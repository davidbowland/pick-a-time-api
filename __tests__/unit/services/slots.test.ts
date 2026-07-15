import { buildSlots, emptyGrid } from '@services/slots'
import { PollRecord } from '@types'

describe('slots', () => {
  describe('buildSlots', () => {
    it('should return a single all-day slot when the poll does not use times', () => {
      const poll = { usesTimes: false, dates: ['2025-09-04'], timezone: 'America/Chicago' } as PollRecord
      expect(buildSlots(poll)).toEqual([{ slotIndex: 0, startMinute: 0, endMinute: 1440 }])
    })

    it('should generate overlapping slots stepped by 30 minutes for a 60-minute duration', () => {
      const poll = {
        usesTimes: true,
        dates: ['2025-09-04'],
        timezone: 'America/Chicago',
        startMinute: 960,
        endMinute: 1080,
        slotMinutes: 60,
      } as PollRecord
      expect(buildSlots(poll)).toEqual([
        { slotIndex: 0, startMinute: 960, endMinute: 1020 },
        { slotIndex: 1, startMinute: 990, endMinute: 1050 },
        { slotIndex: 2, startMinute: 1020, endMinute: 1080 },
      ])
    })

    it('should step by 15 minutes only when slotMinutes is 15', () => {
      const poll = {
        usesTimes: true,
        dates: ['2025-09-04'],
        timezone: 'America/Chicago',
        startMinute: 960,
        endMinute: 1005,
        slotMinutes: 15,
      } as PollRecord
      expect(buildSlots(poll)).toEqual([
        { slotIndex: 0, startMinute: 960, endMinute: 975 },
        { slotIndex: 1, startMinute: 975, endMinute: 990 },
        { slotIndex: 2, startMinute: 990, endMinute: 1005 },
      ])
    })

    it('should tile the range exactly with no leftover for a 90-minute duration', () => {
      const poll = {
        usesTimes: true,
        dates: ['2025-09-04'],
        timezone: 'America/Chicago',
        startMinute: 540, // 9:00
        endMinute: 1020, // 17:00
        slotMinutes: 90,
      } as PollRecord
      const slots = buildSlots(poll)
      expect(slots[0]).toEqual({ slotIndex: 0, startMinute: 540, endMinute: 630 })
      expect(slots[slots.length - 1].endMinute).toBe(1020) // last slot ends exactly at endMinute, no leftover
    })
  })

  describe('emptyGrid', () => {
    it('should build a grid of the given dimensions, all false', () => {
      expect(emptyGrid(3, 2)).toEqual([
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
