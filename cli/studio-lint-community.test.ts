/**
 * REAL-ENTRY-POINT acceptance test for R3-07's `lintCommunityIndex` — driven
 * through the ACTUAL `forge studio lint` entry point (`runStudioLint`,
 * `cli/studio-lint.ts`), not a hand-rolled/direct call to
 * `lintCommunityIndex` (that direct-call coverage lives in
 * `orchestrator/studio/community-index.test.ts`).
 *
 * WHY THIS FILE EXISTS (T2 round 2, MANDATORY M2): "this exact hole — a lint
 * implemented, unit-tested, and inert because the production caller never
 * invokes it — has appeared FOUR times in this campaign (R3-03 PR1's
 * `composition/guard-unknown`, PR2's symmetric lint, PR2's PUT-time hook id,
 * R3-04's `opts.pathEnv`)." A lint that lints nothing passes its own unit
 * tests perfectly. This file drives `runStudioLint(root)` itself and asserts
 * the collision finding appears in the REAL aggregate output — pinning that
 * the implementer must wire `lintCommunityIndex` INTO `runStudioLint`,
 * however they choose to do it (the wiring shape is the implementer's call;
 * only the observable behaviour — a real finding from the real entry point
 * — is pinned here).
 *
 * Co-located in cli/ (not orchestrator/studio/), mirroring
 * `cli/studio-lint-hooks.test.ts`'s own stated reason: both need the entry
 * point directly. Fixture conventions (`tmpRoot`, `seedValidProject`,
 * `buildBaseRoot`) are copied from `cli/studio-lint-hooks.test.ts` rather
 * than reinvented.
 *
 * RED today for the same compounding reason as that file's own header:
 * `community-index.ts` does not exist, so `lintCommunityIndex` cannot be
 * wired into `runStudioLint` at all yet — the assertion below reads 0
 * matching findings today (nothing to find in the current, unwired lint
 * output).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';

import { runStudioLint } from './studio-lint.ts';

// ---------------------------------------------------------------------------
// Fixture helpers — copied conventions, not reinvented (see file header).
// ---------------------------------------------------------------------------

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'studio-lint-community-'));
}

function seedValidProject(root: string, id = 'my-project'): void {
  const forgeDir = join(root, 'projects', id, '.forge');
  mkdirSync(forgeDir, { recursive: true });
  writeFileSync(join(forgeDir, 'project.json'), JSON.stringify({ name: id }), 'utf8');
}

/** A base root with everything runStudioLint needs to lint clean EXCEPT the
 *  community fixtures the caller adds afterwards — mirrors
 *  cli/studio-lint-hooks.test.ts's `buildBaseRoot`. W6-CR-1: community
 *  skills live in studio/community/registry.yaml, not catalog.yaml. */
function buildBaseRoot(): string {
  const root = tmpRoot();
  mkdirSync(join(root, 'skills'), { recursive: true }); // runStudioLint errors if skills/ is missing entirely
  mkdirSync(join(root, 'studio', 'flows'), { recursive: true });
  writeFileSync(
    join(root, 'studio', 'catalog.yaml'),
    `sdks:
  - { id: claude-agent-sdk, name: Claude Agent SDK, available: true }
models:
  - { id: claude-sonnet-4-6, name: Sonnet 4.6, sdk: claude-agent-sdk, tier: standard }
tools: []
mcps: []
guards: []
`,
    'utf8',
  );
  mkdirSync(join(root, 'studio', 'community'), { recursive: true });
  writeFileSync(
    join(root, 'studio', 'community', 'registry.yaml'),
    `meta:
  schemaVersion: 2
  lastRefresh: null
sources: {}
items:
  - id: colliding-community-skill
    kind: skill
    name: Colliding
    provenance: "Test Author"
    sourceUrl: "https://example.com/colliding"
    category: testing
    desc: "A community skill whose id a vendored package also claims."
    signals: { attributedTo: "Test Author" }
`,
    'utf8',
  );
  seedValidProject(root);
  return root;
}

/** A vendored skill package under studio/community/skills/<id>/SKILL.md —
 *  same shape community-index.test.ts's own vendorSkillPackage helper uses. */
function vendorSkillPackage(root: string, id: string): void {
  const dir = join(root, 'studio', 'community', 'skills', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), matter.stringify('\nBody.\n', { name: id, description: `${id} desc`, library: true }), 'utf8');
}

// ---------------------------------------------------------------------------
// The M2-mandated real-entry-point AT
// ---------------------------------------------------------------------------

test('forge studio lint: a vendored skill id colliding with a catalog community-skills id surfaces a real finding from runStudioLint, the ACTUAL entry point', () => {
  let root: string | undefined;
  try {
    root = buildBaseRoot();
    vendorSkillPackage(root, 'colliding-community-skill'); // same id as the catalog community-skills entry above

    const result = runStudioLint(root);

    const hits = result.findings.filter((f) => f.level === 'error' && /colliding-community-skill/.test(f.message) && /collid/i.test(f.message));
    assert.strictEqual(
      hits.length,
      1,
      `expected exactly 1 collision finding naming "colliding-community-skill" from the REAL forge studio lint entry point (runStudioLint) — got findings: ${JSON.stringify(result.findings)}`,
    );
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

test('forge studio lint: NO collision → no finding (sanity: the wiring does not fire on a clean fixture)', () => {
  let root: string | undefined;
  try {
    root = buildBaseRoot();
    vendorSkillPackage(root, 'a-non-colliding-vendored-skill');

    const result = runStudioLint(root);

    const hits = result.findings.filter((f) => /collid/i.test(f.message));
    assert.strictEqual(hits.length, 0, `expected zero collision findings on a clean fixture — got: ${JSON.stringify(hits)}`);
  } finally {
    if (root) rmSync(root, { recursive: true, force: true });
  }
});
