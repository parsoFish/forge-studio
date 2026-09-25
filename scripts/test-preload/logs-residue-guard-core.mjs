/**
 * logs-residue-guard-core.mjs — the pure half of the `_logs/INIT-*` residue
 * guard (forge-8vfn.8.1.10).
 *
 * THE DEFECT THIS GUARDS AGAINST. `packages/flows/tests/integration/
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
 * WHY BEFORE/AFTER, NOT "NONE MAY EXIST". A real local checkout legitimately
 * carries real `_logs/INIT-*` directories from real forge runs — refusing on
 * their mere presence would make the guard permanently red on every
 * operator's machine. The guard therefore only cares about `INIT-*` entries
 * that did not exist when the test run STARTED and do exist by the time it
 * ENDS: a directory nothing but this run could have created.
 *
 * WHY `INIT-*` AND NOT EVERYTHING UNDER `_logs/`. `_logs/<runId>/` is written
 * for cycle runs (`INIT-*`, the manifest id) and for a handful of ad hoc
 * standalone runIds (`_agent-<slug>`, `TEST-*`, …) that legitimately use the
 * repo's own `_logs/` on purpose (an interactive `forge agent dispatch` with
 * no `--logs-root`). Scoping to `INIT-*` — the shape a REAL forge cycle run
 * takes and the shape this exact defect produced — keeps the guard from
 * flagging normal ad hoc dispatch residue that was never this defect's shape,
 * while still catching a cycle-shaped tmp-harness test that leaks into the
 * repo tree.
 *
 * PURE ON PURPOSE. This module performs I/O (`readdirSync`) but has NO
 * import-time side effects and touches only the `logsRoot` it is handed — so
 * a unit test can drive it against a throwaway `mkdtempSync` directory
 * without ever touching this checkout's real `_logs/`. The actual preload
 * wiring (snapshot-at-import + fail-at-exit against THIS repo's `_logs/`)
 * lives in the sibling `logs-residue-guard.mjs`, which imports these two
 * functions rather than re-deriving the same listing/diff logic itself.
 */
import { existsSync, readdirSync } from 'node:fs';

const INIT_DIR_PREFIX = 'INIT-';

/**
 * Every `INIT-*` directory directly inside `logsRoot`, as a `Set` of names
 * (not full paths — the caller already knows `logsRoot`). Empty, never a
 * throw, when `logsRoot` does not exist yet — a fresh checkout with no
 * `_logs/` at all is not a violation of anything.
 */
export function listInitDirs(logsRoot) {
  if (!existsSync(logsRoot)) return new Set();
  return new Set(
    readdirSync(logsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(INIT_DIR_PREFIX))
      .map((entry) => entry.name),
  );
}

/**
 * The names present in `after` but absent from `before`, sorted for a
 * deterministic report. Order-independent inputs (both are `Set`s) so two
 * callers snapshotting the same directory can never disagree over ordering.
 */
export function newInitDirs(before, after) {
  return [...after].filter((name) => !before.has(name)).sort();
}
