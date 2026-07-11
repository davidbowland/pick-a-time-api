import { NotFoundError } from '../errors'
import { getAvailability, getSession } from '../services/dynamodb'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { log, logError } from '../utils/logging'
import { assertSessionActive } from '../utils/sessions'
import status from '../utils/status'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const userId = event.pathParameters?.userId as string

    const { session } = await getSession(sessionId)
    assertSessionActive(session)

    const availability = await getAvailability(sessionId, userId)
    return { ...status.OK, body: JSON.stringify(availability) }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
