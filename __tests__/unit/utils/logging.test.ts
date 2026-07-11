import { DynamoDB } from '@aws-sdk/client-dynamodb'
import * as AWSXRay from 'aws-xray-sdk-core'
import https from 'https'

import { log, logError, logWarn, xrayCapture, xrayCaptureHttps } from '@utils/logging'

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
