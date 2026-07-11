import { maxPlanWeeks } from '../config'
import { ValidationError } from '../errors'
import {
  APIGatewayProxyEventV2,
  AvailabilityCell,
  AvailabilityPatchInput,
  NewPlanInput,
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

const MAX_NAME_LENGTH = 100

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

export const parseNewPlanBody = (event: APIGatewayProxyEventV2): NewPlanInput => {
  const body = parseEventBody(event) as Record<string, unknown>

  if (typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`name is required and must be ${MAX_NAME_LENGTH} characters or fewer`)
  }

  if (
    !Array.isArray(body.weekdays) ||
    body.weekdays.length === 0 ||
    body.weekdays.length > 7 ||
    !body.weekdays.every((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6) ||
    new Set(body.weekdays as number[]).size !== body.weekdays.length
  ) {
    throw new ValidationError('weekdays must be a non-empty array of unique integers between 0 and 6')
  }
  const weekdays = body.weekdays as number[]

  if (typeof body.startDate !== 'string' || !isValidIsoDate(body.startDate)) {
    throw new ValidationError('startDate must be a valid ISO date string (YYYY-MM-DD)')
  }
  const [year, month, day] = body.startDate.split('-').map(Number)
  const startDow = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  if (weekdays[0] !== startDow) {
    throw new ValidationError('startDate must fall on the first day listed in weekdays')
  }

  if (
    typeof body.weekCount !== 'number' ||
    !Number.isInteger(body.weekCount) ||
    body.weekCount < 1 ||
    body.weekCount > maxPlanWeeks
  ) {
    throw new ValidationError(`weekCount must be an integer between 1 and ${maxPlanWeeks}`)
  }

  if (
    typeof body.startHour !== 'number' ||
    !Number.isInteger(body.startHour) ||
    body.startHour < 0 ||
    body.startHour > 23
  ) {
    throw new ValidationError('startHour must be an integer between 0 and 23')
  }

  if (
    typeof body.endHour !== 'number' ||
    !Number.isInteger(body.endHour) ||
    body.endHour <= body.startHour ||
    body.endHour > 24
  ) {
    throw new ValidationError('endHour must be an integer greater than startHour and at most 24')
  }

  if (typeof body.timezone !== 'string' || !isValidTimezone(body.timezone)) {
    throw new ValidationError('timezone must be a valid IANA time zone name')
  }

  return {
    name: body.name.trim(),
    weekdays,
    startDate: body.startDate,
    weekCount: body.weekCount,
    startHour: body.startHour,
    endHour: body.endHour,
    timezone: body.timezone,
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
      if (op.value.length > 50) {
        throw new ValidationError('name must be 50 characters or fewer')
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

  const weekIndex = body.weekIndex === undefined ? null : body.weekIndex
  if (weekIndex !== null && (typeof weekIndex !== 'number' || !Number.isInteger(weekIndex) || weekIndex < 0)) {
    throw new ValidationError('weekIndex must be a non-negative integer or null')
  }

  const resetToPattern = body.resetToPattern === true
  if (resetToPattern && weekIndex === null) {
    throw new ValidationError('resetToPattern requires a non-null weekIndex')
  }

  if (body.cells !== undefined && !Array.isArray(body.cells)) {
    throw new ValidationError('cells must be an array')
  }
  const rawCells = (body.cells ?? []) as unknown[]
  const cells: AvailabilityCell[] = rawCells.map((cell) => {
    const c = cell as Record<string, unknown>
    if (
      typeof c.hourIndex !== 'number' ||
      !Number.isInteger(c.hourIndex) ||
      c.hourIndex < 0 ||
      typeof c.dayIndex !== 'number' ||
      !Number.isInteger(c.dayIndex) ||
      c.dayIndex < 0 ||
      typeof c.value !== 'boolean'
    ) {
      throw new ValidationError('each cell must have a non-negative integer hourIndex/dayIndex and boolean value')
    }
    return { hourIndex: c.hourIndex, dayIndex: c.dayIndex, value: c.value }
  })

  if (cells.length === 0 && !resetToPattern) {
    throw new ValidationError('cells must be non-empty unless resetToPattern is true')
  }

  return { weekIndex, cells, resetToPattern }
}
