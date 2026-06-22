---
title: Unifier wastes ~15 Bash probes discovering forge demo render conventions
description: >-
  The unifier skill spends significant tokens probing forge internals to find
  the demo render sub-command or its --dir flag convention; it falls back to
  manual file copy after failing to invoke it correctly.
category: antipattern
keywords:
  - unifier
  - forge-demo-render
  - discovery
  - repeated-bash
  - tooling-discoverability
created_at: 2026-06-21T00:00:00.000Z
updated_at: 2026-06-21T00:00:00.000Z
---

# Unifier wastes ~15 Bash probes discovering forge demo render conventions

## Pattern observed

In the gitpulse ownership-hotspots-top-flag initiative, the unifier's single
iteration included ~15 Bash calls probing how to invoke `forge demo render`:

1. `forge demo render <init-id>` — succeeded but produced no DEMO.md in the
   expected path.
2. `which forge`, `forge --version` — PATH/version checks.
3. Probing `orchestrator/studio/`, `orchestrator/demo/`, `orchestrator/cli.ts`,
   `orchestrator/brain-paths.ts`, `bin/forge.mjs` for render logic.
4. `forge demo render <init-id> --dir <path>` — tried with explicit `--dir`.
5. Eventually fell back to `cp demo/pulse-capture.md forge/history/.../DEMO.md`.

This pattern likely recurs across unifier invocations whenever the demo render
output path doesn't match the unifier's expectation.

## Root cause

The unifier SKILL.md or the forge demo render CLI do not document the exact
output path convention. The unifier must discover it by reading forge source
each time — a per-cycle rediscovery cost.

## Fix options

A. Add a `## Demo artifacts` section to the unifier SKILL.md documenting:
   - Exact command: `forge demo render <init-id>` run from forge root.
   - Expected output path: `projects/<project>/forge/history/<init-id>/demo/DEMO.md`
   - Fallback: `cp demo/pulse-capture.md` to that path if render fails.

B. Make `forge demo render` print the output path on success (or fail loudly
   with the expected path), so the unifier can verify without probing.

## Sources

- `_logs/2026-06-21T04-52-20_INIT-2026-06-21-ownership-hotspots-top-flag/events.jsonl` — unifier iteration metadata (`tools_used` array for UWI-1) listing the 15+ Bash calls probing `forge demo render`.
- `/home/parso/forge/brain/cycles/_raw/2026-06-21T04-52-20_INIT-2026-06-21-ownership-hotspots-top-flag.md`
