import { advanceRound, countVotersSubmitted, generateMatchups, shouldAutoAdvance, tallyVotes } from '@services/brackets'
import { SessionRecord, UserRecord } from '@types'

const makeUser = (overrides: Partial<UserRecord> = {}): UserRecord => ({
  userId: 'test-user',
  googleSub: null,
  name: null,
  phone: null,
  subscribedRounds: [],
  votes: [],
  textsSent: 0,
  expiration: 9999999999,
  ...overrides,
})

const makeSession = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  sessionId: 'test-session',
  address: '123 Main St',
  location: { latitude: 38.9, longitude: -77.0 },
  currentRound: 0,
  bracket: [],
  byes: [],
  isReady: true,
  errorMessage: null,
  timeoutAt: undefined,
  winner: null,
  expiration: 9999999999,
  type: ['restaurant'],
  exclude: [],
  radius: 5000,
  rankBy: 'POPULARITY',
  totalRounds: 0,
  votersSubmitted: 0,
  ...overrides,
})

describe('brackets', () => {
  describe('generateMatchups', () => {
    it('should pair even number of choices into matchups', () => {
      const { matchups, bye } = generateMatchups(['a', 'b', 'c', 'd'])
      expect(matchups).toHaveLength(2)
      expect(bye).toBeNull()
      const allIds = matchups.flat()
      expect(allIds.sort()).toEqual(['a', 'b', 'c', 'd'])
    })

    it('should handle odd number with one bye', () => {
      const { matchups, bye } = generateMatchups(['a', 'b', 'c'])
      expect(matchups).toHaveLength(1)
      expect(bye).not.toBeNull()
      const allIds = [...matchups.flat(), bye as string]
      expect(allIds.sort()).toEqual(['a', 'b', 'c'])
    })

    it('should handle exactly 2 choices', () => {
      const { matchups, bye } = generateMatchups(['a', 'b'])
      expect(matchups).toHaveLength(1)
      expect(matchups[0]).toHaveLength(2)
      expect(bye).toBeNull()
    })

    it('should cover all choices with many inputs', () => {
      const ids = Array.from({ length: 16 }, (_, i) => `choice-${i}`)
      const { matchups, bye } = generateMatchups(ids)
      expect(matchups).toHaveLength(8)
      expect(bye).toBeNull()
      const allIds = matchups.flat()
      expect(allIds.sort()).toEqual(ids.sort())
    })

    it('should produce matchups with exactly 2 distinct choices each', () => {
      const { matchups } = generateMatchups(['a', 'b', 'c', 'd', 'e', 'f'])
      for (const m of matchups) {
        expect(m).toHaveLength(2)
        expect(m[0]).not.toBe(m[1])
      }
    })

    it('should return empty matchups and no bye for empty input', () => {
      const { matchups, bye } = generateMatchups([])
      expect(matchups).toHaveLength(0)
      expect(bye).toBeNull()
    })

    it('should return no matchups and one bye for single input', () => {
      const { matchups, bye } = generateMatchups(['a'])
      expect(matchups).toHaveLength(0)
      expect(bye).toBe('a')
    })
  })

  describe('tallyVotes', () => {
    const bracket: [string, string][][] = [
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
    ]

    it('should return the choice with more votes', () => {
      const users = [
        makeUser({ userId: 'u1', votes: [['a', 'c']] }),
        makeUser({ userId: 'u2', votes: [['a', 'd']] }),
        makeUser({ userId: 'u3', votes: [['b', 'c']] }),
      ]
      const winners = tallyVotes(0, bracket, users, () => 0.1)
      expect(winners[0]).toBe('a')
      // Second matchup: c=2, d=1 → c wins
      expect(winners[1]).toBe('c')
    })

    it('should break ties randomly', () => {
      const users = [makeUser({ userId: 'u1', votes: [['a', 'c']] }), makeUser({ userId: 'u2', votes: [['b', 'd']] })]
      expect(tallyVotes(0, bracket, users, () => 0.1)[0]).toBe('a')
      expect(tallyVotes(0, bracket, users, () => 0.9)[0]).toBe('b')
    })

    it('should discard invalid votes', () => {
      const users = [
        makeUser({ userId: 'u1', votes: [['a', 'c']] }),
        makeUser({ userId: 'u2', votes: [['INVALID', 'd']] }),
      ]
      const winners = tallyVotes(0, bracket, users, () => 0.9)
      // Matchup 0: a=1 (INVALID discarded), b=0 → a wins
      expect(winners[0]).toBe('a')
      // Matchup 1: c=1, d=1 → tied, random > 0.5 picks 'd'
      expect(winners[1]).toBe('d')
    })

    it('should exclude users who have not voted for the round', () => {
      const users = [makeUser({ userId: 'u1', votes: [['a', 'c']] }), makeUser({ userId: 'u2', votes: [] })]
      const winners = tallyVotes(0, bracket, users)
      expect(winners[0]).toBe('a')
      expect(winners[1]).toBe('c')
    })

    it('should handle null votes gracefully', () => {
      const users = [makeUser({ userId: 'u1', votes: [['a', null]] }), makeUser({ userId: 'u2', votes: [[null, 'c']] })]
      const winners = tallyVotes(0, bracket, users)
      expect(winners[0]).toBe('a')
      expect(winners[1]).toBe('c')
    })
  })

  describe('advanceRound', () => {
    it('should detect a winner when only one choice remains', () => {
      const session = makeSession({
        currentRound: 0,
        bracket: [[['a', 'b']]],
        byes: [null],
      })
      const users = [makeUser({ votes: [['a']] })]
      const result = advanceRound(session, users)
      expect(result.winner).toBe('a')
      expect(result.updatedFields.winner).toBe('a')
    })

    it('should generate a new round when multiple choices remain', () => {
      const session = makeSession({
        currentRound: 0,
        bracket: [
          [
            ['a', 'b'],
            ['c', 'd'],
          ],
        ],
        byes: [null],
      })
      const users = [makeUser({ votes: [['a', 'c']] })]
      const result = advanceRound(session, users)
      expect(result.winner).toBeNull()
      expect(result.updatedFields.currentRound).toBe(1)
      expect(result.updatedFields.bracket).toHaveLength(2)
      expect(result.updatedFields.bracket![1]).toHaveLength(1)
    })

    it('should include bye in advancing choices', () => {
      const session = makeSession({
        currentRound: 0,
        bracket: [[['a', 'b']]],
        byes: ['c'],
      })
      const users = [makeUser({ votes: [['a']] })]
      const result = advanceRound(session, users)
      // a wins matchup, c has bye → 2 advancing → new round
      expect(result.winner).toBeNull()
      expect(result.updatedFields.currentRound).toBe(1)
      const round1Matchup = result.updatedFields.bracket![1][0]
      expect(round1Matchup.sort()).toEqual(['a', 'c'])
    })

    it('should handle tied votes via random tie-break', () => {
      const session = makeSession({
        currentRound: 0,
        bracket: [
          [
            ['a', 'b'],
            ['c', 'd'],
          ],
        ],
        byes: [null],
      })
      const users = [makeUser({ userId: 'u1', votes: [['a', 'c']] }), makeUser({ userId: 'u2', votes: [['b', 'd']] })]
      // Tie-break in tallyVotes picks first choice (< 0.5), then shuffle in generateMatchups
      const result = advanceRound(session, users, () => 0.1)
      expect(result.winner).toBeNull()
      expect(result.updatedFields.currentRound).toBe(1)
      // Both matchups tied → tie-break picks 'a' and 'c' (random < 0.5)
      const round1Choices = result.updatedFields.bracket![1][0].sort()
      expect(round1Choices).toEqual(['a', 'c'])
    })
  })

  describe('shouldAutoAdvance', () => {
    it('should return true when votersSubmitted equals user count', () => {
      expect(shouldAutoAdvance(2, 2)).toBe(true)
    })

    it('should return false when votersSubmitted is less than user count', () => {
      expect(shouldAutoAdvance(1, 2)).toBe(false)
    })

    it('should return false with no users', () => {
      expect(shouldAutoAdvance(0, 0)).toBe(false)
    })
  })

  describe('countVotersSubmitted', () => {
    const bracket: [string, string][][] = [
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
    ]

    it('should count users who completed all matchup votes', () => {
      const session = makeSession({ currentRound: 0, bracket })
      const users = [
        makeUser({ userId: 'u1', votes: [['a', 'c']] }),
        makeUser({ userId: 'u2', votes: [['b', null]] }),
        makeUser({ userId: 'u3', votes: [['a', 'd']] }),
      ]
      expect(countVotersSubmitted(session, users)).toBe(2)
    })

    it('should return 0 when no users have voted', () => {
      const session = makeSession({ currentRound: 0, bracket })
      const users = [makeUser({ userId: 'u1', votes: [] }), makeUser({ userId: 'u2', votes: [] })]
      expect(countVotersSubmitted(session, users)).toBe(0)
    })

    it('should return 0 when bracket has no matchups for current round', () => {
      const session = makeSession({ currentRound: 1, bracket })
      const users = [makeUser({ userId: 'u1', votes: [['a', 'c']] })]
      expect(countVotersSubmitted(session, users)).toBe(0)
    })

    it('should return user count when all users have voted', () => {
      const session = makeSession({ currentRound: 0, bracket })
      const users = [makeUser({ userId: 'u1', votes: [['a', 'c']] }), makeUser({ userId: 'u2', votes: [['b', 'd']] })]
      expect(countVotersSubmitted(session, users)).toBe(2)
    })
  })
})
