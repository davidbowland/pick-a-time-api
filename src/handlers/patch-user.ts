import { JsonPatchError, applyPatch as applyJsonPatch, deepClone } from 'fast-json-patch'

import { ConflictError, ErrorCode, NotFoundError, ValidationError } from '../errors'
import { advanceRound, countVotersSubmitted, shouldAutoAdvance } from '../services/brackets'
import { getAllUsers, getSession, getUser, updateSession, updateUser } from '../services/dynamodb'
import { notifyNewRound, notifyWinner } from '../services/notifications'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, PatchOperation, SessionRecord, UserRecord } from '../types'
import { extractAuthContext } from '../utils/auth'
import { serializeValidationError } from '../utils/errors'
import { parseUserPatch } from '../utils/events'
import { log, logError } from '../utils/logging'
import status from '../utils/status'

const VOTES_PATH_REGEX = /^\/votes\/(\d+)\/(\d+)$/

const validateVotes = (ops: PatchOperation[], session: SessionRecord): void => {
  for (const op of ops) {
    const match = op.path.match(VOTES_PATH_REGEX)
    if (!match) continue

    const round = parseInt(match[1], 10)
    const matchupIndex = parseInt(match[2], 10)

    if (round !== session.currentRound) {
      throw new ValidationError(
        `Can only vote in the current round (${session.currentRound})`,
        ErrorCode.ROUND_NOT_CURRENT,
      )
    }

    const matchup = session.bracket[round]?.[matchupIndex]
    if (!matchup) {
      throw new ValidationError(`Invalid matchup index ${matchupIndex} for round ${round}`)
    }

    if ('value' in op) {
      const choiceId = op.value as string
      if (choiceId !== matchup[0] && choiceId !== matchup[1]) {
        throw new ValidationError(`Choice ${choiceId} is not in matchup [${matchup[0]}, ${matchup[1]}]`)
      }
    }
  }
}

const ensureVotesArraySize = (user: UserRecord, session: SessionRecord): void => {
  // Grow votes array so fast-json-patch can write to /votes/{round}/{matchup}
  while (user.votes.length < session.currentRound + 1) {
    user.votes.push([])
  }
  const matchupCount = session.bracket[session.currentRound]?.length ?? 0
  const currentRoundVotes = user.votes[session.currentRound]
  while (currentRoundVotes.length < matchupCount) {
    currentRoundVotes.push(null)
  }
}

const ensureVotesLength = (user: UserRecord, targetRounds: number): void => {
  while (user.votes.length < targetRounds) {
    user.votes.push([])
  }
}

const hasVoteOps = (ops: PatchOperation[]): boolean => ops.some((op) => VOTES_PATH_REGEX.test(op.path))

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const userId = event.pathParameters?.userId as string

    const ops = parseUserPatch(event)
    const { session, version } = await getSession(sessionId)
    const user = await getUser(sessionId, userId)

    validateVotes(ops, session)

    const cloned = deepClone(user) as UserRecord
    ensureVotesArraySize(cloned, session)
    const patchResult = applyJsonPatch(cloned, ops, true, false)
    const updatedUser = patchResult.newDocument as UserRecord

    // If the name is still null after applying patch ops and the caller is authenticated,
    // default from their Google account (graceful degradation for mid-session sign-in)
    const auth = extractAuthContext(event)
    if (updatedUser.name === null && auth.googleName) {
      updatedUser.name = auth.googleName
    }
    if (updatedUser.googleSub === null && auth.googleSub) {
      updatedUser.googleSub = auth.googleSub
    }

    await updateUser(sessionId, userId, updatedUser)

    if (hasVoteOps(ops)) {
      const allUsers = await getAllUsers(sessionId)
      const currentUserIndex = allUsers.findIndex((u) => u.userId === userId)
      if (currentUserIndex >= 0) {
        allUsers[currentUserIndex] = updatedUser
      }

      const votersSubmitted = countVotersSubmitted(session, allUsers)

      if (shouldAutoAdvance(votersSubmitted, allUsers.length)) {
        const { updatedFields, winner } = advanceRound(session, allUsers)
        const advancedSession: SessionRecord = { ...session, ...updatedFields, votersSubmitted: 0 }

        if (winner) {
          advancedSession.winner = winner
        }

        try {
          await updateSession(sessionId, version, advancedSession)

          if (winner) {
            await notifyWinner(allUsers, winner, sessionId, session.currentRound)
          } else if (updatedFields.currentRound !== undefined) {
            const newRound = updatedFields.currentRound
            for (const u of allUsers) {
              ensureVotesLength(u, newRound + 1)
              await updateUser(sessionId, u.userId, u)
            }
            await notifyNewRound(allUsers, newRound, sessionId)
          }
        } catch (error) {
          // Another request already advanced the round — safe to ignore
          if (!(error instanceof ConflictError)) {
            throw error
          }
          log('Auto-advance conflict, round already advanced')
        }
      } else if (votersSubmitted !== session.votersSubmitted) {
        try {
          await updateSession(sessionId, version, { ...session, votersSubmitted })
        } catch (error) {
          if (!(error instanceof ConflictError)) {
            throw error
          }
          log('votersSubmitted update conflict, session was modified concurrently')
        }
      }
    }

    const { googleSub: _, ...responseUser } = updatedUser
    return { ...status.OK, body: JSON.stringify(responseUser) }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    if (error instanceof ValidationError) return { ...status.BAD_REQUEST, body: serializeValidationError(error) }
    if (error instanceof JsonPatchError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    if (error instanceof ConflictError) return { ...status.CONFLICT, body: JSON.stringify({ message: error.message }) }
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
