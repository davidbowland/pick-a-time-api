import { ValidationError } from '../errors'

export const serializeValidationError = (error: ValidationError): string =>
  JSON.stringify({
    ...(error.errorCode !== undefined && { errorCode: error.errorCode }),
    message: error.message,
  })
