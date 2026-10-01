/**
 * §7.3 release-definition gap — "cost-per-merged-initiative by class".
 * Unit tests for `costByClass` (`packages/flows/cost-by-class.ts`) against a
 * fixture forge root: three priced `_queue/done/` manifests (two `code`, one
 * `docs`) and a fourth `code` manifest with no resolvable cycle log — proving
 * the per-class totals, the priced-only mean, and the `unpriced` count never
 * folding into `totalUsd` as a silent $0.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { costByClass } from '../../cost-by-class.ts';

function writeManifest(forgeRoot: string, id: string, cls: string | null, cycleId: string | null): void {
  const dir = join(forgeRoot, '_queue', 'done');
  mkdirSync(dir, { recursive: true });
  const frontmatter = [
    '---',
    `initiative_id: ${id}`,
    'project: fixture-project',
    "created_at: '2026-01-01T00:00:00.000Z'",
    ...(cls !== null ? [`class: ${cls}`] : []),
    ...(cycleId !== null ? [`cycle_id: ${cycleId}`] : []),
    '---',
    '',
    '## Goal',
    'Fixture.',
    '',
  ].join('\n');
  writeFileSync(join(dir, `${id}.md`), frontmatter);
}

function writeCostEvents(forgeRoot: string, cycleId: string, costs: number[]): void {
  const dir = join(forgeRoot, '_logs', cycleId);
  mkdirSync(dir, { recursive: true });
  const lines = costs.map((cost, i) =>
    JSON.stringify({
      event_id: `${cycleId}-e${i}`,
      cycle_id: cycleId,
      initiative_id: cycleId,
      phase: 'developer-loop',
      skill: 'dev',
      event_type: 'end',
      input_refs: [],
      output_refs: [],
      cost_usd: cost,
      started_at: '2026-01-01T00:00:00.000Z',
    }),
  );
  writeFileSync(join(dir, 'events.jsonl'), lines.join('\n') + '\n');
}

function setup(): string {
  return mkdtempSync(join(tmpdir(), 'cost-by-class-'));
}

test('costByClass: sums per-class totals from the authoritative cost rule, means over priced initiatives only, never drops the unpriced one', () => {
  const forgeRoot = setup();
  try {
    writeManifest(forgeRoot, 'INIT-code-a', 'code', 'cyc-code-a');
    writeCostEvents(forgeRoot, 'cyc-code-a', [2]);

    writeManifest(forgeRoot, 'INIT-code-b', 'code', 'cyc-code-b');
    writeCostEvents(forgeRoot, 'cyc-code-b', [1, 2]);

    writeManifest(forgeRoot, 'INIT-docs-a', 'docs', 'cyc-docs-a');
    writeCostEvents(forgeRoot, 'cyc-docs-a', [5]);

    // Fourth manifest: class "code" but no resolvable cost — no events.jsonl
    // ever written for this cycle id.
    writeManifest(forgeRoot, 'INIT-code-nolog', 'code', 'cyc-code-nolog');

    const rows = costByClass(forgeRoot);

    const code = rows.find((r) => r.class === 'code');
    assert.ok(code, 'expected a "code" row');
    assert.equal(code!.merged, 3, 'three code manifests in done/');
    assert.equal(code!.totalUsd, 5, 'priced code total: 2 + (1+2) = 5, excluding the unpriced one');
    assert.equal(code!.unpriced, 1, 'the no-log manifest counts as unpriced');
    assert.equal(code!.meanUsd, 2.5, 'mean over the TWO priced code initiatives only: 5 / 2');

    const docs = rows.find((r) => r.class === 'docs');
    assert.ok(docs, 'expected a "docs" row');
    assert.equal(docs!.merged, 1);
    assert.equal(docs!.totalUsd, 5);
    assert.equal(docs!.unpriced, 0);
    assert.equal(docs!.meanUsd, 5);

    assert.ok(!rows.some((r) => r.class === 'config'), 'no config manifests in the fixture — no row emitted');
    assert.ok(!rows.some((r) => r.class === 'infra'), 'no infra manifests in the fixture — no row emitted');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('costByClass: a manifest with no "class" frontmatter counts under "unclassified", never dropped — the real-world shape of every pre-ADR-051 manifest', () => {
  const forgeRoot = setup();
  try {
    writeManifest(forgeRoot, 'INIT-legacy', null, 'cyc-legacy');
    writeCostEvents(forgeRoot, 'cyc-legacy', [4]);

    const rows = costByClass(forgeRoot);
    const unclassified = rows.find((r) => r.class === 'unclassified');
    assert.ok(unclassified, 'expected an "unclassified" row for the classless legacy manifest');
    assert.equal(unclassified!.merged, 1);
    assert.equal(unclassified!.totalUsd, 4);
    assert.equal(unclassified!.unpriced, 0);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('costByClass: a manifest with no cycle_id at all counts as unpriced, never as a fabricated $0', () => {
  const forgeRoot = setup();
  try {
    writeManifest(forgeRoot, 'INIT-no-cycle', 'config', null);

    const rows = costByClass(forgeRoot);
    const config = rows.find((r) => r.class === 'config');
    assert.ok(config, 'expected a "config" row');
    assert.equal(config!.merged, 1);
    assert.equal(config!.totalUsd, 0);
    assert.equal(config!.unpriced, 1);
    assert.equal(config!.meanUsd, 0, 'every initiative in the class is unpriced — mean is 0, not NaN or a fabricated figure');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('costByClass: no _queue/done/ directory at all → empty array, not a throw', () => {
  const forgeRoot = setup();
  try {
    const rows = costByClass(forgeRoot);
    assert.deepEqual(rows, []);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
