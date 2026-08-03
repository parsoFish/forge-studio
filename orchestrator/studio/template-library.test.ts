/**
 * Acceptance tests for orchestrator/studio/template-library.ts (R3-06).
 *
 * The module under test does not exist yet — this file is RED at branch base
 * (ERR_MODULE_NOT_FOUND on the `./template-library.ts` import is the expected
 * red). Mirrors the skill-library.ts / skill-library.test.ts pattern (R3-01).
 *
 * AT numbers below are a flat sequence AT-1..AT-N spanning ALL seven files
 * touched by this initiative (see the other six test files for the rest).
 *
 * Style: node:test + node:assert/strict, real temp forge roots via
 * mkdtempSync for anything hypothetical; the REAL repo (REPO_ROOT) for facts
 * that must stay true (real template/flow/scaffold counts, edges, agents).
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';

import {
  listTemplateLibrary,
  templateDetail,
  deriveArtifactTemplateUsage,
  deriveDemoElementUsage,
  lintTemplateLibrary,
  STARTERS_NON_TEMPLATE_DIRS,
  type TemplateLibraryEntry,
} from './template-library.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];

function makeForgeRoot(prefix = 'template-library-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

function writeArtifactTemplate(root: string, id: string, frontmatter: Record<string, unknown>, body = `# ${id}\n\nContract body.\n`): string {
  const dir = join(root, 'studio', 'artifact-templates');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${id}.md`);
  writeFileSync(p, matter.stringify('\n' + body, { id, name: id, kind: 'file', ...frontmatter }), 'utf8');
  return p;
}

function writeDemoElement(root: string, id: string, frontmatter: Record<string, unknown>, body = `# ${id}\n\nGenerator body.\n`): string {
  const dir = join(root, 'studio', 'demo-elements');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${id}.md`);
  writeFileSync(p, matter.stringify('\n' + body, { id, name: id, phase: 'capture', description: 'd', ...frontmatter }), 'utf8');
  return p;
}

function writeScaffold(root: string, id: string, files: Record<string, string>): void {
  const dir = join(root, 'studio', 'starters', 'projects', id);
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content, 'utf8');
  }
}

function writeFlow(root: string, id: string, yamlBody: string): void {
  const dir = join(root, 'studio', 'flows', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'flow.yaml'), yamlBody, 'utf8');
}

function writeProject(root: string, id: string, projectJson: Record<string, unknown>): void {
  const dir = join(root, 'projects', id, '.forge');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ name: id, ...projectJson }), 'utf8');
}

function minimalFlowYaml(opts: {
  id: string;
  nodes: string; // pre-formatted YAML nodes block
  edges: string; // pre-formatted YAML edges block
}): string {
  return `id: ${opts.id}
name: Test Flow
version: 1
goal: Test.
project: null
kb: null
costCeilingUsd: 10
origin: seed
nodes:
${opts.nodes}
edges:
${opts.edges}
triggers: []
`;
}

function byId(entries: readonly TemplateLibraryEntry[], id: string): TemplateLibraryEntry {
  const e = entries.find((x) => x.id === id);
  assert.ok(e, `expected entry "${id}" to be present`);
  return e!;
}

// ===========================================================================
// Union + category structure (AT 1-4)
// ===========================================================================

describe('listTemplateLibrary — real repo union + categories', () => {
  it('AT-1: the real repo surfaces exactly 15 templates: 7 planning + 6 demo-output + 2 project-scaffold', () => {
    const entries = listTemplateLibrary(REPO_ROOT);
    assert.equal(entries.length, 15, `got ids: ${entries.map((e) => e.id).join(', ')}`);
    assert.equal(entries.filter((e) => e.category === 'planning').length, 7);
    assert.equal(entries.filter((e) => e.category === 'demo-output').length, 6);
    assert.equal(entries.filter((e) => e.category === 'project-scaffold').length, 2);
  });

  it('AT-2: entries are sorted by id (deterministic output)', () => {
    const ids = listTemplateLibrary(REPO_ROOT).map((e) => e.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => a.localeCompare(b)));
  });

  it('AT-3: D1 — category is structural (directory), never sniffed from content', () => {
    const root = makeForgeRoot();
    writeArtifactTemplate(root, 'fixture-file-kind', { kind: 'file' });
    writeArtifactTemplate(root, 'fixture-git-kind', { kind: 'git-state' });
    const entries = listTemplateLibrary(root);
    // Both artifact-templates land in 'planning' regardless of their differing
    // `kind` value — the directory decides the category, not the field.
    assert.equal(byId(entries, 'fixture-file-kind').category, 'planning');
    assert.equal(byId(entries, 'fixture-git-kind').category, 'planning');
  });

  it('AT-4: real repo id sets per category are exactly the known on-disk ids', () => {
    const entries = listTemplateLibrary(REPO_ROOT);
    const planning = entries.filter((e) => e.category === 'planning').map((e) => e.id).sort();
    const demoOutput = entries.filter((e) => e.category === 'demo-output').map((e) => e.id).sort();
    const scaffold = entries.filter((e) => e.category === 'project-scaffold').map((e) => e.id).sort();
    assert.deepEqual(planning, ['demo-fix-spec', 'plan', 'pr', 'review-findings', 'verdict', 'wi-branches', 'work-items']);
    assert.deepEqual(demoOutput, ['api-verify', 'cli-capture', 'code-diff', 'narrative', 'screenshot', 'test-evidence']);
    assert.deepEqual(scaffold, ['typescript-api', 'typescript-cli']);
  });
});

// ===========================================================================
// templateDetail (AT 5-8)
// ===========================================================================

describe('templateDetail', () => {
  it('AT-5: a planning entry\'s detail carries its single .md file, path relative, body verbatim', () => {
    const detail = templateDetail(REPO_ROOT, 'plan');
    assert.ok(detail);
    assert.equal(detail!.files.length, 1);
    assert.equal(detail!.files[0].path, 'plan.md');
    const onDisk = readFileSync(join(REPO_ROOT, 'studio', 'artifact-templates', 'plan.md'), 'utf8');
    assert.equal(detail!.files[0].body, onDisk);
  });

  it('AT-6: a demo-output entry\'s detail carries its single .md file, same shape', () => {
    const detail = templateDetail(REPO_ROOT, 'cli-capture');
    assert.ok(detail);
    assert.equal(detail!.files.length, 1);
    assert.equal(detail!.files[0].path, 'cli-capture.md');
    const onDisk = readFileSync(join(REPO_ROOT, 'studio', 'demo-elements', 'cli-capture.md'), 'utf8');
    assert.equal(detail!.files[0].body, onDisk);
  });

  it('AT-7: a project-scaffold entry\'s detail carries the whole file tree, sorted lexicographically', () => {
    const detail = templateDetail(REPO_ROOT, 'typescript-cli');
    assert.ok(detail);
    assert.ok(detail!.files.length > 3, 'a real scaffold has more than a handful of files');
    const paths = detail!.files.map((f) => f.path);
    assert.deepEqual(paths, [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    assert.ok(paths.includes('package.json'));
    assert.ok(paths.includes('AGENTS.md'));
    assert.ok(!paths.some((p) => p.includes('\\')), 'paths must be POSIX-separated');
  });

  it('AT-8: an unknown id returns null (never throws)', () => {
    assert.equal(templateDetail(REPO_ROOT, 'no-such-template-anywhere'), null);
  });
});

// ===========================================================================
// D2 — the starters gap is enforced, never silent (AT 9-11)
// ===========================================================================

describe('D2 — STARTERS_NON_TEMPLATE_DIRS + starters-gap lint', () => {
  it('AT-9: STARTERS_NON_TEMPLATE_DIRS covers exactly {agents, flows}, each with a non-empty reason', () => {
    const dirs = STARTERS_NON_TEMPLATE_DIRS.map((e) => e.dir).sort();
    assert.deepEqual(dirs, ['agents', 'flows']);
    for (const entry of STARTERS_NON_TEMPLATE_DIRS) {
      assert.ok(typeof entry.reason === 'string' && entry.reason.trim().length > 0, `${entry.dir} must carry a non-empty reason`);
    }
  });

  it('AT-10: the real repo lints clean on the starters-gap check (guard against shipping a red lint)', () => {
    const findings = lintTemplateLibrary(REPO_ROOT).filter((f) => f.check === 'template-library/starters-gap');
    assert.deepEqual(findings, [], `expected 0 starters-gap findings, got: ${JSON.stringify(findings)}`);
  });

  it('AT-11: an unmapped studio/starters/ subdir → ERROR naming it', () => {
    const root = makeForgeRoot();
    mkdirSync(join(root, 'studio', 'starters', 'agents'), { recursive: true });
    mkdirSync(join(root, 'studio', 'starters', 'flows'), { recursive: true });
    mkdirSync(join(root, 'studio', 'starters', 'projects'), { recursive: true });
    // The unmapped, undeclared subdir — neither a category source nor on the
    // exclusion list.
    mkdirSync(join(root, 'studio', 'starters', 'widgets'), { recursive: true });

    const findings = lintTemplateLibrary(root).filter((f) => f.check === 'template-library/starters-gap');
    assert.ok(findings.length > 0, 'expected a starters-gap finding');
    assert.ok(findings.some((f) => f.level === 'error'));
    assert.ok(findings.some((f) => f.message.includes('widgets')), `message must name "widgets", got: ${JSON.stringify(findings)}`);
  });
});

// ===========================================================================
// D3 — usedBy is derived from a real, NAMED source — planning (AT 12-18)
// ===========================================================================

describe('D3 — planning usedBy derivation (real repo flow graph)', () => {
  it('AT-12: usedBy for "plan" is exactly ["forge-architect:architect→project-manager"]', () => {
    const entry = byId(listTemplateLibrary(REPO_ROOT), 'plan');
    assert.deepEqual(entry.usedBy, ['forge-architect:architect→project-manager']);
  });

  it('AT-13: usedBy for "wi-branches" is exactly ["forge-develop:developer-ralph→demo-agent"]', () => {
    const entry = byId(listTemplateLibrary(REPO_ROOT), 'wi-branches');
    assert.deepEqual(entry.usedBy, ['forge-develop:developer-ralph→demo-agent']);
  });

  it('AT-14: usedBy for "pr" is exactly ["forge-develop:demo-agent→adversarial-review"]', () => {
    const entry = byId(listTemplateLibrary(REPO_ROOT), 'pr');
    assert.deepEqual(entry.usedBy, ['forge-develop:demo-agent→adversarial-review']);
  });

  it('AT-15: usedBy for "review-findings" resolves its gate endpoint as "gate:review" (no agent on that node)', () => {
    const entry = byId(listTemplateLibrary(REPO_ROOT), 'review-findings');
    assert.deepEqual(entry.usedBy, ['forge-develop:adversarial-review→gate:review']);
  });

  it('AT-16: verdict / work-items / demo-fix-spec travel by band re-entry — zero flow edges, usedBy: []', () => {
    const entries = listTemplateLibrary(REPO_ROOT);
    for (const id of ['verdict', 'work-items', 'demo-fix-spec']) {
      assert.deepEqual(byId(entries, id).usedBy, [], `${id} must have empty usedBy (no DAG edge carries it)`);
    }
  });

  it('AT-17: usedByDerivation for every planning entry names the flow-graph source and the real flow-file count (3)', () => {
    const entries = listTemplateLibrary(REPO_ROOT).filter((e) => e.category === 'planning');
    assert.ok(entries.length > 0);
    for (const e of entries) {
      assert.equal(e.usedByDerivation.source, 'studio/flows/*/flow.yaml');
      assert.equal(e.usedByDerivation.scanned, 3, `expected 3 scanned flow files (forge-architect/forge-develop/forge-reflect) for "${e.id}"`);
    }
  });

  it('AT-18: deriveArtifactTemplateUsage(REPO_ROOT) is the same fact, exposed as a standalone Map', () => {
    const usage = deriveArtifactTemplateUsage(REPO_ROOT);
    assert.deepEqual(usage.get('plan'), ['forge-architect:architect→project-manager']);
    assert.deepEqual(usage.get('review-findings'), ['forge-develop:adversarial-review→gate:review']);
    assert.deepEqual(usage.get('verdict') ?? [], []);
  });
});

