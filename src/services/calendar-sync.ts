import { calendarSyncFreshnessMs } from '../config'
import { CalendarAccountRecord, PollRecord } from '../types'
import { log, logError, sanitizeErrorForLogging } from '../utils/logging'
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
  force = false,
): Promise<CalendarAccountRecord> => {
  const dates = poll.dates
  const isFresh = now() - record.lastSyncedAt * 1000 < calendarSyncFreshnessMs
  // A person pressing "Check again" is asking for a real check, not a cached one.
  //
  // 'error' records are never fresh, whatever lastSyncedAt says. The failure path below stamps
  // lastSyncedAt too, so without this clause a single transient Google failure made the record look
  // freshly synced and every check for the next freshness window short-circuited to that same
  // errored record -- a 502 from the sync handler with no Google round-trip behind it. Worse, a 502
  // never stamps calendarCheckedAt, so the poll's one automatic first check stayed blocked the whole
  // time. A retry has to actually retry.
  if (!force && isFresh && record.status !== 'error' && rangeCoversDates(record.syncedRange, dates)) {
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
    // The success path used to say nothing, which made a calendar that marks nothing impossible to
    // tell apart from a calendar Google reports as empty -- and freeBusy reports plenty of real
    // bookings as empty: all-day events are Free by default and never appear here at all, and only
    // the 'primary' calendar is asked. Count and window only; the intervals themselves are somebody's
    // schedule and have no business in a log.
    log('Fetched free/busy from Google', { busyIntervalCount: busyIntervals.length, timeMax, timeMin })

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
    // lastSyncedAt moves even on failure: it dates the last check ATTEMPT, which is what
    // GET /calendar reports next to status: 'error' so a client can say when the connection was
    // last found broken. It no longer suppresses the next retry -- the 'error' clause in the
    // freshness short-circuit above deliberately overrides it, because a cached 502 is worse than
    // a repeated Google call. The call volume that argued for suppression is gone anyway: this
    // function has exactly one caller, POST .../calendar/sync, which itself runs at most once per
    // poll per person unless they press "Check again".
    const updated: CalendarAccountRecord = { ...record, lastSyncedAt: Math.floor(now() / 1000), status: 'error' }
    await persistCalendarAccount(updated)
    return updated
  }
}
