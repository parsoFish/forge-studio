/**
 * W6-B2 — generalizes the bridge's per-kind WS event tailing
 * (ensureArchitectTail/ensureInstructionsTail/ensureDemoTail/
 * ensureProjectBrainTail) into ONE `ensureSessionTail(kind, sessionId)`,
 * activated from every session kind's session-detail GET. This file proves
 * that generalization actually reaches the two kinds that never had a tail
 * at all before this change — authoring and kb-cleanup — which only have
 * ONE read route each: the generic `/api/studio/sessions/:kind/:id`
 * (cli/bridge-studio-sessions.ts), not a per-kind list route like
 * `/api/architect/sessions`.
 *
 * Mirrors `cli/ui-bridge-architect.test.ts`'s own "GET /api/architect/
 * sessions live-tails the session log -> WS event stream (hex bursts)"
 * test: a real bridge (startBridge), a hand-seeded `events.jsonl`, a real WS
 * client, the session-detail GET triggers the tail, the tool_use event
 * arrives over the wire.
 *
 * Closes bd forge-2ee ("authoring session live activity log dead — no
 * ensureAuthoringTail, spine events land in a dir no consumer reads") for
 * the server-side half: the events dir now HAS a consumer. The other half
 * (forge-ui actually subscribing/rendering) is out of scope here — batch B7
 * per the task brief; forge-ui's `useCycleEvents` hook already derives the
 * identical `_${kind}-${sessionId}` cycleId
 * (apps/studio/app/sessions/[kind]/[sessionId]/page.tsx) so it needs no change
 * to consume what this fix now streams.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import yaml from 'js-yaml';

import { WebSocket } from 'ws';

import { startBridge, writeAuthoringSession } from './ui-bridge.ts';

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

const KB_CLEANUP_SESSION = '2026-08-15T10-00-00';
const AUTHORING_SESSION = '2026-08-15T11-00-00';
// W6-B2 review fix (MEDIUM 2 / LOW) — a session already at its turnSpec's
// terminal phase ('applied', step: 'terminal' in the fixture yaml above).
const KB_CLEANUP_TERMINAL_SESSION = '2026-08-15T12-00-00';
const KB_ID = 'session-tails-fixture-kb';
const PROJECT = 'demoproj';

/** Minimal, real skill-agent fixture — mirrors
 *  cli/bridge-studio-sessions.test.ts's own `writeSkillAgent`, which every
 *  session-kinds descriptor's `agent:` field must resolve against
 *  (validateSessionKinds' unknown-agent check). */
function writeSkillAgent(root: string, slug: string): void {
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
  writeFileSync(join(dir, 'SKILL.md'), matter.stringify('\nFixture body.\n', data), 'utf8');
}

/** A minimal, valid `studio/session-kinds.yaml` carrying just the two kinds
 *  this file needs — kb-cleanup (turnSpec included, mirroring the real
 *  shipped row exactly) and authoring (turnSpec omitted: additive-optional
 *  per orchestrator/studio/session-kinds.ts, and irrelevant to the
 *  read-only transcript/artifact derivation this test exercises). */
function writeSessionKindsYaml(root: string): void {
  const dir = join(root, 'studio');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'session-kinds.yaml'),
    yaml.dump([
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
            { phase: 'awaiting-approval', step: 'noop' },
            { phase: 'applied', step: 'terminal' },
          ],
        },
      },
      {
        id: 'authoring',
        agent: 'creation-agent',
        title: 'Authoring session',
        legacyRoutes: [],
        stages: ['authoring'],
        defaultStage: 'authoring',
        artifact: { kind: 'file-package', label: 'Package' },
      },
    ]),
    'utf8',
  );
}

/** A real, minimal `brain/<id>/kb.yaml` — mirrors
 *  cli/bridge-studio-sessions.test.ts's own `writeResolvableKb` (that file's
 *  sibling `cli/ui-bridge-kb-cleanup.test.ts` AT-3/AT-4/AT-5 already prove
 *  this exact shape is sufficient for `computeAgentCleanupFindings`'s live
 *  brain-lint pass to complete without throwing). */
function writeResolvableKb(root: string, id: string): void {
  const dir = join(root, 'brain', id);
  mkdirSync(join(dir, 'themes'), { recursive: true });
  mkdirSync(join(dir, '_raw'), { recursive: true });
  writeFileSync(
    join(dir, 'kb.yaml'),
    `id: ${id}\nname: Fixture KB ${id}\nbinding: { kind: unique }\ndesc: A fixture KB for the session-tails test.\n`,
    'utf8',
  );
}

/** Plants a kb-cleanup session directly on disk (never through a route) —
 *  mirrors cli/bridge-studio-sessions.test.ts's `writeCleanupSessionWithResolvableKb`.
 *  `phase` defaults to 'awaiting-approval' (non-terminal, per the turnSpec
 *  fixture above) — the terminal-phase gating test below plants a SECOND
 *  session at phase 'applied' (the turnSpec's own `step: 'terminal'` row). */
function writeCleanupSession(projectsRoot: string, project: string, sessionId: string, kbId: string, phase = 'awaiting-approval'): void {
  const dir = join(projectsRoot, project, '_kb-cleanup', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify({
      session_id: sessionId,
      project,
      phase,
      kb_id: kbId,
      kb_binding: { kind: 'unique' },
      findings: [],
      updated_at: new Date().toISOString(),
    }),
    'utf8',
  );
}

/** Seeds `_logs/_<kind>-<sessionId>/events.jsonl` with one `tool_use` event
 *  — the exact fixture shape cli/ui-bridge-architect.test.ts's own
 *  "live-tails the session log" test uses. */
