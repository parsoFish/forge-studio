/**
 * forge-8vfn.19 — `DELETE /api/studio/agents/:slug`'s "still composed by" 409
 * guard can never fire against a real agent composer.
 *
 * Root cause (per the bead, confirmed by reading
 * `packages/agents/bridge-agents-studio.ts`): the guard derived `composedBy`
 * from `listSkillLibrary(ctx.forgeRoot, deps.agentFacts).find((e) => e.id ===
 * slug)?.usedBy ?? []`. `listSkillLibrary` (`@forge/library/studio/skill-trust.ts`)
 * deliberately EXCLUDES studio agents from its roster (AT-5 — an agent is not
 * a library skill), so for any real agent slug that `.find(...)` is always
 * `undefined` and `composedBy` is always `[]`. The 409 branch is dead code for
 * its stated purpose: an agent composed by another agent's `composition.skills`
 * is deleted anyway.
 *
 * Fix direction the bead names: use agents' own reverse-index provider,
 * `agentsUsing('skill', id, forgeRoot)` (`packages/agents/studio/agent-usage.ts`,
 * ruling 13) — the SAME primitive `packages/agents/tests/unit/agent-usage.test.ts`
 * already pins in isolation. This test drives the real HTTP route end to end
 * (mirrors `apps/forge/tests/regression/bridge-studio-writes-ledger-prune.test.ts`'s
 * and `packages/agents/tests/regression/legacy-dispatch-project-guard.test.ts`'s
 * own `startBridge({ forgeRoot, port: 0 })` + `fetch` idiom — "drive the route
 * the way sibling route tests do") rather than unit-testing the index alone,
 * because the defect is specifically in how the ROUTE wires that index in.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from '../../../../apps/forge/ui-bridge.ts';

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

/** A well-formed studio agent, mirroring `agent-usage.test.ts`'s own
 *  `plantAgent` fixture shape (same frontmatter fields `loadAgentDefinition`
 *  requires: `purpose`, `brainAccess`, `interactivity`, `runtime`). */
function plantAgent(slug: string, composedSkills: string[] = []): void {
  const dir = join(forgeRoot, 'skills', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---
name: ${slug}
description: Agent ${slug}.
purpose: composed-by fixture.
brainAccess: none
interactivity: Fully autonomous.
runtime:
  sdk: claude
  strategy: fixed
composition:
  skills: [${composedSkills.join(', ')}]
  tools: []
  mcps: []
  hooks: []
  guards: []
---

Body.
`,
  );
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-agents-studio-composed-by-'));
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'catalog.yaml'),
    ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []', 'community-skills: []', ''].join('\n'),
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

async function del(url: string): Promise<Response> {
  return fetch(url, { method: 'DELETE', headers: { 'x-forge-csrf': '1' } });
}

test('DELETE /api/studio/agents/:slug refuses 409, naming the composer, when another REAL agent composes it as a skill', async () => {
  plantAgent('composer-agent', ['target-agent']);
  plantAgent('target-agent');

  const res = await del(`${bridgeUrl}/api/studio/agents/target-agent`);
  const body = (await res.json()) as { error?: string; usedBy?: string[] };

  assert.equal(
    res.status,
    409,
    `an agent composed by another real agent must be refused 409 — got ${res.status}: ${JSON.stringify(body)}`,
  );
  assert.match(body.error ?? '', /still composed by/i, `409 body must explain the refusal — got: ${JSON.stringify(body)}`);
  assert.ok(
    (body.usedBy ?? []).includes('composer-agent'),
    `409 body must name the composer "composer-agent" — got usedBy: ${JSON.stringify(body.usedBy)}`,
  );
  assert.ok(existsSync(join(forgeRoot, 'skills', 'target-agent')), 'a refused delete must leave the package on disk');
});

test('regression lock: DELETE /api/studio/agents/:slug still succeeds for an agent nobody composes', async () => {
  plantAgent('lonely-agent');

  const res = await del(`${bridgeUrl}/api/studio/agents/lonely-agent`);
  assert.equal(res.status, 200, `an uncomposed agent must still delete cleanly — got ${res.status}: ${await res.text()}`);
  assert.equal(existsSync(join(forgeRoot, 'skills', 'lonely-agent')), false, 'the package directory must be gone');
});
