import { NotFoundError } from '../errors'
import { getAllUsers, getSession } from '../services/dynamodb'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { log, logError, redactEvent } from '../utils/logging'
import status from '../utils/status'
import { stripGoogleSub } from '../utils/users'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', redactEvent(event))
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const sessionRecord = await getSession(sessionId)

    if (sessionRecord.session.expiration < Math.floor(Date.now() / 1000)) {
      return status.NOT_FOUND
    }

    // This endpoint is unauthenticated, so it cannot scope its answer to the person asking.
    // Reporting each participant's calendar connection state told every participant something
    // about every other one that none of them needs to know.
    const users = await getAllUsers(sessionId)

    return { ...status.OK, body: JSON.stringify(users.map(stripGoogleSub)) }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
