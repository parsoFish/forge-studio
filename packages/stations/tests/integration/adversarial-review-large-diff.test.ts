/**
 * forge-nk1y.39 — the adversarial review on a LARGE branch diff.
 *
 * Measured on gitweave I3a round 3 (`39f76ac` vs `main`): 109 changed files, 66
 * of them git-binary demo captures (`.webm` / `.png`), and the orchestrated
 * demo bundle's `demo.json` alone was 1,203,956 bytes of TEXT diff — past
 * `execFileSync`'s default 1 MiB `maxBuffer`, so the `unattributed` chunk's
 * derivation died `spawnSync git ENOBUFS`, the cycle was classified terminal,
 * and the verdict gate kept showing round 2's findings as if they were current.
 *
 * This fixture reproduces that SHAPE: ≥100 changed files, 66 binaries, a
 * >1.2 MB single-line-heavy `demo/<init>/demo.json`, and a 1.5 MB text file no
 * work item claims (so the buffer bound itself is exercised — the demo bundle
 * and the binaries are excluded from content derivation, the big text file is
 * not).
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { reviewFindingsJsonPath, reviewOutcomeJsonPath } from '@forge/flows';

import {
  CYCLE_ID, INIT_ID, collectLogger, makeFixture, run, stubQueryFn, validFindingsJson, withoutSpawnSuppressionEnv,
  type Fixture,
} from '../test-fixtures/adversarial-review-fixture.ts';

const BINARIES = 66;
const TEXT_FILES = 35;

/** Deterministic bytes with NULs, so git classifies every one as binary. */
function binaryBytes(seed: number, size: number): Buffer {
  const b = Buffer.alloc(size);
  let x = seed * 2654435761 >>> 0;
  for (let i = 0; i < size; i += 1) {
    x = (x * 1103515245 + 12345) >>> 0;
    b[i] = i % 97 === 0 ? 0 : x & 0xff;
  }
  return b;
}

/** Commit the I3a-shaped bulk on top of the fixture's feature branch. */
function addLargeDiff(fx: Fixture): { binaries: string[]; demoFiles: string[]; bigText: string } {
  const capDir = join('demo', INIT_ID, '.capture', 'after');
  mkdirSync(join(fx.worktree, capDir), { recursive: true });
  mkdirSync(join(fx.worktree, 'media'), { recursive: true });
  const binaries: string[] = [];
  for (let i = 0; i < BINARIES; i += 1) {
    // Half inside the demo bundle (orchestrated captures), half outside it
    // (a binary a work item could have committed) — both are binary.
    const rel = i % 2 === 0 ? join(capDir, `frame-${i}.png`) : join('media', `clip-${i}.webm`);
    writeFileSync(join(fx.worktree, rel), binaryBytes(i + 1, 4096));
    binaries.push(rel);
  }
  // The demo bundle's structured demo: ~1.3 MB on a few very long lines.
  const longLine = 'x'.repeat(320_000);
  writeFileSync(join(fx.worktree, 'demo', INIT_ID, 'demo.json'), JSON.stringify({ frames: [longLine, longLine, longLine, longLine] }, null, 1));
  writeFileSync(join(fx.worktree, 'demo', INIT_ID, 'DEMO.md'), '# Demo\n\nnarrative\n');
  for (let i = 0; i < TEXT_FILES; i += 1) {
    writeFileSync(join(fx.worktree, `mod-${i}.ts`), `export const m${i} = ${i};\n`);
  }
  // A large TEXT file no work item claims: derived for review, so only an
  // explicit, bounded maxBuffer lets the unattributed chunk derive at all.
  const bigText = 'vendor-lock.txt';
  writeFileSync(join(fx.worktree, bigText), Array.from({ length: 30_000 }, (_, i) => `line ${i} ${'y'.repeat(40)}`).join('\n') + '\n');
  fx.git(['add', '-A']);
  fx.git(['commit', '-q', '-m', 'chore(demo): orchestrated demo capture + bulk']);
  const demoFiles = fx.git(['diff', '--name-only', 'main...HEAD', '--', join('demo', INIT_ID)])
    .trim().split('\n').filter((p) => p !== '' && !binaries.includes(p));
  return { binaries, demoFiles, bigText };
}

