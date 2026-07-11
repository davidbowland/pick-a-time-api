export { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Callback, Context } from 'aws-lambda'
export { Operation as PatchOperation } from 'fast-json-patch'

// Enums and simple types

export type PriceLevel =
  | 'PRICE_LEVEL_UNSPECIFIED'
  | 'PRICE_LEVEL_FREE'
  | 'PRICE_LEVEL_INEXPENSIVE'
  | 'PRICE_LEVEL_MODERATE'
  | 'PRICE_LEVEL_EXPENSIVE'
  | 'PRICE_LEVEL_VERY_EXPENSIVE'

export type GoogleRankBy = 'DISTANCE' | 'POPULARITY'
export type RankByType = GoogleRankBy | 'ALL'

export interface LatLng {
  latitude: number
  longitude: number
}

// Place types

export interface OpeningHoursPeriod {
  open: { day: number; hour: number; minute: number; date?: { year: number; month: number; day: number } }
  close?: { day: number; hour: number; minute: number; date?: { year: number; month: number; day: number } }
}

export interface PlaceDetails {
  formattedAddress?: string | null
  formattedPhoneNumber?: string | null
  internationalPhoneNumber?: string | null
  name?: string | null
  openHours?: string[] | null
  openNow?: boolean | null
  openingHoursPeriods?: OpeningHoursPeriod[] | null
  utcOffsetMinutes?: number | null
  photos: string[]
  placeId: string
  priceLevel?: PriceLevel | null
  rating?: number | null
  ratingsTotal?: number | null
  distanceMiles?: number
  placeTypes?: string[] | null
  website?: string | null
}

export interface PlaceTypeDisplay {
  canBeExcluded?: boolean
  defaultExclude?: boolean
  defaultType?: boolean
  display: string
  mustBeSingleType?: boolean
  value: string
}

export interface GeocodedAddress {
  address: string
  latLng: LatLng
}

// DynamoDB record types — single-table design
// PlaceDetails (above) represents raw Google API responses where fields can be null.
// ChoiceDetail (below) represents cleaned restaurant data stored in DynamoDB after null-stripping.

export interface SessionRecord {
  sessionId: string
  address: string
  location: LatLng | null
  currentRound: number
  bracket: [string, string][][]
  byes: (string | null)[]
  isReady: boolean
  errorMessage: string | null
  timeoutAt: number | undefined
  winner: string | null
  expiration: number
  type: string[]
  exclude: string[]
  radius: number
  rankBy: RankByType
  filterClosingSoon?: boolean
  totalRounds: number
  votersSubmitted: number
}

export interface VersionedSession {
  session: SessionRecord
  users: string[]
  version: number
}

export interface ChoicesRecord {
  choices: Record<string, ChoiceDetail>
  expiration: number
}

export interface ChoiceDetail {
  choiceId: string
  name: string
  formattedAddress?: string
  formattedPhoneNumber?: string
  internationalPhoneNumber?: string
  priceLevel?: PriceLevel
  rating?: number
  ratingsTotal?: number
  distanceMiles?: number
  photos: string[]
  openHours?: string[]
  openNow?: boolean
  isClosingSoon: boolean
  placeTypes: string[]
  website?: string
}

export interface UserRecord {
  userId: string
  googleSub: string | null
  name: string | null
  phone: string | null
  subscribedRounds: number[]
  votes: (string | null)[][]
  textsSent: number
  expiration: number
}

// Input types

export interface SortOption {
  value: RankByType
  label: string
  description: string
  maxChoices: number
}

export interface RadiusConstraints {
  defaultMiles: number
  minMiles: number
  maxMiles: number
}

export interface SessionConfig {
  placeTypes: PlaceTypeDisplay[]
  sortOptions: SortOption[]
  radius: RadiusConstraints
}

export interface NewSessionInput {
  address: string
  type: string[]
  exclude: string[]
  radiusMiles: number
  rankBy: RankByType
  filterClosingSoon: boolean
  latitude?: number
  longitude?: number
}

export interface ShareInput {
  phone: string
  type: 'text'
}

export interface SubscribeInput {
  userId: string
  roundId: number
}

export interface CloseRoundInput {
  roundId: number
}

// Auth

export interface AuthContext {
  isAuthenticated: boolean
  googleSub: string | null
  googleName?: string
  googlePhone?: string
}

// SMS

export type MessageType = 'PROMOTIONAL' | 'TRANSACTIONAL'

export interface SMSMessage {
  to: string
  contents: string
  messageType?: MessageType
}
