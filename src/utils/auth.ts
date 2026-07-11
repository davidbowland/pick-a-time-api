import { APIGatewayProxyEventV2, AuthContext } from '../types'

interface JwtClaims {
  jwt?: {
    claims?: Record<string, unknown>
  }
}

interface RequestContextWithAuthorizer {
  authorizer?: JwtClaims
}

export const extractAuthContext = (event: APIGatewayProxyEventV2): AuthContext => {
  const requestContext = event.requestContext as unknown as RequestContextWithAuthorizer | undefined
  const claims = requestContext?.authorizer?.jwt?.claims
  if (!claims) {
    return { isAuthenticated: false, googleSub: null }
  }

  return {
    isAuthenticated: true,
    googleSub: typeof claims.sub === 'string' ? claims.sub : null,
    googleName: typeof claims.name === 'string' ? claims.name : undefined,
    googlePhone: typeof claims.phone_number === 'string' ? claims.phone_number : undefined,
  }
}
