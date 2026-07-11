import { ConflictError, NotFoundError } from '@errors'

import { session, sessionId } from '../__mocks__'
import eventJson from '@events/post-user.json'
import { handler } from '@handlers/post-user'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'
import * as idGenerator from '@utils/id-generator'
import status from '@utils/status'

jest.mock('@services/dynamodb')
jest.mock('@utils/id-generator')
jest.mock('@utils/logging', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  xrayCapture: jest.fn((x: unknown) => x),
  xrayCaptureHttps: jest.fn(),
}))

describe('post-user', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const futureExpiration = 9999999999
  const futureSession = { ...session, expiration: futureExpiration }

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [], version: 0 })
    jest.mocked(dynamodb).createUser.mockResolvedValue(undefined)
    jest.mocked(idGenerator).generateUserId.mockReturnValue('brave-tiger')
  })

  describe('handler', () => {
    it('should return CREATED with user object on success', async () => {
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.CREATED))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.userId).toBe('brave-tiger')
      expect(body.name).toBeNull()
      expect(body.phone).toBeNull()
      expect(body.subscribedRounds).toEqual([])
      expect(body.textsSent).toBe(0)
      expect(body.googleSub).toBeUndefined()
    })

    it('should set name from Google auth context when authenticated', async () => {
      const authedEvent = {
        ...event,
        requestContext: {
          ...event.requestContext,
          authorizer: { jwt: { claims: { name: 'Google User' } } },
        },
      } as unknown as APIGatewayProxyEventV2
      const result = await handler(authedEvent)
      const body = JSON.parse((result as { body: string }).body)
      expect(body.name).toBe('Google User')
    })

    it('should set phone from Google auth context when authenticated', async () => {
      const authedEvent = {
        ...event,
        requestContext: {
          ...event.requestContext,
          authorizer: { jwt: { claims: { name: 'Google User', phone_number: '+15559999999' } } },
        },
      } as unknown as APIGatewayProxyEventV2
      const result = await handler(authedEvent)
      const body = JSON.parse((result as { body: string }).body)
      expect(body.phone).toBe('+15559999999')
    })

    it('should ignore invalid phone format from Google auth context', async () => {
      const authedEvent = {
        ...event,
        requestContext: {
          ...event.requestContext,
          authorizer: { jwt: { claims: { name: 'Google User', phone_number: '+4412345678' } } },
        },
      } as unknown as APIGatewayProxyEventV2
      const result = await handler(authedEvent)
      const body = JSON.parse((result as { body: string }).body)
      expect(body.phone).toBeNull()
    })

    it('should set name to null when not authenticated', async () => {
      const result = await handler(event)
      const body = JSON.parse((result as { body: string }).body)
      expect(body.name).toBeNull()
    })

    it('should initialize votes with empty arrays for all rounds up to currentRound', async () => {
      const sessionAtRound2 = { ...futureSession, currentRound: 2 }
      jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: sessionAtRound2, users: [], version: 0 })
      const result = await handler(event)
      const body = JSON.parse((result as { body: string }).body)
      expect(body.votes).toEqual([[], [], []])
    })

    it('should set user expiration to match session expiration', async () => {
      const result = await handler(event)
      const body = JSON.parse((result as { body: string }).body)
      expect(body.expiration).toBe(futureExpiration)
    })

    it('should call createUser with correct sessionId and user record', async () => {
      await handler(event)
      expect(dynamodb.createUser).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          userId: 'brave-tiger',
          name: null,
          phone: null,
        }),
      )
    })

    it('should return NOT_FOUND when session does not exist', async () => {
      jest.mocked(dynamodb).getSession.mockRejectedValueOnce(new NotFoundError('Session not found'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.NOT_FOUND))
    })

    it('should return NOT_FOUND when session is expired', async () => {
      const expiredSession = { ...session, expiration: 1 }
      jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: expiredSession, users: [], version: 0 })
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.NOT_FOUND))
    })

    it('should return BAD_REQUEST when session has max users', async () => {
      const fullUsers = Array.from({ length: 10 }, (_, i) => `user-${i}`)
      jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: futureSession, users: fullUsers, version: 0 })
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
      expect(JSON.parse((result as { body: string }).body).message).toContain('10')
    })

    it('should call generateUserId with existing user IDs from session', async () => {
      jest
        .mocked(dynamodb)
        .getSession.mockResolvedValueOnce({ session: futureSession, users: ['alpha-dog', 'beta-cat'], version: 0 })
      await handler(event)
      expect(idGenerator.generateUserId).toHaveBeenCalledWith(['alpha-dog', 'beta-cat'])
    })

    it('should return INTERNAL_SERVER_ERROR when generateUserId throws', async () => {
      jest.mocked(idGenerator).generateUserId.mockImplementationOnce(() => {
        throw new Error('Failed to generate a unique user ID after maximum retries')
      })
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.INTERNAL_SERVER_ERROR))
    })

    it('should return INTERNAL_SERVER_ERROR when createUser rejects', async () => {
      jest.mocked(dynamodb).createUser.mockRejectedValueOnce(new Error('DynamoDB error'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.INTERNAL_SERVER_ERROR))
    })

    it('should return INTERNAL_SERVER_ERROR when createUser throws ConflictError', async () => {
      jest.mocked(dynamodb).createUser.mockRejectedValueOnce(new ConflictError('User ID already exists'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.INTERNAL_SERVER_ERROR))
    })
  })
})
