# Spec — Calendar-assisted availability

Change rundown and traceability matrix. 40 AC IDs issued; **AC-004 and AC-023 are WITHDRAWN**, so
38 are live and every one must appear below.

**Correction to `design.md`:** it lists `pick-a-time-api/src/services/dynamodb.ts` as modified. It
is not — `getAvailability`, `getUser` and `getCalendarAccount` already exist with the shapes the
new handler needs. Removed here rather than carried as a change with no acceptance criterion.

---

## Change rundown

### API — `pick-a-time-api`

**C-1 · `src/handlers/get-availability-authed.ts` — create**
Cognito-authorized read returning `{ userId, free, expiration, busy }`. Loads the poll, the named
participant, and the **caller's own** calendar account by `auth.googleSub`; 403 when
`user.googleSub !== auth.googleSub` or the sub is null. Computes `busy` via `buildBusyGrid` against
this poll. Delegates the refresh decision to C-5. Sets `Cache-Control: private, no-store` and
`Vary: Authorization`. Its own file, so the open route has no code path to busy data (ADR-1).
→ **AC-003, AC-005, AC-007, AC-008, AC-011, AC-034**

**C-2 · `src/handlers/get-availability.ts` — modify**
Extract the record read into a shared service so C-1 does not duplicate it. Response stays
byte-identical: `stripCalendarCheckedAt`, no `busy` key, no Google call reachable.
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
Bound cached intervals by a retention window derived from the poll TTL and prune on write; hard cap
as a backstop. Refresh `expiration` on every successful check. Surface a failed persist instead of
swallowing it. Keep the freshness window and `syncedRange` coverage check — now the only rate limit
(D-6). Keep the `'error'`-is-never-fresh clause.
→ **AC-026, AC-030, AC-038**

**C-6 · `src/handlers/post-calendar-sync.ts` — modify**
No longer writes availability. Refreshes from Google and returns the fresh busy grid. Delete the
`hasFreeCell` guard and the `calendarCheckedAt` lock; keep the stamp as a timestamp. Keep the 403
ownership check and the 502-on-upstream-failure path.
→ **AC-001, AC-002, AC-007, AC-030, AC-034**

**C-7 · `src/utils/logging.ts` — modify**
Response-side redaction sibling covering `busy`, `busyIntervals`, `syncedRange`. Existing
counts-only discipline preserved.
→ **AC-012**

**C-8 · `template.yaml` — modify**
New function, route `GET /sessions/{sessionId}/users/{userId}/availability/authed` with
`CognitoAuthorizer`, and its log group + subscription. `GetOverlapFunction` gains **no** KMS or SSM
grant. New function gets KMS decrypt scoped to `CalendarTokenKey` only.
→ **AC-005, AC-007, AC-009, AC-011**

**C-9 · `src/types.ts` — modify**
`busy: boolean[][]` on the owner-only availability response type.
→ **AC-003**

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
existing `PATCH .../availability`. Batch clear and keep. Remove the drain-before-check dance and the
`editCount` guards — availability now has one writer (ADR-2). Preserve `busy` across every
optimistic `setQueryData`, the rollback snapshot included.
→ **AC-002, AC-020, AC-021, AC-022, AC-027, AC-028, AC-037, AC-040**

**C-16 · `src/components/ui/chip/index.tsx` — modify**
Add `primary` (the `selected` skin without `aria-pressed`) and `aria-disabled` support that keeps
the control focusable and in tab order, with `aria-describedby`. Targets stay ≥24×24.
→ **AC-025, AC-032**

**C-17 · `src/services/api.ts` and `src/types.ts` — modify**
Client for the authed availability read; response type gains `busy`.
→ **AC-003**

**C-18 · `src/components/privacy-policy/index.tsx` — modify**
Delete the two sentences at :105-107. Reword :31-32 so the "nobody can tell which is which" claim
survives and the "look exactly like" claim does not. Wording via the
`plainspoken-privacy-policy` skill; budget at most one added clause.
→ **AC-039**

