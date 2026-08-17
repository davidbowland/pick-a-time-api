# Spec — Calendar-assisted availability

Change rundown and traceability matrix. Every live AC must appear below, and the change named
against it must be able to actually deliver it — a row that merely exists is a false pass.

**Corrections to `design.md`**, applied here rather than left to contradict:
- It lists `src/services/dynamodb.ts` (API) as modified. It is not; the three reads already exist.
- Its "Shared components" row reusing the heat-grid recommended-ring span is **stale** — the cut
  replaced that with A's `--ink` marker bar. Dropped.
- Its privacy-policy table misses a third affected sentence (see C-18).

**Post-review revision.** Three blind reviewers returned 19 blocking findings against the first
draft of this spec. All are applied below. AC IDs issued: 44. WITHDRAWN: AC-004, AC-016, AC-023,
AC-039. Live: **40**.

---

## Change rundown

### API — `pick-a-time-api`

**C-1 · `src/handlers/get-availability-authed.ts` — create**
Cognito-authorized read returning `{ userId, free, expiration, busy }`. Loads the poll, the named
participant, and the **caller's own** calendar account by `auth.googleSub`; 403 when
`user.googleSub !== auth.googleSub` or the sub is null. Computes `busy` via `buildBusyGrid` against
this poll. Delegates the refresh decision to C-5. Sets `Cache-Control: private, no-store` and
`Vary: Authorization`. Its own file, so the open route has no code path to busy data (ADR-1).

Response is `{ userId, free, expiration, busy, calendarStatus, busyWindow }`. **`calendarStatus`
and `busyWindow` are load-bearing, not decoration:** without them the client cannot tell `error`
from `connected-with-nothing-booked` — both are an empty grid — so AC-030, AC-034 and AC-042 are
undecidable. `busyWindow` is the date range actually read, which AC-034's copy names.

Follows `post-calendar-sync.ts:157-163`: an inner `getAvailabilityAuthed(event, now)` with an
injectable clock, wrapped by the exported `handler(event)`, because Lambda passes `Context` second.
Every catch routes through `sanitizeErrorForLogging` — an axios failure out of `refreshAccessToken`
carries `config.data` containing `client_secret` and the refresh token.
→ **AC-003, AC-005, AC-007, AC-008, AC-011, AC-030, AC-034, AC-042**

**C-2 · `src/handlers/get-availability.ts` — modify, and `src/services/availability.ts` — create**
Extract the record read into a **named** service (`src/services/availability.ts`) so C-1 does not
duplicate it, with `__tests__/unit/services/availability.test.ts`. The extracted read touches
records only — it must reach no Google call, or the open route gains a timing side channel.
Response stays byte-identical: `stripCalendarCheckedAt`, no `busy` key.
→ **AC-005, AC-006**

**C-3 · `src/utils/availability.ts` — modify**
Shared serializer gains an owner-only variant carrying `busy`. The open-route serializer is
unchanged and cannot emit it.
→ **AC-005, AC-006**

**C-4 · `src/services/overlap.ts` — modify**
Delete `markBusyHours`. Keep `buildBusyGrid`, `toBusyBlocks`, `computeGrid`,
`findRecommendedMeetings` unchanged.
→ **AC-001, AC-009**

**C-5 · `src/services/calendar-sync.ts` — modify**
Bound cached intervals by `[today − sessionExpireHours, today + maxPollDateRangeDays]` and prune on
write. **Not the poll TTL** — poll dates run to +365d (`src/config.ts:26`) while the TTL is 336h
(`template.yaml:43`), so a TTL-derived clamp would prune the intervals just fetched, `rangeCoversDates`
would never hold, and every poll open would hit Google with no underlay to show for it. The backward
arm is required because a poll may contain dates already past. If the bounded set still cannot fit
400KB, move `busyIntervals` to its own DynamoDB item rather than dropping the oldest — a silently
incomplete underlay is worse than the overflow, because it looks correct.

Surfacing a persist failure must **not** fail the read: a DynamoDB throttle would blank a valid
grid. It marks the served data stale; it does not error. Refresh `expiration` on every successful
check (AC-038). Keep the freshness window and `syncedRange` coverage check — now the only rate
limit (D-6). Keep the `'error'`-is-never-fresh clause. Route every catch through
`sanitizeErrorForLogging`: a raw axios failure here carries `client_secret` and the refresh token.
→ **AC-026, AC-030, AC-038**

**C-6 · `src/handlers/post-calendar-sync.ts` — modify**
No longer writes availability. Refreshes from Google and returns the fresh busy grid. Delete the
`hasFreeCell` guard, the `calendarCheckedAt` lock, **and the stamp itself**. Keep the 403 ownership
check and the 502-on-upstream-failure path. Adopt C-1's response headers — this route now returns
busy too.

