import { NotFoundError } from '@errors'

import { choicesRecord } from '../__mocks__'
import * as dynamodb from '@services/dynamodb'
import { notifyNewRound, notifyWinner } from '@services/notifications'
import * as sms from '@services/sms'
import { UserRecord } from '@types'

jest.mock('@services/dynamodb')
jest.mock('@services/sms')
jest.mock('@utils/logging', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  xrayCapture: jest.fn((x: unknown) => x),
  xrayCaptureHttps: jest.fn(),
}))

const baseUser: UserRecord = {
  userId: 'fuzzy-penguin',
  googleSub: null,
  name: null,
  phone: '+15551234567',
  subscribedRounds: [0, 1],
  votes: [[]],
  textsSent: 0,
  expiration: 9999999999,
}

describe('notifications', () => {
  beforeAll(() => {
    jest.mocked(sms).sendSms.mockResolvedValue({} as any)
    jest.mocked(dynamodb).getChoices.mockResolvedValue(choicesRecord)
  })

  describe('notifyNewRound', () => {
    it('should send SMS to users subscribed to the new round', async () => {
      await notifyNewRound([baseUser], 1, 'abc123')
      expect(sms.sendSms).toHaveBeenCalledWith('+15551234567', expect.stringContaining('Round 2'))
    })

    it('should include user ID in the link', async () => {
      await notifyNewRound([baseUser], 1, 'abc123')
      expect(sms.sendSms).toHaveBeenCalledWith('+15551234567', expect.stringContaining('?id=fuzzy-penguin'))
    })

    it('should not send SMS to users not subscribed to the round', async () => {
      const unsubscribed = { ...baseUser, subscribedRounds: [0] }
      await notifyNewRound([unsubscribed], 1, 'abc123')
      expect(sms.sendSms).not.toHaveBeenCalled()
    })

    it('should not send SMS to users without a phone number', async () => {
      const noPhone = { ...baseUser, phone: null }
      await notifyNewRound([noPhone], 1, 'abc123')
      expect(sms.sendSms).not.toHaveBeenCalled()
    })

    it('should not throw when SMS fails for a subscriber', async () => {
      jest.mocked(sms).sendSms.mockRejectedValueOnce(new Error('SMS failed'))
      await expect(notifyNewRound([baseUser], 1, 'abc123')).resolves.toBeUndefined()
    })
  })

  describe('notifyWinner', () => {
    it('should send SMS with restaurant name to subscribed users', async () => {
      await notifyWinner([baseUser], 'choice-1', 'abc123', 0)
      expect(sms.sendSms).toHaveBeenCalledWith('+15551234567', expect.stringContaining('Flat Branch Pub & Brewing'))
    })

    it('should include session link with user ID', async () => {
      await notifyWinner([baseUser], 'choice-1', 'abc123', 0)
      expect(sms.sendSms).toHaveBeenCalledWith(
        '+15551234567',
        expect.stringContaining('https://choosee.bowland.link/s/abc123?id=fuzzy-penguin'),
      )
    })

    it('should fetch choices only once regardless of subscriber count', async () => {
      const user2 = { ...baseUser, userId: 'brave-tiger', phone: '+15559876543' }
      await notifyWinner([baseUser, user2], 'choice-1', 'abc123', 0)
      expect(dynamodb.getChoices).toHaveBeenCalledTimes(1)
    })

    it('should fall back to choice ID when choices lookup fails', async () => {
      jest.mocked(dynamodb).getChoices.mockRejectedValueOnce(new NotFoundError('Choices not found'))
      await notifyWinner([baseUser], 'choice-99', 'abc123', 0)
      expect(sms.sendSms).toHaveBeenCalledWith('+15551234567', expect.stringContaining('choice-99'))
    })

    it('should not send SMS to users not subscribed to the closed round', async () => {
      const unsubscribed = { ...baseUser, subscribedRounds: [1] }
      await notifyWinner([unsubscribed], 'choice-1', 'abc123', 0)
      expect(sms.sendSms).not.toHaveBeenCalled()
    })

    it('should not fetch choices when no subscribers exist', async () => {
      const unsubscribed = { ...baseUser, subscribedRounds: [] }
      await notifyWinner([unsubscribed], 'choice-1', 'abc123', 0)
      expect(dynamodb.getChoices).not.toHaveBeenCalled()
    })

    it('should not throw when SMS fails for a subscriber', async () => {
      jest.mocked(sms).sendSms.mockRejectedValueOnce(new Error('SMS failed'))
      await expect(notifyWinner([baseUser], 'choice-1', 'abc123', 0)).resolves.toBeUndefined()
    })
  })
})
