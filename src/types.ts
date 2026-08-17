export {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  APIGatewayProxyStructuredResultV2,
  Callback,
  Context,
} from 'aws-lambda'

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
  // Epoch seconds of the last calendar check in THIS poll, or null if there has never been one.
  // Deliberately not provenance: it records that a check ran, never which hours it touched, so
  // nothing derived from it can distinguish a calendar-marked hour from a hand-unmarked one.
  calendarCheckedAt: number | null
  expiration: number
}

export interface DateWindow {
  start: string // ISO "YYYY-MM-DD", inclusive
  end: string // ISO "YYYY-MM-DD", inclusive
}

export interface CalendarAccountRecord {
  googleSub: string
  refreshTokenEncrypted: string // KMS-encrypted, base64
  scope: string
  status: 'connected' | 'error'
  lastSyncedAt: number
  syncedRange: DateWindow | null // ISO dates covered by busyIntervals
  busyIntervals: { start: string; end: string }[] // raw UTC instants from Google's freebusy response
  expiration: number
}

// What the client is told about the calendar behind a busy grid. Three states, not two, and the
// distinction is load-bearing: an errored connection and a connected calendar with nothing booked
// both produce an all-false grid, so without this the client cannot tell "we could not reach your
// calendar" from "your calendar is clear" -- and those get opposite copy (AC-030, AC-034, AC-042).
export type CalendarStatus = 'connected' | 'error' | 'not_connected'

// The owner-only availability response. `free` and `busy` share their dimensions by construction:
// both are built from the same PollRecord in the same request, which is why they are served from
// one route rather than two (ADR-1).
export interface OwnerAvailabilityResponse {
  userId: string
  free: boolean[][]
  expiration: number
  busy: boolean[][] // [dateIndex][slotIndex]; all false whenever calendarStatus is not 'connected'
  calendarStatus: CalendarStatus
  // The date range the calendar was actually read over -- the cached record's syncedRange, never the
  // poll's own dates. A poll outside the retention window comes back 'connected' with a window that
  // does not reach it, and naming the poll's dates here would claim a coverage that was never fetched.
  busyWindow: DateWindow | null
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