`calendarCheckedAt` goes **write-dead**: after this the only writer is `post-user.ts:35` (null).
`stripCalendarCheckedAt` and the `undefined → null` backfill at `dynamodb.ts:61-66` stay, so legacy
records still parse and the field never reaches an unauthenticated response. Stated explicitly
because "keep the stamp as a timestamp" was false — nothing would write it.

`CalendarSyncResult` in the UI (`src/services/api.ts:225-230`) is invalidated by this: `applied`
and `markedBusyCount` no longer exist. Reshaped in C-17.
→ **AC-001, AC-002, AC-007, AC-011, AC-030, AC-034**

**C-7 · `__tests__/unit/services/calendar-sync.test.ts` and `get-availability-authed.test.ts` — modify**
A response-side redaction helper was specified in the first draft and is **cut as YAGNI** — nothing
in either repo logs a response body, so it would ship with zero callers. AC-012 is satisfied by
tests asserting that no log call emits an interval, date, or grid, preserving the existing
counts-only discipline (`calendar-sync.ts:74`, `post-calendar-sync.ts:139`). `src/utils/logging.ts`
is **not** modified.
→ **AC-012**

**C-8 · `template.yaml` — modify**
New function, route `GET /sessions/{sessionId}/users/{userId}/availability/authed` with
`CognitoAuthorizer`, and its log group + subscription.

**IAM, enumerated — the first draft's "KMS decrypt on `CalendarTokenKey` only" would 500 on every
poll open.** ADR-3 has this handler call `syncCalendarAccountForPoll`, which reads two SSM
SecureStrings via `refreshAccessToken` and writes back through `putCalendarAccount`. It needs:
`ssm:GetParameter` on the two named Google client parameters; `kms:Decrypt` on **both**
`CalendarTokenKey` **and the legacy key ARN** still carried by `PostCalendarSyncFunction`
(template.yaml:986-1002) — tokens encrypted under the old key must still decrypt; and
`DynamoDBCrudPolicy` on `SessionsTable`. Enumerated rather than copy-pasted, so the grant is
reviewed rather than inherited. Env: `KMS_CALENDAR_KEY_ID`, `CALENDAR_SYNC_FRESHNESS_MS`.

`GetOverlapFunction` gains **nothing**.
→ **AC-005, AC-007, AC-009, AC-011**

**C-9 · `src/types.ts` and `src/config.ts` — modify**
`busy: boolean[][]`, `calendarStatus` and `busyWindow` on the owner-only availability response type.
`CALENDAR_ACCOUNT_TTL_SECONDS` moves from module-private in `get-calendar-callback.ts:9` into
`config.ts`, because C-5's AC-038 refresh would otherwise duplicate it; the raw `Date.now()` at
`get-calendar-callback.ts:35` becomes an injectable `() => number` with a default, per the project's
clock rule. `src/handlers/get-calendar-callback.ts` is modified for that.
→ **AC-003, AC-030, AC-034, AC-038, AC-042**

**C-10 · API tests — create/modify**
`__tests__/unit/handlers/get-availability-authed.test.ts` (create);
`post-calendar-sync.test.ts`, `services/overlap.test.ts`, `services/calendar-sync.test.ts`,
`handlers/get-availability.test.ts`, `handlers/get-overlap.test.ts`,
`handlers/get-users.test.ts`, `__tests__/unit/__mocks__.ts` (modify).
Delete the `markBusyHours` describe and the four "don't spend a check when nothing is free" tests —
they assert behavior being removed. Extend the shared fixture rather than inventing grids.
→ **AC-001, AC-005, AC-006, AC-007, AC-008, AC-009, AC-010, AC-011, AC-012, AC-026, AC-030, AC-038**

### UI — `pick-a-time-ui`

**C-11 · `src/components/poll/slot-columns.ts` — modify**
Export `BOOKED_CELL_CLASS` and `CONFLICT_CELL_CLASS` beside `DISABLED_CELL_CLASS`, composed only
from existing tokens. Neither is dashed; neither is fainter than the unpainted fill.
→ **AC-013, AC-014, AC-015**

**C-12 · `src/components/poll/painting/grid.tsx` — modify**
The single `on` boolean becomes a derived `painted`/`booked` pair driving five treatments. Booked
carries a `Clock` glyph in `--slate`; conflict keeps the accent fill and `Check` plus an `--ink`
marker bar. Cells stay live buttons. Accessible name gains a `, booked` suffix, comma-appended per
`heat-grid.tsx:308`; the suffix is dropped in the `error` state.
→ **AC-013, AC-014, AC-015, AC-017, AC-018, AC-030**

**C-13 · `src/components/poll/painting/booked-contrast.test.ts` — create**
Parses `index.css` via `src/utils/contrast.ts`, asserting the booked glyph and the conflict marker
each clear 3:1 against their own ground. Mirrors `radio-contrast.test.ts`.
→ **AC-016**

