import { availabilityRecord, calendarAccountRecord, session } from '../__mocks__'
import { buildBusyGrid, computeGrid, findRecommendedMeetings, markBusyHours, pickBestSlot } from '@services/overlap'
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

    // freeBusy answers in instants, so an all-day booking made in a different timezone arrives here
    // split across two local dates, and neither half covers a whole day. Demanding exact midnight
    // alignment left somebody booked solid marked free, and only ever cross-timezone.
    const offsetPoll = (dates: string[]): PollRecord => ({
      sessionId: 'abc123',
      name: 'Trip planning',
      dates,
      usesTimes: false,
      timezone: 'America/Chicago',
      expiration: session.expiration,
    })

    it('should mark a date busy for an all-day booking offset by an hour', () => {
      // A whole day in America/New_York: 2025-09-05T00:00-04:00 to 2025-09-06T00:00-04:00. Read in
      // America/Chicago that runs 09-04 23:00 to 09-05 23:00 -- twenty-three hours of 09-05.
      const grid = buildBusyGrid(offsetPoll(['2025-09-04', '2025-09-05']), [
        { start: '2025-09-05T04:00:00.000Z', end: '2025-09-06T04:00:00.000Z' },
      ])
      expect(grid[1]).toEqual([true])
      // The one-hour tail on the previous day is not a booked day and must not read as one.
      expect(grid[0]).toEqual([false])
    })

    it('should mark a date busy for an all-day booking offset by six hours', () => {
      // A whole UTC day read in America/Chicago: 09-04 19:00 to 09-05 19:00 -- nineteen hours.
      const grid = buildBusyGrid(offsetPoll(['2025-09-05']), [
        { start: '2025-09-05T00:00:00.000Z', end: '2025-09-06T00:00:00.000Z' },
      ])
      expect(grid[0]).toEqual([true])
    })

    it('should not let an ordinary working day mark a dates-only date busy', () => {
      // 08:00-18:00 local. Ten hours is a full day of work and is not a full day.
      const grid = buildBusyGrid(offsetPoll(['2025-09-05']), [
        { start: '2025-09-05T13:00:00.000Z', end: '2025-09-05T23:00:00.000Z' },
      ])
      expect(grid[0]).toEqual([false])
    })

    it('should add separate bookings together before deciding a date is fully booked', () => {
      // 00:00-10:00 and 10:00-19:00 local: two bookings, nineteen hours between them.
      const grid = buildBusyGrid(offsetPoll(['2025-09-05']), [
        { start: '2025-09-05T05:00:00.000Z', end: '2025-09-05T15:00:00.000Z' },
        { start: '2025-09-05T15:00:00.000Z', end: '2025-09-06T00:00:00.000Z' },
      ])
      expect(grid[0]).toEqual([true])
    })

    it('should not double-count overlapping bookings toward a fully booked date', () => {
      // Two ten-hour bookings covering 00:00-11:00 local between them. Summed naively that is
      // twenty hours and a booked day; unioned it is eleven, and is not.
      const grid = buildBusyGrid(offsetPoll(['2025-09-05']), [
        { start: '2025-09-05T05:00:00.000Z', end: '2025-09-05T15:00:00.000Z' },
        { start: '2025-09-05T06:00:00.000Z', end: '2025-09-05T16:00:00.000Z' },
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

  describe('markBusyHours', () => {
    // calendarAccountRecord.busyIntervals is 2025-09-04 16:00-17:00 America/Chicago. The session's
    // slots overlap, so that one interval covers TWO slots on dateIndex 0: slot0 [16:00-17:00) and
    // slot1 [16:30-17:30). slot2 [17:00-18:00) and every slot on the other two dates stay free.
    const busy = calendarAccountRecord.busyIntervals
    // A factory, not a constant: every test gets its own grid, so a mutating implementation can
    // never leak a marked cell from one test into the next.
    const allFree = (): boolean[][] => [
      [true, true, true],
      [true, true, true],
      [true, true, true],
    ]

    it('should mark a free slot busy when the calendar says busy', () => {
      const input = { ...availabilityRecord, free: allFree() }

      const result = markBusyHours(session, input, busy)

      expect(result.availability.free[0]).toEqual([false, false, true])
      expect(result.markedBusyCount).toBe(2)
    })

    it('should not count a slot that was already busy', () => {
      // slot0 is already marked busy by hand, so only slot1 moves -- one fewer than the 2 counted
      // when the same interval lands on an all-free row.
      const input = {
        ...availabilityRecord,
        free: [
          [false, true, true],
          [true, true, true],
          [true, true, true],
        ],
      }

      const result = markBusyHours(session, input, busy)

      expect(result.availability.free[0][0]).toBe(false)
      expect(result.markedBusyCount).toBe(1)
    })

    it('should never mark a slot free', () => {
      // Every slot the calendar reports FREE (slot2 on dateIndex 0, all of dateIndex 1 and 2) is
      // busy here. A two-way edit would turn them all back on; a one-way edit leaves them alone.
      const input = {
        ...availabilityRecord,
        free: [
          [false, false, false],
          [false, false, false],
          [false, false, false],
        ],
      }

      const result = markBusyHours(session, input, busy)

      expect(result.availability.free.flat()).not.toContain(true)
      expect(result.markedBusyCount).toBe(0)
    })

    it('should leave slots the calendar reports free untouched', () => {
      const input = { ...availabilityRecord, free: allFree() }

      const result = markBusyHours(session, input, busy)

      expect(result.availability.free[0][2]).toBe(true)
      expect(result.availability.free[1]).toEqual([true, true, true])
      expect(result.availability.free[2]).toEqual([true, true, true])
    })

    it('should not mutate its input', () => {
      const input = { ...availabilityRecord, free: allFree() }

      markBusyHours(session, input, busy)

      expect(input.free[0][0]).toBe(true)
    })

    it('should preserve every other field on the record', () => {
      const input = { ...availabilityRecord, free: allFree() }

      const result = markBusyHours(session, input, busy)

      expect(result.availability.userId).toBe(input.userId)
      expect(result.availability.expiration).toBe(input.expiration)
    })

    it('should mark nothing when there are no busy intervals', () => {
      const input = { ...availabilityRecord, free: allFree() }

      const result = markBusyHours(session, input, [])

      expect(result.markedBusyCount).toBe(0)
      expect(result.availability.free[0]).toEqual([true, true, true])
    })

    it('should respect per-date override windows where rows have different lengths', () => {
      // An override narrows Saturday to a single slot, so the busy grid is ragged: rows 0 and 1 are
      // 3 slots wide, row 2 is 1. A stored availability row can still be 3 wide there -- written
      // before the override narrowed the day, or by a client holding a stale copy of the poll.
      // Every slot past the end of its busy row has no calendar answer at all, and "no answer"
      // means free: the guard reads those as not-busy rather than marking them or throwing.
      const pollWithOverride: PollRecord = {
        ...session,
        overrides: [{ dates: ['2025-09-06'], startMinute: 960, endMinute: 1020 }],
      }
      // 2025-09-06 16:00-17:00 America/Chicago -- exactly the override's one slot, so the short row
      // really does report busy and the test cannot pass by marking nothing at all.
      const saturdayBusy = [{ start: '2025-09-06T21:00:00.000Z', end: '2025-09-06T22:00:00.000Z' }]
      const input = { ...availabilityRecord, free: allFree() }

      const result = markBusyHours(pollWithOverride, input, saturdayBusy)

      expect(result.availability.free[2]).toEqual([false, true, true])
      expect(result.markedBusyCount).toBe(1)
      // The wider rows on the other dates are untouched -- a short row elsewhere does not shrink them.
      expect(result.availability.free[0]).toEqual([true, true, true])
      expect(result.availability.free[1]).toEqual([true, true, true])
    })

    it('should leave a stored date row that the poll no longer has untouched', () => {
      // The other half of the same guard: availability can outlive a date. Dropping a date from the
      // poll leaves records whose grid has more rows than the poll has dates, and the missing row
      // has no calendar answer for any of its slots.
      const shorterPoll: PollRecord = { ...session, dates: ['2025-09-04', '2025-09-05'] }
      const input = { ...availabilityRecord, free: allFree() } // still 3 rows

      const result = markBusyHours(shorterPoll, input, busy)

      expect(result.availability.free[2]).toEqual([true, true, true])
      expect(result.markedBusyCount).toBe(2) // only the two cells on the date the poll still has
    })

    it('should mark a dates-only poll busy only for a full-day block', () => {
      const datesOnly: PollRecord = {
        sessionId: session.sessionId,
        name: session.name,
        dates: session.dates,
        usesTimes: false,
        timezone: session.timezone,
        expiration: session.expiration,
      }
      const input = { ...availabilityRecord, free: [[true], [true], [true]] }

      const partial = markBusyHours(datesOnly, input, busy)
      expect(partial.markedBusyCount).toBe(0)

      // 2025-09-04T00:00 through 2025-09-05T00:00 America/Chicago -- the whole of dateIndex 0.
      const allDay = [{ start: '2025-09-04T05:00:00.000Z', end: '2025-09-05T05:00:00.000Z' }]
      const full = markBusyHours(datesOnly, input, allDay)
      expect(full.availability.free[0][0]).toBe(false)
      expect(full.markedBusyCount).toBe(1)
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
      calendarCheckedAt: null,
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
        calendarCheckedAt: null,
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
        },
        {
          dateIndex: 1,
          slotIndex: 1,
          date: '2025-09-05',
          startMinute: 990,
          endMinute: 1050,
          freeCount: 3,
          freeUserIds: ['user-a', 'user-b', 'user-c'],
        },
        {
          dateIndex: 2,
          slotIndex: 2,
          date: '2025-09-06',
          startMinute: 1020,
          endMinute: 1080,
          freeCount: 3,
          freeUserIds: ['user-a', 'user-b', 'user-c'],
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
        calendarCheckedAt: null,
        expiration: availabilityRecord.expiration,
      }
      const userB: AvailabilityRecord = {
        userId: 'user-b',
        free: [[true], [true]],
        calendarCheckedAt: null,
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
        calendarCheckedAt: null,
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
        calendarCheckedAt: null,
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
      const user: AvailabilityRecord = {
        userId: 'solo',
        free: [[true]],
        calendarCheckedAt: null,
        expiration: availabilityRecord.expiration,
      }

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
        },
      ])
    })

    it('should never recommend a slot where nobody is free', () => {
      const tinyPoll: PollRecord = { ...session, dates: ['2025-09-04'], endMinute: 1020 }
      const user: AvailabilityRecord = {
        userId: 'solo',
        free: [[false]],
        calendarCheckedAt: null,
        expiration: availabilityRecord.expiration,
      }

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
        calendarCheckedAt: null,
        expiration: availabilityRecord.expiration,
      }

      const result = findRecommendedMeetings(threeSingleSlotDates, [user])

      expect(result).toHaveLength(1)
      expect(result[0].freeCount).toBe(1)
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
        calendarCheckedAt: null,
        expiration: availabilityRecord.expiration,
      }
      const result = findRecommendedMeetings(pollWithOverride, [allFree], 10)
      const saturdayCandidates = result.filter((m) => m.dateIndex === 2)
      expect(saturdayCandidates).toHaveLength(1)
      expect(saturdayCandidates[0].slotIndex).toBe(0)
    })
  })

  describe('pickBestSlot', () => {
    it("should take the top recommended meeting's slot info", () => {
      const recommendedMeetings = [
        {
          dateIndex: 1,
          slotIndex: 2,
          date: '2025-09-05',
          startMinute: 990,
          endMinute: 1050,
          freeCount: 2,
          freeUserIds: ['user-a', 'user-b'],
        },
      ]
      expect(pickBestSlot(recommendedMeetings)).toEqual({
        dateIndex: 1,
        slotIndex: 2,
        freeCount: 2,
        freeUserIds: ['user-a', 'user-b'],
      })
    })

    it('should default to (0,0) with freeCount 0 when there are no recommended meetings', () => {
      expect(pickBestSlot([])).toEqual({ dateIndex: 0, slotIndex: 0, freeCount: 0, freeUserIds: [] })
    })
  })
})
