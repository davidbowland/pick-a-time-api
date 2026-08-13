import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { getAvailability, getSession, getUser, updateAvailability } from '../services/dynamodb'
import { buildSlots } from '../services/slots'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { extractAuthContext } from '../utils/auth'
import { stripCalendarCheckedAt } from '../utils/availability'
import { parseAvailabilityPatch } from '../utils/events'
import { log, logError, redactEvent } from '../utils/logging'
import { assertSessionActive } from '../utils/sessions'
import status from '../utils/status'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', redactEvent(event))
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const userId = event.pathParameters?.userId as string

    const input = parseAvailabilityPatch(event)
    const { session } = await getSession(sessionId)
    assertSessionActive(session)

    const dateCount = session.dates.length
    const slots = buildSlots(session)
    for (const cell of input.cells) {
      if (cell.dateIndex >= dateCount || cell.slotIndex >= slots[cell.dateIndex].length) {
        throw new ValidationError(`cell is out of bounds for date ${cell.dateIndex}`)
      }
    }

    // Only the authenticated route (.../availability/authed) can reach this branch: the other one
    // is deployed with `Authorizer: NONE`, so its requests name no account and there is no mismatch
    // to find. That asymmetry is deliberate and is not a hole to be closed -- a poll link is the
    // only credential most voters have, and the anonymous route has to keep working for the same
    // person on a device where they never signed in.
    //
    // The read is inside the branch so an anonymous PATCH still costs exactly one item read.
    // Unlike patch-user, this does NOT link an unclaimed participant: painting is not the act of
    // saying who you are.
    const auth = extractAuthContext(event)
    if (auth.googleSub) {
      const user = await getUser(sessionId, userId)
      if (user.googleSub !== null && user.googleSub !== auth.googleSub) {
        throw new ForbiddenError('That person on this poll is signed in with a different Google account')
      }
    }

    const availability = await getAvailability(sessionId, userId)
    for (const cell of input.cells) {
      availability.free[cell.dateIndex][cell.slotIndex] = cell.value
    }

    await updateAvailability(sessionId, userId, availability)
    return { ...status.OK, body: JSON.stringify(stripCalendarCheckedAt(availability)) }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    if (error instanceof ForbiddenError)
      return { ...status.FORBIDDEN, body: JSON.stringify({ message: error.message }) }
    if (error instanceof ValidationError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
