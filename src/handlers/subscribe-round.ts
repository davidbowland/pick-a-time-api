import { NotFoundError, ValidationError } from '../errors'
import { getSession, getUser, updateUser } from '../services/dynamodb'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { parseSubscribeBody } from '../utils/events'
import { log, logError } from '../utils/logging'
import status from '../utils/status'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const roundIdStr = event.pathParameters?.roundId
    const roundId = Number(roundIdStr)

    if (roundIdStr === undefined || isNaN(roundId) || !Number.isInteger(roundId) || roundId < 0) {
      throw new ValidationError('roundId path parameter must be a non-negative integer')
    }

    const { userId } = parseSubscribeBody(event)

    const { session } = await getSession(sessionId)
    if (session.expiration < Math.floor(Date.now() / 1000)) {
      throw new NotFoundError('Session not found')
    }

    const user = await getUser(sessionId, userId)

    if (!user.phone) {
      throw new ValidationError('User must have a phone number set to subscribe to notifications')
    }

    if (!user.subscribedRounds.includes(roundId)) {
      user.subscribedRounds.push(roundId)
      await updateUser(sessionId, userId, user)
    }

    return { ...status.OK, body: JSON.stringify(user) }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    if (error instanceof ValidationError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
