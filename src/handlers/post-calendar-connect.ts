import { googleCalendarRedirectUri } from '../config'
import { NotFoundError, ValidationError } from '../errors'
import { getCalendarAccount, getSession, getUser } from '../services/dynamodb'
import { signCalendarState } from '../services/oauth-state'
import { getGoogleCalendarClientId } from '../services/secrets'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { extractAuthContext } from '../utils/auth'
import { log, logError } from '../utils/logging'
import { assertSessionActive } from '../utils/sessions'
import status from '../utils/status'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const userId = event.pathParameters?.userId as string
    const { session } = await getSession(sessionId)
    assertSessionActive(session)
    await getUser(sessionId, userId)

    const auth = extractAuthContext(event)
    if (!auth.isAuthenticated || !auth.googleSub) {
      throw new ValidationError('Google sign-in is required to connect a calendar')
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
    if (error instanceof ValidationError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
