/**
 * forge-mfv5.1.15 — `POST /api/project-brain/revise`: the project-brain review
 * gate's third verdict. The operator's notes become the session's feedback.md,
 * the session goes back to `analyzing` for the next draft round, and the
 * decision lands in verdicts.json beside approve / abandon.
 *
 * DRY BRIDGE, tmp forge root (§6.16): nothing may spawn for real. The "spawn"
 * is observed through the `dry-bridge.skip` agent-turn event the spawn-helper
 * marker emits once per spawn site reached.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from '../../ui-bridge.ts';
import { DRY_BRIDGE_LOG_BUCKET } from '../../dry-bridge.ts';

const PROJECT = 'demoproj';
let forgeRoot: string;
let bridgeUrl: string;
let closeServer: () => Promise<void>;
let counter = 0;
const savedDry = process.env.FORGE_DRY_BRIDGE;
const savedNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;

async function post(path: string, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

before(async () => {
  process.env.FORGE_DRY_BRIDGE = '1';
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  forgeRoot = mkdtempSync(join(tmpdir(), 'pbrain-revise-'));
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', d), { recursive: true });
  }
  const projectDir = join(forgeRoot, 'projects', PROJECT);
  mkdirSync(join(projectDir, '.forge'), { recursive: true });
  writeFileSync(join(projectDir, '.forge', 'project.json'), JSON.stringify({ quality_gate_cmd: ['npm', 'test'] }));
  ({ url: bridgeUrl, close: closeServer } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (closeServer) await closeServer();
  if (savedDry === undefined) delete process.env.FORGE_DRY_BRIDGE; else process.env.FORGE_DRY_BRIDGE = savedDry;
  if (savedNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN; else process.env.FORGE_ARCHITECT_NO_SPAWN = savedNoSpawn;
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

/** Seed a session straight at `phase` (no real agent runs in this suite). */
function seed(phase: string, extra: Record<string, unknown> = {}): { sessionId: string; dir: string } {
  counter += 1;
  const sessionId = `2026-10-09T10-00-${String(counter).padStart(2, '0')}`;
  const dir = join(forgeRoot, '_logs', '_sessions', PROJECT, '_project-brain', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({
    session_id: sessionId, project: PROJECT, project_repo_path: join(forgeRoot, 'projects', PROJECT),
    phase, prompt: 'focus on conventions', updated_at: new Date().toISOString(), ...extra,
  }));
  return { sessionId, dir };
}

const readStatus = (dir: string): Record<string, unknown> => JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8')) as Record<string, unknown>;
const readVerdicts = (dir: string): Array<Record<string, unknown>> => JSON.parse(readFileSync(join(dir, 'verdicts.json'), 'utf8')) as Array<Record<string, unknown>>;

/** How many agent-turn spawn sites this session has reached (dry-bridge.skip events). */
function spawnCount(sessionId: string): number {
  const p = join(forgeRoot, '_logs', DRY_BRIDGE_LOG_BUCKET, 'events.jsonl');
  if (!existsSync(p)) return 0;
  return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as { message?: string; metadata?: { sessionId?: string } })
    .filter((e) => e.message === 'dry-bridge.skip' && e.metadata?.sessionId === sessionId).length;
}

test('revise at awaiting-review -> 200, feedback.md holds the notes, phase analyzing, round 2, verdict recorded, one spawn', async () => {
  const { sessionId, dir } = seed('awaiting-review');
  const r = await post('/api/project-brain/revise', { project: PROJECT, sessionId, feedback: 'the build command is npm run build, not make', notes: 'round one was close' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.ok, true);
  assert.equal(r.json.phase, 'analyzing');
  assert.equal(r.json.round, 2);
  assert.deepEqual(r.json.dryBridge, { skipped: ['agent-turn'] });

  assert.equal(readFileSync(join(dir, 'feedback.md'), 'utf8'), 'the build command is npm run build, not make');
  const status = readStatus(dir);
  assert.equal(status.phase, 'analyzing');
  assert.equal(status.round, 2);
  assert.equal(status.prompt, 'focus on conventions', 'the rest of the status is carried through');

  const verdicts = readVerdicts(dir);
  assert.equal(verdicts.length, 1);
  assert.equal(verdicts[0].verdict, 'revise');
  assert.equal(verdicts[0].feedback, 'the build command is npm run build, not make');
  assert.equal(verdicts[0].notes, 'round one was close');
  assert.ok(typeof verdicts[0].at === 'string');
  assert.equal(spawnCount(sessionId), 1, 'exactly one turn spawn site reached');
});

test('a second revise round -> round 3 and two revise records, each with its own feedback', async () => {
  const { sessionId, dir } = seed('awaiting-review');
  const first = await post('/api/project-brain/revise', { project: PROJECT, sessionId, feedback: 'first correction' });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  // The runner would now stage themes and move the session back to review; do that by hand.
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ ...readStatus(dir), phase: 'awaiting-review' }));

  const second = await post('/api/project-brain/revise', { project: PROJECT, sessionId, feedback: 'second correction' });
  assert.equal(second.status, 200, JSON.stringify(second.json));
  assert.equal(second.json.round, 3);
  assert.equal(readStatus(dir).round, 3);
  assert.equal(readFileSync(join(dir, 'feedback.md'), 'utf8'), 'second correction');

  const verdicts = readVerdicts(dir);
  assert.deepEqual(verdicts.map((v) => [v.verdict, v.feedback]), [['revise', 'first correction'], ['revise', 'second correction']]);
  assert.equal(spawnCount(sessionId), 2);
});

