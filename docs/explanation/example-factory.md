# The example factory

Forge ships one working example so the primitives — agents, skills, flows,
knowledge, gates — can be proven out of the box rather than just described.
That example is the **develop factory**: the pipeline that takes an idea
through to a merged pull request. This page explains what its stations do,
what each one reads and writes, and how each one is known to fail. It does
not enumerate every field of every artifact — that's the job of
[ADR 015](../decisions/015-work-item-format.md) (the work-item schema) and
[ADR 051](../decisions/051-change-class-and-typed-acceptance-criteria.md)
(the change-class and acceptance-criteria contract).

## Why one page, not five

The stations below used to have one reference-shaped page each — architect,
brain, developer-loop, project-manager, reflection — under a now-retired
`docs/phases/` directory. They're folded into one page here for
the reason [ADR 048](../decisions/048-deletable-example-factory.md) gives for
the package they live in: the develop factory is **data**, not framework —
`@forge/factory` is deletable, and CI proves it by booting the bridge from a
worktree with the package removed. Splitting one subject (what this one
example does) across five files made it look like five separate framework
concerns instead of one instance of the platform's primitives. If you're
building a *second* factory, this page is the worked example to read before
you start; the seams it uses (`FlowDef`, session kinds, band guards) are
platform primitives documented in [`architecture.md`](./architecture.md) and
[`security-model.md`](./security-model.md), not factory-specific.

## The shape: two flows, one standalone trigger

The develop factory is two flow definitions plus one agent triggered on
merge — not one monolithic pipeline:

```
architect ─plan─▶ pm ··(forge-architect flow)··
pm ─work-items─▶ dev ─branch─▶ demo ─pr─▶ adversarial-review ─findings─▶ review(verdict) ··(forge-develop flow)··
review ··on: merged··▶ reflector (standalone agent, not a flow node)
```

`studio/flows/forge-architect/flow.yaml` and `studio/flows/forge-develop/flow.yaml`
are the actual DAG definitions the flow runner (`@forge/flows`) walks node by
node; nothing below restates their YAML, only what each node does. The
vocabulary station name is on the left of each heading below; the code
identifier — the flow node id, skill directory, or agent slug — follows in
parentheses the first time it matters, so you can find the file from the
word and the word from the file.

## Brain — the knowledge every station either must or may read

The brain isn't a station on either flow; it's the knowledge substrate every
station either **must** consult or is deliberately fenced off from, per the
policy [ADR 010](../decisions/010-brain-first.md) states and
[`brain/forge-dev/themes/brain-read-policy.md`](../../brain/forge-dev/themes/brain-read-policy.md)
restates positively after an earlier "every skill reads the brain first"
mandate proved wrong:

| Station | `brainAccess` | What it reads |
|---|---|---|
| architect | `mandatory` | Brain 2 (`brain/cycles/themes/`) + Brain 3 (`brain/projects/<name>/`) at turn start |
| pm (project-manager) | `mandatory` | same — a PM that skips brain-query is failed by the orchestrator before its work items are even validated (§ Plan, below) |
| dev (developer-ralph) | `advisory` | Brain 3 only, as supplemental project context — the forge-wide brain (1+2) is off-limits; the work item is the single source of intent |
| adversarial-review | `advisory` | same as dev — the reviewer takes its intent from the diff and the work items, not from re-deriving it out of the brain |
| reflector | `mandatory` | all three brains; it's the one station that **writes** to the brain |

Planning stations read the brain because planning is where historical
work-sizing and known antipatterns actually change the plan; execution
stations don't, because their intent is already fully captured in the work
item the planner wrote — re-deriving it from the brain would let a second,
uncoordinated interpretation of the initiative into a station that's
supposed to just build what the plan says
([ADR 018](../decisions/018-three-brain-model.md);
[ADR 035](../decisions/035-forge-owned-central-artifacts.md) for where
Brain 3 physically lives).

Every skill's own `brain-query` (`skills/brain-query/SKILL.md`) is the
first-action convention referenced above: `mandatory` access is enforced at
the orchestrator, not just requested in the prompt — the PM phase runner
fails a set outright if the agent made zero brain-query calls and the
orchestrator's own prompt-injected brain context was also empty
(`packages/factory/phases/project-manager.ts`).

## Architect — the human moment that starts a cycle

*Interactive; the one station that blocks on a human.* Turns an operator's
free-form idea into one or more queued initiatives, natively inside Forge
Studio (`packages/sessions/kinds/architect.ts`; interview + PLAN gate render
through the unified `/artifact` viewer — [ADR 031](../decisions/031-studio-consolidation.md),
[ADR 020](../decisions/020-architect-in-ui.md)).

