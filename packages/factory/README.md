# `@forge/factory`

**THE example.** The develop flow's agents, their SKILL.mds, the artifact
templates they author, and the `class → gate-profile` table that decides which
gates a change of each class must pass. Nothing else in forge imports this
package except two named seams, and **deleting the directory leaves
`forge studio` bootable** — that property is the package's reason to exist, and
`scripts/factory-deletable.mjs` proves it by execution on every CI run.

Rank 6 in the allow-graph. It may import `contracts`, `kernel`, `library`,
`knowledge`, `projects`, `sessions`, `agents` and `flows`. **Nothing may import
it** but the two seams below.

## The door is `export {}`, on purpose

`index.ts` re-exports nothing, and that is the design (ADR 048), not an
unfinished job. The seams import **deep specifiers** so that resolving one agent
does not pull the demo-capture machinery into the bridge's module graph; a
barrel would re-couple exactly what the deep imports keep apart. **The door this
package really has is the set of specifiers those two seams import**, and
`contract.test.ts` measures it from the seam files rather than from a list, so
this table cannot drift from what the product actually reaches for.

### Reached by `apps/forge/factory-wiring.ts` — the BRIDGE seam (8)

| specifier | what the bridge resolves it for |
|---|---|
| `@forge/factory/phases/executor-table.ts` | the phase executors the flow runner walks |
| `@forge/factory/phases/executor-deps.ts` | the injectable dep set those executors take |
| `@forge/factory/phases/reflector.ts` | the reflector phase |
| `@forge/factory/phases/adversarial-review.ts` | the one read-only review agent |
| `@forge/factory/phases/release-finalize.ts` | the release-finalize phase |
| `@forge/factory/class-profiles.ts` | the `class → gate-profile` table |
| `@forge/factory/reflect-reconcile.ts` | reconciling operator feedback into the reflection |
| `@forge/factory/reflector-rerun.ts` | re-running the reflector from the UI |

### Reached by `apps/forge/factory-cli-wiring.ts` — the CLI seam (3)

| specifier | what the CLI verb resolves it for |
|---|---|
| `@forge/factory/demo.ts` | `forge demo capture` |
| `@forge/factory/demo-model.ts` | the demo model the capture renders |
| `@forge/factory/gates/docs-gate.ts` | `forge gate docs`, and the `docs` class's merge-boundary verb |

**Why two seams and not one.** ADR 048 clause 2 says a fixed, enumerated set,
currently two, checked by name. Folding the CLI's verbs into the bridge seam was
measured and rejected: it put **17 new (file, sink) pairs reachable from a bridge
route** for surfaces no bridge route calls. One file would have meant widening a
security ratchet to make a count look tidier.

### `package.json` enumerates these eleven specifiers by name, plus three test-only ones

Bead `forge-8vfn.5.31` narrowed `exports` from a `"./*"` wildcard — which
legalised every file in the package, not just the eleven above — to exactly
these eleven paths, plus three more that only test files reach for
(`phases/derive-demo-model.ts`, `phases/project-manager.ts`,
`phases/developer-loop.ts`: `apps/forge`'s and `packages/flows`' own test
suites, no production consumer). ADR 048's barrel prohibition governs
`index.ts`, not the exports map — an explicit per-file allowlist is the same
discipline this README's table already keeps, just enforced by Node's module
resolution instead of only by `contract.test.ts`. `packages/factory/
phases/executor-deps.ts`'s own INTERNAL imports of its seven sibling phase
modules were converted from the full `@forge/factory/<file>.ts` specifier to
relative `./`/`../` paths in the same bead, matching the relative-import house
style every other package in this repo already used for same-package
references — an internal file reaching itself through the package specifier
would have needed its own targets legalised in the exports map too, for no
reason.

## What is inside

`design.md` is the internal shape — the bands, the phases, which files are over
the size cap and what their splits are. This file is only the door.

## What was here before

No README, no `design.md`, no `contract.test.ts`. The package had 40-odd pinned
tests and an `index.ts` whose comment called its emptiness honest — which it
was, about the barrel, and silent about the twelve specifiers that were the real
door. A surface with no document is not a small surface; it is an undescribed
one.
