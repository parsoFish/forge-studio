# 044 — Read-path memoization: mtime-keyed memos of the single derivation

- **Status:** Accepted (2026-08-15, operator — wave-6 plan approval)
- **Date:** 2026-08-15
- **Supersedes / amends:** Amends the posture recorded in `brain/forge-dev/themes/derived-never-stored-run-model.md` (a corollary, not a reversal). Operates inside [ADR 042](./042-surface-cap-scope-and-testability.md)'s boundaries.
- **Related roadmap:** wave-6 perf batches P1/P2/P5.

## Context

Forge's read model is deliberately **derived at read time, never stored**: a run surface is computed from `_queue/` manifests + `_logs/<cycle>/events.jsonl` on every request, so no stored copy can go stale (the `derived-never-stored-run-model` theme; the wave-5 `declared-data-fails-open` lesson is the same idea stated as an antipattern).

Measured on 2026-08-15 (wave-6 planning): that posture, applied with zero caching, makes `GET /api/runs` read and JSON-parse **507 MB** of events logs per request — synchronously, on the bridge's single event loop — because `_queue/done/` grows without bound and terminal runs re-parse identically forever. `GET /api/studio/kbs` re-runs a full-tree brain lint (499 files) per request. The bridge stalls globally; every page pays.

## Decision

**A read-path cache in forge is an mtime-keyed memo of the single derivation — never a second derivation, never a persisted artifact.** Concretely:

1. **Same derivation.** The cached value is produced by exactly the code path that produces the uncached value. A cache entry is `(inputs-fingerprint → derived value)`; nothing else ever writes the value. (Proof obligation: a test asserting byte-identical output cached vs uncached over the same tree.)
2. **Invalidation is the inputs' own metadata.** Key on the source files' `mtime`+`size` (manifest, events log, brain tree stat-walk) — the derivation's actual inputs — not on time, counters, or events that merely correlate.
3. **Memory only.** Memos live in the serving process and die with it. No snapshot files, no `done/` archival format, no migration surface. A bridge restart pays one cold pass; the fixed-port always-up studio model makes that rare.
4. **Fail open to the derivation.** Any doubt (missing stat, key mismatch, error) falls through to the uncached path. A memo can never be the only way to produce the value.

What stays forbidden, unchanged: storing a derived value in a manifest/status file and reading it back later (that is the stored-copy staleness the theme exists to prevent), and deriving the same fact a second way anywhere else (client-side re-derivation remains a defect).

## Consequences

- P1 (`cli/run-list-cache.ts`) memoizes per-manifest run derivation; terminal runs parse once per process. P2 memoizes the full-tree lint behind a cheap stat-walk key. P5 may share one events-read memo. All live in `cli/` (uncapped); the only orchestrator change is additive-optional params on already-exported derivation fns (ADR-042 disclose-not-park).
- The theme gains a pointer to this ADR ("bounded memoization corollary") in the same PR that lands P1.
- Persisted snapshots/archival were considered and **rejected** (new on-disk format + migration + a stored copy that can drift — the exact failure class the theme names) — revisit only if cold-pass cost becomes operator-visible in practice.
