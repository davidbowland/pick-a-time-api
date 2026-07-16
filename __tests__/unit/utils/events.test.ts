import { ValidationError } from '@errors'

import { newPollInput } from '../__mocks__'
import { APIGatewayProxyEventV2 } from '@types'
import { extractRecaptchaToken, parseAvailabilityPatch, parseNewPollBody, parseUserPatch } from '@utils/events'

const makeEvent = (overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 =>
  ({
    body: '{}',
    headers: {},
    isBase64Encoded: false,
    pathParameters: {},
    queryStringParameters: {},
    ...overrides,
  }) as unknown as APIGatewayProxyEventV2

const withBody = (body: unknown, base64 = false): Partial<APIGatewayProxyEventV2> => {
  const json = JSON.stringify(body)
  return base64
    ? { body: Buffer.from(json).toString('base64'), isBase64Encoded: true }
    : { body: json, isBase64Encoded: false }
}

describe('events', () => {
  describe('parseNewPollBody', () => {
    const bodyEvent = (body: unknown): APIGatewayProxyEventV2 =>
      ({ body: JSON.stringify(body), isBase64Encoded: false }) as unknown as APIGatewayProxyEventV2
    // Fixed "now" before every fixture date (Sept 2025) and within a year of them.
    const now = () => Date.UTC(2025, 7, 15)

    it('should return the parsed input on a valid timed-poll body', () => {
      expect(parseNewPollBody(bodyEvent(newPollInput), now)).toEqual(newPollInput)
    })

    it('should return the parsed input on a valid dates-only body', () => {
      const datesOnlyInput = {
        name: 'Trip planning',
        dates: ['2025-09-04', '2025-09-05'],
        usesTimes: false,
        timezone: 'America/Chicago',
      }
      expect(parseNewPollBody(bodyEvent(datesOnlyInput), now)).toEqual(datesOnlyInput)
    })

    it('should default slotMinutes to 60 when omitted on a timed poll', () => {
      const { slotMinutes: _slotMinutes, ...withoutSlotMinutes } = newPollInput
      expect(parseNewPollBody(bodyEvent(withoutSlotMinutes), now).slotMinutes).toBe(60)
    })

    it('should throw when name is empty', () => {
      expect(() => parseNewPollBody(bodyEvent({ ...newPollInput, name: '  ' }), now)).toThrow(ValidationError)
    })

    it('should throw when dates is empty', () => {
      expect(() => parseNewPollBody(bodyEvent({ ...newPollInput, dates: [] }), now)).toThrow(ValidationError)
    })

    it('should throw when dates has a duplicate', () => {
      expect(() => parseNewPollBody(bodyEvent({ ...newPollInput, dates: ['2025-09-04', '2025-09-04'] }), now)).toThrow(
        ValidationError,
      )
    })

    it('should throw when a date is not a real calendar date', () => {
      expect(() => parseNewPollBody(bodyEvent({ ...newPollInput, dates: ['2025-02-30'] }), now)).toThrow(
        ValidationError,
      )
    })

    it('should throw when dates exceeds the maximum', () => {
      const tooMany = Array.from({ length: 91 }, (_, i) => {
        const date = new Date(Date.UTC(2025, 8, 1) + i * 86_400_000)
        return date.toISOString().slice(0, 10)
      })
      expect(() => parseNewPollBody(bodyEvent({ ...newPollInput, dates: tooMany }), now)).toThrow(ValidationError)
    })

    it('should throw when timezone is not a valid IANA name', () => {
      expect(() => parseNewPollBody(bodyEvent({ ...newPollInput, timezone: 'Not/AZone' }), now)).toThrow(
        ValidationError,
      )
    })

    it('should throw when a date is in the past', () => {
      expect(() => parseNewPollBody(bodyEvent({ ...newPollInput, dates: ['2024-01-01'] }), now)).toThrow(
        ValidationError,
      )
    })

    it('should throw when a date is a year or more away', () => {
      expect(() => parseNewPollBody(bodyEvent({ ...newPollInput, dates: ['2026-09-01'] }), now)).toThrow(
        ValidationError,
      )
    })

    it('should accept a date exactly maxPollDateRangeDays (365) days from today', () => {
      // now = 2025-08-15T00:00:00Z, but "today" is resolved in America/Chicago (UTC-5 in August),
      // so the zoned today is 2025-08-14. +365 days (no Feb 29 in this span) = 2026-08-14, the exact
      // inclusive boundary.
      expect(() => parseNewPollBody(bodyEvent({ ...newPollInput, dates: ['2026-08-14'] }), now)).not.toThrow()
    })

    it('should throw when a date is one day beyond maxPollDateRangeDays', () => {
      expect(() => parseNewPollBody(bodyEvent({ ...newPollInput, dates: ['2026-08-15'] }), now)).toThrow(
        ValidationError,
      )
    })

    it('should throw when usesTimes is missing', () => {
      const { usesTimes: _usesTimes, ...withoutUsesTimes } = newPollInput
      expect(() => parseNewPollBody(bodyEvent(withoutUsesTimes), now)).toThrow(ValidationError)
    })

    it('should throw when usesTimes is false but startMinute is present', () => {
      expect(() =>
        parseNewPollBody(
          bodyEvent({
            name: 'x',
            dates: ['2025-09-04'],
            usesTimes: false,
            timezone: 'America/Chicago',
            startMinute: 0,
          }),
          now,
        ),
      ).toThrow(ValidationError)
    })

    it('should throw when startMinute is not a multiple of 15', () => {
      expect(() => parseNewPollBody(bodyEvent({ ...newPollInput, startMinute: 961 }), now)).toThrow(ValidationError)
    })

    it('should throw when endMinute is not after startMinute', () => {
      expect(() => parseNewPollBody(bodyEvent({ ...newPollInput, startMinute: 960, endMinute: 960 }), now)).toThrow(
        ValidationError,
      )
    })

    it('should throw when slotMinutes is not one of the allowed presets', () => {
      expect(() => parseNewPollBody(bodyEvent({ ...newPollInput, slotMinutes: 45 }), now)).toThrow(ValidationError)
    })

    it('should throw when the time window is narrower than slotMinutes', () => {
      expect(() =>
        parseNewPollBody(bodyEvent({ ...newPollInput, endMinute: newPollInput.startMinute + 30 }), now),
      ).toThrow(ValidationError)
    })

    it('should accept valid overrides and return their dates sorted', () => {
      const withOverrides = {
        ...newPollInput,
        overrides: [{ dates: ['2025-09-06', '2025-09-05'], startMinute: 600, endMinute: 720 }],
      }
      const result = parseNewPollBody(bodyEvent(withOverrides), now)
      expect(result).toMatchObject({
        overrides: [{ dates: ['2025-09-05', '2025-09-06'], startMinute: 600, endMinute: 720 }],
      })
    })

    it('should omit overrides from the result when not provided', () => {
      expect(parseNewPollBody(bodyEvent(newPollInput), now)).not.toHaveProperty('overrides')
    })

    it('should throw when overrides is an empty array', () => {
      expect(() => parseNewPollBody(bodyEvent({ ...newPollInput, overrides: [] }), now)).toThrow(ValidationError)
    })

    it('should throw when overrides exceeds maxPollOverrideGroups', () => {
      const tooMany = Array.from({ length: 11 }, (_, i) => ({
        dates: [newPollInput.dates[0]],
        startMinute: 600,
        endMinute: 720 + i,
      }))
      expect(() => parseNewPollBody(bodyEvent({ ...newPollInput, overrides: tooMany }), now)).toThrow(ValidationError)
    })

    it('should throw when an override date is not among the poll dates', () => {
      const bad = { ...newPollInput, overrides: [{ dates: ['2025-09-07'], startMinute: 600, endMinute: 720 }] }
      expect(() => parseNewPollBody(bodyEvent(bad), now)).toThrow(ValidationError)
    })

    it('should throw when two override groups share a date', () => {
      const bad = {
        ...newPollInput,
        overrides: [
          { dates: ['2025-09-05'], startMinute: 600, endMinute: 720 },
          { dates: ['2025-09-05', '2025-09-06'], startMinute: 780, endMinute: 900 },
        ],
      }
      expect(() => parseNewPollBody(bodyEvent(bad), now)).toThrow(ValidationError)
    })

    it('should throw when an override startMinute is not a multiple of 15', () => {
      const bad = { ...newPollInput, overrides: [{ dates: ['2025-09-05'], startMinute: 601, endMinute: 720 }] }
      expect(() => parseNewPollBody(bodyEvent(bad), now)).toThrow(ValidationError)
    })

    it('should throw when an override endMinute is not after its startMinute', () => {
      const bad = { ...newPollInput, overrides: [{ dates: ['2025-09-05'], startMinute: 600, endMinute: 600 }] }
      expect(() => parseNewPollBody(bodyEvent(bad), now)).toThrow(ValidationError)
    })

    it('should throw when an override window is narrower than slotMinutes', () => {
      // newPollInput.slotMinutes is 60; this override window is only 30 minutes wide.
      const bad = { ...newPollInput, overrides: [{ dates: ['2025-09-05'], startMinute: 600, endMinute: 630 }] }
      expect(() => parseNewPollBody(bodyEvent(bad), now)).toThrow(ValidationError)
    })

    it('should throw when overrides is present but usesTimes is false', () => {
      const bad = {
        name: 'x',
        dates: ['2025-09-04'],
        usesTimes: false,
        timezone: 'America/Chicago',
        overrides: [{ dates: ['2025-09-04'], startMinute: 600, endMinute: 720 }],
      }
      expect(() => parseNewPollBody(bodyEvent(bad), now)).toThrow(ValidationError)
    })
  })

  describe('parseUserPatch', () => {
    it('should accept valid name patch', () => {
      const ops = [{ op: 'replace', path: '/name', value: 'Alice' }]
      const result = parseUserPatch(makeEvent(withBody(ops)))
      expect(result).toEqual(ops)
    })

    it('should throw on add op', () => {
      const ops = [{ op: 'add', path: '/name', value: 'Bob' }]
      expect(() => parseUserPatch(makeEvent(withBody(ops)))).toThrow(ValidationError)
    })

    it('should throw on test op', () => {
      const ops = [{ op: 'test', path: '/name', value: 'Alice' }]
      expect(() => parseUserPatch(makeEvent(withBody(ops)))).toThrow(ValidationError)
    })

    it('should throw on disallowed path', () => {
      const ops = [{ op: 'replace', path: '/subscribedRounds', value: [1] }]
      expect(() => parseUserPatch(makeEvent(withBody(ops)))).toThrow(ValidationError)
    })

    it('should throw on path that starts with /name but is not exact', () => {
      const ops = [{ op: 'replace', path: '/names_evil', value: 'x' }]
      expect(() => parseUserPatch(makeEvent(withBody(ops)))).toThrow(ValidationError)
    })

    it('should throw on remove op', () => {
      const ops = [{ op: 'remove', path: '/name' }]
      expect(() => parseUserPatch(makeEvent(withBody(ops)))).toThrow(ValidationError)
    })

    it('should throw on move op', () => {
      const ops = [{ op: 'move', path: '/name', from: '/name' }]
      expect(() => parseUserPatch(makeEvent(withBody(ops)))).toThrow(ValidationError)
    })

    it('should throw when name exceeds 50 characters', () => {
      const ops = [{ op: 'replace', path: '/name', value: 'A'.repeat(51) }]
      expect(() => parseUserPatch(makeEvent(withBody(ops)))).toThrow(ValidationError)
    })

    it('should throw when name value is an object', () => {
      const ops = [{ op: 'replace', path: '/name', value: { evil: true } }]
      expect(() => parseUserPatch(makeEvent(withBody(ops)))).toThrow(ValidationError)
    })

    it('should throw when name has no value key', () => {
      const ops = [{ op: 'replace', path: '/name' }]
      expect(() => parseUserPatch(makeEvent(withBody(ops)))).toThrow(ValidationError)
    })

    it('should throw when body is not an array', () => {
      expect(() => parseUserPatch(makeEvent(withBody({ op: 'replace', path: '/name' })))).toThrow(ValidationError)
    })
  })

  describe('extractRecaptchaToken', () => {
    it('should extract token from headers', () => {
      const event = makeEvent({ headers: { 'x-recaptcha-token': 'abc123' } })
      expect(extractRecaptchaToken(event)).toBe('abc123')
    })

    it('should throw when token is missing', () => {
      const event = makeEvent({ headers: {} })
      expect(() => extractRecaptchaToken(event)).toThrow(ValidationError)
    })
  })

  describe('parseAvailabilityPatch', () => {
    const bodyEvent = (body: unknown): APIGatewayProxyEventV2 =>
      ({ body: JSON.stringify(body), isBase64Encoded: false }) as unknown as APIGatewayProxyEventV2
    const validBody = { cells: [{ dateIndex: 1, slotIndex: 0, value: true }] }

    it('should return the parsed input on a valid body', () => {
      expect(parseAvailabilityPatch(bodyEvent(validBody))).toEqual(validBody)
    })

    it('should throw when cells is empty', () => {
      expect(() => parseAvailabilityPatch(bodyEvent({ cells: [] }))).toThrow(ValidationError)
    })

    it('should throw when cells is missing', () => {
      expect(() => parseAvailabilityPatch(bodyEvent({}))).toThrow(ValidationError)
    })

    it('should throw when a cell has a negative dateIndex', () => {
      expect(() =>
        parseAvailabilityPatch(bodyEvent({ cells: [{ dateIndex: -1, slotIndex: 0, value: true }] })),
      ).toThrow(ValidationError)
    })

    it('should throw when a cell has a negative slotIndex', () => {
      expect(() =>
        parseAvailabilityPatch(bodyEvent({ cells: [{ dateIndex: 0, slotIndex: -1, value: true }] })),
      ).toThrow(ValidationError)
    })

    it('should throw when a cell value is not a boolean', () => {
      expect(() =>
        parseAvailabilityPatch(bodyEvent({ cells: [{ dateIndex: 0, slotIndex: 0, value: 'yes' }] })),
      ).toThrow(ValidationError)
    })
  })
})
