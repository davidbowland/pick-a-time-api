# Pick a Time — Core Domain (Plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace this repo's restaurant-bracket-voting domain with the Pick a Time recurring-availability domain: create a plan, join it, and paint a template+per-week-override availability grid. No overlap computation (Plan B) and no Google Calendar sync (Plan C) yet — this plan ships a working, testable API that stores availability; it doesn't yet compute anything from it.

**Architecture:** Same single-table DynamoDB (`PK=sessionId`, `SK='SESSION'|'USER#<id>'|'AVAIL#<id>'`), same Lambda-per-route pattern on API Gateway (both the legacy REST API and HTTP API, mirrored as today), same JWT-claims auth extraction that degrades gracefully when unauthenticated, same adjective-noun ID generation. The optimistic-concurrency `version` field on the session item is dropped — nothing in this plan's scope mutates a plan record after creation, so there's nothing to race.

**Tech Stack:** TypeScript, AWS Lambda (`aws-lambda`), API Gateway (SAM `template.yaml`), DynamoDB (`@aws-sdk/client-dynamodb`), Jest, esbuild.

## Global Constraints

- Keep `sessionId` as the internal field/table-key name; "plan" is UI copy only, never a field name.
- The server is the source of truth. No aggregation, pattern, or "who's busy" logic belongs in this plan — that's `services/overlap.ts` in Plan B. This plan only stores what each user painted.
- Availability grid: hourly slots only in v1 (no 30-minute granularity — matches the shipped UI mockup). `slotMinutes` is not a field anywhere in this plan.
- `weekdays` input must be given in the exact column order the client will display, and `startDate` must fall on `weekdays[0]` — this is what lets occurrence math stay simple (see Task 3).
- Max plan length: 12 weeks (`MAX_PLAN_WEEKS`, new config constant).
- Production `src/` files use relative imports (`'../errors'`). Test files use the path aliases already configured in `jest.config.ts` (`@errors`, `@services/*`, `@handlers/*`, `@types`, `@utils/*`, `@events/*`, `@config`).
- Jest coverage thresholds (`jest.config.ts`): branches 90, functions 90, lines 80 — global. Every new file needs real test coverage, not just the happy path.
- Never manually clear mocks (`clearMocks: true` is on). Set shared defaults in `beforeAll`; override per-test with `mockResolvedValueOnce`/`mockRejectedValueOnce`. No `beforeEach`.
- Any function using `Date.now()`/`Math.random()`/`crypto.randomInt()` for a value that affects test outcomes takes it as an injectable parameter with a default (see `postSession(event, nowMs = Date.now())` already in the codebase for the pattern).

---

## File Structure

**Delete** (restaurant/bracket/places domain — Task 1):
- `src/handlers/close-round.ts`, `create-session.ts`, `get-choices.ts`, `get-reverse-geocode.ts`, `get-session-config.ts`, `subscribe-round.ts`
- `src/services/brackets.ts`, `google-maps.ts`
- `src/assets/place-types.ts`
- `src/utils/open-hours.ts`
- Matching files in `__tests__/unit/handlers/`, `__tests__/unit/services/`, `__tests__/unit/utils/`
- `events/close-round.json`, `get-choice-by-id.json`, `get-choices.json`, `get-decisions-by-id.json`, `get-reverse-geocode.json`, `get-session-config.json`, `patch-decisions-by-id.json`, `patch-session.json`, `subscribe-round.json`

**Modify:**
- `src/types.ts` — remove restaurant/places types, add `PlanRecord`, `SessionWithUsers`, `AvailabilityRecord`, `NewPlanInput`; slim `UserRecord`
- `src/config.ts` — remove Google Places/radius/async-worker constants, add `maxPlanWeeks`
- `src/utils/events.ts` — remove `parseNewSessionBody`/`parseLatLng`/`formatLatLng`/`parseSubscribeBody`/`parseCloseRoundInput`, add `parseNewPlanBody`/`parseAvailabilityPatch`, simplify `parseUserPatch`
- `src/services/dynamodb.ts` — retype Session functions for `PlanRecord`, drop `updateSession`/`getChoices`/`putChoices`, add Availability CRUD
- `src/handlers/post-session.ts`, `post-user.ts`, `patch-user.ts`, `get-session-by-id.ts`, `get-users.ts`, `share-session.ts` — adapted to the new domain
- `__tests__/unit/__mocks__.ts` — replace restaurant fixtures with plan/availability fixtures
- `template.yaml` — remove obsolete routes, add availability routes
- `endpoints.rest` — replace restaurant examples with plan examples

**Create:**
- `src/services/occurrences.ts` (+ test) — `buildOccurrences`, `emptyGrid`
- `src/handlers/get-availability.ts`, `patch-availability.ts` (+ tests)

---

### Task 1: Delete the restaurant/bracket/places domain

**Files:**
- Delete: all files listed under "Delete" above
- Modify: `src/types.ts`, `src/config.ts`, `jest.setup-test-env.js`, `template.yaml`

**Interfaces:** None — this task only removes code. Nothing later depends on anything deleted here.

- [ ] **Step 1: Delete the dead handler, service, asset, and util files**

```bash
git rm src/handlers/close-round.ts src/handlers/create-session.ts src/handlers/get-choices.ts \
  src/handlers/get-reverse-geocode.ts src/handlers/get-session-config.ts src/handlers/subscribe-round.ts \
  src/services/brackets.ts src/services/google-maps.ts src/assets/place-types.ts src/utils/open-hours.ts
```

- [ ] **Step 2: Delete their tests and now-orphaned event fixtures**

```bash
git rm __tests__/unit/handlers/close-round.test.ts __tests__/unit/handlers/create-session.test.ts \
  __tests__/unit/handlers/get-choices.test.ts __tests__/unit/handlers/get-reverse-geocode.test.ts \
  __tests__/unit/handlers/get-session-config.test.ts __tests__/unit/handlers/subscribe-round.test.ts \
  __tests__/unit/services/brackets.test.ts __tests__/unit/services/google-maps.test.ts \
  __tests__/unit/utils/open-hours.test.ts
git rm events/close-round.json events/get-choice-by-id.json events/get-choices.json \
  events/get-decisions-by-id.json events/get-reverse-geocode.json events/get-session-config.json \
  events/patch-decisions-by-id.json events/patch-session.json events/subscribe-round.json
```

- [ ] **Step 3: Remove restaurant/places-only exports from `src/types.ts`**

Delete these exports entirely: `PriceLevel`, `GoogleRankBy`, `RankByType`, `LatLng`, `OpeningHoursPeriod`, `PlaceDetails`, `PlaceTypeDisplay`, `GeocodedAddress`, `ChoicesRecord`, `ChoiceDetail`, `SortOption`, `RadiusConstraints`, `SessionConfig`, `SubscribeInput`, `CloseRoundInput`. Leave `SessionRecord`, `VersionedSession`, `UserRecord`, `NewSessionInput`, `ShareInput`, `AuthContext`, `MessageType`, `SMSMessage`, and the `PatchOperation`/AWS re-exports untouched for now — Task 2 reshapes those.

- [ ] **Step 4: Remove now-unused config from `src/config.ts`**

Delete: `googleApiKeyParamName`, `googleImageCount`, `googleImageMaxHeight`, `googleImageMaxWidth`, `googleTimeoutMs`, `createSessionFunctionName`, `createSessionTimeoutMs`, `radiusMinMiles`, `radiusMaxMiles`, `radiusDefaultMiles`, `metersPerMile`. Keep the `axios`/`axiosRetry` setup at the top (still used by `services/sms.ts` and `services/recaptcha.ts`) and everything under `// Session`, `// reCAPTCHA`, and `// SMS`.

- [ ] **Step 5: Remove the matching env vars from `jest.setup-test-env.js`**

Delete the `GOOGLE_IMAGE_*`, `CREATE_SESSION_FUNCTION_NAME`, `CREATE_SESSION_TIMEOUT_MS`, and `RADIUS_*` lines. Leave `DYNAMODB_TABLE_NAME`, `SESSION_EXPIRE_HOURS`, `MAX_USERS_PER_SESSION`, `CORS_DOMAIN`, `SMS_API_KEY_PARAM_NAME`, `SMS_API_URL`, `SMS_RATE_LIMIT_PER_USER`.

- [ ] **Step 6: Remove the obsolete routes from `template.yaml`**

Delete these resources entirely (each is a `Function` + matching `...LogGroup` + `...LogGroupSubscription` trio): `CreateSessionFunction`, `GetChoicesFunction`, `GetReverseGeocodeFunction`, `GetReverseGeocodeAuthedFunction`, `GetSessionConfigFunction`, `CloseRoundFunction`, `SubscribeRoundFunction`. Leave the `GoogleClientId`/`GoogleClientSecret` params and the whole Cognito section (`UserPool`, `GoogleIdentityProvider`, `UserPoolClient`, `UserPoolDomain`) untouched — those back sign-in, not Places.

- [ ] **Step 7: Confirm the tree is still consistent**

Run: `npm run typecheck`
Expected: errors only in files this task didn't touch yet but that reference now-deleted exports (`post-session.ts`, `post-user.ts`, `patch-user.ts`, `share-session.ts`, `get-session-by-id.ts`, `get-users.ts`, `__tests__/unit/__mocks__.ts`, `utils/events.ts`) — those are fixed in later tasks. If `typecheck` errors on anything *outside* that list, you deleted something still in use — restore it and re-check.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: remove restaurant/bracket/places domain"
```

---

### Task 2: Plan + Availability types

**Files:**
- Modify: `src/types.ts`, `__tests__/unit/__mocks__.ts`

**Interfaces:**
- Produces: `PlanRecord`, `SessionWithUsers`, `AvailabilityRecord`, `NewPlanInput`, slimmed `UserRecord` — every later task imports these from `../types` (or `@types` in tests).

- [ ] **Step 1: Replace `SessionRecord`/`VersionedSession`/`UserRecord`/`NewSessionInput` in `src/types.ts`**

```ts
export interface PlanRecord {
  sessionId: string
  name: string
  weekdays: number[] // 0=Sun..6=Sat, in display column order, e.g. [4,5,6] for Thu/Fri/Sat
  startDate: string // ISO date "YYYY-MM-DD" — must fall on weekdays[0]
  weekCount: number
  startHour: number // 0-23
  endHour: number // 1-24, exclusive upper bound, > startHour
  timezone: string // IANA name, e.g. "America/Chicago"
  expiration: number
}

