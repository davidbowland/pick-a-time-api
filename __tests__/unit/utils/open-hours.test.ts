import { PlaceDetails } from '@types'
import { filterClosingSoon, findActivePeriod, isNotClosingSoon, periodTimeToUtcMs } from '@utils/open-hours'

// UTC-5 (US Central Standard Time) = -300 minutes
const CST_OFFSET = -300
// UTC+0
const UTC_OFFSET = 0
// UTC+5:30 (India Standard Time) = 330 minutes
const IST_OFFSET = 330

const makePeriod = (
  openHour: number,
  closeHour: number,
  date: { year: number; month: number; day: number },
  day: number,
) => ({
  open: { day, hour: openHour, minute: 0, date },
  close: { day, hour: closeHour, minute: 0, date },
})

const makePlace = (overrides: Partial<PlaceDetails> = {}): PlaceDetails => ({
  photos: [],
  placeId: 'test-place',
  ...overrides,
})

describe('open-hours', () => {
  describe('periodTimeToUtcMs', () => {
    it('should return null when date is missing', () => {
      expect(periodTimeToUtcMs({ day: 1, hour: 12, minute: 0 }, 0)).toBeNull()
    })

    it('should convert local time at UTC+0 to correct UTC ms', () => {
      // 2025-03-03 14:30 local at UTC+0 = 2025-03-03 14:30 UTC
      const result = periodTimeToUtcMs(
        { day: 1, hour: 14, minute: 30, date: { year: 2025, month: 3, day: 3 } },
        UTC_OFFSET,
      )
      expect(result).toBe(Date.UTC(2025, 2, 3, 14, 30))
    })

    it('should convert local time at UTC-5 (CST) to correct UTC ms', () => {
      // 9 PM local at UTC-5 → 9 PM - (-300 min) → 9 PM + 5h → 2 AM UTC next day
      const result = periodTimeToUtcMs(
        { day: 1, hour: 21, minute: 0, date: { year: 2025, month: 3, day: 3 } },
        CST_OFFSET,
      )
      expect(result).toBe(Date.UTC(2025, 2, 4, 2, 0))
    })

    it('should convert local time at UTC+5:30 (IST) to correct UTC ms', () => {
      // 9 PM local at UTC+5:30 → 9 PM - 330 min → 3:30 PM UTC same day
      const result = periodTimeToUtcMs(
        { day: 1, hour: 21, minute: 0, date: { year: 2025, month: 3, day: 3 } },
        IST_OFFSET,
      )
      expect(result).toBe(Date.UTC(2025, 2, 3, 15, 30))
    })

    it('should handle midnight correctly', () => {
      const result = periodTimeToUtcMs(
        { day: 1, hour: 0, minute: 0, date: { year: 2025, month: 1, day: 1 } },
        CST_OFFSET,
      )
      // Midnight CST = 5 AM UTC
      expect(result).toBe(Date.UTC(2025, 0, 1, 5, 0))
    })
  })

  describe('findActivePeriod', () => {
    const date = { year: 2025, month: 3, day: 3 }
    const periods = [
      makePeriod(11, 14, date, 1), // 11 AM - 2 PM (lunch)
      makePeriod(17, 22, date, 1), // 5 PM - 10 PM (dinner)
    ]

    it('should find the period that spans the current time', () => {
      // 12 PM UTC on March 3 = 12 PM local at UTC+0
      const nowMs = Date.UTC(2025, 2, 3, 12, 0)
      const result = findActivePeriod(periods, UTC_OFFSET, nowMs)
      expect(result).toEqual(periods[0])
    })

    it('should find the dinner period when time is in the evening', () => {
      const nowMs = Date.UTC(2025, 2, 3, 19, 0) // 7 PM UTC
      const result = findActivePeriod(periods, UTC_OFFSET, nowMs)
      expect(result).toEqual(periods[1])
    })

    it('should return undefined when between periods', () => {
      const nowMs = Date.UTC(2025, 2, 3, 15, 0) // 3 PM UTC — between lunch and dinner
      const result = findActivePeriod(periods, UTC_OFFSET, nowMs)
      expect(result).toBeUndefined()
    })

    it('should return undefined when before all periods', () => {
      const nowMs = Date.UTC(2025, 2, 3, 9, 0) // 9 AM UTC
      const result = findActivePeriod(periods, UTC_OFFSET, nowMs)
      expect(result).toBeUndefined()
    })

    it('should return undefined when after all periods', () => {
      const nowMs = Date.UTC(2025, 2, 3, 23, 0) // 11 PM UTC
      const result = findActivePeriod(periods, UTC_OFFSET, nowMs)
      expect(result).toBeUndefined()
    })

    it('should account for UTC offset when finding active period', () => {
      // Restaurant in CST (UTC-5) open 11 AM - 10 PM local
      // 4 PM UTC = 11 AM CST (just opened)
      const cstPeriods = [makePeriod(11, 22, date, 1)]
      const nowMs = Date.UTC(2025, 2, 3, 16, 0)
      const result = findActivePeriod(cstPeriods, CST_OFFSET, nowMs)
      expect(result).toEqual(cstPeriods[0])
    })

    it('should handle a period with no close time (24-hour)', () => {
      const alwaysOpen = [{ open: { day: 1, hour: 0, minute: 0, date } }]
      const nowMs = Date.UTC(2025, 2, 3, 15, 0)
      const result = findActivePeriod(alwaysOpen, UTC_OFFSET, nowMs)
      expect(result).toEqual(alwaysOpen[0])
    })

    it('should not match a period with no close when now is before open', () => {
      const alwaysOpen = [{ open: { day: 1, hour: 20, minute: 0, date } }]
      const nowMs = Date.UTC(2025, 2, 3, 15, 0) // before 8 PM
      const result = findActivePeriod(alwaysOpen, UTC_OFFSET, nowMs)
      expect(result).toBeUndefined()
    })
  })

  describe('isNotClosingSoon', () => {
    const date = { year: 2025, month: 3, day: 3 }

    it('should reject a place with openNow=false', () => {
      const place = makePlace({ openNow: false })
      expect(isNotClosingSoon(place)).toBe(false)
    })

    it('should reject a place with openNow=null', () => {
      const place = makePlace({ openNow: null })
      expect(isNotClosingSoon(place)).toBe(false)
    })

    it('should reject a place with openNow=undefined', () => {
      const place = makePlace({ openNow: undefined })
      expect(isNotClosingSoon(place)).toBe(false)
    })

    it('should accept a place with openNow=true and no periods (trust Google)', () => {
      const place = makePlace({ openNow: true })
      expect(isNotClosingSoon(place)).toBe(true)
    })

    it('should accept a place with openNow=true and empty periods array', () => {
      const place = makePlace({ openNow: true, openingHoursPeriods: [] })
      expect(isNotClosingSoon(place)).toBe(true)
    })

    it('should accept a place with openNow=true but no utcOffsetMinutes', () => {
      const place = makePlace({
        openNow: true,
        openingHoursPeriods: [makePeriod(11, 22, date, 1)],
        utcOffsetMinutes: undefined,
      })
      expect(isNotClosingSoon(place)).toBe(true)
    })

    it('should accept a place closing in more than 1 hour', () => {
      // Restaurant open 11 AM - 10 PM UTC, current time 6 PM UTC → 4 hours left
      const nowMs = Date.UTC(2025, 2, 3, 18, 0)
      const place = makePlace({
        openNow: true,
        openingHoursPeriods: [makePeriod(11, 22, date, 1)],
        utcOffsetMinutes: UTC_OFFSET,
      })
      expect(isNotClosingSoon(place, nowMs)).toBe(true)
    })

    it('should reject a place closing in less than 1 hour', () => {
      // Restaurant open 11 AM - 10 PM UTC, current time 9:30 PM UTC → 30 min left
      const nowMs = Date.UTC(2025, 2, 3, 21, 30)
      const place = makePlace({
        openNow: true,
        openingHoursPeriods: [makePeriod(11, 22, date, 1)],
        utcOffsetMinutes: UTC_OFFSET,
      })
      expect(isNotClosingSoon(place, nowMs)).toBe(false)
    })

    it('should reject a place closing in exactly 59 minutes', () => {
      // Close at 10 PM, now is 9:01 PM → 59 minutes left
      const nowMs = Date.UTC(2025, 2, 3, 21, 1)
      const place = makePlace({
        openNow: true,
        openingHoursPeriods: [makePeriod(11, 22, date, 1)],
        utcOffsetMinutes: UTC_OFFSET,
      })
      expect(isNotClosingSoon(place, nowMs)).toBe(false)
    })

    it('should accept a place closing in exactly 60 minutes', () => {
      // Close at 10 PM, now is 9 PM → exactly 60 minutes
      const nowMs = Date.UTC(2025, 2, 3, 21, 0)
      const place = makePlace({
        openNow: true,
        openingHoursPeriods: [makePeriod(11, 22, date, 1)],
        utcOffsetMinutes: UTC_OFFSET,
      })
      expect(isNotClosingSoon(place, nowMs)).toBe(true)
    })

    it('should use the active period, not a later one with a later close time', () => {
      // Monday closes at 9 PM, Friday closes at 11 PM
      // Current time: Monday 8:30 PM → only 30 min left on Monday's period
      const mondayDate = { year: 2025, month: 3, day: 3 }
      const fridayDate = { year: 2025, month: 3, day: 7 }
      const periods = [
        makePeriod(11, 21, mondayDate, 1), // Mon 11 AM - 9 PM
        makePeriod(11, 23, fridayDate, 5), // Fri 11 AM - 11 PM
      ]
      const nowMs = Date.UTC(2025, 2, 3, 20, 30) // 8:30 PM UTC Monday
      const place = makePlace({
        openNow: true,
        openingHoursPeriods: periods,
        utcOffsetMinutes: UTC_OFFSET,
      })
      expect(isNotClosingSoon(place, nowMs)).toBe(false)
    })

    it('should handle CST timezone correctly', () => {
      // Restaurant in CST (UTC-5) closes at 9 PM local = 2 AM UTC next day
      // Current time: 12:30 AM UTC = 7:30 PM CST → 1.5 hours until close → pass
      const nowMs = Date.UTC(2025, 2, 4, 0, 30)
      const place = makePlace({
        openNow: true,
        openingHoursPeriods: [makePeriod(11, 21, date, 1)],
        utcOffsetMinutes: CST_OFFSET,
      })
      expect(isNotClosingSoon(place, nowMs)).toBe(true)
    })

    it('should handle CST timezone — closing soon', () => {
      // Restaurant in CST (UTC-5) closes at 9 PM local = 2 AM UTC next day
      // Current time: 1:30 AM UTC = 8:30 PM CST → 30 min until close → reject
      const nowMs = Date.UTC(2025, 2, 4, 1, 30)
      const place = makePlace({
        openNow: true,
        openingHoursPeriods: [makePeriod(11, 21, date, 1)],
        utcOffsetMinutes: CST_OFFSET,
      })
      expect(isNotClosingSoon(place, nowMs)).toBe(false)
    })

    it('should accept a 24-hour place (no close time on active period)', () => {
      const nowMs = Date.UTC(2025, 2, 3, 3, 0)
      const place = makePlace({
        openNow: true,
        openingHoursPeriods: [{ open: { day: 1, hour: 0, minute: 0, date } }],
        utcOffsetMinutes: UTC_OFFSET,
      })
      expect(isNotClosingSoon(place, nowMs)).toBe(true)
    })

    it('should accept when openNow=true but no active period found (trust Google)', () => {
      // Periods don't cover the current time — data inconsistency
      const nowMs = Date.UTC(2025, 2, 3, 3, 0) // 3 AM
      const place = makePlace({
        openNow: true,
        openingHoursPeriods: [makePeriod(11, 22, date, 1)], // 11 AM - 10 PM
        utcOffsetMinutes: UTC_OFFSET,
      })
      expect(isNotClosingSoon(place, nowMs)).toBe(true)
    })

    it('should accept when close time date is missing (trust Google)', () => {
      const nowMs = Date.UTC(2025, 2, 3, 12, 0)
      const place = makePlace({
        openNow: true,
        openingHoursPeriods: [
          {
            open: { day: 1, hour: 11, minute: 0, date },
            close: { day: 1, hour: 22, minute: 0 }, // no date on close
          },
        ],
        utcOffsetMinutes: UTC_OFFSET,
      })
      expect(isNotClosingSoon(place, nowMs)).toBe(true)
    })
  })

  describe('filterClosingSoon', () => {
    const date = { year: 2025, month: 3, day: 3 }
    const nowMs = Date.UTC(2025, 2, 3, 20, 30) // 8:30 PM UTC

    const openLate = makePlace({
      openNow: true,
      placeId: 'open-late',
      openingHoursPeriods: [makePeriod(11, 23, date, 1)], // closes 11 PM → 2.5h left
      utcOffsetMinutes: UTC_OFFSET,
    })

    const closingSoon = makePlace({
      openNow: true,
      placeId: 'closing-soon',
      openingHoursPeriods: [makePeriod(11, 21, date, 1)], // closes 9 PM → 30 min left
      utcOffsetMinutes: UTC_OFFSET,
    })

    const alreadyClosed = makePlace({
      openNow: false,
      placeId: 'closed',
    })

    const noHoursData = makePlace({
      openNow: true,
      placeId: 'no-hours',
    })

    it('should keep places open for more than an hour', () => {
      const result = filterClosingSoon([openLate], nowMs)
      expect(result).toHaveLength(1)
      expect(result[0].placeId).toBe('open-late')
    })

    it('should remove places closing within an hour', () => {
      const result = filterClosingSoon([closingSoon], nowMs)
      expect(result).toHaveLength(0)
    })

    it('should remove closed places', () => {
      const result = filterClosingSoon([alreadyClosed], nowMs)
      expect(result).toHaveLength(0)
    })

    it('should keep places with no hours data (best-effort)', () => {
      const result = filterClosingSoon([noHoursData], nowMs)
      expect(result).toHaveLength(1)
      expect(result[0].placeId).toBe('no-hours')
    })

    it('should filter a mixed list correctly', () => {
      const result = filterClosingSoon([openLate, closingSoon, alreadyClosed, noHoursData], nowMs)
      expect(result).toHaveLength(2)
      expect(result.map((p) => p.placeId)).toEqual(['open-late', 'no-hours'])
    })

    it('should return empty array when all places are filtered out', () => {
      const result = filterClosingSoon([closingSoon, alreadyClosed], nowMs)
      expect(result).toHaveLength(0)
    })

    it('should return empty array for empty input', () => {
      const result = filterClosingSoon([], nowMs)
      expect(result).toHaveLength(0)
    })
  })
})
