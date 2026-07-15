import { NotFoundError } from '@errors'

import { availabilityRecord, calendarAccountRecord, session, sessionId, userRecord } from '../__mocks__'
import eventJson from '@events/get-overlap.json'
import { handler } from '@handlers/get-overlap'
import * as calendarSync from '@services/calendar-sync'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'
import * as logging from '@utils/logging'

jest.mock('@services/dynamodb')
jest.mock('@services/calendar-sync')
jest.mock('@utils/logging', () => ({ log: jest.fn(), logError: jest.fn(), xrayCapture: jest.fn((x: unknown) => x) }))

describe('get-overlap', () => {
  const baseEvent = eventJson as unknown as APIGatewayProxyEventV2
  const futureSession = { ...session, expiration: 9999999999 } // 3 dates x 3 slots

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [sessionId] })
    jest.mocked(dynamodb).getAllAvailability.mockResolvedValue([availabilityRecord])
    jest.mocked(dynamodb).getAllUsers.mockResolvedValue([userRecord]) // userRecord.googleSub is null -> no sync attempted
    jest.mocked(dynamodb).getCalendarAccount.mockResolvedValue(null)
  })

  it('should return the grid and recommendations', async () => {
    const result = await handler(baseEvent)
    expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
    const body = JSON.parse((result as { body: string }).body)
    expect(body.grid.cells).toHaveLength(3) // dates.length
    expect(body.grid.cells[0]).toHaveLength(3) // slot count
    expect(body.recommendedMeetings.length).toBeGreaterThan(0)
  })

  it('should return NOT_FOUND when the session is expired', async () => {
    jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: { ...session, expiration: 1 }, users: [] })
    const result = await handler(baseEvent)
    expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
  })

  it('should return NOT_FOUND when the session does not exist', async () => {
    jest.mocked(dynamodb).getSession.mockRejectedValueOnce(new NotFoundError('Session not found'))
    const result = await handler(baseEvent)
    expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
  })

  it('should return INTERNAL_SERVER_ERROR on an unexpected error', async () => {
    jest.mocked(dynamodb).getAllAvailability.mockRejectedValueOnce(new Error('boom'))
    const result = await handler(baseEvent)
    expect(result).toEqual(expect.objectContaining({ statusCode: 500 }))
  })

  describe('calendar sync integration', () => {
    it('should skip calendar sync entirely for users with no googleSub', async () => {
      await handler(baseEvent)
      expect(dynamodb.getCalendarAccount).not.toHaveBeenCalled()
    })

    it('should sync and fold busy data in for a connected, authenticated user', async () => {
      const connectedUser = { ...userRecord, googleSub: calendarAccountRecord.googleSub }
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([connectedUser])
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(calendarAccountRecord)
      jest.mocked(calendarSync).syncCalendarAccountForPoll.mockResolvedValueOnce(calendarAccountRecord)

      const result = await handler(baseEvent)

      expect(calendarSync.syncCalendarAccountForPoll).toHaveBeenCalledWith(calendarAccountRecord, expect.anything())
      expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
    })

    it('should still attempt sync for a user whose stored connection is in an error state', async () => {
      const connectedUser = { ...userRecord, googleSub: calendarAccountRecord.googleSub }
      const erroredRecord = { ...calendarAccountRecord, status: 'error' as const }
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([connectedUser])
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(erroredRecord)
      jest.mocked(calendarSync).syncCalendarAccountForPoll.mockResolvedValueOnce(erroredRecord)

      await handler(baseEvent)

      expect(calendarSync.syncCalendarAccountForPoll).toHaveBeenCalledWith(erroredRecord, expect.anything())
    })

    it('should still fold cached busy data in when sync fails, not treat the user as fully free', async () => {
      const connectedUser = { ...userRecord, googleSub: calendarAccountRecord.googleSub }
      const failedSync = {
        ...calendarAccountRecord,
        status: 'error' as const,
        // 16:00-17:00 local America/Chicago (CDT, UTC-5) on 2025-09-05 (dateIndex 1, slotIndex 0 is free
        // per availabilityRecord.free[1][0]).
        busyIntervals: [{ start: '2025-09-05T21:00:00.000Z', end: '2025-09-05T22:00:00.000Z' }],
      }
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([connectedUser])
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(calendarAccountRecord)
      jest.mocked(calendarSync).syncCalendarAccountForPoll.mockResolvedValueOnce(failedSync)

      const result = await handler(baseEvent)
      const body = JSON.parse((result as { body: string }).body)

      expect(body.grid.cells[1][0].freeUserIds).not.toContain(connectedUser.userId)
    })

    it('should drop only the affected user and still return 200 when getCalendarAccount rejects for one connected user', async () => {
      const failingUser = { ...userRecord, googleSub: 'google-sub-failing', userId: 'failing-user' }
      const workingUser = { ...userRecord, googleSub: calendarAccountRecord.googleSub, userId: 'working-user' }
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([failingUser, workingUser])
      jest
        .mocked(dynamodb)
        .getCalendarAccount.mockRejectedValueOnce(new Error('DynamoDB throttled'))
        .mockResolvedValueOnce(calendarAccountRecord)
      jest.mocked(calendarSync).syncCalendarAccountForPoll.mockResolvedValueOnce(calendarAccountRecord)

      const result = await handler(baseEvent)

      expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.grid.cells).toHaveLength(3)
      expect(logging.logError).toHaveBeenCalledWith(expect.any(Error))
    })
  })
})
