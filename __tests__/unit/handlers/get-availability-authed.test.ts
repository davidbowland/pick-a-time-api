import {
  availabilityRecord,
  calendarAccountRecord,
  googleSub,
  ownedUserRecord,
  session,
  sessionId,
  userId,
  userRecord,
} from '../__mocks__'
import { InvalidGrantError, NotFoundError } from '@errors'
import { getAvailabilityAuthed, handler } from '@handlers/get-availability-authed'
import * as availabilityService from '@services/availability'
import * as dynamodb from '@services/dynamodb'
import * as googleCalendar from '@services/google-calendar'
import * as kms from '@services/kms'
import { APIGatewayProxyEventV2, CalendarAccountRecord } from '@types'
import { log, logError } from '@utils/logging'

jest.mock('@services/availability')
jest.mock('@services/dynamodb')
jest.mock('@services/google-calendar')
jest.mock('@services/kms')
jest.mock('@utils/logging', () => ({
  ...jest.requireActual('@utils/logging'),
  log: jest.fn(),
  logError: jest.fn(),
}))

// @services/calendar-sync is deliberately NOT mocked. ADR-3 makes the freshness window the only
// rate limit standing between a poll open and a Google call, so the tests that matter here are the
// ones that watch fetchFreeBusy itself. Mocking the sync service would make "a second read makes no
// Google call" a test of a mock's call count rather than of the rule it is asserting.
describe('get-availability-authed', () => {
  // No events/ fixture: Section 6 owns no file in that directory. The shape is the one API Gateway
  // sends for GET /sessions/{sessionId}/users/{userId}/availability/authed behind CognitoAuthorizer.
  const event = {
    pathParameters: { sessionId, userId },
    requestContext: {
      authorizer: { jwt: { claims: { name: 'Google User', sub: googleSub } } },
      http: { method: 'GET', path: `/v1/sessions/${sessionId}/users/${userId}/availability/authed` },
    },
  } as unknown as APIGatewayProxyEventV2

  // 2024-10-10T07:30:51Z. Every clock in this suite is injected, so nothing here depends on the day
  // the suite runs. The retention window at this instant is roughly 2024-09-26 .. 2025-10-10, which
  // contains the `session` fixture's 2025-09 dates and excludes the distant poll used below.
  const nowMs = 1_728_547_851_000
  const now = (): number => nowMs

  // The one interval in calendarAccountRecord is 16:00-17:00 America/Chicago on 2025-09-04. The
  // poll's 60-minute slots step every 30 minutes, so it overlaps slot0 [16:00-17:00) and slot1
  // [16:30-17:30), but not slot2 [17:00-18:00).
  const callerBusy = [
    [true, true, false],
    [false, false, false],
    [false, false, false],
  ]
  const nothingBusy = [
    [false, false, false],
    [false, false, false],
    [false, false, false],
  ]

  // Older than CALENDAR_SYNC_FRESHNESS_MS (30 minutes) before nowMs, so the sync service actually
  // reaches Google rather than short-circuiting on the cache.
  const staleAccount: CalendarAccountRecord = { ...calendarAccountRecord, lastSyncedAt: 1_728_000_000 }

  beforeAll(() => {
    jest.mocked(availabilityService).readAvailabilityRecord.mockResolvedValue({
      availability: availabilityRecord,
      session,
    })
    jest.mocked(dynamodb).getUser.mockResolvedValue(ownedUserRecord)
    jest.mocked(dynamodb).getCalendarAccount.mockResolvedValue(calendarAccountRecord)
    jest.mocked(dynamodb).putCalendarAccount.mockResolvedValue(undefined)
    jest.mocked(kms).decryptRefreshToken.mockResolvedValue('refresh-token')
    jest.mocked(googleCalendar).refreshAccessToken.mockResolvedValue('access-token')
    jest.mocked(googleCalendar).fetchFreeBusy.mockResolvedValue([])
  })

  describe('getAvailabilityAuthed', () => {
    it('should return the participant record alongside their own busy grid', async () => {
      const result = await getAvailabilityAuthed(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
      const body = JSON.parse(result.body as string)
      expect(body).toEqual({
        busy: callerBusy,
        busyWindow: calendarAccountRecord.syncedRange,
        calendarStatus: 'connected',
        expiration: availabilityRecord.expiration,
        free: availabilityRecord.free,
        userId: availabilityRecord.userId,
      })
    })

    // calendarCheckedAt is the field stripCalendarCheckedAt exists to keep off the open route. The
    // owner may know their own check ran, but the response contract is the six keys above and
    // nothing else, so the client cannot start depending on a field that goes write-dead in §7.
    it('should not echo calendarCheckedAt', async () => {
      const result = await getAvailabilityAuthed(event, now)

      expect(result.body as string).not.toContain('calendarCheckedAt')
    })

    it('should carry Cache-Control: private, no-store and Vary: Authorization', async () => {
      const result = await getAvailabilityAuthed(event, now)

      expect(result.headers).toEqual(
        expect.objectContaining({ 'Cache-Control': 'private, no-store', Vary: 'Authorization' }),
      )
    })

    it('should carry the private headers on a refusal too', async () => {
      // CORS here sets AllowCredentials: true. A cache that keyed a 403 on URL alone would hand one
      // signed-in caller's refusal -- or, on a different response, their grid -- to the next.
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce({ ...userRecord, googleSub: 'google-sub-victim' })

      const result = await getAvailabilityAuthed(event, now)

      expect(result.headers).toEqual(
        expect.objectContaining({ 'Cache-Control': 'private, no-store', Vary: 'Authorization' }),
      )
    })

    it('should return 403 on a googleSub mismatch', async () => {
      // {userId} is a free path parameter: anyone holding the poll link can name any participant.
      // Without this check the response would hand a stranger the victim's calendar.
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce({ ...userRecord, googleSub: 'google-sub-victim' })

      const result = await getAvailabilityAuthed(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 403 }))
      expect(result.body as string).not.toContain('busy')
      // The victim's record is never even read, so no branch below has anything of theirs to echo.
      expect(availabilityService.readAvailabilityRecord).not.toHaveBeenCalled()
      expect(dynamodb.getCalendarAccount).not.toHaveBeenCalled()
      expect(googleCalendar.fetchFreeBusy).not.toHaveBeenCalled()
    })

    it('should return 403 on a null googleSub', async () => {
      // Someone who joined anonymously keeps googleSub: null until POST /users/authed or
      // PATCH /users/{userId}/authed links their account. Null is not a match: treating it as one
      // would let any signed-in link-holder read a calendar against any anonymous participant.
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce({ ...userRecord, googleSub: null })

      const result = await getAvailabilityAuthed(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 403 }))
      expect(result.body as string).not.toContain('busy')
      expect(availabilityService.readAvailabilityRecord).not.toHaveBeenCalled()
      expect(dynamodb.getCalendarAccount).not.toHaveBeenCalled()
    })

    it('should compute busy from the caller account and not the path participant', async () => {
      // The leak this whole route is built around: {userId} is 'fuzzy-penguin', the caller's sub is
      // 'google-sub-123'. A lookup keyed on the path parameter -- or on anything else carried by the
      // participant record -- would serve the decoy grid below to a caller who never owned it.
      const decoyAccount: CalendarAccountRecord = {
        ...calendarAccountRecord,
        busyIntervals: [{ end: '2025-09-07T05:00:00.000Z', start: '2025-09-04T05:00:00.000Z' }],
        googleSub: userId,
      }
      const accountsBySub: Record<string, CalendarAccountRecord> = {
        [googleSub]: calendarAccountRecord,
        [userId]: decoyAccount,
      }
      jest
        .mocked(dynamodb)
        .getCalendarAccount.mockImplementation((sub: string) => Promise.resolve(accountsBySub[sub] ?? null))

      const result = await getAvailabilityAuthed(event, now)

      expect(dynamodb.getCalendarAccount).toHaveBeenCalledWith(googleSub)
      expect(dynamodb.getCalendarAccount).not.toHaveBeenCalledWith(userId)
      expect(JSON.parse(result.body as string).busy).toEqual(callerBusy)
    })

    it('should yield only the claimer own grid for a claimed participant', async () => {
      // AC-008. patch-user lets a signed-in link-holder claim a previously unlinked participant, so
      // the record's prior state is not evidence of anything. Only the caller's own sub decides.
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce({ ...userRecord, googleSub, name: 'Google User' })

      const result = await getAvailabilityAuthed(event, now)

      expect(dynamodb.getCalendarAccount).toHaveBeenCalledTimes(1)
      expect(dynamodb.getCalendarAccount).toHaveBeenCalledWith(googleSub)
      expect(JSON.parse(result.body as string).busy).toEqual(callerBusy)
    })

    it('should make no Google call on a second read inside the freshness window', async () => {
      // ADR-3: the one-check-per-poll lock is gone, so this window plus the syncedRange coverage
      // check is the ONLY thing between a poll open and a Google round trip.
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(staleAccount)
      jest.mocked(googleCalendar).fetchFreeBusy.mockResolvedValueOnce(calendarAccountRecord.busyIntervals)

      await getAvailabilityAuthed(event, now)

      expect(googleCalendar.fetchFreeBusy).toHaveBeenCalledTimes(1)

      const cached = jest.mocked(dynamodb).putCalendarAccount.mock.calls[0][0]
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(cached)

      const second = await getAvailabilityAuthed(event, now)

      expect(googleCalendar.fetchFreeBusy).toHaveBeenCalledTimes(1)
      expect(JSON.parse(second.body as string).busy).toEqual(callerBusy)
    })

    it('should distinguish an errored calendar from one with nothing booked', async () => {
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(staleAccount)
      jest.mocked(googleCalendar).fetchFreeBusy.mockResolvedValueOnce([])
      const emptyRead = JSON.parse((await getAvailabilityAuthed(event, now)).body as string)

      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(staleAccount)
      jest.mocked(googleCalendar).refreshAccessToken.mockRejectedValueOnce(new Error('Google unavailable'))
      const failedRead = JSON.parse((await getAvailabilityAuthed(event, now)).body as string)

      // Both grids are empty. Without calendarStatus the two are the same response, and AC-030,
      // AC-034 and AC-042 all turn on telling them apart.
      expect(emptyRead.busy).toEqual(nothingBusy)
      expect(failedRead.busy).toEqual(nothingBusy)
      expect(emptyRead.calendarStatus).toBe('connected')
      expect(failedRead.calendarStatus).toBe('error')
      expect(emptyRead.busyWindow).toEqual({ end: '2025-09-06', start: '2025-09-04' })
      expect(failedRead.busyWindow).toBeNull()
    })

    it('should draw nothing from the cache when the connection is errored', async () => {
      // AC-030. The errored record still carries the intervals from its last good fetch. Drawing
      // them would present a connection that is broken right now as if it had just been read.
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce({ ...calendarAccountRecord, status: 'error' })
      jest.mocked(googleCalendar).refreshAccessToken.mockRejectedValueOnce(new Error('Google unavailable'))

      const result = await getAvailabilityAuthed(event, now)

      const body = JSON.parse(result.body as string)
      expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
      expect(body.calendarStatus).toBe('error')
      expect(body.busy).toEqual(nothingBusy)
      expect(body.free).toEqual(availabilityRecord.free)
    })

    // The read is where the alert storm actually happened: since ADR-3 every poll open by a signed-in
    // person runs the refresh path, so a dead grant produced a Google round trip and an ERROR line per
    // open. These assert the two halves of the fix -- the status survives to the client instead of
    // being flattened into 'error', and a record already known to be revoked costs no round trip.
    it('should report revoked rather than error when Google rejects the refresh token', async () => {
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(staleAccount)
      jest
        .mocked(googleCalendar)
        .refreshAccessToken.mockRejectedValueOnce(new InvalidGrantError('Google refresh token is no longer valid'))

      const result = await getAvailabilityAuthed(event, now)

      const body = JSON.parse(result.body as string)
      expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
      expect(body.calendarStatus).toBe('revoked')
      expect(body.busy).toEqual(nothingBusy)
      expect(body.busyWindow).toBeNull()
      // The participant's own painted availability is untouched by any of this.
      expect(body.free).toEqual(availabilityRecord.free)
    })

    it('should make no Google call at all for an already-revoked record', async () => {
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce({ ...staleAccount, status: 'revoked' as const })

      const result = await getAvailabilityAuthed(event, now)

      expect(googleCalendar.refreshAccessToken).not.toHaveBeenCalled()
      expect(googleCalendar.fetchFreeBusy).not.toHaveBeenCalled()
      expect(JSON.parse(result.body as string).calendarStatus).toBe('revoked')
    })

    it('should not log an error for a revoked grant, however many times the poll is opened', async () => {
      const revoked = { ...staleAccount, status: 'revoked' as const }
      jest
        .mocked(dynamodb)
        .getCalendarAccount.mockResolvedValueOnce(revoked)
        .mockResolvedValueOnce(revoked)
        .mockResolvedValueOnce(revoked)

      await getAvailabilityAuthed(event, now)
      await getAvailabilityAuthed(event, now)
      await getAvailabilityAuthed(event, now)

      expect(logError).not.toHaveBeenCalled()
    })

    it('should report busyWindow from syncedRange and not from the poll dates', async () => {
      // §2's retention window is [today - sessionExpireHours, today + maxPollDateRangeDays]. A poll
      // entirely outside it comes back untouched -- status still 'connected', and deliberately no
      // Google call, since everything fetched would be pruned before the write. Deriving the window
      // from the poll's own dates would claim a coverage that was never fetched.
      const distantPoll = { ...session, dates: ['2030-01-01', '2030-01-02', '2030-01-03'] }
      jest
        .mocked(availabilityService)
        .readAvailabilityRecord.mockResolvedValueOnce({ availability: availabilityRecord, session: distantPoll })

      const result = await getAvailabilityAuthed(event, now)

      const body = JSON.parse(result.body as string)
      expect(body.calendarStatus).toBe('connected')
      expect(body.busyWindow).toEqual({ end: '2025-09-06', start: '2025-09-04' })
      expect(body.busyWindow).not.toEqual({ end: '2030-01-03', start: '2030-01-01' })
      expect(body.busy).toEqual(nothingBusy)
      expect(googleCalendar.fetchFreeBusy).not.toHaveBeenCalled()
    })

    it('should report not_connected with an empty grid when no calendar is linked', async () => {
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(null)

      const result = await getAvailabilityAuthed(event, now)

      const body = JSON.parse(result.body as string)
      expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
      expect(body.calendarStatus).toBe('not_connected')
      expect(body.busy).toEqual(nothingBusy)
      expect(body.busyWindow).toBeNull()
      expect(googleCalendar.fetchFreeBusy).not.toHaveBeenCalled()
    })

    it('should log counts only, never an interval or a grid', async () => {
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(staleAccount)
      jest.mocked(googleCalendar).fetchFreeBusy.mockResolvedValueOnce(calendarAccountRecord.busyIntervals)

      await getAvailabilityAuthed(event, now)

      expect(log).toHaveBeenCalledWith('Authenticated availability read complete', {
        busySlotCount: 2,
        calendarStatus: 'connected',
      })
      const emitted = JSON.stringify(jest.mocked(log).mock.calls)
      expect(emitted).not.toContain('2025-09-04T21:00:00.000Z')
      expect(emitted).not.toContain('busyIntervals')
      expect(emitted).not.toContain('busyWindow')
    })

    it('should return 400 without a Google identity', async () => {
      const anonymous = { ...event, requestContext: { ...event.requestContext, authorizer: undefined } }

      const result = await getAvailabilityAuthed(anonymous as unknown as APIGatewayProxyEventV2, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
      expect(dynamodb.getUser).not.toHaveBeenCalled()
      expect(dynamodb.getCalendarAccount).not.toHaveBeenCalled()
    })

    it('should return 400 when the token carries no subject', async () => {
      const subjectless = {
        ...event,
        requestContext: { ...event.requestContext, authorizer: { jwt: { claims: { name: 'Google User' } } } },
      }

      const result = await getAvailabilityAuthed(subjectless as unknown as APIGatewayProxyEventV2, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
      expect(dynamodb.getCalendarAccount).not.toHaveBeenCalled()
    })

    it('should return 404 when the poll does not exist or has expired', async () => {
      jest
        .mocked(availabilityService)
        .readAvailabilityRecord.mockRejectedValueOnce(new NotFoundError('Session not found'))

      const result = await getAvailabilityAuthed(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
      expect(dynamodb.getCalendarAccount).not.toHaveBeenCalled()
    })

    it('should return 500 and log a sanitized error when a read fails', async () => {
      jest.mocked(dynamodb).getUser.mockRejectedValueOnce(new Error('DynamoDB unavailable'))

      const result = await getAvailabilityAuthed(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 500 }))
      // sanitizeErrorForLogging reduces an axios failure to message and status. Raw, a failure out
      // of refreshAccessToken carries config.data with the client_secret and the refresh token.
      expect(logError).toHaveBeenCalledWith('DynamoDB unavailable')
    })

    it('should serve the grid when Google is down rather than failing the read', async () => {
      // A read is not a check. syncCalendarAccountForPoll swallows a Google failure and stamps
      // 'error', so the participant still gets their own painted availability back.
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(staleAccount)
      jest.mocked(googleCalendar).refreshAccessToken.mockRejectedValueOnce(new Error('Google unavailable'))

      const result = await getAvailabilityAuthed(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
      expect(JSON.parse(result.body as string).free).toEqual(availabilityRecord.free)
    })
  })

  describe('handler', () => {
    // Lambda invokes an exported handler as handler(event, context). Anything the handler accepts in
    // that second slot receives the Context object in production, whatever its declared type says --
    // so the clock cannot live there. Every test above injects the clock through the inner function.
    const lambdaContext = { awsRequestId: 'CBfV4hGMIAMEPZw=', functionName: 'get-availability-authed' }

    it('should ignore the second argument Lambda passes it', async () => {
      const result = await (
        handler as (event: APIGatewayProxyEventV2, context: unknown) => Promise<{ statusCode: number }>
      )(event, lambdaContext)

      expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
    })
  })
})
