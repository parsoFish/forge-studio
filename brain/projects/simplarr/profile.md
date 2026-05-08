---
project: simplarr
created_at: 2026-05-04T19:30:00Z
updated_at: 2026-05-04T19:30:00Z
status: active
domain: media-stack setup-and-configuration tooling (Plex/*arr ecosystem)
stack: [bash, powershell, docker-compose]
taste_decay: 0.05
---

# simplarr

Setup-and-configuration tooling for Plex/*arr media stacks (Sonarr, Radarr, Prowlarr, Overseerr, qBittorrent, etc.). Configures the stack across NAS / Pi / general Docker hosts via parallel Bash and PowerShell implementations of the same configurator.

## Taste signals

- **Dual-language parity** — every feature exists in both `configure.sh` and `configure.ps1`. Drift between them is a defect, not an acceptable trade-off.
- **`docker-compose-{nas,pi}.yml` are profiles, not duplicates** — host-specific overrides on a shared base. A new profile (`-rpi5`, `-vps`) needs a justification, not just a copy.
- **No web UI** — CLI + config files only. Adding interactive prompts is fine; introducing a dashboard is a *new project*, not a simplarr feature.
- **Schema-driven** — `1337x-schema.json` (and similar) reflect the indexer schemas simplarr drives. Updates flow from upstream schema changes, not from speculative additions.

## Hard constraints

- **Bash and PowerShell parity** is mandatory. The PM phase must emit *paired* work items (one for `.sh`, one for `.ps1`) for any feature touching the configurator. The dependency-graph critic should flag a single-language work item as missing a sibling.
- **Compose files reflect deployment targets** — changing `docker-compose-nas.yml` without considering `docker-compose-pi.yml` is a partial change.
- **Healarr is the operations companion** (separate repo) — simplarr stays "set up and run a media stack." Don't bundle monitoring or remediation logic into simplarr.

## Domain note (from v1 Cycle 3 data)

simplarr's **dual-language constraint inflates avg develop time to 6.3 min** (vs env-optimiser's 3.6 min on similar item count) despite clean domain logic. This is structural, not a planning failure — accept the cost; don't paper over it by skipping a language.

## Active focus (v1 roadmap, carried forward)

- **Foundational hardening**: consolidate duplicated logic in configure scripts.
- **Test gaps**: close VPN and split-setup test coverage.
