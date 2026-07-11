import { NotFoundError } from '@errors'

import { session, userRecord } from '../__mocks__'
import eventJson from '@events/get-users.json'
import { handler } from '@handlers/get-users'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'
import status from '@utils/status'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  xrayCapture: jest.fn((x: unknown) => x),
  xrayCaptureHttps: jest.fn(),
}))

describe('get-users', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const futureSession = { ...session, expiration: 9999999999 }

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [], version: 0 })
    jest.mocked(dynamodb).getAllUsers.mockResolvedValue([userRecord])
  })

  describe('handler', () => {
    it('should return OK with users array', async () => {
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
      const body = JSON.parse((result as { body: string }).body)
      expect(body).toEqual([userRecord])
    })

    it('should return NOT_FOUND when session does not exist', async () => {
      jest.mocked(dynamodb).getSession.mockRejectedValueOnce(new NotFoundError('Session not found'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.NOT_FOUND))
    })

    it('should return NOT_FOUND when session is expired', async () => {
      const expiredSession = { ...session, expiration: 1 }
      jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: expiredSession, users: [], version: 0 })
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.NOT_FOUND))
    })

    it('should return OK with empty array when no users exist', async () => {
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([])
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
      expect(JSON.parse((result as { body: string }).body)).toEqual([])
    })

    it('should return INTERNAL_SERVER_ERROR on unexpected errors', async () => {
      jest.mocked(dynamodb).getAllUsers.mockRejectedValueOnce(new Error('DynamoDB error'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.INTERNAL_SERVER_ERROR))
    })
  })
})
