# Design — Calendar-assisted availability

Handoff spec. Produced by `ui-design-options`; three options generated blind, audited, critiqued,
and converged. Live renders and the full critique:
<https://claude.ai/code/artifact/e0519f00-f86d-447b-bc41-eb2118565dc6>

## Decision

**The reviewer's cut: option B as the base, with grafts from A and C.**

> The calendar stays quiet until it disagrees with you.

Booked time is a whisper where you have claimed nothing, and loud where you have claimed something
it contradicts. Disagreements are settled in one action, or kept deliberately. The bulk action is
additive only — it paints, never unpaints.

**Why B over A.** P-b is the primary problem, and B is the only option whose main flow keeps a
stored answer true to the calendar *over time* rather than at the single moment a button is pressed.
That property is also what withdrew D-7: the conflict flow is the reconcile mechanism named at
Stop 2 as the only leak-free way to keep the group's overlap honest, and B delivers it as its
headline rather than as extra scope.

**Runner-up: A, and why not.** A renders state better than anything else in the set and has the most
careful failure handling — both grafted in below. It loses because it only ever informs: a
participant who paints quickly and ignores the layer ends up exactly where they started, which is
P-b unsolved. It also introduces the only new palette token in the set.

## Grafts

| From | What | Why |
|---|---|---|
| A | Five-state cell rendering, including the `--ink` marker for painted-over-a-booking | A proved no color clears 3:1 against **both** `--ink` and `--accent` — the ceiling is ≈2.17:1 — so the marker must be `--ink` at 6.50:1 on the accent fill. This is a fact about the palette, not a preference |
| A | Failure behavior: remove the layer rather than draw it stale; the fill control takes `aria-disabled` but stays focusable with the reason visible | The most careful failure handling in the set, and it generalizes to the `checking` state |
| A | "Slots", never "hours", as the counted unit | Slots slide (5:30–7, 6–7:30, 6:30–8), so three slots is not three hours |
| C | One governing rule: **the system never overrules a hand decision** | C states it as a rule about days; generalized it is B's own thesis expressed better, and it governs every automatic behavior in the feature |

## Rejected by design

- **A's confirmation dialog.** With an additive bulk action there is nothing to confirm. It only
  earns its place if the action may unpaint, and it may not (AC-037).
- **A's `--busy` token.** B reaches the same separation without adding to the palette.
- **C's mode.** Removing a set-aside day's cells from the DOM strains AC-018, and a persisted
  per-user view mode means two people open the same poll and see different grids.
- **A hatch or any texture.** The app has no texture precedent; `border-dashed` is taken by
  `DISABLED_CELL_CLASS`. A rejected it on three grounds — stripes read as hazard tape, they alias
  at zoom and break the 150ms `transition-colors`, and the glyph channel had room.
- **Persisting the `kept` set.** Which conflicts a participant chose to live with stays session
  state. Persisting it would store a decision about someone's calendar in a poll record — the
  provenance the 2026-08-01 spec deliberately refused to keep.

## Shared components

| Component | Action | Path |
|---|---|---|
| `Chip` | **modify** — add a `primary` prop: the existing `selected` skin without `aria-pressed`, plus `aria-disabled` support that keeps the control focusable | `pick-a-time-ui/src/components/ui/chip/index.tsx` |
| `FOCUS_RING` | reuse unchanged | `pick-a-time-ui/src/components/ui/focus-ring.ts` |
| `BOOKED_CELL_FRAGMENT`, `CONFLICT_CELL_FRAGMENT` | **new** — exported beside `DISABLED_CELL_CLASS`, so the three "not a normal cell" treatments are compared whenever any changes. Named *fragment* because unlike its neighbour it is the varying half of a cell, not a whole class list — and with no tailwind-merge here, layering two `bg-*` utilities is resolved by stylesheet order, so the call site picks one in a ternary | `pick-a-time-ui/src/components/poll/slot-columns.ts` |
| `GridKey` | **new** — small, modelled on the heat-grid legend row (`flex items-center gap-1 text-[10px] text-[var(--slate)]`, `h-3 w-3 rounded` swatches) | `pick-a-time-ui/src/components/poll/painting/elements.tsx` |
| `PaintGrid` | **modify** — the single `on` boolean in the className expression becomes a derived `painted`/`booked` pair | `pick-a-time-ui/src/components/poll/painting/grid.tsx` |
| `CalendarStrip` | **modify** — two new branches in `contentFor`/`actionsFor`; new props `conflictCount`, `fillableCount`, `skippedCount`, `onFill`, `onClearConflicts`, `onKeepConflicts`. Stays presentational and prop-driven | `pick-a-time-ui/src/components/poll/painting/elements.tsx` |
| `buildBusyGrid`, `toBusyBlocks` | reuse unchanged | `pick-a-time-api/src/services/overlap.ts:75-89` |

