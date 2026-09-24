/**
 * forge-q4sz — `PUT /api/studio/agents/:slug` saves an agent whose
 * `disallowedTools` omits the Task/Agent subagent-spawn fence, returning 200.
 *
 * `allowed-tools` is advisory only (no production spawn site sets the SDK's
 * `tools` option); `disallowed-tools` naming BOTH `Task` (SDK permission name)
 * and `Agent` (this harness's external name for the same tool) is the only
 * real fence. `lintSkillToolFence` (`packages/library/studio-lint-tool-fence.ts`)
 * already encodes this rule and is the ONLY place `forge studio lint` checks
 * it — the bridge PUT route never called it, so a save with an empty/missing
 * fence sailed through with 200 while validateAgent's OTHER error-level
 * findings (missing purpose, malformed disallowedTools shape, …) already 400
 * on the same route.
 *
 * Fix direction (bead): reuse `lintSkillToolFence` itself — never
 * re-implement its rule — inside the PUT validation block, and 400 the same
 * way the route already 400s any other error-level finding.
 *
 * Drives `handleStudioAgentWrite` directly (no bridge — COMMON §5; see
 * `bridge-agents-studio-composed-by.test.ts` in this same directory for the
 * established idiom and why a package test may not add a fresh
 * `apps/forge/ui-bridge.ts` edge to `check-boundaries.mjs`'s ratchet).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteContext } from '@forge/kernel';
import matter from 'gray-matter';

import { handleStudioAgentWrite, type AgentStudioRouteDeps } from '../../bridge-agents-studio.ts';

function setupForgeRoot(): string {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-agents-studio-put-fence-'));
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

function throwingAgentFacts(): AgentStudioRouteDeps['agentFacts'] {
  return {
    usage: () => { throw new Error('unexpected AgentFacts.usage call'); },
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

/** Minimal valid PUT body — mirrors `apps/forge/tests/integration/bridge-studio-write.test.ts`'s
 *  own `makePutAgentBody`, adapted with an explicit `disallowedTools` so the
 *  new-agent path (no `existing` to inherit from) always declares the field. */
function makePutBody(disallowedTools: string[]): Record<string, unknown> {
  return {
    name: 'Fence Test Agent',
    purpose: 'PUT tool-fence regression fixture.',
    process: 'Do the fixture thing.',
    interactivity: 'none',
    brainAccess: 'advisory',
    composition: { skills: [], tools: [], mcps: [], guards: [] },
    runtime: { sdk: 'claude-code', strategy: 'fixed', model: 'claude-sonnet-4-5' },
    allowedTools: [],
    disallowedTools,
  };
}

async function put(
  forgeRoot: string,
  slug: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const { res, captured } = mockRes();
  const ctx: RouteContext = {
    forgeRoot,
    logsRoot: join(forgeRoot, '_logs'),
    readBody: async () => body,
  };
  const handled = await handleStudioAgentWrite(makeDeps())(mockReq(), res, ctx, `/api/studio/agents/${slug}`, 'PUT');
  assert.ok(handled, 'the handler must claim a well-formed /api/studio/agents/:slug URL');
  return { status: captured.status ?? 0, json: JSON.parse(captured.body || '{}') as Record<string, unknown> };
}

test('PUT /api/studio/agents/:slug refuses 400 (same shape as other error-level findings) when disallowedTools omits Task and Agent', async () => {
  const forgeRoot = setupForgeRoot();
  try {
    const { status, json } = await put(forgeRoot, 'fenceless-agent', makePutBody([]));

    assert.equal(
      status,
      400,
      `saving an agent with no Task/Agent fence must be refused 400 — got ${status}: ${JSON.stringify(json)}`,
    );
    const findings = (json['findings'] as Array<{ check?: string; level?: string }> | undefined) ?? [];
    assert.ok(
      findings.some((f) => f.check === 'skill-tool-fence/task-agent-not-disallowed' && f.level === 'error'),
      `400 body must carry lintSkillToolFence's own finding — got: ${JSON.stringify(findings)}`,
    );
    assert.equal(
      existsSync(join(forgeRoot, 'skills', 'fenceless-agent')),
      false,
      'a refused save of a BRAND-NEW agent must leave no package on disk',
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('regression lock: PUT /api/studio/agents/:slug still saves 200 when disallowedTools declares both Task and Agent', async () => {
  const forgeRoot = setupForgeRoot();
  try {
    const { status, json } = await put(forgeRoot, 'fenced-agent', makePutBody(['Task', 'Agent']));
    assert.equal(status, 200, `a properly fenced agent must save 200 — got ${status}: ${JSON.stringify(json)}`);

    const skillMdPath = join(forgeRoot, 'skills', 'fenced-agent', 'SKILL.md');
    assert.ok(existsSync(skillMdPath), 'a successful save must write the SKILL.md');
    const data = matter(readFileSync(skillMdPath, 'utf8')).data as Record<string, unknown>;
    assert.deepEqual(data['disallowed-tools'], ['Task', 'Agent'], 'the fence must be persisted verbatim');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('regression lock: PUT /api/studio/agents/:slug editing an EXISTING fenced agent, refused for an unrelated fence removal, leaves the original file byte-unchanged', async () => {
  const forgeRoot = setupForgeRoot();
  try {
    const created = await put(forgeRoot, 'edit-fenced-agent', makePutBody(['Task', 'Agent']));
    assert.equal(created.status, 200, 'fixture setup: initial fenced save must succeed');
    const skillMdPath = join(forgeRoot, 'skills', 'edit-fenced-agent', 'SKILL.md');
    const originalContent = readFileSync(skillMdPath, 'utf8');

    const edited = await put(forgeRoot, 'edit-fenced-agent', makePutBody([]));
    assert.equal(edited.status, 400, `dropping the fence on an edit must also be refused 400 — got ${edited.status}`);

    const afterContent = readFileSync(skillMdPath, 'utf8');
    assert.equal(afterContent, originalContent, 'SKILL.md must be restored byte-identical after a refused fence-dropping edit');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
