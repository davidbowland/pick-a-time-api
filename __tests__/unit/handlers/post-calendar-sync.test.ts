import { calendarAccountRecord, googleSub, ownedUserRecord, session, userRecord } from '../__mocks__'
import { NotFoundError } from '@errors'
import eventJson from '@events/post-calendar-sync.json'
import { handler, postCalendarSync } from '@handlers/post-calendar-sync'
import * as calendarSync from '@services/calendar-sync'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'
import { log, logError } from '@utils/logging'

jest.mock('@services/calendar-sync')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging', () => ({
  ...jest.requireActual('@utils/logging'),
  log: jest.fn(),
  logError: jest.fn(),
}))

describe('post-calendar-sync', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const nowMs = 1_728_547_851_000
  const now = (): number => nowMs
  const futureSession = { ...session, expiration: Math.floor(nowMs / 1000) + 1 }

  // The one interval in calendarAccountRecord is 16:00-17:00 America/Chicago on 2025-09-04. The
  // poll's 60-minute slots step every 30 minutes, so it overlaps slot0 [16:00-17:00) and slot1
  // [16:30-17:30), but not slot2 [17:00-18:00).
  const callerBusy = [
    [true, true, false],
    [false, false, false],
    [false, false, false],
  ]

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [] })
    // The shared userRecord fixture carries googleSub: null, which must not match the signed-in
    // caller in the event fixture -- a null sub means the participant never linked a Google account.
    // Every happy path here is the owner calling on their own record; mismatches are opted into
    // per-test with mockResolvedValueOnce, which is what keeps them visible.
    jest.mocked(dynamodb).getUser.mockResolvedValue(ownedUserRecord)
    jest.mocked(dynamodb).getCalendarAccount.mockResolvedValue(calendarAccountRecord)
    jest.mocked(calendarSync).syncCalendarAccountForPoll.mockResolvedValue(calendarAccountRecord)
  })

  describe('postCalendarSync', () => {
    it('should return the freshly refreshed busy grid', async () => {
      const result = await postCalendarSync(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
      expect(JSON.parse(result.body as string)).toEqual({
        busy: callerBusy,
        busyWindow: calendarAccountRecord.syncedRange,
        calendarStatus: 'connected',
        lastSyncedAt: calendarAccountRecord.lastSyncedAt,
      })
    })

    // AC-001. The whole point of the change: a check is a read of Google, not a write of anybody's
    // grid. The handler no longer reads stored availability either, so there is no branch left that
    // could echo it, stamp it, or hand it back subtly altered.
    it('should leave stored availability untouched', async () => {
      await postCalendarSync(event, now)

      expect(dynamodb.updateAvailability).not.toHaveBeenCalled()
      expect(dynamodb.getAvailability).not.toHaveBeenCalled()
    })

    // markedBusyCount and applied both describe a write that no longer happens. `applied` in
    // particular would now be a lie in either direction -- there is nothing to apply.
    it.each(['applied', 'markedBusyCount', 'availability', 'calendarCheckedAt'])(
      'should not report %s',
      async (field) => {
        const result = await postCalendarSync(event, now)

        expect(result.body as string).not.toContain(field)
      },
    )

    // AC-011. This response carries a participant's calendar, and CORS here sets
    // AllowCredentials: true, so a cache keying on the URL alone would hand one signed-in person's
    // booked hours to the next caller of the same path.
    it('should carry Cache-Control: private, no-store and Vary: Authorization', async () => {
      const result = await postCalendarSync(event, now)

      expect(result.headers).toEqual(
        expect.objectContaining({ 'Cache-Control': 'private, no-store', Vary: 'Authorization' }),
      )
    })

    it('should carry the private headers on a refusal too', async () => {
      // A cached 403 is wrong for the same reason a cached grid is; only which caller gets the
      // wrong answer differs.
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce({ ...userRecord, googleSub: 'google-sub-victim' })

      const result = await postCalendarSync(event, now)

      expect(result.headers).toEqual(
        expect.objectContaining({ 'Cache-Control': 'private, no-store', Vary: 'Authorization' }),
      )
    })

    // The one-check-per-poll lock existed only because the write was irreversible: nothing recorded
    // which hours came from a calendar, so a second check would silently undo a deliberate "I'm free
    // then" edit. With no write left, a check is idempotent and repeating one costs nothing but a
    // Google call the freshness window already rate limits.
    it('should refresh again on a repeat check rather than short-circuiting', async () => {
      await postCalendarSync(event, now)
      await postCalendarSync(event, now)

      expect(calendarSync.syncCalendarAccountForPoll).toHaveBeenCalledTimes(2)
    })

    // The hasFreeCell guard existed only to avoid spending the one-per-poll check on a grid the
    // marking pass could not have changed. Nothing is marked now, so what the participant has
    // painted cannot veto their own check -- and the strongest form of that is a handler which
    // never reads the grid at all, leaving no state for such a guard to consult.
    it('should refresh whatever the participant has painted', async () => {
      const result = await postCalendarSync(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
      expect(JSON.parse(result.body as string).busy).toEqual(callerBusy)
      expect(calendarSync.syncCalendarAccountForPoll).toHaveBeenCalled()
      expect(dynamodb.getAvailability).not.toHaveBeenCalled()
    })

    it('should ask for a cached sync when the caller did not force one', async () => {
      await postCalendarSync(event, now)

      expect(calendarSync.syncCalendarAccountForPoll).toHaveBeenCalledWith(
        calendarAccountRecord,
        futureSession,
        now,
        false,
      )
    })

    it('should bypass the freshness window when force is true', async () => {
      // "Check again" is a request for a real check, not a cached one. The freshness window plus the
      // syncedRange coverage check are the only rate limit left, and this is the way past them.
      const forced = { ...event, body: JSON.stringify({ force: true }) }

      const result = await postCalendarSync(forced as APIGatewayProxyEventV2, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
      expect(calendarSync.syncCalendarAccountForPoll).toHaveBeenCalledWith(
        calendarAccountRecord,
        futureSession,
        now,
        true,
      )
    })

    const unforcedBodies: [string, string | undefined][] = [
      ['an unparseable body', 'not json at all'],
      ['a missing body', undefined],
      ['a non-boolean force value', JSON.stringify({ force: 'yes' })],
    ]

    it.each(unforcedBodies)('should treat %s as an unforced check', async (_label, body) => {
      const result = await postCalendarSync({ ...event, body } as unknown as APIGatewayProxyEventV2, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
      expect(calendarSync.syncCalendarAccountForPoll).toHaveBeenCalledWith(
        calendarAccountRecord,
        futureSession,
        now,
        false,
      )
    })

    // AC-012. Two very different failures both surface as "the grid came back empty": a calendar
    // Google reported as empty, and a calendar whose bookings simply miss the poll's hours. Only the
    // counts separate them -- and counts are all that may be emitted. The intervals, the window
    // dates, and the grid are somebody's schedule.
    it('should log counts only, never an interval, a date, or a grid', async () => {
      await postCalendarSync(event, now)

      expect(log).toHaveBeenCalledWith('Calendar check complete', {
        busyIntervalCount: calendarAccountRecord.busyIntervals.length,
        busySlotCount: 2,
      })
      const emitted = JSON.stringify([...jest.mocked(log).mock.calls, ...jest.mocked(logError).mock.calls])
      expect(emitted).not.toContain('2025-09-04T21:00:00.000Z')
      expect(emitted).not.toContain('2025-09-04')
      expect(emitted).not.toContain('busyIntervals')
      expect(emitted).not.toContain('busyWindow')
      expect(emitted).not.toContain('true,true,false')
    })

    it('should return 400 when there is no connected calendar', async () => {
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(null)

      const result = await postCalendarSync(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
      expect(calendarSync.syncCalendarAccountForPoll).not.toHaveBeenCalled()
    })

    it('should return 400 without a Google identity', async () => {
      const anonymous = { ...event, requestContext: { ...event.requestContext, authorizer: undefined } }

      const result = await postCalendarSync(anonymous as unknown as APIGatewayProxyEventV2, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
      expect(dynamodb.getCalendarAccount).not.toHaveBeenCalled()
    })

    it('should return 403 when the caller is not the participant named in the path', async () => {
      // The attack: any Google-signed-in person holding the poll link posts to another participant's
      // {userId}. Without the ownership check the response would hand a stranger the victim's grid
      // -- and even an empty one answers "did they connect a calendar?", the disclosure
      // stripCalendarCheckedAt exists to prevent.
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce({ ...userRecord, googleSub: 'google-sub-victim' })

      const result = await postCalendarSync(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 403 }))
      expect(result.body as string).not.toContain('busy')
      // The victim's calendar is never even looked up, so no branch below has anything of theirs.
      expect(dynamodb.getCalendarAccount).not.toHaveBeenCalled()
      expect(calendarSync.syncCalendarAccountForPoll).not.toHaveBeenCalled()
    })

    it('should return 403 when the participant has never linked a Google account', async () => {
      // Someone who joined anonymously keeps googleSub: null until POST /users/authed or
      // PATCH /users/{userId}/authed links it. Null is not a match: claiming the record by writing
      // the caller's sub onto it would let anyone claim any anonymous participant.
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce({ ...userRecord, googleSub: null })

      const result = await postCalendarSync(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 403 }))
      expect(result.body as string).not.toContain('busy')
      expect(dynamodb.getCalendarAccount).not.toHaveBeenCalled()
    })

    it('should look the caller calendar up by their own sub and not by the path participant', async () => {
      await postCalendarSync(event, now)

      expect(dynamodb.getCalendarAccount).toHaveBeenCalledWith(googleSub)
      expect(dynamodb.getCalendarAccount).toHaveBeenCalledTimes(1)
    })

    it('should return 404 when the poll does not exist', async () => {
      jest.mocked(dynamodb).getSession.mockRejectedValueOnce(new NotFoundError('Session not found'))

      const result = await postCalendarSync(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
    })

    it('should return 404 when the poll has expired at the injected instant', async () => {
      const justExpired = { ...session, expiration: Math.floor(nowMs / 1000) - 1 }
      jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: justExpired, users: [] })

      const result = await postCalendarSync(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
      expect(calendarSync.syncCalendarAccountForPoll).not.toHaveBeenCalled()
    })

    // Unlike the authenticated read, which serves the last good grid through a Google outage, a sync
    // is an explicit request to reach Google. Failing to reach it is a real failure, and 502 says
    // "the upstream calendar is down, try again" where 500 would blame this service.
    it('should return 502 when the record comes back errored', async () => {
      // syncCalendarAccountForPoll does not throw when Google fails: it catches, stamps 'error', and
      // hands back the record with its stale cached busyIntervals. Drawing those would tell the
      // person their calendar was just read when Google never answered.
      jest
        .mocked(calendarSync)
        .syncCalendarAccountForPoll.mockResolvedValueOnce({ ...calendarAccountRecord, status: 'error' })

      const result = await postCalendarSync(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 502 }))
      expect(result.body as string).not.toContain('busy')
    })

    it('should return 502 when the sync throws', async () => {
      jest.mocked(calendarSync).syncCalendarAccountForPoll.mockRejectedValueOnce(new Error('Google unavailable'))

      const result = await postCalendarSync(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 502 }))
    })

    it('should return 500 and log a sanitized error when a record read fails', async () => {
      jest.mocked(dynamodb).getUser.mockRejectedValueOnce(new Error('DynamoDB unavailable'))

      const result = await postCalendarSync(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 500 }))
      // sanitizeErrorForLogging reduces an axios failure to message and status. Raw, a failure out
      // of refreshAccessToken carries config.data with the client_secret and the refresh token.
      expect(logError).toHaveBeenCalledWith('DynamoDB unavailable')
    })
  })

  describe('handler', () => {
    // Lambda invokes an exported handler as handler(event, context). Anything the handler accepts in
    // that second slot receives the Context object in production, whatever its declared type says --
    // so the clock cannot live there. This suite is the only place the real calling convention is
    // exercised; every test above injects the clock through the inner function.
    const lambdaContext = { awsRequestId: 'CBfV4hGMIAMEPZw=', functionName: 'post-calendar-sync' }

    it('should ignore the second argument Lambda passes it', async () => {
      // The poll fixture used above expires one second after the injected instant, which is in the
      // past for the real clock this path uses. Only here does that matter, so only here is it
      // overridden -- with a year far enough out that the test can never expire.
      jest
        .mocked(dynamodb)
        .getSession.mockResolvedValueOnce({ session: { ...session, expiration: 9_999_999_999 }, users: [] })

      const result = await (
        handler as (event: APIGatewayProxyEventV2, context: unknown) => Promise<{ statusCode: number }>
      )(event, lambdaContext)

      expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
    })
  })
})
