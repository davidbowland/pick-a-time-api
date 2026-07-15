import { nextIsoDate, utcToZonedDateAndMinute, zonedTimeToUtc } from '@services/timezone'

describe('timezone', () => {
  describe('nextIsoDate', () => {
    it('should return the next calendar date', () => {
      expect(nextIsoDate('2025-09-04')).toBe('2025-09-05')
    })

    it('should roll over the month', () => {
      expect(nextIsoDate('2025-09-30')).toBe('2025-10-01')
    })
  })

  describe('zonedTimeToUtc', () => {
    it('should convert a local wall-clock time to the correct UTC instant (no DST)', () => {
      // America/Chicago is UTC-5 (CDT) in September
      const result = zonedTimeToUtc('2025-09-04', 16, 0, 'America/Chicago')
      expect(result.toISOString()).toBe('2025-09-04T21:00:00.000Z')
    })

    it('should account for a DST transition (CDT before, CST after)', () => {
      // 2025-11-02 is when America/Chicago falls back from CDT (UTC-5) to CST (UTC-6)
      const before = zonedTimeToUtc('2025-11-01', 16, 0, 'America/Chicago') // still CDT, UTC-5
      const after = zonedTimeToUtc('2025-11-03', 16, 0, 'America/Chicago') // now CST, UTC-6
      expect(before.toISOString()).toBe('2025-11-01T21:00:00.000Z')
      expect(after.toISOString()).toBe('2025-11-03T22:00:00.000Z')
    })

    it('should resolve a local time inside the pre-fix buggy window correctly (2am on the fall-back date)', () => {
      // 2025-11-02 is when America/Chicago falls back from CDT to CST at 2am local.
      // 2:00am only occurs once that day (in CST, after the fallback) — the single-pass
      // algorithm this fixes would incorrectly resolve this to 1:00am CST (07:00Z) instead.
      const result = zonedTimeToUtc('2025-11-02', 2, 0, 'America/Chicago')
      expect(result.toISOString()).toBe('2025-11-02T08:00:00.000Z')
    })
  })

  describe('utcToZonedDateAndMinute', () => {
    it('should convert a UTC instant to local date and minute-of-day', () => {
      const result = utcToZonedDateAndMinute(new Date('2025-09-04T21:00:00.000Z'), 'America/Chicago')
      expect(result).toEqual({ date: '2025-09-04', minuteOfDay: 16 * 60 })
    })

    it('should account for a DST transition when converting back', () => {
      const result = utcToZonedDateAndMinute(new Date('2025-11-03T22:00:00.000Z'), 'America/Chicago')
      expect(result).toEqual({ date: '2025-11-03', minuteOfDay: 16 * 60 })
    })

    it('should roll over to the correct local date when the UTC instant crosses midnight locally', () => {
      // 2025-09-05T03:00:00Z is 2025-09-04T22:00 local (America/Chicago, UTC-5)
      const result = utcToZonedDateAndMinute(new Date('2025-09-05T03:00:00.000Z'), 'America/Chicago')
      expect(result).toEqual({ date: '2025-09-04', minuteOfDay: 22 * 60 })
    })
  })
})
