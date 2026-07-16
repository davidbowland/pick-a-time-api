import {
  allowedSlotMinutes,
  defaultSlotMinutes,
  maxPollDateRangeDays,
  maxPollDates,
  maxPollOverrideGroups,
  participantNameMaxLength,
  pollNameMaxLength,
  startEndMinuteStep,
} from '../config'
import { ValidationError } from '../errors'
import { utcToZonedDateAndMinute } from '../services/timezone'
import {
  APIGatewayProxyEventV2,
  AvailabilityCell,
  AvailabilityPatchInput,
  NewPollInput,
  PatchOperation,
} from '../types'

const ALLOWED_PATCH_OPS = ['replace']
const ALLOWED_PATCH_PATHS = ['/name']

const requireBody = (event: APIGatewayProxyEventV2): string => {
  const raw = event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
  if (!raw) {
    throw new ValidationError('request body is required')
  }
  return raw
}

const parseEventBody = (event: APIGatewayProxyEventV2): unknown => JSON.parse(requireBody(event))

const isValidTimezone = (timezone: string): boolean => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

const isValidIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

const isValidDatesArray = (dates: unknown): dates is string[] =>
  Array.isArray(dates) &&
  dates.length > 0 &&
  dates.every((d: unknown) => typeof d === 'string' && isValidIsoDate(d)) &&
  new Set(dates).size === dates.length

