import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'

import { createSessionFunctionName, createSessionTimeoutMs, metersPerMile, sessionExpireHours } from '../config'
import { ConflictError, ForbiddenError, ValidationError } from '../errors'
import { putNewSession } from '../services/dynamodb'
import { getCaptchaScore } from '../services/recaptcha'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, NewSessionInput, SessionRecord } from '../types'
import { extractRecaptchaToken, parseNewSessionBody } from '../utils/events'
import { generateSessionId } from '../utils/id-generator'
import { log, logError, xrayCapture } from '../utils/logging'
import status from '../utils/status'

const lambda = xrayCapture(new LambdaClient({}))

const MAX_ID_RETRIES = 5

const milesToMeters = (miles: number): number => Math.round(miles * metersPerMile)

const buildSession = (
  sessionId: string,
  input: NewSessionInput,
  expiration: number,
  timeoutAt: number,
): SessionRecord => ({
  address: input.address,
  bracket: [],
  byes: [],
  currentRound: 0,
  errorMessage: null,
  exclude: input.exclude,
  expiration,
  isReady: false,
  location:
    input.latitude !== undefined && input.longitude !== undefined
      ? { latitude: input.latitude, longitude: input.longitude }
      : null,
  filterClosingSoon: input.filterClosingSoon === true,
  radius: milesToMeters(input.radiusMiles),
  rankBy: input.rankBy,
  sessionId,
  timeoutAt,
  totalRounds: 0,
  type: input.type,
  votersSubmitted: 0,
  winner: null,
})

// Retry with a new ID on collision (adjective-noun can collide with active sessions)
const createSessionWithUniqueId = async (
  input: NewSessionInput,
  expiration: number,
  timeoutAt: number,
): Promise<string> => {
  for (let attempt = 0; attempt < MAX_ID_RETRIES; attempt++) {
    const sessionId = generateSessionId()
    const session = buildSession(sessionId, input, expiration, timeoutAt)
    try {
      await putNewSession(sessionId, session)
      return sessionId
    } catch (error) {
      if (error instanceof ConflictError && attempt < MAX_ID_RETRIES - 1) {
        log('Session ID collision, retrying', { sessionId, attempt })
        continue
      }
      throw error
    }
  }
  throw new Error('Failed to create session after maximum retries')
}

export const postSession = async (
  event: APIGatewayProxyEventV2,
  nowMs = Date.now(),
): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const recaptchaToken = extractRecaptchaToken(event)
    const input = parseNewSessionBody(event)

    const score = await getCaptchaScore(recaptchaToken)
    log('reCAPTCHA result', { score })
    if (score < 0.7) {
      throw new ForbiddenError('reCAPTCHA score too low')
    }

    const expiration = Math.floor(nowMs / 1000) + sessionExpireHours * 3600
    const timeoutAt = nowMs + createSessionTimeoutMs

    const sessionId = await createSessionWithUniqueId(input, expiration, timeoutAt)
    log('Session created', { sessionId })

    const { radiusMiles: _, ...inputWithoutMiles } = input
    const payload = JSON.stringify({ sessionId, ...inputWithoutMiles, radius: milesToMeters(input.radiusMiles) })
    const invokeCommand = new InvokeCommand({
      FunctionName: createSessionFunctionName,
      InvocationType: 'Event',
      Payload: new TextEncoder().encode(payload),
    })
    await lambda.send(invokeCommand)
    log('Create session Lambda invoked', { sessionId })

    return {
      ...status.ACCEPTED,
      body: JSON.stringify({ sessionId }),
    }
  } catch (error) {
    if (error instanceof ForbiddenError) return status.FORBIDDEN
    if (error instanceof ValidationError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => postSession(event)
