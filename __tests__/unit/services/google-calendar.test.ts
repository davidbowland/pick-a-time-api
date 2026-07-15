import { InvalidGrantError } from '@errors'
import axios from 'axios'

import { exchangeCodeForTokens, fetchFreeBusy, refreshAccessToken, revokeToken } from '@services/google-calendar'
import * as secrets from '@services/secrets'

jest.mock('axios')
jest.mock('@services/secrets')

describe('google-calendar', () => {
  beforeAll(() => {
    jest.mocked(secrets).getGoogleCalendarClientId.mockResolvedValue('client-id')
    jest.mocked(secrets).getGoogleCalendarClientSecret.mockResolvedValue('client-secret')
  })

  describe('exchangeCodeForTokens', () => {
    it('should exchange an auth code for tokens', async () => {
      jest.mocked(axios.post).mockResolvedValueOnce({ data: { refresh_token: 'rt', access_token: 'at' } })
      const result = await exchangeCodeForTokens('auth-code', 'https://example.com/callback')
      expect(result).toEqual({ refreshToken: 'rt', accessToken: 'at' })
      expect(axios.post).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        null,
        expect.objectContaining({
          params: expect.objectContaining({
            client_id: 'client-id',
            code: 'auth-code',
            grant_type: 'authorization_code',
          }),
        }),
      )
    })
  })

  describe('refreshAccessToken', () => {
    it('should mint a fresh access token from a refresh token, including client_id', async () => {
      jest.mocked(axios.post).mockResolvedValueOnce({ data: { access_token: 'new-at' } })
      const result = await refreshAccessToken('rt')
      expect(result).toBe('new-at')
      expect(axios.post).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        null,
        expect.objectContaining({
          params: expect.objectContaining({ client_id: 'client-id', grant_type: 'refresh_token' }),
        }),
      )
    })

    it('should throw InvalidGrantError when Google reports invalid_grant', async () => {
      jest
        .mocked(axios.post)
        .mockRejectedValueOnce({ response: { data: { error: 'invalid_grant' } }, isAxiosError: true })
      await expect(refreshAccessToken('revoked-rt')).rejects.toThrow(InvalidGrantError)
    })

    it('should rethrow other errors as-is', async () => {
      jest.mocked(axios.post).mockRejectedValueOnce(new Error('network timeout'))
      await expect(refreshAccessToken('rt')).rejects.toThrow('network timeout')
    })
  })

  describe('fetchFreeBusy', () => {
    it('should return the busy intervals for the primary calendar', async () => {
      jest.mocked(axios.post).mockResolvedValueOnce({
        data: { calendars: { primary: { busy: [{ start: '2025-09-04T16:00:00Z', end: '2025-09-04T17:00:00Z' }] } } },
      })
      const result = await fetchFreeBusy('access-token', '2025-09-04T00:00:00Z', '2025-09-05T00:00:00Z')
      expect(result).toEqual([{ start: '2025-09-04T16:00:00Z', end: '2025-09-04T17:00:00Z' }])
      expect(axios.post).toHaveBeenCalledWith(
        'https://www.googleapis.com/calendar/v3/freeBusy',
        expect.objectContaining({ items: [{ id: 'primary' }] }),
        expect.objectContaining({ headers: { Authorization: 'Bearer access-token' } }),
      )
    })
  })

  describe('revokeToken', () => {
    it('should POST the token to the revocation endpoint', async () => {
      jest.mocked(axios.post).mockResolvedValueOnce({})
      await revokeToken('some-token')
      expect(axios.post).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/revoke',
        null,
        expect.objectContaining({ params: { token: 'some-token' } }),
      )
    })
  })
})
