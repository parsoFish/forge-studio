/**
 * Preload — `node --import=./scripts/test-preload/logs-residue-guard.mjs`
 * (wired into package.json's `test` script as a second `--import`, alongside
 * this directory's other preload — loaded before every test file `npm test`
 * runs).
 *
 * forge-8vfn.8.1.10 — fails the suite (non-zero exit, naming the new dirs)
 * if any test run leaves a fresh `INIT-*` directory under THIS repo's own
 * `_logs/`, the residue shape a tmpdir-harness test must never produce.
 *
 * forge-8vfn.8.5.48 (row 212) — the same fate for a fresh `_bridge-*`
 * directory: `startBridge()` opens one under `forgeRoot/_logs` on every boot
 * (`bridgeCycleId`, `packages/kernel/logging.ts`), so a test that boots the
 * bridge with `forgeRoot` pointed at THIS checkout instead of a caller-owned
 * tmp root leaves the same class of residue, one prefix over.
 *
 * forge-8vfn.8.5.48 (row 212 FOLLOW-UP) — a full `npm test` run at 887dc58da
 * (11028/11028 green, both named guards above silent) still left two new
 * top-level `_logs/` entries neither prefix covers (a demo-builder fixture's
 * `_demo-<sid>/` and a CLI-spawning test's `preflight/verdicts.jsonl`) — see
 * `logs-residue-guard-core.mjs`'s module doc's third defect. A per-prefix
 * guard only ever knows the defects someone already found, so this file now
 * ALSO snapshots every top-level `_logs/` entry, named-prefix or not, and
 * reports anything new that the two specific guards above didn't already
 * name — the generalised ratchet, additive to (not a replacement for) them.
 *
 * See `logs-residue-guard-core.mjs`'s module doc for all three defects and
 * the before/after design; this file is only the wiring of that pure logic
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
import { listInitDirs, listBridgeDirs, listTopLevelEntries, newInitDirs } from './logs-residue-guard-core.mjs';

// This file's own location, not `process.cwd()` (T1 ruling 101's reasoning,
// `createLogger`'s doc): `npm test` always runs from the repo root today, but
// a preload that trusted the cwd would silently mis-root the moment that
// stopped being true, and there is no reason this constant needs a caller at
// all — it names ITS OWN repo unconditionally.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOGS_ROOT = join(REPO_ROOT, '_logs');

const initBefore = listInitDirs(LOGS_ROOT);
const bridgeBefore = listBridgeDirs(LOGS_ROOT);
const allBefore = listTopLevelEntries(LOGS_ROOT);

process.on('exit', () => {
  const newInit = newInitDirs(initBefore, listInitDirs(LOGS_ROOT));
  const newBridge = newInitDirs(bridgeBefore, listBridgeDirs(LOGS_ROOT));
  // The generalised ratchet (row 212 follow-up) — everything new, minus
  // whatever the two named guards above already explained, so a `_bridge-*`
  // or `INIT-*` residue is reported ONCE, by its own precise message, not
  // twice over with a second, vaguer one.
  const named = new Set([...newInit, ...newBridge]);
  const newOther = newInitDirs(allBefore, listTopLevelEntries(LOGS_ROOT)).filter((name) => !named.has(name));
  if (newInit.length === 0 && newBridge.length === 0 && newOther.length === 0) return;
  // Setting `process.exitCode` inside an `exit` listener is the documented
  // way to fail late, after every test in this process has already reported
  // — Node reads `process.exitCode` once every `exit` listener has run, not
  // before. Never `process.exit()` here: that would terminate synchronously
  // mid-listener and could cut off another `exit` listener's own cleanup
  // (e.g. a sibling fixture's `rmSync` in a `finally`/`after`).
  process.exitCode = 1;
  if (newInit.length > 0) {
    process.stderr.write(
      `\nlogs-residue-guard: this test run created ${newInit.length} new _logs/INIT-* ` +
        `dir(s) under the REPO ROOT (${LOGS_ROOT}) rather than a caller-owned tmp logs dir: ` +
        `${newInit.join(', ')}\n` +
        'A test exercising `runAgent` (or anything that calls it through `lifecycle: ' +
        "'caller'` — `runProjectManager`, `runAdversarialReview`, `runReflectorBrainWrites`) " +
        'must pass its own tmp-rooted `logger` (or `logsRoot`) into the call so the spawn ' +
        "marker lands in the harness's own tmp dir, never the repo's. See " +
        "packages/agents/run-agent.ts's `logsRootFromLogger`.\n",
    );
  }
  if (newBridge.length > 0) {
    process.stderr.write(
      `\nlogs-residue-guard: this test run created ${newBridge.length} new _logs/_bridge-* ` +
        `dir(s) under the REPO ROOT (${LOGS_ROOT}) rather than a caller-owned tmp forgeRoot: ` +
        `${newBridge.join(', ')}\n` +
        'A test calling `startBridge({ forgeRoot })` must point `forgeRoot` at a ' +
        "tmpdir (`mkdtempSync(join(tmpdir(), '...'))`) seeded with only the fixtures " +
        "it needs, never this checkout's own root or `process.cwd()` — `startBridge` " +
        'installs the ref-guard hook AND opens its own `_bridge-*` log run at `forgeRoot` ' +
        'on every boot (row 211/212, bead forge-8vfn.8.5.47 / .48). See ' +
        'apps/forge/tests/integration/bridge-studio-write.test.ts for the established ' +
        'tmp-root + copy-only-what-you-need idiom.\n',
    );
  }
  if (newOther.length > 0) {
    process.stderr.write(
      `\nlogs-residue-guard: this test run created ${newOther.length} new _logs/ ` +
        `entr${newOther.length === 1 ? 'y' : 'ies'} under the REPO ROOT (${LOGS_ROOT}) that neither ` +
        `the INIT-* nor the _bridge-* guard already explains: ${newOther.join(', ')}\n` +
        'This is the generalised ratchet (row 212 follow-up, bead forge-8vfn.8.5.48): ' +
        'ANY new top-level _logs/ entry a test file leaves is residue, not only the two ' +
        'named shapes above. Known root causes so far — a call that defaults its ' +
        "`logsRoot` from a real `forgeRoot: FORGE_ROOT` instead of passing its own tmp " +
        "`logsRoot` (packages/sessions/kinds/kind-turn.ts's `input.logsRoot ?? " +
        'resolve(forgeRoot, \'_logs\')`), and a CLI command that hard-codes its own log ' +
        "path off FORGE_ROOT with no override (apps/forge/cli.ts's `cmdPreflight`). " +
        'Trace what wrote this entry and give it its own caller-owned tmp root; do not ' +
        'allow-list the name here — see the module doc\'s "WHY NO ALLOWLIST".\n',
    );
  }
});
