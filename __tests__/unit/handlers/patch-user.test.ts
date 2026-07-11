import { NotFoundError } from '@errors'

import { session, userId, sessionId, userRecord } from '../__mocks__'
import eventJson from '@events/patch-user.json'
import { handler } from '@handlers/patch-user'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging', () => ({ log: jest.fn(), logError: jest.fn(), xrayCapture: jest.fn((x: unknown) => x) }))

describe('patch-user', () => {
  const event = {
    ...(eventJson as unknown as APIGatewayProxyEventV2),
    body: JSON.stringify([{ op: 'replace', path: '/name', value: 'Bright Heron' }]),
  }
  const futureSession = { ...session, expiration: 9999999999 }

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [userId] })
    jest.mocked(dynamodb).getUser.mockResolvedValue(userRecord)
    jest.mocked(dynamodb).updateUser.mockResolvedValue(undefined)
  })

  it('should apply a /name patch and return the updated user', async () => {
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
    expect(JSON.parse((result as { body: string }).body).name).toBe('Bright Heron')
  })

  it('should reject a disallowed path', async () => {
    const badEvent = { ...event, body: JSON.stringify([{ op: 'replace', path: '/googleSub', value: 'x' }]) }
    const result = await handler(badEvent)
    expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
  })

  it('should return NOT_FOUND when user does not exist', async () => {
    jest.mocked(dynamodb).getUser.mockRejectedValueOnce(new NotFoundError('User not found'))
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
  })

  it('should return NOT_FOUND when session does not exist', async () => {
    jest.mocked(dynamodb).getSession.mockRejectedValueOnce(new NotFoundError('Session not found'))
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
  })

  it('should return NOT_FOUND when session is expired', async () => {
    const expiredSession = { ...session, expiration: 1 }
    jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: expiredSession, users: [userId] })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
  })

  it('should fill in googleSub from auth context when unset', async () => {
    const authedEvent = {
      ...event,
      requestContext: { ...event.requestContext, authorizer: { jwt: { claims: { sub: 'google-123' } } } },
    } as unknown as APIGatewayProxyEventV2
    await handler(authedEvent)
    expect(dynamodb.updateUser).toHaveBeenCalledWith(
      sessionId,
      userId,
      expect.objectContaining({ googleSub: 'google-123' }),
    )
  })
})
