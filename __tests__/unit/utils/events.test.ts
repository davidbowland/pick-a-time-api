import { ValidationError } from '@errors'

import { newPlanInput } from '../__mocks__'
import { APIGatewayProxyEventV2 } from '@types'
import {
  extractRecaptchaToken,
  parseAvailabilityPatch,
  parseNewPlanBody,
  parseShareBody,
  parseUserPatch,
} from '@utils/events'

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
  describe('parseNewPlanBody', () => {
    const bodyEvent = (body: unknown): APIGatewayProxyEventV2 =>
      ({ body: JSON.stringify(body), isBase64Encoded: false }) as unknown as APIGatewayProxyEventV2

    it('should return the parsed input on a valid body', () => {
      expect(parseNewPlanBody(bodyEvent(newPlanInput))).toEqual(newPlanInput)
    })

    it('should throw when name is empty', () => {
      expect(() => parseNewPlanBody(bodyEvent({ ...newPlanInput, name: '  ' }))).toThrow(ValidationError)
    })

    it('should throw when weekdays has a duplicate', () => {
      expect(() => parseNewPlanBody(bodyEvent({ ...newPlanInput, weekdays: [4, 4, 6] }))).toThrow(ValidationError)
    })

    it('should throw when weekdays has an out-of-range value', () => {
      expect(() => parseNewPlanBody(bodyEvent({ ...newPlanInput, weekdays: [4, 5, 7] }))).toThrow(ValidationError)
    })

    it('should throw when startDate does not fall on weekdays[0]', () => {
      // 2025-09-05 is a Friday, not a Thursday
      expect(() => parseNewPlanBody(bodyEvent({ ...newPlanInput, startDate: '2025-09-05' }))).toThrow(ValidationError)
    })

    it('should throw when startDate is not a real calendar date', () => {
      expect(() => parseNewPlanBody(bodyEvent({ ...newPlanInput, startDate: '2025-02-30' }))).toThrow(ValidationError)
    })

    it('should throw when weekCount exceeds the maximum', () => {
      expect(() => parseNewPlanBody(bodyEvent({ ...newPlanInput, weekCount: 13 }))).toThrow(ValidationError)
    })

    it('should throw when endHour is not after startHour', () => {
      expect(() => parseNewPlanBody(bodyEvent({ ...newPlanInput, startHour: 16, endHour: 16 }))).toThrow(
        ValidationError,
      )
    })

    it('should throw when timezone is not a valid IANA name', () => {
      expect(() => parseNewPlanBody(bodyEvent({ ...newPlanInput, timezone: 'Not/AZone' }))).toThrow(ValidationError)
    })
  })

  describe('parseUserPatch', () => {
    it('should accept valid name patch', () => {
      const ops = [{ op: 'replace', path: '/name', value: 'Alice' }]
      const result = parseUserPatch(makeEvent(withBody(ops)))
      expect(result).toEqual(ops)
    })

    it('should accept valid phone patch', () => {
      const ops = [{ op: 'replace', path: '/phone', value: '+12025551234' }]
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

    it('should throw on path that starts with /phone but is not exact', () => {
      const ops = [{ op: 'replace', path: '/phoneExtra', value: 'x' }]
      expect(() => parseUserPatch(makeEvent(withBody(ops)))).toThrow(ValidationError)
    })

    it('should throw on remove op', () => {
      const ops = [{ op: 'remove', path: '/name' }]
      expect(() => parseUserPatch(makeEvent(withBody(ops)))).toThrow(ValidationError)
    })

    it('should throw on move op', () => {
      const ops = [{ op: 'move', path: '/name', from: '/phone' }]
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

    it('should throw on invalid phone format', () => {
      const ops = [{ op: 'replace', path: '/phone', value: '555-1234' }]
      expect(() => parseUserPatch(makeEvent(withBody(ops)))).toThrow(ValidationError)
    })

    it('should throw when phone value is an array', () => {
      const ops = [{ op: 'replace', path: '/phone', value: ['+15551234567'] }]
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

  describe('parseShareBody', () => {
    it('should parse valid share body', () => {
      const body = { phone: '+12025551234', type: 'text' }
      expect(parseShareBody(makeEvent(withBody(body)))).toEqual(body)
    })

    it('should throw on invalid phone', () => {
      const body = { phone: '555-1234', type: 'text' }
      expect(() => parseShareBody(makeEvent(withBody(body)))).toThrow(ValidationError)
    })

    it('should throw on invalid type', () => {
      const body = { phone: '+12025551234', type: 'email' }
      expect(() => parseShareBody(makeEvent(withBody(body)))).toThrow(ValidationError)
    })

    it('should throw when body is null', () => {
      const event = makeEvent({ body: null } as unknown as Partial<APIGatewayProxyEventV2>)
      expect(() => parseShareBody(event)).toThrow(ValidationError)
    })
  })

  describe('parseAvailabilityPatch', () => {
    const bodyEvent = (body: unknown): APIGatewayProxyEventV2 =>
      ({ body: JSON.stringify(body), isBase64Encoded: false }) as unknown as APIGatewayProxyEventV2
    const validBody = { weekIndex: null, cells: [{ hourIndex: 1, dayIndex: 0, value: true }], resetToPattern: false }

    it('should return the parsed input on a valid body', () => {
      expect(parseAvailabilityPatch(bodyEvent(validBody))).toEqual(validBody)
    })

    it('should default resetToPattern to false when omitted', () => {
      const { resetToPattern: _resetToPattern, ...withoutFlag } = validBody
      expect(parseAvailabilityPatch(bodyEvent(withoutFlag)).resetToPattern).toBe(false)
    })

    it('should throw when resetToPattern is true but weekIndex is null', () => {
      expect(() => parseAvailabilityPatch(bodyEvent({ weekIndex: null, cells: [], resetToPattern: true }))).toThrow(
        ValidationError,
      )
    })

    it('should allow resetToPattern alone with no cells', () => {
      const body = { weekIndex: 2, cells: [], resetToPattern: true }
      expect(parseAvailabilityPatch(bodyEvent(body))).toEqual(body)
    })

    it('should throw when cells is empty and resetToPattern is false', () => {
      expect(() => parseAvailabilityPatch(bodyEvent({ weekIndex: null, cells: [], resetToPattern: false }))).toThrow(
        ValidationError,
      )
    })

    it('should throw when a cell has a negative hourIndex', () => {
      const body = { weekIndex: null, cells: [{ hourIndex: -1, dayIndex: 0, value: true }], resetToPattern: false }
      expect(() => parseAvailabilityPatch(bodyEvent(body))).toThrow(ValidationError)
    })

    it('should throw when weekIndex is negative', () => {
      expect(() => parseAvailabilityPatch(bodyEvent({ weekIndex: -1, cells: [], resetToPattern: true }))).toThrow(
        ValidationError,
      )
    })
  })
})
