import { ValidationError } from '@errors'

import { APIGatewayProxyEventV2 } from '@types'
import {
  extractRecaptchaToken,
  formatLatLng,
  parseCloseRoundInput,
  parseLatLng,
  parseNewSessionBody,
  parseShareBody,
  parseSubscribeBody,
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
  describe('formatLatLng', () => {
    it('should return valid lat/lng', () => {
      expect(formatLatLng({ latitude: 38.9, longitude: -77.0 })).toEqual({ latitude: 38.9, longitude: -77.0 })
    })

    it('should throw on NaN latitude', () => {
      expect(() => formatLatLng({ latitude: NaN, longitude: -77 })).toThrow(ValidationError)
    })

    it.each([-91, 91])('should throw on out-of-range latitude %s', (lat) => {
      expect(() => formatLatLng({ latitude: lat, longitude: 0 })).toThrow(ValidationError)
    })

    it.each([-181, 181])('should throw on out-of-range longitude %s', (lng) => {
      expect(() => formatLatLng({ latitude: 0, longitude: lng })).toThrow(ValidationError)
    })
  })

  describe('parseNewSessionBody', () => {
    const validBody = {
      address: '123 Main St',
      filterClosingSoon: false,
      radiusMiles: 5,
      rankBy: 'DISTANCE',
      type: ['restaurant'],
    }

    it('should parse a valid body', () => {
      const event = makeEvent(withBody(validBody))
      const result = parseNewSessionBody(event)
      expect(result).toEqual({
        address: '123 Main St',
        exclude: [],
        filterClosingSoon: false,
        radiusMiles: 5,
        rankBy: 'DISTANCE',
        type: ['restaurant'],
      })
    })

    it('should parse base64-encoded body', () => {
      const event = makeEvent(withBody(validBody, true))
      const result = parseNewSessionBody(event)
      expect(result.address).toBe('123 Main St')
    })

    it('should accept optional latitude and longitude', () => {
      const event = makeEvent(withBody({ ...validBody, latitude: 38.9, longitude: -77.0 }))
      const result = parseNewSessionBody(event)
      expect(result.latitude).toBe(38.9)
      expect(result.longitude).toBe(-77.0)
    })

    it('should throw when address is missing', () => {
      const event = makeEvent(withBody({ ...validBody, address: undefined }))
      expect(() => parseNewSessionBody(event)).toThrow(ValidationError)
    })

    it('should throw when type is empty', () => {
      const event = makeEvent(withBody({ ...validBody, type: [] }))
      expect(() => parseNewSessionBody(event)).toThrow(ValidationError)
    })

    it('should throw on invalid place type', () => {
      const event = makeEvent(withBody({ ...validBody, type: ['invalid_type'] }))
      expect(() => parseNewSessionBody(event)).toThrow(ValidationError)
    })

    it('should throw on invalid rankBy', () => {
      const event = makeEvent(withBody({ ...validBody, rankBy: 'INVALID' }))
      expect(() => parseNewSessionBody(event)).toThrow(ValidationError)
    })

    it.each(['DISTANCE', 'POPULARITY', 'ALL'])('should accept rankBy %s', (rankBy) => {
      const event = makeEvent(withBody({ ...validBody, rankBy }))
      const result = parseNewSessionBody(event)
      expect(result.rankBy).toBe(rankBy)
    })

    it('should throw when only latitude is provided', () => {
      const event = makeEvent(withBody({ ...validBody, latitude: 38.9 }))
      expect(() => parseNewSessionBody(event)).toThrow(ValidationError)
    })

    it('should throw on out-of-range latitude in body', () => {
      const event = makeEvent(withBody({ ...validBody, latitude: 999, longitude: -77.0 }))
      expect(() => parseNewSessionBody(event)).toThrow(ValidationError)
    })

    it.each([0, -1, 31])('should throw on invalid radiusMiles %s', (radiusMiles) => {
      const event = makeEvent(withBody({ ...validBody, radiusMiles }))
      expect(() => parseNewSessionBody(event)).toThrow(ValidationError)
    })

    it.each([1, 15, 30])('should accept valid radiusMiles %s', (radiusMiles) => {
      const event = makeEvent(withBody({ ...validBody, radiusMiles }))
      const result = parseNewSessionBody(event)
      expect(result.radiusMiles).toBe(radiusMiles)
    })

    it('should throw on radiusMiles below min', () => {
      const event = makeEvent(withBody({ ...validBody, radiusMiles: 0.5 }))
      expect(() => parseNewSessionBody(event)).toThrow(ValidationError)
    })

    it('should parse filterClosingSoon true', () => {
      const event = makeEvent(withBody({ ...validBody, filterClosingSoon: true }))
      const result = parseNewSessionBody(event)
      expect(result.filterClosingSoon).toBe(true)
    })

    it('should parse filterClosingSoon false', () => {
      const event = makeEvent(withBody({ ...validBody, filterClosingSoon: false }))
      const result = parseNewSessionBody(event)
      expect(result.filterClosingSoon).toBe(false)
    })

    it('should throw when filterClosingSoon is missing', () => {
      const { filterClosingSoon: _, ...bodyWithout } = validBody
      const event = makeEvent(withBody(bodyWithout))
      expect(() => parseNewSessionBody(event)).toThrow(ValidationError)
    })

    it('should throw when filterClosingSoon is a string', () => {
      const event = makeEvent(withBody({ ...validBody, filterClosingSoon: 'true' }))
      expect(() => parseNewSessionBody(event)).toThrow(ValidationError)
    })

    it('should throw when filterClosingSoon is a number', () => {
      const event = makeEvent(withBody({ ...validBody, filterClosingSoon: 1 }))
      expect(() => parseNewSessionBody(event)).toThrow(ValidationError)
    })

    it('should throw when filterClosingSoon is null', () => {
      const event = makeEvent(withBody({ ...validBody, filterClosingSoon: null }))
      expect(() => parseNewSessionBody(event)).toThrow(ValidationError)
    })

    it('should throw when body is null', () => {
      const event = makeEvent({ body: null } as unknown as Partial<APIGatewayProxyEventV2>)
      expect(() => parseNewSessionBody(event)).toThrow(ValidationError)
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

    it('should accept valid votes patch', () => {
      const ops = [{ op: 'replace', path: '/votes/0/1', value: 'choice-1' }]
      const result = parseUserPatch(makeEvent(withBody(ops)))
      expect(result).toEqual(ops)
    })

    it('should accept add op', () => {
      const ops = [{ op: 'add', path: '/name', value: 'Bob' }]
      const result = parseUserPatch(makeEvent(withBody(ops)))
      expect(result).toEqual(ops)
    })

    it('should accept test op', () => {
      const ops = [{ op: 'test', path: '/name', value: 'Alice' }]
      const result = parseUserPatch(makeEvent(withBody(ops)))
      expect(result).toEqual(ops)
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

    it('should throw on malformed votes path', () => {
      const ops = [{ op: 'replace', path: '/votes', value: 'x' }]
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

    it('should throw on invalid phone format', () => {
      const ops = [{ op: 'replace', path: '/phone', value: '555-1234' }]
      expect(() => parseUserPatch(makeEvent(withBody(ops)))).toThrow(ValidationError)
    })

    it('should throw when body is not an array', () => {
      expect(() => parseUserPatch(makeEvent(withBody({ op: 'replace', path: '/name' })))).toThrow(ValidationError)
    })
  })

  describe('parseLatLng', () => {
    it('should extract lat/lng from query params', () => {
      const event = makeEvent({ queryStringParameters: { latitude: '38.9', longitude: '-77.0' } })
      expect(parseLatLng(event)).toEqual({ latitude: 38.9, longitude: -77.0 })
    })

    it('should throw on missing params', () => {
      const event = makeEvent({ queryStringParameters: {} })
      expect(() => parseLatLng(event)).toThrow(ValidationError)
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

  describe('parseSubscribeBody', () => {
    it('should parse valid subscribe body', () => {
      const body = { roundId: 0, userId: 'fuzzy-penguin' }
      expect(parseSubscribeBody(makeEvent(withBody(body)))).toEqual(body)
    })

    it('should throw when userId is missing', () => {
      const body = { roundId: 0 }
      expect(() => parseSubscribeBody(makeEvent(withBody(body)))).toThrow(ValidationError)
    })

    it('should throw when roundId is negative', () => {
      const body = { roundId: -1, userId: 'fuzzy-penguin' }
      expect(() => parseSubscribeBody(makeEvent(withBody(body)))).toThrow(ValidationError)
    })

    it('should throw when roundId is not an integer', () => {
      const body = { roundId: 0.5, userId: 'fuzzy-penguin' }
      expect(() => parseSubscribeBody(makeEvent(withBody(body)))).toThrow(ValidationError)
    })
  })

  describe('parseCloseRoundInput', () => {
    it('should parse valid roundId from path', () => {
      const event = makeEvent({ pathParameters: { roundId: '2' } })
      expect(parseCloseRoundInput(event)).toEqual({ roundId: 2 })
    })

    it('should throw on missing roundId', () => {
      const event = makeEvent({ pathParameters: {} })
      expect(() => parseCloseRoundInput(event)).toThrow(ValidationError)
    })

    it('should throw on non-numeric roundId', () => {
      const event = makeEvent({ pathParameters: { roundId: 'abc' } })
      expect(() => parseCloseRoundInput(event)).toThrow(ValidationError)
    })

    it('should throw on negative roundId', () => {
      const event = makeEvent({ pathParameters: { roundId: '-1' } })
      expect(() => parseCloseRoundInput(event)).toThrow(ValidationError)
    })
  })
})
