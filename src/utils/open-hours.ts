import { OpeningHoursPeriod, PlaceDetails } from '../types'

const MILLIS_PER_HOUR = 60 * 60 * 1000
const MILLIS_PER_MINUTE = 60 * 1000

/**
 * Convert a period time to a UTC millisecond timestamp.
 *
 * Period times from Google are in the place's local timezone. To compare
 * against Date.now() (which is UTC), we need to reverse the offset:
 *   UTC = local - offset
 * e.g. 9 PM local at UTC-5 (offset = -300) → 9 PM - (-300 min) → 9 PM + 5 h → 2 AM UTC next day
 */
export const periodTimeToUtcMs = (
  time: { day: number; hour: number; minute: number; date?: { year: number; month: number; day: number } },
  utcOffsetMinutes: number,
): number | null => {
  if (!time.date) return null
  const localMs = Date.UTC(time.date.year, time.date.month - 1, time.date.day, time.hour, time.minute)
  return localMs - utcOffsetMinutes * MILLIS_PER_MINUTE
}

/**
 * Find the currently active period — the one where open ≤ now < close.
 * Returns undefined if no period spans the current time.
 */
export const findActivePeriod = (
  periods: OpeningHoursPeriod[],
  utcOffsetMinutes: number,
  nowMs: number,
): OpeningHoursPeriod | undefined =>
  periods.find((period) => {
    const openUtcMs = periodTimeToUtcMs(period.open, utcOffsetMinutes)
    if (openUtcMs == null || nowMs < openUtcMs) return false

    if (!period.close) {
      // No close time → 24-hour or always-open; this period is active
      return true
    }

    const closeUtcMs = periodTimeToUtcMs(period.close, utcOffsetMinutes)
    if (closeUtcMs == null) return false

    return nowMs < closeUtcMs
  })

/**
 * Determine whether a place is currently open and won't close within the
 * next hour. Used to filter out restaurants that are about to close.
 *
 * Strategy:
 * 1. If Google says openNow=false (or missing), reject immediately.
 * 2. Find the active period (open ≤ now < close) for today.
 * 3. Verify that period's close time is ≥ now + 1 hour.
 *
 * Falls back to accepting the place when period data is missing but
 * openNow=true — Google sometimes omits structured periods for 24-hour
 * or irregular-hours businesses. This means the filter is best-effort:
 * it removes places it can prove are closing soon, but lets through
 * places where it can't determine the close time.
 */
export const isNotClosingSoon = (place: PlaceDetails, nowMs: number = Date.now()): boolean => {
  if (place.openNow !== true) return false

  const periods = place.openingHoursPeriods
  const utcOffset = place.utcOffsetMinutes

  // No structured data to check close time — trust openNow as best-effort
  if (!periods?.length || utcOffset == null) return true

  const active = findActivePeriod(periods, utcOffset, nowMs)
  if (!active) {
    // openNow=true but no matching period — data inconsistency, trust Google
    return true
  }

  if (!active.close) {
    // No close time on the active period → 24-hour or always-open
    return true
  }

  const closeUtcMs = periodTimeToUtcMs(active.close, utcOffset)
  if (closeUtcMs == null) return true

  return closeUtcMs >= nowMs + MILLIS_PER_HOUR
}

/**
 * Filter out places that are closed or closing within the next hour.
 * Best-effort: places without structured hours data are kept if Google
 * reports them as currently open.
 */
export const filterClosingSoon = (places: PlaceDetails[], nowMs?: number): PlaceDetails[] =>
  places.filter((place) => isNotClosingSoon(place, nowMs))
