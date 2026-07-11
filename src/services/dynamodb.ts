import {
  ConditionalCheckFailedException,
  DynamoDB,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  TransactionCanceledException,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb'

import { dynamodbTableName } from '../config'
import { ConflictError, NotFoundError, RateLimitError } from '../errors'
import { AvailabilityRecord, PlanRecord, SessionWithUsers, UserRecord } from '../types'
import { xrayCapture } from '../utils/logging'

const dynamodb = xrayCapture(new DynamoDB({ apiVersion: '2012-08-10' }))

/* Session (Plan) */

export const getSession = async (sessionId: string): Promise<SessionWithUsers> => {
  const command = new GetItemCommand({
    Key: { PK: { S: sessionId }, SK: { S: 'SESSION' } },
    TableName: dynamodbTableName,
  })
  const response = await dynamodb.send(command)
  if (!response.Item?.Data?.S) {
    throw new NotFoundError('Session not found')
  }
  const session: PlanRecord = JSON.parse(response.Item.Data.S)
  const users = response.Item.users?.L?.map((item: { S: string }) => item.S) ?? []
  return { session, users }
}

export const putNewSession = async (sessionId: string, session: PlanRecord): Promise<void> => {
  const command = new PutItemCommand({
    ConditionExpression: 'attribute_not_exists(PK)',
    Item: {
      Data: { S: JSON.stringify(session) },
      expiration: { N: `${session.expiration}` },
      PK: { S: sessionId },
      SK: { S: 'SESSION' },
    },
    TableName: dynamodbTableName,
  })
  try {
    await dynamodb.send(command)
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      throw new ConflictError('Session ID already exists')
    }
    throw error
  }
}

/* Availability */

export const getAvailability = async (sessionId: string, userId: string): Promise<AvailabilityRecord> => {
  const command = new GetItemCommand({
    Key: { PK: { S: sessionId }, SK: { S: `AVAIL#${userId}` } },
    TableName: dynamodbTableName,
  })
  const response = await dynamodb.send(command)
  if (!response.Item?.Data?.S) {
    throw new NotFoundError('Availability not found')
  }
  return JSON.parse(response.Item.Data.S)
}

export const createAvailability = async (sessionId: string, availability: AvailabilityRecord): Promise<void> => {
  const command = new PutItemCommand({
    ConditionExpression: 'attribute_not_exists(PK)',
    Item: {
      Data: { S: JSON.stringify(availability) },
      expiration: { N: `${availability.expiration}` },
      PK: { S: sessionId },
      SK: { S: `AVAIL#${availability.userId}` },
    },
    TableName: dynamodbTableName,
  })
  try {
    await dynamodb.send(command)
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      throw new ConflictError('Availability already exists for this user')
    }
    throw error
  }
}

export const updateAvailability = async (
  sessionId: string,
  userId: string,
  availability: AvailabilityRecord,
): Promise<void> => {
  const command = new UpdateItemCommand({
    ExpressionAttributeNames: { '#data': 'Data' },
    ExpressionAttributeValues: { ':data': { S: JSON.stringify(availability) } },
    Key: { PK: { S: sessionId }, SK: { S: `AVAIL#${userId}` } },
    TableName: dynamodbTableName,
    UpdateExpression: 'SET #data = :data',
  })
  await dynamodb.send(command)
}

/* Users */

export const getUser = async (sessionId: string, userId: string): Promise<UserRecord> => {
  const command = new GetItemCommand({
    Key: {
      PK: { S: sessionId },
      SK: { S: `USER#${userId}` },
    },
    TableName: dynamodbTableName,
  })
  const response = await dynamodb.send(command)
  if (!response.Item?.Data?.S) {
    throw new NotFoundError('User not found')
  }
  return JSON.parse(response.Item.Data.S)
}

export const getAllUsers = async (sessionId: string): Promise<UserRecord[]> => {
  const command = new QueryCommand({
    ExpressionAttributeValues: {
      ':pk': { S: sessionId },
      ':skPrefix': { S: 'USER#' },
    },
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    TableName: dynamodbTableName,
  })
  const response = await dynamodb.send(command)
  return (response.Items ?? []).map((item: { Data: { S: string } }) => JSON.parse(item.Data.S))
}

export const createUser = async (
  sessionId: string,
  user: UserRecord,
  availability: AvailabilityRecord,
): Promise<void> => {
  const command = new TransactWriteItemsCommand({
    TransactItems: [
      {
        Put: {
          ConditionExpression: 'attribute_not_exists(PK)',
          Item: {
            Data: { S: JSON.stringify(user) },
            expiration: { N: `${user.expiration}` },
            PK: { S: sessionId },
            SK: { S: `USER#${user.userId}` },
            textsSent: { N: `${user.textsSent}` },
          },
          TableName: dynamodbTableName,
        },
      },
      {
        Put: {
          ConditionExpression: 'attribute_not_exists(PK)',
          Item: {
            Data: { S: JSON.stringify(availability) },
            expiration: { N: `${availability.expiration}` },
            PK: { S: sessionId },
            SK: { S: `AVAIL#${availability.userId}` },
          },
          TableName: dynamodbTableName,
        },
      },
      {
        Update: {
          ExpressionAttributeNames: { '#users': 'users' },
          ExpressionAttributeValues: {
            ':emptyList': { L: [] },
            ':newUser': { L: [{ S: user.userId }] },
          },
          Key: {
            PK: { S: sessionId },
            SK: { S: 'SESSION' },
          },
          TableName: dynamodbTableName,
          UpdateExpression: 'SET #users = list_append(if_not_exists(#users, :emptyList), :newUser)',
        },
      },
    ],
  })
  try {
    await dynamodb.send(command)
  } catch (error) {
    if (error instanceof TransactionCanceledException) {
      throw new ConflictError('User ID already exists')
    }
    throw error
  }
}

export const updateUser = async (sessionId: string, userId: string, user: UserRecord): Promise<void> => {
  const command = new UpdateItemCommand({
    ExpressionAttributeNames: { '#data': 'Data' },
    ExpressionAttributeValues: {
      ':data': { S: JSON.stringify(user) },
    },
    Key: {
      PK: { S: sessionId },
      SK: { S: `USER#${userId}` },
    },
    TableName: dynamodbTableName,
    UpdateExpression: 'SET #data = :data',
  })
  await dynamodb.send(command)
}

/**
 * Atomically increment textsSent if below the limit.
 * Throws RateLimitError if the user has already hit the cap.
 */
export const incrementTextsSent = async (sessionId: string, userId: string, limit: number): Promise<void> => {
  const command = new UpdateItemCommand({
    ConditionExpression: '#textsSent < :limit',
    ExpressionAttributeNames: {
      '#textsSent': 'textsSent',
    },
    ExpressionAttributeValues: {
      ':increment': { N: '1' },
      ':limit': { N: `${limit}` },
    },
    Key: {
      PK: { S: sessionId },
      SK: { S: `USER#${userId}` },
    },
    TableName: dynamodbTableName,
    UpdateExpression: 'SET #textsSent = #textsSent + :increment',
  })

  try {
    await dynamodb.send(command)
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      throw new RateLimitError('SMS rate limit exceeded')
    }
    throw error
  }
}
