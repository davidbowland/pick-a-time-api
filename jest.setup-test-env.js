// DynamoDB

process.env.DYNAMODB_TABLE_NAME = 'pick-a-time-table'
process.env.SESSION_EXPIRE_HOURS = '336'
process.env.MAX_POLL_DATES = '90'

// Session

process.env.MAX_USERS_PER_SESSION = '10'

// reCAPTCHA

// Calendar sync

process.env.KMS_CALENDAR_KEY_ID = 'test-kms-calendar-key-id'
process.env.GOOGLE_CALENDAR_REDIRECT_URI = 'https://pick-a-time-api.bowland.link/v1/oauth/google-calendar/callback'
process.env.WEB_APP_URL = 'https://pick-a-time.bowland.link'
process.env.CALENDAR_SYNC_FRESHNESS_MS = '1800000'
