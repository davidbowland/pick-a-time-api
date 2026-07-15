import { DynamoDB } from '@aws-sdk/client-dynamodb'
import * as AWSXRay from 'aws-xray-sdk-core'
import https from 'https'

import { log, logError, logWarn, sanitizeErrorForLogging, xrayCapture, xrayCaptureHttps } from '@utils/logging'

jest.mock('aws-xray-sdk-core')

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

  describe('xrayCapture', () => {
    const capturedDynamodb = 'captured-dynamodb' as unknown as DynamoDB
    const dynamodb = 'dynamodb'

    beforeAll(() => {
      jest.mocked(AWSXRay).captureAWSv3Client.mockReturnValue(capturedDynamodb)
    })

    it('should capture AWS client with X-Ray when not running locally', () => {
      process.env.AWS_SAM_LOCAL = 'false'
      const result = xrayCapture(dynamodb)
      expect(AWSXRay.captureAWSv3Client).toHaveBeenCalledWith(dynamodb)
      expect(result).toEqual(capturedDynamodb)
    })

    it('should return original object when running locally', () => {
      process.env.AWS_SAM_LOCAL = 'true'
      const result = xrayCapture(dynamodb)
      expect(AWSXRay.captureAWSv3Client).toHaveBeenCalledTimes(0)
      expect(result).toEqual(dynamodb)
    })
  })

  describe('xrayCaptureHttps', () => {
    it('should capture HTTPS with X-Ray when not running locally', () => {
      process.env.AWS_SAM_LOCAL = 'false'
      xrayCaptureHttps()
      expect(AWSXRay.captureHTTPsGlobal).toHaveBeenCalledWith(https)
    })

    it('should not capture HTTPS when running locally', () => {
      process.env.AWS_SAM_LOCAL = 'true'
      xrayCaptureHttps()
      expect(AWSXRay.captureHTTPsGlobal).toHaveBeenCalledTimes(0)
    })
  })
})