// ===========================================================================
// D3 — demo-output usedBy derivation (fixture-controlled, AT 19-21)
// ===========================================================================

describe('D3 — demo-output usedBy derivation (project demoProcess)', () => {
  function demoOutputFixture(): string {
    const root = makeForgeRoot('template-library-demo-');
    writeDemoElement(root, 'cli-capture', { phase: 'capture' });
    writeDemoElement(root, 'narrative', { phase: 'present' });
    writeProject(root, 'proj-with-element', {
      demoProcess: [{ kind: 'capture', text: 'run it', element: 'cli-capture' }],
    });
    writeProject(root, 'proj-without-element', {
      demoProcess: [{ kind: 'capture', text: 'run it (legacy free text, no element)' }],
    });
    return root;
  }

  it('AT-19: a demo-element referenced by exactly one project\'s demoProcess.element → usedBy: [that project id]; an unreferenced element → []', () => {
    const root = demoOutputFixture();
    const entries = listTemplateLibrary(root);
    assert.deepEqual(byId(entries, 'cli-capture').usedBy, ['proj-with-element']);
    assert.deepEqual(byId(entries, 'narrative').usedBy, []);
  });

  it('AT-20: usedByDerivation names the real project.json source and the real discovered-project count', () => {
    const root = demoOutputFixture();
    const entries = listTemplateLibrary(root).filter((e) => e.category === 'demo-output');
    for (const e of entries) {
      assert.equal(e.usedByDerivation.source, 'projects/*/.forge/project.json (demoProcess)');
      assert.equal(e.usedByDerivation.scanned, 2, `expected 2 discovered projects for "${e.id}"`);
    }
  });

  it('AT-21: deriveDemoElementUsage(root) is the same fact, exposed as a standalone Map', () => {
    const root = demoOutputFixture();
    const usage = deriveDemoElementUsage(root);
    assert.deepEqual(usage.get('cli-capture'), ['proj-with-element']);
    assert.deepEqual(usage.get('narrative') ?? [], []);
  });
});

