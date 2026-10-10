/**
 * Bead forge-mfv5.1.25 — the four Kickoff-gate consumers agree, through the
 * real bridge, on the EXACT stranded shape (forge-architect manifest in
 * `_queue/ready-for-review/`, `cycle.end` says `ready-for-review`, five pending
 * WIs, plan present):
 *
 *   1. roadmap card   — `status: 'awaiting-kickoff'` (Studio labels it KICKOFF);
 *   2. Start          — `canStartDevelopment`, and `POST /api/develop/start` enqueues;
 *   3. merged count   — no `completedAt` on the roadmap or the run;
 *   4. Monitor        — `GET /api/runs` carries `awaitingKickoff` + "Awaiting kickoff".
 *
 * And on every "already built" variant, none of them says kickoff, and Start is
 * refused by name.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../ui-bridge.ts';
import {
  plantStrandedKickoff, STRANDED_INIT, STRANDED_PROJECT, STRANDED_BUILT_CASES, type StrandedBuilt,
} from '../../../../packages/flows/tests/test-fixtures/stranded-kickoff.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

type Card = { initiativeId: string; status: string; canStartDevelopment: boolean; completedAt?: string };
type RunRow = { initiativeId: string; status: string; gateNote?: string; awaitingKickoff?: true; completedAt?: string };
type View = { card: Card; run: RunRow; start: { status: number; result: { status: string; detail?: string } } };

async function observe(built?: (root: string) => StrandedBuilt): Promise<View> {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'kickoff-consumers-'));
  plantStrandedKickoff(forgeRoot, built?.(forgeRoot));
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const { url, close } = await startBridge({ forgeRoot, port: 0 });
  try {
    const roadmap = (await (await fetch(`${url}/api/studio/projects/${STRANDED_PROJECT}/roadmap`)).json()) as { roadmap: { initiatives: Card[] } };
    const runs = (await (await fetch(`${url}/api/runs`)).json()) as { runs: RunRow[] };
    const res = await fetch(`${url}/api/develop/start`, { method: 'POST', headers: CSRF, body: JSON.stringify({ initiativeIds: [STRANDED_INIT] }) });
    const body = (await res.json()) as { results: Array<{ status: string; detail?: string }> };
    const card = roadmap.roadmap.initiatives.find((i) => i.initiativeId === STRANDED_INIT);
    const run = runs.runs.find((r) => r.initiativeId === STRANDED_INIT);
    assert.ok(card && run, 'the stranded initiative is on the roadmap and in the runs list');
    return { card, run, start: { status: res.status, result: body.results[0] } };
  } finally {
    await close();
    rmSync(forgeRoot, { recursive: true, force: true });
  }
}

test('stranded shape: all four consumers read the Kickoff gate', async () => {
  const v = await observe();
  assert.equal(v.card.status, 'awaiting-kickoff');
  assert.equal(v.card.canStartDevelopment, true);
  assert.equal(v.card.completedAt, undefined, 'not counted merged');
  assert.equal(v.run.awaitingKickoff, true);
  assert.equal(v.run.gateNote, 'Awaiting kickoff');
  assert.equal(v.run.completedAt, undefined);
  assert.equal(v.start.result.status, 'enqueued', v.start.result.detail);
});

function branchRepo(root: string): string {
  const dir = join(root, 'projects', 'repo');
  const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git(['commit', '-q', '-m', 'base']);
  git(['checkout', '-q', '-b', `forge/${STRANDED_INIT}`]);
  writeFileSync(join(dir, 'b.txt'), 'b\n');
  git(['add', 'b.txt']);
  git(['commit', '-q', '-m', 'built']);
  return dir;
}

const BUILT: Array<[string, (root: string) => StrandedBuilt]> = [
  ...STRANDED_BUILT_CASES.map((c): [string, (root: string) => StrandedBuilt] => [c, () => c]),
  ['branch-commits', (root) => ({ branchRepo: branchRepo(root) })],
];

for (const [name, built] of BUILT) {
  test(`built (${name}): no consumer reads kickoff, and Start is refused by name`, async () => {
    const v = await observe(built);
    assert.equal(v.card.status, 'ready-for-review');
    assert.equal(v.run.awaitingKickoff, undefined);
    assert.notEqual(v.run.gateNote, 'Awaiting kickoff');
    assert.equal(v.start.result.status, 'not-at-kickoff');
    assert.match(v.start.result.detail ?? '', /work items already built — not at the kickoff gate/);
  });
}
