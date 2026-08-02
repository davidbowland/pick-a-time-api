import { AvailabilityRecord } from '../types'

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
