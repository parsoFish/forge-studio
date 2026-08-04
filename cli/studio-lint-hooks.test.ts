/**
 * REAL-ENTRY-POINT acceptance tests for R3-03-F1b's symmetric enforcement
 * (composition.hooks vs composition.guards) — driven through the ACTUAL
 * `forge studio lint` entry point (`runStudioLint`, `cli/studio-lint.ts`),
 * not a hand-rolled/direct call to `lintHookComposition`/`lintHookDefinitions`.
 *
 * WHY THIS FILE EXISTS (peer-review redirect, 2026-08-04): the direct-call
 * tests in `orchestrator/studio/hook-library.test.ts` prove `lintHookComposition`
 * behaves correctly in isolation — they do NOT prove `runStudioLint` ever
 * calls it. An unwired lint function is exactly the "declared-data-fails-open"
 * defect class this campaign keeps finding (`composition/guard-unknown` was
 * implemented, unit-tested, and inert in production until its own real-entry-
 * point test was added — see `cli/studio-lint-guards-migration.test.ts`'s C4).
 * A lint that lints nothing passes its own unit tests perfectly. So this file
 * drives `runStudioLint(root)` itself and asserts the findings appear in the
 * REAL aggregate output — pinning that the implementer must wire
 * `lintHookComposition`/`lintHookDefinitions` INTO `runStudioLint`, however
 * they choose to do it (the wiring shape is the implementer's call; only the
 * observable behaviour — a real finding from the real entry point — is
 * pinned here, per instruction).
 *
 * Co-located in cli/ (not orchestrator/studio/), mirroring
 * `cli/studio-lint-guards-migration.test.ts`'s own stated reason: both need
 * the entry point directly. Fixture conventions (`tmpRoot`, `validSkillMd`-
 * shaped content, `validCatalogYaml`, `seedValidProject`) are copied from
 * `cli/studio-lint.test.ts` / `cli/studio-lint-guards-migration.test.ts`
 * rather than reinvented.
 *
 * RED today for compounding reasons, same pattern as the guards-migration
 * file's A3: `hook-library.ts` does not exist, its lint functions are not
 * wired into `runStudioLint`, AND (for the two fixtures below that declare a
 * `composition.hooks:` key) `loadAgentDefinition` currently still THROWS the
 * "composition.hooks is retired" error before lint ever gets a chance to
 * apply the new hook-aware checks — so today those agents surface as a
 * generic `check: 'load'` error, not the specific hook-library findings
 * pinned below. All four assertions read `0` matching findings today.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';

import { runStudioLint } from './studio-lint.ts';

// ---------------------------------------------------------------------------
// Fixture helpers — copied conventions, not reinvented (see file header).
// ---------------------------------------------------------------------------

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'studio-lint-hooks-'));
}

/** Minimal valid SKILL.md content, with composition.guards/.hooks overridable
 *  — mirrors cli/studio-lint.test.ts's `validSkillMd`. */
function agentSkillMd(slug: string, opts: { guards?: string[]; hooks?: string[] } = {}): string {
  const guardsLine = `  guards: [${(opts.guards ?? []).join(', ')}]`;
  const hooksLine = opts.hooks !== undefined ? `\n  hooks: [${opts.hooks.join(', ')}]` : '';
  return `---
name: ${slug}
description: A test agent for the hooks/guards symmetric-enforcement lint.
library: true
purpose: Prove the real forge studio lint entry point surfaces hook-library findings.
brainAccess: none
interactivity: none
composition:
  skills: []
  tools: []
  mcps: []
${guardsLine}${hooksLine}
runtime:
  sdk: claude-agent-sdk
  strategy: fixed
  model: claude-sonnet-4-6
budgets: {}
allowed-tools: []
disallowed-tools: []
---
## Process

This agent exercises the hooks/guards symmetric-enforcement lint.
`;
}

/** The 9 real orchestrator guard ids, in catalog.yaml's `guards:` shape —
 *  mirrors cli/studio-lint-guards-migration.test.ts's `validGuardsCatalogYaml`. */
function validGuardsCatalogYaml(): string {
  return `sdks:
  - { id: claude-agent-sdk, name: Claude Agent SDK, available: true }
models:
  - { id: claude-sonnet-4-6, name: Sonnet 4.6, sdk: claude-agent-sdk, tier: standard }
tools: []
mcps: []
guards:
  - { id: event-log, name: JSONL event log }
  - { id: cost-guard, name: Cost guard }
  - { id: stall-watchdog, name: Stall watchdog }
  - { id: merge-gate, name: Merge gate }
  - { id: scratch-strip, name: Scratch strip }
  - { id: wi-contract, name: WI contract band }
  - { id: reflection-close, name: Reflection close band }
  - { id: demo-band, name: Demo band }
  - { id: review-band, name: Review band }
`;
}

function seedValidProject(root: string, id = 'my-project'): void {
  const forgeDir = join(root, 'projects', id, '.forge');
  mkdirSync(forgeDir, { recursive: true });
  writeFileSync(join(forgeDir, 'project.json'), JSON.stringify({ name: id }), 'utf8');
}

/** A base root with everything runStudioLint needs to lint clean EXCEPT the
 *  fixture agent(s)/hooks the caller adds afterwards — mirrors
 *  cli/studio-lint.test.ts's `buildValidRoot`, but seeds the real 9-id
 *  `guards:` catalog section (not an empty one) so guard-id resolution has
 *  real ground truth to check against. */
