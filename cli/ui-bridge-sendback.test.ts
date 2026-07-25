/**
 * POST /api/verdict `send-back` — ADR-040 rewrite (R4-08-F2).
 *
 * The send-back branch no longer appends a terminal-re-prep UWI pair; it
 * compiles the operator's feedback into ONE ordinary work item (`origin:
 * 'review-fix'`) on the initiative's own `.forge/work-items/` queue via
 * `compileFixWorkItems` (orchestrator/fix-work-items.ts), stamps
 * `resume_from: 'develop'` + increments `review_rounds` on the manifest
 * (`persistManifestSendBack`), and records the round in BOTH:
 *   1. the fix WI file itself — the operator's rationale lands VERBATIM in
 *      the body (the re-run's prompt source), and
 *   2. a structured `reviewer.verdict.send-back` event PLUS one
 *      `pm.work-item-emitted` event per fix WI in the cycle's
 *      `_logs/<cycleId>/events.jsonl` (`cli/cycle-retention.ts` and
 *      `cli/cycle-recap.ts` count the former; `run-model-derive` matches the
 *      latter for the run page's hex + drawer spec).
 * Cap exhaustion (`FixLoopCapError`) rejects with 409 + `parked:
 * 'needs-operator'` and writes the greppable `.forge/REVIEW-CAP-EXHAUSTED.md`
 * marker WITHOUT writing a new WI file (reject-then-park).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { parseManifest } from '../orchestrator/manifest.ts';
import { parseWorkItem } from '../orchestrator/work-item.ts';
import { reviewCapExhaustedPath } from '../orchestrator/fix-work-items.ts';

function makeManifest(worktreePath: string, initiativeId: string, cycleId: string): string {
  return [
    '---',
    `initiative_id: ${initiativeId}`,
    `cycle_id: ${cycleId}`,
    'project: test-project',
    'project_repo_path: /tmp/test-project',
    `worktree_path: ${worktreePath}`,
    'created_at: 2026-01-01T00:00:00.000Z',
    'iteration_budget: 5',
    'cost_budget_usd: 2.0',
    '---',
    '',
    '# Test initiative',
  ].join('\n');
}

async function postVerdict(
  url: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${url}/api/verdict`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

/** Fresh forgeRoot + worktree + ready-for-review manifest for one initiative. */
function setup(slug: string): { forgeRoot: string; worktreePath: string; initiativeId: string; cycleId: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), `bv-sendback-${slug}-`));
  const worktreePath = join(forgeRoot, 'projects', 'test-project', 'worktrees', slug);
  mkdirSync(worktreePath, { recursive: true });
  const initiativeId = `INIT-2026-01-01-${slug}`;
  const cycleId = `${initiativeId}-20260101T000000`;
  const rfr = join(forgeRoot, '_queue', 'ready-for-review');
  mkdirSync(rfr, { recursive: true });
  writeFileSync(join(rfr, `${initiativeId}.md`), makeManifest(worktreePath, initiativeId, cycleId));
  return { forgeRoot, worktreePath, initiativeId, cycleId };
}