## Cell state vocabulary

Five treatments. All are live, focusable `<button>`s; every glyph, ring and marker is
`aria-hidden`.

| State | Fill | Non-color channel | Accessible name |
|---|---|---|---|
| Unpainted, not booked | `bg-[var(--bone)]/10` | — | `Wed, Aug 12, 5:30–7:00 PM` |
| Painted, not booked | `bg-[var(--accent)]` | `Check`, `text-[var(--ink)]/70` | …, `aria-pressed="true"` |
| Booked, unpainted | `bg-[var(--bone)]/16` | `Clock` glyph in `--slate` (**3.80:1 on the booked fill** — 5.98:1 is the page measurement, which no reader sees) | `…, booked` |
| Booked **and** painted (conflict) | `bg-[var(--accent)]` | `Check` **plus** an `--ink` marker bar (6.50:1 on accent) | `…, booked`, `aria-pressed="true"` |
| Out of this date's window | `DISABLED_CELL_CLASS` — dashed, `bg-[var(--bone)]/[0.03]` | not a button, `aria-hidden` | — |

Booked is never dashed and never fainter than the unpainted fill, so it cannot be confused with the
out-of-window treatment (AC-014). The fill steps are decorative; **the glyph carries the meaning**,
which is what satisfies AC-015 and AC-016 — the `--bone` family cannot clear 3:1 below α≈0.40, and
a fill that loud would misread as a warning.

## Copy

`[live]` = the strip's single `aria-live="polite"` detail node. `[a11y]` = accessible name or
screen-reader-only text.

### Toolbar and explanatory lines

| Element | Condition | String |
|---|---|---|
| Toolbar chip | always | `Select all` |
| Toolbar chip | always | `Clear all` |
| Line 1 | always | `Each column is a 90-minute slot.` |
| Line 2 | busy layer drawn (`connected` or `checking`) | `We only check your primary calendar, and only the dates in this poll.` |
| Line 3 | `checking` — `aria-describedby` target of the inert fill chip | `You can fill in what's free once the check finishes.` |
| Line 3 | `error` — `aria-describedby` target of the inert fill chip | `You can fill in what's free once we reach your calendar.` |

### Key

| Element | Condition | String |
|---|---|---|
| Heading `[a11y]` | key rendered | `Key` |
| Item 1 | ≥1 booked, unmarked square on screen | `Booked on your calendar` |
| Item 2 | ≥1 marked-and-booked square on screen | `Marked free, but booked` |
| — | no booked square on screen | *not rendered* |

### Strip — `not_connected`

| Element | String |
|---|---|
| Title | `Fill this in from your calendar` |
| Detail `[live]` | `Connect Google Calendar and we'll show where your primary calendar says you're booked, then fill in the rest in one tap. We never mark anything you didn't ask for. We see when you're busy — never event titles, guests, or locations.` |
| Chip, primary | `Connect` |
| Chip | `Not now` |

### Strip — connecting *(unchanged from shipping)*

| Element | String |
|---|---|
| Detail `[live]` | `Connecting to Google Calendar…` |
| Chip, disabled | `Connecting…` |

### Strip — `checking`

| Element | String |
|---|---|
| Title | `Google Calendar connected` |
| Detail `[live]` | `Checking your calendar… The booked squares on screen are from the last check.` |
| Chip, `aria-disabled`, `aria-describedby` line 3 | `Fill in what's free` |
| Chip, `aria-disabled` | `Checking…` |

