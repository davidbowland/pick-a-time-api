import { calendarAccountRecord } from '../__mocks__'
import eventJson from '@events/delete-calendar.json'
import { handler } from '@handlers/delete-calendar'
import * as dynamodb from '@services/dynamodb'
import * as googleCalendar from '@services/google-calendar'
import * as kms from '@services/kms'
import { APIGatewayProxyEventV2 } from '@types'
import * as logging from '@utils/logging'

jest.mock('@services/dynamodb')
jest.mock('@services/google-calendar')
jest.mock('@services/kms')
jest.mock('@utils/logging', () => ({
  ...jest.requireActual('@utils/logging'),
  log: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
}))

describe('delete-calendar', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2

  beforeAll(() => {
    jest.mocked(dynamodb).getCalendarAccount.mockResolvedValue(calendarAccountRecord)
    jest.mocked(dynamodb).deleteCalendarAccount.mockResolvedValue(undefined)
    jest.mocked(kms).decryptRefreshToken.mockResolvedValue('decrypted-rt')
    jest.mocked(googleCalendar).revokeToken.mockResolvedValue(undefined)
  })

  describe('handler', () => {
    it('should revoke at Google and delete the stored record', async () => {
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 204 }))
      expect(googleCalendar.revokeToken).toHaveBeenCalledWith('decrypted-rt')
      expect(dynamodb.deleteCalendarAccount).toHaveBeenCalledWith(calendarAccountRecord.googleSub)
    })

    it('should still delete the record when Google revocation fails', async () => {
      jest.mocked(googleCalendar).revokeToken.mockRejectedValueOnce(new Error('Google unavailable'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 204 }))
      expect(dynamodb.deleteCalendarAccount).toHaveBeenCalled()
    })

    it('should sanitize an Axios-shaped revokeToken failure before logging it, never logging the raw refresh token', async () => {
      const axiosError = {
        message: 'Request failed with status code 400',
        isAxiosError: true,
        response: { status: 400 },
        config: { params: { token: 'shh-the-refresh-token-itself' } },
      }
      jest.mocked(googleCalendar).revokeToken.mockRejectedValueOnce(axiosError)

      const result = await handler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: 204 }))
      expect(logging.logWarn).toHaveBeenCalledWith(
        'Could not revoke the token at Google; deleting the local record anyway',
        { error: { message: axiosError.message, status: 400 }, recordStatus: calendarAccountRecord.status },
      )
      const loggedCall = jest.mocked(logging).logWarn.mock.calls[0]
      expect(JSON.stringify(loggedCall)).not.toContain('config')
      expect(JSON.stringify(loggedCall)).not.toContain('shh-the-refresh-token-itself')
    })

    // Disconnecting an already-revoked calendar is the recovery path -- it is how somebody clears a
    // dead record so they can connect again -- and Google answers 400 for a token it has already
    // forgotten. Logging that at ERROR sent an alert email for a successful, deliberate user action.
    it('should not log an error when revoking a grant Google has already forgotten', async () => {
      jest
        .mocked(dynamodb)
        .getCalendarAccount.mockResolvedValueOnce({ ...calendarAccountRecord, status: 'revoked' as const })
      jest.mocked(googleCalendar).revokeToken.mockRejectedValueOnce(new Error('Request failed with status code 400'))

      const result = await handler(event)

      expect(result).toEqual(expect.objectContaining({ statusCode: 204 }))
      expect(dynamodb.deleteCalendarAccount).toHaveBeenCalled()
      expect(logging.logError).not.toHaveBeenCalled()
      expect(logging.logWarn).toHaveBeenCalledWith(
        'Could not revoke the token at Google; deleting the local record anyway',
        expect.objectContaining({ recordStatus: 'revoked' }),
      )
    })

    it('should return NO_CONTENT with no side effects when no connection exists', async () => {
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(null)
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 204 }))
      expect(dynamodb.deleteCalendarAccount).not.toHaveBeenCalled()
    })

    it('should still delete the record when decryption fails, without attempting revocation', async () => {
      jest.mocked(kms).decryptRefreshToken.mockRejectedValueOnce(new Error('KMS unavailable'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 204 }))
      expect(dynamodb.deleteCalendarAccount).toHaveBeenCalledWith(calendarAccountRecord.googleSub)
      expect(googleCalendar.revokeToken).not.toHaveBeenCalled()
    })

    it('should not require a session or user', async () => {
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 204 }))
      expect(dynamodb.getSession).not.toHaveBeenCalled()
      expect(dynamodb.getUser).not.toHaveBeenCalled()
    })

    it('should return 400 without a Google identity', async () => {
      const anonymous = { ...event, requestContext: { ...event.requestContext, authorizer: undefined } }
      const result = await handler(anonymous as unknown as APIGatewayProxyEventV2)
      expect(result.statusCode).toEqual(400)
    })
  })
})
