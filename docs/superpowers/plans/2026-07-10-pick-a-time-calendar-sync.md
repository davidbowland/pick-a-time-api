# Pick a Time — Google Calendar Sync (Plan C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **STATUS: PROVISIONAL.** This captures what we know today. It has not been broken into bite-sized TDD tasks yet, and it depends on both Plan A (shipped) and Plan B (the overlap computation this needs to feed into). Do not start executing this until both are done and the overlap contract is stable — this plan's shape will change once real usage informs the sync cadence and failure handling. Treat every section below as a starting point to re-validate, not a locked contract.

**Goal:** Let a user who signs in with Google automatically block off times they're already busy, across every occurrence date in a plan, without manually marking each one.

**Architecture:** A second, independent OAuth grant against Google directly (not through Cognito — see `docs/pick-a-time-changes.md` for why Cognito federation can't be extended to cover this). New encrypted per-user token storage in DynamoDB, a sync step that calls Google's `freebusy.query` for the plan's actual occurrence dates, and a poll-on-read refresh triggered from the overlap endpoint (Plan B) rather than a push webhook.

**Tech Stack:** Same as Plans A/B, plus Google's OAuth 2.0 token endpoint, the Calendar API's `freebusy.query`, and AWS KMS for envelope encryption of refresh tokens.

## Global Constraints

- Scope requested: `https://www.googleapis.com/auth/calendar.freebusy` only. Never request `calendar.readonly` or broader — the product's privacy pitch depends on genuinely never seeing event titles.
- `access_type=offline&prompt=consent` on the initial grant, so a refresh token is actually issued.
- Refresh tokens are KMS-encrypted at rest, never logged, never returned to the client in any response body.
- No push webhooks/channels in v1 — sync happens by checking staleness on read (mirrors the app's existing no-websocket, refetch-based model from Plan A/B).
- This is additive to Plan B's `computeGrid`: when a user is calendar-connected, their busy blocks reduce `freeCount` at the relevant cells exactly like a `template`/`override` "not free" would — Plan B's grid math needs a third input (calendar busy blocks) folded in alongside template/overrides, not a parallel computation path.

---

## What we know now

### New DynamoDB item: `CALENDAR#<userId>`

```ts
interface CalendarAccountRecord {
  userId: string
  refreshTokenEncrypted: string // KMS envelope-encrypted
  scope: string
  lastSyncedAt: number
  busyBlocks: { date: string; startMinute: number; endMinute: number }[]
  expiration: number
}
```

### New endpoints

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /sessions/{sessionId}/users/{userId}/calendar/connect` | Cognito (authed route, like today's `/authed` route-duplication pattern) | Returns the Google OAuth consent URL to redirect the browser to |
| `GET /oauth/google-calendar/callback` | none (state param verified instead) | Google redirects here after consent; exchanges the code, encrypts and stores the refresh token |
| `DELETE /sessions/{sessionId}/users/{userId}/calendar` | Cognito | Revokes the token at Google, deletes the stored record |

### Sync flow (sketch)

```ts
// services/google-calendar.ts
export const exchangeCodeForTokens = async (code: string): Promise<{ refreshToken: string; accessToken: string }> => {
  throw new Error('not implemented') // POST to Google's token endpoint
}

export const refreshAccessToken = async (refreshToken: string): Promise<string> => {
  throw new Error('not implemented') // POST grant_type=refresh_token; handle invalid_grant explicitly
}

export const fetchFreeBusy = async (
  accessToken: string,
  dateRange: { start: string; end: string },
): Promise<{ start: string; end: string }[]> => {
  throw new Error('not implemented') // POST https://www.googleapis.com/calendar/v3/freeBusy
}
```

Called from Plan B's overlap endpoint: if a calendar-connected user's `lastSyncedAt` is stale (threshold TBD, likely 15-30 minutes), refresh before computing that user's contribution to the grid. A stale-but-present cache is used on failure (revoked token, API timeout) rather than blocking the whole read — mark `calendarConnected: false` server-side and let the client prompt reconnect on its own schedule, not synchronously in the middle of an overlap read.

## Open questions to resolve before writing real tasks

1. **New Google Cloud OAuth client, or reuse the Cognito one?** Recommend a new one — isolates blast radius if this client's secret ever leaks, independent of the sign-in client Cognito uses. Needs a Google Cloud Console decision, not just code.
2. **Where does the encrypted refresh token get decrypted, and by whom?** Needs a dedicated KMS key (not reusing whatever key, if any, secures other secrets) with an IAM policy scoped tightly to the sync Lambda(s) — follow the existing `Statement`/`kms:Decrypt`/`Resource: <specific key ARN>` pattern already used for `PatchUserFunction` in `template.yaml`, not a wildcard.
3. **`invalid_grant` handling.** When does the UI find out a connection died? Options: surface it in the overlap response (a per-user `calendarStatus: 'connected' | 'disconnected' | 'error'` field) so the client can prompt reconnect inline, versus a separate polling endpoint. Leaning toward folding it into the overlap/user response rather than a new endpoint — decide when Plan B's response shape is final.
4. **Sync trigger cadence.** Poll-on-read (triggered by the overlap endpoint) is simplest, but means a user's calendar changes won't show up until *someone* requests overlap. Probably fine for v1 (this is exactly how the rest of the app already works — nothing is push-updated). Revisit if that turns out to feel stale in practice.
5. **What happens to `busyBlocks` and the encrypted token on disconnect?** Full delete of the `CALENDAR#<userId>` item, plus an explicit call to Google's revocation endpoint (`https://oauth2.googleapis.com/revoke`) — don't just stop using the token locally.
6. **Timezone correctness across a DST boundary.** A plan spanning a DST transition needs each occurrence's local start/end hour converted to the correct UTC instant for that specific date (not a fixed offset) before calling `freebusy.query`. Node's `Intl`/`Temporal`-adjacent tooling (or a small library) should handle this — flag it explicitly as a test case once this plan is broken into real tasks, since it's exactly the kind of bug that only shows up twice a year.
