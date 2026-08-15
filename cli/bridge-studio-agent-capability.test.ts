/**
 * Tests for GET /api/studio/agents/:slug/capability (W6-B6 fix — wave-6
 * final gate, journey demo-builder DB-4).
 *
 * Covers:
 *   - happy path: a strategy:range, library:false agent (mirrors
 *     demo-builder's real shape) returns its full allowedTiers envelope,
 *     even though it is EXCLUDED from /api/studio/agents' roster
 *   - a strategy:fixed agent returns no allowedTiers key at all
 *   - unknown slug → 404
 *   - a plain skill (no runtime: block) → 404, same response as unknown
 *   - a quarantined/installed def (D4) → 404, even though it carries runtime:
 *   - malformed/traversal-shaped slug → 400, before any fs call
 *   - a SYMLINKED SKILL.md FILE escaping the forge root → 404, no leak
 *   - a smoke test against the REAL forge repo's skills/demo-builder/SKILL.md
 *     — the exact regression this fix closes — returns ['sonnet','opus']
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const CATALOG_FIXTURE = `sdks:
  - { id: claude, name: Claude Agent SDK, available: true }
models:
  - { id: claude-sonnet-4-6, name: Claude Sonnet 4.6, sdk: claude, tier: sonnet, costIn: 3, costOut: 15 }
  - { id: claude-opus-4-8, name: Claude Opus 4.8, sdk: claude, tier: opus, costIn: 5, costOut: 25 }
tools: []
mcps: []
guards: []
`;

function makeRangeLibraryFalseAgent(): string {
  return [
    '---',
    'name: Kickoff-Only Range Agent',
    'description: Mirrors demo-builder — strategy:range, library:false.',
    'phase: unifier',
    'library: false',
    'purpose: Exercise the capability route for a range, library:false agent.',
    'brainAccess: none',
    'interactivity: Operator-driven.',
    'composition:',
    '  skills: []',
    '  tools: []',
    '  mcps: []',
    '  guards: []',
    'runtime:',
    '  sdk: claude',
    '  strategy: range',
    '  range:',
    '    - claude-sonnet-4-6',
    '    - claude-opus-4-8',
    'allowed-tools: []',
    'disallowed-tools: []',
    'budgets: {}',
    '---',
    '',
    '# Range Agent',
  ].join('\n');
}

function makeFixedLibraryFalseAgent(): string {
  return [
    '---',
    'name: Kickoff-Only Fixed Agent',
    'description: Mirrors project-brain-builder — strategy:fixed, library:false.',
    'phase: unifier',
    'library: false',
    'purpose: Exercise the capability route for a fixed, library:false agent.',
    'brainAccess: none',
    'interactivity: Fully autonomous.',
    'composition:',
    '  skills: []',
    '  tools: []',
    '  mcps: []',
    '  guards: []',
    'runtime:',
    '  sdk: claude',
    '  strategy: fixed',
    '  model: claude-sonnet-4-6',
    'allowed-tools: []',
    'disallowed-tools: []',
    'budgets: {}',
    '---',
    '',
    '# Fixed Agent',
  ].join('\n');
}

function makePlainSkill(): string {
  return [
    '---',
    'name: Plain Skill',
    'description: No runtime block — not a studio agent at all.',
    '---',
    '',
    '# Plain Skill',
  ].join('\n');
}

function makeQuarantinedAgent(): string {
  return [
    '---',
    'name: Quarantined Agent',
    'description: An installed package that happens to carry a runtime block.',
    'quarantined: true',
    'runtime:',
    '  sdk: claude',
    '  strategy: fixed',
    '  model: claude-sonnet-4-6',
    '---',
    '',
    '# Quarantined Agent',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Global fixtures
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-agent-capability-'));

  mkdirSync(join(forgeRoot, 'skills', 'range-agent'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'range-agent', 'SKILL.md'), makeRangeLibraryFalseAgent());
  mkdirSync(join(forgeRoot, 'skills', 'fixed-agent'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'fixed-agent', 'SKILL.md'), makeFixedLibraryFalseAgent());
  mkdirSync(join(forgeRoot, 'skills', 'plain-skill'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'plain-skill', 'SKILL.md'), makePlainSkill());
  mkdirSync(join(forgeRoot, 'skills', 'quarantined-agent'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'quarantined-agent', 'SKILL.md'), makeQuarantinedAgent());

  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'catalog.yaml'), CATALOG_FIXTURE);
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

// ---------------------------------------------------------------------------
// Happy path — the roster-excluded, library:false range agent
// ---------------------------------------------------------------------------

test('a library:false strategy:range agent (mirrors demo-builder) returns its full allowedTiers envelope', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/agents/range-agent/capability`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as { slug: string; capability: { allowedTiers?: string[] } };
  assert.equal(body.slug, 'range-agent');
  assert.deepEqual(body.capability.allowedTiers, ['sonnet', 'opus'], 'cheapest-first');
});

test('the same library:false agent is EXCLUDED from /api/studio/agents\' roster — proving the roster gate is real', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/agents`);
  const body = (await res.json()) as { agents: { slug: string }[] };
  assert.ok(!body.agents.some((a) => a.slug === 'range-agent'), 'library:false agent must not appear in the roster');
});

// ---------------------------------------------------------------------------
// strategy:fixed — no allowedTiers key
// ---------------------------------------------------------------------------

test('a library:false strategy:fixed agent (mirrors project-brain-builder) has no allowedTiers key at all', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/agents/fixed-agent/capability`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as { slug: string; capability: Record<string, unknown> };
  assert.equal(body.slug, 'fixed-agent');
  assert.ok(!('allowedTiers' in body.capability), 'a fixed-strategy descriptor must omit allowedTiers entirely');
});

// ---------------------------------------------------------------------------
// Unknown / non-agent / quarantined slugs → 404
// ---------------------------------------------------------------------------

test('unknown slug → 404', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/agents/no-such-agent/capability`);
  assert.equal(res.status, 404);
});

test('a plain skill (no runtime: block) → 404, same as an unknown slug', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/agents/plain-skill/capability`);
  assert.equal(res.status, 404);
});

test('a quarantined installed package → 404, even though it carries a runtime: block (D4)', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/agents/quarantined-agent/capability`);
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// Malformed / traversal-shaped slug → 400, before any fs call
// ---------------------------------------------------------------------------

test('encoded traversal slug "..%2F..%2Fetc%2Fpasswd" → 400', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/agents/..%2F..%2Fetc%2Fpasswd/capability`);
  assert.equal(res.status, 400);
});

test('a ~30-deep repeated "../" slug chain does not escape the forge root', async () => {
  const evilSlug = '..%2F'.repeat(30) + 'etc%2Fpasswd';
  const res = await fetch(`${bridgeUrl}/api/studio/agents/${evilSlug}/capability`);
  assert.ok(res.status === 400 || res.status === 404, `expected 400/404, got ${res.status}`);
  const text = await res.text();
  assert.ok(!/root:.*:0:0:/.test(text), 'response must never carry real /etc/passwd content');
});

test('a SYMLINKED SKILL.md FILE escaping the forge root → 404, no leak', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'agent-capability-outside-'));
  const marker = 'OUTSIDE-SECRET-MARKER-DO-NOT-LEAK-9d2e1b';
  const outsideFile = join(outsideDir, 'secret.md');
  writeFileSync(
    outsideFile,
    `---\nname: leaked\npurpose: ${marker}\nruntime:\n  sdk: claude\n  strategy: fixed\n  model: claude-sonnet-4-6\n---\n\n${marker}\n`,
    'utf8',
  );

  mkdirSync(join(forgeRoot, 'skills', 'escape-agent'), { recursive: true });
  const linkPath = join(forgeRoot, 'skills', 'escape-agent', 'SKILL.md');
  try {
    symlinkSync(outsideFile, linkPath);
  } catch {
    rmSync(outsideDir, { recursive: true, force: true });
    return;
  }

  try {
    const res = await fetch(`${bridgeUrl}/api/studio/agents/escape-agent/capability`);
    const text = await res.text();
    assert.equal(res.status, 404);
    assert.ok(!text.includes(marker), 'the outside file content must never appear in the response');
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Real-repo smoke test — the exact regression this fix closes
// ---------------------------------------------------------------------------

test('REAL REPO: demo-builder (library:false, strategy:range) returns allowedTiers [sonnet, opus] off its real SKILL.md', async () => {
  const realForgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const realQueueDone = join(realForgeRoot, '_queue', 'done');
  const realLogs = join(realForgeRoot, '_logs');
  // Real repo checkouts always carry these (gitignored but present in dev/CI);
  // scaffold defensively rather than assume, mirroring other real-repo smoke
  // tests in this suite family.
  mkdirSync(realQueueDone, { recursive: true });
  mkdirSync(realLogs, { recursive: true });

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const { url, close } = await startBridge({ forgeRoot: realForgeRoot, port: 0 });
  try {
    const res = await fetch(`${url}/api/studio/agents/demo-builder/capability`);
    const text = await res.text();
    assert.equal(res.status, 200, text);
    const body = JSON.parse(text) as { slug: string; capability: { allowedTiers?: string[] } };
    assert.equal(body.slug, 'demo-builder');
    assert.deepEqual(body.capability.allowedTiers, ['sonnet', 'opus']);
  } finally {
    await close();
  }
});
