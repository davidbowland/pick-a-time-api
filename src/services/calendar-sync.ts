import {
  CALENDAR_ACCOUNT_TTL_SECONDS,
  calendarSyncFreshnessMs,
  maxCachedBusyIntervals,
  maxPollDateRangeDays,
  sessionExpireHours,
} from '../config'
import { CalendarAccountRecord, PollRecord } from '../types'
import { log, logError, sanitizeErrorForLogging } from '../utils/logging'
import { putCalendarAccount } from './dynamodb'
import { fetchFreeBusy, refreshAccessToken } from './google-calendar'
import { decryptRefreshToken } from './kms'
import { nextIsoDate } from './timezone'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

interface DateRange {
  start: string
  end: string
}

const isoDateOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

// The dates a cached record is allowed to hold: [today - sessionExpireHours, today +
// maxPollDateRangeDays]. Anchored to today, never to whichever poll triggered the check, because
// the record is shared across every poll a person is in -- a per-poll bound would let one poll
// evict another's underlay and turn every poll open into a Google call.
//
// Both arms are load-bearing, and neither is derived from the poll TTL. Forward: poll dates run to
// +maxPollDateRangeDays (365), so a TTL-derived arm (336h, 14 days) would prune the intervals a
// check just fetched for any poll further out than a fortnight, rangeCoversDates could never hold
// afterwards, and every open would hit Google with nothing to show for it. Backward: a live poll
// may legitimately hold dates already past, and the poll item itself lives sessionExpireHours, so
// that is exactly how far back an underlay can still be asked for.
//
// Everything outside is dropped on write. Without a bound, syncedRange only ever unioned outward,
// nothing pruned busyIntervals, and the item lived 90 days -- unbounded growth in a record that is
// now a read path, where a 400KB overflow means a stale underlay served as if it were current.
const retentionWindow = (now: () => number): DateRange => {
  const nowMs = now()
  return {
    end: isoDateOf(nowMs + maxPollDateRangeDays * DAY_MS),
    start: isoDateOf(nowMs - sessionExpireHours * HOUR_MS),
  }
}

// The UTC instants a date range actually covers: padded 14h before the start date and 12h after the
// day following the end date -- wide enough to cover every real-world UTC offset (UTC-12 to UTC+14).
// busyIntervals is cached per googleSub and shared across every poll the person is in, each
// potentially in a different timezone; anchoring this window to whichever poll happened to trigger
// the sync would leave a differently-timezoned reader's local day only partially covered by what was
// actually fetched. The raw intervals are stored as-is; each reader converts them to its own local
// date/minute blocks at read time in buildBusyGrid, using its own poll.timezone.
//
// Used for both the Google query and the retention prune, from the one definition, so an interval
// that was in range to fetch cannot be out of range to keep.
const paddedWindowMs = (range: DateRange): { min: number; max: number } => ({
  max: new Date(`${nextIsoDate(range.end)}T00:00:00.000Z`).getTime() + 12 * HOUR_MS,
  min: new Date(`${range.start}T00:00:00.000Z`).getTime() - 14 * HOUR_MS,
})

const rangeCoversDates = (range: DateRange | null, dates: string[]): boolean =>
  !!range && dates.every((date) => date >= range.start && date <= range.end)

const rangesOverlapOrAdjacent = (a: DateRange, b: DateRange): boolean => a.start <= b.end && b.start <= a.end

const clampRange = (range: DateRange, bounds: DateRange): DateRange => ({
  end: range.end < bounds.end ? range.end : bounds.end,
  start: range.start > bounds.start ? range.start : bounds.start,
})

const pruneIntervals = (intervals: { start: string; end: string }[], bounds: DateRange): typeof intervals => {
  const { max, min } = paddedWindowMs(bounds)
  return intervals.filter(
    (interval) => new Date(interval.end).getTime() > min && new Date(interval.start).getTime() < max,
  )
}

// Surfaced, not swallowed: the caller is told whether the write landed. It is deliberately not
// thrown, because a DynamoDB throttle must not blank a grid that is perfectly valid -- the data was
// fetched successfully and is worth serving. What it costs is the record's claim to have been
// recorded; see servedWithoutWrite.
const persistCalendarAccount = async (record: CalendarAccountRecord): Promise<boolean> => {
  try {
    await putCalendarAccount(record)
    return true
  } catch (error) {
    logError('Failed to persist calendar account sync result', sanitizeErrorForLogging(error))
    return false
  }
}

// What to hand back when the write failed. The freshly fetched data is served, but lastSyncedAt and
// expiration describe what is IN the table, and nothing reached the table -- so they stay at the
// stored record's values. The served copy is therefore marked stale rather than blanked: the next
// check sees an old lastSyncedAt, fails the freshness test, and actually retries, instead of
// trusting a write that never landed.
const servedWithoutWrite = (
  stored: CalendarAccountRecord,
  attempted: CalendarAccountRecord,
): CalendarAccountRecord => ({
  ...attempted,
  expiration: stored.expiration,
  lastSyncedAt: stored.lastSyncedAt,
})

