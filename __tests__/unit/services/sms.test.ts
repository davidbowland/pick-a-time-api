import { sendSms } from '@services/sms'

const mockPost = jest.fn()
jest.mock('axios', () => ({
  create: jest.fn().mockImplementation(() => ({ post: (...args) => mockPost(...args) })),
}))
jest.mock('axios-retry')
jest.mock('@utils/logging')
jest.mock('@services/secrets', () => ({
  getSmsApiKey: jest.fn().mockResolvedValue('3edfgr4ertyjkijhg8'),
}))

describe('queue', () => {
  describe('sendSms', () => {
    const to = '+1800JENNYCRAIG'
    const contents = 'Hello, Goodbye!'

    beforeAll(() => {
      mockPost.mockResolvedValue({ status: 200 })
    })

    it('should pass sms contents to the endpoint', async () => {
      await sendSms(to, contents)
      expect(mockPost).toHaveBeenCalledWith(
        '/messages',
        {
          contents,
          messageType: 'TRANSACTIONAL',
          to,
        },
        { headers: { 'x-api-key': '3edfgr4ertyjkijhg8' } },
      )
    })
  })
})
