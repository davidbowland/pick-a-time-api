import { adjectives } from '@assets/adjectives'
import { nouns } from '@assets/nouns'
import { generateUserId } from '@utils/id-generator'

describe('id-generator', () => {
  describe('generateUserId', () => {
    const midRandom = (max: number) => Math.floor(max / 2)

    it('should return an adjective-noun formatted ID', () => {
      const id = generateUserId([], 5, midRandom)
      const [adj, noun] = id.split('-')
      expect(adjectives).toContain(adj)
      expect(nouns).toContain(noun)
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
