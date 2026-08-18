/**
 * Acceptance + unit tests for W6-B11's aggregate sessions index:
 *   GET /api/studio/sessions[?active=1]
 *
 * Implemented in cli/ui-bridge.ts (`handleStudioSessionsIndex`,
 * `collectStudioSessionIndexRows`, `sortAndCapSessionIndexRows`) — reuses the
 * SAME per-kind readers the existing `/api/architect/sessions` etc. list
 * routes already call (`listArchitectSessions`, `listInstructionsSessions`,
 * `listDemoSessions`, `listProjectBrainSessions`), plus a generic
 * per-segment-guarded directory scan (mirroring `collectSessionRows`'s own
 * shape) for every OTHER registry kind (onboarding, kb-cleanup, authoring —
 * no bespoke list route exists for these).
 *
 * This file also pins a real behavior fix bundled into this WI:
 * `isTerminalPhase` (cli/bridge-studio-sessions.ts) previously had NO
 * terminal-phase source for 'onboarding' (no `turnSpec`, and 'onboarding'
 * carries no row in `LEGACY_SESSION_TERMINAL_PHASES`) and always returned
 * `false` for it — harmless at its original call site (onboarding's tail is
 * a no-op regardless) but WRONG for this index's `?active=1` contract, which
 * must exclude a completed/failed onboarding session. The fix widens
 * `isTerminalPhase` to also check a descriptor's `panel` table (the same
 * table `deriveSessionAffordances` already reads) — proven
 * behavior-preserving for the four legacy kinds (see that function's own
 * doc comment) and regression-locked here for onboarding specifically.
 *
 * Test shape mirrors cli/bridge-studio-sessions.test.ts's idiom: a real
 * bridge (startBridge) + fetch for the acceptance-level behavior, plus
 * direct import of the pure sort/cap function for isolated unit coverage.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { startBridge, sortAndCapSessionIndexRows, SESSION_INDEX_MAX_ROWS, type SessionIndexRow } from './ui-bridge.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

const ARCHITECT_SESSION = '2026-08-01T10-00-00';
const INSTRUCTIONS_ACTIVE_SESSION = '2026-08-02T11-00-00';
const INSTRUCTIONS_TERMINAL_SESSION = '2026-08-02T11-05-00';
const INSTRUCTIONS_MODEL_TIER_SESSION = '2026-08-02T11-10-00';
const DEMO_SESSION = '2026-08-03T12-00-00';
const PROJECT_BRAIN_SESSION = '2026-08-04T13-00-00';
const KB_CLEANUP_SESSION = '2026-08-05T14-00-00';
const ONBOARDING_ACTIVE_SESSION = '2026-08-06T15-00-00';
const ONBOARDING_TERMINAL_SESSION = '2026-08-06T15-05-00';

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
        legacyRoutes: [],
        stages: ['roadmap'],
        defaultStage: 'roadmap',
        artifact: { kind: 'roadmap-draft', label: 'Roadmap draft' },
      },
      {
        id: 'instructions',
        agent: 'instructions-creator',
        title: 'Instructions',
        legacyRoutes: [],
        stages: ['instructions'],
        defaultStage: 'instructions',
        artifact: { kind: 'markdown-draft', label: 'AGENTS.md draft' },
        panel: {
          phases: [
            { phase: 'interviewing', step: 'agent' },
            { phase: 'awaiting-answers', step: 'noop', awaits: 'questions', next: 'interviewing' },
            { phase: 'drafting', step: 'agent', writes: ['draft'], next: 'awaiting-verdict' },
            { phase: 'awaiting-verdict', step: 'noop', awaits: 'verdict' },
            { phase: 'finalizing', step: 'finalize', finalizer: 'writeToRepoRoot', next: 'committed' },
            { phase: 'committed', step: 'terminal' },
            { phase: 'rejected', step: 'terminal' },
          ],
        },
      },
      {
        id: 'demo',
        agent: 'demo-builder',
        title: 'Demo',
        legacyRoutes: [],
        stages: ['demo'],
        defaultStage: 'demo',
        artifact: { kind: 'generation-gallery', label: 'Demo generations' },
        panel: {
          phases: [
            { phase: 'generating', step: 'agent', writes: ['demo'], next: 'awaiting-review' },
            { phase: 'awaiting-review', step: 'noop', awaits: 'verdict' },
            { phase: 'locking', step: 'finalize', finalizer: 'recordLockedDemo', next: 'locked' },
            { phase: 'locked', step: 'terminal' },
            { phase: 'abandoned', step: 'terminal' },
          ],
        },
      },
      {
        id: 'project-brain',
        agent: 'project-brain-builder',
        title: 'Project Brain',
        legacyRoutes: [],
        stages: ['brain'],
        defaultStage: 'brain',
        artifact: { kind: 'brain-structure', label: 'Seeded structure' },
      },
      {
        id: 'onboarding',
        agent: 'onboarding-agent',
        title: 'Onboarding session',
        legacyRoutes: [],
        stages: ['contract', 'instructions', 'secrets', 'demo', 'roadmap'],
        defaultStage: 'contract',
        artifact: { kind: 'contract-buildout', label: 'Contract build-out' },
        panel: {
          phases: [
            { phase: 'running', step: 'agent' },
            { phase: 'complete', step: 'terminal' },
            { phase: 'failed', step: 'terminal' },
          ],
        },
      },
      {
        id: 'kb-cleanup',
        agent: 'brain-maintenance',
        title: 'KB cleanup session',
        legacyRoutes: [],
        stages: ['brain'],
        defaultStage: 'brain',
        artifact: { kind: 'cleanup-plan', label: 'Cleanup plan' },
        turnSpec: {
          kindDir: '_kb-cleanup',
          style: 'agent',
          phases: [
            { phase: 'drafting', step: 'agent', writes: ['plan'], next: 'awaiting-approval' },
            { phase: 'awaiting-approval', step: 'noop', awaits: 'verdict', verdicts: ['approve'] },
            { phase: 'applied', step: 'terminal' },
          ],
        },
      },
    ]),
    'utf8',
  );
}

function writeArchitectSession(projectsRoot: string, project: string, sessionId: string): void {
  const dir = join(projectsRoot, project, '_architect', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'idea.md'), 'An idea.\n', 'utf8');
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify({ session_id: sessionId, project, phase: 'interviewing', updated_at: '2026-08-01T10:00:00.000Z' }),
    'utf8',
  );
}

function writeInstructionsSession(
  projectsRoot: string,
  project: string,
  sessionId: string,
  phase: string,
  updatedAt: string,
  modelTier?: string,
): void {
  const dir = join(projectsRoot, project, '_instructions', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.md'), 'Author AGENTS.md.\n', 'utf8');
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify({ session_id: sessionId, project, phase, updated_at: updatedAt, ...(modelTier ? { modelTier } : {}) }),
    'utf8',
  );
}

function writeDemoSession(projectsRoot: string, project: string, sessionId: string): void {
  const dir = join(projectsRoot, project, '_demo', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify({ session_id: sessionId, project, phase: 'generating', updated_at: '2026-08-03T12:00:00.000Z', iteration: 0 }),
    'utf8',
  );
}

function writeProjectBrainSession(projectsRoot: string, project: string, sessionId: string): void {
  const dir = join(projectsRoot, project, '_project-brain', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.md'), 'Seed the brain.\n', 'utf8');
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify({ session_id: sessionId, project, phase: 'analyzing', updated_at: '2026-08-04T13:00:00.000Z' }),
    'utf8',
  );
}

function writeKbCleanupSession(projectsRoot: string, project: string, sessionId: string): void {
  const dir = join(projectsRoot, project, '_kb-cleanup', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify({ session_id: sessionId, project, phase: 'awaiting-approval', kb_id: 'some-kb', findings: [] }),
    'utf8',
  );
}

function writeOnboardingSession(projectsRoot: string, project: string, sessionId: string, phase: string): void {
  const dir = join(projectsRoot, project, '_onboarding', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.md'), 'Onboard.\n', 'utf8');
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify({ phase, project, startedAt: '2026-08-06T15:00:00.000Z' }),
    'utf8',
  );
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'ui-bridge-sessions-index-'));
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

  const projectsRoot = join(forgeRoot, 'projects');
  writeArchitectSession(projectsRoot, 'proja', ARCHITECT_SESSION);
  // Instructions: one active (needsYou true via awaiting-verdict's `verdict`
  // affordance), one terminal (filtered by ?active=1), one carrying a real
  // modelTier (threading proof).
  writeInstructionsSession(projectsRoot, 'proja', INSTRUCTIONS_ACTIVE_SESSION, 'awaiting-verdict', '2026-08-02T11:00:00.000Z');
  writeInstructionsSession(projectsRoot, 'proja', INSTRUCTIONS_TERMINAL_SESSION, 'committed', '2026-08-02T11:05:00.000Z');
  writeInstructionsSession(projectsRoot, 'proja', INSTRUCTIONS_MODEL_TIER_SESSION, 'drafting', '2026-08-02T11:10:00.000Z', 'opus');
  writeDemoSession(projectsRoot, 'projb', DEMO_SESSION);
  writeProjectBrainSession(projectsRoot, 'projb', PROJECT_BRAIN_SESSION);
  writeKbCleanupSession(projectsRoot, 'projc', KB_CLEANUP_SESSION);
  // Onboarding: one active ('running', no panel affordance -> needsYou
  // false), one at the TERMINAL 'complete' phase — the isTerminalPhase fix's
  // own regression lock.
  writeOnboardingSession(projectsRoot, 'projd', ONBOARDING_ACTIVE_SESSION, 'running');
  writeOnboardingSession(projectsRoot, 'projd', ONBOARDING_TERMINAL_SESSION, 'complete');

  // Traversal-safety fixture (mirrors the repo's AT-47 idiom): a REAL victim
  // session holding a secret phase, and an attacker project whose
  // `_kb-cleanup/` dir contains a SYMLINK (not a lexical path string)
  // pointing at the victim's session dir. The generic fallback branch (the
  // one this fixture exercises — kb-cleanup has no bespoke list route) must
  // resolve this through the SAME guarded choke point every other read in
  // this route uses and simply omit it, never leak the victim's phase.
  const SECRET_PHASE = 'TOP-SECRET-AGGREGATE-ESCAPE-MARKER';
  const victimDir = join(projectsRoot, 'victimproj', '_kb-cleanup', '2026-08-07T16-00-00');
  mkdirSync(victimDir, { recursive: true });
  writeFileSync(join(victimDir, 'status.json'), JSON.stringify({ phase: SECRET_PHASE, project: 'victimproj' }), 'utf8');
  const attackerKbCleanupDir = join(projectsRoot, 'attackerproj', '_kb-cleanup');
  mkdirSync(attackerKbCleanupDir, { recursive: true });
  symlinkSync(victimDir, join(attackerKbCleanupDir, 'evil-session'));

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  await closeBridge();
  rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Acceptance tests — real bridge + fetch
// ---------------------------------------------------------------------------

test('GET /api/studio/sessions (no query) returns rows across every registry kind, including terminal ones', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { sessions: SessionIndexRow[]; cap: number };
  const kinds = new Set(body.sessions.map((s) => s.kind));
  assert.deepEqual(
    [...kinds].sort(),
    ['architect', 'demo', 'instructions', 'kb-cleanup', 'onboarding', 'project-brain'],
    'expected a row for every fixture kind',
  );
  // The terminal instructions + onboarding sessions ARE present without ?active=1.
  const terminalRow = body.sessions.find((s) => s.sessionId === INSTRUCTIONS_TERMINAL_SESSION);
  assert.ok(terminalRow, 'expected the terminal instructions session present when active filter is not requested');
  assert.equal(terminalRow!.terminal, true);
  const onboardingTerminalRow = body.sessions.find((s) => s.sessionId === ONBOARDING_TERMINAL_SESSION);
  assert.ok(onboardingTerminalRow, 'expected the terminal onboarding session present when active filter is not requested');
  assert.equal(onboardingTerminalRow!.terminal, true, 'onboarding "complete" must be derived as terminal (the isTerminalPhase widening this WI ships)');
  assert.equal(body.cap, SESSION_INDEX_MAX_ROWS);
});

test('GET /api/studio/sessions?active=1 filters out every terminal row (instructions "committed" AND onboarding "complete")', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions?active=1`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { sessions: SessionIndexRow[] };
  const ids = body.sessions.map((s) => s.sessionId);
  assert.ok(!ids.includes(INSTRUCTIONS_TERMINAL_SESSION), 'terminal instructions session must be filtered by ?active=1');
  assert.ok(!ids.includes(ONBOARDING_TERMINAL_SESSION), 'terminal onboarding session must be filtered by ?active=1');
  assert.ok(ids.includes(INSTRUCTIONS_ACTIVE_SESSION), 'active instructions session must remain');
  assert.ok(ids.includes(ONBOARDING_ACTIVE_SESSION), 'active onboarding session must remain');
  assert.ok(body.sessions.every((s) => s.terminal === false), 'every returned row must be non-terminal under ?active=1');
});

test('needsYou is true only where deriveSessionAffordances derives a real affordance — architect (no turnSpec/panel) is always false; instructions "awaiting-verdict" and kb-cleanup "awaiting-approval" are true; onboarding "running" (an agent-step row) is false', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions`);
  const body = (await res.json()) as { sessions: SessionIndexRow[] };
  const byId = (id: string): SessionIndexRow => {
    const row = body.sessions.find((s) => s.sessionId === id);
    assert.ok(row, `expected a row for session ${id}`);
    return row!;
  };
  assert.equal(byId(ARCHITECT_SESSION).needsYou, false, 'architect has neither turnSpec nor panel -> deriveSessionAffordances always []');
  assert.equal(byId(INSTRUCTIONS_ACTIVE_SESSION).needsYou, true, 'awaiting-verdict declares awaits:verdict -> a real affordance');
  assert.equal(byId(KB_CLEANUP_SESSION).needsYou, true, 'awaiting-approval declares awaits:verdict -> a real affordance');
  assert.equal(byId(ONBOARDING_ACTIVE_SESSION).needsYou, false, '"running" is a plain agent-step row -> no affordance');
});

test('modelTier threads through from status.json when present, and is null when absent', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions`);
  const body = (await res.json()) as { sessions: SessionIndexRow[] };
  const withTier = body.sessions.find((s) => s.sessionId === INSTRUCTIONS_MODEL_TIER_SESSION);
  assert.ok(withTier);
  assert.equal(withTier!.modelTier, 'opus');
  const withoutTier = body.sessions.find((s) => s.sessionId === ARCHITECT_SESSION);
  assert.ok(withoutTier);
  assert.equal(withoutTier!.modelTier, null);
});

test('href is the modern generic session-shell shape for every row', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions`);
  const body = (await res.json()) as { sessions: SessionIndexRow[] };
  const row = body.sessions.find((s) => s.sessionId === KB_CLEANUP_SESSION);
  assert.ok(row);
  assert.equal(row!.href, `/sessions/kb-cleanup/${KB_CLEANUP_SESSION}?project=projc`);
});

test('a symlinked session dir escaping to another project (the generic fallback branch, kb-cleanup) is never surfaced under the ATTACKER project — the victim\'s own legitimate row is unaffected', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions`);
  const body = (await res.json()) as { sessions: SessionIndexRow[] };
  // The victim's OWN real session (a genuine dir under a genuine project)
  // legitimately appears exactly once, attributed to victimproj.
  const withSecret = body.sessions.filter((s) => s.phase === 'TOP-SECRET-AGGREGATE-ESCAPE-MARKER');
  assert.equal(withSecret.length, 1, 'the secret phase must surface exactly once — the victim\'s own legitimate row');
  assert.equal(withSecret[0].project, 'victimproj');
  // The attacker project's symlinked "evil-session" must contribute NO row at
  // all — resolveGuardedPath's realpath containment refuses it, collapsing
  // into the same outcome as "session not found" (no oracle).
  const attackerRow = body.sessions.find((s) => s.project === 'attackerproj');
  assert.equal(attackerRow, undefined, 'the attacker project must contribute no row for the symlinked session');
});

// ---------------------------------------------------------------------------
// Pure unit tests — sortAndCapSessionIndexRows (no I/O)
// ---------------------------------------------------------------------------

function row(overrides: Partial<SessionIndexRow>): SessionIndexRow {
  return {
    kind: 'instructions',
    sessionId: 'fixture',
    project: 'p',
    phase: 'drafting',
    terminal: false,
    needsYou: false,
    // W7-A2 — the three lifecycle fields every row carries.
    state: 'working',
    error: null,
    idleMs: null,
    modelTier: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    href: '/sessions/instructions/fixture?project=p',
    ...overrides,
  };
}

test('sortAndCapSessionIndexRows: needsYou rows sort before non-needsYou rows regardless of updatedAt', () => {
  const older = row({ sessionId: 'a', needsYou: true, updatedAt: '2020-01-01T00:00:00.000Z' });
  const newer = row({ sessionId: 'b', needsYou: false, updatedAt: '2030-01-01T00:00:00.000Z' });
  const sorted = sortAndCapSessionIndexRows([newer, older]);
  assert.deepEqual(sorted.map((r) => r.sessionId), ['a', 'b']);
});

test('sortAndCapSessionIndexRows: within the same needsYou group, newest updatedAt sorts first', () => {
  const oldest = row({ sessionId: 'a', updatedAt: '2020-01-01T00:00:00.000Z' });
  const newest = row({ sessionId: 'b', updatedAt: '2030-01-01T00:00:00.000Z' });
  const middle = row({ sessionId: 'c', updatedAt: '2025-01-01T00:00:00.000Z' });
  const sorted = sortAndCapSessionIndexRows([oldest, newest, middle]);
  assert.deepEqual(sorted.map((r) => r.sessionId), ['b', 'c', 'a']);
});

test('sortAndCapSessionIndexRows: an honest-absent ("") updatedAt sorts LAST within its needsYou group, never treated as newest', () => {
  const absent = row({ sessionId: 'a', updatedAt: '' });
  const real = row({ sessionId: 'b', updatedAt: '2020-01-01T00:00:00.000Z' });
  const sorted = sortAndCapSessionIndexRows([absent, real]);
  assert.deepEqual(sorted.map((r) => r.sessionId), ['b', 'a']);
});

test('sortAndCapSessionIndexRows: caps to the given bound', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row({ sessionId: `s${i}`, updatedAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z` }));
  const capped = sortAndCapSessionIndexRows(rows, 3);
  assert.equal(capped.length, 3);
  assert.deepEqual(capped.map((r) => r.sessionId), ['s9', 's8', 's7']);
});

test('sortAndCapSessionIndexRows: default cap is SESSION_INDEX_MAX_ROWS', () => {
  const rows = Array.from({ length: SESSION_INDEX_MAX_ROWS + 5 }, (_, i) => row({ sessionId: `s${i}` }));
  const capped = sortAndCapSessionIndexRows(rows);
  assert.equal(capped.length, SESSION_INDEX_MAX_ROWS);
});
