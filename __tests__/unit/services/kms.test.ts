import { decryptRefreshToken, encryptRefreshToken } from '@services/kms'

const mockSend = jest.fn()
jest.mock('@aws-sdk/client-kms', () => ({
  DecryptCommand: jest.fn().mockImplementation((x) => x),
  EncryptCommand: jest.fn().mockImplementation((x) => x),
  KMS: jest.fn(() => ({
    send: (...args: any[]) => mockSend(...args),
  })),
}))
jest.mock('@utils/logging', () => ({
  xrayCapture: jest.fn().mockImplementation((x) => x),
}))

describe('kms', () => {
  describe('encryptRefreshToken', () => {
    it('should return a base64 string of the ciphertext blob', async () => {
      mockSend.mockResolvedValueOnce({ CiphertextBlob: Buffer.from('cipher-bytes') })
      const result = await encryptRefreshToken('refresh-token-value')
      expect(result).toBe(Buffer.from('cipher-bytes').toString('base64'))
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ KeyId: 'test-kms-calendar-key-id', Plaintext: Buffer.from('refresh-token-value') }),
      )
    })

    it('should throw when KMS returns no CiphertextBlob', async () => {
      mockSend.mockResolvedValueOnce({})
      await expect(encryptRefreshToken('x')).rejects.toThrow('KMS Encrypt returned no CiphertextBlob')
    })
  })

  describe('decryptRefreshToken', () => {
    it('should return the decrypted plaintext as a utf8 string', async () => {
      mockSend.mockResolvedValueOnce({ Plaintext: Buffer.from('refresh-token-value') })
      const result = await decryptRefreshToken(Buffer.from('cipher-bytes').toString('base64'))
      expect(result).toBe('refresh-token-value')
    })

    it('should throw when KMS returns no Plaintext', async () => {
      mockSend.mockResolvedValueOnce({})
      await expect(decryptRefreshToken('abc')).rejects.toThrow('KMS Decrypt returned no Plaintext')
    })
  })
})
