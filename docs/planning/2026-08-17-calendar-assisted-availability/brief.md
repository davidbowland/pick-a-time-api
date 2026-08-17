# Brief — Calendar-assisted availability

## Problems

**P-b — transcription labor** *(primary)*

> A participant has to re-enter information their calendar already holds. They read their
> calendar in another tab and hand-copy their availability into the grid; the calendar can
> only prune that afterward, never supply it. The work the calendar was supposed to remove
> is still done by hand.

**P-c — invisible and untrustworthy**

> A participant cannot tell whether the calendar did anything. A cell the check marked busy
> is pixel-identical to one they never painted, so they cannot confirm it ran, cannot spot
> when it is wrong, and cannot build trust in it.

Withdrawn at Stop 1: **P-a** (empty-grid dead end — a symptom of P-b), **P-d** (overstated
availability — different victim, different feature). See `decisions.md` D-1.

## Scope

**In:** a non-destructive, owner-private busy layer rendered on the participant's own grid
(design option C); a one-tap "Start from my calendar" that paints non-conflicting slots
(design option B).

**Out:** widening the OAuth scope beyond `freeBusy`; secondary/shared calendars; inverting
the paint model; changes to the overlap/results view; other calendar providers; writing
events back to Google.

## Recon digest

### This was built before, and removed on purpose

A read-time busy layer shipped in July (`656674d`, `aae41e3`) and was torn out on 2026-08-01
(`9b799b8`, `fc2e5f3`, `c9df5b1`). The spec that removed it
(`docs/superpowers/specs/2026-08-01-calendar-marks-booked-hours-busy-design.md:5-18`) names
three failure modes: it was invisible on your own screen, it **could not be overridden**
("the filter re-applies on every read"), and it **leaked** (`excludedByCalendar` told every
participant that a named person was booked at a specific hour).

The proposed layer differs from July's on the axis that caused all three: July's filter fed
`computeGrid`, so it *decided* availability on every read. This one never touches `free` and
never reaches the overlap — it only draws. That is a load-bearing constraint, not a
preference: the moment the layer reaches overlap or results, failure modes 2 and 3 are both
rebuilt.

### Machinery that already exists

`buildBusyGrid` and `toBusyBlocks` survived the August removal (`src/services/overlap.ts:75-89`),
are already non-destructive and timezone-correct per reading poll, and carry 11 passing tests
(`__tests__/unit/services/overlap.test.ts:6-157`). This work is mostly plumbing that function
into an authorized read path, not new computation.

### The keyspace forces a second read

`CalendarAccountRecord` is keyed `google#{googleSub}` / `CALENDAR`; `AvailabilityRecord` is
keyed `{sessionId}` / `AVAIL#{userId}` (`src/services/dynamodb.ts:71,88,244,256`). One table,
no GSI. A read-time busy grid therefore needs a second `GetItem` against a different partition
(~1 RCU).

### The unauthenticated routes cannot carry busy data

`GET .../availability`, `PATCH .../availability`, and `GET .../overlap` are all
`Authorizer: NONE` (`template.yaml:700,812,758`) — the poll link is the credential, and
`{userId}` is a free path parameter. `stripCalendarCheckedAt` (`src/utils/availability.ts:8`)
establishes the project's bar: *calendar connection state is private between participants*.
`GetOverlapFunction` had its KMS/SSM grants deliberately removed (`template.yaml:742-749`).

### Which guardrails survive the write becoming non-destructive

My going-in hypothesis was "most of them evaporate." Recon corrected it:

| Guardrail | Verdict |
|---|---|
| one-check-per-poll (`calendarCheckedAt` as a lock) | **evaporates** — existed only to avoid silently undoing a deliberate edit |
| `calendarCheckedAt` as a stamp | **demote, don't delete** — still the "checked X ago" source |
| freshness window + `syncedRange` cache | **fully survives, and becomes the only rate limit** |
| `hasFreeCell` empty-grid guard | **evaporates** — it *is* the reported defect |
| "'error' records are never fresh" | **half survives** — stale intervals would now render as a wrong underlay |
| "don't bank an inert check" | **evaporates** — wholly downstream of the first |

### Accepted regression

Today a calendar conflict removes you from `free`, which removes you from the overlap. Under a
presentational-only layer that protection disappears: `computeGrid` and `findRecommendedMeetings`
read `free` as their sole input by explicit design (`src/services/overlap.ts:99-100`). Mitigated
but not erased by B, which writes to `free` with consent. Restoring it in the overlap read path is
refused — it would require re-granting KMS/SSM to an unauthenticated function and would rebuild
July's failure modes 2 and 3.

### House style that constrains the UI

