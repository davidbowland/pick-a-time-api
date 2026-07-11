import { recaptchaToken } from '../__mocks__'
import { getCaptchaScore } from '@services/recaptcha'
import { logWarn } from '@utils/logging'

const mockPost = jest.fn()
jest.mock('axios', () => ({
  create: jest.fn().mockImplementation(() => ({ post: (...args) => mockPost(...args) })),
}))
jest.mock('axios-retry')
jest.mock('@utils/logging')
jest.mock('@services/secrets', () => ({
  getRecaptchaSecretKey: jest.fn().mockResolvedValue('ertyuiknbghj'),
}))

describe('recaptcha', () => {
  beforeAll(() => {
    mockPost.mockResolvedValue({ data: { success: true, score: 0.9 } })
  })

  describe('getCaptchaScore', () => {
    it('should pass token and secret to request', async () => {
      await getCaptchaScore(recaptchaToken)
      expect(mockPost).toHaveBeenCalledWith(
        'recaptcha/api/siteverify',
        {},
        {
          params: {
            response: 'ytrewsdfghjmnbgtyu',
            secret: 'ertyuiknbghj',
          },
        },
      )
    })

    it('should return score', async () => {
      const score = await getCaptchaScore(recaptchaToken)
      expect(score).toEqual(0.9)
    })

    it('should return 0 and warn when response is missing score', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true } })
      const score = await getCaptchaScore(recaptchaToken)
      expect(score).toEqual(0)
      expect(logWarn).toHaveBeenCalledWith('reCAPTCHA response missing score', { data: { success: true } })
    })

    it('should return 0 and warn when score is not a number', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true, score: undefined } })
      const score = await getCaptchaScore(recaptchaToken)
      expect(score).toEqual(0)
      expect(logWarn).toHaveBeenCalledWith('reCAPTCHA response missing score', {
        data: { success: true, score: undefined },
      })
    })

    it('should return 0 and warn when verification fails with error codes', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: false, 'error-codes': ['timeout-or-duplicate'] } })
      const score = await getCaptchaScore(recaptchaToken)
      expect(score).toEqual(0)
      expect(logWarn).toHaveBeenCalledWith('reCAPTCHA verification failed', {
        success: false,
        errorCodes: ['timeout-or-duplicate'],
      })
    })

    it('should return 0 and warn when verification fails without error codes', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: false } })
      const score = await getCaptchaScore(recaptchaToken)
      expect(score).toEqual(0)
      expect(logWarn).toHaveBeenCalledWith('reCAPTCHA verification failed', {
        success: false,
        errorCodes: [],
      })
    })
  })
})
