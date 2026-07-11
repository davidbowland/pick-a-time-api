import { NotFoundError } from '@errors'

import { availabilityRecord, session, sessionId, userId } from '../__mocks__'
import eventJson from '@events/patch-availability.json'
import { handler } from '@handlers/patch-availability'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging', () => ({ log: jest.fn(), logError: jest.fn(), xrayCapture: jest.fn((x: unknown) => x) }))

// Deep-cloning helper so each test gets its own grid — the handler mutates
// `availability.template`/`.overrides` in place, and reusing the same nested
// arrays across tests via a shallow `{ ...availabilityRecord }` would leak
// mutations from one test into the next.
const cloneGrid = (grid: boolean[][]): boolean[][] => grid.map((row) => row.slice())

describe('patch-availability', () => {
  const baseEvent = eventJson as unknown as APIGatewayProxyEventV2
  const futureSession = { ...session, expiration: 9999999999 } // endHour-startHour=4, weekdays.length=3

  const withBody = (body: unknown): APIGatewayProxyEventV2 =>
    ({ ...baseEvent, body: JSON.stringify(body) }) as unknown as APIGatewayProxyEventV2

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [userId] })
    jest.mocked(dynamodb).getAvailability.mockImplementation(async () => ({
      userId,
      expiration: availabilityRecord.expiration,
      overrides: {},
      template: cloneGrid(availabilityRecord.template),
    }))
    jest.mocked(dynamodb).updateAvailability.mockResolvedValue(undefined)
  })

  it('should write a cell into the template when weekIndex is null', async () => {
    const event = withBody({
      weekIndex: null,
      cells: [{ hourIndex: 0, dayIndex: 0, value: true }],
      resetToPattern: false,
    })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
    expect(dynamodb.updateAvailability).toHaveBeenCalledWith(
      sessionId,
      userId,
      expect.objectContaining({
        template: [
          [true, false, false],
          [true, true, false],
          [true, true, true],
          [false, false, false],
        ],
      }),
    )
  })

  it('should clone the template into a new override on first write to a week', async () => {
    const event = withBody({ weekIndex: 2, cells: [{ hourIndex: 0, dayIndex: 0, value: true }], resetToPattern: false })
    await handler(event)
    expect(dynamodb.updateAvailability).toHaveBeenCalledWith(
      sessionId,
      userId,
      expect.objectContaining({
        overrides: {
          2: [
            [true, false, false],
            [true, true, false],
            [true, true, true],
            [false, false, false],
          ],
        },
      }),
    )
  })

  it('should delete the override on resetToPattern', async () => {
    jest.mocked(dynamodb).getAvailability.mockResolvedValueOnce({
      userId,
      expiration: availabilityRecord.expiration,
      overrides: { 2: cloneGrid(availabilityRecord.template) },
      template: cloneGrid(availabilityRecord.template),
    })
    const event = withBody({ weekIndex: 2, cells: [], resetToPattern: true })
    await handler(event)
    expect(dynamodb.updateAvailability).toHaveBeenCalledWith(
      sessionId,
      userId,
      expect.objectContaining({ overrides: {} }),
    )
  })

  it('should return BAD_REQUEST when weekIndex is beyond weekCount', async () => {
    const event = withBody({ weekIndex: 99, cells: [], resetToPattern: true })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
  })

  it('should return BAD_REQUEST when a cell is out of grid bounds', async () => {
    const event = withBody({
      weekIndex: null,
      cells: [{ hourIndex: 99, dayIndex: 0, value: true }],
      resetToPattern: false,
    })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
  })

  it('should return NOT_FOUND when availability does not exist', async () => {
    jest.mocked(dynamodb).getAvailability.mockRejectedValueOnce(new NotFoundError('Availability not found'))
    const event = withBody({
      weekIndex: null,
      cells: [{ hourIndex: 0, dayIndex: 0, value: true }],
      resetToPattern: false,
    })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
  })

  it('should return NOT_FOUND when the session is expired', async () => {
    jest
      .mocked(dynamodb)
      .getSession.mockResolvedValueOnce({ session: { ...futureSession, expiration: 1 }, users: [userId] })
    const event = withBody({
      weekIndex: null,
      cells: [{ hourIndex: 0, dayIndex: 0, value: true }],
      resetToPattern: false,
    })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
  })

  it('should return INTERNAL_SERVER_ERROR on an unexpected error', async () => {
    jest.mocked(dynamodb).getAvailability.mockRejectedValueOnce(new Error('boom'))
    const event = withBody({
      weekIndex: null,
      cells: [{ hourIndex: 0, dayIndex: 0, value: true }],
      resetToPattern: false,
    })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 500 }))
  })
})
