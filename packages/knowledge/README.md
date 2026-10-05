# `@forge/knowledge`

Forge's **Brain** in product terms, **Knowledge** outward: the three scoped graphs, the
paths that locate them, the lint that keeps them honest, and the KB surface Studio drives.

## The public door

`import … from '@forge/knowledge'`. That is this package's API and the list below is all
of it. `package.json` maps only `"."` and one documented test-only subpath
(`@forge/knowledge/testing`, below) — a deep path like
`@forge/knowledge/brain-paths.ts` no longer resolves. Bead `forge-8vfn.5.31` collapsed
the legacy `"./*"` door; every importer now goes through `@forge/knowledge`.

`contract.test.ts` asserts this list against what the index actually
exports, in both directions, and is required to FAIL against an empty index.

### Values (49)

| area | exports |
|---|---|
| brain paths | `cycleArchivePath` · `cycleArchiveRelPath` · `cyclesRawDir` · `cyclesThemesDir` · `deriveKbIdFromBrainPath` · `projectBrainDir` · `projectThemesDir` · `readArtifactRoot` · `resolveKbBrainDir` |
| brain index | `loadBrainIndex` · `regenerateBrainIndex` |
| brain lint | `CHECK_NAMES` · `classify` · `classifyFinding` · `lintThemeFiles` · `runBrainLint` · `brainTruthRates` · `formatTruthfulnessLines` |
| KB descriptors | `loadKbDescriptor` · `serializeKbDescriptor` · `projectKbBindings` · `unroutableKbReason` · `kbReadPolicyViolation` |
| KB surface | `KB_SEEDING_ANCHOR_PREFIX` · `KB_CLEANUP_KIND_DIR` · `approveKbCleanup` · `computeAgentCleanupFindings` · `loadKbDescriptors` · `releaseInterruptedKbCleanupApplies` · `activeJobReason` · `deriveKbActiveJob` · `runPostReflectionKbHealth` · `guardAgentKbEdits` · `snapshotBrainTree` · `noKbEdits` · `tryGetKbBackend` |
| project brain seeding | `checkProjectBrainSeedContainment` · `seedProjectBrain` · `isUntouchedBrainSeedStub` · `PROJECT_BRAIN_KIND_DIR` · `buildAnalyzePlan` · `commitProjectBrain` · `listStagedThemes` |
| brain write lease | `acquireBrainWriteLease` · `BrainWriteLeaseContentionError` |
| KB validation | `validateKb` |
| cycle retention | `assignRetention` · `collectCitedBy` · `patchArchiveFrontmatter` |
| HTTP routes | `knowledgeRoutes` |

### Types (9)

`Finding` · `RunBrainLintResult` · `Scope` · `UnroutableKb` · `KbEditGateResult` ·
`RetentionTag` · `ThemeMeta` · `KbBackend` · `SessionStatusIoPort`

### The one test-only subpath

`@forge/knowledge/testing` exports `resolveKbProcesses` — used only by two
`apps/forge` tests, no production consumer outside this package, so it stays off the
main door (bead `forge-8vfn.5.31`: a symbol earns the door by having a production
consumer in another package; a test-only deep import gets a named, documented
subpath instead of widening `"./*"` back open).

## What it owns

Three scoped graphs (SPEC §4): forge
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
violation, and the caller's business (SPEC §4
as amended). It does not run sessions: the drain and brain-fix runners are a sessions
kind, and the rows that still cross that line are listed in `_1.0/handoffs.md`, not
hidden. It does not own project artifacts
(SPEC §4 puts Brain 3 in
this repo, under forge's ownership, not the managed project's).

## Crash and recovery

- **KB drain status** (`writeKbDrainStatus`, `kb-drain-store.ts`) is a genuine tmp+rename: it writes `status.json.tmp` then `renameSync`s it over the final path, so the GET routes polling a live run every ~100-250ms only ever see a fully-written prior file or a fully-written new one, never a truncated one — see `packages/knowledge/tests/unit/bridge-studio-kb-drain.test.ts` ("writeKbDrainStatus is atomic").
- **The drain cancel flag** (`requestKbDrainCancel`, `kb-drain-store.ts`) is a plain file write, not in-memory, so a stop request survives a bridge restart racing the run; a crashed drain simply leaves the flag unread, which is harmless once the run itself is gone.
- **The brain-write lease** (`acquireBrainWriteLease`, `brain-write-lease.ts`) serializes the daemon's reflector against a Studio KB job with a `proper-lockfile` mutex. A holder that crashes stops refreshing its lock's mtime, so the lease self-clears after `BRAIN_WRITE_LEASE_STALE_MS` (15s) unless its recorded holder PID is still alive, in which case it stays held for up to `BRAIN_WRITE_LEASE_PID_TRUST_MS` (60s) — see `packages/knowledge/tests/unit/brain-write-lease.test.ts`.
- **KB-cleanup drafts vs. applied edits** (`bridge-studio-kbs.ts`): approving a drain-gated prose draft claims the session at `phase: 'applying'`, re-audits the proposal against the file's current bytes, then whole-file-overwrites each theme file. A caught write failure reverts the session to `awaiting-approval` with the error recorded, so a retry is safe (a whole-file replacement is idempotent). A hard crash mid-loop cannot do that, so the bridge does it at its next start: the apply only ever runs in the bridge process, so any session still at `applying` then is orphaned, and `releaseInterruptedKbCleanupApplies` (`kb-drain-store.ts`) releases it to `awaiting-approval` with an `apply_error` naming the interruption, one JSONL event per release, leaving every other phase untouched — see `packages/knowledge/tests/unit/kb-drain-store-crash-recovery.test.ts`.
- **Brain index and auto-fixes** (`regenerateBrainIndex` in `brain-index.ts`; `applyAutoFixes` in `brain-fix-auto.ts`) write `INDEX.md` and theme files directly with `writeFileSync`, not atomically. Recovery here is regeneration, not rollback: both are proven byte-stable and idempotent on repeat runs, so a crash mid-write is repaired by simply running the same regenerate/fix call again — see `packages/knowledge/tests/unit/brain-index.test.ts` and `packages/knowledge/tests/unit/brain-fix-auto.test.ts`.

## Layout

`tests/{unit,integration,contract,regression}/` — no test file sits at the package root.
Production files stay under the 800-line cap; the package as a whole is capped in
`QUARRY.md`.

See [`design.md`](./design.md) for why the seam is shaped this way.
