/**
 * Acceptance tests for cli/bridge-studio-sessions.ts (R2-10, PR1: the
 * session-shell backend contract).
 *
 * The module under test does not exist yet — this file is RED at branch base
 * (ERR_MODULE_NOT_FOUND on the `./bridge-studio-sessions.ts` import is the
 * expected red). Mirrors cli/bridge-studio-templates.test.ts's idiom: a real
 * bridge (startBridge) + fetch for the "happy" behavioral tests, plus direct
 * handler invocation for the passthrough contract AND the slug-validation
 * sweep (see the design-decision note below on why the sweep needs direct
 * invocation).
 *
 * AT numbers continue the flat R2-10 sequence started in
 * orchestrator/studio/session-kinds.test.ts (AT-1..AT-18) and continued in
 * orchestrator/studio/session-transcript.test.ts (AT-19..AT-37). This file
 * covers AT-38..AT-48.
 *
 * Design decisions this file pins:
 *
 *   - `sessionId` is validated with SAFE_ID_RE (cli/bridge-studio.ts), NOT
 *     SLUG_RE — real session ids are ISO-ish timestamps
 *     (`2026-08-05T10-00-00`) with an uppercase `T`, which SLUG_RE (strict
 *     lowercase-kebab) rejects. `project` is validated with SLUG_RE. This
 *     mirrors the EXACT precedent in cli/bridge-studio-runs.ts's plan-verdict
 *     route ("project uses SLUG_RE ... sessionId uses SAFE_ID_RE").
 *   - The slug-validation variant sweep (AT-45/AT-46) uses DIRECT handler
 *     invocation, not real fetch() calls. Several required variants (a bare
 *     `..` path segment, an embedded null byte, a leading `/`) never survive
 *     a real HTTP client: WHATWG URL / undici's fetch() normalizes
 *     dot-segments client-side (a literal `..` segment gets collapsed away
 *     BEFORE the request is ever sent, so the server never sees it) and
 *     throws client-side on a raw NUL byte. Direct invocation hands the
 *     handler the exact raw `rawUrl` string a misbehaving/malicious HTTP
 *     client (or a proxy that does its own un-normalized forwarding) could
 *     produce, which is the only way to actually exercise the server-side
 *     guard for those variants.
 *   - `phase` in the response body is a passthrough of the session's
 *     `status.json.phase` field — not reinterpreted or validated against a
 *     closed vocabulary here (each runner owns its own phase enum).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import yaml from 'js-yaml';

import { startBridge } from './ui-bridge.ts';
import { handleStudioSessionsRoutes } from './bridge-studio-sessions.ts';
import type { StudioContext } from './bridge-studio.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

const REAL_ARCHITECT_SESSION = '2026-08-01T10-00-00';
const REAL_INSTRUCTIONS_SESSION = '2026-08-02T11-00-00';
const REAL_PROJECT_BRAIN_SESSION = '2026-08-03T12-00-00';
const BADSTAGE_SESSION = '2026-08-04T13-00-00';
const VICTIM_SESSION = '2026-08-05T14-00-00';
const SECRET_MARKER = 'TOP-SECRET-BRIDGE-ESCAPE-MARKER-4471';

function writeSkillAgent(root: string, slug: string, opts: { libraryFalse?: boolean } = {}): void {
  const dir = join(root, 'skills', slug);
  mkdirSync(dir, { recursive: true });
  const data: Record<string, unknown> = {
    name: slug,
    description: `Fixture agent ${slug}.`,
    purpose: 'Fixture purpose.',
    composition: { skills: [], tools: [], mcps: [], guards: [] },
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
    brainAccess: 'none',
    interactivity: 'Fixture.',
    'allowed-tools': [],
    'disallowed-tools': [],
    budgets: {},
  };
  if (opts.libraryFalse) data.library = false;
  writeFileSync(join(dir, 'SKILL.md'), matter.stringify('\nFixture body.\n', data), 'utf8');
}

function writeSessionKindsYaml(root: string): void {
  const dir = join(root, 'studio');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'session-kinds.yaml'),
    yaml.dump([
      {
        id: 'architect',
        agent: 'architect',
        title: 'Architect',
        legacyRoutes: ['/architect/[sessionId]', '/architect/[sessionId]/interview'],
        stages: ['roadmap'],
        defaultStage: 'roadmap',
        artifact: { kind: 'roadmap-draft', label: 'Roadmap draft' },
      },
      {
        id: 'instructions',
        agent: 'instructions-creator',
        title: 'Instructions',
        legacyRoutes: ['/instructions/[sessionId]'],
        stages: ['instructions'],
        defaultStage: 'instructions',
        artifact: { kind: 'markdown-draft', label: 'AGENTS.md draft' },
      },
      {
        id: 'project-brain',
        agent: 'project-brain-builder',
        title: 'Project Brain',
        legacyRoutes: ['/project-brain/[sessionId]'],
        stages: ['brain'],
        defaultStage: 'brain',
        artifact: { kind: 'brain-structure', label: 'Seeded structure' },
      },
    ]),
    'utf8',
  );
}

function writeArchitectSession(projectsRoot: string, project: string, sessionId: string): void {
  const dir = join(projectsRoot, project, '_architect', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'idea.md'), 'Build a fixture thing.\n', 'utf8');
  writeFileSync(join(dir, 'answers.json'), JSON.stringify([{ round: 1, answers: [{ question: 'Q?', answer: 'A.' }] }]), 'utf8');
  mkdirSync(join(dir, 'manifests'), { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'awaiting-verdict' }), 'utf8');
}

function writeInstructionsSession(projectsRoot: string, project: string, sessionId: string): void {
  const dir = join(projectsRoot, project, '_instructions', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.md'), 'Author AGENTS.md.\n', 'utf8');
  writeFileSync(join(dir, 'AGENTS.draft.md'), '# AGENTS.md\n\nDraft body.\n', 'utf8');
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'drafting' }), 'utf8');
}

function writeProjectBrainSession(projectsRoot: string, project: string, sessionId: string): void {
  const dir = join(projectsRoot, project, '_project-brain', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.md'), 'Seed the brain.\n', 'utf8');
  mkdirSync(join(dir, 'themes'), { recursive: true });
  writeFileSync(join(dir, 'themes', 'alpha.md'), '# Alpha\n', 'utf8');
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'analyzing' }), 'utf8');
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-sessions-'));
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'catalog.yaml'),
    ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []', 'community-skills: []', ''].join('\n'),
  );
  writeSessionKindsYaml(forgeRoot);
  writeSkillAgent(forgeRoot, 'architect');
  writeSkillAgent(forgeRoot, 'instructions-creator', { libraryFalse: true });
  writeSkillAgent(forgeRoot, 'project-brain-builder', { libraryFalse: true });

  const projectsRoot = join(forgeRoot, 'projects');
  writeArchitectSession(projectsRoot, 'demoproj', REAL_ARCHITECT_SESSION);
  writeInstructionsSession(projectsRoot, 'demoproj', REAL_INSTRUCTIONS_SESSION);
  writeProjectBrainSession(projectsRoot, 'demoproj', REAL_PROJECT_BRAIN_SESSION);

  // Fail-closed fixture: a round carrying a stage marker outside the
  // architect descriptor's declared stages (['roadmap']).
  const badStageDir = join(projectsRoot, 'badstageproj', '_architect', BADSTAGE_SESSION);
  mkdirSync(badStageDir, { recursive: true });
  writeFileSync(
    join(badStageDir, 'answers.json'),
    JSON.stringify([{ round: 1, stage: 'no-such-stage', answers: [{ question: 'Q?', answer: 'A.' }] }]),
    'utf8',
  );
  writeFileSync(join(badStageDir, 'status.json'), JSON.stringify({ session_id: BADSTAGE_SESSION, project: 'badstageproj', phase: 'awaiting-verdict' }), 'utf8');

  // Escape fixture: a REAL victim session holding a secret, and an
  // ATTACKER project whose `_architect/` dir contains a SYMLINK (not a
  // lexical path string) pointing at the victim's session dir. The
  // symlink's own on-disk path is safely inside the attacker's `_architect/`
  // — only realpathSync at the read choke point reveals it escapes.
  const victimDir = join(projectsRoot, 'victimproj', '_architect', VICTIM_SESSION);
  mkdirSync(victimDir, { recursive: true });
  writeFileSync(join(victimDir, 'idea.md'), SECRET_MARKER + '\n', 'utf8');
  writeFileSync(join(victimDir, 'status.json'), JSON.stringify({ session_id: VICTIM_SESSION, project: 'victimproj', phase: 'awaiting-verdict' }), 'utf8');
  const attackerArchitectDir = join(projectsRoot, 'attackerproj', '_architect');
  mkdirSync(attackerArchitectDir, { recursive: true });
  symlinkSync(victimDir, join(attackerArchitectDir, 'evil-session'));

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 200 happy path — the three real kinds (AT-38, 39, 40)
// ---------------------------------------------------------------------------

type SessionShellTurn = { index: number; role: string; stage: string; text: string; source: string };
type SessionShellBody = {
  ok: boolean; kind: string; sessionId: string; project: string; phase: string;
  stages: string[]; defaultStage: string; turns: SessionShellTurn[]; artifact: unknown;
};

test('AT-38: GET /api/studio/sessions/architect/<id>?project=<p> returns the full shell payload', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${REAL_ARCHITECT_SESSION}?project=demoproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;

  assert.equal(body.ok, true);
  assert.equal(body.kind, 'architect');
  assert.equal(body.sessionId, REAL_ARCHITECT_SESSION);
  assert.equal(body.project, 'demoproj');
  assert.equal(body.phase, 'awaiting-verdict', 'phase must be the real value read from the session\'s status.json');
  assert.deepEqual(body.stages, ['roadmap']);
  assert.equal(body.defaultStage, 'roadmap');

  // The fixture is idea.md + a single answered round (no questions.json, no
  // feedback.md) — the exact, known transcript this session must derive.
  assert.equal(body.turns.length, 3, `expected idea.md + round-1 agent + round-1 operator, got: ${JSON.stringify(body.turns)}`);
  assert.deepEqual(body.turns.map((t) => t.source), ['idea.md', 'answers.json#round-1', 'answers.json#round-1']);
  assert.deepEqual(body.turns.map((t) => t.role), ['operator', 'agent', 'operator']);

  const artifact = body.artifact as { kind: string; rows: unknown[] };
  assert.equal(artifact.kind, 'roadmap-draft');
  assert.deepEqual(artifact.rows, [], 'the fixture\'s manifests/ dir is empty — the artifact must be an honest empty roadmap, not a fabricated row');
});

test('AT-39: GET /api/studio/sessions/instructions/<id>?project=<p> returns the full shell payload', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${REAL_INSTRUCTIONS_SESSION}?project=demoproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;

  assert.equal(body.ok, true);
  assert.equal(body.kind, 'instructions');
  assert.equal(body.sessionId, REAL_INSTRUCTIONS_SESSION);
  assert.equal(body.project, 'demoproj');
  assert.equal(body.phase, 'drafting', 'phase must be the real value read from the session\'s status.json');
  assert.deepEqual(body.stages, ['instructions']);
  assert.equal(body.defaultStage, 'instructions');

  // The fixture is prompt.md only (no answers.json/questions.json/feedback.md).
  assert.equal(body.turns.length, 1, `expected the single prompt.md operator turn, got: ${JSON.stringify(body.turns)}`);
  assert.equal(body.turns[0].role, 'operator');
  assert.equal(body.turns[0].source, 'prompt.md');

  const artifact = body.artifact as { kind: string; body: string | null; hasDraft: boolean };
  assert.equal(artifact.kind, 'markdown-draft');
  assert.equal(artifact.body, '# AGENTS.md\n\nDraft body.\n', 'the draft body must be byte-faithful, including the trailing newline');
  assert.equal(artifact.hasDraft, true);
});

test('AT-40: GET /api/studio/sessions/project-brain/<id>?project=<p> returns the full shell payload, honestly one turn', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/project-brain/${REAL_PROJECT_BRAIN_SESSION}?project=demoproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;

  assert.equal(body.ok, true);
  assert.equal(body.kind, 'project-brain');
  assert.equal(body.sessionId, REAL_PROJECT_BRAIN_SESSION);
  assert.equal(body.project, 'demoproj');
  assert.equal(body.phase, 'analyzing', 'phase must be the real value read from the session\'s status.json');
  assert.deepEqual(body.stages, ['brain']);
  assert.equal(body.defaultStage, 'brain');

  // project-brain's runner has NO interview machinery (no answers.json/
  // questions.json/feedback.md ever exist for this kind) — one turn here is
  // the honest, complete transcript, not a truncation of something longer.
  assert.equal(body.turns.length, 1, `project-brain must surface honestly as one turn, no fabricated interview, got: ${JSON.stringify(body.turns)}`);
  assert.equal(body.turns[0].role, 'operator');
  assert.equal(body.turns[0].source, 'prompt.md');

  const artifact = body.artifact as { kind: string; themeCount: number; files: Array<{ path: string; body: string }> };
  assert.equal(artifact.kind, 'brain-structure');
  assert.equal(artifact.themeCount, 1);
  assert.ok(artifact.files.some((f) => f.path.includes('alpha.md')), 'the fixture\'s themes/alpha.md must appear in files');
});

// ---------------------------------------------------------------------------
// Passthrough contract — direct invocation (AT-41)
// ---------------------------------------------------------------------------

test('AT-41: handleStudioSessionsRoutes returns false for a non-matching URL (passthrough contract)', async () => {
  const mockRes = {
    writeHead: () => { throw new Error('must not write a response for a non-matching URL'); },
    end: () => { throw new Error('must not end a response for a non-matching URL'); },
  } as unknown as import('node:http').ServerResponse;
  const mockReq = {} as import('node:http').IncomingMessage;
  const ctx: StudioContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs') };

  const handled = await handleStudioSessionsRoutes(mockReq, mockRes, ctx, '/api/studio/nonexistent', 'GET');
  assert.equal(handled, false, 'a non-matching studio-sessions URL must return false');
});

// ---------------------------------------------------------------------------
// 404 / 400 — unknown kind, unknown session, missing project (AT-42, 43, 44)
// ---------------------------------------------------------------------------

test('AT-42: GET /api/studio/sessions/no-such-kind/<id>?project=<p> returns 404 naming the allowed kinds', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/no-such-kind/${REAL_ARCHITECT_SESSION}?project=demoproj`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.ok(body.error.includes('no-such-kind'));
  for (const kind of ['architect', 'instructions', 'project-brain']) {
    assert.ok(body.error.includes(kind), `error must name allowed kind "${kind}", got: ${body.error}`);
  }
});

test('AT-43: GET /api/studio/sessions/architect/<unknown-id>?project=<p> returns 404', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/2099-01-01T00-00-00?project=demoproj`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.ok(typeof body.error === 'string' && body.error.length > 0);
});

test('AT-44: GET /api/studio/sessions/architect/<id> with NO project query param returns 400', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${REAL_ARCHITECT_SESSION}`);
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.ok(typeof body.error === 'string' && body.error.length > 0);
});

// ---------------------------------------------------------------------------
// Slug validation sweep — DIRECT invocation (AT-45, 46) — see the header note
// on why real fetch() cannot exercise every variant.
// ---------------------------------------------------------------------------

function captureResponse(): { res: import('node:http').ServerResponse; status: () => number | undefined; body: () => unknown } {
  let status: number | undefined;
  let raw = '';
  const res = {
    writeHead: (code: number) => { status = code; },
    end: (chunk?: unknown) => { if (typeof chunk === 'string') raw = chunk; },
  } as unknown as import('node:http').ServerResponse;
  return { res, status: () => status, body: () => (raw ? JSON.parse(raw) : undefined) };
}

// Shared traversal/malformed payloads that are representable as a NON-EMPTY
// single path segment (a bare '' segment can never appear in a URL that
// still matches `/api/studio/sessions/:kind/:sessionId` — a trailing slash
// with nothing after it simply fails to match the route at all, which is a
// different, already-covered passthrough/404 case, not this handler's 400).
const BAD_PATH_SEGMENT_VARIANTS: string[] = [
  '..',
  '.',
  'a%2Fb', // "a/b" as a single path segment — the raw traversal char is what's under test, not the segmentation
  '%2Fetc%2Fpasswd', // an absolute-path-shaped value
  '%00', // embedded null byte
  'a'.repeat(300), // overlong id — valid charset, invalid length
  '%2e%2e%2f', // URL-encoded traversal
  '%252e%252e%252f', // double-encoded traversal
  '%c0%af', // overlong UTF-8 encoding of '/'
];

// The project query param IS representable as an empty value (`?project=`),
// unlike a path segment — so '' is meaningful here and only here.
const BAD_QUERY_VALUE_VARIANTS: string[] = ['', ...BAD_PATH_SEGMENT_VARIANTS];

test('AT-45: sessionId slug validation rejects every traversal/malformed variant with 400, BEFORE any fs read', async () => {
  const ctx: StudioContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs') };
  for (const variant of BAD_PATH_SEGMENT_VARIANTS) {
    const { res, status, body } = captureResponse();
    const rawUrl = `/api/studio/sessions/architect/${variant}?project=demoproj`;
    const handled = await handleStudioSessionsRoutes({} as import('node:http').IncomingMessage, res, ctx, rawUrl, 'GET');
    assert.equal(handled, true, `variant ${JSON.stringify(variant)} must be handled (not passthrough)`);
    assert.equal(status(), 400, `variant ${JSON.stringify(variant)} must be rejected with 400, got ${status()}`);
    assert.ok(typeof (body() as { error?: string })?.error === 'string', `variant ${JSON.stringify(variant)} must carry an error message`);
  }
});

test('AT-46: project slug validation rejects every traversal/malformed variant with 400, BEFORE any fs read', async () => {
  const ctx: StudioContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs') };
  for (const variant of BAD_QUERY_VALUE_VARIANTS) {
    const { res, status, body } = captureResponse();
    const rawUrl = `/api/studio/sessions/architect/${REAL_ARCHITECT_SESSION}?project=${variant}`;
    const handled = await handleStudioSessionsRoutes({} as import('node:http').IncomingMessage, res, ctx, rawUrl, 'GET');
    assert.equal(handled, true, `variant ${JSON.stringify(variant)} must be handled (not passthrough)`);
    assert.equal(status(), 400, `project variant ${JSON.stringify(variant)} must be rejected with 400, got ${status()}`);
    assert.ok(typeof (body() as { error?: string })?.error === 'string');
  }
});

// ---------------------------------------------------------------------------
// Real escape probe — symlink, not a lexical path (AT-47)
// ---------------------------------------------------------------------------

test('AT-47: a sessionId resolving via a symlink into ANOTHER project\'s session dir is rejected, content never leaked', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/evil-session?project=attackerproj`);
  assert.notEqual(res.status, 200, 'a symlink escaping into another project\'s session dir must never resolve as a valid session');
  const text = await res.text();
  assert.ok(!text.includes(SECRET_MARKER), 'the victim session\'s content must never be returned, whatever the rejection status');
});

// ---------------------------------------------------------------------------
// Fail-closed unknown stage surfaces through the route (AT-48)
// ---------------------------------------------------------------------------

test('AT-48: an unknown-stage checkpoint surfaces as a non-200 (or ok:false), naming the offending value + allowed set — never smoothed into a 200 with defaulted stages', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${BADSTAGE_SESSION}?project=badstageproj`);
  const text = await res.text();
  let parsed: { ok?: boolean; error?: string; stages?: unknown } = {};
  try { parsed = JSON.parse(text); } catch { /* non-JSON is fine, handled below */ }

  const smoothedInto200 = res.status === 200 && parsed.ok !== false;
  assert.ok(!smoothedInto200, `an unknown-stage checkpoint must not be smoothed into a plain 200, got status=${res.status} body=${text}`);

  const message = parsed.error ?? text;
  assert.ok(message.includes('no-such-stage'), `response must name the offending value, got: ${message}`);
  assert.ok(message.includes('roadmap'), `response must name the allowed stage set, got: ${message}`);
});
