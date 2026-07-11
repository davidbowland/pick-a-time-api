import { NotFoundError } from '@errors'

import { choicesRecord } from '../__mocks__'
import eventJson from '@events/get-choices.json'
import { handler } from '@handlers/get-choices'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'
import status from '@utils/status'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging')

describe('get-choices', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2

  beforeAll(() => {
    jest.mocked(dynamodb).getChoices.mockResolvedValue(choicesRecord)
  })

  describe('handler', () => {
    it('should return OK with choices keyed by ID', async () => {
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.OK))
      expect(JSON.parse(result.body as string)).toEqual(choicesRecord.choices)
    })

    it('should return NOT_FOUND when getChoices throws NotFoundError', async () => {
      jest.mocked(dynamodb).getChoices.mockRejectedValueOnce(new NotFoundError('Choices not found'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.NOT_FOUND))
    })

    it('should return INTERNAL_SERVER_ERROR on unexpected errors', async () => {
      jest.mocked(dynamodb).getChoices.mockRejectedValueOnce(new Error('DynamoDB error'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining(status.INTERNAL_SERVER_ERROR))
    })
  })
})