Dark theme only — `dark` is force-added (`_app.tsx:77`); the palette lives in one `html.dark`
block in `src/assets/css/index.css`. All styling is inline Tailwind arbitrary values over CSS
custom properties; there is no Tailwind config. There is **no texture precedent anywhere** — a
hatch would be a new primitive. `DISABLED_CELL_CLASS` (`src/components/poll/slot-columns.ts:9-10`,
dashed border, near-empty fill, `aria-hidden`, not a button) already occupies the "you can't use
this" visual space; a booked treatment must not collide with it. No jest-axe or
eslint-plugin-jsx-a11y; accessibility is enforced by a hand-rolled contrast harness
(`src/utils/contrast.ts`) consumed by `*-contrast.test.ts` files that parse `index.css`. UI
`CLAUDE.md:37` forbids CSS/style assertions in tests, so cell state is testable only through its
accessible name.

---

## Acceptance criteria

### Non-destructive layer

**AC-001 (P-c)** — A check never modifies stored availability
```
Given a participant with a connected calendar and a painted grid
When  a calendar check runs, by any trigger, and Google reports busy intervals overlapping painted cells
Then  the stored AvailabilityRecord.free is byte-identical to what it was before
Verify: automated
```

**AC-002 (P-c)** — A booked hour can be claimed anyway, and it sticks
```
Given a slot the calendar reports as busy
When  the participant paints it free and the page is reloaded
Then  the slot is still painted free, and remains so after any subsequent check
Verify: automated
```

**AC-003 (P-c)** — The layer appears without being asked for
```
Given a signed-in participant with a connected calendar opening a poll
When  the grid renders, with no button pressed
Then  slots their calendar reports as busy are shown as booked
Verify: automated
```

**AC-004 (P-c)** — A stale or failed calendar is not presented as fact
```
Given a calendar account whose status is 'error'
When  the participant opens the poll
Then  no busy treatment is drawn from the cached intervals, and the strip says the
      connection needs attention
Verify: automated
```

### Owner-privacy of busy data

**AC-005 (P-c)** — Busy data is served only from an authenticated route
```
Given the unauthenticated GET .../availability and GET .../overlap routes
When  any caller requests them, for a participant with a connected calendar
Then  the response body contains no busy field and no busy-derived value
Verify: automated
```

**AC-006 (P-c)** — Connection state stays unobservable on open routes
```
Given two participants in a poll, one with a connected calendar and one without
When  a link-holder requests each one's availability on the unauthenticated route
Then  the two responses are identical in shape and key set, and neither triggers a Google call
Verify: automated
```

**AC-007 (P-c)** — Busy is computed from the caller's own account
```
Given a signed-in caller requesting busy for a {userId} path parameter naming another participant
When  that participant's googleSub does not equal the caller's googleSub
Then  the response is 403 and contains no busy data
Verify: automated
```

**AC-008 (P-c)** — A claimed participant yields only the claimer's own calendar
```
Given a signed-in caller who has claimed a previously unlinked participant via PATCH /users/{userId}
When  they request busy data for that participant
Then  the grid returned is computed from the caller's own calendar account, never from any
      data associated with the record's prior state
Verify: automated
```

**AC-009 (P-c)** — The overlap is unaffected by anyone's calendar
```
Given participants with connected calendars and busy hours overlapping their painted cells
When  GET .../overlap is requested
Then  the cells, bestSlot, and recommendedMeetings are computed from stored free alone,
      and GetOverlapFunction holds no KMS or SSM grant
Verify: automated
```

**AC-010 (P-c)** — Participant lists gain no calendar tell
```
Given a poll with participants who have connected calendars
When  GET .../users is requested
Then  no returned field reveals calendar connection state or busy time
Verify: automated
```

**AC-011 (P-c)** — Busy responses are not cacheable across users
```
Given the authenticated busy route
When  it returns a grid
Then  the response carries Cache-Control: private, no-store and Vary: Authorization
Verify: automated
```

**AC-012 (P-c)** — Busy time never reaches logs
```
Given any code path that handles busy intervals or a busy grid
When  it logs
Then  the emitted record contains counts and window bounds only — no interval, date, or grid
Verify: automated
```

### Visible on the grid

**AC-013 (P-c)** — Booked slots are visually distinguishable from both other states
```
Given a grid containing a painted slot, an unpainted slot, and an unpainted booked slot
When  it renders
Then  the booked slot is distinguishable from each of the other two
Verify: manual
```

**AC-014 (P-c)** — The booked treatment does not collide with out-of-window slots
```
Given a poll with per-date overrides producing out-of-window slots, and a connected calendar
When  the grid renders
Then  the booked treatment is not dashed, and is not fainter than the unpainted fill
Verify: manual
```

**AC-015 (P-c)** — Booked is conveyed by more than color (WCAG 2.2 AA, 1.4.1)
```
Given a booked slot
When  it renders
Then  a non-color indicator (glyph or texture) marks it, and the grid is legible under a
      grayscale simulation
Verify: manual
```

