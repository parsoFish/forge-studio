# `@forge/agents` — design

## The seam

One agent, run once. Resolve a slug to a definition, compose its prompt, spawn
it through a pinned SDK seam, keep what it spawns contained, and classify how it
ended. Everything else in this package exists to serve that sentence.

## ADR 024 — an agent composes skills; it is not a hardcoded phase

The runnable unit is a **SKILL.md with frontmatter**, not a function in a phase
table. `studio/agent-registry.ts` loads it, `studio/derive.ts` derives what the
runtime needs from it, and `run-agent.ts` spawns whatever it describes. That is
why the package has a *registry* and a *derivation* rather than a switch: adding
an agent is authoring a file, and the code path does not change.

The consequence worth stating: **declared data must be enforced somewhere**. A
frontmatter field that is parsed and surfaced but checked nowhere is the
recurring defect class of this codebase. `composition.guards` is rejected
against a closed set, `runtime.loopStrategy: 'ralph'` is refused on the
standalone route before a run directory exists, and connection readiness is
checked before a spawn rather than after a failure.

## ADR 043 §3 — session kinds dispatch ahead of the legacy table

`cmdAgentRun` resolves a turnSpec-bearing session-kind descriptor **before** it
consults `AGENT_RUNNERS`. All four legacy kinds have since been ported into
`packages/sessions/kinds/`, so that table is now empty — and it stays, because
`packages/sessions/studio/session-kinds.test.ts` asserts against it. That
assertion is what stops a new kind quietly acquiring a bespoke runner and
re-opening the per-runner cap park ADR 043 dissolved. `knownAgentIds` derives
the operator's usage line from the **union** of both tables for the matching
reason: a kind that ports must not become invisible while still working.

## The spawn containment contract

A dispatched agent must not act outside the tree it was given. Four rules, each
of which exists because it was broken once:

1. **The root is kernel's `FORGE_ROOT`, never `'..'` arithmetic.** A root
   derived by counting directories from a module's own location resolves
   somewhere plausible-but-wrong the moment that file moves, and a guard reading
   an empty tree fails quietly.
2. **The workdir is never the parent's `process.cwd()`.** An unbound dispatch
   resolves to its own run directory. Inheriting the parent's cwd is how a
   dispatched agent came to edit a checkout nobody chose for it.
3. **The run owns what it spawns.** Every spawn carries a per-run env marker at
   the pinned-query seam, so a grandchild that calls `setsid` and outlives its
   parent — invisible to both a ppid walk and a process-group sweep — is still
   attributable. The marker is inherited only by what we spawned, which is what
   lets the sweep find an orphan without also matching the operator's shell.
4. **A run that cannot proceed still owes a terminus.** A refusal, a crash and a
   SIGTERM all write a terminal event; a log that simply stops cannot be read as
   complete or incomplete, and the bridge reports a perpetual `running`.
   SIGKILL remains uncatchable — that residual is reader-side and belongs with
   the bridge, and is stated rather than implied away.

## Rank 3, and why so much is injected

The allow-graph puts this package above `contracts`, `kernel`, `library`,
`knowledge` and `projects`, and below `sessions`, `flows` and `factory`. So
every collaborator from above arrives as a deps object bound at
`apps/forge/routes.ts` or `apps/forge/cli.ts`:

- `BandAgentDeps` — the two factory band pipelines plus flows' queue and
  manifest readers, so a standalone `demo-agent` / `adversarial-review` run goes
  through the SAME pipeline the flow band runs. The port is declared here rather
  than reusing kernel's `PhaseExecutor`, whose `CycleOutcome` return is a
  whole-cycle verdict; what crosses this seam is a pipeline status.
- `AgentsRouteDeps` — the bridge instance state and the rank-4/5 reads the eight
  carved `/api/agents*` and `/api/studio/agents*` handlers need. The aggregation
  helpers behind the history and recent-runs routes are pure functions of those
  deps: moving their source while they still called sessions and flows directly
  would have relocated boundary violations rather than closing them.
- `agentUsageIndex` — inverted the other way. Library must not read agent files,
  so it receives the reverse index instead (T1 rulings 13 and 73).

Containment guards are the exception and are imported directly from
`@forge/kernel`: an injected guard is a guard a caller can replace.
