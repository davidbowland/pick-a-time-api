import { adjectives } from '@assets/adjectives'
import { excludedIdWords } from '@assets/excluded-id-words'
import { nouns } from '@assets/nouns'

describe('excluded-id-words', () => {
  const excluded = (words: string[]) => words.filter((word) => excludedIdWords.has(word))

  describe('adjectives', () => {
    it('should contain no excluded words', () => {
      expect(excluded(adjectives)).toEqual([])
    })

    it('should contain enough words to keep IDs varied', () => {
      expect(adjectives.length).toBeGreaterThanOrEqual(400)
    })

    it('should contain only lowercase letters so IDs split cleanly on the hyphen', () => {
      expect(adjectives.filter((word) => !/^[a-z]+$/.test(word))).toEqual([])
    })

    it('should contain no duplicates', () => {
      expect(new Set(adjectives).size).toEqual(adjectives.length)
    })
  })

  describe('nouns', () => {
    it('should contain no excluded words', () => {
      expect(excluded(nouns)).toEqual([])
    })

    it('should contain enough words to keep IDs varied', () => {
      expect(nouns.length).toBeGreaterThanOrEqual(1800)
    })

    it('should contain only lowercase letters so IDs split cleanly on the hyphen', () => {
      expect(nouns.filter((word) => !/^[a-z]+$/.test(word))).toEqual([])
    })

    it('should contain no duplicates', () => {
      expect(new Set(nouns).size).toEqual(nouns.length)
    })
  })

  describe('excludedIdWords', () => {
    it('should contain only lowercase letters, matching the vocabulary lists', () => {
      expect([...excludedIdWords].filter((word) => !/^[a-z]+$/.test(word))).toEqual([])
    })

    it('should cover the pairings that motivated it', () => {
      const offensivePairings = ['black-death', 'white-black', 'black-rape', 'white-cancer', 'crazy-fat']
      const unsafeHalves = offensivePairings.flatMap((pairing) => pairing.split('-'))

      expect(unsafeHalves.filter((word) => !excludedIdWords.has(word))).toEqual([])
    })
  })
})
