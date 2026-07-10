/**
 * N6 (plan 2.8) — post-merge CI watch primitives in pr.ts.
 *
 * After a cycle's PR merges, forge used to walk away — a post-merge CI
 * failure on main went unseen (the betterado run shipped broken main for a
 * day). `watchPostMergeCi` polls the merged commit's GitHub Actions runs via
 * `gh`, bounded by a config-driven timeout, and reports a structured
 * outcome the closure phase turns into `cycle.post-merge-ci` events.
 *
 * gh is mocked with a PATH shim (same pattern as pr.test.ts) — a stateful
 * node script that serves canned JSON per invocation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { evaluateCiRuns, watchPostMergeCi, type CiRun } from './pr.ts';

const run = (over: Partial<CiRun>): CiRun => ({
  name: 'CI',
  status: 'completed',
  conclusion: 'success',
  url: 'https://github.com/o/r/actions/runs/1',
  databaseId: 1,
  ...over,
});

// ---------------------------------------------------------------------------
// evaluateCiRuns — pure verdict over a run list
// ---------------------------------------------------------------------------

test('evaluateCiRuns: all completed green (success/neutral/skipped) → green', () => {
  const v = evaluateCiRuns([
    run({ conclusion: 'success' }),
    run({ name: 'lint', conclusion: 'neutral', databaseId: 2 }),
    run({ name: 'docs', conclusion: 'skipped', databaseId: 3 }),
  ]);
  assert.equal(v.verdict, 'green');
});

test('evaluateCiRuns: any completed failure → red with the failing runs', () => {
  const v = evaluateCiRuns([
    run({ conclusion: 'success' }),
    run({ name: 'test', conclusion: 'failure', url: 'https://github.com/o/r/actions/runs/9', databaseId: 9 }),
  ]);
  assert.equal(v.verdict, 'red');
  if (v.verdict === 'red') {
    assert.equal(v.failing.length, 1);
    assert.equal(v.failing[0]!.name, 'test');
  }
});

test('evaluateCiRuns: in-progress runs → pending (even alongside green ones)', () => {
  const v = evaluateCiRuns([
    run({ conclusion: 'success' }),
    run({ name: 'acc', status: 'in_progress', conclusion: null, databaseId: 4 }),
  ]);
  assert.equal(v.verdict, 'pending');
});

test('evaluateCiRuns: a red verdict beats pending (fail fast on the first red run)', () => {
  const v = evaluateCiRuns([
    run({ name: 'slow', status: 'queued', conclusion: null }),
    run({ name: 'test', conclusion: 'timed_out', databaseId: 5 }),
  ]);
  assert.equal(v.verdict, 'red');
});

test('evaluateCiRuns: empty run list → pending (no signal yet)', () => {
  assert.equal(evaluateCiRuns([]).verdict, 'pending');
});

// ---------------------------------------------------------------------------
// watchPostMergeCi — bounded poll loop against a gh shim
// ---------------------------------------------------------------------------

/**
 * Install a stateful `gh` shim. `runsSeq` is served per `gh run list` call
 * (last entry repeats). Returns a restore function.
 */
function withGhShim(opts: {
  mergeSha?: string | null;
  workflows?: unknown[] | 'error';
  runsSeq?: unknown[][];
  jobs?: unknown[];
}): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'n6-gh-'));
  writeFileSync(join(dir, 'merge-sha'), opts.mergeSha ?? '');
  writeFileSync(join(dir, 'workflows.json'), opts.workflows === 'error' ? 'ERROR' : JSON.stringify(opts.workflows ?? [{ id: 1 }]));
  writeFileSync(join(dir, 'runs-seq.json'), JSON.stringify(opts.runsSeq ?? [[]]));
  writeFileSync(join(dir, 'jobs.json'), JSON.stringify({ jobs: opts.jobs ?? [] }));
  const shim = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const dir = ${JSON.stringify(dir)};
