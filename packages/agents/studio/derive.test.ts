/**
 * Frontmatter-regression lock for ADR-027 M2 ws-3: invocation files now derive
 * from SKILL.md (single source), so the M0 dual-source deep-equal became a
 * tautology. This test replaces it: assert each derived spec deep-equals an
 * EXPLICIT expected literal (the known-good values). Any frontmatter regression
 * (wrong tool list, wrong tier/model, wrong phase key) will surface here.
 *
 * W8-C2a (bead `forge-eip`): the three literals below gained `Task, Agent` in
 * `disallowedTools`. That is the lock working, not the lock being weakened —
 * the SKILL.md frontmatter genuinely changed, and this test is what forced the
 * change to be deliberate rather than incidental. `allowed-tools` is advisory
 * (the SDK auto-approves from it but never restricts), so `disallowed-tools` is
 * the only declarative fence against the subagent-spawn tool; both the SDK's
 * permission name (`Task`) and this harness's external name (`Agent`) must be
 * listed. A future edit that drops either name from a roster SKILL.md now trips
 * BOTH this literal and `skill-tool-fence/task-agent-not-disallowed` in
 * `forge studio lint`, which CI runs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { deriveAgentSpec, executionPathForSurface, agentCapabilityDescriptor, FORGE_ROOT } from './derive.ts';
import { listAgentDefinitions, loadAgentDefinition } from './agent-registry.ts';
import type { AgentDefinition } from '@forge/contracts/studio/types.ts';

// ---------------------------------------------------------------------------
// Explicit expected-literal assertions (frontmatter-regression lock, M2-3)
// ---------------------------------------------------------------------------

test('deriveAgentSpec: project-manager spec matches known-good literal', () => {
  assert.deepEqual(deriveAgentSpec('skills/project-manager/SKILL.md'), {
    phase: 'project-manager',
    skill: 'skills/project-manager/SKILL.md',
    tier: 'sonnet',
    allowedTools: ['Read', 'Grep', 'Glob', 'Write', 'Edit'],
    disallowedTools: ['Bash', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'Agent'],
    sdk: 'claude',
  });
});

test('deriveAgentSpec: developer-loop spec matches known-good literal', () => {
  assert.deepEqual(deriveAgentSpec('skills/developer-ralph/SKILL.md'), {
    phase: 'developer-loop',
    skill: 'skills/developer-ralph/SKILL.md',
    tier: 'sonnet',
    allowedTools: ['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Grep', 'Glob'],
    disallowedTools: ['NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'Agent'],
    sdk: 'claude',
  });
});

test('deriveAgentSpec: reflector spec matches known-good literal', () => {
  assert.deepEqual(deriveAgentSpec('skills/reflector/SKILL.md'), {
    phase: 'reflector',
    skill: 'skills/reflector/SKILL.md',
    tier: 'sonnet',
    allowedTools: ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash'],
    disallowedTools: ['NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'Agent'],
    sdk: 'claude',
  });
});

// ---------------------------------------------------------------------------
// Negative tests via in-memory tmp fixtures
// ---------------------------------------------------------------------------

/** Write a minimal studio SKILL.md into a tmp dir and return its absolute path. */
function writeTmpSkill(dir: string, frontmatter: string): string {
  const skillDir = mkdtempSync(join(dir, 'skill-'));
  const skillPath = join(skillDir, 'SKILL.md');
  writeFileSync(skillPath, `---\n${frontmatter}\n---\n\n# Body\n`);
  return skillPath;
}

const VALID_BASE = `name: test-agent
description: A test agent.
phase: test
surface: unattended
purpose: Test things.
composition:
  skills: []
  tools: []
  mcps: []
  guards: []
brainAccess: advisory
interactivity: Fully autonomous.
allowed-tools: [Read]
disallowed-tools: [Bash]
budgets: {}
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6`;

