import { availabilityRecord, session } from '../__mocks__'
import * as overlap from '@services/overlap'
import { buildBusyGrid, computeGrid, findRecommendedMeetings, pickBestSlot } from '@services/overlap'
import { AvailabilityRecord, PollRecord } from '@types'

describe('overlap', () => {
  // AC-001 and AC-009. The deleted marking pass was the only path from calendar data into stored
  // availability, and losing it is what makes a check non-destructive. Pinned as an exact export
  // list rather than as the absence of one name: a re-implementation under any name would restore
  // the destructive write with every other test in this file still green, and this is the assertion
  // that has to be edited before that can happen.
  it('should export only grid readers and nothing that writes availability', () => {
    expect(Object.keys(overlap).sort()).toEqual([
      'buildBusyGrid',
      'computeGrid',
      'findRecommendedMeetings',
      'pickBestSlot',
    ])
  })

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
      // 09-04 is busy 16:00-24:00: eight hours exactly, which is the threshold, so the departure day
      // counts as booked along with the interior ones. A day you leave on at four is not a day you
      // can give to something else.
      expect(grid[0]).toEqual([true])
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

    it('should mark a dates-only date busy for an ordinary working day', () => {
      // 08:00-18:00 local. A day already carrying ten hours of commitments is not a day this person
      // is free for a whole-day plan, whether or not anything on it is an all-day booking.
      const grid = buildBusyGrid(offsetPoll(['2025-09-05']), [
        { start: '2025-09-05T13:00:00.000Z', end: '2025-09-05T23:00:00.000Z' },
      ])
      expect(grid[0]).toEqual([true])
    })

    it('should leave a dates-only date free for less than a working day of bookings', () => {
      // 09:00-15:00 local: six hours, a morning and a bit. Enough to work around, so the date stays
      // free and its owner keeps the choice.
      const grid = buildBusyGrid(offsetPoll(['2025-09-05']), [
        { start: '2025-09-05T14:00:00.000Z', end: '2025-09-05T20:00:00.000Z' },
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
      // Two five-hour bookings covering 00:00-07:00 local between them. Summed naively that is ten
      // hours and a booked day; unioned it is seven, and is not.
      const grid = buildBusyGrid(offsetPoll(['2025-09-05']), [
        { start: '2025-09-05T05:00:00.000Z', end: '2025-09-05T10:00:00.000Z' },
        { start: '2025-09-05T07:00:00.000Z', end: '2025-09-05T12:00:00.000Z' },
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