**AC-016 (P-c)** — The booked indicator clears contrast (WCAG 2.2 AA, 1.4.11)
```
Given the color token introduced for the booked treatment
When  its ratio against --ink is computed by src/utils/contrast.ts
Then  it is at least 3:1
Verify: automated
```

**AC-017 (P-c)** — Booked state is announced (WCAG 2.2 AA, 1.3.1, 4.1.2)
```
Given a booked slot
When  a screen reader reads its accessible name
Then  the name carries the date, the time range, and a busy suffix, following the
      comma-appended pattern at results/heat-grid.tsx:308
Verify: automated
```

**AC-018 (P-c)** — A booked slot stays operable
```
Given a booked slot
When  a participant tabs to it and activates it
Then  it receives focus with the shared focus ring, is not disabled or aria-hidden,
      and paints free
Verify: automated
```

**AC-019 (P-c)** — The treatment is explained
```
Given a grid drawing booked slots
When  a first-time participant looks at it
Then  a key states what the treatment means, in the explanatory line slot above the grid
Verify: manual
```

### One-tap import

**AC-020 (P-b)** — The calendar can supply the answer
```
Given a signed-in participant with a connected calendar and an entirely unpainted grid
When  they activate "Start from my calendar"
Then  every slot their calendar does not report busy is painted free, and the booked
      slots are left unpainted
Verify: automated
```

**AC-021 (P-b)** — The import is offered exactly where the old dead end was
```
Given a participant who connects a calendar before painting anything
When  the strip renders
Then  the import action is available, and activating it requires no prior painting
Verify: automated
```

**AC-022 (P-b)** — The import persists
```
Given a completed import
When  the page is reloaded
Then  the painted slots are the ones the import produced
Verify: automated
```

**AC-023 (P-b)** — The import does not silently discard existing work
```
Given a participant who has already painted slots
When  they activate "Start from my calendar"
Then  the action either preserves their existing paint or requires a confirmation that
      names what will be replaced
Verify: automated
```

**AC-024 (P-b)** — The import reports what it did
```
Given a completed import
When  it finishes
Then  the count of slots painted is announced in the strip's existing aria-live region
Verify: automated
```

**AC-025 (P-b)** — The import action meets target size (WCAG 2.2 AA, 2.5.8)
```
Given the import control
When  it renders at mobile and desktop widths
Then  its target is at least 24x24 CSS pixels, matching the shared Chip primitive
Verify: automated
```

### Data integrity

**AC-026 (P-c)** — Cached busy data cannot silently grow past what can be stored
```
Given a person whose accumulated syncedRange and busyIntervals approach the DynamoDB
      400KB item limit
When  a sync attempts to persist them
Then  the intervals are bounded or pruned so the write succeeds, and any failure to
      persist is surfaced rather than swallowed into serving stale data
Verify: automated
```

## Constraints (not acceptance criteria)

- **The layer is strictly presentational.** It must never feed `computeGrid`,
  `findRecommendedMeetings`, or any results surface. Violating this rebuilds July's failure
  modes 2 and 3.
- Reuse `buildBusyGrid` / `toBusyBlocks` (`src/services/overlap.ts:75-89`) rather than
  reimplementing the computation.
- Functional style: no mutation, dependency injection, injectable clocks as
  `() => number` with a default (project `CLAUDE.md`).
- Tests: `clearMocks` is on; `beforeAll` not `beforeEach`; extend
  `__tests__/unit/__mocks__.ts` rather than inventing new fixtures. The UI has no shared
  fixture module.
- Coverage gates must still pass: API branches 90 / functions 90 / lines 80; UI branches 80 /
  functions 90 / lines 90.
- No CSS or style assertions in UI tests (UI `CLAUDE.md:37`); a new hatch belongs in an
  exported class constant beside `DISABLED_CELL_CLASS`.
- Dark theme only. There is no light mode to design for.
- `markedBusyCount` and the three copy patches built around it need redefining or retiring;
  they describe a destructive write that will no longer happen.

## Known defects surfaced but out of scope

- `CalendarAccountRecord.expiration` is never refreshed. The comment at
  `src/handlers/get-calendar-callback.ts:9` claims it is renewed on every successful sync, but
  `src/services/calendar-sync.ts:76-82` spreads `...record` and never touches it, so a connected
  calendar hard-expires 90 days after connect regardless of use.
- `CalendarAccountRecord.scope` is written at connect and never read anywhere.
- OAuth state (`src/services/oauth-state.ts`) carries no `jti` or browser binding, so it is
  replayable within its 10-minute window.
- `patch-user.ts:51-52` lets any signed-in link-holder claim an unlinked participant. AC-008
  constrains this feature against it but does not close it.
