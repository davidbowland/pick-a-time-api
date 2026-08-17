# Architecture — Calendar-assisted availability

Four decisions clear the ADR bar (two competent developers here could plausibly choose
differently, *and* changing it later costs materially more than ordinary code). Everything
else was decided below the bar and logged in `decisions.md`.

---

## ADR-1 — Busy is served from a new authed route backed by its own handler

**Context.** AC-005, AC-006, AC-007 require busy data to be unreachable from any
unauthenticated route, and require the open route's response to stay byte-identical so
calendar connection state remains unobservable. The repo's established convention is an
`/authed` twin: the *same handler file* wired to a second route that differs only in
authorizer (`template.yaml:866` and `855-878` point `PatchAvailabilityAuthFunction` at
`src/handlers/patch-availability.ts`, the same file the open route uses).

**Candidates.**

| | Wins | Costs |
|---|---|---|
| **(a)** `GET .../availability/authed`, same handler as the open route, busy added when auth context is present | Matches the house convention exactly; one file to maintain | The handler's output depends on which route invoked it. One wrong conditional and busy is on the open route. The thing we must never do becomes a one-line mistake |
| **(b)** `GET .../availability/authed`, **new handler file**, open handler untouched | Same URL family, so the convention holds where it is observable; free and busy come from one response so their grid dimensions cannot drift; the open handler is *structurally* incapable of emitting busy | Departs from the same-handler half of the convention; some duplicated read logic |
| **(c)** Dedicated `GET .../calendar/busy` | Cleanest resource semantics; independent cache policy | Two round trips on poll open; two sources of truth for grid dimensions, which can disagree when a poll has per-date overrides; a new cache key and invalidation path |

**Decision.** **(b).** The `/authed` path convention is followed where it is user-visible; the
same-handler half is deliberately abandoned, because AC-005 and AC-006 should hold by
construction rather than by a correctly-written conditional. Choosing (b) over (c) is about
`buildSlots`: a poll with per-date overrides produces ragged rows, and having one handler
build `free` and `busy` from the same `PollRecord` in the same request makes misalignment
impossible rather than merely unlikely.

**Consequences.** Easy: proving the open route cannot leak — it has no code path to busy.
Hard: keeping the two handlers' shared read logic from drifting; extract what they share into
a service rather than copying it. Forecloses: serving busy without a poll context, since the
route is poll-scoped.

