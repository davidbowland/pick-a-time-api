import { googleSub } from '../__mocks__'
import { signCalendarState, verifyCalendarState } from '@services/oauth-state'
import * as secrets from '@services/secrets'

jest.mock('@services/secrets')

describe('oauth-state', () => {
  beforeAll(() => {
    jest.mocked(secrets).getOauthStateSecret.mockResolvedValue('test-signing-secret')
  })

  describe('signCalendarState / verifyCalendarState', () => {
    it('should round-trip: verify recovers the googleSub that was signed', async () => {
      const state = await signCalendarState(googleSub)
      const recovered = await verifyCalendarState(state)
      expect(recovered).toBe(googleSub)
    })

    it('should throw on a tampered state string', async () => {
      const state = await signCalendarState(googleSub)
      await expect(verifyCalendarState(`${state}tampered`)).rejects.toThrow()
    })

    it('should throw on a state signed with a different secret', async () => {
      const state = await signCalendarState(googleSub)
      jest.mocked(secrets).getOauthStateSecret.mockResolvedValueOnce('a-different-secret')
      await expect(verifyCalendarState(state)).rejects.toThrow()
    })
  })
})
