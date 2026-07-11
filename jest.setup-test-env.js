// DynamoDB

process.env.DYNAMODB_TABLE_NAME = 'choosee-table'
process.env.SESSION_EXPIRE_HOURS = '24'

// Google

process.env.GOOGLE_IMAGE_COUNT = '5'
process.env.GOOGLE_IMAGE_MAX_HEIGHT = '300'
process.env.GOOGLE_IMAGE_MAX_WIDTH = '400'

// Session

process.env.MAX_USERS_PER_SESSION = '10'
process.env.CREATE_SESSION_FUNCTION_NAME = 'create-session-lambda'
process.env.CREATE_SESSION_TIMEOUT_MS = '10000'

// Radius

process.env.RADIUS_MIN_MILES = '1'
process.env.RADIUS_MAX_MILES = '30'
process.env.RADIUS_DEFAULT_MILES = '15'

// reCAPTCHA

// SMS Queue API

process.env.CORS_DOMAIN = 'https://choosee.bowland.link'
process.env.SMS_API_KEY_PARAM_NAME = 'sms-queue-api-key-test'
process.env.SMS_API_URL = 'https://sms-api.dbowland.com/v1'
process.env.SMS_RATE_LIMIT_PER_USER = '5'
