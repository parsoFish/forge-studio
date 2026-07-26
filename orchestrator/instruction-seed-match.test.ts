/**
 * Tests for R3-05-F3 instruction-seed matching (detect project tags, match
 * seeds, render the prompt section, composed-seeds footer).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectProjectTags,
  matchInstructionSeeds,
  renderSeedPromptSection,
  composedSeedsFooter,
  stripComposedSeedsFooter,
} from './instruction-seed-match.ts';
import type { InstructionSeed } from './studio/types.ts';

function seed(over: Partial<InstructionSeed>): InstructionSeed {
  return {
    id: 'x', title: 'X', kind: 'language', appliesTo: ['typescript'],
    scope: 'project', provenance: 'p', body: 'body', path: '/x.md', ...over,
  };
}

test('detectProjectTags: a TypeScript CLI repo → typescript/node/javascript/cli/forge-managed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'proj-ts-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ bin: { mytool: 'dist/cli.js' }, devDependencies: { typescript: '^5' } }));
  writeFileSync(join(dir, 'tsconfig.json'), '{}');
  const tags = detectProjectTags(dir);
  for (const t of ['typescript', 'node', 'javascript', 'cli', 'forge-managed']) {
    assert.ok(tags.includes(t), `expected tag ${t}, got ${tags.join(',')}`);
  }
  rmSync(dir, { recursive: true, force: true });
});

test('detectProjectTags: a Go terraform-provider repo → go/terraform/terraform-provider', () => {
  const dir = mkdtempSync(join(tmpdir(), 'terraform-provider-demo-'));
  writeFileSync(join(dir, 'go.mod'), 'module github.com/x/terraform-provider-demo\n\nrequire github.com/hashicorp/terraform-plugin-sdk/v2 v2.0.0\n');
  const tags = detectProjectTags(dir);
  for (const t of ['go', 'terraform', 'terraform-provider', 'forge-managed']) {
    assert.ok(tags.includes(t), `expected ${t}, got ${tags.join(',')}`);
  }
  rmSync(dir, { recursive: true, force: true });
});

test('detectProjectTags: an empty repo → just forge-managed (never fabricates)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'proj-empty-'));
  assert.deepEqual(detectProjectTags(dir), ['forge-managed']);
  rmSync(dir, { recursive: true, force: true });
});

test('matchInstructionSeeds: intersects appliesTo, honours project/both scope, sorts by id', () => {
  const seeds = [
    seed({ id: 'ts', appliesTo: ['typescript'], scope: 'both' }),
    seed({ id: 'go', appliesTo: ['go'], scope: 'project' }),
    seed({ id: 'agent-only', appliesTo: ['typescript'], scope: 'agent' }),
    seed({ id: 'cli', appliesTo: ['cli'], scope: 'project' }),
  ];
  const matched = matchInstructionSeeds(seeds, ['typescript', 'cli']);
  assert.deepEqual(matched.map((s) => s.id), ['cli', 'ts'], 'go excluded (no tag), agent-only excluded (scope)');
});

test('matchInstructionSeeds: no tag intersection → [] (from-scratch fallback)', () => {
  const seeds = [seed({ id: 'go', appliesTo: ['go'], scope: 'project' })];
  assert.deepEqual(matchInstructionSeeds(seeds, ['python']), []);
});

test('renderSeedPromptSection: empty match → empty string; non-empty → a compose-from section listing ids + bodies', () => {
  assert.equal(renderSeedPromptSection([]), '');
  const section = renderSeedPromptSection([seed({ id: 'ts-node', title: 'TS', body: 'Use tsc.' })]);
  assert.match(section, /Matching instruction seeds/);
  assert.match(section, /seed: ts-node/);
  assert.match(section, /Use tsc\./);
  assert.match(section, /composed_seed_ids/);
});

test('composedSeedsFooter: dedups + sorts; empty → empty string', () => {
  assert.equal(composedSeedsFooter([]), '');
  assert.equal(composedSeedsFooter(['', '  ']), '', 'blank ids dropped');
  const footer = composedSeedsFooter(['cli-project-shape', 'typescript-node', 'typescript-node']);
  assert.match(footer, /forge:composed-instruction-seeds: cli-project-shape, typescript-node/);
});

test('stripComposedSeedsFooter: removes a trailing footer, idempotent, leaves footer-less bodies alone', () => {
  const body = '# AGENTS\n\nBuild: `npm run build`.';
  const withFooter = `${body}\n\n<!-- forge:composed-instruction-seeds: cli-project-shape, typescript-node -->\n`;
  assert.equal(stripComposedSeedsFooter(withFooter).trim(), body);
  assert.equal(stripComposedSeedsFooter(body), body, 'no footer → unchanged');
  // Re-strip is idempotent.
  assert.equal(stripComposedSeedsFooter(stripComposedSeedsFooter(withFooter)).trim(), body);
});
