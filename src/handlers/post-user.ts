import { maxUsersPerSession } from '../config'
import { MaxUsersError, NotFoundError } from '../errors'
import { createUser, getSession } from '../services/dynamodb'
import { emptyGrid } from '../services/occurrences'
import { AvailabilityRecord, APIGatewayProxyEventV2, APIGatewayProxyResultV2, UserRecord } from '../types'
import { extractAuthContext } from '../utils/auth'
import { PHONE_REGEX } from '../utils/events'
import { generateUserId } from '../utils/id-generator'
import { log, logError } from '../utils/logging'
import { assertSessionActive } from '../utils/sessions'
import status from '../utils/status'
import { stripGoogleSub } from '../utils/users'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const { session, users } = await getSession(sessionId)
    assertSessionActive(session)

    if (users.length >= maxUsersPerSession) {
      throw new MaxUsersError(`Session has reached the maximum of ${maxUsersPerSession} users`)
    }

    const userId = generateUserId(users)
    const auth = extractAuthContext(event)
    const phone = auth.googlePhone && PHONE_REGEX.test(auth.googlePhone) ? auth.googlePhone : null

    const user: UserRecord = {
      expiration: session.expiration,
      googleSub: auth.googleSub,
      name: auth.googleName ?? null,
      phone,
      textsSent: 0,
      userId,
    }

    const availability: AvailabilityRecord = {
      expiration: session.expiration,
      overrides: {},
      template: emptyGrid(session.endHour - session.startHour, session.weekdays.length),
      userId,
    }

    await createUser(sessionId, user, availability)
    log('User created', { sessionId, userId })

    return { ...status.CREATED, body: JSON.stringify(stripGoogleSub(user)) }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    if (error instanceof MaxUsersError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
