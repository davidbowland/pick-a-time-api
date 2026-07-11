import { UserRecord } from '../types'

export const stripGoogleSub = (user: UserRecord): Omit<UserRecord, 'googleSub'> => {
  const { googleSub: _, ...rest } = user
  return rest
}