**Deliberately out of the flow's automatic path.** Nothing invokes the
architect unattended; the operator types an idea, drives the interview,
reviews `PLAN.html`, and approves or rejects. Only on approve does a
manifest promote into `_queue/pending/`, where the scheduler picks it up.

- **Inputs:** the operator's idea; Brain 2 + Brain 3 (mandatory, read at turn
  start); a prior round's `feedback.md` if this is a revise pass.
- **Outputs:** `PLAN.md` + `PLAN.html` (the review artifact); draft manifests
  under `manifests/`, not yet queued; on approve, one or more
  `_queue/pending/<initiative-id>.md` manifests. Frontmatter now carries the
  ADR 051 fields — a required `class: code | docs | config | infra` and typed
  `acceptance_criteria: [{given, when, then}]` — alongside the older
  `iteration_budget` / `cost_budget_usd` caps (`@forge/contracts`'s
  `InitiativeManifest`). There's no separate `features[]` list: the PM
  decomposes the acceptance criteria directly.
- **The state machine:** `interviewing → exploring → drafting →
  awaiting-verdict → finalizing → committed` (`packages/sessions/kinds/architect.ts`).
  Each turn is bounded and file-checkpointed — the operator's think-time
  happens *between* turns, not inside a blocked session, so the session
  survives a crash at any point ([ADR 012](../decisions/012-crash-recovery.md)).
  An `exploring` stage runs once before drafting: it enumerates edge cases
  (dispositions `covered` /
  `needs-initiative` / `deferred` — nothing found may silently vanish) and
  brain-sourced constraints, and fails open — an empty or failed exploration
  is logged and the session proceeds rather than blocking.
- **The completeness critic** (`packages/sessions/kinds/architect-critic.ts`)
  is a single advisory structured-output pass at the FINALIZE step, after the
  operator approves the PLAN and before manifests promote to
  `_queue/pending/`. It checks the drafted plan for coverage gaps — dropped
  scope, an orphaned or double-owned initiative, an invariant stated once in
  prose but never propagated into every constrained initiative's acceptance
  criteria. A crash resolves to zero findings rather than blocking finalize
  (advisory infrastructure must never brick the gate); a real finding blocks
  promotion once, surfacing back to the operator. This is a single pass, not
  a multi-agent panel — an earlier design's `CouncilTranscript` type
  (`packages/sessions/kinds/architect-plan.ts`) still carries `perCritic` /
  `flags` / `escalations` fields, but the runtime populates them as an empty
  placeholder today; naming it here so a future reader doesn't mistake the
  type's shape for a live multi-critic pipeline.
- **Known failure modes:** an agent that over-scopes one idea into a sprawling
  spec (the prompt caps initiative size and prefers small, releasable
  initiatives); vague acceptance criteria propagating downstream, now that
  there's no feature list to fall back on — the completeness critic is the
  backstop, not a per-criterion reviewer; an edge case enumerated during
  exploration but never turned into an initiative, which the `disposition`
  field exists to make visible rather than silently dropped.

## Plan — decomposing the initiative into work items

*Unattended.* Code identifier: `pm` / `project-manager`
(`skills/project-manager/SKILL.md`, `packages/factory/phases/project-manager.ts`).
Reads the architect's confirmed initiative and decomposes its acceptance
criteria directly into **work items** — atomic, dependency-ordered units the
build station can verify. There's no intermediate feature list: the PM maps
acceptance criteria to outcome-sized work items in one pass.

- **Inputs:** the claimed initiative manifest; the project tree at the
  worktree's HEAD; Brain 2 + Brain 3 (mandatory).
- **Outputs:** one `.forge/work-items/WI-<n>.md` file per work item plus a
  `_graph.md` dependency graph (mermaid `graph TD`) — both formats locked by
  [ADR 015](../decisions/015-work-item-format.md). Validated by
  `@forge/flows`'s `validateWorkItem` / `validateWorkItemSet` /
  `detectHiddenCoupling` (`packages/flows/work-item.ts`) before anything
  downstream trusts the set.
- **Optional per-WI fields** (ADR 015 §3a, all omit-on-undefined):
  `quality_gate_cmd` (a per-WI gate override), `non_goals`,
  `verification_artifact`, and `creates` (which file a WI originates, feeding
  the one-creator-per-file rule). `demo_hook` is initiative-level only, never
  a WI field.
- **Sizing is qualitative, not a fixed count.** The current skill's guidance
  is "atomic, outcome-sized" per work item — a spec that runs over a page is
  a signal to decompose further, not a target number of work items per
  initiative. PM may not invent acceptance criteria or work items ungrounded
  in the initiative body; every GWT block in the body must be exercised by
  at least one work item's `quality_gate_cmd`.
