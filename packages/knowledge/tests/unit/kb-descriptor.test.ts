/**
 * R1-06 WI-1 group A — descriptor contract + usage-default band-vocab pins.
 *
 * Sibling to registry.test.ts (already 1767 lines) rather than an addition
 * there. Targets orchestrator/studio/kb-descriptor.ts directly — the real
 * module; registry.ts only re-exports it. Harness mirrors registry.test.ts:
 * node:test + node:assert/strict with mkdtempSync fixtures.
 *
 * Pins (RED today):
 *   1. loadKbDescriptor preserves an optional `band` on a `flow` binding.
 *   2. serializeKbDescriptor emits `band`; a write->load round-trip
 *      preserves it.
 *   3. loadKbDescriptor REJECTS `band` on `project`/`unique` bindings with a
 *      named/typed error (band is only meaningful off a flow binding).
 *   4. deriveKbUsageDefaults maps `band: review-band` -> readers including
 *      'reviewer'; a different band (demo-band) keeps the plain
 *      planner+reflector default — review-band is the ONLY mapped band
 *      (T1 ruling Q2).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadKbDescriptor, serializeKbDescriptor, deriveKbUsageDefaults } from '../../studio/kb-descriptor.ts';
import type { KbDescriptor } from '@forge/contracts/studio/types.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'forge-kb-descriptor-'));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(name: string, content: string): string {
  const p = join(tmpDir, name);
  writeFileSync(p, content, 'utf8');
  return p;
}

// ---------------------------------------------------------------------------
// (1) loadKbDescriptor preserves `band` on a flow binding
// ---------------------------------------------------------------------------

describe('loadKbDescriptor — band on flow binding (R1-06 WI-1)', () => {
  it('preserves binding.band through the real parse path (RED: parseKbBinding drops band today)', () => {
    const src = `id: cycles
name: Cycle Patterns
binding: { kind: flow, ref: forge-develop, band: review-band }
desc: Accumulated cross-cycle patterns and retros.
`;
    const p = writeFixture('kb-band-flow.yaml', src);

    // Fixture precondition: the raw file really does carry `band` before we
    // trust anything read back from the parsed verdict.
    const raw = readFileSync(p, 'utf8');
    assert.match(raw, /band:\s*review-band/, `fixture must declare band — got:\n${raw}`);

    const kb = loadKbDescriptor(p);
    assert.deepEqual(kb.binding, { kind: 'flow', ref: 'forge-develop', band: 'review-band' });
  });
});

// ---------------------------------------------------------------------------
// (2) serializeKbDescriptor emits `band`; write->load round-trip preserves it
// ---------------------------------------------------------------------------

describe('serializeKbDescriptor — band on flow binding (R1-06 WI-1)', () => {
  it('emits binding.band in the written yaml, and a write->load round-trip preserves it (RED: serializer never emits band today)', () => {
    const kb = {
      id: 'cycles',
      name: 'Cycle Patterns',
      binding: { kind: 'flow' as const, ref: 'forge-develop', band: 'review-band' },
      desc: 'Accumulated cross-cycle patterns and retros.',
      path: '/unused',
    } as unknown as KbDescriptor;

    const yamlStr = serializeKbDescriptor(kb);
    // Assert the mutation (the serialized text) directly before trusting any
    // downstream round-trip verdict built on top of it.
    assert.match(
      yamlStr,
      /band:\s*review-band/,
      `serialized kb.yaml text must include the band — got:\n${yamlStr}`,
    );

    const p = writeFixture('kb-band-rt.yaml', yamlStr);
    const reloaded = loadKbDescriptor(p);
    assert.deepEqual(reloaded.binding, { kind: 'flow', ref: 'forge-develop', band: 'review-band' });
  });
});

// ---------------------------------------------------------------------------
// (3) loadKbDescriptor REJECTS `band` off a flow binding
// ---------------------------------------------------------------------------

describe('loadKbDescriptor — band rejected off a flow binding (R1-06 WI-1)', () => {
  it('throws a named/typed error when band is set on a project binding (RED: silently ignored today)', () => {
    const src = `id: gitpulse
name: Gitpulse Patterns
binding: { kind: project, ref: gitpulse, band: review-band }
desc: Project-scoped patterns.
`;
    const p = writeFixture('kb-band-project-reject.yaml', src);
    const raw = readFileSync(p, 'utf8');
    assert.match(raw, /band:\s*review-band/, `fixture must declare band — got:\n${raw}`);

    assert.throws(
      () => loadKbDescriptor(p),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'must throw a real Error (typed/named), not a bare value');
        assert.ok(
          err.message.includes('band') && err.message.includes('project'),
          `expected a band/project-scoped error message, got: ${(err as Error).message}`,
        );
        return true;
      },
    );
  });

  it('throws a named/typed error when band is set on a unique binding (RED: silently ignored today)', () => {
    const src = `id: forge-dev
name: Forge Dev
binding: { kind: unique, band: review-band }
desc: Forge engineering knowledge.
`;
    const p = writeFixture('kb-band-unique-reject.yaml', src);
    const raw = readFileSync(p, 'utf8');
    assert.match(raw, /band:\s*review-band/, `fixture must declare band — got:\n${raw}`);

    assert.throws(
      () => loadKbDescriptor(p),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'must throw a real Error (typed/named), not a bare value');
        assert.ok(
          err.message.includes('band') && err.message.includes('unique'),
          `expected a band/unique-scoped error message, got: ${(err as Error).message}`,
        );
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// (4) deriveKbUsageDefaults — band vocabulary mapping (T1 ruling Q2)
// ---------------------------------------------------------------------------

describe('deriveKbUsageDefaults — band vocabulary mapping (R1-06 WI-1, T1 ruling Q2)', () => {
  it("review-band binding's readers include 'reviewer' (RED: readers is planner+reflector for every non-project binding today)", () => {
    const binding = { kind: 'flow' as const, ref: 'forge-develop', band: 'review-band' };
    const usage = deriveKbUsageDefaults(binding);
    assert.ok(
      usage.readers.includes('reviewer'),
      `expected readers to include 'reviewer' for a review-band binding — got ${JSON.stringify(usage.readers)}`,
    );
  });

  it("[companion, paired with the review-band RED pin above] a different band (demo-band) keeps exactly ['planner','reflector'] — review-band is the ONLY mapped band (T1 ruling Q2)", () => {
    const binding = { kind: 'flow' as const, ref: 'forge-develop', band: 'demo-band' };
    const usage = deriveKbUsageDefaults(binding);
    assert.deepEqual(usage.readers, ['planner', 'reflector']);
  });
});
