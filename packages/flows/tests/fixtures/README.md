# m7-a-breach-control-cycle-events.jsonl

Trimmed rows from a recorded M7 breach control run's event log — a
develop-flow cycle that re-entered `runCycle` for the SAME `cycle_id` after
its PLAN gate: a first entry (synthetic architect + project-manager, ending
`cycle.end ready-for-review`) and a second that resumed at developer-loop
onward. Bead forge-8vfn.8.1.5.

Both `cycle.start` rows and every real cost-bearing row are kept verbatim.
The noisy, no-cost dev-loop turn-by-turn rows (`tool_use` / `log` /
`agent_heartbeat` for WI-1's ~150 in-turn events) are trimmed — none of them
carry `cost_usd` or an `iteration` event type, so removing them cannot change
the arithmetic. Worktree paths embedded in `input_refs`/`output_refs` are
sanitized to `/repo/...`.

Real dollar figures preserved:
- architect: $2.0368506 (`architect.end`)
- project-manager: $0.8104302 (`project-manager.end`, first entry, before the
  PLAN gate)
- developer-loop: $1.3089468, carried on ONE `iteration` event for WI-1; the
  per-WI `ralph.end` and the phase-rollup `end` restate the same dollars and
  must not be double counted.
- total authoritative spend: $4.1562276.

The recorded run's own (buggy) ceiling stop read $3.3457974 (architect + dev
only — project-manager's spend from the first entry was invisible to the
second entry's tracker). This fixture is what proves the fix.