export interface SessionWithUsers {
  session: PlanRecord
  users: string[]
}

export interface UserRecord {
  userId: string
  googleSub: string | null
  name: string | null
  phone: string | null
  textsSent: number
  expiration: number
}

export interface AvailabilityRecord {
  userId: string
  template: boolean[][] // [hourIndex][dayIndex], sized (endHour-startHour) x weekdays.length
  overrides: Record<number, boolean[][]> // sparse, keyed by weekIndex (0-based)
  expiration: number
}

export interface NewPlanInput {
  name: string
  weekdays: number[]
  startDate: string
  weekCount: number
  startHour: number
  endHour: number
  timezone: string
}
```

Leave `ShareInput`, `AuthContext`, `MessageType`, `SMSMessage`, the AWS/`fast-json-patch` re-exports as-is.

- [ ] **Step 2: Replace the restaurant fixtures in `__tests__/unit/__mocks__.ts`**

Delete the `// Places`, `// Choices`, `// Geocoding`, `// Place response` sections and their exports (`placeId`, `place1`, `place2`, `choiceDetail1..4`, `choicesRecord`, `geocodedAddress`, `geocodeResult`, `reverseGeocodeResult`, `placeResponse`) and `newSessionInput`. Replace the `// Session` and `// Users` sections with:

