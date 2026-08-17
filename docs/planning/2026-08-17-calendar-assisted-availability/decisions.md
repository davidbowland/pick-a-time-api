# Decisions — Calendar-assisted availability

```
STATUS: phase 4 complete — Stop 5 reached, plan.md committed
Last committed: plan.md
Next action: hand plan.md to devils-advocate-review-loop and build
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

```
D-9 · phase 2 · Client cache shape for the busy grid — BELOW THE ADR BAR
  ADR-1 puts busy in the same response as the availability record, so the existing
  ['availability', sessionId, userId] key carries it; no new key, no new invalidation.
  Requirement that falls out: every optimistic setQueryData on that key must PRESERVE the
  busy field. applyCellsToRecord (painting/index.tsx:335) already spreads the record so it
  survives, but the rollback snapshot and any response overwrite must be checked.
  Query keys are internal to the UI and cheap to refactor, so this fails the "materially
  more expensive to change later" half of the ADR bar.
```

```
D-10 · phase 2 · Where the import control lives — DEFERRED TO PHASE 3
  Candidates: (a) Toolbar, beside Select all / Clear all (a grid action)
              (b) CalendarStrip actionsFor (a calendar action, and the strip already owns
                  the aria-live region AC-024 needs)
  Not decided here: it is a UI/UX judgment and ui-design-options should make it with real
  options rendered. Both use the same Chip primitive (src/components/ui/chip/index.tsx).
```

```
D-11 · phase 2 · markedBusyCount is retired, not redefined — BELOW THE ADR BAR
  It counts cells a destructive write flipped. ADR-2 deletes that write, so the number has
  no referent. Redefining it as "cells that overlap busy" would report a figure that never
  changes between checks, which reads as broken.
  Replaced by AC-024's import count ("painted N hours"), which describes something that
  actually happened. Retires three UI copy patches built to make the old number readable
  (ea79bd8, 6afefa6, 14ee759) and the elements.test.tsx assertions around them.
```

```
D-12 · phase 2 · The booked treatment is an exported class constant — BELOW THE ADR BAR
  Placed beside DISABLED_CELL_CLASS in src/components/poll/slot-columns.ts, because the
  two must be compared when either changes (AC-014 forbids them looking alike) and because
  there is no texture precedent anywhere in the app -- a hatch is a new primitive and
  should not be inlined into grid.tsx. Ordinary implementation choice.
```

```
D-13 · phase 2 · User delegated all open decisions
  User said "take all your recommendations". Applied to: the Stop 2 approval of brief.md as
  written; D-7 (accept the overlap regression, no reconcile prompt in this run); D-4
  (secondary calendars stay out); AC-026 staying in scope; and every ADR decision above.
  Tagged user-delegated -- auditable and reversible. Stops 3, 4 and 5 collapse; the run
  continues to completion and hands off to devils-advocate-review-loop.
```

```
D-14 · phase 3 · Chosen design — the reviewer's cut
  Candidates: (A) "show me and let me decide" — passive layer, explicit bulk action, confirm
                  dialog before replacing paint
              (B) "speak when I'm wrong" — booked is loud only where it contradicts paint,
                  batch conflict resolution
              (C) "off the table" — a mode removes booked time from the grid; Select all
                  becomes the import
  Rejected:   (C) removes a set-aside day's cells from the DOM, straining AC-018 — the restore
                  chip mitigates but does not fix it — and a persisted per-user view mode means
                  two people open the same poll and see different grids.
              (A) informs but never acts, so it fails the participant who paints quickly and
                  ignores the layer; it also introduces the only new palette token in the set.
  Picked:     the cut — base B, grafting from A: the five-state cell rendering including the
              --ink marker for painted-over-a-booking, the failure behavior (remove the layer,
              aria-disable the bulk action while keeping it focusable with a visible reason),
              and "slots" as the unit. From C: the governing rule that the system never
              overrules a hand decision. Recommended, user confirmed.
  Rationale:  B is the only option whose main flow keeps a stored answer true to the calendar
              OVER TIME rather than at the single moment a button is pressed.
