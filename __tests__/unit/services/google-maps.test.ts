import { geocodeResult, place1, place2, placeResponse, reverseGeocodeResult } from '../__mocks__'
import {
  fetchAddressFromGeocode,
  fetchGeocodeResults,
  fetchPlaceResults,
  HIDDEN_TYPES,
  interleaveArrays,
} from '@services/google-maps'
import { LatLng } from '@types'

const mockGeocode = jest.fn()
const mockReverseGeocode = jest.fn()
jest.mock('@googlemaps/google-maps-services-js', () => ({
  AddressType: { postal_code: 'postal_code', street_address: 'street_address' },
  Client: jest.fn().mockReturnValue({
    geocode: (...args) => mockGeocode(...args),
    reverseGeocode: (...args) => mockReverseGeocode(...args),
  }),
}))

const mockGetPhotoMedia = jest.fn()
const mockSearchNearby = jest.fn()
jest.mock('@googlemaps/places', () => ({
  PlacesClient: jest.fn().mockReturnValue({
    getPhotoMedia: (...args) => mockGetPhotoMedia(...args),
    searchNearby: (...args) => mockSearchNearby(...args),
  }),
}))

jest.mock('@utils/logging', () => ({ logWarn: jest.fn(), xrayCaptureHttps: jest.fn() }))

jest.mock('@services/secrets', () => ({
  getGoogleApiKey: jest.fn().mockResolvedValue('98uhjgr4rgh0ijhgthjk'),
}))

const fieldMask = {
  otherArgs: {
    headers: {
      'X-Goog-FieldMask':
        'places.id,places.types,places.nationalPhoneNumber,places.internationalPhoneNumber,places.formattedAddress,places.rating,places.websiteUri,places.currentOpeningHours,places.priceLevel,places.userRatingCount,places.priceLevel,places.displayName,places.editorialSummary,places.photos,places.generativeSummary,places.priceRange,places.utcOffsetMinutes,places.location',
    },
  },
}

describe('interleaveArrays', () => {
  it('should alternate elements starting with the first array when random returns < 0.5', () => {
    expect(interleaveArrays(['P1', 'P2', 'P3'], ['D1', 'D2', 'D3'], () => 0)).toEqual([
      'P1',
      'D1',
      'P2',
      'D2',
      'P3',
      'D3',
    ])
  })

  it('should alternate elements starting with the second array when random returns >= 0.5', () => {
    expect(interleaveArrays(['P1', 'P2', 'P3'], ['D1', 'D2', 'D3'], () => 1)).toEqual([
      'D1',
      'P1',
      'D2',
      'P2',
      'D3',
      'P3',
    ])
  })

  it('should handle unequal lengths', () => {
    expect(interleaveArrays(['P1', 'P2'], ['D1'], () => 0)).toEqual(['P1', 'D1', 'P2'])
  })

  it('should handle an empty first array', () => {
    expect(interleaveArrays([], ['D1', 'D2'], () => 0)).toEqual(['D1', 'D2'])
  })

  it('should handle an empty second array', () => {
    expect(interleaveArrays(['P1', 'P2'], [], () => 0)).toEqual(['P1', 'P2'])
  })
})

