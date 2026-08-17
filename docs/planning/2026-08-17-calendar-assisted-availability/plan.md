# Plan — Calendar-assisted availability

Twelve sections in three batches. `Files:` lists are exact and disjoint **within a batch**, so
sections in the same batch can run in parallel worktrees without collision. All paths are
repo-relative; `api/` = `pick-a-time-api`, `ui/` = `pick-a-time-ui` (branches
`google-calendar-sync` and `google-calendar-sync-v2`).

TDD applies: the failing test comes first in every section.

---

## Batch 1 — primitives and server foundations

Nothing here consumes anything else in this plan.

### Section 1 — Extract the availability read

Goal: give the new authed handler a shared record read without duplicating `get-availability`.

- **ACs:** AC-005, AC-006
- **Files:**
  - `api/src/services/availability.ts` — create
  - `api/src/handlers/get-availability.ts` — modify
  - `api/__tests__/unit/services/availability.test.ts` — create
  - `api/__tests__/unit/handlers/get-availability.test.ts` — modify
- **Interfaces:** Provides: `readAvailabilityRecord(sessionId, userId)`. Consumes: —
- **Verify:** `npm test -- get-availability availability` in `api/`; the open route's response body
  is byte-identical before and after, and no Google call is reachable from it.

### Section 2 — Retention bound, expiration refresh, error hygiene

Goal: make the cached calendar record safe to serve as a read path.

- **ACs:** AC-026, AC-038
- **Files:**
  - `api/src/services/calendar-sync.ts` — modify
  - `api/src/config.ts` — modify
  - `api/src/handlers/get-calendar-callback.ts` — modify
  - `api/__tests__/unit/services/calendar-sync.test.ts` — modify
  - `api/__tests__/unit/handlers/get-calendar-callback.test.ts` — modify
- **Interfaces:** Provides: `CALENDAR_ACCOUNT_TTL_SECONDS` from config; a bounded, prunable
  `busyIntervals`. Consumes: —
- **Verify:** `npm test -- calendar-sync get-calendar-callback` in `api/`. Tests must prove the
  bound is `[today − sessionExpireHours, today + maxPollDateRangeDays]` and **not** TTL-derived —
  a poll whose dates run a year out must still have its just-fetched intervals survive the prune.

### Section 3 — Cell class constants and their contrast proof

Goal: the two new cell treatments exist as reviewable constants with a contrast test.

- **ACs:** AC-041
- **Files:**
  - `ui/src/components/poll/slot-columns.ts` — modify
  - `ui/src/components/poll/painting/booked-contrast.test.ts` — create
- **Interfaces:** Provides: `BOOKED_CELL_CLASS`, `CONFLICT_CELL_CLASS`. Consumes: —
- **Verify:** `npm test -- booked-contrast slot-columns` in `ui/`. The test parses `index.css` via
  `src/utils/contrast.ts` and asserts each indicator ≥3:1 **against its own fill** — booked glyph on
  the booked fill, conflict marker on `--accent`.

### Section 4 — Chip gains `primary` and focusable-disabled

Goal: the button primitive can express emphasis and inertness without leaving the tab order.

- **ACs:** AC-025, AC-032
- **Files:**
  - `ui/src/components/ui/chip/index.tsx` — modify
  - `ui/src/components/ui/chip/index.test.tsx` — modify
- **Interfaces:** Provides: `Chip` with `primary` and `aria-disabled` + `aria-describedby`.
  Consumes: —
- **Verify:** `npm test -- chip` in `ui/`. An `aria-disabled` chip stays focusable, keeps its
  `aria-describedby`, and does not fire `onPress`.

---

## Batch 2 — the server contract

Consumes batch 1.

### Section 5 — Delete the destructive write

Goal: `markBusyHours` is gone and nothing on the server writes availability from calendar data.

- **ACs:** AC-001, AC-009
- **Files:**
  - `api/src/services/overlap.ts` — modify
  - `api/__tests__/unit/services/overlap.test.ts` — modify
  - `api/__tests__/unit/handlers/get-overlap.test.ts` — modify
- **Interfaces:** Provides: an `overlap` module with `buildBusyGrid` and no `markBusyHours`.
  Consumes: —
- **Verify:** `npm test -- overlap` in `api/`. `grep -r markBusyHours api/src` returns nothing. The
  overlap response is unchanged and `GetOverlapFunction` holds no KMS or SSM grant.

### Section 6 — The authed availability read

Goal: the owner, and only the owner, can read their own busy grid.

- **ACs:** AC-003, AC-005, AC-007, AC-008, AC-011, AC-030, AC-034, AC-042
- **Files:**
  - `api/src/handlers/get-availability-authed.ts` — create
  - `api/src/utils/availability.ts` — modify
  - `api/src/types.ts` — modify
  - `api/__tests__/unit/handlers/get-availability-authed.test.ts` — create
  - `api/__tests__/unit/__mocks__.ts` — modify
- **Interfaces:** Provides: `{ userId, free, expiration, busy, calendarStatus, busyWindow }`.
  Consumes: §1 `readAvailabilityRecord`, §2 bounded intervals, §5's `buildBusyGrid`.
- **Verify:** `npm test -- get-availability-authed` in `api/`. Required cases: 403 on
  `googleSub` mismatch **and** on a null sub; busy computed from the **caller's** account, never the
  path participant's; `Cache-Control: private, no-store` and `Vary: Authorization` present; a
  claimed-but-previously-unlinked participant yields only the claimer's own grid.

### Section 7 — Sync becomes a refresh

Goal: `POST .../calendar/sync` stops writing availability and returns the fresh grid.

