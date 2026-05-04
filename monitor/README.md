# Monitor

> Visualisation of forge cycles as they run. Per user principle 5: monitoring of forge cycles with visualisation of agents at work.

## Layout

The monitor is a **tmux session** with three (or more) panes:

```
┌─────────────────────────────────┬─────────────────────────────┐
│                                 │                             │
│  Pane 1 — forge serve           │  Pane 3 — forge status      │
│  (the scheduler)                │     --watch                 │
│                                 │  (live queue + in-flight)   │
│                                 │                             │
├─────────────────────────────────┤                             │
│                                 │                             │
│  Pane 2 — tail event log        │                             │
│  tail -f _logs/<latest>/        │                             │
│       events.jsonl | jq         │                             │
│                                 │                             │
└─────────────────────────────────┴─────────────────────────────┘
```

Plus an **Obsidian window** (separate desktop window) opened on the brain vault — for navigating the wiki, watching the graph evolve as theme pages are added.

## Run

```bash
./monitor/tmux.sh
```

This launches the three-pane layout. Detach with `Ctrl+b d`; reattach with `tmux attach -t forge-monitor`.

## What you see

- **Pane 1:** scheduler stdout — claims, recoveries, notifications.
- **Pane 2:** the event log live — every skill invocation, iteration, cost.
- **Pane 3:** queue counts + in-flight initiatives with their current phase + iteration count + heartbeat age.
- **Obsidian:** the brain graph; theme pages light up as the reflector ingests.

## Future improvements

- `forge tui` — a proper TUI built on the same data sources, with phase-detail drilldowns.
- A web dashboard (deferred until there's real demand).
- Sparkline-rendered cost / iteration trends per cycle.

## Status

⏳ `tmux.sh` is a stub; populate when monitoring becomes a daily-driver workflow.
