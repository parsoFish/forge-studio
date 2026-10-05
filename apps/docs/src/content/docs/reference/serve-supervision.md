---
title: Serve supervision
description: How forge serve runs, who restarts it, its process-id and lock files, recovery sweeps, and the emergency halt.
type: reference
owner: parsoFish
last_verified: 2026-10-06
covers: [packages/flows/daemon.ts, packages/flows/scheduler.ts, packages/flows/halt-watch.ts, packages/kernel/halt.ts, apps/forge/serve-supervisor.ts, apps/forge/bridge-halt.ts, apps/forge/forge-watch.ts]
---

`forge serve` is the daemon that claims pending initiatives and drives each to completion. `forge studio` supervises it.

## Shape

| Concern | Owner |
|---|---|
| Start, adopt and restart the `forge serve` process | `forge studio`, with crash-loop back-off |
| Allow only one `forge serve` per forge root | `forge serve` itself, by lock |
| Re-queue work orphaned by a dead process | `forge serve`, by sweeps |
| Show serve's health | Studio, read-only |

`forge studio` spawns `serve` detached, so closing Studio does not strand in-flight work. On start it adopts a live serve of the same root instead of spawning a second. An attach-only `forge studio --attach` never supervises; it only reads state.

When `forge studio` exits it sends serve one `SIGTERM` and records the process id in `stopping`. In-flight cycles drain inside the detached process. A later `forge studio` waits for that process id to exit, then spawns a fresh serve.

## Fields

Files under `_logs/daemon/` in the forge root:

| File | Description |
|---|---|
| `forge.pid` | Process id of the running serve. Written by serve after it takes the lock, so it only names a lock holder. Advisory. |
| `serve.lock` | The per-root lock. The real authority on whether a serve may run. |
| `serve.log` | standard output and error of a serve that Studio spawned. |
| `stopping` | The process id a stop signal was sent to. |

Supervisor timings:

| Setting | Value | Description |
|---|---|---|
| Poll interval | 2 s | How often the supervisor checks the process id. |
| Initial back-off | 1 s | Delay before the first restart after a crash. |
| Back-off cap | 60 s | Delays double up to this. |
| Healthy uptime | 30 s | A death after this resets the delay. |

Serve settings (defaults; `scheduler.maxConcurrentInitiatives` in `forge.config.json` overrides the concurrency):

| Setting | Default | Description |
|---|---|---|
| `maxConcurrentInitiatives` | 2 | Initiatives running at once. |
| `pollIntervalMs` | 5000 | Queue poll interval. |
| `heartbeatIntervalMs` | 30000 | Heartbeat write interval for an in-flight cycle. |
| `staleHeartbeatMs` | 300000 | Age at which a heartbeat counts as dead. |
| `recoverIntervalMs` | 300000 | How often the recovery sweep re-runs. |

`GET /api/health` returns a `serve` object:

| Field | Description |
|---|---|
| `state` | `running`, `draining`, `restarting`, `down` or `unsupervised`. |
| `pid` | Supervised process id, or null. |
| `restarts` | Restarts after crashes by this Studio instance. |
| `nextRestartAt` | When a pending restart fires, or null. |
| `halt` | The emergency halt record, or null. |

`GET /api/liveness` reports heartbeat age across in-flight cycles. When it is stale, Studio shows its connection state as `daemon-stalled`.

## Examples

Run serve without Studio under `systemd`:

```ini
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

Run it under pm2:

```bash
pm2 start "forge serve" --name forge-serve --max-restarts 50 --restart-delay 5000
```

Claim one initiative and exit:

```bash
forge serve --once
```

Release the emergency halt without Studio, from the forge root:

```bash
rm _queue/halt.json
```

## Emergency halt

The halt is one file, `_queue/halt.json`, holding `since` and `actor`. While it exists, serve keeps polling but claims nothing, and ready-for-review cycles are not re-entered. Work already in flight runs to its end; nothing is signalled. A file that cannot be read or parsed counts as a halt.

Serve prints one line when it first sees the halt, repeats it at most every 10 minutes, and prints `[serve] emergency halt released — claiming again` once when the file goes. `serve --once` under a halt claims nothing and exits normally. Studio's Release halt button removes the same file. The supervisor still reports a halted serve as `running` and never restarts it.

## Limits

- A second `forge serve` for a root refuses at once: non-zero exit and one standard error line naming the holder process id. It also refuses when `forge.pid` names a live serve of this root, even if that serve is blocked and has let the lock age.
- A lock not refreshed for 60 s can be taken over. A serve that finds its lock compromised keeps running and retakes it.
- Studio never restarts a serve you started under `systemd` or pm2; it adopts it. Restart policy for that serve is the supervisor's you chose.
