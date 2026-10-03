/**
 * logs-residue-guard-core.mjs — the pure half of the `_logs/` residue guards,
 * all sharing one before/after diff shape: the named-prefix guards for
 * `_logs/INIT-*` (forge-8vfn.8.1.10) and `_logs/_bridge-*` (forge-8vfn.8.5.48,
 * row 212), and the GENERALISED any-new-top-level-entry ratchet below (row
 * 212 follow-up, same bead).
 *
 * THE FIRST DEFECT THIS GUARDS AGAINST. `packages/flows/tests/integration/
 * cycle-pm-hallucination.test.ts` builds its own `mkdtempSync` harness — its
 * own `_queue`, its own `_logs` — yet running it used to create
 * `<repo>/_logs/INIT-2026-05-20-pm-decomp-test/agent-run.marker` in THIS
 * checkout's real `_logs/`. The cause was `runAgent`'s spawn-marker write
 * deriving its logs root from `<FORGE_ROOT>/_logs` whenever a caller omitted
 * `ctx.logsRoot` — see `packages/agents/run-agent.ts`'s `logsRootFromLogger`
 * for the fix. This module is the belt: a future caller that reintroduces the
 * same shape (any code path that writes into `_logs/INIT-*` using the repo's
 * own root instead of a caller-supplied one) fails the suite instead of
 * leaving silent residue for the next run to trip over.
 *
 * THE SECOND DEFECT (row 212). Since row 211 (forge-8vfn.8.5.47), every
 * `startBridge()` boot installs a git `reference-transaction` hook into
 * `forgeRoot`'s hooks dir (`installForgeRefGuardHook`) AND opens its own
 * `_logs/_bridge-<stamp>-<rand>` run dir there (`bridgeCycleId`,
 * `packages/kernel/logging.ts`'s `createLogger(bridgeCycleId(), join(forgeRoot,
 * '_logs'))`). A test that boots the bridge with `forgeRoot` pointed at THIS
 * checkout — rather than a caller-owned tmp root — leaves a `_bridge-*`
 * directory under the repo's own `_logs/`: the same residue SHAPE as the
 * `INIT-*` defect above, a different prefix and a different call path
 * (`startBridge` itself, not `runAgent`). Found empirically (2026-10-04) by
 * snapshotting this checkout's `_logs/` and the shared hooks dir before/after
 * running every test file that calls `startBridge(` or references `forge
 * studio`: exactly two offenders, both passing the real checkout as
 * `forgeRoot` instead of a tmp root (`ui-bridge-cost-ceiling-enforceable
 * .test.ts`'s `forgeRoot: process.cwd()` and `bridge-studio-agent-capability
 * .test.ts`'s `realForgeRoot = resolve(dirname(...), '..','..','..','..')`).
 *
 * WHY BEFORE/AFTER, NOT "NONE MAY EXIST". A real local checkout legitimately
 * carries real `_logs/INIT-*` directories from real forge runs, and a healthy
 * `forge studio` left running nearby legitimately carries `_logs/_bridge-*`
 * ones — refusing on mere presence would make the guard permanently red on
 * every operator's machine. The guard therefore only cares about entries that
 * did not exist when the test run STARTED and do exist by the time it ENDED:
 * a directory nothing but this run could have created.
 *
 * WHY `INIT-*`/`_bridge-*` AND NOT EVERYTHING UNDER `_logs/` — FOR THOSE TWO
 * NAMED GUARDS SPECIFICALLY. `_logs/<runId>/` is also written for a handful of
 * ad hoc standalone runIds (`_agent-<slug>`, `TEST-*`, …) that legitimately
 * use the repo's own `_logs/` on purpose (an interactive `forge agent
 * dispatch` with no `--logs-root`). Scoping each NAMED guard to the one prefix
 * its defect actually produces keeps ITS message precise and lets it stay
 * silent about everything else.
 *
 * THE THIRD DEFECT (row 212 follow-up) — a full `npm test` run (887dc58da,
 * 11028/11028 green, the row-212 named guards both silent) still left TWO
 * new top-level `_logs/` entries this module had no prefix for: a
 * `_demo-2026-06-24T11-00-00/` directory (a demo-builder runner fixture
 * defaulting `logsRoot` from a `forgeRoot: FORGE_ROOT` it only meant to pin a
 * call site's CWD-independence with — `packages/sessions/kinds/kind-turn.ts`'s
 * `const logsRoot = input.logsRoot ?? resolve(forgeRoot, '_logs')`) and a
 * `preflight/verdicts.jsonl` (`apps/forge/cli.ts`'s `cmdPreflight` hard-codes
 * `join(FORGE_ROOT, '_logs', 'preflight')` with no override, for a CLI that
 * two regression tests spawn as a real subprocess against the real checkout
 * ON PURPOSE — see `cli-own-tree.test.ts`'s D2). Two genuinely different root
 * causes, same residue CLASS, and neither is the last one a third call path
 * will ever invent: a per-defect prefix guard only ever catches defects
 * someone already found. `listTopLevelEntries` below is the generalisation —
 * ANY new top-level `_logs/` entry, file or directory, named-prefix or not —
 * so the NEXT such defect is caught by the suite the first time it happens,
 * not the second time someone goes looking.
 *
 * WHY THIS RELIES ON "NO TEST WRITES INTO THE REAL `_logs/`, EVEN
 * TRANSIENTLY" (row 212 follow-up 3). `node --test` runs files as PARALLEL
 * processes diffing the SAME shared repo `_logs/`, so an entry a DIFFERENT
 * file creates and removes entirely within THIS file's own before/after
 * window is indistinguishable from one this file made itself — measured
 * directly when three reflector tests' always-cleaned-up scratch still
 * tripped four unrelated files' guards purely from running concurrently.
 *
 * WHY NO ALLOWLIST. A legitimate per-run `_logs/` entry this module doesn't
 * already know a prefix for is, by definition, something no currently-known
 * forge code path produces during `npm test` — there is no case on record
 * where a test run is SUPPOSED to leave a new top-level `_logs/` entry behind.
 * An allowlist entry would be a silent, permanent exemption for whatever
 * shape happened to exist the day someone added it; reporting instead forces
 * each new shape through the same fix-or-justify scrutiny the first two got.
 *
 * WHY ADDITIVE, NOT A REPLACEMENT FOR THE NAMED GUARDS. `listInitDirs`/
 * `listBridgeDirs` keep their own before/after snapshots and their own
 * specific remediation text (which file, which fix) — more useful than the
 * generic ratchet's message for the two shapes it already knows. The generic
 * ratchet's `listTopLevelEntries` snapshot runs ALONGSIDE them and only
 * reports the entries NEITHER named guard already explained.
 *
 * PURE ON PURPOSE. This module performs I/O (`readdirSync`) but has NO
 * import-time side effects and touches only the `logsRoot` it is handed — so
 * a unit test can drive it against a throwaway `mkdtempSync` directory
 * without ever touching this checkout's real `_logs/`. The actual preload
 * wiring (snapshot-at-import + fail-at-exit against THIS repo's `_logs/`)
 * lives in the sibling `logs-residue-guard.mjs`, which imports these
 * functions rather than re-deriving the same listing/diff logic itself.
 */
