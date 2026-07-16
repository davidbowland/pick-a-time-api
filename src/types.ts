export { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Callback, Context } from 'aws-lambda'

export interface PatchOperation {
  op: 'replace' | 'add' | 'test'
  path: string
  value?: unknown
}

// DynamoDB record types — single-table design

export interface DatesOnlyPoll {
  usesTimes: false
}

export interface TimedPoll {
  usesTimes: true
  startMinute: number // minutes since local midnight; multiple of 15; 0-1425
  endMinute: number // minutes since local midnight; multiple of 15; > startMinute, <= 1440
  slotMinutes: 15 | 30 | 60 | 90 | 120
  overrides?: {
    dates: string[] // non-empty subset of the poll's own `dates`; no date appears in more than one group
    startMinute: number
    endMinute: number
  }[]
}

export type PollRecord = (DatesOnlyPoll | TimedPoll) & {
  sessionId: string
  name: string
  dates: string[] // ISO "YYYY-MM-DD", sorted ascending, deduplicated, 1..maxPollDates entries; not in the past, less than a year out (both checked against the poll's timezone)
  timezone: string // IANA name, e.g. "America/Chicago"
  expiration: number
}

export interface SessionWithUsers {
  session: PollRecord
  users: string[]
}

export interface UserRecord {
  userId: string
  googleSub: string | null
  name: string | null
  expiration: number
}

export interface AvailabilityRecord {
  userId: string
  free: boolean[][] // [dateIndex][slotIndex]; slotIndex always 0 when the poll's usesTimes is false
  expiration: number
}

export interface CalendarAccountRecord {
  googleSub: string
  refreshTokenEncrypted: string // KMS-encrypted, base64
  scope: string
  status: 'connected' | 'error'
  lastSyncedAt: number
  syncedRange: { start: string; end: string } | null // ISO dates covered by busyIntervals
  busyIntervals: { start: string; end: string }[] // raw UTC instants from Google's freebusy response
  expiration: number
}

// Input types

export type NewPollInput = (DatesOnlyPoll | TimedPoll) & {
  name: string
  dates: string[]
  timezone: string
}

export interface AvailabilityCell {
  dateIndex: number
  slotIndex: number // always 0 when the poll's usesTimes is false
  value: boolean
}

export interface AvailabilityPatchInput {
  cells: AvailabilityCell[]
}

// Auth

export interface AuthContext {
  isAuthenticated: boolean
  googleSub: string | null
  googleName?: string
}
