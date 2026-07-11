import { corsDomain } from '../config'
import { UserRecord } from '../types'
import { logError } from '../utils/logging'
import { getChoices } from './dynamodb'
import { sendSms } from './sms'

export const notifyNewRound = async (users: UserRecord[], newRound: number, sessionId: string): Promise<void> => {
  const subscribers = users.filter((u) => u.phone && u.subscribedRounds.includes(newRound))
  for (const subscriber of subscribers) {
    try {
      await sendSms(
        subscriber.phone as string,
        `Round ${newRound + 1} has started! Vote now at ${corsDomain}/s/${sessionId}?id=${subscriber.userId}`,
      )
    } catch (err) {
      logError('Failed to send round notification', { userId: subscriber.userId, err })
    }
  }
}

export const notifyWinner = async (
  users: UserRecord[],
  winnerId: string,
  sessionId: string,
  closedRound: number,
): Promise<void> => {
  const subscribers = users.filter((u) => u.phone && u.subscribedRounds.includes(closedRound))
  if (subscribers.length === 0) return

  let winnerName = winnerId
  try {
    const choices = await getChoices(sessionId)
    winnerName = choices.choices[winnerId]?.name ?? winnerId
  } catch (err) {
    logError('Failed to fetch choices for winner name, falling back to choice ID', { sessionId, winnerId, err })
  }

  for (const subscriber of subscribers) {
    try {
      await sendSms(
        subscriber.phone as string,
        `We have a winner: ${winnerName}! View the result at ${corsDomain}/s/${sessionId}?id=${subscriber.userId}`,
      )
    } catch (err) {
      logError('Failed to send winner notification', { userId: subscriber.userId, err })
    }
  }
}
