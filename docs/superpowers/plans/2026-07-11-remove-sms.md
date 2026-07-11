# Remove SMS Capability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the app's ability to send SMS messages by deleting the share-via-SMS feature end-to-end, and remove `phone`/`textsSent` from the user data model since their only consumer was that feature.

**Architecture:** This is a subtractive refactor, not new-feature TDD. Task 1 deletes the SMS transport (`services/sms.ts`) and the `/share` endpoint that used it, plus everything that only existed to support it (rate-limit error/counter, duplicate-phone error, share input parsing/type, the SSM secret lookup, IAM grants). Task 2 removes `phone`/`textsSent` from `UserRecord` and every code path that reads or writes them, since nothing but the deleted share flow ever consumed `phone`. Both tasks end with the full test suite and typecheck green — no task should land in a broken intermediate state.

**Tech Stack:** TypeScript, AWS Lambda, API Gateway (SAM `template.yaml`), DynamoDB, Jest.

## Global Constraints

- Production `src/` files use relative imports (`'../errors'`). Test files use the path aliases configured in `jest.config.ts` (`@errors`, `@services/*`, `@handlers/*`, `@types`, `@utils/*`, `@events/*`, `@config`).
- Jest coverage thresholds (`jest.config.ts`): branches 90, functions 90, lines 80 — global. Deleting code without deleting its tests, or leaving dead branches uncovered, will fail these thresholds.
- `jest.config.ts` has `clearMocks: true`. Never manually clear mocks. Set shared defaults in `beforeAll`; override per-test with `mockResolvedValueOnce`/`mockRejectedValueOnce`. No `beforeEach`.
- Run `npm test` and `npx tsc --noEmit` at the end of each task; both must be clean before committing.
- Follow the design spec at `docs/superpowers/specs/2026-07-11-remove-sms-design.md` for full rationale — this plan implements it verbatim, plus one extra finding noted in Task 1 (dead `corsDomain`/`CORS_DOMAIN`).

---

## Task 1: Delete the SMS transport and the `/share` endpoint

**Files:**
- Delete: `src/services/sms.ts`
- Delete: `__tests__/unit/services/sms.test.ts`
- Delete: `src/handlers/share-session.ts`
- Delete: `__tests__/unit/handlers/share-session.test.ts`
- Delete: `events/share-session.json`
- Modify: `template.yaml`
- Modify: `src/errors.ts`
- Modify: `src/services/dynamodb.ts`
- Modify: `__tests__/unit/services/dynamodb.test.ts`
- Modify: `src/utils/events.ts`
- Modify: `__tests__/unit/utils/events.test.ts`
- Modify: `src/types.ts`
- Modify: `src/services/secrets.ts`
- Modify: `__tests__/unit/services/secrets.test.ts`
- Modify: `src/config.ts`
- Modify: `jest.setup-test-env.js`
- Modify: `__tests__/unit/__mocks__.ts`
- Modify: `endpoints.rest`

**Interfaces:**
- Consumes: nothing from other tasks (this is the first task).
- Produces: a repo with no SMS transport, no `/share` route, no `RateLimitError`/`DuplicatePhoneError`/`incrementTextsSent`/`ShareInput`/`SMSMessage`/`MessageType`/`getSmsApiKey`. `UserRecord.phone`/`UserRecord.textsSent` still exist (Task 2 removes them) — `PHONE_REGEX` in `src/utils/events.ts` and its `/phone` patch-path handling still exist too, since `PATCH /phone` is independent of SMS and is only removed in Task 2.

- [ ] **Step 1: Delete the SMS service, the share handler, and their fixtures**

```bash
git rm src/services/sms.ts \
  __tests__/unit/services/sms.test.ts \
  src/handlers/share-session.ts \
  __tests__/unit/handlers/share-session.test.ts \
  events/share-session.json
```

- [ ] **Step 2: Remove the `/share` Lambda and SMS config from `template.yaml`**

Remove the `smsApiUrl`/`ssmSmsApiKeyName` entries from `EnvironmentMap` for both environments. **Keep `corsDomain`** — it's a separate, still-used mapping (see note below), not an SMS artifact. Change:

```yaml
    prod:
      certificateEdge: cdf7b531-7189-4a69-a82c-ea54ef16729e
      certificateRegional: cdf7b531-7189-4a69-a82c-ea54ef16729e
      corsDomain: https://pick-a-time.com
      domain: api.pick-a-time.com
      domainInternal: api-internal.pick-a-time.com
      logStreamFunction: log-subscriber
      maxPlanWeeks: '12'
      sessionsTable: pick-a-time-api-sessions
      smsApiUrl: https://sms-queue-api.dbowland.com/v1
      ssmSmsApiKeyName: sms-queue-api-key
      zoneId: Z09477181IUYK36D4AQQV
    test:
      certificateEdge: 6a48cba7-feb9-4de5-8cbf-d383140fcdef
      certificateRegional: 6a48cba7-feb9-4de5-8cbf-d383140fcdef
      corsDomain: https://pick-a-time.bowland.link
      domain: pick-a-time-api.bowland.link
      domainInternal: pick-a-time-api-internal.bowland.link
      logStreamFunction: log-subscriber-test
      maxPlanWeeks: '12'
      sessionsTable: pick-a-time-api-sessions-test
      smsApiUrl: https://sms-queue-api.bowland.link/v1
      ssmSmsApiKeyName: sms-queue-api-key-test
      zoneId: Z01312547RGU1BYKIJXY
```

