import { session, userRecord } from '../__mocks__'
import { NotFoundError } from '@errors'
import eventJson from '@events/get-users.json'
import { handler } from '@handlers/get-users'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'
import status from '@utils/status'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  redactEvent: jest.fn((event: unknown) => event),
}))

describe('get-users', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const futureSession = { ...session, expiration: 9999999999 }

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [], version: 0 })
    jest.mocked(dynamodb).getAllUsers.mockResolvedValue([userRecord])
  })

  describe('handler', () => {
    it('should return OK with users array', async () => {
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
      const body = JSON.parse((result as { body: string }).body)
      const { googleSub: _, ...responseUser } = userRecord
      expect(body).toEqual([responseUser])
    })

    it('should return users without googleSub, votes, or subscribedRounds fields', async () => {
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([userRecord])
      const result = await handler(event)
      const body = JSON.parse((result as { body: string }).body)
      const { googleSub: _, ...responseUser } = userRecord
      expect(body[0]).toEqual(responseUser)
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

    it('should not disclose any user calendar state', async () => {
      const result = await handler(event)
      const body = JSON.parse((result as { body: string }).body)
      expect(body[0]).not.toHaveProperty('calendarStatus')
      expect(dynamodb.getCalendarAccount).not.toHaveBeenCalled()
    })

    // AC-010. The participant list is the one response every link-holder reads about everybody else,
    // so a single calendar-derived key on it would tell the whole poll who connected an account and,
    // for busy or busyWindow, when they are booked. It is a standing guarantee rather than a
    // consequence of any change here: the handler has no calendar code today, and this is what
    // notices the day somebody adds some. Named fields, not a shape comparison, so a field invented
    // later under one of these names is caught by the name it would actually be given.
    const calendarDerivedFields = ['busy', 'busyWindow', 'calendarCheckedAt', 'calendarStatus', 'lastSyncedAt']

    it.each(calendarDerivedFields)('should expose no %s field on any participant', async (field) => {
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([{ ...userRecord, googleSub: 'google-sub-123' }])

      const result = await handler(event)

      const body = JSON.parse((result as { body: string }).body)
      expect(body[0]).not.toHaveProperty(field)
      // The serialized body too: a nested object would satisfy the property check above and still
      // put the value on the wire.
      expect((result as { body: string }).body).not.toContain(field)
    })

    it('should return INTERNAL_SERVER_ERROR on unexpected errors', async () => {
      jest.mocked(dynamodb).getAllUsers.mockRejectedValueOnce(new Error('DynamoDB error'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.INTERNAL_SERVER_ERROR))
    })
  })
})
