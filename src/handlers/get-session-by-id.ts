import { NotFoundError } from '../errors'
import { getSession } from '../services/dynamodb'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { log, logError } from '../utils/logging'
import status from '../utils/status'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const { session, users } = await getSession(sessionId)

    if (session.expiration < Math.floor(Date.now() / 1000)) {
      return status.NOT_FOUND
    }

    return {
      ...status.OK,
      body: JSON.stringify({
        ...session,
        filterClosingSoon: session.filterClosingSoon === true,
        sessionId,
        voterCount: users.length,
      }),
    }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
