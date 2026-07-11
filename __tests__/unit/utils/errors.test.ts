import { ValidationError } from '@errors'

import { serializeValidationError } from '@utils/errors'

describe('serializeValidationError', () => {
  it('should serialize the error message', () => {
    const error = new ValidationError('bad input')
    const result = JSON.parse(serializeValidationError(error))
    expect(result).toEqual({ message: 'bad input' })
  })
})
