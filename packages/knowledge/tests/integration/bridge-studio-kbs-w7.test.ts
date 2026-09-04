/**
 * W7-B2 pinned tests — KB route honesty + the one action-group gate
 * (knowledge-V01 / -22 / -23 / -24 / -05 / -06 and the /active-job route).
 * Isolated bridge per test group, mirroring cli/bridge-studio-kb-drain.test.ts
 * Part B.
 */

import { refusingSessionStatusIo } from '../test-fixtures/session-status-io.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { IncomingMessage, ServerResponse } from 'node:http';

import { dispatchRoute } from '@forge/kernel';
import { knowledgeRoutes, type KnowledgeRouteContext } from '../../routes.ts';
import { deriveKbActiveJob, activeJobReason } from '../../kb-job-state.ts';

/**
 * These drive the CARVED HANDLERS directly — no bridge (COMMON §5). The
 * `{status, json}` shape is preserved so every assertion is byte-for-byte what
 * it was over HTTP. Origin/CSRF/404-fallthrough are the HOST's policy and stay
 * in `cli/*.test.ts`.
 */
const routes = knowledgeRoutes({
  sessionStatusIo: refusingSessionStatusIo,
  listFlowIds: () => ['forge-develop'],
  listFlowBandIds: () => ['review-band', 'demo-band'],
  // M4 ruling 86: the real fix turn is injected by the assembly, so route
  // tests declare one. It THROWS: no assertion in this file expects a fix turn
  // to be dispatched, and a stub that returned a plausible result would let a
  // future change dispatch one here unnoticed.
  runFixTurn: async () => {
    throw new Error('unexpected brain-fix dispatch in this test');
  },
});

const mockReq = () => ({ headers: {} }) as unknown as IncomingMessage;

function mockRes(): { res: ServerResponse; captured: { status: number | null; body: string } } {
  const captured: { status: number | null; body: string } = { status: null, body: '' };
  const res = {
    writeHead(status: number) { captured.status = status; return res; },
    end(payload?: string) { if (payload !== undefined) captured.body = payload; return res; },
  } as unknown as ServerResponse;
  return { res, captured };
}

async function drive(root: string, path: string, method: string, body: unknown = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  const { res, captured } = mockRes();
  const ctx: KnowledgeRouteContext = {
    forgeRoot: root,
    logsRoot: join(root, '_logs'),
    readBody: async () => body,
  };
  const matched = await dispatchRoute(routes, mockReq(), res, ctx, path, method);
  if (!matched) return { status: 404, json: {} };
  return { status: captured.status ?? 0, json: JSON.parse(captured.body || '{}') as Record<string, unknown> };
}

function makeIsolatedBridge(): { root: string } {
  const root = mkdtempSync(join(tmpdir(), 'kbs-w7-http-'));
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(root, '_queue', state), { recursive: true });
  }
  mkdirSync(join(root, '_logs'), { recursive: true });
  return { root };
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

const postJson = (root: string, path: string, body: Record<string, unknown> = {}) => drive(root, path, 'POST', body);

const getJson = (root: string, path: string) => drive(root, path, 'GET');

const del = (root: string, path: string) => drive(root, path, 'DELETE');

// ---------------------------------------------------------------------------
// knowledge-V01 — create collision must check BOTH containment roots
// ---------------------------------------------------------------------------

