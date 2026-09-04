/**
 * REAL-ENTRY-POINT acceptance tests for the tool-fence sweep — driven
 * through the ACTUAL `forge studio lint` entry point (`runStudioLint`,
 * `apps/forge/studio-lint.ts`), not a hand-rolled/direct call to
 * `lintSkillToolFence`. Mirrors `apps/forge/studio-lint-hooks.test.ts`'s own
 * stated reason: a direct-call unit test on `lintSkillToolFence` in
 * isolation would prove the function is correct but NOT that
 * `runStudioLint` ever calls it — an unwired lint function is exactly the
 * "declared-data-fails-open" defect class this campaign keeps finding.
 *
 * Fixture conventions (`tmpRoot`, `buildBaseRoot`, `writeAgent`,
 * `validGuardsCatalogYaml`, `seedValidProject`) are copied from
 * `apps/forge/studio-lint-hooks.test.ts` rather than reinvented.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FORGE_ROOT } from '@forge/kernel/ids.ts';

import { runStudioLint } from '../../apps/forge/studio-lint.ts';

const CHECK = 'skill-tool-fence/task-agent-not-disallowed';

// ---------------------------------------------------------------------------
// Fixture helpers — copied conventions, not reinvented (see file header).
// ---------------------------------------------------------------------------

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-lint-tool-fence-'));
  mkdirSync(join(root, 'studio'), { recursive: true });
  writeFileSync(join(root, 'studio', 'session-kinds.yaml'), '[]\n', 'utf8');
  return root;
}

function validGuardsCatalogYaml(): string {
  return `sdks:
  - { id: claude-agent-sdk, name: Claude Agent SDK, available: true }
models:
  - { id: claude-sonnet-4-6, name: Sonnet 4.6, sdk: claude-agent-sdk, tier: standard }
tools: []
mcps: []
guards:
  - { id: event-log, name: JSONL event log }
`;
}

function seedValidProject(root: string, id = 'my-project'): void {
  const forgeDir = join(root, 'projects', id, '.forge');
  mkdirSync(forgeDir, { recursive: true });
  writeFileSync(join(forgeDir, 'project.json'), JSON.stringify({ name: id }), 'utf8');
}

function buildBaseRoot(): string {
  const root = tmpRoot();
  mkdirSync(join(root, 'skills'), { recursive: true });
  mkdirSync(join(root, 'studio', 'flows'), { recursive: true });
  writeFileSync(join(root, 'studio', 'catalog.yaml'), validGuardsCatalogYaml());
  seedValidProject(root);
  return root;
}

/** A minimal valid studio-agent SKILL.md, with `allowed-tools`/
 *  `disallowed-tools` overridable so tests can construct both the missing-
 *  names and the fully-fenced case without duplicating the whole template. */
function agentSkillMd(slug: string, opts: { allowedTools?: string[]; disallowedTools?: string[] } = {}): string {
  const allowed = opts.allowedTools ?? ['Read'];
  const disallowed = opts.disallowedTools ?? ['Bash'];
  return `---
name: ${slug}
description: A test agent for the tool-fence sweep.
library: true
purpose: Prove the real forge studio lint entry point surfaces skill-tool-fence findings.
brainAccess: none
interactivity: none
composition:
  skills: []
  tools: []
  mcps: []
  guards: []
runtime:
  sdk: claude-agent-sdk
  strategy: fixed
  model: claude-sonnet-4-6
budgets: {}
allowed-tools: [${allowed.join(', ')}]
disallowed-tools: [${disallowed.join(', ')}]
---
## Process

This agent exercises the tool-fence sweep.
`;
}

/** A minimal valid studio-agent SKILL.md that declares NEITHER
 *  `allowed-tools:` nor `disallowed-tools:` at all — the "declares neither"
 *  set (10 real skills) that must stay OUT of scope for this check. */
function agentSkillMdNoToolFrontmatter(slug: string): string {
  return `---
name: ${slug}
description: A test agent that declares no tool frontmatter at all.
library: true
purpose: Prove skills declaring neither allowed-tools nor disallowed-tools are out of scope.
brainAccess: none
interactivity: none
composition:
  skills: []
  tools: []
  mcps: []
  guards: []
runtime:
  sdk: claude-agent-sdk
  strategy: fixed
  model: claude-sonnet-4-6
budgets: {}
---
## Process

This agent exercises the tool-fence sweep's out-of-scope case.
`;
}

