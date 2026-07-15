import { NotFoundError } from '../errors'
import { syncCalendarAccountForPoll } from '../services/calendar-sync'
import { getAllAvailability, getAllUsers, getCalendarAccount, getSession } from '../services/dynamodb'
import { buildBusyGrid, computeGrid, findRecommendedMeetings } from '../services/overlap'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { log, logError } from '../utils/logging'
import { assertSessionActive } from '../utils/sessions'
import status from '../utils/status'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const sessionId = event.pathParameters?.sessionId as string

    const { session } = await getSession(sessionId)
    assertSessionActive(session)

    const [availability, users] = await Promise.all([getAllAvailability(sessionId), getAllUsers(sessionId)])

    const busyGridEntries = await Promise.all(
      users
        .filter((user) => user.googleSub)
        .map(async (user) => {
          try {
            const record = await getCalendarAccount(user.googleSub as string)
            if (!record) return null
            const synced = await syncCalendarAccountForPoll(record, session)
            return [user.userId, buildBusyGrid(session, synced.busyIntervals)] as const
          } catch (error) {
            logError(error)
            return null
          }
        }),
    )
    const busyGrids = Object.fromEntries(
      busyGridEntries.filter((entry): entry is readonly [string, ReturnType<typeof buildBusyGrid>] => entry !== null),
    )

    const grid = computeGrid(session, availability, busyGrids)
    const recommendedMeetings = findRecommendedMeetings(session, availability, 3, busyGrids)

    return { ...status.OK, body: JSON.stringify({ grid, recommendedMeetings }) }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
