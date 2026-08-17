import { ValidationError } from '../errors'
import { deleteCalendarAccount, getCalendarAccount } from '../services/dynamodb'
import { revokeToken } from '../services/google-calendar'
import { decryptRefreshToken } from '../services/kms'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { extractAuthContext } from '../utils/auth'
import { log, logError, logWarn, redactEvent, sanitizeErrorForLogging } from '../utils/logging'
import status from '../utils/status'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', redactEvent(event))
  try {
    // No session or user in scope: a calendar connection belongs to a Google account, and revoking
    // it affects every poll. Requiring a poll in the path implied otherwise, and left someone whose
    // polls had all expired with no address to call.
    const auth = extractAuthContext(event)
    if (!auth.isAuthenticated || !auth.googleSub) {
      throw new ValidationError('Google sign-in is required to disconnect a calendar')
    }

    const record = await getCalendarAccount(auth.googleSub)
    if (record) {
      const refreshToken = await decryptRefreshToken(record.refreshTokenEncrypted).catch(() => null)
      if (refreshToken) {
        // WARN, not ERROR: the alert mailer is wired to `level="ERROR"` (see the log subscription
        // filters in template.yaml), and the commonest reason this call fails is the least alarming
        // one -- the grant is already gone, which is exactly the state a record stamped 'revoked' is
        // in, and Google answers 400 for a token it has already forgotten. Disconnecting an
        // already-dead calendar is a success, not an incident, and the delete below runs either way,
        // so nothing is left behind for anyone to act on.
        await revokeToken(refreshToken).catch((error) =>
          logWarn('Could not revoke the token at Google; deleting the local record anyway', {
            error: sanitizeErrorForLogging(error),
            recordStatus: record.status,
          }),
        )
      }
      await deleteCalendarAccount(auth.googleSub)
    }

    return status.NO_CONTENT
  } catch (error) {
    if (error instanceof ValidationError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
