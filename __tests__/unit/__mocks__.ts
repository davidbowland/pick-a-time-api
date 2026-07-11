/* eslint sort-keys:0 */
import { AvailabilityRecord, PatchOperation, PlanRecord, ShareInput, UserRecord } from '@types'

// Session (Plan)

export const sessionId = 'abc123'

export const session: PlanRecord = {
  sessionId: 'abc123',
  name: 'Fall rec soccer practice',
  weekdays: [4, 5, 6], // Thu, Fri, Sat
  startDate: '2025-09-04', // a Thursday
  weekCount: 6,
  startHour: 16,
  endHour: 20,
  timezone: 'America/Chicago',
  expiration: 1728547851,
}

// Users

export const userId = 'fuzzy-penguin'

export const userRecord: UserRecord = {
  userId: 'fuzzy-penguin',
  googleSub: null,
  name: null,
  phone: null,
  textsSent: 0,
  expiration: 1728547851,
}

// Availability

export const availabilityRecord: AvailabilityRecord = {
  userId: 'fuzzy-penguin',
  template: [
    [false, false, false],
    [true, true, false],
    [true, true, true],
    [false, false, false],
  ],
  overrides: {},
  expiration: 1728547851,
}

// Inputs

export const newPlanInput = {
  name: 'Fall rec soccer practice',
  weekdays: [4, 5, 6],
  startDate: '2025-09-04',
  weekCount: 6,
  startHour: 16,
  endHour: 20,
  timezone: 'America/Chicago',
}

export const shareInput: ShareInput = {
  phone: '+15551234567',
  type: 'text',
}

// JSON Patch

export const jsonPatchOperations: PatchOperation[] = [{ op: 'replace', path: '/name', value: 'New Name' }]

// reCAPTCHA

export const recaptchaToken = 'ytrewsdfghjmnbgtyu'