function writeAgentMd(root: string, slug: string, content: string): void {
  const dir = join(root, 'skills', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), content);
}

/** Same shape as `writeAgentMd`, but under `studio/starters/agents/<slug>/`
 *  — the OOTB starter template tree (forge-6gv.18: the source the roster
 *  copies are installed FROM, and the tree this file's second sweep,
 *  `lintStarterAgentToolFence`, was added to cover). */
function writeStarterAgentMd(root: string, slug: string, content: string): void {
  const dir = join(root, 'studio', 'starters', 'agents', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), content);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('forge studio lint: a roster SKILL.md declaring tool frontmatter without Task/Agent in disallowed-tools fails skill-tool-fence/task-agent-not-disallowed', () => {
  let root: string | undefined;
  try {
    root = buildBaseRoot();
    const slug = 'agent-missing-fence';
    writeAgentMd(root, slug, agentSkillMd(slug, { disallowedTools: ['Bash', 'WebFetch'] }));

    const result = runStudioLint(root);

    const hits = result.findings.filter(
      (f) => f.level === 'error' && f.object === `skill:${slug}` && f.check === CHECK,
    );
    assert.strictEqual(
      hits.length,
      1,
      `expected exactly 1 skill:${slug} ${CHECK} error from the REAL forge studio lint entry point — got: ${JSON.stringify(result.findings)}`,
    );
    assert.match(hits[0]!.message, /Task/);
    assert.match(hits[0]!.message, /Agent/);
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

test('forge studio lint: a roster SKILL.md declaring disallowed-tools with ONLY Task (missing Agent) still fails', () => {
  let root: string | undefined;
  try {
    root = buildBaseRoot();
    const slug = 'agent-half-fenced';
    writeAgentMd(root, slug, agentSkillMd(slug, { disallowedTools: ['Bash', 'Task'] }));

    const result = runStudioLint(root);

    const hits = result.findings.filter(
      (f) => f.level === 'error' && f.object === `skill:${slug}` && f.check === CHECK,
    );
    assert.strictEqual(
      hits.length,
      1,
      `expected exactly 1 skill:${slug} ${CHECK} error (Agent still missing) — got: ${JSON.stringify(result.findings)}`,
    );
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

test('forge studio lint: a roster SKILL.md whose disallowed-tools already lists Task and Agent passes clean', () => {
  let root: string | undefined;
  try {
    root = buildBaseRoot();
    const slug = 'agent-fully-fenced';
    writeAgentMd(root, slug, agentSkillMd(slug, { disallowedTools: ['Bash', 'Task', 'Agent'] }));

    const result = runStudioLint(root);

    const hits = result.findings.filter((f) => f.object === `skill:${slug}` && f.check === CHECK);
    assert.strictEqual(hits.length, 0, `expected 0 ${CHECK} findings for a fully-fenced skill — got: ${JSON.stringify(result.findings)}`);
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

test('forge studio lint: a roster SKILL.md declaring NEITHER allowed-tools nor disallowed-tools is out of scope for this check', () => {
  let root: string | undefined;
  try {
    root = buildBaseRoot();
    const slug = 'agent-no-tool-frontmatter';
    writeAgentMd(root, slug, agentSkillMdNoToolFrontmatter(slug));

    const result = runStudioLint(root);

    const hits = result.findings.filter((f) => f.object === `skill:${slug}` && f.check === CHECK);
    assert.strictEqual(
      hits.length,
      0,
      `expected 0 ${CHECK} findings for a skill declaring no tool frontmatter at all — got: ${JSON.stringify(result.findings)}`,
    );
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The starter template tree (studio/starters/agents/**, forge-6gv.18) —
// SAME rule, same real entry point, a DIFFERENT root. This is the sweep that
// was missing entirely when the three OOTB starters (Dev/Plan/Review) shipped
// without Task/Agent fenced: `forge studio lint` stayed green on main because
// nothing scanned studio/starters/agents/ at all, only skills/.
// ---------------------------------------------------------------------------

test('forge studio lint: a starter-template SKILL.md under studio/starters/agents/ missing Task/Agent fails skill-tool-fence/task-agent-not-disallowed', () => {
  let root: string | undefined;
  try {
    root = buildBaseRoot();
    const slug = 'starter-missing-fence';
    writeStarterAgentMd(root, slug, agentSkillMd(slug, { disallowedTools: ['Bash', 'WebFetch'] }));

    const result = runStudioLint(root);

    const hits = result.findings.filter(
      (f) => f.level === 'error' && f.object === `starter-agent:${slug}` && f.check === CHECK,
    );
    assert.strictEqual(
      hits.length,
      1,
      `expected exactly 1 starter-agent:${slug} ${CHECK} error from the REAL forge studio lint entry point — got: ${JSON.stringify(result.findings)}`,
    );
    assert.match(hits[0]!.message, /Task/);
    assert.match(hits[0]!.message, /Agent/);
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

test('forge studio lint: a starter-template SKILL.md whose disallowed-tools already lists Task and Agent passes clean', () => {
  let root: string | undefined;
  try {
    root = buildBaseRoot();
    const slug = 'starter-fully-fenced';
    writeStarterAgentMd(root, slug, agentSkillMd(slug, { disallowedTools: ['Bash', 'Task', 'Agent'] }));

    const result = runStudioLint(root);

    const hits = result.findings.filter((f) => f.object === `starter-agent:${slug}` && f.check === CHECK);
    assert.strictEqual(
      hits.length,
      0,
      `expected 0 ${CHECK} findings for a fully-fenced starter template — got: ${JSON.stringify(result.findings)}`,
    );
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

test('forge studio lint: a synthetic root with no studio/starters/agents/ directory at all degrades to zero starter-agent findings (no crash)', () => {
  let root: string | undefined;
  try {
    root = buildBaseRoot(); // never creates studio/starters/ — proves the missing-dir case
    const result = runStudioLint(root);

    const hits = result.findings.filter((f) => f.object.startsWith('starter-agent:'));
    assert.strictEqual(
      hits.length,
      0,
      `expected 0 starter-agent findings when studio/starters/agents/ is absent — got: ${JSON.stringify(result.findings)}`,
    );
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Pin: the REAL OOTB starters (forge-6gv.18). Reproduces the exact regression
// — copy a starter's SKILL.md into skills/ and lint — and separately locks
// every known starter slug against the fence directly, so a future starter
// added to studio/starters/agents/ without Task/Agent trips THIS test, not
// just the general "runStudioLint on the real repo produces 0 errors" smoke
// test in apps/forge/studio-lint.test.ts (which would also catch it, but wouldn't
// name the starter or the mechanism).
// ---------------------------------------------------------------------------

test('every real OOTB starter agent (studio/starters/agents/**) satisfies the tool fence', () => {
  const KNOWN_STARTER_SLUGS = ['dev', 'plan', 'review'] as const;
  // FORGE_ROOT, not process.cwd(): under `npm test --workspace=packages/library`
  // the cwd is `packages/library/`, and this sweep must lint the REAL repo.
  const result = runStudioLint(FORGE_ROOT);

  const starterHits = result.findings.filter((f) => f.object.startsWith('starter-agent:') && f.check === CHECK);
  assert.strictEqual(
    starterHits.length,
    0,
    `expected 0 ${CHECK} findings across studio/starters/agents/ — got: ${JSON.stringify(starterHits)}`,
  );

  // Guard the guard: if studio/starters/agents/ were ever emptied or renamed,
  // the assertion above would pass vacuously (zero dirs scanned ⇒ zero
  // findings). Naming the known slugs here means that failure mode is caught
  // too — a bare "0 findings" is not proof the sweep actually ran over
  // anything.
  const scannedDirs = new Set(
    readdirSync(join(FORGE_ROOT, 'studio', 'starters', 'agents'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name),
  );
  for (const slug of KNOWN_STARTER_SLUGS) {
    assert.ok(scannedDirs.has(slug), `expected studio/starters/agents/${slug}/ to exist on disk`);
  }
});