to:

```yaml
    prod:
      certificateEdge: cdf7b531-7189-4a69-a82c-ea54ef16729e
      certificateRegional: cdf7b531-7189-4a69-a82c-ea54ef16729e
      corsDomain: https://pick-a-time.com
      domain: api.pick-a-time.com
      domainInternal: api-internal.pick-a-time.com
      logStreamFunction: log-subscriber
      maxPlanWeeks: '12'
      sessionsTable: pick-a-time-api-sessions
      zoneId: Z09477181IUYK36D4AQQV
    test:
      certificateEdge: 6a48cba7-feb9-4de5-8cbf-d383140fcdef
      certificateRegional: 6a48cba7-feb9-4de5-8cbf-d383140fcdef
      corsDomain: https://pick-a-time.bowland.link
      domain: pick-a-time-api.bowland.link
      domainInternal: pick-a-time-api-internal.bowland.link
      logStreamFunction: log-subscriber-test
      maxPlanWeeks: '12'
      sessionsTable: pick-a-time-api-sessions-test
      zoneId: Z01312547RGU1BYKIJXY
```

**Note on `corsDomain` — do NOT remove the `EnvironmentMap` key:** unlike `smsApiUrl`/`ssmSmsApiKeyName`, `corsDomain` is a genuine multi-purpose mapping still consumed outside any Lambda: the `Api`/`HttpApi` CORS `AllowOrigins` (`!FindInMap [EnvironmentMap, !Ref Environment, corsDomain]` around the `Cors:` block near the top of `Resources`) and the Cognito `UserPoolClient`'s `CallbackURLs`/`LogoutURLs`. Confirm this before editing:

```bash
grep -n "corsDomain" template.yaml
```

expected: hits in `EnvironmentMap` (2), the CORS `AllowOrigins` list, `CallbackURLs`, `LogoutURLs`, and the three Lambda `Environment.Variables.CORS_DOMAIN` entries (`PatchUserFunction`, `PatchUserAuthFunction`, `ShareSessionFunction`). Only the last category — the per-Lambda `CORS_DOMAIN` env vars — is dead weight from the SMS/share cruft; those are removed below (two of the three go away because `ShareSessionFunction` itself is deleted, and the other two because `patch-user.ts` never reads `corsDomain`). The `EnvironmentMap` key itself, the CORS config, and the Cognito URLs are untouched by this task.

Remove the whole `## Share / SMS` section — the `ShareSessionFunction`, `ShareSessionLogGroup`, and `ShareSessionLogGroupSubscription` resources (currently the block starting `## Share / SMS` and ending right before the `# Cognito — Google-only authentication` comment).

In `PatchUserFunction`, remove the SMS IAM `Statement` and the `SMS_API_KEY_PARAM_NAME`/`SMS_API_URL`/`CORS_DOMAIN` env vars (all three are unused by `patch-user.ts` today — confirmed by grep, this is dead cruft, not a functional change). Change:

```yaml
  PatchUserFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/handlers/patch-user.handler
      MemorySize: 1536
      Description: pick-a-time-api patch user (voting)
      Policies:
        - AWSLambdaBasicExecutionRole
        - DynamoDBCrudPolicy:
            TableName: !Ref SessionsTable
        - Statement:
            - Effect: Allow
              Action:
                - ssm:GetParameter
              Resource: !Sub
                - 'arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/${ParamName}'
                - ParamName: !FindInMap [EnvironmentMap, !Ref Environment, ssmSmsApiKeyName]
            - Effect: Allow
              Action:
                - kms:Decrypt
              Resource: !Sub 'arn:aws:kms:${AWS::Region}:${AWS::AccountId}:key/74085ce3-4f95-4edd-99d4-0bb17aa7b879'
      Environment:
        Variables:
          CORS_DOMAIN: !FindInMap [EnvironmentMap, !Ref Environment, corsDomain]
          DYNAMODB_TABLE_NAME: !Ref SessionsTable
          SMS_API_KEY_PARAM_NAME: !FindInMap [EnvironmentMap, !Ref Environment, ssmSmsApiKeyName]
          SMS_API_URL: !FindInMap [EnvironmentMap, !Ref Environment, smsApiUrl]
```

to:

```yaml
  PatchUserFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/handlers/patch-user.handler
      MemorySize: 1536
      Description: pick-a-time-api patch user (voting)
      Policies:
        - AWSLambdaBasicExecutionRole
        - DynamoDBCrudPolicy:
            TableName: !Ref SessionsTable
      Environment:
        Variables:
          DYNAMODB_TABLE_NAME: !Ref SessionsTable
```