const a = process.argv.slice(2);
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
if (a[0] === 'pr' && a[1] === 'view') {
  const sha = read('merge-sha').trim();
  if (!sha) { process.stderr.write('no merged pr\\n'); process.exit(1); }
  console.log(JSON.stringify({ mergeCommit: { oid: sha } }));
  process.exit(0);
}
if (a[0] === 'workflow' && a[1] === 'list') {
  const w = read('workflows.json');
  if (w === 'ERROR') { process.stderr.write('workflow list failed\\n'); process.exit(1); }
  console.log(w);
  process.exit(0);
}
if (a[0] === 'run' && a[1] === 'list') {
  const countPath = path.join(dir, 'count');
  const n = fs.existsSync(countPath) ? Number(fs.readFileSync(countPath, 'utf8')) : 0;
  fs.writeFileSync(countPath, String(n + 1));
  const seq = JSON.parse(read('runs-seq.json'));
  console.log(JSON.stringify(seq[Math.min(n, seq.length - 1)]));
  process.exit(0);
}
if (a[0] === 'run' && a[1] === 'view') {
  console.log(read('jobs.json'));
  process.exit(0);
}
process.stderr.write('unsupported: ' + a.join(' ') + '\\n');
process.exit(1);
`;
  writeFileSync(join(dir, 'gh'), shim);
  chmodSync(join(dir, 'gh'), 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}:${oldPath}`;
  return () => {
    process.env.PATH = oldPath;
  };
}

const FAST = { timeoutMs: 3_000, pollIntervalMs: 5 };

test('watchPostMergeCi: pending then all green → green with run names', async () => {
  const restore = withGhShim({
    mergeSha: 'abc123',
    runsSeq: [
      [{ name: 'CI', status: 'in_progress', conclusion: null, url: 'https://x/1', databaseId: 1 }],
      [{ name: 'CI', status: 'completed', conclusion: 'success', url: 'https://x/1', databaseId: 1 }],
    ],
  });
  try {
    const o = await watchPostMergeCi('.', FAST);
    assert.equal(o.status, 'green');
    if (o.status === 'green') {
      assert.equal(o.sha, 'abc123');
      assert.equal(o.runs[0]!.name, 'CI');
    }
  } finally {
    restore();
  }
});

test('watchPostMergeCi: red run → red with run link + failing job names', async () => {
  const restore = withGhShim({
    mergeSha: 'abc123',
    runsSeq: [
      [{ name: 'CI', status: 'completed', conclusion: 'failure', url: 'https://x/9', databaseId: 9 }],
    ],
    jobs: [
      { name: 'build', conclusion: 'success' },
      { name: 'acc-tests', conclusion: 'failure' },
    ],
  });
  try {
    const o = await watchPostMergeCi('.', FAST);
    assert.equal(o.status, 'red');
    if (o.status === 'red') {
      assert.equal(o.failing[0]!.url, 'https://x/9');
      assert.deepEqual(o.failing[0]!.failing_jobs, ['acc-tests']);
    }
  } finally {
    restore();
  }
});

test('watchPostMergeCi: repo with no workflows → no-ci immediately (no polling)', async () => {
  const restore = withGhShim({ mergeSha: 'abc123', workflows: [] });
  try {
    const o = await watchPostMergeCi('.', FAST);
    assert.equal(o.status, 'no-ci');
  } finally {
    restore();
  }
});

test('watchPostMergeCi: workflows exist but no runs ever appear for the commit → no-ci at deadline', async () => {
  const restore = withGhShim({ mergeSha: 'abc123', runsSeq: [[]] });
  try {
    const o = await watchPostMergeCi('.', { timeoutMs: 60, pollIntervalMs: 5 });
    assert.equal(o.status, 'no-ci');
  } finally {
    restore();
  }
});

test('watchPostMergeCi: runs still in progress at the deadline → timeout with pending run names', async () => {
  const restore = withGhShim({
    mergeSha: 'abc123',
    runsSeq: [[{ name: 'acc', status: 'in_progress', conclusion: null, url: 'https://x/2', databaseId: 2 }]],
  });
  try {
    const o = await watchPostMergeCi('.', { timeoutMs: 60, pollIntervalMs: 5 });
    assert.equal(o.status, 'timeout');
    if (o.status === 'timeout') assert.deepEqual(o.pending, ['acc']);
  } finally {
    restore();
  }
});

test('watchPostMergeCi: merged commit sha unresolvable (gh error) → unavailable, no polling', async () => {
  const restore = withGhShim({ mergeSha: null });
  try {
    const o = await watchPostMergeCi('.', FAST);
    assert.equal(o.status, 'unavailable');
  } finally {
    restore();
  }
});
