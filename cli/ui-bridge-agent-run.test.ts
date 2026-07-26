/**
 * Tests for the generic `POST /api/agents/<slug>/run` route (R2-01-F3 dispatch
 * half) — the agent-page run surface for a non-interactive roster agent.
 *
 * Validation is exercised against a temp forgeRoot with two fixture studio
 * agents (`test-runnable` unattended, `test-interactive` interactive) under
 * `<root>/skills/`. FORGE_ARCHITECT_NO_SPAWN=1 keeps the happy path from
 * launching a real SDK run — the route still returns the runId.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

function studioAgent(slug: string, surface: string): string {
  return `---
name: ${slug}
description: fixture agent for the generic run route test
purpose: exercise the dispatch route
brainAccess: advisory
interactivity: Autonomous once launched; asks no questions.
surface: ${surface}
composition:
  skills: []
  tools: []
  mcps: []
  hooks: []
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
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-agent-run-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects', 'gitpulse'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills', 'test-runnable'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills', 'test-interactive'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'test-runnable', 'SKILL.md'), studioAgent('test-runnable', 'unattended'));
  writeFileSync(join(forgeRoot, 'skills', 'test-interactive', 'SKILL.md'), studioAgent('test-interactive', 'interactive'));

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('POST /api/agents/<slug>/run: malformed slug → 400', async () => {
  const res = await fetch(`${url}/api/agents/Bad_Slug/run`, { method: 'POST', headers: CSRF, body: '{}' });
  assert.equal(res.status, 400);
  assert.match((await res.json() as { error: string }).error, /invalid agent slug/);
});

test('POST /api/agents/<slug>/run: unknown slug → 400 (no runnable agent)', async () => {
  const res = await fetch(`${url}/api/agents/not-a-real-agent/run`, { method: 'POST', headers: CSRF, body: '{}' });
  assert.equal(res.status, 400);
  assert.match((await res.json() as { error: string }).error, /no runnable agent "not-a-real-agent"/);
});

test('POST /api/agents/<slug>/run: an interactive agent is refused → 400', async () => {
  const res = await fetch(`${url}/api/agents/test-interactive/run`, { method: 'POST', headers: CSRF, body: '{}' });
  assert.equal(res.status, 400);
  assert.match((await res.json() as { error: string }).error, /is interactive/);
});

test('POST /api/agents/<slug>/run: unknown project → 404', async () => {
  const res = await fetch(`${url}/api/agents/test-runnable/run`, {
    method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'nope' }),
  });
  assert.equal(res.status, 404);
});

test('POST /api/agents/<slug>/run: non-string input value → 400', async () => {
  const res = await fetch(`${url}/api/agents/test-runnable/run`, {
    method: 'POST', headers: CSRF, body: JSON.stringify({ inputs: { northStar: 42 } }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json() as { error: string }).error, /must be a string/);
});

test('POST /api/agents/<slug>/run: dispatchable agent → 200, ok:true, runId returned', async () => {
  const res = await fetch(`${url}/api/agents/test-runnable/run`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ project: 'gitpulse', inputs: { northStar: 'ship it' } }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; runId: string; slug: string };
  assert.equal(body.ok, true);
  assert.equal(body.slug, 'test-runnable');
  assert.match(body.runId, /^_agent-test-runnable-/);
});
