/**
 * Tests for orchestrator/studio/registry.ts
 * Uses node:test + node:assert/strict with mkdtempSync fixtures.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';

import {
  isStudioAgent,
  loadAgentDefinition,
  serializeAgentDefinition,
  listAgentDefinitions,
  listPlainSkills,
  loadFlowDefinition,
  serializeFlowDefinition,
  loadKbDescriptor,
  serializeKbDescriptor,
  resolveKbProcesses,
  loadCatalog,
  discoverProjects,
} from './registry.ts';
import type { KbBinding, KbDescriptor } from './types.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AGENT_FIXTURE = `---
name: tester
description: A test agent.
phase: tester
purpose: Test things.
composition:
  skills: [demo]
  tools: []
  mcps: []
  guards: [event-log]
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
brainAccess: none
interactivity: Fully autonomous.
allowed-tools: [Read, Grep]
disallowed-tools: [Bash]
budgets:
  iterationCap: 15
---

Process body here.
`;

const LEGACY_AGENT_FIXTURE = `---
name: legacy-agent
description: A legacy skill without studio fields.
---

Some body.
`;

const FLOW_FIXTURE = `id: forge-cycle
name: Forge Cycle
version: 1
goal: Take an approved initiative to a merged PR with reflection captured.
project: null
kb: cycles
costCeilingUsd: 25
origin: seed
nodes:
  - { id: architect, agent: architect, gate: plan }
  - { id: pm, agent: project-manager }
  - { id: dev, agent: developer-ralph, fanOut: work-items }
  - { id: unifier, agent: developer-unifier, resumable: true }
  - { id: review, gate: verdict }
  - { id: reflect, agent: reflector }
edges:
  - { from: architect, to: pm, artifact: plan }
  - { from: pm, to: dev, artifact: work-items }
  - { from: dev, to: unifier, artifact: wi-branches }
  - { from: unifier, to: review, artifact: pr }
  - { from: review, to: reflect, artifact: verdict }
triggers: []
`;

const KB_FIXTURE = `id: cycles
name: Cycle Patterns
binding: { kind: flow, ref: forge-develop }
desc: Accumulated cross-cycle patterns and retros.
`;

const CATALOG_FIXTURE = `sdks:
  - { id: claude, name: Claude Agent SDK, available: true }
models:
  - { id: claude-sonnet-4-6, name: Claude Sonnet 4.6, sdk: claude, tier: sonnet }
tools:
  - { id: Read, name: Read }
  - { id: Grep, name: Grep }
mcps:
  - { id: gmail, name: Gmail MCP }
guards:
  - { id: event-log, name: Event Log Hook }
`;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'forge-studio-registry-'));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(name: string, content: string): string {
  const p = join(tmpDir, name);
  writeFileSync(p, content, 'utf8');
  return p;
}

function writeAgentFixture(dirName: string, content: string): string {
  const dir = join(tmpDir, dirName);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'SKILL.md');
  writeFileSync(p, content, 'utf8');
  return p;
}

// ---------------------------------------------------------------------------
// isStudioAgent
// ---------------------------------------------------------------------------

describe('isStudioAgent', () => {
  it('returns true for studio frontmatter (has runtime block)', () => {
    const p = writeAgentFixture('studio-agent', AGENT_FIXTURE);
    assert.equal(isStudioAgent(p), true);
  });

  it('returns false for legacy frontmatter (no runtime block)', () => {
    const p = writeAgentFixture('legacy-agent', LEGACY_AGENT_FIXTURE);
    assert.equal(isStudioAgent(p), false);
  });
});

// ---------------------------------------------------------------------------
// loadAgentDefinition
// ---------------------------------------------------------------------------

describe('loadAgentDefinition', () => {
  it('parses slug from parent directory name', () => {
    const p = writeAgentFixture('my-tester', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.equal(def.slug, 'my-tester');
  });

  it('parses name and description', () => {
    const p = writeAgentFixture('name-desc-agent', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.equal(def.name, 'tester');
    assert.equal(def.description, 'A test agent.');
  });

  it('parses phase', () => {
    const p = writeAgentFixture('phase-agent', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.equal(def.phase, 'tester');
  });

  it('parses composition.guards', () => {
    const p = writeAgentFixture('guards-agent', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.deepEqual(def.composition.guards, ['event-log']);
    assert.deepEqual(def.composition.skills, ['demo']);
    assert.deepEqual(def.composition.tools, []);
    assert.deepEqual(def.composition.mcps, []);
  });

  it('parses runtime.model', () => {
    const p = writeAgentFixture('runtime-model-agent', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.equal(def.runtime.model, 'claude-sonnet-4-6');
    assert.equal(def.runtime.sdk, 'claude');
    assert.equal(def.runtime.strategy, 'fixed');
  });

  it('parses allowedTools and disallowedTools', () => {
    const p = writeAgentFixture('tools-agent', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.deepEqual(def.allowedTools, ['Read', 'Grep']);
    assert.deepEqual(def.disallowedTools, ['Bash']);
  });

  it('parses budgets.iterationCap', () => {
    const p = writeAgentFixture('budgets-agent', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.equal(def.budgets.iterationCap, 15);
  });

  it('parses body content', () => {
    const p = writeAgentFixture('body-agent', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.ok(def.body.includes('Process body here.'));
  });

  it('sets path to the absolute SKILL.md path', () => {
    const p = writeAgentFixture('path-agent', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.equal(def.path, p);
  });

  it('parses executor when present', () => {
    const p = writeAgentFixture(
      'executor-agent',
      AGENT_FIXTURE.replace('phase: tester', 'phase: tester\nexecutor: pm'),
    );
    const def = loadAgentDefinition(p);
    assert.equal(def.executor, 'pm');
  });

  it('executor absent → undefined', () => {
    const p = writeAgentFixture('no-executor-agent', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.equal(def.executor, undefined);
  });
});

// ---------------------------------------------------------------------------
// serializeAgentDefinition (round-trip)
// ---------------------------------------------------------------------------

describe('serializeAgentDefinition', () => {
  it('round-trips losslessly: load → serialize → write → load → deepEqual (ignoring path)', () => {
    const p = writeAgentFixture('roundtrip-agent', AGENT_FIXTURE);
    const original = loadAgentDefinition(p);

    const serialized = serializeAgentDefinition(original);

    // Write to a new file in a new dir
    const rtDir = join(tmpDir, 'roundtrip-agent-rt');
    mkdirSync(rtDir, { recursive: true });
    const rtPath = join(rtDir, 'SKILL.md');
    writeFileSync(rtPath, serialized, 'utf8');

    const reloaded = loadAgentDefinition(rtPath);

    // Compare everything except path and slug (slug is derived from dir name, which differs).
    const { path: _origPath, slug: _origSlug, ...origRest } = original;
    const { path: _rtPath, slug: _rtSlug, ...reloadedRest } = reloaded;
    assert.deepEqual(reloadedRest, origRest);
  });
});

// ---------------------------------------------------------------------------
// materials (R2-09 D1/D2) — new optional AgentDefinition field
// ---------------------------------------------------------------------------

describe('loadAgentDefinition — materials', () => {
  it('parses materials: [images, documents] onto def.materials, order preserved', () => {
    const p = writeAgentFixture(
      'materials-agent',
      AGENT_FIXTURE.replace('purpose: Test things.', 'purpose: Test things.\nmaterials: [images, documents]'),
    );
    const def = loadAgentDefinition(p);
    assert.deepEqual(def.materials, ['images', 'documents']);
  });

  it('absent materials ⇒ def.materials is undefined ("not declared", distinct from [])', () => {
    const p = writeAgentFixture('no-materials-agent', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.equal(def.materials, undefined);
  });

  it('an unknown material VALUE loads fine (lenient) and is preserved verbatim — lint rejects it, not load', () => {
    const p = writeAgentFixture(
      'unknown-materials-agent',
      AGENT_FIXTURE.replace('purpose: Test things.', 'purpose: Test things.\nmaterials: [holograms]'),
    );
    const def = loadAgentDefinition(p);
    assert.deepEqual(def.materials, ['holograms']);
  });

  it('non-array materials: (a SHAPE error) throws at load', () => {
    const p = writeAgentFixture(
      'bad-shape-materials-agent',
      AGENT_FIXTURE.replace('purpose: Test things.', 'purpose: Test things.\nmaterials: images'),
    );
    assert.throws(() => loadAgentDefinition(p));
  });
});

describe('serializeAgentDefinition — materials', () => {
  it('emits materials when present', () => {
    const p = writeAgentFixture(
      'serialize-materials-agent',
      AGENT_FIXTURE.replace('purpose: Test things.', 'purpose: Test things.\nmaterials: [images]'),
    );
    const def = loadAgentDefinition(p);
    const out = serializeAgentDefinition(def);
    const { data } = matter(out);
    assert.deepEqual(data.materials, ['images']);
  });

  it('omits the materials key entirely when undefined (not declared)', () => {
    const p = writeAgentFixture('serialize-no-materials-agent', AGENT_FIXTURE);
    const def = loadAgentDefinition(p);
    assert.equal(def.materials, undefined);
    const out = serializeAgentDefinition(def);
    const { data } = matter(out);
    assert.ok(!('materials' in data), 'materials key must be omitted, not emitted as null/[]');
  });

  it('emits an explicit empty list when materials is declared [] (declared-empty is meaningful, must survive)', () => {
    const p = writeAgentFixture(
      'serialize-empty-materials-agent',
      AGENT_FIXTURE.replace('purpose: Test things.', 'purpose: Test things.\nmaterials: []'),
    );
    const def = loadAgentDefinition(p);
    assert.deepEqual(def.materials, []);
    const out = serializeAgentDefinition(def);
    const { data } = matter(out);
    assert.ok('materials' in data, 'declared-empty materials must still be emitted, not dropped like undefined');
    assert.deepEqual(data.materials, []);
  });

  it('serialize → load round-trip preserves materials exactly', () => {
    const p = writeAgentFixture(
      'roundtrip-materials-agent',
      AGENT_FIXTURE.replace('purpose: Test things.', 'purpose: Test things.\nmaterials: [audio, data-files]'),
    );
    const original = loadAgentDefinition(p);
    const serialized = serializeAgentDefinition(original);
    const rtDir = join(tmpDir, 'roundtrip-materials-agent-rt');
    mkdirSync(rtDir, { recursive: true });
    const rtPath = join(rtDir, 'SKILL.md');
    writeFileSync(rtPath, serialized, 'utf8');
    const reloaded = loadAgentDefinition(rtPath);
    assert.deepEqual(reloaded.materials, ['audio', 'data-files']);
  });
});

// ---------------------------------------------------------------------------
// serializeAgentDefinition(def, originalRaw) — golden-file byte-fidelity
// (D5/D6). Real repo SKILL.md files, located relative to THIS test file (not
// a hardcoded absolute path).
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEV_RALPH_PATH = join(REPO_ROOT, 'skills', 'developer-ralph', 'SKILL.md');
const PROJECT_MANAGER_PATH = join(REPO_ROOT, 'skills', 'project-manager', 'SKILL.md');

describe('serializeAgentDefinition(def, originalRaw) — golden files', () => {
  it('developer-ralph: changing ONLY body keeps the frontmatter block byte-identical (7-line comment, fanout:, key order)', () => {
    const raw = readFileSync(DEV_RALPH_PATH, 'utf8');
    const { content } = matter(raw);
    const bodyStart = raw.length - content.length;
    assert.equal(raw.slice(bodyStart), content, 'sanity: content is a verbatim suffix of raw (proven fact this AT relies on)');

    const def = loadAgentDefinition(DEV_RALPH_PATH);
    const newBody = def.body + '\n\nAppended by the golden-file test.\n';
    const updated = { ...def, body: newBody };

    const output = serializeAgentDefinition(updated, raw);
    assert.equal(
      output.slice(0, bodyStart),
      raw.slice(0, bodyStart),
      'frontmatter block (incl. the 7-line comment block at lines 17-24 and the fanout: block) must be byte-identical',
    );
    assert.equal(output.slice(bodyStart), newBody, 'body replaced exactly — appended verbatim, no leading-newline normalization');
  });

  it('developer-ralph: body UNCHANGED ⇒ output is byte-identical to the whole original file (the single strongest AT)', () => {
    const raw = readFileSync(DEV_RALPH_PATH, 'utf8');
    const def = loadAgentDefinition(DEV_RALPH_PATH);
    const output = serializeAgentDefinition(def, raw);
    assert.equal(output, raw, 'a no-op edit must produce a byte-identical file');
  });

  it('project-manager: frontmatter byte-identical on body-only change; mid-body --- stays ASCII (not en-dash); frontmatter data unchanged', () => {
    const raw = readFileSync(PROJECT_MANAGER_PATH, 'utf8');
    const { content, data: originalData } = matter(raw);
    const bodyStart = raw.length - content.length;

    const def = loadAgentDefinition(PROJECT_MANAGER_PATH);
    const updated = { ...def, body: def.body + '\n\nAppended.\n' };
    const output = serializeAgentDefinition(updated, raw);

    assert.equal(output.slice(0, bodyStart), raw.slice(0, bodyStart), 'frontmatter block byte-identical');
    const outputBody = output.slice(bodyStart);
    assert.ok(!outputBody.includes('–––'), 'the "---" lines inside the yaml-fenced example (lines 98/115) must stay ASCII, not be mangled to en-dashes (D6)');
    const { data: outputData } = matter(output);
    assert.deepEqual(outputData, originalData, 'no frontmatter injection through a body that itself contains --- lines');
  });

  it('changed-frontmatter fallback: changing purpose runs the full re-serialize path; body content stays byte-exact', () => {
    const raw = readFileSync(DEV_RALPH_PATH, 'utf8');
    const def = loadAgentDefinition(DEV_RALPH_PATH);
    const updated = { ...def, purpose: 'A DIFFERENT purpose for this golden-file AT.' };

    const output = serializeAgentDefinition(updated, raw);
    const { data, content } = matter(output);
    assert.equal(data.purpose, 'A DIFFERENT purpose for this golden-file AT.', 're-serialize path applies the changed field');
    // Observed behaviour (2026-08, verified against today's implementation
    // minus the en-dash mangling this AT also proves is gone): the full
    // re-serialize path does not add or strip any leading newline for this
    // fixture — content is byte-identical to def.body. If a future
    // implementation legitimately needs to normalize a leading newline,
    // update this assertion with a comment recording the new observed
    // behaviour — the body's CONTENT must never silently diverge otherwise.
    assert.equal(content, def.body, 'body content must be byte-exact through the full re-serialize path');
  });

  it('D6 proof: a body whose FIRST line is "---" round-trips byte-identical with no frontmatter injection (no originalRaw)', () => {
    // 2026-08-05 adversarial-review round 2, finding F/13 — verified this AT
    // already pins the fix: `gray-matter`'s `matter.stringify` RE-PARSES a
    // BARE-STRING body for its own frontmatter, so a naive
    // `matter.stringify(body, data)` call would silently inject the body's
    // OWN "frontmatter-shaped" lines into `data` and truncate `content` down
    // to whatever came after the body's own second `---`. The shipped
    // implementation avoids this by passing `{ content: def.body }` (an
    // object, never re-parsed) — see the comment on `serializeAgentDefinition`.
    // Reproduced directly against gray-matter outside this test file: the
    // bare-string form for this exact `trickyBody` corrupts `content` to
    // `''` (not `trickyBody`) and injects one numeric-string key per
    // character of the body into `data` (`data['0']`, `data['1']`, ...) —
    // the `content` equality assertion below already catches that reversion
    // (it would go from equal to `false`); the numeric-key assertion is an
    // explicit second, independent tripwire on the injection itself.
    const def = loadAgentDefinition(DEV_RALPH_PATH);
    const trickyBody = '---\n\nA body that opens with a literal thematic break.\n\nAnother --- mid-body break.\n';
    const updated = { ...def, body: trickyBody };

    const output = serializeAgentDefinition(updated);
    const { data, content } = matter(output);
    assert.equal(data.name, def.name, 'frontmatter data must be unaffected by a body starting with ---');
    assert.equal(content, trickyBody, 'body must round-trip byte-identical, including its literal leading and mid-body --- lines');
    assert.ok(
      Object.keys(data).every((k) => !/^\d+$/.test(k)),
      `frontmatter data must carry no injected numeric-string keys (the bare-string-form injection signature): got keys ${JSON.stringify(Object.keys(data))}`,
    );
  });

  it('serializeAgentDefinition(def) with no originalRaw still produces a loadable file with all fields intact (backward-compatible signature)', () => {
    const def = loadAgentDefinition(DEV_RALPH_PATH);
    const output = serializeAgentDefinition(def);
    const rtDir = join(tmpDir, 'no-originalraw-rt');
    mkdirSync(rtDir, { recursive: true });
    const rtPath = join(rtDir, 'SKILL.md');
    writeFileSync(rtPath, output, 'utf8');
    const reloaded = loadAgentDefinition(rtPath);
    const { path: _p1, slug: _s1, ...rest1 } = def;
    const { path: _p2, slug: _s2, ...rest2 } = reloaded;
    assert.deepEqual(rest2, rest1);
  });
});

// ---------------------------------------------------------------------------
// serializeAgentDefinition(def, originalRaw) — materials vs D5 byte-fidelity
// interaction (R2-09 defect). The agent builder UI
// (forge-ui/app/agents/[id]/page.tsx) initializes `materials: []` and always
// sends it on save, so every agent with no declared materials (all 16 roster
// agents) round-trips through the PUT with an explicit `materials: []`
// against an on-disk file that has NO `materials:` key at all. D2 (registry
// tests above) establishes that absent and declared-empty are semantically
// IDENTICAL ("accepts nothing" either way) — so this representational
// difference alone must never defeat the D5 byte-faithful fast path and
// destroy the original frontmatter's comments/key order. A fixture with a
// real multi-line YAML comment is used so the assertions are about comment
// survival, not just data equality.
// ---------------------------------------------------------------------------

const COMMENTED_AGENT_FIXTURE = `---
name: commented-agent
description: An agent with a real YAML comment block in its frontmatter.
purpose: Test the byte-fidelity fast path against a real comment block.
composition:
  skills: []
  tools: []
  mcps: []
  guards: []
# This is a load-bearing YAML comment that must survive a byte-faithful save.
# It spans multiple lines so the WHOLE block is exercised, not just one line.
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
brainAccess: none
interactivity: Fully autonomous.
allowed-tools: [Read]
disallowed-tools: [Bash]
budgets: {}
---

Body text here.
`;

const COMMENTED_AGENT_FIXTURE_WITH_MATERIALS = COMMENTED_AGENT_FIXTURE.replace(
  'purpose: Test the byte-fidelity fast path against a real comment block.',
  'purpose: Test the byte-fidelity fast path against a real comment block.\nmaterials: [images]',
);

const COMMENT_NEEDLE = '# This is a load-bearing YAML comment';

describe('serializeAgentDefinition(def, originalRaw) — materials vs byte-fidelity (R2-09 defect)', () => {
  it('DEFECT: materials: [] vs no materials: key on original must NOT defeat the byte-faithful fast path (frontmatter + comment must survive)', () => {
    const p = writeAgentFixture('materials-empty-vs-absent-agent', COMMENTED_AGENT_FIXTURE);
    const raw = readFileSync(p, 'utf8');
    const def = loadAgentDefinition(p);
    assert.equal(def.materials, undefined, 'sanity: the original file declares no materials key at all');

    // Mirrors the real UI save payload: body-only edit, materials sent as [].
    const updated = { ...def, materials: [] as string[], body: def.body + '\n(probe)\n' };
    const output = serializeAgentDefinition(updated, raw);

    const { content } = matter(raw);
    const bodyStart = raw.length - content.length;
    assert.equal(
      output.slice(0, bodyStart),
      raw.slice(0, bodyStart),
      'D2: absent and declared-empty materials are semantically identical — materials: [] on save must not force a re-serialize that destroys the frontmatter block',
    );
    assert.ok(
      output.slice(0, bodyStart).includes(COMMENT_NEEDLE),
      'the YAML comment in the frontmatter must survive the byte-faithful save verbatim',
    );
  });

  it('mirror (non-regression): materials: undefined vs no materials: key on original stays byte-faithful — a fix must not trade this working case away', () => {
    const p = writeAgentFixture('materials-undefined-vs-absent-agent', COMMENTED_AGENT_FIXTURE);
    const raw = readFileSync(p, 'utf8');
    const def = loadAgentDefinition(p);
    assert.equal(def.materials, undefined);

    const updated = { ...def, body: def.body + '\n(probe)\n' };
    const output = serializeAgentDefinition(updated, raw);

    const { content } = matter(raw);
    const bodyStart = raw.length - content.length;
    assert.equal(
      output.slice(0, bodyStart),
      raw.slice(0, bodyStart),
      'materials left undefined (not touched by the save) must remain byte-faithful',
    );
    assert.ok(output.slice(0, bodyStart).includes(COMMENT_NEEDLE), 'comment must survive');
  });

  it('real change: materials: [images] vs no materials: key on original must NOT be byte-faithful — a genuine declaration must persist, not be silently dropped', () => {
    const p = writeAgentFixture('materials-real-change-agent', COMMENTED_AGENT_FIXTURE);
    const raw = readFileSync(p, 'utf8');
    const def = loadAgentDefinition(p);
    assert.equal(def.materials, undefined, 'sanity: original declares no materials key');

    const updated = { ...def, materials: ['images'], body: def.body + '\n(probe)\n' };
    const output = serializeAgentDefinition(updated, raw);

    const { content } = matter(raw);
    const bodyStart = raw.length - content.length;
    assert.notEqual(
      output.slice(0, bodyStart),
      raw.slice(0, bodyStart),
      'a genuine materials declaration must force the full re-serialize — a fix that ignores materials entirely in the comparison would wrongly keep this byte-faithful and silently drop the new declaration',
    );
    const { data } = matter(output);
    assert.deepEqual(data.materials, ['images'], 'the real materials declaration must actually be written to the file');
  });

  it('reverse asymmetry: original declares materials: [images], saved with materials: [] must NOT be byte-faithful — deselecting all materials is a genuine change', () => {
    const p = writeAgentFixture('materials-deselect-agent', COMMENTED_AGENT_FIXTURE_WITH_MATERIALS);
    const raw = readFileSync(p, 'utf8');
    const def = loadAgentDefinition(p);
    assert.deepEqual(def.materials, ['images'], 'sanity: the original file declares materials: [images]');

    const updated = { ...def, materials: [] as string[], body: def.body + '\n(probe)\n' };
    const output = serializeAgentDefinition(updated, raw);

    const { content } = matter(raw);
    const bodyStart = raw.length - content.length;
    assert.notEqual(
      output.slice(0, bodyStart),
      raw.slice(0, bodyStart),
      'the operator clearing a previously-declared materials list is a genuine change and must not be masked as byte-faithful — a fix that treats materials as always-insignificant would wrongly pass this',
    );
    const { data } = matter(output);
    assert.deepEqual(data.materials, [], 'the cleared materials list must actually be persisted as []');
  });
});

// ---------------------------------------------------------------------------
// serializeAgentDefinition(def, originalRaw) — runtime.range / allowed-tools /
// disallowed-tools vs byte-fidelity (R2-09 defect class — same absent-vs-[]
// shape as materials above, pinned in registry.ts + skill-md-fidelity.ts).
//
// Both reported instances were VERIFIED against today's implementation
// (direct probes against serializeAgentDefinition, not assumed from the
// report) before writing these tests:
//
// - runtime.range: LIVE and reachable today, MORE severe than materials.
//   forge-ui/app/agents/[id]/page.tsx defaults `runtime.range` to `[]`
//   (DEFAULT_RUNTIME / parseAgent) and always sends it in buildPutBody;
//   cli/bridge-studio-writes.ts's PUT merge takes the client's array
//   unconditionally whenever it IS an array
//   (`Array.isArray(rtIn['range']) ? rtIn['range'] : existing?.runtime.range`
//   — never falls back to disk for a client-supplied array). Every roster
//   agent declares `strategy: fixed` with no `range:` key at all (verified:
//   `grep -rl '^  range:' skills/*/SKILL.md` → zero hits across all 16
//   studio agents). So a real UI save of ANY roster agent merges
//   `range: []` against an original with no `range:` key.
//   `projectAgentFrontmatter` only omits `range` when `undefined` — `[]` IS
//   emitted — and `normalizeOriginalDataForComparison` normalizes only
//   `composition.*`, never `runtime.*`. Confirmed defeats the fast path
//   today (probed directly): unlike materials, this fires on EVERY save
//   regardless of whether materials is touched.
//
// - allowed-tools / disallowed-tools: latent, NOT reachable today. Verified
//   registry.ts's loader calls `stringArray(d, 'allowed-tools', ...)` /
//   `stringArray(d, 'disallowed-tools', ...)` unconditionally — unlike
//   `range`, there is no `!== undefined` guard — and `stringArray` (in
//   yaml-fields.ts) defaults an absent/null key to `[]`. So
//   `def.allowedTools`/`def.disallowedTools` are NEVER `undefined`, always
//   concrete arrays, even when the file omits the key entirely, and
//   `projectAgentFrontmatter` emits both keys unconditionally (no
//   presence guard at all). Verified all 16 roster agents declare BOTH keys
//   explicitly (scripted grep over skills/*/SKILL.md, zero misses), and the
//   bridge PUT route never reads a client-supplied allowedTools/
//   disallowedTools — it always uses `existing?.allowedTools ?? []` /
//   `existing?.disallowedTools ?? []`, so today's only source is disk, and
//   disk always already carries the key for every roster agent — hence
//   UNREACHABLE today. But probed directly: a hand-authored SKILL.md that
//   omits either key defeats the fast path the moment it is loaded and
//   saved through the builder with ONLY a body change — no merge
//   simulation needed at all, the loader's own unconditional default is
//   enough to reproduce it.
// ---------------------------------------------------------------------------

const COMMENTED_AGENT_FIXTURE_NO_TOOLS = COMMENTED_AGENT_FIXTURE.replace(
  'allowed-tools: [Read]\ndisallowed-tools: [Bash]\n',
  '',
);

const COMMENTED_AGENT_FIXTURE_WITH_RANGE = COMMENTED_AGENT_FIXTURE.replace(
  '  strategy: fixed\n  model: claude-sonnet-4-6\n',
  '  strategy: range\n  model: claude-sonnet-4-6\n  range: [alpha, beta]\n',
);

describe('serializeAgentDefinition(def, originalRaw) — runtime.range vs byte-fidelity (R2-09 defect)', () => {
  it('DEFECT: range: [] vs no range: key on original must NOT defeat the byte-faithful fast path (frontmatter + comment must survive)', () => {
    const p = writeAgentFixture('range-empty-vs-absent-agent', COMMENTED_AGENT_FIXTURE);
    const raw = readFileSync(p, 'utf8');
    const def = loadAgentDefinition(p);
    assert.equal(def.runtime.range, undefined, 'sanity: the original file declares no range key at all');

    // Mirrors the real UI save payload: body-only edit, range sent as [] (DEFAULT_RUNTIME/buildPutBody).
    const updated = { ...def, runtime: { ...def.runtime, range: [] as string[] }, body: def.body + '\n(probe)\n' };
    const output = serializeAgentDefinition(updated, raw);

    const { content } = matter(raw);
    const bodyStart = raw.length - content.length;
    assert.equal(
      output.slice(0, bodyStart),
      raw.slice(0, bodyStart),
      'absent and declared-empty range are semantically identical for a fixed-strategy agent — range: [] on save must not force a re-serialize that destroys the frontmatter block',
    );
    assert.ok(
      output.slice(0, bodyStart).includes(COMMENT_NEEDLE),
      'the YAML comment in the frontmatter must survive the byte-faithful save verbatim',
    );
  });

  it('real change: range: [alpha, beta] vs no range: key on original must NOT be byte-faithful — a genuine declaration must persist, not be silently dropped', () => {
    const p = writeAgentFixture('range-real-change-agent', COMMENTED_AGENT_FIXTURE);
    const raw = readFileSync(p, 'utf8');
    const def = loadAgentDefinition(p);
    assert.equal(def.runtime.range, undefined, 'sanity: original declares no range key');

    const updated = { ...def, runtime: { ...def.runtime, range: ['alpha', 'beta'] }, body: def.body + '\n(probe)\n' };
    const output = serializeAgentDefinition(updated, raw);

    const { content } = matter(raw);
    const bodyStart = raw.length - content.length;
    assert.notEqual(
      output.slice(0, bodyStart),
      raw.slice(0, bodyStart),
      'a genuine range declaration must force the full re-serialize — a fix that ignores range entirely in the comparison would wrongly keep this byte-faithful and silently drop the new declaration',
    );
    const { data } = matter(output);
    assert.deepEqual((data.runtime as Record<string, unknown>).range, ['alpha', 'beta'], 'the real range declaration must actually be written to the file');
  });

  it('reverse asymmetry: original declares range: [alpha, beta], saved with range: [] must NOT be byte-faithful — clearing the range is a genuine change', () => {
    const p = writeAgentFixture('range-deselect-agent', COMMENTED_AGENT_FIXTURE_WITH_RANGE);
    const raw = readFileSync(p, 'utf8');
    const def = loadAgentDefinition(p);
    assert.deepEqual(def.runtime.range, ['alpha', 'beta'], 'sanity: the original file declares range: [alpha, beta]');

    const updated = { ...def, runtime: { ...def.runtime, range: [] as string[] }, body: def.body + '\n(probe)\n' };
    const output = serializeAgentDefinition(updated, raw);

    const { content } = matter(raw);
    const bodyStart = raw.length - content.length;
    assert.notEqual(
      output.slice(0, bodyStart),
      raw.slice(0, bodyStart),
      'clearing a previously-declared range is a genuine change and must not be masked as byte-faithful — a fix that treats range as always-insignificant would wrongly pass this',
    );
    const { data } = matter(output);
    assert.deepEqual((data.runtime as Record<string, unknown>).range, [], 'the cleared range must actually be persisted as []');
  });
});

describe('serializeAgentDefinition(def, originalRaw) — allowed-tools vs byte-fidelity (R2-09 defect class, latent)', () => {
  it('DEFECT: allowed-tools: [] vs no allowed-tools: key on original must NOT defeat the byte-faithful fast path (frontmatter + comment must survive)', () => {
    const p = writeAgentFixture('allowed-tools-empty-vs-absent-agent', COMMENTED_AGENT_FIXTURE_NO_TOOLS);
    const raw = readFileSync(p, 'utf8');
    const def = loadAgentDefinition(p);
    assert.deepEqual(def.allowedTools, [], 'sanity: the loader defaults an absent allowed-tools key to [] (never undefined)');

    const updated = { ...def, allowedTools: [] as string[], body: def.body + '\n(probe)\n' };
    const output = serializeAgentDefinition(updated, raw);

    const { content } = matter(raw);
    const bodyStart = raw.length - content.length;
    assert.equal(
      output.slice(0, bodyStart),
      raw.slice(0, bodyStart),
      'absent and declared-empty allowed-tools are semantically identical ("no tools allow-listed") — [] on save must not force a re-serialize that destroys the frontmatter block',
    );
    assert.ok(
      output.slice(0, bodyStart).includes(COMMENT_NEEDLE),
      'the YAML comment in the frontmatter must survive the byte-faithful save verbatim',
    );
  });

  it('real change: allowed-tools: [Read, Grep] vs no allowed-tools: key on original must NOT be byte-faithful — a genuine declaration must persist, not be silently dropped', () => {
    const p = writeAgentFixture('allowed-tools-real-change-agent', COMMENTED_AGENT_FIXTURE_NO_TOOLS);
    const raw = readFileSync(p, 'utf8');
    const def = loadAgentDefinition(p);
    assert.deepEqual(def.allowedTools, [], 'sanity: original declares no allowed-tools key');

    const updated = { ...def, allowedTools: ['Read', 'Grep'], body: def.body + '\n(probe)\n' };
    const output = serializeAgentDefinition(updated, raw);

    const { content } = matter(raw);
    const bodyStart = raw.length - content.length;
    assert.notEqual(
      output.slice(0, bodyStart),
      raw.slice(0, bodyStart),
      'a genuine allowed-tools declaration must force the full re-serialize — a fix that ignores allowed-tools entirely in the comparison would wrongly keep this byte-faithful and silently drop the new declaration',
    );
    const { data } = matter(output);
    assert.deepEqual(data['allowed-tools'], ['Read', 'Grep'], 'the real allowed-tools declaration must actually be written to the file');
  });

  it('reverse asymmetry: original declares allowed-tools: [Read], saved with allowed-tools: [] must NOT be byte-faithful — clearing the allow-list is a genuine change', () => {
    const p = writeAgentFixture('allowed-tools-deselect-agent', COMMENTED_AGENT_FIXTURE);
    const raw = readFileSync(p, 'utf8');
    const def = loadAgentDefinition(p);
    assert.deepEqual(def.allowedTools, ['Read'], 'sanity: the original file declares allowed-tools: [Read]');

    const updated = { ...def, allowedTools: [] as string[], body: def.body + '\n(probe)\n' };
    const output = serializeAgentDefinition(updated, raw);

    const { content } = matter(raw);
    const bodyStart = raw.length - content.length;
    assert.notEqual(
      output.slice(0, bodyStart),
      raw.slice(0, bodyStart),
      'clearing a previously-declared allow-list is a genuine change and must not be masked as byte-faithful — a fix that treats allowed-tools as always-insignificant would wrongly pass this',
    );
    const { data } = matter(output);
    assert.deepEqual(data['allowed-tools'], [], 'the cleared allowed-tools list must actually be persisted as []');
  });
});

describe('serializeAgentDefinition(def, originalRaw) — disallowed-tools vs byte-fidelity (R2-09 defect class, latent)', () => {
  it('DEFECT: disallowed-tools: [] vs no disallowed-tools: key on original must NOT defeat the byte-faithful fast path (frontmatter + comment must survive)', () => {
    const p = writeAgentFixture('disallowed-tools-empty-vs-absent-agent', COMMENTED_AGENT_FIXTURE_NO_TOOLS);
    const raw = readFileSync(p, 'utf8');
    const def = loadAgentDefinition(p);
    assert.deepEqual(def.disallowedTools, [], 'sanity: the loader defaults an absent disallowed-tools key to [] (never undefined)');

    const updated = { ...def, disallowedTools: [] as string[], body: def.body + '\n(probe)\n' };
    const output = serializeAgentDefinition(updated, raw);

    const { content } = matter(raw);
    const bodyStart = raw.length - content.length;
    assert.equal(
      output.slice(0, bodyStart),
      raw.slice(0, bodyStart),
      'absent and declared-empty disallowed-tools are semantically identical ("nothing block-listed") — [] on save must not force a re-serialize that destroys the frontmatter block',
    );
    assert.ok(
      output.slice(0, bodyStart).includes(COMMENT_NEEDLE),
      'the YAML comment in the frontmatter must survive the byte-faithful save verbatim',
    );
  });

  it('real change: disallowed-tools: [Bash, Write] vs no disallowed-tools: key on original must NOT be byte-faithful — a genuine declaration must persist, not be silently dropped', () => {
    const p = writeAgentFixture('disallowed-tools-real-change-agent', COMMENTED_AGENT_FIXTURE_NO_TOOLS);
    const raw = readFileSync(p, 'utf8');
    const def = loadAgentDefinition(p);
    assert.deepEqual(def.disallowedTools, [], 'sanity: original declares no disallowed-tools key');

    const updated = { ...def, disallowedTools: ['Bash', 'Write'], body: def.body + '\n(probe)\n' };
    const output = serializeAgentDefinition(updated, raw);

    const { content } = matter(raw);
    const bodyStart = raw.length - content.length;
    assert.notEqual(
      output.slice(0, bodyStart),
      raw.slice(0, bodyStart),
      'a genuine disallowed-tools declaration must force the full re-serialize — a fix that ignores disallowed-tools entirely in the comparison would wrongly keep this byte-faithful and silently drop the new declaration',
    );
    const { data } = matter(output);
    assert.deepEqual(data['disallowed-tools'], ['Bash', 'Write'], 'the real disallowed-tools declaration must actually be written to the file');
  });

  it('reverse asymmetry: original declares disallowed-tools: [Bash], saved with disallowed-tools: [] must NOT be byte-faithful — clearing the block-list is a genuine change', () => {
    const p = writeAgentFixture('disallowed-tools-deselect-agent', COMMENTED_AGENT_FIXTURE);
    const raw = readFileSync(p, 'utf8');
    const def = loadAgentDefinition(p);
    assert.deepEqual(def.disallowedTools, ['Bash'], 'sanity: the original file declares disallowed-tools: [Bash]');

    const updated = { ...def, disallowedTools: [] as string[], body: def.body + '\n(probe)\n' };
    const output = serializeAgentDefinition(updated, raw);

    const { content } = matter(raw);
    const bodyStart = raw.length - content.length;
    assert.notEqual(
      output.slice(0, bodyStart),
      raw.slice(0, bodyStart),
      'clearing a previously-declared block-list is a genuine change and must not be masked as byte-faithful — a fix that treats disallowed-tools as always-insignificant would wrongly pass this',
    );
    const { data } = matter(output);
    assert.deepEqual(data['disallowed-tools'], [], 'the cleared disallowed-tools list must actually be persisted as []');
  });
});

// ---------------------------------------------------------------------------
// General-rule pin (not tied to any single field): a definition where NOTHING
// semantically changed but the body must ALWAYS take the byte-faithful fast
// path, even when EVERY optional array key (composition.*, materials,
// runtime.range, allowed-tools, disallowed-tools) is absent from the
// original and the merge produces the corresponding empty-array default for
// each. This is deliberately NOT a per-field test: a wrong implementation
// that fixes only some of today's known instances (e.g. materials +
// composition, but not range or allowed/disallowed-tools) still fails this,
// because ALL of them must be normalized at once for a genuinely untouched
// agent to round-trip byte-faithfully. A future optional array field added
// to AgentDefinition inherits this same obligation.
// ---------------------------------------------------------------------------

const MINIMAL_ORIGINAL_FIXTURE = `---
name: minimal-agent
description: Minimal agent omitting every optional array key at once.
purpose: Pin the general absent-vs-empty-array rule, not any one field.
composition: {}
# a load-bearing comment on the minimal, all-keys-omitted fixture
runtime:
  sdk: claude
  strategy: fixed