test('POST /api/studio/kbs — 409 when the id already lives at brain/projects/<id> (knowledge-V01: no silent shadow)', async () => {
  const iso = makeIsolatedBridge();
  try {
    seedKb(iso.root, 'gitpulse', { project: true });
    seedProject(iso.root, 'gitpulse');
    const res = await postJson(iso.root, '/api/studio/kbs', {
      id: 'gitpulse', name: 'gitpulse', binding: { kind: 'project', ref: 'gitpulse' }, desc: 'shadow attempt',
    });
    assert.equal(res.status, 409, JSON.stringify(res.json));
    assert.match(String(res.json['error']), /already exists/, JSON.stringify(res.json));
    // The real central brain is untouched and NO shadow dir was scaffolded.
    assert.ok(!existsSync(join(iso.root, 'brain', 'gitpulse')), 'no shadow brain/<id> dir may be scaffolded');
    assert.ok(existsSync(join(iso.root, 'brain', 'projects', 'gitpulse', 'kb.yaml')));
  } finally {
    rmSync(iso.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// knowledge-05 — every mutating KB route refuses while a job is live
// ---------------------------------------------------------------------------

test('mutating KB routes 409 with the active-job reason while a drain is live (knowledge-05)', async () => {
  const iso = makeIsolatedBridge();
  try {
    seedKb(iso.root, 'busy-kb');
    const runId = seedLiveDrain(iso.root, 'busy-kb');
    const job = deriveKbActiveJob(iso.root, 'busy-kb');
    assert.deepEqual(job, { kind: 'drain', runId });

    const consolidate = await postJson(iso.root, '/api/studio/kbs/busy-kb/maintenance', { op: 'consolidate' });
    assert.equal(consolidate.status, 409, JSON.stringify(consolidate.json));
    assert.equal(consolidate.json['error'], activeJobReason({ kind: 'drain', runId }));

    const index = await postJson(iso.root, '/api/studio/kbs/busy-kb/maintenance', { op: 'index' });
    assert.equal(index.status, 409, JSON.stringify(index.json));

    // `POST /api/studio/kbs/:id/cleanup/start` is deliberately absent from this
    // list. It is the 18th KB route and the ONE that is still implemented
    // inline in `cli/ui-bridge.ts` (it mints an interactive session, so ruling
    // 17 forbids carving it into a rank-2 package) — handoff K10 to
    // M4-sessions. A handler-level test cannot reach it, so its 409 assertion
    // MOVED to `cli/ui-bridge-kb-cleanup.test.ts`, which boots a real bridge
    // and already owns that route's test surface. It was not dropped.

    const remove = await del(iso.root, '/api/studio/kbs/busy-kb');
    assert.equal(remove.status, 409, JSON.stringify(remove.json));

    const active = await getJson(iso.root, '/api/studio/kbs/busy-kb/active-job');
    assert.equal(active.status, 200);
    assert.deepEqual(active.json['job'], { kind: 'drain', runId });
    assert.equal(active.json['reason'], activeJobReason({ kind: 'drain', runId }));
  } finally {
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('GET /api/studio/kbs/:id/active-job — null when nothing runs', async () => {
  const iso = makeIsolatedBridge();
  try {
    seedKb(iso.root, 'idle-kb');
    const res = await getJson(iso.root, '/api/studio/kbs/idle-kb/active-job');
    assert.equal(res.status, 200);
    assert.equal(res.json['job'], null);
  } finally {
    rmSync(iso.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// knowledge-06 — op=index is per-KB (and reports both halves)
// ---------------------------------------------------------------------------

test('POST maintenance op=index — drains THIS kb\'s index-tier findings and reports kb + global halves (knowledge-06)', async () => {
  const iso = makeIsolatedBridge();
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
    const res = await postJson(iso.root, '/api/studio/kbs/idx-kb/maintenance', { op: 'index' });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const kbHalf = res.json['kb'] as { applied: number };
    assert.ok(kbHalf && kbHalf.applied >= 1, `expected ≥1 per-KB index fix applied — got ${JSON.stringify(res.json)}`);
    assert.match(readFileSync(join(dir, 'patterns.md'), 'utf8'), /unlisted/, 'the theme must be linked into ITS OWN index');
  } finally {
    rmSync(iso.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// knowledge-24 — delete tidies the KB's anchored sessions
// ---------------------------------------------------------------------------

test('DELETE /api/studio/kbs/:id — removes the dot-anchor session dir and reports project-anchored orphans (knowledge-24)', async () => {
  const iso = makeIsolatedBridge();
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

    const res = await del(iso.root, '/api/studio/kbs/doomed-kb');
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json['removedSessionAnchor'], true);
    assert.deepEqual(res.json['orphanedSessions'], ['other-project/_kb-cleanup/2026-08-20T09-01-00-bbbb']);
    assert.ok(!existsSync(join(iso.root, 'projects', '.kb-doomed-kb')), 'the dot-anchor dir must be removed');
    assert.ok(existsSync(projSession), 'a real project\'s session dir is never swept');
  } finally {
    rmSync(iso.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// W7 FIX-B-KB — the journey kb-maintain fixture shape must consolidate to a
// genuine `cleared` terminal under no-spawn.
//
// The fixture theme's description carries an unquoted `: ` (real themes do
// too — parseTheme's lenient fallback exists exactly for that), which makes
// gray-matter throw on first parse. gray-matter caches the file object
// BEFORE the parse throws, so every LATER parse of the byte-identical
// content silently got `data: {}` back — the own-theme lens then invented
// three agent-tier "missing required frontmatter field" findings for fields
// plainly present, and consolidate reported cleared=1/4 → "not-cleared"
// (the knowledge journey's kb-maintain gate failure). This pin drives the
// exact journey shape end to end: exactly ONE agent-tier finding, fixed
// deterministically in-process, terminal cleared=true.
// ---------------------------------------------------------------------------

test('runBrainConsolidateNow: the journey kb-maintain fixture (unquoted-colon description) reaches cleared=true under no-spawn (W7 FIX-B-KB)', async () => {
  const { runBrainConsolidateNow } = await import('../../bridge-studio-kb-consolidate.ts');
  const root = mkdtempSync(join(tmpdir(), 'kbs-w7-consolidate-'));
  const prevNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  try {
    const kbId = 'jm-kb';
    const kbDir = join(root, 'brain', 'projects', kbId);
    mkdirSync(join(kbDir, 'themes'), { recursive: true });
    writeFileSync(join(kbDir, 'kb.yaml'), `id: ${kbId}\nname: ${kbId} (project)\nbinding:\n  kind: project\n  ref: ${kbId}\ndesc: journey-shaped fixture\nbackend: filesystem\n`);
    const now = new Date().toISOString();
    // Mirrors the retired knowledge journey's seedScratchKbMaintain() —
    // including the unquoted colon in `description:` that gray-matter
    // rejects (the lenient-fallback + cache-poisoning trigger). Uniquified
    // so no earlier parse in this process can pre-poison the content key.
    writeFileSync(join(kbDir, 'themes', 'colon-lesson.md'), [
      '---',
      'title: Colon lesson — deliberately unindexed',
      `description: A scratch lint fixture: unquoted colon, real theme, missing from its own index (w7pin-${Date.now()})`,
      'category: pattern',
      'keywords: [w7, fix-b-kb]',
      `created_at: ${now}`,
      `updated_at: ${now}`,
      'related_themes: []',
      '---',
      '',
      '# Theme: colon lesson',
      '',
    ].join('\n'));
    writeFileSync(join(kbDir, 'patterns.md'), `# ${kbId} — Patterns\n\n## Theme pages\n\n(deliberately empty)\n`);

    const runId = `${kbId}-consolidate-w7pin`;
    await runBrainConsolidateNow(root, kbId, runId);

    const evRaw = readFileSync(join(root, '_logs', `_brainfix-${runId}`, 'events.jsonl'), 'utf8');
    const end = evRaw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as { event_type?: string; metadata?: Record<string, unknown> })
      .find((e) => e.event_type === 'end');
    assert.ok(end, `terminal 'end' event must exist, got: ${evRaw}`);
    assert.equal(
      end?.metadata?.['total'], 1,
      `the fixture must scope to exactly ONE agent-tier finding — more means phantom findings from a poisoned parse, got ${JSON.stringify(end?.metadata)}`,
    );
    assert.equal(end?.metadata?.['cleared'], true, `the deterministic in-process fix must clear it, got ${JSON.stringify(end?.metadata)}`);
    assert.ok(
      readFileSync(join(kbDir, 'patterns.md'), 'utf8').includes('(./themes/colon-lesson.md)'),
      'the KB\'s own patterns.md must carry the appended link',
    );
  } finally {
    if (prevNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = prevNoSpawn;
    rmSync(root, { recursive: true, force: true });
  }
});
