import { availabilityRecord, session, userId } from '../__mocks__'
import { NotFoundError } from '@errors'
import eventJson from '@events/get-availability.json'
import { handler } from '@handlers/get-availability'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  redactEvent: jest.fn((event: unknown) => event),
}))

describe('get-availability', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const futureSession = { ...session, expiration: 9999999999 }

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [userId] })
    jest.mocked(dynamodb).getAvailability.mockResolvedValue(availabilityRecord)
  })

  it('should return the availability record', async () => {
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
    const { calendarCheckedAt: _, ...visible } = availabilityRecord
    expect(JSON.parse((result as { body: string }).body)).toEqual(visible)
  })

  it('should not reveal whether this participant has a connected calendar', async () => {
    jest
      .mocked(dynamodb)
      .getAvailability.mockResolvedValueOnce({ ...availabilityRecord, calendarCheckedAt: 1_728_547_000 })

    const result = await handler(event)

    // This endpoint is unauthenticated, so it answers for any participant to anyone holding the
    // poll link. A non-null calendarCheckedAt would prove that person connected a Google calendar.
    expect(JSON.parse((result as { body: string }).body)).not.toHaveProperty('calendarCheckedAt')
  })

  it('should return NOT_FOUND when the session is expired', async () => {
    jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: { ...session, expiration: 1 }, users: [] })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
  })

  it('should return NOT_FOUND when availability does not exist', async () => {
    jest.mocked(dynamodb).getAvailability.mockRejectedValueOnce(new NotFoundError('Availability not found'))
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
  })

  it('should return INTERNAL_SERVER_ERROR on an unexpected error', async () => {
    jest.mocked(dynamodb).getAvailability.mockRejectedValueOnce(new Error('boom'))
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 500 }))
  })
})