brainAccess: none
interactivity: Fully autonomous.
budgets: {}
---

Minimal body.
`;

describe('serializeAgentDefinition(def, originalRaw) — general rule: untouched agent stays byte-faithful regardless of which optional array keys are absent', () => {
  it('a definition with NOTHING changed but the body round-trips byte-faithful even when composition.*, materials, range, allowed-tools, disallowed-tools are all absent from the original', () => {
    const p = writeAgentFixture('minimal-all-keys-omitted-agent', MINIMAL_ORIGINAL_FIXTURE);
    const raw = readFileSync(p, 'utf8');
    const def = loadAgentDefinition(p);
    assert.equal(def.materials, undefined, 'sanity: materials absent');
    assert.equal(def.runtime.range, undefined, 'sanity: range absent');
    assert.deepEqual(def.allowedTools, [], 'sanity: allowed-tools defaults to [] on load');
    assert.deepEqual(def.disallowedTools, [], 'sanity: disallowed-tools defaults to [] on load');
    assert.deepEqual(def.composition, { skills: [], tools: [], mcps: [], guards: [], hooks: [] }, 'sanity: composition defaults to all-[] on load');

    // Simulate exactly what a real, genuinely no-op UI save merges for every
    // optional array field (each defaults to a concrete [] on the wire, per
    // the report's own JOB context): materials and range go from undefined
    // to [], mirroring buildPutBody/DEFAULT_RUNTIME; composition/tools stay
    // the [] the loader already produced.
    const updated = {
      ...def,
      materials: [] as string[],
      runtime: { ...def.runtime, range: [] as string[] },
      body: def.body + '\n(probe)\n',
    };
    const output = serializeAgentDefinition(updated, raw);

    const { content } = matter(raw);
    const bodyStart = raw.length - content.length;
    assert.equal(
      output.slice(0, bodyStart),
      raw.slice(0, bodyStart),
      'an untouched agent (body-only edit) must ALWAYS take the byte-faithful fast path, regardless of which optional array keys the original happens to omit',
    );
    assert.ok(
      output.slice(0, bodyStart).includes('# a load-bearing comment on the minimal, all-keys-omitted fixture'),
      'the YAML comment must survive the byte-faithful save verbatim',
    );
  });
});

// ---------------------------------------------------------------------------
// loadFlowDefinition
// ---------------------------------------------------------------------------

describe('loadFlowDefinition', () => {
  it('parses id, name, version, goal, origin, costCeilingUsd', () => {
    const p = writeFixture('forge-cycle.yaml', FLOW_FIXTURE);
    const flow = loadFlowDefinition(p);
    assert.equal(flow.id, 'forge-cycle');
    assert.equal(flow.name, 'Forge Cycle');
    assert.equal(flow.version, 1);
    assert.equal(flow.goal, 'Take an approved initiative to a merged PR with reflection captured.');
    assert.equal(flow.origin, 'seed');
    assert.equal(flow.costCeilingUsd, 25);
  });

  it('parses nodes: agent nodes and gate-only node', () => {
    const p = writeFixture('flow-nodes.yaml', FLOW_FIXTURE);
    const flow = loadFlowDefinition(p);
    assert.equal(flow.nodes.length, 6);

    // Agent node
    const pm = flow.nodes.find((n) => n.id === 'pm');
    assert.ok(pm);
    assert.equal(pm.agent, 'project-manager');
    assert.equal(pm.gate, undefined);

    // fanOut node
    const dev = flow.nodes.find((n) => n.id === 'dev');
    assert.ok(dev);
    assert.equal(dev.fanOut, 'work-items');

    // resumable node
    const unifier = flow.nodes.find((n) => n.id === 'unifier');
    assert.ok(unifier);
    assert.equal(unifier.resumable, true);

    // gate-only node (no agent)
    const review = flow.nodes.find((n) => n.id === 'review');
    assert.ok(review);
    assert.equal(review.agent, undefined);
    assert.equal(review.gate, 'verdict');
  });

  it('parses edges with from/to/artifact', () => {
    const p = writeFixture('flow-edges.yaml', FLOW_FIXTURE);
    const flow = loadFlowDefinition(p);
    assert.equal(flow.edges.length, 5);
    assert.deepEqual(flow.edges[0], { from: 'architect', to: 'pm', artifact: 'plan' });
  });

  it('project: null → null', () => {
    const p = writeFixture('flow-null-project.yaml', FLOW_FIXTURE);
    const flow = loadFlowDefinition(p);
    assert.equal(flow.project, null);
  });

  it('kb present → string', () => {
    const p = writeFixture('flow-kb.yaml', FLOW_FIXTURE);
    const flow = loadFlowDefinition(p);
    assert.equal(flow.kb, 'cycles');
  });

  it('triggers absent or [] → []', () => {
    const p = writeFixture('flow-triggers.yaml', FLOW_FIXTURE);
    const flow = loadFlowDefinition(p);
    assert.deepEqual(flow.triggers, []);
  });

  it('triggers absent (no key) → []', () => {
    const noTriggers = FLOW_FIXTURE.replace('triggers: []\n', '');
    const p = writeFixture('flow-no-triggers.yaml', noTriggers);
    const flow = loadFlowDefinition(p);
    assert.deepEqual(flow.triggers, []);
  });

  it('kickoff present → parsed', () => {
    const p = writeFixture('flow-kickoff.yaml', FLOW_FIXTURE + 'kickoff: { kind: initiative-select }\n');
    const flow = loadFlowDefinition(p);
    assert.deepEqual(flow.kickoff, { kind: 'initiative-select' });
  });

  it('kickoff absent → undefined', () => {
    const p = writeFixture('flow-kickoff-absent.yaml', FLOW_FIXTURE);
    const flow = loadFlowDefinition(p);
    assert.strictEqual(flow.kickoff, undefined);
  });

  it('kickoff round-trips through serialize', () => {
    const p = writeFixture('flow-kickoff-rt-src.yaml', FLOW_FIXTURE + 'kickoff: { kind: trigger-only }\n');
    const original = loadFlowDefinition(p);
    const reloaded = loadFlowDefinition(
      writeFixture('flow-kickoff-rt-dst.yaml', serializeFlowDefinition(original)),
    );
    assert.deepEqual(reloaded.kickoff, { kind: 'trigger-only' });
  });

  it('project absent → null', () => {
    const noProject = FLOW_FIXTURE.replace('project: null\n', '');
    const p = writeFixture('flow-no-project.yaml', noProject);
    const flow = loadFlowDefinition(p);
    assert.equal(flow.project, null);
  });

  it('kb absent → null', () => {
    const noKb = FLOW_FIXTURE.replace('kb: cycles\n', '');
    const p = writeFixture('flow-no-kb.yaml', noKb);
    const flow = loadFlowDefinition(p);
    assert.equal(flow.kb, null);
  });

  it('sets path', () => {
    const p = writeFixture('flow-path.yaml', FLOW_FIXTURE);
    const flow = loadFlowDefinition(p);
    assert.equal(flow.path, p);
  });
});

// ---------------------------------------------------------------------------
// serializeFlowDefinition (round-trip)
// ---------------------------------------------------------------------------

describe('serializeFlowDefinition', () => {
  it('round-trips: load → serialize → load → deepEqual sans path', () => {
    const p = writeFixture('flow-rt-src.yaml', FLOW_FIXTURE);
    const original = loadFlowDefinition(p);

    const serialized = serializeFlowDefinition(original);

    const rtPath = writeFixture('flow-rt-dst.yaml', serialized);
    const reloaded = loadFlowDefinition(rtPath);

    const { path: _op, ...origRest } = original;
    const { path: _rp, ...reloadedRest } = reloaded;
    assert.deepEqual(reloadedRest, origRest);
  });

  it('persists node x/y positions across serialize → load (J3 / ADR-033)', () => {
    const src = loadFlowDefinition(writeFixture('flow-xy-src.yaml', FLOW_FIXTURE));
    const positioned = {
      ...src,
      nodes: src.nodes.map((n, i) => ({ ...n, x: 100 + i * 50, y: 200 + i * 30 })),
    };
    const reloaded = loadFlowDefinition(writeFixture('flow-xy-dst.yaml', serializeFlowDefinition(positioned)));
    for (let i = 0; i < positioned.nodes.length; i++) {
      assert.equal(reloaded.nodes[i].x, 100 + i * 50, `node[${i}].x must round-trip`);
      assert.equal(reloaded.nodes[i].y, 200 + i * 30, `node[${i}].y must round-trip`);
    }
  });
});

// ---------------------------------------------------------------------------
// loadKbDescriptor
// ---------------------------------------------------------------------------

describe('loadKbDescriptor', () => {
  it('parses id, name, binding, desc', () => {
    const p = writeFixture('kb.yaml', KB_FIXTURE);
    const kb = loadKbDescriptor(p);
    assert.equal(kb.id, 'cycles');
    assert.equal(kb.name, 'Cycle Patterns');
    assert.deepEqual(kb.binding, { kind: 'flow', ref: 'forge-develop' });
    assert.equal(kb.desc, 'Accumulated cross-cycle patterns and retros.');
    assert.equal(kb.path, p);
  });

  it('binding.kind unique parses with no ref required', () => {
    const p = writeFixture(
      'kb-unique.yaml',
      `id: forge-dev
