import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { getSession, getUser, updateUser } from '../services/dynamodb'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, PatchOperation, UserRecord } from '../types'
import { extractAuthContext } from '../utils/auth'
import { parseUserPatch } from '../utils/events'
import { log, logError, redactEvent } from '../utils/logging'
import { assertSessionActive } from '../utils/sessions'
import status from '../utils/status'
import { stripGoogleSub } from '../utils/users'

const applyUserPatch = (user: UserRecord, ops: PatchOperation[]): UserRecord => {
  const updated = { ...user }
  for (const op of ops) {
    if (op.path === '/name') updated.name = op.value as string
  }
  return updated
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', redactEvent(event))
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const userId = event.pathParameters?.userId as string

    const ops = parseUserPatch(event)

    const { session } = await getSession(sessionId)
    assertSessionActive(session)

    const user = await getUser(sessionId, userId)
    const updatedUser = applyUserPatch(user, ops)

    const auth = extractAuthContext(event)
    // Three cases, and only one of them is refused.
    //
    // Signed in, participant unclaimed -- this is how a participant gets linked at all. Somebody who
    // joins before signing in has no account on their record, and nothing else ever attaches one.
    //
    // Signed in, participant linked to somebody else -- refused. Not as an access control (the
    // unauthenticated route below patches anybody, by design: a poll link is the only credential a
    // voter has), but so the caller is told the truth. The UI cannot see googleSub -- stripGoogleSub
    // removes it -- so this 403 is the only way it can learn that the person it is voting as belongs
    // to another account, which is exactly what the calendar routes refuse it for.
    //
    // Not signed in -- allowed against any participant, linked or not. An unauthenticated request
    // names no account, so there is no mismatch to find, and refusing it would lock somebody out of
    // their own name on a device where they have not signed in.
    if (auth.googleSub && updatedUser.googleSub !== null && updatedUser.googleSub !== auth.googleSub) {
      throw new ForbiddenError('That person on this poll is signed in with a different Google account')
    }
    if (updatedUser.googleSub === null && auth.googleSub) {
      updatedUser.googleSub = auth.googleSub
    }

    await updateUser(sessionId, userId, updatedUser)

    return { ...status.OK, body: JSON.stringify(stripGoogleSub(updatedUser)) }
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