// ===========================================================================
// D3 — project-scaffold usedBy is honestly empty (AT 22-23)
// ===========================================================================

describe('D3 — project-scaffold usedBy is honestly empty (appType is not persisted)', () => {
  it('AT-22: the real repo\'s scaffold entries carry usedBy: [] and a non-empty usedByDerivation.source naming what was checked', () => {
    const entries = listTemplateLibrary(REPO_ROOT).filter((e) => e.category === 'project-scaffold');
    assert.equal(entries.length, 2);
    for (const e of entries) {
      assert.deepEqual(e.usedBy, []);
      assert.ok(typeof e.usedByDerivation.source === 'string' && e.usedByDerivation.source.trim().length > 0, `"${e.id}" usedByDerivation.source must be a non-empty string`);
    }
  });

  it('AT-23: FORBIDDEN — a project that happens to share a scaffold\'s file bytes must NOT be attributed to it (no file-shape comparison)', () => {
    const root = makeForgeRoot('template-library-scaffold-');
    writeScaffold(root, 'typescript-cli', {
      'package.json': JSON.stringify({ name: '{{NAME}}', version: '0.0.0' }, null, 2),
      'AGENTS.md': '{{TITLE}}\n',
    });
    // A project whose package.json is byte-identical to the (substituted) scaffold's.
    writeProject(root, 'shape-alike-project', {});
    mkdirSync(join(root, 'projects', 'shape-alike-project'), { recursive: true });
    writeFileSync(
      join(root, 'projects', 'shape-alike-project', 'package.json'),
      JSON.stringify({ name: 'shape-alike-project', version: '0.0.0' }, null, 2),
      'utf8',
    );

    const entry = byId(listTemplateLibrary(root), 'typescript-cli');
    assert.deepEqual(entry.usedBy, [], 'a coincidental file-shape match must never populate usedBy');
  });
});

