import { NotFoundError } from '@errors'

import { calendarAccountRecord, session, userRecord } from '../__mocks__'
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
  xrayCapture: jest.fn((x: unknown) => x),
}))

describe('delete-calendar', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const futureSession = { ...session, expiration: 9999999999 }

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [] })
    jest.mocked(dynamodb).getUser.mockResolvedValue(userRecord)
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
      expect(logging.logError).toHaveBeenCalledWith('Failed to revoke token at Google', {
        message: axiosError.message,
        status: 400,
      })
      const loggedCall = jest
        .mocked(logging)
        .logError.mock.calls.find(([firstArg]) => firstArg === 'Failed to revoke token at Google')
      expect(JSON.stringify(loggedCall)).not.toContain('config')
      expect(JSON.stringify(loggedCall)).not.toContain('shh-the-refresh-token-itself')
    })

    it('should return NO_CONTENT with no side effects when no connection exists', async () => {
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(null)
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 204 }))
      expect(dynamodb.deleteCalendarAccount).not.toHaveBeenCalled()
    })

    it('should return NOT_FOUND when the session-user does not exist', async () => {
      jest.mocked(dynamodb).getUser.mockRejectedValueOnce(new NotFoundError('User not found'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
    })

    it('should still delete the record when decryption fails, without attempting revocation', async () => {
      jest.mocked(kms).decryptRefreshToken.mockRejectedValueOnce(new Error('KMS unavailable'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 204 }))
      expect(dynamodb.deleteCalendarAccount).toHaveBeenCalledWith(calendarAccountRecord.googleSub)
      expect(googleCalendar.revokeToken).not.toHaveBeenCalled()
    })
  })
})
