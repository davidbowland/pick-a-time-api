import { ConflictError, ErrorCode, NotFoundError } from '@errors'

import { choicesRecord, session, sessionId, userRecord } from '../__mocks__'
import eventJson from '@events/close-round.json'
import { handler } from '@handlers/close-round'
import * as brackets from '@services/brackets'
import * as dynamodb from '@services/dynamodb'
import * as sms from '@services/sms'
import { APIGatewayProxyEventV2, SessionRecord, UserRecord } from '@types'
import status from '@utils/status'

jest.mock('@services/dynamodb')
jest.mock('@services/brackets')
jest.mock('@services/sms')
jest.mock('@utils/logging', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  xrayCapture: jest.fn((x: unknown) => x),
  xrayCaptureHttps: jest.fn(),
}))

describe('close-round', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const futureExpiration = 9999999999
  const futureSession: SessionRecord = { ...session, expiration: futureExpiration }
  const user: UserRecord = { ...userRecord, expiration: futureExpiration }

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: ['fuzzy-penguin'], version: 0 })
    jest.mocked(dynamodb).getAllUsers.mockResolvedValue([user])
    jest.mocked(dynamodb).getChoices.mockResolvedValue(choicesRecord)
    jest.mocked(dynamodb).updateSession.mockResolvedValue(undefined)
    jest.mocked(dynamodb).updateUser.mockResolvedValue(undefined)
    jest.mocked(sms).sendSms.mockResolvedValue({} as any)
  })

  describe('handler', () => {
    it('should return OK with winner when only one choice remains', async () => {
      jest.mocked(brackets).advanceRound.mockReturnValueOnce({
        updatedFields: { winner: 'choice-1' },
        winner: 'choice-1',
      })
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.winner).toBe('choice-1')
    })

    it('should return OK with new round when multiple choices remain', async () => {
      jest.mocked(brackets).advanceRound.mockReturnValueOnce({
        updatedFields: {
          bracket: [...futureSession.bracket, [['choice-1', 'choice-3']]],
          byes: [null, null],
          currentRound: 1,
        },
        winner: null,
      })
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.currentRound).toBe(1)
    })

    it('should ensure votes array length matches new round count', async () => {
      const shortVotesUser: UserRecord = { ...user, votes: [] }
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([shortVotesUser])
      jest.mocked(brackets).advanceRound.mockReturnValueOnce({
        updatedFields: {
          bracket: [...futureSession.bracket, [['choice-1', 'choice-3']]],
          byes: [null, null],
          currentRound: 1,
        },
        winner: null,
      })
      await handler(event)
      expect(dynamodb.updateUser).toHaveBeenCalledWith(
        sessionId,
        shortVotesUser.userId,
        expect.objectContaining({ votes: expect.arrayContaining([expect.any(Array), expect.any(Array)]) }),
      )
    })

    it('should return current session for past rounds (idempotent)', async () => {
      const advancedSession = { ...futureSession, currentRound: 2 }
      jest
        .mocked(dynamodb)
        .getSession.mockResolvedValueOnce({ session: advancedSession, users: ['fuzzy-penguin'], version: 0 })
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.currentRound).toBe(2)
      expect(brackets.advanceRound).not.toHaveBeenCalled()
    })

    it('should return current session when winner already exists', async () => {
      const wonSession = { ...futureSession, winner: 'choice-1' }
      jest
        .mocked(dynamodb)
        .getSession.mockResolvedValueOnce({ session: wonSession, users: ['fuzzy-penguin'], version: 0 })
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.winner).toBe('choice-1')
      expect(brackets.advanceRound).not.toHaveBeenCalled()
    })

    it('should return BAD_REQUEST without errorCode when session is not ready', async () => {
      const notReadySession = { ...futureSession, isReady: false }
      jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: notReadySession, users: [], version: 0 })
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.message).toBeDefined()
      expect(body.errorCode).toBeUndefined()
    })

    it('should return BAD_REQUEST with ROUND_NOT_CURRENT when roundId does not match currentRound', async () => {
      const eventWithBadRound = {
        ...event,
        pathParameters: { ...event.pathParameters, roundId: '5' },
      } as unknown as APIGatewayProxyEventV2
      const result = await handler(eventWithBadRound)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.errorCode).toBe(ErrorCode.ROUND_NOT_CURRENT)
      expect(body.message).toBeDefined()
    })

    it('should return CONFLICT on condition expression failure', async () => {
      jest.mocked(brackets).advanceRound.mockReturnValueOnce({
        updatedFields: { winner: 'choice-1' },
        winner: 'choice-1',
      })
      jest.mocked(dynamodb).updateSession.mockRejectedValueOnce(new ConflictError('Round has already been advanced'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.CONFLICT))
    })

    it('should send SMS notifications to subscribed users on new round', async () => {
      const subscribedUser: UserRecord = { ...user, phone: '+15551234567', subscribedRounds: [1] }
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([subscribedUser])
      jest.mocked(brackets).advanceRound.mockReturnValueOnce({
        updatedFields: {
          bracket: [...futureSession.bracket, [['choice-1', 'choice-3']]],
          byes: [null, null],
          currentRound: 1,
        },
        winner: null,
      })
      await handler(event)
      expect(sms.sendSms).toHaveBeenCalledWith('+15551234567', expect.stringContaining('Round 2'))
    })

    it('should include user ID in round notification link', async () => {
      const subscribedUser: UserRecord = {
        ...user,
        userId: 'brave-tiger',
        phone: '+15551234567',
        subscribedRounds: [1],
      }
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([subscribedUser])
      jest.mocked(brackets).advanceRound.mockReturnValueOnce({
        updatedFields: {
          bracket: [...futureSession.bracket, [['choice-1', 'choice-3']]],
          byes: [null, null],
          currentRound: 1,
        },
        winner: null,
      })
      await handler(event)
      expect(sms.sendSms).toHaveBeenCalledWith('+15551234567', expect.stringContaining('?id=brave-tiger'))
    })

    it('should send winner notification with restaurant name when winner is determined', async () => {
      const subscribedUser: UserRecord = { ...user, phone: '+15551234567', subscribedRounds: [0] }
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([subscribedUser])
      jest.mocked(brackets).advanceRound.mockReturnValueOnce({
        updatedFields: { winner: 'choice-1' },
        winner: 'choice-1',
      })
      await handler(event)
      expect(sms.sendSms).toHaveBeenCalledWith('+15551234567', expect.stringContaining('Flat Branch Pub & Brewing'))
    })

    it('should include session link in winner notification', async () => {
      const subscribedUser: UserRecord = {
        ...user,
        userId: 'brave-tiger',
        phone: '+15551234567',
        subscribedRounds: [0],
      }
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([subscribedUser])
      jest.mocked(brackets).advanceRound.mockReturnValueOnce({
        updatedFields: { winner: 'choice-1' },
        winner: 'choice-1',
      })
      await handler(event)
      expect(sms.sendSms).toHaveBeenCalledWith(
        '+15551234567',
        expect.stringContaining(`https://choosee.bowland.link/s/${sessionId}?id=brave-tiger`),
      )
    })

    it('should fall back to choice ID in winner notification when choices lookup fails', async () => {
      const subscribedUser: UserRecord = { ...user, phone: '+15551234567', subscribedRounds: [0] }
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([subscribedUser])
      jest.mocked(dynamodb).getChoices.mockRejectedValueOnce(new Error('DynamoDB error'))
      jest.mocked(brackets).advanceRound.mockReturnValueOnce({
        updatedFields: { winner: 'choice-1' },
        winner: 'choice-1',
      })
      await handler(event)
      expect(sms.sendSms).toHaveBeenCalledWith('+15551234567', expect.stringContaining('choice-1'))
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

    it('should return BAD_REQUEST for invalid roundId', async () => {
      const eventWithInvalidRound = {
        ...event,
        pathParameters: { ...event.pathParameters, roundId: 'abc' },
      } as unknown as APIGatewayProxyEventV2
      const result = await handler(eventWithInvalidRound)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
    })
  })
})