Do the same in `PatchUserAuthFunction`. Change:

```yaml
  PatchUserAuthFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/handlers/patch-user.handler
      MemorySize: 1536
      Description: pick-a-time-api patch user (authenticated)
      Policies:
        - AWSLambdaBasicExecutionRole
        - DynamoDBCrudPolicy:
            TableName: !Ref SessionsTable
        - Statement:
            - Effect: Allow
              Action:
                - ssm:GetParameter
              Resource: !Sub
                - 'arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/${ParamName}'
                - ParamName: !FindInMap [EnvironmentMap, !Ref Environment, ssmSmsApiKeyName]
            - Effect: Allow
              Action:
                - kms:Decrypt
              Resource: !Sub 'arn:aws:kms:${AWS::Region}:${AWS::AccountId}:key/74085ce3-4f95-4edd-99d4-0bb17aa7b879'
      Environment:
        Variables:
          CORS_DOMAIN: !FindInMap [EnvironmentMap, !Ref Environment, corsDomain]
          DYNAMODB_TABLE_NAME: !Ref SessionsTable
          SMS_API_KEY_PARAM_NAME: !FindInMap [EnvironmentMap, !Ref Environment, ssmSmsApiKeyName]
          SMS_API_URL: !FindInMap [EnvironmentMap, !Ref Environment, smsApiUrl]
```

to:

```yaml
  PatchUserAuthFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/handlers/patch-user.handler
      MemorySize: 1536
      Description: pick-a-time-api patch user (authenticated)
      Policies:
        - AWSLambdaBasicExecutionRole
        - DynamoDBCrudPolicy:
            TableName: !Ref SessionsTable
      Environment:
        Variables:
          DYNAMODB_TABLE_NAME: !Ref SessionsTable
```

- [ ] **Step 3: Validate the template**

Run: `sam validate --lint -t template.yaml` (if `sam`/`cfn-lint` is available in this environment; otherwise `npx js-yaml template.yaml >/dev/null` as a syntax sanity check).
Expected: no errors. If `sam` isn't installed, note that in the task summary — don't fail the task over tooling availability, but do run the `js-yaml` fallback.

- [ ] **Step 4: Remove `RateLimitError` and `DuplicatePhoneError` from `src/errors.ts`**

