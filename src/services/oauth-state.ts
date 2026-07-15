import jwt from 'jsonwebtoken'

import { getOauthStateSecret } from './secrets'

const STATE_EXPIRY_SECONDS = 600 // 10 minutes — long enough to complete Google's consent screen

export const signCalendarState = async (googleSub: string): Promise<string> => {
  const secret = await getOauthStateSecret()
  return jwt.sign({ googleSub }, secret, { expiresIn: STATE_EXPIRY_SECONDS })
}

export const verifyCalendarState = async (state: string): Promise<string> => {
  const secret = await getOauthStateSecret()
  const decoded = jwt.verify(state, secret, { algorithms: ['HS256'] }) as { googleSub: string }
  return decoded.googleSub
}
