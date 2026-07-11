import { AddressType, Client as GeocodeClient, ReverseGeocodeResponse } from '@googlemaps/google-maps-services-js'
import { PlacesClient } from '@googlemaps/places'

import { googleImageCount, googleImageMaxHeight, googleImageMaxWidth, googleTimeoutMs } from '../config'
import { GeocodedAddress, GoogleRankBy, LatLng, PlaceDetails, PriceLevel, RankByType } from '../types'
import { logWarn, xrayCaptureHttps } from '../utils/logging'
import { getGoogleApiKey } from './secrets'

export const HIDDEN_TYPES = [
  'airport',
  'bowling_alley',
  'casino',
  'convenience_store',
  'funeral_home',
  'gas_station',
  'gym',
  'zoo',
]

xrayCaptureHttps()
const geocodeClient = new GeocodeClient()

let placesClient: PlacesClient | null = null
let placesClientApiKey: string | null = null

const getPlacesClient = async (): Promise<PlacesClient> => {
  const apiKey = await getGoogleApiKey()
  if (!placesClient || placesClientApiKey !== apiKey) {
    placesClient = new PlacesClient({ apiKey, timeout: googleTimeoutMs })
    placesClientApiKey = apiKey
  }
  return placesClient
}

/* Geocoding */

export const fetchAddressFromGeocode = async (latitude: number, longitude: number): Promise<ReverseGeocodeResponse> => {
  const result = await geocodeClient.reverseGeocode({
    params: {
      key: await getGoogleApiKey(),
      latlng: {
        lat: latitude,
        lng: longitude,
      },
      result_type: [AddressType.street_address, AddressType.postal_code],
    },
    timeout: googleTimeoutMs,
  })
  return result
}

export const fetchGeocodeResults = async (address: string): Promise<GeocodedAddress> => {
  const result = await geocodeClient.geocode({
    params: {
      address,
      key: await getGoogleApiKey(),
    },
    timeout: googleTimeoutMs,
  })

  const location = result.data.results[0].geometry.location
  return {
    address: result.data.results[0].formatted_address,
    latLng: { latitude: location.lat, longitude: location.lng },
  }
}

/* Place photos */

const fetchPicture = async (name: string): Promise<string> => {
  const placesClient = await getPlacesClient()
  const response = await placesClient.getPhotoMedia({
    maxHeightPx: googleImageMaxHeight,
    maxWidthPx: googleImageMaxWidth,
    name,
  })
  return response[0].photoUri as string
}

/* Nearby search */

const searchNearbyFieldMask = {
  otherArgs: {
    headers: {
      'X-Goog-FieldMask':
        'places.id,places.types,places.nationalPhoneNumber,places.internationalPhoneNumber,places.formattedAddress,places.rating,places.websiteUri,places.currentOpeningHours,places.priceLevel,places.userRatingCount,places.priceLevel,places.displayName,places.editorialSummary,places.photos,places.generativeSummary,places.priceRange,places.utcOffsetMinutes,places.location',
    },
  },
}

interface GoogleOpeningHoursPeriodPoint {
  day: number
  hour: number
  minute: number
  date?: { year: number; month: number; day: number }
}

interface GooglePlace {
  id?: string | null
  formattedAddress?: string | null
  nationalPhoneNumber?: string | null
  internationalPhoneNumber?: string | null
  displayName?: { text?: string | null } | null
  currentOpeningHours?: {
    openNow?: boolean | null
    weekdayDescriptions?: string[] | null
    periods?: { open?: GoogleOpeningHoursPeriodPoint; close?: GoogleOpeningHoursPeriodPoint }[] | null
  } | null
  location?: { latitude?: number | null; longitude?: number | null } | null
  photos?: { name?: string | null }[] | null
  priceLevel?: string | null
  rating?: number | null
  types?: string[] | null
  userRatingCount?: number | null
  utcOffsetMinutes?: number | null
  websiteUri?: string | null
}

/** Intermediate shape: PlaceDetails without resolved photos, carrying raw photo refs instead. */
interface RawPlaceWithRefs extends Omit<PlaceDetails, 'photos'> {
  photoRefs: string[]
}

const EARTH_RADIUS_MILES = 3_958.8

const haversineDistanceMiles = (from: LatLng, to: LatLng): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(to.latitude - from.latitude)
  const dLng = toRad(to.longitude - from.longitude)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(from.latitude)) * Math.cos(toRad(to.latitude)) * Math.sin(dLng / 2) ** 2
  return EARTH_RADIUS_MILES * 2 * Math.asin(Math.sqrt(a))
}

/** Map a GooglePlace to RawPlaceWithRefs (no photo fetching). */
const toRawPlace = (place: GooglePlace, origin: LatLng): RawPlaceWithRefs => {
  const raw: RawPlaceWithRefs = {
    formattedAddress: place.formattedAddress,
    formattedPhoneNumber: place.nationalPhoneNumber,
    internationalPhoneNumber: place.internationalPhoneNumber,
    name: place.displayName?.text,
    openHours: place.currentOpeningHours?.weekdayDescriptions,
    openNow: place.currentOpeningHours?.openNow,
    openingHoursPeriods: place.currentOpeningHours?.periods
      ?.filter((p) => p.open != null)
      .map((p) => ({
        open: { day: p.open!.day, hour: p.open!.hour, minute: p.open!.minute, date: p.open!.date },
        close: p.close
          ? { day: p.close.day, hour: p.close.hour, minute: p.close.minute, date: p.close.date }
          : undefined,
      })),
    utcOffsetMinutes: place.utcOffsetMinutes,
    photoRefs: place.photos?.slice(0, googleImageCount).map((p) => `${p.name}/media`) ?? [],
    placeId: place.id as string,
    priceLevel: place.priceLevel as PriceLevel,
    rating: place.rating,
    ratingsTotal: place.userRatingCount,
    placeTypes: place.types,
    website: place.websiteUri,
  }
  if (place.location?.latitude != null && place.location?.longitude != null) {
    raw.distanceMiles = haversineDistanceMiles(origin, {
      latitude: place.location.latitude,
      longitude: place.location.longitude,
    })
  }
  return raw
}