- **On validation failure, the set is quarantined, not discarded.** A set
  that fails validation — a hidden-coupling collision, a brain-first skip, a
  checkpoint that capped decomposition mid-flight — is moved wholesale to a
  timestamped `work-items-rejected-<stamp>` sibling directory with the
  failure reason recorded beside it (`packages/factory/phases/pm-rejected-set.ts`).
  This replaced an earlier design that deleted the stale directory and
  retried the PM once with an augmented prompt: the failed set is now kept
  as evidence (a rejected decomposition is the best record of *why* it
  failed) and every downstream reader of the work-items directory sees it as
  empty rather than silently running a partially-emitted set — the defect
  this closes let a validation-failed set merge to a real project anyway,
  because the failure path withheld only the manifest's `specs` pointer
  while the directory itself stayed readable.
- **Known failure modes:** over- or under-decomposition (a WI spec running
  over a page is the signal to split it further; there's no numeric cap);
  vague acceptance criteria (every WI needs ≥ 1 GWT criterion,
  enforced by the validator); hidden dependencies — two WIs editing the same
  file with no ordering edge between them — caught by
  `detectHiddenCoupling`; multiple creators for one file, caught by the
  `creates` field; a trivially-green build if the whole-project gate would
  pass before any WI's work lands, which per-WI `quality_gate_cmd` exists to
  rule out on larger initiatives.

## Build — the Ralph loop

*Unattended; the fan-out station.* Code identifier: `dev` / `developer-ralph`
(`skills/developer-ralph/SKILL.md`, `packages/factory/phases/developer-loop.ts`).
Walks the work items in topological order, running one Ralph loop per work
item in its own git worktree, skipping dependents of a failed prerequisite.
Concurrency is capped (`concurrencyCap: 1` today) and per-item isolation
means one wedged work item doesn't block its unrelated siblings.

- **Inputs:** one `.forge/work-items/<id>.md` spec; the runtime-adapter
  registry (`packages/agents/_adapters/`) selects the SDK — the flow calls
  `getAdapter(sdkId).createAgent(...)`, never a hardcoded Claude path, so a
  second runtime is a registry row rather than an orchestrator edit; Brain 3
  only, advisory (see the Brain table above — step one of the skill is
  explicitly "no forge-brain query").
- **Outputs:** commits in the worktree, ideally atomic per acceptance
  criterion; the work item's `status` flipped to `complete` or `failed`;
  iteration events in the cycle's event log.
- **The only no-progress backstop is the iteration budget.** A Ralph loop
  that never converges aborts when its iteration budget is exhausted — there
  is no other wedge detector at this layer (a stall watchdog guard exists,
  but the budget is what actually bounds runaway iteration).
- **Known failure modes:** wedged loops (iteration budget is the backstop);
  token burn on no-op iterations (budget plus the initiative cost ceiling
  cap it); merge conflicts across parallel work items (per-work-item
  worktrees plus the merge-boundary gate below); hallucinated test passes —
  gate verification runs outside the agent's own process, never trusting the
  agent's self-report.

## Integrate — deriving the review bundle

*Unattended; an orchestrator verb, not an LLM turn.* **Write `integrate`,
not `demo`, for this station** (vocabulary ruling 383) — its code identifier
is `demo`: the flow node id is `demo`, the skill directory is
`skills/demo-agent/`, and the module is `packages/factory/phases/integrate.ts`.
Name that mapping once, here, and use `integrate` everywhere else.

Takes the branch the build station finished and turns it into what a
reviewer reads: a `demo.json` + `DEMO.md` bundle and the PR body. **Nothing
in this bundle is authored** — it's derived from the acceptance criteria the
work items carry, the merge-boundary gate's own evidence, and the diff
(`derive-demo-model.ts`, `derive-pr-body.ts`) — so there's no draft to
validate, no retry to spend, and no coverage heuristic to fool. The
`demo-agent` skill's own description is explicit about this: no model is
spawned on any path.

- **What the change class decides:** the class → gate-profile table
  (`packages/factory/class-profiles.ts`, [ADR 051](../decisions/051-change-class-and-typed-acceptance-criteria.md))
  selects the capture mode — `checkpoints` runs the project's declared
  `demoProcess` steps under orchestrated capture, `plan-output` records the
  merge gate's own output, `none` records the diff alone. A class that asks
  for checkpoints against a project contract that declares no `demoProcess`
  fails loud — an empty capture is not the same fact as a capture nobody
  asked for.
- **What it does not decide:** whether the acceptance criteria were actually
  met. That verdict belongs to the read-only review station, next.
- **The merge boundary runs first.** For one change class, the boundary runs
  the project's declared `testProcess.*` gates the class selects, then (only
  on a green gate) the class's own orchestrator verb — `docs` selects no
  test suite at all and is checked by `forge gate docs` instead
  (`packages/factory/phases/merge-boundary.ts`).

