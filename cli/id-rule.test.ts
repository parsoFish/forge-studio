/**
 * W7-A4 — the ONE id rule for projects and knowledge bases (findings
 * knowledge-03, crosscut-11, home-sessions-16, projects-02, projects-34,
 * projects-30, crosscut-20; bead forge-9bd).
 *
 * Rule: a project id IS its on-disk directory name and a KB id IS its
 * kb.yaml `id` (== its directory name) — case-preserving, matched exactly,
 * end to end: discovery, the roster, every `:id` route, every validator.
 * `trafficGame` (a real project + KB in this install) must be reachable
 * everywhere the roster lists it, and a project must auto-bind the KB whose
 * `binding.ref` names it. The literal id `new` is reserved on every create
 * route (the UI's `/x/new` builder segment must never collide with a real
 * object).
 *
 * Wrong implementations these pins kill:
 *   - discovery lowercases the dir name (the old `normalizeProjectId`) while
 *     the `:id` routes re-join the raw id → `trafficGame` listed as
 *     `trafficgame`, every per-project route 404s (projects-02);
 *   - per-KB routes gate on the lowercase-kebab `SLUG_RE` while the roster
 *     lists whatever kb.yaml says → `trafficGame` listed, every detail route
 *     400s (knowledge-03 / crosscut-11 / home-sessions-16);
 *   - project↔KB binding compared across two normalisations (projects-34);
 *   - a create route accepting the id `new` (projects-30 / crosscut-20).
 *
 * RUN: node --test --experimental-strip-types cli/id-rule.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { discoverProjects, normalizeProjectId } from '../orchestrator/studio/registry.ts';
import { PROJECT_ID_RE, KB_ID_RE, isReservedId } from '../orchestrator/studio/validate.ts';
import { invalidProjectReason } from './bridge-studio-sessions.ts';
import { deriveContractStages } from './contract-stages.ts';
import { buildProjectSavePayload } from '../forge-ui/lib/project-save-payload.ts';
import { unroutableKbReason, unroutableKbs } from './kb-sites.ts';

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

const PROJECT_JSON = JSON.stringify({
  name: 'trafficGame',
  northStar: 'A traffic game.',
  testProcess: { local: { cmd: ['npm', 'test'] } },
}, null, 2);

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'id-rule-'));
  for (const state of ['in-flight', 'done', 'failed', 'pending', 'ready-for-review']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  // A mixed-case project dir (the real install's trafficGame shape).
  mkdirSync(join(forgeRoot, 'projects', 'trafficGame', '.forge'), { recursive: true });
  writeFileSync(join(forgeRoot, 'projects', 'trafficGame', '.forge', 'project.json'), PROJECT_JSON);
  // A lowercase sibling so exact-match (not case-insensitive) is provable.
  mkdirSync(join(forgeRoot, 'projects', 'gitpulse', '.forge'), { recursive: true });
  writeFileSync(join(forgeRoot, 'projects', 'gitpulse', '.forge', 'project.json'), PROJECT_JSON.replace('trafficGame', 'gitpulse'));
  // A dir whose name can never be a routable id — must not surface as a project.
  mkdirSync(join(forgeRoot, 'projects', 'bad name'), { recursive: true });

  // W7-FIX-A4 (W7A4-04): a kb.yaml whose id is NOT its directory name — a
  // valid id per KB_ID_RE, so validateKb is silent — binding project gitpulse.
  // No route can resolve it (routes join brain/**/<id>/), so it must not be
  // listed AND must not derive gitpulse's binding — but it must be DIAGNOSED.
  mkdirSync(join(forgeRoot, 'brain', 'projects', 'gitpulse'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'brain', 'projects', 'gitpulse', 'kb.yaml'),
    'id: gitpulse-brain\nname: gitpulse (project)\nbinding:\n  kind: project\n  ref: gitpulse\ndesc: Mismatched id.\nbackend: filesystem\n',
  );

  // The matching central per-project KB (ADR 035): brain/projects/trafficGame/kb.yaml
  mkdirSync(join(forgeRoot, 'brain', 'projects', 'trafficGame', 'themes'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'brain', 'projects', 'trafficGame', 'kb.yaml'),
    'id: trafficGame\nname: trafficGame (project)\nbinding:\n  kind: project\n  ref: trafficGame\ndesc: Per-project brain for trafficGame.\nbackend: filesystem\n',
  );

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${bridgeUrl}${path}`);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function send(method: string, path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

// ---------------------------------------------------------------------------
// 1. The predicate itself — one regex, case-preserving, path-safe.
// ---------------------------------------------------------------------------

test('PROJECT_ID_RE / KB_ID_RE: accept real-world case-preserving ids, reject every path-shaped or flag-shaped string', () => {
  const accept = ['trafficGame', 'terraform-provider-betterado', 'gitpulse', 'My_Project', 'a1', 'forge-dev', 'cycles'];
  const reject = ['', '../x', 'a/b', 'a\\b', '.hidden', '-flag', 'a b', 'a.b', 'a:b', 'ünïcode', '..'];
  for (const id of accept) {
    assert.ok(PROJECT_ID_RE.test(id), `PROJECT_ID_RE must accept "${id}"`);
    assert.ok(KB_ID_RE.test(id), `KB_ID_RE must accept "${id}"`);
  }
  for (const id of reject) {
    assert.ok(!PROJECT_ID_RE.test(id), `PROJECT_ID_RE must reject ${JSON.stringify(id)}`);
    assert.ok(!KB_ID_RE.test(id), `KB_ID_RE must reject ${JSON.stringify(id)}`);
  }
});

test('isReservedId: "new" (any case) is reserved; ordinary ids are not', () => {
  assert.equal(isReservedId('new'), true);
  assert.equal(isReservedId('New'), true);
  assert.equal(isReservedId('NEW'), true);
  assert.equal(isReservedId('newish'), false);
  assert.equal(isReservedId('trafficGame'), false);
});

// ---------------------------------------------------------------------------
// 2. Discovery publishes the directory name verbatim — never a lowercased copy.
// ---------------------------------------------------------------------------

test('discoverProjects: id === directory name (case-preserving); an un-routable dir name is not a project', () => {
  const found = discoverProjects(join(forgeRoot, 'projects'), forgeRoot);
  const ids = found.map((p) => p.id);
  assert.ok(ids.includes('trafficGame'), `expected verbatim "trafficGame" in ${JSON.stringify(ids)}`);
  assert.ok(!ids.includes('trafficgame'), 'the lowercased copy must NOT be published');
  assert.ok(!ids.some((id) => id.includes(' ')), `"bad name" must never surface as a project (got ${JSON.stringify(ids)})`);
  const tg = found.find((p) => p.id === 'trafficGame')!;
  assert.equal(tg.path, 'projects/trafficGame');
  assert.ok(tg.absPath.endsWith('/projects/trafficGame'));
});

test('normalizeProjectId: identity for any id that already satisfies the rule (no lowercasing)', () => {
  assert.equal(normalizeProjectId('trafficGame'), 'trafficGame');
  assert.equal(normalizeProjectId('My_Project'), 'My_Project');
  assert.equal(normalizeProjectId('gitpulse'), 'gitpulse');
});

// ---------------------------------------------------------------------------
// 3. Every validator agrees with discovery.
// ---------------------------------------------------------------------------

test('invalidProjectReason (session routes, forge-9bd): accepts "trafficGame"; still rejects traversal shapes', () => {
  assert.equal(invalidProjectReason('trafficGame'), null);
  assert.equal(invalidProjectReason('terraform-provider-betterado'), null);
  assert.notEqual(invalidProjectReason('../x'), null);
  assert.notEqual(invalidProjectReason('a/b'), null);
  assert.notEqual(invalidProjectReason('.hidden'), null);
});

test('W7A4-02: invalidProjectReason accepts the `.kb-<id>` seeding anchor for EVERY KB_ID_RE-valid id (mixed case, digit-leading, underscore) — the anchor charset IS the KB id rule', () => {
  // The create route (POST /api/studio/kbs) validates the id with KB_ID_RE, and
  // the seeding/cleanup sessions anchor under projects/.kb-<that id>/ — so the
  // anchor gate must accept exactly what KB_ID_RE accepts, or those sessions
  // are unreachable via BOTH ?project= and the bare deep link.
  for (const kbId of ['MyNotes', '2026-notes', 'trafficGame', 'My_KB', 'seedkb']) {
    assert.ok(KB_ID_RE.test(kbId), `precondition: KB_ID_RE accepts "${kbId}"`);
    assert.equal(invalidProjectReason(`.kb-${kbId}`), null, `.kb-${kbId} must be a valid seeding anchor`);
  }
  // …and rejects exactly what KB_ID_RE rejects — the carve-out widens case,
  // never path safety (traversal / empty / nested / dot / flag shapes).
  for (const bad of ['', '../x', 'a/b', 'a\\b', '.hidden', '-flag', 'a b', 'x\u0000y']) {
    assert.notEqual(invalidProjectReason(`.kb-${bad}`), null, `.kb-${JSON.stringify(bad)} must be rejected`);
  }
  // The rejection message names the KB id rule it enforces, not the retired SLUG_RE.
  const reason = invalidProjectReason('.kb-a/b');
  assert.ok(reason !== null && reason.includes(String(KB_ID_RE)), `reason must cite KB_ID_RE, got: ${reason}`);
});

test('deriveContractStages: resolves a mixed-case project id (projects-02)', () => {
  const r = deriveContractStages({ forgeRoot, projectsRoot: join(forgeRoot, 'projects'), projectId: 'trafficGame' });
  assert.equal(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
  const lower = deriveContractStages({ forgeRoot, projectsRoot: join(forgeRoot, 'projects'), projectId: 'trafficgame' });
  assert.equal(lower.ok, false, 'exact match: the lowercased id is NOT the project');
});

// ---------------------------------------------------------------------------
// 4. Roster ↔ routes agree over the wire (the walkthrough's actual repro).
// ---------------------------------------------------------------------------

test('roster: GET /api/studio/projects lists "trafficGame" verbatim and auto-binds the KB whose binding.ref names it (projects-34)', async () => {
  const r = await get('/api/studio/projects');
  assert.equal(r.status, 200);
  const ids = r.body.projects.map((p: any) => p.id);
  assert.ok(ids.includes('trafficGame'), `roster ids: ${JSON.stringify(ids)}`);
  assert.ok(!ids.includes('trafficgame'));
  const tg = r.body.projects.find((p: any) => p.id === 'trafficGame');
  assert.equal(tg.kb, 'trafficGame', 'project.json has no kb — the KB bound to this project must be DERIVED from kb.yaml binding.ref');
  const gp = r.body.projects.find((p: any) => p.id === 'gitpulse');
  assert.equal(gp.kb, undefined, 'a project no KB binds to has no kb (derive, never invent)');
});

test('W7A4-03 (RED on main): the editor\'s Save of an UNTOUCHED derived binding never writes `kb` into project.json — the derivation stays live', async () => {
  const projectJsonPath = join(forgeRoot, 'projects', 'trafficGame', '.forge', 'project.json');
  assert.ok(!('kb' in JSON.parse(readFileSync(projectJsonPath, 'utf8'))), 'precondition: no stored kb');

  // The roster hands the editor the DERIVED kb; the operator edits only the north
  // star and presses Save. This is exactly the payload page.tsx sends.
  const roster = await get('/api/studio/projects');
  const tg = roster.body.projects.find((p: any) => p.id === 'trafficGame');
  assert.equal(tg.kb, 'trafficGame', 'precondition: the roster serves the derived binding');
  const untouched = buildProjectSavePayload({
    name: tg.name, northStar: 'A traffic game, now with a north star edit.', instructions: '',
    demoProcess: [], skills: [], kb: tg.kb ?? null, kbTouched: false,
  });
  const r1 = await send('PUT', '/api/studio/projects/trafficGame', untouched);
  assert.equal(r1.status, 200, `PUT → ${r1.status} ${JSON.stringify(r1.body)}`);
  const afterUntouched = JSON.parse(readFileSync(projectJsonPath, 'utf8'));
  assert.equal(afterUntouched.northStar, 'A traffic game, now with a north star edit.');
  assert.ok(!('kb' in afterUntouched), `an untouched binding must NOT be stored — project.json now carries kb=${JSON.stringify(afterUntouched.kb)}`);
  const roster2 = await get('/api/studio/projects');
  assert.equal(roster2.body.projects.find((p: any) => p.id === 'trafficGame').kb, 'trafficGame', 'still derived after the save');

  // An EXPLICIT rebind by the operator IS stored (that is the one legitimate write).
  const touched = buildProjectSavePayload({
    name: tg.name, northStar: 'A traffic game.', instructions: '', demoProcess: [], skills: [],
    kb: 'trafficGame', kbTouched: true,
  });
  const r2 = await send('PUT', '/api/studio/projects/trafficGame', touched);
  assert.equal(r2.status, 200, `PUT(touched) → ${r2.status} ${JSON.stringify(r2.body)}`);
  const afterTouched = JSON.parse(readFileSync(projectJsonPath, 'utf8'));
  assert.equal(afterTouched.kb, 'trafficGame', 'an explicit operator rebind is written');
  // Restore the fixture for the tests below (no stored kb).
  writeFileSync(projectJsonPath, PROJECT_JSON);
});

test('per-project routes: every :id route the walkthrough saw 404/400 now resolves "trafficGame" (projects-02)', async () => {
  const preflight = await get('/api/studio/projects/trafficGame/preflight');
  assert.equal(preflight.status, 200, `preflight → ${preflight.status} ${JSON.stringify(preflight.body)}`);
  const contract = await get('/api/studio/projects/trafficGame/contract-stages');
  assert.equal(contract.status, 200, `contract-stages → ${contract.status} ${JSON.stringify(contract.body)}`);
  assert.equal(contract.body.project, 'trafficGame');
  const roadmap = await get('/api/studio/projects/trafficGame/roadmap');
  assert.equal(roadmap.status, 200, `roadmap → ${roadmap.status}`);
  const repoStatus = await get('/api/studio/projects/trafficGame/repo-status');
  assert.equal(repoStatus.status, 200, `repo-status → ${repoStatus.status}`);
  const onboardingActive = await get('/api/studio/projects/trafficGame/onboarding/active');
  assert.notEqual(onboardingActive.status, 400, `onboarding/active must not reject the id: ${JSON.stringify(onboardingActive.body)}`);
  assert.notEqual(onboardingActive.status, 404, `onboarding/active must resolve the project: ${JSON.stringify(onboardingActive.body)}`);
});

test('per-project routes: exact match — the lowercased id is unknown (404), never silently resolved', async () => {
  const preflight = await get('/api/studio/projects/trafficgame/preflight');
  assert.equal(preflight.status, 404, `preflight(trafficgame) → ${preflight.status}`);
});

test('generic session route: project=trafficGame is a valid project (404 unknown session, NOT 400 invalid project) — forge-9bd', async () => {
  const r = await get('/api/studio/sessions/demo/2026-01-01T00-00-00-0000abcd?project=trafficGame');
  assert.notEqual(r.status, 400, `got 400: ${JSON.stringify(r.body)}`);
});

test('W7A4-04: unroutableKbReason is the ONE predicate — null iff id === dir AND id passes KB_ID_RE', () => {
  assert.equal(unroutableKbReason('trafficGame', 'trafficGame'), null);
  assert.equal(unroutableKbReason('gitpulse', 'gitpulse'), null);
  assert.match(unroutableKbReason('gitpulse-brain', 'gitpulse') ?? '', /gitpulse-brain.*"gitpulse"/);
  assert.match(unroutableKbReason('trafficgame', 'trafficGame') ?? '', /trafficgame/, 'case matters — exact match');
  assert.notEqual(unroutableKbReason('bad id', 'bad id'), null, 'an id failing KB_ID_RE is unroutable even when it equals its dir');
});

test('W7A4-04 (RED on main): the roster DIAGNOSES a dropped descriptor — GET /api/studio/kbs returns `unroutable[]` naming dir + id + reason; the KB is neither listed nor bound', async () => {
  const local = unroutableKbs(forgeRoot);
  assert.equal(local.length, 1, `expected exactly the gitpulse fixture, got ${JSON.stringify(local)}`);
  assert.equal(local[0].dir, 'gitpulse');
  assert.equal(local[0].id, 'gitpulse-brain');
  assert.match(local[0].reason, /gitpulse-brain/);

  const list = await get('/api/studio/kbs');
  assert.equal(list.status, 200);
  const ids = list.body.kbs.map((k: any) => k.id);
  assert.ok(!ids.includes('gitpulse-brain') && !ids.includes('gitpulse'), `a mismatched descriptor is not listed: ${JSON.stringify(ids)}`);
  assert.ok(Array.isArray(list.body.unroutable), `roster must carry an unroutable[] diagnostic, got keys ${JSON.stringify(Object.keys(list.body))}`);
  assert.deepEqual(list.body.unroutable.map((u: any) => [u.dir, u.id]), [['gitpulse', 'gitpulse-brain']]);
  assert.match(String(list.body.unroutable[0].reason), /gitpulse-brain/);

  const roster = await get('/api/studio/projects');
  const gp = roster.body.projects.find((p: any) => p.id === 'gitpulse');
  assert.equal(gp.kb, undefined, 'a mismatched (unroutable) KB never derives a project binding');
});

test('per-KB routes: GET /api/studio/kbs lists "trafficGame" AND every per-KB route accepts it (knowledge-03 / crosscut-11 / home-sessions-16)', async () => {
  const list = await get('/api/studio/kbs');
  assert.equal(list.status, 200);
  const ids = list.body.kbs.map((k: any) => k.id);
  assert.ok(ids.includes('trafficGame'), `kb ids: ${JSON.stringify(ids)}`);

  const detail = await get('/api/studio/kbs/trafficGame');
  assert.equal(detail.status, 200, `GET kbs/trafficGame → ${detail.status} ${JSON.stringify(detail.body)}`);
  assert.equal(detail.body.kb.id, 'trafficGame');

  const drain = await get('/api/studio/kbs/trafficGame/drain');
  assert.notEqual(drain.status, 400, `drain → ${drain.status} ${JSON.stringify(drain.body)}`);
  const consolidate = await get('/api/studio/kbs/trafficGame/consolidate/active');
  assert.notEqual(consolidate.status, 400, `consolidate/active → ${consolidate.status} ${JSON.stringify(consolidate.body)}`);
  const maint = await get('/api/studio/kbs/trafficGame/maintenance');
  assert.notEqual(maint.status, 400, `maintenance → ${maint.status} ${JSON.stringify(maint.body)}`);
  const ingest = await get('/api/studio/kbs/trafficGame/ingest-activity');
  assert.notEqual(ingest.status, 400, `ingest-activity → ${ingest.status} ${JSON.stringify(ingest.body)}`);
});

test('per-KB routes: traversal shapes are still refused (the rule widens case, not path safety)', async () => {
  const dot = await get('/api/studio/kbs/..%2Fforge-dev');
  assert.equal(dot.status, 400, `..%2F → ${dot.status}`);
  const hidden = await get('/api/studio/kbs/.hidden');
  assert.equal(hidden.status, 400, `.hidden → ${hidden.status}`);
  const projectDot = await get('/api/studio/projects/..%2Fx/preflight');
  assert.equal(projectDot.status, 400, `projects/..%2Fx → ${projectDot.status}`);
});

// ---------------------------------------------------------------------------
// 5. Reserved "new" on every create route (projects-30 / crosscut-20).
// ---------------------------------------------------------------------------

test('reserved id: POST /api/studio/projects refuses an object that would be named "new"', async () => {
  const r = await send('POST', '/api/studio/projects', { name: 'New', qualityGateCmd: 'npm test', northStar: 'x' });
  assert.equal(r.status, 400, `expected 400, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.match(String(r.body.error), /reserved/i);
  const found = discoverProjects(join(forgeRoot, 'projects'), forgeRoot).map((p) => p.id);
  assert.ok(!found.includes('new'), 'no projects/new directory may have been created');
});

