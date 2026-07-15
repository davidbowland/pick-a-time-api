import { NotFoundError, ValidationError } from '../errors'
import { getAvailability, getSession, updateAvailability } from '../services/dynamodb'
import { buildSlots } from '../services/slots'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { parseAvailabilityPatch } from '../utils/events'
import { log, logError } from '../utils/logging'
import { assertSessionActive } from '../utils/sessions'
import status from '../utils/status'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const userId = event.pathParameters?.userId as string

    const input = parseAvailabilityPatch(event)
    const { session } = await getSession(sessionId)
    assertSessionActive(session)

    const dateCount = session.dates.length
    const slotCount = buildSlots(session).length
    for (const cell of input.cells) {
      if (cell.dateIndex >= dateCount || cell.slotIndex >= slotCount) {
        throw new ValidationError(`cell is out of bounds for a ${dateCount}x${slotCount} grid`)
      }
    }

    const availability = await getAvailability(sessionId, userId)
    for (const cell of input.cells) {
      availability.free[cell.dateIndex][cell.slotIndex] = cell.value
    }

    await updateAvailability(sessionId, userId, availability)
    return { ...status.OK, body: JSON.stringify(availability) }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    if (error instanceof ValidationError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