// ===========================================================================
// D4 — declared producer/consumer cross-validated against the flow graph
// (AT 24-28)
// ===========================================================================

describe('D4 — producer/consumer cross-check', () => {
  it('AT-24: plan / wi-branches / pr / review-findings are all edge-backed and agree → endpointsVerified: true, no lint finding', () => {
    const entries = listTemplateLibrary(REPO_ROOT);
    for (const id of ['plan', 'wi-branches', 'pr', 'review-findings']) {
      assert.equal(byId(entries, id).endpointsVerified, true, `${id} must be endpointsVerified: true`);
    }
    const mismatchFindings = lintTemplateLibrary(REPO_ROOT).filter(
      (f) => f.check === 'template-library/endpoint-mismatch' && ['plan', 'wi-branches', 'pr', 'review-findings'].some((id) => f.object.includes(id)),
    );
    assert.deepEqual(mismatchFindings, []);
  });

  it('AT-25: declaredProducer/declaredConsumer are carried VERBATIM from frontmatter — "review-findings" consumer stays the bare string "review", never normalized to "gate:review"', () => {
    const entries = listTemplateLibrary(REPO_ROOT);
    const plan = byId(entries, 'plan');
    assert.equal(plan.declaredProducer, 'architect');
    assert.equal(plan.declaredConsumer, 'project-manager');
    const reviewFindings = byId(entries, 'review-findings');
    assert.equal(reviewFindings.declaredProducer, 'adversarial-review');
    assert.equal(reviewFindings.declaredConsumer, 'review', 'must stay the bare frontmatter value, not the resolved gate:review form');
  });

  it('AT-26: verdict / work-items / demo-fix-spec have zero edges → endpointsVerified: false + exactly 3 lint flags naming them, 0 errors', () => {
    const entries = listTemplateLibrary(REPO_ROOT);
    for (const id of ['verdict', 'work-items', 'demo-fix-spec']) {
      assert.equal(byId(entries, id).endpointsVerified, false, `${id} must be endpointsVerified: false (unverifiable)`);
    }
    const flags = lintTemplateLibrary(REPO_ROOT).filter((f) => f.check === 'template-library/unverifiable-endpoints');
    assert.equal(flags.length, 3, `expected 3 unverifiable-endpoints flags, got: ${JSON.stringify(flags)}`);
    assert.ok(flags.every((f) => f.level === 'flag'));
    for (const id of ['verdict', 'work-items', 'demo-fix-spec']) {
      assert.ok(flags.some((f) => f.message.includes(id)), `expected a flag naming "${id}"`);
    }
    const errors = lintTemplateLibrary(REPO_ROOT).filter((f) => f.check === 'template-library/endpoint-mismatch' && f.level === 'error');
    assert.deepEqual(errors, [], 'the real repo must not carry any endpoint-mismatch errors');
  });

  it('AT-27: a declared producer/consumer that CONTRADICTS the resolved edge endpoints → ERROR', () => {
    const root = makeForgeRoot('template-library-mismatch-');
    writeArtifactTemplate(root, 'mismatched', { producer: 'ghost-agent', consumer: 'real-consumer' });
    writeFlow(
      root,
      'fixture-flow',
      minimalFlowYaml({
        id: 'fixture-flow',
        nodes: '  - { id: a, agent: real-producer }\n  - { id: b, agent: real-consumer }',
        edges: '  - { from: a, to: b, artifact: mismatched }',
      }),
    );

    const entry = byId(listTemplateLibrary(root), 'mismatched');
    assert.equal(entry.endpointsVerified, false, 'a contradicting declaration must not be reported as verified');
    const findings = lintTemplateLibrary(root).filter((f) => f.check === 'template-library/endpoint-mismatch');
    assert.ok(findings.some((f) => f.level === 'error' && f.message.includes('mismatched')));
  });

  it('AT-28: gate-endpoint tolerant match — the bare node id matches; a different declared value does not', () => {
    const rootOk = makeForgeRoot('template-library-gate-ok-');
    writeArtifactTemplate(rootOk, 'gate-matched', { producer: 'producer-agent', consumer: 'review-gate' });
    writeFlow(
      rootOk,
      'fixture-flow',
      minimalFlowYaml({
        id: 'fixture-flow',
        nodes: '  - { id: a, agent: producer-agent }\n  - { id: review-gate, gate: verdict }',
        edges: '  - { from: a, to: review-gate, artifact: gate-matched }',
      }),
    );
    const okEntry = byId(listTemplateLibrary(rootOk), 'gate-matched');
    assert.equal(okEntry.endpointsVerified, true, 'declared consumer equal to the bare gate node id must verify');

    const rootBad = makeForgeRoot('template-library-gate-bad-');
    writeArtifactTemplate(rootBad, 'gate-mismatched', { producer: 'producer-agent', consumer: 'some-other-name' });
    writeFlow(
      rootBad,
      'fixture-flow',
      minimalFlowYaml({
        id: 'fixture-flow',
        nodes: '  - { id: a, agent: producer-agent }\n  - { id: review-gate, gate: verdict }',
        edges: '  - { from: a, to: review-gate, artifact: gate-mismatched }',
      }),
    );
    const badEntry = byId(listTemplateLibrary(rootBad), 'gate-mismatched');
    assert.equal(badEntry.endpointsVerified, false);
    const findings = lintTemplateLibrary(rootBad).filter((f) => f.check === 'template-library/endpoint-mismatch');
    assert.ok(findings.some((f) => f.level === 'error' && f.message.includes('gate-mismatched')));
  });
});

