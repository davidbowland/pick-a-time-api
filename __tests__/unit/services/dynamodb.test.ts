import { ConditionalCheckFailedException, TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import { ConflictError, NotFoundError, RateLimitError } from '@errors'

import { choicesRecord, session, sessionId, userId, userRecord } from '../__mocks__'
import {
  createUser,
  getAllUsers,
  getChoices,
  getSession,
  getUser,
  incrementTextsSent,
  putChoices,
  putNewSession,
  putSession,
  querySession,
  updateSession,
  updateUser,
} from '@services/dynamodb'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-dynamodb', () => ({
  ConditionalCheckFailedException: class ConditionalCheckFailedException extends Error {
    name = 'ConditionalCheckFailedException'
  },
  DynamoDB: jest.fn(() => ({
    send: (...args: any[]) => mockSend(...args),
  })),
  GetItemCommand: jest.fn().mockImplementation((x) => x),
  PutItemCommand: jest.fn().mockImplementation((x) => x),
  QueryCommand: jest.fn().mockImplementation((x) => x),
  TransactionCanceledException: class TransactionCanceledException extends Error {
    name = 'TransactionCanceledException'
  },
  TransactWriteItemsCommand: jest.fn().mockImplementation((x) => x),
  UpdateItemCommand: jest.fn().mockImplementation((x) => x),
}))
jest.mock('@utils/logging', () => ({
  xrayCapture: jest.fn().mockImplementation((x) => x),
}))

