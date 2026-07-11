import placeTypes from '../assets/place-types'
import { radiusMaxMiles, radiusMinMiles } from '../config'
import { ValidationError } from '../errors'
import {
  APIGatewayProxyEventV2,
  CloseRoundInput,
  LatLng,
  NewSessionInput,
  PatchOperation,
  RankByType,
  ShareInput,
  SubscribeInput,
} from '../types'

const PHONE_REGEX = /^\+1[2-9]\d{9}$/
const VOTES_PATH_REGEX = /^\/votes\/\d+\/\d+$/
const ALLOWED_PATCH_OPS = ['replace', 'add', 'test']

const requireBody = (event: APIGatewayProxyEventV2): string => {
  const raw = event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
  if (!raw) {
    throw new ValidationError('request body is required')
  }
  return raw
}

const parseEventBody = (event: APIGatewayProxyEventV2): unknown => JSON.parse(requireBody(event))

interface LatLngParams {
  latitude: number
  longitude: number
}

export const formatLatLng = (latLng: LatLngParams): LatLng => {
  const latitude = parseFloat(String(latLng.latitude))
  const longitude = parseFloat(String(latLng.longitude))
  if (isNaN(latitude) || isNaN(longitude)) {
    throw new ValidationError('latitude and longitude query parameters must be provided')
  } else if (latitude < -90 || latitude > 90) {
    throw new ValidationError('latitude must be between -90 and 90')
  } else if (longitude < -180 || longitude > 180) {
    throw new ValidationError('longitude must be between -180 and 180')
  }
  return { latitude, longitude }
}

export const parseNewSessionBody = (event: APIGatewayProxyEventV2): NewSessionInput => {
  const body = parseEventBody(event) as Record<string, unknown>
  const placeTypeValues = placeTypes.map((t) => t.value)

  if (typeof body.address !== 'string' || body.address.trim().length === 0) {
    throw new ValidationError('address is required')
  }

  if (!Array.isArray(body.type) || body.type.length === 0) {
    throw new ValidationError('type must be a non-empty array of valid place types')
  }
  for (const t of body.type) {
    if (!placeTypeValues.includes(t as string)) {
      throw new ValidationError(`invalid place type: ${t}`)
    }
  }

  const exclude: string[] = []
  if (body.exclude !== undefined) {
    if (!Array.isArray(body.exclude)) {
      throw new ValidationError('exclude must be an array of valid place types')
    }
    for (const e of body.exclude) {
      if (!placeTypeValues.includes(e as string)) {
        throw new ValidationError(`invalid exclude place type: ${e}`)
      }
      exclude.push(e as string)
    }
  }

  if (
    typeof body.radiusMiles !== 'number' ||
    isNaN(body.radiusMiles) ||
    body.radiusMiles < radiusMinMiles ||
    body.radiusMiles > radiusMaxMiles
  ) {
    throw new ValidationError(`radiusMiles must be a number between ${radiusMinMiles} and ${radiusMaxMiles}`)
  }

  if (body.rankBy !== 'DISTANCE' && body.rankBy !== 'POPULARITY' && body.rankBy !== 'ALL') {
    throw new ValidationError('rankBy must be ALL, DISTANCE, or POPULARITY')
  }

  const hasLat = body.latitude !== undefined
  const hasLng = body.longitude !== undefined
  if (hasLat !== hasLng) {
    throw new ValidationError('latitude and longitude must both be present or both absent')
  }

  if (typeof body.filterClosingSoon !== 'boolean') {
    throw new ValidationError('filterClosingSoon is required and must be a boolean')
  }

  const result: NewSessionInput = {
    address: body.address as string,
    exclude,
    filterClosingSoon: body.filterClosingSoon,
    radiusMiles: body.radiusMiles as number,
    rankBy: body.rankBy as RankByType,
    type: body.type as string[],
  }

  if (hasLat) {
    if (typeof body.latitude !== 'number' || typeof body.longitude !== 'number') {
      throw new ValidationError('latitude and longitude must be numbers')
    }
    const validated = formatLatLng({ latitude: body.latitude as number, longitude: body.longitude as number })
    result.latitude = validated.latitude
    result.longitude = validated.longitude
  }

  return result
}

export const parseUserPatch = (event: APIGatewayProxyEventV2): PatchOperation[] => {
  const ops = parseEventBody(event) as PatchOperation[]

  if (!Array.isArray(ops)) {
    throw new ValidationError('request body must be an array of patch operations')
  }

  for (const op of ops) {
    if (!ALLOWED_PATCH_OPS.includes(op.op)) {
      throw new ValidationError(`disallowed patch op: ${op.op}`)
    }

    const path = op.path
    if (path !== '/name' && path !== '/phone' && !VOTES_PATH_REGEX.test(path)) {
      throw new ValidationError(`disallowed patch path: ${path}`)
    }

    if (path === '/name' && 'value' in op) {
      const name = op.value as string
      if (typeof name === 'string' && name.length > 50) {
        throw new ValidationError('name must be 50 characters or fewer')
      }
    }

    if (path === '/phone' && 'value' in op) {
      const phone = op.value as string
      if (typeof phone === 'string' && !PHONE_REGEX.test(phone)) {
        throw new ValidationError('phone must match format +1XXXXXXXXXX')
      }
    }
  }

  return ops
}

export const parseLatLng = (event: APIGatewayProxyEventV2): LatLng => {
  const params = event.queryStringParameters ?? {}
  return formatLatLng({
    latitude: parseFloat(params.latitude as string),
    longitude: parseFloat(params.longitude as string),
  })
}

export const extractRecaptchaToken = (event: APIGatewayProxyEventV2): string => {
  const token = event.headers['x-recaptcha-token']
  if (!token) {
    throw new ValidationError('x-recaptcha-token header is required')
  }
  return token
}

export const parseShareBody = (event: APIGatewayProxyEventV2): ShareInput => {
  const body = parseEventBody(event) as Record<string, unknown>

  if (typeof body.phone !== 'string' || !PHONE_REGEX.test(body.phone)) {
    throw new ValidationError('phone must match format +1XXXXXXXXXX')
  }

  if (body.type !== 'text') {
    throw new ValidationError('type must be "text"')
  }

  return { phone: body.phone, type: 'text' }
}

export const parseSubscribeBody = (event: APIGatewayProxyEventV2): SubscribeInput => {
  const body = parseEventBody(event) as Record<string, unknown>

  if (typeof body.userId !== 'string' || body.userId.trim().length === 0) {
    throw new ValidationError('userId is required')
  }

  if (typeof body.roundId !== 'number' || !Number.isInteger(body.roundId) || body.roundId < 0) {
    throw new ValidationError('roundId must be a non-negative integer')
  }

  return { roundId: body.roundId, userId: body.userId }
}

export const parseCloseRoundInput = (event: APIGatewayProxyEventV2): CloseRoundInput => {
  const roundIdStr = event.pathParameters?.roundId
  const roundId = Number(roundIdStr)

  if (roundIdStr === undefined || isNaN(roundId) || !Number.isInteger(roundId) || roundId < 0) {
    throw new ValidationError('roundId path parameter must be a non-negative integer')
  }

  return { roundId }
}
