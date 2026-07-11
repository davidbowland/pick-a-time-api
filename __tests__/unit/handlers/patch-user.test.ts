import { ConflictError, ErrorCode, NotFoundError, ValidationError } from '@errors'

import { choicesRecord, session, userRecord } from '../__mocks__'
import eventJson from '@events/patch-user.json'
import { handler } from '@handlers/patch-user'
import * as brackets from '@services/brackets'
import * as dynamodb from '@services/dynamodb'
import * as sms from '@services/sms'
import { APIGatewayProxyEventV2 } from '@types'
import * as events from '@utils/events'
import status from '@utils/status'

jest.mock('@services/brackets')
jest.mock('@services/dynamodb')
jest.mock('@services/sms')
jest.mock('@utils/events')
jest.mock('@utils/logging', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  xrayCapture: jest.fn((x: unknown) => x),
  xrayCaptureHttps: jest.fn(),
}))

describe('patch-user', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const futureExpiration = 9999999999
  const futureSession = { ...session, expiration: futureExpiration }
  const futureUser = { ...userRecord, expiration: futureExpiration }

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: ['fuzzy-penguin'], version: 0 })
    jest.mocked(dynamodb).getUser.mockResolvedValue(futureUser)
    jest.mocked(dynamodb).getAllUsers.mockResolvedValue([futureUser])
    jest.mocked(dynamodb).updateUser.mockResolvedValue(undefined)
    jest.mocked(dynamodb).updateSession.mockResolvedValue(undefined)
    jest.mocked(dynamodb).getChoices.mockResolvedValue(choicesRecord)
    jest.mocked(events).parseUserPatch.mockReturnValue([{ op: 'replace', path: '/name', value: 'Alice' }])
    jest.mocked(brackets).shouldAutoAdvance.mockReturnValue(false)
    jest.mocked(brackets).countVotersSubmitted.mockReturnValue(0)
    jest.mocked(sms).sendSms.mockResolvedValue({} as any)
  })

  describe('handler', () => {
    it('should return OK with updated user after name patch', async () => {
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.name).toBe('Alice')
      expect(body.googleSub).toBeUndefined()
    })

    it('should return OK with updated user after phone patch', async () => {
      jest.mocked(events).parseUserPatch.mockReturnValueOnce([{ op: 'replace', path: '/phone', value: '+15551234567' }])
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.phone).toBe('+15551234567')
    })

    it('should return OK with updated votes after vote submission', async () => {
      jest.mocked(events).parseUserPatch.mockReturnValueOnce([{ op: 'replace', path: '/votes/0/0', value: 'choice-1' }])
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.votes[0][0]).toBe('choice-1')
    })

    it('should handle test ops correctly without modifying data', async () => {
      const userWithName = { ...futureUser, name: 'Alice' }
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce(userWithName)
      jest.mocked(events).parseUserPatch.mockReturnValueOnce([{ op: 'test', path: '/name', value: 'Alice' }])
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.name).toBe('Alice')
    })

    it('should validate test ops on vote paths against bracket matchup', async () => {
      jest
        .mocked(events)
        .parseUserPatch.mockReturnValueOnce([{ op: 'test', path: '/votes/0/0', value: 'invalid-choice' }])
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
      expect(JSON.parse((result as { body: string }).body).message).toContain('invalid-choice')
    })

    it('should return BAD_REQUEST when parseUserPatch throws ValidationError', async () => {
      jest.mocked(events).parseUserPatch.mockImplementationOnce(() => {
        throw new ValidationError('disallowed patch path: /sessionId')
      })
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
    })

    it('should return BAD_REQUEST when vote choice is not in matchup', async () => {
      jest
        .mocked(events)
        .parseUserPatch.mockReturnValueOnce([{ op: 'replace', path: '/votes/0/0', value: 'invalid-choice' }])
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
      expect(JSON.parse((result as { body: string }).body).message).toContain('invalid-choice')
    })

    it('should return BAD_REQUEST when voting in wrong round', async () => {
      jest.mocked(events).parseUserPatch.mockReturnValueOnce([{ op: 'replace', path: '/votes/5/0', value: 'choice-1' }])
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.message).toContain('current round')
      expect(body.errorCode).toBe(ErrorCode.ROUND_NOT_CURRENT)
    })

    it('should return BAD_REQUEST when matchup index is out of bounds', async () => {
      jest
        .mocked(events)
        .parseUserPatch.mockReturnValueOnce([{ op: 'replace', path: '/votes/0/99', value: 'choice-1' }])
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.message).toContain('Invalid matchup index')
      expect(body.errorCode).toBeUndefined()
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

    it('should call getUser instead of getAllUsers for initial user fetch', async () => {
      await handler(event)
      expect(dynamodb.getUser).toHaveBeenCalledWith('abc123', 'fuzzy-penguin')
    })

    it('should return BAD_REQUEST when test op fails', async () => {
      const userWithName = { ...futureUser, name: 'Alice' }
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce(userWithName)
      jest.mocked(events).parseUserPatch.mockReturnValueOnce([{ op: 'test', path: '/name', value: 'wrong-name' }])
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
    })

    it('should trigger auto-advance when all users have voted', async () => {
      jest.mocked(events).parseUserPatch.mockReturnValueOnce([{ op: 'replace', path: '/votes/0/0', value: 'choice-1' }])
      jest.mocked(brackets).shouldAutoAdvance.mockReturnValueOnce(true)
      jest.mocked(brackets).advanceRound.mockReturnValueOnce({
        updatedFields: {
          currentRound: 1,
          bracket: [...futureSession.bracket, [['choice-1', 'choice-3']]],
          byes: [null, null],
        },
        winner: null,
      })

      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
      expect(dynamodb.updateSession).toHaveBeenCalledWith('abc123', 0, expect.objectContaining({ currentRound: 1 }))
    })

    it('should call updateUser for each user to initialize new round vote arrays on advance', async () => {
      const user2 = { ...futureUser, userId: 'clever-fox', votes: [[null, null]] }
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([futureUser, user2])
      jest.mocked(events).parseUserPatch.mockReturnValueOnce([{ op: 'replace', path: '/votes/0/0', value: 'choice-1' }])
      jest.mocked(brackets).shouldAutoAdvance.mockReturnValueOnce(true)
      jest.mocked(brackets).advanceRound.mockReturnValueOnce({
        updatedFields: {
          currentRound: 1,
          bracket: [...futureSession.bracket, [['choice-1', 'choice-3']]],
          byes: [null, null],
        },
        winner: null,
      })

      await handler(event)
      const updateCalls = jest.mocked(dynamodb).updateUser.mock.calls
      const lastCalls = updateCalls.slice(-2)
      expect(lastCalls).toEqual(
        expect.arrayContaining([
          expect.arrayContaining(['abc123', 'fuzzy-penguin']),
          expect.arrayContaining(['abc123', 'clever-fox']),
        ]),
      )
    })

    it('should set winner when auto-advance determines a winner', async () => {
      jest.mocked(events).parseUserPatch.mockReturnValueOnce([{ op: 'replace', path: '/votes/0/0', value: 'choice-1' }])
      jest.mocked(brackets).shouldAutoAdvance.mockReturnValueOnce(true)
      jest.mocked(brackets).advanceRound.mockReturnValueOnce({
        updatedFields: { winner: 'choice-1' },
        winner: 'choice-1',
      })

      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
      expect(dynamodb.updateSession).toHaveBeenCalledWith('abc123', 0, expect.objectContaining({ winner: 'choice-1' }))
    })

    it('should not call updateUser for vote init when winner is determined', async () => {
      jest.mocked(events).parseUserPatch.mockReturnValueOnce([{ op: 'replace', path: '/votes/0/0', value: 'choice-1' }])
      jest.mocked(brackets).shouldAutoAdvance.mockReturnValueOnce(true)
      jest.mocked(brackets).advanceRound.mockReturnValueOnce({
        updatedFields: { winner: 'choice-1' },
        winner: 'choice-1',
      })

      const updateCountBefore = jest.mocked(dynamodb).updateUser.mock.calls.length
      await handler(event)
      // Only the initial user update from the patch, no vote-init updates
      expect(jest.mocked(dynamodb).updateUser.mock.calls.length - updateCountBefore).toBe(1)
    })

    it('should send winner notification with restaurant name on auto-advance', async () => {
      const subscribedUser = { ...futureUser, phone: '+15559876543', subscribedRounds: [0] }
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce(subscribedUser)
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([subscribedUser])
      jest.mocked(events).parseUserPatch.mockReturnValueOnce([{ op: 'replace', path: '/votes/0/0', value: 'choice-1' }])
      jest.mocked(brackets).shouldAutoAdvance.mockReturnValueOnce(true)
      jest.mocked(brackets).advanceRound.mockReturnValueOnce({
        updatedFields: { winner: 'choice-1' },
        winner: 'choice-1',
      })

      await handler(event)
      expect(sms.sendSms).toHaveBeenCalledWith('+15559876543', expect.stringContaining('Flat Branch Pub & Brewing'))
    })

    it('should send SMS to subscribed users on auto-advance to new round', async () => {
      const subscribedUser = { ...futureUser, phone: '+15559876543', subscribedRounds: [1] }
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce(subscribedUser)
      jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([subscribedUser])
      jest.mocked(events).parseUserPatch.mockReturnValueOnce([{ op: 'replace', path: '/votes/0/0', value: 'choice-1' }])
      jest.mocked(brackets).shouldAutoAdvance.mockReturnValueOnce(true)
      jest.mocked(brackets).advanceRound.mockReturnValueOnce({
        updatedFields: {
          currentRound: 1,
          bracket: [...futureSession.bracket, [['choice-1', 'choice-3']]],
          byes: [null, null],
        },
        winner: null,
      })

      await handler(event)
      expect(sms.sendSms).toHaveBeenCalledWith('+15559876543', expect.stringContaining('Round 2'))
    })

    it('should not crash when auto-advance hits a conflict error', async () => {
      jest.mocked(events).parseUserPatch.mockReturnValueOnce([{ op: 'replace', path: '/votes/0/0', value: 'choice-1' }])
      jest.mocked(brackets).shouldAutoAdvance.mockReturnValueOnce(true)
      jest.mocked(brackets).advanceRound.mockReturnValueOnce({
        updatedFields: { currentRound: 1 },
        winner: null,
      })
      jest.mocked(dynamodb).updateSession.mockRejectedValueOnce(new ConflictError('Round already advanced'))

      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
    })

    it('should return INTERNAL_SERVER_ERROR on unexpected errors', async () => {
      jest.mocked(dynamodb).getSession.mockRejectedValueOnce(new Error('DynamoDB error'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.INTERNAL_SERVER_ERROR))
    })

    it('should overwrite existing vote', async () => {
      const userWithVote = { ...futureUser, votes: [['choice-2', null]] }
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce(userWithVote)
      jest.mocked(events).parseUserPatch.mockReturnValueOnce([{ op: 'replace', path: '/votes/0/0', value: 'choice-1' }])

      const result = await handler(event)
      const body = JSON.parse((result as { body: string }).body)
      expect(body.votes[0][0]).toBe('choice-1')
    })

    it('should not mutate the original user object when applying patch', async () => {
      const originalVotes = [['choice-2', null] as (string | null)[]]
      const userWithVote = { ...futureUser, votes: originalVotes }
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce(userWithVote)
      jest.mocked(events).parseUserPatch.mockReturnValueOnce([{ op: 'replace', path: '/votes/0/0', value: 'choice-1' }])

      await handler(event)
      expect(originalVotes[0][0]).toBe('choice-2')
    })
  })
})
