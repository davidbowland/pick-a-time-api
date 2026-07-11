import { sessionExpireHours } from '../config'
import { ConflictError, ForbiddenError, ValidationError } from '../errors'
import { putNewSession } from '../services/dynamodb'
import { getCaptchaScore } from '../services/recaptcha'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, NewPlanInput, PlanRecord } from '../types'
import { extractRecaptchaToken, parseNewPlanBody } from '../utils/events'
import { generateSessionId } from '../utils/id-generator'
import { log, logError } from '../utils/logging'
import status from '../utils/status'

const MAX_ID_RETRIES = 5

const buildPlan = (sessionId: string, input: NewPlanInput, expiration: number): PlanRecord => ({
  endHour: input.endHour,
  expiration,
  name: input.name,
  sessionId,
  startDate: input.startDate,
  startHour: input.startHour,
  timezone: input.timezone,
  weekCount: input.weekCount,
  weekdays: input.weekdays,
})

const createSessionWithUniqueId = async (input: NewPlanInput, expiration: number): Promise<string> => {
  for (let attempt = 0; attempt < MAX_ID_RETRIES; attempt++) {
    const sessionId = generateSessionId()
    const session = buildPlan(sessionId, input, expiration)
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
    const recaptchaToken = extractRecaptchaToken(event)
    const input = parseNewPlanBody(event)

    const score = await getCaptchaScore(recaptchaToken)
    log('reCAPTCHA result', { score })
    if (score < 0.7) {
      throw new ForbiddenError('reCAPTCHA score too low')
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
