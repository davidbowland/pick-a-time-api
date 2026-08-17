import { calendarAccountRecord, session } from '../__mocks__'
import { CALENDAR_ACCOUNT_TTL_SECONDS, maxCachedBusyIntervals } from '@config'
import { syncCalendarAccountForPoll } from '@services/calendar-sync'
import * as dynamodb from '@services/dynamodb'
import * as googleCalendar from '@services/google-calendar'
import * as kms from '@services/kms'
import { log, logError } from '@utils/logging'

jest.mock('@services/dynamodb')
jest.mock('@services/google-calendar')
jest.mock('@services/kms')
jest.mock('@utils/logging', () => ({
  ...jest.requireActual('@utils/logging'),
  log: jest.fn(),
  logError: jest.fn(),
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

    // Nothing on the success path used to say anything at all, so "the check marked nothing" and
    // "Google answered with nothing" were indistinguishable from outside -- the exact ambiguity that
    // left a dead sync undiagnosable. Counts and the queried window only: interval times are somebody's
    // calendar, and the count is all a reader needs to tell an empty answer from a full one.
    it('should log how many intervals Google returned and the window asked for', async () => {
      const outOfRangeRecord = { ...calendarAccountRecord, syncedRange: { start: '2020-01-01', end: '2020-01-31' } }
      jest.mocked(googleCalendar).fetchFreeBusy.mockResolvedValueOnce([])

      await syncCalendarAccountForPoll(outOfRangeRecord, session, freshNow)

      expect(log).toHaveBeenCalledWith(
        'Fetched free/busy from Google',
        expect.objectContaining({ busyIntervalCount: 0, timeMax: expect.any(String), timeMin: expect.any(String) }),
      )
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

    it('should refetch from Google when forced, even if the cache is fresh', async () => {
      const fresh = {
        ...calendarAccountRecord,
        lastSyncedAt: Math.floor(1728547851000 / 1000),
        syncedRange: { start: '2025-09-04', end: '2025-09-06' },
      }
      await syncCalendarAccountForPoll(fresh, session, () => 1728547851000, true)
      expect(googleCalendar.fetchFreeBusy).toHaveBeenCalled()
    })

    it('should serve the cache when not forced and the cache is fresh', async () => {
      const fresh = {
        ...calendarAccountRecord,
        lastSyncedAt: Math.floor(1728547851000 / 1000),
        syncedRange: { start: '2025-09-04', end: '2025-09-06' },
      }
      const result = await syncCalendarAccountForPoll(fresh, session, () => 1728547851000, false)
      expect(googleCalendar.fetchFreeBusy).not.toHaveBeenCalled()
      expect(result).toEqual(fresh)
    })

    it('should mark status error and keep serving cached busyIntervals on refresh failure', async () => {
      const staleNow = () => calendarAccountRecord.lastSyncedAt * 1000 + 3_600_000
      jest.mocked(googleCalendar).refreshAccessToken.mockRejectedValueOnce(new Error('invalid_grant'))

      const result = await syncCalendarAccountForPoll(calendarAccountRecord, session, staleNow)

      expect(result.status).toBe('error')
      expect(result.busyIntervals).toEqual(calendarAccountRecord.busyIntervals)
      expect(dynamodb.putCalendarAccount).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }))
    })

    it('should stamp lastSyncedAt on failure and still retry on the next check', async () => {
      const staleNow = () => calendarAccountRecord.lastSyncedAt * 1000 + 3_600_000 // 1 hour later, past the 30-min threshold
      jest.mocked(googleCalendar).refreshAccessToken.mockRejectedValueOnce(new Error('invalid_grant'))

      const failed = await syncCalendarAccountForPoll(calendarAccountRecord, session, staleNow)

      expect(failed.status).toBe('error')
      expect(failed.lastSyncedAt).toBe(Math.floor(staleNow() / 1000))

      // The stamp dates the attempt; it must not gate the retry. A check a second later reaches
      // Google again. Before this, the stamp made the errored record look fresh, so the next check
      // short-circuited and handed back the SAME errored record -- the sync handler turns that into
      // a 502 without ever contacting Google, and, because a 502 never stamps calendarCheckedAt,
      // the poll's one automatic first check stayed blocked for the whole freshness window.
      const shortlyAfterFailure = () => staleNow() + 1_000
      const result = await syncCalendarAccountForPoll(failed, session, shortlyAfterFailure)

      expect(googleCalendar.refreshAccessToken).toHaveBeenCalledTimes(2)
      expect(googleCalendar.fetchFreeBusy).toHaveBeenCalled()
      expect(result.status).toBe('connected')
    })

    it('should retry an errored record even when its stamped lastSyncedAt is still fresh and the range is covered', async () => {
      // Same record as the "serve the cache when fresh" case above in every respect but status.
      // Status is what decides: a fresh SUCCESS is served from cache, a fresh ERROR is retried.
      const erroredButFresh = { ...calendarAccountRecord, status: 'error' as const }
      const rawInterval = { start: '2025-09-04T21:00:00.000Z', end: '2025-09-04T22:00:00.000Z' }
      jest.mocked(googleCalendar).fetchFreeBusy.mockResolvedValueOnce([rawInterval])

      const result = await syncCalendarAccountForPoll(erroredButFresh, session, freshNow)

      expect(googleCalendar.fetchFreeBusy).toHaveBeenCalled()
      expect(result.status).toBe('connected')
      expect(result.busyIntervals).toEqual([rawInterval])
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

    // A throttled write is not a reason to blank a grid that is perfectly valid: the intervals came
    // back from Google in this very call, so they are served. What must NOT happen is the served
    // copy claiming to have been recorded -- lastSyncedAt and expiration describe what is in the
    // table, and nothing reached the table, so they stay where the stored record left them and the
    // next check treats this copy as stale instead of trusting a write that never landed.
    it('should serve the fresh grid but leave the stored stamps alone when the success-path write fails', async () => {
      const outOfRangeRecord = { ...calendarAccountRecord, syncedRange: { start: '2020-01-01', end: '2020-01-31' } }
      const rawInterval = { start: '2025-09-04T21:00:00.000Z', end: '2025-09-04T22:00:00.000Z' }
      jest.mocked(googleCalendar).fetchFreeBusy.mockResolvedValueOnce([rawInterval])
      jest.mocked(dynamodb).putCalendarAccount.mockRejectedValueOnce(new Error('ProvisionedThroughputExceeded'))

      const result = await syncCalendarAccountForPoll(outOfRangeRecord, session, freshNow)

      expect(result.status).toBe('connected')
      expect(result.busyIntervals).toEqual([rawInterval])
      expect(result.lastSyncedAt).toBe(outOfRangeRecord.lastSyncedAt)
      expect(result.expiration).toBe(outOfRangeRecord.expiration)
      expect(logError).toHaveBeenCalledWith(
        'Failed to persist calendar account sync result',
        'ProvisionedThroughputExceeded',
      )
    })

    it('should still return the error-flagged record when persisting the failure-path fallback fails', async () => {
      const staleNow = () => calendarAccountRecord.lastSyncedAt * 1000 + 3_600_000
      jest.mocked(googleCalendar).refreshAccessToken.mockRejectedValueOnce(new Error('invalid_grant'))
      jest.mocked(dynamodb).putCalendarAccount.mockRejectedValueOnce(new Error('ProvisionedThroughputExceeded'))

      const result = await syncCalendarAccountForPoll(calendarAccountRecord, session, staleNow)

      expect(result.status).toBe('error')
      expect(result.busyIntervals).toEqual(calendarAccountRecord.busyIntervals)
      expect(result.lastSyncedAt).toBe(calendarAccountRecord.lastSyncedAt)
      expect(logError).toHaveBeenCalledWith(
        'Failed to persist calendar account sync result',
        'ProvisionedThroughputExceeded',
      )
    })

    // The record is the read path now, so it has to stay small enough to write. syncedRange only
    // ever unioned outward, nothing pruned busyIntervals, and the item lives 90 days -- growth had
    // no ceiling at all. The ceiling is a window anchored to today:
    // [today - sessionExpireHours, today + maxPollDateRangeDays]. `freshNow` is 2024-10-10T07:56Z,
    // so with SESSION_EXPIRE_HOURS=336 and maxPollDateRangeDays=365 that window is
    // [2024-09-26, 2025-10-10].
    describe('retention window', () => {
      const staleRecord = { ...calendarAccountRecord, lastSyncedAt: 0 }

      // The boundary is NOT derived from the poll TTL, and this is the test that proves it. Poll
      // dates may legally run to +365d while the TTL is 336h; a TTL-derived forward arm would prune
      // the intervals this very call just fetched, rangeCoversDates could never hold afterwards, and
      // every poll open would hit Google with nothing to show for it.
      it('should keep the intervals just fetched for a poll whose dates run a year out', async () => {
        const farOutPoll = { ...session, dates: ['2025-10-08', '2025-10-09', '2025-10-10'] }
        const farOutInterval = { start: '2025-10-09T15:00:00.000Z', end: '2025-10-09T16:00:00.000Z' }
        jest.mocked(googleCalendar).fetchFreeBusy.mockResolvedValueOnce([farOutInterval])

        const result = await syncCalendarAccountForPoll({ ...staleRecord, syncedRange: null }, farOutPoll, freshNow)

        expect(googleCalendar.fetchFreeBusy).toHaveBeenCalledWith(
          'access-token',
          '2025-10-07T10:00:00.000Z',
          '2025-10-11T12:00:00.000Z',
        )
        expect(result.busyIntervals).toEqual([farOutInterval])
        expect(result.syncedRange).toEqual({ start: '2025-10-08', end: '2025-10-10' })
        expect(dynamodb.putCalendarAccount).toHaveBeenCalledWith(
          expect.objectContaining({ busyIntervals: [farOutInterval] }),
        )
      })

      it('should clamp a synced range that reaches further back than the retention window', async () => {
        const ancientRange = { ...staleRecord, syncedRange: { start: '2023-01-01', end: '2025-09-06' } }

        const result = await syncCalendarAccountForPoll(ancientRange, session, freshNow)

        expect(result.syncedRange).toEqual({ start: '2024-09-26', end: '2025-09-06' })
        expect(googleCalendar.fetchFreeBusy).toHaveBeenCalledWith(
          'access-token',
          '2024-09-25T10:00:00.000Z', // 2024-09-26T00:00:00Z minus 14h -- the clamped start, not 2023-01-01
          '2025-09-07T12:00:00.000Z',
        )
      })

      it('should prune intervals outside the retention window before writing', async () => {
        const outside = { start: '2023-05-01T15:00:00.000Z', end: '2023-05-01T16:00:00.000Z' }
        const inside = { start: '2025-09-04T21:00:00.000Z', end: '2025-09-04T22:00:00.000Z' }
        jest.mocked(googleCalendar).fetchFreeBusy.mockResolvedValueOnce([outside, inside])

        const result = await syncCalendarAccountForPoll(staleRecord, session, freshNow)

        expect(result.busyIntervals).toEqual([inside])
        expect(dynamodb.putCalendarAccount).toHaveBeenCalledWith(expect.objectContaining({ busyIntervals: [inside] }))
      })

      // The backward arm exists because a live poll may legitimately hold dates already past. A poll
      // entirely behind it can never be cached, so asking Google for a window we would prune to
      // nothing on write is a round trip that can only come back useless.
      it('should not call Google for a poll whose dates all precede the retention window', async () => {
        const pastPoll = { ...session, dates: ['2024-09-01', '2024-09-02'] }

        const result = await syncCalendarAccountForPoll(staleRecord, pastPoll, freshNow)

        expect(googleCalendar.fetchFreeBusy).not.toHaveBeenCalled()
        expect(dynamodb.putCalendarAccount).not.toHaveBeenCalled()
        expect(result).toEqual(staleRecord)
      })

      it('should fetch only the poll dates that fall inside the retention window', async () => {
        const mixedPoll = { ...session, dates: ['2024-09-01', '2024-10-11'] }

        await syncCalendarAccountForPoll({ ...staleRecord, syncedRange: null }, mixedPoll, freshNow)

        expect(googleCalendar.fetchFreeBusy).toHaveBeenCalledWith(
          'access-token',
          '2024-10-10T10:00:00.000Z', // anchored to 2024-10-11, not to the out-of-window 2024-09-01
          '2024-10-12T12:00:00.000Z',
        )
      })

      // Dropping the oldest intervals to fit would hand back a grid that looks complete and is not.
      // Refusing the write serves the last cache that WAS complete and says so out loud.
      it('should fail loudly rather than store a silently truncated interval set', async () => {
        const oneTooMany = Array.from({ length: maxCachedBusyIntervals + 1 }, () => ({
          start: '2025-09-04T21:00:00.000Z',
          end: '2025-09-04T22:00:00.000Z',
        }))
        jest.mocked(googleCalendar).fetchFreeBusy.mockResolvedValueOnce(oneTooMany)

        const result = await syncCalendarAccountForPoll(staleRecord, session, freshNow)

        expect(result.status).toBe('error')
        expect(result.busyIntervals).toEqual(calendarAccountRecord.busyIntervals)
        expect(dynamodb.putCalendarAccount).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'connected' }))
        expect(logError).toHaveBeenCalledWith(
          'Calendar sync failed, serving cached busy data',
          expect.stringContaining('exceed the cached interval cap'),
        )
      })
    })

    // The OAuth callback's comment claimed the 90-day clock was "refreshed on every successful
    // sync" and the published privacy policy says the same. Neither was true: the record was
    // spread without ever touching expiration, so the clock ran from the moment of connecting.
    describe('retention clock', () => {
      it('should extend expiration from the moment of a successful check', async () => {
        const staleRecord = { ...calendarAccountRecord, lastSyncedAt: 0 }

        const result = await syncCalendarAccountForPoll(staleRecord, session, freshNow)

        const expected = Math.floor(freshNow() / 1000) + CALENDAR_ACCOUNT_TTL_SECONDS
        expect(result.expiration).toBe(expected)
        expect(dynamodb.putCalendarAccount).toHaveBeenCalledWith(expect.objectContaining({ expiration: expected }))
      })

      it('should leave expiration alone when the check fails', async () => {
        const staleRecord = { ...calendarAccountRecord, lastSyncedAt: 0 }
        jest.mocked(googleCalendar).refreshAccessToken.mockRejectedValueOnce(new Error('invalid_grant'))

        const result = await syncCalendarAccountForPoll(staleRecord, session, freshNow)

        expect(result.status).toBe('error')
        expect(result.expiration).toBe(calendarAccountRecord.expiration)
      })
    })
  })
})