describe('google-maps', () => {
  beforeAll(() => {
    mockGetPhotoMedia.mockResolvedValue([{ photoUri: 'a-picture-stream' }])
  })

  describe('fetchAddressFromGeocode', () => {
    beforeAll(() => {
      mockReverseGeocode.mockResolvedValue(reverseGeocodeResult)
    })

    it('should pass params to reverseGeocode', async () => {
      await fetchAddressFromGeocode(38.897957, -77.03656)
      expect(mockReverseGeocode).toHaveBeenCalledWith({
        params: {
          key: '98uhjgr4rgh0ijhgthjk',
          latlng: { lat: 38.897957, lng: -77.03656 },
          result_type: ['street_address', 'postal_code'],
        },
        timeout: 2500,
      })
    })

    it('should return results', async () => {
      const result = await fetchAddressFromGeocode(38.897957, -77.03656)
      expect(result).toEqual(reverseGeocodeResult)
    })
  })

  describe('fetchGeocodeResults', () => {
    beforeAll(() => {
      mockGeocode.mockResolvedValue(geocodeResult)
    })

    it('should pass address to geocode', async () => {
      await fetchGeocodeResults('90210')
      expect(mockGeocode).toHaveBeenCalledWith({
        params: { address: '90210', key: '98uhjgr4rgh0ijhgthjk' },
        timeout: 2500,
      })
    })

    it('should return results', async () => {
      const result = await fetchGeocodeResults('90210')
      expect(result).toEqual({
        address: 'Columbia, MO 65203, USA',
        latLng: { latitude: 39.0013395, longitude: -92.3128326 },
      })
    })
  })

  describe('fetchPlaceResults', () => {
    const location: LatLng = { latitude: 39, longitude: -92 }
    const radius = 45_000
    const rankBy = 'DISTANCE'
    const primaryTypes = ['restaurant']
    const exclude = ['cat_cafe', 'fast_food_restaurant']
    const expectedHiddenTypes = HIDDEN_TYPES.concat(exclude)

    beforeAll(() => {
      mockSearchNearby.mockResolvedValue([placeResponse])
    })

    it('should pass parameters to searchNearby with maxResultCount of 20', async () => {
      await fetchPlaceResults(location, primaryTypes, exclude, rankBy, radius)
      expect(mockSearchNearby).toHaveBeenCalledWith(
        {
          excludedTypes: expectedHiddenTypes,
          includedPrimaryTypes: primaryTypes,
          languageCode: 'en',
          locationRestriction: { circle: { center: location, radius } },
          maxResultCount: 20,
          rankPreference: rankBy,
        },
        fieldMask,
      )
    })

    it('should pass rankPreference for POPULARITY', async () => {
      await fetchPlaceResults(location, primaryTypes, exclude, 'POPULARITY', radius)
      expect(mockSearchNearby).toHaveBeenCalledWith(
        expect.objectContaining({ rankPreference: 'POPULARITY' }),
        fieldMask,
      )
    })

    it('should return results', async () => {
      const result = await fetchPlaceResults(location, primaryTypes, exclude, rankBy, radius)
      expect(result).toEqual([place1, place2])
    })

    it('should return an empty array when response has no places', async () => {
      mockSearchNearby.mockResolvedValueOnce([{}])
      const result = await fetchPlaceResults(location, primaryTypes, exclude, rankBy, radius)
      expect(result).toEqual([])
    })

    describe('ALL mode', () => {
      it('should make parallel POPULARITY and DISTANCE calls', async () => {
        mockSearchNearby.mockResolvedValue([placeResponse])

        await fetchPlaceResults(location, primaryTypes, exclude, 'ALL', radius)

        expect(mockSearchNearby).toHaveBeenCalledWith(
          expect.objectContaining({ rankPreference: 'POPULARITY' }),
          fieldMask,
        )
        expect(mockSearchNearby).toHaveBeenCalledWith(
          expect.objectContaining({ rankPreference: 'DISTANCE' }),
          fieldMask,
        )
      })

      it('should deduplicate results by placeId', async () => {
        // Both queries return the same two places
        mockSearchNearby.mockResolvedValue([placeResponse])

        const result = await fetchPlaceResults(location, primaryTypes, exclude, 'ALL', radius)

        const placeIds = result.map((p) => p.placeId)
        expect(placeIds).toEqual([...new Set(placeIds)])
        expect(result).toHaveLength(2)
      })

      it('should interleave results with popularity first when random < 0.5', async () => {
        mockSearchNearby
          .mockResolvedValueOnce([{ places: [placeResponse.places[0]] }])
          .mockResolvedValueOnce([{ places: [placeResponse.places[1]] }])

        const result = await fetchPlaceResults(location, primaryTypes, exclude, 'ALL', radius, () => 0)

        expect(result).toHaveLength(2)
        expect(result[0].placeId).toBe(place1.placeId)
        expect(result[1].placeId).toBe(place2.placeId)
      })

      it('should interleave results with distance first when random >= 0.5', async () => {
        mockSearchNearby
          .mockResolvedValueOnce([{ places: [placeResponse.places[0]] }])
          .mockResolvedValueOnce([{ places: [placeResponse.places[1]] }])

        const result = await fetchPlaceResults(location, primaryTypes, exclude, 'ALL', radius, () => 1)

        expect(result).toHaveLength(2)
        expect(result[0].placeId).toBe(place2.placeId)
        expect(result[1].placeId).toBe(place1.placeId)
      })

      it('should continue with DISTANCE results when POPULARITY fails', async () => {
        mockSearchNearby.mockRejectedValueOnce(new Error('POPULARITY failed')).mockResolvedValueOnce([placeResponse])

        const result = await fetchPlaceResults(location, primaryTypes, exclude, 'ALL', radius)

        expect(result).toHaveLength(2)
      })

      it('should continue with POPULARITY results when DISTANCE fails', async () => {
        mockSearchNearby.mockResolvedValueOnce([placeResponse]).mockRejectedValueOnce(new Error('DISTANCE failed'))

        const result = await fetchPlaceResults(location, primaryTypes, exclude, 'ALL', radius)

        expect(result).toHaveLength(2)
      })

      it('should throw when both queries fail', async () => {
        mockSearchNearby
          .mockRejectedValueOnce(new Error('POPULARITY failed'))
          .mockRejectedValueOnce(new Error('DISTANCE failed'))

        await expect(fetchPlaceResults(location, primaryTypes, exclude, 'ALL', radius)).rejects.toThrow(
          'POPULARITY failed',
        )
      })
    })

    describe('distanceMiles', () => {
      it('should compute distanceMiles from origin when place has location', async () => {
        const placeWithLocation = {
          places: [{ ...placeResponse.places[0], location: { latitude: 39.1, longitude: -92.0 } }],
        }
        mockSearchNearby.mockResolvedValueOnce([placeWithLocation])

        const result = await fetchPlaceResults(location, primaryTypes, exclude, rankBy, radius)

        expect(result[0].distanceMiles).toBeCloseTo(6.91, 2)
      })

      it('should omit distanceMiles when place has no location', async () => {
        const result = await fetchPlaceResults(location, primaryTypes, exclude, rankBy, radius)

        expect(result[0]).not.toHaveProperty('distanceMiles')
      })

      it('should omit distanceMiles when place location has null coordinates', async () => {
        const placeWithPartialLocation = {
          places: [{ ...placeResponse.places[0], location: { latitude: 39.1, longitude: null } }],
        }
        mockSearchNearby.mockResolvedValueOnce([placeWithPartialLocation])

        const result = await fetchPlaceResults(location, primaryTypes, exclude, rankBy, radius)

        expect(result[0]).not.toHaveProperty('distanceMiles')
      })
    })

    describe('photo resilience', () => {
      it('should skip failed photos and return successful ones', async () => {
        mockSearchNearby.mockResolvedValueOnce([placeResponse])
        mockGetPhotoMedia
          .mockResolvedValueOnce([{ photoUri: 'photo-1' }])
          .mockRejectedValueOnce(new Error('photo fetch failed'))
          .mockResolvedValueOnce([{ photoUri: 'photo-3' }])
          .mockResolvedValueOnce([{ photoUri: 'photo-4' }])
          .mockResolvedValueOnce([{ photoUri: 'photo-5' }])

        const result = await fetchPlaceResults(location, primaryTypes, exclude, rankBy, radius)

        // place1 has 10 photos in placeResponse but googleImageCount limits to 5
        // One of those 5 fails, so place1 should have 4 photos
        expect(result[0].photos).toHaveLength(4)
      })

      it('should return empty photos array when all photos fail for a place', async () => {
        const singlePlaceResponse = { places: [{ ...placeResponse.places[1], photos: [{ name: 'bad-photo' }] }] }
        mockSearchNearby.mockResolvedValueOnce([singlePlaceResponse])
        mockGetPhotoMedia.mockRejectedValueOnce(new Error('photo fetch failed'))

        const result = await fetchPlaceResults(location, primaryTypes, exclude, rankBy, radius)

        expect(result[0].photos).toEqual([])
      })
    })

    describe('getPlacesClient rotation', () => {
      it('should propagate the error from getGoogleApiKey without caching a broken client', async () => {
        jest.resetModules()
        jest.doMock('@services/secrets', () => ({
          getGoogleApiKey: jest
            .fn()
            .mockRejectedValueOnce(new Error('SSM unavailable'))
            .mockResolvedValueOnce('98uhjgr4rgh0ijhgthjk'),
        }))

        try {
          const { fetchPlaceResults: freshFetchPlaceResults } = await import('@services/google-maps')
          mockSearchNearby.mockResolvedValue([placeResponse])

          await expect(freshFetchPlaceResults(location, primaryTypes, exclude, rankBy, radius)).rejects.toThrow(
            'SSM unavailable',
          )

          const result = await freshFetchPlaceResults(location, primaryTypes, exclude, rankBy, radius)
          expect(result).toEqual([place1, place2])
        } finally {
          jest.dontMock('@services/secrets')
        }
      })

      it('should rebuild the places client when getGoogleApiKey returns a different key', async () => {
        jest.resetModules()
        const mockGetGoogleApiKey = jest.fn().mockResolvedValue('key-1')
        jest.doMock('@services/secrets', () => ({
          getGoogleApiKey: mockGetGoogleApiKey,
        }))

        try {
          const { fetchPlaceResults: freshFetchPlaceResults } = await import('@services/google-maps')
          const { PlacesClient: FreshPlacesClient } = await import('@googlemaps/places')
          mockSearchNearby.mockResolvedValue([placeResponse])

          // Every call within this first invocation resolves the same key, so
          // fetching photos concurrently must not cause spurious rebuilds.
          await freshFetchPlaceResults(location, primaryTypes, exclude, rankBy, radius)

          // Simulate a rotation: the key changes for every subsequent call.
          mockGetGoogleApiKey.mockResolvedValue('key-2')
          await freshFetchPlaceResults(location, primaryTypes, exclude, rankBy, radius)

          expect(jest.mocked(FreshPlacesClient).mock.calls).toEqual([
            [{ apiKey: 'key-1', timeout: 2500 }],
            [{ apiKey: 'key-2', timeout: 2500 }],
          ])
        } finally {
          jest.dontMock('@services/secrets')
        }
      })

      it('should not rebuild the places client when getGoogleApiKey returns the same key', async () => {
        jest.resetModules()
        jest.doMock('@services/secrets', () => ({
          getGoogleApiKey: jest.fn().mockResolvedValue('same-key'),
        }))

        try {
          const { fetchPlaceResults: freshFetchPlaceResults } = await import('@services/google-maps')
          const { PlacesClient: FreshPlacesClient } = await import('@googlemaps/places')
          mockSearchNearby.mockResolvedValue([placeResponse])

          await freshFetchPlaceResults(location, primaryTypes, exclude, rankBy, radius)
          await freshFetchPlaceResults(location, primaryTypes, exclude, rankBy, radius)

          expect(jest.mocked(FreshPlacesClient).mock.calls).toHaveLength(1)
        } finally {
          jest.dontMock('@services/secrets')
        }
      })
    })
  })
})
