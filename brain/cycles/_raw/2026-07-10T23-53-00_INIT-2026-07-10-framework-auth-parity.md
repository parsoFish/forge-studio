---
source_type: cycle
source_url: _logs/2026-07-10T23-53-00_INIT-2026-07-10-framework-auth-parity/events.jsonl
source_title: Cycle 2026-07-10T23-53-00 — Initiative INIT-2026-07-10-framework-auth-parity
cycle_id: 2026-07-10T23-53-00_INIT-2026-07-10-framework-auth-parity
initiative_id: INIT-2026-07-10-framework-auth-parity
project: terraform-provider-betterado
ingested_at: 2026-07-11T01:45:00.000Z
ingested_by: reflector
retention: load-bearing
cited_by:
  - brain/cycles/themes/2026-07-11-dev-loop-delivered-event-fires-for-failed-wi.md
  - brain/cycles/themes/2026-07-11-release-finalizer-version-guess.md
  - brain/projects/terraform-provider-betterado/themes/2026-07-11-az-cli-ado-token-probe-pattern.md
---

## Summary

**Initiative:** Port the full credential-resolution logic (`GetAuthProvider`) from the SDKv2 `provider.go` into the pure-framework `Configure()`, making the provider work with all 17 auth attributes (PAT, CLI, MSI, OIDC, AAD client-secret/cert) post mux-free cutover. Ride-along: bump `terraform-registry-manifest.json` to protocol 6.0 and cut `PROVIDER_VERSION.txt` to `2.0.1`.

**Shape:** 3 WIs (auth resolver + unit tests / Configure() wiring / live-acc + ride-along), linear chain (WI-3 depends on WI-1 + WI-2). Operator note: WI-1 and WI-2 were parallelizable per the plan but the orchestrator ran them serially.

**Outcome:** Merged as PR #69 at SHA `31389bdc`. Net delivery: 20 files, +1,429/-42 lines, 14 commits.

---

## Cycle walk-through

### Cycle 1 — PM + first dev-loop (~23:54–00:01 UTC) — FAILED

PM planned 3 WIs with quality gates keyed on invented test-function names (`go test -run TestResolveFrameworkAuth …`). None of those functions existed at WI start. `go test -run <nonexistent>` exits 0 with `[no tests to run]`; forge classified each WI **gate-too-loose** at iter-0. 0/3 complete — terminal/non-recoverable.

**Forge fix applied same-day (ba073ce):** gate requires expected-fail at iter-0 when `creates:` paths are absent from `git diff main...HEAD`. WI statuses reset, worktree preserved.

### Cycle 2 — Dev-loop retry (~00:01 UTC) — FAILED

All 3 ralphs started simultaneously. WI-1 completed in 1 iteration. WI-2 and WI-3 had started in parallel and had zero output yet. Orchestrator saw 0/3 complete and classified the cycle **total failure**. Requeue preserved the worktree.

### Cycle 3 — Dev-loop success (~00:18–01:23 UTC) — MERGED

With the forge fix active, all 3 WIs followed the same pattern:
- **iter-0:** `gate.expected-fail` (required-paths-missing — creates[] not yet in diff)
- **iter-1:** `gate.pass`

Delivery:
- WI-1: 2 files, +426/-0 (auth resolver + unit tests)
- WI-2: 2 files, +201/-40 (Configure() wiring)
- WI-3: 4 files, +182/-2 (live-acc CLI probe + ride-along manifest)

Unifier: 1 iteration, clean. CI gate: green. PR #69 opened and merged.

### Post-merge forge bugs surfaced (all fixed same-day)

1. **Release-finalizer version-guess:** guessed `3.0.0` (ENHANCEMENTS category unmapped + staged `PROVIDER_VERSION.txt = 2.0.1` not honored). Operator re-cut `v2.0.1`. Fix: 9970cc4.
2. **Demo-capture crash:** cwd-relative skill resolution crashed on every cycle; best-effort stance masked it as a flake. Fix: 416bc76 (deriveAgentSpec resolves from forge install root).
3. **dev-loop.delivered fires for failed WIs:** emitted with `files_changed: 0` in Cycles 1–2. Honest payload, misleading event name.
4. **Architect session block replayed 4× in log** (cosmetic duplicate events).

---

## Event log reference

Full event log: `_logs/2026-07-10T23-53-00_INIT-2026-07-10-framework-auth-parity/events.jsonl` (918 lines)
