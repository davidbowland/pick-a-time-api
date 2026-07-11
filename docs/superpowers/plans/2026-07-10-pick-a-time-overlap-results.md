# Pick a Time — Overlap & Results (Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **STATUS: PROVISIONAL.** This captures what we know today. It has not been broken into bite-sized TDD tasks yet — do that once Plan A has shipped and its actual `PlanRecord`/`AvailabilityRecord` shapes have been exercised by a real client. Treat every section below as a starting point to re-validate, not a locked contract.

**Goal:** Given a shipped plan with users painting availability (Plan A), compute and serve the overlap grid the client renders: a "pattern" view aggregated across all recurring weeks, and a "by-week" view for one concrete week — plus the best slot and a short list of exceptions.

**Architecture:** A new `services/overlap.ts`, parallel to the old `services/brackets.ts` this repo used to have. Computed on-demand per request, not materialized — read all `AVAIL#*` items for the session plus the `SESSION` item, run pure grid math, return the result. No new DynamoDB item type; this reads what Plan A already stores.

**Tech Stack:** Same as Plan A — TypeScript, Lambda, DynamoDB, Jest.

## Global Constraints

- Everything here is server-computed. The client never re-derives a pattern, a best slot, or an exception list — it only renders what this endpoint returns. (Same principle as Plan A's Global Constraints — restated because it matters most here.)
- Depends on Plan A's `PlanRecord`, `AvailabilityRecord`, `getSession`, `getAllUsers`-equivalent-for-availability (Plan A doesn't currently have a "list all availability records for a session" DynamoDB call — this plan will need one; see Open Questions).
- No calendar-busy data exists yet (that's Plan C). Until Plan C ships, `computeWeekGrid`/`computePatternGrid` only account for `template`/`overrides` — nobody is ever auto-blocked.

---

## What we know now

### New DynamoDB read

`getAllAvailability(sessionId): Promise<AvailabilityRecord[]>` — a `QueryCommand` on `PK = sessionId AND begins_with(SK, 'AVAIL#')`, mirroring `getAllUsers`'s existing `begins_with(SK, 'USER#')` query almost exactly. This is the one new piece of `services/dynamodb.ts` this plan needs; everything else it reads already exists.

### `services/overlap.ts` (sketch)

```ts
import { buildOccurrences } from './occurrences'
import { AvailabilityRecord, PlanRecord } from '../types'

export interface OverlapCell {
  hourIndex: number
  dayIndex: number
  freeCount: number
  freeUserIds: string[]
}

export interface OverlapGrid {
  cells: OverlapCell[][] // [hourIndex][dayIndex]
  bestSlot: { hourIndex: number; dayIndex: number; freeCount: number }
}

// weekIndex omitted (or a dedicated "pattern" mode) = aggregate across every occurrence of
// that weekday; weekIndex present = that one concrete week's actual grid, using overrides
// where the user has them.
export const computeGrid = (
  plan: PlanRecord,
  availability: AvailabilityRecord[],
  weekIndex: number | null,
): OverlapGrid => {
  // for each (hourIndex, dayIndex):
  //   pattern mode: for each user, does their *effective* template hold across
  //     most/all weeks for this weekday? (needs a definition — see Open Questions)
  //   by-week mode: for each user, availability.overrides[weekIndex]?.[hourIndex][dayIndex]
  //     ?? availability.template[hourIndex][dayIndex]
  // freeCount = how many users are free; freeUserIds = which ones, for "tap a cell" detail
  throw new Error('not implemented')
}

export const findExceptions = (
  plan: PlanRecord,
  availability: AvailabilityRecord[],
): { weekIndex: number; hourIndex: number; dayIndex: number; description: string }[] => {
  // weeks where a user's override disagrees with their own template at a slot that
  // would otherwise be part of the best pattern — this is what surfaces "Sat this week,
  // Bright Heron has a one-off conflict" in the UI mockup
  throw new Error('not implemented')
}
```

### Endpoint

`GET /sessions/{sessionId}/overlap?week=pattern|<n>` — reuses `getSession` + the new `getAllAvailability`, calls `computeGrid`, returns:

```ts
interface OverlapResponse {
  mode: 'pattern' | 'week'
  weekIndex: number | null
  grid: OverlapGrid
  exceptions: { weekIndex: number; hourIndex: number; dayIndex: number; description: string }[]
}
```

Auth: none (matches the rest of the read path in Plan A).

## Open questions to resolve before writing real tasks

1. **What does "pattern" actually average?** The simplest honest definition: for a given (weekday, hour) cell, `freeCount` = number of users whose *template* value is true at that cell, full stop — overrides are pattern-invisible by design (the pattern view answers "what's generally true," and overrides are specifically the exceptions to that). This needs to be a conscious decision, not an accident of whatever's easiest to compute — write it down in the real plan when this is picked up.
2. **`findExceptions` needs a threshold.** "Show every week where any override differs from the template" could be noisy for a 12-week plan where three people all have minor variations. Decide whether to cap the exceptions list (e.g., top 3 by how much they'd change the best slot) or show all of them grouped by user.
3. **Does `bestSlot` need a tie-break rule?** If two cells both have the maximum `freeCount`, which one is `bestSlot`? Earliest day, then earliest hour, is the obvious default — make it explicit in code, not implicit in iteration order.
4. **Performance ceiling.** At `MAX_WEEK_COUNT=12` weeks × up to `maxUsersPerSession` users × a modest hour range, this is at most a few thousand boolean reads per request — should be comfortably fine to compute per-request, but worth a quick sanity check with real numbers once `maxUsersPerSession` is finalized for this app (it's currently `10`, inherited from the old restaurant app's config default — confirm that's still the right cap for a scheduling tool, which might reasonably want more participants).
5. **Caching?** Given #4 is likely fine, probably no caching needed for v1 — but if a plan's overlap gets polled frequently (client refetching after every paint), consider whether the client should just get the freshly-computed grid back as part of the PATCH availability response instead of a separate round-trip. Worth deciding once the UI's actual polling behavior is known.
