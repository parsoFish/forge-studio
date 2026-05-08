---
title: simplarr — no monitoring or remediation logic (that's healarr)
description: simplarr is set-up-and-run only. Adding monitoring, remediation, or self-healing logic is a new project (healarr), not a simplarr feature.
category: decision
keywords: [simplarr, healarr, scope, monitoring, remediation, separation-of-concerns]
created_at: 2026-05-04T19:30:00Z
updated_at: 2026-05-04T19:30:00Z
related_themes: []
---

# simplarr — no monitoring or remediation logic

simplarr's surface is *"set up and run a media stack."* Monitoring, remediation, and self-healing logic live in [healarr](../../healarr/profile.md) — a deliberately separate project.

The architect rejects simplarr initiatives that:

- Add health-check polling.
- Add auto-remediation logic ("retry import," "blocklist torrent," "rescan library").
- Add a dashboard.
- Add notification logic for service failures.

These are healarr-shaped. The right framing for the user is *"propose this as a healarr initiative instead."*

The architect *accepts* simplarr initiatives that:

- Improve the install / configure / upgrade path.
- Add new service profiles to compose files.
- Expand schema coverage (`1337x-schema.json` etc.).
- Improve test coverage of the existing setup paths.

This is forge enforcing the user-stated separation: *"simplarr = set up and run; healarr = watch and fix."* Both improve when used together; mixing dilutes both.

## Sources

- healarr README "Why a separate repo?" section.

## Related

- [`healarr/profile.md`](../../healarr/profile.md) — the project that owns monitoring + remediation.