const addDays = (isoDate: string, days: number): string => {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export const parseNewPollBody = (event: APIGatewayProxyEventV2, now = Date.now): NewPollInput => {
  const body = parseEventBody(event) as Record<string, unknown>

  if (typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.length > pollNameMaxLength) {
    throw new ValidationError(`name is required and must be ${pollNameMaxLength} characters or fewer`)
  }

  if (!isValidDatesArray(body.dates)) {
    throw new ValidationError('dates must be a non-empty array of unique valid ISO date strings (YYYY-MM-DD)')
  }
  if (body.dates.length > maxPollDates) {
    throw new ValidationError(`dates must contain at most ${maxPollDates} entries`)
  }

  if (typeof body.timezone !== 'string' || !isValidTimezone(body.timezone)) {
    throw new ValidationError('timezone must be a valid IANA time zone name')
  }

  const dates = [...body.dates].sort()
  const today = utcToZonedDateAndMinute(new Date(now()), body.timezone).date
  if (dates[0] < today) {
    throw new ValidationError('dates must not be in the past')
  }
  if (dates[dates.length - 1] > addDays(today, maxPollDateRangeDays)) {
    throw new ValidationError(`dates must be within ${maxPollDateRangeDays} days of today`)
  }

  if (typeof body.usesTimes !== 'boolean') {
    throw new ValidationError('usesTimes must be a boolean')
  }

  if (!body.usesTimes) {
    if (
      body.startMinute !== undefined ||
      body.endMinute !== undefined ||
      body.slotMinutes !== undefined ||
      body.overrides !== undefined
    ) {
      throw new ValidationError(
        'startMinute, endMinute, slotMinutes, and overrides must be omitted when usesTimes is false',
      )
    }
    return { name: body.name.trim(), dates, usesTimes: false, timezone: body.timezone }
  }

  if (
    typeof body.startMinute !== 'number' ||
    !Number.isInteger(body.startMinute) ||
    body.startMinute < 0 ||
    body.startMinute > 1425 ||
    body.startMinute % startEndMinuteStep !== 0
  ) {
    throw new ValidationError(`startMinute must be a multiple of ${startEndMinuteStep} between 0 and 1425`)
  }

  if (
    typeof body.endMinute !== 'number' ||
    !Number.isInteger(body.endMinute) ||
    body.endMinute <= body.startMinute ||
    body.endMinute > 1440 ||
    body.endMinute % startEndMinuteStep !== 0
  ) {
    throw new ValidationError(
      `endMinute must be a multiple of ${startEndMinuteStep}, greater than startMinute, and at most 1440`,
    )
  }

  const slotMinutes = (body.slotMinutes === undefined ? defaultSlotMinutes : body.slotMinutes) as number
  if (!allowedSlotMinutes.includes(slotMinutes)) {
    throw new ValidationError(`slotMinutes must be one of ${allowedSlotMinutes.join(', ')}`)
  }

  if (body.endMinute - body.startMinute < slotMinutes) {
    throw new ValidationError(`the time window must be at least ${slotMinutes} minutes wide`)
  }

  const dateSet = new Set(dates)
  let overrides: { dates: string[]; startMinute: number; endMinute: number }[] | undefined

  if (body.overrides !== undefined) {
    if (!Array.isArray(body.overrides) || body.overrides.length === 0) {
      throw new ValidationError('overrides must be a non-empty array when present')
    }
    if (body.overrides.length > maxPollOverrideGroups) {
      throw new ValidationError(`overrides must contain at most ${maxPollOverrideGroups} entries`)
    }

    const seenDates = new Set<string>()
    overrides = body.overrides.map((entry: unknown, index: number) => {
      const o = entry as Record<string, unknown>

      if (!isValidDatesArray(o.dates)) {
        throw new ValidationError(
          `overrides[${index}].dates must be a non-empty array of unique valid ISO date strings`,
        )
      }
      for (const date of o.dates) {
        if (!dateSet.has(date)) {
          throw new ValidationError(`overrides[${index}].dates must be a subset of the poll's own dates`)
        }
        if (seenDates.has(date)) {
          throw new ValidationError(`overrides[${index}].dates must not overlap with another override group`)
        }
        seenDates.add(date)
      }

      if (
        typeof o.startMinute !== 'number' ||
        !Number.isInteger(o.startMinute) ||
        o.startMinute < 0 ||
        o.startMinute > 1425 ||
        o.startMinute % startEndMinuteStep !== 0
      ) {
        throw new ValidationError(
          `overrides[${index}].startMinute must be a multiple of ${startEndMinuteStep} between 0 and 1425`,
        )
      }
      if (
        typeof o.endMinute !== 'number' ||
        !Number.isInteger(o.endMinute) ||
        o.endMinute <= o.startMinute ||
        o.endMinute > 1440 ||
        o.endMinute % startEndMinuteStep !== 0
      ) {
        throw new ValidationError(
          `overrides[${index}].endMinute must be a multiple of ${startEndMinuteStep}, greater than startMinute, and at most 1440`,
        )
      }
      if (o.endMinute - o.startMinute < slotMinutes) {
        throw new ValidationError(`overrides[${index}] time window must be at least ${slotMinutes} minutes wide`)
      }

      return { dates: [...o.dates].sort(), startMinute: o.startMinute, endMinute: o.endMinute }
    })
  }

  return {
    name: body.name.trim(),
    dates,
    usesTimes: true,
    startMinute: body.startMinute,
    endMinute: body.endMinute,
    slotMinutes: slotMinutes as 15 | 30 | 60 | 90 | 120,
    timezone: body.timezone,
    ...(overrides !== undefined && { overrides }),
  }
}

export const parseUserPatch = (event: APIGatewayProxyEventV2): PatchOperation[] => {
  const ops = parseEventBody(event) as PatchOperation[]

  if (!Array.isArray(ops)) {
    throw new ValidationError('request body must be an array of patch operations')
  }

  for (const op of ops) {
    if (!ALLOWED_PATCH_OPS.includes(op.op)) {
      throw new ValidationError(`disallowed patch op: ${op.op}`)
    }
    if (!ALLOWED_PATCH_PATHS.includes(op.path)) {
      throw new ValidationError(`disallowed patch path: ${op.path}`)
    }
    if (op.path === '/name') {
      if (!('value' in op) || typeof op.value !== 'string') {
        throw new ValidationError('name must be a string')
      }
      if (op.value.length > participantNameMaxLength) {
        throw new ValidationError(`name must be ${participantNameMaxLength} characters or fewer`)
      }
    }
  }

  return ops
}

export const extractRecaptchaToken = (event: APIGatewayProxyEventV2): string => {
  const token = event.headers['x-recaptcha-token']
  if (!token) {
    throw new ValidationError('x-recaptcha-token header is required')
  }
  return token
}

export const parseAvailabilityPatch = (event: APIGatewayProxyEventV2): AvailabilityPatchInput => {
  const body = parseEventBody(event) as Record<string, unknown>

  if (!Array.isArray(body.cells) || body.cells.length === 0) {
    throw new ValidationError('cells must be a non-empty array')
  }

  const cells: AvailabilityCell[] = body.cells.map((cell) => {
    const c = cell as Record<string, unknown>
    if (
      typeof c.dateIndex !== 'number' ||
      !Number.isInteger(c.dateIndex) ||
      c.dateIndex < 0 ||
      typeof c.slotIndex !== 'number' ||
      !Number.isInteger(c.slotIndex) ||
      c.slotIndex < 0 ||
      typeof c.value !== 'boolean'
    ) {
      throw new ValidationError('each cell must have a non-negative integer dateIndex/slotIndex and boolean value')
    }
    return { dateIndex: c.dateIndex, slotIndex: c.slotIndex, value: c.value }
  })

  return { cells }
}
