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

  it('should return the poll with participantCount and slots', async () => {
    jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: futureSession, users: [userId, 'other-user'] })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
    expect(JSON.parse((result as { body: string }).body)).toEqual({
      ...futureSession,
      participantCount: 2,
      slots: [
        { slotIndex: 0, startMinute: 960, endMinute: 1020 },
        { slotIndex: 1, startMinute: 990, endMinute: 1050 },
        { slotIndex: 2, startMinute: 1020, endMinute: 1080 },
      ],
    })
  })

  it('should return a single all-day slot for dates-only polls', async () => {
    const datesOnlySession = {
      sessionId: 'abc123',
      name: 'Trip',
      dates: ['2025-09-04', '2025-09-05'],
      usesTimes: false as const,
      timezone: 'America/Chicago',
      expiration: 9999999999,
    }
    jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: datesOnlySession, users: [] })
    const result = await handler(event)
    const body = JSON.parse((result as { body: string }).body)
    expect(body.slots).toEqual([{ slotIndex: 0, startMinute: 0, endMinute: 1440 }])
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
