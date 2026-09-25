---
name: docs-writer
description: Launch the Ralph loop runner for a single docs-class work item; revise the pages in scope until the docs gate passes, the iteration budget is exhausted, or the loop is detected as wedged.
library: true
phase: developer-loop
surface: unattended
purpose: Implement one docs-class work item to a green gate inside its worktree — revise the pages it names, never the source they describe — iterating until the budget is exhausted or the loop wedges.
composition:
  skills: []
  tools: [git, node]
  mcps: []
  guards: [event-log, cost-guard, stall-watchdog, scratch-strip]
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
  loopStrategy: ralph
# forge-docs's own build-station agent (seam F4: the dev-loop band spawns
# under WHICHEVER def declares loopStrategy:ralph on the node, never a
# hardcoded canonical slug) — mirrors developer-ralph's fan-out declaration
# verbatim; a docs initiative is `singleWiAllowed` (packages/factory/
# class-profiles.ts) but the mechanism is unchanged.
fanout:
  drivingArtifact: work-items
  isolation: worktree
  concurrencyCap: 1
  perItemGate: item-declared
brainAccess: advisory
interactivity: Fully autonomous; never blocks on the operator.
allowed-tools: [Read, Write, Edit, MultiEdit, Bash, Grep, Glob]
disallowed-tools: [NotebookEdit, WebFetch, WebSearch, Task, Agent]
budgets: {}
---

# Docs Writer — Ralph

## Single responsibility

Drive a single `docs`-class work item to completion via the Ralph loop
pattern ([ADR 002](../../../../docs/decisions/002-ralph-loop-pattern.md)) —
forge-docs's own agent for the `build` station, the same loop mechanism
[`developer-ralph`](../../../../skills/developer-ralph/SKILL.md) drives for
`forge-develop`. Thin wrapper: prepare loop input artifacts (`PROMPT.md`,
`AGENT.md`, `fix_plan.md`), project: invoke the platform's `loops/ralph/runner.ts`.

The gate profile this run is judged against comes from the initiative's
`class: docs` field, read once by `packages/factory/class-profiles.ts` and
threaded into the dev-loop station — not from anything declared here:

- `iter0FailFirst: 'off'` — a docs page has no failing test to write first;
  there is no iteration-0 red-to-green requirement.
- `requiredPathsSource: 'files-in-scope'` — the gate's required-paths check
  (did the branch actually touch a declared path) reads the work item's full
  `files_in_scope`, not a narrower `creates:` list.

## Inputs / Outputs

**Inputs:**
- `<worktree>/.forge/work-items/WI-<n>.md` — the work-item spec.
- project: `loops/ralph/PROMPT.md.tmpl` + `loops/ralph/AGENT.md.tmpl` — templates.
- The worktree itself.

**Outputs:**
- Commits in the worktree (one per AC where possible).
- `<worktree>/AGENT.md` — institutional memory across iterations.
- `<worktree>/fix_plan.md` — checklist showing remaining work if incomplete.
- Iteration events to the event log.

> **Status frontmatter is owned by the orchestrator.** Do not edit
> `WI-<n>.md` — the orchestrator writes `status: complete | failed` after
> `run()` returns.

## Event-log entries to emit

Same vocabulary as `developer-ralph`: `ralph.start`, per-iteration
`event_type: 'iteration'`, `ralph.uncommitted-work-swept`, `ralph.end`.

## Process

1. Read the work item spec — single source of intent (no forge-brain query).
2. project: stamp `loops/ralph/PROMPT.md.tmpl` with the work-item content + ACs.
3. project: stamp `loops/ralph/AGENT.md.tmpl` (empty; the loop fills it).
4. Initialise `<worktree>/fix_plan.md` with the ACs as a checklist.
5. Invoke the ralph runner; the orchestrator writes `status` back to the WI.

## What "revise, never author the source" means for a docs change

- Edit the page(s) named in the work item's `files_in_scope` — for a `docs`
  WI that list IS the gate's required-paths check, so the branch diff must
  touch at least one of them before the gate can pass.
- Never edit the code, config, or behaviour a page describes. A docs WI
  corrects or extends what a page **says**; it does not change what the
  project **does**. If an acceptance criterion seems to need a source edit,
  that is a mis-classified initiative, not a widened scope — flag it in
  `AGENT.md` rather than making the edit.
- No failing-test-first step (`iter0FailFirst: 'off'`). Your evidence that an
  AC is met is the page reading correctly against the source it cites, not a
  red-to-green test transition.

## Constraints

Inherits `developer-ralph`'s whole discipline list: you are CONTINUING, not
restarting (`git log`/`git diff --stat main..HEAD` + `AGENT.md` first, every
iteration); write real edits early, not a research-only iteration; commit
every iteration with a conventional-commits message, never `git add -A` the
loop-scratch files (`AGENT.md`, `PROMPT.md`, `fix_plan.md` are gitignored on
purpose); no shortcuts, no hallucinated gate passes — prove a claim by
running the gate's own command via `Bash`. The orchestrator decides when to
stop, not you.
