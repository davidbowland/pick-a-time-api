import {
  getGoogleCalendarClientId,
  getGoogleCalendarClientSecret,
  getOauthStateSecret,
  getRecaptchaSecretKey,
} from '@services/secrets'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-ssm', () => ({
  GetParameterCommand: jest.fn().mockImplementation((x) => x),
  SSM: jest.fn(() => ({
    send: (...args: any[]) => mockSend(...args),
  })),
}))
jest.mock('@utils/logging', () => ({
  xrayCapture: jest.fn().mockImplementation((x) => x),
}))

const TTL_MS = 10 * 60 * 1000

describe('secrets', () => {
  beforeAll(() => {
    mockSend.mockResolvedValue({ Parameter: { Value: 'fetched-value' } })
  })

  describe('getRecaptchaSecretKey', () => {
    it('should fetch the /pick-a-time/recaptcha-secret-key parameter with decryption', async () => {
      await getRecaptchaSecretKey(() => 2_000_000)
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ Name: '/pick-a-time/recaptcha-secret-key', WithDecryption: true }),
      )
    })

    it('should return the cached value without calling SSM again inside the TTL', async () => {
      await getRecaptchaSecretKey(() => 5_000_000)
      mockSend.mockClear()
      const result = await getRecaptchaSecretKey(() => 5_000_000 + TTL_MS - 1)
      expect(result).toBe('fetched-value')
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should refetch once the cached value has expired', async () => {
      await getRecaptchaSecretKey(() => 10_000_000)
      mockSend.mockClear()
      await getRecaptchaSecretKey(() => 10_000_000 + TTL_MS + 1)
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ Name: '/pick-a-time/recaptcha-secret-key', WithDecryption: true }),
      )
    })

    it('should throw when the SSM parameter has no value', async () => {
      mockSend.mockResolvedValueOnce({ Parameter: {} })
      await expect(getRecaptchaSecretKey(() => 20_000_000)).rejects.toThrow(
        'SSM parameter /pick-a-time/recaptcha-secret-key has no value',
      )
    })
  })

  describe('getOauthStateSecret', () => {
    it('should fetch the oauth state secret parameter', async () => {
      mockSend.mockResolvedValueOnce({ Parameter: { Value: 'state-signing-secret' } })
      const result = await getOauthStateSecret(() => 0)
      expect(result).toBe('state-signing-secret')
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ Name: '/pick-a-time/oauth-state-secret', WithDecryption: true }),
      )
    })
  })

  describe('getGoogleCalendarClientId', () => {
    it('should fetch the calendar client id parameter', async () => {
      mockSend.mockResolvedValueOnce({ Parameter: { Value: 'calendar-client-id' } })
      const result = await getGoogleCalendarClientId(() => 0)
      expect(result).toBe('calendar-client-id')
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ Name: '/pick-a-time/google-client-id', WithDecryption: true }),
      )
    })
  })

  describe('getGoogleCalendarClientSecret', () => {
    it('should fetch the calendar client secret parameter', async () => {
      mockSend.mockResolvedValueOnce({ Parameter: { Value: 'calendar-client-secret' } })
      const result = await getGoogleCalendarClientSecret(() => 0)
      expect(result).toBe('calendar-client-secret')
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ Name: '/pick-a-time/google-client-secret', WithDecryption: true }),
      )
    })
  })
})
