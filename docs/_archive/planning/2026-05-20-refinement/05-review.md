---
area: review
date: 2026-05-20
date_contracts_locked: 2026-05-21
date_trafficgame_amended: 2026-05-23
status: contracts locked — see CONTRACTS.md
contract_deps: [C3a, C3b, C3c, C6, C16, C16a, C16b, C26, C27]
---

# Review refinement plan

> **Contracts locked.** This plan honours [CONTRACTS.md](./CONTRACTS.md).
> Where this plan and `CONTRACTS.md` disagree, `CONTRACTS.md` wins.
> Specifically: C3a (`_queue/in-flight/<id>.pr-feedback.md` YAML schema),
> C3b (unifier accepts `--feedback-ref` — declared in plan 04), C16a
> (approve-vs-send-back decision table replaces the prose rule), C16b
> (cursor write is `tmp + rename`; parse-fail = `cursor=0`), C6
> (`/forge-review` accepts handles like `traf#7` per plan 07b's resolver).
> **Amended 2026-05-23 (trafficGame post-S0 learnings):** the verdict
> shape extends to include **score-delta vs locked baselines** (L1 +
> C26) AND **visual confirmation** (L4 — screenshots are non-optional
> for visual/canvas/physics work; never just "diff matches spec"); L8
> reinforces that "tests pass" ≠ "fix landed" for visual systems
> (real-browser luminance was the only honest gate for the overlay-darken
> regression). For `type: exploration` manifests per C27, the send-back
> may carry a sweep-direction directive ("approve, but explore in
> direction X"). See [LEARNINGS-trafficgame.md](./LEARNINGS-trafficgame.md).

## Problem (grounded in current state)

Today's review phase is a full Ralph loop on the initiative branch
([`orchestrator/phases/reviewer.ts`](../../../orchestrator/phases/reviewer.ts))
that **prepares the PR/demo on iter 1 and then reacts to operator feedback
on iters 2-3**. Once plan 04 moves PR prep into the dev-loop unifier, the
review phase owns no artifact: its only remaining duty is to relay
GitHub PR comments and the approval/merge signal back into the system.
The current shape — iteration-1 demo + draft, P2 integrity gate,
adaptive cap, fallback PR description, holistic-intent dev-loop spawn,
`fix_plan.md` send-back appender — becomes dead weight. The phase
should shrink to: detect "operator wants this looked at again" → invoke
the dev-loop unifier with PR feedback; detect "operator merged" → fire
closure + reflect.

## Current state

- [`orchestrator/phases/reviewer.ts`](../../../orchestrator/phases/reviewer.ts)
  (~780 lines) — spins up a Ralph loop with `REVIEWER_MODEL` Sonnet,
  builds the gate, prepares workspace, holistic-intent assessor,
  adaptive iteration cap, fall-through PR description.
- [`orchestrator/reviewer-stage2.ts`](../../../orchestrator/reviewer-stage2.ts)
  — gate factory, `appendSendBackFeedback`, `detectFalselyCompleteWorkItems`,
  artifact-missing / gate-failure / integrity notes appended to `fix_plan.md`.
- [`orchestrator/reviewer-invocation.ts`](../../../orchestrator/reviewer-invocation.ts)
  — system + user prompt builders, `prepareReviewerWorkspace`, `wipeRalphScratch`.
- [`skills/reviewer/SKILL.md`](../../../skills/reviewer/SKILL.md) —
  Ralph reviewer skill (demo + PR draft + send-back).
- [`orchestrator/file-verdict.ts`](../../../orchestrator/file-verdict.ts) —
  file transport for verdicts (`_queue/in-flight/<id>.verdict-{prompt,response}.md`).
- [`orchestrator/pr-verdict.ts`](../../../orchestrator/pr-verdict.ts) —
  PR-comment transport: `makePrCommentVerdict` posts a prompt comment,
  polls `gh api .../issues/<n>/comments`, parses `forge: approve` /
  `forge: send-back` + `- GIVEN … WHEN … THEN …` via
  `parseVerdictComment` + `parseAcceptanceCriteria`.
- [`orchestrator/pr.ts`](../../../orchestrator/pr.ts) — `ensurePullRequest`
  (idempotent create/push), `embedDemoInPr` (visibility-aware),
  `confirmPrMerged` (the single merge gate consumed by `closure.ts`).
- [`orchestrator/phases/closure.ts`](../../../orchestrator/phases/closure.ts)
  — already the sole terminal-move authority (`in-flight → done` only
  when `confirmPrMerged` is true).
- [`benchmarks/review-loop/`](../../../benchmarks/review-loop/) — 5
  fixtures, scoring on demo + PR draft (`demo_recording_present`,
  `demo_exercises_acceptance_criteria`, `pr_description_*`,
  `pr_links_demo`, `merge_strategy_respected`); two hard gates
  (`quality_gates_pass`, `pr_only_when_green`).
- [`benchmarks/e2e/`](../../../benchmarks/e2e/) — `slugifier-basic`
  drives PM → dev → review → merge with a simulator agent providing
  verdicts; 5 weighted criteria + `cycle_completed` gate.

## Proposed refinement

### Scope reduction

**Removed (moved to dev-loop unifier, plan 04):**
- Demo recording (`.forge/demos/<id>/` + `embedDemoInPr`) — the
  unifier produces and commits the demo as part of its own loop, so
  `prepareReviewerWorkspace`, `buildReviewerSystemPrompt`,
  `renderReviewerUserPrompt`, the `tallyToolUse` helper, and the entire
  `skills/reviewer/SKILL.md` Ralph contract become unused.
- `pr-description.md` draft + `ensureMinimalPrDescription` fallback —
  dev-loop unifier writes the PR body.
- `ensurePullRequest` call from the gate — the dev-loop unifier opens
  the PR at the end of its work; the review phase only watches it.
- `appendSendBackFeedback`, `appendArtifactMissingNote`,
  `appendGateFailureNote`, `appendIntegrityFailureNote`,
  `appendIntegrityPersistsNote` — there is no `fix_plan.md` here any
  more; feedback flows into the dev-loop unifier's own state.
- `detectFalselyCompleteWorkItems` (P2 integrity check) — moves to the
  dev-loop unifier's own self-check before it opens the PR.
- `computeAdaptiveReviewIterationCap`, `inferProjectType`,
  `assessIntentHolisticallyAndMaybeRefine`,
  `maybeSpawnAlignmentDevLoop`, `wipeRalphScratch`,
  `runHolisticGate` — all artifacts of "review is a Ralph loop".
- `REVIEWER_MODEL` / `REVIEWER_ALLOWED_TOOLS` / Sonnet invocation —
  there is no agent here, just a small orchestrator routine.

**Kept (minimal review surface):**
- A non-LLM "PR comment poller + router" that runs when the operator
  signals send-back. Reuses `makePrCommentVerdict`'s `gh api` paging
  helpers from [`orchestrator/pr-verdict.ts`](../../../orchestrator/pr-verdict.ts).
- The `_queue/in-flight/<id>.verdict-response.md` shape stays as a
  manual fallback when `gh` is unavailable (the file-verdict shape is
  the one piece of `file-verdict.ts` we keep, alongside
  `parseAcceptanceCriteria`).
- `confirmPrMerged` → `closure.ts` (unchanged).

### PR-comment ingest mechanism

**Trigger: manual nudge (operator-initiated) is the primary mode.**
The operator runs `/forge-review <id>` (or `forge review <id>`) which
the daemon ([`orchestrator/daemon.ts`](../../../orchestrator/daemon.ts))
maps to a single action: *"there are new PR comments — gather them and
send back."* This is the simplest thing that works:

- No webhook infrastructure (forge runs unattended in local worktrees;
  exposing a webhook target is out of scope).
- No constant poll (would burn `gh` rate limit and is unobservable
  to the operator).
- The operator already had to look at the PR to decide it needs more
  work — having them say so is a one-line confirmation, not a chore.

**Dedup / threading (per C16b — cursor atomicity locked):**
- Persist `_queue/in-flight/<id>.review-cursor.json` containing
  `{ last_seen_comment_id, last_seen_review_id }`. On each
  `/forge-review` invocation, fetch `gh api .../issues/<n>/comments`
  AND `gh api .../pulls/<n>/reviews` AND
  `.../pulls/<n>/comments` (line-level review comments), filter `id >
  cursor`, drop our own sentinel comments
  (`<!-- forge:verdict-prompt -->` / `<!-- forge:verdict-ack -->`
  already defined in
  [`pr-verdict.ts`](../../../orchestrator/pr-verdict.ts) lines
  44-45), then update the cursor.
- **Atomicity (per C16b):** write to `<id>.review-cursor.json.tmp`
  then `rename(2)`. On parse failure of an existing cursor, treat as
  `cursor=0` (idempotent replay beats silent skip).
- Threading: each review-comment carries `path:line`; emit it verbatim
  into the dev-loop's feedback artifact so the unifier can address
  the right file. PR-level comments arrive without `path` and are
  treated as general intent.

**Write-back format (per C3a — the artifact the unifier reads):**

`_queue/in-flight/<initiative-id>.pr-feedback.md`

```markdown
---
round: <int>                       # send-back round number (1, 2, ...)
comments_collected: <int>          # how many comments in this round
cursor: <github-comment-id>        # latest comment id seen
generated_at: <ISO-8601>
---

### @<author> on <path>:<line>      # line-level review comment
<comment body>

### @<author> general               # PR-level comment
<comment body>

### operator-note                   # optional, set via `/forge-review --note`
<operator-provided context>
```

The dev-loop unifier consumes this via `--feedback-ref <path>` per C3b
(declared in [plan 04](./04-dev-loop.md) §"Re-entrant unifier").

### Send-back flow

1. Operator leaves review comments on the GitHub PR, requests changes
   (optional — the request-changes event is not load-bearing; comments
   alone are enough).
2. Operator runs `/forge-review <id>` (or invokes a slash-command from
   their own session). The thin slash command lives at
   [`.claude/commands/forge-review.md`](../../../.claude/commands/forge-review.md);
   per [`brain/forge/themes/human-interaction-via-own-session.md`](../../../brain/forge/themes/human-interaction-via-own-session.md)
   it just delegates to a skill — the new `skills/review-router/`
   that this plan adds.
3. The router (no LLM, ~200 lines TS) does:
   a. Resolves the PR via `prRef(worktreePath)`.
   b. Reads the cursor (atomic `tmp + rename` write; parse-fail =
      `cursor=0` per C16b), fetches new comments + reviews, dedups.
   c. Applies the **C16a decision table** to pick action:

      | Latest review-event by `submitted_at` | Branch state since | Action |
      |---|---|---|
      | `APPROVED` | No new commits since approval | → approval flow |
      | `APPROVED` | New commits since approval (forge or operator pushed) | → ignore approval (stale); re-evaluate from prior events |
      | `CHANGES_REQUESTED` | (any) | → send-back flow |
      | `COMMENTED` only | (any) | → send-back flow (`/forge-review` itself is intent) |
      | Multiple reviewers, mixed | Most recent `CHANGES_REQUESTED` wins | → send-back |
      | Latest commit author ≠ `forge-bot` | (operator pushed directly to PR branch) | → refuse to enqueue; warn |

   d. Send-back: write `pr-feedback.md` (per C3a schema) and emit a
      `review.send-back` event into the durable JSONL log; update the cursor.
   e. Enqueue a "dev-loop unifier" task for the daemon with
      `--feedback-ref _queue/in-flight/<id>.pr-feedback.md` (per C3b).
      The scheduler reactivates the worktree, runs the unifier, which
      pushes new commits to the SAME PR (idempotent — the PR already exists).
4. The unifier finishes → posts an ack comment on the PR (`<!--
   forge:verdict-ack -->` + summary of what changed) → operator
   re-reviews on the PR.

### Approval flow

1. Operator clicks **Merge** on GitHub (the normal path — forge never
   auto-merges, per Phase 6 / G9).
2. The daemon's existing periodic closure pass
   ([`orchestrator/phases/closure.ts`](../../../orchestrator/phases/closure.ts))
   calls `confirmPrMerged`. Already wired; unchanged by this plan.
3. **New (optional):** `/forge-review <id> --confirm-merge` runs
   `confirmPrMerged` immediately so the operator does not have to wait
   for the periodic pass. Most operators will just wait.
4. Closure aligns local↔remote, moves manifest `in-flight → done`,
   triggers reflection. (Same as today.)

The current `_pr-metadata.json` flow used by the e2e bench's gh shim
([`benchmarks/_lib/recorder-shims.ts`](../../../benchmarks/_lib/recorder-shims.ts))
keeps working — it shims `gh pr merge`, writes the metadata, and the
shim's fast-forward stands in for `alignLocalToRemote`.

### Slash-command surface

`/forge-review <id>` — three behaviours, all flag-driven:

- `/forge-review <id>` (default) — auto-detect: poll comments since
  cursor; if the latest review is `APPROVED` and the branch is
  unchanged since, confirm merge; otherwise treat as send-back. The
  operator does not need to know which mode they're in.
- `/forge-review <id> --note "<text>"` — optional extra context (e.g.
  "ignore the nitpicks, focus on the perf comment") appended to
  `pr-feedback.md` as a `### operator-note` section.
- `/forge-review <id> --abandon` — kept from
  [`cli.ts`](../../../orchestrator/cli.ts) `cmdReviewAbandon`; moves
  manifest to `failed/` and tears down the worktree.

The current `--inspect` / `--approve` subcommands shrink:
`--inspect` prints the cursor + last 5 PR comments;
`--approve` becomes `--confirm-merge` (semantics above).

### Trigger from the system perspective

Recommended: **manual nudge + a low-frequency poll fallback.**

- **Primary: manual.** `/forge-review <id>` from the operator's own
  session is the trigger. Cheap, observable, and aligns with the
  "human moment runs in its own session" principle in
  [`brain/forge/themes/human-interaction-via-own-session.md`](../../../brain/forge/themes/human-interaction-via-own-session.md).
- **Safety net: a 5-minute closure poll.** The daemon already needs to
  call `confirmPrMerged` periodically for auto-closure of merged PRs;
  reuse that pass to *also* check for an approval review event. No
  comment polling (would race the operator's intent and miss request-
  changes). Webhooks are explicitly rejected — they imply an exposed
  receiver, which violates "simplest thing that could work".

### Bench redesign

The phase-internal `benchmarks/review-loop/` measures something the
phase no longer does (demo + PR draft authoring). **Retire it**;
those criteria move to the dev-loop unifier's bench in plan 04.

**Bench inheritance note (per council 05 `ceo:bench-retire-loses-historical-baseline`):**
plan 04's unifier bench inherits the criteria that move out of
review-loop bench: `demo_recording_present`, `demo_exercises_acceptance_criteria`,
`pr_description_*`, `pr_links_demo`, `merge_strategy_respected`. Plan 04's
new `expected_unifier` block covers them as `demo_present` /
`demo_runs_clean` / `pr_self_contained` / `branches_in_sync`. No
historical regression floor is lost.

**Replace with a new `benchmarks/review-router/`** (≤ 5 fixtures,
deterministic — no LLM in the loop, so cost ≈ $0):

- Each fixture mocks `gh api` responses (a fake `GhRunner`, the same
  injectable seam used in
  [`pr-verdict.test.ts`](../../../orchestrator/pr-verdict.test.ts)).
- Criteria (all 0/1, equal weight, threshold 0.7):
  1. **`send_back_triggers_unifier_reactivation`** — given new comments,
     the router writes `pr-feedback.md` and enqueues the unifier.
  2. **`approval_triggers_merge_confirm`** — given an `APPROVED`
     review newer than the last commit, the router calls
     `confirmPrMerged` (mocked).
  3. **`cursor_dedup_no_double_send_back`** — running twice in a row
     with no new comments is a no-op.
  4. **`request_changes_threading_preserved`** — a `path:line` comment
     lands as `### @user on src/x.ts:42` in `pr-feedback.md`.
  5. **`fallback_to_file_verdict_when_no_pr`** — when `prRef()` is
     null, the router writes the verdict-prompt file
     ([`file-verdict.ts`](../../../orchestrator/file-verdict.ts)) and
     emits a notification.

Plus: **reuse `benchmarks/e2e/`** unchanged in shape. The simulator
agent in
[`benchmarks/e2e/simulator.ts`](../../../benchmarks/e2e/simulator.ts)
already provides verdicts as PR comments; the only change is that the
"send-back" round is fulfilled by the dev-loop unifier rather than the
review-Ralph. End-state: still `1/1` at score 1.0, still ends at
`MERGED`.

## Operator UX walkthrough

1. Forge runs the cycle unattended → dev-loop unifier opens PR
   `o/r#42` with the demo embedded, posts a desktop notification:
   *"Review needed: INIT-2026-05-20-x — https://github.com/o/r/pull/42".*
2. Operator opens the PR in GitHub, scrolls the diff, reviews the
   embedded demo, leaves three line-comments + one PR-level comment
   asking for a perf optimisation, then clicks **Request changes**.
3. Operator (in their own Claude session) runs `/forge-review
   INIT-2026-05-20-x`.
4. The review-router (no LLM): fetches 4 new comments + the
   request-changes review, writes
   `_queue/in-flight/INIT-2026-05-20-x.pr-feedback.md`, updates the
   cursor, emits `review.send-back round=1`, enqueues the unifier.
5. Daemon picks up the task. Unifier reads `pr-feedback.md`, addresses
   each item, re-records the demo if it touched user-facing code,
   commits, pushes. The PR auto-updates.
6. Unifier posts an ack comment (`<!-- forge:verdict-ack -->
   addressed: src/x.ts:42, perf comment in #2; demo refreshed`).
   Notification fires.
7. Operator re-reviews, approves on GitHub, clicks Merge.
8. Closure poll (within ~5 minutes) confirms merged, fast-forwards
   local main, prunes the branch, moves manifest to `done/`, fires
   reflection. Operator gets a `reflection-ready` notification.

The operator's local interaction with forge: **two slash-command
invocations** (`/forge-review` once for send-back, optionally
`/forge-reflect` later). Everything else is GitHub.

## Open questions for the operator

1. ~~Auto-detect vs. explicit mode?~~ **Decided (C16a):** auto-detect
   via the decision table (above). Explicit `--send-back` / `--approve`
   subcommands available as overrides.
2. **Closure-poll cadence.** Recommendation: 5 min, configurable in
   `forge config`. Revisit if `gh` rate-limit becomes a problem on a
   multi-initiative cycle.
3. **Should `/forge-review` enqueue or run inline?** Recommendation:
   write the `pr-feedback.md` file + drop a marker in
   `_queue/triggered/`; the daemon's existing poll picks it up.
4. **Ack comment voice.** Terse `<!-- forge:verdict-ack --> rev abc1234`
   is the lean. Operator's call before slicing.
5. ~~What if the operator pushes to the branch directly?~~ **Decided
   (C16a row 6):** refuse to enqueue when the latest commit author is
   not `forge-bot`; surface as a warning.
6. **Squash vs. merge button.** Squash is forbidden for stacked PRs
   (brain theme `squash-merge-stacked-prs`). Plan 04's unifier inherits
   the rule — confirm during S4.

## Dependencies on other refinement plans

- **Plan 04 (dev-loop unifier)** — owns PR prep (demo, body), owns
  responding to send-back via `pr-feedback.md`, owns the squash-merge
  rule, owns the P2 integrity self-check before it opens the PR.
  Without plan 04 landing first, this plan can't shrink.
- **General-plan friendlier init-IDs** — the slash-command is much
  more tolerable with short slugs (e.g. `slugify-batch`) than today's
  `INIT-2026-05-20-trafficGame-world-map-overlay-darken-fix-arc`. The
  operator types init-IDs by hand into `/forge-review`.
- **Reflect-plan** — fires on the closure-confirmed merge (unchanged
  trigger, since closure is unchanged). Reflect-plan should consume
  `pr-feedback.md` history if it wants per-round retro signals.

## Acceptance criteria for THIS refinement

- `orchestrator/phases/reviewer.ts` deleted or reduced to ≤ 80
  lines (a thin scheduler-callback that delegates to the router).
- `orchestrator/reviewer-stage2.ts`,
  `orchestrator/reviewer-invocation.ts`,
  `orchestrator/reviewer-invocation.test.ts`,
  `orchestrator/reviewer-stage2.test.ts`,
  `skills/reviewer/SKILL.md`,
  `benchmarks/review-loop/` — all deleted (the responsibility moves
  away). `parseAcceptanceCriteria` is **already exported from
  `file-verdict.ts`** (consumed by `pr-verdict.ts:22`); the migration
  is just "delete the re-export from `reviewer-stage2.ts`, update one
  import in `pr-verdict.ts`" (per council 05 `dx:orphan-test-migration-incomplete`).
  Acceptance: no production code still imports from
  `reviewer-stage2.ts` or `reviewer-invocation.ts` after deletion;
  `tsc --noEmit` clean.
- New `orchestrator/review-router.ts` + `review-router.test.ts`
  implementing the comment-poll + dedup + cursor + enqueue.
- New `benchmarks/review-router/` with the five criteria above; ≥ 4/5
  on first run; deterministic (zero LLM cost).
- `benchmarks/e2e/` still passes at `1/1` score 1.0 against
  `slugifier-basic`, with the dev-loop unifier reacting to the
  simulator's PR-comment send-back round.
- No regression in `confirmPrMerged` / `closure.ts` paths — closure
  remains the single terminal-move authority.
- Operator can complete a full send-back → approve → merge → reflect
  arc with **at most two** local invocations: `/forge-review <id>`
  (one or more times for send-back) and `/forge-reflect <id>` once
  after merge. No file-editing required.
