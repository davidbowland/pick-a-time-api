import { randomInt as cryptoRandomInt } from 'crypto'

import { adjectives } from '../assets/adjectives'
import { nouns } from '../assets/nouns'

export const generateSessionId = (randomInt = cryptoRandomInt): string => {
  const adjective = adjectives[randomInt(adjectives.length)]
  const noun = nouns[randomInt(nouns.length)]
  return `${adjective}-${noun}`
}

export const generateUserId = (existingUserIds: string[], maxRetries = 5, randomInt = cryptoRandomInt): string => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const adjective = adjectives[randomInt(adjectives.length)]
    const noun = nouns[randomInt(nouns.length)]
    const id = `${adjective}-${noun}`

    if (!existingUserIds.includes(id)) {
      return id
    }
  }

  throw new Error('Failed to generate a unique user ID after maximum retries')
}
