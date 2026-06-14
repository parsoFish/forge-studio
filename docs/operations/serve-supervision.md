# Supervising `forge serve` — use a battle-tested OS supervisor

> forge does **not** hand-roll a process watchdog. Restarting a dead/wedged
> daemon is the OS supervisor's job (systemd, pm2, runit, …). This honours the
> CLAUDE.md "never re-invent a resource controller / process isolator" line and
> ADRs 011–013.

## What forge does and does NOT do

`forge serve` is the long-running scheduler daemon. Its recovery model (ADR
012) is intentionally minimal: two file-system sweeps (stale-heartbeat +
missing-worktree) that re-queue orphaned in-flight work on startup and on a
5-minute timer. That handles *work* recovery — it does **not** restart the
daemon *process* if the process itself dies or wedges. forge deliberately has
no internal "restart myself" watchdog: a process cannot reliably resurrect
itself, and re-inventing one is exactly the kind of community-tool re-invention
the project forbids.

So the supervision contract is split cleanly:

| Concern | Owner |
| --- | --- |
| Re-queue orphaned in-flight cycles | forge (ADR 012 sweeps) |
| Restart the `forge serve` **process** when it exits/hangs | **OS supervisor** (systemd / pm2) |
| **Surface** a stalled daemon to the operator | forge-ui (Feature #8) |

## The liveness surface (Feature #8)

The bridge (started by `forge studio`) exposes `GET /api/liveness`, which reports
the **max heartbeat age across in-flight cycles** (read from the
`_queue/in-flight/<id>.md.heartbeat` mtimes the scheduler writes). When that age
exceeds a **generous** multiple of `staleHeartbeatMs` (6× the 5-minute default =
30 minutes), the Studio UI:

- flips the page-level `data-conn-state` to `daemon-stalled` (the bridge is
  still reachable — this is distinct from `reconnecting` / `no-bridge`), and
- fires **one** edge-triggered toast (not repeated) telling the operator to
  check the supervisor.

This is a *surface*, not a *fix*. forge-ui never tries to restart the daemon —
it tells the human (or whatever is watching the Studio UI) that the supervisor
should.

## Recommended supervisor configs

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
# Optional hard liveness ceiling — systemd restarts the unit if it doesn't
# ping the watchdog within the interval. forge does not currently sd_notify,
# so prefer Restart=always + the forge-ui liveness surface for now.

[Install]
WantedBy=multi-user.target
```

### pm2 (dev / single-box)

```bash
pm2 start "forge serve" --name forge-serve --max-restarts 50 --restart-delay 5000
pm2 save
```

Either supervisor restarts the process on exit; the forge-ui liveness surface
covers the "process is alive but wedged" gap until the operator (or a future
`sd_notify`/healthcheck hook) intervenes.
