# Supervising `forge serve`

`forge studio` is `forge serve`'s supervisor (ADR 011, ADR 031 decision 5): it
brings `serve` up the same way it brings up the bridge and the UI — spawning
it detached at boot, adopting a live pid if one already exists, restarting a
dead one with crash-loop backoff, and sending it exactly one `SIGTERM` when
`forge studio` itself exits (recorded in `_logs/daemon/stopping`; in-flight
cycles drain inside the detached `serve` process, and a later `forge studio`
waits for that drain to finish before spawning a fresh one rather than
signalling the same pid twice). The operator never manages `serve`'s process
lifecycle as a separate step — `forge studio` is the one thing that does. A
second, attach-only `forge studio` never supervises `serve`; it only reads its
state.

**Exactly one `forge serve` runs for a given forge root, enforced by `serve`
itself.** Before `serve()` runs, `forge serve` (forever or `--once`) takes an
exclusive per-root lock and then writes its own pid to
`_logs/daemon/forge.pid`, so the pid file only ever names a serve that holds
the lock. A second `forge serve` or `forge serve --once` for the same root
refuses immediately — a non-zero exit and one clear stderr line naming the
pid already holding the root — and it refuses whenever `forge.pid` names a
live serve of this root, even one blocked in a long synchronous call that has
let the lock age. A serve is recognised by its working directory (the forge
root) and its argv (`bin/forge.mjs` or `apps/forge/cli.ts`, symlinks resolved,
so `forge serve` through an npm-linked `forge` on `PATH` counts) with
`serve`. `forge studio` adopts whichever
`serve` already holds that lock — started by hand, by `forge studio` itself,
or by systemd/pm2 (below) — rather than spawning a second one beside it.

## What forge does and does NOT do

`forge serve` is the long-running daemon that claims every eligible pending
manifest and drives it to completion. Its WORK-recovery model (ADR 012) is
intentionally minimal: two file-system sweeps (stale-heartbeat +
missing-worktree) that re-queue orphaned in-flight work on startup and on a
5-minute timer — that recovers *work* that was mid-flight when a process died.
Restarting the `serve` **process** itself belongs to `forge studio`, not to
`serve` restarting itself: a process cannot reliably resurrect itself, so
forge does not hand-roll a second watchdog beside the one `forge studio`
already runs (CLAUDE.md's "never re-invent a resource controller / process
isolator" line, ADRs 011–013).

So the supervision contract is split cleanly:

| Concern | Owner |
| --- | --- |
| Re-queue orphaned in-flight cycles | forge (ADR 012 sweeps) |
| Restart the `forge serve` **process** when it exits or wedges | **`forge studio`**, with crash-loop backoff |
| Surface `serve`'s liveness to the operator, read-only | Studio (`GET /api/health`'s `serve` object) |

## Running `forge serve` without Studio

Some ground — a headless server, CI, a box where no one runs `forge studio`
at all — still needs `serve` running without a supervising Studio. For that
case only, hand the process to a battle-tested OS supervisor rather than
hand-rolling one, matching ADR 011's "run in the foreground (or under
systemd/pm2 for process supervision)" line:

### systemd (Linux servers)

```ini
# /etc/systemd/system/forge-serve.service
[Unit]
Description=forge scheduler daemon
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/forge
ExecStart=/usr/bin/env forge serve
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### pm2 (dev / single-box)

```bash
pm2 start "forge serve" --name forge-serve --max-restarts 50 --restart-delay 5000
pm2 save
```

Either config restarts the process on exit, standing in for what `forge
studio` already does whenever it is the one running `serve`. If `forge
studio` is started on this same root afterwards, it adopts this `serve`
(the lock + pid file above name it) rather than spawning a second one.

## The liveness surface

`GET /api/health` carries a `serve` object —
`state: "running"|"draining"|"restarting"|"down"|"unsupervised"`, `pid`,
`restarts`, `nextRestartAt` — so Studio can tell the operator `serve` is
between lives without inventing a control for it: while `state` is `running`
the UI shows the ordinary claim/run-in-progress copy; while it is `restarting`
or `down` it instead shows a read-only line (`data-serve-state`,
`data-serve-restarts`) with no button, because there is nothing for the
operator to press — `forge studio` is already handling it.

Separately, the bridge also exposes `GET /api/liveness`, reporting the **max
heartbeat age across in-flight cycles** (read from the
`_queue/in-flight/<id>.md.heartbeat` mtimes `serve` writes) — a different
question (is a specific cycle's work stalled) from whether the `serve`
process itself is up. When that age exceeds a **generous** multiple of
`staleHeartbeatMs` (6× the 5-minute default = 30 minutes), the Studio UI flips
the connection-state indicator's `data-connection-state` to `daemon-stalled`
(the bridge is still reachable — this is distinct from `reconnecting` /
`no-bridge`) and fires one edge-triggered toast.

## The emergency halt

The emergency halt is one record, `_queue/halt.json` (`{ "since", "actor" }`).
While the file exists, `forge serve` stays running and polling but claims
nothing: no pending manifest moves to `in-flight/`, and the drain sweep does
not re-enter ready-for-review cycles. Work already in flight runs to its own
end; nothing is signalled. A file that cannot be read or parsed counts as a
halt (the brake fails closed).

`serve` prints one line when it first sees the halt, naming the way out:

```
[serve] emergency halt on since <iso time> — claiming nothing; release it from Studio (Release halt) or remove <abs path>/_queue/halt.json
```

While the halt stays on it repeats that line at most once every ten minutes,
and it prints `[serve] emergency halt released — claiming again` once when the
file goes. `serve --once` under a halt prints the first line, claims nothing
and exits normally.

The supervisor reads a halted `serve` as `running`: a halt is queue state, not
a serve state, so it never restarts the process and never counts a restart.

Release without Studio by removing the file from the forge root:

```
rm _queue/halt.json
```

`serve`'s next tick (within `pollIntervalMs`) claims again. Studio's
"Release halt" button removes the same file; `GET /api/health` reports it as
`serve.halt` (`{ since, actor, active, queued }`, or `null`).
