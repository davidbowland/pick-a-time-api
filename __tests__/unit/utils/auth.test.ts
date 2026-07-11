import { APIGatewayProxyEventV2 } from '@types'
import { extractAuthContext } from '@utils/auth'

describe('extractAuthContext', () => {
  const baseEvent = {
    requestContext: {
      http: { method: 'POST', path: '/v1/test' },
    },
  } as unknown as APIGatewayProxyEventV2

  it('should return unauthenticated when no authorizer is present', () => {
    const result = extractAuthContext(baseEvent)
    expect(result).toEqual({ isAuthenticated: false, googleSub: null })
  })

  it('should return unauthenticated when authorizer has no jwt', () => {
    const event = {
      ...baseEvent,
      requestContext: { ...baseEvent.requestContext, authorizer: {} },
    } as unknown as APIGatewayProxyEventV2
    const result = extractAuthContext(event)
    expect(result).toEqual({ isAuthenticated: false, googleSub: null })
  })

  it('should return authenticated with sub, name and phone from claims', () => {
    const event = {
      ...baseEvent,
      requestContext: {
        ...baseEvent.requestContext,
        authorizer: {
          jwt: {
            claims: { sub: 'abc123', name: 'Alice', phone_number: '+15551234567' },
          },
        },
      },
    } as unknown as APIGatewayProxyEventV2
    const result = extractAuthContext(event)
    expect(result).toEqual({
      isAuthenticated: true,
      googleSub: 'abc123',
      googleName: 'Alice',
      googlePhone: '+15551234567',
    })
  })

  it('should return authenticated with name only when phone and sub are missing', () => {
    const event = {
      ...baseEvent,
      requestContext: {
        ...baseEvent.requestContext,
        authorizer: {
          jwt: {
            claims: { name: 'Bob' },
          },
        },
      },
    } as unknown as APIGatewayProxyEventV2
    const result = extractAuthContext(event)
    expect(result).toEqual({
      isAuthenticated: true,
      googleSub: null,
      googleName: 'Bob',
      googlePhone: undefined,
    })
  })

  it('should ignore non-string claim values', () => {
    const event = {
      ...baseEvent,
      requestContext: {
        ...baseEvent.requestContext,
        authorizer: {
          jwt: {
            claims: { name: 123, phone_number: true },
          },
        },
      },
    } as unknown as APIGatewayProxyEventV2
    const result = extractAuthContext(event)
    expect(result).toEqual({
      isAuthenticated: true,
      googleSub: null,
      googleName: undefined,
      googlePhone: undefined,
    })
  })
})