name: Forge Dev
binding: { kind: unique }
desc: Forge engineering knowledge.
`,
    );
    const kb = loadKbDescriptor(p);
    assert.deepEqual(kb.binding, { kind: 'unique' });
  });

  it('throws when binding is missing', () => {
    const bad = KB_FIXTURE.replace('binding: { kind: flow, ref: forge-develop }\n', '');
    const p = writeFixture('kb-no-binding.yaml', bad);
    assert.throws(
      () => loadKbDescriptor(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('binding'), `Expected "binding" in error: ${err.message}`);
        return true;
      },
    );
  });

  it('throws on invalid binding.kind', () => {
    const bad = KB_FIXTURE.replace('kind: flow', 'kind: bogus');
    const p = writeFixture('kb-bad-kind.yaml', bad);
    assert.throws(
      () => loadKbDescriptor(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('binding.kind') && err.message.includes('flow|project|unique'),
          `Expected enum message: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('throws when flow binding is missing ref', () => {
    const bad = KB_FIXTURE.replace('binding: { kind: flow, ref: forge-develop }', 'binding: { kind: flow }');
    const p = writeFixture('kb-no-ref.yaml', bad);
    assert.throws(
      () => loadKbDescriptor(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('ref'), `Expected "ref" in error: ${err.message}`);
        return true;
      },
    );
  });

  it('throws when project binding has empty-string ref', () => {
    const bad = KB_FIXTURE.replace(
      'binding: { kind: flow, ref: forge-develop }',
      'binding: { kind: project, ref: "" }',
    );
    const p = writeFixture('kb-empty-ref.yaml', bad);
    assert.throws(() => loadKbDescriptor(p));
  });
});

