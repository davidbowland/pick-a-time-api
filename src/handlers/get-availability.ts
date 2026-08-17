import { NotFoundError } from '../errors'
import { readAvailabilityRecord } from '../services/availability'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { stripCalendarCheckedAt } from '../utils/availability'
import { log, logError, redactEvent } from '../utils/logging'
import status from '../utils/status'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', redactEvent(event))
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const userId = event.pathParameters?.userId as string

    const { availability } = await readAvailabilityRecord(sessionId, userId)
    return { ...status.OK, body: JSON.stringify(stripCalendarCheckedAt(availability)) }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