Remove these two classes (keep `MaxUsersError` — it's shared with `post-user.ts`):

```ts
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
```

- [ ] **Step 5: Remove `incrementTextsSent` from `src/services/dynamodb.ts`**

Change the import line:

```ts
import { ConflictError, NotFoundError, RateLimitError } from '../errors'
```

to:

```ts
import { ConflictError, NotFoundError } from '../errors'
```

Remove the function (and its doc comment) at the end of the file:

```ts
/**
 * Atomically increment textsSent if below the limit.
 * Throws RateLimitError if the user has already hit the cap.
 */
export const incrementTextsSent = async (sessionId: string, userId: string, limit: number): Promise<void> => {
  const command = new UpdateItemCommand({
    ConditionExpression: '#textsSent < :limit',
    ExpressionAttributeNames: {
      '#textsSent': 'textsSent',
    },
    ExpressionAttributeValues: {
      ':increment': { N: '1' },
      ':limit': { N: `${limit}` },
    },
    Key: {
      PK: { S: sessionId },
      SK: { S: `USER#${userId}` },
    },
    TableName: dynamodbTableName,
    UpdateExpression: 'SET #textsSent = #textsSent + :increment',
  })

  try {
    await dynamodb.send(command)
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      throw new RateLimitError('SMS rate limit exceeded')
    }
    throw error
  }
}
```

- [ ] **Step 6: Update `__tests__/unit/services/dynamodb.test.ts` for the removed function**

Remove `RateLimitError` from the `@errors` import and `incrementTextsSent` from the `@services/dynamodb` import:

```ts
import { ConditionalCheckFailedException, TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import { ConflictError, NotFoundError, RateLimitError } from '@errors'

import { availabilityRecord, session, sessionId, userId, userRecord } from '../__mocks__'
import {
  createAvailability,
  createUser,
  getAllUsers,
  getAvailability,
  getSession,
  getUser,
  incrementTextsSent,
  putNewSession,
  updateAvailability,
  updateUser,
} from '@services/dynamodb'
```

becomes:

```ts
import { ConditionalCheckFailedException, TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import { ConflictError, NotFoundError } from '@errors'

import { availabilityRecord, session, sessionId, userId, userRecord } from '../__mocks__'
import {
  createAvailability,
  createUser,
  getAllUsers,
  getAvailability,
  getSession,
  getUser,
  putNewSession,
  updateAvailability,
  updateUser,
} from '@services/dynamodb'
```

Remove the entire `describe('incrementTextsSent', ...)` block (the last block in the file, three `it`s: increment-with-condition, `RateLimitError` on cap, rethrow non-condition errors).

Leave the `textsSent: { N: ... }` assertion inside the `describe('createUser', ...)` test as-is for now — Task 2 removes `textsSent` from `UserRecord` entirely and updates that assertion.

- [ ] **Step 7: Remove `parseShareBody` from `src/utils/events.ts`**

Remove `ShareInput` from the type import:

```ts
import {
  APIGatewayProxyEventV2,
  AvailabilityCell,
  AvailabilityPatchInput,
  NewPlanInput,
  PatchOperation,
  ShareInput,
} from '../types'
```

becomes:

```ts
import {
  APIGatewayProxyEventV2,
  AvailabilityCell,
  AvailabilityPatchInput,
  NewPlanInput,
  PatchOperation,
} from '../types'
```

Remove the function:

```ts
export const parseShareBody = (event: APIGatewayProxyEventV2): ShareInput => {
  const body = parseEventBody(event) as Record<string, unknown>

  if (typeof body.phone !== 'string' || !PHONE_REGEX.test(body.phone)) {
    throw new ValidationError('phone must match format +1XXXXXXXXXX')
  }

  if (body.type !== 'text') {
    throw new ValidationError('type must be "text"')
  }

  return { phone: body.phone, type: 'text' }
}
```

Leave `PHONE_REGEX` and the `/phone` handling in `parseUserPatch` as-is — Task 2 removes those.

- [ ] **Step 8: Update `__tests__/unit/utils/events.test.ts` for the removed function**

Remove `parseShareBody` from the `@utils/events` import:

```ts
import {
  extractRecaptchaToken,
  parseAvailabilityPatch,
  parseNewPlanBody,
  parseShareBody,
  parseUserPatch,
} from '@utils/events'
```

becomes:

```ts
import { extractRecaptchaToken, parseAvailabilityPatch, parseNewPlanBody, parseUserPatch } from '@utils/events'
```

Remove the entire `describe('parseShareBody', ...)` block (4 `it`s: valid share body, invalid phone, invalid type, null body).

Leave the `parseUserPatch` phone-related tests (`'should accept valid phone patch'`, `'should throw on path that starts with /phone but is not exact'`, `'should throw on invalid phone format'`, `'should throw when phone value is an array'`) as-is — Task 2 removes those.

- [ ] **Step 9: Remove SMS types from `src/types.ts`**

Remove `ShareInput`:

```ts
export interface ShareInput {
  phone: string
  type: 'text'
}
```

Remove the SMS section at the end of the file:

```ts
// SMS

export type MessageType = 'PROMOTIONAL' | 'TRANSACTIONAL'

export interface SMSMessage {
  to: string
  contents: string
  messageType?: MessageType
}
```

Leave `UserRecord.phone`/`UserRecord.textsSent` and `AuthContext.googlePhone` as-is — Task 2 removes those.

- [ ] **Step 10: Remove `getSmsApiKey` from `src/services/secrets.ts`**

Change the import:

```ts
import { recaptchaSecretKeyParamName, smsApiKeyParamName } from '../config'
```

to:

```ts
import { recaptchaSecretKeyParamName } from '../config'
```

Remove:

```ts
export const getSmsApiKey = (now: () => number = Date.now): Promise<string> => getParameter(smsApiKeyParamName, now)
```

- [ ] **Step 11: Update `__tests__/unit/services/secrets.test.ts` for the removed function**

Change the import:

```ts
import { getRecaptchaSecretKey, getSmsApiKey } from '@services/secrets'
```

to:

```ts
import { getRecaptchaSecretKey } from '@services/secrets'
```

Remove the `describe('getSmsApiKey', ...)` block.

- [ ] **Step 12: Remove SMS/share config from `src/config.ts`**

`corsDomain` here is the TypeScript config export (`src/config.ts`), a different thing from the `EnvironmentMap.corsDomain` YAML mapping key kept in Step 2 — this export's only consumer was `share-session.ts` (deleted in Step 1), so it's dead now. Confirm before deleting:

```bash
grep -rn "corsDomain" src/handlers/ src/services/ src/utils/
```

expected: no output.

The full file today is:

```ts
import axios from 'axios'
import axiosRetry from 'axios-retry'

// Axios

axiosRetry(axios, { retries: 3 })

// DynamoDB

export const dynamodbTableName = process.env.DYNAMODB_TABLE_NAME as string
export const sessionExpireHours = parseInt(process.env.SESSION_EXPIRE_HOURS as string, 10)
export const maxPlanWeeks = parseInt(process.env.MAX_PLAN_WEEKS as string, 10)

// Session

export const maxUsersPerSession = parseInt(process.env.MAX_USERS_PER_SESSION as string, 10)

// reCAPTCHA

export const recaptchaSecretKeyParamName = '/pick-a-time/recaptcha-secret-key'

// SMS

export const corsDomain = process.env.CORS_DOMAIN as string
export const smsApiKeyParamName = process.env.SMS_API_KEY_PARAM_NAME as string
export const smsApiUrl = process.env.SMS_API_URL as string
export const smsRateLimitPerUser = parseInt(process.env.SMS_RATE_LIMIT_PER_USER as string, 10)
```

Replace it with (the `// SMS` section deleted entirely):

```ts
import axios from 'axios'
import axiosRetry from 'axios-retry'

// Axios

axiosRetry(axios, { retries: 3 })

// DynamoDB

export const dynamodbTableName = process.env.DYNAMODB_TABLE_NAME as string
export const sessionExpireHours = parseInt(process.env.SESSION_EXPIRE_HOURS as string, 10)
export const maxPlanWeeks = parseInt(process.env.MAX_PLAN_WEEKS as string, 10)

// Session

export const maxUsersPerSession = parseInt(process.env.MAX_USERS_PER_SESSION as string, 10)

// reCAPTCHA

export const recaptchaSecretKeyParamName = '/pick-a-time/recaptcha-secret-key'
```

- [ ] **Step 13: Remove SMS env vars from `jest.setup-test-env.js`**

Change:

```js
// DynamoDB

process.env.DYNAMODB_TABLE_NAME = 'pick-a-time-table'
process.env.SESSION_EXPIRE_HOURS = '24'
process.env.MAX_PLAN_WEEKS = '12'

// Session

process.env.MAX_USERS_PER_SESSION = '10'

// reCAPTCHA

// SMS Queue API

process.env.CORS_DOMAIN = 'https://pick-a-time.bowland.link'
process.env.SMS_API_KEY_PARAM_NAME = 'sms-queue-api-key-test'
process.env.SMS_API_URL = 'https://sms-api.dbowland.com/v1'
process.env.SMS_RATE_LIMIT_PER_USER = '5'
```

to:

```js
// DynamoDB

process.env.DYNAMODB_TABLE_NAME = 'pick-a-time-table'
process.env.SESSION_EXPIRE_HOURS = '24'
process.env.MAX_PLAN_WEEKS = '12'

// Session

process.env.MAX_USERS_PER_SESSION = '10'

// reCAPTCHA
```

- [ ] **Step 14: Remove `shareInput` from `__tests__/unit/__mocks__.ts`**

Change the type import:

```ts
import { AvailabilityRecord, PatchOperation, PlanRecord, ShareInput, UserRecord } from '@types'
```

to:

```ts
import { AvailabilityRecord, PatchOperation, PlanRecord, UserRecord } from '@types'
```

Remove:

```ts
export const shareInput: ShareInput = {
  phone: '+15551234567',
  type: 'text',
}
```

- [ ] **Step 15: Remove the SMS share section from `endpoints.rest`**

Remove the final section of the file:

```
### Share plan via SMS
# Creates a new user with the recipient's phone and sends an SMS with a join link.
# Requires Cognito JWT. The caller's Google sub must match the sharing user's sub.
# Path includes the sharing user's ID for rate-limit tracking and ownership verification.

POST {{host}}/sessions/{{sessionId}}/users/{{userId}}/share
Content-Type: application/json
Authorization: Bearer {{cognito-jwt}}

{
  "phone": "+15559876543",
  "type": "text"
}

# Response 201:
# { "userId": "clever-fox" }
#
# Response 400: invalid phone format, max users reached
# Response 401: missing or invalid JWT
# Response 403: caller's Google sub doesn't match sharing user, or user not linked
# Response 404: session not found, sharing user not found, or expired
# Response 422: phone number already in use in this session
# Response 429: SMS rate limit exceeded (5 texts per user)
# Response 500: SMS send failed (userId of created user included in error body)
```

Leave everything above it (including the `### Update user info (name, phone)` section) as-is — Task 2 updates that section.

- [ ] **Step 16: Run the full test suite and typecheck**

Run: `npm test`
Expected: all tests pass, coverage thresholds met, no reference-to-deleted-module errors.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `grep -rn "sms\|SMS\|share-session\|ShareInput\|RateLimitError\|DuplicatePhoneError\|incrementTextsSent\|getSmsApiKey" src/ __tests__/ template.yaml jest.setup-test-env.js endpoints.rest`
Expected: no output (a case-insensitive `sms` match against `src/assets/nouns.ts`'s word list entries `telephone`/`phone` will not match `sms`, so this should come back empty; if it doesn't, resolve every hit before proceeding).

- [ ] **Step 17: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Remove SMS transport and share-via-SMS endpoint

Deletes services/sms.ts, the /share Lambda and route, and everything that
existed only to support it (rate limiting, duplicate-phone check, share
input parsing/type, SMS secret lookup, IAM grants). Also drops the unused
SMS/CORS_DOMAIN env vars and IAM statements that were dead-copy-pasted onto
the Patch user Lambdas.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Remove `phone`/`textsSent` from the user domain model

**Files:**
- Modify: `src/types.ts`
- Modify: `src/utils/auth.ts`
- Modify: `__tests__/unit/utils/auth.test.ts`
- Modify: `src/utils/events.ts`
- Modify: `__tests__/unit/utils/events.test.ts`
- Modify: `src/handlers/post-user.ts`
- Modify: `__tests__/unit/handlers/post-user.test.ts`
- Modify: `src/handlers/patch-user.ts`
- Modify: `__tests__/unit/handlers/patch-user.test.ts`
- Modify: `src/services/dynamodb.ts`
- Modify: `__tests__/unit/services/dynamodb.test.ts`
- Modify: `__tests__/unit/__mocks__.ts`
- Modify: `endpoints.rest`

**Interfaces:**
- Consumes: the post-Task-1 state — no SMS/share code remains, but `UserRecord.phone`/`UserRecord.textsSent`, `AuthContext.googlePhone`, `PHONE_REGEX`, and the `/phone` patch path are all still present (this task removes them).
- Produces: `UserRecord` with only `userId`/`googleSub`/`name`/`expiration`. No `phone` field anywhere in the request/response surface. `PATCH` only accepts `/name`.

- [ ] **Step 1: Remove `phone`/`textsSent` from `UserRecord` and `googlePhone` from `AuthContext` in `src/types.ts`**

Change:

```ts
export interface UserRecord {
  userId: string
  googleSub: string | null
  name: string | null
  phone: string | null
  textsSent: number
  expiration: number
}
```

to:

```ts
export interface UserRecord {
  userId: string
  googleSub: string | null
  name: string | null
  expiration: number
}
```

Change:

```ts
export interface AuthContext {
  isAuthenticated: boolean
  googleSub: string | null
  googleName?: string
  googlePhone?: string
}
```

to:

```ts
export interface AuthContext {
  isAuthenticated: boolean
  googleSub: string | null
  googleName?: string
}
```

- [ ] **Step 2: Stop extracting `googlePhone` in `src/utils/auth.ts`**

Change:

```ts
  return {
    isAuthenticated: true,
    googleSub: typeof claims.sub === 'string' ? claims.sub : null,
    googleName: typeof claims.name === 'string' ? claims.name : undefined,
    googlePhone: typeof claims.phone_number === 'string' ? claims.phone_number : undefined,
  }
```

to:

```ts
  return {
    isAuthenticated: true,
    googleSub: typeof claims.sub === 'string' ? claims.sub : null,
    googleName: typeof claims.name === 'string' ? claims.name : undefined,
  }
```

- [ ] **Step 3: Update `__tests__/unit/utils/auth.test.ts`**

In the `'should return authenticated with sub, name and phone from claims'` test, remove `phone_number` from the input claims and `googlePhone` from the expectation:

```ts
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
```

becomes:

```ts
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
```

In `'should return authenticated with name only when phone and sub are missing'`, remove `googlePhone` from the expectation and rename to reflect the simplified case:

```ts
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
```

becomes:

```ts
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
```

In `'should ignore non-string claim values'`, remove `phone_number: true` from the input and `googlePhone: undefined` from the expectation:

```ts
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
```

becomes:

```ts
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
```

- [ ] **Step 4: Remove `/phone` handling from `src/utils/events.ts`**

Change:

```ts
export const PHONE_REGEX = /^\+1[2-9]\d{9}$/
const ALLOWED_PATCH_OPS = ['replace']
const ALLOWED_PATCH_PATHS = ['/name', '/phone']
```

to:

```ts
const ALLOWED_PATCH_OPS = ['replace']
const ALLOWED_PATCH_PATHS = ['/name']
```

Remove the `/phone` branch from `parseUserPatch`:

```ts
    if (op.path === '/name') {
      if (!('value' in op) || typeof op.value !== 'string') {
        throw new ValidationError('name must be a string')
      }
      if (op.value.length > 50) {
        throw new ValidationError('name must be 50 characters or fewer')
      }
    }
    if (op.path === '/phone') {
      if (!('value' in op) || typeof op.value !== 'string') {
        throw new ValidationError('phone must be a string')
      }
      if (!PHONE_REGEX.test(op.value)) {
        throw new ValidationError('phone must match format +1XXXXXXXXXX')
      }
    }
```

becomes:

```ts
    if (op.path === '/name') {
      if (!('value' in op) || typeof op.value !== 'string') {
        throw new ValidationError('name must be a string')
      }
      if (op.value.length > 50) {
        throw new ValidationError('name must be 50 characters or fewer')
      }
    }
```

- [ ] **Step 5: Update `__tests__/unit/utils/events.test.ts` for the removed `/phone` path**

In the `describe('parseUserPatch', ...)` block, remove these four `it`s:

```ts
    it('should accept valid phone patch', () => {
      const ops = [{ op: 'replace', path: '/phone', value: '+12025551234' }]
      const result = parseUserPatch(makeEvent(withBody(ops)))
      expect(result).toEqual(ops)
    })
```

```ts
    it('should throw on path that starts with /phone but is not exact', () => {
      const ops = [{ op: 'replace', path: '/phoneExtra', value: 'x' }]
      expect(() => parseUserPatch(makeEvent(withBody(ops)))).toThrow(ValidationError)
    })
```

```ts
    it('should throw on invalid phone format', () => {
      const ops = [{ op: 'replace', path: '/phone', value: '555-1234' }]
      expect(() => parseUserPatch(makeEvent(withBody(ops)))).toThrow(ValidationError)
    })
```

```ts
    it('should throw when phone value is an array', () => {
      const ops = [{ op: 'replace', path: '/phone', value: ['+15551234567'] }]
      expect(() => parseUserPatch(makeEvent(withBody(ops)))).toThrow(ValidationError)
    })
```

Also fix the `'should throw on move op'` test, which references `/phone` only as an incidental `from` value in an already-disallowed op — update it to not reference the removed path (the assertion is unaffected either way, but keep the fixture free of dead references):

```ts
    it('should throw on move op', () => {
      const ops = [{ op: 'move', path: '/name', from: '/phone' }]
      expect(() => parseUserPatch(makeEvent(withBody(ops)))).toThrow(ValidationError)
    })
```

becomes:

```ts
    it('should throw on move op', () => {
      const ops = [{ op: 'move', path: '/name', from: '/name' }]
      expect(() => parseUserPatch(makeEvent(withBody(ops)))).toThrow(ValidationError)
    })
```

- [ ] **Step 6: Remove phone assembly from `src/handlers/post-user.ts`**

Change:

```ts
import { maxUsersPerSession } from '../config'
import { MaxUsersError, NotFoundError } from '../errors'
import { createUser, getSession } from '../services/dynamodb'
import { emptyGrid } from '../services/occurrences'
import { AvailabilityRecord, APIGatewayProxyEventV2, APIGatewayProxyResultV2, UserRecord } from '../types'
import { extractAuthContext } from '../utils/auth'
import { PHONE_REGEX } from '../utils/events'
import { generateUserId } from '../utils/id-generator'
```

to:

```ts
import { maxUsersPerSession } from '../config'
import { MaxUsersError, NotFoundError } from '../errors'
import { createUser, getSession } from '../services/dynamodb'
import { emptyGrid } from '../services/occurrences'
import { AvailabilityRecord, APIGatewayProxyEventV2, APIGatewayProxyResultV2, UserRecord } from '../types'
import { extractAuthContext } from '../utils/auth'
import { generateUserId } from '../utils/id-generator'
```

Change:

```ts
    const userId = generateUserId(users)
    const auth = extractAuthContext(event)
    const phone = auth.googlePhone && PHONE_REGEX.test(auth.googlePhone) ? auth.googlePhone : null

    const user: UserRecord = {
      expiration: session.expiration,
      googleSub: auth.googleSub,
      name: auth.googleName ?? null,
      phone,
      textsSent: 0,
      userId,
    }
```

to:

```ts
    const userId = generateUserId(users)
    const auth = extractAuthContext(event)

    const user: UserRecord = {
      expiration: session.expiration,
      googleSub: auth.googleSub,
      name: auth.googleName ?? null,
      userId,
    }
```

- [ ] **Step 7: Update `__tests__/unit/handlers/post-user.test.ts`**

Change:

```ts
    it('should return CREATED with user object on success', async () => {
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 201 }))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.userId).toBe('brave-tiger')
      expect(body.name).toBeNull()
      expect(body.phone).toBeNull()
      expect(body.textsSent).toBe(0)
      expect(body.googleSub).toBeUndefined()
    })
```

to:

```ts
    it('should return CREATED with user object on success', async () => {
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 201 }))
      const body = JSON.parse((result as { body: string }).body)
      expect(body.userId).toBe('brave-tiger')
      expect(body.name).toBeNull()
      expect(body.googleSub).toBeUndefined()
    })
```

- [ ] **Step 8: Remove the `/phone` branch from `src/handlers/patch-user.ts`**

Change:

```ts
const applyUserPatch = (user: UserRecord, ops: PatchOperation[]): UserRecord => {
  const updated = { ...user }
  for (const op of ops) {
    if (op.path === '/name') updated.name = op.value as string
    if (op.path === '/phone') updated.phone = op.value as string
  }
  return updated
}
```

to:

```ts
const applyUserPatch = (user: UserRecord, ops: PatchOperation[]): UserRecord => {
  const updated = { ...user }
  for (const op of ops) {
    if (op.path === '/name') updated.name = op.value as string
  }
  return updated
}
```

- [ ] **Step 9: Remove the `/phone` test case from `__tests__/unit/handlers/patch-user.test.ts`**

Remove:

```ts
  it('should apply a /phone patch', async () => {
    const phoneEvent = { ...event, body: JSON.stringify([{ op: 'replace', path: '/phone', value: '+15551234567' }]) }
    const result = await handler(phoneEvent)
    expect(JSON.parse((result as { body: string }).body).phone).toBe('+15551234567')
  })
```

- [ ] **Step 10: Remove the `textsSent` attribute write from `createUser` in `src/services/dynamodb.ts`**

Change:

```ts
      {
        Put: {
          ConditionExpression: 'attribute_not_exists(PK)',
          Item: {
            Data: { S: JSON.stringify(user) },
            expiration: { N: `${user.expiration}` },
            PK: { S: sessionId },
            SK: { S: `USER#${user.userId}` },
            textsSent: { N: `${user.textsSent}` },
          },
          TableName: dynamodbTableName,
        },
      },
