import { ConflictError, ErrorCode, NotFoundError, ValidationError } from '../errors'
import { advanceRound } from '../services/brackets'
import { getAllUsers, getSession, updateSession, updateUser } from '../services/dynamodb'
import { notifyNewRound, notifyWinner } from '../services/notifications'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, SessionRecord, UserRecord } from '../types'
import { serializeValidationError } from '../utils/errors'
import { parseCloseRoundInput } from '../utils/events'
import { log, logError } from '../utils/logging'
import status from '../utils/status'

const ensureVotesLength = (user: UserRecord, targetRounds: number): void => {
  while (user.votes.length < targetRounds) {
    user.votes.push([])
  }
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const { roundId } = parseCloseRoundInput(event)

    const { session, users: userIds, version } = await getSession(sessionId)

    if (session.expiration < Math.floor(Date.now() / 1000)) {
      throw new NotFoundError('Session not found')
    }

    if (!session.isReady) {
      throw new ValidationError('Session is not ready')
    }

    if (session.winner) {
      return { ...status.OK, body: JSON.stringify({ ...session, voterCount: userIds.length }) }
    }

    if (roundId < session.currentRound) {
      return { ...status.OK, body: JSON.stringify({ ...session, voterCount: userIds.length }) }
    }

    if (roundId !== session.currentRound) {
      throw new ValidationError(
        `roundId ${roundId} does not match current round ${session.currentRound}`,
        ErrorCode.ROUND_NOT_CURRENT,
      )
    }

    const users = await getAllUsers(sessionId)
    const { updatedFields, winner } = advanceRound(session, users)
    const advancedSession: SessionRecord = { ...session, ...updatedFields, votersSubmitted: 0 }

    if (winner) {
      advancedSession.winner = winner
    }

    const newVersion = await updateSession(sessionId, version, advancedSession)

    if (winner) {
      await notifyWinner(users, winner, sessionId, session.currentRound)
    } else if (updatedFields.currentRound !== undefined) {
      const newRound = updatedFields.currentRound
      for (const u of users) {
        ensureVotesLength(u, newRound + 1)
        await updateUser(sessionId, u.userId, u)
      }
      await notifyNewRound(users, newRound, sessionId)
    }

    return {
      ...status.OK,
      body: JSON.stringify({ ...advancedSession, voterCount: users.length, version: newVersion }),
    }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    if (error instanceof ValidationError) return { ...status.BAD_REQUEST, body: serializeValidationError(error) }
    if (error instanceof ConflictError) return { ...status.CONFLICT, body: JSON.stringify({ message: error.message }) }
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