// ===========================================================================
// D5 — format / provenance / definitionRef are derived, never new frontmatter
// (AT 29-33)
// ===========================================================================

describe('D5 — format / provenance / definitionRef', () => {
  it('AT-29: planning format is the source ArtifactTemplate.kind, verbatim', () => {
    const entries = listTemplateLibrary(REPO_ROOT);
    assert.equal(byId(entries, 'plan').format, 'file');
    assert.equal(byId(entries, 'wi-branches').format, 'git-state');
  });

  it('AT-30: demo-output format is the source DemoElementDefinition.phase, verbatim, for every real element', () => {
    const entries = listTemplateLibrary(REPO_ROOT);
    const expected: Record<string, string> = {
      'api-verify': 'verify',
      'cli-capture': 'capture',
      'code-diff': 'present',
      narrative: 'present',
      screenshot: 'capture',
      'test-evidence': 'verify',
    };
    for (const [id, phase] of Object.entries(expected)) {
      assert.equal(byId(entries, id).format, phase, `"${id}" format must equal its phase`);
    }
  });

  it('AT-31: project-scaffold format is the fixed literal "directory tree"', () => {
    const entries = listTemplateLibrary(REPO_ROOT);
    assert.equal(byId(entries, 'typescript-cli').format, 'directory tree');
    assert.equal(byId(entries, 'typescript-api').format, 'directory tree');
  });

  it('AT-32: provenance is category-level, pinned exactly, identical across every entry in a category', () => {
    const entries = listTemplateLibrary(REPO_ROOT);
    for (const e of entries.filter((x) => x.category === 'planning')) assert.equal(e.provenance, 'studio/artifact-templates');
    for (const e of entries.filter((x) => x.category === 'demo-output')) assert.equal(e.provenance, 'studio/demo-elements');
    for (const e of entries.filter((x) => x.category === 'project-scaffold')) assert.equal(e.provenance, 'studio/starters/projects');
  });

  it('AT-33: definitionRef is the entry-specific, repo-root-relative path', () => {
    const entries = listTemplateLibrary(REPO_ROOT);
    assert.equal(byId(entries, 'plan').definitionRef, 'studio/artifact-templates/plan.md');
    assert.equal(byId(entries, 'test-evidence').definitionRef, 'studio/demo-elements/test-evidence.md');
    assert.equal(byId(entries, 'typescript-api').definitionRef, 'studio/starters/projects/typescript-api');
  });
});