const PHOTO_CONCURRENCY = 5

// The new Places API (v1) searchNearby returns at most 20 results per call
// and has no page token mechanism.
const MAX_RESULTS_PER_REQUEST = 20

/** Single-strategy search: calls Google Places API once with the given rankPreference. */
const searchNearby = async (
  location: LatLng,
  types: string[],
  exclude: string[],
  rankBy: GoogleRankBy,
  radius: number,
): Promise<GooglePlace[]> => {
  const placesClient = await getPlacesClient()
  const response = await placesClient.searchNearby(
    {
      excludedTypes: HIDDEN_TYPES.concat(exclude),
      includedPrimaryTypes: types,
      languageCode: 'en',
      locationRestriction: {
        circle: {
          center: location,
          radius,
        },
      },
      maxResultCount: MAX_RESULTS_PER_REQUEST,
      rankPreference: rankBy,
    },
    searchNearbyFieldMask,
  )
  return (response[0].places ?? []) as GooglePlace[]
}

export const interleaveArrays = <T>(a: T[], b: T[], random = Math.random): T[] => {
  const [first, second] = random() < 0.5 ? [a, b] : [b, a]
  const result: T[] = []
  const maxLen = Math.max(first.length, second.length)
  for (let i = 0; i < maxLen; i++) {
    if (i < first.length) result.push(first[i])
    if (i < second.length) result.push(second[i])
  }
  return result
}

/** Deduplicate places by placeId, keeping the first occurrence. */
const dedupeByPlaceId = <T extends { placeId: string }>(places: T[]): T[] => {
  const seen = new Set<string>()
  return places.filter((p) => {
    if (seen.has(p.placeId)) return false
    seen.add(p.placeId)
    return true
  })
}

/**
 * Fetch place results for any RankByType.
 *
 * - DISTANCE / POPULARITY: single API call.
 * - ALL: parallel POPULARITY + DISTANCE calls, deduplicated by placeId
 *   (popularity results first). If one query fails, the other's results are used.
 *
 * Photos are fetched with bounded concurrency (max 5 at a time).
 * Individual photo failures are logged and result in an empty string being omitted.
 */
export const fetchPlaceResults = async (
  location: LatLng,
  types: string[],
  exclude: string[],
  rankBy: RankByType,
  radius: number,
  random = Math.random,
): Promise<PlaceDetails[]> => {
  let rawPlaces: GooglePlace[]

  if (rankBy === 'ALL') {
    const results = await Promise.allSettled([
      searchNearby(location, types, exclude, 'POPULARITY', radius),
      searchNearby(location, types, exclude, 'DISTANCE', radius),
    ])

    const popularityPlaces = results[0].status === 'fulfilled' ? results[0].value : []
    const distancePlaces = results[1].status === 'fulfilled' ? results[1].value : []

    if (results[0].status === 'rejected') {
      logWarn('POPULARITY search failed in ALL mode, continuing with DISTANCE results', results[0].reason)
    }
    if (results[1].status === 'rejected') {
      logWarn('DISTANCE search failed in ALL mode, continuing with POPULARITY results', results[1].reason)
    }
    if (results[0].status === 'rejected' && results[1].status === 'rejected') {
      throw results[0].reason
    }

    rawPlaces = interleaveArrays(popularityPlaces, distancePlaces, random)
  } else {
    rawPlaces = await searchNearby(location, types, exclude, rankBy, radius)
  }

  const mapped = rawPlaces.map((p) => toRawPlace(p, location))
  const unique = dedupeByPlaceId(mapped)

  // Collect all photo refs with back-references, then resolve in batches
  const allRefs: { placeIdx: number; ref: string }[] = []
  for (let i = 0; i < unique.length; i++) {
    for (const ref of unique[i].photoRefs) {
      allRefs.push({ placeIdx: i, ref })
    }
  }

  const photosByPlace: string[][] = unique.map(() => [])
  for (let i = 0; i < allRefs.length; i += PHOTO_CONCURRENCY) {
    const batch = allRefs.slice(i, i + PHOTO_CONCURRENCY)
    const settled = await Promise.allSettled(batch.map((entry) => fetchPicture(entry.ref)))
    settled.forEach((result, j) => {
      if (result.status === 'fulfilled') {
        photosByPlace[batch[j].placeIdx].push(result.value)
      } else {
        logWarn('Failed to fetch photo, skipping', batch[j].ref, result.reason)
      }
    })
  }

  return unique.map((place, i) => {
    const result: PlaceDetails = {
      formattedAddress: place.formattedAddress,
      formattedPhoneNumber: place.formattedPhoneNumber,
      internationalPhoneNumber: place.internationalPhoneNumber,
      name: place.name,
      openHours: place.openHours,
      openNow: place.openNow,
      openingHoursPeriods: place.openingHoursPeriods,
      utcOffsetMinutes: place.utcOffsetMinutes,
      photos: photosByPlace[i],
      placeId: place.placeId,
      priceLevel: place.priceLevel,
      rating: place.rating,
      ratingsTotal: place.ratingsTotal,
      placeTypes: place.placeTypes,
      website: place.website,
    }
    if (place.distanceMiles !== undefined) result.distanceMiles = place.distanceMiles
    return result
  })
}
