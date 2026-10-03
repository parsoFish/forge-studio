/**
 * Row 212 follow-up (bead forge-8vfn.8.5.48) — a test-side fence around
 * `apps/forge/cli.ts`'s `cmdPreflight` verdict-audit write.
 *
 * WHY A TEST-SIDE FENCE, NOT A PRODUCT ESCAPE HATCH. `cmdPreflight` appends
 * one JSONL line to `<FORGE_ROOT>/_logs/preflight/verdicts.jsonl` on every
 * `forge preflight` run, and `FORGE_ROOT` (`resolve(import.meta.dirname, '..',
 * '..')`) is intentionally non-overridable — `cli-own-tree.test.ts`'s D2 is
 * the regression test FOR that exact design (`forge` must always operate on
 * its own install, whatever `cwd`/`FORGE_PROJECTS_DIR` says). A product-side
 * env override that redirects only this ONE write path, while every other
 * forge log write still resolves off `<forgeRoot>/_logs` directly, is an
 * inconsistent config surface added for tests alone — the kind of flag
 * CLAUDE.md forbids. `cli-own-tree.test.ts` (D1) and `cli-preflight-deps
 * .test.ts` spawn the REAL `cli.ts` against the REAL checkout ON PURPOSE, so
 * the fix belongs in the tests: record what was there before the spawn, let
 * it write wherever `cmdPreflight` actually writes, then put it back.
 *
 * THE THREE STATES, AND WHY EACH RESTORE IS WHAT IT IS.
 *   `absent`   — `_logs/preflight/` did not exist before the spawn. The spawn
 *                created it (and `verdicts.jsonl` inside it) from nothing, so
 *                restoring means removing the whole directory the spawn
 *                created — nothing of the operator's was there to protect.
 *   `dir-only` — the directory existed (perhaps from an earlier real
 *                `forge preflight` run whose file was since rotated away) but
 *                `verdicts.jsonl` itself did not. Restoring means removing
 *                only the file the spawn appended into existence, leaving the
 *                directory exactly as found.
 *   `file`     — `verdicts.jsonl` already existed, carrying real operator
 *                verdict history. `cmdPreflight` only ever APPENDS
 *                (`appendFileSync`), so the file's first N bytes — N being
 *                its length at snapshot time — are byte-identical before and
 *                after the spawn; truncating back to that length keeps every
 *                pre-existing line and drops only what this test's spawn
 *                appended. This is the one state real operator use actually
 *                produces, and the one this fence exists to protect.
 *
 * PURE ON PURPOSE (same discipline as `logs-residue-guard-core.mjs` and
 * `interactive-runner-log-observer.ts`): no import-time I/O, and every
 * function takes the `preflightDir` it operates on as an explicit argument —
 * so a unit test drives all three states against a throwaway `mkdtempSync`
 * directory, never the real `_logs/preflight/`. Its own tests live in
 * `apps/forge/tests/regression/preflight-verdicts-fence.test.ts`, the same
 * "subject gets its own test file" convention `interactive-runner-log
 * -observer.ts` already established in this directory.
 */
import { existsSync, rmSync, statSync, truncateSync } from 'node:fs';
import { join } from 'node:path';

export const PREFLIGHT_VERDICTS_FILENAME = 'verdicts.jsonl';

export type PreflightVerdictsSnapshot =
  | { kind: 'absent' }
  | { kind: 'dir-only' }
  | { kind: 'file'; length: number };

/**
 * Record the state of `preflightDir` (a `_logs/preflight` directory, real or
 * throwaway) before a `forge preflight` spawn — see the module doc for what
 * each of the three states means and how `restorePreflightVerdicts` undoes
 * only what the spawn actually added.
 */
export function snapshotPreflightVerdicts(preflightDir: string): PreflightVerdictsSnapshot {
  if (!existsSync(preflightDir)) return { kind: 'absent' };
  const file = join(preflightDir, PREFLIGHT_VERDICTS_FILENAME);
  if (!existsSync(file)) return { kind: 'dir-only' };
  return { kind: 'file', length: statSync(file).size };
}

/**
 * Put `preflightDir` back exactly as `snapshot` recorded it — the inverse of
 * `snapshotPreflightVerdicts`, run in the caller's `finally` after the spawn
 * under test has had its chance to write.
 */
export function restorePreflightVerdicts(preflightDir: string, snapshot: PreflightVerdictsSnapshot): void {
  switch (snapshot.kind) {
    case 'absent':
      rmSync(preflightDir, { recursive: true, force: true });
      return;
    case 'dir-only':
      rmSync(join(preflightDir, PREFLIGHT_VERDICTS_FILENAME), { force: true });
      return;
    case 'file':
      truncateSync(join(preflightDir, PREFLIGHT_VERDICTS_FILENAME), snapshot.length);
      return;
  }
}

/**
 * Snapshot `preflightDir`, run `fn`, then restore — the whole fence in one
 * call for the common case (a synchronous `spawnSync` under test). `mkdirSync`
 * is NOT called here: `cmdPreflight` itself creates `preflightDir` if it is
 * missing, and creating it ourselves would silently turn an `absent` snapshot
 * into a `dir-only` one before the spawn ever runs.
 */
export function withPreflightVerdictsFence<T>(preflightDir: string, fn: () => T): T {
  const snapshot = snapshotPreflightVerdicts(preflightDir);
  try {
    return fn();
  } finally {
    restorePreflightVerdicts(preflightDir, snapshot);
  }
}
