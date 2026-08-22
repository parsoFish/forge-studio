/**
 * W8-A3 WI-1 — `flows-37` / `forge-chm` at the ROUTE boundary.
 *
 * `orchestrator/enqueue-flow-run-repoint.test.ts` pins the rule on the
 * primitive. This file pins the two things only an over-the-wire test can
 * establish:
 *
 *  1. `POST /api/flows/:id/run` — the operator-facing door flows-37 was
 *     reproduced through — refuses an unconfirmed cross-flow repoint with a
 *     409 whose body names the flow of origin, and leaves the queued manifest
 *     byte-identical on disk.
 *  2. The confirmation is a BOOLEAN `true` and nothing else. A truthy string
 *     (`"true"`, `"1"`) or a number must NOT read as confirmation — a guard
 *     that accepts whatever JSON happens to be truthy is a guard an
 *     accidental client serialization walks straight through.
 *
 * The route stays a pure forwarder: it maps the body flag and the status onto
 * HTTP, and holds no copy of the rule (see `cli/ui-bridge.ts`'s own comment at
 * the handler — the id rule, the state guards and now the repoint guard are
 * all the enqueue's).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { startBridge } from './ui-bridge.ts';

process.env.FORGE_ARCHITECT_NO_SPAWN = '1';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

/** Queued under the ARCHITECT flow — the real shape of every planned initiative. */
const INIT_QUEUED = 'INIT-2026-08-18-queued-elsewhere';
/** Already queued under the flow we will target — not a repoint at all. */
const INIT_SAME = 'INIT-2026-08-18-same-flow';

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

function manifestBody(id: string, flowId: string): string {
  return [
    '---',
    `initiative_id: ${id}`,
    'project: demo-project',
    `project_repo_path: ${join(forgeRoot, 'projects', 'demo-project')}`,
    `created_at: '2026-08-18T13:33:48.787Z'`,
    'iteration_budget: 3',
    'cost_budget_usd: 2',
    'phase: pending',
    'origin: architect',
    `flow_id: ${flowId}`,
    'specs:',
    '  - .forge/work-items/WI-1.md',
    '---',
    '',
    '## Summary',
    '',
    'Probe manifest.',
    '',
  ].join('\n');
}

function pendingPath(id: string): string {
  return join(forgeRoot, '_queue', 'pending', `${id}.md`);
}

async function postRun(flowId: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${url}/api/flows/${encodeURIComponent(flowId)}/run`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-w8a3-repoint-'));
  mkdirSync(join(forgeRoot, 'projects', 'demo-project'), { recursive: true });
  mkdirSync(join(forgeRoot, '_queue', 'pending'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  // Real flow definitions — `flow not found` stays a real existence check.
  for (const flowId of ['forge-develop', 'forge-architect']) {
    const src = join(REPO_ROOT, 'studio', 'flows', flowId, 'flow.yaml');
    const dst = join(forgeRoot, 'studio', 'flows', flowId, 'flow.yaml');
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, readFileSync(src, 'utf8'));
  }

  writeFileSync(pendingPath(INIT_QUEUED), manifestBody(INIT_QUEUED, 'forge-architect'));
  writeFileSync(pendingPath(INIT_SAME), manifestBody(INIT_SAME, 'forge-develop'));

  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('POST /api/flows/:id/run: an unconfirmed cross-flow repoint → 409, and the queued manifest is byte-unchanged', async () => {
  const before = readFileSync(pendingPath(INIT_QUEUED), 'utf8');

  const r = await postRun('forge-develop', { initiativeId: INIT_QUEUED });

  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.ok, false);
  assert.equal(r.json.status, 'repoint-requires-confirm');
  assert.equal(r.json.currentFlowId, 'forge-architect', 'the body names the flow of origin the picker never disclosed');
  assert.match(String(r.json.detail ?? ''), /forge-architect/);
  assert.equal(readFileSync(pendingPath(INIT_QUEUED), 'utf8'), before, 'manifest byte-identical — the click stole nothing');
});

test('POST /api/flows/:id/run: a truthy NON-boolean confirmRepoint is not confirmation (fails closed)', async () => {
  const before = readFileSync(pendingPath(INIT_QUEUED), 'utf8');
  for (const bogus of ['true', '1', 1, {}, ['true']]) {
    const r = await postRun('forge-develop', { initiativeId: INIT_QUEUED, confirmRepoint: bogus });
    assert.equal(r.status, 409, `confirmRepoint: ${JSON.stringify(bogus)} must not confirm anything`);
    assert.equal(r.json.status, 'repoint-requires-confirm');
  }
  assert.equal(readFileSync(pendingPath(INIT_QUEUED), 'utf8'), before, 'manifest byte-identical after every bogus attempt');
});

test('POST /api/flows/:id/run: the same flow the initiative is already queued under needs no flag → 200', async () => {
  const r = await postRun('forge-develop', { initiativeId: INIT_SAME });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, 'enqueued');
  assert.ok(existsSync(pendingPath(INIT_SAME)));
});

test('POST /api/flows/:id/run: confirmRepoint:true performs the repoint the operator confirmed → 200', async () => {
  const r = await postRun('forge-develop', { initiativeId: INIT_QUEUED, confirmRepoint: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, 'enqueued');
  assert.equal(r.json.flowId, 'forge-develop');
  assert.match(readFileSync(pendingPath(INIT_QUEUED), 'utf8'), /^flow_id: forge-develop$/m);
});
