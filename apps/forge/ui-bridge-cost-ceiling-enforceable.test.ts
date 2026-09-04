/**
 * Acceptance tests for WI-3 (R6-04): `GET /api/studio/agents` must serve the
 * new `costCeilingEnforceable` capability fact (orchestrator/studio/derive.ts
 * `agentCapabilityDescriptor`) on each agent's `capability` object — the SAME
 * wire shape the route already uses for `interactive`/`runtimeSdks`/
 * `fanoutCapable`/`materials` (cli/bridge-studio.ts:
 * `agents.map((a) => ({ ...a, capability: agentCapabilityDescriptor(a) }))`).
 *
 * This is a BRIDGE-LAYER test (independent of
 * orchestrator/studio/derive-cost-ceiling-enforceable.test.ts's pure-function
 * coverage of the same field): it proves the fact actually reaches the wire
 * through the real HTTP route, not merely that the pure function computes it
 * correctly in isolation. A descriptor-only test cannot catch a bridge route
 * that computes the descriptor but strips/omits the new key before
 * `sendJson`, or a route that spreads the OLD 4-key shape from a stale local
 * type.
 *
 * Placement: `node --test` home (package.json test glob includes
 * `cli/*.test.ts`). Mirrors the harness pattern established in
 * `cli/ui-bridge-agent-run-ceiling.test.ts` section (D) — reimplemented
 * locally (not imported) since these are independently-owned test files, the
 * same convention that file's own header documents for
 * DRY_BRIDGE_LOG_BUCKET-adjacent helpers.
 *
 * RUN: node --test --experimental-strip-types cli/ui-bridge-cost-ceiling-enforceable.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

/** A minimal, valid studio SKILL.md fixture — `loopStrategy` is only emitted
 *  when provided, so omitting it exercises the real "absent" frontmatter
 *  shape rather than a stubbed-empty-string one. */
function studioAgentFixture(slug: string, loopStrategy?: string): string {
  return `---
name: ${slug}
description: fixture agent for the costCeilingEnforceable wire test
purpose: exercise GET /api/studio/agents' capability.costCeilingEnforceable
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
${loopStrategy !== undefined ? `  loopStrategy: ${loopStrategy}\n` : ''}allowed-tools: [Read]
disallowed-tools: [Bash]
---

Fixture body for ${slug}.
`;
}

function scaffoldForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'bridge-ceiling-enforceable-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(root, '_queue', state), { recursive: true });
  }
  mkdirSync(join(root, '_logs'), { recursive: true });
  mkdirSync(join(root, 'skills', 'fixture-one-shot'), { recursive: true });
  writeFileSync(join(root, 'skills', 'fixture-one-shot', 'SKILL.md'), studioAgentFixture('fixture-one-shot', 'one-shot'));
  mkdirSync(join(root, 'skills', 'fixture-legacy'), { recursive: true });
  writeFileSync(join(root, 'skills', 'fixture-legacy', 'SKILL.md'), studioAgentFixture('fixture-legacy'));
  mkdirSync(join(root, 'skills', 'fixture-ralph'), { recursive: true });
  writeFileSync(join(root, 'skills', 'fixture-ralph', 'SKILL.md'), studioAgentFixture('fixture-ralph', 'ralph'));
  return root;
}

type WireAgent = { slug: string; capability?: { costCeilingEnforceable?: boolean; interactive?: boolean; runtimeSdks?: string[]; fanoutCapable?: boolean; materials?: string[] } };

async function fetchAgents(url: string): Promise<{ status: number; agents: WireAgent[] }> {
  const res = await fetch(`${url}/api/studio/agents`);
  const body = (await res.json()) as { agents: WireAgent[] };
  return { status: res.status, agents: body.agents };
}

