# DECISIONS

One line per live decision. A decision that is a seam contract lives in
[SPEC.md](./SPEC.md) instead. "Enforced by" names the check or test that
fails when the decision is broken; `review` means no check exists and a
reviewer holds it. `node scripts/check-decisions.mjs` verifies every
enforcement resolves.

A change that conflicts with a line here updates the line in the same PR,
with the operator's approval. The decision records these lines were distilled
from are archived at the git tag `pre-docs-refactor`.

## Decisions

| ID | Decision | Why | Enforced by |
|---|---|---|---|
| D-01 | Every agent spawn goes through `pinnedSdkQuery` on the Claude Agent SDK | The wrapper allowlist-filters the child env, so no ambient override reaches a spawned agent | packages/agents/tests/contract/pinned-sdk-query.enforce.test.ts |
| D-02 | Git and GitHub operations shell out to `git` and `gh`; no git library or REST client | Mature tools cost no maintenance and worktrees give native isolation | review |
| D-03 | The emergency halt is one persisted `_queue/halt.json`: every claim refuses, in-flight work finishes, an unreadable record reads as halted | A halt that kills runs or hides itself is worse than none | packages/kernel/tests/unit/halt.test.ts; packages/flows/tests/integration/emergency-halt.test.ts |
| D-04 | The queue is `_queue/<state>/` directories and a claim is an atomic rename; no database or broker | The filesystem is the protocol, so `ls _queue/` is the whole system state | packages/flows/tests/integration/queue.test.ts |
| D-05 | Startup recovery returns an in-flight item to `pending/` when its heartbeat is stale or its worktree is missing | In-flight work is never silently lost | packages/flows/tests/integration/queue.test.ts (missing-worktree half: review) |
| D-06 | Resume rebases the preserved branch onto main first; a conflict is terminal; committed work-item work is never discarded | Recovery re-enters against committed work, and a stale base fails the close after a wasted run | packages/flows/tests/integration/resume-rebase.test.ts; packages/flows/tests/integration/reentry-rebase.test.ts |
| D-07 | A demo is one schema-validated `demo.json`; `DEMO.md` is derived from it, never hand-written | One structural contract keeps the PR text and the UI view from drifting | packages/stations/tests/unit/demo-model.test.ts |
| D-08 | Real-capability runs are operator-gated, on gitpulse, never in CI and never on mdtoc | Real cycles catch seam defects and cost real money per run | scripts/verify-outcomes.test.ts (never-in-CI half: review) |
| D-09 | Studio objects are git-tracked markdown or YAML written by one canonical serializer; no database or second registry | One writer prevents frontmatter corruption and a second source of truth | packages/agents/tests/contract/skill-md-fidelity.test.ts; node --experimental-strip-types apps/forge/cli.ts studio lint |
| D-10 | A trigger's `projects:` scope: absent means unscoped, `[]` means nothing fires, an unresolved project fails closed | A silently broadened trigger under unattended execution has an unbounded blast radius | packages/flows/tests/integration/flow-run-requests.test.ts |
| D-11 | An operator stop is a flag file read at the same clean boundary as the cost ceiling; no live handle into a running cycle | Bridge and daemon are separate processes and a stop must not corrupt an in-flight write | packages/flows/tests/unit/operator-stop.test.ts; packages/stations/tests/unit/executor-deps.operator-stop.test.ts |
| D-12 | Studio and its guarded bridge are the sole operator surface; the CLI keeps only the runtime spine, and `forge studio` supervises `forge serve` | One write path per human moment makes "never auto-satisfied" assertable once | review |
| D-13 | A disabled primary action states why (`data-disabled-reason` plus `title`) | A greyed control with no reason leaves the operator no next step | scripts/check-disabled-reason.mjs |
| D-14 | Starters under `studio/starters/` are clean-room templates, not live objects, and `studio lint` skips them | Starters with no brain access or phase coupling are safe first-run seeds | apps/forge/tests/contract/starters.test.ts |
| D-15 | The orchestrator runs gates and demo capture; an agent never produces or certifies its own evidence | Agents that author their own evidence fabricate it | packages/flows/tests/integration/orchestrated-capture.test.ts |
| D-16 | A gate killed by its timeout is an environment failure and is retried, never a work failure | Load-killed gates mis-failed complete work | packages/agents/tests/integration/stop-conditions.test.ts |
| D-17 | Constraint clauses are injected verbatim into matching work items by code, not by planner prose | A planner drops fixed checklists when it repeats them across many work items | packages/flows/tests/integration/wi-spec-compile.test.ts |
| D-18 | Each work item declares `creates:` (or `verification_artifact`), capped in size, never under a gitignored path | A gate naming a test that does not exist passes vacuously | packages/flows/tests/integration/wi-spec-compile.test.ts; packages/flows/tests/integration/wi-spec-compile-gitignored-creates.test.ts |
| D-19 | The initiative state vocabulary extends through one data table, never scattered string literals | A second literal set re-derives the state name at every call site | review |
| D-20 | A send-back compiles validated fix work items onto the initiative's own queue and re-enters develop; two config caps park the initiative | One cycle identity, one executor; unbounded send-back is runaway spend | packages/flows/tests/integration/fix-work-items.test.ts |
| D-21 | A confirmed-merged PR wins over a pending fix loop | Fixing code that is already merged is waste | review |
| D-22 | A webhook verifies the signature over the raw body before parsing; a missing secret answers 503 | The bridge is LAN-reachable, so an unverified accept is an open door | packages/flows/tests/unit/webhook-verify.test.ts |
| D-23 | A trigger fire only stages a claimable request file; the daemon sweep dispatches it | No spawn-capable surface outside the dry-bridge perimeter | packages/flows/tests/contract/trigger-kind-conformance.test.ts |
| D-24 | External trigger text reaches a prompt only as strictly validated tokens; free text travels as data | Prompt injection through commit messages | packages/stations/tests/unit/trigger-prompt-isolation.test.ts |
| D-25 | On a write-fenced turn Bash is denied unless the kind opts into fail-closed static inspection | Tool-permission hooks are bypassed by edit modes; Bash could write outside the root | packages/sessions/tests/unit/bash-fence.test.ts |
| D-26 | Session lifecycle state and `needsYou` are derived at read time from the phase table and on-disk liveness, never stored | A stored status goes stale and fails open | review |
| D-27 | A read cache is an in-memory, mtime-keyed memo of the one derivation and fails open to the uncached path | Derived state is never stored; persisted snapshots drift | packages/flows/tests/integration/run-list-cache.test.ts |
| D-28 | Studio never commits to the forge repo or merges a forge PR; every real-acting route refuses under the dry bridge | A bridge once merged its own change | apps/forge/tests/contract/dry-bridge-coverage.test.ts |
| D-29 | A package imports only strictly lower ranks of `contracts ← kernel ← {library, knowledge, projects} ← agents ← sessions ← flows ← stations ← factory ← apps`; Studio imports only contracts | Coupling is between concerns, and a lint that fails the PR is the only boundary that holds | scripts/check-boundaries.mjs |
| D-30 | Each package exposes one `"."` door plus literal, real subpaths, never a wildcard | Node's resolver then refuses deep imports at typecheck and at runtime | scripts/check-skeleton.test.ts |
| D-31 | Files cap at 800 lines (a baseline that only shrinks), each package has a ratified LOC cap in `QUARRY.md`, every production file has one owner | A cap needs an object smaller than a directory, and moved code needs an owner | scripts/check-file-size.mjs; scripts/check-package-caps.mjs; scripts/check-owner.mjs |
| D-32 | No package imports `@forge/factory`; the assembly reaches it through an enumerated seam set; a checkout without it boots and answers `/api/health` | Deletability claimed in prose rots; only a deleted-tree boot proves it | scripts/factory-deletable.mjs |
| D-33 | With the example factory absent, a station that needs a class profile refuses by name and never falls back to a default | A default profile would grade work by the wrong rules | scripts/factory-deletable.mjs (station refusal: review) |
| D-34 | `class` is a required manifest field (`code`, `docs`, `config`, `infra`); one table maps class to gate profile; no phase branches on a class name | A profile re-derived at a call site drifts from the table | packages/factory/tests/contract/class-profiles.contract.test.ts |
| D-35 | The class table's `acceptance` column (required or advisory) replaces any project-wide acceptance flag | A project-wide flag forced docs initiatives to fabricate live work items | packages/factory/tests/contract/class-profiles.contract.test.ts |
| D-36 | The plan gate rejects a manifest whose class the target flow does not accept, and flags a body that prescribes sizing or a gate command | The class selects the gates, so it is checked before any spend | packages/flows/plan-gate-class-check.test.ts |
| D-37 | Docs word budgets are ceilings, never targets: guide 1,000 · how-to 800 · explanation and reference prose 2,000 · landing 600 words; at most 20 hand-written guides; budgets only ratchet down | A smaller page that answers the reader is worth more; the report shows every page and the median so short pages stay visible (operator ruling R22, replacing the 25-page cap) | scripts/check-docs-budget.mjs |
| D-38 | A change that conflicts with SPEC.md or DECISIONS.md updates them in the same PR as the code, with the operator's approval | The ledger stays current only if it moves with the code it governs (operator ruling R24) | review |
| D-39 | The docs site is Astro + Starlight with exactly four plugins (sidebar topics, links validator, llms.txt, page actions), pinned to exact versions and bumped by Renovate; Vale and lychee lint it in CI; anything else is a new dependency | A static site from markdown needs no server, and each extra plugin is a maintenance liability (operator ruling R14) | review |
| D-40 | `apps/docs` imports nothing from the product: no package, no other app, no legacy tree | The site documents forge and must build, move or be replaced without touching its code (operator ruling R20) | scripts/check-boundaries.mjs |
| D-41 | A generated page (`generated_from:`, the story how-tos) is never hand-edited; change the story and re-run it | A hand edit drifts from the run that proves the page, and the next regeneration erases it | scripts/hooks/guard-paths.mjs; scripts/check-docs-shape.mjs |
| D-42 | A story's how-to renders one step per beat; when that page would exceed the how-to ceiling it renders condensed instead — one list item per beat, grouped under `Act n` headings by the beats' `ACT n —` prefix, with no narration — on a single page | The ceiling never rises (D-37), a story keeps one page and one URL, and stories that fit render unchanged | scripts/stories/docs-fragment.test.ts |
| D-43 | A demo checkpoint's bare command resolves on PATH, else to a `bin` its worktree's package.json declares, through one resolver shared by the claim check and the capture; a declared target must stay inside the worktree | A project's own CLI is producible without being installed on the host, and a command judged producible is the command capture runs | packages/flows/tests/integration/demo-checkpoint-preflight.test.ts; packages/kernel/tests/unit/checkpoint-command.test.ts |
| D-44 | A writer that commits theme pages into a brain files each one in its category index through the one idempotent writer (`ensureLinked`), and reports a theme it cannot file | A theme no index links is invisible to every reader, and a second index writer drifts from the one the fixer uses | packages/sessions/tests/integration/project-brain-commit-index.test.ts |
| D-45 | The demo planner chooses each checkpoint's evidence form and the initiative's narrative as inert data from the change's ACs and user stories; the declaration supplies only means; the orchestrator validates the plan by name, captures and compares (D-15); narrative is never evidence | An agent that also ran or judged its evidence would grade its own work; one fixed external base reads the same live resource for before and after, so the control would always say 'unchanged' — a live service is reached through the project's own command | packages/stations/tests/integration/demo-planner.test.ts; packages/factory/demo-planner.test.ts |