test('reserved id: POST /api/studio/kbs refuses id "new"', async () => {
  const r = await send('POST', '/api/studio/kbs', { id: 'new', name: 'New KB', desc: 'd', binding: { kind: 'unique' } });
  assert.equal(r.status, 400, `expected 400, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.match(String(r.body.error), /reserved/i);
});

test('reserved id: PUT /api/studio/agents/new and PUT /api/studio/flows/new are refused', async () => {
  const agent = await send('PUT', '/api/studio/agents/new', { name: 'New', description: 'd', body: '# x' });
  assert.equal(agent.status, 400, `agents/new → ${agent.status} ${JSON.stringify(agent.body)}`);
  assert.match(String(agent.body.error), /reserved/i);
  const flow = await send('PUT', '/api/studio/flows/new', { name: 'New', nodes: [], edges: [] });
  assert.equal(flow.status, 400, `flows/new → ${flow.status} ${JSON.stringify(flow.body)}`);
  assert.match(String(flow.body.error), /reserved/i);
});

test('reserved id: POST /api/studio/skills and POST /api/studio/hooks refuse a slug that derives to "new"', async () => {
  const skill = await send('POST', '/api/studio/skills', { name: 'New', description: 'd', body: 'x' });
  assert.equal(skill.status, 400, `skills → ${skill.status} ${JSON.stringify(skill.body)}`);
  assert.match(String(skill.body.error), /reserved/i);
  const hook = await send('POST', '/api/studio/hooks', { name: 'New', description: 'd', on: 'PreToolUse', scriptBody: 'echo hi' });
  assert.equal(hook.status, 400, `hooks → ${hook.status} ${JSON.stringify(hook.body)}`);
  assert.match(String(hook.body.error), /reserved/i);
});
