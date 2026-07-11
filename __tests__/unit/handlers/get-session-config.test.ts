import eventJson from '@events/get-session-config.json'
import { getSessionConfigHandler } from '@handlers/get-session-config'
import { APIGatewayProxyEventV2, SessionConfig } from '@types'

jest.mock('@utils/logging')

describe('get-session-config', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2

  describe('getSessionConfigHandler', () => {
    it('should return OK status with session config', async () => {
      const result = await getSessionConfigHandler(event)
      const config = JSON.parse(result.body) as SessionConfig

      expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
      expect(config.placeTypes).toEqual(
        expect.arrayContaining([
          {
            canBeExcluded: false,
            defaultType: true,
            display: 'Any restaurant',
            mustBeSingleType: true,
            value: 'restaurant',
          },
          { display: 'Cat cafe', value: 'cat_cafe' },
          { defaultExclude: true, display: 'Fast food', value: 'fast_food_restaurant' },
        ]),
      )
      expect(config.sortOptions).toEqual([
        { description: 'Highest rated first', label: 'Most popular', maxChoices: 20, value: 'POPULARITY' },
        { description: 'Nearest to you', label: 'Closest', maxChoices: 20, value: 'DISTANCE' },
        { description: 'Popular & nearby', label: 'Both', maxChoices: 40, value: 'ALL' },
      ])
      expect(config.radius).toEqual({ defaultMiles: 15, minMiles: 1, maxMiles: 30 })
    })
  })
})