```ts
import { AvailabilityRecord, PatchOperation, PlanRecord, ShareInput, UserRecord } from '@types'

// Session (Plan)

export const sessionId = 'abc123'

export const session: PlanRecord = {
  sessionId: 'abc123',
  name: 'Fall rec soccer practice',
  weekdays: [4, 5, 6], // Thu, Fri, Sat
  startDate: '2025-09-04', // a Thursday
  weekCount: 6,
  startHour: 16,
  endHour: 20,
  timezone: 'America/Chicago',
  expiration: 1728547851,
}

// Users

export const userId = 'fuzzy-penguin'

export const userRecord: UserRecord = {
  userId: 'fuzzy-penguin',
  googleSub: null,
  name: null,
  phone: null,
  textsSent: 0,
  expiration: 1728547851,
}

// Availability

export const availabilityRecord: AvailabilityRecord = {
  userId: 'fuzzy-penguin',
  template: [
    [false, false, false],
    [true, true, false],
    [true, true, true],
    [false, false, false],
  ],
  overrides: {},
  expiration: 1728547851,
}

// Inputs

export const newPlanInput = {
  name: 'Fall rec soccer practice',
  weekdays: [4, 5, 6],
  startDate: '2025-09-04',
  weekCount: 6,
  startHour: 16,
  endHour: 20,
  timezone: 'America/Chicago',
}

export const shareInput: ShareInput = {
  phone: '+15551234567',
  type: 'text',
}

// JSON Patch

export const jsonPatchOperations: PatchOperation[] = [{ op: 'replace', path: '/name', value: 'New Name' }]

// reCAPTCHA

export const recaptchaToken = 'ytrewsdfghjmnbgtyu'
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: errors now concentrated in `src/handlers/*.ts`, `src/services/dynamodb.ts`, `src/utils/events.ts` — the files Tasks 3-13 fix. `__mocks__.ts` itself should compile clean.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts __tests__/unit/__mocks__.ts
git commit -m "feat: add Plan/Availability domain types, remove restaurant types"
```

---

### Task 3: Occurrence and grid math

**Files:**
- Create: `src/services/occurrences.ts`
- Test: `__tests__/unit/services/occurrences.test.ts`

**Interfaces:**
- Consumes: `PlanRecord` (from Task 2)
- Produces: `Occurrence` (`{ weekIndex: number; dayIndex: number; date: string }`), `buildOccurrences(plan)`, `emptyGrid(hourCount, dayCount)` — Task 7 and Plan B both depend on `buildOccurrences`; Task 7 depends on `emptyGrid`.

This corrects a real bug from the earlier UI mockup's date math, which assumed `weekIndex*7 + dayIndex` days after `startDate` — that only works when the configured weekdays are consecutive (Thu/Fri/Sat). It's wrong for something like Mon/Wed/Fri. The fix: compute each weekday's offset from `startDate`'s day-of-week using modular arithmetic, once, then apply that fixed per-column offset every week.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/unit/services/occurrences.test.ts
import { buildOccurrences, emptyGrid } from '@services/occurrences'

describe('occurrences', () => {
  describe('buildOccurrences', () => {
    it('should build consecutive-weekday occurrences (Thu/Fri/Sat x 2 weeks)', () => {
      const result = buildOccurrences({ weekdays: [4, 5, 6], startDate: '2025-09-04', weekCount: 2 })
      expect(result).toEqual([
        { weekIndex: 0, dayIndex: 0, date: '2025-09-04' },
        { weekIndex: 0, dayIndex: 1, date: '2025-09-05' },
        { weekIndex: 0, dayIndex: 2, date: '2025-09-06' },
        { weekIndex: 1, dayIndex: 0, date: '2025-09-11' },
        { weekIndex: 1, dayIndex: 1, date: '2025-09-12' },
        { weekIndex: 1, dayIndex: 2, date: '2025-09-13' },
      ])
    })

    it('should build non-consecutive-weekday occurrences (Mon/Wed/Fri) correctly', () => {
      const result = buildOccurrences({ weekdays: [1, 3, 5], startDate: '2025-09-01', weekCount: 1 })
      expect(result).toEqual([
        { weekIndex: 0, dayIndex: 0, date: '2025-09-01' },
        { weekIndex: 0, dayIndex: 1, date: '2025-09-03' },
        { weekIndex: 0, dayIndex: 2, date: '2025-09-05' },
      ])
    })

    it('should handle a single weekday spanning several weeks', () => {
      const result = buildOccurrences({ weekdays: [0], startDate: '2025-09-07', weekCount: 3 })
      expect(result.map((o) => o.date)).toEqual(['2025-09-07', '2025-09-14', '2025-09-21'])
    })
  })

  describe('emptyGrid', () => {
    it('should build a grid of the given dimensions, all false', () => {
      const grid = emptyGrid(3, 2)
      expect(grid).toEqual([
        [false, false],
        [false, false],
        [false, false],
      ])
    })

    it('should return independent row arrays (mutating one row must not affect another)', () => {
      const grid = emptyGrid(2, 2)
      grid[0][0] = true
      expect(grid[1][0]).toBe(false)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest occurrences.test.ts`
Expected: FAIL — `Cannot find module '@services/occurrences'`

- [ ] **Step 3: Write the implementation**

```ts
// src/services/occurrences.ts
import { PlanRecord } from '../types'

export interface Occurrence {
  weekIndex: number
  dayIndex: number
  date: string // ISO "YYYY-MM-DD"
}

const parseIsoDate = (isoDate: string): Date => {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

const formatIsoDate = (date: Date): string => date.toISOString().slice(0, 10)

export const dayOfWeek = (isoDate: string): number => parseIsoDate(isoDate).getUTCDay()

export const buildOccurrences = (
  plan: Pick<PlanRecord, 'weekdays' | 'startDate' | 'weekCount'>,
): Occurrence[] => {
  const startDow = dayOfWeek(plan.startDate)
  const offsetsWithinWeek = plan.weekdays.map((weekday) => (weekday - startDow + 7) % 7)

  const occurrences: Occurrence[] = []
  plan.weekdays.forEach((_, dayIndex) => {
    for (let weekIndex = 0; weekIndex < plan.weekCount; weekIndex++) {
      const totalDayOffset = weekIndex * 7 + offsetsWithinWeek[dayIndex]
      const date = parseIsoDate(plan.startDate)
      date.setUTCDate(date.getUTCDate() + totalDayOffset)
      occurrences.push({ weekIndex, dayIndex, date: formatIsoDate(date) })
    }
  })
  return occurrences.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

export const emptyGrid = (hourCount: number, dayCount: number): boolean[][] =>
  Array.from({ length: hourCount }, () => Array.from({ length: dayCount }, () => false))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest occurrences.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/occurrences.ts __tests__/unit/services/occurrences.test.ts
git commit -m "feat: add occurrence and grid math for recurring plans"
```

---

### Task 4: Plan-creation validation

**Files:**
- Modify: `src/utils/events.ts`
- Test: `__tests__/unit/utils/events.test.ts`

**Interfaces:**
- Consumes: `NewPlanInput` (Task 2)
- Produces: `parseNewPlanBody(event): NewPlanInput` — consumed by Task 6's `post-session.ts`

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/unit/utils/events.test.ts` (remove the old `parseNewSessionBody`/`parseLatLng`/`parseSubscribeBody`/`parseCloseRoundInput` describe blocks first):

```ts
import { ValidationError } from '@errors'
import { newPlanInput } from '../__mocks__'
import { parseNewPlanBody } from '@utils/events'
import { APIGatewayProxyEventV2 } from '@types'

const bodyEvent = (body: unknown): APIGatewayProxyEventV2 =>
  ({ body: JSON.stringify(body), isBase64Encoded: false }) as unknown as APIGatewayProxyEventV2

describe('parseNewPlanBody', () => {
  it('should return the parsed input on a valid body', () => {
    expect(parseNewPlanBody(bodyEvent(newPlanInput))).toEqual(newPlanInput)
  })

  it('should throw when name is empty', () => {
    expect(() => parseNewPlanBody(bodyEvent({ ...newPlanInput, name: '  ' }))).toThrow(ValidationError)
  })

  it('should throw when weekdays has a duplicate', () => {
    expect(() => parseNewPlanBody(bodyEvent({ ...newPlanInput, weekdays: [4, 4, 6] }))).toThrow(ValidationError)
  })

  it('should throw when weekdays has an out-of-range value', () => {
    expect(() => parseNewPlanBody(bodyEvent({ ...newPlanInput, weekdays: [4, 5, 7] }))).toThrow(ValidationError)
  })

  it('should throw when startDate does not fall on weekdays[0]', () => {
    // 2025-09-05 is a Friday, not a Thursday
    expect(() => parseNewPlanBody(bodyEvent({ ...newPlanInput, startDate: '2025-09-05' }))).toThrow(ValidationError)
  })

  it('should throw when startDate is not a real calendar date', () => {
    expect(() => parseNewPlanBody(bodyEvent({ ...newPlanInput, startDate: '2025-02-30' }))).toThrow(ValidationError)
  })

  it('should throw when weekCount exceeds the maximum', () => {
    expect(() => parseNewPlanBody(bodyEvent({ ...newPlanInput, weekCount: 13 }))).toThrow(ValidationError)
  })

  it('should throw when endHour is not after startHour', () => {
    expect(() => parseNewPlanBody(bodyEvent({ ...newPlanInput, startHour: 16, endHour: 16 }))).toThrow(
      ValidationError,
    )
  })

  it('should throw when timezone is not a valid IANA name', () => {
    expect(() => parseNewPlanBody(bodyEvent({ ...newPlanInput, timezone: 'Not/AZone' }))).toThrow(ValidationError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest events.test.ts -t "parseNewPlanBody"`
Expected: FAIL — `parseNewPlanBody is not a function`

- [ ] **Step 3: Implement `parseNewPlanBody` in `src/utils/events.ts`**

Remove `parseNewSessionBody`, `formatLatLng`, `parseLatLng`, `parseSubscribeBody`, `parseCloseRoundInput`, and the now-unused `radiusMaxMiles`/`radiusMinMiles`/`placeTypes` imports. Add:

```ts
import { NewPlanInput } from '../types'

const MAX_NAME_LENGTH = 100
const MAX_WEEK_COUNT = 12

const isValidTimezone = (timezone: string): boolean => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

const isValidIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export const parseNewPlanBody = (event: APIGatewayProxyEventV2): NewPlanInput => {
  const body = parseEventBody(event) as Record<string, unknown>

  if (typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`name is required and must be ${MAX_NAME_LENGTH} characters or fewer`)
  }

  if (
    !Array.isArray(body.weekdays) ||
    body.weekdays.length === 0 ||
    body.weekdays.length > 7 ||
    !body.weekdays.every((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6) ||
    new Set(body.weekdays as number[]).size !== body.weekdays.length
  ) {
    throw new ValidationError('weekdays must be a non-empty array of unique integers between 0 and 6')
  }
  const weekdays = body.weekdays as number[]

  if (typeof body.startDate !== 'string' || !isValidIsoDate(body.startDate)) {
    throw new ValidationError('startDate must be a valid ISO date string (YYYY-MM-DD)')
  }
  const [year, month, day] = body.startDate.split('-').map(Number)
  const startDow = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  if (weekdays[0] !== startDow) {
    throw new ValidationError('startDate must fall on the first day listed in weekdays')
  }

  if (
    typeof body.weekCount !== 'number' ||
    !Number.isInteger(body.weekCount) ||
    body.weekCount < 1 ||
    body.weekCount > MAX_WEEK_COUNT
  ) {
    throw new ValidationError(`weekCount must be an integer between 1 and ${MAX_WEEK_COUNT}`)
  }

  if (typeof body.startHour !== 'number' || !Number.isInteger(body.startHour) || body.startHour < 0 || body.startHour > 23) {
    throw new ValidationError('startHour must be an integer between 0 and 23')
  }

  if (
    typeof body.endHour !== 'number' ||
    !Number.isInteger(body.endHour) ||
    body.endHour <= body.startHour ||
    body.endHour > 24
  ) {
    throw new ValidationError('endHour must be an integer greater than startHour and at most 24')
  }

  if (typeof body.timezone !== 'string' || !isValidTimezone(body.timezone)) {
    throw new ValidationError('timezone must be a valid IANA time zone name')
  }

  return {
    name: body.name.trim(),
    weekdays,
    startDate: body.startDate,
    weekCount: body.weekCount,
    startHour: body.startHour,
    endHour: body.endHour,
    timezone: body.timezone,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest events.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/events.ts __tests__/unit/utils/events.test.ts
git commit -m "feat: add plan-creation validation, remove places/round validation"
```

---

### Task 5: DynamoDB layer for Plan + Availability

**Files:**
- Modify: `src/services/dynamodb.ts`
- Test: `__tests__/unit/services/dynamodb.test.ts`

**Interfaces:**
- Consumes: `PlanRecord`, `SessionWithUsers`, `AvailabilityRecord` (Task 2)
- Produces: `getSession(sessionId): Promise<SessionWithUsers>`, `putNewSession(sessionId, plan)`, `getAvailability(sessionId, userId): Promise<AvailabilityRecord>`, `createAvailability(sessionId, availability)`, `updateAvailability(sessionId, userId, availability)` — Tasks 6, 7, 9, 11, 12 all depend on these exact names.

- [ ] **Step 1: Write the failing tests**

Replace the `getSession`/`putSession`/`putNewSession`/`getChoices`/`putChoices`/`updateSession` describe blocks in `__tests__/unit/services/dynamodb.test.ts` with:

```ts
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { ConflictError, NotFoundError } from '@errors'
import { availabilityRecord, session, sessionId, userId } from '../__mocks__'
import {
  createAvailability,
  getAvailability,
  getSession,
  putNewSession,
  updateAvailability,
} from '@services/dynamodb'

describe('getSession', () => {
  it('should fetch SESSION record by composite key', async () => {
    mockSend.mockResolvedValueOnce({
      Item: { Data: { S: JSON.stringify(session) }, users: { L: [{ S: userId }] } },
    })
    const result = await getSession(sessionId)
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ Key: { PK: { S: sessionId }, SK: { S: 'SESSION' } }, TableName: 'choosee-table' }),
    )
    expect(result).toEqual({ session, users: [userId] })
  })

  it('should default users to empty array when attribute is missing', async () => {
    mockSend.mockResolvedValueOnce({ Item: { Data: { S: JSON.stringify(session) } } })
    const result = await getSession(sessionId)
    expect(result.users).toEqual([])
  })

  it('should throw NotFoundError when Item is missing', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined })
    await expect(getSession(sessionId)).rejects.toThrow(NotFoundError)
  })
})

describe('putNewSession', () => {
  it('should store SESSION record with attribute_not_exists condition', async () => {
    mockSend.mockResolvedValueOnce({})
    await putNewSession(sessionId, session)
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        ConditionExpression: 'attribute_not_exists(PK)',
        Item: {
          Data: { S: JSON.stringify(session) },
          expiration: { N: `${session.expiration}` },
          PK: { S: sessionId },
          SK: { S: 'SESSION' },
        },
      }),
    )
  })

  it('should throw ConflictError on ID collision', async () => {
    mockSend.mockRejectedValueOnce(new ConditionalCheckFailedException({ message: 'fail', $metadata: {} }))
    await expect(putNewSession(sessionId, session)).rejects.toThrow(ConflictError)
  })
})

describe('getAvailability', () => {
  it('should fetch AVAIL#<userId> record', async () => {
    mockSend.mockResolvedValueOnce({ Item: { Data: { S: JSON.stringify(availabilityRecord) } } })
    const result = await getAvailability(sessionId, userId)
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ Key: { PK: { S: sessionId }, SK: { S: `AVAIL#${userId}` } } }),
    )
    expect(result).toEqual(availabilityRecord)
  })

  it('should throw NotFoundError when Item is missing', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined })
    await expect(getAvailability(sessionId, userId)).rejects.toThrow(NotFoundError)
  })
})

describe('createAvailability', () => {
  it('should store AVAIL#<userId> record with attribute_not_exists condition', async () => {
    mockSend.mockResolvedValueOnce({})
    await createAvailability(sessionId, availabilityRecord)
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        ConditionExpression: 'attribute_not_exists(PK)',
        Item: {
          Data: { S: JSON.stringify(availabilityRecord) },
          expiration: { N: `${availabilityRecord.expiration}` },
          PK: { S: sessionId },
          SK: { S: `AVAIL#${userId}` },
        },
      }),
    )
  })

  it('should throw ConflictError when availability already exists', async () => {
    mockSend.mockRejectedValueOnce(new ConditionalCheckFailedException({ message: 'fail', $metadata: {} }))
    await expect(createAvailability(sessionId, availabilityRecord)).rejects.toThrow(ConflictError)
  })
})

describe('updateAvailability', () => {
  it('should overwrite the Data attribute', async () => {
    mockSend.mockResolvedValueOnce({})
    await updateAvailability(sessionId, userId, availabilityRecord)
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        Key: { PK: { S: sessionId }, SK: { S: `AVAIL#${userId}` } },
        UpdateExpression: 'SET #data = :data',
        ExpressionAttributeValues: { ':data': { S: JSON.stringify(availabilityRecord) } },
      }),
    )
  })
})
```

Keep the existing `createUser`/`getUser`/`getAllUsers`/`updateUser`/`incrementTextsSent` describe blocks and the `jest.mock('@aws-sdk/client-dynamodb', ...)` block at the top as-is — just drop `getChoices`/`putChoices`/`updateSession`/`putSession`/`querySession` from the imports if those blocks are removed in Step 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest dynamodb.test.ts`
Expected: FAIL — `createAvailability`, `getAvailability`, `updateAvailability` are not exported; `getSession`/`putNewSession` still reference the old shape

- [ ] **Step 3: Implement in `src/services/dynamodb.ts`**

Replace the `/* Session */` and `/* Choices */` sections with:

```ts
import { AvailabilityRecord, PlanRecord, SessionWithUsers } from '../types'