function seedEventLog(root: string, kind: string, sessionId: string): void {
  const logDir = join(root, '_logs', `_${kind}-${sessionId}`);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(
    join(logDir, 'events.jsonl'),
    JSON.stringify({
      event_id: `EV_${kind}_1`,
      cycle_id: `_${kind}-${sessionId}`,
      initiative_id: `${kind}-session-${sessionId}`,
      phase: kind,
      skill: `${kind}-runner`,
      event_type: 'tool_use',
      started_at: new Date().toISOString(),
      input_refs: [],
      output_refs: [],
      message: 'tool.Grep',
      metadata: { tool: 'Grep' },
    }) + '\n',
    'utf8',
  );
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-session-tails-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'catalog.yaml'),
    ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []', 'community-skills: []', ''].join('\n'),
  );
  writeSessionKindsYaml(forgeRoot);
  writeSkillAgent(forgeRoot, 'brain-maintenance');
  writeSkillAgent(forgeRoot, 'creation-agent');

  const projectsRoot = join(forgeRoot, 'projects');
  mkdirSync(projectsRoot, { recursive: true });

  writeResolvableKb(forgeRoot, KB_ID);
  writeCleanupSession(projectsRoot, PROJECT, KB_CLEANUP_SESSION, KB_ID);
  seedEventLog(forgeRoot, 'kb-cleanup', KB_CLEANUP_SESSION);

  // W6-B2 review fix (MEDIUM 2 / LOW) — the terminal-phase fixture: the
  // event log is seeded BEFORE any GET, exactly like the non-terminal
  // fixture above, so a tail that started (wrongly) would replay it on its
  // first 200ms poll — the negative test below proves no such replay
  // happens.
  writeCleanupSession(projectsRoot, PROJECT, KB_CLEANUP_TERMINAL_SESSION, KB_ID, 'applied');
  seedEventLog(forgeRoot, 'kb-cleanup', KB_CLEANUP_TERMINAL_SESSION);

  const authoringParent = join(projectsRoot, PROJECT, '_authoring');
  mkdirSync(authoringParent, { recursive: true });
  writeAuthoringSession(authoringParent, AUTHORING_SESSION, PROJECT, `_agent-creation-agent-${AUTHORING_SESSION}`, 'Build a fixture thing.');
  seedEventLog(forgeRoot, 'authoring', AUTHORING_SESSION);

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

function waitForToolUseEvent(ws: WebSocket, cycleId: string, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(false), timeoutMs);
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type?: string; cycleId?: string; event?: { event_type?: string } };
        if (msg.type === 'event' && msg.cycleId === cycleId && msg.event?.event_type === 'tool_use') {
          clearTimeout(timer);
          resolvePromise(true);
        }
      } catch { /* ignore */ }
    });
  });
}

test('GET /api/studio/sessions/kb-cleanup/<id>?project=<p> live-tails the session log -> WS event stream', async () => {
  const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/ws`);
  const got = waitForToolUseEvent(ws, `_kb-cleanup-${KB_CLEANUP_SESSION}`);
  await new Promise<void>((r) => ws.on('open', () => r()));

  const res = await fetch(`${url}/api/studio/sessions/kb-cleanup/${KB_CLEANUP_SESSION}?project=${PROJECT}`);
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${await res.text()}`);

  const received = await got;
  ws.close();
  assert.ok(received, 'expected a tool_use event over the WS for the kb-cleanup session');
});

test('GET /api/studio/sessions/authoring/<id>?project=<p> live-tails the session log -> WS event stream (closes bd forge-2ee: the authoring spine\'s events dir now has a consumer)', async () => {
  const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/ws`);
  const got = waitForToolUseEvent(ws, `_authoring-${AUTHORING_SESSION}`);
  await new Promise<void>((r) => ws.on('open', () => r()));

  const res = await fetch(`${url}/api/studio/sessions/authoring/${AUTHORING_SESSION}?project=${PROJECT}`);
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${await res.text()}`);

  const received = await got;
  ws.close();
  assert.ok(received, 'expected a tool_use event over the WS for the authoring session');
});

// W6-B2 review fix (MEDIUM 2 / LOW) — pins isTerminalPhase's gate: a session
// already at a TERMINAL phase must NOT get a tail started at all, even
// though its own GET still 200s and its events.jsonl already carries an
// event that a (wrongly) started tail would immediately replay on its first
// 200ms poll. Waits several poll intervals past the GET with no event
// arriving — the same negative-wait technique, applied to the ABSENCE of
// the positive tests' own proof.
test('GET /api/studio/sessions/kb-cleanup/<id>?project=<p> for a session already at a TERMINAL phase (applied) does NOT start a tail — no WS event arrives even though events.jsonl already carries one', async () => {
  const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/ws`);
  const gotUnexpectedEvent = waitForToolUseEvent(ws, `_kb-cleanup-${KB_CLEANUP_TERMINAL_SESSION}`, 700);
  await new Promise<void>((r) => ws.on('open', () => r()));

  const res = await fetch(`${url}/api/studio/sessions/kb-cleanup/${KB_CLEANUP_TERMINAL_SESSION}?project=${PROJECT}`);
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200 (the GET itself must still succeed for a terminal session), got ${res.status}: ${text}`);
  assert.equal((JSON.parse(text) as { phase: string }).phase, 'applied', 'arrange: the fixture session must genuinely be at the terminal "applied" phase');

  const received = await gotUnexpectedEvent;
  ws.close();
  assert.equal(
    received,
    false,
    'a terminal-phase session GET must NOT start a tail: the pre-seeded tool_use event would have replayed on the first ~200ms poll if ensureSessionTail had (wrongly) been called for it',
  );
});
