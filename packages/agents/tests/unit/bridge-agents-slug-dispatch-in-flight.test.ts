/**
 * LOW-5 (row 206 follow-up, forge-8vfn.8.5.56) — `POST /api/agents/:slug/run`
 * (`handleAgentRunStart`, `bridge-agents-slug.ts`) did not map a thrown
 * `DispatchInFlight` to 409; it fell through to the route's generic 500.
 *
 * In PRACTICE this route's runId is minted fresh by `deps.newRunStamp()` on
 * every call (never a reused/fixed id like a session's `sessionId`), so two
 * calls can never collide on the SAME run id and `DispatchInFlight` is not
 * reachable through ordinary use — the same shape `/api/architect/start`
 * documents for its own freshly-minted `sessionId`. This test proves the
 * MAPPING itself (by injecting a `spawnAgentDispatch` that throws one)
 * rather than racing a real collision that the id scheme rules out.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleAgentRunStart, type AgentSlugRouteDeps } from '../../bridge-agents-slug.ts';
import { DispatchInFlight } from '@forge/kernel';
import type { RouteContext } from '@forge/kernel';

const AGENT_MD = `---
name: test-runnable
description: fixture agent for the LOW-5 dispatch-in-flight mapping test
purpose: exercise the dispatch route
brainAccess: advisory
interactivity: Autonomous once launched; asks no questions.
surface: unattended
composition:
  skills: []
  tools: []
  mcps: []
  guards: []
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
allowed-tools: [Read]
disallowed-tools: [Bash]
---

Fixture body.
`;

function mockReqRes(): { req: IncomingMessage; res: ServerResponse; captured: { status: number | null; body: string } } {
  const captured = { status: null as number | null, body: '' };
  const req = { url: '/api/agents/test-runnable/run', headers: {} } as unknown as IncomingMessage;
  const res = {
    writeHead(status: number) { captured.status = status; return res; },
    end(payload?: string) { if (payload !== undefined) captured.body = payload; return res; },
  } as unknown as ServerResponse;
  return { req, res, captured };
}

/** Inert for every port this route does not exercise in this fixture; only
 *  the named overrides matter. */
function fakeDeps(overrides: Partial<AgentSlugRouteDeps>): AgentSlugRouteDeps {
  const inert = new Proxy({}, { get: () => () => undefined }) as AgentSlugRouteDeps;
  return { ...inert, ...overrides };
}

test('POST /api/agents/:slug/run: a DispatchInFlight from spawnAgentDispatch maps to 409 (not the generic 500)', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'agents-slug-dispatch-in-flight-'));
  try {
    mkdirSync(join(forgeRoot, 'skills', 'test-runnable'), { recursive: true });
    writeFileSync(join(forgeRoot, 'skills', 'test-runnable', 'SKILL.md'), AGENT_MD);

    const deps = fakeDeps({
      projectsRoot: forgeRoot,
      safeInputKeyRe: /^[A-Za-z0-9_-]+$/,
      newRunStamp: () => 'fixed-stamp',
      spawnAgentDispatch: () => {
        throw new DispatchInFlight(4242, '_agent-test-runnable-fixed-stamp');
      },
      dryBridgeAgentTurnMarker: () => ({}),
      ensureAgentRunTail: () => {},
    });

    const { req, res, captured } = mockReqRes();
    const ctx: RouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), readBody: async () => ({}) };

    const handled = await handleAgentRunStart(deps)(req, res, ctx);
    assert.equal(handled, true);
    assert.equal(captured.status, 409, `expected 409 (DispatchInFlight), got ${captured.status}: ${captured.body}`);
    const body = JSON.parse(captured.body) as { holderPid?: number };
    assert.equal(body.holderPid, 4242);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('structural pin: this route mints its runId from deps.newRunStamp() (always fresh), so DispatchInFlight cannot be reached by two ordinary calls', () => {
  const src = readFileSync(fileURLToPath(new URL('../../bridge-agents-slug.ts', import.meta.url)), 'utf8');
  assert.match(src, /deps\.newRunStamp\(\)/, 'the run id must be minted via the injected newRunStamp, never a fixed/reused value');
});