/* Session (Plan) */

export const getSession = async (sessionId: string): Promise<SessionWithUsers> => {
  const command = new GetItemCommand({
    Key: { PK: { S: sessionId }, SK: { S: 'SESSION' } },
    TableName: dynamodbTableName,
  })
  const response = await dynamodb.send(command)
  if (!response.Item?.Data?.S) {
    throw new NotFoundError('Session not found')
  }
  const session: PlanRecord = JSON.parse(response.Item.Data.S)
  const users = response.Item.users?.L?.map((item: { S: string }) => item.S) ?? []
  return { session, users }
}

export const putNewSession = async (sessionId: string, session: PlanRecord): Promise<void> => {
  const command = new PutItemCommand({
    ConditionExpression: 'attribute_not_exists(PK)',
    Item: {
      Data: { S: JSON.stringify(session) },
      expiration: { N: `${session.expiration}` },
      PK: { S: sessionId },
      SK: { S: 'SESSION' },
    },
    TableName: dynamodbTableName,
  })
  try {
    await dynamodb.send(command)
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      throw new ConflictError('Session ID already exists')
    }
    throw error
  }
}

/* Availability */

export const getAvailability = async (sessionId: string, userId: string): Promise<AvailabilityRecord> => {
  const command = new GetItemCommand({
    Key: { PK: { S: sessionId }, SK: { S: `AVAIL#${userId}` } },
    TableName: dynamodbTableName,
  })
  const response = await dynamodb.send(command)
  if (!response.Item?.Data?.S) {
    throw new NotFoundError('Availability not found')
  }
  return JSON.parse(response.Item.Data.S)
}

export const createAvailability = async (sessionId: string, availability: AvailabilityRecord): Promise<void> => {
  const command = new PutItemCommand({
    ConditionExpression: 'attribute_not_exists(PK)',
    Item: {
      Data: { S: JSON.stringify(availability) },
      expiration: { N: `${availability.expiration}` },
      PK: { S: sessionId },
      SK: { S: `AVAIL#${availability.userId}` },
    },
    TableName: dynamodbTableName,
  })
  try {
    await dynamodb.send(command)
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      throw new ConflictError('Availability already exists for this user')
    }
    throw error
  }
}

export const updateAvailability = async (
  sessionId: string,
  userId: string,
  availability: AvailabilityRecord,
): Promise<void> => {
  const command = new UpdateItemCommand({
    ExpressionAttributeNames: { '#data': 'Data' },
    ExpressionAttributeValues: { ':data': { S: JSON.stringify(availability) } },
    Key: { PK: { S: sessionId }, SK: { S: `AVAIL#${userId}` } },
    TableName: dynamodbTableName,
    UpdateExpression: 'SET #data = :data',
  })
  await dynamodb.send(command)
}
```

Delete `updateSession`, `getChoices`, `putChoices`, `putSession`, and `querySession` — nothing in this plan calls them. Keep `getUser`, `getAllUsers`, `createUser`, `updateUser`, `incrementTextsSent` untouched (they still typecheck once `UserRecord` drops `votes`/`subscribedRounds` from Task 2).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest dynamodb.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/dynamodb.ts __tests__/unit/services/dynamodb.test.ts
git commit -m "feat: add Availability CRUD, retype Session CRUD for PlanRecord"
```

---

### Task 6: `POST /sessions` — create a plan

**Files:**
- Modify: `src/handlers/post-session.ts`, `src/config.ts`, `jest.setup-test-env.js`
- Test: `__tests__/unit/handlers/post-session.test.ts`

**Interfaces:**
- Consumes: `parseNewPlanBody` (Task 4), `putNewSession` (Task 5), `generateSessionId` (unchanged, `utils/id-generator.ts`)
- Produces: `postSession(event, nowMs?)`, `handler` — HTTP contract: `201 { sessionId }` on success

- [ ] **Step 1: Add `maxPlanWeeks` to config**

