import { sessionExpireHours } from '../config'
import { ConflictError, ForbiddenError, ValidationError } from '../errors'
import { putNewSession } from '../services/dynamodb'
import { getCaptchaScore } from '../services/recaptcha'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, NewPollInput, PollRecord } from '../types'
import { extractAuthContext } from '../utils/auth'
import { extractRecaptchaToken, parseNewPollBody } from '../utils/events'
import { generateSessionId } from '../utils/id-generator'
import { log, logError } from '../utils/logging'
import status from '../utils/status'

const MAX_ID_RETRIES = 5

const buildPoll = (sessionId: string, input: NewPollInput, expiration: number): PollRecord =>
  input.usesTimes
    ? {
      sessionId,
      name: input.name,
      dates: input.dates,
      usesTimes: true,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      slotMinutes: input.slotMinutes,
      timezone: input.timezone,
      expiration,
    }
    : {
      sessionId,
      name: input.name,
      dates: input.dates,
      usesTimes: false,
      timezone: input.timezone,
      expiration,
    }

const createSessionWithUniqueId = async (input: NewPollInput, expiration: number): Promise<string> => {
  for (let attempt = 0; attempt < MAX_ID_RETRIES; attempt++) {
    const sessionId = generateSessionId()
    const session = buildPoll(sessionId, input, expiration)
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
  nowMs = Date.now,
): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const auth = extractAuthContext(event)
    const recaptchaToken = auth.isAuthenticated ? null : extractRecaptchaToken(event)
    const input = parseNewPollBody(event, nowMs)

    if (recaptchaToken !== null) {
      const score = await getCaptchaScore(recaptchaToken)
      log('reCAPTCHA result', { score })
      if (score < 0.7) {
        throw new ForbiddenError('reCAPTCHA score too low')
      }
    }

    const expiration = Math.floor(nowMs() / 1000) + sessionExpireHours * 3600
    const sessionId = await createSessionWithUniqueId(input, expiration)
    log('Session created', { sessionId })

    return { ...status.CREATED, body: JSON.stringify({ sessionId }) }
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { ...status.FORBIDDEN, body: JSON.stringify({ message: error.message }) }
    if (error instanceof ValidationError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => postSession(event)
