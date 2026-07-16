import { ConflictError, NotFoundError } from '@errors'

import { session, sessionId } from '../__mocks__'
import eventJson from '@events/post-user.json'
import { handler } from '@handlers/post-user'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'
import * as idGenerator from '@utils/id-generator'

jest.mock('@services/dynamodb')
jest.mock('@utils/id-generator')
jest.mock('@utils/logging', () => ({ log: jest.fn(), logError: jest.fn(), xrayCapture: jest.fn((x: unknown) => x) }))

describe('post-user', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const futureExpiration = 9999999999
  const futureSession = { ...session, expiration: futureExpiration }

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [] })
    jest.mocked(dynamodb).createUser.mockResolvedValue(undefined)
    jest.mocked(idGenerator).generateUserId.mockReturnValue('brave-tiger')
  })

  describe('handler', () => {
    it('should return CREATED with user object on success', async () => {
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 201 }))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.userId).toBe('brave-tiger')
      expect(body.name).toBeNull()
      expect(body.googleSub).toBeUndefined()
    })

    it('should create an empty availability grid sized from the poll dates and slots', async () => {
      await handler(event)
      expect(dynamodb.createUser).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({ userId: 'brave-tiger' }),
        expect.objectContaining({
          userId: 'brave-tiger',
          free: [
            [false, false, false],
            [false, false, false],
            [false, false, false],
          ],
        }),
      )
    })

    it('should create a single-column-per-date grid when the poll does not use times', async () => {
      const datesOnlySession = {
        sessionId: 'abc123',
        name: 'Trip',
        dates: ['2025-09-04', '2025-09-05'],
        usesTimes: false as const,
        timezone: 'America/Chicago',
        expiration: futureExpiration,
      }
      jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: datesOnlySession, users: [] })
      await handler(event)
      expect(dynamodb.createUser).toHaveBeenCalledWith(
        sessionId,
        expect.anything(),
        expect.objectContaining({ free: [[false], [false]] }),
      )
    })

    it('should create a ragged availability grid when the poll has a per-date override', async () => {
      const overrideSession = {
        ...futureSession,
        overrides: [{ dates: ['2025-09-06'], startMinute: 960, endMinute: 1020 }], // Saturday: single 60-min slot
      }
      jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: overrideSession, users: [] })
      await handler(event)
      expect(dynamodb.createUser).toHaveBeenCalledWith(
        sessionId,
        expect.anything(),
        expect.objectContaining({
          free: [[false, false, false], [false, false, false], [false]],
        }),
      )
    })

    it('should set name from Google auth context when authenticated', async () => {
      const authedEvent = {
        ...event,
        requestContext: { ...event.requestContext, authorizer: { jwt: { claims: { name: 'Google User' } } } },
      } as unknown as APIGatewayProxyEventV2
      const result = await handler(authedEvent)
      expect(JSON.parse((result as { body: string }).body).name).toBe('Google User')
    })

    it('should return NOT_FOUND when session does not exist', async () => {
      jest.mocked(dynamodb).getSession.mockRejectedValueOnce(new NotFoundError('Session not found'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
    })

    it('should return BAD_REQUEST when session has max users', async () => {
      const fullUsers = Array.from({ length: 10 }, (_, i) => `user-${i}`)
      jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: futureSession, users: fullUsers })
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
    })

    it('should return INTERNAL_SERVER_ERROR when createUser rejects', async () => {
      jest.mocked(dynamodb).createUser.mockRejectedValueOnce(new ConflictError('exists'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 500 }))
    })
  })
})
