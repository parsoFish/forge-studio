/**
 * Tests for the R3-05 instruction-seed library loader
 * (studio/instruction-seeds/<id>.md).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { listInstructionSeeds, loadInstructionSeed } from './registry.ts';
import { INSTRUCTION_SEED_KINDS, INSTRUCTION_SEED_SCOPES } from './types.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');

test('listInstructionSeeds loads the shipped OOTB corpus with valid frontmatter', () => {
  const seeds = listInstructionSeeds(FORGE_ROOT);
  assert.ok(seeds.length >= 4, `expected the seeded corpus, got ${seeds.length}`);
  const byId = Object.fromEntries(seeds.map((s) => [s.id, s]));
  // ≥1 seed per listed domain (R3-05-F2 acceptance).
  for (const id of ['typescript-node', 'go-terraform-provider', 'cli-project-shape', 'forge-managed-project']) {
    assert.ok(byId[id], `seed ${id} present`);
  }
  for (const s of seeds) {
    assert.ok(INSTRUCTION_SEED_KINDS.includes(s.kind), `${s.id} kind valid`);
    assert.ok(INSTRUCTION_SEED_SCOPES.includes(s.scope), `${s.id} scope valid`);
    assert.ok(s.appliesTo.length > 0, `${s.id} has ≥1 appliesTo tag`);
    assert.ok(s.title.length > 0, `${s.id} has a title`);
    assert.ok(s.body.length > 0, `${s.id} has a composable body`);
    // Corpus-grounding — every shipped seed cites a real artifact.
    assert.ok(s.provenance.trim().length > 0, `${s.id} cites provenance`);
  }
});

test('listInstructionSeeds is sorted by id and returns [] for an absent dir', () => {
  const seeds = listInstructionSeeds(FORGE_ROOT);
  const ids = seeds.map((s) => s.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a.localeCompare(b)), 'sorted by id');
  const empty = mkdtempSync(join(tmpdir(), 'no-seeds-'));
  assert.deepEqual(listInstructionSeeds(empty), [], 'absent dir tolerated');
  rmSync(empty, { recursive: true, force: true });
});

test('loadInstructionSeed parses frontmatter + body; throws on a bad enum / missing field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seed-'));
  const seedDir = join(dir, 'studio', 'instruction-seeds');
  mkdirSync(seedDir, { recursive: true });
  writeFileSync(
    join(seedDir, 'rust-lang.md'),
    '---\nid: rust-lang\ntitle: Rust conventions\nkind: language\nappliesTo: [rust]\nscope: project\nprovenance: "some-repo/AGENTS.md"\n---\n\n## Rust\n\nUse clippy.\n',
  );
  const seed = loadInstructionSeed(join(seedDir, 'rust-lang.md'));
  assert.equal(seed.id, 'rust-lang');
  assert.equal(seed.kind, 'language');
  assert.deepEqual(seed.appliesTo, ['rust']);
  assert.match(seed.body, /clippy/);

  // Bad `kind` enum → throws (lint surfaces it).
  writeFileSync(
    join(seedDir, 'bad-kind.md'),
    '---\nid: bad-kind\ntitle: X\nkind: not-a-kind\nappliesTo: [x]\nscope: project\nprovenance: p\n---\nbody',
  );
  assert.throws(() => loadInstructionSeed(join(seedDir, 'bad-kind.md')), /kind/);

  // Missing `provenance` → throws (mandatory, corpus-grounding).
  writeFileSync(
    join(seedDir, 'no-prov.md'),
    '---\nid: no-prov\ntitle: X\nkind: practice\nappliesTo: [x]\nscope: both\n---\nbody',
  );
  assert.throws(() => loadInstructionSeed(join(seedDir, 'no-prov.md')), /provenance/);

  rmSync(dir, { recursive: true, force: true });
});