```

to:

```ts
      {
        Put: {
          ConditionExpression: 'attribute_not_exists(PK)',
          Item: {
            Data: { S: JSON.stringify(user) },
            expiration: { N: `${user.expiration}` },
            PK: { S: sessionId },
            SK: { S: `USER#${user.userId}` },
          },
          TableName: dynamodbTableName,
        },
      },
```

- [ ] **Step 11: Update the `createUser` assertion in `__tests__/unit/services/dynamodb.test.ts`**

Change:

```ts
              Put: {
                ConditionExpression: 'attribute_not_exists(PK)',
                Item: {
                  Data: { S: JSON.stringify(userRecord) },
                  expiration: { N: `${userRecord.expiration}` },
                  PK: { S: sessionId },
                  SK: { S: `USER#${userId}` },
                  textsSent: { N: `${userRecord.textsSent}` },
                },
                TableName: 'pick-a-time-table',
              },
```

to:

```ts
              Put: {
                ConditionExpression: 'attribute_not_exists(PK)',
                Item: {
                  Data: { S: JSON.stringify(userRecord) },
                  expiration: { N: `${userRecord.expiration}` },
                  PK: { S: sessionId },
                  SK: { S: `USER#${userId}` },
                },
                TableName: 'pick-a-time-table',
              },
