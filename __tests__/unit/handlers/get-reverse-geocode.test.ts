import { ValidationError } from '@errors'

import { recaptchaToken, reverseGeocodeResult } from '../__mocks__'
import eventJson from '@events/get-reverse-geocode.json'
import { handler } from '@handlers/get-reverse-geocode'
import * as googleMaps from '@services/google-maps'
import * as recaptcha from '@services/recaptcha'
import { APIGatewayProxyEventV2 } from '@types'
import * as events from '@utils/events'
import status from '@utils/status'

jest.mock('@services/google-maps')
jest.mock('@services/recaptcha')
jest.mock('@utils/events')
jest.mock('@utils/logging')

describe('get-reverse-geocode', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2

  beforeAll(() => {
    jest.mocked(events).extractRecaptchaToken.mockReturnValue(recaptchaToken)
    jest.mocked(events).parseLatLng.mockReturnValue({ latitude: 38.897957, longitude: -77.03656 })
    jest.mocked(recaptcha).getCaptchaScore.mockResolvedValue(0.9)
    jest.mocked(googleMaps).fetchAddressFromGeocode.mockResolvedValue({ data: reverseGeocodeResult } as any)
  })

  describe('handler', () => {
    it('should return OK with address when coordinates are valid and reCAPTCHA passes', async () => {
      const result = await handler(event)
      expect(result).toEqual({
        ...status.OK,
        body: JSON.stringify({ address: '1600 Pennsylvania Avenue NW, Washington, DC 20500, USA' }),
      })
    })

    it('should return FORBIDDEN when reCAPTCHA score is below 0.7', async () => {
      jest.mocked(recaptcha).getCaptchaScore.mockResolvedValueOnce(0.5)
      const result = await handler(event)
      expect(result).toEqual(status.FORBIDDEN)
    })

    it('should validate reCAPTCHA before parsing lat/lng', async () => {
      jest.mocked(events).extractRecaptchaToken.mockImplementationOnce(() => {
        throw new ValidationError('x-recaptcha-token header is required')
      })
      const result = await handler(event)
      expect(events.parseLatLng).not.toHaveBeenCalled()
      expect(result).toEqual({
        ...status.BAD_REQUEST,
        body: JSON.stringify({ message: 'x-recaptcha-token header is required' }),
      })
    })

    it('should return BAD_REQUEST when lat/lng are missing/invalid', async () => {
      jest.mocked(events).parseLatLng.mockImplementationOnce(() => {
        throw new ValidationError('latitude and longitude query parameters must be provided')
      })
      const result = await handler(event)
      expect(result).toEqual({
        ...status.BAD_REQUEST,
        body: JSON.stringify({ message: 'latitude and longitude query parameters must be provided' }),
      })
    })

    it('should return INTERNAL_SERVER_ERROR when fetchAddressFromGeocode rejects', async () => {
      jest.mocked(googleMaps).fetchAddressFromGeocode.mockRejectedValueOnce(new Error('API error'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.INTERNAL_SERVER_ERROR))
    })

    it('should return INTERNAL_SERVER_ERROR when getCaptchaScore rejects with a network error', async () => {
      jest.mocked(recaptcha).getCaptchaScore.mockRejectedValueOnce(new Error('ECONNREFUSED'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.INTERNAL_SERVER_ERROR))
    })

    it('should return NOT_FOUND when no geocode results found', async () => {
      jest.mocked(googleMaps).fetchAddressFromGeocode.mockResolvedValueOnce({ data: { results: [] } } as any)
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.NOT_FOUND))
    })
  })
})
