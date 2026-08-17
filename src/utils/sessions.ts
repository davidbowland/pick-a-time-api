import { NotFoundError } from '../errors'
import { PollRecord } from '../types'

// The clock is injected rather than read live, per the project's rule that anything deciding a test
// outcome from Date.now() must be passable in. Every caller today invokes this with one argument, so
// the default keeps them unchanged -- and the parameter is second, where no caller passes anything,
// so it can never collide with an argument a caller already supplies.
export const assertSessionActive = (session: PollRecord, now: () => number = Date.now): void => {
  if (session.expiration < Math.floor(now() / 1000)) {
    throw new NotFoundError('Session not found')
  }
}
