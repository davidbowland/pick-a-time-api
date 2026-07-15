import { PollRecord } from '../types'

export interface Slot {
  slotIndex: number
  startMinute: number
  endMinute: number
}

export const buildSlots = (poll: PollRecord): Slot[] => {
  if (!poll.usesTimes) {
    return [{ slotIndex: 0, startMinute: 0, endMinute: 1440 }]
  }

  const step = poll.slotMinutes === 15 ? 15 : 30
  const slots: Slot[] = []
  for (let start = poll.startMinute; start + poll.slotMinutes <= poll.endMinute; start += step) {
    slots.push({ slotIndex: slots.length, startMinute: start, endMinute: start + poll.slotMinutes })
  }
  return slots
}

export const emptyGrid = (rowCount: number, colCount: number): boolean[][] =>
  Array.from({ length: rowCount }, () => Array.from({ length: colCount }, () => false))
