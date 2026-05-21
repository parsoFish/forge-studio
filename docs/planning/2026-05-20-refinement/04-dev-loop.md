---
area: dev-loop
date: 2026-05-20
date_contracts_locked: 2026-05-21
status: contracts locked — see CONTRACTS.md
contract_deps: [C1, C2, C3a, C3b, C3c, C10, C15a, C15b, C19]
---

# Dev-loop refinement plan

> **Contracts locked.** This plan honours [CONTRACTS.md](./CONTRACTS.md).
> Where this plan and `CONTRACTS.md` disagree, `CONTRACTS.md` wins.
> Specifically: C1 (project config = `<project>/.forge/project.json`,
> NOT `forge.config.json`); C2 (project-level field is `demo.shape`,
> NOT `demo.shape`); C3a (`pr-feedback.md` schema); C3b (unifier accepts
> `--feedback-ref <path>` for re-entrant send-back mode); C15a (recap
> PR-comment gated by manifest `post_recap_to_pr: true`); C15b
> (`demo_hook` is initiative-level only); C19 (no $ caps —
> iteration cap is the only bound; existing per-WI $1.0 cap removed in
> the same initiative; `cost_budget_respected` / `cost_within_unifier_budget`
> bench criteria removed).

## Problem (grounded in cycles)

Today the dev-loop walks WIs one Ralph at a time, each scoped to a single
file-list, then hands a partially-stitched branch to the review phase.
The review phase has had to absorb three loads that don't naturally
belong to "is this approved?":

1. **PR prep + demo authorship.** `orchestrator/phases/reviewer.ts:177-247`
   stamps `pr-description.md` and runs `embedDemoInPr` from `orchestrator/pr.ts:75-191`
   inside review iteration 1. When that iteration over-runs (the operator
   reliability pass removed the per-iteration $ guard precisely because
   medium initiatives could not finish prep + demo + PR draft in one go —
   see `orchestrator/phases/reviewer.ts:67-77` comment), the reviewer is
   what burns budget instead of what reviews.
2. **"Holistic intent" patch-up.** `assessIntentHolisticallyAndMaybeRefine`
   (`reviewer.ts:546-578`) runs the whole-branch quality gate at review
   entry, and when it fails the reviewer can spawn *another* dev-loop
   (`maybeSpawnAlignmentDevLoop`, `reviewer.ts:599-653`). That is dev-loop
   work happening inside the review phase because the per-WI loops never
   look at the initiative as a whole.
3. **Demo discoverability + visibility-awareness.** `embedDemoInPr`
   copies `.forge/demos/<id>/` (gitignored) into a tracked `demo/<id>/`
   and commits it on the branch — the only step that decides whether the
   PR is actually self-contained for a private repo. The themes
   `brain/forge/themes/pr-as-sole-review-window.md` and
   `brain/projects/terraform-provider-betterado/themes/2026-05-18-go-test-harness-demos.md`
   document the visibility + non-UI demo tensions; today nothing in the
   dev-loop is responsible for resolving them — the reviewer guesses.

The user pain: dev-loops "finish" without proving the initiative-level
acceptance criteria hold; demos sometimes don't exist (the cap-exhausted
path leaves a stub — `reviewer.ts:706-765`); private-repo PRs render
broken images; project repos sometimes lag origin (`pr.ts:alignLocalToRemote`
landed to fix this — `pr.ts:594-712`). Demo expectations differ wildly
by project: trafficGame (`projects/trafficGame/bp-demo.html`, Vite, Playwright)
vs betterado (no UI, `go test` harness only).

## Current state

- **Per-WI Ralph:** `orchestrator/phases/developer-loop.ts:62-350`. One
  Ralph per WI in topological order, `wipeRalphScratch` between WIs
  (line 136), pushes the initiative branch after every WI (G8, line 302).
  Iteration cap 5, USD cap $1.0 / WI (lines 42-45).
