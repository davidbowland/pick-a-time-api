import { NotFoundError } from '../errors'
import { PollRecord } from '../types'

export const assertSessionActive = (session: PollRecord): void => {
  if (session.expiration < Math.floor(Date.now() / 1000)) {
    throw new NotFoundError('Session not found')
  }
}
