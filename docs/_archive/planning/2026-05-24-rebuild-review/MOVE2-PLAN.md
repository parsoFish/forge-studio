# Move 2 — Operator UI (`forge-ui/`)

> Source: [REVIEW.md §5](./REVIEW.md). Move 1 (orchestrator slim) landed on branch `rebuild-move1-slim-orchestrator` 2026-05-24.
> Style: cwc `how-we-claude-code` interview captured below before any code touched.
> Estimated scope: 3 stages of forge work (M2-A foundation → M2-B sidebar → M2-C chat/intervention).

## Operator brief + interview (2026-05-24)

Three rounds of `AskUserQuestion`, 12 questions total, capturing the high-leverage shape decisions before scaffolding anything.

### Round 1 — surface, agent-flow, process, intervention

| Question | Answer |
|---|---|
| What surface should forge-ui be? | **Local web app** (Vite + React + WebSocket from forge daemon) |
| Relationship to agent-flow? | **Fork agent-flow**, add state-machine + chat panel, re-skin tabs as cycles |
| How does the operator launch it? | **`forge watch [<id>]`** — foreground subcommand; quits with the terminal |
| Chat / intervention scope? | **Wraps existing slash commands at human moments only** (architect / review / reflect) |

Tension resolved by sub-investigation: agent-flow is in fact a **Next.js web app**, not a TUI (verified via WebFetch on the upstream repo). The operator's answers therefore reconcile — Next.js fork, foreground CLI launcher that spawns it.

### Round 2 — fork location, data plane, v0 scope, intervention UX

| Question | Answer |
|---|---|
| Where should the forge-ui fork live? | **In-repo at `forge-ui/`** as an npm workspace |
| How does forge-ui get cycle state? | **WebSocket from a new `forge ui-bridge` process** that tails events.jsonl + queue dirs |
| What's the minimum v0? | **Cycles tab + state-machine pane + live event tail + activity sidebar** (per-phase tool calls + mermaid) — ~3 stages |
| Intervention UX? | **Structured forms** at human-moment boundaries |

### Round 3 — operational edge cases

| Question | Answer |
|---|---|
| Does `forge watch` start the scheduler? | **Prompt the operator** with "scheduler stopped — [Start it]?" |
| Cycles tab — history or live only? | **Live + recent done/failed (last 20, scrollable)** |
| Verdict race vs scheduler state transition? | **Bridge locks the in-flight manifest** with `proper-lockfile` before allowing a verdict write |
| Relationship to `notify.ts`? | **Complement** — keep desktop pings; forge-ui shows in-app toast on state changes |

## Locked architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Operator terminal: `forge watch [<id>]`                          │
│   ↓ (spawns 2 child processes; waits both; cleans up on Ctrl-C)  │
│ ┌──────────────────────┐    ┌────────────────────────────────┐   │
│ │ forge ui-bridge      │←──→│ Next.js dev / static server    │   │
│ │ (Node, ~300 LOC)     │ ws │ (forge-ui/, react+next)        │   │
│ │  · tail events.jsonl │    │ · cycles tab list              │   │
│ │  · watch _queue/     │    │ · state-machine pane           │   │
│ │  · WS broadcast      │    │ · activity sidebar             │   │
│ │  · POST verdicts     │    │ · chat-panel form              │   │
│ │  · proper-lockfile   │    │ · toast on state change        │   │
│ └──────────────────────┘    └────────────────────────────────┘   │
│         ↑                            ↑                            │
└─────────│────────────────────────────│────────────────────────────┘
          │ reads                       │ HTTP localhost:PORT
   _logs/<id>/events.jsonl             browser
   _queue/{pending,in-flight,
           ready-for-review,done,failed}/
```

- `forge-ui/` is a separate npm workspace under the forge root (`workspaces: ["forge-ui"]` in root package.json).
- The bridge is a small Node process owned by `cli/ui-bridge.ts` (consistent with Move 1's relocation rule — operator-utility code lives in cli/).
- WebSocket protocol: server pushes `event` (one JSONL row), `queue-state` (full snapshot), `cycle-list-changed` (debounced). Client posts `verdict` (initiative-id + payload) and `start-scheduler`.
- Scheduler-start UX: a banner with a "Start it?" button POSTs `start-scheduler` to the bridge, which `child_process.spawn`s `forge start` (the existing detached-daemon path).
- Fork of agent-flow: vendor the Next.js app subdirectory of `patoles/agent-flow@HEAD` into `forge-ui/` at scaffold time, strip Codex-specific bits, re-aim the data source at our WebSocket. Apache-2.0 attribution NOTICE retained.

## Stage breakdown

### Stage M2-A — Foundation (this session)
**Deliverable:** the operator can run `forge watch` and see live cycle state in a browser, including phase progress and a tail of events. No intervention yet.

Files touched:
- `forge-ui/` — new npm workspace; Next.js app scaffolded from the agent-flow vendor
- `cli/ui-bridge.ts` — new Node WebSocket bridge process
- `cli/forge-watch.ts` — new orchestrator/cli.ts subcommand handler
- `orchestrator/cli.ts` — new `forge watch` subcommand wired to cli/forge-watch.ts
- `package.json` — workspaces declaration; new scripts
- `tsconfig.json` — include forge-ui (or set up its own tsconfig that extends root)
- `monitor/README.md` — point to forge-ui (the tmux stub gets a sibling)

Acceptance:
- `forge watch` opens `http://localhost:<port>` in the operator's browser.
- The page shows: (1) tabs for each cycle in `_queue/{in-flight,done,failed}/` (limit 20), (2) a state-machine pane for the active cycle showing architect / PM / dev-loop / review / reflect with a tick / ▶ / ⏸ per phase, (3) a live-tailing event log for the active cycle's `events.jsonl`.
- Ctrl-C in the terminal kills the Next.js dev server + the bridge cleanly.
- `npm test` still passes (existing 766 tests); `npm run build` still passes.