- **Workspace stamping:** `orchestrator/dev-invocation.ts:189-267`
  (`prepareDevWorkspace` writes PROMPT.md / AGENT.md / fix_plan.md from
  the WI spec).
- **Ralph runtime:** `loops/ralph/runner.ts:127-184` (`run`). Injectable
  `qualityGate` + `agent`; iteration-0 skips quality-gate-pass
  (lines 149-160) so even no-op WIs force one agent invocation.
- **Bench:** `benchmarks/developer-loop/cases.json` — five fixtures with
  per-fixture `quality_gate_cmd` (pytest / node:test / bats / grep).
  `benchmarks/developer-loop/scoring.ts` — five weighted criteria
  (`loop_completed` 0.35, `iteration_budget_respected` 0.20,
  `files_in_scope_respected` 0.20, `cost_budget_respected` 0.15,
  `no_regression` 0.10).
- **PR construction:** `orchestrator/pr.ts:openPullRequest:193-256`
  invokes `embedDemoInPr` (lines 75-191), pushes, then `gh pr create`.
  `ensurePullRequest:301-313` is idempotent across send-back rounds.
- **Branch hygiene primitives:** `pushInitiativeBranch:429-444`,
  `assertLocalRemoteSynced:530-536`, `checkLocalRemoteSynced:468-523`,
  `alignLocalToRemote:594-712`, `stripForgeScratchFromBranch:399-427`.
  All exist; the dev-loop calls `pushInitiativeBranch` per WI but does
  NOT call `assertLocalRemoteSynced` at close (the comment at
  `developer-loop.ts:298-301` says "hard invariant is asserted once at
  close" — that assertion is currently missing).
- **Demo skill:** `skills/demo/SKILL.md` defines a `kind` taxonomy
  (`screenshot`, `video`, `harness`) but is invoked from the reviewer,
  not the dev-loop. `orchestrator/demo-runtime.ts` builds + serves +
  drives Playwright; designed for browser projects.

## Proposed refinement

### New unifier sub-phase

After the last per-WI Ralph completes, run **one more Ralph** in the same
worktree with a distinct brief and budget. Call it the **unifier**. It
does NOT take a WI spec — it takes the initiative manifest + every
WI's acceptance criteria + the existing commits.

- **Brief** (new `skills/developer-unifier/SKILL.md`, sister to
  `developer-ralph`): "Treat the initiative as one PR. Prove every AC
  holds against the branch tip. Author the demo. Author the PR body.
  Refactor incidentally if it unifies the change. Do NOT add scope."
- **Budget:** 3 iterations. **No $ cap** per C19. Iteration cap is the
  only bound. Browser-shape unifiers may pay Playwright install cost
  (network/OS, not LLM) — that's not a budget concern.
- **Quality gates** (composed; ALL must pass):
  1. `initiative_gate` — the project's quality-gate command
     (`CycleInput.qualityGateCmd`) run against the WHOLE branch. Replaces
     the misplaced `assessIntentHolisticallyAndMaybeRefine` in reviewer.
  2. `demo_runs_clean` — `forge demo run` against the worktree returns
     exit-0, OR a project that declares `demo: { shape: "none" }` is
     excused (see Demo contract).
  3. `pr_self_contained` — `<worktree>/demo/<initiative-id>/DEMO.md`
     exists with relative-link images committed on the branch; PR body
     draft at `<worktree>/.forge/pr-description.md` is ≥ 300 chars and
     contains a `## Demo` block.
  4. `branches_in_sync` — `assertLocalRemoteSynced` does not throw.
- **Artifacts produced:**
  - `<worktree>/.forge/pr-description.md` (PR body, agent-authored).
  - `<worktree>/demo/<initiative-id>/` (tracked, committed on branch).
  - `<worktree>/demo/<initiative-id>/DEMO.md` (relative links).
  - One closing commit `feat(<initiative>): unify and demo` if the unifier
    made changes; otherwise no-op.
- **Dev-loop output to review:** the PR URL. Review phase becomes purely
  *operator-or-simulator verdict* on the open PR; no more PR draft, no
  more demo authorship, no more holistic gate. (Cross-link to the review
  refinement plan, doc 05.)

### Demo contract

Each managed project declares its demo shape in `.forge/project.json`
(extends today's `forge.config.json.example`):

```json
{
  "demo": {
    "shape": "browser" | "harness" | "cli-diff" | "artifact" | "none",
    "command": ["bash", "-lc", "..."],
    "output": "demo/<initiative-id>/",
    "baseline": "<git-ref-or-branch>"
  }
}
```

How forge plugs in, per `kind`:

- **`browser`** (trafficGame): unifier shells `npm run preview` /
  `vite preview`, runs the agent-authored Playwright spec (`demo.spec.ts`
  pattern from `skills/demo/SKILL.md`) against both `baseline` (default
  `main`) and `HEAD`. Screenshots + videos land under `output`. Reuses
  `orchestrator/demo-runtime.ts`.
- **`harness`** (betterado): unifier runs `command` (e.g.
  `["bash","-lc","cd azuredevops && go test ./internal/service/release/..."]`)
  against baseline and HEAD, scrapes stdout via regex defined in
  `demo-manifest.json` (already in `skills/demo/SKILL.md`'s vocabulary),
  renders a before/after table to `DEMO.md`.
- **`cli-diff`** (simplarr-style bash tools): unifier runs `command`
  twice, captures stdout, renders a unified diff into `DEMO.md`.
- **`artifact`** (slugifier / pure libs): unifier runs `command`
  (typically `node example.ts` / `python -m demo`), captures the
  produced file or stdout block, embeds it inline in `DEMO.md`. For pure
  libs where "demo" is "look at the new API in use", a tiny example
  script committed under `output/` IS the artifact.
- **`none`** (an infra-only initiative — security headers, log format,
  CI config): the unifier skips media generation but still writes
  `DEMO.md` summarising "what would a reviewer have to grep to convince
  themselves this works" with a short rationale. The `demo_runs_clean`
  gate is skipped; the `pr_self_contained` gate accepts a `DEMO.md` with
  no images.

Per-initiative override: a manifest may set `demo_override: { shape, command }`
to escape the project default for atypical initiatives (e.g. a
config-only PR on trafficGame opts into `shape: "none"`).

### Re-entrant unifier (send-back mode, per C3b)

The unifier accepts a `--feedback-ref <path>` invocation parameter.
When set, its brief is augmented:

> "This is a send-back round. Read `<feedback-ref>` (the file is
> `_queue/in-flight/<initiative-id>.pr-feedback.md` with the C3a schema)
> and address each comment by file/line. Commit. Push. Do not exceed
> the iteration cap. Do not add scope beyond what the comments
> request."

Without `--feedback-ref`, the unifier runs in initial-prep mode (first
iteration after per-WI Ralphs). The review router (plan 05) writes the
`pr-feedback.md` file and enqueues this mode.

### PR-as-self-contained-review-window (closing remaining gaps)

`embedDemoInPr` (`pr.ts:75-191`) already does the heavy lifting:
copy `.forge/demos/<id>/` → tracked `demo/<id>/`, commit, write
`DEMO.md` with relative links, detect repo visibility, build a body
suffix that inlines raw URLs only when public. Move it FROM `pr.ts`'s
call inside `openPullRequest` INTO the unifier's own commit step:

- The unifier writes `demo/<initiative-id>/` directly (no copy from
  `.forge/demos/`). The bundle is born tracked; no gitignored shadow
  copy.
- `embedDemoInPr` survives as the **PR-body composer** only —
  `pr.ts:openPullRequest` passes the tracked `demo/<id>/` path + repo
  visibility and gets back the `## Demo` body block. Eliminates the
  `cpSync` step (lines 96-100) entirely.
- Private vs public still resolved via `gh repo view --json isPrivate`,
  unchanged. Default-to-private remains the safe default.
- The unifier MUST run on a branch with `origin` reachable before its
  `demo` gate — otherwise relative-link URLs to `blob/<branch>/demo/...`
  in the eventual PR body 404. Tie to the branch-sync invariant below.

**Atomic call-site edits (per council 04 F6 — must land in one initiative
with plan 05's review shrink so neither phase half-owns PR prep):**

1. `pr.ts:openPullRequest` — remove the `cpSync` step (current lines
   96-100 inside `embedDemoInPr`).
2. `pr.ts:embedDemoInPr` — signature change to
   `(worktree, initiativeId, branch, trackedDemoDir, isPrivate) → bodyBlock | null`.
   No filesystem mutations. Pure composer.
3. `reviewer.ts` (in plan 05's shrink) — remove the `embedDemoInPr`
   call site entirely; the unifier wrote the tracked demo before the
   PR opened, so PR-open just reads + composes.
4. `pr.ts:openPullRequest` — add an `assertTrackedDemoExists` precondition;
   throws if `<worktree>/demo/<initiative-id>/DEMO.md` is absent (no
   silent re-commit).

### Branch + worktree hygiene

Invariants the dev-loop (per-WI + unifier) holds:

- **I1** — at the close of every per-WI Ralph, `origin/<branch>` ==
  local HEAD (already done via `pushInitiativeBranch`, lines 302-315
  of `developer-loop.ts`; needed by `embedDemoInPr` and by the unifier's
  demo gate which references `blob/<branch>/...`).
- **I2** — at the close of the unifier (= end of dev-loop), call
  `assertLocalRemoteSynced` (currently a comment-only promise). On
  divergence throw — classified as `dev-loop-unifier-branch-divergence`
  per §"Classified failure modes".
- **I2a (pre-cursor, council F5 split):** `assertLocalRemoteSynced`
  at the close of the **current** dev-loop (before the unifier even
  exists) is a bug fix on existing code. The comment at
  `developer-loop.ts:298-301` admits the assertion is missing. This
  fix ships as **Stage S1.3** (separate small PR), not bundled with
  the unifier work.
- **I3** — never push `.forge/` (`stripForgeScratchFromBranch` runs
  before every push, kept).
- **I4** — never rebase mid-dev-loop. The branch ships as Ralph wrote it
  (one per-WI commit + one closing unifier commit if any). Stacked PRs
  remain forbidden per `CLAUDE.md` (squash-merge-stacked-prs lesson).
- **I5** — worktree lifetime: created by the scheduler at cycle start,
  removed by `worktree.cleanup()` after `alignLocalToRemote` on
  confirmed merge. The unifier does NOT remove the worktree. The closure
  step does (already wired — `pr.ts:594-712`).

When to push:
- After every per-WI Ralph (status quo, line 302).
- Once at the unifier's end, after the closing commit (so the demo
  bundle is on origin before the PR opens).
- The PR itself is opened by the review phase from this dev-loop's
  output — NOT by the dev-loop. The dev-loop guarantees the branch is
  pushable + the demo is committed; the review phase calls
  `ensurePullRequest`.

### Classified failure modes (per council 04 F7)

When the unifier hits its iteration cap without passing the four
composed gates, the cycle's stop reason is one of three classifications
visible to the operator:

| Failure class | Trigger | Operator response |
|---|---|---|
| `dev-loop-unifier-gate-failed` | `initiative_gate` fails on branch tip | Inspect WIs that touched the failing area; consider PM re-plan |
| `dev-loop-unifier-demo-failed` | `demo_runs_clean` fails OR `pr_self_contained` fails | Check `.forge/project.json` `demo.command`; verify `preview_command` for `shape: "browser"` |
| `dev-loop-unifier-branch-divergence` | `assertLocalRemoteSynced` throws | Resolve manually; remote moved during the cycle |

### Bench redesign

Extend `benchmarks/developer-loop/cases.json` with a new section per
fixture:

```json
"expected_unifier": {
  "max_iterations": 3,
  "demo_shape": "browser" | "harness" | "cli-diff" | "artifact" | "none",
  "demo_command": [...],
  "demo_artifact_glob": "demo/<id>/*.{png,webm,md}"
}
```

(No `max_cost_usd` — see C19. Iteration cap is the only bound.)

New criteria layer added to `scoring.ts` (run only when the fixture has
an `expected_unifier` block; existing dev-loop criteria stay):

- `unifier_terminated_cleanly` — gate (mirrors `terminated_cleanly`).
- `initiative_gate_passed` — 0.30 — project quality-gate command vs
  branch tip.
- `demo_present` — 0.25 — `demo/<id>/DEMO.md` exists, ≥ 1 image OR
  artifact file OR a `shape: "none"` justification block.
- `demo_runs_clean` — 0.20 — running `demo_command` against the fixture
  returns 0.
- `pr_self_contained` — 0.15 — body draft ≥ 300 chars + contains
  `## Demo` + (if non-`none`) image links resolve to tracked files.
- `branches_in_sync` — 0.10 — `assertLocalRemoteSynced` ok.

(Per C19, no `cost_within_unifier_budget`. The existing dev-loop bench's
`cost_budget_respected` criterion is **also removed** in this initiative,
with its 0.15 weight redistributed across remaining criteria.)

Pass threshold 0.7 (matches sibling benches). Add an `artifact` fixture
(slugifier-style) and a `harness` fixture (betterado-shaped, possibly a
trimmed acceptance package) so all four non-`none` kinds are exercised.

### Cross-phase contracts

- **PM-out → dev-loop-in:** every WI carries `acceptance_criteria` AND
  the manifest carries the initiative-level ACs the unifier proves. The
  PM refinement plan (03) is asked to surface a `quality_gate_cmd`
  per-initiative when the project default isn't enough (`CycleInput.qualityGateCmd`
  is already plumbed — see `developer-loop.ts:193-199`).
- **Dev-loop-out → review-in:** the dev-loop guarantees:
  - branch pushed, `assertLocalRemoteSynced` passes
  - `<worktree>/.forge/pr-description.md` exists ≥ 300 chars with a
    `## Demo` section
  - `<worktree>/demo/<initiative-id>/` exists, tracked, committed
  - manifest unchanged in shape, status fields written

  Review (refinement plan 05) trusts these. It only `ensurePullRequest`s
  and runs verdict rounds; no demo prep, no holistic gate, no spawn.

## Onboarding contract

A project enters forge by declaring, in `.forge/project.json` at the
project root (NOT at forge root — this is project-owned config):

- `demo.shape` — one of `browser` / `harness` / `cli-diff` / `artifact` /
  `none`.
- `demo.command` — required when `kind != "none"`. Argv-style. Run from
  worktree root.
- `demo.baseline` — optional, default `main`. The git ref the unifier
  diffs the change against for before/after captures.
- `demo.output` — optional, default `demo/<initiative-id>/`.
- `quality_gate_cmd` — argv that proves the project still works (e.g.
  `["npm","test"]`, `["go","test","./..."]`, `["bats","tests/"]`).
- `preview_command` — only required for `shape: "browser"`; the dev-server
  / preview-server command (e.g. `["npm","run","preview"]`). Forge picks
  a free port and passes it via env.

Checklist for a new project on entry:
1. `.forge/project.json` present at project root with the fields above.
2. `quality_gate_cmd` returns 0 on `main` BEFORE any forge work.
3. For `shape: "browser"`: `preview_command` serves something on the chosen
   port; `playwright` (or equivalent) installed locally OR the project
   declares `demo.skip_browser_install: false` so the unifier installs it.
4. For `shape: "harness"`: `demo.command` runs to completion in under
   5 minutes on baseline; emits stable, regex-scrapable lines.
5. Brain root `brain/projects/<project>/themes/` seeded with at least
   one demo-shape theme (betterado already has this — see
   `brain/projects/terraform-provider-betterado/themes/2026-05-18-go-test-harness-demos.md`).

**Managed-project `demo.shape` assignments (per council 04 F4 — enumerate
before locking the taxonomy):**

| Project | `demo.shape` | One-line reason |
|---|---|---|
| trafficGame | `browser` | UI; Vite + Playwright already in place |
| terraform-provider-betterado | `harness` | Go provider; `go test` against `azdosdkmocks` is the canonical evidence |
| slugifier | `artifact` | Pure TS library; tiny example script + stdout block |
| simplarr | `cli-diff` | Bash tool; before/after stdout diff |
| healarr | `cli-diff` | Bash tool; same shape |
| env-optimiser | `artifact` | Library / utility; generated config or example output |
| GitWeave | TBD | Re-evaluate at onboarding |

### Resolution of "is forge content in the project repo?"

The standing tension: PRs ship to the project's GitHub repo. Forge
artefacts (`.forge/`, AGENT.md, fix_plan.md, PROMPT.md) are
gitignored — see `.gitignore:9-30` and `pr.ts:stripForgeScratchFromBranch`.
The demo, however, IS for the project's reviewers — so it ships.

Rule: **only `demo/<initiative-id>/` (and its `DEMO.md`) is tracked.**
Everything else forge writes stays under `.forge/` and is stripped from
the branch by `stripForgeScratchFromBranch`. The unifier writes the
demo bundle directly to the tracked path; there is no
`.forge/demos/<id>/` shadow copy in the refined flow. Projects can opt
out of even the tracked demo by setting `demo.shape: "none"` — they will
get a `DEMO.md`-only directory with a rationale block, no media.

## Betterado walkthrough

Project: `projects/terraform-provider-betterado/`. From its roadmap
(line ~22 of `roadmap.md`): `INIT-2026-05-18-betterado-02-release-folder`
(`betterado_release_folder` resource).

1. **Per-WI Ralphs** (unchanged):
   - WI-1: schema + CRUD against `azdosdkmocks`.
   - WI-2: docs + example in `examples/release_definition/`.
   - WI-3: registration wired into `provider.go`.
   Each Ralph commits, pushes (I1). Quality gate is
   `["go","test","./azuredevops/internal/service/release/..."]`.
2. **Unifier Ralph kicks in.** Brief: "this initiative adds
   `betterado_release_folder`; prove the unit tests pass; demo it via
   the Go-test harness per `brain/projects/terraform-provider-betterado/themes/2026-05-18-go-test-harness-demos.md`."
3. **Demo gate:** `.forge/project.json` declares
   `demo.shape: "harness"`. The unifier runs:

   ```
   demo.command = ["bash","-lc",
     "go test -v ./azuredevops/internal/service/release/folder/ -run TestRelease 2>&1 | tee /tmp/demo.log"]
   ```

   It runs the same command on baseline (`main`, no resource) — which
   yields "no test files" — and on HEAD — which yields the new
   `TestReleaseFolder_*` runs. The unifier scrapes the pass count via
   regex (`--- PASS: (\w+)`), renders a before/after table to
   `demo/INIT-…-02/DEMO.md`. No media — `harness` kind.
4. **PR-body gate:** `.forge/pr-description.md` includes a
   `## Demo` section linking to `demo/INIT-…-02/DEMO.md` (relative).
   When the PR opens, GitHub renders that markdown on the blob page
   even though `parsoFish/terraform-provider-betterado` is private.
5. **Branch sync:** unifier pushes, `assertLocalRemoteSynced` clean,
   review phase takes over.

Second walkthrough, `INIT-2026-05-18-betterado-01-release-def-test-substrate`:
this is the gate substrate — no new resource, just a test scaffold. The
manifest sets `demo_override: { shape: "none" }`. Unifier writes
`demo/.../DEMO.md` with rationale ("substrate-only; gates 60+ later
resources"), passes `pr_self_contained` without media, ships.

## Open questions for the operator

1. ~~Should `shape: "none"` initiatives still get a `## Demo` PR block?~~
   **Decided (per council 04 design escalation):** rationale block always.
   Matches PR-as-sole-review-window invariant.
2. ~~Where does the project config live?~~ **Decided (C1):**
   `<project>/.forge/project.json`.
3. ~~Unifier budget cost ceiling?~~ **Decided (C19):** removed — no $
   cap. Iteration cap (3) is the only bound. Iteration cap revisits if a
   real cycle shows unifier consistently saturating.
4. ~~Fail-closed vs silent-default for missing project config?~~
   **Decided (council 04 dx F8):** always fail-closed at cycle start.
   Scheduler refuses to schedule an initiative when
   `.forge/project.json` is missing or invalid; surfaces in operator
   queue. No silent defaults — drift-tolerance is an unattended-op hazard.
5. Should the unifier ever fix per-WI regressions discovered during the
   initiative gate, or always send-back to the per-WI loops? Inclined:
   unifier fixes within scope (touching files already in some WI's
   `files_in_scope`); anything outside scope = halt and surface for
   operator.
6. `demo.baseline` — always `main`, or "the merge-base of HEAD and main
   at dev-loop start" (handles concurrent main updates during long
   initiatives)? Inclined: merge-base captured at unifier start.

## Dependencies on other refinement plans

- **PM plan (03):** `quality_gate_cmd` per initiative + per-WI
  `acceptance_criteria` shape. The unifier reads the initiative-level
  ACs from the manifest; PM must keep that block stable.
- **Review plan (05):** trusts dev-loop hands over a pushable branch +
  tracked demo + ≥300-char PR body. Review's only responsibility
  becomes verdict-rounds on the open PR.
- **General plan (01):** logging surfaces unifier `start` / `iteration`
  / `gate` events with `phase: 'developer-loop'`, `skill: 'developer-unifier'`.
  Same event shape as today's dev-loop iterations — no schema change.
- **Brain-ingest plan (06, if any):** brain-themes per project must
  include a `demo-shape` theme (betterado has one; trafficGame
  effectively does via `bp-demo.html`; others need seeding).

## Acceptance criteria for THIS refinement

1. `developer-loop` phase produces a branch where:
   - all per-WI quality gates passed OR ≥ 1 WI completed and the
     initiative gate passed
   - `demo/<initiative-id>/DEMO.md` is tracked and committed
   - `.forge/pr-description.md` ≥ 300 chars with a `## Demo` block
   - `assertLocalRemoteSynced` returns OK
2. `benchmarks/developer-loop/` covers all five demo kinds with
   per-fixture `expected_unifier` blocks. Pass threshold 0.7.
3. `embedDemoInPr` no longer copies from `.forge/demos/` — it composes
   the PR body block from the tracked `demo/<initiative-id>/` directly.
4. Review phase code is reduced: `assessIntentHolisticallyAndMaybeRefine`,
   `maybeSpawnAlignmentDevLoop`, and the `pr-description.md` /
   `embedDemoInPr` call paths inside `runReviewer` are removed (they
   move to the unifier).
5. The betterado initiative `INIT-2026-05-18-betterado-02-release-folder`
   runs end-to-end (dev-loop → unifier → review verdict → merge) using
   `demo.shape: "harness"` declared in
   `projects/terraform-provider-betterado/.forge/project.json` (per C1).
6. Onboarding checklist documented in `docs/phases/developer-loop.md`
   (with §"Onboarding a project" containing: (a) checklist; (b) one
   worked example per `demo.shape` cross-linking the managed-project
   `.forge/project.json` files; (c) failure-mode table — per council 04
   F9). The `.forge/project.json` JSON-schema is shipped as
   `docs/schemas/project-config.schema.json` rather than via the
   per-machine `forge.config.json.example` (which retains its
   per-machine scope per ADR 009).
7. `assertLocalRemoteSynced` is called at dev-loop close and emits a
   classified error event on divergence (no silent drift).