## Review — the one read-only agent

*Unattended; read-only by design.* Code identifier: `adversarial-review`
(`skills/adversarial-review/SKILL.md`, `packages/factory/phases/adversarial-review.ts`).
One agent, no execution tools ([ADR 036](../decisions/036-orchestrator-owned-gate-execution.md)
stands: gates are orchestrator verbs, never agent-authored scripts). It
critiques the diff the integrate station derived, producing a per-acceptance-criterion
verdict plus a Why/What/How paragraph.

- **Band order:** assemble (the orchestrator hands the agent a diff, diffstat
  and changed-files list — the agent judges, it doesn't gather its own
  evidence) → spawn (one bounded turn) → harvest
  (`.forge/review-findings.json`, one bounded authoring retry on a schema
  miss) → persist (the `review-findings` artifact) → scrub (nothing
  untracked survives to block a later merge).
- **A pre/post `git status` diff hard-fails any write outside the findings
  file** — the reviewer is read-only in enforcement, not just in prompt.
- **The findings are claims, not a gate by themselves.** The operator weighs
  them at the verdict gate; approving is what merges
  ([ADR 021](../decisions/021-local-review-and-unified-demo.md): approve
  *is* the merge).

## Verdict — the second human moment

*Human-in-the-loop; not an agent.* The `forge-develop` flow's terminal node
is a gate, not a station that runs code: the operator reads the review
findings and the integrate bundle in Studio and approves or sends back. On
approve, the flow's merge fires; on send-back, the flow re-enters the build
station via band re-entry (`resume_from: 'develop'`) rather than restarting
the whole initiative — the flow stays a DAG with no back-edges, and a
send-back is a re-dispatch of the one build executor, not a new topology.

## Reflect — closing the loop

*Unattended; a standalone agent, not a flow node.* Code identifier:
`reflector` (`skills/reflector/SKILL.md`, `packages/factory/phases/reflector.ts`).
`forge-develop` terminates at "ready for review" (PR open), before merge, so
the flow's own `flow-complete` trigger can't be the merge signal — merge is
async and confirmed later. The flow declares `{on: merged, target: {kind:
agent, ref: reflector}}`; once a merge is confirmed, that declaration — not
a hardcoded call — is what dispatches the reflector.

Runs a four-stage retrospective:

1. **Agentic self-reflection** (unattended) — the agent reviews its own
   performance from the cycle's event log.
2. **Agent-prompted user questions** (file handoff) — writes structured
   questions to `_logs/<cycle-id>/user-questions.md`.
3. **Pure user feedback** (file handoff) — reads
   `_logs/<cycle-id>/user-feedback.md` if a human populated it; a no-op if
   not (unattended-only runs skip this stage rather than blocking on it).
4. **Brain writes** (unattended) — direct file writes of theme markdown plus
   a cycle archive.

- **Direct writes, not `brain-ingest`.** All four stages write to the brain
  by direct file write; `brain-ingest` is available in the skill's
  composition but is explicitly not invoked in this closure pass
  (`skills/reflector/SKILL.md`). The orchestrator regenerates
  `brain/INDEX.md` after theme writes; the reflector maintains the
  per-category indexes itself.
- **Outputs:** `retro.md` (self-reflection / user questions / user feedback
  sections); new theme pages under `brain/projects/<project>/themes/` and
  `brain/cycles/themes/` — each with a `## Sources` section citing at least
  one evidence path that resolves; `brain/cycles/_raw/<cycle-id>.md`, the
  archived cycle log.
- **Reflection never changes the cycle's outcome.** The merge is already
  confirmed and closed before reflection runs — closure moves the manifest
  `in-flight/ → merged/` on a confirmed remote merge, and `merged/` is a
  transient pass-through, never a parking state. `finalize-merged.ts`
  promotes it on to `_queue/done/` in the same sweep regardless of whether
  reflection succeeded, threw, or was never triggered — a thrown reflector
  surfaces `reflection_status: 'failed'` in telemetry, but the terminal move
  to `done/` happens either way; reflection cannot reopen or revert a merged
  cycle.
- **Known failure modes:** vague retros ("we could do better at X") —
  rejected because every `## Sources` path is checked to resolve; a cycle
  with a wedge or send-back that produces no `category: antipattern` theme
  is a contract miss the skill is designed to avoid; brain growth without
  curation, backstopped by `forge brain lint`'s frontmatter/category/evidence
  rules.

## What's deliberately not on this page

Per-field schemas (the work-item frontmatter, the manifest frontmatter, the
`class → gate-profile` table's columns) are reference material, not
explanation — they live in ADR 015 and ADR 051, and in the class-profiles
module's own comments. This page is the "why does the shape look like this"
companion to those; if you need the exact field list, that's the wrong
altitude for what's written here.