### Strip — `connected`, at rest

| Element | Condition | String |
|---|---|---|
| Title | all | `Google Calendar connected` |
| Detail `[live]` | nothing marked, ≥1 booked slot | `The grid shows where your calendar says you're booked. One tap marks everything else free.` |
| Detail `[live]` | check returned nothing booked | `Checked just now · nothing booked on your primary calendar, Aug 12–25` |
| Detail `[live]` | something marked, none of it booked | `Nothing you marked is booked on your calendar.` |
| Detail `[live]` | after `Check again`, no change | `Checked just now · your booked time hasn't changed` |
| Chip, primary | ≥1 unmarked, unbooked slot | `Fill in what's free` |
| Chip | always | `Check again` |

### Strip — after `Fill in what's free`

| Element | Condition | String |
|---|---|---|
| Detail `[live]` | n marked, m booked slots skipped | `Marked 23 slots free · skipped 7 booked slots` |
| Detail `[live]` | n = 1 | `Marked 1 slot free · skipped 7 booked slots` |
| Detail `[live]` | m = 1 | `Marked 23 slots free · skipped 1 booked slot` |
| Detail `[live]` | m = 0 | `Marked 30 slots free` |
| Detail `[live]` | n = 0 (defensive; chip normally absent) | `Nothing left to fill. Nothing on your grid changed.` |

> **`m` is the number of booked slots the fill actually skipped — not the total booked count.**
> On a partly-painted grid those differ, and the difference is a correctness bug, not a wording
> choice. Carried as AC-040.

### Strip — review mode (≥1 unresolved conflict)

| Element | Condition | String |
|---|---|---|
| Title | all counts | `Marked free, but booked` |
| Detail `[live]` | n ≥ 2 | `7 slots you marked free are booked on your calendar.` |
| Detail `[live]` | n = 1 | `1 slot you marked free is booked on your calendar.` |
| Chip, primary | n ≥ 2 | `Clear these 7` |
| Chip, primary | n = 1 | `Clear this one` |
| Chip | n ≥ 2 | `Keep them` |
| Chip | n = 1 | `Keep it` |

The title is a flat statement of fact, matching every title in the voice sample. It does not
personify the calendar and does not editorialize, so it holds at 1 conflict and at 25 of 30.

### Strip — after a batch resolution

| Element | Condition | String |
|---|---|---|
| Title | | `Google Calendar connected` |
| Detail `[live]`, cleared | n ≥ 2 | `Cleared 7 slots · nothing you marked is booked now` |
| Detail `[live]`, cleared | n = 1 | `Cleared 1 slot · nothing you marked is booked now` |
| Detail `[live]`, kept | n ≥ 2 | `Kept 7 slots · we won't ask again unless you change them` |
| Detail `[live]`, kept | n = 1 | `Kept 1 slot · we won't ask again unless you change it` |

### Strip — `error`

| Element | String |
|---|---|
| Title | `We couldn't reach Google Calendar` |
| Detail `[live]` | `Nothing on your grid changed. Booked squares are hidden until we can check again.` |
| Chip, `aria-disabled`, `aria-describedby` line 3 | `Fill in what's free` |
| Chip, primary | `Try again` |
| Key, Line 2 | *not rendered* |

### Grid

| Element | String |
|---|---|
| Column headers, visible | `5:30p–7` · `6p–7:30` · `6:30p–8` |
| Column headers `[a11y]` | `5:30–7:00 PM` · `6:00–7:30 PM` · `6:30–8:00 PM` |
| Row labels `[a11y]` | `Wed, Aug 12` … `Tue, Aug 25` |
| Cell `[a11y]`, not booked | `Wed, Aug 12, 5:30–7:00 PM` |
| Cell `[a11y]`, booked (marked or not) | `Thu, Aug 20, 5:30–7:00 PM, booked` |
| Cell `[a11y]`, `error` state | busy suffix **dropped** — the layer is not drawn, so the name must not claim it |

### Privacy policy — `pick-a-time-ui/src/components/privacy-policy/index.tsx`

