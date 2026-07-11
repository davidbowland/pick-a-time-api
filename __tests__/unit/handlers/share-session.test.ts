import { NotFoundError, RateLimitError } from '@errors'

import { session, sessionId, userRecord } from '../__mocks__'
import eventJson from '@events/share-session.json'
import { handler } from '@handlers/share-session'
import * as dynamodb from '@services/dynamodb'
import * as sms from '@services/sms'
import { APIGatewayProxyEventV2, UserRecord } from '@types'
import * as idGenerator from '@utils/id-generator'
import status from '@utils/status'

jest.mock('@services/dynamodb')
jest.mock('@services/sms')
jest.mock('@utils/id-generator')
jest.mock('@utils/logging', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  xrayCapture: jest.fn((x: unknown) => x),
  xrayCaptureHttps: jest.fn(),
}))

describe('share-session', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const futureExpiration = 9999999999
  const futureSession = { ...session, expiration: futureExpiration }
  const sharingUser: UserRecord = {
    ...userRecord,
    expiration: futureExpiration,
    googleSub: 'google-uid-123',
    textsSent: 0,
  }

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: ['fuzzy-penguin'], version: 0 })
    jest.mocked(dynamodb).getUser.mockResolvedValue(sharingUser)
    jest.mocked(dynamodb).getAllUsers.mockResolvedValue([{ ...sharingUser }])
    jest.mocked(dynamodb).createUser.mockResolvedValue(undefined)
    jest.mocked(dynamodb).updateUser.mockResolvedValue(undefined)
    jest.mocked(dynamodb).incrementTextsSent.mockResolvedValue(undefined)
    jest.mocked(sms).sendSms.mockResolvedValue({} as any)
    jest.mocked(idGenerator).generateUserId.mockReturnValue('brave-tiger')
  })

  describe('handler', () => {
    it('should return CREATED with userId on successful share', async () => {
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.CREATED))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.userId).toBe('brave-tiger')
    })

    it('should return 401 when no auth context is present', async () => {
      const unauthEvent = {
        ...event,
        requestContext: { http: event.requestContext.http },
      } as unknown as APIGatewayProxyEventV2
      const result = await handler(unauthEvent)
      expect(result).toEqual(expect.objectContaining({ statusCode: 401 }))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.message).toContain('Authentication required')
    })

    it('should allow sharing when sharing user has no phone set', async () => {
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce({ ...sharingUser, phone: null })
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.CREATED))
    })

    it('should return 403 when caller googleSub does not match sharing user', async () => {
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce({ ...sharingUser, googleSub: 'different-uid' })
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 403 }))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.message).toContain('your own user')
    })

    it('should backfill googleSub and allow sharing when sharing user has null googleSub', async () => {
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce({ ...sharingUser, googleSub: null })
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.CREATED))
      expect(dynamodb.updateUser).toHaveBeenCalledWith(
        sessionId,
        'fuzzy-penguin',
        expect.objectContaining({ googleSub: 'google-uid-123' }),
      )
    })

    it('should allow sharing when authenticated with minimal claims', async () => {
      const minimalAuthEvent = {
        ...event,
        requestContext: {
          ...event.requestContext,
          authorizer: { jwt: { claims: { sub: 'google-uid-123' } } },
        },
      } as unknown as APIGatewayProxyEventV2
      const result = await handler(minimalAuthEvent)
      expect(result).toEqual(expect.objectContaining(status.CREATED))
    })

    it('should call incrementTextsSent before creating user', async () => {
      await handler(event)
      const incrementOrder = jest.mocked(dynamodb).incrementTextsSent.mock.invocationCallOrder[0]
      const createOrder = jest.mocked(dynamodb).createUser.mock.invocationCallOrder[0]
      expect(incrementOrder).toBeLessThan(createOrder)
    })

    it('should call incrementTextsSent with sessionId, userId, and limit', async () => {
      await handler(event)
      expect(dynamodb.incrementTextsSent).toHaveBeenCalledWith(sessionId, 'fuzzy-penguin', expect.any(Number))
    })

    it('should create user with recipient phone number and availability grid', async () => {
      await handler(event)
      expect(dynamodb.createUser).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({ phone: '+15551234567', userId: 'brave-tiger' }),
        expect.objectContaining({
          userId: 'brave-tiger',
          overrides: {},
          template: expect.any(Array),
        }),
      )
    })

    it('should send SMS with session link', async () => {
      await handler(event)
      expect(sms.sendSms).toHaveBeenCalledWith(
        '+15551234567',
        `Join the plan to add your hours: https://pick-a-time.bowland.link/s/${sessionId}?id=brave-tiger`,
      )
    })

    it('should return BAD_REQUEST for invalid phone number', async () => {
      const badPhoneEvent = {
        ...event,
        body: JSON.stringify({ phone: '5551234567', type: 'text' }),
      } as unknown as APIGatewayProxyEventV2
      const result = await handler(badPhoneEvent)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
    })

    it('should return BAD_REQUEST when session has max users', async () => {
      const fullUsers = Array.from({ length: 10 }, (_, i) => `user-${i}`)
      jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: futureSession, users: fullUsers, version: 0 })
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
      expect(JSON.parse((result as { body: string }).body).message).toContain('10')
    })

    it('should return error with userId when SMS fails after user creation', async () => {
      jest.mocked(sms).sendSms.mockRejectedValueOnce(new Error('SMS failed'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 500 }))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.message).toContain('SMS')
      expect(body.userId).toBe('brave-tiger')
    })

    it('should return TOO_MANY_REQUESTS when incrementTextsSent throws RateLimitError', async () => {
      jest.mocked(dynamodb).incrementTextsSent.mockRejectedValueOnce(new RateLimitError('SMS rate limit exceeded'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.TOO_MANY_REQUESTS))
    })

    it('should not create user when rate limit is exceeded', async () => {
      jest.mocked(dynamodb).incrementTextsSent.mockRejectedValueOnce(new RateLimitError('SMS rate limit exceeded'))
      await handler(event)
      expect(dynamodb.createUser).not.toHaveBeenCalled()
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

    it('should return NOT_FOUND when sharing user does not exist', async () => {
      jest.mocked(dynamodb).getUser.mockRejectedValueOnce(new NotFoundError('User not found'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.NOT_FOUND))
    })

    it('should return 422 when phone number is already in use', async () => {
      const existingUser: UserRecord = { ...userRecord, expiration: futureExpiration, phone: '+15551234567' }
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([existingUser])
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 422 }))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.message).toContain('phone number')
    })

    it('should not increment textsSent when phone number is already in use', async () => {
      const existingUser: UserRecord = { ...userRecord, expiration: futureExpiration, phone: '+15551234567' }
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([existingUser])
      await handler(event)
      expect(dynamodb.incrementTextsSent).not.toHaveBeenCalled()
    })

    it('should return BAD_REQUEST for invalid type', async () => {
      const badTypeEvent = {
        ...event,
        body: JSON.stringify({ phone: '+15551234567', type: 'email' }),
      } as unknown as APIGatewayProxyEventV2
      const result = await handler(badTypeEvent)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
    })
  })
})