test('deriveAgentSpec throws when frontmatter has no phase field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-neg-'));
  try {
    const fm = VALID_BASE.replace('phase: test\n', '');
    const skillPath = writeTmpSkill(dir, fm);
    assert.throws(
      () => deriveAgentSpec(skillPath, '/'),
      /cannot derive spec — no phase field/,
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('deriveAgentSpec: strategy:range derives spec at cheapest tier (haiku < sonnet)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-range-'));
  try {
    const fm = VALID_BASE
      .replace('strategy: fixed', 'strategy: range')
      .replace('model: claude-sonnet-4-6', 'range:\n  - claude-haiku-4-5-20251001\n  - claude-sonnet-4-6');
    const skillPath = writeTmpSkill(dir, fm);
    // Must NOT throw; spec.tier = cheapest in range = haiku
    const spec = deriveAgentSpec(skillPath, FORGE_ROOT);
    assert.equal(spec.tier, 'haiku');
    assert.equal(spec.phase, 'test');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('deriveAgentSpec: strategy:range with opus+haiku derives at haiku (cheapest)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-range-'));
  try {
    const fm = VALID_BASE
      .replace('strategy: fixed', 'strategy: range')
      .replace('model: claude-sonnet-4-6', 'range:\n  - claude-opus-4-8\n  - claude-haiku-4-5-20251001');
    const skillPath = writeTmpSkill(dir, fm);
    const spec = deriveAgentSpec(skillPath, FORGE_ROOT);
    assert.equal(spec.tier, 'haiku');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// allowedTiers — ADR-043 §3 amendment (wave-6 kickoff model-tier seam)
// ---------------------------------------------------------------------------

test('deriveAgentSpec: strategy:range populates allowedTiers cheapest-first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-range-'));
  try {
    const fm = VALID_BASE
      .replace('strategy: fixed', 'strategy: range')
      .replace('model: claude-sonnet-4-6', 'range:\n  - claude-opus-4-8\n  - claude-sonnet-4-6');
    const skillPath = writeTmpSkill(dir, fm);
    const spec = deriveAgentSpec(skillPath, FORGE_ROOT);
    assert.deepEqual(spec.allowedTiers, ['sonnet', 'opus']);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('deriveAgentSpec: strategy:fixed omits allowedTiers entirely (not just undefined)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-fixed-'));
  try {
    const skillPath = writeTmpSkill(dir, VALID_BASE);
    const spec = deriveAgentSpec(skillPath, FORGE_ROOT);
    assert.ok(!('allowedTiers' in spec), 'allowedTiers key must be entirely absent for strategy:fixed');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('deriveAgentSpec throws when strategy:range has no range field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-range-'));
  try {
    const fm = VALID_BASE
      .replace('strategy: fixed', 'strategy: range');
    // model key is kept — should still fail because range is missing
    const skillPath = writeTmpSkill(dir, fm);
    assert.throws(
      () => deriveAgentSpec(skillPath, FORGE_ROOT),
      /strategy:range requires a non-empty range field/,
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('deriveAgentSpec throws when model is not in MODEL_BY_TIER', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-neg-'));
  try {
    const fm = VALID_BASE.replace('model: claude-sonnet-4-6', 'model: gpt-4-turbo');
    const skillPath = writeTmpSkill(dir, fm);
    assert.throws(
      () => deriveAgentSpec(skillPath, '/'),
      /unknown model gpt-4-turbo/,
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

// ----- 2026-07-11: cwd-independence -----
// Surfaced by INIT-2026-07-10-framework-auth-parity: the orchestrated demo
// capture spawns `forge demo capture` with cwd = the PROJECT WORKTREE; every
// phase-invocation module calls deriveAgentSpec('skills/<phase>/SKILL.md') at
// module load, and the old cwd default made that resolution explode
// (ENOENT → capture_ok:false) in any process not started from the forge root.
test('deriveAgentSpec default root is the forge install root, not process.cwd()', () => {
  const prev = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), 'derive-cwd-'));
  try {
    process.chdir(dir);
    const spec = deriveAgentSpec('skills/project-manager/SKILL.md');
    assert.equal(spec.phase, 'project-manager', 'spec resolves from a non-forge cwd');
  } finally {
    process.chdir(prev);
    rmSync(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// executionPathForSurface (R2-01-F5) — pure mapping, no I/O
// ---------------------------------------------------------------------------

test("executionPathForSurface('interactive') → 'interactive'", () => {
  assert.equal(executionPathForSurface('interactive'), 'interactive');
});

test("executionPathForSurface('unattended') → 'unattended'", () => {
  assert.equal(executionPathForSurface('unattended'), 'unattended');
});

test("executionPathForSurface('operator-triggered') → 'unattended' (describes the launch, not mid-run interactivity)", () => {
  assert.equal(executionPathForSurface('operator-triggered'), 'unattended');
});

test("executionPathForSurface('both') → 'unattended' (safe default; unattended-with-optional-pause)", () => {
  assert.equal(executionPathForSurface('both'), 'unattended');
});

test('executionPathForSurface(undefined) → \'unattended\' (absent surface, e.g. architect)', () => {
  assert.equal(executionPathForSurface(undefined), 'unattended');
});

test("executionPathForSurface('some-unknown-value') → 'unattended' (unknown default)", () => {
  assert.equal(executionPathForSurface('some-unknown-value'), 'unattended');
});

// ---------------------------------------------------------------------------
// agentCapabilityDescriptor (R2-02-F1) — pure mapping, no I/O
// ---------------------------------------------------------------------------

/** Minimal AgentDefinition fixture; override only what a given test cares about. */
function baseAgentDefFixture(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    slug: 'fixture-agent',
    name: 'Fixture Agent',
    description: 'A fixture agent for descriptor tests.',
    purpose: 'Testing descriptor computation.',
    composition: { skills: [], tools: [], mcps: [], hooks: [], guards: [] },
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
    brainAccess: 'none',
    interactivity: 'Fully autonomous.',
    budgets: {},
    allowedTools: [],
    disallowedTools: [],
    body: '# Fixture\n',
    path: '/fixture/skills/fixture-agent/SKILL.md',
    ...overrides,
  };
}

// R6-04 WI-3 amendment (test-writer, re-pinned): agentCapabilityDescriptor
// gains `costCeilingEnforceable` (see derive-cost-ceiling-enforceable.test.ts
// for the dedicated coverage of that field). Both fixtures here declare no
// `runtime.loopStrategy`, so the expected value is `false` in both — these
// full-object deepEqual literals are amended so implementing WI-3 does not
// spuriously fail two pre-existing, unrelated assertions the moment the new
// key appears on the wire.
// W8-B3 amendment (sessions-kinds-R06): agentCapabilityDescriptor gains
// `fixedTier` — the ONE tier a strategy:fixed skill can run on, the exact
// mirror of `allowedTiers` (present only for fixed, absent for range). Both
// fixtures here are strategy:fixed on a real catalog model, so the key is
// present in both. Amended, like the R6-04 amendment above, so a new key on
// the wire does not spuriously fail two pre-existing unrelated assertions —
// and the VALUE is asserted here rather than dropped, so these stay
// full-object literal pins rather than becoming partial ones.
test('agentCapabilityDescriptor: surface unattended → interactive:false', () => {
  const def = baseAgentDefFixture({ surface: 'unattended' });
  // W7-B5: absent loopStrategy = legacy invocation path = ceiling enforceable (see derive-cost-ceiling-enforceable.test.ts).
  assert.deepEqual(agentCapabilityDescriptor(def), { interactive: false, runtimeSdks: ['claude'], fanoutCapable: false, materials: [], costCeilingEnforceable: true, fixedTier: 'sonnet' });
});

test('agentCapabilityDescriptor: surface interactive → interactive:true', () => {
  const def = baseAgentDefFixture({ surface: 'interactive' });
  assert.deepEqual(agentCapabilityDescriptor(def), { interactive: true, runtimeSdks: ['claude'], fanoutCapable: false, materials: [], costCeilingEnforceable: true, fixedTier: 'sonnet' });
});

test('W8-B3 (sessions-kinds-R06): fixedTier is present ONLY for strategy:fixed — exactly one of {allowedTiers, fixedTier} ever appears', () => {
  const fixed = agentCapabilityDescriptor(baseAgentDefFixture({ surface: 'unattended' }));
  assert.equal(fixed.fixedTier, 'sonnet');
  assert.ok(!('allowedTiers' in fixed), 'a fixed-strategy descriptor must not advertise a tier envelope');

  // A model outside the catalog resolves to no tier at all rather than a
  // guess — this route is served live and must degrade, not invent.
  const unknownModel = baseAgentDefFixture({ surface: 'unattended' });
  const bogus = agentCapabilityDescriptor({ ...unknownModel, runtime: { ...unknownModel.runtime, model: 'not-a-real-model' } });
  assert.ok(!('fixedTier' in bogus), 'an unrecognised model must leave the key absent, never fabricate a tier');
});

test('agentCapabilityDescriptor: R2-03-F2 — fanoutCapable reflects a declared fanout: block', () => {
  const without = baseAgentDefFixture({ surface: 'unattended' });
  assert.equal(agentCapabilityDescriptor(without).fanoutCapable, false, 'no fanout block ⇒ not fanout-capable');
  const withFanout = baseAgentDefFixture({ surface: 'unattended', fanout: { drivingArtifact: 'work-items', isolation: 'worktree', concurrencyCap: 1 } });
  assert.equal(agentCapabilityDescriptor(withFanout).fanoutCapable, true, 'a declared fanout block ⇒ fanout-capable');
});

test('agentCapabilityDescriptor: surface operator-triggered → interactive:false', () => {
  const def = baseAgentDefFixture({ surface: 'operator-triggered' });
  assert.equal(agentCapabilityDescriptor(def).interactive, false);
});

test('agentCapabilityDescriptor: surface both → interactive:false', () => {
  const def = baseAgentDefFixture({ surface: 'both' });
  assert.equal(agentCapabilityDescriptor(def).interactive, false);
});

test('agentCapabilityDescriptor: absent surface → interactive:false', () => {
  const def = baseAgentDefFixture({ surface: undefined });
  assert.equal(agentCapabilityDescriptor(def).interactive, false);
});

test('agentCapabilityDescriptor: runtimeSdks is a one-element set from runtime.sdk', () => {
  const def = baseAgentDefFixture({ runtime: { sdk: 'codex', strategy: 'fixed', model: 'gpt' } });
  assert.deepEqual(agentCapabilityDescriptor(def).runtimeSdks, ['codex']);
});

test('agentCapabilityDescriptor: empty-string runtime.sdk yields empty runtimeSdks (defensive)', () => {
  const def = baseAgentDefFixture({ runtime: { sdk: '', strategy: 'fixed', model: 'x' } });
  assert.deepEqual(agentCapabilityDescriptor(def).runtimeSdks, []);
});

// ---------------------------------------------------------------------------
// agentCapabilityDescriptor — allowedTiers (ADR-043 §3 amendment, B5 reviewer
// fix): present + cost-sorted cheapest-first for strategy:range, entirely
// absent for strategy:fixed.
// ---------------------------------------------------------------------------

test('agentCapabilityDescriptor: strategy:range populates allowedTiers cheapest-first (reused rangeTiers, not declaration order)', () => {
  // Declared opus-before-sonnet on purpose: if the implementation merely
  // mapped declaration order it would report ['opus','sonnet'] — asserting
  // ['sonnet','opus'] proves it actually reuses the SAME cost-sorted
  // rangeTiers computation deriveAgentSpec uses for PhaseAgentSpec.allowedTiers.
  const def = baseAgentDefFixture({ runtime: { sdk: 'claude', strategy: 'range', range: ['claude-opus-4-8', 'claude-sonnet-4-6'] } });
  assert.deepEqual(agentCapabilityDescriptor(def).allowedTiers, ['sonnet', 'opus']);
});

test('agentCapabilityDescriptor: strategy:fixed leaves allowedTiers entirely absent (not just undefined)', () => {
  const def = baseAgentDefFixture(); // strategy:fixed (default fixture)
  assert.ok(!('allowedTiers' in agentCapabilityDescriptor(def)), 'allowedTiers key must be entirely absent for strategy:fixed');
});

test('agentCapabilityDescriptor: on the REAL creation-agent skill (widened to strategy:range), allowedTiers is [sonnet, opus]', () => {
  // creation-agent declares `library: false` (an operator-dispatched
  // interactive helper, not a Studio-roster/palette chip), so it is NOT in
  // listAgentDefinitions' filtered roster — load it directly, the same way
  // deriveAgentSpec/loadAgentDefinition resolve it in production.
  const def = loadAgentDefinition(join(FORGE_ROOT, 'skills', 'creation-agent', 'SKILL.md'));
  assert.deepEqual(agentCapabilityDescriptor(def).allowedTiers, ['sonnet', 'opus']);
});

// Real-roster guard: every in-tree studio agent computes without throwing, and
// `interactive` always agrees with executionPathForSurface — the descriptor
// must never diverge from the reused mapper it's built on.
test('agentCapabilityDescriptor: computes for every real roster agent, interactive matches executionPathForSurface', () => {
  const defs = listAgentDefinitions(join(FORGE_ROOT, 'skills'));
  assert.ok(defs.length > 0, 'roster must be non-empty');
  for (const def of defs) {
    const descriptor = agentCapabilityDescriptor(def);
    assert.equal(
      descriptor.interactive,
      executionPathForSurface(def.surface) === 'interactive',
      `${def.slug}: interactive must match executionPathForSurface(surface)`,
    );
    assert.ok(Array.isArray(descriptor.runtimeSdks), `${def.slug}: runtimeSdks must be an array`);
  }
});

// ---------------------------------------------------------------------------
// agentCapabilityDescriptor — materials (R2-09 D4)
// ---------------------------------------------------------------------------

test('descriptor materials equals the declared list', () => {
  const def = baseAgentDefFixture({ materials: ['images', 'audio'] });
  assert.deepEqual(agentCapabilityDescriptor(def).materials, ['images', 'audio']);
});

test('descriptor materials is [] when the definition materials is undefined, and [] when it is []', () => {
  const undeclared = baseAgentDefFixture({ materials: undefined });
  assert.deepEqual(agentCapabilityDescriptor(undeclared).materials, []);
  const declaredEmpty = baseAgentDefFixture({ materials: [] });
  assert.deepEqual(agentCapabilityDescriptor(declaredEmpty).materials, []);
});

test('descriptor FILTERS OUT a value not in MATERIAL_KINDS — a def that slipped past lint must never advertise a non-vocabulary capability on the wire', () => {
  const def = baseAgentDefFixture({ materials: ['images', 'holograms'] });
  assert.deepEqual(agentCapabilityDescriptor(def).materials, ['images']);
});

// ---------------------------------------------------------------------------
// agentCapabilityDescriptor — fail-CLOSED on a malformed def.materials
// (2026-08-05 adversarial-review round 2, finding B/3). Same reachability
// argument as materials.test.ts's agentAcceptsMaterial coverage: this
// descriptor is computed from ANY AgentDefinition, not only one that passed
// through loadAgentDefinition. Today `(def.materials ?? []).filter(...)`
// throws `TypeError: (...).filter is not a function` for a non-array
// materials value (a bare string, in particular) — a capability-descriptor
// computation must never crash the whole GET /api/studio/agents response
// over one malformed agent def.
// ---------------------------------------------------------------------------

test('agentCapabilityDescriptor: a non-array (bare string) materials value does not throw — descriptor.materials is []', () => {
  const def = baseAgentDefFixture({ materials: 'images' as unknown as string[] });
  assert.doesNotThrow(() => agentCapabilityDescriptor(def));
  assert.deepEqual(agentCapabilityDescriptor(def).materials, []);
});

test('agentCapabilityDescriptor: materials: null does not throw — descriptor.materials is []', () => {
  const def = baseAgentDefFixture({ materials: null as unknown as string[] });
  assert.doesNotThrow(() => agentCapabilityDescriptor(def));
  assert.deepEqual(agentCapabilityDescriptor(def).materials, []);
});
