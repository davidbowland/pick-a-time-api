import { AvailabilityRecord, PollRecord } from '../types'
import { buildSlots, Slot } from './slots'
import { nextIsoDate, utcToZonedDateAndMinute } from './timezone'

export type BusyGrid = boolean[][] // [dateIndex][slotIndex]

const datesBetweenExclusive = (startDate: string, endDate: string): string[] => {
  const dates: string[] = []
  for (let date = nextIsoDate(startDate); date < endDate; date = nextIsoDate(date)) {
    dates.push(date)
  }
  return dates
}

const toBusyBlocks = (
  intervals: { start: string; end: string }[],
  timezone: string,
): { date: string; startMinute: number; endMinute: number }[] =>
  intervals.flatMap((interval) => {
    const start = utcToZonedDateAndMinute(new Date(interval.start), timezone)
    const end = utcToZonedDateAndMinute(new Date(interval.end), timezone)
    if (start.date === end.date) {
      return [{ date: start.date, endMinute: end.minuteOfDay, startMinute: start.minuteOfDay }]
    }
    const middleDayBlocks = datesBetweenExclusive(start.date, end.date).map((date) => ({
      date,
      endMinute: 24 * 60,
      startMinute: 0,
    }))
    return [
      { date: start.date, endMinute: 24 * 60, startMinute: start.minuteOfDay },
      ...middleDayBlocks,
      { date: end.date, endMinute: end.minuteOfDay, startMinute: 0 },
    ]
  })

const isSlotBusy = (poll: PollRecord, blocks: { startMinute: number; endMinute: number }[], slot: Slot): boolean =>
  poll.usesTimes
    ? blocks.some((block) => block.startMinute < slot.endMinute && block.endMinute > slot.startMinute)
    : blocks.some((block) => block.startMinute <= 0 && block.endMinute >= 1440)

export const buildBusyGrid = (poll: PollRecord, busyIntervals: { start: string; end: string }[]): BusyGrid => {
  const slots = buildSlots(poll)
  const busyBlocks = toBusyBlocks(busyIntervals, poll.timezone)
  const blocksByDate = new Map<string, { startMinute: number; endMinute: number }[]>()
  for (const block of busyBlocks) {
    const existing = blocksByDate.get(block.date)
    if (existing) existing.push(block)
    else blocksByDate.set(block.date, [block])
  }

  return poll.dates.map((date, dateIndex) => {
    const blocks = blocksByDate.get(date) ?? []
    return slots[dateIndex].map((slot) => isSlotBusy(poll, blocks, slot))
  })
}

export const markBusyHours = (
  poll: PollRecord,
  availability: AvailabilityRecord,
  busyIntervals: { start: string; end: string }[],
): { availability: AvailabilityRecord; markedBusyCount: number } => {
  const busyGrid = buildBusyGrid(poll, busyIntervals)
  let markedBusyCount = 0

  // One-way by construction: a cell can only move from true to false here. `isFree && isBusy` is
  // the sole path that writes anything, so no calendar response -- including one reporting an hour
  // free -- can turn a cell back on.
  const free = availability.free.map((row, dateIndex) =>
    row.map((isFree, slotIndex) => {
      const isBusy = busyGrid[dateIndex]?.[slotIndex] ?? false
      if (isFree && isBusy) {
        markedBusyCount += 1
        return false
      }
      return isFree
    }),
  )

  return { availability: { ...availability, free }, markedBusyCount }
}

export interface OverlapCell {
  dateIndex: number
  slotIndex: number
  startMinute: number
  endMinute: number
  freeCount: number
  freeUserIds: string[]
}

export interface OverlapGrid {
  cells: OverlapCell[][] // [dateIndex][slotIndex]
  bestSlot: { dateIndex: number; slotIndex: number; freeCount: number; freeUserIds: string[] }
}

// Stored availability is the only input. Calendar busy time reaches the grid by having been written
// into someone's own availability by the sync endpoint, never by being subtracted again here.
export const computeGrid = (poll: PollRecord, availability: AvailabilityRecord[]): Pick<OverlapGrid, 'cells'> => {
  const slots = buildSlots(poll)

  const cells: OverlapCell[][] = poll.dates.map((_, dateIndex) =>
    slots[dateIndex].map((slot) => {
      const freeUserIds = availability.filter((a) => a.free[dateIndex][slot.slotIndex]).map((a) => a.userId)
      return {
        dateIndex,
        slotIndex: slot.slotIndex,
        startMinute: slot.startMinute,
        endMinute: slot.endMinute,
        freeCount: freeUserIds.length,
        freeUserIds,
      }
    }),
  )

  return { cells }
}

export interface RecommendedMeeting {
  dateIndex: number
  slotIndex: number
  date: string
  startMinute: number
  endMinute: number
  freeCount: number
  freeUserIds: string[]
}

interface Candidate {
  dateIndex: number
  slotIndex: number
  date: string
  startMinute: number
  endMinute: number
  freeCount: number
  freeUserIds: string[]
}

const isDiverseFromPicks = (candidate: Candidate, picks: Candidate[]): boolean =>
  picks.every((pick) => pick.dateIndex !== candidate.dateIndex && pick.slotIndex !== candidate.slotIndex)

const groupIntoTiers = (sortedByFreeCountDesc: Candidate[]): Candidate[][] => {
  const tiers: Candidate[][] = []
  for (const candidate of sortedByFreeCountDesc) {
    const currentTier = tiers[tiers.length - 1]
    if (currentTier && currentTier[0].freeCount === candidate.freeCount) {
      currentTier.push(candidate)
    } else {
      tiers.push([candidate])
    }
  }
  return tiers
}

export const findRecommendedMeetings = (
  poll: PollRecord,
  availability: AvailabilityRecord[],
  maxRecommendations = 3,
): RecommendedMeeting[] => {
  const slots = buildSlots(poll)

  const candidates: Candidate[] = poll.dates
    .flatMap((date, dateIndex) =>
      slots[dateIndex].map((slot) => {
        const freeUserIds = availability.filter((a) => a.free[dateIndex][slot.slotIndex]).map((a) => a.userId)
        return {
          dateIndex,
          slotIndex: slot.slotIndex,
          date,
          startMinute: slot.startMinute,
          endMinute: slot.endMinute,
          freeCount: freeUserIds.length,
          freeUserIds,
        }
      }),
    )
    .filter((candidate) => candidate.freeCount > 0)

  const sorted = [...candidates].sort(
    (a, b) => b.freeCount - a.freeCount || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
  )
  const tiers = groupIntoTiers(sorted)

  const picks: Candidate[] = []
  for (const tier of tiers) {
    if (picks.length >= maxRecommendations) break
    const remaining = [...tier]

    let diverseIndex = remaining.findIndex((candidate) => isDiverseFromPicks(candidate, picks))
    while (picks.length < maxRecommendations && diverseIndex !== -1) {
      picks.push(remaining[diverseIndex])
      remaining.splice(diverseIndex, 1)
      diverseIndex = remaining.findIndex((candidate) => isDiverseFromPicks(candidate, picks))
    }

    while (picks.length < maxRecommendations && remaining.length > 0) {
      picks.push(remaining.shift()!)
    }
  }

  return picks
}

export const pickBestSlot = (recommendedMeetings: RecommendedMeeting[]): OverlapGrid['bestSlot'] => {
  const top = recommendedMeetings[0]
  return top
    ? { dateIndex: top.dateIndex, slotIndex: top.slotIndex, freeCount: top.freeCount, freeUserIds: top.freeUserIds }
    : { dateIndex: 0, slotIndex: 0, freeCount: 0, freeUserIds: [] }
}
