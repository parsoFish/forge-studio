/**
 * logs-residue-guard-core.mjs — the pure half of two `_logs/` residue guards
 * that share one before/after diff shape: `_logs/INIT-*` (forge-8vfn.8.1.10)
 * and `_logs/_bridge-*` (forge-8vfn.8.5.48, row 212).
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
 * WHY `INIT-*`/`_bridge-*` AND NOT EVERYTHING UNDER `_logs/`. `_logs/<runId>/`
 * is also written for a handful of ad hoc standalone runIds (`_agent-<slug>`,
 * `TEST-*`, …) that legitimately use the repo's own `_logs/` on purpose (an
 * interactive `forge agent dispatch` with no `--logs-root`). Scoping to the
 * two prefixes each defect actually produces keeps the guard from flagging
 * normal ad hoc dispatch residue that was never either defect's shape, while
 * still catching a leaking tmp-harness test.
 *
 * WHY TWO PREFIXES, ONE MODULE. Different call paths, same pure diff logic —
 * `listDirsWithPrefix` plus the shared `newInitDirs` set-diff answers both; a
 * second prefix is a second thin wrapper, not a second algorithm.
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
 * The names present in `after` but absent from `before`, sorted for a
 * deterministic report. Order-independent inputs (both are `Set`s) so two
 * callers snapshotting the same directory can never disagree over ordering.
 * Prefix-agnostic by design — the same function diffs an `INIT-*` snapshot
 * pair and a `_bridge-*` snapshot pair; only the `listXDirs` call that built
 * each `Set` knows which shape it watched.
 */
export function newInitDirs(before, after) {
  return [...after].filter((name) => !before.has(name)).sort();
}
