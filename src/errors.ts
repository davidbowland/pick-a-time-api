// Error codes — machine-stable identifiers for specific validation failures

export enum ErrorCode {
  ROUND_NOT_CURRENT = 'ROUND_NOT_CURRENT',
}

export class ValidationError extends Error {
  errorCode?: ErrorCode

  constructor(message: string, errorCode?: ErrorCode) {
    super(message)
    this.name = 'ValidationError'
    this.errorCode = errorCode
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export class MaxUsersError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MaxUsersError'
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RateLimitError'
  }
}

export class DuplicatePhoneError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DuplicatePhoneError'
  }
}
