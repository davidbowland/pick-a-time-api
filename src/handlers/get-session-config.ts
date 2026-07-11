import placeTypes from '../assets/place-types'
import { radiusDefaultMiles, radiusMaxMiles, radiusMinMiles } from '../config'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, SessionConfig } from '../types'
import { log } from '../utils/logging'
import status from '../utils/status'

const sessionConfig: SessionConfig = {
  placeTypes,
  radius: {
    defaultMiles: radiusDefaultMiles,
    maxMiles: radiusMaxMiles,
    minMiles: radiusMinMiles,
  },
  sortOptions: [
    { description: 'Highest rated first', label: 'Most popular', maxChoices: 20, value: 'POPULARITY' },
    { description: 'Nearest to you', label: 'Closest', maxChoices: 20, value: 'DISTANCE' },
    { description: 'Popular & nearby', label: 'Both', maxChoices: 40, value: 'ALL' },
  ],
}

export const getSessionConfigHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2<any>> => {
  log('Received event', { ...event, body: undefined })
  return { ...status.OK, body: JSON.stringify(sessionConfig) }
}
