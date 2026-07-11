# Pick a Time — what changes in this API

This repo currently backs Choosee, a restaurant-bracket-voting app. We're repurposing it into
the API for Pick a Time: a recurring, multi-week group-availability scheduler at
`pick-a-time.com`. Most of the plumbing survives — single-table DynamoDB, adjective-noun IDs,
Cognito+Google auth, JSON-Patch updates, the error/status catalog. The domain model
(brackets, votes, rounds, restaurant choices) does not.

This doc describes **what** needs to change. A follow-up spec covers **how** we get there
(step-by-step, in what order).

## Core principle: the server is the source of truth

The client renders what the API returns. It does not compute overlap, pattern aggregation,
best-slot selection, or "who's busy" — all of that is server-side, in a new
`services/overlap.ts` (this project's equivalent of today's `services/brackets.ts`), and the
client just displays the response.

The one exception is **in-flight gesture feedback**: while a user is mid-drag on the
availability grid, the client shows the paint stroke locally for responsiveness (you can't
round-trip to the server on every cell crossed during a drag). The moment the gesture ends,
the client sends the resulting cells as a single PATCH and reconciles its display to whatever
the server's response says — it never trusts its own optimistic state as final, and it never
computes aggregates, override indicators, or exceptions itself. If the server and the
client's optimistic guess ever disagree, the server wins and the UI snaps to match.

## Auth & Google scopes — Cognito vs. us

Today's scopes (`template.yaml`, `GoogleIdentityProvider.ProviderDetails.authorize_scopes` =
`openid profile email`, mirrored in `UserPoolClient.AllowedOAuthScopes`) are configured **by
us**, in this repo's CloudFormation. But they only cover *sign-in identity* — Cognito is
acting as an identity broker: it exchanges Google's tokens for its own Cognito-minted JWT and
does **not** hand your backend Google's own `access_token`/`refresh_token`. That's a hard
limitation of Cognito federation, not a config option we're missing.

Calendar freebusy access needs Google's own OAuth tokens directly, so it cannot be added as
"one more scope" on the existing Cognito Google IdP. It has to be a **second, independent
OAuth grant**, run outside Cognito:

