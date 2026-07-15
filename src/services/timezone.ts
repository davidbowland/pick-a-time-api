const parseIsoDate = (isoDate: string): Date => {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

const formatIsoDate = (date: Date): string => date.toISOString().slice(0, 10)

export const nextIsoDate = (isoDate: string): string => {
  const date = parseIsoDate(isoDate)
  date.setUTCDate(date.getUTCDate() + 1)
  return formatIsoDate(date)
}

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const getZonedParts = (date: Date, timezone: string): ZonedParts => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  })
  const parts = formatter
    .formatToParts(date)
    .reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {} as Record<string, string>)
  return {
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    month: Number(parts.month),
    year: Number(parts.year),
  }
}

// Two-pass offset correction: the first pass estimates the UTC offset using the naive UTC
// guess, which can be wrong within the ~5-hour window around a DST transition where the
// offset at the guess differs from the offset at the actual candidate instant. The second
// pass recomputes the offset at the corrected candidate and uses it if it differs from the
// first pass. The single local hour that is truly ambiguous (repeated during fall-back) or
// skipped (during spring-forward) remains inherently unresolvable without extra
// disambiguation input — this is a standard, accepted limitation of timezone conversion, not
// a bug.
export const zonedTimeToUtc = (isoDate: string, hour: number, minute: number, timezone: string): Date => {
  const [year, month, day] = isoDate.split('-').map(Number)
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute))

  const offsetAt = (instant: Date): number => {
    const zoned = getZonedParts(instant, timezone)
    const asIfUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute)
    return asIfUtc - instant.getTime()
  }

  const firstOffset = offsetAt(utcGuess)
  const candidate = new Date(utcGuess.getTime() - firstOffset)
  const secondOffset = offsetAt(candidate)
  return secondOffset === firstOffset ? candidate : new Date(utcGuess.getTime() - secondOffset)
}

export const utcToZonedDateAndMinute = (instant: Date, timezone: string): { date: string; minuteOfDay: number } => {
  const parts = getZonedParts(instant, timezone)
  const date = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
  return { date, minuteOfDay: parts.hour * 60 + parts.minute }
}
