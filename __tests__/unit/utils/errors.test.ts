import { ErrorCode, ValidationError } from '@errors'

import { serializeValidationError } from '@utils/errors'

describe('serializeValidationError', () => {
  it('should include errorCode when present', () => {
    const error = new ValidationError('wrong round', ErrorCode.ROUND_NOT_CURRENT)
    const result = JSON.parse(serializeValidationError(error))
    expect(result).toEqual({ errorCode: ErrorCode.ROUND_NOT_CURRENT, message: 'wrong round' })
  })

  it('should omit errorCode when not provided', () => {
    const error = new ValidationError('bad input')
    const result = JSON.parse(serializeValidationError(error))
    expect(result).toEqual({ message: 'bad input' })
    expect(result.errorCode).toBeUndefined()
  })

  it('should omit errorCode when explicitly undefined', () => {
    const error = new ValidationError('bad input', undefined)
    const result = JSON.parse(serializeValidationError(error))
    expect(result).toEqual({ message: 'bad input' })
    expect('errorCode' in result).toBe(false)
  })
})