| Line | Action |
|---|---|
| :105-107 | **Delete** — `Hours marked busy by your calendar stay busy. You can mark yourself free again at any time.` Describes a mechanism that no longer exists |
| :31-32 | **Reword** — the clause "nobody on the poll can tell which is which" stays true and is enforced by AC-005/009/010; "look exactly like hours you crossed out by hand" becomes false on the owner's own screen |
| :105-106 | **No change needed** once AC-038 lands — "every check restarts that clock" becomes true rather than being weakened |

Wording for the reword is produced by the `plainspoken-privacy-policy` skill at implementation
time, not fixed here. Budget: at most one clause added.

## Accessibility

- Every cell stays a live `<button>`: focusable, in tab order, never `disabled`, never
  `aria-hidden` (AC-018). This is what C forfeited and the cut keeps.
- State is announced through the accessible **name** — a comma-appended `, booked` suffix, matching
  the `statusSuffix` pattern at `results/heat-grid.tsx:308` — because UI `CLAUDE.md:37` bars CSS and
  style assertions in tests, so the name is the only testable channel.
- **The strip's live region is one persistent DOM node** across every state transition, updated by
  text content only (AC-036). A remount silently drops the announcement.
- Inert controls use `aria-disabled` plus `aria-describedby` pointing at an on-screen reason, never
  `disabled` — which would remove them from the tab order and strand a keyboard user with no
  explanation (AC-032).
- Contrast: booked glyph `--slate` 5.98:1; conflict marker `--ink` on `--accent` 6.50:1; painted
  fill `--accent` 6.50:1. Verified by a `*-contrast.test.ts` beside the component, parsing
  `index.css` via `src/utils/contrast.ts` — the project's existing acceptance vehicle.
- Targets are 3rem × `h-8` (48×32px at a 16px root), clearing SC 2.5.8's 24×24 AA minimum. SC 2.5.5
  (44×44) is Level AAA and not the operative bar — `slot-columns.ts:45-46` documents this correctly.
- `prefers-reduced-motion` honored; the only motion is the existing `duration-150 ease-out`.

## Data and API

Per ADR-1 and ADR-2.

- **New:** `GET /sessions/{sessionId}/users/{userId}/availability/authed`, Cognito-authorized,
  backed by its **own handler file** so the unauthenticated route has no code path to busy data.
  Returns `{ userId, free, expiration, busy }` where `busy: boolean[][]` is `buildBusyGrid`'s output
  for this poll. 403 when `user.googleSub !== auth.googleSub`. Headers `Cache-Control: private,
  no-store` and `Vary: Authorization`.
- **Changed:** `POST .../calendar/sync` no longer touches availability. It refreshes cached
  intervals from Google and returns the fresh busy grid. Idempotent.
- **Deleted:** `markBusyHours` and its tests; the `hasFreeCell` guard; the one-check-per-poll lock.
- **Unchanged:** `GET .../availability`, `PATCH .../availability`, `GET .../overlap`, `GET .../users`
  — byte-identical responses, no new fields, no KMS/SSM grant added to `GetOverlapFunction`.
- Client: busy rides the existing `['availability', sessionId, userId]` cache entry (D-9). Every
  optimistic `setQueryData` must preserve it; the rollback snapshot and any response overwrite are
  the two places that can drop it.

## Design-system deltas

- `Chip` gains a `primary` prop and `aria-disabled` support. **Not a new token.**
- `BOOKED_CELL_CLASS` and `CONFLICT_CELL_CLASS` — new exported class constants. Composed entirely
  from existing tokens.
- **No new color, font, radius, shadow, easing, duration, or breakpoint.** A's `--busy` was the only
  proposed new token and it was rejected.

## Analytics

None. The app has no analytics pipeline, and adding one is out of scope. The brief's success
measure is observed through the existing `log('Calendar check complete', { … })` counts, which
already emit counts only and never intervals (AC-012).

## Feature flag and rollout

None. The change is non-destructive by construction and reversible by removing a render branch and
a prop — no stored data to migrate back. Poll-scoped records carry a 14-day TTL, so any record
damaged by the old destructive write self-heals within two weeks of the deploy.

## Edge cases

