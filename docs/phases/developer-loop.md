# Phase: Developer Loop

> *Unattended.* Ralph loop pattern over Claude Agent SDK. Iterates per work item until quality gates pass.

## Purpose

Take a work item and drive it to "complete" (quality gates pass + acceptance criteria met) via the Ralph loop pattern. Multiple developer loops run in parallel across worktrees, coordinated by the scheduler.

## Inputs

- `<worktree>/.forge/work-items/<work-item-id>.md` (the work item spec from the PM).
- `loops/ralph/PROMPT.md.tmpl` (template stamped per work item).
- `loops/ralph/AGENT.md.tmpl` (institutional memory template; per-worktree state).
- Brain knowledge (queried at iteration 1 and on demand).

## Outputs

- Commits in the worktree (atomic per acceptance criterion where possible).
- `<worktree>/.forge/work-items/<work-item-id>.md` — frontmatter `status` updated to `complete` or `failed`.
- `<worktree>/AGENT.md` — final institutional memory (what was tried, what worked, what was learned for next time).
- Iteration events in `_logs/<cycle-id>/events.jsonl`.

## Skills

- [`skills/developer-ralph/SKILL.md`](../../skills/developer-ralph/SKILL.md) — the entry point that the orchestrator's `cycle.ts` invokes.

## Loop runtime

- [`loops/ralph/runner.ts`](../../loops/ralph/runner.ts) — driver.
- [`loops/ralph/stop-conditions.ts`](../../loops/ralph/stop-conditions.ts) — quality-gates-pass | iteration-budget. (Wedged-detection was removed in Tier 2, 2026-05-25; the iteration budget is now the only no-progress backstop.)
- [`loops/_adapters/`](../../loops/_adapters/) — RuntimeAdapter registry (ADR 029). The Claude adapter (`loops/_adapters/claude/`) is the reference implementation; Gemini and Aider adapters shipped in M8 as the second implementations (both `available: false` until provisioned). The flow engine's dev node calls `getAdapter(sdkId).createAgent(...)` — never `createClaudeAgent` directly. Adding a new runtime is one file + registry row, no orchestrator edit.

## Success signals

- **Iterations to green:** median iterations per work item ≤ 3 (lower is better).
- **Cost per work item:** ≤ $0.50 (target; surfaced via metrics).
- **Quality gate pass rate:** ≥ 95% on first acceptance-criterion verification.
- **Wedge rate:** ≤ 5% of work items hit `iteration_budget` without completing.
- **Merge success:** initiative-branch quality gates pass after all work items merge.

## Known failure modes (to defend against)

- **Wedged loops** — Ralph never converges. The iteration budget is the backstop (loop aborts when iterations are exhausted). A dedicated wedged-detector existed historically but was removed in Tier 2 (2026-05-25); the iteration budget is now the only no-progress backstop.
- **Token burn on no-op iterations** — iteration budget caps this; cost budget per initiative caps it harder.
- **Hallucinated test passes** — quality gate verification runs in the orchestrator, not the agent.
- **Merge conflicts across parallel loops** — handled by per-work-item branches off the initiative branch + orchestrator-level rebase before declaring the initiative complete.

## TODO (post-scaffold)

- [x] Wire the Claude Agent SDK in `runner.ts` past skeleton — done via [`loops/ralph/claude-agent.ts`](../../loops/ralph/claude-agent.ts) (`createClaudeAgent` factory). The runner's `AgentInvocation` parameter accepts either the stub (default, for tests) or the SDK-backed agent. The flow engine drives the dev loop via the RuntimeAdapter registry (`getAdapter(sdkId)`) — M8, ADR 029.
- [ ] ~~Implement wedged-detector (no-progress heuristic).~~ Removed in Tier 2 (2026-05-25) — the iteration budget is the only no-progress backstop; no dedicated wedged-detector exists.
- [x] Implement quality-gates-pass stop condition with per-WI commands — done. `LoopInput.qualityGate` is injectable; the live cycle reads each WI's `quality_gate_cmd` (or the project's `quality_gate_cmd` from `.forge/project.json`).
- [x] Per-iteration commit discipline + JSONL event emission — done. `orchestrator/cycle.ts:runDeveloperLoop` walks WIs in topological order, emits `ralph.start` / `ralph.end` per WI plus a phase-level summary.

## Onboarding a project

> Source of truth: [`docs/forge-project-contract.md`](../forge-project-contract.md) + [ADR 017](../decisions/017-forge-project-contract.md).
> Schema: [`docs/schemas/project-config.schema.json`](../schemas/project-config.schema.json).

Each managed project declares how forge should drive its dev-loop unifier
sub-phase via `<project-root>/.forge/project.json`. The file is **required**
to schedule any initiative against that project (fail-closed per council 04
F8); the scheduler refuses to dispatch an initiative whose project config is
missing or malformed, and surfaces the error in the operator queue.