```

```
D-15 · phase 3 · The overlap regression is no longer accepted — D-7 is superseded
  D-7 recorded the loss of calendar-aware overlap as forced by the strictly-presentational
  constraint, with a reconcile prompt named as the only leak-free remedy and deliberately left
  out of scope. Option B, generated blind and with no knowledge of D-7, produced exactly that
  remedy as its PRIMARY flow. It costs no additional scope, leaks nothing (the conflict data
  never leaves the owner's authenticated session), and is fully overridable (AC-028).
  D-7's "picked (a) — accept the regression" is therefore withdrawn. AC-027 and AC-028 carry
  the remedy. The overlap itself is still computed from stored `free` alone (AC-009 unchanged);
  what changed is that participants now have a first-class way to keep `free` honest.
```

```
D-16 · phase 3 · AC amendments, append-only
  WITHDRAWN: AC-004 (superseded by AC-030, strictly stronger)
             AC-023 (superseded by AC-037; its confirm branch describes a design nobody builds)
  APPENDED:  AC-027..AC-030 from the chosen option's conflict flow
             AC-031..AC-036 from the coverage pass
             AC-037 replacing AC-023 — the bulk action only ever paints
             AC-038, AC-039 — truthfulness of published claims (see D-17)
  Not amended: AC-024 already said "slots", not "hours". An earlier claim that it needed
  fixing was wrong; the counting defect is in SHIPPED copy (`detailFor` in elements.tsx
  renders "marked N hours busy"), which D-11 already retires with markedBusyCount.
```

```
D-17 · phase 3 · The expiration bug moves into scope
  Context:    The published privacy policy states the calendar connection is kept "for 90 days
              after the last time we checked, and every check restarts that clock". That last
              clause is false: calendar-sync.ts:76-82 spreads ...record and never touches
              expiration, so the clock runs from connect. D-8 had filed this as an out-of-scope
              code defect.
  Candidates: (a) fix the code so the sentence becomes true (one line, alongside lastSyncedAt)
              (b) weaken the policy sentence to match the bug
              (c) leave both, ship, fix later
  Rejected:   (b) edits a privacy policy to match a defect — the wrong direction of repair, and
                  it makes the retention promise worse for the reader.
              (c) ships a feature that touches this exact record while knowingly leaving a false
                  published claim about it.
  Picked:     (a) — AC-038. Recommended by me and taken under the user's standing "take all your
              recommendations" delegation rather than answered directly; user-delegated,
              reversible. The user raised the policy question; this is the cheaper half of the
              answer.
  Note:       AC-038 and AC-039 trace to P-c by an extended reading — a feature that leaves the
              app making false statements about itself is P-c's trust failure in another
              surface. Recorded as extended rather than asserted as a clean trace.
```

```
D-18 · phase 3 · Privacy policy edits forced by this change — BELOW THE ADR BAR
  Two sentences at src/components/privacy-policy/index.tsx:105-107 become false and are deleted:
  "Hours marked busy by your calendar stay busy. You can mark yourself free again at any time."
  One sentence at :31-32 is reworded, not deleted: "Hours your calendar blocks off look exactly
  like hours you crossed out by hand — nobody on the poll can tell which is which." Its second
  clause stays true (AC-005/009/010 enforce it); its first becomes false on the owner's own
  screen, which is the point of the feature. Net: shorter and more accurate, at most one clause
  added. The plainspoken-privacy-policy skill writes the replacement wording, not this log.
```

```
D-19 · phase 3 · Copy review — 24 findings, 12 blocking, all applied
  One was not a copy defect at all: the fill's report counted the TOTAL booked slots rather than
  the ones the fill actually skipped. Those differ on a partly painted grid, so the string was
  reporting a number the action did not produce. Carried as AC-040.
  The rest that changed behaviour rather than wording:
    - the primary-calendar limit was absent from every base surface and from the consent moment;
      it becomes a permanent explanatory line above the grid ("We only check your primary
      calendar, and only the dates in this poll"), which closes D-4's honesty gap without
      widening the OAuth scope
    - the error state dropped the fill control with no reason, while the design already specified
      aria-disabled + a visible reason for `checking`; the two are now consistent (AC-032)
    - the accent (primary) chip was the INERT one in checking and error — emphasis on a control
      that cannot act
    - "Your calendar disagrees" personified; every title in the voice sample is a flat fact.
      Now "Marked free, but booked", which also holds at 25 conflicts where the original scolded
    - the error state's cell names kept claiming ", booked" while the layer was not drawn
```

```
D-20 · phase 3 · Two questions left open rather than resolved silently
  (a) Whether `Check again` stays visible during the conflict review — the strip now has four
      jobs and this is the only state with a competing action.
  (b) Whether the fill chip lives in the strip or the toolbar (D-10). The strip owns the
      aria-live region AC-024 needs; Select all / Clear all are the chip's natural siblings.
  Both need the real component on screen to decide. Recorded in design.md "Open questions"
  rather than guessed at.
```

```
D-21 · phase 4 · Consistency review — 19 blocking findings, all applied, one pass
  Three reviewers, blind to each other. The first draft of spec.md was wrong in ways the
  traceability gate did not catch, because the gate checked that every AC HAD a row rather
  than that the row's changes could DELIVER it. Four rows were false passes.

  The five that would have caused real damage:
    - The authed response carried no calendar status, so `error` and
      `connected-with-nothing-booked` were indistinguishable client-side and AC-030, AC-034
      and AC-042 were undecidable. calendarStatus + busyWindow added.
    - The IAM grant was KMS-only. ADR-3 has the handler call syncCalendarAccountForPoll,
      which reads two SSM SecureStrings and writes back to DynamoDB. Every poll open would
      have 500'd. Also needs the LEGACY KMS key ARN — tokens encrypted under it still decrypt.
    - "Remove the editCount guards" was too broad. editCountAtSyncRef dies with the second
      writer; editCountRef guards a stale PATCH against newer paint and is unrelated to the
      calendar. Deleting it would have reintroduced a paint-vs-paint race.
    - The retention bound was self-defeating: poll dates run to +365d while the TTL is 336h,
      so a TTL-derived clamp prunes the intervals just fetched. Now bounded by
      [today - sessionExpireHours, today + maxPollDateRangeDays], with a backward arm because
      polls may hold past dates.
    - Signed-in-but-unlinked participants get a BLANK grid, not a calendar-less one:
      painting/index.tsx:237 returns null with no availability, and the claim that links the
      record fires in the parent after the child's query mounts. AC-044 and a 401/403 fallback.

  YAGNI cut: the response-side redaction helper had zero callers, since nothing in either repo
  logs a response body. AC-012 is carried by tests instead; src/utils/logging.ts is untouched.

  Non-blocking, carried not fixed: line-reference drift across artifacts; elements.tsx:137-146
  already satisfies AC-036 so C-14 preserves rather than adds; C-14's prop naming should follow
  isChecking/isConnecting; D-11 above still quotes "painted N hours".
```

```
D-22 · phase 4 · AC-039 was false, and the fill is what falsifies it
  The privacy policy claims "nobody on the poll can tell which is which" about calendar-derived
  hours. AC-020's one-tap fill makes stored `free` the exact complement of busy within the poll
  window, and `free` is public to link-holders on an unauthenticated route — so a link-holder
  can inverft the grid and recover calendar occupancy.
  The leak is reachable today (paint everything, run a check) but the fill makes it the DEFAULT
  path rather than an edge case.
  Candidates: (a) narrow the claim to what stays true — the record stores no provenance
              (b) make the fill deliberately imperfect so `free` is not a clean complement
              (c) move `free` behind auth
  Rejected:   (b) degrades the feature to defeat an inference, and a determined observer still
                  gets most of the signal.
              (c) anonymous participants have no auth to move behind — the link IS the
                  credential — so this breaks joining without a Google account.
  Picked:     (a) — AC-043. The honest claim is the one about storage, not about inference.
```
