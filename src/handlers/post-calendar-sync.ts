import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { syncCalendarAccountForPoll } from '../services/calendar-sync'
import { getAvailability, getCalendarAccount, getSession, getUser, updateAvailability } from '../services/dynamodb'
import { markBusyHours } from '../services/overlap'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, CalendarAccountRecord, PollRecord } from '../types'
import { extractAuthContext } from '../utils/auth'
import { log, logError, redactEvent, sanitizeErrorForLogging } from '../utils/logging'
import { assertSessionActive } from '../utils/sessions'
import status from '../utils/status'

const parseForce = (body: string | undefined): boolean => {
  try {
    return JSON.parse(body ?? '{}')?.force === true
  } catch {
    return false
  }
}

// Google is the one collaborator this handler cannot vouch for, so its failure gets its own return
// path: a 502 says "the upstream calendar is down, try again", which a DynamoDB or code failure
// (500) does not. Returning null rather than rethrowing keeps that distinction out of the shared
// catch block, where every error looks alike.
//
// In practice syncCalendarAccountForPoll swallows its own failures -- it stamps status 'error' and
// returns the record with whatever busyIntervals it last cached -- so the caller checks that status
// too. This catch stays as a guard against a failure the sync service does not handle itself.
const syncOrNull = async (
  account: CalendarAccountRecord,
  session: PollRecord,
  now: () => number,
  force: boolean,
): Promise<CalendarAccountRecord | null> => {
  try {
    return await syncCalendarAccountForPoll(account, session, now, force)
  } catch (error) {
    logError('Calendar sync failed', sanitizeErrorForLogging(error))
    return null
  }
}

export const handler = async (
  event: APIGatewayProxyEventV2,
  now: () => number = Date.now,
): Promise<APIGatewayProxyResultV2> => {
  log('Received event', redactEvent(event))
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const userId = event.pathParameters?.userId as string

    const auth = extractAuthContext(event)
    if (!auth.isAuthenticated || !auth.googleSub) {
      throw new ValidationError('Google sign-in is required to check a calendar')
    }

    const { session } = await getSession(sessionId)
    assertSessionActive(session)

    // {userId} is a free path parameter: anyone holding the poll link can name any participant.
    // Everything below reads and writes that participant's own availability, so the caller has to
    // BE them. Without this the response would hand a stranger the victim's calendarCheckedAt --
    // proof of whether they connected a calendar, the one thing stripCalendarCheckedAt exists to
    // hide -- and would mark the victim busy at the ATTACKER's meeting times.
    //
    // A null googleSub is not a match. Someone who joined anonymously and later signed in keeps
    // null until POST /users/authed or PATCH /users/{userId}/authed links their account; claiming
    // the record here by writing auth.googleSub onto it would let anyone claim any anonymous
    // participant, which is a wider hole than the one this closes. They link, then they check.
    const user = await getUser(sessionId, userId)
    if (user.googleSub !== auth.googleSub) {
      throw new ForbiddenError('You can only check your own calendar')
    }

    const account = await getCalendarAccount(auth.googleSub)
    if (!account) {
      throw new ValidationError('No calendar is connected for this account')
    }

    const availability = await getAvailability(sessionId, userId)
    const force = parseForce(event.body)

    // The server owns the "when does a check fire" rule. Nothing records which hours came from a
    // calendar, so an unforced re-check would silently undo a deliberate "I'm free then" edit with
    // no way to explain it. One check per poll, plus whatever the person asks for explicitly.
    if (!force && availability.calendarCheckedAt !== null) {
      return {
        ...status.OK,
        body: JSON.stringify({
          applied: false,
          availability,
          lastSyncedAt: account.lastSyncedAt,
          markedBusyCount: 0,
        }),
      }
    }

    const synced = await syncOrNull(account, session, now, force)
    // A record that came back marked 'error' carries the busy data from some earlier successful
    // fetch, not from this check. Marking hours from that cache and answering 200 would tell the
    // person their calendar was just read when Google never answered -- and would burn their one
    // unforced check on data that is only as fresh as the outage is old. Say the upstream failed.
    if (!synced || synced.status === 'error') {
      return status.BAD_GATEWAY
    }

    const { availability: updated, markedBusyCount } = markBusyHours(session, availability, synced.busyIntervals)
    const stamped = { ...updated, calendarCheckedAt: Math.floor(now() / 1000) }
    await updateAvailability(sessionId, userId, stamped)

    return {
      ...status.OK,
      body: JSON.stringify({
        applied: true,
        availability: stamped,
        lastSyncedAt: synced.lastSyncedAt,
        markedBusyCount,
      }),
    }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    if (error instanceof ForbiddenError)
      return { ...status.FORBIDDEN, body: JSON.stringify({ message: error.message }) }
    if (error instanceof ValidationError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    logError(sanitizeErrorForLogging(error))
    return status.INTERNAL_SERVER_ERROR
  }
}
