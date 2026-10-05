# Forge Studio — Project Instructions for Claude Code

## Identity

**forge-studio** is a construction platform for agentic software factories: a
small set of composable primitives — agents, skills, flows, knowledge, gates —
that let one operator assemble a purpose-built delivery pipeline for any
codebase. It ships **one working example, the develop flow**, as evidence the
kit works; the example is not the product. Licence AGPL-3.0-or-later. Install
form: a Node source checkout (Node ≥ 22.12). Platform: WSL2 / Linux. The
operator is **one human running many side projects**.

**Vocabulary — use these words in docs, UI and code.** *Factory* (one
assembled, running pipeline) · *Flow* (ordered path of stations; `FlowDef`,
SPEC §2) · *Station* (a step where an agent or gate acts) · *Gate* (human or
automated approval between stations) · *Agent* (worker executing a station;
`PhaseAgentSpec`, SPEC §1; session kinds, SPEC §5) · *Skill* (reusable
instruction/tool unit) · *Brain* in-product, *Knowledge* outward (`KbBackend`,
SPEC §4). `node scripts/check-identity.mjs` lists the retired terms and fails CI
on any current-state doc, skill or README that uses one.

A factory runs **primarily unattended** between the gates its flow declares;
those gates are the factory's, not the platform's. The example develop factory
pauses at its plan gate, starts on a named operator act (kickoff from the
roadmap card), and pauses again at its verdict and reflection gates
([example factory](./docs/explanation/example-factory.md)).

Judge every change against three questions: does it preserve unattended
operation · does a battle-tested tool already do this · is it the simplest thing
that could work. There is **one operating model**: the daemon (`forge serve`);
operator-directed step-through falls out of isolated phase functions, not a
forked runtime.

## Where things are

- Contracts every package obeys, each naming the test that holds it:
  [`SPEC.md`](./SPEC.md).
- Live decisions and rejected alternatives, one line each:
  [`DECISIONS.md`](./DECISIONS.md). Grep it before proposing a design; a
  "Rejected" line is not re-proposed.
- Package map and allow-graph: [`ARCHITECTURE.md`](./ARCHITECTURE.md) ·
  principles [`PRINCIPLES.md`](./PRINCIPLES.md) · per-package caps and owners
  [`QUARRY.md`](./QUARRY.md) · commands and quickstart
  [`README.md`](./README.md).
- The plan: [`docs/roadmaps/1.0.md`](./docs/roadmaps/1.0.md). Its §1 is the
  fresh-session read order; follow it before designing anything. Campaign
  state lives in a gitignored campaign directory; a committed file never cites
  a path inside it.
- Area rules load on their own when you touch the area (`.claude/rules/`).

## Studio session

`forge studio` is the sole operator surface (D-12), on fixed ports: bridge
**4123**, UI **4124**. Run it once at session start and keep it up; restart it
only to apply changes to Studio's own code. It serves a production Next build;
`--dev` keeps next-dev for UI iteration. A second `forge studio` probes
`GET /api/health` and **reuses** a healthy forge bridge; human viewers open a
second window with `--attach`. **Never `--force-takeover` a running agent
session** — it SIGKILLs the bridge and hard-resets in-flight cycles.

## Gates

A PR merges only when all of these pass on its head (CI runs them;
`.github/workflows/ci.yml` is the list):

```bash
npm run build && npm test && npm run test:ui && npm run test:ui:typecheck
node --experimental-strip-types apps/forge/cli.ts studio lint
node --experimental-strip-types apps/forge/cli.ts brain lint
npm run lint                                   # markdownlint
node scripts/check-identity.mjs                # retired vocabulary
node scripts/check-decisions.mjs               # every DECISIONS row names its check
node scripts/check-stale-path-citations.mjs    # cited paths exist; CLAUDE.md ≤ 150 lines
node scripts/check-boundaries.mjs              # allow-graph (D-29)
node scripts/check-file-size.mjs && node scripts/check-owner.mjs && node scripts/check-package-caps.mjs
npm run stories -- --story smoke && npm run stories -- --story proof
```

## Merge protocol

Strict branch protection → `gh pr update-branch` → CI green **on the exact head
SHA** → merge → re-verify merged main with build, typecheck and the full
`npm test`. Never merge on absence of red: a gate that reports no checks is not
green. Never `--admin`. Never `git add -A`. `git checkout` never shares a
command line and never takes `.`. Conventional commits
(`feat|fix|refactor|test|docs|chore|perf|ci`), no AI attribution lines, one
concern per PR, git worktrees for parallel work. Never squash-merge stacked PRs.

## Docs

- A user-facing change updates the page whose `covers:` matches the code you
  changed, in the same PR; the PR body carries a `Docs impact:` line.
- Never hand-edit a generated page (`generated_from:`): change the story and
  re-run it. A hook blocks the edit.
- Word budgets are ceilings, never targets (D-37); shorter wins.
  `node scripts/check-docs-budget.mjs --report` prints every page.
- Agent-dev material (SPEC, DECISIONS, QUARRY, plans) never goes in the
  published site.

## Never do

- Re-invent a job queue, worker pool, resource controller or process isolator
  (R-03).
- Spawn agents as Claude CLI subprocesses — agents run through the SDK (D-01).
- Add a feature flag, fallback or backwards-compatibility path. There are no
  legacy users.
- Emit an artifact that is not greppable markdown, or a skill invocation that
  logs no structured event to the JSONL event log (SPEC §3).

## Park — produce the artifact, say so, and stop

- A change that conflicts with SPEC.md or DECISIONS.md: update them in the
  same PR, and the operator approves (D-38).
- A new external dependency (every dependency is a maintenance liability).
- A cross-project breaking change.
- A new guard (lint, check, ratchet) that does not retire one of equal weight,
  unless it closes a recorded incident.