function readEvents(forgeRoot: string, cycleId: string): Record<string, unknown>[] {
  const eventsPath = join(forgeRoot, '_logs', cycleId, 'events.jsonl');
  assert.ok(existsSync(eventsPath), `events.jsonl missing at ${eventsPath}`);
  return readFileSync(eventsPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

test('send-back: 200, ONE fix work item appended (origin review-fix), manifest + verdict.json + events all record round 1', async () => {
  const { forgeRoot, worktreePath, initiativeId, cycleId } = setup('main');

  const rationale = 'The demo shows a test-name table, not the live GET response — embed the actual API output.';
  const ac = {
    given: 'the review page for this cycle',
    when: 'the demo section renders',
    then: 'the live GET response body is embedded verbatim',
  };

  const { url, close } = await startBridge({
    forgeRoot,
    port: 0,
    mergePr: () => {
      throw new Error('mergePr must not be called on send-back');
    },
    finalizeAfterMerge: async () => {
      throw new Error('finalizeAfterMerge must not be called on send-back');
    },
  });
  try {
    const { status, json } = await postVerdict(url, {
      initiativeId,
      kind: 'send-back',
      rationale,
      acceptanceCriteria: [ac],
      concernKind: 'code-fix',
    });
    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(json)}`);
    const body = json as Record<string, unknown>;
    assert.deepEqual(body.appendedWorkItems, ['WI-1'], 'exactly one fix WI — no terminal re-prep pair');
    assert.equal(body.round, 1);

    // 1. The fix WI lands on the initiative's OWN work-items queue with
    //    origin 'review-fix' and the operator's rationale VERBATIM in the body.
    const wiPath = join(worktreePath, '.forge', 'work-items', 'WI-1.md');
    assert.ok(existsSync(wiPath), 'fix work item written');
    const wi = parseWorkItem(readFileSync(wiPath, 'utf8'));
    assert.equal(wi.origin, 'review-fix');
    assert.ok(wi.body.includes(rationale), 'rationale verbatim in the fix WI body');

    // 2. The manifest is stamped resume_from:'develop' + review_rounds:1 and
    //    the new WI id is appended to `specs`.
    const manifestPath = join(forgeRoot, '_queue', 'ready-for-review', `${initiativeId}.md`);
    const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.resume_from, 'develop');
    assert.equal(manifest.review_rounds, 1);
    assert.ok(manifest.specs?.includes('WI-1'), 'new WI id appended to manifest specs');

    // 3. verdict.json records kind:'send-back' + round:1.
    const verdictPath = join(forgeRoot, '_logs', cycleId, 'artifacts', 'verdict.json');
    assert.ok(existsSync(verdictPath), 'verdict.json written');
    const verdict = JSON.parse(readFileSync(verdictPath, 'utf8')) as Record<string, unknown>;
    assert.equal(verdict.kind, 'send-back');
    assert.equal(verdict.round, 1);

    // 4. events.jsonl (same cycleId) has BOTH the send-back event and a
    //    pm.work-item-emitted for the new fix WI.
    const events = readEvents(forgeRoot, cycleId);
    const sendBackEv = events.find((e) => e.message === 'reviewer.verdict.send-back');
    assert.ok(sendBackEv, 'reviewer.verdict.send-back event emitted');
    assert.equal(sendBackEv.cycle_id, cycleId);
    assert.equal(sendBackEv.initiative_id, initiativeId);
    assert.equal(sendBackEv.phase, 'review-loop');
    const sbMeta = sendBackEv.metadata as Record<string, unknown>;
    assert.equal(sbMeta.rationale, rationale, 'operator feedback verbatim in the event');
    assert.deepEqual(sbMeta.acceptance_criteria, [ac]);
    assert.deepEqual(sbMeta.appended_work_items, ['WI-1']);
    assert.equal(sbMeta.origin, 'review-fix');
    assert.equal(sbMeta.round, 1);
    assert.equal(sbMeta.decided_by, 'operator');

    const emittedEv = events.find(
      (e) => e.message === 'pm.work-item-emitted' && (e.metadata as Record<string, unknown>)?.work_item_id === 'WI-1',
    );
    assert.ok(emittedEv, 'pm.work-item-emitted event for the new fix WI');
    assert.equal(emittedEv.initiative_id, initiativeId);
  } finally {
    await close();
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('second send-back: round 2, next WI id (WI-2)', async () => {
  const { forgeRoot, worktreePath, initiativeId } = setup('round2');
  const ac = { given: 'a user', when: 'clicking submit', then: 'data is saved' };

  const { url, close } = await startBridge({
    forgeRoot,
    port: 0,
    mergePr: () => { throw new Error('mergePr must not be called on send-back'); },
    finalizeAfterMerge: async () => { throw new Error('finalizeAfterMerge must not be called on send-back'); },
  });
  try {
    const first = await postVerdict(url, {
      initiativeId,
      kind: 'send-back',
      rationale: 'first round of feedback',
      acceptanceCriteria: [ac],
    });
    assert.equal(first.status, 200, `round 1 failed: ${JSON.stringify(first.json)}`);

    const second = await postVerdict(url, {
      initiativeId,
      kind: 'send-back',
      rationale: 'second round of feedback',
      acceptanceCriteria: [ac],
    });
    assert.equal(second.status, 200, `round 2 failed: ${JSON.stringify(second.json)}`);
    const body = second.json as Record<string, unknown>;
    assert.deepEqual(body.appendedWorkItems, ['WI-2']);
    assert.equal(body.round, 2);

    const wi2Path = join(worktreePath, '.forge', 'work-items', 'WI-2.md');
    assert.ok(existsSync(wi2Path), 'second fix work item written as WI-2');

    const manifestPath = join(forgeRoot, '_queue', 'ready-for-review', `${initiativeId}.md`);
    const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.review_rounds, 2);
    assert.ok(manifest.specs?.includes('WI-1') && manifest.specs?.includes('WI-2'));
  } finally {
    await close();
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('send-back cap exhaustion: round cap reached → 409 parked needs-operator, marker written, no new WI', async () => {
  const { forgeRoot, worktreePath, initiativeId } = setup('cap');
  const ac = { given: 'a user', when: 'clicking submit', then: 'data is saved' };
  const prevCap = process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
  process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS = '1';

  const { url, close } = await startBridge({
    forgeRoot,
    port: 0,
    mergePr: () => { throw new Error('mergePr must not be called on send-back'); },
    finalizeAfterMerge: async () => { throw new Error('finalizeAfterMerge must not be called on send-back'); },
  });
  try {
    const first = await postVerdict(url, {
      initiativeId,
      kind: 'send-back',
      rationale: 'round 1 — within cap',
      acceptanceCriteria: [ac],
    });
    assert.equal(first.status, 200, `round 1 (within cap) should succeed: ${JSON.stringify(first.json)}`);

    const second = await postVerdict(url, {
      initiativeId,
      kind: 'send-back',
      rationale: 'round 2 — exceeds cap of 1',
      acceptanceCriteria: [ac],
    });
    assert.equal(second.status, 409, `expected 409 on cap exhaustion, got ${second.status}`);
    const body = second.json as Record<string, unknown>;
    assert.equal(body.parked, 'needs-operator');

    assert.ok(existsSync(reviewCapExhaustedPath(worktreePath)), 'REVIEW-CAP-EXHAUSTED.md written');

    const wi2Path = join(worktreePath, '.forge', 'work-items', 'WI-2.md');
    assert.ok(!existsSync(wi2Path), 'no new WI written when the cap rejects the send-back');
  } finally {
    if (prevCap === undefined) delete process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
    else process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS = prevCap;
    await close();
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('send-back with empty acceptanceCriteria → 400 (validated before the compiler)', async () => {
  const { forgeRoot, initiativeId } = setup('invalid');

  const { url, close } = await startBridge({
    forgeRoot,
    port: 0,
    mergePr: () => { throw new Error('mergePr must not be called on send-back'); },
    finalizeAfterMerge: async () => { throw new Error('finalizeAfterMerge must not be called on send-back'); },
  });
  try {
    const { status, json } = await postVerdict(url, {
      initiativeId,
      kind: 'send-back',
      rationale: 'missing acceptance criteria',
      acceptanceCriteria: [],
    });
    assert.equal(status, 400, `expected 400, got ${status}: ${JSON.stringify(json)}`);
    const body = json as Record<string, unknown>;
    assert.ok(typeof body.error === 'string' && body.error.length > 0);
  } finally {
    await close();
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
