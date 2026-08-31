/**
 * agents-44 — a starter agent materialised by a flow save must be DISPATCHABLE.
 *
 * The flow PUT materialises any starter agent a saved canvas names (plan / dev
 * / review) straight into skills/. Before this test that copy was verbatim, so
 * the live agent landed WITHOUT a `phase:` field — and `deriveAgentSpec`, which
 * runAgent() calls synchronously as its Step 1 before any spawn, hard-requires
 * one. The operator's Run control read fully ready and every dispatch of
 * Studio's own shipped starter flow died on "cannot derive spec — no phase
 * field", with no in-Studio recovery (a builder re-save preserves an existing
 * agent's absent phase verbatim, by design).
 *
 * The gate: every materialised starter's ON-DISK SKILL.md round-trips through
 * deriveAgentSpec without throwing — the same synthesis (`phase: <slug>`) the
 * sibling agent-builder PUT path already performs for a brand-new mint.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { deriveAgentSpec } from '@forge/agents/studio/derive.ts';
import { loadAgentDefinition } from '../orchestrator/studio/registry.ts';

const REAL_ROOT = process.cwd();
const STARTER_SLUGS = ['plan', 'dev', 'review'] as const;

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-starter-materialise-'));

  // The real starter library + catalog — this defect is about the SHIPPED
  // starters, so the fixture uses them verbatim rather than hand-written stubs.
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  cpSync(join(REAL_ROOT, 'studio', 'catalog.yaml'), join(forgeRoot, 'studio', 'catalog.yaml'));
  cpSync(join(REAL_ROOT, 'studio', 'starters'), join(forgeRoot, 'studio', 'starters'), { recursive: true });

  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  for (const state of ['pending', 'in-flight', 'done', 'ready-for-review', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
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

/** Save Studio's own shipped basic plan→dev→review starter canvas. */
async function saveStarterFlow(): Promise<Response> {
  return fetch(`${bridgeUrl}/api/studio/flows/basic-copy`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({
      name: 'Basic Flow',
      goal: 'Plan a change, implement it, and review the result before it merges.',
      nodes: [
        { id: 'plan', agent: 'plan' },
        { id: 'dev', agent: 'dev' },
        { id: 'review', agent: 'review', gate: 'verdict' },
      ],
      edges: [
        { from: 'plan', to: 'dev', artifact: 'plan' },
        { from: 'dev', to: 'review', artifact: 'pr' },
      ],
      triggers: [],
    }),
  });
}

test('a flow save materialises the starter agents into skills/', async () => {
  const res = await saveStarterFlow();
  assert.equal(res.status, 200, `flow save failed: ${await res.text()}`);
  for (const slug of STARTER_SLUGS) {
    assert.ok(
      existsSync(join(forgeRoot, 'skills', slug, 'SKILL.md')),
      `expected the flow save to materialise skills/${slug}/SKILL.md`,
    );
  }
});

test('every materialised starter agent derives a spec — runAgent() Step 1 (agents-44)', () => {
  for (const slug of STARTER_SLUGS) {
    // The decisive call: this is literally runAgent()'s Step 1, run
    // synchronously before any spawn. It threw for all three starters.
    const spec = deriveAgentSpec(join('skills', slug, 'SKILL.md'), forgeRoot);
    assert.equal(spec.phase, slug);
    assert.equal(spec.skill, join('skills', slug, 'SKILL.md'));

    const def = loadAgentDefinition(join(forgeRoot, 'skills', slug, 'SKILL.md'));
    assert.equal(
      def.phase,
      slug,
      `skills/${slug}/SKILL.md must carry phase: ${slug} — materialisation must stamp it, exactly as the agent-builder PUT synthesises phase for a brand-new mint`,
    );
  }
});

test('materialisation preserves the starter package verbatim apart from the stamped fields', () => {
  for (const slug of STARTER_SLUGS) {
    const starter = loadAgentDefinition(join(forgeRoot, 'studio', 'starters', 'agents', slug, 'SKILL.md'));
    const live = loadAgentDefinition(join(forgeRoot, 'skills', slug, 'SKILL.md'));
    assert.equal(live.name, starter.name);
    assert.equal(live.description, starter.description);
    assert.equal(live.purpose, starter.purpose);
    assert.deepEqual(live.runtime, starter.runtime);
    assert.deepEqual(live.composition, starter.composition);
    assert.deepEqual(live.allowedTools, starter.allowedTools);
    assert.deepEqual(live.disallowedTools, starter.disallowedTools);
    assert.equal(live.body, starter.body);
  }
});
