import { googleSub } from '../__mocks__'
import eventJson from '@events/get-calendar-callback.json'
import { handler } from '@handlers/get-calendar-callback'
import * as dynamodb from '@services/dynamodb'
import * as googleCalendar from '@services/google-calendar'
import * as kms from '@services/kms'
import * as oauthState from '@services/oauth-state'
import { APIGatewayProxyEventV2 } from '@types'
import * as logging from '@utils/logging'

jest.mock('@services/dynamodb')
jest.mock('@services/google-calendar')
jest.mock('@services/kms')
jest.mock('@services/oauth-state')
jest.mock('@utils/logging', () => ({
  ...jest.requireActual('@utils/logging'),
  log: jest.fn(),
  logError: jest.fn(),
  xrayCapture: jest.fn((x: unknown) => x),
}))

describe('get-calendar-callback', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2

  beforeAll(() => {
    jest.mocked(oauthState).verifyCalendarState.mockResolvedValue(googleSub)
    jest.mocked(googleCalendar).exchangeCodeForTokens.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' })
    jest.mocked(kms).encryptRefreshToken.mockResolvedValue('encrypted-rt')
    jest.mocked(dynamodb).putCalendarAccount.mockResolvedValue(undefined)
  })

  describe('handler', () => {
    it('should redirect to the web app with status=connected on success', async () => {
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 302 }))
      expect((result as { headers: Record<string, string> }).headers.Location).toContain('status=connected')
      expect(dynamodb.putCalendarAccount).toHaveBeenCalledWith(
        expect.objectContaining({ googleSub, refreshTokenEncrypted: 'encrypted-rt', status: 'connected' }),
      )
    })

    it('should redact code and state from the logged event, not the raw secrets', async () => {
      await handler(event)

      expect(logging.log).toHaveBeenCalledWith(
        'Received event',
        expect.objectContaining({
          queryStringParameters: { code: '[REDACTED]', state: '[REDACTED]' },
        }),
      )
      const [, loggedEvent] = jest.mocked(logging).log.mock.calls[0]
      expect(JSON.stringify(loggedEvent)).not.toContain('auth-code-value')
      expect(JSON.stringify(loggedEvent)).not.toContain('signed-state-token')
    })

    it('should redirect with status=declined when Google reports a consent error', async () => {
      const declinedEvent = {
        ...event,
        queryStringParameters: { error: 'access_denied' },
      } as unknown as APIGatewayProxyEventV2
      const result = await handler(declinedEvent)
      expect((result as { headers: Record<string, string> }).headers.Location).toContain('status=declined')
      expect(dynamodb.putCalendarAccount).not.toHaveBeenCalled()
    })

    it('should redirect with status=error when code or state is missing', async () => {
      const badEvent = { ...event, queryStringParameters: { code: 'x' } } as unknown as APIGatewayProxyEventV2
      const result = await handler(badEvent)
      expect((result as { headers: Record<string, string> }).headers.Location).toContain('status=error')
    })

    it('should redirect with status=error when state verification fails', async () => {
      jest.mocked(oauthState).verifyCalendarState.mockRejectedValueOnce(new Error('bad state'))
      const result = await handler(event)
      expect((result as { headers: Record<string, string> }).headers.Location).toContain('status=error')
    })

    it('should sanitize an Axios-shaped token-exchange failure before logging it, never logging config secrets', async () => {
      const axiosError = {
        message: 'Request failed with status code 400',
        isAxiosError: true,
        response: { status: 400 },
        config: {
          params: { client_secret: 'shh-client-secret', code: 'shh-auth-code' },
        },
      }
      jest.mocked(googleCalendar).exchangeCodeForTokens.mockRejectedValueOnce(axiosError)

      const result = await handler(event)

      expect((result as { headers: Record<string, string> }).headers.Location).toContain('status=error')
      expect(logging.logError).toHaveBeenCalledWith({ message: axiosError.message, status: 400 })
      const loggedArg = jest.mocked(logging).logError.mock.calls.at(-1)?.[0]
      expect(JSON.stringify(loggedArg)).not.toContain('config')
      expect(JSON.stringify(loggedArg)).not.toContain('shh-client-secret')
      expect(JSON.stringify(loggedArg)).not.toContain('shh-auth-code')
    })
  })
})
