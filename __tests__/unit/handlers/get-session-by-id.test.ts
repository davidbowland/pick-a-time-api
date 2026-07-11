import { NotFoundError } from '@errors'

import { session, sessionId } from '../__mocks__'
import eventJson from '@events/get-session-by-id.json'
import { handler } from '@handlers/get-session-by-id'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'
import status from '@utils/status'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

describe('get-session-by-id', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2

  const futureSession = { ...session, expiration: 9999999999 }

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [], version: 0 })
  })

  describe('handler', () => {
    it('should return OK with session data when session exists', async () => {
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
      const body = JSON.parse(result.body as string)
      expect(body).toEqual(expect.objectContaining({ sessionId }))
    })

    it('should derive voterCount from users.length', async () => {
      jest
        .mocked(dynamodb)
        .getSession.mockResolvedValueOnce({ session: futureSession, users: ['u1', 'u2', 'u3'], version: 0 })
      const result = await handler(event)
      const body = JSON.parse(result.body as string)
      expect(body.voterCount).toBe(3)
    })

    it('should return cached votersSubmitted from session', async () => {
      const sessionWithVoters = { ...futureSession, votersSubmitted: 2 }
      jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: sessionWithVoters, users: [], version: 0 })
      const result = await handler(event)
      const body = JSON.parse(result.body as string)
      expect(body.votersSubmitted).toBe(2)
    })

    it('should return NOT_FOUND when getSession throws NotFoundError', async () => {
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

    it('should return INTERNAL_SERVER_ERROR on unexpected errors', async () => {
      jest.mocked(dynamodb).getSession.mockRejectedValueOnce(new Error('DynamoDB error'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.INTERNAL_SERVER_ERROR))
    })
  })
})