**Revisit if.** A second consumer needs busy without a poll (an account-level "what does
pick-a-time see?" screen would be one), at which point (c) becomes the better shape.

> **Do not "fix" this by merging the handlers.** The separation is the security control.

---

## ADR-2 — The destructive write is deleted; availability gets exactly one writer

**Context.** AC-001 forbids a check from modifying stored availability. But AC-020's import
*does* write availability, with consent. So the question is not whether availability is ever
written from calendar data — it is *which code path does it*.

**Candidates.**

| | Wins | Costs |
|---|---|---|
| **(a)** Delete `markBusyHours`. The import computes all-minus-busy **client-side** from the grid it already holds (ADR-1) and persists through the existing `PATCH .../availability` | Availability has exactly one writer — the paint pipeline. Optimistic updates, debounce, and rollback keep working untouched. Retires the drain-before-check dance (`painting/index.tsx:135-136`) and the `editCount` guards (`:149-151`), which exist only because a second writer could clobber in-flight paint | The client computes the seed, so it must hold the busy grid — which ADR-1 gives it. Adds no authority: `PATCH .../availability` is already unauthenticated with the link as the credential, so a client could always write any grid |
| **(b)** Server-side `POST .../calendar/import` computes and writes the seed | Computation lives in one testable place and cannot drift from the server's own busy logic | A second writer for availability, bypassing the paint pipeline. The UI must reconcile its cache against a record it did not compute — precisely the sequencing problem that produced commit `1444214` and the `editCount` machinery |
| **(c)** Keep `markBusyHours`, implement the import as "select all, then mark busy" | Reuses tested code | Keeps the destructive function alive and reintroduces the semantics being removed. Two writers again |

**Decision.** **(a).** This is the largest simplification available in the whole change, and
it is what makes the rest cheap.

**Consequences.** `POST .../calendar/sync` survives but changes meaning: it refreshes the
cached intervals from Google and returns the fresh busy grid. It no longer touches
availability, so it is idempotent and safe to repeat — which is what lets ADR-3 be
affordable. `markBusyHours` and its tests are deleted; `buildBusyGrid` and `toBusyBlocks`
stay. `markedBusyCount` loses its meaning and is retired rather than redefined (see
`decisions.md` D-11). Forecloses: any future server-authoritative rule about what a
participant's availability *must* be — the server no longer computes availability at all.

**Revisit if.** A non-browser client needs the import, or the seed computation grows rules a
client should not be trusted with.

---

## ADR-3 — The authed read refreshes through the existing freshness window

**Context.** AC-003 requires the underlay to appear on poll open with no button pressed. The
freshness window plus `syncedRange` coverage check (`src/services/calendar-sync.ts:41-52`) is
the only rate limit left once the one-check-per-poll lock is dropped (`decisions.md` D-6).

**Candidates.**

| | Wins | Costs |
|---|---|---|
| **(a)** Read serves cache only; Google is called on connect and on explicit "Check again" | Read is fast, cheap, cannot fail on a Google outage; no Google call on a page load | A person whose `syncedRange` does not cover this poll's dates sees an empty underlay until they press a button. That is P-a rebuilt — the exact dead end being fixed. Fatal |
| **(b)** Read calls `syncCalendarAccountForPoll` with the existing freshness window | Underlay is correct on first open, unprompted. Reuses logic already built and tested for exactly this — including the `rangeCoversDates` check that (a) fails | A poll open can block on Google; a Google outage degrades a read; the freshness window is the only thing between this and a fetch per page view |
| **(c)** Read serves cache plus a staleness timestamp; the client decides when to refresh | Flexible | Moves the "when does a check fire" rule back into the client, which the August spec explicitly moved to the server. Repeats a known mistake |

**Decision.** **(b).** Only (b) satisfies AC-003 for a date range the cache does not already
cover, and the coverage check that makes it correct already exists. This is affordable *only*
because ADR-2 made the operation idempotent — a repeated read can no longer destroy anything,
which is what made an unforced automatic check unsafe before.

**Consequences.** Easy: the underlay is right without anybody being taught to press a button.
Hard: the freshness window is now load-bearing for cost and for Google quota; it must be
covered by tests that assert a second read inside the window makes no Google call. When
`status` is `'error'`, the read serves no underlay at all (AC-004) rather than drawing stale
intervals as fact. Forecloses: treating poll open as a guaranteed-cheap operation.

**Revisit if.** Google quota or read latency becomes a problem, at which point (c) with a
server-supplied staleness hint is the next stop.

---

## ADR-4 — Cached intervals are bounded by a retention window, and persist failures surface

**Context.** AC-026. `syncedRange` only ever unions outward and never shrinks
(`src/services/calendar-sync.ts:46-52`) across every poll a person joins, over a 90-day item
life, with nothing pruning `busyIntervals`. Under ADR-3 this record becomes the read path, so
a 400KB item overflow stops being theoretical: `putCalendarAccount` failures are swallowed
(`:17-23`), which would silently serve an ever-staler underlay as if it were current.

**Candidates.**

| | Wins | Costs |
|---|---|---|
| **(a)** Cap interval count, dropping oldest first | Simple, bounded | A cap that trims a range the caller is actively asking about produces a silently incomplete underlay — worse than the overflow, because it looks fine |
| **(b)** Clamp `syncedRange` to a rolling retention window and prune intervals outside it on every write | Bounds the record by the thing actually driving growth. Past busy time is not needed once no live poll can reference it, and poll-scoped items carry a 14-day TTL | Requires choosing a boundary; a poll whose dates precede the boundary loses its underlay |
| **(c)** Stop unioning ranges — replace `syncedRange` with each request's range | Strictly bounded by one poll | Destroys the cache's purpose: the record is shared across every poll a person is in, and each poll would evict the others, turning every poll open into a Google call |

**Decision.** **(b)**, plus the half of (a) worth keeping: a hard interval cap as a backstop,
and `persistCalendarAccount` surfacing a failed write rather than swallowing it. The
retention boundary is an implementation choice for the plan; the recommendation is to derive
it from the poll TTL (`calendarSyncFreshnessMs`' neighbour in `src/config.ts:11`, 336h) so
the two cannot drift, and to clamp rather than to drop the range entirely.

**Consequences.** Easy: the record stays small enough that ADR-3's read path is reliable.
Hard: a poll asking about dates older than the retention window will not get an underlay for
them — acceptable, since the same poll is itself within days of expiry. Forecloses: using
this record as a general calendar cache for arbitrary historical ranges.

**Revisit if.** Polls gain a longer TTL, or a use case appears for busy data outside a live
poll's range.

---

## Below the bar

Decided and logged in `decisions.md` rather than given an ADR: the client cache key shape
(D-9), where the import control lives (D-10, deferred to Phase 3), the fate of
`markedBusyCount` (D-11), and the hatch class constant's home (D-12).
