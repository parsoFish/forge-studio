---
id: cli-project-shape
title: CLI project shape
kind: project-shape
appliesTo: [cli, typescript, node]
scope: project
provenance: "projects/mdtoc/CLAUDE.md (forge's dependency-light TypeScript CLI reference project) + github.com/parsoFish/gitpulse (the creds-free verify-cycle ground)"
---

## CLI project shape

The archetype forge's own verify-cycle grounds (mdtoc, gitpulse) are built to:
a dependency-light command-line tool with a two-tier gate.

- **Quality gate (per dev-loop iteration):** ONE command — deterministic,
  creds-free, sub-second (e.g. `npm test`, a `node:test` unit suite). It must
  fail before the work exists and pass only when the behaviour is correct.
- **Acceptance gate (once per cycle):** run the **built** binary as a real child
  process against a checked-in fixture and assert the exact output — a read-back
  against the actually-running thing, not the source (e.g. `npm run acceptance`
  builds then runs the CLI vs `test/fixtures/*`).
- **Fixtures use non-default, distinctive values** (a `sentinel-<hex>` marker) so
  an implementation that ignores the real input is caught.
- **Dependency-light.** Keep runtime deps minimal (ideally zero — node builtins
  only); a small, fixed dev toolchain (`tsx`/`typescript`). Justify any new
  dependency before adding it.
- **Build step is distinct from the gate:** `npm run build` (tsc → `dist/`)
  compiles the binary the acceptance gate then runs.
- **The human owns git history and the instruction file** — forge never
  `git reset`/force-pushes, and never creates or overwrites a human-authored
  AGENTS.md/CLAUDE.md.
