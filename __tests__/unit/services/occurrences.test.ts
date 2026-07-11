import { buildOccurrences, emptyGrid } from '@services/occurrences'

describe('occurrences', () => {
  describe('buildOccurrences', () => {
    it('should build consecutive-weekday occurrences (Thu/Fri/Sat x 2 weeks)', () => {
      const result = buildOccurrences({ weekdays: [4, 5, 6], startDate: '2025-09-04', weekCount: 2 })
      expect(result).toEqual([
        { weekIndex: 0, dayIndex: 0, date: '2025-09-04' },
        { weekIndex: 0, dayIndex: 1, date: '2025-09-05' },
        { weekIndex: 0, dayIndex: 2, date: '2025-09-06' },
        { weekIndex: 1, dayIndex: 0, date: '2025-09-11' },
        { weekIndex: 1, dayIndex: 1, date: '2025-09-12' },
        { weekIndex: 1, dayIndex: 2, date: '2025-09-13' },
      ])
    })

    it('should build non-consecutive-weekday occurrences (Mon/Wed/Fri) correctly', () => {
      const result = buildOccurrences({ weekdays: [1, 3, 5], startDate: '2025-09-01', weekCount: 1 })
      expect(result).toEqual([
        { weekIndex: 0, dayIndex: 0, date: '2025-09-01' },
        { weekIndex: 0, dayIndex: 1, date: '2025-09-03' },
        { weekIndex: 0, dayIndex: 2, date: '2025-09-05' },
      ])
    })

    it('should handle a single weekday spanning several weeks', () => {
      const result = buildOccurrences({ weekdays: [0], startDate: '2025-09-07', weekCount: 3 })
      expect(result.map((o) => o.date)).toEqual(['2025-09-07', '2025-09-14', '2025-09-21'])
    })
  })

  describe('emptyGrid', () => {
    it('should build a grid of the given dimensions, all false', () => {
      const grid = emptyGrid(3, 2)
      expect(grid).toEqual([
        [false, false],
        [false, false],
        [false, false],
      ])
    })

    it('should return independent row arrays (mutating one row must not affect another)', () => {
      const grid = emptyGrid(2, 2)
      grid[0][0] = true
      expect(grid[1][0]).toBe(false)
    })
  })
})
