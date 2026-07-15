import axios from 'axios'

import { InvalidGrantError } from '../errors'
import { getGoogleCalendarClientId, getGoogleCalendarClientSecret } from './secrets'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export interface GoogleTokens {
  refreshToken: string
  accessToken: string
}

export interface BusyInterval {
  start: string
  end: string
}

export const exchangeCodeForTokens = async (code: string, redirectUri: string): Promise<GoogleTokens> => {
  const [clientId, clientSecret] = await Promise.all([getGoogleCalendarClientId(), getGoogleCalendarClientSecret()])
  const response = await axios.post(TOKEN_URL, null, {
    params: {
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    },
  })
  return { accessToken: response.data.access_token, refreshToken: response.data.refresh_token }
}

export const refreshAccessToken = async (refreshToken: string): Promise<string> => {
  const [clientId, clientSecret] = await Promise.all([getGoogleCalendarClientId(), getGoogleCalendarClientSecret()])
  try {
    const response = await axios.post(TOKEN_URL, null, {
      params: {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
    })
    return response.data.access_token
  } catch (error) {
    const errorCode = (error as { response?: { data?: { error?: string } } })?.response?.data?.error
    if (errorCode === 'invalid_grant') {
      throw new InvalidGrantError('Google refresh token is no longer valid')
    }
    throw error
  }
}

export const fetchFreeBusy = async (accessToken: string, timeMin: string, timeMax: string): Promise<BusyInterval[]> => {
  const response = await axios.post(
    FREEBUSY_URL,
    { items: [{ id: 'primary' }], timeMax, timeMin },
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  return response.data.calendars.primary.busy
}

export const revokeToken = async (token: string): Promise<void> => {
  await axios.post(REVOKE_URL, null, { params: { token } })
}
