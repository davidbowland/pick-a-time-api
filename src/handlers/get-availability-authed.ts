import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { readAvailabilityRecord } from '../services/availability'
import { syncCalendarAccountForPoll } from '../services/calendar-sync'
import { getCalendarAccount, getUser } from '../services/dynamodb'
import { buildBusyGrid } from '../services/overlap'
import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  APIGatewayProxyStructuredResultV2,
  PollRecord,
} from '../types'
import { extractAuthContext } from '../utils/auth'
import { CalendarView, toOwnerAvailabilityResponse } from '../utils/availability'
import { log, logError, redactEvent, sanitizeErrorForLogging } from '../utils/logging'
import status from '../utils/status'

// AC-011. This is the only response in the API that carries a participant's calendar, and the CORS
// configuration sets AllowCredentials: true, so any cache sitting in front of the API would
// otherwise be free to key a grid on the URL alone and hand one signed-in person's booked hours to
// the next caller of the same path. no-store keeps it out of every cache; Vary: Authorization keeps
// any cache that honours the former but not the latter keyed per bearer token.
//
// Applied to every response this handler produces, not only the 200: a cached 403 is wrong for the
// same reason a cached grid is, and the two differ only in which caller gets the wrong answer.
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' }

// An all-false grid with exactly the dimensions this poll's `free` has. Built through buildBusyGrid
// with no intervals rather than filled by hand, because a poll with per-date overrides has ragged
// rows and only buildSlots knows their widths -- a hand-rolled rectangle would silently misalign
// against `free` on precisely the polls where alignment is hardest to eyeball.
const noBusy = (poll: PollRecord): boolean[][] => buildBusyGrid(poll, [])

// The caller's own calendar, and never anybody else's. googleSub arrives from the verified JWT, not
// from the path and not from the participant record: the {userId} path parameter names a poll
// participant, and a lookup keyed on anything reachable from that record is the leak this whole
// route exists to prevent.
const readCallerCalendar = async (googleSub: string, poll: PollRecord, now: () => number): Promise<CalendarView> => {
  const account = await getCalendarAccount(googleSub)
  if (!account) {
    return { busy: noBusy(poll), busyWindow: null, calendarStatus: 'not_connected' }
  }

  // ADR-3: the read refreshes. AC-003 wants the underlay correct on first open with no button
  // pressed, and a cache-only read cannot deliver that for a poll whose dates the cached syncedRange
  // has never covered. The freshness window plus that coverage check -- both inside this call -- are
  // now the only rate limit between a poll open and a Google round trip.
  //
  // Not wrapped in its own catch: syncCalendarAccountForPoll already handles a Google failure by
  // stamping 'error' or 'revoked' and returning the last good cache, so a read survives an outage as
  // a 200. Anything that still escapes it is a defect, not an upstream problem, and belongs in the
  // handler's 500 path where sanitizeErrorForLogging is applied.
  //
  // A record already stamped 'revoked' costs no Google call at all -- the sync service returns it
  // untouched -- so a dead grant is one cheap DynamoDB read per open rather than a failing round trip.
  const synced = await syncCalendarAccountForPoll(account, poll, now)
  if (synced.status !== 'connected') {
    // AC-030. A broken record still carries the intervals from whichever check last succeeded.
    // Drawing them would present a connection that is broken right now as freshly read, and the
    // reader has no way to tell a stale booked hour from a current one. Draw nothing.
    //
    // The status is passed through rather than flattened to 'error', because 'revoked' and 'error'
    // want opposite controls on the client: one is worth another press of "Try again", the other can
    // only be reconnected. Flattening them here is what would put somebody on a retry that is
    // incapable of succeeding.
    return { busy: noBusy(poll), busyWindow: null, calendarStatus: synced.status }
  }

  return {
    busy: buildBusyGrid(poll, synced.busyIntervals),
    // The window that was actually read, straight off the record. Deliberately not derived from
    // poll.dates: a poll outside the retention window comes back untouched and still 'connected',
    // so naming its dates here would claim a coverage that was never fetched.
    busyWindow: synced.syncedRange,
    calendarStatus: 'connected',
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
      throw new ValidationError('Google sign-in is required to read calendar busy time')
    }

    // {userId} is a free path parameter: anyone holding the poll link can name any participant. This
    // response carries calendar data, so the caller has to BE the participant they name -- otherwise
    // it would hand a stranger the victim's booked hours, and even an empty grid would answer
    // "did they connect a calendar?", the one thing stripCalendarCheckedAt exists to hide.
    //
    // A null googleSub is not a match. Someone who joined anonymously and later signed in keeps null
    // until POST /users/authed or PATCH /users/{userId}/authed links their account; treating null as
    // claimable here would let anyone read a calendar against any anonymous participant, which is a
    // wider hole than the one this closes. They link, then they read.
    //
    // Checked before the availability record is read at all, so no branch below has anything of the
    // victim's to echo even by accident.
    const user = await getUser(sessionId, userId)
    if (user.googleSub !== auth.googleSub) {
      throw new ForbiddenError('You can only read your own calendar')
    }

    const { availability, session } = await readAvailabilityRecord(sessionId, userId)
    const calendar = await readCallerCalendar(auth.googleSub, session, now)

    // Counts only. The intervals and the grid are somebody's schedule and have no business in a log;
    // the busy-cell count is what actually separates the two ways a read comes back drawing nothing
    // -- a calendar with nothing in the poll's hours from a calendar that could not be reached --
    // and calendarStatus names which of those it was.
    log('Authenticated availability read complete', {
      busySlotCount: calendar.busy.reduce((total, row) => total + row.filter(Boolean).length, 0),
      calendarStatus: calendar.calendarStatus,
    })

    return { ...status.OK, body: JSON.stringify(toOwnerAvailabilityResponse(availability, calendar)) }
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

export const getAvailabilityAuthed = async (
  event: APIGatewayProxyEventV2,
  now: () => number = Date.now,
): Promise<APIGatewayProxyStructuredResultV2> => {
  log('Received event', redactEvent(event))
  const result = await respond(event, now)
  return { ...result, headers: PRIVATE_HEADERS }
}

// Lambda calls the exported handler as handler(event, context), so the injected clock cannot be the
// second parameter of the thing template.yaml points at -- Context is not callable, and the first
// now() reached would throw "now is not a function" on every real request. The wrapper keeps the
// injection point one level in, where only tests reach it.
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
  getAvailabilityAuthed(event)
