import { googleCalendarRedirectUri } from '../config'
import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { getCalendarAccount, getSession, getUser } from '../services/dynamodb'
import { signCalendarState } from '../services/oauth-state'
import { getGoogleCalendarClientId } from '../services/secrets'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { extractAuthContext } from '../utils/auth'
import { log, logError, redactEvent } from '../utils/logging'
import { assertSessionActive } from '../utils/sessions'
import status from '../utils/status'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', redactEvent(event))
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const userId = event.pathParameters?.userId as string
    const { session } = await getSession(sessionId)
    assertSessionActive(session)
    const user = await getUser(sessionId, userId)

    const auth = extractAuthContext(event)
    if (!auth.isAuthenticated || !auth.googleSub) {
      throw new ValidationError('Google sign-in is required to connect a calendar')
    }

    // This route only ever touches account-keyed data -- the connection belongs to auth.googleSub,
    // never to {userId} -- so naming someone else's participant id gains nothing today. The check
    // is here anyway: the sibling sync route had the same gap and it was exploitable there, and
    // nothing but this line stops a future edit from reading or writing the named participant.
    // A null googleSub is not a match; see the note in post-calendar-sync.
    if (user.googleSub !== auth.googleSub) {
      throw new ForbiddenError('You can only connect your own calendar')
    }

    const existing = await getCalendarAccount(auth.googleSub)
    if (existing?.status === 'connected') {
      return { ...status.OK, body: JSON.stringify({ alreadyConnected: true }) }
    }

    const [clientId, state] = await Promise.all([getGoogleCalendarClientId(), signCalendarState(auth.googleSub)])
    const authUrl = `${GOOGLE_AUTH_URL}?${new URLSearchParams({
      access_type: 'offline',
      client_id: clientId,
      prompt: 'consent',
      redirect_uri: googleCalendarRedirectUri,
      response_type: 'code',
      scope: CALENDAR_SCOPE,
      state,
    }).toString()}`

    return { ...status.OK, body: JSON.stringify({ alreadyConnected: false, authUrl }) }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    if (error instanceof ForbiddenError)
      return { ...status.FORBIDDEN, body: JSON.stringify({ message: error.message }) }
    if (error instanceof ValidationError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