export const syncCalendarAccountForPoll = async (
  record: CalendarAccountRecord,
  poll: PollRecord,
  now: () => number = Date.now,
  force = false,
): Promise<CalendarAccountRecord> => {
  const bounds = retentionWindow(now)
  // Only dates inside the retention window can ever be cached, so they are the only ones the
  // coverage check below may demand. Demanding the rest would guarantee a permanent cache miss:
  // a date outside the window is pruned on every write, so no amount of fetching would ever make
  // rangeCoversDates true for it, and the freshness window -- now the only rate limit -- would be
  // bypassed on every single open.
  const dates = poll.dates.filter((date) => date >= bounds.start && date <= bounds.end)
  if (dates.length === 0) {
    // A poll entirely outside the window gets no underlay and, deliberately, no Google call:
    // everything fetched for it would be pruned before the write, so the round trip could only
    // ever come back useless. The poll itself is within days of expiring.
    log('Poll dates fall outside the calendar retention window', {
      retentionEnd: bounds.end,
      retentionStart: bounds.start,
    })
    return record
  }

  const isFresh = now() - record.lastSyncedAt * 1000 < calendarSyncFreshnessMs
  // A person pressing "Check again" is asking for a real check, not a cached one.
  //
  // 'error' records are never fresh, whatever lastSyncedAt says. The failure path below stamps
  // lastSyncedAt too, so without this clause a single transient Google failure made the record look
  // freshly synced and every check for the next freshness window short-circuited to that same
  // errored record -- a 502 from the sync handler with no Google round-trip behind it. Worse, a 502
  // never stamps calendarCheckedAt, so the poll's one automatic first check stayed blocked the whole
  // time. A retry has to actually retry.
  //
  // This pair -- the freshness window and the range coverage check -- is now the ONLY thing rate
  // limiting Google calls: the one-check-per-poll lock is gone, and every poll open reads this path.
  if (!force && isFresh && record.status !== 'error' && rangeCoversDates(record.syncedRange, dates)) {
    return record
  }

  const requiredRange = { end: dates[dates.length - 1], start: dates[0] }
  const unionedRange =
    record.syncedRange && rangesOverlapOrAdjacent(record.syncedRange, requiredRange)
      ? {
          end: record.syncedRange.end > requiredRange.end ? record.syncedRange.end : requiredRange.end,
          start: record.syncedRange.start < requiredRange.start ? record.syncedRange.start : requiredRange.start,
        }
      : requiredRange
  // The union is what used to grow without limit. Clamping it here is what makes the growth stop,
  // and it also narrows the Google query: nothing outside the retention window is worth fetching,
  // since it would be pruned before the write. requiredRange is inside the bounds by construction,
  // so the clamped range can never come out empty.
  const nextRange = clampRange(unionedRange, bounds)

  try {
    const refreshToken = await decryptRefreshToken(record.refreshTokenEncrypted)
    const accessToken = await refreshAccessToken(refreshToken)
    const { max, min } = paddedWindowMs(nextRange)
    const timeMin = new Date(min).toISOString()
    const timeMax = new Date(max).toISOString()
    const busyIntervals = await fetchFreeBusy(accessToken, timeMin, timeMax)
    // The success path used to say nothing, which made a calendar that marks nothing impossible to
    // tell apart from a calendar Google reports as empty -- and freeBusy reports plenty of real
    // bookings as empty: all-day events are Free by default and never appear here at all, and only
    // the 'primary' calendar is asked. Count and window only; the intervals themselves are somebody's
    // schedule and have no business in a log.
    log('Fetched free/busy from Google', { busyIntervalCount: busyIntervals.length, timeMax, timeMin })

    const retained = pruneIntervals(busyIntervals, bounds)
    // The hard cap is a backstop under the window, and it refuses rather than trims. Dropping the
    // oldest intervals to fit would produce a grid that looks complete and is not -- the reader
    // cannot tell a pruned hour from a free one, so a silently incomplete underlay is worse than an
    // overflow. Throwing lands in the catch below, which serves the last cache that WAS complete and
    // stamps 'error'; the sync handler turns that into a 502. Loudly wrong beats quietly incomplete.
    if (retained.length > maxCachedBusyIntervals) {
      throw new Error(`Calendar busy intervals exceed the cached interval cap: ${retained.length}`)
    }

    const checkedAt = Math.floor(now() / 1000)
    const updated: CalendarAccountRecord = {
      ...record,
      busyIntervals: retained,
      // The retention clock restarts from this check, which is what the privacy policy has always
      // said happens and what the OAuth callback's comment claimed. Before this the record was
      // spread without touching expiration, so the 90 days ran from the moment of connecting and
      // a calendar in daily use disconnected itself on the anniversary of its consent.
      expiration: checkedAt + CALENDAR_ACCOUNT_TTL_SECONDS,
      lastSyncedAt: checkedAt,
      status: 'connected',
      syncedRange: nextRange,
    }
    const persisted = await persistCalendarAccount(updated)
    return persisted ? updated : servedWithoutWrite(record, updated)
  } catch (error) {
    logError('Calendar sync failed, serving cached busy data', sanitizeErrorForLogging(error))
    // lastSyncedAt moves even on failure: it dates the last check ATTEMPT, which is what
    // GET /calendar reports next to status: 'error' so a client can say when the connection was
    // last found broken. It no longer suppresses the next retry -- the 'error' clause in the
    // freshness short-circuit above deliberately overrides it, because a cached 502 is worse than
    // a repeated Google call.
    //
    // expiration is NOT extended here. The clock tracks successful checks, so a connection that has
    // been broken since the day it broke still ages out on schedule rather than being kept alive by
    // its own failures.
    const updated: CalendarAccountRecord = { ...record, lastSyncedAt: Math.floor(now() / 1000), status: 'error' }
    const persisted = await persistCalendarAccount(updated)
    return persisted ? updated : servedWithoutWrite(record, updated)
  }
}
