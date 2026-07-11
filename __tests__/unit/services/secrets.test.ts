import { getRecaptchaSecretKey, getSmsApiKey } from '@services/secrets'

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