// ===========================================================================
// D6 — previewKind is a total, derived function (AT 34-35)
// ===========================================================================

describe('D6 — previewKind mapping', () => {
  it('AT-34: the previewKind mapping is pinned exactly, across every real entry', () => {
    const entries = listTemplateLibrary(REPO_ROOT);
    const expected: Record<string, string> = {
      plan: 'doc', // planning, kind: file
      'wi-branches': 'mock', // planning, kind: git-state
      'api-verify': 'html', // demo-output, phase: verify
      'test-evidence': 'html',
      'cli-capture': 'shots', // demo-output, phase: capture
      screenshot: 'shots',
      'code-diff': 'doc', // demo-output, phase: present
      narrative: 'doc',
      'typescript-cli': 'scaffold',
      'typescript-api': 'scaffold',
    };
    for (const [id, previewKind] of Object.entries(expected)) {
      assert.equal(byId(entries, id).previewKind, previewKind, `"${id}" previewKind mismatch`);
    }
  });

  it('AT-35: an unrecognised demo-element phase (bypassing the enum) surfaces as an error entry — never a silently-defaulted previewKind, and never crashes the listing', () => {
    const root = makeForgeRoot('template-library-badphase-');
    const dir = join(root, 'studio', 'demo-elements');
    mkdirSync(dir, { recursive: true });
    // Hand-write invalid frontmatter — bypasses the loader's DEMO_STEP_KINDS oneOf().
    writeFileSync(
      join(dir, 'bogus-phase.md'),
      '---\nid: bogus-phase\nname: Bogus\nphase: not-a-real-phase\ndescription: d\n---\nBody.\n',
      'utf8',
    );
    writeDemoElement(root, 'clean-element', { phase: 'verify' });

    let entries: TemplateLibraryEntry[] = [];
    assert.doesNotThrow(() => { entries = listTemplateLibrary(root); }, 'one malformed demo-element must not crash the whole listing');

    const clean = entries.find((e) => e.id === 'clean-element');
    assert.ok(clean, 'the clean sibling must still be reported');
    assert.equal(clean!.previewKind, 'html');

    const bogus = entries.find((e) => e.id === 'bogus-phase');
    assert.ok(bogus, 'the malformed element must still be reported, not dropped');
    assert.ok(typeof bogus!.error === 'string' && bogus!.error.length > 0, 'must carry a non-empty error field');
    assert.equal(bogus!.previewKind, undefined, 'a malformed entry must never carry a silently-defaulted previewKind');
  });
});

