import { ValidationError } from '../errors'
import { getCalendarAccount } from '../services/dynamodb'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { extractAuthContext } from '../utils/auth'
import { log, logError, redactEvent } from '../utils/logging'
import status from '../utils/status'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', redactEvent(event))
  try {
    // No session or user in scope: a calendar connection belongs to a Google account, not to a
    // poll, so the JWT alone says whose state this is.
    const auth = extractAuthContext(event)
    if (!auth.isAuthenticated || !auth.googleSub) {
      throw new ValidationError('Google sign-in is required to read calendar state')
    }

    const record = await getCalendarAccount(auth.googleSub)

    return {
      ...status.OK,
      body: JSON.stringify({
        lastSyncedAt: record?.lastSyncedAt ?? null,
        status: record?.status ?? 'not_connected',
      }),
    }
  } catch (error) {
    if (error instanceof ValidationError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
