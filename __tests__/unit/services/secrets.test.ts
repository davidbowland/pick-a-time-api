import { getGoogleApiKey, getRecaptchaSecretKey, getSmsApiKey } from '@services/secrets'

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

  describe('getGoogleApiKey', () => {
    it('should fetch the google-places-api parameter with decryption', async () => {
      await getGoogleApiKey(() => 1_000_000)
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ Name: 'google-places-api', WithDecryption: true }),
      )
    })

    it('should return the fetched value', async () => {
      const result = await getGoogleApiKey(() => 1_000_000)
      expect(result).toEqual('fetched-value')
    })

    it('should not call SSM again when the cached value has not expired', async () => {
      await getGoogleApiKey(() => 1_000_000)
      const callsAfterFirstFetch = mockSend.mock.calls.length
      await getGoogleApiKey(() => 1_000_001)
      expect(mockSend.mock.calls.length).toBe(callsAfterFirstFetch)
    })

    it('should call SSM again when the cached value has expired', async () => {
      await getGoogleApiKey(() => 1_000_000)
      const callsAfterFirstFetch = mockSend.mock.calls.length
      await getGoogleApiKey(() => 1_000_000 + TTL_MS + 1)
      expect(mockSend.mock.calls.length).toBeGreaterThan(callsAfterFirstFetch)
    })

    it('should propagate the error when the SSM call fails', async () => {
      mockSend.mockRejectedValueOnce(new Error('ParameterNotFound'))
      await expect(getGoogleApiKey(() => 4_000_000)).rejects.toThrow('ParameterNotFound')
    })

    it('should throw and not cache when SSM returns a response with no parameter value', async () => {
      mockSend.mockResolvedValueOnce({ Parameter: {} })
      await expect(getGoogleApiKey(() => 10_000_000)).rejects.toThrow('google-places-api has no value')
    })
  })

  describe('getRecaptchaSecretKey', () => {
    it('should fetch the /choosee/recaptcha-secret-key parameter with decryption', async () => {
      await getRecaptchaSecretKey(() => 2_000_000)
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ Name: '/choosee/recaptcha-secret-key', WithDecryption: true }),
      )
    })
  })

  describe('getSmsApiKey', () => {
    it('should fetch the configured SMS parameter name with decryption', async () => {
      await getSmsApiKey(() => 3_000_000)
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ Name: 'sms-queue-api-key-test', WithDecryption: true }),
      )
    })
  })
})
