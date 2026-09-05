import { adjectives } from '@assets/adjectives'
import { excludedIdWords } from '@assets/excluded-id-words'
import { nouns } from '@assets/nouns'
import { generateSessionId, generateUserId } from '@utils/id-generator'

describe('id-generator', () => {
  const midRandom = (max: number) => Math.floor(max / 2)

  describe('generateSessionId', () => {
    it('should return an adjective-noun formatted ID', () => {
      const id = generateSessionId(midRandom)
      const [adj, noun] = id.split('-')

      expect(id).toMatch(/^[a-z]+-[a-z]+$/)
      expect(adjectives).toContain(adj)
      expect(nouns).toContain(noun)
    })

    it('should use the first word of each list', () => {
      expect(generateSessionId(() => 0)).toEqual(`${adjectives[0]}-${nouns[0]}`)
    })

    it('should use the last word of each list', () => {
      expect(generateSessionId((max: number) => max - 1)).toEqual(
        `${adjectives[adjectives.length - 1]}-${nouns[nouns.length - 1]}`,
      )
    })

    it('should never build an ID from an excluded word', () => {
      const ids = adjectives.map((_, index) => generateSessionId(() => index))
      const unsafe = ids.filter((id) => id.split('-').filter((word) => excludedIdWords.has(word)).length > 0)

      expect(unsafe).toEqual([])
    })
  })

  describe('generateUserId', () => {
    it('should return an adjective-noun formatted ID', () => {
      const id = generateUserId([], 5, midRandom)
      const [adj, noun] = id.split('-')
      expect(id).toMatch(/^[a-z]+-[a-z]+$/)
      expect(adjectives).toContain(adj)
      expect(nouns).toContain(noun)
    })

    it('should never build an ID from an excluded word', () => {
      const ids = adjectives.map((_, index) => generateUserId([], 5, () => index))
      const unsafe = ids.filter((id) => id.split('-').filter((word) => excludedIdWords.has(word)).length > 0)

      expect(unsafe).toEqual([])
    })

    it('should return an ID not in the existing list', () => {
      const id = generateUserId(['fuzzy-penguin', 'bold-castle'], 5, midRandom)
      expect(id).not.toBe('fuzzy-penguin')
      expect(id).not.toBe('bold-castle')
    })

    it('should retry on collision and return a unique ID', () => {
      let call = 0
      const mockRandomInt = () => [0, 0, 1, 1][call++]

      const collidingId = `${adjectives[0]}-${nouns[0]}`
      const id = generateUserId([collidingId], 5, mockRandomInt)

      expect(id).not.toBe(collidingId)
      expect(id.split('-')).toHaveLength(2)
    })

    it('should throw after maxRetries exhausted', () => {
      const collidingId = `${adjectives[0]}-${nouns[0]}`
      expect(() => generateUserId([collidingId], 3, () => 0)).toThrow('Failed to generate a unique user ID')
    })

    it('should respect custom maxRetries', () => {
      const collidingId = `${adjectives[0]}-${nouns[0]}`
      expect(() => generateUserId([collidingId], 1, () => 0)).toThrow()
    })

    it('should succeed on first try with empty existing list', () => {
      const id = generateUserId([], 5, midRandom)
      expect(id).toMatch(/^.+-.+$/)
    })
  })
})
