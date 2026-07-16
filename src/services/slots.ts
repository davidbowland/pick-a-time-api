import { PollRecord, TimedPoll } from '../types'

export interface Slot {
  slotIndex: number
  startMinute: number
  endMinute: number
}

const resolveWindow = (poll: TimedPoll, date: string): { startMinute: number; endMinute: number } => {
  const override = poll.overrides?.find((group) => group.dates.includes(date))
  return override
    ? { startMinute: override.startMinute, endMinute: override.endMinute }
    : { startMinute: poll.startMinute, endMinute: poll.endMinute }
}

const buildSlotsForWindow = (startMinute: number, endMinute: number, slotMinutes: number): Slot[] => {
  const step = slotMinutes === 15 ? 15 : 30
  const slots: Slot[] = []
  for (let start = startMinute; start + slotMinutes <= endMinute; start += step) {
    slots.push({ slotIndex: slots.length, startMinute: start, endMinute: start + slotMinutes })
  }
  return slots
}

export const buildSlots = (poll: PollRecord): Slot[][] =>
  poll.usesTimes
    ? poll.dates.map((date) => {
      const { startMinute, endMinute } = resolveWindow(poll, date)
      return buildSlotsForWindow(startMinute, endMinute, poll.slotMinutes)
    })
    : poll.dates.map(() => [{ slotIndex: 0, startMinute: 0, endMinute: 1440 }])

export const emptyGrid = (rowLengths: number[]): boolean[][] =>
  rowLengths.map((length) => Array.from({ length }, () => false))