## Rejected — don't re-propose

| ID | Rejected | Why |
|---|---|---|
| R-01 | Spawning the `claude` CLI as a subprocess agent runtime | More plumbing than the SDK for less leverage; every platform improvement had to be re-wired by hand |
| R-02 | A vector database or embeddings as the brain's recall mechanism | Recall is not the bottleneck; theme-page quality is, and grep loads what is needed |
| R-03 | Our own job queue, worker pool, resource controller, process isolator or message broker | The prior build's version was heavy; a static concurrency knob and the filesystem suffice |
| R-04 | A hand-filled contract checklist in place of inspecting the project's real state | A trust-based checklist can be gamed; preflight reads git and the files |
| R-05 | Running an interview through tool-permission interception or a long-lived blocked SDK session | Permission hooks only allow or deny, and a blocked session loses state on a crash; file-checkpointed turns are durable |
| R-06 | Per-phase synthetic benches with hand-curated rubrics, or real cycles in CI on every change | Rubrics get taught to, and real cycles cost money per push |
| R-07 | A forge-side lifecycle event bus for operator hooks | The SDK already ships hooks; a bus re-invents them |
| R-08 | A cycle registry, pid tracking or IPC channel from the bridge into a live cycle for instant kill | It re-invents the queue and process isolator R-03 rejects |
| R-09 | A hand-rolled drag-and-drop canvas layer | ReactFlow is already a dependency |
| R-10 | Forensic evidence escalation: mtime checks, capture-time cross-checks, evidence affidavits | An agent that can read a forensic gate can target it; execution provenance (D-15) ends the race |
| R-11 | An LLM-only compiler pass, or longer planner prompts, to carry constraints across work items | Verbatim repetition across many outputs is exactly the task that failed |
| R-12 | The pipeline contract on the artifact template, or a second object store | One consumer per band; a second store regrows the duplication |
| R-13 | Migrating the architect onto the generic turn descriptor as pure data | Its brain injection, forced-emit retry and critic gate fire on paths no fixture reaches |
| R-14 | A free model override outside the agent definition's declared tier range | The UI would become a second source of runtime truth over `SKILL.md` |
| R-15 | Persisted snapshots or an archival format for run lists | A stored copy drifts from the derivation |
| R-16 | A per-model pricing table to estimate live dollars mid-query | Stale-prone, double-count complexity for marginal value |
| R-17 | Testing factory deletability by mocking the module, or a "no example installed" flag | A mock tests the mock; flags and fallbacks are forbidden |
| R-18 | Inferring class from the diff, an untyped acceptance-criteria fallback, or a fifth class | Class selects gates before work happens; a fallback that succeeds silently is the defect |
