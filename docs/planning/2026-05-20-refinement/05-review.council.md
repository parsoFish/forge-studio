---
plan: 05-review
councilled_at: 2026-05-21
critics: ceo, eng, design, dx
---

# Council review — 05-review

## Headline

A genuine deletion plan: ~1,685 lines of reviewer code (`reviewer.ts` 781 +
`reviewer-stage2.ts` 532 + `reviewer-invocation.ts` 372) + a SKILL + a
bench retire in favour of a ~200-line non-LLM router + a deterministic
mini-bench. Lines up cleanly with all three north-star tests. The single
biggest risk is the cross-plan contract: plan 04 (dev-loop unifier) is
required to read `pr-feedback.md` on a send-back invocation, and plan 04
doesn't currently mention that file or that mode.

## Mechanical flags

### `eng:plan-04-contract-implicit`
**Issue:** This plan declares `_queue/in-flight/<id>.pr-feedback.md` as
the artifact the unifier consumes on send-back (lines 127-132, 154-155,
259-264). Grepping `04-dev-loop.md` for `pr-feedback`, `send-back`,
`router`, and `feedback` produces zero hits on the input-contract side
(only one "send-back to per-WI loops" sentence in an unrelated context).
Plan 04 currently has no notion of a "re-entrant on-feedback" mode.
**Proposed fix:** Add an explicit "Cross-plan input contract" section to
this plan listing the *exact* schema plan 04 must accept
(`pr-feedback.md` YAML header `{ round, comments_collected, cursor }` +
per-comment sections), and add a matching acceptance criterion to plan
04 ("unifier accepts `--feedback-ref <path>` and re-runs with that file
as additional context"). Without it, this plan dead-ends.

### `eng:cursor-not-atomic-spec`
**Issue:** `review-cursor.json` is described as persistent state but the
plan doesn't specify atomic-write semantics. A crash mid-write between
"fetched 4 new comments" and "wrote cursor=last-id" would either replay
comments (annoying but safe) or skip them (silent data loss).
**Proposed fix:** State explicitly: write to `cursor.json.tmp` then
`rename(2)`; on parse failure, treat as cursor=0 (idempotent replay
beats silent skip). One acceptance criterion: "router is safe to lose
or corrupt the cursor file — never skips comments".

### `eng:detect-approve-vs-sendback-race`
**Issue:** "If the latest PR review-event is `APPROVED` AND it is dated
after the last commit on the branch: jump to the approval flow" (lines
147-149) is well-defined for the happy path but doesn't handle: (a)
operator approves then leaves additional review comments (newer than
the approval); (b) operator approves on iteration N, then forge pushes
on the unrelated daemon poll, invalidating the approval timestamp; (c)
multiple reviewers (approval from one, change-request from another).
**Proposed fix:** Define the precedence rule (latest review-event by
`submitted_at` wins; multiple reviewers → most recent
`CHANGES_REQUESTED` blocks even after `APPROVED`). At minimum, the
auto-detect branch should be a 4-line decision table in the plan.

### `eng:request-changes-not-load-bearing-is-load-bearing`
**Issue:** Line 109-111: "the request-changes event is not load-bearing;
comments alone are enough." Fine for the friendly-operator case, but
GitHub's PR Review Comments API (`.../pulls/<n>/comments`) and Issue
Comments API (`.../issues/<n>/comments`) return *every* comment ever,
including ones that say "lgtm modulo nits" the operator does not intend
as send-back. The router can't tell intent from content without an LLM
or a sentinel. Operator clicks **Request changes** → that's the only
clean signal of intent.
**Proposed fix:** Either (a) require the `CHANGES_REQUESTED` review-event
as the send-back trigger and treat raw comments as informational
context, or (b) define an explicit operator opt-in (`/forge-review <id>`
itself is the intent declaration, comments are payload — which is in
fact what the plan describes; this just needs to be stated explicitly,
not "comments alone are enough"). The latter is consistent with the
rest of the design.

### `dx:orphan-test-migration-incomplete`
**Issue:** AC lines 321-325 say "tests for `parseAcceptanceCriteria`
migrate to live next to `file-verdict.ts` / `pr-verdict.ts`". Sanity:
`parseAcceptanceCriteria` is *exported from* `file-verdict.ts` already
(see `pr-verdict.ts:22`). The migration is therefore "delete the
re-export from `reviewer-stage2.ts` and update one import in
`pr-verdict.ts`". Worth saying that's the whole migration so a future
implementer doesn't go hunting for a fictional test file.
**Proposed fix:** Tighten the AC to "no production code still imports
from `reviewer-stage2.ts` or `reviewer-invocation.ts` after deletion;
`tsc --noEmit` clean."

