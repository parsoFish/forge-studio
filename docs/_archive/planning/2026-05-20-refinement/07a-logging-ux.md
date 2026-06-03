---
area: logging-ux
date: 2026-05-20
date_split_from_07: 2026-05-21
date_contracts_locked: 2026-05-21
status: contracts locked — see CONTRACTS.md
contract_deps: [C13, C14]
council_review: ./07-general-logging-ids.council.md
ships_in_stage: S7
---

# Logging UX refinement plan (07a — split from 07 per C18d)

> **Contracts locked.** This plan honours [CONTRACTS.md](./CONTRACTS.md).
> Specifically: C13 (`agent_heartbeat` emits from
> `loops/ralph/claude-agent.ts` SDK call wrapper — NOT Ralph runner —
> with a sidecar timer started before `query()` and cleared on result;
> 15s default cadence configurable via `.forge/project.json`
> `logging.heartbeat_seconds`); C14 (`cost_tick` emits from a derived
> consumer subscribing to the existing `tee` hook — NOT from
> `logging.ts` — preserving ADR-008's single-writer / refs-not-contents
> discipline; de-bounce 1/s max, emit only when cost changed).
>
> Originally bundled with 07b (init IDs); split per C18d because the
> surfaces are disjoint. Ships in stage **S7** (after plans 04/05/06
> land — the unifier's new phase events must be stable before the
> pretty-printer's phase→colour map is finalised).

## Problem (grounded in actual log samples)

Sampled `_logs/2026-05-19T12-01-34_INIT-2026-05-19-trafficgame-backpressure-live/events.jsonl` (41 lines, 3 WIs, full PM → dev → review cycle). Unique event shapes observed:

```
orchestrator.cycle           start  cycle.start
project-manager              start/tool_use(pm.brain-query)/log(pm.work-item-emitted | pm.feature-decomposed | pm.graph-emitted)/end
developer-ralph              start/log(ralph.start | gate.pass | dev-loop.branch-pushed)/iteration/end(ralph.end)
review-loop.reviewer         start/log(reviewer.holistic-intent-aligned)/iteration/end
orchestrator.cycle           log(cycle.dev-boundary-commit | cycle.dev-close-pushed | cycle.dev-close-invariant-ok)
```

What's **missing or hard to read** (verbatim operator pain):

1. **No active-work signal.** An `iteration` event lands at end of an iteration (~100s of silent agent time). `metadata.tools_used` is a 20-tool array embedded in one JSON line — unreadable without `jq` projection. There is no "WI-1 dev — reading X / running pytest / wrote Y" mid-iteration heartbeat.
2. **File changes invisible mid-cycle.** `output_refs` only appears at iteration end. Operator can't see which files moved without `git -C _worktrees/<id> diff` in a second terminal.
3. **Test runs not first-class.** They're inferred from `metadata.bash_commands` containing `npm run test` substrings. No `test.start` / `test.end` event with pass/fail counts. `gate.pass` exists but only fires once.
4. **Cost accumulation per-event only.** No running total per WI or per cycle in the firehose. Each event carries `cost_usd` for that span.
5. **Phase transitions buried.** The scheduler's `makeProgressTee` already filters to phase boundaries (good), but it's stdout-only — the daemon (`forge start`) writes that to `serve-*.log`, which is human-hostile bare text. There is no equivalent live view from anywhere else.
6. **No way to follow one initiative.** `_logs/` interleaves nothing (one dir per cycle, OK) but there's no `forge watch <id>` — operator must `tail -f` the right `events.jsonl` and pipe through `jq`.

## Current state

- `orchestrator/logging.ts` — single writer, `EventLogEntry` schema, `tee` hook (already exposed, used only by the scheduler).
- `orchestrator/scheduler.ts:makeProgressTee()` — filters firehose to phase-boundary stdout (cycle / PM / dev-loop / review / reflection). Works, but stdout-only; no per-iteration detail.
- `monitor/README.md` — describes a tmux layout (`forge serve` + `tail -f events.jsonl | jq` + `forge status --watch`). `monitor/tmux.sh` is a **stub** ("populate when monitoring becomes a daily-driver workflow"). README's "Future improvements" already lists `forge tui` and sparkline trends.
- `brain/forge/themes/jsonl-event-log.md` reaffirms ADR 008: refs-not-contents, single writer, append-only.
- `forge status [--watch]` exists (CLI:375) — prints queue counts + daemon state, **not** active-work detail.

## Proposed refinement

### Pretty-printer / TUI

**Tool choice: `pino-pretty` adapter + `tail -F | pino-pretty` pane (Phase 1), and `blessed-contrib` for the per-initiative TUI (Phase 2).** Justification:

- `pino-pretty` is the canonical Node JSONL pretty-printer (10M+ DL/wk), accepts `--customLevels`, custom message format, colourisation, `--ignore`, `--translateTime`. We already write the same shape — we just need a thin adapter that maps `event_type` → pino level and `phase` → component name. Zero re-invention.
- `blessed-contrib` (built on `blessed`) is the battle-tested Node TUI lib (used by `vtop`, many ops dashboards). Boxes / log-tail widget / sparkline / table — exactly the monitor README's "future improvements". No new TUI framework.
- Strict no-go: do not build a custom React-Ink dashboard or a web UI. The principle is "battle-tested community tools, not re-invention" and Ink is a re-implementation of `blessed` semantics with worse ops ergonomics for log-tailing.

**Adapter spec (per council 07 `eng:02-pino-pretty-schema-mismatch`):** the
adapter wraps `pino-pretty` with an explicit `messageFormat` template
that consumes forge's `{event_type, phase, skill, work_item_id?, cost_usd?, …}`
shape rather than rewriting every line into pino's `{level, time, msg}` shape.
Concretely:

```
messageFormat:
  "{phase|UPPERCASE} {event_type} {if work_item_id}{work_item_id} {/if}{msg|truncate:120}"
customLevels:
  cycle: 50
  pm: 40
  developer-ralph: 40
  developer-unifier: 40
  reviewer: 40
  review-router: 35
  reflector: 40
  brain-lint: 30
```

Concrete colour map updated when plan 04 (dev-loop unifier) lands a new
`phase: 'developer-unifier'` value. Currently uncoloured rows would
otherwise show "unknown" (council 07 design flag).

### New events to emit

Five additions, all one JSONL line, refs-not-contents preserved:

| event_type | phase / skill            | metadata                                                  | Where emitted |
|------------|--------------------------|-----------------------------------------------------------|---------------|
| `file_change`     | dev-loop / review-loop / developer-ralph / developer-unifier | `{ work_item_id?, path, op: 'add'\|'modify'\|'delete', size_bytes }` | **Hook into Ralph's `Edit`/`Write` tool-use stream** (deterministic, agent-driven only) — per council 07 `eng:03-file-change-tap-source`. `chokidar` rejected as primary; deferred to future need. |
| `test_run`        | dev-loop / review-loop   | `{ work_item_id?, command, exit_code, duration_ms, pass_count?, fail_count?, stdout_tail }` | Wrap `quality_gate_cmd` + heuristic-detect `npm/pytest/go test` in `metadata.bash_commands` |
| `phase_transition`| orchestrator             | `{ from, to, reason }`                                    | `cycle.ts` between `runProjectManager` / `runDeveloperLoop` (incl. unifier) / `runReviewLoop` / `runReflector` |
| `agent_heartbeat` | (any with active LLM)    | `{ tool_use_count, last_tool, since_ms }` (≤1 / 15 s)     | **SDK call wrapper** (`loops/ralph/claude-agent.ts`) per C13 — NOT Ralph runner. Sidecar timer started before `query()`; cleared on result. Configurable cadence via `.forge/project.json` `logging.heartbeat_seconds`. |
| `cost_tick`       | orchestrator (synthetic) | `{ cycle_cost_usd, wi_cost_usd? }`                        | **Derived consumer subscribing to the existing `tee` hook** per C14 — NOT the logger. Same path `metrics.ts` uses. De-bounce 1/s max; emit only when cost changed. Logger stays dumb / append-only per ADR-008. |

(Per C19, no `budget_remaining_usd` field — budgets are removed.)

`agent_heartbeat` is the only new write that scales with active LLM time; rate-limit to **one per 15 s** with a tail-emit on idle > 30 s so the operator sees "stuck reading" rather than dead air. Cap log growth: a 30-min cycle adds at most ~120 heartbeats.

Schema change: extend `EventType` in `orchestrator/logging.ts`. All readers (`metrics.ts`, `cycle-report.ts`, the reflector) get a default-switch fall-through (unknown event_types are no-ops); add tests for each new type in `logging.test.ts`.

### Per-initiative live view

`forge watch <id>` — new CLI subcommand. Resolves `<id>` via plan 07b's `resolveInitiativeId` (accepts canonical or handle), locates the latest `_logs/<ts>_<canonical>/events.jsonl`, and renders a 4-pane `blessed-contrib` view:

```
┌───────────────────────────────┬───────────────────────────────┐
│ HEADER (id, phase, WI x/N,    │ COST                          │
│  iter k/cap, branch, hb age)   │  cycle $1.42 (informational;  │
│                               │   no cap per C19)             │
│                               │  sparkline of cost/min        │
├───────────────────────────────┼───────────────────────────────┤
│ EVENT TAIL (last 20)          │ FILES CHANGED                 │
│  pino-pretty formatted        │  scrollable list of           │
│  colourised by phase          │  file_change events           │
│                               │  + git status worktree poll   │
└───────────────────────────────┴───────────────────────────────┘
```

(Cost pane is informational per C19; no budget bar.)

Data sources:
- Tail of `events.jsonl` via `node:fs.watch` + line splitter (no third-party tail dep needed).
- Periodic (2 s) `git -C _worktrees/<canonical> status --porcelain=v1` for working-tree truth (catches edits that pre-date the next iteration event).
- `_queue/in-flight/<canonical>.md.heartbeat` mtime for liveness.

**Failure modes (per council 07 design flags 01 + 02):**

- **No events yet** (initiative enqueued but scheduler hasn't claimed it):
  show "waiting for scheduler to claim — queue position N" header pane
  state; transition automatically when `_logs/<ts>_<canonical>/` appears.
- **Cycle already finished** (`<id>` resolves to a completed cycle):
  render final state + last 50 events; same TUI; no live tail; exit on `q`.
- **No id supplied** (`forge watch` bare): auto-attach when exactly one
  initiative is in-flight; otherwise list + prompt (per council 07
  design escalation, matches `git status` / `npm test` ergonomics).

Headless mode: `forge watch <id> --plain` pipes pretty-printed lines to stdout (for `tmux split-window` / SSH).

## Bench / acceptance

Add `benchmarks/logging-ux/` (lightweight — no LLM cost):

1. **`events-coverage.test.ts`** — replay a recorded cycle log; assert ≥1 of each new event type fires for a representative WI.
2. **`pretty-printer-snapshot.test.ts`** — feed a 41-line synthetic JSONL through the adapter, snapshot the formatted output. Catches accidental schema drift.
3. **`heartbeat-timing.test.ts`** — plant a synthetic 30s sleep in a mocked SDK call wrapper; assert ≥1 `agent_heartbeat` event fires (acceptance for C13 emit-site correctness).
4. **Operator-walkthrough script** — `scripts/demo-watch.sh` replays a recorded log through `forge watch --plain --replay <file>` so the human can eyeball without running a cycle.

Acceptance: operator sits in front of `forge watch <id>` during a live trafficGame or betterado cycle and can answer **without leaving the pane**: current WI, current phase, last file changed, last test run + result, cycle cost so far (informational), agent-idle age.

## Open questions for the operator

1. **Pretty-printer scope:** is `pino-pretty` the right colour palette / time format default, or do you want a forge-specific theme baked in?
2. **Heartbeat cadence:** 15 s default; configurable per-project. Reasonable, or do you want a global default tunable?
3. **`forge watch` default behaviour with no ID:** auto-attach to the single in-flight initiative if there's exactly one, else list and prompt. Confirmed as the spec — flag if you'd rather always-require.
4. **File-change event source of truth:** hook into Ralph's `Edit`/`Write` tool-use stream (decided per council 07 — deterministic, agent-driven only). `chokidar` on the worktree (catches all writes incl. test artefacts) deferred. Confirm.

## Dependencies on other refinement plans

- **Plan 04 (dev-loop unifier)** introduces new phase events (`developer-unifier`) — the pretty-printer's phase→colour map must be updated in lockstep, otherwise watch shows uncoloured "unknown" lines. This is the primary reason 07a ships in **S7** (after plan 04).
- **Plan 07b (init IDs)** ships first (S1.1); `forge watch <handle>` lands via the shared `resolveInitiativeId` helper.
- **Plan 01 (brain refinement)** — orthogonal; no dependency.

## Acceptance criteria for THIS refinement

- Operator can sit in front of `forge watch <id>` during a live cycle and articulate, without re-reading code: current WI, current phase, last file changed, last test result, cycle cost so far, agent-idle age. The headless `forge watch --plain` mode produces output legible enough to paste into a chat window.
- All 5 new event types fire on a real cycle and the bench's coverage assertion passes.
- Heartbeat sidecar timer survives a synthetic 30s SDK call without missing the heartbeat (C13 emit-site test).
- `cost_tick` consumer subscribes via `tee` and never appears as a writer in `orchestrator/logging.ts` (C14 enforcement — verifiable by grep on the resulting code).
