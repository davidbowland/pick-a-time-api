import { session, userId, sessionId, userRecord } from '../__mocks__'
import { NotFoundError } from '@errors'
import eventJson from '@events/patch-user.json'
import { handler } from '@handlers/patch-user'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  redactEvent: jest.fn((event: unknown) => event),
}))

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

  it('should return INTERNAL_SERVER_ERROR on an unexpected error', async () => {
    jest.mocked(dynamodb).getUser.mockRejectedValueOnce(new Error('boom'))
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 500 }))
  })

  // The shared userRecord fixture carries googleSub: null, so the base `event` is an anonymous
  // caller patching an unclaimed participant. These three cover the rest of the grid.
  const authedEvent = {
    ...event,
    requestContext: { ...event.requestContext, authorizer: { jwt: { claims: { sub: 'google-123' } } } },
  } as unknown as APIGatewayProxyEventV2

  it('should fill in googleSub from auth context when unset', async () => {
    await handler(authedEvent)
    expect(dynamodb.updateUser).toHaveBeenCalledWith(
      sessionId,
      userId,
      expect.objectContaining({ googleSub: 'google-123' }),
    )
  })

  it('should return FORBIDDEN when the participant is linked to a different Google account', async () => {
    jest.mocked(dynamodb).getUser.mockResolvedValueOnce({ ...userRecord, googleSub: 'google-sub-other' })
    const result = await handler(authedEvent)
    expect(result).toEqual(expect.objectContaining({ statusCode: 403 }))
    expect(dynamodb.updateUser).not.toHaveBeenCalled()
  })

  it('should leave the link alone when the caller already owns the participant', async () => {
    jest.mocked(dynamodb).getUser.mockResolvedValueOnce({ ...userRecord, googleSub: 'google-123' })
    const result = await handler(authedEvent)
    expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
    expect(dynamodb.updateUser).toHaveBeenCalledWith(
      sessionId,
      userId,
      expect.objectContaining({ googleSub: 'google-123', name: 'Bright Heron' }),
    )
  })

  // The same person on a second device, signed out there. An unauthenticated request names no
  // account, so there is no mismatch to find -- and refusing it would lock somebody out of their
  // own name on any device where they have not signed in.
  it('should allow an unauthenticated patch of a linked participant', async () => {
    jest.mocked(dynamodb).getUser.mockResolvedValueOnce({ ...userRecord, googleSub: 'google-sub-other' })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
    expect(dynamodb.updateUser).toHaveBeenCalledWith(
      sessionId,
      userId,
      expect.objectContaining({ googleSub: 'google-sub-other', name: 'Bright Heron' }),
    )
  })
})
