import { NotFoundError } from '../errors'
import { PlanRecord } from '../types'

export const assertSessionActive = (session: PlanRecord): void => {
  if (session.expiration < Math.floor(Date.now() / 1000)) {
    throw new NotFoundError('Session not found')
  }
}
