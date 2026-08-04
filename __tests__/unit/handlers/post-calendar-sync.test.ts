import {
  availabilityRecord,
  calendarAccountRecord,
  googleSub,
  session,
  sessionId,
  userId,
  userRecord,
} from '../__mocks__'
import { NotFoundError } from '@errors'
import eventJson from '@events/post-calendar-sync.json'
import { handler } from '@handlers/post-calendar-sync'
import * as calendarSync from '@services/calendar-sync'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'

jest.mock('@services/calendar-sync')
jest.mock('@services/dynamodb')
jest.mock('@utils/logging', () => ({
  ...jest.requireActual('@utils/logging'),
  log: jest.fn(),
  logError: jest.fn(),
}))

describe('post-calendar-sync', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  // assertSessionActive compares against the real clock, so the fixture poll has to outlive any
  // day this suite runs on. Year 2286 is far enough that the test can never expire.
  const futureSession = { ...session, expiration: 9_999_999_999 }
  const nowMs = 1_728_547_851_000
  const now = (): number => nowMs
  // A factory, not a constant: every test gets its own grid, so a mutating implementation could
  // never leak a marked cell from one test into the next.
  const allFree = () => ({
    ...availabilityRecord,
    free: [
      [true, true, true],
      [true, true, true],
      [true, true, true],
    ],
  })

  // The shared userRecord fixture carries googleSub: null, which no longer matches the signed-in
  // caller in the event fixture -- and must not, since a null googleSub means the participant never
  // linked a Google account. Every happy-path test here is the owner calling on their own record,
  // so this suite overrides the fixture with the caller's own sub. Ownership mismatches are opted
  // into per-test with mockResolvedValueOnce.
  const ownedUserRecord = { ...userRecord, googleSub }

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [] })
    jest.mocked(dynamodb).getUser.mockResolvedValue(ownedUserRecord)
    jest.mocked(dynamodb).getCalendarAccount.mockResolvedValue(calendarAccountRecord)
    jest.mocked(dynamodb).getAvailability.mockImplementation(() => Promise.resolve(allFree()))
    jest.mocked(dynamodb).updateAvailability.mockResolvedValue(undefined)
    jest.mocked(calendarSync).syncCalendarAccountForPoll.mockResolvedValue(calendarAccountRecord)
  })

  describe('handler', () => {
    it('should mark busy hours and report the count', async () => {
      const result = await handler(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
      const body = JSON.parse(result.body as string)
      expect(body.applied).toBe(true)
      // The account fixture is busy 16:00-17:00 Chicago on 2025-09-04. The poll's 60-minute slots
      // step every 30 minutes, so that single hour overlaps slot0 [16:00-17:00) AND slot1
      // [16:30-17:30) -- two cells, not one. slot2 [17:00-18:00) starts as the busy block ends.
      expect(body.markedBusyCount).toBe(2)
      expect(body.availability.free[0]).toEqual([false, false, true])
      expect(body.availability.free[1]).toEqual([true, true, true])
      expect(body.lastSyncedAt).toBe(calendarAccountRecord.lastSyncedAt)
      expect(dynamodb.updateAvailability).toHaveBeenCalledWith(
        sessionId,
        userId,
        expect.objectContaining({
          free: [
            [false, false, true],
            [true, true, true],
            [true, true, true],
          ],
        }),
      )
    })

    it('should stamp calendarCheckedAt on the saved record and echo it back', async () => {
      const result = await handler(event, now)

      const saved = jest.mocked(dynamodb).updateAvailability.mock.calls[0][2]
      expect(saved.calendarCheckedAt).toBe(Math.floor(nowMs / 1000))
      expect(JSON.parse(result.body as string).availability.calendarCheckedAt).toBe(Math.floor(nowMs / 1000))
    })

    it('should ask for a cached sync when the caller did not force one', async () => {
      await handler(event, now)

      expect(calendarSync.syncCalendarAccountForPoll).toHaveBeenCalledWith(
        calendarAccountRecord,
        futureSession,
        now,
        false,
      )
    })

    it('should skip when the poll was already checked and force is false', async () => {
      jest.mocked(dynamodb).getAvailability.mockResolvedValueOnce({ ...allFree(), calendarCheckedAt: 1_728_547_000 })

      const result = await handler(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
      const body = JSON.parse(result.body as string)
      expect(body.applied).toBe(false)
      expect(body.markedBusyCount).toBe(0)
      // Nothing records which hours came from a calendar, so a second unforced check would silently
      // erase a deliberate "I'm free then" edit. The server refuses to call Google or to write.
      expect(calendarSync.syncCalendarAccountForPoll).not.toHaveBeenCalled()
      expect(dynamodb.updateAvailability).not.toHaveBeenCalled()
    })

    it('should return the untouched availability when it skips', async () => {
      const alreadyChecked = { ...allFree(), calendarCheckedAt: 1_728_547_000 }
      jest.mocked(dynamodb).getAvailability.mockResolvedValueOnce(alreadyChecked)

      const result = await handler(event, now)

      expect(JSON.parse(result.body as string).availability).toEqual(alreadyChecked)
      expect(JSON.parse(result.body as string).lastSyncedAt).toBe(calendarAccountRecord.lastSyncedAt)
    })

    it('should run anyway when force is true', async () => {
      jest.mocked(dynamodb).getAvailability.mockResolvedValueOnce({ ...allFree(), calendarCheckedAt: 1_728_547_000 })
      const forced = { ...event, body: JSON.stringify({ force: true }) }

      const result = await handler(forced as APIGatewayProxyEventV2, now)

      const body = JSON.parse(result.body as string)
      expect(body.applied).toBe(true)
      expect(body.markedBusyCount).toBe(2)
      expect(calendarSync.syncCalendarAccountForPoll).toHaveBeenCalledWith(
        calendarAccountRecord,
        futureSession,
        now,
        true,
      )
      expect(dynamodb.updateAvailability).toHaveBeenCalled()
    })

    it('should treat an unparseable body as an unforced check', async () => {
      jest.mocked(dynamodb).getAvailability.mockResolvedValueOnce({ ...allFree(), calendarCheckedAt: 1_728_547_000 })
      const garbled = { ...event, body: 'not json at all' }

      const result = await handler(garbled as APIGatewayProxyEventV2, now)

      expect(JSON.parse(result.body as string).applied).toBe(false)
      expect(calendarSync.syncCalendarAccountForPoll).not.toHaveBeenCalled()
    })

    it('should treat a missing body as an unforced check', async () => {
      const bodyless = { ...event, body: undefined }

      const result = await handler(bodyless as unknown as APIGatewayProxyEventV2, now)

      expect(JSON.parse(result.body as string).applied).toBe(true)
      expect(calendarSync.syncCalendarAccountForPoll).toHaveBeenCalledWith(
        calendarAccountRecord,
        futureSession,
        now,
        false,
      )
    })

    it('should ignore a non-boolean force value', async () => {
      jest.mocked(dynamodb).getAvailability.mockResolvedValueOnce({ ...allFree(), calendarCheckedAt: 1_728_547_000 })
      const sneaky = { ...event, body: JSON.stringify({ force: 'yes' }) }

      const result = await handler(sneaky as APIGatewayProxyEventV2, now)

      expect(JSON.parse(result.body as string).applied).toBe(false)
    })

    it('should return 400 when there is no connected calendar', async () => {
      jest.mocked(dynamodb).getCalendarAccount.mockResolvedValueOnce(null)

      const result = await handler(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
      expect(dynamodb.updateAvailability).not.toHaveBeenCalled()
    })

    it('should return 400 without a Google identity', async () => {
      const anonymous = { ...event, requestContext: { ...event.requestContext, authorizer: undefined } }

      const result = await handler(anonymous as unknown as APIGatewayProxyEventV2, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
      expect(dynamodb.getCalendarAccount).not.toHaveBeenCalled()
    })

    it('should return 403 when the caller is not the participant named in the path', async () => {
      // The attack: any Google-signed-in person holding the poll link posts to another
      // participant's {userId}. Without an ownership check the handler would answer 200, echo the
      // victim's availability -- revealing their calendarCheckedAt, and with it whether they ever
      // connected a calendar -- and write the ATTACKER's busy hours onto the victim's grid.
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce({ ...userRecord, googleSub: 'google-sub-victim' })

      const result = await handler(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 403 }))
      // The victim's availability is never even read, so no branch below -- neither the skip path
      // nor the applied path -- has anything of theirs to echo back.
      expect(dynamodb.getAvailability).not.toHaveBeenCalled()
      expect(dynamodb.getCalendarAccount).not.toHaveBeenCalled()
      expect(calendarSync.syncCalendarAccountForPoll).not.toHaveBeenCalled()
      expect(dynamodb.updateAvailability).not.toHaveBeenCalled()
      expect(result.body as string).not.toContain('calendarCheckedAt')
    })

    it('should return 403 when the participant has never linked a Google account', async () => {
      // Someone who joined anonymously keeps googleSub: null until POST /users/authed or
      // PATCH /users/{userId}/authed links it. Null is not a match: claiming the record by writing
      // the caller's sub onto it would let anyone claim any anonymous participant.
      jest.mocked(dynamodb).getUser.mockResolvedValueOnce({ ...userRecord, googleSub: null })

      const result = await handler(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 403 }))
      expect(calendarSync.syncCalendarAccountForPoll).not.toHaveBeenCalled()
      expect(dynamodb.updateAvailability).not.toHaveBeenCalled()
      expect(result.body as string).not.toContain('calendarCheckedAt')
    })

    it('should return 404 when the poll does not exist', async () => {
      jest.mocked(dynamodb).getSession.mockRejectedValueOnce(new NotFoundError('Session not found'))

      const result = await handler(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
    })

    it('should return 404 when the poll has expired', async () => {
      jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: { ...session, expiration: 1 }, users: [] })

      const result = await handler(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
      expect(calendarSync.syncCalendarAccountForPoll).not.toHaveBeenCalled()
    })

    it('should return 502 and leave availability untouched when Google fails', async () => {
      // syncCalendarAccountForPoll does not throw when Google fails: it catches, stamps
      // status 'error', and hands back the record with its stale cached busyIntervals. Marking
      // hours from that cache would tell the person their calendar was just checked when it
      // never was, so the handler treats an 'error' record as an upstream failure.
      jest
        .mocked(calendarSync)
        .syncCalendarAccountForPoll.mockResolvedValueOnce({ ...calendarAccountRecord, status: 'error' })

      const result = await handler(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 502 }))
      expect(dynamodb.updateAvailability).not.toHaveBeenCalled()
    })

    it('should return 502 on a forced check when Google fails', async () => {
      jest.mocked(dynamodb).getAvailability.mockResolvedValueOnce({ ...allFree(), calendarCheckedAt: 1_728_547_000 })
      jest
        .mocked(calendarSync)
        .syncCalendarAccountForPoll.mockResolvedValueOnce({ ...calendarAccountRecord, status: 'error' })
      const forced = { ...event, body: JSON.stringify({ force: true }) }

      const result = await handler(forced as APIGatewayProxyEventV2, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 502 }))
      expect(dynamodb.updateAvailability).not.toHaveBeenCalled()
    })

    it('should return 502 when the sync throws', async () => {
      jest.mocked(calendarSync).syncCalendarAccountForPoll.mockRejectedValueOnce(new Error('Google unavailable'))

      const result = await handler(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 502 }))
      expect(dynamodb.updateAvailability).not.toHaveBeenCalled()
    })

    it('should return 500 when the write fails', async () => {
      jest.mocked(dynamodb).updateAvailability.mockRejectedValueOnce(new Error('DynamoDB unavailable'))

      const result = await handler(event, now)

      expect(result).toEqual(expect.objectContaining({ statusCode: 500 }))
    })
  })
})
