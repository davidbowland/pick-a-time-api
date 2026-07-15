/* eslint sort-keys:0 */
import { AvailabilityRecord, CalendarAccountRecord, PatchOperation, PollRecord, UserRecord } from '@types'

// Session (Poll)

export const sessionId = 'abc123'

// 3 dates (Thu/Fri/Sat), times mode 16:00-18:00 with 60-min slots stepped every 30 min ->
// 3 overlapping slots: [16:00-17:00), [16:30-17:30), [17:00-18:00).
export const session: PollRecord = {
  sessionId: 'abc123',
  name: 'Fall rec soccer practice',
  dates: ['2025-09-04', '2025-09-05', '2025-09-06'],
  usesTimes: true,
  startMinute: 960,
  endMinute: 1080,
  slotMinutes: 60,
  timezone: 'America/Chicago',
  expiration: 1728547851,
}

// Users

export const userId = 'fuzzy-penguin'

export const userRecord: UserRecord = {
  userId: 'fuzzy-penguin',
  googleSub: null,
  name: null,
  expiration: 1728547851,
}

// Availability

export const availabilityRecord: AvailabilityRecord = {
  userId: 'fuzzy-penguin',
  free: [
    [false, false, false], // 2025-09-04
    [true, true, false], // 2025-09-05
    [true, true, true], // 2025-09-06
  ],
  expiration: 1728547851,
}

// Calendar

export const googleSub = 'google-sub-123'

export const calendarAccountRecord: CalendarAccountRecord = {
  googleSub: 'google-sub-123',
  refreshTokenEncrypted: 'ZW5jcnlwdGVkLXRva2Vu',
  scope: 'https://www.googleapis.com/auth/calendar.freebusy',
  status: 'connected',
  lastSyncedAt: 1728547000,
  // Covers every date in the `session` fixture (2025-09-04 through 2025-09-06).
  syncedRange: { start: '2025-09-04', end: '2025-09-06' },
  // Raw UTC instant equivalent to 2025-09-04 16:00-17:00 America/Chicago (CDT, UTC-5) -- stored
  // unconverted; each reader converts it to date/minute blocks in its own timezone at read time.
  busyIntervals: [{ start: '2025-09-04T21:00:00.000Z', end: '2025-09-04T22:00:00.000Z' }],
  expiration: 1736323851,
}

// Inputs

export const newPollInput = {
  name: 'Fall rec soccer practice',
  dates: ['2025-09-04', '2025-09-05', '2025-09-06'],
  usesTimes: true,
  startMinute: 960,
  endMinute: 1080,
  slotMinutes: 60,
  timezone: 'America/Chicago',
}

// JSON Patch

export const jsonPatchOperations: PatchOperation[] = [{ op: 'replace', path: '/name', value: 'New Name' }]

// reCAPTCHA

export const recaptchaToken = 'ytrewsdfghjmnbgtyu'
