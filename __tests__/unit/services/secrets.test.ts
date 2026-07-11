import { getRecaptchaSecretKey } from '@services/secrets'

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
})
