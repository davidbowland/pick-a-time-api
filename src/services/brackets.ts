import { SessionRecord, UserRecord } from '../types'

const shuffle = <T>(arr: T[], random = Math.random): T[] => {
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export const generateMatchups = (
  choiceIds: string[],
  random = Math.random,
): { matchups: [string, string][]; bye: string | null } => {
  const shuffled = shuffle(choiceIds, random)
  let bye: string | null = null

  if (shuffled.length % 2 !== 0) {
    bye = shuffled.pop() as string
  }

  const matchups: [string, string][] = []
  for (let i = 0; i < shuffled.length; i += 2) {
    matchups.push([shuffled[i], shuffled[i + 1]])
  }

  return { matchups, bye }
}

export const tallyVotes = (
  round: number,
  bracket: [string, string][][],
  users: UserRecord[],
  random = Math.random,
): string[] => {
  const matchups = bracket[round]
  return matchups.map((matchup, matchupIndex) => {
    const counts: Record<string, number> = { [matchup[0]]: 0, [matchup[1]]: 0 }

    for (const user of users) {
      const roundVotes = user.votes[round]
      if (!roundVotes) continue

      const vote = roundVotes[matchupIndex]
      if (vote === null || vote === undefined) continue

      if (vote !== matchup[0] && vote !== matchup[1]) continue

      counts[vote]++
    }

    if (counts[matchup[0]] > counts[matchup[1]]) return matchup[0]
    if (counts[matchup[1]] > counts[matchup[0]]) return matchup[1]

    return random() < 0.5 ? matchup[0] : matchup[1]
  })
}

export const advanceRound = (
  session: SessionRecord,
  users: UserRecord[],
  random = Math.random,
): { updatedFields: Partial<SessionRecord>; winner: string | null } => {
  const round = session.currentRound
  const winners = tallyVotes(round, session.bracket, users, random)

  const advancing = [...winners]
  const currentBye = session.byes[round]
  if (currentBye) {
    advancing.push(currentBye)
  }

  if (advancing.length === 1) {
    return {
      updatedFields: { winner: advancing[0] },
      winner: advancing[0],
    }
  }

  const { matchups, bye } = generateMatchups(advancing, random)
  const newRound = round + 1
  const newBracket = [...session.bracket, matchups]
  const newByes = [...session.byes, bye]

  return {
    updatedFields: {
      bracket: newBracket,
      byes: newByes,
      currentRound: newRound,
    },
    winner: null,
  }
}

export const countVotersSubmitted = (session: SessionRecord, users: UserRecord[]): number => {
  const round = session.currentRound
  const matchupCount = session.bracket[round]?.length ?? 0
  if (matchupCount === 0) return 0

  return users.filter((user) => {
    const roundVotes = user.votes[round]
    if (!roundVotes) return false
    if (roundVotes.length < matchupCount) return false
    return roundVotes.slice(0, matchupCount).every((v) => v !== null && v !== undefined)
  }).length
}

export const shouldAutoAdvance = (votersSubmitted: number, userCount: number): boolean => {
  if (userCount === 0) return false
  return votersSubmitted === userCount
}
