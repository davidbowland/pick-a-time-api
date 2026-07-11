import { ValidationError } from '../errors'

export const serializeValidationError = (error: ValidationError): string => JSON.stringify({ message: error.message })
