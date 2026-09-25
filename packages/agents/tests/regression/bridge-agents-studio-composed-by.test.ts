/**
 * forge-8vfn.19 — `DELETE /api/studio/agents/:slug`'s "still composed by" 409
 * guard can never fire against a real agent composer.
 *
 * Root cause (per the bead, confirmed by reading
 * `packages/agents/bridge-agents-studio.ts`): the guard derived `composedBy`
 * from `listSkillLibrary(ctx.forgeRoot, deps.agentFacts).find((e) => e.id ===
 * slug)?.usedBy ?? []`. `listSkillLibrary` (`@forge/library`)
 * deliberately EXCLUDES studio agents from its roster (AT-5 — an agent is not
 * a library skill), so for any real agent slug that `.find(...)` is always
 * `undefined` and `composedBy` is always `[]`. The 409 branch is dead code for
 * its stated purpose: an agent composed by another agent's `composition.skills`
 * is deleted anyway.
 *
 * Fix direction the bead names: use agents' own reverse-index provider,
 * `agentsUsing('skill', id, forgeRoot)` (`packages/agents/studio/agent-usage.ts`,
 * ruling 13) — the SAME primitive `packages/agents/tests/unit/agent-usage.test.ts`
 * already pins in isolation.
 *
 * Drives the carved handler DIRECTLY, no bridge (COMMON §5 — a package test
 * never boots one; the same idiom
 * `packages/knowledge/tests/integration/test-fixtures/bridge-studio-kbs.ts`'s
 * `postAt` uses). This is "the way sibling route tests do" for a package-owned
 * carved route; `check-boundaries.mjs`'s package-to-assembly baseline may only
 * shrink, so a NEW test may not add a fresh edge into `apps/forge/ui-bridge.ts`
 * even though older, already-baselined tests do.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteContext } from '@forge/kernel';

import { handleStudioAgentWrite, type AgentStudioRouteDeps } from '../../bridge-agents-studio.ts';

/** A well-formed studio agent, mirroring `agent-usage.test.ts`'s own
 *  `plantAgent` fixture shape (same frontmatter fields `loadAgentDefinition`
 *  requires: `purpose`, `brainAccess`, `interactivity`, `runtime`). */
function plantAgent(forgeRoot: string, slug: string, composedSkills: string[] = []): void {
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

function setupForgeRoot(): string {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-agents-studio-composed-by-'));
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  return forgeRoot;
}

const mockReq = () => ({ headers: {} }) as unknown as IncomingMessage;

function mockRes(): { res: ServerResponse; captured: { status: number | null; body: string } } {
  const captured: { status: number | null; body: string } = { status: null, body: '' };
  const res = {
    writeHead(status: number) { captured.status = status; return res; },
    end(payload?: string) { if (payload !== undefined) captured.body = payload; return res; },
  } as unknown as ServerResponse;
  return { res, captured };
}

/** `agentFacts` is unused by the fixed guard (it now calls `agentsUsing`
 *  directly) — a throwing stub proves that: if the route ever reached for it
 *  again this fixture would surface it loudly instead of silently answering
 *  with a plausible-looking fake. */
function throwingAgentFacts(): AgentStudioRouteDeps['agentFacts'] {
  return {
    usage: () => { throw new Error('unexpected AgentFacts.usage call — composedBy must use agentsUsing directly'); },
    compositions: () => { throw new Error('unexpected AgentFacts.compositions call'); },
    isAgentSkillMd: () => { throw new Error('unexpected AgentFacts.isAgentSkillMd call'); },
  };
}

function makeDeps(): AgentStudioRouteDeps {
  return {
    listFlowIds: () => [],
    flowPathForId: () => { throw new Error('unexpected flowPathForId call — no flow fixtures in this suite'); },
    loadFlowDefinition: () => { throw new Error('unexpected loadFlowDefinition call — no flow fixtures in this suite'); },
    agentFacts: throwingAgentFacts(),
  };
}

async function del(forgeRoot: string, slug: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const { res, captured } = mockRes();
  const ctx: RouteContext = {
    forgeRoot,
    logsRoot: join(forgeRoot, '_logs'),
    readBody: async () => { throw new Error('DELETE must never read a body'); },
  };
  const handled = await handleStudioAgentWrite(makeDeps())(mockReq(), res, ctx, `/api/studio/agents/${slug}`, 'DELETE');
  assert.ok(handled, 'the handler must claim a well-formed /api/studio/agents/:slug URL');
  return { status: captured.status ?? 0, json: JSON.parse(captured.body || '{}') as Record<string, unknown> };
}

test('DELETE /api/studio/agents/:slug refuses 409, naming the composer, when another REAL agent composes it as a skill', async () => {
  const forgeRoot = setupForgeRoot();
  try {
    plantAgent(forgeRoot, 'composer-agent', ['target-agent']);
    plantAgent(forgeRoot, 'target-agent');

    const { status, json } = await del(forgeRoot, 'target-agent');
    const usedBy = (json['usedBy'] as string[] | undefined) ?? [];

    assert.equal(
      status,
      409,
      `an agent composed by another real agent must be refused 409 — got ${status}: ${JSON.stringify(json)}`,
    );
    assert.match(
      String(json['error'] ?? ''),
      /still composed by/i,
      `409 body must explain the refusal — got: ${JSON.stringify(json)}`,
    );
    assert.ok(
      usedBy.includes('composer-agent'),
      `409 body must name the composer "composer-agent" — got usedBy: ${JSON.stringify(usedBy)}`,
    );
    assert.ok(existsSync(join(forgeRoot, 'skills', 'target-agent')), 'a refused delete must leave the package on disk');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('regression lock: DELETE /api/studio/agents/:slug still succeeds for an agent nobody composes', async () => {
  const forgeRoot = setupForgeRoot();
  try {
    plantAgent(forgeRoot, 'lonely-agent');

    const { status } = await del(forgeRoot, 'lonely-agent');
    assert.equal(status, 200, `an uncomposed agent must still delete cleanly — got ${status}`);
    assert.equal(existsSync(join(forgeRoot, 'skills', 'lonely-agent')), false, 'the package directory must be gone');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
