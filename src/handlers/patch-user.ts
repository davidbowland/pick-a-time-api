import { NotFoundError, ValidationError } from '../errors'
import { getSession, getUser, updateUser } from '../services/dynamodb'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, PatchOperation, UserRecord } from '../types'
import { extractAuthContext } from '../utils/auth'
import { parseUserPatch } from '../utils/events'
import { log, logError } from '../utils/logging'
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
  log('Received event', { ...event, body: undefined })
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const userId = event.pathParameters?.userId as string

    const ops = parseUserPatch(event)

    const { session } = await getSession(sessionId)
    assertSessionActive(session)

    const user = await getUser(sessionId, userId)
    const updatedUser = applyUserPatch(user, ops)

    const auth = extractAuthContext(event)
    if (updatedUser.googleSub === null && auth.googleSub) {
      updatedUser.googleSub = auth.googleSub
    }

    await updateUser(sessionId, userId, updatedUser)

    return { ...status.OK, body: JSON.stringify(stripGoogleSub(updatedUser)) }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    if (error instanceof ValidationError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