- A dedicated redirect flow hitting `accounts.google.com/o/oauth2/v2/auth` directly (not
  Cognito's hosted UI), requesting `https://www.googleapis.com/auth/calendar.freebusy` with
  `access_type=offline&prompt=consent` so we get a refresh token.
- This can reuse the **same** Google Cloud OAuth client (client ID/secret) already registered
  for Cognito's IdP, or a new dedicated one — recommend a new one, so the calendar grant has
  its own redirect URI and its own blast radius if the secret ever leaks, independent of the
  sign-in client.
- In Google Cloud Console: enable the Calendar API on the project, and add the new redirect
  URI (e.g. `https://api.pick-a-time.com/oauth/google-calendar/callback`) as an authorized
  redirect URI on whichever client is used for this flow.
- Token storage/refresh is entirely on us — a new `CALENDAR#<userId>` DynamoDB item (KMS-
  encrypted refresh token), a Lambda that mints a fresh access token from it before each
  `freebusy.query` call, and explicit handling for `invalid_grant` (token revoked externally)
  and consent-denied.

Net: Cognito config is unchanged for sign-in. Calendar access is new infrastructure end to
end — new Google Cloud OAuth client, new redirect route, new encrypted token storage, new
sync logic. Nothing about it lives in Cognito.

## Domain removed

- `SessionRecord.bracket` / `.byes` / `.winner` / `.currentRound` / `.totalRounds` /
  `.votersSubmitted`, `UserRecord.votes` / `.subscribedRounds`
- `services/brackets.ts`, `services/google-maps.ts`, `services/recaptcha.ts` usage tied to
  place search (reCAPTCHA itself likely stays, just gating plan creation instead of session
  creation)
- `ChoiceDetail`, `ChoicesRecord`, `PlaceDetails`, `PlaceTypeDisplay`, `src/assets/place-types.ts`
- Handlers: `close-round.ts`, `subscribe-round.ts`, `get-choices.ts`, `get-reverse-geocode.ts`,
  `get-session-config.ts` (a new, much smaller config endpoint may still be useful for
  client-configurable constants like max weeks)

## Data model

Keep `sessionId` as the internal name (it's already threaded through the table, ID generator,
and tests) — "plan" is UI copy only.

**`SESSION` item** (replaces `SessionRecord`):

```ts
interface PlanRecord {
  sessionId: string
  name: string // "Fall rec soccer practice"
  weekdays: number[] // [4,5,6] — 0=Sun..6=Sat, the recurring days
  startDate: string // "2025-09-04", ISO date of the first occurrence
  weekCount: number // 6
  startHour: number // 16
  endHour: number // 20
  slotMinutes: number // 60 (or 30)
  timezone: string // IANA, e.g. "America/Chicago" — required for correct hour math
  //   and for freebusy queries against the right day boundaries
  expiration: number // TTL, same pattern as today
}
```

Occurrence dates are **not** stored. They're derived by a pure `buildOccurrences(plan)`
function from `weekdays`/`startDate`/`weekCount` — the same approach already prototyped as
`dateFor()` in the UI mockup. No combinatorial storage growth, and it's trivially testable
without touching Dynamo.

**`AVAIL#<userId>` item** (new — this plan's equivalent of `votes`):

```ts
interface AvailabilityRecord {
  userId: string
  template: boolean[][] // [hourSlot][dayIndex] — applies to every week by default
  overrides: Record<number, boolean[][]> // sparse — only weeks the user diverged from the template
  calendarConnected: boolean
}
```

**`CALENDAR#<userId>` item** (new, only exists for users who connected Google Calendar):

```ts
interface CalendarAccountRecord {
  userId: string
  refreshTokenEncrypted: string // KMS-encrypted; never returned to the client, never logged
  scope: string
  lastSyncedAt: number
  busyBlocks: { date: string; startMinute: number; endMinute: number }[]
}
```

## Endpoints

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /sessions` | none | Create a plan: name, weekdays, startDate, weekCount, hours, timezone. Synchronous — no async worker Lambda needed here (unlike today's Google Places lookup), so the `isReady`-polling pattern goes away entirely. |
| `GET /sessions/{sessionId}` | none | Plan details + participant count |
| `POST /sessions/{sessionId}/users` (+ `/authed`) | none / Cognito | Join, get an adjective-noun name — same shape as today's `post-user.ts` |
| `PATCH /sessions/{sessionId}/users/{userId}` | none | Rename, set phone — unchanged from today |
| `PATCH /sessions/{sessionId}/users/{userId}/availability` | none | JSON Patch against `/template/{h}/{d}` and `/overrides/{w}/{h}/{d}`, plus `remove` on `/overrides/{w}` for "reset this week to the pattern" — same allow-listed-path approach as today's `VOTES_PATH_REGEX` |
| `POST /sessions/{sessionId}/users/{userId}/calendar/connect` | Cognito | Returns the Google OAuth consent URL to redirect to |
| `GET /oauth/google-calendar/callback` | none (state-verified) | Google redirects here after consent; exchanges code, stores encrypted refresh token |
| `DELETE /sessions/{sessionId}/users/{userId}/calendar` | Cognito | Revokes at Google, deletes the stored record |
| `GET /sessions/{sessionId}/users` | none | Users + their template/overrides + synced busy overlay |
| `GET /sessions/{sessionId}/overlap?week=pattern\|<n>` | none | Computed grid, best slot, and exceptions — fully server-computed |
| `POST /sessions/{sessionId}/users/{userId}/share` | Cognito | SMS invite — reuse `share-session.ts` near verbatim |

## `services/overlap.ts` — the new business-logic core

- `buildOccurrences(plan)` — pure function, the real recurring dates
- `computePatternGrid(plan, users)` — per weekday/hour, aggregates across all occurrences of
  that weekday (template, minus per-week override, minus that date's calendar-busy)
- `computeWeekGrid(plan, users, weekIndex)` — same, for one concrete week's actual dates
- `findBestSlot(grid)`

Computed on-demand per read rather than materialized — at realistic scale (≤12 weeks × 7 days
× ~20 slots × a handful of users) this is a few thousand boolean operations, cheap enough that
an incremental/precomputed view would be premature.

## Open decisions

- Slot granularity: 30 vs. 60 minutes (affects grid size and PATCH path cardinality)
- Max `weekCount` — needs a ceiling for validation (`events.ts`-style bounds check)
- Whether to reuse the existing Google Cloud OAuth client for the calendar grant or register a
  new one (recommend new, for blast-radius isolation)
- ~~Whether to rename the CloudFormation-level resources~~ — resolved: renamed everything
  (`pick-a-time-${Environment}` UserPool, `pick-a-time-api-sessions` table, `pick-a-time.com`
  domains, SSM parameter paths, S3/IAM pipeline resource names) since this is the first deploy
  and reusing `choosee`-named identifiers would collide with the real, still-live Choosee
  production stack in the same AWS account. Still open: real ACM certificates need to be
  issued/validated for `pick-a-time.com` / `api.pick-a-time.com` / `api-internal.pick-a-time.com`
  (see `template.yaml`'s `certificateEdge`/`certificateRegional` placeholders), and the
  `/pick-a-time/recaptcha-secret-key`, `/pick-a-time/google-client-id`, and
  `/pick-a-time/google-client-secret` SSM parameters need to exist before the pipeline can
  deploy — they won't be copied over automatically from the old `/choosee/...` paths.
- DST handling for `timezone` — occurrence-to-UTC conversion needs to account for a plan that
  spans a DST transition (a 6-week plan crossing November's fall-back, for example)