**C-19 · UI tests — create/modify**
`grid.test.tsx`, `elements.test.tsx`, `index.test.tsx`, `services/api.test.ts`,
`test/pages/privacy-policy.test.tsx`. State asserted through accessible names only — UI
`CLAUDE.md:37` bars CSS/style assertions. Delete the settle-and-check-once machinery tests and the
additive-contract copy assertions, which police behavior being replaced.
→ **AC-002, AC-013, AC-017, AC-018, AC-019, AC-020, AC-021, AC-022, AC-024, AC-025, AC-027, AC-028, AC-029, AC-031, AC-032, AC-033, AC-034, AC-035, AC-036, AC-037, AC-039, AC-040**

---

## Traceability matrix

Gate: every live AC appears in ≥1 change; every change carries ≥1 AC; every AC names a live `P-n`.

| AC | Parent | Changes |
|---|---|---|
| AC-001 | P-c | C-4, C-6, C-10 |
| AC-002 | P-c | C-15, C-19 |
| AC-003 | P-c | C-1, C-9, C-17 |
| AC-004 | — | **WITHDRAWN** — superseded by AC-030 |
| AC-005 | P-c | C-1, C-2, C-3, C-8, C-10 |
| AC-006 | P-c | C-2, C-3, C-10 |
| AC-007 | P-c | C-1, C-6, C-8, C-10 |
| AC-008 | P-c | C-1, C-10 |
| AC-009 | P-c | C-4, C-8, C-10 |
| AC-010 | P-c | C-10 |
| AC-011 | P-c | C-1, C-8, C-10 |
| AC-012 | P-c | C-7, C-10 |
| AC-013 | P-c | C-11, C-12, C-19 |
| AC-014 | P-c | C-11, C-12 |
| AC-015 | P-c | C-11, C-12 |
| AC-016 | P-c | C-13 |
| AC-017 | P-c | C-12, C-19 |
| AC-018 | P-c | C-12, C-19 |
| AC-019 | P-c | C-14, C-19 |
| AC-020 | P-b | C-15, C-19 |
| AC-021 | P-b | C-15, C-19 |
| AC-022 | P-b | C-15, C-19 |
| AC-023 | — | **WITHDRAWN** — superseded by AC-037 |
| AC-024 | P-b | C-14, C-19 |
| AC-025 | P-b | C-16, C-19 |
| AC-026 | P-c | C-5, C-10 |
| AC-027 | P-c | C-15, C-19 |
| AC-028 | P-c | C-15, C-19 |
| AC-029 | P-c | C-14, C-19 |
| AC-030 | P-c | C-5, C-6, C-12, C-14 |
| AC-031 | P-c | C-14, C-19 |
| AC-032 | P-c | C-14, C-16, C-19 |
| AC-033 | P-c | C-14, C-19 |
| AC-034 | P-c | C-1, C-6, C-14, C-19 |
| AC-035 | P-c | C-14, C-19 |
| AC-036 | P-c | C-14, C-19 |
| AC-037 | P-b | C-15, C-19 |
| AC-038 | P-c | C-5, C-10 |
| AC-039 | P-c | C-18, C-19 |
| AC-040 | P-b | C-15, C-19 |

**Reverse check — every change carries an AC:**
C-1 ✓ · C-2 ✓ · C-3 ✓ · C-4 ✓ · C-5 ✓ · C-6 ✓ · C-7 ✓ · C-8 ✓ · C-9 ✓ · C-10 ✓ · C-11 ✓ ·
C-12 ✓ · C-13 ✓ · C-14 ✓ · C-15 ✓ · C-16 ✓ · C-17 ✓ · C-18 ✓ · C-19 ✓

**Parent check:** every AC above names P-b or P-c, both live. AC-038 and AC-039 trace to P-c by the
extended reading recorded in `brief.md` and D-17.

**No orphans in either direction. Gate passes.**
