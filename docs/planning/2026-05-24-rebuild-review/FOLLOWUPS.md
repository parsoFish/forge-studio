# Followups — cycle closure + forge-ui v2

> Source: operator's review of the overnight `INIT-2026-05-23-release-def-substrate-gates` cycle attempt (2026-05-24). Sister docs: [REVIEW.md](./REVIEW.md), [MOVE2-PLAN.md](./MOVE2-PLAN.md).
> Status: planning. No code touched yet.

## Why this exists

The first cycle on the post-Move-1+2 forge ran to ~60% completion and surfaced one fundamental architectural lie and seven concrete gaps that, together, prevent a cycle from actually reaching `done`. The operator also asked the forge-ui surface to step up — replacing the static WI list with a graph visualisation, adopting agent-flow's hex-based active-agent monitoring, and surfacing cost figures.

This plan stages both threads (forge correctness + forge-ui v2) so they land together in a way that makes the next cycle on a betterado-sized initiative actually merge.

## Cycle 1 outcome (the evidence)

- PM clean (5 WIs, no thrash, no hidden coupling).
- Dev-loop: WI-1/2/3 ✓ each in one iteration (**+202 lines** of real schema/expand/flatten landed in `resource_release_definition.go`). WI-4 (tests) + WI-5 (HCL example) each ran 2 Ralph iterations, gate-tightening correctly rejected both for not creating the declared files.
- Unifier silently failed to author `DEMO.md` (its prerequisites missing because of the 2 failed WIs).
- review-loop emitted `reviewer.pr-open-failed`.
- Cycle ended with `status: ready-for-review`, manifest moved to `_queue/ready-for-review/` — **but no PR was ever opened**.
- Cycle 2 (re-queued by hand) failed at startup, likely a stale `git worktree` registry entry colliding.

The full trace lives at `_logs/2026-05-23T17-33-31_INIT-2026-05-23-release-def-substrate-gates/events.jsonl`.

## Issue catalogue

Numbered for cross-reference; ordered by how much they block cycle closure.

| # | Issue | Severity | Surface |
|---|---|---|---|
| I1 | `ready-for-review` emitted when no PR was opened (unifier failure leaked through) | **blocks closure** | `orchestrator/cycle.ts`, `cli/unifier-invocation.ts`, `forge-ui/app/page.tsx` |
| I2 | Gate-tightening rejection is diagnostic, not prescriptive — agent doesn't fix the gap on iter 2 | **blocks closure** | `loops/ralph/stop-conditions.ts`, `orchestrator/dev-invocation.ts` |
| I3 | No `forge requeue <init>` — manual 5-step file dance to re-run a failed/partial cycle | quality-of-life | new CLI subcommand |
| I4 | `prepareWorktree` doesn't self-heal from prior runs (orphan git-worktree entry, surviving branch) | blocks retry safety | `orchestrator/worktree.ts` |
| I5 | PM doesn't require `creates:` for code-emitting WIs — gate-tightening was effectively bypassed for WI-1/2/3 | latent false-pass risk | `skills/project-manager/SKILL.md`, `orchestrator/work-item.ts` (validator) |
| I6 | No post-cycle send-back — `ready-for-review` cycles that need fixes must restart from PM | operator stuck | new CLI subcommand + cycle re-entry path |
| I7 | Unifier failure is silent — no structured `unifier.prerequisite-missing` event | visibility gap | `cli/unifier-invocation.ts`, `forge-ui` UI |
| I8 | Cost-per-cycle not surfaced anywhere the operator can see | budgeting blind | logger metadata → events → bridge → UI |

## agent-flow re-read — what's worth porting

Per the operator's note ("dig back into agent-flow"), this section captures what's load-bearing in their UX that we'd port (NOT a fork — concept adoption only).

