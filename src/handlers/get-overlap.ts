import { NotFoundError } from '../errors'
import { getAllAvailability, getSession } from '../services/dynamodb'
import { computeGrid, findRecommendedMeetings, pickBestSlot } from '../services/overlap'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { log, logError, redactEvent } from '../utils/logging'
import { assertSessionActive } from '../utils/sessions'
import status from '../utils/status'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', redactEvent(event))
  try {
    const sessionId = event.pathParameters?.sessionId as string

    const { session } = await getSession(sessionId)
    assertSessionActive(session)

    const availability = await getAllAvailability(sessionId)

    // Reading results never touches anybody's calendar, and no calendar has ever touched the stored
    // availability being read: busy time is a presentational layer served only to its owner by the
    // authenticated availability route (ADR-1, ADR-2). Subtracting it here would make it
    // un-overridable -- a hour painted free would be removed again on every read -- and would
    // publish per-person calendar occupancy to every holder of the poll link, which is exactly what
    // this route must not do. Stored `free` is the whole input.
    const { cells } = computeGrid(session, availability)
    const recommendedMeetings = findRecommendedMeetings(session, availability, 3)
    const grid = { cells, bestSlot: pickBestSlot(recommendedMeetings) }

    return { ...status.OK, body: JSON.stringify({ grid, recommendedMeetings }) }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
