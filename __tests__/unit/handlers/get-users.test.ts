import { NotFoundError } from '@errors'

import { calendarAccountRecord, session, userRecord } from '../__mocks__'
import eventJson from '@events/get-users.json'
import { handler } from '@handlers/get-users'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'
import status from '@utils/status'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  xrayCapture: jest.fn((x: unknown) => x),
  xrayCaptureHttps: jest.fn(),
}))

describe('get-users', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const futureSession = { ...session, expiration: 9999999999 }

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [], version: 0 })
    jest.mocked(dynamodb).getAllUsers.mockResolvedValue([userRecord])
    jest.mocked(dynamodb).getCalendarAccount.mockResolvedValue(null)
  })

  describe('handler', () => {
    it('should return OK with users array', async () => {
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
      const body = JSON.parse((result as { body: string }).body)
      const { googleSub: _, ...responseUser } = userRecord
      expect(body).toEqual([{ ...responseUser, calendarStatus: 'not_connected' }])
    })

    it('should return users without googleSub, votes, or subscribedRounds fields', async () => {
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([userRecord])
      const result = await handler(event)
      const body = JSON.parse((result as { body: string }).body)
      const { googleSub: _, ...responseUser } = userRecord
      expect(body[0]).toEqual({ ...responseUser, calendarStatus: 'not_connected' })
      expect(body[0].googleSub).toBeUndefined()
      expect(body[0].votes).toBeUndefined()
      expect(body[0].subscribedRounds).toBeUndefined()
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

    it('should return OK with empty array when no users exist', async () => {
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([])
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
      expect(JSON.parse((result as { body: string }).body)).toEqual([])
    })

    it('should return INTERNAL_SERVER_ERROR on unexpected errors', async () => {
      jest.mocked(dynamodb).getAllUsers.mockRejectedValueOnce(new Error('DynamoDB error'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.INTERNAL_SERVER_ERROR))
    })
  })

  describe('calendarStatus', () => {
    it('should report not_connected for a user with no googleSub', async () => {
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([{ ...userRecord, googleSub: null }])
      const result = await handler(event)
      const body = JSON.parse((result as { body: string }).body)
      expect(body[0].calendarStatus).toBe('not_connected')
      expect(dynamodb.getCalendarAccount).not.toHaveBeenCalled()
    })

    it('should report not_connected for an authenticated user with no calendar record', async () => {
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([{ ...userRecord, googleSub: 'some-sub' }])
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(null)
      const result = await handler(event)
      expect(JSON.parse((result as { body: string }).body)[0].calendarStatus).toBe('not_connected')
    })

    it('should report connected when a healthy calendar record exists', async () => {
      jest
        .mocked(dynamodb)
        .getAllUsers.mockResolvedValueOnce([{ ...userRecord, googleSub: calendarAccountRecord.googleSub }])
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(calendarAccountRecord)
      const result = await handler(event)
      expect(JSON.parse((result as { body: string }).body)[0].calendarStatus).toBe('connected')
    })

    it('should report error when the stored calendar record is unhealthy', async () => {
      jest
        .mocked(dynamodb)
        .getAllUsers.mockResolvedValueOnce([{ ...userRecord, googleSub: calendarAccountRecord.googleSub }])
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce({ ...calendarAccountRecord, status: 'error' })
      const result = await handler(event)
      expect(JSON.parse((result as { body: string }).body)[0].calendarStatus).toBe('error')
    })

    it('should default calendarStatus to not_connected (and still return 200) when the calendar lookup for one user rejects, without affecting other users', async () => {
      const brokenUser = { ...userRecord, userId: 'broken-user', googleSub: 'broken-sub' }
      const healthyUser = { ...userRecord, userId: 'healthy-user', googleSub: calendarAccountRecord.googleSub }
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([brokenUser, healthyUser])
      jest
        .mocked(dynamodb)
        .getCalendarAccount.mockImplementationOnce(() => Promise.reject(new Error('DynamoDB unavailable')))
        .mockResolvedValueOnce(calendarAccountRecord)

      const result = await handler(event)

      expect(result).toEqual(expect.objectContaining(status.OK))
      const body = JSON.parse((result as { body: string }).body)
      expect(body).toEqual([
        expect.objectContaining({ userId: 'broken-user', calendarStatus: 'not_connected' }),
        expect.objectContaining({ userId: 'healthy-user', calendarStatus: 'connected' }),
      ])
    })
  })
})