| Pattern | What it is | Adopt for forge? | Notes |
|---|---|---|---|
| Hexagonal canvas nodes | Each agent = a hex with glow, breathing animation, scanline; state encoded by colour ring + center icon | **Yes** | One hex per phase (or per WI in dev-loop). Canvas-rendered for animation perf. |
| Force-directed positioning | `d3-force` arranges hexes without grid rigidity | **Yes for the active-agent canvas** | Static WI graph uses React Flow (see U2); this is for the agent-process layer (U3). |
| Cost pill | Floating $X above each hex, mini horizontal bars per tool type | **Yes** | Maps to per-phase cost. Cost data plumbed in U1. |
| Top-right cost summary panel | Total $ + token count, per-agent list, per-tool breakdown | **Yes** | Operator's "budgeting" need. |
| Timeline + transcript dual view | Bottom timeline of events; right-side message bubbles | **Yes, simpler version** | Forge events.jsonl is already a perfect feed. |
| Tapered Bézier edges with flowing particles | Active edges glow + animate particles flowing source → destination | **Yes** | Used in U3 for tool-call relationships. |
| Pure Canvas rendering | All visualisation via HTML5 Canvas, sprite caching for perf | **Hybrid** | Canvas for the animated agent-monitor layer (U3); React Flow for the static WI DAG (U2) — different appropriate tools. |

License: Apache-2.0 — concept adoption is fine; we attribute in `forge-ui/NOTICE`.

## Stages

Five stages, total ~3-4 forge sessions worth of work. The first stage is non-negotiable — it's the difference between a cycle that can close and one that can't.

### F1 — Cycle closure unblock _(must land first)_

Land all four together: they collectively fix the cycle-closes path.

- **I1 fix**: in `orchestrator/cycle.ts` after `runUnifier`, branch on whether `openPullRequest` actually wrote a PR. If not, the cycle's `status` is `failed-unifier` (NOT `ready-for-review`), with a new failure-classification kind (under our `transient | terminal` taxonomy: `terminal`, reason='unifier did not author DEMO.md / open PR — N WIs failed gate'). `dispatchTerminalStatus` moves to `_queue/failed/` not `_queue/ready-for-review/`. Forge-ui's VerdictForm gate stays at `status === 'ready-for-review'` — the form simply won't render for failed-unifier cycles.
- **I2 fix**: the Ralph stop-condition rejection message becomes prescriptive — instead of "rejected: none of the WI's required paths appear in diff. Required: [...]", emit "REJECTED. Before exiting iteration, you MUST create at least one of: <paths>. A compiling stub is enough — the test/code body comes second. Without this, the iteration fails." Plus a system-prompt addition in `orchestrator/dev-invocation.ts` reinforcing the same rule.
- **I4 fix**: `orchestrator/worktree.ts:prepareWorktree` runs `git worktree prune` first, then checks `git branch --list <branch>`. If the branch exists but the worktree dir is gone: `git worktree add <dir> <branch>`. If both gone: `git worktree add -b <branch> <dir> <base>`. Surface the path taken via an event so we can see in events.jsonl whether self-heal kicked in.
- **I5 fix**: `skills/project-manager/SKILL.md` adds a hard rule: every WI whose `files_in_scope` includes a non-test source file MUST declare `creates: [<that file>]` (the file the dev-loop will write/modify and the gate must see). Validator in `orchestrator/work-item.ts` enforces this (rejects WIs with `files_in_scope` containing a `.go`/`.ts`/`.py`/`.rs`/`.js`/etc. and empty `creates`). Drops the load-bearing bit from "PM emits creates if it feels like it" to "PM emits creates or the WI fails validation".

**Acceptance**: re-run INIT-2026-05-23-release-def-substrate-gates. If WI-4 still fails twice, the cycle ends `failed-unifier` (not the misleading `ready-for-review`). If WI-4 succeeds, the cycle reaches a real PR. Either way, no architectural lies are told.

### F2 — Operator-tooling commands

