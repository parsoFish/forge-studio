---
title: simplarr — Bash + PowerShell parity is mandatory
description: Every configurator feature exists in both configure.sh and configure.ps1. Single-language work items are flagged as missing a sibling by the dependency-graph critic.
category: decision
keywords: [simplarr, dual-language, bash, powershell, parity, configurator, paired-work-items]
created_at: 2026-05-04T19:30:00Z
updated_at: 2026-05-04T19:30:00Z
related_themes: []
---

# simplarr — Bash + PowerShell parity

simplarr ships parallel Bash and PowerShell implementations of the same configurator. Drift between them is a defect.

PM-phase discipline:

- **Paired work items** — every configurator feature emits two work items (`WI-N-bash` and `WI-N-ps1`), with `depends_on` so the test/validation work item depends on both.
- **Single-language work items** for the configurator are flagged by the dependency-graph critic as missing a sibling — escalation to the user, not auto-resolve.
- **Tests run both** — work item acceptance criteria must include "ran via bash AND ran via PowerShell" for configurator behaviour.

Why accept the doubling cost:

- The user's deployment environment is heterogeneous (Linux NAS, Windows hosts, Pi). Locking out either is regression.
- v1 Cycle 3 data confirms this is expensive (6.3 min avg vs 3.6 min for single-language). The cost is structural; don't paper over it by skipping a language.

## Sources

- simplarr README presence of `configure.sh` + `configure.ps1`.
- [`v1-themes-completion-stats.cycle.md`](../../../_raw/v1-wiki/v1-themes-completion-stats.cycle.md) — dual-language inflation note.

## Related

- [Theme: Dependency-ordered work](../../../forge/themes/dependency-ordered-work.md) — graph critic enforcement.
