import { ConflictError, ValidationError } from '@errors'

import { newSessionInput, recaptchaToken } from '../__mocks__'
import eventJson from '@events/post-session.json'
import { handler, postSession } from '@handlers/post-session'
import * as dynamodb from '@services/dynamodb'
import * as recaptcha from '@services/recaptcha'
import { APIGatewayProxyEventV2 } from '@types'
import * as events from '@utils/events'
import * as idGenerator from '@utils/id-generator'
import status from '@utils/status'

const mockSend = jest.fn()
const mockInvokeCommand = jest.fn()

jest.mock('@aws-sdk/client-lambda', () => ({
  // function expression required: handler calls new InvokeCommand(...)
  InvokeCommand: function (...args: unknown[]) {
    return mockInvokeCommand(...args)
  },
  LambdaClient: jest.fn(() => ({ send: (...args: unknown[]) => mockSend(...args) })),
}))
jest.mock('@services/dynamodb')
jest.mock('@services/recaptcha')
jest.mock('@utils/events')
jest.mock('@utils/id-generator')
jest.mock('@utils/logging', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  xrayCapture: jest.fn((x: unknown) => x),
  xrayCaptureHttps: jest.fn(),
}))

describe('post-session', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const NOW = 1700000000000

  beforeAll(() => {
    jest.mocked(events).extractRecaptchaToken.mockReturnValue(recaptchaToken)
    jest.mocked(events).parseNewSessionBody.mockReturnValue(newSessionInput)
    jest.mocked(recaptcha).getCaptchaScore.mockResolvedValue(0.9)
    jest.mocked(dynamodb).putNewSession.mockResolvedValue(undefined)
    jest.mocked(idGenerator).generateSessionId.mockReturnValue('fuzzy-penguin')
    mockSend.mockResolvedValue(undefined)
  })

  describe('handler', () => {
    it('should return FORBIDDEN when reCAPTCHA score is below threshold', async () => {
      jest.mocked(recaptcha).getCaptchaScore.mockResolvedValueOnce(0.5)
      const result = await handler(event)
      expect(result).toEqual(status.FORBIDDEN)
    })

    it('should return BAD_REQUEST when parseNewSessionBody throws ValidationError', async () => {
      jest.mocked(events).parseNewSessionBody.mockImplementationOnce(() => {
        throw new ValidationError('address is required')
      })
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
    })

    it('should return BAD_REQUEST when extractRecaptchaToken throws ValidationError', async () => {
      jest.mocked(events).extractRecaptchaToken.mockImplementationOnce(() => {
        throw new ValidationError('x-recaptcha-token header is required')
      })
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
    })

    it('should call putNewSession with correct session defaults', async () => {
      await handler(event)
      expect(dynamodb.putNewSession).toHaveBeenCalledWith(
        'fuzzy-penguin',
        expect.objectContaining({
          bracket: [],
          byes: [],
          currentRound: 0,
          errorMessage: null,
          isReady: false,
          location: null,
          radius: Math.round(2.33 * 1609.34),
          sessionId: 'fuzzy-penguin',
          totalRounds: 0,
          winner: null,
        }),
      )
    })

    it('should set expiration to 24 hours from now in seconds', async () => {
      await postSession(event, NOW)
      const sessionArg = jest.mocked(dynamodb).putNewSession.mock.calls.at(-1)?.[1]
      expect(sessionArg?.expiration).toBe(Math.floor(NOW / 1000) + 24 * 3600)
    })

    it('should set timeoutAt to now + configured timeout in ms', async () => {
      await postSession(event, NOW)
      const sessionArg = jest.mocked(dynamodb).putNewSession.mock.calls.at(-1)?.[1]
      expect(sessionArg?.timeoutAt).toBe(NOW + 10000)
    })

    it('should invoke Lambda with InvocationType Event', async () => {
      await handler(event)
      expect(mockInvokeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          InvocationType: 'Event',
        }),
      )
      expect(mockSend).toHaveBeenCalled()
    })

    it('should return ACCEPTED with sessionId in body', async () => {
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.ACCEPTED))
      expect(JSON.parse((result as { body: string }).body).sessionId).toBe('fuzzy-penguin')
    })

    it('should retry with new ID on session ID collision', async () => {
      jest.mocked(dynamodb).putNewSession.mockRejectedValueOnce(new ConflictError('Session ID already exists'))
      jest
        .mocked(idGenerator)
        .generateSessionId.mockReturnValueOnce('colliding-name')
        .mockReturnValueOnce('unique-name')

      const result = await handler(event)

      expect(idGenerator.generateSessionId).toHaveBeenCalledTimes(2)
      expect(result).toEqual(expect.objectContaining(status.ACCEPTED))
      expect(JSON.parse((result as { body: string }).body).sessionId).toBe('unique-name')
    })

    it('should return INTERNAL_SERVER_ERROR after exhausting collision retries', async () => {
      const conflict = new ConflictError('Session ID already exists')
      jest
        .mocked(dynamodb)
        .putNewSession.mockRejectedValueOnce(conflict)
        .mockRejectedValueOnce(conflict)
        .mockRejectedValueOnce(conflict)
        .mockRejectedValueOnce(conflict)
        .mockRejectedValueOnce(conflict)

      const result = await handler(event)

      expect(result).toEqual(expect.objectContaining(status.INTERNAL_SERVER_ERROR))
    })

    it('should return INTERNAL_SERVER_ERROR when putNewSession rejects with non-conflict error', async () => {
      jest.mocked(dynamodb).putNewSession.mockRejectedValueOnce(new Error('DynamoDB error'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.INTERNAL_SERVER_ERROR))
    })

    it('should return INTERNAL_SERVER_ERROR when Lambda invoke rejects', async () => {
      mockSend.mockRejectedValueOnce(new Error('Lambda error'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.INTERNAL_SERVER_ERROR))
    })

    it('should return INTERNAL_SERVER_ERROR when getCaptchaScore rejects', async () => {
      jest.mocked(recaptcha).getCaptchaScore.mockRejectedValueOnce(new Error('Network error'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.INTERNAL_SERVER_ERROR))
    })
  })
})
