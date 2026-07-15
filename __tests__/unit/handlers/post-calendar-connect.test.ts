import { NotFoundError } from '@errors'

import { calendarAccountRecord, session, userId, userRecord } from '../__mocks__'
import eventJson from '@events/post-calendar-connect.json'
import { handler } from '@handlers/post-calendar-connect'
import * as dynamodb from '@services/dynamodb'
import * as oauthState from '@services/oauth-state'
import * as secrets from '@services/secrets'
import { APIGatewayProxyEventV2 } from '@types'

jest.mock('@services/dynamodb')
jest.mock('@services/oauth-state')
jest.mock('@services/secrets')
jest.mock('@utils/logging', () => ({ log: jest.fn(), logError: jest.fn(), xrayCapture: jest.fn((x: unknown) => x) }))

describe('post-calendar-connect', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const futureSession = { ...session, expiration: 9999999999 }

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [userId] })
    jest.mocked(dynamodb).getUser.mockResolvedValue(userRecord)
    jest.mocked(dynamodb).getCalendarAccount.mockResolvedValue(null)
    jest.mocked(oauthState).signCalendarState.mockResolvedValue('signed-state-token')
    jest.mocked(secrets).getGoogleCalendarClientId.mockResolvedValue('calendar-client-id')
  })

  describe('handler', () => {
    it('should return an authUrl when no connection exists yet', async () => {
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.alreadyConnected).toBe(false)
      expect(body.authUrl).toContain('https://accounts.google.com/o/oauth2/v2/auth')
      expect(body.authUrl).toContain('state=signed-state-token')
      expect(body.authUrl).toContain('prompt=consent')
    })

    it('should return alreadyConnected: true without generating an authUrl when already connected', async () => {
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce({ ...calendarAccountRecord, status: 'connected' })
      const result = await handler(event)
      expect(JSON.parse((result as { body: string }).body)).toEqual({ alreadyConnected: true })
      expect(oauthState.signCalendarState).not.toHaveBeenCalled()
    })

    it('should generate a new authUrl when the existing connection is in an error state', async () => {
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce({ ...calendarAccountRecord, status: 'error' })
      const result = await handler(event)
      expect(JSON.parse((result as { body: string }).body).alreadyConnected).toBe(false)
    })

    it('should return BAD_REQUEST when the caller is not authenticated', async () => {
      const unauthedEvent = {
        ...event,
        requestContext: { ...event.requestContext, authorizer: undefined },
      } as unknown as APIGatewayProxyEventV2
      const result = await handler(unauthedEvent)
      expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
    })

    it('should return NOT_FOUND when the session does not exist', async () => {
      jest.mocked(dynamodb).getSession.mockRejectedValueOnce(new NotFoundError('Session not found'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
    })
  })
})