```

- [ ] **Step 12: Remove `phone`/`textsSent` from the `userRecord` fixture in `__tests__/unit/__mocks__.ts`**

Change:

```ts
export const userRecord: UserRecord = {
  userId: 'fuzzy-penguin',
  googleSub: null,
  name: null,
  phone: null,
  textsSent: 0,
  expiration: 1728547851,
}
```

to:

```ts
export const userRecord: UserRecord = {
  userId: 'fuzzy-penguin',
  googleSub: null,
  name: null,
  expiration: 1728547851,
}
```

- [ ] **Step 13: Update `endpoints.rest` to drop `phone` from every example and the patch docs**

Change the "Get users for plan" response example:

```
# Response 200:
# [
#   {
#     "userId": "brave-tiger",
#     "name": "Alice",
#     "phone": "+15551234567",
#     "expiration": 1725453600
#   },
#   {
#     "userId": "clever-fox",
#     "name": "Bob",
#     "phone": null,
#     "expiration": 1725453600
#   }
# ]
```

to:

```
# Response 200:
# [
#   {
#     "userId": "brave-tiger",
#     "name": "Alice",
#     "expiration": 1725453600
#   },
#   {
#     "userId": "clever-fox",
#     "name": "Bob",
#     "expiration": 1725453600
#   }
# ]
```

Change the "Join a plan" response example:

```
# Response 201:
# {
#   "userId": "clever-fox",
#   "name": null,
#   "phone": null,
#   "expiration": 1725453600
# }
```

to:

```
# Response 201:
# {
#   "userId": "clever-fox",
#   "name": null,
#   "expiration": 1725453600
# }
```

Change the "Update user info" section:

```
### Update user info (name, phone)
# JSON Patch format. Allowed ops: replace.
# Allowed paths: /name, /phone
# Authenticated variant: PATCH {{host}}/sessions/{{sessionId}}/users/{{userId}}/authed (Cognito JWT)

