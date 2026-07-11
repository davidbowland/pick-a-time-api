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

  it('should return authenticated with sub and name from claims', () => {
    const event = {
      ...baseEvent,
      requestContext: {
        ...baseEvent.requestContext,
        authorizer: {
          jwt: {
            claims: { sub: 'abc123', name: 'Alice' },
          },
        },
      },
    } as unknown as APIGatewayProxyEventV2
    const result = extractAuthContext(event)
    expect(result).toEqual({
      isAuthenticated: true,
      googleSub: 'abc123',
      googleName: 'Alice',
    })
  })

  it('should return authenticated with name only when sub is missing', () => {
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
    })
  })

  it('should ignore non-string claim values', () => {
    const event = {
      ...baseEvent,
      requestContext: {
        ...baseEvent.requestContext,
        authorizer: {
          jwt: {
            claims: { name: 123 },
          },
        },
      },
    } as unknown as APIGatewayProxyEventV2
    const result = extractAuthContext(event)
    expect(result).toEqual({
      isAuthenticated: true,
      googleSub: null,
      googleName: undefined,
    })
  })
})
