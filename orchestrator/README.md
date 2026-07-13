# `orchestrator/` — Framework hot path (Scope 1)

> **Scope 1 — the hot path.** Scheduler, cycle runner, flow engine, the KB-backend
> seam, logging, and the Studio engine ([`studio/`](./studio/)). This is thin
> coordination: it picks a model tier and spawns each phase; it owns **no** phase
> prompt (those are skills, ADR 024). **Rule: never special-case a particular project
> or cycle-agent here** — cross-scope concerns belong here; project/agent specifics
> do not.

The ~40 `betterado`/`mdtoc`/`gitpulse` mentions in this tree are load-bearing
**incident-provenance comments**, not project logic — do not "clean" them.

See [docs/repo-map.md](../docs/repo-map.md) · [ARCHITECTURE.md](../ARCHITECTURE.md).
