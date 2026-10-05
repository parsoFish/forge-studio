/**
 * forge-8vfn.8.5.58 — an interactive session's directory must never live
 * inside the managed project's checkout (the "ground"): it moves the ground's
 * content hash and leaves scratch in someone else's repo. Every session kind's
 * dir lives under forge's own logs root:
 *   <logsRoot>/_sessions/<project>/<kindDir>/<sessionId>/
 *
 * Real bridge (startBridge) against a temp forgeRoot, no spawn. For architect
 * (start -> answer -> plan-verdict approve), a generic yaml kind (authoring)
 * and demo: (a) the ground's recursive listing is IDENTICAL before and after,
 * (b) the session files exist at the new path.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../ui-bridge.ts';

process.env.FORGE_ARCHITECT_NO_SPAWN = '1';

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

const ground = (): string => join(forgeRoot, 'projects', 'demo');
const sessionsDir = (kindDir: string, sid: string): string => join(forgeRoot, '_logs', '_sessions', 'demo', kindDir, sid);

/** Recursive, sorted relative listing of a directory. */
function listing(root: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const r = rel === '' ? e.name : `${rel}/${e.name}`;
    out.push(r);
    if (e.isDirectory()) out.push(...listing(root, r));
  }
  return out.sort();
}

async function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'session-outside-ground-'));
  mkdirSync(ground(), { recursive: true });
  writeFileSync(join(ground(), 'README.md'), '# demo\n');
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('architect start -> answer -> approve leaves the ground untouched; files live under _logs/_sessions', async () => {
  const baseline = listing(ground());
  const start = await post('/api/architect/start', { project: 'demo', idea: 'A brand new idea.' });
  assert.equal(start.status, 200);
  const sid = start.json.sessionId as string;
  const dir = sessionsDir('_architect', sid);
  assert.ok(existsSync(join(dir, 'status.json')), `status.json at ${dir}`);
  assert.ok(existsSync(join(dir, 'idea.md')), 'idea.md beside it');

  const status = JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ ...status, phase: 'awaiting-answers' }));
  const ans = await post('/api/architect/answer', { project: 'demo', sessionId: sid, answers: [{ question: 'Q', answer: 'A' }] });
  assert.equal(ans.status, 200);
  assert.ok(existsSync(join(dir, 'answers.json')), 'answers.json under the logs root');

  const st2 = JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ ...st2, phase: 'awaiting-verdict' }));
  writeFileSync(join(dir, 'PLAN.html'), '<!doctype html><title>PLAN</title>');
  const verdict = await post('/api/plan-verdict', { project: 'demo', sessionId: sid, kind: 'approve' });
  assert.equal(verdict.status, 200);

  assert.deepEqual(listing(ground()), baseline, 'the ground must gain no `_architect` (or any `_<kind>`) entry');
  assert.ok(!existsSync(join(ground(), '_architect')));
});

test('authoring (generic yaml kind) start leaves the ground untouched', async () => {
  const baseline = listing(ground());
  const res = await post('/api/studio/authoring/start', { project: 'demo', prompt: 'a skill that does x' });
  assert.equal(res.status, 200);
  const sid = res.json.sessionId as string;
  assert.ok(existsSync(join(sessionsDir('_authoring', sid), 'status.json')));
  assert.deepEqual(listing(ground()), baseline);
});

test('demo-builder start leaves the ground untouched', async () => {
  const baseline = listing(ground());
  const res = await post('/api/demo-builder/start', { project: 'demo', mode: 'create' });
  assert.equal(res.status, 200);
  const sid = res.json.sessionId as string;
  assert.ok(existsSync(join(sessionsDir('_demo', sid), 'status.json')));
  assert.deepEqual(listing(ground()), baseline);
});