- **ACs:** AC-001, AC-002, AC-006, AC-007, AC-010, AC-011, AC-012, AC-030, AC-034
- **Files:**
  - `api/src/handlers/post-calendar-sync.ts` — modify
  - `api/__tests__/unit/handlers/post-calendar-sync.test.ts` — modify
  - `api/__tests__/unit/handlers/get-users.test.ts` — modify
- **Interfaces:** Provides: a sync response carrying `busy`, `calendarStatus`, `busyWindow` and
  neither `applied` nor `markedBusyCount`. Consumes: §5, §6's response shape.
- **Verify:** `npm test -- post-calendar-sync get-users` in `api/`. Stored `free` is byte-identical
  across a check; no log call emits an interval, date, or grid; `GET /users` gains no
  calendar-derived field.

### Section 8 — Route, function, and IAM

Goal: the new endpoint is deployable with a grant that is enumerated, not inherited.

- **ACs:** AC-005, AC-007, AC-009, AC-011
- **Files:**
  - `api/template.yaml` — modify
- **Interfaces:** Provides: `GET /sessions/{sessionId}/users/{userId}/availability/authed` behind
  `CognitoAuthorizer`, with log group and subscription. Consumes: §6's handler.
- **Verify:** `sam validate` in `api/`. The new function grants `ssm:GetParameter` on the two named
  Google parameters, `kms:Decrypt` on **both** `CalendarTokenKey` and the legacy key ARN carried by
  `PostCalendarSyncFunction`, and `DynamoDBCrudPolicy` on `SessionsTable`. `GetOverlapFunction`'s
  policy block is unchanged — diff it explicitly.

---

## Batch 3 — the client

Consumes batch 2. §9 and §10 both touch the painting directory and are **sequential with each
other**; §11 and §12 are independent of both.

### Section 9 — Four-state cells

Goal: the grid draws booked and conflict states without losing operability.

- **ACs:** AC-013, AC-014, AC-015, AC-017, AC-018, AC-030
- **Files:**
  - `ui/src/components/poll/painting/grid.tsx` — modify
  - `ui/src/components/poll/painting/grid.test.tsx` — modify
- **Interfaces:** Provides: a `PaintGrid` taking `busy`. Consumes: §3's class constants.
- **Verify:** `npm test -- grid` in `ui/`. State asserted through accessible names only. Every cell
  is a focusable button in every state; the `, booked` suffix is present when the layer is drawn and
  **absent** in the `error` state.

### Section 10 — The strip, the key, and the conflict flow

Goal: the calendar speaks when it disagrees, and the fill only ever paints.

- **ACs:** AC-002, AC-019, AC-020, AC-021, AC-022, AC-024, AC-027, AC-028, AC-029, AC-031,
  AC-032, AC-033, AC-034, AC-035, AC-036, AC-037, AC-040, AC-042, AC-044
- **Files:**
  - `ui/src/components/poll/painting/elements.tsx` — modify
  - `ui/src/components/poll/painting/index.tsx` — modify
  - `ui/src/components/poll/painting/elements.test.tsx` — modify
  - `ui/src/components/poll/painting/index.test.tsx` — modify
- **Interfaces:** Provides: the review flow and the fill action. Consumes: §4's `Chip`, §9's
  `PaintGrid`, §11's client.
- **Verify:** `npm test -- painting` in `ui/`. Required: the fill never unpaints; its skipped count
  is what it **actually skipped**, not the total booked; `editCountRef` still present and
  `editCountAtSyncRef` gone; the `aria-live` node is the same element across every state
  transition; copy branches covered table-driven at 1, n, and 0.

### Section 11 — API client and types

Goal: the client reads from the right endpoint and survives an unlinked record.

- **ACs:** AC-003, AC-044
- **Files:**
  - `ui/src/services/api.ts` — modify
  - `ui/src/types.ts` — modify
  - `ui/src/services/api.test.ts` — modify
- **Interfaces:** Provides: the authed availability client with a 401/403 fallback to the open read;
  a reshaped `CalendarSyncResult`. Consumes: §6, §7.
- **Verify:** `npm test -- api` in `ui/`. A 403 from the authed read falls back to the open read and
  resolves with no `busy`, rather than rejecting.

### Section 12 — Privacy policy

Goal: the published policy says only what stays true.

- **ACs:** AC-043
- **Files:**
  - `ui/src/components/privacy-policy/index.tsx` — modify
  - `ui/src/components/privacy-policy/index.test.tsx` — modify
  - `ui/test/pages/privacy-policy.test.tsx` — modify
- **Interfaces:** Provides: —. Consumes: —
- **Verify:** `npm test -- privacy` in `ui/`. Three passages changed; no claim survives that the
  calendar marks hours on the participant's behalf, that other participants cannot distinguish
  calendar-derived hours, or that busy times are kept for a period the retention bound contradicts.
  **Invoke the `plainspoken-privacy-policy` skill for the wording.** Budget: at most one added
  clause across all three.

---

## Whole-plan verification

Run in both repos after batch 3:

```
api/  npm run lint && npm run typecheck && npm test
ui/   npm run lint && npm run typecheck && npm test
```

Coverage gates are global, not per-file: API branches 90 / functions 90 / lines 80; UI branches 80 /
functions 90 / lines 90. The UI **branch** gate is the one at risk — the copy table adds ~20
singular/plural branches, so §10 must cover them table-driven.

## Open questions for implementation

Both recorded in `design.md`; neither blocks a section.

1. Whether `Check again` stays visible during the conflict review.
2. Whether the fill chip lives in the strip or the toolbar (D-10). The renders place it in the strip.