### Checklist for a new project

1. **Create `<project-root>/.forge/project.json`** with at minimum a `demo`
   block (with a valid `shape`) and a `quality_gate_cmd` argv. See worked
   examples below per `demo.shape`.
2. **Verify `quality_gate_cmd` exits 0 on `main`** before any forge work
   begins. If it doesn't, the unifier's `initiative_gate` can never pass.
3. **For `shape: "browser"`:** add `preview_command`. Confirm Playwright
   (or your e2e runner) is installable locally. Forge picks a free port
   and passes it via env to the preview server.
4. **For `shape: "harness"`:** confirm `demo.command` completes within
   ~5 minutes on baseline and emits stable, regex-scrapable lines.
5. **Seed at least one Brain 3 theme** in the project's own repo
   (`<project-root>/forge/brain/themes/` or `<project-root>/brain/themes/`,
   per [ADR 018](../decisions/018-three-brain-model.md)) describing the
   project's demo-shape choice (see
   [`projects/mdtoc/forge/brain/themes/anchor-slug-fidelity.md`](../../projects/mdtoc/forge/brain/themes/anchor-slug-fidelity.md)
   for an example).

### Worked examples per `demo.shape`

Reference templates live under
[`docs/schemas/examples/`](../schemas/examples/) — operators run `cp` to
install the appropriate one and edit the project-specific commands. Both
templates back a live managed project:

| Project | `demo.shape` | Example |
|---|---|---|
| mdtoc (creds-free OOTB reference) | `cli-diff` | [`project.mdtoc.json`](../schemas/examples/project.mdtoc.json) |
| terraform-provider-betterado (live-ADO) | `harness` | [`project.betterado.json`](../schemas/examples/project.betterado.json) |

(`trafficGame` is the live `browser`-shape managed project; it needs a
`preview_command` in its `.forge/project.json` — see the `shape: "browser"`
checklist item above.)

### Failure-mode table (unifier sub-phase)

| Failure class | Trigger | Operator response |
|---|---|---|
| `dev-loop-unifier-gate-failed` | `initiative_gate` fails on branch tip | Inspect WIs that touched the failing area; consider PM re-plan |
| `dev-loop-unifier-demo-failed` | `demo_runs_clean` fails OR `pr_self_contained` fails | Check `.forge/project.json` `demo.command`; verify `preview_command` for `shape: "browser"` |
| `dev-loop-unifier-branch-divergence` | `assertLocalRemoteSynced` throws at unifier close | Resolve manually; remote moved during the cycle |

### Unifier node (independently-dispatchable, M8-0)

The unifier is now a **real, independently-dispatchable flow node** — not a
tail inside `runDeveloperLoop` (ADR-028 M8-0 amendment). `runDeveloperLoop`
is per-WI only; the unifier tail was extracted into `runUnifierPhase`
(`orchestrator/phases/developer-loop.ts`) and is executed by
`flow-runner.ts:execUnifier`. The unifier node has its own wedge detector,
its own `unifier-phase.start` boundary event (which lights the unifier hex in
the UI), and is the resume target for `resumeFrom: 'unifier'` (the per-WI dev
node self-no-ops when resuming from unifier, but still emits its
phase-boundary events so the dev hex is not stuck `active`).

The unifier Ralph is invoked with a distinct brief:

> Treat the initiative as one PR. Prove every AC against branch tip.
> Author the demo. Author the PR body. Refactor incidentally if it unifies
> the change. Do NOT add scope.

The unifier owns:

- `<worktree>/demo/<initiative-id>/` (tracked, born committed; no
  `.forge/demos/` shadow).
- `<worktree>/demo/<initiative-id>/DEMO.md` (relative-link images for
  visibility-agnostic rendering).
- `<worktree>/.forge/pr-description.md` (PR body, ≥ 300 chars with a
  `## Demo` section).
- A closing commit `feat(<initiative-id>): unify and demo` if any changes.

The demo contract — what `demo.json` must contain, effort tiers scaled to the
diff, per-shape rules, media capture, and the review-UI mapping — is owned by
[`skills/demo/SKILL.md`](../../skills/demo/SKILL.md) (the canonical demo
capability the unifier agent composes, ADR 024).

Iteration cap: **diff-scaled** — trivial (≤2 files changed) → 4; small (≤10 files) → 8; larger → 15. No $ cap. Composed gates that
must all pass for the unifier to exit clean: `initiative_gate`,
`demo_runs_clean`, `pr_self_contained`, `branches_in_sync`.

In send-back mode (after a `/forge-review` nudge that produced
`pr-feedback.md`), the unifier accepts `--feedback-ref <path>` per
CONTRACTS.md C3b — it reads the C3a-shape feedback file and addresses each
comment by file/line without expanding scope.
