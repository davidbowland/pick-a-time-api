import { maxUsersPerSession } from '../config'
import { MaxUsersError, NotFoundError, ValidationError } from '../errors'
import { createUser, getSession } from '../services/dynamodb'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, UserRecord } from '../types'
import { extractAuthContext } from '../utils/auth'
import { generateUserId } from '../utils/id-generator'
import { log, logError } from '../utils/logging'
import status from '../utils/status'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const { session, users } = await getSession(sessionId)

    if (session.expiration < Math.floor(Date.now() / 1000)) {
      throw new NotFoundError('Session not found')
    }

    if (users.length >= maxUsersPerSession) {
      throw new MaxUsersError(`Session has reached the maximum of ${maxUsersPerSession} users`)
    }

    const userId = generateUserId(users)
    const auth = extractAuthContext(event)

    const phone = auth.googlePhone && /^\+1[2-9]\d{9}$/.test(auth.googlePhone) ? auth.googlePhone : null

    const user: UserRecord = {
      expiration: session.expiration,
      googleSub: auth.googleSub,
      name: auth.googleName ?? null,
      phone,
      subscribedRounds: [],
      textsSent: 0,
      userId,
      votes: Array.from({ length: session.currentRound + 1 }, () => []),
    }

    await createUser(sessionId, user)
    log('User created', { sessionId, userId })

    const { googleSub: _, ...responseUser } = user
    return {
      ...status.CREATED,
      body: JSON.stringify(responseUser),
    }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    if (error instanceof MaxUsersError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    if (error instanceof ValidationError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    // ConflictError from createUser means a DB-level user ID collision — server's fault, not the client's
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
