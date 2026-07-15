import { NotFoundError } from '../errors'
import { getAllUsers, getCalendarAccount, getSession } from '../services/dynamodb'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { log, logError } from '../utils/logging'
import status from '../utils/status'
import { stripGoogleSub } from '../utils/users'

type CalendarStatus = 'not_connected' | 'connected' | 'error'

const resolveCalendarStatus = async (googleSub: string | null): Promise<CalendarStatus> => {
  if (!googleSub) return 'not_connected'
  try {
    const record = await getCalendarAccount(googleSub)
    return record?.status ?? 'not_connected'
  } catch (error) {
    // A transient failure looking up ONE user's calendar record must not 500 the whole
    // /users response for every user in the session. Default to 'not_connected' rather than
    // 'error': we don't actually know this user's connection is broken, we just failed to
    // check it, and 'not_connected' doesn't assert anything false either way.
    logError(error)
    return 'not_connected'
  }
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const sessionRecord = await getSession(sessionId)

    if (sessionRecord.session.expiration < Math.floor(Date.now() / 1000)) {
      return status.NOT_FOUND
    }

    const users = await getAllUsers(sessionId)
    const usersWithCalendarStatus = await Promise.all(
      users.map(async (user) => ({
        ...stripGoogleSub(user),
        calendarStatus: await resolveCalendarStatus(user.googleSub),
      })),
    )

    return { ...status.OK, body: JSON.stringify(usersWithCalendarStatus) }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