describe('dynamodb', () => {
  describe('getSession', () => {
    it('should fetch SESSION record by composite key', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          Data: { S: JSON.stringify(session) },
          version: { N: '3' },
          users: { L: [{ S: 'fuzzy-penguin' }] },
        },
      })

      const result = await getSession(sessionId)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: {
            PK: { S: sessionId },
            SK: { S: 'SESSION' },
          },
          TableName: 'choosee-table',
        }),
      )
      expect(result).toEqual({ session, users: ['fuzzy-penguin'], version: 3 })
    })

    it('should default version to 0 when attribute is missing', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          Data: { S: JSON.stringify(session) },
          users: { L: [{ S: 'fuzzy-penguin' }] },
        },
      })

      const result = await getSession(sessionId)
      expect(result).toEqual({ session, users: ['fuzzy-penguin'], version: 0 })
    })

    it('should default users to empty array when attribute is missing', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { Data: { S: JSON.stringify(session) }, version: { N: '1' } },
      })

      const result = await getSession(sessionId)
      expect(result.users).toEqual([])
    })

    it('should throw NotFoundError when Item is missing', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined })

      await expect(getSession(sessionId)).rejects.toThrow(NotFoundError)
    })
  })

  describe('putSession', () => {
    it('should store SESSION record with currentRound, expiration, and version as top-level attributes', async () => {
      mockSend.mockResolvedValueOnce({})

      await putSession(sessionId, session)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: {
            currentRound: { N: `${session.currentRound}` },
            Data: { S: JSON.stringify(session) },
            expiration: { N: `${session.expiration}` },
            PK: { S: sessionId },
            SK: { S: 'SESSION' },
            version: { N: '0' },
          },
          TableName: 'choosee-table',
        }),
      )
    })
  })

  describe('putNewSession', () => {
    it('should store SESSION record with attribute_not_exists condition', async () => {
      mockSend.mockResolvedValueOnce({})

      await putNewSession(sessionId, session)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          ConditionExpression: 'attribute_not_exists(PK)',
          Item: {
            currentRound: { N: `${session.currentRound}` },
            Data: { S: JSON.stringify(session) },
            expiration: { N: `${session.expiration}` },
            PK: { S: sessionId },
            SK: { S: 'SESSION' },
            version: { N: '0' },
          },
          TableName: 'choosee-table',
        }),
      )
    })

    it('should throw ConflictError when session ID already exists', async () => {
      mockSend.mockRejectedValueOnce(new ConditionalCheckFailedException({ $metadata: {}, message: 'fail' }))

      await expect(putNewSession(sessionId, session)).rejects.toThrow(ConflictError)
    })

    it('should rethrow non-condition errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('network error'))

      await expect(putNewSession(sessionId, session)).rejects.toThrow('network error')
    })
  })

  describe('updateSession', () => {
    const updatedSession = { ...session, currentRound: 1 }

    it('should update with condition expression on version', async () => {
      mockSend.mockResolvedValueOnce({})

      await updateSession(sessionId, 0, updatedSession)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          ConditionExpression: '#version = :expectedVersion',
          ExpressionAttributeNames: {
            '#currentRound': 'currentRound',
            '#data': 'Data',
            '#version': 'version',
          },
          ExpressionAttributeValues: {
            ':data': { S: JSON.stringify(updatedSession) },
            ':expectedVersion': { N: '0' },
            ':newRound': { N: '1' },
            ':newVersion': { N: '1' },
          },
          Key: {
            PK: { S: sessionId },
            SK: { S: 'SESSION' },
          },
          TableName: 'choosee-table',
          UpdateExpression: 'SET #data = :data, #currentRound = :newRound, #version = :newVersion',
        }),
      )
    })

    it('should return the new version number', async () => {
      mockSend.mockResolvedValueOnce({})

      const newVersion = await updateSession(sessionId, 5, updatedSession)
      expect(newVersion).toBe(6)
    })

    it('should not include version in the stored Data blob', async () => {
      mockSend.mockResolvedValueOnce({})

      await updateSession(sessionId, 0, updatedSession)

      const call = mockSend.mock.calls[mockSend.mock.calls.length - 1][0]
      const storedData = JSON.parse(call.ExpressionAttributeValues[':data'].S)
      expect(storedData.version).toBeUndefined()
    })

    it('should throw ConflictError when condition expression fails', async () => {
      mockSend.mockRejectedValueOnce(new ConditionalCheckFailedException({ $metadata: {}, message: 'fail' }))

      await expect(updateSession(sessionId, 0, updatedSession)).rejects.toThrow(ConflictError)
    })

    it('should rethrow non-condition errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('network error'))

      await expect(updateSession(sessionId, 0, updatedSession)).rejects.toThrow('network error')
    })
  })

  describe('getChoices', () => {
    it('should fetch CHOICES record by composite key', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { Data: { S: JSON.stringify(choicesRecord) } },
      })

      const result = await getChoices(sessionId)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: {
            PK: { S: sessionId },
            SK: { S: 'CHOICES' },
          },
          TableName: 'choosee-table',
        }),
      )
      expect(result).toEqual(choicesRecord)
    })

    it('should throw NotFoundError when Item is missing', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined })

      await expect(getChoices(sessionId)).rejects.toThrow(NotFoundError)
    })
  })

  describe('putChoices', () => {
    it('should store CHOICES record with expiration', async () => {
      mockSend.mockResolvedValueOnce({})

      await putChoices(sessionId, choicesRecord)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: {
            Data: { S: JSON.stringify(choicesRecord) },
            expiration: { N: `${choicesRecord.expiration}` },
            PK: { S: sessionId },
            SK: { S: 'CHOICES' },
          },
          TableName: 'choosee-table',
        }),
      )
    })
  })

  describe('getUser', () => {
    it('should fetch USER record by composite key', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { Data: { S: JSON.stringify(userRecord) } },
      })

      const result = await getUser(sessionId, userId)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: {
            PK: { S: sessionId },
            SK: { S: `USER#${userId}` },
          },
          TableName: 'choosee-table',
        }),
      )
      expect(result).toEqual(userRecord)
    })

    it('should throw NotFoundError when Item is missing', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined })

      await expect(getUser(sessionId, userId)).rejects.toThrow(NotFoundError)
    })
  })

  describe('getAllUsers', () => {
    it('should query all USER records with begins_with on SK', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [{ Data: { S: JSON.stringify(userRecord) } }],
      })

      const result = await getAllUsers(sessionId)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          ExpressionAttributeValues: {
            ':pk': { S: sessionId },
            ':skPrefix': { S: 'USER#' },
          },
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
          TableName: 'choosee-table',
        }),
      )
      expect(result).toEqual([userRecord])
    })

    it('should return empty array when no users exist', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] })

      const result = await getAllUsers(sessionId)

      expect(result).toEqual([])
    })
  })

  describe('createUser', () => {
    it('should transact PutItem USER with condition + UpdateItem SESSION to append userId', async () => {
      mockSend.mockResolvedValueOnce({})

      await createUser(sessionId, userRecord)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          TransactItems: [
            {
              Put: {
                ConditionExpression: 'attribute_not_exists(PK)',
                Item: {
                  Data: { S: JSON.stringify(userRecord) },
                  expiration: { N: `${userRecord.expiration}` },
                  PK: { S: sessionId },
                  SK: { S: `USER#${userId}` },
                  textsSent: { N: `${userRecord.textsSent}` },
                },
                TableName: 'choosee-table',
              },
            },
            {
              Update: {
                ExpressionAttributeNames: { '#users': 'users' },
                ExpressionAttributeValues: {
                  ':emptyList': { L: [] },
                  ':newUser': { L: [{ S: userId }] },
                },
                Key: {
                  PK: { S: sessionId },
                  SK: { S: 'SESSION' },
                },
                TableName: 'choosee-table',
                UpdateExpression: 'SET #users = list_append(if_not_exists(#users, :emptyList), :newUser)',
              },
            },
          ],
        }),
      )
    })

    it('should throw ConflictError when user ID already exists', async () => {
      mockSend.mockRejectedValueOnce(new TransactionCanceledException({ $metadata: {}, message: 'fail' }))

      await expect(createUser(sessionId, userRecord)).rejects.toThrow(ConflictError)
    })
  })

  describe('updateUser', () => {
    it('should update USER record Data attribute with full user', async () => {
      const updatedUser = { ...userRecord, name: 'Test User' }
      mockSend.mockResolvedValueOnce({})

      await updateUser(sessionId, userId, updatedUser)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          ExpressionAttributeNames: { '#data': 'Data' },
          ExpressionAttributeValues: {
            ':data': { S: JSON.stringify(updatedUser) },
          },
          Key: {
            PK: { S: sessionId },
            SK: { S: `USER#${userId}` },
          },
          TableName: 'choosee-table',
          UpdateExpression: 'SET #data = :data',
        }),
      )
    })
  })

  describe('incrementTextsSent', () => {
    it('should increment textsSent with condition textsSent < limit', async () => {
      mockSend.mockResolvedValueOnce({})

      await incrementTextsSent(sessionId, userId, 5)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          ConditionExpression: '#textsSent < :limit',
          ExpressionAttributeNames: { '#textsSent': 'textsSent' },
          ExpressionAttributeValues: {
            ':increment': { N: '1' },
            ':limit': { N: '5' },
          },
          Key: {
            PK: { S: sessionId },
            SK: { S: `USER#${userId}` },
          },
          TableName: 'choosee-table',
          UpdateExpression: 'SET #textsSent = #textsSent + :increment',
        }),
      )
    })

    it('should throw RateLimitError when condition fails (at cap)', async () => {
      mockSend.mockRejectedValueOnce(new ConditionalCheckFailedException({ $metadata: {}, message: 'fail' }))

      await expect(incrementTextsSent(sessionId, userId, 5)).rejects.toThrow(RateLimitError)
    })

    it('should rethrow non-condition errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('network error'))

      await expect(incrementTextsSent(sessionId, userId, 5)).rejects.toThrow('network error')
    })
  })

  describe('querySession', () => {
    it('should query all items in a session partition', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { Data: { S: JSON.stringify(session) } },
          { Data: { S: JSON.stringify(choicesRecord) } },
          { Data: { S: JSON.stringify(userRecord) } },
        ],
      })

      const result = await querySession(sessionId)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          ExpressionAttributeValues: {
            ':pk': { S: sessionId },
          },
          KeyConditionExpression: 'PK = :pk',
          TableName: 'choosee-table',
        }),
      )
      expect(result).toEqual([session, choicesRecord, userRecord])
    })

    it('should return empty array when session has no items', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] })

      const result = await querySession(sessionId)

      expect(result).toEqual([])
    })
  })
})
