# Forge — holistic user stories

> The minimal set of stories that captures forge's intent **without
> losing it**. Derived from the trafficGame-arc reflection
> (`_logs/2026-05-16_trafficgame-arc-reflection/`) and the as-built
> snapshot (`docs/architecture/as-built-snapshot-2026-05-17.md`). Every
> story has a single clear boundary, explicit inputs/outputs, and a
> concise testable goal. If a story needs a sub-system to grow surface
> to satisfy it, that is a smell — see Epic 7. **Traceability (bottom of
> file) maps every story to its now-LANDED durable record** — the
> closure arc (Phases 1–8) implemented all of them.

**North star.** *As the single operator of many side projects, I want a
system that turns an intent into merged, demonstrated work largely
unattended — pausing only at three deliberate human moments — so that my
throughput is bounded by my judgement, not my keystrokes.*

---

## Epic 1 — Unattended progress (the core loop)

**US-1.0 — Vision → right-sized initiatives.** As the operator, I want
the architect to turn a free-form vision into a roadmap and atomically-
sized initiative manifests, sized from the brain's historical
work/cost evidence, so that what enters the queue is already tractable.
- In: a free-form intent + `roadmap.md` + brain (antipatterns + sizing).
- Out: `roadmap.md` rows + `_queue/pending/INIT-*.md`.
- Done when: each emitted initiative is schema-valid and pre-sliced to
  the contract's C1/C3 norms; the architect demonstrably consulted the
  brain. (This is a human moment — US-3.1 — not a wired phase.)

**US-1.1 — Decompose an initiative.** As forge, I want the
project-manager to turn one initiative manifest into atomic, dependency-
ordered work items, so that the dev-loop can execute them in isolation.
- In: `_queue/in-flight/INIT-*.md` + project worktree + brain.
- Out: `.forge/work-items/WI-*.md` + `_graph.md`.
- Done when: every WI is schema-valid, the graph is acyclic, and no
  hidden coupling remains unflagged.

**US-1.2 — Implement a work item.** As forge, I want the dev-loop to
satisfy one WI's acceptance criteria via a bounded Ralph loop, so that
progress is objective and cost-capped.
- In: one WI spec (+ its `files_in_scope`) — **not** the brain.
- Out: commits on the initiative branch + WI status.
- Done when: the project quality gate passes or a stop condition fires;
  the WI is the *only* unit of intent the agent needs.

**US-1.3 — Converge an initiative holistically.** As forge, I want the
review phase to judge the *whole* initiative branch against the
initiative's intent and refine it (spawning dev-loops as needed), so
that the result is coherent, not a pile of isolated WIs.
- In: initiative branch + manifest intent (+ architect narrative).
- Out: an intent-aligned branch + an embedded demo + a PR on the
  project repo.
- Done when: ACs are broadly met holistically and a demo exists; the
  review phase **never auto-merges**.

**US-1.4 — Learn from every closed cycle.** As forge, I want the
reflector to convert a confirmed-merged cycle into evidence-grounded
brain themes, so that the next cycle is better than the last.
- In: events.jsonl + merged tree + brain.
- Out: `retro.md` + theme files + cycle archive + `brain/log.md`.
- Done when: it fires only on a **confirmed** merge and every theme
  cites resolvable evidence.

## Epic 2 — The brain as memory (read policy)

**US-2.1 — The planner reads the brain.** As the architect/PM, I want to
read antipatterns and historical work-sizing before slicing an
initiative, so that I avoid known traps and size work realistically.
- Done when: planning/PM brain reads are enforced and use the
  INDEX/category-index/profile metadata (navigation), not full scans.

**US-2.2 — The dev-loop and reviewer do NOT read the brain.** As forge,
I want execution and review to rely solely on the work items the planner
authored, so that intent has one source and brain cost is not paid twice.
- Done when: no dev-loop/reviewer code path reads `brain/`; all intent
  the executor needs is in the WI; the reviewer's intent source is the
  manifest + WI set the planner produced.

**US-2.3 — Brain reads are guard-railed.** As forge, I want every brain
read to go through the built indexes/metadata first, so that reads are
cheap and bounded.
- Done when: a read budget/path discipline exists; the cached index
  staleness window is either invalidated per cycle or documented.

**US-2.4 — The brain measurably improves outcomes.** As the operator, I
want each reflection to change the brain so that comparable future
initiatives are cheaper / faster / more reliable, so that forge
compounds rather than relearns.
- Done when: a brain query before vs after a cycle surfaces new
  evidence-grounded themes; repeated initiative shapes trend down in
  cost/iterations cycle-over-cycle (the Principle-3 brain example).

## Epic 3 — Human interaction at three deliberate moments

**US-3.1 — Three moments, the operator's own session.** As the operator,
I want the three human interaction points — (a) roadmap/architect,
(b) review feedback & merge, (c) reflection feedback — to happen in **my
own Claude session** (CLI / VSCode extension), not a forge-spawned
agent, so that I stay in control with full context.
- Done when: each moment is a **slash command** I invoke
  (`/forge-architect`, `/forge-review <id>`, `/forge-reflect <id>`);
  forge never simulates these in production.

**US-3.2 — The PR is the review surface.** As the operator, I want to
give feedback and merge on the GitHub PR itself, so that the showcase
and the decision live in one place.
- Done when: review feedback is user-triggered against the PR; merging
  the PR in GitHub is what closes the review phase; on closure forge
  aligns local to remote.

## Epic 4 — The forge↔project contract