// ---------------------------------------------------------------------------
// loadKbDescriptor — processes
// ---------------------------------------------------------------------------

describe('loadKbDescriptor — processes', () => {
  it('lean descriptor (no processes) → processes is undefined', () => {
    const p = writeFixture('kb-lean.yaml', KB_FIXTURE);
    const kb = loadKbDescriptor(p);
    assert.equal(kb.processes, undefined);
  });

  it('full processes block parses all four obligations', () => {
    const full = `id: cycles
name: Cycle Patterns
binding: { kind: flow, ref: forge-develop }
desc: Accumulated cross-cycle patterns and retros.
processes:
  lint: { builtin: forge-brain-lint }
  ingest: { cmd: "./scripts/custom-ingest.sh" }
  consolidate: { builtin: brain-fix }
  usage: { readSurface: search, readers: [planner, reflector] }
`;
    const p = writeFixture('kb-full-processes.yaml', full);
    const kb = loadKbDescriptor(p);
    assert.deepEqual(kb.processes, {
      lint: { builtin: 'forge-brain-lint' },
      ingest: { cmd: './scripts/custom-ingest.sh' },
      consolidate: { builtin: 'brain-fix' },
      usage: { readSurface: 'search', readers: ['planner', 'reflector'] },
    });
  });

  it('throws on unknown process key', () => {
    const bad = `id: cycles
name: Cycle Patterns
binding: { kind: flow, ref: forge-develop }
desc: Accumulated cross-cycle patterns and retros.
processes:
  lint: { builtin: forge-brain-lint }
  ingest: { builtin: reflector-ingest }
  consolidate: { builtin: brain-fix }
  usage: { readSurface: navigation-index, readers: [planner] }
  extra: { builtin: bogus }
`;
    const p = writeFixture('kb-unknown-process-key.yaml', bad);
    assert.throws(
      () => loadKbDescriptor(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('extra'), `Expected "extra" in error: ${err.message}`);
        return true;
      },
    );
  });

  it('throws when a process obligation is neither {builtin} nor {cmd}', () => {
    const bad = `id: cycles
name: Cycle Patterns
binding: { kind: flow, ref: forge-develop }
desc: Accumulated cross-cycle patterns and retros.
processes:
  lint: { builtin: forge-brain-lint, cmd: also-here }
  ingest: { builtin: reflector-ingest }
  consolidate: { builtin: brain-fix }
  usage: { readSurface: navigation-index, readers: [planner] }
`;
    const p = writeFixture('kb-bad-process-shape.yaml', bad);
    assert.throws(() => loadKbDescriptor(p));
  });

  it('throws when processes.usage.readSurface is invalid', () => {
    const bad = `id: cycles
name: Cycle Patterns
binding: { kind: flow, ref: forge-develop }
desc: Accumulated cross-cycle patterns and retros.
processes:
  lint: { builtin: forge-brain-lint }
  ingest: { builtin: reflector-ingest }
  consolidate: { builtin: brain-fix }
  usage: { readSurface: bogus-surface, readers: [planner] }
`;
    const p = writeFixture('kb-bad-read-surface.yaml', bad);
    assert.throws(() => loadKbDescriptor(p));
  });

  it('throws when processes.usage.readers contains an invalid role', () => {
    const bad = `id: cycles
name: Cycle Patterns
binding: { kind: flow, ref: forge-develop }
desc: Accumulated cross-cycle patterns and retros.
processes:
  lint: { builtin: forge-brain-lint }
  ingest: { builtin: reflector-ingest }
  consolidate: { builtin: brain-fix }
  usage: { readSurface: navigation-index, readers: [planner, bogus-role] }
`;
    const p = writeFixture('kb-bad-reader-role.yaml', bad);
    assert.throws(() => loadKbDescriptor(p));
  });
});

