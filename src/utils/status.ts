export default {
  OK: { statusCode: 200 },
  CREATED: { statusCode: 201 },
  ACCEPTED: { statusCode: 202 },
  NO_CONTENT: { statusCode: 204, body: '' },
  BAD_REQUEST: { statusCode: 400, body: '{"message":"Bad request"}' },
  UNAUTHORIZED: { statusCode: 401, body: '{"message":"Unauthorized"}' },
  FORBIDDEN: { statusCode: 403 },
  NOT_FOUND: { statusCode: 404, body: '{"message":"Not found"}' },
  CONFLICT: { statusCode: 409 },
  UNPROCESSABLE_ENTITY: { statusCode: 422 },
  TOO_MANY_REQUESTS: { statusCode: 429 },
  INTERNAL_SERVER_ERROR: { statusCode: 500, body: '{"message":"Internal server error"}' },
}
