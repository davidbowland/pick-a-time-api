import { NotFoundError, ValidationError } from '../errors'
import { deleteCalendarAccount, getCalendarAccount, getSession, getUser } from '../services/dynamodb'
import { revokeToken } from '../services/google-calendar'
import { decryptRefreshToken } from '../services/kms'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { extractAuthContext } from '../utils/auth'
import { log, logError, sanitizeErrorForLogging } from '../utils/logging'
import { assertSessionActive } from '../utils/sessions'
import status from '../utils/status'

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
      throw new ValidationError('Google sign-in is required to disconnect a calendar')
    }

    const record = await getCalendarAccount(auth.googleSub)
    if (record) {
      const refreshToken = await decryptRefreshToken(record.refreshTokenEncrypted).catch(() => null)
      if (refreshToken) {
        await revokeToken(refreshToken).catch((error) =>
          logError('Failed to revoke token at Google', sanitizeErrorForLogging(error)),
        )
      }
      await deleteCalendarAccount(auth.googleSub)
    }

    return status.NO_CONTENT
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    if (error instanceof ValidationError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
