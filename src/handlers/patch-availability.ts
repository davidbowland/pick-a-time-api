import { NotFoundError, ValidationError } from '../errors'
import { getAvailability, getSession, updateAvailability } from '../services/dynamodb'
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

    const hourCount = session.endHour - session.startHour
    const dayCount = session.weekdays.length

    if (input.weekIndex !== null && input.weekIndex >= session.weekCount) {
      throw new ValidationError(`weekIndex must be less than weekCount (${session.weekCount})`)
    }
    for (const cell of input.cells) {
      if (cell.hourIndex >= hourCount || cell.dayIndex >= dayCount) {
        throw new ValidationError(`cell is out of bounds for a ${hourCount}x${dayCount} grid`)
      }
    }

    const availability = await getAvailability(sessionId, userId)

    if (input.resetToPattern && input.weekIndex !== null) {
      delete availability.overrides[input.weekIndex]
    }

    if (input.cells.length > 0) {
      if (input.weekIndex === null) {
        for (const cell of input.cells) {
          availability.template[cell.hourIndex][cell.dayIndex] = cell.value
        }
      } else {
        if (!availability.overrides[input.weekIndex]) {
          availability.overrides[input.weekIndex] = availability.template.map((row) => row.slice())
        }
        for (const cell of input.cells) {
          availability.overrides[input.weekIndex][cell.hourIndex][cell.dayIndex] = cell.value
        }
      }
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
