import AWSXRay from 'aws-xray-sdk-core'
import https from 'https'

export const log = (...args: any[]): unknown => console.log(...args)

export const logError = (...args: any[]): unknown => console.error(...args)

interface AxiosLikeError {
  message: string
  isAxiosError?: boolean
  response?: { status?: number }
}

const isAxiosLikeError = (error: unknown): error is AxiosLikeError =>
  typeof error === 'object' &&
  error !== null &&
  (error as { isAxiosError?: unknown }).isAxiosError === true &&
  typeof (error as { message?: unknown }).message === 'string'

// Strips the raw error down to a minimal, safe-to-log shape. Axios errors carry a `config` object
// with the request's params/headers -- for our Google OAuth calls that's exactly where client
// secrets, refresh tokens, and access tokens live, so it must never reach the logger as-is.
export const sanitizeErrorForLogging = (error: unknown): unknown => {
  if (isAxiosLikeError(error)) {
    return { message: error.message, status: error.response?.status }
  }
  if (error instanceof Error) {
    return error.message
  }
  return error
}

export const logWarn = (...args: any[]): unknown => console.warn(...args)

export const xrayCapture = (x: any): any => (process.env.AWS_SAM_LOCAL === 'true' ? x : AWSXRay.captureAWSv3Client(x))

export const xrayCaptureHttps = (): void =>
  process.env.AWS_SAM_LOCAL === 'true' ? undefined : AWSXRay.captureHTTPsGlobal(https)
