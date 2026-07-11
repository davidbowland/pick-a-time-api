import { PlanRecord } from '../types'

export interface Occurrence {
  weekIndex: number
  dayIndex: number
  date: string // ISO "YYYY-MM-DD"
}

const parseIsoDate = (isoDate: string): Date => {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

const formatIsoDate = (date: Date): string => date.toISOString().slice(0, 10)

export const dayOfWeek = (isoDate: string): number => parseIsoDate(isoDate).getUTCDay()

export const buildOccurrences = (plan: Pick<PlanRecord, 'weekdays' | 'startDate' | 'weekCount'>): Occurrence[] => {
  const startDow = dayOfWeek(plan.startDate)
  const offsetsWithinWeek = plan.weekdays.map((weekday) => (weekday - startDow + 7) % 7)

  const occurrences: Occurrence[] = []
  plan.weekdays.forEach((_, dayIndex) => {
    for (let weekIndex = 0; weekIndex < plan.weekCount; weekIndex++) {
      const totalDayOffset = weekIndex * 7 + offsetsWithinWeek[dayIndex]
      const date = parseIsoDate(plan.startDate)
      date.setUTCDate(date.getUTCDate() + totalDayOffset)
      occurrences.push({ weekIndex, dayIndex, date: formatIsoDate(date) })
    }
  })
  return occurrences.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

export const emptyGrid = (hourCount: number, dayCount: number): boolean[][] =>
  Array.from({ length: hourCount }, () => Array.from({ length: dayCount }, () => false))
