/**
 * W7-C2 pinned acceptance tests — the 'revise' verdict + rationale record on
 * the generic session-affordance WRITE endpoint
 * (cli/bridge-studio-affordances.ts), closing sessions-kinds-09/23/29,
 * library-22/24, beads forge-4ei.
 *
 * Contract pinned here (RED at branch base):
 *   - `verdict: 'revise'` is legal wherever the yaml row declares it
 *     (instructions awaiting-verdict, demo awaiting-review, authoring
 *     awaiting-review, kb-cleanup awaiting-approval, community-refresh
 *     awaiting-review). A revise REQUIRES a non-empty `feedback` string
 *     (400 naming it otherwise), writes it to the session's feedback.md, and
 *     sends the session back to its drafting/agent phase (spawning the next
 *     turn — a no-op under FORGE_DRY_BRIDGE, like every sibling test).
 *   - `reject` becomes legal for authoring + kb-cleanup → terminal
 *     `rejected` phase, no spawn, nothing landed.
 *   - EVERY accepted verdict appends {at, verdict, notes?} to the session
 *     dir's verdicts.json — only after a 2xx (a refused verdict never
 *     records). `notes` is optional on approve/reject, capped at the shared
 *     MAX_ANSWER_FIELD_BYTES.
 *   - authoring approve with a non-slug id → 400 naming the slug rule
 *     (never a 500 with a raw InteractiveRunnerError — library-22), phase
 *     untouched.
 *   - a SUCCESSFUL authoring finalize persists `finalized: {kind, id}` onto
 *     status.json (sessions-kinds-36 — the committed session keeps a
 *     permanent pointer at the object it produced).
 *
 * Harness mirrors cli/bridge-studio-affordances.test.ts exactly (real
 * bridge, real checked-in session-kinds.yaml, dry-bridge spawns).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { startBridge } from './ui-bridge.ts';
import { KB_SEEDING_ANCHOR_PREFIX } from './bridge-studio-kbs.ts';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-affordances-revise-'));
  for (const state of ['in-flight', 'done', 'failed', 'pending', 'ready-for-review']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'hooks'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'catalog.yaml'),
    ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []', 'community-skills: []', ''].join('\n'),
  );
  const realSessionKindsYaml = readFileSync(join(REPO_ROOT, 'studio', 'session-kinds.yaml'), 'utf8');
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), realSessionKindsYaml);

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  process.env.FORGE_DRY_BRIDGE = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  delete process.env.FORGE_DRY_BRIDGE;
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

let sessionCounter = 0;
function freshSessionId(): string {
  sessionCounter += 1;
  return `2026-08-21T00-00-${String(sessionCounter).padStart(3, '0')}-rv`;
}

function seedSession(project: string, kindDir: string, sessionId: string, status: Record<string, unknown>): string {
  const dir = join(forgeRoot, 'projects', project, kindDir, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify(status, null, 2), 'utf8');
  return dir;
}

function readPhase(sessionDir: string): string {
  return (JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as { phase: string }).phase;
}

function readStatus(sessionDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as Record<string, unknown>;
}

function readVerdicts(sessionDir: string): Array<Record<string, unknown>> {
  return JSON.parse(readFileSync(join(sessionDir, 'verdicts.json'), 'utf8')) as Array<Record<string, unknown>>;
}

function affordanceUrl(kind: string, sessionId: string, affordance: string): string {
  return `${bridgeUrl}/api/studio/sessions/${encodeURIComponent(kind)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(affordance)}`;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: CSRF, body: JSON.stringify(body) });
}

// ---------------------------------------------------------------------------
// revise — instructions (generic route parity with the bespoke
// /api/instructions/verdict revise arm)
// ---------------------------------------------------------------------------

test('C2-REV-1: instructions revise at awaiting-verdict -> 200, feedback.md written, phase -> drafting, verdict recorded', async () => {
  const project = 'c2rev1';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'awaiting-verdict', round: 2, prompt: '' });
  const res = await postJson(affordanceUrl('instructions', sessionId, 'awaiting-verdict-verdict'), {
    project, verdict: 'revise', feedback: 'Tighten the build-commands section.',
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  assert.equal(readPhase(sessionDir), 'drafting');
  assert.equal(readFileSync(join(sessionDir, 'feedback.md'), 'utf8'), 'Tighten the build-commands section.');
  const records = readVerdicts(sessionDir);
  assert.equal(records.length, 1);
  assert.equal(records[0].verdict, 'revise');
  assert.equal(typeof records[0].at, 'string');
});

test('C2-REV-2: revise with a MISSING/empty feedback -> 400 naming "feedback", nothing written, phase unchanged', async () => {
  const project = 'c2rev2';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'awaiting-verdict', round: 2, prompt: '' });
  for (const body of [{ project, verdict: 'revise' }, { project, verdict: 'revise', feedback: '   ' }]) {
    const res = await postJson(affordanceUrl('instructions', sessionId, 'awaiting-verdict-verdict'), body);
    const parsed = (await res.json()) as { error: string };
    assert.equal(res.status, 400, JSON.stringify(parsed));
    assert.match(parsed.error, /feedback/);
  }
  assert.equal(readPhase(sessionDir), 'awaiting-verdict');
  assert.equal(existsSync(join(sessionDir, 'feedback.md')), false);
  assert.equal(existsSync(join(sessionDir, 'verdicts.json')), false, 'a refused verdict must never record');
});

test('C2-REV-3: revise with an over-cap feedback -> 400 naming the byte cap', async () => {
  const project = 'c2rev3';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'awaiting-verdict', round: 2, prompt: '' });
  const res = await postJson(affordanceUrl('instructions', sessionId, 'awaiting-verdict-verdict'), {
    project, verdict: 'revise', feedback: 'x'.repeat(9 * 1024),
  });
  const body = (await res.json()) as { error: string };
  assert.equal(res.status, 400);
  assert.match(body.error, /byte|8192/i);
  assert.equal(readPhase(sessionDir), 'awaiting-verdict');
});

test('C2-REV-4: PARITY — generic revise reaches the SAME phase + feedback.md the bespoke /api/instructions/verdict revise arm reaches', async () => {
  const project = 'c2rev4';
  const bespokeId = freshSessionId();
  const genericId = freshSessionId();
  const bespokeDir = seedSession(project, '_instructions', bespokeId, { session_id: bespokeId, project, phase: 'awaiting-verdict', round: 2, prompt: '' });
  const genericDir = seedSession(project, '_instructions', genericId, { session_id: genericId, project, phase: 'awaiting-verdict', round: 2, prompt: '' });

  const bespokeRes = await postJson(`${bridgeUrl}/api/instructions/verdict`, { project, sessionId: bespokeId, kind: 'revise', feedback: 'Use pnpm.' });
  assert.equal(bespokeRes.status, 200);
  const genericRes = await postJson(affordanceUrl('instructions', genericId, 'awaiting-verdict-verdict'), { project, verdict: 'revise', feedback: 'Use pnpm.' });
  assert.equal(genericRes.status, 200);

  assert.equal(readPhase(genericDir), readPhase(bespokeDir));
  assert.equal(readPhase(genericDir), 'drafting');
  assert.equal(readFileSync(join(genericDir, 'feedback.md'), 'utf8'), readFileSync(join(bespokeDir, 'feedback.md'), 'utf8'));
});

// ---------------------------------------------------------------------------
// revise — demo (parity with the bespoke /api/demo-builder/feedback route:
// feedback.md + phase generating + iteration + 1)
// ---------------------------------------------------------------------------

test('C2-REV-5: demo revise at awaiting-review -> 200, feedback.md written, phase -> generating, iteration incremented', async () => {
  const project = 'c2rev5';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_demo', sessionId, { session_id: sessionId, project, project_repo_path: '', phase: 'awaiting-review', iteration: 2 });
  const res = await postJson(affordanceUrl('demo', sessionId, 'awaiting-review-verdict'), {
    project, verdict: 'revise', feedback: 'More contrast on the CLI capture.',
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  assert.equal(readPhase(sessionDir), 'generating');
  assert.equal(readStatus(sessionDir).iteration, 3);
  assert.equal(readFileSync(join(sessionDir, 'feedback.md'), 'utf8'), 'More contrast on the CLI capture.');
});

// ---------------------------------------------------------------------------
// revise + reject — authoring (library-24, sessions-kinds-23)
// ---------------------------------------------------------------------------

test('C2-REV-6: authoring revise at awaiting-review -> 200, feedback.md written, phase -> analyzing (a real revise turn), no id required', async () => {
  const project = 'c2rev6';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_authoring', sessionId, { session_id: sessionId, project, phase: 'awaiting-review' });
  mkdirSync(join(sessionDir, 'staging'), { recursive: true });
  writeFileSync(join(sessionDir, 'staging', 'SKILL.md'), '---\nname: Draft\ndescription: fixture\n---\n\nBody.\n', 'utf8');
  const res = await postJson(affordanceUrl('authoring', sessionId, 'awaiting-review-verdict'), {
    project, verdict: 'revise', feedback: 'Rename the tool section and add an example.',
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200 (requires:[id] is APPROVE-scoped — revise needs no id), got ${res.status}: ${text}`);
  assert.equal(readPhase(sessionDir), 'analyzing');
  assert.equal(readFileSync(join(sessionDir, 'feedback.md'), 'utf8'), 'Rename the tool section and add an example.');
});

test('C2-REV-7: authoring reject at awaiting-review -> 200, phase -> rejected (terminal), nothing landed, verdict recorded with notes', async () => {
  const project = 'c2rev7';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_authoring', sessionId, { session_id: sessionId, project, phase: 'awaiting-review' });
  mkdirSync(join(sessionDir, 'staging'), { recursive: true });
  writeFileSync(join(sessionDir, 'staging', 'SKILL.md'), '---\nname: Unwanted\ndescription: fixture\n---\n\nBody.\n', 'utf8');
  const res = await postJson(affordanceUrl('authoring', sessionId, 'awaiting-review-verdict'), {
    project, verdict: 'reject', notes: 'Not needed after all.',
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  assert.equal(readPhase(sessionDir), 'rejected');
  const records = readVerdicts(sessionDir);
  assert.equal(records.length, 1);
  assert.equal(records[0].verdict, 'reject');
  assert.equal(records[0].notes, 'Not needed after all.');
});

// ---------------------------------------------------------------------------
// revise + reject — kb-cleanup
// ---------------------------------------------------------------------------

test('C2-REV-8: kb-cleanup revise at awaiting-approval -> 200, feedback.md written, phase -> drafting', async () => {
  const kbId = 'c2-cleanup-kb-1';
  const kbDir = join(forgeRoot, 'brain', kbId);
  mkdirSync(join(kbDir, 'themes'), { recursive: true });
  mkdirSync(join(kbDir, '_raw'), { recursive: true });
  writeFileSync(join(kbDir, 'kb.yaml'), `id: ${kbId}\nname: Fixture KB\nbinding: { kind: unique }\ndesc: C2 fixture.\n`, 'utf8');
  const project = `${KB_SEEDING_ANCHOR_PREFIX}${kbId}`;
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_kb-cleanup', sessionId, {
    session_id: sessionId, project, phase: 'awaiting-approval', kb_id: kbId, kb_binding: { kind: 'unique' }, findings: [],
  });
  const res = await postJson(affordanceUrl('kb-cleanup', sessionId, 'awaiting-approval-verdict'), {
    project, verdict: 'revise', feedback: 'Merge the two dedupe actions into one.',
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  assert.equal(readPhase(sessionDir), 'drafting');
  assert.equal(readFileSync(join(sessionDir, 'feedback.md'), 'utf8'), 'Merge the two dedupe actions into one.');
});

test('C2-REV-9: kb-cleanup reject at awaiting-approval -> 200, phase -> rejected (the old 422 refusal is gone)', async () => {
  const kbId = 'c2-cleanup-kb-2';
  const kbDir = join(forgeRoot, 'brain', kbId);
  mkdirSync(join(kbDir, 'themes'), { recursive: true });
  mkdirSync(join(kbDir, '_raw'), { recursive: true });
  writeFileSync(join(kbDir, 'kb.yaml'), `id: ${kbId}\nname: Fixture KB\nbinding: { kind: unique }\ndesc: C2 fixture.\n`, 'utf8');
  const project = `${KB_SEEDING_ANCHOR_PREFIX}${kbId}`;
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_kb-cleanup', sessionId, {
    session_id: sessionId, project, phase: 'awaiting-approval', kb_id: kbId, kb_binding: { kind: 'unique' }, findings: [],
  });
  const res = await postJson(affordanceUrl('kb-cleanup', sessionId, 'awaiting-approval-verdict'), { project, verdict: 'reject' });
  assert.equal(res.status, 200);
  assert.equal(readPhase(sessionDir), 'rejected');
});

// ---------------------------------------------------------------------------
// revise — community-refresh
// ---------------------------------------------------------------------------

test('C2-REV-10: community-refresh revise at awaiting-review -> 200, feedback.md written, phase -> gathering', async () => {
  const project = '.community-registry';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_community-refresh', sessionId, { session_id: sessionId, project, phase: 'awaiting-review' });
  mkdirSync(join(sessionDir, 'staging'), { recursive: true });
  writeFileSync(join(sessionDir, 'staging', 'registry.yaml'), 'skills: []\n', 'utf8');
  const res = await postJson(affordanceUrl('community-refresh', sessionId, 'awaiting-review-verdict'), {
    project, verdict: 'revise', feedback: 'Drop the unverified entries.',
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  assert.equal(readPhase(sessionDir), 'gathering');
  assert.equal(readFileSync(join(sessionDir, 'feedback.md'), 'utf8'), 'Drop the unverified entries.');
});

// ---------------------------------------------------------------------------
// notes — the rationale record (sessions-kinds-29)
// ---------------------------------------------------------------------------

test('C2-NOTES-1: instructions approve with notes -> 200 and verdicts.json records {verdict:approve, notes}', async () => {
  const project = 'c2notes1';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'awaiting-verdict', round: 2, prompt: '' });
  const res = await postJson(affordanceUrl('instructions', sessionId, 'awaiting-verdict-verdict'), {
    project, verdict: 'approve', notes: 'Reads exactly like our house style.',
  });
  assert.equal(res.status, 200);
  assert.equal(readPhase(sessionDir), 'finalizing');
  const records = readVerdicts(sessionDir);
  assert.equal(records.length, 1);
  assert.equal(records[0].verdict, 'approve');
  assert.equal(records[0].notes, 'Reads exactly like our house style.');
});

test('C2-NOTES-2: notes over the byte cap -> 400, phase unchanged, nothing recorded', async () => {
  const project = 'c2notes2';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'awaiting-verdict', round: 2, prompt: '' });
  const res = await postJson(affordanceUrl('instructions', sessionId, 'awaiting-verdict-verdict'), {
    project, verdict: 'reject', notes: 'x'.repeat(9 * 1024),
  });
  const body = (await res.json()) as { error: string };
  assert.equal(res.status, 400);
  assert.match(body.error, /notes/);
  assert.equal(readPhase(sessionDir), 'awaiting-verdict');
  assert.equal(existsSync(join(sessionDir, 'verdicts.json')), false);
});

test('C2-NOTES-3: a REFUSED verdict (wrong phase, 409) never records to verdicts.json', async () => {
  const project = 'c2notes3';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'interviewing', round: 1, prompt: '' });
  const res = await postJson(affordanceUrl('instructions', sessionId, 'awaiting-verdict-verdict'), { project, verdict: 'approve', notes: 'n' });
  assert.equal(res.status, 409);
  assert.equal(existsSync(join(sessionDir, 'verdicts.json')), false);
});

// ---------------------------------------------------------------------------
// authoring slug validation (library-22) + finalized persistence
// (sessions-kinds-36)
// ---------------------------------------------------------------------------

test('C2-SLUG-1: authoring approve with a non-slug id -> 400 (never 500), an operator-readable message, phase untouched', async () => {
  const project = 'c2slug1';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_authoring', sessionId, { session_id: sessionId, project, phase: 'awaiting-review' });
  mkdirSync(join(sessionDir, 'staging'), { recursive: true });
  writeFileSync(join(sessionDir, 'staging', 'SKILL.md'), '---\nname: Bad Id Probe\ndescription: fixture\n---\n\nBody.\n', 'utf8');
  const res = await postJson(affordanceUrl('authoring', sessionId, 'awaiting-review-verdict'), {
    project, verdict: 'approve', id: 'W7 Throwaway Authored!!',
  });
  const text = await res.text();
  assert.equal(res.status, 400, `expected 400, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { error: string };
  assert.ok(!/InteractiveRunnerError|runInteractiveTurn/.test(body.error), `the internal error class must never reach the operator, got: ${body.error}`);
  assert.match(body.error, /lowercase|slug|a-z/i, `expected an operator-readable id rule, got: ${body.error}`);
  assert.equal(readPhase(sessionDir), 'awaiting-review');
});

test('C2-FIN-1: a successful authoring finalize persists finalized {kind, id} onto status.json', async () => {
  const project = 'c2fin1';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_authoring', sessionId, { session_id: sessionId, project, phase: 'awaiting-review' });
  mkdirSync(join(sessionDir, 'staging'), { recursive: true });
  writeFileSync(join(sessionDir, 'staging', 'SKILL.md'), '---\nname: C2 Finalized Skill\ndescription: fixture\n---\n\nBody.\n', 'utf8');
  const res = await postJson(affordanceUrl('authoring', sessionId, 'awaiting-review-verdict'), {
    project, verdict: 'approve', id: 'c2-finalized-skill',
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const status = readStatus(sessionDir);
  assert.deepEqual(status.finalized, { kind: 'skill', id: 'c2-finalized-skill' });
  assert.equal(readPhase(sessionDir), 'committed');
});
