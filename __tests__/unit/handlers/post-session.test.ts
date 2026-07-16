import { ConflictError, ValidationError } from '@errors'

import { newPollInput, sessionId } from '../__mocks__'
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
  parseNewPollBody: jest.fn(),
}))
jest.mock('@utils/logging', () => ({ log: jest.fn(), logError: jest.fn(), xrayCapture: jest.fn((x: unknown) => x) }))

describe('post-session', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const nowMs = 1_700_000_000_000

  beforeAll(() => {
    jest.mocked(events).parseNewPollBody.mockReturnValue(newPollInput)
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

    it('should compute expiration from sessionExpireHours and nowMs', async () => {
      await postSession(event, () => nowMs)
      const expectedExpiration = Math.floor(nowMs / 1000) + 336 * 3600
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

    it('should skip the reCAPTCHA check for an authenticated request', async () => {
      const authedEvent = {
        ...event,
        headers: {},
        requestContext: { ...event.requestContext, authorizer: { jwt: { claims: { sub: 'google-123' } } } },
      } as unknown as APIGatewayProxyEventV2
      const result = await postSession(authedEvent, () => nowMs)
      expect(result).toEqual(expect.objectContaining(status.CREATED))
      expect(JSON.parse((result as { body: string }).body)).toEqual({ sessionId })
      expect(recaptcha.getCaptchaScore).not.toHaveBeenCalled()
    })

    it('should return BAD_REQUEST when validation fails', async () => {
      jest.mocked(events).parseNewPollBody.mockImplementationOnce(() => {
        throw new ValidationError('name is required')
      })
      const result = await postSession(event, () => nowMs)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
    })

    it('should return INTERNAL_SERVER_ERROR when every retry collides', async () => {
      jest
        .mocked(dynamodb)
        .putNewSession.mockRejectedValueOnce(new ConflictError('Session ID already exists'))
        .mockRejectedValueOnce(new ConflictError('Session ID already exists'))
        .mockRejectedValueOnce(new ConflictError('Session ID already exists'))
        .mockRejectedValueOnce(new ConflictError('Session ID already exists'))
        .mockRejectedValueOnce(new ConflictError('Session ID already exists'))
      const result = await postSession(event, () => nowMs)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.INTERNAL_SERVER_ERROR.statusCode }))
    })

    it('should build a timed poll record including startMinute/endMinute/slotMinutes', async () => {
      await postSession(event, () => nowMs)
      expect(dynamodb.putNewSession).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          usesTimes: true,
          startMinute: newPollInput.startMinute,
          endMinute: newPollInput.endMinute,
          slotMinutes: newPollInput.slotMinutes,
        }),
      )
    })

    it('should persist overrides on the poll record when present', async () => {
      const inputWithOverrides = {
        ...newPollInput,
        overrides: [{ dates: [newPollInput.dates[0]], startMinute: 600, endMinute: 720 }],
      }
      jest.mocked(events).parseNewPollBody.mockReturnValueOnce(inputWithOverrides)
      await postSession(event, () => nowMs)
      expect(dynamodb.putNewSession).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({ overrides: inputWithOverrides.overrides }),
      )
    })

    it('should not include an overrides key on the poll record when not provided', async () => {
      await postSession(event, () => nowMs)
      const [, record] = jest.mocked(dynamodb).putNewSession.mock.calls[0]
      expect(record).not.toHaveProperty('overrides')
    })

    it('should build a dates-only poll record when usesTimes is false', async () => {
      const datesOnlyInput = {
        name: 'Trip planning',
        dates: ['2025-09-04'],
        usesTimes: false as const,
        timezone: 'America/Chicago',
      }
      jest.mocked(events).parseNewPollBody.mockReturnValueOnce(datesOnlyInput)
      await postSession(event, () => nowMs)
      expect(dynamodb.putNewSession).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({ usesTimes: false, dates: ['2025-09-04'] }),
      )
    })
  })
})
