---
plan: 06-reflect
councilled_at: 2026-05-21
critics: ceo, eng, design, dx
---

# Council review — 06-reflect

## Headline

Strong, well-grounded plan that respects the 5/5 close-criterion and keeps log-and-continue. Real concerns cluster around (a) cross-plan dependency on plan 01 being optional-stubbable, (b) the new `reflection_status: 'lint-flagged'` value rippling into telemetry consumers, (c) the slash-command writing `user-feedback.md` in a session that runs *after* the reflector has already exited — the "always" flow risks losing the operator's voice this cycle.

## Mechanical flags

### `eng:01-plan01-coupling`
**Issue:** §"Dependencies" says reflect "cannot land until plan 01's executable exists (or is no-op-stubbed)". The bench-shim story is well-thought-out (DI parallel to `gh` shim), but production has no fallback path defined — if plan 01 slips, reflect either ships gated on a missing binary or ships with the trigger commented out. No explicit "ship order" or interim contract.
**Proposed fix:** Spec the interim: if `forge brain lint` is absent at runtime, `runReflector` emits `reflector.lint-skipped` with reason `executable-missing` and proceeds (same log-and-continue posture). Cite the no-op stub path explicitly.

### `eng:02-status-enum-expansion`
**Issue:** Adding `reflection_status: 'lint-flagged'` (line 42 / open question 3) is a breaking schema change. `CycleResult.reflection_status` is consumed downstream (telemetry, JSONL events, anything checking `=== 'closed'`). Plan does not enumerate consumers or migrations.
**Proposed fix:** Prefer fold-into-`closed`-with-metadata (open-question 3 second option). Keep `reflection_status` ternary (`closed | failed | skipped`); add `lint_status: 'clean' | 'flagged' | 'skipped'` as a sibling field. Avoids enum-expansion blast radius.

### `eng:03-lint-scope-contract-missing`
**Issue:** `--scope cycle-touched-themes --cycle <id>` is invented in plan 06 but is plan 01's surface. Plan 01 §"Brain-lint design" enumerates scopes (`full / forge-only / project-only / single-file`) and does *not* include `cycle-touched-themes`. Contract isn't established on either side.
**Proposed fix:** Either pin the scope name in both plans (cross-edit plan 01 §1), or have reflect compute the file list itself and pass `--scope single-file --file ...` per touched theme. Latter is the simpler thing that could work.

### `design:01-slash-command-write-timing`
**Issue:** §"Slash-command UX" step 8: "operator answers in-session. Command then writes `_logs/<id>/user-feedback.md`". But the reflector has already exited (per §"Operator UX walkthrough" step 5). The feedback file lands *after* stage 3 already read it (or recorded "no feedback"). The only path the operator's answers reach the brain is `--rerun`, which is opt-in.
**Proposed fix:** Make `--rerun` default-on when `user-feedback.md` is newly written by the slash command, OR change the production loop so reflector stage 3 *waits* on `user-feedback.md` with a bounded timeout. Today's bench pre-populates the file before the reflector runs — production has no equivalent gate. This is the single biggest UX gap.

### `dx:01-cli-module-pattern`
**Issue:** `orchestrator/forge-reflect-cli.ts` is novel — first slash-command-extracted CLI module. Plan asserts it's reusable for other phases but doesn't define the pattern (interface, naming, registration with the slash command). Risk: each phase invents its own shape.
**Proposed fix:** One-paragraph contract: "all slash-command CLI modules live at `orchestrator/forge-<phase>-cli.ts`, export `render(input): string` and `writeOutput(input): Promise<void>`, are unit-testable without SDK." Anchor it here so plan 04 (review UX) inherits.

### `ceo:01-scope-cohesion`
**Issue:** Plan bundles four things (lint trigger + slash UX + recap + retention). All defensible, but the slash UX + recap are operator-facing surface; lint trigger + retention are brain-curation infrastructure. Different urgency, different reviewers.
**Proposed fix:** Acknowledge in §"Acceptance criteria" that AC1-2 (lint, retention) can land independently of AC3-4 (slash, recap). Avoids "all four or none" merge thrash.

## Escalations

### [design] Should `/forge-reflect` block on missing reflector output, or render a "reflector hasn't run yet" stub?
- **Block-with-explanation** — operator sees clear "reflector for `<id>` has not run; cycle was merged at `<t>`; retry via `forge reflect <id>`". Honest, deterministic.
- **Stub-render** — render the recap-so-far + "reflector pending". Friendly but invites the operator to type answers into a void.
- **Always-defer to bench-style file pre-population** — slash command refuses to render without `retro.md` present; operator writes `user-feedback.md` by hand the old way. Preserves today's contract verbatim.

### [eng] Per `feedback_reflection_close_criterion`, "no inconsistency" is the close gate. Does a `flagged` lint result violate it?
- **No** — flagged ≠ inconsistent themes; the themes the reflector wrote are still internally consistent. Lint flags pre-existing brain debt, not this cycle's output. (Matches plan recommendation.)
- **Yes-for-cycle-touched-themes** — if lint flags a theme this cycle wrote, *that's* an inconsistency the reflector introduced. Gate close on cycle-touched-only.
- **Defer to reflector's own self-check** — reflector already validates its own theme writes (skills/reflector/SKILL.md:144 step 13). Don't add a second gate, strengthen the existing one to consume lint output.

### [ceo] Wait or ship?
- **Wait until plan 01 is real** — clean dependency order; reflect refinement gets the executable it needs, not a stub.
- **Ship lint-trigger as no-op stub now** — UX surface (slash + recap + retention) is independent value; lint trigger lands as a wiring stub and activates when plan 01 lands.
- **Ship recap + retention only; defer lint + slash** — minimal-risk slice; preserves 5/5 trivially.

## Per-critic verdict
### CEO
- flags: 1
- escalations: 1
- summary: Scope is cohesive *if* you accept that "post-cycle operator experience" is one job. Otherwise, four loosely-coupled features. Plan-01 dependency is the gating question; UX value of recap + slash is real but not urgent.

### Engineering
- flags: 3
- escalations: 1
- summary: Contract surfaces (lint scope name, status enum, no-op-stub fallback) need pinning before code. Bench-shim story is well-thought-out. DI extraction of `forge-reflect-cli.ts` is the right move.

### Design
- flags: 1
- escalations: 1
- summary: Write-timing of `user-feedback.md` is the single biggest hole. The recap surface and inline-answer flow are good; they're undermined if the answers don't reach the reflector this cycle. `--rerun` default-on or wait-with-timeout would close it.

### DX
- flags: 1
- escalations: 0
- summary: Reusable CLI-module pattern needs naming/contract before it propagates. Migrations of forge's own surface (existing 19-line `.claude/commands/forge-reflect.md`) are handled by the "thin invoker" pattern from commit 86473cd — good precedent, plan should cite it.

## Recommended next action for the operator

Resolve **`design:01`** (slash-command write timing) and **`eng:02`** (status enum vs metadata field) before merge. Both are contract decisions that ripple. Then pick a ship order via the CEO escalation — leaning toward "ship recap + retention now, lint + slash after plan 01 lands" if plan 01 is more than a week out.