- **I3**: `forge requeue <init-id-or-handle> [--reset-retries]`. One command that does: `git worktree remove --force <path>` (if exists), `rm -f _queue/*/<init>.verdict-*.md`, move manifest from any queue dir → `_queue/pending/`, optionally reset `retry_count` to 0 + clear `previous_failure_modes`. Reuses `resolveInitiativeId` from `orchestrator/initiative-id.ts`.
- **I6**: `forge send-back <init> --feedback <file.md>` (or `--interactive` for inline acceptance-criteria entry). Writes `_queue/in-flight/<init>.verdict-response.md` with the send-back shape, then re-claims and resumes the cycle from the review-loop (Ralph picks up `fix_plan.md` as it would in-cycle). Requires a small `orchestrator/cycle.ts` change: a `resumeFrom: 'review-loop'` entry path that skips PM + dev-loop.
- **I7**: New event types `unifier.prerequisite-missing` (emitted by `cli/unifier-invocation.ts` when a declared WI output is missing pre-`openPullRequest`) and `unifier.demo-bundled` (emitted on success). Both shape: `{ wi_id, paths: [...], reason }`. Forge-ui (already structured) surfaces these in the event tail with a distinct colour; F3's hex canvas uses them too.

**Acceptance**: a partial cycle can be requeued in one command. A `ready-for-review` cycle can be sent back with operator feedback and the dev-loop continues from where it left off.

### U1 — Cost telemetry plumbing

- Reuse the existing `cli/cost-tick.ts` consumer (already a derived event-log subscriber). Currently emits `cost_tick` events but they're not aggregated.
- Add `cli/forge-metrics.ts:summariseCost(cycleId)` returning `{ totalUsd, perPhase: { architect: …, pm: …, dev: …, … }, perTool: { Read: …, Bash: …, … } }`.
- Bridge new endpoint `GET /api/cost/<cycleId>` → that summary.
- forge-ui: new `data-active-cycle-cost` attribute on `<main>`, plus an exposed total in the connection-badge area.
- F1's `failure-classification` event already includes the kind; add `cost_usd_total` to the same event so it survives across the forensic-archive path.

**Acceptance**: every cycle's `report.md` includes `Cost: $X.XX`. forge-ui shows `$X.XX` in the cycle tab + header.

### U2 — WI dep graph as visualisation (replaces the static list)

- Pull in `reactflow` as a forge-ui dep (well-maintained, ~150KB, the standard for static-ish node+edge graphs in React).
- New `forge-ui/components/WiGraphCanvas.tsx`: nodes are WI cards (id + truncated title), edges show `depends_on`. Each node carries `data-wi-id`, `data-wi-status`, `data-wi-iteration-count`, `data-wi-cost-usd` (DOM-as-metrics convention from [[dom-as-metrics-for-headless-driven-uis]]).
- Status colours: pending (grey) / active (blue, pulse) / complete (green) / failed (red). Status derived from the live event stream (`derivePerWiStatus(events)` helper).
- Click a WI node → main page's event-tail filters to that WI's events.
- Layout: dagre layout (built into reactflow) for the dependency tree; force-directed isn't right for a DAG.

**Acceptance**: WI panel shows a real dependency graph. Operator can spot at a glance which WI is stuck.

### U3 — Hex-based active-agent canvas _(agent-flow-inspired)_

- New `forge-ui/components/AgentHexCanvas.tsx`. Canvas-rendered (not SVG/DOM) for animation performance.
- One hex per active phase (architect / PM / dev-loop / review-loop / closure / reflection). When dev-loop is active, expand to one sub-hex per in-flight WI inside the dev-loop hex (nesting).
- State encoding:
  - **Pending**: grey outline, no animation
  - **Active**: glowing outline, breathing animation (sin wave 0.8-1.0 alpha)
  - **Tool-call in flight**: orbiting particle on the hex perimeter
  - **Errored**: red outline pulse
  - **Complete**: green fill, fades out after 2s
- Cost pill (per U1 data): `$X.XX` floating above each hex.
- Edges: tapered Bézier curves between phases (architect → pm → dev-loop → …) showing the cycle pipeline; pulse/flow when a phase hands off.
- Sprite cache for glow/breathing layers (off-screen canvases re-used per frame).
- Force-directed layout via `d3-force` if we have side-by-side dev-loop WIs; the cycle pipeline itself stays in fixed horizontal order.
- Read state from the existing WebSocket event stream; no new bridge endpoints.

