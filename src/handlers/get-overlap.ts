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

    // Reading results never touches anybody's calendar. Busy time is already folded into stored
    // availability by the sync endpoint, so filtering again here would subtract a synced person
    // twice -- and a GET that rewrote people's hours as a side effect was never defensible.
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
