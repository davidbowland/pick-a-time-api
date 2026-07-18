import AWSXRay from 'aws-xray-sdk-core'
import https from 'https'

import { APIGatewayProxyEventV2 } from '../types'

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

// Headers carrying live credentials: the Cognito bearer JWT and the single-use reCAPTCHA
// verification token. Compared case-insensitively since API Gateway may not normalize casing
// on every surface.
const REDACTED_HEADERS = new Set(['authorization', 'x-recaptcha-token'])

// OAuth callback query params: the Google authorization `code` and our signed `state` JWT.
const REDACTED_QUERY_KEYS = new Set(['code', 'state'])

// Strip sensitive keys from a header map, case-insensitively. Works for both the single-value
// `headers` map and the V1 `multiValueHeaders` map (string[] values) -- this API is HTTP API
// (V2) only today, so `multiValueHeaders` is always absent in practice, but the same
// case-insensitive redaction is applied here as a harmless no-op should that ever change.
const redactHeaders = <T>(headers: Record<string, T> | undefined | null): Record<string, T> =>
  Object.fromEntries(Object.entries(headers ?? {}).filter(([key]) => !REDACTED_HEADERS.has(key.toLowerCase())))

const redactQuery = (
  query: APIGatewayProxyEventV2['queryStringParameters'],
): APIGatewayProxyEventV2['queryStringParameters'] =>
  query &&
  Object.fromEntries(
    Object.entries(query).map(([key, value]) => [
      key,
      REDACTED_QUERY_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : value,
    ]),
  )

const redactClaims = (claims: Record<string, unknown> | undefined): Record<string, unknown> | undefined =>
  claims && { sub: claims.sub }

// Only body/Authorization/x-recaptcha-token/JWT claims/code/state carry secrets or PII;
// everything else in the event (method, path, other query params, request id, source IP) is
// safe and useful for debugging.
export const redactEvent = (event: APIGatewayProxyEventV2): unknown => {
  const requestContext = event.requestContext as unknown as {
    authorizer?: { jwt?: { claims?: Record<string, unknown> } }
    identity?: { apiKey?: string | null }
  }
  const multiValueHeaders = (event as unknown as { multiValueHeaders?: Record<string, string[]> }).multiValueHeaders
  return {
    ...event,
    body: undefined,
    headers: redactHeaders(event.headers),
    ...(multiValueHeaders && { multiValueHeaders: redactHeaders(multiValueHeaders) }),
    queryStringParameters: redactQuery(event.queryStringParameters),
    requestContext: {
      ...event.requestContext,
      authorizer: requestContext.authorizer && {
        jwt: { claims: redactClaims(requestContext.authorizer.jwt?.claims) },
      },
      // V1 (REST API) events echo the caller's API key here. This API is HTTP API (V2) only
      // today, so `identity` is always absent in practice, but the same defensive redaction
      // applied to multiValueHeaders above is applied here as a harmless no-op should that
      // ever change.
      ...(requestContext.identity && {
        identity: { ...requestContext.identity, apiKey: requestContext.identity.apiKey ? '[REDACTED]' : undefined },
      }),
    },
  }
}
