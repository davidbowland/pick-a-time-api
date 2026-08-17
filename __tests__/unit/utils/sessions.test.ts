import { session } from '../__mocks__'
import { NotFoundError } from '@errors'
import { assertSessionActive } from '@utils/sessions'

describe('assertSessionActive', () => {
  // Epoch seconds 1_728_547_851 -- the same instant the calendar suites pin their clocks to.
  const nowMs = 1_728_547_851_000
  const now = (): number => nowMs

  it('should throw NotFoundError when the session is expired', () => {
    const expiredSession = { ...session, expiration: 1 }
    expect(() => assertSessionActive(expiredSession)).toThrow(new NotFoundError('Session not found'))
  })

  it('should not throw when the session is active', () => {
    const activeSession = { ...session, expiration: 9999999999 }
    expect(() => assertSessionActive(activeSession)).not.toThrow()
  })

  // Without an injectable clock the two tests above are the only ones that can be written: every
  // boundary case has to be expressed as a date so far from today that the wall clock cannot reach
  // it, which is the same as not testing the boundary at all. These two pin the comparison exactly.
  it('should throw against an injected clock one second past expiration', () => {
    const expiringSession = { ...session, expiration: 1_728_547_850 }
    expect(() => assertSessionActive(expiringSession, now)).toThrow(new NotFoundError('Session not found'))
  })

  it('should not throw against an injected clock on the expiration second itself', () => {
    const expiringSession = { ...session, expiration: 1_728_547_851 }
    expect(() => assertSessionActive(expiringSession, now)).not.toThrow()
  })
})
