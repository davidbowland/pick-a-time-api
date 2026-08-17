import { availabilityRecord, session, sessionId, userId } from '../__mocks__'
import { NotFoundError } from '@errors'
import { readAvailabilityRecord } from '@services/availability'
import * as dynamodb from '@services/dynamodb'
import * as googleCalendar from '@services/google-calendar'

jest.mock('@services/dynamodb')
jest.mock('@services/google-calendar')

describe('availability', () => {
  // assertSessionActive compares against the real clock, so the fixture poll has to outlive any day
  // this suite runs on. Year 2286 is far enough that the test can never expire.
  const activeSession = { ...session, expiration: 9_999_999_999 }
  // Same shape either way -- only calendarCheckedAt differs, and it is the field that says whether
  // this participant ever connected a calendar.
  const connectionCases: [string, number | null][] = [
    ['a participant with a connected calendar', 1_728_547_000],
    ['a participant without one', null],
  ]

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: activeSession, users: [userId] })
    jest.mocked(dynamodb).getAvailability.mockResolvedValue(availabilityRecord)
  })

  describe('readAvailabilityRecord', () => {
    it('should return the stored record alongside the poll it belongs to', async () => {
      const result = await readAvailabilityRecord(sessionId, userId)

      expect(result).toEqual({ availability: availabilityRecord, session: activeSession })
      expect(dynamodb.getSession).toHaveBeenCalledWith(sessionId)
      expect(dynamodb.getAvailability).toHaveBeenCalledWith(sessionId, userId)
    })

    it('should return the record exactly as stored, calendarCheckedAt included', async () => {
      const checked = { ...availabilityRecord, calendarCheckedAt: 1_728_547_000 }
      jest.mocked(dynamodb).getAvailability.mockResolvedValueOnce(checked)

      const { availability } = await readAvailabilityRecord(sessionId, userId)

      // Deciding what a caller may see is the caller's job: the open route drops calendarCheckedAt,
      // the authenticated one does not. A service that stripped it here would make that choice for
      // both and leave the authed route unable to report when the calendar was last checked.
      expect(availability).toEqual(checked)
    })

    it('should reject an expired poll before the record is read at all', async () => {
      jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: { ...session, expiration: 1 }, users: [] })

      await expect(readAvailabilityRecord(sessionId, userId)).rejects.toThrow(NotFoundError)
      expect(dynamodb.getAvailability).not.toHaveBeenCalled()
    })

    it('should propagate NotFoundError when the record does not exist', async () => {
      jest.mocked(dynamodb).getAvailability.mockRejectedValueOnce(new NotFoundError('Availability not found'))

      await expect(readAvailabilityRecord(sessionId, userId)).rejects.toThrow(NotFoundError)
    })

    // This read backs the unauthenticated route, so it must have no path to Google at all. A record
    // read that refreshed a connected participant's calendar and did nothing for an unconnected one
    // would take visibly longer for the first -- turning the open route into a timing oracle for who
    // linked an account, which is exactly the disclosure stripCalendarCheckedAt exists to prevent.
    it.each(connectionCases)('should reach no Google call for %s', async (_label, calendarCheckedAt) => {
      jest.mocked(dynamodb).getAvailability.mockResolvedValueOnce({ ...availabilityRecord, calendarCheckedAt })

      await readAvailabilityRecord(sessionId, userId)

      expect(googleCalendar.refreshAccessToken).not.toHaveBeenCalled()
      expect(googleCalendar.fetchFreeBusy).not.toHaveBeenCalled()
      expect(dynamodb.getCalendarAccount).not.toHaveBeenCalled()
    })
  })
})
