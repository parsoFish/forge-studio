/**
 * W7-B2 pinned tests — KB route honesty + the one action-group gate
 * (knowledge-V01 / -22 / -23 / -24 / -05 / -06 and the /active-job route).
 * Isolated bridge per test group, mirroring cli/bridge-studio-kb-drain.test.ts
 * Part B.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { deriveKbActiveJob, activeJobReason } from './kb-job-state.ts';

async function makeIsolatedBridge(): Promise<{ root: string; url: string; close: () => Promise<void> }> {
  const root = mkdtempSync(join(tmpdir(), 'kbs-w7-http-'));
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(root, '_queue', state), { recursive: true });
  }
  mkdirSync(join(root, '_logs'), { recursive: true });
  const { url, close } = await startBridge({ forgeRoot: root, port: 0 });
  return { root, url, close };
}

function seedKb(root: string, kbId: string, opts: { project?: boolean } = {}): string {
  const dir = opts.project ? join(root, 'brain', 'projects', kbId) : join(root, 'brain', kbId);
  mkdirSync(join(dir, 'themes'), { recursive: true });
  const binding = opts.project ? `{ kind: project, ref: ${kbId} }` : '{ kind: unique }';
  writeFileSync(join(dir, 'kb.yaml'), `id: ${kbId}\nname: ${kbId}\nbinding: ${binding}\ndesc: w7 fixture.\n`);
  return dir;
}

function seedProject(root: string, id: string): void {
  const dir = join(root, 'projects', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'README.md'), `# ${id}\n`);
}

/** A LIVE drain status file — makes deriveKbActiveJob report a drain. */
function seedLiveDrain(root: string, kbId: string): string {
  const runId = `${kbId}-drain-w7live`;
  const dir = join(root, '_logs', `_kb-drain-${runId}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({
    state: 'running', round: 1, counts: { auto: 0, agent: 1, user: 0 }, perFinding: [],
    costUsd: 0, kbId, updatedAt: new Date().toISOString(),
  }));
  return runId;
}

async function postJson(base: string, path: string, body?: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function getJson(base: string, path: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function del(base: string, path: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, { method: 'DELETE', headers: { 'x-forge-csrf': '1' } });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// knowledge-V01 — create collision must check BOTH containment roots
// ---------------------------------------------------------------------------

test('POST /api/studio/kbs — 409 when the id already lives at brain/projects/<id> (knowledge-V01: no silent shadow)', async () => {
  const iso = await makeIsolatedBridge();
  try {
    seedKb(iso.root, 'gitpulse', { project: true });
    seedProject(iso.root, 'gitpulse');
    const res = await postJson(iso.url, '/api/studio/kbs', {
      id: 'gitpulse', name: 'gitpulse', binding: { kind: 'project', ref: 'gitpulse' }, desc: 'shadow attempt',
    });
    assert.equal(res.status, 409, JSON.stringify(res.json));
    assert.match(String(res.json['error']), /already exists/, JSON.stringify(res.json));
    // The real central brain is untouched and NO shadow dir was scaffolded.
    assert.ok(!existsSync(join(iso.root, 'brain', 'gitpulse')), 'no shadow brain/<id> dir may be scaffolded');
    assert.ok(existsSync(join(iso.root, 'brain', 'projects', 'gitpulse', 'kb.yaml')));
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// knowledge-05 — every mutating KB route refuses while a job is live
// ---------------------------------------------------------------------------

test('mutating KB routes 409 with the active-job reason while a drain is live (knowledge-05)', async () => {
  const iso = await makeIsolatedBridge();
  try {
    seedKb(iso.root, 'busy-kb');
    const runId = seedLiveDrain(iso.root, 'busy-kb');
    const job = deriveKbActiveJob(iso.root, 'busy-kb');
    assert.deepEqual(job, { kind: 'drain', runId });

    const consolidate = await postJson(iso.url, '/api/studio/kbs/busy-kb/maintenance', { op: 'consolidate' });
    assert.equal(consolidate.status, 409, JSON.stringify(consolidate.json));
    assert.equal(consolidate.json['error'], activeJobReason({ kind: 'drain', runId }));

    const index = await postJson(iso.url, '/api/studio/kbs/busy-kb/maintenance', { op: 'index' });
    assert.equal(index.status, 409, JSON.stringify(index.json));

    const cleanup = await postJson(iso.url, '/api/studio/kbs/busy-kb/cleanup/start', {});
    assert.equal(cleanup.status, 409, JSON.stringify(cleanup.json));

    const remove = await del(iso.url, '/api/studio/kbs/busy-kb');
    assert.equal(remove.status, 409, JSON.stringify(remove.json));

    const active = await getJson(iso.url, '/api/studio/kbs/busy-kb/active-job');
    assert.equal(active.status, 200);
    assert.deepEqual(active.json['job'], { kind: 'drain', runId });
    assert.equal(active.json['reason'], activeJobReason({ kind: 'drain', runId }));
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('GET /api/studio/kbs/:id/active-job — null when nothing runs', async () => {
  const iso = await makeIsolatedBridge();
  try {
    seedKb(iso.root, 'idle-kb');
    const res = await getJson(iso.url, '/api/studio/kbs/idle-kb/active-job');
    assert.equal(res.status, 200);
    assert.equal(res.json['job'], null);
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// knowledge-06 — op=index is per-KB (and reports both halves)
// ---------------------------------------------------------------------------

test('POST maintenance op=index — drains THIS kb\'s index-tier findings and reports kb + global halves (knowledge-06)', async () => {
  const iso = await makeIsolatedBridge();
  try {
    // A project KB whose theme is NOT listed in its category index — the
    // per-KB index half must fix exactly that.
    const dir = seedKb(iso.root, 'idx-kb', { project: true });
    writeFileSync(join(dir, 'themes', 'unlisted.md'), [
      '---',
      'title: Unlisted',
      'description: fixture',
      'category: pattern',
      'created_at: 2026-01-01',
      'updated_at: 2026-01-02',
      '---',
      '',
      'Body.',
      '',
    ].join('\n'));
    writeFileSync(join(dir, 'patterns.md'), '# Patterns\n\n');
    const res = await postJson(iso.url, '/api/studio/kbs/idx-kb/maintenance', { op: 'index' });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const kbHalf = res.json['kb'] as { applied: number };
    assert.ok(kbHalf && kbHalf.applied >= 1, `expected ≥1 per-KB index fix applied — got ${JSON.stringify(res.json)}`);
    assert.match(readFileSync(join(dir, 'patterns.md'), 'utf8'), /unlisted/, 'the theme must be linked into ITS OWN index');
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// knowledge-24 — delete tidies the KB's anchored sessions
// ---------------------------------------------------------------------------

test('DELETE /api/studio/kbs/:id — removes the dot-anchor session dir and reports project-anchored orphans (knowledge-24)', async () => {
  const iso = await makeIsolatedBridge();
  try {
    seedKb(iso.root, 'doomed-kb');
    // Dot-anchor sessions (non-project KB).
    const anchorSession = join(iso.root, 'projects', '.kb-doomed-kb', '_kb-cleanup', '2026-08-20T09-00-00-aaaa');
    mkdirSync(anchorSession, { recursive: true });
    writeFileSync(join(anchorSession, 'status.json'), JSON.stringify({ phase: 'drafting', kb_id: 'doomed-kb' }));
    // A project-anchored cleanup session carrying this kb_id (reported, not swept).
    const projSession = join(iso.root, 'projects', 'other-project', '_kb-cleanup', '2026-08-20T09-01-00-bbbb');
    mkdirSync(projSession, { recursive: true });
    writeFileSync(join(projSession, 'status.json'), JSON.stringify({ phase: 'applied', kb_id: 'doomed-kb' }));

    const res = await del(iso.url, '/api/studio/kbs/doomed-kb');
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json['removedSessionAnchor'], true);
    assert.deepEqual(res.json['orphanedSessions'], ['other-project/_kb-cleanup/2026-08-20T09-01-00-bbbb']);
    assert.ok(!existsSync(join(iso.root, 'projects', '.kb-doomed-kb')), 'the dot-anchor dir must be removed');
    assert.ok(existsSync(projSession), 'a real project\'s session dir is never swept');
  } finally {
    await iso.close();
    rmSync(iso.root, { recursive: true, force: true });
  }
});
