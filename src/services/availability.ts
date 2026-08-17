import { AvailabilityRecord, PollRecord } from '../types'
import { assertSessionActive } from '../utils/sessions'
import { getAvailability, getSession } from './dynamodb'

export interface AvailabilityRead {
  availability: AvailabilityRecord
  session: PollRecord
}

// The poll comes back with the record because the authenticated caller needs both -- the open
// handler discards it -- and reading it twice would
// let the two reads disagree -- one arm seeing an active poll, the other an expired one.
//
// Records only. This read is what the unauthenticated GET /availability serves, so it must have no
// path to Google: a refresh here would take measurably longer for a participant with a connected
// calendar than for one without, and the open route would answer "who linked an account?" by timing
// alone -- the disclosure stripCalendarCheckedAt exists to prevent. Anything calendar-derived is
// computed by the authenticated route from what it reads itself.
//
// The record is returned exactly as stored, calendarCheckedAt included: what a given caller may see
// is that caller's decision, and the two routes decide differently.
export const readAvailabilityRecord = async (sessionId: string, userId: string): Promise<AvailabilityRead> => {
  const { session } = await getSession(sessionId)
  assertSessionActive(session)

  const availability = await getAvailability(sessionId, userId)
  return { availability, session }
}
