---
area: reflect
date: 2026-05-20
date_contracts_locked: 2026-05-21
status: contracts locked — see CONTRACTS.md
contract_deps: [C7, C8, C9, C15a, C18c]
---

# Reflect refinement plan

> **Contracts locked.** This plan honours [CONTRACTS.md](./CONTRACTS.md).
> Where this plan and `CONTRACTS.md` disagree, `CONTRACTS.md` wins.
> Specifically: C7 (lint scope `cycle-touched-themes` is canonical),
> C8 (do NOT add a new `reflection_status` enum value — add sibling
> `lint_status: 'clean' | 'flagged' | 'skipped'`), C9 (`/forge-reflect
> <id>` auto-invokes `--rerun` after writing `user-feedback.md` —
> closes the batch's biggest UX hole), C15a (recap surface ownership:
> reflect owns `_logs/<id>/recap.md`; PR-comment posting is plan 04's
> via `post_recap_to_pr` manifest field), C18c (split S6A lint+retention
> from S6B slash+recap; either order acceptable).

## Problem (grounded in current state)

Reflect is the highest-scoring phase in the system — bench **5/5 (100%)**, p95 cost $1.04, see [`brain/log.md`](../../../brain/log.md) reflection-closure entry. Two seams now show in real operation:

1. **No lint on write.** Themes land directly via the agent (`orchestrator/phases/reflector.ts:108` writes into `brain/projects/<project>/themes/`). The bench's `no_brain_corruption` gate re-implements a subset of `brain/LINT.md` inline (per [`docs/phases/reflection.md:62`](../../phases/reflection.md)), but the live cycle has no such check — the brain accumulates malformed `category` values and broken `## Sources` paths between operator-driven `brain-lint` passes. Plan 01 (brain) makes `brain-lint` an executable; reflect should call it.
2. **Slash-command UX is bare.** [`.claude/commands/forge-reflect.md`](../../../.claude/commands/forge-reflect.md) is 19 lines and delegates entirely to a SKILL.md section. There is no rendered context for the operator, no recap of *what just happened*, no inline answer flow. Compare to `/forge-architect` where the operator at least picks a project. Reflect's questions are the most thought-intensive moment in the cycle and the operator's first signal is a bare path.
3. **No post-cycle recap surface.** Themes and the archive end up under `brain/_raw/cycles/` and `brain/projects/<project>/themes/`. Discovery requires `find` or `git log`. The operator currently learns about a cycle's outcomes by reading the PR + the retro.md by hand.

Reflect already meets its close criterion ("no inconsistency + testable goals + honest as-built", pinned `feedback_reflection_close_criterion`). All proposals below preserve that.

## Current state

- [`docs/phases/reflection.md`](../../phases/reflection.md) — four-stage contract; outputs at lines 24-30; future TODOs at 65-73 already list "production CLI `forge reflect <cycle-id>`".
- [`orchestrator/reflector-invocation.ts`](../../../orchestrator/reflector-invocation.ts) — system + user prompt builders + `tallyToolUse`. Lines 130-138: hard rules (no `gh`, no queue mutation, no web). Lines 213-257: tool-use tally surfaced to telemetry.
- [`orchestrator/phases/reflector.ts`](../../../orchestrator/phases/reflector.ts) — one-shot SDK call, max 60 turns / $1.50, log-and-continue (lines 37-38, 188-189). F-13 brain-gate at line 195. `reflection_status` surfaced in `CycleResult` (lines 53, 224).
- [`skills/reflector/SKILL.md`](../../../skills/reflector/SKILL.md) — operator-handoff section (lines 19-40) is the single source of truth for stage-2/3 file format.
- [`.claude/commands/forge-reflect.md`](../../../.claude/commands/forge-reflect.md) — 19-line thin invoker.
- [`benchmarks/reflection/`](../../../benchmarks/reflection/) — 5 fixtures, layered tempdir brain (`sdk.ts` masks themes/`_raw/cycles/`), file-based simulator.
- [`brain/_raw/cycles/`](../../../brain/_raw/cycles/) — 6 cycle archives at writing.
- [`skills/brain-lint/SKILL.md`](../../../skills/brain-lint/SKILL.md) — exists, conservative, never deletes; today not invoked by the reflector. Plan 01 promotes it to `orchestrator/brain-lint.ts`.

## Proposed refinement

### Brain-lint integration

Contract with [plan 01](./01-brain.md) §1: reflect calls `forge brain lint --scope cycle-touched-themes --cycle <id>` immediately after the agent exits, before `reflector.end` is emitted. Scope-filter restricts the walk to themes whose `## Sources` references the just-closed `<cycle-id>` — typically 1-5 files. Plan 01 owns the executable; reflect owns the *trigger* + the *failure-handling policy*.

**Failure handling — surfaced follow-up (locked per C8):**

Errors written to `_logs/<id>/brain-lint.md`; `reflector.lint-failed`
event emitted; recap surface (below) shows lint deltas.

