/**
 * Preload — `node --import=./scripts/test-preload/logs-residue-guard.mjs`
 * (wired into package.json's `test` script as a second `--import`, alongside
 * this directory's other preload — loaded before every test file `npm test`
 * runs).
 *
 * forge-8vfn.8.1.10 — fails the suite (non-zero exit, naming the new dirs)
 * if any test run leaves a fresh `INIT-*` directory under THIS repo's own
 * `_logs/`, the residue shape a tmpdir-harness test must never produce. See
 * `logs-residue-guard-core.mjs`'s module doc for the defect and the
 * before/after design; this file is only the wiring of that pure logic
 * against the real repo root — the decision logic itself lives there and is
 * unit-tested there (against a throwaway root, never this file's `LOGS_ROOT`).
 *
 * `node --test` isolates test files into separate subprocesses by default,
 * so THIS preload is re-imported once per test-file process — each process
 * takes its own before-snapshot at its own start and checks it at its own
 * `exit`, which still catches residue created within that file's run: the
 * defect this exists for (a test file creating a dir during its OWN tests)
 * always falls within its own process's before/after window. Measured
 * (2026-09-26): a residue created inside one test file's process is reported
 * by that file's own exit handler, non-zero exit code included, and `node
 * --test` surfaces a child's unexpected non-zero exit as a suite failure —
 * so this needs no extra wiring to fail `npm test` overall.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listInitDirs, newInitDirs } from './logs-residue-guard-core.mjs';

// This file's own location, not `process.cwd()` (T1 ruling 101's reasoning,
// `createLogger`'s doc): `npm test` always runs from the repo root today, but
// a preload that trusted the cwd would silently mis-root the moment that
// stopped being true, and there is no reason this constant needs a caller at
// all — it names ITS OWN repo unconditionally.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOGS_ROOT = join(REPO_ROOT, '_logs');

const before = listInitDirs(LOGS_ROOT);

process.on('exit', () => {
  const created = newInitDirs(before, listInitDirs(LOGS_ROOT));
  if (created.length === 0) return;
  // Setting `process.exitCode` inside an `exit` listener is the documented
  // way to fail late, after every test in this process has already reported
  // — Node reads `process.exitCode` once every `exit` listener has run, not
  // before. Never `process.exit()` here: that would terminate synchronously
  // mid-listener and could cut off another `exit` listener's own cleanup
  // (e.g. a sibling fixture's `rmSync` in a `finally`/`after`).
  process.exitCode = 1;
  process.stderr.write(
    `\nlogs-residue-guard: this test run created ${created.length} new _logs/INIT-* ` +
      `dir(s) under the REPO ROOT (${LOGS_ROOT}) rather than a caller-owned tmp logs dir: ` +
      `${created.join(', ')}\n` +
      'A test exercising `runAgent` (or anything that calls it through `lifecycle: ' +
      "'caller'` — `runProjectManager`, `runAdversarialReview`, `runReflectorBrainWrites`) " +
      'must pass its own tmp-rooted `logger` (or `logsRoot`) into the call so the spawn ' +
      "marker lands in the harness's own tmp dir, never the repo's. See " +
      "packages/agents/run-agent.ts's `logsRootFromLogger`.\n",
  );
});