for (const [label, feedback] of [['missing', undefined], ['empty', ''], ['whitespace-only', '  \n\t ']] as const) {
  test(`revise with ${label} feedback -> 400, nothing written, no spawn`, async () => {
    const { sessionId, dir } = seed('awaiting-review');
    const body: Record<string, unknown> = { project: PROJECT, sessionId };
    if (feedback !== undefined) body.feedback = feedback;
    const r = await post('/api/project-brain/revise', body);
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.match(String(r.json.error), /feedback is required to revise/);
    assert.equal(existsSync(join(dir, 'feedback.md')), false);
    assert.equal(existsSync(join(dir, 'verdicts.json')), false);
    assert.equal(readStatus(dir).phase, 'awaiting-review');
    assert.equal(readStatus(dir).round, undefined);
    assert.equal(spawnCount(sessionId), 0);
  });
}

test('revise without project / sessionId -> 400 naming both', async () => {
  const r = await post('/api/project-brain/revise', { feedback: 'x' });
  assert.equal(r.status, 400);
  assert.match(String(r.json.error), /project and sessionId are required/);
});

test('revise with feedback over the byte cap -> 400, nothing written', async () => {
  const { sessionId, dir } = seed('awaiting-review');
  const r = await post('/api/project-brain/revise', { project: PROJECT, sessionId, feedback: 'x'.repeat(8 * 1024 + 1) });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.match(String(r.json.error), /exceeds the \d+-byte limit/);
  assert.equal(existsSync(join(dir, 'feedback.md')), false);
  assert.equal(readStatus(dir).phase, 'awaiting-review');
});

test('revise on an unknown session -> 404', async () => {
  const r = await post('/api/project-brain/revise', { project: PROJECT, sessionId: '2026-10-09T10-59-59', feedback: 'x' });
  assert.equal(r.status, 404, JSON.stringify(r.json));
});

for (const phase of ['briefing', 'analyzing', 'committing', 'committed', 'abandoned']) {
  test(`revise at phase "${phase}" -> 409, nothing written, no spawn`, async () => {
    const { sessionId, dir } = seed(phase);
    const r = await post('/api/project-brain/revise', { project: PROJECT, sessionId, feedback: 'fix it' });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.match(String(r.json.error), new RegExp(phase));
    assert.equal(existsSync(join(dir, 'feedback.md')), false);
    assert.equal(existsSync(join(dir, 'verdicts.json')), false);
    assert.equal(readStatus(dir).phase, phase);
    assert.equal(spawnCount(sessionId), 0);
  });
}

test('revise refuses 409 on an unparseable verdicts.json and writes nothing', async () => {
  const { sessionId, dir } = seed('awaiting-review');
  writeFileSync(join(dir, 'verdicts.json'), '{ not json');
  const r = await post('/api/project-brain/revise', { project: PROJECT, sessionId, feedback: 'fix it' });
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.match(String(r.json.error), /verdicts\.json/);
  assert.equal(readFileSync(join(dir, 'verdicts.json'), 'utf8'), '{ not json', 'the unreadable history is never overwritten');
  assert.equal(existsSync(join(dir, 'feedback.md')), false);
  assert.equal(readStatus(dir).phase, 'awaiting-review');
});

test('approve after a revise still works and records approve after the revise', async () => {
  const { sessionId, dir } = seed('awaiting-review');
  assert.equal((await post('/api/project-brain/revise', { project: PROJECT, sessionId, feedback: 'tighten it' })).status, 200);
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ ...readStatus(dir), phase: 'awaiting-review' }));

  const approved = await post('/api/project-brain/approve', { project: PROJECT, sessionId });
  assert.equal(approved.status, 200, JSON.stringify(approved.json));
  assert.deepEqual(Object.keys(approved.json).sort(), ['dryBridge', 'ok'], 'approve response shape is unchanged');
  assert.equal(readStatus(dir).phase, 'committing');
  assert.deepEqual(readVerdicts(dir).map((v) => v.verdict), ['revise', 'approve']);
});

test('abandon records abandon and keeps its response shape', async () => {
  const { sessionId, dir } = seed('awaiting-review');
  const r = await post('/api/project-brain/abandon', { project: PROJECT, sessionId });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { ok: true });
  assert.equal(readStatus(dir).phase, 'abandoned');
  assert.deepEqual(readVerdicts(dir).map((v) => v.verdict), ['abandon']);
});