// ---------------------------------------------------------------------------
// resolveKbProcesses
// ---------------------------------------------------------------------------

describe('resolveKbProcesses', () => {
  it('lean flow-bound descriptor → fills all four defaults', () => {
    const kb = loadKbDescriptor(writeFixture('kb-resolve-lean.yaml', KB_FIXTURE));
    const resolved = resolveKbProcesses(kb);
    assert.deepEqual(resolved, {
      lint: { builtin: 'forge-brain-lint' },
      ingest: { builtin: 'reflector-ingest' },
      consolidate: { builtin: 'brain-fix' },
      usage: { readSurface: 'navigation-index', readers: ['planner', 'reflector'] },
    });
  });

  it('lean project-bound descriptor → usage defaults include dev-loop + reviewer', () => {
    const kb = loadKbDescriptor(
      writeFixture(
        'kb-resolve-project.yaml',
        `id: gitpulse
name: Gitpulse Patterns
binding: { kind: project, ref: gitpulse }
desc: Project-scoped patterns.
`,
      ),
    );
    const resolved = resolveKbProcesses(kb);
    assert.deepEqual(resolved.usage, {
      readSurface: 'navigation-index',
      readers: ['planner', 'reflector', 'dev-loop', 'reviewer'],
    });
  });

  it('lean unique-bound descriptor → usage defaults are planner+reflector only', () => {
    const kb = loadKbDescriptor(
      writeFixture(
        'kb-resolve-unique.yaml',
        `id: forge-dev
name: Forge Dev
binding: { kind: unique }
desc: Forge engineering knowledge.
`,
      ),
    );
    const resolved = resolveKbProcesses(kb);
    assert.deepEqual(resolved.usage, { readSurface: 'navigation-index', readers: ['planner', 'reflector'] });
  });

  it('descriptor with explicit processes resolves to its own declared values, not defaults', () => {
    const full = `id: cycles
name: Cycle Patterns
binding: { kind: flow, ref: forge-develop }
desc: Accumulated cross-cycle patterns and retros.
processes:
  lint: { cmd: ./custom-lint.sh }
  ingest: { builtin: reflector-ingest }
  consolidate: { builtin: brain-fix }
  usage: { readSurface: search, readers: [reflector] }
`;
    const kb = loadKbDescriptor(writeFixture('kb-resolve-full.yaml', full));
    const resolved = resolveKbProcesses(kb);
    assert.deepEqual(resolved.lint, { cmd: './custom-lint.sh' });
    assert.deepEqual(resolved.usage, { readSurface: 'search', readers: ['reflector'] });
  });
});

