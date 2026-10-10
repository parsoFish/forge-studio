/**
 * Bead forge-mfv5.1.25 — the Kickoff gate on the EXACT stranded shape (a
 * forge-architect cycle whose `cycle.end` says `ready-for-review`, five pending
 * WIs, plan present), and the refusal on every "already built" variant.
 *
 * The run model is the one place `awaitingKickoff` is derived; the develop
 * enqueue refuses a built manifest by name through the same fact reader.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { aggregateRun } from '../../run-model.ts';
import { enqueueDevelopRun } from '../../enqueue-develop-run.ts';
import { parseManifest } from '../../manifest.ts';
import {
  plantStrandedKickoff, STRANDED_INIT, STRANDED_CYCLE, STRANDED_WI_COUNT, STRANDED_BUILT_CASES, type StrandedBuilt,
} from '../test-fixtures/stranded-kickoff.ts';

const NOW = Date.parse('2026-10-10T00:00:00.000Z');

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'forge-kickoff-gate-'));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function runFor(root: string, manifestPath: string) {
  return aggregateRun({ root, queueState: 'ready-for-review', manifestPath, nowMs: NOW });
}

function branchRepo(root: string): string {
  const dir = join(root, 'repo');
  const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git(['commit', '-q', '-m', 'base']);
  git(['checkout', '-q', '-b', `forge/${STRANDED_INIT}`]);
  writeFileSync(join(dir, 'b.txt'), 'built\n');
  git(['add', 'b.txt']);
  git(['commit', '-q', '-m', 'WI-1']);
  return dir;
}

test('stranded shape: the run awaits kickoff — Monitor note "Awaiting kickoff", never complete-dated', () => {
  withRoot((root) => {
    const { manifestPath } = plantStrandedKickoff(root);
    const run = runFor(root, manifestPath);
    assert.equal(run.awaitingKickoff, true);
    assert.equal(run.status, 'gated');
    assert.equal(run.gateNote, 'Awaiting kickoff');
    assert.equal(run.completedAt, undefined, 'a kickoff is not a completion — the roadmap must not count it merged');
  });
});

test('stranded shape: Start development is accepted and keeps the 5 WIs and the plan, with no re-plan', () => {
  withRoot((root) => {
    const { snapshotDir, planPath } = plantStrandedKickoff(root);
    const r = enqueueDevelopRun(STRANDED_INIT, { queueRoot: join(root, '_queue') });
    assert.equal(r.status, 'enqueued', r.detail);
    assert.equal(r.cycleId, STRANDED_CYCLE, 'the architect cycle id threads through (DEC-2)');
    const pending = parseManifest(readFileSync(join(root, '_queue', 'pending', `${STRANDED_INIT}.md`), 'utf8'));
    assert.equal(pending.flow_id, 'forge-develop');
    assert.equal(pending.resume_from, undefined, 'no resume_from: plan — the develop spine runs, not a re-plan');
    assert.equal(readdirSync(snapshotDir).filter((f) => f.startsWith('WI-')).length, STRANDED_WI_COUNT);
    assert.ok(existsSync(planPath));
  });
});

const BUILT: Array<[string, (root: string) => StrandedBuilt]> = [
  ...STRANDED_BUILT_CASES.map((c): [string, (root: string) => StrandedBuilt] => [c, () => c]),
  ['branch-commits', (root) => ({ branchRepo: branchRepo(root) })],
];

for (const [name, built] of BUILT) {
  test(`refusal (${name}): a built forge-architect manifest never awaits kickoff, and Start is refused by name`, () => {
    withRoot((root) => {
      const { manifestPath } = plantStrandedKickoff(root, built(root));
      const run = runFor(root, manifestPath);
      assert.equal(run.awaitingKickoff, undefined);
      assert.notEqual(run.gateNote, 'Awaiting kickoff');
      const r = enqueueDevelopRun(STRANDED_INIT, { queueRoot: join(root, '_queue') });
      assert.equal(r.status, 'not-at-kickoff');
      assert.match(r.detail ?? '', /work items already built — not at the kickoff gate/);
      assert.ok(existsSync(manifestPath), 'a refusal writes nothing');
    });
  });
}