// ===========================================================================
// D7 — malformed definitions + duplicate ids (AT 36-37)
// ===========================================================================

describe('D7 — malformed definitions surface with error; duplicate ids are a lint error', () => {
  it('AT-36: a malformed artifact-template (missing required "id") surfaces as an entry with an error field, not dropped', () => {
    const root = makeForgeRoot('template-library-malformed-');
    const dir = join(root, 'studio', 'artifact-templates');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'broken.md'), '---\nname: Broken\nkind: file\n---\nBody.\n', 'utf8');
    writeArtifactTemplate(root, 'clean-template', {});

    let entries: TemplateLibraryEntry[] = [];
    assert.doesNotThrow(() => { entries = listTemplateLibrary(root); });

    assert.ok(entries.some((e) => e.id === 'clean-template'), 'the clean sibling must still be reported');
    // The broken file has no parseable id — it must still surface (e.g. keyed by
    // filename stem) with a non-empty error, never silently vanish.
    const broken = entries.find((e) => e.error && e.error.length > 0 && e.category === 'planning' && e.id !== 'clean-template');
    assert.ok(broken, `expected the malformed artifact-template to surface with an error, got: ${JSON.stringify(entries)}`);
  });

  it('AT-37: a duplicate id across two categories → both entries surface, and lintTemplateLibrary emits a duplicate-id ERROR naming it', () => {
    const root = makeForgeRoot('template-library-dupe-');
    writeArtifactTemplate(root, 'collision', {});
    writeDemoElement(root, 'collision', {});

    const entries = listTemplateLibrary(root).filter((e) => e.id === 'collision');
    assert.equal(entries.length, 2, 'both the planning and demo-output entries must surface, neither dropped nor merged');
    assert.deepEqual(entries.map((e) => e.category).sort(), ['demo-output', 'planning']);

    const findings = lintTemplateLibrary(root).filter((f) => f.check === 'template-library/duplicate-id');
    assert.ok(findings.some((f) => f.level === 'error' && f.message.includes('collision')));
  });
});
