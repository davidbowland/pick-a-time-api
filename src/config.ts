import axios from 'axios'
import axiosRetry from 'axios-retry'

// Axios

axiosRetry(axios, { retries: 3 })

// DynamoDB

export const dynamodbTableName = process.env.DYNAMODB_TABLE_NAME as string
export const sessionExpireHours = parseInt(process.env.SESSION_EXPIRE_HOURS as string, 10)
export const maxPlanWeeks = parseInt(process.env.MAX_PLAN_WEEKS as string, 10)

// Session

export const maxUsersPerSession = parseInt(process.env.MAX_USERS_PER_SESSION as string, 10)

// reCAPTCHA

export const recaptchaSecretKeyParamName = '/pick-a-time/recaptcha-secret-key'

// SMS

export const corsDomain = process.env.CORS_DOMAIN as string
export const smsApiKeyParamName = process.env.SMS_API_KEY_PARAM_NAME as string
export const smsApiUrl = process.env.SMS_API_URL as string
export const smsRateLimitPerUser = parseInt(process.env.SMS_RATE_LIMIT_PER_USER as string, 10)