| Case | Behavior |
|---|---|
| Every slot booked | Fill chip absent; strip reports `Nothing left to fill. Nothing on your grid changed.` |
| Nothing booked in range | Connected title, success-shaped report naming calendar and date range, no key, fill stays available (AC-034) |
| Check fails mid-session | Layer removed, key and scope line dropped, cell names drop the busy suffix, fill inert with a visible reason (AC-030) |
| Conflict created *after* a `Keep` | Review returns — `kept` is keyed per slot, so a newly conflicting slot is not covered by an earlier decision (AC-028) |
| Poll dates outside the retention window | No underlay for those dates; the poll is itself within days of expiry (ADR-4) |
| 390px, 20 columns | Table `min-width` in rem forces horizontal scroll inside the scrollport; page body never scrolls sideways |
| Longest label (`Wed May 28`) | Label column pinned at 5.25rem; see `slot-columns.ts:51-62` |
| Participant claims an unlinked record, then reads busy | Grid is computed from the **caller's** account, never the record's prior state (AC-008) |

## New AC forced by this phase

**AC-040 (P-b)** — The fill reports what it actually skipped
```
Given a partly painted grid where some booked slots are already painted free
When  the participant activates the fill
Then  the reported skipped count is the number of booked slots the fill left unpainted,
      not the total number of booked slots
Verify: automated
```

## Open questions

1. **Should `Check again` remain visible while the review bar is showing?** The strip is now doing
   four jobs, and the review state is the only one where a second primary-ish action competes with
   the resolution chips. Not resolved here; decide during implementation with the real component
   on screen.
2. **Does the fill chip belong in the strip or the toolbar?** D-10 left this open. The strip owns
   the `aria-live` region AC-024 needs, which argues for the strip; `Select all` / `Clear all` are
   its natural siblings, which argues for the toolbar. The renders place it in the strip.

---

## Sections for the plan

### Files — API (`pick-a-time-api`)

- `src/handlers/get-availability-authed.ts` — **create**
- `src/handlers/post-calendar-sync.ts` — **modify**
- `src/handlers/get-availability.ts` — **modify** (extract shared read into a service)
- `src/services/overlap.ts` — **modify** (delete `markBusyHours`; keep `buildBusyGrid`)
- `src/services/calendar-sync.ts` — **modify** (retention bound; refresh `expiration`; surface persist failure)
- `src/services/dynamodb.ts` — **modify**
- `src/utils/availability.ts` — **modify**
- `src/utils/logging.ts` — **modify** (response-side redaction for busy)
- `template.yaml` — **modify** (new route + function + log group)
- `__tests__/unit/handlers/get-availability-authed.test.ts` — **create**
- `__tests__/unit/handlers/post-calendar-sync.test.ts` — **modify**
- `__tests__/unit/services/overlap.test.ts` — **modify**
- `__tests__/unit/services/calendar-sync.test.ts` — **modify**
- `__tests__/unit/__mocks__.ts` — **modify**

### Files — UI (`pick-a-time-ui`)

- `src/components/poll/painting/grid.tsx` — **modify**
- `src/components/poll/painting/elements.tsx` — **modify**
- `src/components/poll/painting/index.tsx` — **modify**
- `src/components/poll/slot-columns.ts` — **modify**
- `src/components/ui/chip/index.tsx` — **modify**
- `src/services/api.ts` — **modify**
- `src/types.ts` — **modify**
- `src/components/privacy-policy/index.tsx` — **modify**
- `src/components/poll/painting/booked-contrast.test.ts` — **create**
- `src/components/poll/painting/grid.test.tsx` — **modify**
- `src/components/poll/painting/elements.test.tsx` — **modify**
- `src/components/poll/painting/index.test.tsx` — **modify**
- `src/services/api.test.ts` — **modify**
- `test/pages/privacy-policy.test.tsx` — **modify**

### Interfaces

- **Provides:** `busy: boolean[][]` on the authed availability response; `BOOKED_CELL_CLASS` /
  `CONFLICT_CELL_CLASS`; `Chip`'s `primary` prop.
- **Consumes:** `buildBusyGrid` (exists); the heat-grid ring span (exists); `src/utils/contrast.ts`
  (exists).
