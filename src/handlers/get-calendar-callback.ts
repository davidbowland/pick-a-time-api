import { googleCalendarRedirectUri, webAppUrl } from '../config'
import { putCalendarAccount } from '../services/dynamodb'
import { exchangeCodeForTokens } from '../services/google-calendar'
import { encryptRefreshToken } from '../services/kms'
import { verifyCalendarState } from '../services/oauth-state'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, CalendarAccountRecord } from '../types'
import { log, logError, sanitizeErrorForLogging } from '../utils/logging'

const CALENDAR_ACCOUNT_TTL_SECONDS = 90 * 24 * 3600 // refreshed on every successful sync
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy'

const redirectTo = (status: 'connected' | 'declined' | 'error'): APIGatewayProxyResultV2 => ({
  headers: { Location: `${webAppUrl}/calendar-connected?status=${status}` },
  statusCode: 302,
})

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const query = event.queryStringParameters ?? {}
  const redactedQuery = {
    ...query,
    ...(query.code ? { code: '[REDACTED]' } : {}),
    ...(query.state ? { state: '[REDACTED]' } : {}),
  }
  log('Received event', { ...event, body: undefined, queryStringParameters: redactedQuery })

  if (query.error) {
    return redirectTo('declined')
  }
  if (!query.code || !query.state) {
    return redirectTo('error')
  }

  try {
    const googleSub = await verifyCalendarState(query.state)
    const tokens = await exchangeCodeForTokens(query.code, googleCalendarRedirectUri)
    const refreshTokenEncrypted = await encryptRefreshToken(tokens.refreshToken)

    const record: CalendarAccountRecord = {
      busyIntervals: [],
      expiration: Math.floor(Date.now() / 1000) + CALENDAR_ACCOUNT_TTL_SECONDS,
      googleSub,
      lastSyncedAt: 0,
      refreshTokenEncrypted,
      scope: CALENDAR_SCOPE,
      status: 'connected',
      syncedRange: null,
    }
    await putCalendarAccount(record)

    return redirectTo('connected')
  } catch (error) {
    logError(sanitizeErrorForLogging(error))
    return redirectTo('error')
  }
}