Substaging:
- U3a: static hexes in the right positions, no animation; reads phase state correctly
- U3b: breathing + tool-call particles
- U3c: cost pills + edge flow

**Acceptance**: the operator opens the page mid-cycle and the canvas tells them at a glance which phase is active, what's costing money, what's stuck.

### U4 — Activity panel detail

- New `forge-ui/components/ActivityPanel.tsx`. Replaces or augments the existing event-tail.
- Timeline (horizontal): each phase as a swimlane; events as coloured ticks; tool-call events render as wider blocks; click any to expand into the right-side detail panel.
- Detail panel (right): shows the selected event's metadata pretty-printed — tool name, parameters, output snippet, duration, cost contribution.
- Live transcript bubbles: each `agent.assistant-text` event renders as a chat-style bubble pinned next to its phase's swimlane.
- Filter chip row at top: by phase, by event_type, by WI.

**Acceptance**: operator can drill from "PM took 8 min" → "here are the 12 tool calls PM made, in order, with output".

## Dependency map between stages

```
F1  →  enables F2 (requeue needs status honesty)
F1  →  enables U2 (WI-status colours need the per-WI state right)
F1  +  U1  →  enables U3 (agent canvas needs cost + phase state)
U2 + U3 + U4 — independent of each other after F1+U1; can land in any order
```

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| F1 status-change breaks a test that hard-codes `status: 'ready-for-review'` | Medium | Tests use shared status enum; grep + update; bench e2e covers regression |
| I2 prescriptive rejection wording too aggressive → agent over-creates stub files that don't actually do the work | Medium | Stub is "compiles + matches the path" — gate still requires the broader `quality_gate_cmd` to pass. A no-op stub may compile but tests would fail. |
| I5 mandatory `creates:` rejects PM output for legitimate non-code WIs (e.g., refactors with no NEW files) | Low | Validator exemption for WIs whose `files_in_scope` already lists existing files AND the action is "modify in place"; mark by `creates: []` + non-empty `modifies: [...]` (new optional field) |
| I6 send-back from a `failed-unifier` (post-F1) cycle has no in-flight Ralph to consume the feedback | Medium | `forge send-back` does a partial-resume: spawns a new reviewer Ralph against the existing dev-loop output, NOT a full restart |
| U3 canvas performance on a 5-cycle in-flight scenario | Low | agent-flow sprite-cache pattern handles 20+ agents; we have at most ~10 hexes |
| reactflow bundle size on top of Next.js's already-87KB shared | Low | ~150KB gzipped; acceptable for the value |
| Forking agent-flow temptation re-emerges | Low | This plan explicitly NOT a fork — concept adoption with attribution in `forge-ui/NOTICE` |

## Out of scope

- Architect plan-doc annotation form (deferred from M2-C; not a cycle-closure blocker)
- Reflect Q&A form (same)
- Phase autonomy structural refactor (REVIEW §1-2; separate batch)
- Replacing notify.ts (still complements forge-ui per MOVE2-PLAN Round 3)

## What "done" looks like

A fresh re-run of `INIT-2026-05-23-release-def-substrate-gates`:

1. PM emits 5 WIs, each declaring `creates:` (I5)
2. Dev-loop: 5/5 WIs complete on first iteration (I2 prescriptive rejection makes WI-4/5 succeed)
3. Unifier authors `DEMO.md`, opens PR
4. Cycle ends `status: ready-for-review` (now meaning what it says — a real PR exists)
5. Operator opens forge-ui, sees:
   - WI graph (U2) all green
   - Agent hex canvas (U3) with the review-loop hex active
   - Cost pill on each phase (U1) summing to actual $ total
   - Verdict form available
6. Operator clicks approve. Cycle moves to done.

If anything in (1)-(3) fails, the cycle ends `failed-unifier` (I1) with a structured `unifier.prerequisite-missing` event (I7) — operator runs `forge requeue` (I3) or `forge send-back` (I6) and iterates.
