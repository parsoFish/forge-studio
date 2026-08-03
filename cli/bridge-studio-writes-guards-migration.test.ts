/**
 * MIGRATION ACCEPTANCE TEST (must be RED on today's code) — E1 of the
 * ADR-027-amendment-#2 `composition.hooks` → `composition.guards` rename:
 * the agent save/round-trip path in `cli/bridge-studio-writes.ts` (~L379
 * currently maps `hooks`) must preserve `composition.guards` through a
 * PUT /api/studio/agents/:slug write → re-load-from-disk cycle.
 *
 * Mirrors `cli/bridge-studio-write.test.ts`'s existing harness conventions
 * exactly (`startBridge`, `putJson`, a temp forgeRoot fixture with a real
 * `skills/<slug>/SKILL.md`) rather than inventing a new one — this is a
 * SEPARATE new file (not an edit to that existing, currently-green suite)
 * so this file's expected-to-fail assertions never contaminate that one.
 *
 * The seed on-disk SKILL.md still carries the CURRENT vocabulary
 * (`composition.hooks: [event-log]`) — that is what a REAL pre-migration
 * agent looks like on disk today. The PUT body sends the FUTURE vocabulary
 * (`composition.guards`, no `hooks` key at all) — what a migrated Studio
 * agent-builder UI would send. Today's `bridge-studio-writes.ts` never reads
 * `compIn['guards']` anywhere, so the PUT succeeds (200) but silently
 * discards the sent guards entirely (falling back to the EXISTING on-disk
 * `hooks` value, since the body has no recognized `hooks` key either) — the
 * round-tripped, re-loaded def's `composition.guards` is `undefined`, not
 * the sent value. That mismatch is this test's RED signal.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { loadAgentDefinition } from '../orchestrator/studio/registry.ts';

const SLUG = 'write-agent-guards';

function makeSeedSkillMd(): string {
  return [
    '---',
    'name: Write Agent Guards',
    'description: An agent for the guards-migration bridge round-trip test.',
    'phase: developer',
    'surface: unattended',
    'purpose: Prove the bridge round-trips composition.guards.',
    'brainAccess: advisory',
    'interactivity: none',
    'composition:',
    '  skills: []',
    '  tools: []',
    '  mcps: []',
    '  hooks:',
    '    - event-log',
    'runtime:',
    '  sdk: claude-code',
    '  strategy: fixed',
    '  model: claude-sonnet-4-5',
    'allowed-tools: []',
    'disallowed-tools: []',
    'budgets: {}',
    '---',
    '',
    '# Write Agent Guards',
    '',
    'Process body text.',
  ].join('\n');
}

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-guards-migration-'));
  mkdirSync(join(forgeRoot, 'skills', SLUG), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', SLUG, 'SKILL.md'), makeSeedSkillMd());
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  mkdirSync(join(forgeRoot, '_queue', 'done'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

async function putJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
}

test('E1: PUT /api/studio/agents/:slug with composition.guards round-trips through a save + re-load (RED until migrated)', async () => {
  const putBody = {
    name: 'Write Agent Guards',
    purpose: 'Prove the bridge round-trips composition.guards.',
    process: 'Updated process body.',
    interactivity: 'none',
    brainAccess: 'advisory',
    composition: {
      skills: [],
      tools: [],
      mcps: [],
      guards: ['review-band'],
    },
    runtime: { sdk: 'claude-code', strategy: 'fixed', model: 'claude-sonnet-4-5' },
  };

  const res = await putJson(`${bridgeUrl}/api/studio/agents/${SLUG}`, putBody);
  assert.equal(res.status, 200, `expected the PUT to succeed (200) — got ${res.status}: ${JSON.stringify(await res.json().catch(() => null))}`);

  const reloaded = loadAgentDefinition(join(forgeRoot, 'skills', SLUG, 'SKILL.md'));
  const guards = (reloaded.composition as unknown as { guards?: string[] }).guards;
  assert.deepEqual(
    guards,
    ['review-band'],
    `expected the re-loaded def's composition.guards to equal the PUT body's sent value — got: ${JSON.stringify(guards)}`,
  );
});
