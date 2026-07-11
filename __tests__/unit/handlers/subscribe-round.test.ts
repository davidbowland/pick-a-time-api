import { NotFoundError } from '@errors'

import { session, userRecord } from '../__mocks__'
import eventJson from '@events/subscribe-round.json'
import { handler } from '@handlers/subscribe-round'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2, UserRecord } from '@types'
import status from '@utils/status'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  xrayCapture: jest.fn((x: unknown) => x),
  xrayCaptureHttps: jest.fn(),
}))

describe('subscribe-round', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const futureExpiration = 9999999999
  const futureSession = { ...session, expiration: futureExpiration }
  const userWithPhone: UserRecord = { ...userRecord, expiration: futureExpiration, phone: '+15551234567' }

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [], version: 0 })
    jest.mocked(dynamodb).getUser.mockResolvedValue(userWithPhone)
    jest.mocked(dynamodb).updateUser.mockResolvedValue(undefined)
  })

  describe('handler', () => {
    it('should return OK and add roundId to subscribedRounds', async () => {
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.subscribedRounds).toContain(1)
    })

    it('should be idempotent when re-subscribing to same round', async () => {
      const alreadySubscribed: UserRecord = { ...userWithPhone, subscribedRounds: [1] }
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce(alreadySubscribed)
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
      expect(dynamodb.updateUser).not.toHaveBeenCalled()
      const body = JSON.parse((result as { body: string }).body)
      expect(body.subscribedRounds.filter((r: number) => r === 1)).toHaveLength(1)
    })

    it('should return BAD_REQUEST when user has no phone number', async () => {
      const noPhoneUser: UserRecord = { ...userRecord, expiration: futureExpiration, phone: null }
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce(noPhoneUser)
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
      expect(JSON.parse((result as { body: string }).body).message).toContain('phone')
    })

    it('should return NOT_FOUND when session does not exist', async () => {
      jest.mocked(dynamodb).getSession.mockRejectedValueOnce(new NotFoundError('Session not found'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.NOT_FOUND))
    })

    it('should return NOT_FOUND when user does not exist', async () => {
      jest.mocked(dynamodb).getUser.mockRejectedValueOnce(new NotFoundError('User not found'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.NOT_FOUND))
    })

    it('should return NOT_FOUND when session is expired', async () => {
      const expiredSession = { ...session, expiration: 1 }
      jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: expiredSession, users: [], version: 0 })
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.NOT_FOUND))
    })

    it('should return BAD_REQUEST for invalid roundId path parameter', async () => {
      const badEvent = {
        ...event,
        pathParameters: { ...event.pathParameters, roundId: 'abc' },
      } as unknown as APIGatewayProxyEventV2
      const result = await handler(badEvent)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
    })

    it('should allow any user to subscribe another user', async () => {
      const otherUser: UserRecord = { ...userWithPhone, userId: 'brave-tiger' }
      const eventForOtherUser = {
        ...event,
        body: JSON.stringify({ userId: 'brave-tiger', roundId: 1 }),
      } as unknown as APIGatewayProxyEventV2
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce(otherUser)
      const result = await handler(eventForOtherUser)
      expect(result).toEqual(expect.objectContaining(status.OK))
    })

    it('should return INTERNAL_SERVER_ERROR on unexpected errors', async () => {
      const freshUser: UserRecord = { ...userWithPhone, subscribedRounds: [] }
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce(freshUser)
      jest.mocked(dynamodb).updateUser.mockRejectedValueOnce(new Error('DynamoDB error'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.INTERNAL_SERVER_ERROR))
    })
  })
})
