import { calendarAccountRecord } from '../__mocks__'
import eventJson from '@events/get-calendar.json'
import { handler } from '@handlers/get-calendar'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging', () => ({
  ...jest.requireActual('@utils/logging'),
  log: jest.fn(),
  logError: jest.fn(),
  xrayCapture: jest.fn((x: unknown) => x),
}))

describe('get-calendar', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2

  beforeAll(() => {
    jest.mocked(dynamodb).getCalendarAccount.mockResolvedValue(calendarAccountRecord)
  })

  describe('handler', () => {
    it('should report a connected account with its last sync time', async () => {
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
      expect(JSON.parse(result.body as string)).toEqual({
        lastSyncedAt: calendarAccountRecord.lastSyncedAt,
        status: 'connected',
      })
    })

    it('should report an errored account', async () => {
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce({ ...calendarAccountRecord, status: 'error' })
      const result = await handler(event)
      expect(JSON.parse(result.body as string).status).toEqual('error')
    })

    it('should date the last check ATTEMPT, not the last success, for an errored account', async () => {
      // calendar-sync stamps lastSyncedAt on the failure path as well as the success path, so an
      // errored record carries the time of a check that fetched nothing. The field dates the
      // attempt; status says whether the data behind it is any newer. Pinned here because the
      // contract used to be written up as "the last successful Google fetch", which it is not.
      const attemptedAt = calendarAccountRecord.lastSyncedAt + 3600
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce({
        ...calendarAccountRecord,
        lastSyncedAt: attemptedAt,
        status: 'error',
      })

      const result = await handler(event)

      expect(JSON.parse(result.body as string)).toEqual({ lastSyncedAt: attemptedAt, status: 'error' })
    })

    it('should report not_connected when there is no record', async () => {
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(null)
      const result = await handler(event)
      expect(JSON.parse(result.body as string)).toEqual({ lastSyncedAt: null, status: 'not_connected' })
    })

    it('should return 400 without a Google identity', async () => {
      const anonymous = { ...event, requestContext: { ...event.requestContext, authorizer: undefined } }
      const result = await handler(anonymous as unknown as APIGatewayProxyEventV2)
      expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
    })
  })
})
