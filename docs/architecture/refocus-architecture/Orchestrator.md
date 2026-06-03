# Orchestrator (engine substrate)

> **Intent.** The thin, deterministic, **LLM-free** coordination layer the phases run
> inside. It claims pending initiatives, runs each as a cycle in its own git worktree,
> heartbeats, moves the manifest through a filesystem state machine, owns the **merge-gate
> invariants**, recovers from crashes, and notifies. It holds **no phase intent** and
> composes **no skills** — that is correct; it is the substrate, not a phase.
>
> **Type:** engine substrate (there is deliberately no "phase" here). **Realized via:**
> [orchestrator/scheduler.ts](orchestrator/scheduler.ts) (the `forge serve` loop) +
> [orchestrator/cycle.ts](orchestrator/cycle.ts) (the phase spine) + `queue.ts` /
> `worktree.ts` / `closure.ts` / `pr.ts` / `daemon.ts` (ADRs 011-013, 019).

## Responsibilities

1. **Claim** pending initiatives atomically (`mv`) up to a static concurrency cap,
   respecting the **dependency gate** (`depends_on_initiatives` all in `done/`) — a
   dependent must wait for its prerequisite to *merge* before branching from fresh `main`.
2. **Provision** a git worktree per in-flight initiative (link gitignored deps so the gate
   runs); **heartbeat**; **recover** crashed/orphaned cycles via two filesystem sweeps.
3. **Drive the phase spine** ([cycle.ts](orchestrator/cycle.ts)): thread each phase's output
   into the next phase's input — PM → dev-loop → unifier → review → closure → reflect —
   without authoring any phase prompt.
4. **Own the merge-gate invariants:** the dev-loop-close branch-sync check, the delivery
   gate (no PR unless the unifier gate passed), and **G1 (`done/` ⇒ gh-confirmed merged) /
   G9 (never auto-merge) / G10 (reflection only on confirmed merge)**.
5. Move the manifest through the `_queue/` state machine on terminal status; **bounded
   auto-retry** (≤2) of recoverable failures; notify the operator.

## Inputs → Outputs

**Consumes:** `_queue/pending/<id>.md` manifests; `forge.config.json`; git + gh state.
**Produces:** `_queue/` state transitions (atomic moves); worktrees + pushed branches; the
JSONL event log + snapshotted artifacts; operator notifications.

## Relationships

- **Upstream:** the [Forge↔Project Contract](docs/architecture/refocus-architecture/forge-project.md) decline gate; the queue (written by the
  architect via `promote-manifests`).
- **Spawns:** every phase ([PM](docs/architecture/refocus-architecture/Project-Manager.md), [dev-loop + unifier](docs/architecture/refocus-architecture/Developer-Loop.md),
  [review](docs/architecture/refocus-architecture/Review-Loop.md), [reflect](docs/architecture/refocus-architecture/Reflection.md)) — picking the
  agent + model tier per the [Skill-Model](docs/architecture/refocus-architecture/Skill-Model.md) seam.
- **Read out-of-band by:** the [UI bridge](docs/architecture/refocus-architecture/forge-ui.md) (files only — no compile-time dep).

## Boundaries (what this is NOT)

- **Never** a job queue with priorities/dedup, a worker pool, a resource controller, or a
  process isolator (ADRs 011-013). The filesystem *is* the protocol; `ls _queue/` is the
  whole state.
- Not an agent — no LLM calls, no prompts, no skills.
- Not the phase-intent owner — it spawns; the skill holds the intent.

## Divergences to resolve → [backlog](docs/architecture/refocus-architecture/REFINEMENT-BACKLOG.md)

- **[ORC-1 · high]** `scheduler.ts` is 771 LOC against the ~150 intent (≈5×). Extract the
  operator-experience concerns (progress tee, idle ticker, announce dedup) and the manifest
  parsing; reconcile the ADR 011 LOC budget to the honest number with rationale.
- **[ORC-2 · med]** **Three hand-rolled YAML frontmatter parsers** (`scheduler.parseManifest`,
  `parseManifestFile`, `queue.parseWorktreePath`) for one format — `manifest.ts` is already
  imported. Collapse to the one parser (hand-rolling is what CLAUDE.md forbids).
- **[ORC-3 · med]** `pr.ts` (899 LOC) forks on `hasOriginRemote` in nearly every function for
  a no-origin local-merge shim — quarantine behind one injected `PrTransport` (real-gh vs
  local) so the production merge-gate path is readable. *(Confirm whether local-merge is a
  supported run mode or bench-only.)*
- **[ORC-4 · med]** `node_modules` protection is duplicated across `linkProjectDeps` +
  cycle.ts `git reset` — keep one (the git-exclude). Two `closure→reflector` chains
  (in-cycle vs `finalize-merged`) — unify onto one shared `finalizeMerged()`.
- **[ORC-5 · low]** `failure-classifier` computes ~18 boolean signatures to feed a binary
  transient|terminal decision (`priorModes` read then discarded) — keep the transient set +
  reason strings, fold the rest into a terminal default. Synthetic architect start/end events
  in cycle.ts are presentation leaking into the engine (consider deriving in the UI).
