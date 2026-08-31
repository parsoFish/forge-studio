/**
 * ACCEPTANCE TESTS (T3, M0-A fix round 2, Defect A — RE-AIMED) — every merged
 * cycle loses its reflection.
 *
 * T1's confirmed ruling (round 2 of this defect): the fix site is
 * `orchestrator/phases/reflector.ts`'s `resolveCurrentManifestPath` (~line
 * 793), called at ~line 162. Its candidate list is a HAND-WRITTEN SUBSET of
 * the queue's states — `done`, `ready-for-review`, `failed` — and the one it
 * omits is `merged/`, which is exactly where closure has put the manifest
 * when reflection fires (the `merged/ → done/` promotion happens AFTER the
 * reflect dispatch — see `finalize-merged.ts`'s `promoteMergedToDoneFn` call,
 * which runs after `fireFlowTriggers`). The resolver runs, matches nothing,
 * falls through to `return originalPath`, and the reflector ENOENTs on
 * `_queue/in-flight/<id>.md` — the exact shape of run 1's real log:
 *
 *   reflection   reflector.start
 *   reflection   reflector.manifest-unreadable   {"error":"ENOENT: ... open
 *                '<root>/_queue/in-flight/INIT-....md'"}
 *   reflection   cycle.reflection-lost
 *
 * `finalize-merged.ts` passing its own original (in-flight) path to the
 * handler is BY DESIGN — that is the entire reason this resolver exists.
 * These tests therefore pin the resolver's contract directly, not what
 * `finalize-merged.ts` passes to a handler (see the deleted
 * `finalize-merged.reflect-manifest.test.ts`, replaced by this file).
 *
 * PIN THE CLASS, NOT THE INSTANCE: `orchestrator/queue.ts`'s `QueuePaths` /
 * `QueueState` declare SIX states (`pending | in-flight | ready-for-review |
 * merged | done | failed`). Rather than hand-listing a few of them (which is
 * exactly the shape of the bug — a hand-written subset that quietly omitted
 * one), the state-coverage battery below drives its cases from
 * `Object.keys(getPaths(...))` — the REAL runtime `QueuePaths` shape — so a
 * seventh state added to that object tomorrow is automatically included
 * here, not silently unexercised.
 *
 * `resolveCurrentManifestPath` is `function`, not `export function`, as of
 * this writing — the implementer is expected to export it. Resolved via a
 * dynamic `import()` (same technique used for defects B/C in
 * `scripts/verify-outcomes.test.ts`) so a not-yet-exported binding fails as
 * its own red "is not a function" assertion, not a whole-file `SyntaxError`
 * that would hide every other case in this file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { getPaths, type QueuePaths } from '@forge/flows/queue.ts';
import { runReflector } from './phases/reflector.ts';
import { createLogger } from '@forge/kernel';
import { REFLECTION_LOST_EVENT, type CycleInput } from '@forge/flows/cycle-context.ts';

// Dynamic import: `resolveCurrentManifestPath` is not exported today. If the
// export has not landed yet, every case below fails on its own
// "is not a function" TypeError — never a module-load SyntaxError that would
// mask other files' passing tests.
const { resolveCurrentManifestPath } = await import('./phases/reflector.ts');

const FILENAME_STEM = 'INIT-2026-08-28-manifest-resolve-test';
const FILENAME = `${FILENAME_STEM}.md`;

/**
 * The FULL runtime set of queue state keys, sourced from `getPaths()` itself
 * (no filesystem access — `getPaths` is pure path arithmetic), never a
 * hand-typed literal array. `root` is the queue root, not a manifest state.
 */
const QUEUE_STATE_KEYS: Array<keyof Omit<QueuePaths, 'root'>> = Object.keys(getPaths('/__unused__')).filter(
  (k) => k !== 'root',
) as Array<keyof Omit<QueuePaths, 'root'>>;

/** A fresh `<tmp>/_queue/{pending,in-flight,...}` scaffold, every state dir created. */
function scaffold(): { forgeRoot: string; paths: QueuePaths } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-manifest-resolve-'));
  const paths = getPaths(join(forgeRoot, '_queue'));
  for (const key of QUEUE_STATE_KEYS) mkdirSync(paths[key], { recursive: true });
  return { forgeRoot, paths };
}

