import axios from 'axios'
import axiosRetry from 'axios-retry'

// Axios

axiosRetry(axios, { retries: 3 })

// DynamoDB

export const dynamodbTableName = process.env.DYNAMODB_TABLE_NAME as string
export const sessionExpireHours = parseInt(process.env.SESSION_EXPIRE_HOURS as string, 10)

// Google

export const googleApiKeyParamName = 'google-places-api'
export const googleImageCount = parseInt(process.env.GOOGLE_IMAGE_COUNT as string, 10)
export const googleImageMaxHeight = parseInt(process.env.GOOGLE_IMAGE_MAX_HEIGHT as string, 10)
export const googleImageMaxWidth = parseInt(process.env.GOOGLE_IMAGE_MAX_WIDTH as string, 10)
export const googleTimeoutMs = 2500

// Session

export const maxUsersPerSession = parseInt(process.env.MAX_USERS_PER_SESSION as string, 10)
export const createSessionFunctionName = process.env.CREATE_SESSION_FUNCTION_NAME as string
export const createSessionTimeoutMs = parseInt(process.env.CREATE_SESSION_TIMEOUT_MS as string, 10)

// reCAPTCHA

export const recaptchaSecretKeyParamName = '/choosee/recaptcha-secret-key'

// Radius

export const radiusMinMiles = parseInt(process.env.RADIUS_MIN_MILES as string, 10)
export const radiusMaxMiles = parseInt(process.env.RADIUS_MAX_MILES as string, 10)
export const radiusDefaultMiles = parseInt(process.env.RADIUS_DEFAULT_MILES as string, 10)
export const metersPerMile = 1609.34

// SMS

export const corsDomain = process.env.CORS_DOMAIN as string
export const smsApiKeyParamName = process.env.SMS_API_KEY_PARAM_NAME as string
export const smsApiUrl = process.env.SMS_API_URL as string
export const smsRateLimitPerUser = parseInt(process.env.SMS_RATE_LIMIT_PER_USER as string, 10)
