# Orphaned scheduler claims queue work with stale loaded modules

- **Category**: antipattern
- **Date**: 2026-07-11
- **Evidence**: Wave-1 gate runs, `_logs/2026-07-11T05-13-21_INIT-2026-07-11-json-output-flag`

## What happened

A `forge serve` process from a dead session (started 09:52, before any of the
day's merges) stayed alive for 5+ hours. When the Wave-1 verify run promoted a
manifest, **the orphan's scheduler won the claim race** against the harness's
own watch and ran the PM with its boot-time module snapshot — hours-old code.

Forge runs TypeScript directly (`--experimental-strip-types`, no build step),
so *disk* is always current but a *process* is frozen at first-import. The two
drift silently.

## Symptom signature (how to spot it fast)

- **Impossible event sandwiches**: events emitted BEFORE and AFTER a new code
  block appear in the log; the new block's own events are absent
  (`pm.work-item-emitted` ✓ → `pm.spec-lint` ✗ → `pm.graph-emitted` ✓).
- New validations that should have failed a pass simply… don't fire.
- Fresh child processes (architect turns spawn per-turn) show NEW behaviour in
  the same cycle where the long-lived process shows OLD behaviour — mixed-era
  evidence in one log is the tell.

## Standing rules

1. **Before any verify/gate run**: `ps -eo pid,lstart,args | grep 'cli.ts'` —
   any scheduler-bearing process older than the last merge must die first.
2. **Harnesses must reap what they spawn**: `verify-cycle.mjs` now tracks its
   watch from SPAWN (not from ready), kills it in the fatal handler, kills a
   half-booted studio on ready-timeout (it already holds ports 4123/4124), and
   tees `[watch]`-prefixed output + an EXITED line into the run log so a dying
   bridge leaves a trail.
3. **Self-heal, loudly**: the harness health-probes the bridge before every
   approve and restarts it if dead (state is disk-backed; a silent vanish
   loses merge/finalize/reflect).

## Open sub-mystery

The harness watch was externally SIGKILLed mid-dev-loop in three separate runs
(~15–20 min in; `EXITED code=null signal=SIGKILL`, no graceful shutdown line).
Suspected WSL2 memory pressure (next-dev + bridge + SDK children + go/tsc
gates). Not root-caused; `ensureWatch` self-heal absorbs it operationally.