// ---------------------------------------------------------------------------
// State-coverage battery: for EVERY queue state the manifest could currently
// be sitting in, the resolver must find it there. Driven by QUEUE_STATE_KEYS
// (all six), not a hand-picked subset — this is what makes the `merged`
// case red on today's code and would catch a future omission the same way.
// ---------------------------------------------------------------------------
for (const stateKey of QUEUE_STATE_KEYS) {
  test(`resolveCurrentManifestPath: a manifest currently sitting in queue state "${stateKey}" is found there`, () => {
    const { forgeRoot, paths } = scaffold();
    const targetDir = paths[stateKey];
    writeFileSync(join(targetDir, FILENAME), '---\ninitiative_id: X\n---\nbody');
    // The ORIGINAL path handed to the resolver is always the in-flight claim
    // path (what `finalize-merged.ts` threads through) — for stateKey ===
    // 'inFlight' this equals the manifest's actual current location (the
    // resolver's own fast path); for every other state it is stale by design.
    const originalPath = join(paths.inFlight, FILENAME);
    const result = resolveCurrentManifestPath(originalPath, forgeRoot);
    const expected = join(targetDir, FILENAME);
    assert.equal(
      result,
      expected,
      `expected the resolver to find the manifest in "${stateKey}" (${expected}), got ${result}`,
    );
  });
}

test('resolveCurrentManifestPath: genuinely absent from every queue state — returns the original path unchanged (never fabricates a location)', () => {
  const { forgeRoot, paths } = scaffold(); // every state dir exists, but empty
  const originalPath = join(paths.inFlight, FILENAME);
  const result = resolveCurrentManifestPath(originalPath, forgeRoot);
  assert.equal(result, originalPath);
});

// ---------------------------------------------------------------------------
// Caller loud-loss regression guard (bullet 4): when resolution genuinely
// fails, the EXISTING manifest-unreadable → cycle.reflection-lost mechanism
// in `runReflector` (orchestrator/phases/reflector.ts ~line 171-198) must
// still fire. This calls the REAL `runReflector` (not a stub) — safe because
// an unreadable manifest is caught before any SDK/agent call is ever made
// (the read+parse happens first; the catch returns early). `runReflector`
// hardcodes `forgeRoot` from its own module location
// (`resolve(import.meta.dirname, '..', '..')`), so this test can't inject a
// scratch forgeRoot — it uses a manifest id distinctive enough that it is
// guaranteed absent from every real queue directory, and writes its own
// event log to a scratch `logsRoot` so nothing touches the real repo's
// `_logs/`.
// ---------------------------------------------------------------------------
const REAL_FORGE_ROOT = resolve(import.meta.dirname, '..');

test('runReflector (real function, no agent invoked): a manifest genuinely gone from every queue state still records cycle.reflection-lost LOUDLY, never silently', async () => {
  const fakeId = `INIT-2026-08-28-t3-genuinely-absent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const fakeManifestPath = join(REAL_FORGE_ROOT, '_queue', 'in-flight', `${fakeId}.md`);
  // Defensive: this id is manufactured to be absent everywhere real; confirm
  // that before trusting the rest of the assertions below.
  for (const stateDir of ['pending', 'in-flight', 'ready-for-review', 'merged', 'done', 'failed']) {
    assert.ok(
      !existsSync(join(REAL_FORGE_ROOT, '_queue', stateDir, `${fakeId}.md`)),
      'test-setup bug: the manufactured fake id unexpectedly collides with a real manifest',
    );
  }

  const logsRoot = mkdtempSync(join(tmpdir(), 'forge-manifest-resolve-logs-'));
  const cycleId = 'T3-GENUINELY-ABSENT-TEST';
  const logger = createLogger(cycleId, logsRoot);
  const input: CycleInput = {
    initiativeId: fakeId,
    manifestPath: fakeManifestPath,
    projectRepoPath: '',
    worktreePath: '',
  };

  const result = await runReflector(input, logger);
  assert.equal(result.reflection_status, 'failed');
  assert.equal(result.lint_status, 'skipped');

  const events = readFileSync(logger.logFilePath, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

  const unreadable = events.find((e) => e.message === 'reflector.manifest-unreadable');
  assert.ok(unreadable, `expected reflector.manifest-unreadable; got messages: ${JSON.stringify(events.map((e) => e.message))}`);

  const lost = events.find((e) => e.message === REFLECTION_LOST_EVENT);
  assert.ok(lost, `expected a loud ${REFLECTION_LOST_EVENT}; got messages: ${JSON.stringify(events.map((e) => e.message))}`);
  assert.equal(lost.metadata?.cause, 'manifest-unreadable');
  assert.equal(typeof lost.metadata?.detail, 'string');
});
