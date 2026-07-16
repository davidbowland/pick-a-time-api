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

// reCAPTCHA

export const recaptchaSecretKeyParamName = '/pick-a-time/recaptcha-secret-key'

// Calendar sync

export const googleCalendarClientIdParamName = '/pick-a-time/google-client-id'
export const googleCalendarClientSecretParamName = '/pick-a-time/google-client-secret'
export const oauthStateSecretParamName = '/pick-a-time/oauth-state-secret'
export const kmsCalendarKeyId = process.env.KMS_CALENDAR_KEY_ID as string
export const googleCalendarRedirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI as string
export const webAppUrl = process.env.WEB_APP_URL as string
export const calendarSyncFreshnessMs = parseInt(process.env.CALENDAR_SYNC_FRESHNESS_MS as string, 10)
