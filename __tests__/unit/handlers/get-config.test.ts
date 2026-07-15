import eventJson from '@events/get-config.json'
import { handler } from '@handlers/get-config'
import { APIGatewayProxyEventV2 } from '@types'

jest.mock('@utils/logging', () => ({ log: jest.fn(), logError: jest.fn(), xrayCapture: jest.fn((x: unknown) => x) }))

describe('get-config', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2

  it('should return all poll/session defaults and limits', async () => {
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
    expect(JSON.parse((result as { body: string }).body)).toEqual({
      maxPollDates: 90,
      pollNameMaxLength: 100,
      participantNameMaxLength: 50,
      allowedSlotMinutes: [15, 30, 60, 90, 120],
      defaultSlotMinutes: 60,
      startEndMinuteStep: 15,
      maxPollDateRangeDays: 365,
      maxUsersPerSession: 10,
      sessionExpireHours: 336,
    })
  })
})
