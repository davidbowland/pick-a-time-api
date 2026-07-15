import { calendarSyncFreshnessMs } from '../config'
import { CalendarAccountRecord, PollRecord } from '../types'
import { logError, sanitizeErrorForLogging } from '../utils/logging'
import { putCalendarAccount } from './dynamodb'
import { fetchFreeBusy, refreshAccessToken } from './google-calendar'
import { decryptRefreshToken } from './kms'
import { nextIsoDate } from './timezone'

const HOUR_MS = 60 * 60 * 1000

const rangeCoversDates = (range: { start: string; end: string } | null, dates: string[]): boolean =>
  !!range && dates.every((date) => date >= range.start && date <= range.end)

const rangesOverlapOrAdjacent = (a: { start: string; end: string }, b: { start: string; end: string }): boolean =>
  a.start <= b.end && b.start <= a.end

const persistCalendarAccount = async (record: CalendarAccountRecord): Promise<void> => {
  try {
    await putCalendarAccount(record)
  } catch (error) {
    logError('Failed to persist calendar account sync result', error)
  }
}

export const syncCalendarAccountForPoll = async (
  record: CalendarAccountRecord,
  poll: PollRecord,
  now: () => number = Date.now,
): Promise<CalendarAccountRecord> => {
  const dates = poll.dates
  const isFresh = now() - record.lastSyncedAt * 1000 < calendarSyncFreshnessMs
  if (isFresh && rangeCoversDates(record.syncedRange, dates)) {
    return record
  }

  const requiredRange = { end: dates[dates.length - 1], start: dates[0] }
  const nextRange =
    record.syncedRange && rangesOverlapOrAdjacent(record.syncedRange, requiredRange)
      ? {
        end: record.syncedRange.end > requiredRange.end ? record.syncedRange.end : requiredRange.end,
        start: record.syncedRange.start < requiredRange.start ? record.syncedRange.start : requiredRange.start,
      }
      : requiredRange

  try {
    const refreshToken = await decryptRefreshToken(record.refreshTokenEncrypted)
    const accessToken = await refreshAccessToken(refreshToken)
    // Query a UTC window padded 14h before the start date and 12h after the day following the end
    // date -- wide enough to cover every real-world UTC offset (UTC-12 to UTC+14). busyIntervals is
    // cached per googleSub and shared across every poll the person is in, each potentially in a
    // different timezone; anchoring this window to whichever poll happened to trigger the sync
    // would leave a differently-timezoned reader's local day only partially covered by what was
    // actually fetched. The raw intervals are stored as-is; each reader converts them to its own
    // local date/minute blocks at read time in buildBusyGrid, using its own poll.timezone.
    const timeMin = new Date(new Date(`${nextRange.start}T00:00:00.000Z`).getTime() - 14 * HOUR_MS).toISOString()
    const timeMax = new Date(
      new Date(`${nextIsoDate(nextRange.end)}T00:00:00.000Z`).getTime() + 12 * HOUR_MS,
    ).toISOString()
    const busyIntervals = await fetchFreeBusy(accessToken, timeMin, timeMax)

    const updated: CalendarAccountRecord = {
      ...record,
      busyIntervals,
      lastSyncedAt: Math.floor(now() / 1000),
      status: 'connected',
      syncedRange: nextRange,
    }
    await persistCalendarAccount(updated)
    return updated
  } catch (error) {
    logError('Calendar sync failed, serving cached busy data', sanitizeErrorForLogging(error))
    // Update lastSyncedAt even on failure so an account that has synced successfully at least
    // once before doesn't get retried (KMS decrypt + a guaranteed-failing Google round-trip) on
    // every single overlap/users read until the normal freshness window elapses. An account that
    // has NEVER synced successfully (syncedRange: null) will still retry on every read, since
    // rangeCoversDates(null, ...) is always false regardless of lastSyncedAt -- that narrower,
    // "freshly broken" case is left alone; this only closes the "was working, now permanently
    // retrying forever" case.
    const updated: CalendarAccountRecord = { ...record, lastSyncedAt: Math.floor(now() / 1000), status: 'error' }
    await persistCalendarAccount(updated)
    return updated
  }
}