**C-14 · `src/components/poll/painting/elements.tsx` — modify**
`CalendarStrip` gains `checking` and review branches in `contentFor`/`actionsFor`, plus
`conflictCount`, `fillableCount`, `skippedCount`, `onFill`, `onClearConflicts`, `onKeepConflicts`.
The `aria-live` detail is **one persistent node** updated by text only. New `GridKey`, rendered only
for treatments on screen. All copy from `design.md`. `markedBusyCount` and `detailFor`'s
`marked N hours busy` are deleted.
→ **AC-019, AC-024, AC-029, AC-030, AC-031, AC-032, AC-033, AC-034, AC-035, AC-036**

**C-15 · `src/components/poll/painting/index.tsx` — modify**
Derive `conflicts = busy ∧ free` and `live = conflicts \ kept`; `kept` is session state, never
persisted. Fill action paints every non-booked slot and never unpaints, persisting through the
existing `PATCH .../availability`. Batch clear and keep. Remove the drain-before-check dance and **`editCountAtSyncRef` only** — availability now has one
writer (ADR-2). **`editCountRef` (`painting/index.tsx:96,100`) stays:** it guards a stale PATCH
response against newer optimistic paint, which is paint-vs-paint and has nothing to do with the
calendar. Deleting it would reintroduce an unrelated race.

`busy` is preserved across **every** write to the cache entry — optimistic paint, the rollback
snapshot, and any mutation response. The PATCH and open-route responses carry no `busy`, so a
mutation response must be **merged into** the cached record, never substituted for it, or the layer
vanishes on the next paint.
→ **AC-002, AC-020, AC-021, AC-022, AC-027, AC-028, AC-037, AC-040**

**C-16 · `src/components/ui/chip/index.tsx` — modify**
Add `primary` (the `selected` skin without `aria-pressed`) and `aria-disabled` support that keeps
the control focusable and in tab order, with `aria-describedby`. Targets stay ≥24×24.
→ **AC-025, AC-032**

**C-17 · `src/services/api.ts` and `src/types.ts` — modify**
Client for the authed availability read; response type gains `busy`, `calendarStatus`, `busyWindow`.
**The authed read is the sole populator of the cache entry for signed-in owners**, and it
**falls back to the unauthenticated read on 401/403** — a signed-in participant whose record is not
yet linked (`user.googleSub` null) otherwise races the parent's claim, gets a 403, and
`painting/index.tsx:237` renders `null`: a blank grid, not a calendar-less one.
`CalendarSyncResult` is reshaped — `applied` and `markedBusyCount` are gone (C-6).
→ **AC-003, AC-044**

**C-18 · `src/components/privacy-policy/index.tsx` — modify**
Three affected passages, not two:
- **:105-107** — delete `Hours marked busy by your calendar stay busy. You can mark yourself free
  again at any time.` The mechanism is gone.
- **:31-32** — the whole sentence is rewritten. Both halves fail: "look exactly like" is false on
  the owner's own screen, and **"nobody on the poll can tell which is which" is falsified by
  AC-020** — after a one-tap fill, stored `free` is the complement of busy within the poll window,
  and `free` is public to link-holders. The replacement claims only that the stored record keeps no
  record of which hours came from a calendar.
- **:105-106** — the 90-day retention sentence. AC-038 makes "every check restarts that clock"
  true, but C-5's retention bound falsifies "we keep… the busy times we've saved" for that whole
  period. The clause needs the bound.

Wording via the `plainspoken-privacy-policy` skill; budget at most one added clause across all three.
→ **AC-043**

**C-19 · UI tests — create/modify**
`grid.test.tsx`, `elements.test.tsx`, `index.test.tsx`, `services/api.test.ts`,
`test/pages/privacy-policy.test.tsx`. State asserted through accessible names only — UI
`CLAUDE.md:37` bars CSS/style assertions. Delete the settle-and-check-once machinery tests and the
additive-contract copy assertions, which police behavior being replaced — the full list is larger
than the first draft's "the four": `post-calendar-sync.test.ts:100,108,119,134,158,170,178,187,203,213`,
`elements.test.tsx:32,64,71,78,83,90,205,233`, `api.test.ts:477-486`.

Coverage gates are **global, not per-file**, so deleting tests alongside their source is neutral.
The real exposure is UI **branch** coverage at 80%: the copy table adds ~20 singular/plural
branches. Cover them **table-driven**, one case per branch, not one test per string.
→ **AC-002, AC-013, AC-017, AC-018, AC-019, AC-020, AC-021, AC-022, AC-024, AC-025, AC-027, AC-028, AC-029, AC-031, AC-032, AC-033, AC-034, AC-035, AC-036, AC-037, AC-039, AC-040**

---

## Traceability matrix