**`reflection_status` stays ternary** (`closed | failed | skipped`) per
C8. A new sibling field `lint_status: 'clean' | 'flagged' | 'skipped'`
is added to `CycleResult`. Avoids the breaking enum-expansion blast
radius (telemetry consumers checking `reflection_status === 'closed'`
keep working).

Reflect ran successfully when themes exist + retro exists; lint state
is reported alongside, not folded into the close gate. Flagged lint
becomes input to the *next* cycle's reflector (per plan 01 §"interaction
with reflect").

**Missing-executable fallback** (per council 06 `eng:01-plan01-coupling`):
if `forge brain lint` is absent at runtime (plan 01 hasn't landed), the
orchestrator emits `reflector.lint-skipped` with reason
`executable-missing`, sets `lint_status: 'skipped'`, and proceeds.
Log-and-continue posture preserved.

Auto-fixes from `brain-lint --fix` are explicitly **not** invoked by
reflect — only `--scope cycle-touched-themes` (read-only, per C7).
Mutation requires the operator, per
`feedback_destructive_instruction_preserve_intent`.

### Slash-command UX

Today: `/forge-reflect <id>` opens, says "follow the SKILL", stops. Operator opens four files in different panes.

Refinement: `/forge-reflect <id>` renders, in-session:

1. **Header** — initiative id, project, cycle id, merge SHA, duration, total cost, send-back count (pulled from `_logs/<id>/events.jsonl`).
2. **Numbered questions** — content of `_logs/<id>/user-questions.md` inline (≤4 questions), each followed by an empty `> Your answer:` block.
3. **Free-form prompt** — "Anything else for the brain?" with a `> Your feedback:` block.
4. **Context links** — `retro.md`, the PR URL (from manifest), themes-written-so-far list (from `reflector.theme-emitted` events).

Operator types answers in-session. The command then **writes** `_logs/<id>/user-feedback.md` in the canonical format the SKILL declares (numbered answers + free-form section), and **auto-invokes** `forge reflect <id> --rerun` per C9 — the reflector re-runs with the operator's answers as additional context, themes get refined, lint runs again over cycle-touched themes.

**`--rerun` is default-on per C9** — without it, the operator's answers never reach the brain this cycle (the reflector has already exited when the slash command fires). This is the single biggest UX hole in the batch and C9 closes it. Cost: +1 reflector pass per cycle where the operator answers questions; acceptable.

Override available: `/forge-reflect <id> --no-rerun` writes the feedback file but does not re-invoke the reflector (operator can `forge reflect <id> --rerun` manually later, or wait for the next cycle).

### Post-cycle recap surface

New artifact: `_logs/<id>/recap.md`, written by `runReflector` (orchestrator, not agent) at the end of the phase. Single page, machine-generated from the event log + the reflector's outputs:

- One-line summary of the initiative outcome.
- Cost / duration / send-back counts.
- Themes written (with relative links).
- Brain-gaps observed (with status: closed / outstanding).
- Lint deltas (if any).
- Link to the cycle archive.

Lives in `_logs/<id>/recap.md` (durable, gitignored, alongside everything else operator-facing for that cycle).

**Recap-as-PR-comment is owned by plan 04 (per C15a)**, not by this plan. When the dev-loop unifier closes a cycle, it MAY post the recap as a PR comment via `gh pr comment` — gated by manifest field `post_recap_to_pr: true` (default false). Reflect's responsibility ends at writing `_logs/<id>/recap.md`.

### Cycle archiving / retention tagging

Today every reflection writes `brain/_raw/cycles/<id>.md` with full provenance. Plan 01 (brain) cleanup pass needs a retention signal so it knows which raw cycles to keep verbatim vs. summarise.

Refinement: extend the cycle-archive frontmatter with `retention` (one of `load-bearing` | `interesting` | `routine`) and `cited_by` (list of theme paths that reference this archive). The reflector assigns `retention` based on the same signal that drives `theme_categories_balanced`:

- `load-bearing` — the cycle produced ≥ 1 `category: antipattern` theme, or saw any wedge / recovery event.
- `interesting` — non-routine but no antipattern (e.g. a new pattern theme; ≥ 2 send-backs).
- `routine` — minimal clean cycle, no new themes beyond a single `pattern` confirmation.

Plan 01's `cleanup-candidates.md` reads `retention` as the tier-B/C signal — `routine` cycles older than N days become Tier B (archive-and-summarise), `load-bearing` is Tier-C (never auto). Operator has the final call.

### Bench updates

The bench must validate the new bits without losing reflectivity. Add (no removals):

- **Recap.md presence** — new gate `recap_emitted` (boolean). Fail if missing.
- **Retention tag present** — new gate `retention_assigned` (one of the three values). Fail if missing.
- **Lint trigger fired** — new gate `lint_invoked`: `reflector.lint-invoked` event in the harness's event log (the bench provides a fake `forge brain lint` shim that no-ops + writes a stub report, same DI pattern as the `gh` shim in [`benchmarks/e2e/`](../../../benchmarks/e2e/)).
- **Slash-command flow** — the slash-command itself isn't agentic, so testing is a separate harness: a node:test integration test under `.claude/commands/forge-reflect.test.ts` that synthesises a fake `_logs/<id>/` directory, runs the command's render logic (extracted into `orchestrator/forge-reflect-cli.ts` for testability), and asserts the resulting `user-feedback.md` matches the SKILL's contract format.

**Slash-command CLI module pattern (per council 06 `dx:01-cli-module-pattern` — establishes the convention for all phases):**

> All slash-command CLI modules live at `orchestrator/forge-<phase>-cli.ts`,
> export `render(input): string` and `writeOutput(input): Promise<void>`,
> and are unit-testable without spawning the Agent SDK.

`orchestrator/forge-reflect-cli.ts` is the first concrete implementation;
future plans extending other slash commands (e.g. plan 02's
`forge architect commit`, plan 05's `/forge-review`) follow the same
contract.

The 5 existing fixtures cover the new gates by definition; one new fixture (`load-bearing-multi-send-back`) is optional to exercise the retention tagging branch separately. Pass threshold stays 0.7. The injectable handoff (file-based) stays — `forge-reflect-cli.ts` is testable in isolation from the agent.

## Operator UX walkthrough

1. Reviewer merges PR → `runReflector` fires (existing).
2. Reflector agent runs stages 1-4 (existing).
3. Orchestrator runs `forge brain lint --scope cycle-touched-themes` (new). Stub report on bench, real report in production.
4. Orchestrator writes `_logs/<id>/recap.md` (new) — one-page summary linking everything.
5. Reflector emits `reflector.end` with `reflection_status: 'closed' | 'lint-flagged' | 'failed'`.
6. Operator gets a notification path (TBD — beyond this plan's scope; see general-plan for the broader notification story).
7. Operator types `/forge-reflect <id>`. The command renders the recap + the numbered questions + an inline answer block.
8. Operator answers in-session. Command writes `_logs/<id>/user-feedback.md` and echoes the path.
9. Operator stops, or passes `--rerun` to invoke a second reflector pass that ingests their feedback into the existing retro/themes.
10. Lint output (if any errors) surfaces as a follow-up TODO in the recap; operator runs `forge brain lint --fix` manually when ready (per plan 01 §"never auto-applies").

## Open questions for the operator

1. Should `/forge-reflect <id>` always render the recap, or only when no `user-feedback.md` exists yet (i.e. "first time you visit this cycle")?
2. ~~Auto-`--rerun` or always-manual?~~ **Decided (C9):** auto-rerun is default-on after the slash command writes `user-feedback.md`. `--no-rerun` override available.
3. ~~`lint-flagged` enum value, or sibling field?~~ **Decided (C8):** sibling `lint_status: 'clean' | 'flagged' | 'skipped'` on `CycleResult`; `reflection_status` stays ternary.
4. ~~Recap embed in PR thread?~~ **Decided (C15a):** plan 04 owns the PR-comment surface; reflect owns `_logs/<id>/recap.md`. Manifest field `post_recap_to_pr: true` gates the comment.
5. Retention tiering — three values or two? `load-bearing` vs `routine` may be enough; `interesting` could leak into routine drift.
6. Per [`feedback_reflection_close_criterion`](MEMORY), reflect closes on "no inconsistency". `lint_status: 'flagged'` (per C8) does NOT block close — themes the reflector wrote are still internally consistent; flagged lint reports pre-existing brain debt for the next cycle.

## Dependencies on other refinement plans

- **Plan 01 (brain)** — owns `forge brain lint` executable + `--scope cycle-touched-themes` + the `retention` field reader in cleanup. Reflect cannot land until plan 01's executable exists (or is no-op-stubbed for the interim).
- **Plan 05 (review)** — review merges the PR, which triggers reflect. The hand-off contract (manifest in `_queue/done/`, merged tree path) is stable today and doesn't change; if plan 05 changes the post-merge artifact set, reflect must re-resolve paths.
- **Plan 04 (review-UX) / general plan** — friendlier initiative IDs would flow into the recap header; the recap-as-PR-comment surface is shared territory.

## Acceptance criteria for THIS refinement

1. **Bench still 5/5.** The three new gates pass on all 5 existing fixtures; pass threshold stays 0.7.
2. **Lint trigger fires.** A live reflection emits `reflector.lint-invoked` + writes `_logs/<id>/brain-lint.md`; surfaced follow-up mode behaviour matches the recommended row above.
3. **Slash-command flow exists.** `/forge-reflect <id>` renders the recap + questions + inline answer block; writing produces `user-feedback.md` in the SKILL's canonical format; `orchestrator/forge-reflect-cli.ts` is unit-tested.
4. **Recap exists.** Every closed reflection writes `_logs/<id>/recap.md`; `recap_emitted` gate passes on bench.
5. **Retention tagged.** Every `brain/_raw/cycles/<id>.md` includes a `retention` value; `retention_assigned` gate passes on bench.
6. **Close-criterion preserved.** No regression in "no inconsistency + testable goals + honest as-built" — themes still cite ≥ 1 resolvable source, lint errors are *flagged* not *fabricated*.