function buildBaseRoot(): string {
  const root = tmpRoot();
  mkdirSync(join(root, 'skills'), { recursive: true }); // runStudioLint errors if skills/ is missing entirely (existence check, not an emptiness one)
  mkdirSync(join(root, 'studio', 'flows'), { recursive: true });
  writeFileSync(join(root, 'studio', 'catalog.yaml'), validGuardsCatalogYaml());
  seedValidProject(root);
  return root;
}

function writeAgent(root: string, slug: string, opts: { guards?: string[]; hooks?: string[] } = {}): void {
  const dir = join(root, 'skills', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), agentSkillMd(slug, opts));
}

/** A real studio/hooks/<id>/hook.yaml + script package. */
function writeHookPackage(root: string, id: string, on = 'PreToolUse'): void {
  const dir = join(root, 'studio', 'hooks', id);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'run.sh'), '#!/usr/bin/env bash\necho ok\n', 'utf8');
  writeFileSync(
    join(dir, 'hook.yaml'),
    yaml.dump({ id, name: id, description: `Test hook ${id}.`, on, script: 'scripts/run.sh', permissions: { env: [], read: [], network: false } }),
    'utf8',
  );
}

// ---------------------------------------------------------------------------
// The four REDIRECT-1-mandated real-entry-point ATs
// ---------------------------------------------------------------------------

test('forge studio lint: a real guard id ("event-log") under composition.hooks surfaces hook-library/guard-in-hooks', () => {
  let root: string | undefined;
  try {
    root = buildBaseRoot();
    const slug = 'agent-guard-in-hooks';
    writeAgent(root, slug, { guards: [], hooks: ['event-log'] });

    const result = runStudioLint(root);

    const hits = result.findings.filter(
      (f) => f.level === 'error' && f.object === `agent:${slug}` && f.check === 'hook-library/guard-in-hooks',
    );
    assert.strictEqual(
      hits.length,
      1,
      `expected exactly 1 agent:${slug} hook-library/guard-in-hooks error from the REAL forge studio lint entry point — got: ${JSON.stringify(result.findings)}`,
    );
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

test('forge studio lint: a real library hook id under composition.guards surfaces hook-library/hook-in-guards', () => {
  let root: string | undefined;
  try {
    root = buildBaseRoot();
    writeHookPackage(root, 'test-lib-hook');
    const slug = 'agent-hook-in-guards';
    writeAgent(root, slug, { guards: ['test-lib-hook'], hooks: [] });

    const result = runStudioLint(root);

    const hits = result.findings.filter(
      (f) => f.level === 'error' && f.object === `agent:${slug}` && f.check === 'hook-library/hook-in-guards',
    );
    assert.strictEqual(
      hits.length,
      1,
      `expected exactly 1 agent:${slug} hook-library/hook-in-guards error from the REAL forge studio lint entry point — got: ${JSON.stringify(result.findings)}`,
    );
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

test('forge studio lint: composition.hooks id resolving to neither a guard nor a real hook surfaces hook-library/unknown-hook-ref', () => {
  let root: string | undefined;
  try {
    root = buildBaseRoot();
    const slug = 'agent-unknown-hook';
    writeAgent(root, slug, { guards: [], hooks: ['totally-made-up-hook-id'] });

    const result = runStudioLint(root);

    const hits = result.findings.filter(
      (f) => f.level === 'error' && f.object === `agent:${slug}` && f.check === 'hook-library/unknown-hook-ref',
    );
    assert.strictEqual(
      hits.length,
      1,
      `expected exactly 1 agent:${slug} hook-library/unknown-hook-ref error from the REAL forge studio lint entry point — got: ${JSON.stringify(result.findings)}`,
    );
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

test('forge studio lint: a hook.yaml with an `on:` value outside the closed lifecycle-event set surfaces as a real error naming the hook', () => {
  let root: string | undefined;
  try {
    root = buildBaseRoot();
    writeHookPackage(root, 'bad-on-hook', 'NotARealEvent');

    const result = runStudioLint(root);

    const hits = result.findings.filter((f) => f.level === 'error' && f.object === 'hook:bad-on-hook');
    assert.strictEqual(
      hits.length,
      1,
      `expected exactly 1 error finding naming hook:bad-on-hook from the REAL forge studio lint entry point — got: ${JSON.stringify(result.findings)}`,
    );
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Sanity: the correctly-placed case produces NEITHER hook-library finding
// (guards against a false-positive that would make the above tests
// meaningless once implemented).
// ---------------------------------------------------------------------------

test('forge studio lint: a real guard under composition.guards + a real hook under composition.hooks produces neither hook-library finding for that agent', () => {
  let root: string | undefined;
  try {
    root = buildBaseRoot();
    writeHookPackage(root, 'well-placed-hook');
    const slug = 'agent-well-formed';
    writeAgent(root, slug, { guards: ['event-log'], hooks: ['well-placed-hook'] });

    const result = runStudioLint(root);

    const hookLibraryFindings = result.findings.filter(
      (f) => f.object === `agent:${slug}` && f.check.startsWith('hook-library/'),
    );
    assert.deepEqual(
      hookLibraryFindings,
      [],
      `expected zero hook-library/* findings for a correctly-composed agent — got: ${JSON.stringify(hookLibraryFindings)}`,
    );
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});
