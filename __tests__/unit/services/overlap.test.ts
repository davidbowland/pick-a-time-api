import { availabilityRecord, session } from '../__mocks__'
import { buildBusyGrid, computeGrid, findRecommendedMeetings } from '@services/overlap'
import { AvailabilityRecord, PollRecord } from '@types'

describe('overlap', () => {
  describe('buildBusyGrid', () => {
    it('should mark every overlapping slot busy for a busy interval (times mode)', () => {
      // session: dates ['2025-09-04','2025-09-05','2025-09-06'], slots [16:00-17:00),[16:30-17:30),[17:00-18:00)
      // Busy 21:00-22:00Z = 16:00-17:00 local on 2025-09-04 -- overlaps slot0 fully and slot1 partially
      // (slot1 starts at 16:30, inside the busy window), but not slot2 (starts at 17:00, busy ends there).
      const grid = buildBusyGrid(session, [{ start: '2025-09-04T21:00:00.000Z', end: '2025-09-04T22:00:00.000Z' }])
      expect(grid[0]).toEqual([true, true, false])
      expect(grid[1]).toEqual([false, false, false])
      expect(grid[2]).toEqual([false, false, false])
    })

    it('should return an all-false grid sized dates x slots when there are no busy intervals', () => {
      expect(buildBusyGrid(session, [])).toEqual([
        [false, false, false],
        [false, false, false],
        [false, false, false],
      ])
    })

    it('should mark an interior date fully busy for a multi-day busy interval spanning it (dates-only mode)', () => {
      const datesOnlyPoll: PollRecord = {
        sessionId: 'abc123',
        name: 'Trip planning',
        dates: ['2025-09-04', '2025-09-05', '2025-09-06'],
        usesTimes: false,
        timezone: 'America/Chicago',
        expiration: session.expiration,
      }
      // Local 2025-09-04T16:00 through 2025-09-07T18:00 -- 09-05 and 09-06 are fully interior days.
      const grid = buildBusyGrid(datesOnlyPoll, [
        { start: '2025-09-04T21:00:00.000Z', end: '2025-09-07T23:00:00.000Z' },
      ])
      expect(grid[0]).toEqual([false]) // 09-04: only busy 16:00-24:00, doesn't span the whole day
      expect(grid[1]).toEqual([true]) // 09-05: fully interior
      expect(grid[2]).toEqual([true]) // 09-06: fully interior
    })

    it('should not mark a date busy for a partial-day interval in dates-only mode', () => {
      const datesOnlyPoll: PollRecord = {
        sessionId: 'abc123',
        name: 'Trip planning',
        dates: ['2025-09-05'],
        usesTimes: false,
        timezone: 'America/Chicago',
        expiration: session.expiration,
      }
      const grid = buildBusyGrid(datesOnlyPoll, [
        { start: '2025-09-05T21:00:00.000Z', end: '2025-09-05T22:00:00.000Z' }, // 16:00-17:00 local, partial day
      ])
      expect(grid[0]).toEqual([false])
    })

    it('should convert the same busyIntervals independently for two polls in different timezones sharing a calendar-connected user', () => {
      // Regression test for the shared-cache cross-timezone bug: the same raw busyIntervals, cached
      // once per googleSub, must be interpreted independently by each reading poll's own timezone.
      const busyIntervals = [{ start: '2025-09-04T21:00:00.000Z', end: '2025-09-04T22:00:00.000Z' }]
      const chicagoPoll = { ...session, timezone: 'America/Chicago' }
      const tokyoPoll = { ...session, timezone: 'Asia/Tokyo', startMinute: 0, endMinute: 1440, slotMinutes: 60 }

      const chicagoGrid = buildBusyGrid(chicagoPoll, busyIntervals)
      const tokyoGrid = buildBusyGrid(tokyoPoll, busyIntervals)

      expect(chicagoGrid[0][0]).toBe(true) // 2025-09-04, 16:00-17:00 local Chicago
      expect(chicagoGrid[1]).toEqual([false, false, false]) // Chicago's other date unaffected
      // Same instant is 06:00-07:00 local in Tokyo, the next calendar day (2025-09-05, dateIndex 1).
      // Tokyo's slots step every 30 min from 00:00 -- slotIndex 12 is exactly [06:00, 07:00).
      expect(tokyoGrid[1][12]).toBe(true)
    })

    it("should size an overridden date's slot row independently from the poll's default window", () => {
      const pollWithOverride: PollRecord = {
        ...session,
        overrides: [{ dates: ['2025-09-06'], startMinute: 960, endMinute: 1020 }], // Saturday: single 60-min slot
      }
      const grid = buildBusyGrid(pollWithOverride, [])
      expect(grid[0]).toHaveLength(3) // 2025-09-04, default window -> 3 overlapping slots
      expect(grid[1]).toHaveLength(3) // 2025-09-05, default window
      expect(grid[2]).toHaveLength(1) // 2025-09-06, override window -> exactly 1 slot
    })
  })

  describe('computeGrid', () => {
    const secondUser: AvailabilityRecord = {
      userId: 'second-user',
      free: [
        [false, false, false],
        [false, true, false],
        [true, true, true],
      ],
      expiration: availabilityRecord.expiration,
    }

    it('should tally freeCount and freeUserIds per cell', () => {
      const grid = computeGrid(session, [availabilityRecord, secondUser])
      // session slots: slotIndex0 [960,1020), slotIndex1 [990,1050), slotIndex2 [1020,1080)
      expect(grid.cells[1]).toEqual([
        {
          dateIndex: 1,
          slotIndex: 0,
          startMinute: 960,
          endMinute: 1020,
          freeCount: 1,
          freeUserIds: [availabilityRecord.userId],
        },
        {
          dateIndex: 1,
          slotIndex: 1,
          startMinute: 990,
          endMinute: 1050,
          freeCount: 2,
          freeUserIds: [availabilityRecord.userId, secondUser.userId],
        },
        { dateIndex: 1, slotIndex: 2, startMinute: 1020, endMinute: 1080, freeCount: 0, freeUserIds: [] },
      ])
    })

    it('should pick the best slot, breaking ties by earliest date then earliest slot', () => {
      const grid = computeGrid(session, [availabilityRecord, secondUser])
      // Max freeCount is 2, first reached at dateIndex 1 (slotIndex 1); dateIndex 2 also reaches 2
      // at every slot, but dateIndex 1 sorts earlier.
      expect(grid.bestSlot).toEqual({ dateIndex: 1, slotIndex: 1, freeCount: 2 })
    })

    it('should default bestSlot to (0,0) when every cell is tied', () => {
      const oneUser: AvailabilityRecord = {
        userId: 'only-user',
        free: [
          [true, true, true],
          [true, true, true],
          [true, true, true],
        ],
        expiration: availabilityRecord.expiration,
      }
      const grid = computeGrid(session, [oneUser])
      expect(grid.bestSlot).toEqual({ dateIndex: 0, slotIndex: 0, freeCount: 1 })
    })

    it('should break freeCount ties by earliest date regardless of slotIndex', () => {
      const custom: AvailabilityRecord = {
        userId: 'user-x',
        free: [
          [false, false, true], // date0: only slot2 free
          [false, true, false], // date1: only slot1 free
          [false, false, false],
        ],
        expiration: availabilityRecord.expiration,
      }
      const grid = computeGrid(session, [custom])
      // (date0,slot2) and (date1,slot1) tie at freeCount 1; date0 wins regardless of slotIndex.
      expect(grid.bestSlot).toEqual({ dateIndex: 0, slotIndex: 2, freeCount: 1 })
    })

    it('should reduce freeCount when a user is calendar-busy', () => {
      // 16:00-16:30 local on 2025-09-06 (date2) overlaps only slot0 ([16:00-17:00)), not slot1
      // ([16:30-17:30)) or slot2 ([17:00-18:00)).
      const busyGrids = {
        [availabilityRecord.userId]: buildBusyGrid(session, [
          { start: '2025-09-06T21:00:00.000Z', end: '2025-09-06T21:30:00.000Z' },
        ]),
      }
      const grid = computeGrid(session, [availabilityRecord], busyGrids)
      expect(grid.cells[2][0].freeCount).toBe(0) // was free per the raw grid, now calendar-busy
      expect(grid.cells[2][1].freeCount).toBe(1) // unaffected
    })

    it('should size each date row of cells independently when the poll has an override', () => {
      const pollWithOverride: PollRecord = {
        ...session,
        overrides: [{ dates: ['2025-09-06'], startMinute: 960, endMinute: 1020 }],
      }
      const grid = computeGrid(pollWithOverride, [availabilityRecord])
      expect(grid.cells[0]).toHaveLength(3)
      expect(grid.cells[2]).toHaveLength(1)
    })
  })

  describe('findRecommendedMeetings', () => {
    it('should pick all 3 mutually-diverse best times when they exist, in date order', () => {
      const diagonal: boolean[][] = [
        [true, false, false],
        [false, true, false],
        [false, false, true],
      ]
      const users: AvailabilityRecord[] = ['user-a', 'user-b', 'user-c'].map((userId) => ({
        userId,
        free: diagonal,
        expiration: availabilityRecord.expiration,
      }))

      const result = findRecommendedMeetings(session, users)

      // session slots: slotIndex0 [960,1020), slotIndex1 [990,1050), slotIndex2 [1020,1080)
      expect(result).toEqual([
        {
          dateIndex: 0,
          slotIndex: 0,
          date: '2025-09-04',
          startMinute: 960,
          endMinute: 1020,
          freeCount: 3,
          freeUserIds: ['user-a', 'user-b', 'user-c'],
          excludedByCalendar: [],
        },
        {
          dateIndex: 1,
          slotIndex: 1,
          date: '2025-09-05',
          startMinute: 990,
          endMinute: 1050,
          freeCount: 3,
          freeUserIds: ['user-a', 'user-b', 'user-c'],
          excludedByCalendar: [],
        },
        {
          dateIndex: 2,
          slotIndex: 2,
          date: '2025-09-06',
          startMinute: 1020,
          endMinute: 1080,
          freeCount: 3,
          freeUserIds: ['user-a', 'user-b', 'user-c'],
          excludedByCalendar: [],
        },
      ])
    })

    it('should never trade attendance for diversity: best times always win', () => {
      // 1 slot per date (30-min slot, 30-min window -- no overlap); freeCount 2 only ever occurs
      // at slotIndex 0 on both dates, slotIndex is irrelevant here since there's only one per date --
      // this instead demonstrates diversity failing to diversify when only one *date* alignment wins.
      const twoDatePoll: PollRecord = {
        ...session,
        dates: ['2025-09-04', '2025-09-05'],
        startMinute: 960,
        endMinute: 990,
        slotMinutes: 30,
      }
      const userA: AvailabilityRecord = {
        userId: 'user-a',
        free: [[true], [true]],
        expiration: availabilityRecord.expiration,
      }
      const userB: AvailabilityRecord = {
        userId: 'user-b',
        free: [[true], [true]],
        expiration: availabilityRecord.expiration,
      }

      const result = findRecommendedMeetings(twoDatePoll, [userA, userB], 2)

      expect(result).toHaveLength(2)
      expect(result.every((meeting) => meeting.freeCount === 2)).toBe(true)
    })

    it('should prefer a later diverse candidate over an earlier non-diverse one within the same tier', () => {
      const userA: AvailabilityRecord = {
        userId: 'user-a',
        free: [
          [true, false, false],
          [false, true, false],
          [false, false, false],
        ],
        expiration: availabilityRecord.expiration,
      }
      const userB: AvailabilityRecord = { ...userA, userId: 'user-b' }
      const userC: AvailabilityRecord = {
        userId: 'user-c',
        free: [
          [false, false, false],
          [true, false, false],
          [false, false, true],
        ],
        expiration: availabilityRecord.expiration,
      }

      const result = findRecommendedMeetings(session, [userA, userB, userC])

      // Tier0 (freeCount 2): (date0,slot0), (date1,slot1) -> both diverse, both picked.
      // Tier1 (freeCount 1): (date1,slot0) [not diverse: shares dateIndex1 with pick2]
      //                      (date2,slot2) [diverse from both] -> wins the 3rd slot even though
      //                      (date1,slot0)'s date sorts earlier within the tier.
      expect(result.map(({ dateIndex, slotIndex, freeCount }) => ({ dateIndex, slotIndex, freeCount }))).toEqual([
        { dateIndex: 0, slotIndex: 0, freeCount: 2 },
        { dateIndex: 1, slotIndex: 1, freeCount: 2 },
        { dateIndex: 2, slotIndex: 2, freeCount: 1 },
      ])
    })

    it('should return fewer than maxRecommendations when the candidate pool is smaller', () => {
      const tinyPoll: PollRecord = { ...session, dates: ['2025-09-04'], endMinute: 1020 } // 1 date, 1 slot
      const user: AvailabilityRecord = { userId: 'solo', free: [[true]], expiration: availabilityRecord.expiration }

      const result = findRecommendedMeetings(tinyPoll, [user])

      // tinyPoll: startMinute 960, endMinute 1020, slotMinutes 60 -> single slot [960,1020)
      expect(result).toEqual([
        {
          dateIndex: 0,
          slotIndex: 0,
          date: '2025-09-04',
          startMinute: 960,
          endMinute: 1020,
          freeCount: 1,
          freeUserIds: ['solo'],
          excludedByCalendar: [],
        },
      ])
    })

    it('should never recommend a slot where nobody is free', () => {
      const tinyPoll: PollRecord = { ...session, dates: ['2025-09-04'], endMinute: 1020 }
      const user: AvailabilityRecord = { userId: 'solo', free: [[false]], expiration: availabilityRecord.expiration }

      expect(findRecommendedMeetings(tinyPoll, [user])).toEqual([])
    })

    it('should return fewer than maxRecommendations rather than pad with zero-attendance slots', () => {
      const threeSingleSlotDates: PollRecord = {
        ...session,
        dates: ['2025-09-04', '2025-09-05', '2025-09-06'],
        startMinute: 960,
        endMinute: 990,
        slotMinutes: 30,
      }
      const user: AvailabilityRecord = {
        userId: 'solo',
        free: [[true], [false], [false]],
        expiration: availabilityRecord.expiration,
      }

      const result = findRecommendedMeetings(threeSingleSlotDates, [user])

      expect(result).toHaveLength(1)
      expect(result[0].freeCount).toBe(1)
    })

    it('should list users who marked themselves free but were excluded by a calendar conflict', () => {
      const tinyPoll: PollRecord = { ...session, dates: ['2025-09-04'], endMinute: 1020 } // 1 date, 1 slot (16:00-17:00)
      const solo: AvailabilityRecord = { userId: 'solo', free: [[true]], expiration: availabilityRecord.expiration }
      const other: AvailabilityRecord = { userId: 'other', free: [[true]], expiration: availabilityRecord.expiration }
      const busyGrids = {
        solo: buildBusyGrid(tinyPoll, [{ start: '2025-09-04T21:00:00.000Z', end: '2025-09-04T22:00:00.000Z' }]),
      }

      const result = findRecommendedMeetings(tinyPoll, [solo, other], 3, busyGrids)

      // tinyPoll: startMinute 960, endMinute 1020, slotMinutes 60 -> single slot [960,1020)
      expect(result).toEqual([
        {
          dateIndex: 0,
          slotIndex: 0,
          date: '2025-09-04',
          startMinute: 960,
          endMinute: 1020,
          freeCount: 1,
          freeUserIds: ['other'],
          excludedByCalendar: ['solo'],
        },
      ])
    })

    it('should respect a narrower override window when building candidates for that date', () => {
      const pollWithOverride: PollRecord = {
        ...session,
        overrides: [{ dates: ['2025-09-06'], startMinute: 960, endMinute: 1020 }],
      }
      const allFree: AvailabilityRecord = {
        userId: 'solo',
        free: [
          [true, true, true],
          [true, true, true],
          [true, true, true],
        ],
        expiration: availabilityRecord.expiration,
      }
      const result = findRecommendedMeetings(pollWithOverride, [allFree], 10)
      const saturdayCandidates = result.filter((m) => m.dateIndex === 2)
      expect(saturdayCandidates).toHaveLength(1)
      expect(saturdayCandidates[0].slotIndex).toBe(0)
    })
  })
})
