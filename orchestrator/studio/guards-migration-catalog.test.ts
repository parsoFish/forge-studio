/**
 * MIGRATION ACCEPTANCE TEST (must be RED on today's code) — B1-B3 of the
 * ADR-027-amendment-#2 `composition.hooks` → `composition.guards` rename,
 * targeting `studio/catalog.yaml` + `orchestrator/studio/registry.ts`'s
 * `loadCatalog` + `orchestrator/studio/validate.ts`'s `validateCatalog`.
 *
 * The 9 ids are unchanged (5 toggles, 4 bands — `BAND_GUARD_IDS`); what moves
 * is the section name (`hooks:` → `guards:`) and what's NEW is a DERIVED
 * `kind` (`band`/`toggle`) per entry — derived from `BAND_GUARD_IDS`, never
 * declared in the YAML (the anti-"declared-data-fails-open" point of B2).
 *
 * IDENTIFIER RENAME (2026-08-04, Job B): `agent-bands.ts`'s `BAND_HOOK_IDS`
 * is being renamed to `BAND_GUARD_IDS` to finish the vocabulary split — this
 * file's import is updated below, which now names an identifier that does
 * not exist in today's `agent-bands.ts` (B2's own RED signal, independent of
 * B1-B3's original field-migration subject, which is already landed).
 *
 * B1 reads the REAL on-disk `studio/catalog.yaml` (not a fixture) — today it
 * has a `hooks:` section, not `guards:`, so this is a direct, honest RED
 * against real repo data.
 *
 * B2/B3 build TEMP catalog.yaml fixtures (never touching the real file) and
 * call the REAL, unmigrated `loadCatalog`/`validateCatalog`. Neither function
 * reads a `guards` key at all today (`loadCatalog` only ever reads `d['hooks']`
 * into `.hooks`; `validateCatalog`'s duplicate-id sweep only lists
 * `['hooks', c.hooks]`), so a `Catalog.guards` field flows through as
 * `undefined` at runtime — read via an explicit
 * `as unknown as { guards?: Array<{ id: string; kind?: string }> }` cast
 * (the real `Catalog` type has no `guards` field yet; this repo's strict tsc
 * config type-checks `.test.ts` files too, so a raw `.guards` property access
 * would itself be a compile error).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadCatalog } from './registry.ts';
import { validateCatalog } from './validate.ts';
import { loadYaml } from './yaml-fields.ts';
import { BAND_GUARD_IDS } from '../agent-bands.ts';
import type { Catalog } from './types.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');
const REAL_CATALOG_PATH = resolve(FORGE_ROOT, 'studio', 'catalog.yaml');

const EXPECTED_GUARD_IDS = ['event-log', 'cost-guard', 'stall-watchdog', 'merge-gate', 'scratch-strip', 'wi-contract', 'reflection-close', 'demo-band', 'review-band'];

test('B1: studio/catalog.yaml has a guards: section with exactly the 9 known ids, and NO hooks: section (RED until migrated)', () => {
  const raw = loadYaml(REAL_CATALOG_PATH);
  const guards = raw['guards'];
  assert.ok(Array.isArray(guards), `expected studio/catalog.yaml to have a "guards:" array section — got: ${JSON.stringify(guards)}`);
  const ids = ((guards ?? []) as Array<{ id: string }>).map((e) => e.id).sort((a, b) => a.localeCompare(b));
  assert.deepEqual(ids, [...EXPECTED_GUARD_IDS].sort((a, b) => a.localeCompare(b)));
  assert.equal(raw['hooks'], undefined, 'expected NO "hooks:" section to remain in studio/catalog.yaml');
});

/** A temp catalog.yaml with a `guards:` section (9 real ids) and no `hooks:`
 * section — one entry (`wi-contract`, a real band id) is given a DELIBERATELY
 * WRONG `kind: toggle` in the file, to prove B2's derivation overrides
 * declared data rather than trusting it. */
function writeGuardsCatalogFixture(dir: string): string {
  const path = join(dir, 'catalog.yaml');
  const lines = [
    'sdks:',
    '  - { id: claude, name: Claude Agent SDK, available: true }',
    'models:',
    '  - { id: claude-sonnet-4-6, name: Claude Sonnet 4.6, sdk: claude, tier: sonnet }',
    'tools: []',
    'mcps: []',
    'guards:',
    '  - { id: event-log, name: JSONL event log, desc: Structured events on every invocation. }',
    '  - { id: cost-guard, name: Cost guard, desc: Per-cycle USD budget enforcement. }',
    '  - { id: stall-watchdog, name: Stall watchdog, desc: Heartbeat liveness monitoring. }',
    '  - { id: merge-gate, name: Merge gate, desc: Dependent WIs wait on prerequisite merge. }',
    '  - { id: scratch-strip, name: Scratch strip, desc: Base-guard strips scratch files pre-PR. }',
    // Deliberately WRONG kind — a real band id declared as a toggle. B2 must
    // prove the derivation from BAND_GUARD_IDS overrides this, not trust it.
    '  - { id: wi-contract, name: WI contract band, desc: "Plan-agent band.", kind: toggle }',
    '  - { id: reflection-close, name: Reflection close band, desc: "Reflect-agent band." }',
    '  - { id: demo-band, name: Demo band, desc: "Demo-agent band." }',
    '  - { id: review-band, name: Review band, desc: "Adversarial-review band." }',
  ];
  writeFileSync(path, lines.join('\n') + '\n');
  return path;
}

test('B2: loadCatalog surfaces guards with a DERIVED kind (band for BAND_GUARD_IDS, toggle otherwise), overriding a wrong declared kind (RED until the Job B rename lands)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guards-migration-catalog-'));
  try {
    const catalogPath = writeGuardsCatalogFixture(dir);
    const catalog = loadCatalog(catalogPath);
    const guards = (catalog as unknown as { guards?: Array<{ id: string; kind?: string }> }).guards;
    assert.ok(guards, `expected loadCatalog to surface a .guards array — got: ${JSON.stringify(catalog)}`);

    const bandIds = new Set<string>(BAND_GUARD_IDS as readonly string[]);
    for (const entry of guards!) {
      const expectedKind = bandIds.has(entry.id) ? 'band' : 'toggle';
      assert.equal(
        entry.kind,
        expectedKind,
        `expected guard "${entry.id}" to have DERIVED kind "${expectedKind}" (got "${entry.kind}") — the declared kind in the fixture ("wi-contract": toggle) must never win`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B3: the catalog duplicate-id validation covers the guards section (RED until migrated)', () => {
  const base: Catalog = {
    sdks: [{ id: 'claude', name: 'Claude', available: true }],
    models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', sdk: 'claude', tier: 'sonnet' }],
    tools: [],
    mcps: [],
    guards: [],
    path: '/studio/catalog.yaml',
  };
  const fixture = {
    ...base,
    guards: [
      { id: 'event-log', name: 'JSONL event log', kind: 'toggle' },
      { id: 'event-log', name: 'Duplicate event log', kind: 'toggle' },
    ],
  } as unknown as Catalog;

  const findings = validateCatalog(fixture);
  const dupFinding = findings.find((f) => f.check === 'unique-ids' && f.message.includes('catalog.guards'));
  assert.ok(
    dupFinding,
    `expected a unique-ids finding naming "catalog.guards" for the duplicate "event-log" id — got: ${JSON.stringify(findings)}`,
  );
});
