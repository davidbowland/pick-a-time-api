import { NotFoundError } from '@errors'

import { session } from '../__mocks__'
import { assertSessionActive } from '@utils/sessions'

describe('assertSessionActive', () => {
  it('should throw NotFoundError when the session is expired', () => {
    const expiredSession = { ...session, expiration: 1 }
    expect(() => assertSessionActive(expiredSession)).toThrow(new NotFoundError('Session not found'))
  })

  it('should not throw when the session is active', () => {
    const activeSession = { ...session, expiration: 9999999999 }
    expect(() => assertSessionActive(activeSession)).not.toThrow()
  })
})