### `ceo:bench-retire-loses-historical-baseline`
**Issue:** `benchmarks/review-loop/` had 5 fixtures scoring at 5/5 100%
($2.55/run). Retiring it is correct (the criteria move to plan 04's
unifier bench) but the plan should explicitly state that *plan 04
inherits demo + PR-body criteria* so we don't lose the regression
floor.
**Proposed fix:** Add to acceptance criteria: "plan 04's unifier bench
covers `demo_recording_present`, `demo_exercises_acceptance_criteria`,
`pr_description_*`, `pr_links_demo`, `merge_strategy_respected` — or a
documented superset." This belongs in this plan because *this* plan is
the one retiring those criteria.

### `design:slash-command-discoverability`
**Issue:** Operator UX walkthrough is clear once you know the flow, but
step 1 ("desktop notification: Review needed") assumes the notification
includes the init-ID copy-pastable. Open-question 6 also flags the
typing burden (today's `INIT-2026-05-20-trafficGame-world-map-overlay-darken-fix-arc`
is brutal as a slash-command argument).
**Proposed fix:** Either commit that the notification copies the
init-ID to clipboard (small `notify` change), or have `/forge-review`
default to the most-recent open initiative when called bare. Both are
cheap; one should be in scope.

## Escalations

### [eng] Should the closure-poll cadence be hard-coded or configurable?
- **5-minute hard-coded** — simplest; matches plan recommendation;
  cuts a config knob.
- **Configurable in `forge config`, default 5 min** — plan currently
  hedges ("configurable"); deciding now avoids a follow-up.
- **Bind to existing daemon tick** — if the daemon already polls on
  some interval for other reasons, piggyback rather than introduce a
  second cadence.

### [design] Auto-detect vs. explicit `--send-back` / `--approve`?
- **Auto-detect (plan default)** — friendlier; fewer flags; relies on
  the cursor + last-commit-timestamp rule.
- **Explicit subcommand** — safer when cursor drift or multiple
  reviewers introduce ambiguity (see `eng:detect-approve-vs-sendback-race`).
- **Auto-detect with a confirmation prompt on ambiguous state** — the
  router prints "I think this is a send-back (3 new comments, no
  approval) — continue?". Cheap.

### [dx] Where does the router live — `orchestrator/` or `skills/`?
- **`orchestrator/review-router.ts`** — plan's current placement;
  consistent with "no LLM, no skill".
- **`skills/review-router/`** — symmetric with reflector/architect
  packaging, even though there's no agent. Risk: implies LLM where
  there is none.
- The plan picks orchestrator/; just confirm and lock.

## Per-critic verdict

### CEO
- flags: 1
- escalations: 0
- summary: Strongest possible alignment with north-star — this is a
  net-deletion plan that preserves unattended operation and removes a
  re-implemented loop. Cohesive scope (delete + small new router + new
  bench + retire old bench). Loss of the historical review-loop bench
  baseline is the only strategic flag; mitigated by plan 04 inheriting
  those criteria. Operator workflow demonstrably improves (PR is the
  review window; two slash-command invocations per cycle).

### Engineering
- flags: 4
- escalations: 1
- summary: The deletion side is well-grounded (line numbers verified;
  `reviewer.ts` is indeed 781 lines, `reviewer-stage2.ts` 532). The new
  router design reuses `pr-verdict.ts`'s `gh` seam cleanly. Real
  issues: cross-plan contract with plan 04 is implicit (the biggest
  risk in the whole plan), cursor atomicity is unspecified, the
  approve-vs-send-back decision has edge cases the plan glosses, and
  "request-changes is not load-bearing" undersells how much the slash
  command itself carries intent.

### Design
- flags: 1
- escalations: 1
- summary: The end-to-end flow reads well in the walkthrough.
  Slash-command discoverability + init-ID typing burden are the only
  operator-visible friction points. Failure-mode coverage (stale
  comments, comments-without-action) is implicit in the cursor design
  but worth one explicit sentence.

### DX
- flags: 1
- escalations: 1
- summary: Maintainability win is real, not cosmetic — 1,685 LOC of
  reviewer surface deleted vs. ~200 LOC router added. The migration
  trail (orphan tests, broken imports) is small and tractable; the AC
  just needs sharper "tsc clean after deletion" framing. No docs/runbook
  beyond the slash-command help itself is needed.

## Recommended next action for the operator

Land plan 05 *as a single PR after plan 04 merges*, not before. Before
either plan goes to implementation, **co-edit plans 04 and 05 in one
sitting** to lock the `pr-feedback.md` schema and the unifier's
re-entrant-on-feedback mode as a shared contract section that appears
in both plan documents verbatim. Without that joint edit, plan 05's
deletion has no functional receiver and the cycle's send-back round
goes silent.