PATCH {{host}}/sessions/{{sessionId}}/users/{{userId}}
Content-Type: application/json

[
  { "op": "replace", "path": "/name", "value": "Alice" }
]

# Example: set phone
# [{ "op": "replace", "path": "/phone", "value": "+15551234567" }]
#
# Response 200: updated user object
# Response 400: disallowed path, name > 50 chars, invalid phone
# Response 404: session or user not found
```

to:

```
### Update user info (name)
# JSON Patch format. Allowed ops: replace.
# Allowed paths: /name
# Authenticated variant: PATCH {{host}}/sessions/{{sessionId}}/users/{{userId}}/authed (Cognito JWT)

PATCH {{host}}/sessions/{{sessionId}}/users/{{userId}}
Content-Type: application/json

[
  { "op": "replace", "path": "/name", "value": "Alice" }
]

# Response 200: updated user object
# Response 400: disallowed path, name > 50 chars
# Response 404: session or user not found
```

- [ ] **Step 14: Run the full test suite and typecheck**

Run: `npm test`
Expected: all tests pass, coverage thresholds met.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `grep -rn "\bphone\b\|textsSent\|googlePhone\|PHONE_REGEX" src/ __tests__/ endpoints.rest`
Expected: no output. (This intentionally excludes `src/assets/nouns.ts`, which isn't in that grep's scope, so no need to exclude it explicitly — but if the grep surfaces it, confirm it's only the noun-list entries `telephone`/`phone` and leave those, since `assets/nouns.ts` is the word list for adjective-noun ID generation, unrelated to the user `phone` field.)

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Remove phone/textsSent from the user domain model

phone's only real consumer was the share-via-SMS flow removed in the
previous commit. Drops UserRecord.phone/textsSent, AuthContext.googlePhone,
PHONE_REGEX, and the PATCH /phone path entirely.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
