# `@forge/factory`

**THE example.** The develop flow's agents, their SKILL.mds, the artifact
templates they author, and the `class → gate-profile` table that decides which
gates a change of each class must pass. Nothing else in forge imports this
package except two named seams, and **deleting the directory leaves
`forge studio` bootable** — that property is the package's reason to exist, and
`scripts/factory-deletable.mjs` proves it by execution on every CI run.

Rank 7 in the allow-graph (one above `stations` — F3, operator ruling, items
81/83). It may import `contracts`, `kernel`, `library`, `knowledge`, `projects`,
`sessions`, `agents`, `flows` and `stations`. **Nothing may import it** but the
two seams below.

## The door is `export {}`, on purpose

`index.ts` re-exports nothing, and that is the design (ADR 048), not an
unfinished job. The seams import **deep specifiers** so that resolving one agent
does not pull the demo-capture machinery into the bridge's module graph; a
barrel would re-couple exactly what the deep imports keep apart. **The door this
package really has is the set of specifiers those two seams import**, and
`contract.test.ts` measures it from the seam files rather than from a list, so
this table cannot drift from what the product actually reaches for.

### Reached by `apps/forge/factory-wiring.ts` — the BRIDGE seam (1)

| specifier | what the bridge resolves it for |
|---|---|
| `@forge/factory/class-profiles.ts` | the `class → gate-profile` table |

**F3 (operator ruling, items 81/83): the executor, every band, and the demo
model moved to `@forge/stations`.** The bridge seam's other seven specifiers —
the phase executors, the reflector, the review agent, release-finalize,
feedback reconciliation and the reflector re-run — are `@forge/stations`
imports now, not `@forge/factory` ones, so this table (which the contract test
measures from the FACTORY-prefixed specifiers a seam actually imports) shrank
to the one thing still the example's: the class table. `apps/forge` imports
`@forge/stations` for the rest **statically** — it is not part of the example
and is never absent, so there is nothing there for the seam's "no example
installed" degrade path to guard.

### Reached by `apps/forge/factory-cli-wiring.ts` — the CLI seam (1)

| specifier | what the CLI verb resolves it for |
|---|---|
| `@forge/factory/demo.ts` | `forge demo capture` |

**Same move.** The demo model and `docs-gate.ts` are `@forge/stations`
specifiers now (`@forge/stations/demo-model.ts`, `@forge/stations/gates/docs-gate.ts`);
`demo.ts` — the capture verb itself — is the one piece of the CLI seam that
stayed the example's.

**Why two seams and not one.** ADR 048 clause 2 says a fixed, enumerated set,
currently two, checked by name. Folding the CLI's verbs into the bridge seam was
measured and rejected: it put **17 new (file, sink) pairs reachable from a bridge
route** for surfaces no bridge route calls. One file would have meant widening a
security ratchet to make a count look tidier.

### `package.json` enumerates these two specifiers by name — nothing else

Bead `forge-8vfn.5.31` narrowed `exports` from a `"./*"` wildcard — which
legalised every file in the package, not just the two the seams actually
reach for — to exactly `"./class-profiles.ts"` and `"./demo.ts"`. ADR 048's
barrel prohibition governs `index.ts`, not the exports map — an explicit
per-file allowlist is the same discipline this README's table already keeps,
just enforced by Node's module resolution instead of only by
`contract.test.ts`.

This table was fourteen entries wide, plus three test-only ones, until item
83's split: the same bead's first pass legalised the phase executors,
`reflector.ts`, `adversarial-review.ts`, `release-finalize.ts`,
`reflect-reconcile.ts`, `reflector-rerun.ts`, `gates/docs-gate.ts`,
`demo-model.ts` and three test-only phase files — all of which moved to
`@forge/stations` in the same wave (F3, operator ruling items 81/83). Merging
the two lanes' work found the stale entries — `package.json` exports naming
files that no longer exist under `packages/factory/` at all — and this table
is the corrected, re-measured result: only `class-profiles.ts` and `demo.ts`
are still the example's to legalise. `@forge/stations`'s own `package.json`
now carries the corresponding entries for the files that moved; see that
package's README.

## What is inside

`design.md` is the internal shape — the bands, the phases, which files are over
the size cap and what their splits are. This file is only the door.

## What was here before

No README, no `design.md`, no `contract.test.ts`. The package had 40-odd pinned
tests and an `index.ts` whose comment called its emptiness honest — which it
was, about the barrel, and silent about the twelve specifiers that were the real
door. A surface with no document is not a small surface; it is an undescribed
one.