`src/config.ts`:
```ts
export const maxPlanWeeks = parseInt(process.env.MAX_PLAN_WEEKS as string, 10)
```
`jest.setup-test-env.js`:
```js
process.env.MAX_PLAN_WEEKS = '12'
```
(This constant isn't consumed yet in this task — `MAX_WEEK_COUNT` in Task 4 is currently a local literal. Leave it there for now; wiring it from config is a one-line change, not worth blocking this task on. Note it as a follow-up.)

- [ ] **Step 2: Write the failing tests**

Rewrite `__tests__/unit/handlers/post-session.test.ts`:

```ts
import { ConflictError, ValidationError } from '@errors'
import { newPlanInput, sessionId } from '../__mocks__'
import eventJson from '@events/post-session.json'
import { postSession } from '@handlers/post-session'
import * as dynamodb from '@services/dynamodb'
import * as recaptcha from '@services/recaptcha'
import { APIGatewayProxyEventV2 } from '@types'
import * as idGenerator from '@utils/id-generator'
import * as events from '@utils/events'
import status from '@utils/status'

jest.mock('@services/dynamodb')
jest.mock('@services/recaptcha')
jest.mock('@utils/id-generator')
jest.mock('@utils/events', () => ({
  ...jest.requireActual('@utils/events'),
  parseNewPlanBody: jest.fn(),
}))
jest.mock('@utils/logging', () => ({ log: jest.fn(), logError: jest.fn(), xrayCapture: jest.fn((x: unknown) => x) }))

describe('post-session', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const nowMs = 1_700_000_000_000

  beforeAll(() => {
    jest.mocked(events).parseNewPlanBody.mockReturnValue(newPlanInput)
    jest.mocked(recaptcha).getCaptchaScore.mockResolvedValue(0.9)
    jest.mocked(idGenerator).generateSessionId.mockReturnValue(sessionId)
    jest.mocked(dynamodb).putNewSession.mockResolvedValue(undefined)
  })

  describe('postSession', () => {
    it('should return CREATED with the new sessionId', async () => {
      const result = await postSession(event, () => nowMs)
      expect(result).toEqual(expect.objectContaining(status.CREATED))
      expect(JSON.parse((result as { body: string }).body)).toEqual({ sessionId })
    })

    it('should compute expiration from weekCount and nowMs', async () => {
      await postSession(event, () => nowMs)
      const expectedExpiration = Math.floor(nowMs / 1000) + 24 * 3600
      expect(dynamodb.putNewSession).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({ expiration: expectedExpiration }),
      )
    })

    it('should retry with a new sessionId on collision', async () => {
      jest.mocked(dynamodb).putNewSession.mockRejectedValueOnce(new ConflictError('Session ID already exists'))
      jest.mocked(idGenerator).generateSessionId.mockReturnValueOnce('taken-id').mockReturnValueOnce(sessionId)
      const result = await postSession(event, () => nowMs)
      expect(JSON.parse((result as { body: string }).body)).toEqual({ sessionId })
    })

    it('should return FORBIDDEN when reCAPTCHA score is too low', async () => {
      jest.mocked(recaptcha).getCaptchaScore.mockResolvedValueOnce(0.1)
      const result = await postSession(event, () => nowMs)
      expect(result).toEqual(expect.objectContaining(status.FORBIDDEN))
    })

    it('should return BAD_REQUEST when validation fails', async () => {
      jest.mocked(events).parseNewPlanBody.mockImplementationOnce(() => {
        throw new ValidationError('name is required')
      })
      const result = await postSession(event, () => nowMs)
      expect(result).toEqual(expect.objectContaining({ statusCode: status.BAD_REQUEST.statusCode }))
    })
  })
})
```

(Uses whatever `events/post-session.json` fixture already exists — the body content doesn't matter here since `parseNewPlanBody` is mocked directly, but the event still needs an `x-recaptcha-token` header for `extractRecaptchaToken` to succeed; check the existing fixture has one, since `post-session.json` already served this purpose for the old handler.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest post-session.test.ts`
Expected: FAIL — old handler still references `NewSessionInput`/`radiusMiles`/async Lambda invoke

- [ ] **Step 4: Rewrite `src/handlers/post-session.ts`**

```ts
import { sessionExpireHours } from '../config'
import { ConflictError, ForbiddenError, ValidationError } from '../errors'
import { putNewSession } from '../services/dynamodb'
import { getCaptchaScore } from '../services/recaptcha'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, NewPlanInput, PlanRecord } from '../types'
import { extractRecaptchaToken, parseNewPlanBody } from '../utils/events'
import { generateSessionId } from '../utils/id-generator'
import { log, logError } from '../utils/logging'
import status from '../utils/status'

const MAX_ID_RETRIES = 5

const buildPlan = (sessionId: string, input: NewPlanInput, expiration: number): PlanRecord => ({
  endHour: input.endHour,
  expiration,
  name: input.name,
  sessionId,
  startDate: input.startDate,
  startHour: input.startHour,
  timezone: input.timezone,
  weekCount: input.weekCount,
  weekdays: input.weekdays,
})

const createSessionWithUniqueId = async (input: NewPlanInput, expiration: number): Promise<string> => {
  for (let attempt = 0; attempt < MAX_ID_RETRIES; attempt++) {
    const sessionId = generateSessionId()
    const session = buildPlan(sessionId, input, expiration)
    try {
      await putNewSession(sessionId, session)
      return sessionId
    } catch (error) {
      if (error instanceof ConflictError && attempt < MAX_ID_RETRIES - 1) {
        log('Session ID collision, retrying', { sessionId, attempt })
        continue
      }
      throw error
    }
  }
  throw new Error('Failed to create session after maximum retries')
}

export const postSession = async (
  event: APIGatewayProxyEventV2,
  nowMs = Date.now,
): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const recaptchaToken = extractRecaptchaToken(event)
    const input = parseNewPlanBody(event)

    const score = await getCaptchaScore(recaptchaToken)
    log('reCAPTCHA result', { score })
    if (score < 0.7) {
      throw new ForbiddenError('reCAPTCHA score too low')
    }

    const expiration = Math.floor(nowMs() / 1000) + sessionExpireHours * 3600
    const sessionId = await createSessionWithUniqueId(input, expiration)
    log('Session created', { sessionId })

    return { ...status.CREATED, body: JSON.stringify({ sessionId }) }
  } catch (error) {
    if (error instanceof ForbiddenError) return status.FORBIDDEN
    if (error instanceof ValidationError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => postSession(event)
```

Note the `nowMs` parameter changed from a `number` default to a `() => number` default (`Date.now`, not `Date.now()`) to match this repo's injectable-nondeterminism convention precisely — the test above passes `() => nowMs`, matching that shape.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest post-session.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/handlers/post-session.ts src/config.ts jest.setup-test-env.js __tests__/unit/handlers/post-session.test.ts
git commit -m "feat: rewrite POST /sessions to create a recurring plan synchronously"
```

---

### Task 7: `POST /sessions/{sessionId}/users` — join a plan

**Files:**
- Modify: `src/handlers/post-user.ts`
- Test: `__tests__/unit/handlers/post-user.test.ts`

**Interfaces:**
- Consumes: `getSession`, `createUser`, `createAvailability` (Task 5), `emptyGrid` (Task 3), `generateUserId` (unchanged)
- Produces: `handler` — HTTP contract: `201 UserRecord` (minus `googleSub`) on success; also creates an empty `AvailabilityRecord` as a side effect

- [ ] **Step 1: Write the failing tests**

Rewrite `__tests__/unit/handlers/post-user.test.ts`, replacing the `votes`/`subscribedRounds` assertions:

```ts
import { ConflictError, NotFoundError } from '@errors'
import { session, sessionId } from '../__mocks__'
import eventJson from '@events/post-user.json'
import { handler } from '@handlers/post-user'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'
import * as idGenerator from '@utils/id-generator'

jest.mock('@services/dynamodb')
jest.mock('@utils/id-generator')
jest.mock('@utils/logging', () => ({ log: jest.fn(), logError: jest.fn(), xrayCapture: jest.fn((x: unknown) => x) }))

describe('post-user', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const futureExpiration = 9999999999
  const futureSession = { ...session, expiration: futureExpiration }

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [] })
    jest.mocked(dynamodb).createUser.mockResolvedValue(undefined)
    jest.mocked(dynamodb).createAvailability.mockResolvedValue(undefined)
    jest.mocked(idGenerator).generateUserId.mockReturnValue('brave-tiger')
  })

  describe('handler', () => {
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

    it('should create an empty availability grid sized from the plan hours and weekdays', async () => {
      await handler(event)
      expect(dynamodb.createAvailability).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          userId: 'brave-tiger',
          overrides: {},
          template: [
            [false, false, false],
            [false, false, false],
            [false, false, false],
            [false, false, false],
          ],
        }),
      )
    })

    it('should set name from Google auth context when authenticated', async () => {
      const authedEvent = {
        ...event,
        requestContext: { ...event.requestContext, authorizer: { jwt: { claims: { name: 'Google User' } } } },
      } as unknown as APIGatewayProxyEventV2
      const result = await handler(authedEvent)
      expect(JSON.parse((result as { body: string }).body).name).toBe('Google User')
    })

    it('should return NOT_FOUND when session does not exist', async () => {
      jest.mocked(dynamodb).getSession.mockRejectedValueOnce(new NotFoundError('Session not found'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
    })

    it('should return BAD_REQUEST when session has max users', async () => {
      const fullUsers = Array.from({ length: 10 }, (_, i) => `user-${i}`)
      jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: futureSession, users: fullUsers })
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
    })

    it('should return INTERNAL_SERVER_ERROR when createAvailability rejects', async () => {
      jest.mocked(dynamodb).createAvailability.mockRejectedValueOnce(new ConflictError('exists'))
      const result = await handler(event)
      expect(result).toEqual(expect.objectContaining({ statusCode: 500 }))
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest post-user.test.ts`
Expected: FAIL — handler still builds `votes`, `dynamodb.createAvailability` doesn't exist as a mock target yet

- [ ] **Step 3: Rewrite `src/handlers/post-user.ts`**

```ts
import { maxUsersPerSession } from '../config'
import { MaxUsersError, NotFoundError } from '../errors'
import { createAvailability, createUser, getSession } from '../services/dynamodb'
import { emptyGrid } from '../services/occurrences'
import { AvailabilityRecord, APIGatewayProxyEventV2, APIGatewayProxyResultV2, UserRecord } from '../types'
import { extractAuthContext } from '../utils/auth'
import { generateUserId } from '../utils/id-generator'
import { log, logError } from '../utils/logging'
import status from '../utils/status'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const { session, users } = await getSession(sessionId)

    if (session.expiration < Math.floor(Date.now() / 1000)) {
      throw new NotFoundError('Session not found')
    }

    if (users.length >= maxUsersPerSession) {
      throw new MaxUsersError(`Session has reached the maximum of ${maxUsersPerSession} users`)
    }

    const userId = generateUserId(users)
    const auth = extractAuthContext(event)
    const phone = auth.googlePhone && /^\+1[2-9]\d{9}$/.test(auth.googlePhone) ? auth.googlePhone : null

    const user: UserRecord = {
      expiration: session.expiration,
      googleSub: auth.googleSub,
      name: auth.googleName ?? null,
      phone,
      textsSent: 0,
      userId,
    }

    const availability: AvailabilityRecord = {
      expiration: session.expiration,
      overrides: {},
      template: emptyGrid(session.endHour - session.startHour, session.weekdays.length),
      userId,
    }

    await createUser(sessionId, user)
    await createAvailability(sessionId, availability)
    log('User created', { sessionId, userId })

    const { googleSub: _, ...responseUser } = user
    return { ...status.CREATED, body: JSON.stringify(responseUser) }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    if (error instanceof MaxUsersError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest post-user.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/handlers/post-user.ts __tests__/unit/handlers/post-user.test.ts
git commit -m "feat: join a plan creates user and empty availability grid"
```

---

### Task 8: `PATCH /sessions/{sessionId}/users/{userId}` — rename / set phone

**Files:**
- Modify: `src/handlers/patch-user.ts`, `src/utils/events.ts`, `src/types.ts`, `package.json`
- Test: `__tests__/unit/handlers/patch-user.test.ts`, `__tests__/unit/utils/events.test.ts`

**Interfaces:**
- Consumes: `getUser`, `updateUser` (unchanged in Task 5)
- Produces: `handler` — HTTP contract: `200 UserRecord` (minus `googleSub`)

Votes are gone, so this handler no longer needs generic JSON-Patch semantics — only two fields are ever writable. Hand-roll it and drop the `fast-json-patch` runtime dependency (keep only a small local `PatchOperation` type for the wire shape).

- [ ] **Step 1: Replace the `PatchOperation` re-export in `src/types.ts`**

```ts
// was: export { Operation as PatchOperation } from 'fast-json-patch'
export interface PatchOperation {
  op: 'replace' | 'add' | 'test'
  path: string
  value?: unknown
}
```

- [ ] **Step 2: Write the failing tests**

Simplify `parseUserPatch`'s tests in `__tests__/unit/utils/events.test.ts` to only cover `/name` and `/phone` (remove the `/votes/...` cases), and rewrite `__tests__/unit/handlers/patch-user.test.ts`:

```ts
import { NotFoundError } from '@errors'
import { userId, sessionId, userRecord } from '../__mocks__'
import eventJson from '@events/patch-user.json'
import { handler } from '@handlers/patch-user'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging', () => ({ log: jest.fn(), logError: jest.fn(), xrayCapture: jest.fn((x: unknown) => x) }))

describe('patch-user', () => {
  const event = { ...(eventJson as unknown as APIGatewayProxyEventV2), body: JSON.stringify([{ op: 'replace', path: '/name', value: 'Bright Heron' }]) }

  beforeAll(() => {
    jest.mocked(dynamodb).getUser.mockResolvedValue(userRecord)
    jest.mocked(dynamodb).updateUser.mockResolvedValue(undefined)
  })

  it('should apply a /name patch and return the updated user', async () => {
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
    expect(JSON.parse((result as { body: string }).body).name).toBe('Bright Heron')
  })

  it('should apply a /phone patch', async () => {
    const phoneEvent = { ...event, body: JSON.stringify([{ op: 'replace', path: '/phone', value: '+15551234567' }]) }
    const result = await handler(phoneEvent)
    expect(JSON.parse((result as { body: string }).body).phone).toBe('+15551234567')
  })

  it('should reject a disallowed path', async () => {
    const badEvent = { ...event, body: JSON.stringify([{ op: 'replace', path: '/googleSub', value: 'x' }]) }
    const result = await handler(badEvent)
    expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
  })

  it('should return NOT_FOUND when user does not exist', async () => {
    jest.mocked(dynamodb).getUser.mockRejectedValueOnce(new NotFoundError('User not found'))
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
  })

  it('should fill in googleSub from auth context when unset', async () => {
    const authedEvent = {
      ...event,
      requestContext: { ...event.requestContext, authorizer: { jwt: { claims: { sub: 'google-123' } } } },
    } as unknown as APIGatewayProxyEventV2
    await handler(authedEvent)
    expect(dynamodb.updateUser).toHaveBeenCalledWith(sessionId, userId, expect.objectContaining({ googleSub: 'google-123' }))
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest patch-user.test.ts`
Expected: FAIL — handler still imports `advanceRound`/`countVotersSubmitted` from the deleted `brackets.ts`

- [ ] **Step 4: Simplify `parseUserPatch` in `src/utils/events.ts`**

```ts
const ALLOWED_PATCH_PATHS = ['/name', '/phone']

export const parseUserPatch = (event: APIGatewayProxyEventV2): PatchOperation[] => {
  const ops = parseEventBody(event) as PatchOperation[]

  if (!Array.isArray(ops)) {
    throw new ValidationError('request body must be an array of patch operations')
  }

  for (const op of ops) {
    if (!ALLOWED_PATCH_OPS.includes(op.op)) {
      throw new ValidationError(`disallowed patch op: ${op.op}`)
    }
    if (!ALLOWED_PATCH_PATHS.includes(op.path)) {
      throw new ValidationError(`disallowed patch path: ${op.path}`)
    }
    if (op.path === '/name' && 'value' in op) {
      const name = op.value as string
      if (typeof name === 'string' && name.length > 50) {
        throw new ValidationError('name must be 50 characters or fewer')
      }
    }
    if (op.path === '/phone' && 'value' in op) {
      const phone = op.value as string
      if (typeof phone === 'string' && !PHONE_REGEX.test(phone)) {
        throw new ValidationError('phone must match format +1XXXXXXXXXX')
      }
    }
  }

  return ops
}
```

- [ ] **Step 5: Rewrite `src/handlers/patch-user.ts`**

```ts
import { NotFoundError, ValidationError } from '../errors'
import { getUser, updateUser } from '../services/dynamodb'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, PatchOperation, UserRecord } from '../types'
import { extractAuthContext } from '../utils/auth'
import { parseUserPatch } from '../utils/events'
import { log, logError } from '../utils/logging'
import status from '../utils/status'

const applyUserPatch = (user: UserRecord, ops: PatchOperation[]): UserRecord => {
  const updated = { ...user }
  for (const op of ops) {
    if (op.path === '/name') updated.name = op.value as string
    if (op.path === '/phone') updated.phone = op.value as string
  }
  return updated
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const userId = event.pathParameters?.userId as string

    const ops = parseUserPatch(event)
    const user = await getUser(sessionId, userId)
    const updatedUser = applyUserPatch(user, ops)

    const auth = extractAuthContext(event)
    if (updatedUser.googleSub === null && auth.googleSub) {
      updatedUser.googleSub = auth.googleSub
    }

    await updateUser(sessionId, userId, updatedUser)

    const { googleSub: _, ...responseUser } = updatedUser
    return { ...status.OK, body: JSON.stringify(responseUser) }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    if (error instanceof ValidationError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
```

- [ ] **Step 6: Remove the `fast-json-patch` dependency**

```bash
npm uninstall fast-json-patch
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx jest patch-user.test.ts events.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: simplify PATCH user to name/phone only, drop fast-json-patch"
```

---

### Task 9: `GET /sessions/{sessionId}` — plan details

**Files:**
- Modify: `src/handlers/get-session-by-id.ts`
- Test: `__tests__/unit/handlers/get-session-by-id.test.ts`

**Interfaces:**
- Consumes: `getSession` (Task 5)
- Produces: `handler` — HTTP contract: `200 { ...PlanRecord, participantCount }`

- [ ] **Step 1: Write the failing test**

```ts
import { NotFoundError } from '@errors'
import { session, sessionId, userId } from '../__mocks__'
import eventJson from '@events/get-session-by-id.json'
import { handler } from '@handlers/get-session-by-id'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging', () => ({ log: jest.fn(), logError: jest.fn(), xrayCapture: jest.fn((x: unknown) => x) }))

describe('get-session-by-id', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const futureSession = { ...session, expiration: 9999999999 }

  it('should return the plan with participantCount', async () => {
    jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: futureSession, users: [userId, 'other-user'] })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
    expect(JSON.parse((result as { body: string }).body)).toEqual({ ...futureSession, participantCount: 2 })
  })

  it('should return NOT_FOUND when session is expired', async () => {
    jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: { ...session, expiration: 1 }, users: [] })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
  })

  it('should return NOT_FOUND when session does not exist', async () => {
    jest.mocked(dynamodb).getSession.mockRejectedValueOnce(new NotFoundError('Session not found'))
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest get-session-by-id.test.ts`
Expected: FAIL — response still includes `filterClosingSoon`/`voterCount`

- [ ] **Step 3: Update `src/handlers/get-session-by-id.ts`**

```ts
import { NotFoundError } from '../errors'
import { getSession } from '../services/dynamodb'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { log, logError } from '../utils/logging'
import status from '../utils/status'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const { session, users } = await getSession(sessionId)

    if (session.expiration < Math.floor(Date.now() / 1000)) {
      return status.NOT_FOUND
    }

    return { ...status.OK, body: JSON.stringify({ ...session, participantCount: users.length }) }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest get-session-by-id.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/handlers/get-session-by-id.ts __tests__/unit/handlers/get-session-by-id.test.ts
git commit -m "feat: adapt GET /sessions/{sessionId} to plan shape"
```

---

### Task 10: `GET /sessions/{sessionId}/users` — list users

**Files:**
- Modify: `__tests__/unit/handlers/get-users.test.ts` only — `src/handlers/get-users.ts` needs no logic change, just confirmation it still compiles and behaves against the slimmed `UserRecord`.

**Interfaces:**
- Consumes: `getSession`, `getAllUsers` (unchanged)
- Produces: `handler` (unchanged contract, just a smaller `UserRecord` shape in the response)

- [ ] **Step 1: Update the test's expectations**

In `__tests__/unit/handlers/get-users.test.ts`, update any assertion on the returned user shape to confirm `votes`/`subscribedRounds` are gone:

```ts
it('should return users without votes or subscribedRounds fields', async () => {
  jest.mocked(dynamodb).getAllUsers.mockResolvedValueOnce([userRecord])
  const result = await handler(event)
  const body = JSON.parse((result as { body: string }).body)
  expect(body[0]).toEqual(userRecord)
  expect(body[0].votes).toBeUndefined()
  expect(body[0].subscribedRounds).toBeUndefined()
})
```

- [ ] **Step 2: Run the full test file**

Run: `npx jest get-users.test.ts`
Expected: PASS — `src/handlers/get-users.ts` needs no changes; it was already domain-agnostic (`JSON.stringify(users)` of whatever `UserRecord` currently contains).

- [ ] **Step 3: Commit**

```bash
git add __tests__/unit/handlers/get-users.test.ts
git commit -m "test: confirm GET /sessions/{sessionId}/users reflects slimmed UserRecord"
```

---

### Task 11: Availability endpoints

**Files:**
- Modify: `src/utils/events.ts`
- Create: `src/handlers/get-availability.ts`, `src/handlers/patch-availability.ts`
- Test: `__tests__/unit/utils/events.test.ts`, `__tests__/unit/handlers/get-availability.test.ts`, `__tests__/unit/handlers/patch-availability.test.ts`
- Create: `events/get-availability.json`, `events/patch-availability.json` (copy the shape of `events/get-users.json`/`events/patch-user.json`, changing `pathParameters` to include both `sessionId` and `userId` and, for the PATCH fixture, a JSON body matching `AvailabilityPatchInput` below)

**Interfaces:**
- Consumes: `getAvailability`, `updateAvailability`, `getSession` (Task 5)
- Produces: `parseAvailabilityPatch(event): AvailabilityPatchInput`, two handlers

This deliberately does **not** reuse RFC 6902 JSON Patch (unlike `patch-user.ts`). The wire shape here is a batch of cell toggles from one paint gesture, plus an optional "reset this week to the pattern" flag — a purpose-built request body is a better fit than forcing a sparse 3D structure through generic patch semantics, and is simpler to validate and apply correctly.

```ts
// AvailabilityPatchInput shape (add to src/types.ts alongside NewPlanInput)
export interface AvailabilityCell {
  hourIndex: number
  dayIndex: number
  value: boolean
}

export interface AvailabilityPatchInput {
  weekIndex: number | null // null = editing the template; 0-based otherwise
  cells: AvailabilityCell[]
  resetToPattern: boolean
}
```

- [ ] **Step 1: Write the failing validation tests**

Add to `__tests__/unit/utils/events.test.ts`:

```ts
import { parseAvailabilityPatch } from '@utils/events'

describe('parseAvailabilityPatch', () => {
  const validBody = { weekIndex: null, cells: [{ hourIndex: 1, dayIndex: 0, value: true }], resetToPattern: false }

  it('should return the parsed input on a valid body', () => {
    expect(parseAvailabilityPatch(bodyEvent(validBody))).toEqual(validBody)
  })

  it('should default resetToPattern to false when omitted', () => {
    const { resetToPattern, ...withoutFlag } = validBody
    expect(parseAvailabilityPatch(bodyEvent(withoutFlag)).resetToPattern).toBe(false)
  })

  it('should throw when resetToPattern is true but weekIndex is null', () => {
    expect(() => parseAvailabilityPatch(bodyEvent({ weekIndex: null, cells: [], resetToPattern: true }))).toThrow(
      ValidationError,
    )
  })

  it('should allow resetToPattern alone with no cells', () => {
    const body = { weekIndex: 2, cells: [], resetToPattern: true }
    expect(parseAvailabilityPatch(bodyEvent(body))).toEqual(body)
  })

  it('should throw when cells is empty and resetToPattern is false', () => {
    expect(() => parseAvailabilityPatch(bodyEvent({ weekIndex: null, cells: [], resetToPattern: false }))).toThrow(
      ValidationError,
    )
  })

  it('should throw when a cell has a negative hourIndex', () => {
    const body = { weekIndex: null, cells: [{ hourIndex: -1, dayIndex: 0, value: true }], resetToPattern: false }
    expect(() => parseAvailabilityPatch(bodyEvent(body))).toThrow(ValidationError)
  })

  it('should throw when weekIndex is negative', () => {
    expect(() =>
      parseAvailabilityPatch(bodyEvent({ weekIndex: -1, cells: [], resetToPattern: true })),
    ).toThrow(ValidationError)
  })
})
```

(`bodyEvent` is the helper already added in Task 4.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest events.test.ts -t "parseAvailabilityPatch"`
Expected: FAIL — not exported

- [ ] **Step 3: Implement `parseAvailabilityPatch` in `src/utils/events.ts`**

```ts
import { AvailabilityCell, AvailabilityPatchInput } from '../types'

export const parseAvailabilityPatch = (event: APIGatewayProxyEventV2): AvailabilityPatchInput => {
  const body = parseEventBody(event) as Record<string, unknown>

  const weekIndex = body.weekIndex === undefined ? null : body.weekIndex
  if (weekIndex !== null && (typeof weekIndex !== 'number' || !Number.isInteger(weekIndex) || weekIndex < 0)) {
    throw new ValidationError('weekIndex must be a non-negative integer or null')
  }

  const resetToPattern = body.resetToPattern === true
  if (resetToPattern && weekIndex === null) {
    throw new ValidationError('resetToPattern requires a non-null weekIndex')
  }

  if (body.cells !== undefined && !Array.isArray(body.cells)) {
    throw new ValidationError('cells must be an array')
  }
  const rawCells = (body.cells ?? []) as unknown[]
  const cells: AvailabilityCell[] = rawCells.map((cell) => {
    const c = cell as Record<string, unknown>
    if (
      typeof c.hourIndex !== 'number' ||
      !Number.isInteger(c.hourIndex) ||
      c.hourIndex < 0 ||
      typeof c.dayIndex !== 'number' ||
      !Number.isInteger(c.dayIndex) ||
      c.dayIndex < 0 ||
      typeof c.value !== 'boolean'
    ) {
      throw new ValidationError('each cell must have a non-negative integer hourIndex/dayIndex and boolean value')
    }
    return { hourIndex: c.hourIndex, dayIndex: c.dayIndex, value: c.value }
  })

  if (cells.length === 0 && !resetToPattern) {
    throw new ValidationError('cells must be non-empty unless resetToPattern is true')
  }

  return { weekIndex, cells, resetToPattern }
}
```

Add `AvailabilityCell`/`AvailabilityPatchInput` to `src/types.ts` as shown above the steps for this task.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest events.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing handler tests**

```ts
// __tests__/unit/handlers/get-availability.test.ts
import { NotFoundError } from '@errors'
import { availabilityRecord, session, sessionId, userId } from '../__mocks__'
import eventJson from '@events/get-availability.json'
import { handler } from '@handlers/get-availability'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging', () => ({ log: jest.fn(), logError: jest.fn(), xrayCapture: jest.fn((x: unknown) => x) }))

describe('get-availability', () => {
  const event = eventJson as unknown as APIGatewayProxyEventV2
  const futureSession = { ...session, expiration: 9999999999 }

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [userId] })
    jest.mocked(dynamodb).getAvailability.mockResolvedValue(availabilityRecord)
  })

  it('should return the availability record', async () => {
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
    expect(JSON.parse((result as { body: string }).body)).toEqual(availabilityRecord)
  })

  it('should return NOT_FOUND when the session is expired', async () => {
    jest.mocked(dynamodb).getSession.mockResolvedValueOnce({ session: { ...session, expiration: 1 }, users: [] })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
  })

  it('should return NOT_FOUND when availability does not exist', async () => {
    jest.mocked(dynamodb).getAvailability.mockRejectedValueOnce(new NotFoundError('Availability not found'))
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
  })
})
```

```ts
// __tests__/unit/handlers/patch-availability.test.ts
import { NotFoundError } from '@errors'
import { availabilityRecord, session, sessionId, userId } from '../__mocks__'
import eventJson from '@events/patch-availability.json'
import { handler } from '@handlers/patch-availability'
import * as dynamodb from '@services/dynamodb'
import { APIGatewayProxyEventV2 } from '@types'

jest.mock('@services/dynamodb')
jest.mock('@utils/logging', () => ({ log: jest.fn(), logError: jest.fn(), xrayCapture: jest.fn((x: unknown) => x) }))

// Deep-cloning helper so each test gets its own grid — the handler mutates
// `availability.template`/`.overrides` in place, and reusing the same nested
// arrays across tests via a shallow `{ ...availabilityRecord }` would leak
// mutations from one test into the next.
const cloneGrid = (grid: boolean[][]): boolean[][] => grid.map((row) => row.slice())

describe('patch-availability', () => {
  const baseEvent = eventJson as unknown as APIGatewayProxyEventV2
  const futureSession = { ...session, expiration: 9999999999 } // endHour-startHour=4, weekdays.length=3

  const withBody = (body: unknown): APIGatewayProxyEventV2 => ({ ...baseEvent, body: JSON.stringify(body) }) as unknown as APIGatewayProxyEventV2

  beforeAll(() => {
    jest.mocked(dynamodb).getSession.mockResolvedValue({ session: futureSession, users: [userId] })
    jest.mocked(dynamodb).getAvailability.mockImplementation(async () => ({
      userId,
      expiration: availabilityRecord.expiration,
      overrides: {},
      template: cloneGrid(availabilityRecord.template),
    }))
    jest.mocked(dynamodb).updateAvailability.mockResolvedValue(undefined)
  })

  it('should write a cell into the template when weekIndex is null', async () => {
    const event = withBody({ weekIndex: null, cells: [{ hourIndex: 0, dayIndex: 0, value: true }], resetToPattern: false })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 200 }))
    expect(dynamodb.updateAvailability).toHaveBeenCalledWith(
      sessionId,
      userId,
      expect.objectContaining({
        template: [
          [true, false, false],
          [true, true, false],
          [true, true, true],
          [false, false, false],
        ],
      }),
    )
  })

  it('should clone the template into a new override on first write to a week', async () => {
    const event = withBody({ weekIndex: 2, cells: [{ hourIndex: 0, dayIndex: 0, value: true }], resetToPattern: false })
    await handler(event)
    expect(dynamodb.updateAvailability).toHaveBeenCalledWith(
      sessionId,
      userId,
      expect.objectContaining({
        overrides: {
          2: [
            [true, false, false],
            [true, true, false],
            [true, true, true],
            [false, false, false],
          ],
        },
      }),
    )
  })

  it('should delete the override on resetToPattern', async () => {
    jest.mocked(dynamodb).getAvailability.mockResolvedValueOnce({
      userId,
      expiration: availabilityRecord.expiration,
      overrides: { 2: cloneGrid(availabilityRecord.template) },
      template: cloneGrid(availabilityRecord.template),
    })
    const event = withBody({ weekIndex: 2, cells: [], resetToPattern: true })
    await handler(event)
    expect(dynamodb.updateAvailability).toHaveBeenCalledWith(sessionId, userId, expect.objectContaining({ overrides: {} }))
  })

  it('should return BAD_REQUEST when weekIndex is beyond weekCount', async () => {
    const event = withBody({ weekIndex: 99, cells: [], resetToPattern: true })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
  })

  it('should return BAD_REQUEST when a cell is out of grid bounds', async () => {
    const event = withBody({ weekIndex: null, cells: [{ hourIndex: 99, dayIndex: 0, value: true }], resetToPattern: false })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 400 }))
  })

  it('should return NOT_FOUND when availability does not exist', async () => {
    jest.mocked(dynamodb).getAvailability.mockRejectedValueOnce(new NotFoundError('Availability not found'))
    const event = withBody({ weekIndex: null, cells: [{ hourIndex: 0, dayIndex: 0, value: true }], resetToPattern: false })
    const result = await handler(event)
    expect(result).toEqual(expect.objectContaining({ statusCode: 404 }))
  })
})
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx jest get-availability.test.ts patch-availability.test.ts`
Expected: FAIL — `Cannot find module '@handlers/get-availability'` / `'@handlers/patch-availability'`

- [ ] **Step 7: Create `src/handlers/get-availability.ts`**

```ts
import { NotFoundError } from '../errors'
import { getAvailability, getSession } from '../services/dynamodb'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { log, logError } from '../utils/logging'
import status from '../utils/status'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const userId = event.pathParameters?.userId as string

    const { session } = await getSession(sessionId)
    if (session.expiration < Math.floor(Date.now() / 1000)) {
      throw new NotFoundError('Session not found')
    }

    const availability = await getAvailability(sessionId, userId)
    return { ...status.OK, body: JSON.stringify(availability) }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
```

- [ ] **Step 8: Create `src/handlers/patch-availability.ts`**

```ts
import { NotFoundError, ValidationError } from '../errors'
import { getAvailability, getSession, updateAvailability } from '../services/dynamodb'
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from '../types'
import { parseAvailabilityPatch } from '../utils/events'
import { log, logError } from '../utils/logging'
import status from '../utils/status'

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  log('Received event', { ...event, body: undefined })
  try {
    const sessionId = event.pathParameters?.sessionId as string
    const userId = event.pathParameters?.userId as string

    const input = parseAvailabilityPatch(event)
    const { session } = await getSession(sessionId)
    const hourCount = session.endHour - session.startHour
    const dayCount = session.weekdays.length

    if (input.weekIndex !== null && input.weekIndex >= session.weekCount) {
      throw new ValidationError(`weekIndex must be less than weekCount (${session.weekCount})`)
    }
    for (const cell of input.cells) {
      if (cell.hourIndex >= hourCount || cell.dayIndex >= dayCount) {
        throw new ValidationError(`cell is out of bounds for a ${hourCount}x${dayCount} grid`)
      }
    }

    const availability = await getAvailability(sessionId, userId)

    if (input.resetToPattern && input.weekIndex !== null) {
      delete availability.overrides[input.weekIndex]
    }

    if (input.cells.length > 0) {
      if (input.weekIndex === null) {
        for (const cell of input.cells) {
          availability.template[cell.hourIndex][cell.dayIndex] = cell.value
        }
      } else {
        if (!availability.overrides[input.weekIndex]) {
          availability.overrides[input.weekIndex] = availability.template.map((row) => row.slice())
        }
        for (const cell of input.cells) {
          availability.overrides[input.weekIndex][cell.hourIndex][cell.dayIndex] = cell.value
        }
      }
    }

    await updateAvailability(sessionId, userId, availability)
    return { ...status.OK, body: JSON.stringify(availability) }
  } catch (error) {
    if (error instanceof NotFoundError) return status.NOT_FOUND
    if (error instanceof ValidationError)
      return { ...status.BAD_REQUEST, body: JSON.stringify({ message: error.message }) }
    logError(error)
    return status.INTERNAL_SERVER_ERROR
  }
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx jest get-availability.test.ts patch-availability.test.ts events.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add GET/PATCH availability endpoints with template+override model"
```

---

### Task 12: `POST /sessions/{sessionId}/users/{userId}/share` — SMS invite

**Files:**
- Modify: `src/handlers/share-session.ts`
- Test: `__tests__/unit/handlers/share-session.test.ts`

**Interfaces:**
- Consumes: `createAvailability`, `emptyGrid` (Tasks 3, 5), everything else unchanged
- Produces: `handler` — same contract, `201 { userId }`, now also creates an `AvailabilityRecord` for the invited user

- [ ] **Step 1: Update the test**

In `__tests__/unit/handlers/share-session.test.ts`, add:

```ts
it('should create an empty availability grid for the shared user', async () => {
  jest.mocked(dynamodb).createAvailability.mockResolvedValueOnce(undefined)
  await handler(event)
  expect(dynamodb.createAvailability).toHaveBeenCalledWith(
    sessionId,
    expect.objectContaining({ userId: 'brave-tiger', overrides: {} }),
  )
})
```

and update the SMS-copy assertion (search for the existing `sendSms` assertion and change the expected message from the restaurant-voting copy to plan copy, e.g. `Join the plan to add your hours: ${link}`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest share-session.test.ts`
Expected: FAIL — `dynamodb.createAvailability` never called; old message text still asserted

- [ ] **Step 3: Update `src/handlers/share-session.ts`**

Add the import: `createAvailability` alongside the existing `dynamodb` imports, and `emptyGrid` from `../services/occurrences`. Replace the `newUser` construction and the line after `createUser(sessionId, newUser)` with:

```ts
const newUser: UserRecord = {
  expiration: session.expiration,
  googleSub: null,
  name: null,
  phone,
  textsSent: 0,
  userId,
}

await createUser(sessionId, newUser)
await createAvailability(sessionId, {
  expiration: session.expiration,
  overrides: {},
  template: emptyGrid(session.endHour - session.startHour, session.weekdays.length),
  userId,
})
```

Update the SMS body text: `` `Join the plan to add your hours: ${link}` `` in place of the restaurant-voting copy.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest share-session.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/handlers/share-session.ts __tests__/unit/handlers/share-session.test.ts
git commit -m "feat: share-session also creates availability for the invited user"
```

---

### Task 13: Wire up `template.yaml`

**Files:**
- Modify: `template.yaml`

**Interfaces:** None — infra only.

- [ ] **Step 1: Add `MAX_PLAN_WEEKS` to `EnvironmentMap` and to `PostSessionFunction`'s `Environment.Variables`**

Add `maxPlanWeeks: '12'` under each environment entry in `EnvironmentMap`, and `MAX_PLAN_WEEKS: !FindInMap [EnvironmentMap, !Ref Environment, maxPlanWeeks]` to `PostSessionFunction`'s environment block.

- [ ] **Step 2: Add the two new availability routes**

Add, mirroring `PatchUserFunction`'s structure exactly (same `Policies`, same dual `ApiKey`/`Http` events, same `LogGroup`/`LogGroupSubscription` pair, same `Metadata.BuildProperties`):

```yaml
  GetAvailabilityFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/handlers/get-availability.handler
      MemorySize: 1536
      Description: pick-a-time get user availability
      Policies:
        - AWSLambdaBasicExecutionRole
        - DynamoDBCrudPolicy:
            TableName: !Ref SessionsTable
      Environment:
        Variables:
          DYNAMODB_TABLE_NAME: !Ref SessionsTable
      Events:
        ApiKey:
          Type: Api
          Properties:
            RestApiId: !Ref Api
            Path: /sessions/{sessionId}/users/{userId}/availability
            Method: get
            Auth:
              ApiKeyRequired: true
        Http:
          Type: HttpApi
          Properties:
            ApiId: !Ref HttpApi
            Path: /sessions/{sessionId}/users/{userId}/availability
            Method: get
            Auth:
              Authorizer: NONE
      Timeout: 60
    Metadata:
      BuildMethod: esbuild
      BuildProperties:
        Minify: true
        Target: 'es2024'
        Sourcemap: true
        EntryPoints:
          - src/handlers/get-availability.ts

  GetAvailabilityLogGroup:
    Type: AWS::Logs::LogGroup
    Properties:
      LogGroupName: !Sub /aws/lambda/${GetAvailabilityFunction}
      RetentionInDays: 30
      Tags:
        - Key: 'created-by'
          Value: 'choosee-api'
        - Key: 'created-for'
          Value: 'choosee'
        - Key: 'environment'
          Value: !Ref Environment

  GetAvailabilityLogGroupSubscription:
    Type: AWS::Logs::SubscriptionFilter
    Properties:
      DestinationArn: !Sub
        - 'arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:${Function}'
        - Function: !FindInMap [EnvironmentMap, !Ref Environment, logStreamFunction]
      FilterPattern: '[timestamp, uuid, level="ERROR", message]'
      LogGroupName: !Ref GetAvailabilityLogGroup

  PatchAvailabilityFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/handlers/patch-availability.handler
      MemorySize: 1536
      Description: pick-a-time patch user availability
      Policies:
        - AWSLambdaBasicExecutionRole
        - DynamoDBCrudPolicy:
            TableName: !Ref SessionsTable
      Environment:
        Variables:
          DYNAMODB_TABLE_NAME: !Ref SessionsTable
      Events:
        ApiKey:
          Type: Api
          Properties:
            RestApiId: !Ref Api
            Path: /sessions/{sessionId}/users/{userId}/availability
            Method: patch
            Auth:
              ApiKeyRequired: true
        Http:
          Type: HttpApi
          Properties:
            ApiId: !Ref HttpApi
            Path: /sessions/{sessionId}/users/{userId}/availability
            Method: patch
            Auth:
              Authorizer: NONE
      Timeout: 60
    Metadata:
      BuildMethod: esbuild
      BuildProperties:
        Minify: true
        Target: 'es2024'
        Sourcemap: true
        EntryPoints:
          - src/handlers/patch-availability.ts

  PatchAvailabilityLogGroup:
    Type: AWS::Logs::LogGroup
    Properties:
      LogGroupName: !Sub /aws/lambda/${PatchAvailabilityFunction}
      RetentionInDays: 30
      Tags:
        - Key: 'created-by'
          Value: 'choosee-api'
        - Key: 'created-for'
          Value: 'choosee'
        - Key: 'environment'
          Value: !Ref Environment

  PatchAvailabilityLogGroupSubscription:
    Type: AWS::Logs::SubscriptionFilter
    Properties:
      DestinationArn: !Sub
        - 'arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:${Function}'
        - Function: !FindInMap [EnvironmentMap, !Ref Environment, logStreamFunction]
      FilterPattern: '[timestamp, uuid, level="ERROR", message]'
      LogGroupName: !Ref PatchAvailabilityLogGroup
```

- [ ] **Step 3: Validate the template**

Run: `sam validate` (or `aws cloudformation validate-template --template-body file://template.yaml` if SAM CLI isn't installed locally)
Expected: template is valid; no dangling `!Ref`/`!FindInMap` to resources removed in Task 1

- [ ] **Step 4: Commit**

```bash
git add template.yaml
git commit -m "chore: wire availability routes into template.yaml, remove obsolete routes"
```

(Deleting the obsolete `Function`/`LogGroup`/`LogGroupSubscription` blocks named in Task 1 Step 6 is part of this same commit if not already done — do it now if it wasn't practical to do inline during Task 1.)

---

### Task 14: Update `endpoints.rest` for manual smoke testing

**Files:**
- Modify: `endpoints.rest`

**Interfaces:** None — developer convenience file only.

- [ ] **Step 1: Replace the restaurant-domain requests with plan requests**

Remove requests tied to deleted routes (`/sessions/config`, `/sessions/{id}/choices`, `/reverse-geocode`, `/rounds/...`). Replace the `POST {{host}}/sessions` example body with:

```http
### Create a plan
POST {{host}}/sessions
Content-Type: application/json
x-recaptcha-token: test-token

{
  "name": "Fall rec soccer practice",
  "weekdays": [4, 5, 6],
  "startDate": "2025-09-04",
  "weekCount": 6,
  "startHour": 16,
  "endHour": 20,
  "timezone": "America/Chicago"
}

### Join a plan
POST {{host}}/sessions/{{sessionId}}/users

### Get availability
GET {{host}}/sessions/{{sessionId}}/users/{{userId}}/availability

### Paint the template
PATCH {{host}}/sessions/{{sessionId}}/users/{{userId}}/availability
Content-Type: application/json

{
  "weekIndex": null,
  "cells": [{ "hourIndex": 2, "dayIndex": 0, "value": true }],
  "resetToPattern": false
}
```

- [ ] **Step 2: Commit**

```bash
git add endpoints.rest
git commit -m "docs: update endpoints.rest for the plan/availability domain"
```

---

## Final verification

- [ ] Run: `npm run typecheck` — expect no errors
- [ ] Run: `npm test` — expect all suites passing and coverage thresholds (branches 90 / functions 90 / lines 80) met
- [ ] Run: `npm run lint` — expect no errors
- [ ] Manually walk `endpoints.rest`'s new requests against a local/dev deploy: create a plan, join it, GET the empty availability grid, PATCH a few cells into the template, GET again and confirm they stuck.
