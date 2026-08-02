import { availabilityRecord, calendarAccountRecord, session, sessionId, userRecord } from '../__mocks__'
import { NotFoundError } from '@errors'
import eventJson from '@events/get-overlap.json'
import { handler } from '@handlers/get-overlap'
import * as calendarSync from '@services/calendar-sync'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'

jest.mock('@services/dynamodb')
jest.mock('@services/calendar-sync')
jest.mock('@utils/logging', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  redactEvent: jest.fn((event: unknown) => event),
  xrayCapture: jest.fn((x: unknown) => x),
}))

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

  describe('calendar is not consulted at read time', () => {
    // The connected user's busyIntervals cover 2025-09-04 16:00-17:00 America/Chicago, which is
    // cells[0][0]. Their stored availability says free there, and stored availability is the only
    // source of truth now -- calendar busy time is written into it by the sync endpoint instead.
    const connectedUser = { ...userRecord, googleSub: calendarAccountRecord.googleSub }
    const allFree = {
      ...availabilityRecord,
      free: [
        [true, true, true],
        [true, true, true],
        [true, true, true],
      ],
    }

    it('should count a user free even when their calendar shows a conflict', async () => {
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([connectedUser])
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(calendarAccountRecord)
      jest.mocked(calendarSync).syncCalendarAccountForPoll.mockResolvedValueOnce(calendarAccountRecord)
      jest.mocked(dynamodb).getAllAvailability.mockResolvedValueOnce([allFree])

      const result = await handler(baseEvent)

      const body = JSON.parse((result as { body: string }).body)
      expect(body.grid.cells[0][0].freeUserIds).toContain(allFree.userId)
    })

    it('should not sync any calendar while reading', async () => {
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([connectedUser])
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(calendarAccountRecord)
      jest.mocked(dynamodb).getAllAvailability.mockResolvedValueOnce([allFree])

      await handler(baseEvent)

      expect(calendarSync.syncCalendarAccountForPoll).not.toHaveBeenCalled()
      expect(dynamodb.getCalendarAccount).not.toHaveBeenCalled()
    })
  })
})
