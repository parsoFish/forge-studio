---
title: 'simplarr — docker-compose-{nas,pi}.yml are profiles, not duplicates'
description: >-
  Host-specific overrides on a shared base. A new profile needs justification,
  not just a copy. Changes to one require considering both.
category: pattern
keywords:
  - simplarr
  - docker-compose
  - profiles
  - nas
  - pi
  - overrides
  - deployment-targets
created_at: 2026-05-04T19:30:00.000Z
updated_at: 2026-05-04T19:30:00.000Z
related_themes: []
---

# simplarr — compose profiles, not duplicates

`docker-compose-nas.yml` and `docker-compose-pi.yml` are profiles, not parallel files. Each represents host-specific overrides (resource limits, paths, network mode) on a shared service definition.

Practice for simplarr work items:

- **Changing one compose file is a partial change.** The PM phase should emit work items that update both, with a final integration item that re-exercises the deployment validation on each.
- **A new profile** (`-rpi5`, `-vps`, `-nas-with-tailscale`) needs explicit user justification — the architect treats this as a taste decision, not an auto-resolve. New profiles compound the "drift between profiles" risk.
- **Tests must validate at least the deltas.** A new env var added in nas.yml is unobserved unless something verifies it; pi.yml shouldn't silently lack the same setting.

This is the simplarr equivalent of the layered-merge-order pattern: structural enforcement that prevents partial coverage from looking complete.

## Sources

- simplarr README + `docker-compose-{nas,pi}.yml` files in repo.