test('forge-nk1y.39: an I3a-shaped diff (≥100 files, 66 binaries, 1.3 MB demo.json, 1.5 MB text) is reviewed to completion; binaries and the demo bundle are named, not reviewed', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { binaries, demoFiles, bigText } = addLargeDiff(fx);
    const changed = fx.git(['diff', '--name-only', 'main...HEAD']).trim().split('\n');
    assert.ok(changed.length >= 100, `fixture must reproduce the ≥100-file shape (got ${changed.length})`);
    const demoDiffBytes = execFileSync('git', ['diff', 'main...HEAD', '--', join('demo', INIT_ID, 'demo.json')], {
      cwd: fx.worktree, maxBuffer: 64 * 1024 * 1024,
    }).length;
    assert.ok(demoDiffBytes > 1024 * 1024, `demo.json diff must exceed the 1 MiB default buffer (got ${demoDiffBytes})`);

    const { logger, events } = collectLogger(fx.logsRoot);
    const prompts: string[] = [];
    const qf = stubQueryFn([
      (prompt) => writeFileSync(join(fx.worktree, '.forge', 'review-findings.json'), validFindingsJson(prompt)),
    ], prompts);
    const res = await run(fx, qf, logger);

    assert.equal(res.status, 'complete', `review must complete, got ${JSON.stringify(res)}`);
    assert.ok(!events.some((e) => e.message === 'review.input.derive-error'), 'no derivation error');

    const rec = JSON.parse(readFileSync(reviewFindingsJsonPath(fx.logsRoot, CYCLE_ID), 'utf8')) as {
      notReviewed?: Array<{ path: string; reason: string }>;
    };
    const named = new Map((rec.notReviewed ?? []).map((n) => [n.path, n.reason]));
    for (const b of binaries) assert.equal(named.get(b), 'binary', `${b} named as binary, not reviewed`);
    for (const d of demoFiles) assert.equal(named.get(d), 'demo-bundle', `${d} named as the orchestrator's demo bundle, not reviewed`);
    assert.ok(!named.has(bigText), 'a large TEXT file is still reviewed — size alone never excludes');

    // Never shown to the agent: no excluded path in any briefing.
    const briefing = prompts.join('\n');
    for (const p of [...binaries, ...demoFiles]) assert.ok(!briefing.includes(p), `${p} must not be briefed`);
    assert.ok(briefing.includes(bigText), 'the large text file is briefed');

    const excluded = events.find((e) => e.message === 'review.input.excluded');
    assert.ok(excluded, 'the exclusion is evented');
    const md = excluded!.metadata as Record<string, unknown>;
    assert.equal(md.binary, binaries.length);
    assert.equal(md.demo_bundle, demoFiles.length);

    const outcome = JSON.parse(readFileSync(reviewOutcomeJsonPath(fx.logsRoot, CYCLE_ID), 'utf8')) as Record<string, unknown>;
    assert.equal(outcome.status, 'complete');
    assert.equal(outcome.headSha, fx.git(['rev-parse', 'HEAD']).trim());
  } finally {
    fx.cleanup();
    restore();
  }
});

test('forge-nk1y.39 refusal path: a derivation failure records a FAILED outcome at the head it ran at — never a complete one, never silence', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    // `main` gone locally → `git diff main...HEAD` cannot run. No queryFn
    // stub writes anything: a broken refusal cannot reach a real spawn.
    fx.git(['update-ref', '-d', 'refs/heads/main']);
    fx.git(['update-ref', '-d', 'refs/remotes/origin/main']);
    const { logger } = collectLogger(fx.logsRoot);
    const qf = stubQueryFn([() => { throw new Error('a refused review must never spawn'); }]);
    const res = await run(fx, qf, logger);
    assert.equal(res.status, 'failed');
    assert.equal((res as { reason: string }).reason, 'derive-failed');
    const outcome = JSON.parse(readFileSync(reviewOutcomeJsonPath(fx.logsRoot, CYCLE_ID), 'utf8')) as Record<string, unknown>;
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.reason, 'derive-failed');
    assert.equal(outcome.headSha, fx.git(['rev-parse', 'HEAD']).trim());
    assert.match(String(outcome.detail), /git derivation error/);
  } finally {
    fx.cleanup();
    restore();
  }
});
