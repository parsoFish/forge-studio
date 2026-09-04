/**
 * Acceptance test for the R3-04-F3 / D9.2 pre-spawn connection-readiness
 * refusal on the REAL bridge run route `POST /api/agents/:slug/run`
 * (`cli/ui-bridge.ts:1113`) — DOES NOT EXIST YET. The route exists and
 * already accepts requests today; this file's "blocked" tests are RED at
 * the ASSERTION level (a 200 with a real runId today, expected to become a
 * 4xx naming the component once WI-3 lands) rather than at import time —
 * exactly the "seam added to an existing entry point" red the T3 brief
 * anticipates.
 *
 * Mirrors `cli/ui-bridge-agent-run.test.ts`'s fixture style exactly
 * (`studioAgent(slug, surface)`, `FORGE_ARCHITECT_NO_SPAWN=1` to keep the
 * happy path hermetic) — extended with a `tools`/`mcps` composition
 * override and a REAL connections-extended `studio/catalog.yaml`, so the
 * "unready" case is proven with a REAL, guaranteed-absent probe command
 * (no injection seam needed at the HTTP layer — the same "real absent
 * command" device `connection-probe.test.ts`'s D4 ATs use).
 *
 * ---------------------------------------------------------------------------
 * CONTRACT DECISION (ratify or redirect — also noted in the T3 final
 * report): the route refuses with an actionable, non-2xx status BEFORE
 * `spawnAgentDispatch` is ever called — proven indirectly here by asserting
 * the response body never carries `runId`/`ok:true` for the blocked case
 * (a synchronous pre-spawn check has nothing to hand back; a route that
 * spawned first and failed asynchronously would still have returned
 * `{ok:true, runId}` immediately, which this test would catch as a false
 * "not blocked" pass).
 * ---------------------------------------------------------------------------
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { startBridge } from './ui-bridge.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

function studioAgent(slug: string, tools: string[] = [], mcps: string[] = []): string {
  return `---
name: ${slug}
description: fixture agent for the connection-readiness run-block test
purpose: exercise the pre-spawn connection-readiness refusal
brainAccess: advisory
interactivity: Autonomous once launched; asks no questions.
surface: unattended
composition:
  skills: []
  tools: [${tools.join(', ')}]
  mcps: [${mcps.join(', ')}]
  guards: []
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
allowed-tools: [Read]
disallowed-tools: [Bash]
---

Fixture body for ${slug}.
`;
}

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-agent-run-conn-block-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });

  mkdirSync(join(forgeRoot, 'skills', 'unready-conn-agent'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'unready-conn-agent', 'SKILL.md'), studioAgent('unready-conn-agent', ['absent-conn-tool']));

  mkdirSync(join(forgeRoot, 'skills', 'ready-conn-agent'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'ready-conn-agent', 'SKILL.md'), studioAgent('ready-conn-agent', ['present-conn-tool']));

  const catalogYaml = yaml.dump({
    sdks: [{ id: 'claude', name: 'Claude', available: true }],
    models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', sdk: 'claude', tier: 'sonnet' }],
    tools: [
      {
        id: 'absent-conn-tool',
        name: 'absent-conn-tool',
        install: { method: 'system-provided' },
        config: [],
        probe: { kind: 'command', command: 'definitely-absent-binary-xyz-run-block-test', args: [] },
        provenance: 'system',
      },
      {
        id: 'present-conn-tool',
        name: 'present-conn-tool',
        install: { method: 'system-provided' },
        config: [],
        probe: { kind: 'command', command: 'node', args: ['--version'] },
        provenance: 'system',
      },
    ],
    mcps: [],
    guards: [],
  });
  writeFileSync(join(forgeRoot, 'studio', 'catalog.yaml'), catalogYaml, 'utf8');

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('POST /api/agents/<slug>/run: refuses PRE-SPAWN when a bound connection is not ready, naming the component and its state', async () => {
  const res = await fetch(`${url}/api/agents/unready-conn-agent/run`, { method: 'POST', headers: CSRF, body: '{}' });
  assert.ok(res.status >= 400 && res.status < 500, `expected a 4xx refusal, got ${res.status}`);
  const body = (await res.json()) as { error?: string; ok?: boolean; runId?: string };
  assert.match(body.error ?? '', /absent-conn-tool/, 'the refusal must NAME the unready component');
  assert.match(body.error ?? '', /not-installed/, 'the refusal must NAME the component\'s state — "not ready" alone fails this AC');
  assert.equal(body.ok, undefined, 'a blocked request must never carry ok:true');
  assert.equal(body.runId, undefined, 'a blocked request must never carry a runId — the block is PRE-spawn, nothing was dispatched');
});

test('POST /api/agents/<slug>/run: an agent whose bound connections are all available is NOT blocked — still returns a runId', async () => {
  const res = await fetch(`${url}/api/agents/ready-conn-agent/run`, { method: 'POST', headers: CSRF, body: '{}' });
  const body = (await res.json()) as { ok: boolean; runId: string; error?: string };
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
  assert.equal(body.ok, true);
  assert.ok(typeof body.runId === 'string' && body.runId.length > 0);
});
