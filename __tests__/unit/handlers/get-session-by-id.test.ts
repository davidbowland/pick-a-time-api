import { NotFoundError } from '@errors'

import { session, userId } from '../__mocks__'
import eventJson from '@events/get-session-by-id.json'
import { handler } from '@handlers/get-session-by-id'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging', () => ({ log: jest.fn(), logError: jest.fn(), xrayCapture: jest.fn((x: unknown) => x) }))

describe('get-session-by-id', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const futureSession = { ...session, expiration: 9999999999 }

  it('should return the plan with participantCount', async () => {
    jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: futureSession, users: [userId, 'other-user'] })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
    expect(JSON.parse((result as { body: string }).body)).toEqual({ ...futureSession, participantCount: 2 })
  })

  it('should return NOT_FOUND when session is expired', async () => {
    jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: { ...session, expiration: 1 }, users: [] })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
  })

  it('should return NOT_FOUND when session does not exist', async () => {
    jest.mocked(dynamodb).getSession.mockRejectedValueOnce(new NotFoundError('Session not found'))
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
  })

  it('should return INTERNAL_SERVER_ERROR on an unexpected error', async () => {
    jest.mocked(dynamodb).getSession.mockRejectedValueOnce(new Error('boom'))
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 500 }))
  })
})