// ---------------------------------------------------------------------------
// serializeKbDescriptor round-trip
// ---------------------------------------------------------------------------

describe('serializeKbDescriptor round-trip', () => {
  const cases: Array<{ label: string; binding: KbBinding }> = [
    { label: 'unique', binding: { kind: 'unique' } },
    { label: 'flow', binding: { kind: 'flow', ref: 'forge-develop' } },
    { label: 'project', binding: { kind: 'project', ref: 'gitpulse' } },
  ];

  for (const { label, binding } of cases) {
    it(`lean (${label} binding, no processes) round-trips`, () => {
      const kb: KbDescriptor = {
        id: `test-${label}`,
        name: `Test ${label}`,
        binding,
        desc: 'A test KB.',
        path: '/unused',
      };
      const yamlStr = serializeKbDescriptor(kb);
      const p = writeFixture(`kb-rt-lean-${label}.yaml`, yamlStr);
      const reloaded = loadKbDescriptor(p);
      assert.equal(reloaded.id, kb.id);
      assert.equal(reloaded.name, kb.name);
      assert.deepEqual(reloaded.binding, kb.binding);
      assert.equal(reloaded.desc, kb.desc);
      assert.equal(reloaded.processes, undefined);
    });

    it(`with explicit processes (${label} binding) round-trips all four obligations`, () => {
      const kb: KbDescriptor = {
        id: `test-full-${label}`,
        name: `Test Full ${label}`,
        binding,
        desc: 'A test KB with explicit processes.',
        processes: {
          lint: { builtin: 'forge-brain-lint' },
          ingest: { cmd: './custom-ingest.sh' },
          consolidate: { builtin: 'brain-fix' },
          usage: { readSurface: 'search', readers: ['planner', 'dev-loop'] },
        },
        path: '/unused',
      };
      const yamlStr = serializeKbDescriptor(kb);
      const p = writeFixture(`kb-rt-full-${label}.yaml`, yamlStr);
      const reloaded = loadKbDescriptor(p);
      assert.deepEqual(reloaded.binding, kb.binding);
      assert.deepEqual(reloaded.processes, kb.processes);
    });
  }

  it('omits backend when undefined, includes it when present', () => {
    const kb: KbDescriptor = {
      id: 'test-backend',
      name: 'Test Backend',
      binding: { kind: 'unique' },
      desc: 'A test KB.',
      backend: 'filesystem',
      path: '/unused',
    };
    const yamlStr = serializeKbDescriptor(kb);
    assert.ok(yamlStr.includes('backend'));
    const reloaded = loadKbDescriptor(writeFixture('kb-rt-backend.yaml', yamlStr));
    assert.equal(reloaded.backend, 'filesystem');
  });
});

