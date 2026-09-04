# `orchestrator/` — legacy residue (Scope 1, being quarried)

> **What is left here after M4:** `phases/` (the develop factory's legacy phase code the
> `packages/factory` executors still lean on), `studio/validate.ts` (846 lines, owner
> `kernel`, the last five-way validation split — M5-A), and the spawn-capture test
> fixtures. Everything else — scheduler, flow engine, KB backend, session runners, the
> Studio engine and registry, the UI bridge — now lives in `packages/*` and `apps/forge`
> ([repo map](../docs/repo-map.md)). **No package may import this directory**; the
> remaining rows are enumerated in `scripts/baselines/boundaries.json` and only shrink.
> Production lines here are counted by `scripts/check-package-caps.mjs` and ratified in
> [`QUARRY.md`](../QUARRY.md).

The ~40 `betterado`/`mdtoc`/`gitpulse` mentions in this tree are load-bearing
**incident-provenance comments**, not project logic — do not "clean" them.

See [docs/repo-map.md](../docs/repo-map.md) · [ARCHITECTURE.md](../ARCHITECTURE.md).
