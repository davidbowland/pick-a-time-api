import { calendarAccountRecord, session } from '../__mocks__'
import { syncCalendarAccountForPoll } from '@services/calendar-sync'
import * as dynamodb from '@services/dynamodb'
import * as googleCalendar from '@services/google-calendar'
import * as kms from '@services/kms'
import { logError } from '@utils/logging'

jest.mock('@services/dynamodb')
jest.mock('@services/google-calendar')
jest.mock('@services/kms')
jest.mock('@utils/logging', () => ({
  ...jest.requireActual('@utils/logging'),
  log: jest.fn(),
  logError: jest.fn(),
  xrayCapture: jest.fn((x: unknown) => x),
}))

describe('calendar-sync', () => {
  const freshNow = () => calendarAccountRecord.lastSyncedAt * 1000 + 1000 // 1 second after lastSyncedAt

  beforeAll(() => {
    jest.mocked(kms).decryptRefreshToken.mockResolvedValue('decrypted-refresh-token')
    jest.mocked(googleCalendar).refreshAccessToken.mockResolvedValue('access-token')
    jest.mocked(googleCalendar).fetchFreeBusy.mockResolvedValue([])
    jest.mocked(dynamodb).putCalendarAccount.mockResolvedValue(undefined)
  })

  describe('syncCalendarAccountForPoll', () => {
    it('should return the cached record unchanged when fresh and range-covered', async () => {
      // session spans 2025-09-04 through 2025-09-06 (3 dates) — inside the fixture's syncedRange
      const result = await syncCalendarAccountForPoll(calendarAccountRecord, session, freshNow)
      expect(result).toEqual(calendarAccountRecord)
      expect(googleCalendar.fetchFreeBusy).not.toHaveBeenCalled()
    })

    it('should refresh when the cached range does not cover the poll dates', async () => {
      const outOfRangeRecord = { ...calendarAccountRecord, syncedRange: { start: '2020-01-01', end: '2020-01-31' } }
      const rawInterval = { start: '2025-09-04T21:00:00.000Z', end: '2025-09-04T22:00:00.000Z' }
      jest.mocked(googleCalendar).fetchFreeBusy.mockResolvedValueOnce([rawInterval])

      const result = await syncCalendarAccountForPoll(outOfRangeRecord, session, freshNow)

      expect(googleCalendar.fetchFreeBusy).toHaveBeenCalled()
      expect(result.status).toBe('connected')
      // busyIntervals is stored exactly as Google returned it -- no per-timezone conversion happens
      // at sync time anymore, since the cache is shared across polls that may be in different
      // timezones. Conversion to date/minute blocks happens per-reader in buildBusyGrid instead.
      expect(result.busyIntervals).toEqual([rawInterval])
      expect(dynamodb.putCalendarAccount).toHaveBeenCalledWith(expect.objectContaining({ status: 'connected' }))
    })

    it('should query a UTC window padded 14h before the start date and 12h after the day following the end date', async () => {
      // session (fixture) spans 2025-09-04 through 2025-09-06 (3 dates). The window no longer depends on
      // poll.timezone, usesTimes, or startMinute/endMinute at all -- padding wide enough to cover every
      // real-world UTC offset (UTC-12 to UTC+14) guarantees any reading poll's local day for a
      // "covered" date is fully contained in what was actually fetched, regardless of which poll's
      // timezone triggered the sync.
      const outOfRangeRecord = { ...calendarAccountRecord, syncedRange: { start: '2020-01-01', end: '2020-01-31' } }

      await syncCalendarAccountForPoll(outOfRangeRecord, session, freshNow)

      expect(googleCalendar.fetchFreeBusy).toHaveBeenCalledWith(
        'access-token',
        '2025-09-03T10:00:00.000Z', // 2025-09-04T00:00:00Z minus 14h
        '2025-09-07T12:00:00.000Z', // 2025-09-07T00:00:00Z (day after the last date) plus 12h
      )
    })

    it('should compute an identical fetch window regardless of the syncing poll timezone or hour window', async () => {
      // Same occurrence dates as `session`, but a different timezone and a narrow hour window
      // (e.g. a lunch poll). Both used to influence the query window (timezone-anchored day
      // boundaries; hours were clipped before an earlier review fix) -- neither does anymore. This
      // is the regression test for the cross-timezone shared-cache bug: whichever poll syncs first
      // must fetch a window that fully covers every other poll's interpretation of the same dates.
      const outOfRangeRecord = { ...calendarAccountRecord, syncedRange: { start: '2020-01-01', end: '2020-01-31' } }
      const differentPoll = { ...session, timezone: 'Pacific/Kiritimati', startMinute: 660, endMinute: 840 }

      await syncCalendarAccountForPoll(outOfRangeRecord, differentPoll, freshNow)

      expect(googleCalendar.fetchFreeBusy).toHaveBeenCalledWith(
        'access-token',
        '2025-09-03T10:00:00.000Z',
        '2025-09-07T12:00:00.000Z',
      )
    })

    it('should refresh when lastSyncedAt is stale even if the range is covered', async () => {
      const staleNow = () => calendarAccountRecord.lastSyncedAt * 1000 + 3_600_000 // 1 hour later, past the 30-min threshold
      await syncCalendarAccountForPoll(calendarAccountRecord, session, staleNow)
      expect(googleCalendar.fetchFreeBusy).toHaveBeenCalled()
    })

    it('should mark status error and keep serving cached busyIntervals on refresh failure', async () => {
      const staleNow = () => calendarAccountRecord.lastSyncedAt * 1000 + 3_600_000
      jest.mocked(googleCalendar).refreshAccessToken.mockRejectedValueOnce(new Error('invalid_grant'))

      const result = await syncCalendarAccountForPoll(calendarAccountRecord, session, staleNow)

      expect(result.status).toBe('error')
      expect(result.busyIntervals).toEqual(calendarAccountRecord.busyIntervals)
      expect(dynamodb.putCalendarAccount).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }))
    })

    it('should update lastSyncedAt on failure so a previously-synced account is not retried again within the freshness window', async () => {
      const staleNow = () => calendarAccountRecord.lastSyncedAt * 1000 + 3_600_000 // 1 hour later, past the 30-min threshold
      jest.mocked(googleCalendar).refreshAccessToken.mockRejectedValueOnce(new Error('invalid_grant'))

      const failed = await syncCalendarAccountForPoll(calendarAccountRecord, session, staleNow)

      expect(failed.status).toBe('error')
      expect(failed.lastSyncedAt).toBe(Math.floor(staleNow() / 1000))

      // A second read shortly after the failure (well within the freshness window measured from
      // the NEW lastSyncedAt) must not attempt the sync again.
      const shortlyAfterFailure = () => staleNow() + 1_000
      const result = await syncCalendarAccountForPoll(failed, session, shortlyAfterFailure)

      expect(result).toEqual(failed)
      expect(googleCalendar.refreshAccessToken).toHaveBeenCalledTimes(1)
      expect(googleCalendar.fetchFreeBusy).not.toHaveBeenCalled()
    })

    it('should sanitize an Axios-shaped refreshAccessToken failure before logging it, never logging config secrets', async () => {
      const staleNow = () => calendarAccountRecord.lastSyncedAt * 1000 + 3_600_000
      const axiosError = {
        message: 'Request failed with status code 400',
        isAxiosError: true,
        response: { status: 400 },
        config: { params: { client_secret: 'shh-client-secret', refresh_token: 'shh-refresh-token' } },
      }
      jest.mocked(googleCalendar).refreshAccessToken.mockRejectedValueOnce(axiosError)

      const result = await syncCalendarAccountForPoll(calendarAccountRecord, session, staleNow)

      expect(result.status).toBe('error')
      expect(logError).toHaveBeenCalledWith('Calendar sync failed, serving cached busy data', {
        message: axiosError.message,
        status: 400,
      })
      const loggedCall = jest
        .mocked(logError)
        .mock.calls.find(([firstArg]) => firstArg === 'Calendar sync failed, serving cached busy data')
      expect(JSON.stringify(loggedCall)).not.toContain('config')
      expect(JSON.stringify(loggedCall)).not.toContain('shh-client-secret')
      expect(JSON.stringify(loggedCall)).not.toContain('shh-refresh-token')
    })

    it('should still return the synced record when persisting the success-path result fails', async () => {
      const outOfRangeRecord = { ...calendarAccountRecord, syncedRange: { start: '2020-01-01', end: '2020-01-31' } }
      const rawInterval = { start: '2025-09-04T21:00:00.000Z', end: '2025-09-04T22:00:00.000Z' }
      jest.mocked(googleCalendar).fetchFreeBusy.mockResolvedValueOnce([rawInterval])
      jest.mocked(dynamodb).putCalendarAccount.mockRejectedValueOnce(new Error('ProvisionedThroughputExceeded'))

      const result = await syncCalendarAccountForPoll(outOfRangeRecord, session, freshNow)

      expect(result.status).toBe('connected')
      expect(result.busyIntervals).toEqual([rawInterval])
      expect(logError).toHaveBeenCalledWith('Failed to persist calendar account sync result', expect.any(Error))
    })

    it('should still return the error-flagged record when persisting the failure-path fallback fails', async () => {
      const staleNow = () => calendarAccountRecord.lastSyncedAt * 1000 + 3_600_000
      jest.mocked(googleCalendar).refreshAccessToken.mockRejectedValueOnce(new Error('invalid_grant'))
      jest.mocked(dynamodb).putCalendarAccount.mockRejectedValueOnce(new Error('ProvisionedThroughputExceeded'))

      const result = await syncCalendarAccountForPoll(calendarAccountRecord, session, staleNow)

      expect(result.status).toBe('error')
      expect(result.busyIntervals).toEqual(calendarAccountRecord.busyIntervals)
      expect(logError).toHaveBeenCalledWith('Failed to persist calendar account sync result', expect.any(Error))
    })
  })
})
