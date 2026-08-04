/**
 * MIGRATION ACCEPTANCE TEST — E1 of the ADR-027-amendment-#2
 * `composition.hooks` → `composition.guards` rename: the agent save/round-trip
 * path in `cli/bridge-studio-writes.ts` (~L379, now maps `guards`) must
 * preserve `composition.guards` through a PUT /api/studio/agents/:slug
 * write → re-load-from-disk cycle.
 *
 * Mirrors `cli/bridge-studio-write.test.ts`'s existing harness conventions
 * exactly (`startBridge`, `putJson`, a temp forgeRoot fixture with a real
 * `skills/<slug>/SKILL.md`) rather than inventing a new one — this is a
 * SEPARATE new file (not an edit to that existing, currently-green suite)
 * so this file's assertions never contaminate that one.
 *
 * FIXTURE CORRECTION (2026-08-04, post-migration): the original draft of
 * this file seeded the on-disk SKILL.md with the OLD vocabulary
 * (`composition.hooks: [event-log]`) and asserted the PUT returned 200. That
 * was written before A3 was redirected (peer review) to make
 * `loadAgentDefinition` THROW on a stale `hooks:` key rather than silently
 * ignore it — so the old fixture modeled a state A2 now makes IMPOSSIBLE:
 * after this migration, no real on-disk SKILL.md carries the old key, and
 * `bridge-studio-writes.ts`'s PUT handler loads the EXISTING file to merge
 * fields before writing (`existing = loadAgentDefinition(skillMdPath)`), so a
 * legacy-hooks seed now makes every PUT against that slug 500, not 200 — the
 * old fixture was asserting behaviour that can no longer occur, against
 * production code that now correctly refuses to reach it. Confirmed
 * empirically: after the migration landed, the original E1 failed with
 * `500: composition.hooks is retired...`, not the expected mismatch — a
 * stale-fixture failure, not a feature-gap failure.
 *
 * Fixed: the seed SKILL.md now carries `composition.guards` (the true
 * post-migration on-disk shape). E1a is the real subject — a round-trip PUT
 * with `composition.guards` in the body preserves it exactly. E1b is new
 * (see below): a legacy-hooks on-disk file makes the PUT fail loud (500),
 * proving the bridge's OWN load path inherits the loud-failure contract —
 * this is NOT redundant with A3's lint-surface case
 * (`cli/studio-lint-guards-migration.test.ts`), because it drives a
 * DIFFERENT real entry point: `runStudioLint` is a read-only SCAN that
 * catches the throw and turns it into a `Finding` (never crashes the scan);
 * the PUT route's `existing = loadAgentDefinition(...)` call is wrapped in
 * its own try/catch (`bridge-studio-writes.ts`) that turns the SAME throw
 * into an HTTP 500 response — a distinct product surface with its own
 * contract (does the operator's save request fail loud, not just does the
 * lint report drift), so it gets its own pin.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { loadAgentDefinition } from '../orchestrator/studio/registry.ts';

const SLUG = 'write-agent-guards';
const LEGACY_SLUG = 'write-agent-legacy-hooks';

function makeSeedSkillMd(name: string, compositionBlock: string[]): string {
  return [
    '---',
    `name: ${name}`,
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
    ...compositionBlock,
    'runtime:',
    '  sdk: claude-code',
    '  strategy: fixed',
    '  model: claude-sonnet-4-5',
    'allowed-tools: []',
    'disallowed-tools: []',
    'budgets: {}',
    '---',
    '',
    `# ${name}`,
    '',
    'Process body text.',
  ].join('\n');
}

/** Post-migration on-disk shape — the true seed for E1a. */
function makeGuardsSeedSkillMd(): string {
  return makeSeedSkillMd('Write Agent Guards', ['  guards:', '    - event-log']);
}

/** The OLD, now-impossible on-disk shape — the true seed for E1b (proves the
 * bridge PUT path fails loud rather than silently accepting/rewriting it). */
function makeLegacyHooksSeedSkillMd(): string {
  return makeSeedSkillMd('Write Agent Legacy Hooks', ['  hooks:', '    - event-log']);
}

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-guards-migration-'));
  mkdirSync(join(forgeRoot, 'skills', SLUG), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', SLUG, 'SKILL.md'), makeGuardsSeedSkillMd());
  mkdirSync(join(forgeRoot, 'skills', LEGACY_SLUG), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', LEGACY_SLUG, 'SKILL.md'), makeLegacyHooksSeedSkillMd());
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

test('E1a: PUT /api/studio/agents/:slug with composition.guards round-trips through a save + re-load', async () => {
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
      guards: ['event-log', 'cost-guard'],
    },
    runtime: { sdk: 'claude-code', strategy: 'fixed', model: 'claude-sonnet-4-5' },
  };

  const res = await putJson(`${bridgeUrl}/api/studio/agents/${SLUG}`, putBody);
  const putResponseBody = await res.json().catch(() => null);
  assert.equal(res.status, 200, `expected the PUT to succeed (200) — got ${res.status}: ${JSON.stringify(putResponseBody)}`);

  const reloaded = loadAgentDefinition(join(forgeRoot, 'skills', SLUG, 'SKILL.md'));
  assert.deepEqual(
    reloaded.composition.guards,
    ['event-log', 'cost-guard'],
    `expected the re-loaded def's composition.guards to equal the PUT body's sent value — got: ${JSON.stringify(reloaded.composition.guards)}`,
  );
});

test('E1b: PUT /api/studio/agents/:slug against a legacy-hooks on-disk SKILL.md fails loud (500), never a silent 200 or a silent rewrite', async () => {
  const putBody = {
    name: 'Write Agent Legacy Hooks',
    purpose: 'Prove the bridge PUT path fails loud on a legacy on-disk file.',
    process: 'Updated process body.',
    interactivity: 'none',
    brainAccess: 'advisory',
    composition: { skills: [], tools: [], mcps: [], guards: ['event-log'] },
    runtime: { sdk: 'claude-code', strategy: 'fixed', model: 'claude-sonnet-4-5' },
  };

  const res = await putJson(`${bridgeUrl}/api/studio/agents/${LEGACY_SLUG}`, putBody);
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  assert.equal(
    res.status,
    500,
    `expected the PUT against a legacy composition.hooks on-disk file to fail loud (500) — got ${res.status}: ${JSON.stringify(body)}`,
  );
  assert.ok(
    body?.error?.includes('composition.hooks') && body.error.includes('composition.guards'),
    `expected the 500 error to name both composition.hooks and composition.guards — got: ${JSON.stringify(body)}`,
  );
});