test('GET /api/studio/agents: a one-shot agent\'s capability carries costCeilingEnforceable: true on the wire', async () => {
  const root = scaffoldForgeRoot();
  const bridge = await startBridge({ forgeRoot: root, port: 0 });
  try {
    const { status, agents } = await fetchAgents(bridge.url);
    assert.equal(status, 200);
    const agent = agents.find((a) => a.slug === 'fixture-one-shot');
    assert.ok(agent, 'expected fixture-one-shot in the served roster');
    assert.ok(agent!.capability, 'expected a capability object on the wire (existing R2-02-F1 contract)');
    assert.equal(agent!.capability!.costCeilingEnforceable, true);
  } finally {
    await bridge.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('GET /api/studio/agents: an agent with NO loopStrategy declared carries costCeilingEnforceable: TRUE on the wire (⚑ AMENDED W7-B5 agents-21: the legacy invocation path now enforces via the adapter per-iteration budget — see run-agent-w7b5.test.ts)', async () => {
  const root = scaffoldForgeRoot();
  const bridge = await startBridge({ forgeRoot: root, port: 0 });
  try {
    const { agents } = await fetchAgents(bridge.url);
    const agent = agents.find((a) => a.slug === 'fixture-legacy');
    assert.ok(agent, 'expected fixture-legacy in the served roster');
    assert.equal(agent!.capability!.costCeilingEnforceable, true);
  } finally {
    await bridge.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// Kills a truthy-loopStrategy implementation at the WIRE layer too (not only
// the pure-function layer) — 'ralph' is declared and truthy, but not 'one-shot'.
test('GET /api/studio/agents: an agent declaring loopStrategy "ralph" carries costCeilingEnforceable: false on the wire (not merely "truthy loopStrategy")', async () => {
  const root = scaffoldForgeRoot();
  const bridge = await startBridge({ forgeRoot: root, port: 0 });
  try {
    const { agents } = await fetchAgents(bridge.url);
    const agent = agents.find((a) => a.slug === 'fixture-ralph');
    assert.ok(agent, 'expected fixture-ralph in the served roster');
    assert.equal(agent!.capability!.costCeilingEnforceable, false);
  } finally {
    await bridge.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// The existing capability keys must survive byte-identically alongside the
// new one — kills an implementation that replaces the descriptor spread with
// a hand-picked subset of keys (dropping e.g. `materials` while adding the
// new field).
test('GET /api/studio/agents: costCeilingEnforceable coexists with the existing capability keys (interactive, runtimeSdks, fanoutCapable, materials) — none dropped', async () => {
  const root = scaffoldForgeRoot();
  const bridge = await startBridge({ forgeRoot: root, port: 0 });
  try {
    const { agents } = await fetchAgents(bridge.url);
    const agent = agents.find((a) => a.slug === 'fixture-one-shot');
    assert.ok(agent?.capability, 'expected a capability object');
    const cap = agent!.capability!;
    assert.equal(typeof cap.interactive, 'boolean', 'interactive must still be present');
    assert.ok(Array.isArray(cap.runtimeSdks), 'runtimeSdks must still be present');
    assert.equal(typeof cap.fanoutCapable, 'boolean', 'fanoutCapable must still be present');
    assert.ok(Array.isArray(cap.materials), 'materials must still be present');
    assert.equal(typeof cap.costCeilingEnforceable, 'boolean', 'costCeilingEnforceable must be present');
  } finally {
    await bridge.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// Real-roster grounding at the wire layer (not just the pure-function layer
// covered by derive-cost-ceiling-enforceable.test.ts) — proves the FULL
// route (skill discovery + frontmatter parse + descriptor + JSON
// serialization) gets the real project-manager/architect agents right, not
// just a synthetic fixture that might not mirror the real YAML shape.
test('GET /api/studio/agents: real roster — project-manager true, architect TRUE (⚑ AMENDED W7-B5 agents-21: legacy path enforceable), developer-ralph false, served over the real bridge process', async () => {
  // Deliberately NOT scaffoldForgeRoot() here — this test points the bridge
  // at the REAL repo root (this process's cwd, expected to be the forge
  // install root when run via `node --test`) so it exercises the full route
  // (skill discovery + real SKILL.md frontmatter parse + descriptor +
  // serialization) against the genuine project-manager/architect skills, not
  // a synthetic fixture. Nothing here is created or deleted — read-only GET.
  const bridge = await startBridge({ forgeRoot: process.cwd(), port: 0 });
  try {
    const { agents } = await fetchAgents(bridge.url);
    const pm = agents.find((a) => a.slug === 'project-manager');
    const architect = agents.find((a) => a.slug === 'architect');
    const ralph = agents.find((a) => a.slug === 'developer-ralph');
    assert.ok(pm, 'expected the real project-manager agent in the roster');
    assert.ok(architect, 'expected the real architect agent in the roster');
    assert.ok(ralph, 'expected the real developer-ralph agent in the roster');
    assert.equal(pm!.capability!.costCeilingEnforceable, true, 'project-manager declares loopStrategy: one-shot');
    assert.equal(architect!.capability!.costCeilingEnforceable, true, 'architect declares no loopStrategy — the legacy invocation path enforces since W7-B5');
    assert.equal(ralph!.capability!.costCeilingEnforceable, false, 'developer-ralph declares loopStrategy: ralph — standalone dispatch is refused outright');
  } finally {
    await bridge.close();
  }
});