// ---------------------------------------------------------------------------
// loadCatalog
// ---------------------------------------------------------------------------

describe('loadCatalog', () => {
  it('parses all five sections', () => {
    const p = writeFixture('catalog.yaml', CATALOG_FIXTURE);
    const catalog = loadCatalog(p);
    assert.equal(catalog.sdks.length, 1);
    assert.equal(catalog.sdks[0].id, 'claude');
    assert.equal(catalog.sdks[0].available, true);
    assert.equal(catalog.models.length, 1);
    assert.equal(catalog.models[0].tier, 'sonnet');
    assert.equal(catalog.tools.length, 2);
    assert.equal(catalog.mcps.length, 1);
    assert.equal(catalog.guards.length, 1);
    assert.equal(catalog.path, p);
  });

  it('missing section → []', () => {
    const partial = `sdks:\n  - { id: claude, name: Claude Agent SDK, available: true }\n`;
    const p = writeFixture('catalog-partial.yaml', partial);
    const catalog = loadCatalog(p);
    assert.deepEqual(catalog.models, []);
    assert.deepEqual(catalog.tools, []);
    assert.deepEqual(catalog.mcps, []);
    assert.deepEqual(catalog.guards, []);
  });
});

// ---------------------------------------------------------------------------
// discoverProjects (disk scan — replaces the projects.yaml registry)
// ---------------------------------------------------------------------------

describe('discoverProjects', () => {
  it('discovers a project dir that carries .forge/project.json', () => {
    const forgeRoot = join(tmpDir, 'disc-cfg');
    const projDir = join(forgeRoot, 'projects', 'betterado', '.forge');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, 'project.json'), '{"name":"betterado"}', 'utf8');

    const found = discoverProjects(join(forgeRoot, 'projects'), forgeRoot);
    assert.equal(found.length, 1);
    assert.equal(found[0].id, 'betterado');
    assert.equal(found[0].path, 'projects/betterado');
    assert.equal(found[0].hasConfig, true);
  });

  it('flags a project dir missing .forge/project.json (hasConfig=false)', () => {
    const forgeRoot = join(tmpDir, 'disc-nocfg');
    mkdirSync(join(forgeRoot, 'projects', 'half-onboarded'), { recursive: true });

    const found = discoverProjects(join(forgeRoot, 'projects'), forgeRoot);
    assert.equal(found.length, 1);
    assert.equal(found[0].id, 'half-onboarded');
    assert.equal(found[0].hasConfig, false);
  });

  it('slugifies a mixed-case dir name to a SLUG_RE id', () => {
    const forgeRoot = join(tmpDir, 'disc-slug');
    mkdirSync(join(forgeRoot, 'projects', 'trafficGame'), { recursive: true });

    const found = discoverProjects(join(forgeRoot, 'projects'), forgeRoot);
    assert.equal(found.length, 1);
    assert.equal(found[0].id, 'trafficgame');
    assert.equal(found[0].path, 'projects/trafficGame');
  });

  it('returns sorted entries and tolerates a missing projects root', () => {
    const forgeRoot = join(tmpDir, 'disc-sort');
    for (const n of ['zeta', 'alpha']) mkdirSync(join(forgeRoot, 'projects', n), { recursive: true });
    const found = discoverProjects(join(forgeRoot, 'projects'), forgeRoot);
    assert.deepEqual(found.map((p) => p.id), ['alpha', 'zeta']);

    // missing projects root → empty list (not a throw)
    assert.deepEqual(discoverProjects(join(tmpDir, 'does-not-exist'), tmpDir), []);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('loaders throw with file path in message on malformed YAML', () => {
    const p = writeFixture('bad.yaml', '{ not yaml: [');
    assert.throws(
      () => loadFlowDefinition(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes(p), `Expected path in error: ${err.message}`);
        return true;
      },
    );
  });

  it('loadFlowDefinition throws with path on missing required field (id)', () => {
    const noId = FLOW_FIXTURE.replace('id: forge-cycle\n', '');
    const p = writeFixture('flow-no-id.yaml', noId);
    assert.throws(
      () => loadFlowDefinition(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes(p), `Expected path in error: ${err.message}`);
        return true;
      },
    );
  });

  it('loadAgentDefinition throws with path on malformed content', () => {
    // Write a SKILL.md that has YAML frontmatter but missing required fields
    const dir = join(tmpDir, 'bad-agent');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'SKILL.md');
    writeFileSync(p, '---\nphase: foo\n---\nno name or description\n', 'utf8');
    assert.throws(
      () => loadAgentDefinition(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes(p), `Expected path in error: ${err.message}`);
        return true;
      },
    );
  });

  it('loadKbDescriptor throws with path on malformed YAML', () => {
    const p = writeFixture('bad-kb.yaml', '{ not yaml: [');
    assert.throws(
      () => loadKbDescriptor(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes(p), `Expected path in error: ${err.message}`);
        return true;
      },
    );
  });

  it('loadCatalog throws with path on malformed YAML', () => {
    const p = writeFixture('bad-catalog.yaml', '{ not yaml: [');
    assert.throws(
      () => loadCatalog(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes(p), `Expected path in error: ${err.message}`);
        return true;
      },
    );
  });

});

