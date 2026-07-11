import { ConflictError, ValidationError } from '@errors'

import { newPlanInput, sessionId } from '../__mocks__'
import eventJson from '@events/post-session.json'
import { postSession } from '@handlers/post-session'
import * as dynamodb from '@services/dynamodb'
import * as recaptcha from '@services/recaptcha'
import { APIGatewayProxyEventV2 } from '@types'
import * as events from '@utils/events'
import * as idGenerator from '@utils/id-generator'
import status from '@utils/status'

jest.mock('@services/dynamodb')
jest.mock('@services/recaptcha')
jest.mock('@utils/id-generator')
jest.mock('@utils/events', () => ({
  ...jest.requireActual('@utils/events'),
  parseNewPlanBody: jest.fn(),
}))
jest.mock('@utils/logging', () => ({ log: jest.fn(), logError: jest.fn(), xrayCapture: jest.fn((x: unknown) => x) }))

describe('post-session', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const nowMs = 1_700_000_000_000

  beforeAll(() => {
    jest.mocked(events).parseNewPlanBody.mockReturnValue(newPlanInput)
    jest.mocked(recaptcha).getCaptchaScore.mockResolvedValue(0.9)
    jest.mocked(idGenerator).generateSessionId.mockReturnValue(sessionId)
    jest.mocked(dynamodb).putNewSession.mockResolvedValue(undefined)
  })

  describe('postSession', () => {
    it('should return CREATED with the new sessionId', async () => {
      const result = await postSession(event, () => nowMs)
      expect(result).toEqual(expect.objectContaining(status.CREATED))
      expect(JSON.parse((result as { body: string }).body)).toEqual({ sessionId })
    })

    it('should compute expiration from weekCount and nowMs', async () => {
      await postSession(event, () => nowMs)
      const expectedExpiration = Math.floor(nowMs / 1000) + 24 * 3600
      expect(dynamodb.putNewSession).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({ expiration: expectedExpiration }),
      )
    })

    it('should retry with a new sessionId on collision', async () => {
      jest.mocked(dynamodb).putNewSession.mockRejectedValueOnce(new ConflictError('Session ID already exists'))
      jest.mocked(idGenerator).generateSessionId.mockReturnValueOnce('taken-id').mockReturnValueOnce(sessionId)
      const result = await postSession(event, () => nowMs)
      expect(JSON.parse((result as { body: string }).body)).toEqual({ sessionId })
    })

    it('should return FORBIDDEN when reCAPTCHA score is too low', async () => {
      jest.mocked(recaptcha).getCaptchaScore.mockResolvedValueOnce(0.1)
      const result = await postSession(event, () => nowMs)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.FORBIDDEN.statusCode }))
      expect(JSON.parse((result as { body: string }).body)).toEqual({ message: 'reCAPTCHA score too low' })
    })

    it('should return BAD_REQUEST when validation fails', async () => {
      jest.mocked(events).parseNewPlanBody.mockImplementationOnce(() => {
        throw new ValidationError('name is required')
      })
      const result = await postSession(event, () => nowMs)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
    })
  })
})
