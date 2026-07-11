export { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Callback, Context } from 'aws-lambda'

export interface PatchOperation {
  op: 'replace' | 'add' | 'test'
  path: string
  value?: unknown
}

// DynamoDB record types — single-table design

export interface PlanRecord {
  sessionId: string
  name: string
  weekdays: number[] // 0=Sun..6=Sat, in display column order, e.g. [4,5,6] for Thu/Fri/Sat
  startDate: string // ISO date "YYYY-MM-DD" — must fall on weekdays[0]
  weekCount: number
  startHour: number // 0-23
  endHour: number // 1-24, exclusive upper bound, > startHour
  timezone: string // IANA name, e.g. "America/Chicago"
  expiration: number
}

export interface SessionWithUsers {
  session: PlanRecord
  users: string[]
}

export interface UserRecord {
  userId: string
  googleSub: string | null
  name: string | null
  phone: string | null
  textsSent: number
  expiration: number
}

export interface AvailabilityRecord {
  userId: string
  template: boolean[][] // [hourIndex][dayIndex], sized (endHour-startHour) x weekdays.length
  overrides: Record<number, boolean[][]> // sparse, keyed by weekIndex (0-based)
  expiration: number
}

// Input types

export interface NewPlanInput {
  name: string
  weekdays: number[]
  startDate: string
  weekCount: number
  startHour: number
  endHour: number
  timezone: string
}

export interface ShareInput {
  phone: string
  type: 'text'
}

export interface AvailabilityCell {
  hourIndex: number
  dayIndex: number
  value: boolean
}

export interface AvailabilityPatchInput {
  weekIndex: number | null // null = editing the template; 0-based otherwise
  cells: AvailabilityCell[]
  resetToPattern: boolean
}

// Auth

export interface AuthContext {
  isAuthenticated: boolean
  googleSub: string | null
  googleName?: string
  googlePhone?: string
}

// SMS

export type MessageType = 'PROMOTIONAL' | 'TRANSACTIONAL'

export interface SMSMessage {
  to: string
  contents: string
  messageType?: MessageType
}
