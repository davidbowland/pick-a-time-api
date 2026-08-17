# Decisions — Calendar-assisted availability

```
STATUS: phase 1 (Requirements) — at Stop 2, awaiting user approval of brief.md
Last committed: brief.md
Next action: on approval, open phase 2 and write ADRs into architecture.md
```

## Working context

- **API repo:** `pick-a-time-api`, branch `google-calendar-sync`
- **UI repo:** `pick-a-time-ui`, branch `google-calendar-sync-v2`
- Artifacts live in the API repo; `plan.md` names exact files in both.

## Confirmed problem statements

**P-b — transcription labor** *(primary)*

> A participant has to re-enter information their calendar already holds. They read
> their calendar in another tab and hand-copy their availability into the grid; the
> calendar can only prune that afterward, never supply it. The work the calendar was
> supposed to remove is still done by hand.

**P-c — invisible and untrustworthy**

> A participant cannot tell whether the calendar did anything. A cell the check marked
> busy is pixel-identical to one they never painted (`pick-a-time-ui/src/components/poll/painting/elements.tsx:148`),
> so they cannot confirm it ran, cannot spot when it is wrong, and cannot build trust
> in it.

## Entries

```
D-1 · phase 0 · Which problem this run serves
  Candidates: (P-a) empty-grid dead end — connecting before painting yields nothing
              (P-b) transcription labor — the calendar cannot supply input, only prune it
              (P-c) invisible/untrustworthy — marked-busy is indistinguishable from unpainted
              (P-d) overstated availability — the group schedules into conflicts
  Rejected:   (P-a) is a symptom of P-b; once the calendar can source input, an empty
                    grid stops being a dead end. Folded in rather than tracked separately.
              (P-d) different victim (organizer/group, not participant) and a different
                    feature — nudging people toward accuracy. Out of scope.
  Picked:     P-b primary, P-c alongside — recommended, user confirmed
```

```
D-2 · phase 0 · Solution space constrained up front
  User directed that only design options C + B be built:
    C — calendar rendered as a visible, non-destructive underlay that never writes
        into `free`
    B — a one-tap "Start from my calendar" that paints every non-conflicting slot
  Rejected:   (D) suggested-selection-with-accept — the permanent underlay in C already
                  serves as the preview D's consent step exists to provide, so D is cost
                  without benefit once C ships
              (E) auto-apply on connect with undo — writes the answer without asking
              (F) invert the paint model to "mark when you can't" — rewrites the mental
                  model the whole app rests on, breaks the Doodle/When2meet convention,
                  touches overlap math and every existing poll
              (G) per-conflict nudges — does not scale past a handful of conflicts
              (A) do nothing, document "Select all" — ships documentation, not a feature
  Picked:     C as foundation, B on top — recommended, user confirmed

  NOTE: ACs trace to P-b/P-c, not to C+B. This entry constrains the solution space; it
  does not replace the traceability chain. If Phase 1 recon surfaces an AC that C+B
  cannot satisfy, that is escalated, not silently bent.
```

```
D-3 · phase 0 · Scope boundary
  Out of scope, confirmed at Stop 1:
    - Widening the OAuth scope beyond freeBusy — no event titles, guests, or locations.
      The privacy promise at pick-a-time-ui/src/components/poll/painting/elements.tsx:76
      stands.
    - Inverting the paint model (see D-2, option F).
    - Changes to the overlap/results view.
    - Other calendar providers; writing events back to Google.
```

```
D-4 · phase 0 · Secondary/shared calendars
  Context:    src/services/google-calendar.ts:58 queries only `items: [{ id: 'primary' }]`,
              so events on shared/family/secondary calendars are invisible to the check.
              Widening forces every already-connected user through OAuth re-consent.
  Candidates: (a) out of scope for this run
              (b) in scope — query all calendars, build the re-consent flow
              (c) out of scope, but have recon price the re-consent cost for a later call
  Picked:     (a) — inferred from the user's "only build C+B" scope constraint rather
              than answered directly. Flagged revisitable; user may veto.
  Revisit if: users report bookings the check cannot see, once C makes the underlay
              visible enough for them to notice the gap.
```

```
D-5 · phase 0 · Root cause already confirmed, systematic-debugging not re-run
  The originating report ("nothing gets marked") was diagnosed before this skill started:
  src/handlers/post-calendar-sync.ts:99 returns before any Google call when no cell is
  free. Corroborated by the UI selecting its empty-grid copy at
  pick-a-time-ui/src/components/poll/painting/elements.tsx:97, and by a throwaway proof
  that markBusyHours correctly marks all three Aug 20 slots when they are painted free.
  Phase 1 therefore skips the systematic-debugging prerequisite.
```

```
D-6 · phase 1 · Hypothesis "most guardrails evaporate" was partly wrong
  Prior-art recon corrected the going-in assumption. The freshness window + syncedRange
  cache was never destructive-derived (aae41e3, 356a5ec, 52f4d3a, fa1ca1d) and becomes the
  ONLY rate limit once one-check-per-poll is dropped. calendarCheckedAt survives as a
  timestamp for "checked X ago" even though it dies as a lock. The "'error' is never fresh"
  clause half-survives and grows more important, because stale intervals would now render
  as a visibly wrong underlay rather than being invisible.
  Recorded so the plan does not delete them on the strength of the original hypothesis.
```

```
D-7 · phase 1 · Overlap no longer reflects calendar conflicts — accepted, not chosen
  Context:    Today a calendar conflict clears a cell in `free`, which removes the person
              from the overlap. computeGrid/findRecommendedMeetings read `free` as their
              sole input by explicit design (src/services/overlap.ts:99-100).
  Candidates: (a) accept it — busy stays owner-private, overlap is paint-only
              (b) subtract busy in the overlap read path
              (c) rely on option B's consented write to keep `free` accurate in practice
  Rejected:   (b) requires re-granting KMS/SSM to the unauthenticated GetOverlapFunction
                  (deliberately stripped, template.yaml:742-749), and rebuilds BOTH failure
                  modes that killed the July read-time filter: un-overridable, and leaks
                  per-person calendar occupancy by differencing the grid against public `free`.
              (c) is a mitigation, not an alternative — it only holds for people who use the
                  import button.
  Picked:     (a) — forced by the strictly-presentational constraint rather than chosen
              freely. Captured as AC-009 so it is tested as intended behavior, not
              discovered later as a regression.
  Revisit if: a way exists to reflect conflicts in the overlap without an unauthenticated
              function decrypting tokens and without per-person occupancy being recoverable.
```

```
D-8 · phase 1 · Pre-existing defects surfaced, deliberately not fixed here
  Non-blocking, logged and carried forward (see brief.md "Known defects"):
    - CalendarAccountRecord.expiration never refreshed; connected calendars hard-expire 90
      days after connect regardless of use, contradicting the comment at
      src/handlers/get-calendar-callback.ts:9
    - CalendarAccountRecord.scope written and never read
    - OAuth state replayable within its 10-minute window (no jti, no browser binding)
    - patch-user.ts:51-52 permits claiming an unlinked participant
  Only the busyIntervals growth risk became an AC (AC-026), because C promotes busyIntervals
  from a transient value to the read path, which turns a theoretical overflow into silently
  serving a wrong underlay. The rest fail the "traces to P-b or P-c" test and stay out.
```