Gate: every live AC appears in ≥1 change; every change carries ≥1 AC; every AC names a live `P-n`;
and each named change can actually deliver the criterion as written.

**44 AC IDs issued. WITHDRAWN: AC-004, AC-016, AC-023, AC-039. Live: 40.**

| AC | Parent | Changes |
|---|---|---|
| AC-001 | P-c | C-4, C-6, C-10 |
| AC-002 | P-c | C-4, C-6, C-15, C-19 |
| AC-003 | P-c | C-1, C-9, C-17 |
| AC-004 | — | **WITHDRAWN** — superseded by AC-030 + AC-042 |
| AC-005 | P-c | C-1, C-2, C-3, C-8, C-10 |
| AC-006 | P-c | C-2, C-3, C-10 |
| AC-007 | P-c | C-1, C-6, C-8, C-10 |
| AC-008 | P-c | C-1, C-10 |
| AC-009 | P-c | C-4, C-8, C-10 |
| AC-010 | P-c | C-10 |
| AC-011 | P-c | C-1, C-6, C-8, C-10 |
| AC-012 | P-c | C-7, C-10 |
| AC-013 | P-c | C-11, C-12, C-19 |
| AC-014 | P-c | C-11, C-12 |
| AC-015 | P-c | C-11, C-12 |
| AC-016 | — | **WITHDRAWN** — superseded by AC-041 |
| AC-017 | P-c | C-12, C-19 |
| AC-018 | P-c | C-12, C-19 |
| AC-019 | P-c | C-14, C-19 |
| AC-020 | P-b | C-15, C-19 |
| AC-021 | P-b | C-14, C-15, C-19 |
| AC-022 | P-b | C-15, C-19 |
| AC-023 | — | **WITHDRAWN** — superseded by AC-037 |
| AC-024 | P-b | C-14, C-19 |
| AC-025 | P-b | C-16, C-19 |
| AC-026 | P-c | C-5, C-10 |
| AC-027 | P-c | C-15, C-19 |
| AC-028 | P-c | C-15, C-19 |
| AC-029 | P-c | C-14, C-19 |
| AC-030 | P-c | C-1, C-5, C-6, C-9, C-12, C-14, C-10, C-19 |
| AC-031 | P-c | C-12, C-14, C-15, C-19 |
| AC-032 | P-c | C-14, C-16, C-19 |
| AC-033 | P-c | C-14, C-19 |
| AC-034 | P-c | C-1, C-6, C-9, C-14, C-19 |
| AC-035 | P-c | C-14, C-19 |
| AC-036 | P-c | C-14, C-19 |
| AC-037 | P-b | C-15, C-19 |
| AC-038 | P-c | C-5, C-9, C-10 |
| AC-039 | — | **WITHDRAWN** — superseded by AC-043 |
| AC-040 | P-b | C-15, C-19 |
| AC-041 | P-c | C-11, C-12, C-13 |
| AC-042 | P-c | C-1, C-9, C-14, C-19 |
| AC-043 | P-c | C-18, C-19 |
| AC-044 | P-c | C-15, C-17, C-19 |

**Reverse check — every change carries an AC:**
C-1 ✓ · C-2 ✓ · C-3 ✓ · C-4 ✓ · C-5 ✓ · C-6 ✓ · C-7 ✓ · C-8 ✓ · C-9 ✓ · C-10 ✓ · C-11 ✓ ·
C-12 ✓ · C-13 ✓ · C-14 ✓ · C-15 ✓ · C-16 ✓ · C-17 ✓ · C-18 ✓ · C-19 ✓

**Parent check:** every live AC names P-b or P-c. AC-038, AC-042 and AC-043 trace to P-c by the
extended reading recorded in `brief.md` and D-17 — a feature that leaves the app making false
statements about itself is P-c's trust failure in another surface.

**Deliverability check** — the four rows the first draft got wrong, now repaired:
- AC-030 / AC-034 / AC-042 were undecidable client-side until C-1 and C-9 added `calendarStatus`.
- AC-002 needed the server changes (C-4, C-6), not only the client.
- AC-031 needed grid and cache behavior (C-12, C-15), not only strip copy.
- AC-012 lost C-7's redaction helper to YAGNI and is now carried by tests.

**No orphans in either direction. Gate passes.**

---

## Non-blocking findings, carried forward

Logged rather than fixed here (`decisions.md` D-21): line-reference drift across artifacts
(`template.yaml:700→703`, `812→815`, `758→761`; `architecture.md:124` cites `config.ts:11`, which is
`maxPollDates`, not `calendarSyncFreshnessMs` at `:47`); `elements.tsx:137-146` already satisfies
AC-036, so C-14 preserves rather than adds it; C-14's new prop should follow the existing
`isChecking`/`isConnecting` naming; `decisions.md` D-11 still quotes "painted N hours".
