import { ConditionalCheckFailedException, TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import { ConflictError, NotFoundError } from '@errors'

import { availabilityRecord, session, sessionId, userId, userRecord } from '../__mocks__'
import {
  createAvailability,
  createUser,
  getAllUsers,
  getAvailability,
  getSession,
  getUser,
  putNewSession,
  updateAvailability,
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
        Item: { Data: { S: JSON.stringify(session) }, users: { L: [{ S: userId }] } },
      })
      const result = await getSession(sessionId)
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { PK: { S: sessionId }, SK: { S: 'SESSION' } },
          TableName: 'pick-a-time-table',
        }),
      )
      expect(result).toEqual({ session, users: [userId] })
    })

    it('should default users to empty array when attribute is missing', async () => {
      mockSend.mockResolvedValueOnce({ Item: { Data: { S: JSON.stringify(session) } } })
      const result = await getSession(sessionId)
      expect(result.users).toEqual([])
    })

    it('should throw NotFoundError when Item is missing', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined })
      await expect(getSession(sessionId)).rejects.toThrow(NotFoundError)
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
            Data: { S: JSON.stringify(session) },
            expiration: { N: `${session.expiration}` },
            PK: { S: sessionId },
            SK: { S: 'SESSION' },
          },
        }),
      )
    })

    it('should throw ConflictError on ID collision', async () => {
      mockSend.mockRejectedValueOnce(new ConditionalCheckFailedException({ message: 'fail', $metadata: {} }))
      await expect(putNewSession(sessionId, session)).rejects.toThrow(ConflictError)
    })
  })

  describe('getAvailability', () => {
    it('should fetch AVAIL#<userId> record', async () => {
      mockSend.mockResolvedValueOnce({ Item: { Data: { S: JSON.stringify(availabilityRecord) } } })
      const result = await getAvailability(sessionId, userId)
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ Key: { PK: { S: sessionId }, SK: { S: `AVAIL#${userId}` } } }),
      )
      expect(result).toEqual(availabilityRecord)
    })

    it('should throw NotFoundError when Item is missing', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined })
      await expect(getAvailability(sessionId, userId)).rejects.toThrow(NotFoundError)
    })
  })

  describe('createAvailability', () => {
    it('should store AVAIL#<userId> record with attribute_not_exists condition', async () => {
      mockSend.mockResolvedValueOnce({})
      await createAvailability(sessionId, availabilityRecord)
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          ConditionExpression: 'attribute_not_exists(PK)',
          Item: {
            Data: { S: JSON.stringify(availabilityRecord) },
            expiration: { N: `${availabilityRecord.expiration}` },
            PK: { S: sessionId },
            SK: { S: `AVAIL#${userId}` },
          },
        }),
      )
    })

    it('should throw ConflictError when availability already exists', async () => {
      mockSend.mockRejectedValueOnce(new ConditionalCheckFailedException({ message: 'fail', $metadata: {} }))
      await expect(createAvailability(sessionId, availabilityRecord)).rejects.toThrow(ConflictError)
    })
  })

  describe('updateAvailability', () => {
    it('should overwrite the Data attribute', async () => {
      mockSend.mockResolvedValueOnce({})
      await updateAvailability(sessionId, userId, availabilityRecord)
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { PK: { S: sessionId }, SK: { S: `AVAIL#${userId}` } },
          UpdateExpression: 'SET #data = :data',
          ExpressionAttributeValues: { ':data': { S: JSON.stringify(availabilityRecord) } },
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
          TableName: 'pick-a-time-table',
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
          TableName: 'pick-a-time-table',
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
    it('should transact PutItem USER + PutItem AVAIL with condition + UpdateItem SESSION to append userId', async () => {
      mockSend.mockResolvedValueOnce({})

      await createUser(sessionId, userRecord, availabilityRecord)

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
                },
                TableName: 'pick-a-time-table',
              },
            },
            {
              Put: {
                ConditionExpression: 'attribute_not_exists(PK)',
                Item: {
                  Data: { S: JSON.stringify(availabilityRecord) },
                  expiration: { N: `${availabilityRecord.expiration}` },
                  PK: { S: sessionId },
                  SK: { S: `AVAIL#${userId}` },
                },
                TableName: 'pick-a-time-table',
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
                TableName: 'pick-a-time-table',
                UpdateExpression: 'SET #users = list_append(if_not_exists(#users, :emptyList), :newUser)',
              },
            },
          ],
        }),
      )
    })

    it('should throw ConflictError when user ID already exists', async () => {
      mockSend.mockRejectedValueOnce(new TransactionCanceledException({ $metadata: {}, message: 'fail' }))

      await expect(createUser(sessionId, userRecord, availabilityRecord)).rejects.toThrow(ConflictError)
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
          TableName: 'pick-a-time-table',
          UpdateExpression: 'SET #data = :data',
        }),
      )
    })
  })
})
