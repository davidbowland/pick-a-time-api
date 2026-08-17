import axios from 'axios'
import axiosRetry from 'axios-retry'

// Axios

axiosRetry(axios, { retries: 3 })

// DynamoDB

export const dynamodbTableName = process.env.DYNAMODB_TABLE_NAME as string
export const sessionExpireHours = parseInt(process.env.SESSION_EXPIRE_HOURS as string, 10)
export const maxPollDates = parseInt(process.env.MAX_POLL_DATES as string, 10)

// Session

export const maxUsersPerSession = parseInt(process.env.MAX_USERS_PER_SESSION as string, 10)

// Poll limits and defaults

export const pollNameMaxLength = 100
export const participantNameMaxLength = 50
export const allowedSlotMinutes = [15, 30, 60, 90, 120]
export const defaultSlotMinutes = 60
export const startEndMinuteStep = 15
export const maxPollDateRangeDays = 365 // the exact max offset (in days, inclusive) from today a poll date may be -- single source of truth for both the events.ts validation and this disclosed value
export const maxPollOverrideGroups = 10 // max entries in a TimedPoll's overrides array

// SSM

// Both environments deploy into the same AWS account, so the parameter tree is what keeps their
// secrets apart: prod reads /pick-a-time, test reads /pick-a-time-test. The two hold different
// Google OAuth clients, since test's belongs to a GCP project that stays in Testing status.
const ssmParamPrefix = process.env.SSM_PARAM_PREFIX as string

// reCAPTCHA

export const recaptchaSecretKeyParamName = `${ssmParamPrefix}/recaptcha-secret-key`

// Calendar sync

export const googleCalendarClientIdParamName = `${ssmParamPrefix}/google-client-id`
export const googleCalendarClientSecretParamName = `${ssmParamPrefix}/google-client-secret`
export const oauthStateSecretParamName = `${ssmParamPrefix}/oauth-state-secret`
export const kmsCalendarKeyId = process.env.KMS_CALENDAR_KEY_ID as string
export const googleCalendarRedirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI as string
export const webAppUrl = process.env.WEB_APP_URL as string
export const calendarSyncFreshnessMs = parseInt(process.env.CALENDAR_SYNC_FRESHNESS_MS as string, 10)

// How long a connected calendar account record lives, as a DynamoDB TTL. It sits here rather than
// module-private beside the OAuth callback that first stamps it because the sync path re-stamps it
// on every successful check -- two copies of this number would drift, and the published privacy
// policy promises a specific one ("every check restarts that clock"), so there can only be one.
export const CALENDAR_ACCOUNT_TTL_SECONDS = 90 * 24 * 3600

// Hard backstop under the retention window in calendar-sync.ts, not the primary bound. A cached
// interval costs roughly 62 bytes as a DynamoDB map (the two 24-character instants plus their
// attribute names), so 5000 of them is about 310KB against the 400KB item limit -- room to spare
// for the rest of the record, and far above any real calendar (5000 intervals across the retention
// window is more than thirteen bookings every day for a year). Exceeding it is treated as a failed
// sync rather than as license to drop the oldest: see the throw in calendar-sync.ts for why.
export const maxCachedBusyIntervals = 5000
