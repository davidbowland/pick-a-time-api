import { AvailabilityRecord, CalendarStatus, DateWindow, OwnerAvailabilityResponse } from '../types'

// GET and PATCH /availability are unauthenticated and take the participant as a path parameter, so
// anyone holding the poll link can read any participant's record. calendarCheckedAt is non-null
// only for someone who ran a calendar check, which requires a connected Google calendar -- echoing
// it would tell every participant which of the others connected one. The stored record keeps the
// field; only these two responses omit it.
export const stripCalendarCheckedAt = (
  availability: AvailabilityRecord,
): Omit<AvailabilityRecord, 'calendarCheckedAt'> => {
  const { calendarCheckedAt: _, ...rest } = availability
  return rest
}

// Everything a caller is told about their own calendar, computed by the authenticated route and
// carried as one unit so the three values can never be assembled from different reads.
export interface CalendarView {
  busy: boolean[][]
  calendarStatus: CalendarStatus
  busyWindow: DateWindow | null
}

// The owner-only serializer. It is additive over stripCalendarCheckedAt rather than a variant of it,
// so the open route's serializer above stays exactly what it was and has no path to busy data --
// AC-005 and AC-006 hold because this function is never reachable from the open handler, not because
// a conditional inside a shared one happens to be written correctly (ADR-1).
export const toOwnerAvailabilityResponse = (
  availability: AvailabilityRecord,
  calendar: CalendarView,
): OwnerAvailabilityResponse => ({ ...stripCalendarCheckedAt(availability), ...calendar })