import { existsSync, readdirSync } from 'node:fs';

const INIT_DIR_PREFIX = 'INIT-';
const BRIDGE_DIR_PREFIX = '_bridge-';

/**
 * Every directory directly inside `logsRoot` whose name starts with `prefix`,
 * as a `Set` of names (not full paths — the caller already knows `logsRoot`).
 * Empty, never a throw, when `logsRoot` does not exist yet — a fresh checkout
 * (or a fresh tmp forgeRoot that never got as far as booting) is not a
 * violation of anything. Shared by `listInitDirs` and `listBridgeDirs` below
 * — the two watched shapes differ only in their prefix.
 */
function listDirsWithPrefix(logsRoot, prefix) {
  if (!existsSync(logsRoot)) return new Set();
  return new Set(
    readdirSync(logsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map((entry) => entry.name),
  );
}

/** Every `INIT-*` directory directly inside `logsRoot` — see the module doc's
 *  first defect. */
export function listInitDirs(logsRoot) {
  return listDirsWithPrefix(logsRoot, INIT_DIR_PREFIX);
}

/** Every `_bridge-*` directory directly inside `logsRoot` — see the module
 *  doc's second defect (row 212, bead forge-8vfn.8.5.48). */
export function listBridgeDirs(logsRoot) {
  return listDirsWithPrefix(logsRoot, BRIDGE_DIR_PREFIX);
}

/**
 * Every top-level entry directly inside `logsRoot` — FILES as well as
 * directories, no prefix filter — as a `Set` of names. The generalised
 * ratchet (row 212 follow-up, bead forge-8vfn.8.5.48): see the module doc's
 * third defect for why "only the prefixes we already know about" is not
 * enough. Empty, never a throw, when `logsRoot` does not exist yet, for the
 * same reason `listDirsWithPrefix` is: a fresh checkout (or a fresh tmp
 * forgeRoot that never got as far as booting) is not a violation of
 * anything. `.gitkeep` is the one entry every checkout starts with; it is
 * present in both the before- and after-snapshot, so the diff never reports
 * it as new.
 */
export function listTopLevelEntries(logsRoot) {
  if (!existsSync(logsRoot)) return new Set();
  return new Set(readdirSync(logsRoot, { withFileTypes: true }).map((entry) => entry.name));
}

/**
 * The names present in `after` but absent from `before`, sorted for a
 * deterministic report. Order-independent inputs (both are `Set`s) so two
 * callers snapshotting the same directory can never disagree over ordering.
 * Prefix-agnostic by design — the same function diffs an `INIT-*` snapshot
 * pair, a `_bridge-*` snapshot pair, and (row 212 follow-up) a whole
 * `listTopLevelEntries` snapshot pair; only the `listXDirs`/`listTopLevelEntries`
 * call that built each `Set` knows which shape it watched.
 */
export function newInitDirs(before, after) {
  return [...after].filter((name) => !before.has(name)).sort();
}