// ---------------------------------------------------------------------------
// loadAgentDefinition — legacy SKILL.md guard
// ---------------------------------------------------------------------------

describe('loadAgentDefinition legacy guard', () => {
  it('throws with "not a studio SKILL.md" message when frontmatter has no runtime block', () => {
    const p = writeAgentFixture('legacy-throw-agent', LEGACY_AGENT_FIXTURE);
    assert.throws(
      () => loadAgentDefinition(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('not a studio SKILL.md'),
          `Expected "not a studio SKILL.md" in error: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('isStudioAgent still returns false for legacy SKILL.md without throwing', () => {
    const p = writeAgentFixture('legacy-is-studio-agent', LEGACY_AGENT_FIXTURE);
    assert.equal(isStudioAgent(p), false);
  });
});

// ---------------------------------------------------------------------------
// loadAgentDefinition — enum field guards
// ---------------------------------------------------------------------------

describe('loadAgentDefinition enum guards', () => {
  it('throws on invalid brainAccess value with descriptive message', () => {
    const bad = AGENT_FIXTURE.replace('brainAccess: none', 'brainAccess: invalid-value');
    const p = writeAgentFixture('bad-brain-access-agent', bad);
    assert.throws(
      () => loadAgentDefinition(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('brainAccess') && err.message.includes('mandatory|advisory|none'),
          `Expected enum message for brainAccess: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('throws on invalid runtime.strategy value with descriptive message', () => {
    const bad = AGENT_FIXTURE.replace('  strategy: fixed', '  strategy: unknown-strategy');
    const p = writeAgentFixture('bad-strategy-agent', bad);
    assert.throws(
      () => loadAgentDefinition(p),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('strategy') && err.message.includes('fixed|range'),
          `Expected enum message for strategy: ${err.message}`,
        );
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// serializeAgentDefinition — empty budgets round-trip
// ---------------------------------------------------------------------------

describe('R2-03-F2 fanout block round-trip', () => {
  it('parses a fanout: block and survives load → serialize → load', () => {
    const withFanout = AGENT_FIXTURE.replace(
      /^brainAccess:/m,
      'fanout:\n  drivingArtifact: work-items\n  isolation: worktree\n  concurrencyCap: 2\n  perItemGate: item-declared\nbrainAccess:',
    );
    const p = writeAgentFixture('fanout-agent', withFanout);
    const original = loadAgentDefinition(p);
    assert.deepEqual(original.fanout, { drivingArtifact: 'work-items', isolation: 'worktree', concurrencyCap: 2, perItemGate: 'item-declared' });

    const rtDir = join(tmpDir, 'fanout-agent-rt');
    mkdirSync(rtDir, { recursive: true });
    const rtPath = join(rtDir, 'SKILL.md');
    writeFileSync(rtPath, serializeAgentDefinition(original), 'utf8');
    const reloaded = loadAgentDefinition(rtPath);
    assert.deepEqual(reloaded.fanout, original.fanout, 'fanout survives the serialize round-trip');
  });

  it('an agent WITHOUT a fanout block loads fanout as undefined (not fanout-capable)', () => {
    const p = writeAgentFixture('no-fanout-agent', AGENT_FIXTURE);
    assert.equal(loadAgentDefinition(p).fanout, undefined);
  });
});

describe('serializeAgentDefinition empty budgets round-trip', () => {
  it('agent without budget fields survives load→serialize→load with all budget fields undefined', () => {
    const noBudgets = AGENT_FIXTURE.replace(
      /^budgets:\n  iterationCap: 15\n/m,
      '',
    );
    const p = writeAgentFixture('no-budgets-agent', noBudgets);
    const original = loadAgentDefinition(p);

    // All budget fields should be undefined → deepEqual {}
    assert.deepEqual(original.budgets, {
      iterationFloor: undefined,
      iterationCap: undefined,
      maxTurnsPerIteration: undefined,
      wedgeKillMs: undefined,
      maxTurns: undefined,
      maxBudgetUsd: undefined,
      maxBudgetUsdShare: undefined,
    });

    const serialized = serializeAgentDefinition(original);

    const rtDir = join(tmpDir, 'no-budgets-agent-rt');
    mkdirSync(rtDir, { recursive: true });
    const rtPath = join(rtDir, 'SKILL.md');
    writeFileSync(rtPath, serialized, 'utf8');

    const reloaded = loadAgentDefinition(rtPath);
    assert.deepEqual(reloaded.budgets, original.budgets);
  });
});

// ---------------------------------------------------------------------------
// listAgentDefinitions
// ---------------------------------------------------------------------------

describe('listAgentDefinitions', () => {
  it('returns sorted studio agents, skipping legacy', () => {
    const skillsDir = join(tmpDir, 'skills-list');
    mkdirSync(skillsDir, { recursive: true });

    // Write two studio agents and one legacy
    for (const name of ['zulu', 'alpha']) {
      const d = join(skillsDir, name);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'SKILL.md'), AGENT_FIXTURE.replace('name: tester', `name: ${name}`), 'utf8');
    }
    const legDir = join(skillsDir, 'legacy');
    mkdirSync(legDir, { recursive: true });
    writeFileSync(join(legDir, 'SKILL.md'), LEGACY_AGENT_FIXTURE, 'utf8');

    const defs = listAgentDefinitions(skillsDir);
    assert.equal(defs.length, 2);
    assert.equal(defs[0].slug, 'alpha');
    assert.equal(defs[1].slug, 'zulu');
  });
});

// ---------------------------------------------------------------------------
// listPlainSkills (R3-01-F2)
// ---------------------------------------------------------------------------

describe('listPlainSkills', () => {
  it('returns only the plain (no-runtime) skill, skipping the runtime-bearing one', () => {
    const forgeRootFixture = join(tmpDir, 'plain-skills-root');
    const skillsSubdir = join(forgeRootFixture, 'skills');
    mkdirSync(skillsSubdir, { recursive: true });

    // Plain skill: SKILL.md with no `runtime` block.
    const plainDir = join(skillsSubdir, 'plain-skill');
    mkdirSync(plainDir, { recursive: true });
    writeFileSync(join(plainDir, 'SKILL.md'), LEGACY_AGENT_FIXTURE, 'utf8');

    // Runtime-bearing skill: a studio agent — must be excluded.
    const studioDir = join(skillsSubdir, 'studio-agent');
    mkdirSync(studioDir, { recursive: true });
    writeFileSync(join(studioDir, 'SKILL.md'), AGENT_FIXTURE, 'utf8');

    const plain = listPlainSkills(forgeRootFixture);
    assert.equal(plain.length, 1);
    assert.equal(plain[0].id, 'plain-skill');
    assert.equal(plain[0].name, 'legacy-agent');
    assert.equal(plain[0].desc, 'A legacy skill without studio fields.');
  });

  it('excludes a plain skill that opts out with library:false', () => {
    const forgeRootFixture = join(tmpDir, 'plain-skills-optout-root');
    const skillsSubdir = join(forgeRootFixture, 'skills');
    mkdirSync(skillsSubdir, { recursive: true });
    const optOutDir = join(skillsSubdir, 'opted-out');
    mkdirSync(optOutDir, { recursive: true });
    writeFileSync(join(optOutDir, 'SKILL.md'), '---\nname: opted-out\ndescription: hidden\nlibrary: false\n---\nbody\n', 'utf8');
    const shownDir = join(skillsSubdir, 'shown');
    mkdirSync(shownDir, { recursive: true });
    writeFileSync(join(shownDir, 'SKILL.md'), '---\nname: shown\ndescription: visible\nlibrary: true\n---\nbody\n', 'utf8');

    const plain = listPlainSkills(forgeRootFixture);
    assert.equal(plain.length, 1, 'library:false plain skill is hidden from the palette');
    assert.equal(plain[0].id, 'shown');
  });

  it('returns [] for a forgeRoot with no skills/ directory', () => {
    const emptyRoot = join(tmpDir, 'plain-skills-root-empty');
    assert.deepEqual(listPlainSkills(emptyRoot), []);
  });
});
