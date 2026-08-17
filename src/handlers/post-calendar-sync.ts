import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { syncCalendarAccountForPoll } from '../services/calendar-sync'
import { getCalendarAccount, getSession, getUser } from '../services/dynamodb'
import { buildBusyGrid } from '../services/overlap'
import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  APIGatewayProxyStructuredResultV2,
  CalendarAccountRecord,
  PollRecord,
} from '../types'
import { extractAuthContext } from '../utils/auth'
import { CalendarView } from '../utils/availability'
import { log, logError, redactEvent, sanitizeErrorForLogging } from '../utils/logging'
import { assertSessionActive } from '../utils/sessions'
import status from '../utils/status'

// AC-011. This route now returns busy data, so it inherits the authenticated read's cache policy
// verbatim: the response carries a participant's calendar, and the CORS configuration sets
// AllowCredentials: true, so any cache in front of the API would otherwise be free to key a grid on
// the URL alone and hand one signed-in person's booked hours to the next caller of the same path.
// no-store keeps it out of every cache; Vary: Authorization keeps any cache that honours the former
// but not the latter keyed per bearer token.
//
// Applied to every response, not only the 200: a cached 403 is wrong for the same reason a cached
// grid is, and the two differ only in which caller gets the wrong answer.
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' }

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

const respond = async (
  event: APIGatewayProxyEventV2,
  now: () => number,
): Promise<APIGatewayProxyStructuredResultV2> => {
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const userId = event.pathParameters?.userId as string

    const auth = extractAuthContext(event)
    if (!auth.isAuthenticated || !auth.googleSub) {
      throw new ValidationError('Google sign-in is required to check a calendar')
    }

    const { session } = await getSession(sessionId)
    assertSessionActive(session, now)

    // {userId} is a free path parameter: anyone holding the poll link can name any participant. This
    // response carries calendar data, so the caller has to BE the participant they name -- otherwise
    // it would hand a stranger the victim's booked hours, and even an empty grid would answer
    // "did they connect a calendar?", the one thing stripCalendarCheckedAt exists to hide.
    //
    // A null googleSub is not a match. Someone who joined anonymously and later signed in keeps null
    // until POST /users/authed or PATCH /users/{userId}/authed links their account; claiming the
    // record here by writing auth.googleSub onto it would let anyone claim any anonymous
    // participant, which is a wider hole than the one this closes. They link, then they check.
    const user = await getUser(sessionId, userId)
    if (user.googleSub !== auth.googleSub) {
      throw new ForbiddenError('You can only check your own calendar')
    }

    // The caller's own calendar, and never anybody else's: googleSub arrives from the verified JWT,
    // not from the path and not from the participant record.
    const account = await getCalendarAccount(auth.googleSub)
    if (!account) {
      throw new ValidationError('No calendar is connected for this account')
    }

    // Stored availability is not read, let alone written. A check is a refresh of the cached
    // intervals and nothing else, which is what makes it idempotent and safe to repeat -- and is why
    // the one-check-per-poll lock and its calendarCheckedAt stamp are gone (AC-001, ADR-2). Force is
    // what a person pressing "Check again" asks for: a real Google round trip rather than a cached
    // one. The freshness window inside the sync service is the only rate limit left.
    const synced = await syncOrNull(account, session, now, parseForce(event.body))
    // A record that came back marked 'error' carries busy data from some earlier successful fetch,
    // not from this check. Serving it and answering 200 would tell the person their calendar was
    // just read when Google never answered, and they have no way to tell a stale booked hour from a
    // current one. Unlike the authenticated READ -- which is entitled to survive an outage, since
    // nobody asked it to reach Google -- a sync IS the request to reach Google, so failing to reach
    // it is a real failure and says so.
    if (!synced || synced.status === 'error') {
      return status.BAD_GATEWAY
    }

    // The same three values the authenticated read serves, assembled as one unit so they can never
    // be taken from different reads. calendarStatus is 'connected' by construction on this path --
    // an errored record left as a 502 above and a missing one as a 400 -- and is carried anyway so
    // the client can feed this response into exactly the cache entry the read populates.
    const calendar: CalendarView = {
      busy: buildBusyGrid(session, synced.busyIntervals),
      calendarStatus: 'connected',
      // The window that was actually read, straight off the record rather than derived from
      // poll.dates: a poll outside the retention window comes back untouched and still 'connected',
      // so naming its dates here would claim a coverage that was never fetched.
      busyWindow: synced.syncedRange,
    }

    // Counts only. Two very different outcomes both come back drawing nothing -- a calendar Google
    // reported as empty, and one whose bookings simply miss the poll's hours -- and only these two
    // numbers separate them. The intervals, the window dates, and the grid are somebody's schedule
    // and have no business in a log (AC-012).
    log('Calendar check complete', {
      busyIntervalCount: synced.busyIntervals.length,
      busySlotCount: calendar.busy.reduce((total, row) => total + row.filter(Boolean).length, 0),
    })

    return { ...status.OK, body: JSON.stringify({ ...calendar, lastSyncedAt: synced.lastSyncedAt }) }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    if (error instanceof ForbiddenError)
      return { ...status.FORBIDDEN, body: JSON.stringify({ message: error.message }) }
    if (error instanceof ValidationError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    // Never the raw error: an axios failure out of refreshAccessToken carries config.data, which for
    // the Google token endpoint holds the client_secret and the refresh token in full.
    logError(sanitizeErrorForLogging(error))
    return status.INTERNAL_SERVER_ERROR
  }
}

export const postCalendarSync = async (
  event: APIGatewayProxyEventV2,
  now: () => number = Date.now,
): Promise<APIGatewayProxyStructuredResultV2> => {
  log('Received event', redactEvent(event))
  const result = await respond(event, now)
  return { ...result, headers: PRIVATE_HEADERS }
}

// Lambda calls the exported handler as handler(event, context), so the injected clock cannot be the
// second parameter of the thing template.yaml points at -- Context is not callable, and the first
// now() (inside syncCalendarAccountForPoll) threw "now is not a function" on every real request.
// The wrapper keeps the injection point one level in, where only tests reach it.
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
  postCalendarSync(event)