### Stage M2-B — Activity sidebar
**Deliverable:** per-phase activity feed + mermaid render of the WI graph + toast notifications on state transitions.

Files touched:
- `forge-ui/src/components/Sidebar.tsx` — per-phase activity feed (tool calls, durations, last assistant text)
- `forge-ui/src/components/MermaidGraph.tsx` — render `_graph.md` for the in-flight cycle
- `forge-ui/src/lib/toast.ts` — toast on `cycle-list-changed`
- `cli/ui-bridge.ts` — enrich event stream with derived signals (current tool, last-assistant-snippet)

Acceptance:
- Active cycle's sidebar shows the most recent tool call per phase with elapsed time.
- WI graph renders below the state machine.
- A cycle transitioning to `ready-for-review/` triggers a toast within ≤2s of the queue move.

### Stage M2-C — Chat / intervention forms
**Deliverable:** the operator can submit architect, review, and reflect verdicts from forge-ui without dropping to the terminal slash commands.

Files touched:
- `forge-ui/src/components/HumanMoment.tsx` — form per moment (architect plan-comment, review verdict, reflect feedback)
- `cli/ui-bridge.ts` — POST handlers that wrap the existing file-based handoff (`*.verdict-response.md`, `user-feedback.md`, architect annotations)
- `cli/ui-bridge.ts` — `proper-lockfile` around the in-flight manifest during verdict write
- Banner + button: "scheduler stopped — Start it?" → POST `/start-scheduler` → `child_process.spawn('forge', ['start'])`

Acceptance:
- Operator drives a betterado-sized cycle from `_queue/pending/` through merge using only `forge-ui` (no `tail -f`, no `forge review`).
- Verdict submission writes the correct file; if cycle has moved past the touchpoint the UI surfaces "already resolved" with the current state.
- Locking prevents racy double-writes; integration test for the lock contention case.

## Reuse / patterns

- `cli/visualise.ts` already has the queue-counts shape (`counts`, `listInFlight`, `getPaths`) — bridge reuses it directly.
- `cli/metrics.ts` has `summariseCycle` returning the same per-phase aggregates the state-machine pane needs.
- `cli/forge-metrics.ts` has all the section renderers — the activity sidebar can re-use the work-item snapshot loader and the trajectory renderer.
- `orchestrator/queue.ts` has `moveTo` / `claim` semantics — bridge does not duplicate.
- `orchestrator/file-verdict.ts` already owns the verdict-file write contract — bridge calls it for the review touchpoint.
- `orchestrator/forge-reflect-rerun.ts` already owns the reflect re-invoke — bridge calls it.
- `proper-lockfile` is already a dep.
- `notify.ts` keeps its desktop-toast contract; forge-ui adds an in-app sibling, not a replacement.

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Adding Next.js to the lockfile pulls in 100+ deps, contradicting the "minimal deps" north-star | Medium | The fork is the dep — it's one decision, ratified. Pin to a known agent-flow commit; document in `CLAUDE.md` under "deps justified" |
| WebSocket reconnect logic gets gnarly when the operator pauses & resumes their laptop | Medium | Bridge sends a `hello` snapshot on every (re)connect; client treats all state as derivable from the snapshot |
| `forge-watch` + dev-server port clash with the operator's other tools | Low | Default to 0 (let OS assign); print the URL on stdout; allow `--port <n>` override |
| The verdict-race lockfile contention is a real bug under fast operator + slow scheduler | Medium | Test it: hold the lock with a synthetic process; bridge must report "another writer holds the lock" within 2s |
| Vendor agent-flow's history once and never sync — we drift | Low | Document the upstream pin in `forge-ui/NOTICE`. v3 might rewrite without the fork anyway |
| Stage M2-A is large (Next.js scaffold + bridge + CLI command + WebSocket) | Medium | Land in three commits: bridge first, watch CLI second, UI third — each independently testable |

## Out of scope (Move 2)

- Multi-machine (forge-ui served to a remote operator). Local-only.
- Multi-user (forge is single-operator by design).
- A "logs analytics" view — that's `forge metrics` territory.
- Replacing `notify.ts` or `forge serve`'s lifecycle model.
- Phase autonomy (REVIEW §1–2) — still deferred to a later move.

## Commit shape

Each stage lands as 1-3 conventional-commit messages on a feature branch (`rebuild-move2-stage-a`, `-b`, `-c`). Each branch passes `npm run build && npm test` cleanly and can ship independently.
