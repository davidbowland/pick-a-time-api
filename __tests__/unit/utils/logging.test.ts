import { APIGatewayProxyEventV2 } from '@types'
import { log, logError, logWarn, redactEvent, sanitizeErrorForLogging } from '@utils/logging'

describe('logging', () => {
  const consoleError = console.error
  const consoleLog = console.log
  const consoleWarn = console.warn

  beforeAll(() => {
    console.error = jest.fn()
    console.log = jest.fn()
    console.warn = jest.fn()
  })

  afterAll(() => {
    console.error = consoleError
    console.log = consoleLog
    console.warn = consoleWarn
  })

  describe('log', () => {
    it.each(['Hello', 0, null, undefined, { a: 1, b: 2 }])(
      'should call console.log with the provided message for value %s',
      async (value) => {
        const message = `Log message for value ${JSON.stringify(value)}`

        await log(message)
        expect(console.log).toHaveBeenCalledWith(message)
      },
    )
  })

  describe('logError', () => {
    it.each(['Hello', 0, null, undefined, { a: 1, b: 2 }])(
      'should call console.error with the error object for value %s',
      async (value) => {
        const message = `Error message for value ${JSON.stringify(value)}`
        const error = new Error(message)

        await logError(error)
        expect(console.error).toHaveBeenCalledWith(error)
      },
    )
  })

  describe('logWarn', () => {
    it.each(['Hello', 0, null, undefined, { a: 1, b: 2 }])(
      'should call console.warn with the provided message for value %s',
      async (value) => {
        const message = `Warn message for value ${JSON.stringify(value)}`

        await logWarn(message)
        expect(console.warn).toHaveBeenCalledWith(message)
      },
    )
  })

  describe('sanitizeErrorForLogging', () => {
    it('should reduce an Axios-shaped error to message and status, dropping config entirely', () => {
      const axiosError = {
        message: 'Request failed with status code 400',
        isAxiosError: true,
        response: { status: 400, data: { error: 'invalid_grant' } },
        config: {
          params: { client_secret: 'shh-client-secret', refresh_token: 'shh-refresh-token', code: 'shh-auth-code' },
          headers: { Authorization: 'Bearer shh-access-token' },
        },
      }

      const result = sanitizeErrorForLogging(axiosError)

      expect(result).toEqual({ message: axiosError.message, status: 400 })
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('config')
      expect(serialized).not.toContain('shh-client-secret')
      expect(serialized).not.toContain('shh-refresh-token')
      expect(serialized).not.toContain('shh-auth-code')
      expect(serialized).not.toContain('shh-access-token')
    })

    it('should pass through a plain Error as just its message', () => {
      const error = new Error('plain failure')
      expect(sanitizeErrorForLogging(error)).toBe('plain failure')
    })

    it.each(['a string error', 0, null, undefined, { a: 1, b: 2 }])(
      'should pass through a non-Error value %s unchanged',
      (value) => {
        expect(sanitizeErrorForLogging(value)).toEqual(value)
      },
    )
  })

  describe('redactEvent', () => {
    const event = {
      body: JSON.stringify({ secret: 'sauce' }),
      headers: {
        authorization: 'Bearer secret-jwt',
        Authorization: 'Bearer secret-jwt',
        'x-recaptcha-token': 'recaptcha-token-value',
        'content-type': 'json',
      },
      queryStringParameters: { code: 'auth-code-value', state: 'signed-state-token', other: 'kept' },
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user-1', name: 'Jane Doe' } } },
      },
    } as unknown as APIGatewayProxyEventV2

    it('drops the body', () => {
      expect((redactEvent(event) as { body: unknown }).body).toBeUndefined()
    })

    it('drops authorization headers (any casing) and the recaptcha token header, but keeps other headers', () => {
      const result = redactEvent(event) as { headers: Record<string, string> }
      expect(result.headers.authorization).toBeUndefined()
      expect(result.headers.Authorization).toBeUndefined()
      expect(result.headers['x-recaptcha-token']).toBeUndefined()
      expect(result.headers['content-type']).toBe('json')
    })

    it('redacts the code and state query params but keeps other query params', () => {
      const result = redactEvent(event) as { queryStringParameters: Record<string, string> }
      expect(result.queryStringParameters).toEqual({ code: '[REDACTED]', state: '[REDACTED]', other: 'kept' })
    })

    it('keeps only sub from the authorizer jwt claims, dropping name PII', () => {
      const result = redactEvent(event) as { requestContext: { authorizer: { jwt: { claims: unknown } } } }
      expect(result.requestContext.authorizer.jwt.claims).toEqual({ sub: 'user-1' })
    })

    it('handles events with no authorizer', () => {
      const unauthenticated = { headers: {}, requestContext: {} } as unknown as APIGatewayProxyEventV2
      const result = redactEvent(unauthenticated) as { requestContext: { authorizer: unknown } }
      expect(result.requestContext.authorizer).toBeUndefined()
    })

    it('handles events with no query string parameters', () => {
      const noQuery = { headers: {}, requestContext: {} } as unknown as APIGatewayProxyEventV2
      const result = redactEvent(noQuery) as { queryStringParameters: unknown }
      expect(result.queryStringParameters).toBeUndefined()
    })

    // V1 (REST / APIGatewayProxyEvent) fixture carrying the token in BOTH `headers`
    // and `multiValueHeaders`. Both must be scrubbed, case-insensitively. This API is HTTP API
    // (V2) only today, so `multiValueHeaders` never appears on real traffic, but the redaction
    // logic covers it as a harmless no-op should that ever change.
    it('drops authorization from multiValueHeaders (any casing) but keeps other multiValueHeaders', () => {
      const v1Event = {
        body: JSON.stringify({ secret: 'sauce' }),
        headers: { Authorization: 'Bearer secret-jwt', 'content-type': 'json' },
        multiValueHeaders: {
          Authorization: ['Bearer secret-jwt'],
          authorization: ['Bearer secret-jwt'],
          'content-type': ['json'],
        },
        requestContext: {},
      } as unknown as APIGatewayProxyEventV2
      const result = redactEvent(v1Event) as { multiValueHeaders: Record<string, string[]> }
      expect(result.multiValueHeaders.Authorization).toBeUndefined()
      expect(result.multiValueHeaders.authorization).toBeUndefined()
      expect(result.multiValueHeaders['content-type']).toEqual(['json'])
    })

    it('is a no-op for multiValueHeaders on V2 events that lack the field', () => {
      const v2Event = { headers: {}, requestContext: {} } as unknown as APIGatewayProxyEventV2
      const result = redactEvent(v2Event) as { multiValueHeaders?: unknown }
      expect('multiValueHeaders' in (result as object)).toBe(false)
    })

    // V1 (REST API) events echo the caller's API key at requestContext.identity.apiKey.
    // This API is HTTP API (V2) only today, so `identity` never appears on real traffic, but
    // the redaction logic covers it as a harmless no-op should that ever change.
    it('redacts requestContext.identity.apiKey when present, keeping other identity fields', () => {
      const v1Event = {
        body: JSON.stringify({ secret: 'sauce' }),
        headers: { Authorization: 'Bearer secret-jwt', 'content-type': 'json' },
        multiValueHeaders: { Authorization: ['Bearer secret-jwt'], 'content-type': ['json'] },
        requestContext: { identity: { apiKey: 'live-api-key-value', sourceIp: '203.0.113.7' } },
      } as unknown as APIGatewayProxyEventV2
      const result = redactEvent(v1Event) as { requestContext: { identity: Record<string, unknown> } }
      expect(result.requestContext.identity.apiKey).toBe('[REDACTED]')
      expect(result.requestContext.identity.sourceIp).toBe('203.0.113.7')
      expect(JSON.stringify(result)).not.toContain('live-api-key-value')
    })

    it('is a no-op for requestContext.identity on events that lack the field', () => {
      const event = { headers: {}, requestContext: {} } as unknown as APIGatewayProxyEventV2
      const result = redactEvent(event) as { requestContext: { identity?: unknown } }
      expect('identity' in result.requestContext).toBe(false)
    })
  })
})
