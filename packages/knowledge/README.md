# `@forge/knowledge`

Forge's **Brain** in product terms, **Knowledge** outward: the three scoped graphs, the
paths that locate them, the lint that keeps them honest, and the KB surface Studio drives.

## The public door

`import … from '@forge/knowledge'`. That is this package's API and the list below is all
of it. Deep paths (`@forge/knowledge/brain-paths.ts`) still resolve — `package.json` maps
`"./*": "./*"` — and every existing importer uses one, so they are the **legacy** door,
kept working and not recommended. Collapsing to one door is bead `forge-8vfn.5.31`.

`tests/contract/contract.test.ts` asserts this list against what the index actually
exports, in both directions, and is required to FAIL against an empty index.

### Values (35)

| area | exports |
|---|---|
| brain paths | `cycleArchivePath` · `cycleArchiveRelPath` · `cyclesRawDir` · `cyclesThemesDir` · `projectBrainDir` · `projectThemesDir` · `readArtifactRoot` · `resolveKbBrainDir` |
| brain index | `loadBrainIndex` · `regenerateBrainIndex` |
| brain lint | `CHECK_NAMES` · `classify` · `classifyFinding` · `lintThemeFiles` · `runBrainLint` |
| KB descriptors | `loadKbDescriptor` · `serializeKbDescriptor` · `projectKbBindings` · `unroutableKbReason` · `kbReadPolicyViolation` |
| KB surface | `KB_SEEDING_ANCHOR_PREFIX` · `approveKbCleanup` · `computeAgentCleanupFindings` · `loadKbDescriptors` · `activeJobReason` · `deriveKbActiveJob` · `runPostReflectionKbHealth` · `guardAgentKbEdits` · `snapshotBrainTree` |
| project brain seeding | `checkProjectBrainSeedContainment` · `seedProjectBrain` |
| cycle retention | `assignRetention` · `collectCitedBy` · `patchArchiveFrontmatter` |
| HTTP routes | `knowledgeRoutes` |

### Types (7)

`Finding` · `RunBrainLintResult` · `Scope` · `UnroutableKb` · `KbEditGateResult` ·
`RetentionTag` · `ThemeMeta`

## What it owns

Three scoped graphs ([ADR 018](../../docs/decisions/018-three-brain-model.md)): forge
engineering, cross-cycle patterns, and one graph per managed project. Every per-KB read
and write goes through **`KbBackend`** (`kb-backend.ts`) — `SPEC.md` §4, narrowed in M4
to a guarantee that is true and asserted rather than one enforced nowhere. Cross-brain
navigation sits above the seam, deliberately and in writing.

`routes.ts` is the package's HTTP surface: seventeen carved routes as an ordered,
first-match-wins table that `apps/forge/routes.ts` assembles. Order is part of the
contract — several patterns genuinely overlap — so `tests/contract/routes-table.test.ts`
pins each colliding URL to the entry that must claim it.

## What it does not own

It does not decide **who may read a brain** — that is `kb-read-policy.ts` reporting a
violation, and the caller's business ([ADR 010](../../docs/decisions/010-brain-first.md)
as amended). It does not run sessions: the drain and brain-fix runners are a sessions
kind, and the rows that still cross that line are listed in `_1.0/handoffs.md`, not
hidden. It does not own project artifacts
([ADR 035](../../docs/decisions/035-forge-owned-central-artifacts.md) puts Brain 3 in
this repo, under forge's ownership, not the managed project's).

## Layout

`tests/{unit,integration,contract,regression}/` — no test file sits at the package root.
Production files stay under the 800-line cap; the package as a whole is capped in
`QUARRY.md`.

See [`design.md`](./design.md) for why the seam is shaped this way.
