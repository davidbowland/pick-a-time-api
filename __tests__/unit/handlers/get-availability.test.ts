import { availabilityRecord, session, userId } from '../__mocks__'
import { NotFoundError } from '@errors'
import eventJson from '@events/get-availability.json'
import { handler } from '@handlers/get-availability'
import * as dynamodb from '@services/dynamodb'
import * as googleCalendar from '@services/google-calendar'
import { APIGatewayProxyEventV2 } from '@types'

jest.mock('@services/dynamodb')
// Deliberately NOT mocking @services/availability: the record read this route delegates to is the
// half of the route that could reach Google, so the assertions below only mean something with the
// real service in the loop.
jest.mock('@services/google-calendar')
jest.mock('@utils/logging', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  redactEvent: jest.fn((event: unknown) => event),
}))

describe('get-availability', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const futureSession = { ...session, expiration: 9999999999 }
  const { calendarCheckedAt: _, ...visible } = availabilityRecord
  const connectionCases: [string, number | null][] = [
    ['a connected calendar', 1_728_547_000],
    ['no connected calendar', null],
  ]

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [userId] })
    jest.mocked(dynamodb).getAvailability.mockResolvedValue(availabilityRecord)
  })

  it('should return the availability record', async () => {
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
  })

  // Byte-level, not shape-level. Moving the read behind a service is only safe if every client
  // already parsing this body sees the same bytes it saw before -- same keys, same order, nothing
  // added. An equality check on the parsed object would pass while a new key or a reordered one
  // sailed through.
  it('should serialize exactly the stripped record and nothing else', async () => {
    const result = await handler(event)
    expect((result as { body: string }).body).toBe(JSON.stringify(visible))
  })

  // This endpoint is unauthenticated, so it answers for any participant to anyone holding the poll
  // link. Both halves matter: a non-null calendarCheckedAt in the body would prove that person
  // connected a Google calendar, and a Google round-trip on only one of the two would prove the
  // same thing by how long the answer took.
  it.each(connectionCases)('should answer identically for %s', async (_label, calendarCheckedAt) => {
    jest.mocked(dynamodb).getAvailability.mockResolvedValueOnce({ ...availabilityRecord, calendarCheckedAt })

    const result = await handler(event)

    expect((result as { body: string }).body).toBe(JSON.stringify(visible))
    expect(JSON.parse((result as { body: string }).body)).not.toHaveProperty('calendarCheckedAt')
    expect(googleCalendar.refreshAccessToken).not.toHaveBeenCalled()
    expect(googleCalendar.fetchFreeBusy).not.toHaveBeenCalled()
    expect(dynamodb.getCalendarAccount).not.toHaveBeenCalled()
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
