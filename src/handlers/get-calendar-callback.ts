import { CALENDAR_ACCOUNT_TTL_SECONDS, googleCalendarRedirectUri, webAppUrl } from '../config'
import { putCalendarAccount } from '../services/dynamodb'
import { exchangeCodeForTokens } from '../services/google-calendar'
import { encryptRefreshToken } from '../services/kms'
import { verifyCalendarState } from '../services/oauth-state'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, CalendarAccountRecord } from '../types'
import { log, logError, redactEvent, sanitizeErrorForLogging } from '../utils/logging'

// CALENDAR_ACCOUNT_TTL_SECONDS used to live here, module-private, with a comment claiming it was
// "refreshed on every successful sync" -- it was not, and the published privacy policy repeats the
// claim. calendar-sync.ts now re-stamps expiration on every successful check, which makes the claim
// true, and the constant moved to config.ts so the connect path and the check path cannot disagree
// about the number the policy publishes.
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy'

const redirectTo = (status: 'connected' | 'declined' | 'error'): APIGatewayProxyResultV2 => ({
  headers: { Location: `${webAppUrl}/calendar-connected?status=${status}` },
  statusCode: 302,
})

export const getCalendarCallback = async (
  event: APIGatewayProxyEventV2,
  now: () => number = Date.now,
): Promise<APIGatewayProxyResultV2> => {
  const query = event.queryStringParameters ?? {}
  log('Received event', redactEvent(event))

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
      expiration: Math.floor(now() / 1000) + CALENDAR_ACCOUNT_TTL_SECONDS,
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

// Lambda calls the exported handler as handler(event, context), so the injected clock cannot be the
// second parameter of the thing template.yaml points at -- Context is not callable, and now() would
// throw "now is not a function" on every real request. The wrapper keeps the injection point one
// level in, where only tests reach it. Same shape as post-calendar-sync.ts.
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
  getCalendarCallback(event)