**US-4.1 — A project must be ready before forge runs it.** As the
operator, I want a written, checkable preflight (contract clauses
C1–C6: fast gate, scratch hygiene, decomposed source, machine-readable
arch context, honoured locked-core, satisfiable merge model), so that
forge only attempts projects it can actually progress unattended.
- Done when: a project either passes the preflight or forge declines
  with the failing clause named.

## Epic 5 — Resilience & truthful state

**US-5.1 — Classify and auto-retry recoverable failures.** As forge, I
want a thrown cycle classified into one failure mode and auto-retried
only when that mode is recoverable, within an anti-thrash budget, so
that transient problems self-heal and real ones surface clearly.
- Boundary: classification + retry decision only (caps and crash
  recovery are US-5.4/US-5.5).
- Done when: every failure maps to exactly one *reachable* classifier
  mode (no dead modes); recoverable modes retry ≤2 with anti-thrash;
  fatal modes stop with a named diagnosis.

**US-5.4 — Never run away.** As the operator, I want every loop bounded
by iteration, cost, and wedge caps, so that an unattended failure is
cheap and self-terminating.
- Done when: each Ralph loop stops on quality-gate-pass OR
  iteration-budget OR cost-budget OR wedged; per-initiative $/iteration
  caps are enforced and surfaced in the event log.

**US-5.5 — Crash-recoverable, no orphan state.** As the operator, I want
forge to resume cleanly after a crash/restart and leave no orphan
worktrees or branches, so that unattended operation survives
interruption.
- Done when: stale-heartbeat / missing-worktree sweeps return work to
  pending and remove the owning worktree + branch; a restart re-claims
  safely; no leaked `_worktrees/` after any terminal state.

**US-5.2 — Queue state is the truth.** As the operator, I want
`_queue/done/` to mean "merged in GitHub", so that I can trust the
system's own report.
- Done when: `done/` ⇒ the PR is `MERGED`; partial merges are flagged,
  never silently accepted.

**US-5.3 — Local equals remote.** As forge, I want the initiative branch
kept in sync with origin throughout, so that the merge boundary never
diverges.
- Done when: at dev-loop close `origin/<branch>` == local HEAD and
  `main` == merge-base.

## Epic 6 — Phase isolation + chained verification

**US-6.1 — Each phase provable in isolation.** As the operator, I want
each phase to keep its own benchmark that matches forge's *actual*
current behaviour, so that I can prove a phase improved without running
the whole cycle.
- Done when: no bench asserts behaviour forge no longer has (no
  false-green) and none fails purely from drift (no false-red).

**US-6.2 — An e2e test is a seed fed into the chain, not its own
benchmark.** As the operator, I want the chain to *purely tie the
existing per-phase benchmarks together* — each phase bench's generated
output is the next phase bench's input — so that the overall cycle is
tested without any standalone e2e fixture or e2e rubric.
- Done when: an e2e test is a single **seed** (architect-level intent)
  entered at the front of the chain; scoring is **solely** the six
  existing per-phase `scoring.ts:caseScore` over one generated artifact
  set; there is no `benchmarks/e2e/scoring.ts` or any chained-only
  rubric/fixture; isolated benches keep their golden fixtures unchanged
  (one rubric set, two input sources).

## Epic 7 — Simplicity as a standing constraint (cross-cutting)

**US-7.1 — Clear boundaries, clear I/O, concise goals.** As the
operator, for every component (code, instruction, agent, skill) I want
exactly one responsibility, named inputs and outputs, and a concise
goal, **without losing the component's intent**, so that the system
stays comprehensible and adherence is enforceable.
- Done when: a component's responsibility fits one sentence; its I/O is
  enumerated; adding surface to satisfy a story is treated as a defect
  to be redesigned, not accepted. Consolidate (Ralph drives one role;
  one coupling validator; one notify sink; PR/merge out of the
  reviewer) rather than accrete.

**US-7.2 — Reuse over hand-roll.** As the operator, for every subsystem
I want a battle-tested tool used unless non-reuse is explicitly
justified, so that forge stays small and robust (Principle 1).
- Done when: each subsystem either delegates to a community tool
  (SDK / Ralph / `gh` / `git` / notify-send) or carries a one-line
  ADR-backed justification; hand-rolled code that is dead or
  partially-implemented is a defect to delete, not keep.

## Epic 8 — Observable, replayable cycles (Principle 5)

**US-8.1 — One event log is the single source of truth.** As the
operator, I want every action/input/output emitted to one append-only
`_logs/<id>/events.jsonl`, with live monitoring and per-cycle metrics
that read *only* that log, so that I can watch, debug, and reflect.
- Done when: every phase emits start/end + per-iteration events;
  `forge status` / `forge metrics` / the monitor derive solely from the
  log; a cycle is replayable from it; no declared event_type or
  SKILL-mandated event is unemitted (no dead taxonomy).

---

## Traceability

| Story | Durable record |
|---|---|
| US-1.0 | brain `human-interaction-via-own-session`; arch §A (out-of-cycle architect) |
| US-1.3, US-3.2, US-5.2, US-5.3 | brain `review-phase-target-design`; arch §G; retro C6/G8–G10 |
| US-2.* | brain `brain-read-policy` |
| US-3.* | brain `human-interaction-via-own-session` |
| US-4.1 | brain `forge-project-onboarding-contract`; retro §3 C1–C6 |
| US-5.1, US-5.4, US-5.5 | arch §E (classifier); ADR-011/012; retro G5 |
| US-6.* | brain `chained-phase-benchmarks`; `_logs/2026-05-16_trafficgame-arc-reflection/benchmark-alignment.md` |
| US-7.1, US-7.2 | brain `reactive-constraint-stripback-arc`; PRINCIPLES.md P1/P2; arch §H |
| US-8.1 | PRINCIPLES.md P5; ADR-008; arch §B |
