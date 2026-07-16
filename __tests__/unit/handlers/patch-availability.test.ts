import { NotFoundError } from '@errors'

import { availabilityRecord, session, sessionId, userId } from '../__mocks__'
import eventJson from '@events/patch-availability.json'
import { handler } from '@handlers/patch-availability'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging', () => ({ log: jest.fn(), logError: jest.fn(), xrayCapture: jest.fn((x: unknown) => x) }))

// Deep-cloning helper so each test gets its own grid — the handler mutates `availability.free`
// in place, and reusing the same nested arrays across tests via a shallow `{ ...availabilityRecord }`
// would leak mutations from one test into the next.
const cloneGrid = (grid: boolean[][]): boolean[][] => grid.map((row) => row.slice())

describe('patch-availability', () => {
  const baseEvent = eventJson as unknown as APIGatewayProxyEventV2
  const futureSession = { ...session, expiration: 9999999999 } // 3 dates x 3 slots

  const withBody = (body: unknown): APIGatewayProxyEventV2 =>
    ({ ...baseEvent, body: JSON.stringify(body) }) as unknown as APIGatewayProxyEventV2

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [userId] })
    jest.mocked(dynamodb).getAvailability.mockImplementation(async () => ({
      userId,
      expiration: availabilityRecord.expiration,
      free: cloneGrid(availabilityRecord.free),
    }))
    jest.mocked(dynamodb).updateAvailability.mockResolvedValue(undefined)
  })

  it('should write a cell into the free grid', async () => {
    const event = withBody({ cells: [{ dateIndex: 0, slotIndex: 0, value: true }] })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
    expect(dynamodb.updateAvailability).toHaveBeenCalledWith(
      sessionId,
      userId,
      expect.objectContaining({
        free: [
          [true, false, false],
          [true, true, false],
          [true, true, true],
        ],
      }),
    )
  })

  it('should write multiple cells in one call', async () => {
    const event = withBody({
      cells: [
        { dateIndex: 2, slotIndex: 0, value: false },
        { dateIndex: 0, slotIndex: 1, value: true },
      ],
    })
    await handler(event)
    expect(dynamodb.updateAvailability).toHaveBeenCalledWith(
      sessionId,
      userId,
      expect.objectContaining({
        free: [
          [false, true, false],
          [true, true, false],
          [false, true, true],
        ],
      }),
    )
  })

  it('should return BAD_REQUEST when a cell dateIndex is out of bounds', async () => {
    const event = withBody({ cells: [{ dateIndex: 99, slotIndex: 0, value: true }] })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
  })

  it('should return BAD_REQUEST when a cell slotIndex is out of bounds', async () => {
    const event = withBody({ cells: [{ dateIndex: 0, slotIndex: 99, value: true }] })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
  })

  it('should return BAD_REQUEST for a slotIndex valid on one date but out of bounds on a narrower-override date', async () => {
    const overrideSession = {
      ...futureSession,
      overrides: [{ dates: ['2025-09-06'], startMinute: 960, endMinute: 1020 }], // Saturday: 1 slot only
    }
    jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: overrideSession, users: [userId] })
    // slotIndex 1 is valid on dateIndex 0/1 (3 slots each) but out of bounds on dateIndex 2 (1 slot)
    const event = withBody({ cells: [{ dateIndex: 2, slotIndex: 1, value: true }] })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
  })

  it('should return NOT_FOUND when availability does not exist', async () => {
    jest.mocked(dynamodb).getAvailability.mockRejectedValueOnce(new NotFoundError('Availability not found'))
    const event = withBody({ cells: [{ dateIndex: 0, slotIndex: 0, value: true }] })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
  })

  it('should return NOT_FOUND when the session is expired', async () => {
    jest
      .mocked(dynamodb)
      .getSession.mockResolvedValueOnce({ session: { ...futureSession, expiration: 1 }, users: [userId] })
    const event = withBody({ cells: [{ dateIndex: 0, slotIndex: 0, value: true }] })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
  })

  it('should return INTERNAL_SERVER_ERROR on an unexpected error', async () => {
    jest.mocked(dynamodb).getAvailability.mockRejectedValueOnce(new Error('boom'))
    const event = withBody({ cells: [{ dateIndex: 0, slotIndex: 0, value: true }] })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 500 }))
  })
})
