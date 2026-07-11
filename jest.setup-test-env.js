// DynamoDB

process.env.DYNAMODB_TABLE_NAME = 'pick-a-time-table'
process.env.SESSION_EXPIRE_HOURS = '24'
process.env.MAX_PLAN_WEEKS = '12'

// Session

process.env.MAX_USERS_PER_SESSION = '10'

// reCAPTCHA

// SMS Queue API

process.env.CORS_DOMAIN = 'https://pick-a-time.bowland.link'
process.env.SMS_API_KEY_PARAM_NAME = 'sms-queue-api-key-test'
process.env.SMS_API_URL = 'https://sms-api.dbowland.com/v1'
process.env.SMS_RATE_LIMIT_PER_USER = '5'
