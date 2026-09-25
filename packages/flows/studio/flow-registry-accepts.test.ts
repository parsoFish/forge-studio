/**
 * Seam F6 half 1 (ADR 051 decision 4, spec §5 item 8, bead forge-8vfn.6.10.15):
 * "a flow registers its accepted classes" — `loadFlowDefinition`'s own
 * validation of the new required `accepts` field.
 *
 * Colocated with `flow-registry.ts` (mirrors `validate-flow.test.ts`'s own
 * placement convention in this same directory).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadFlowDefinition, serializeFlowDefinition } from './flow-registry.ts';

function tmpFlow(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'flow-accepts-'));
  const flowDir = join(dir, 'studio', 'flows', 'my-flow');
  mkdirSync(flowDir, { recursive: true });
  const path = join(flowDir, 'flow.yaml');
  writeFileSync(path, yaml);
  return path;
}

const BASE = [
  'id: my-flow',
  'name: My Flow',
  'version: 1',
  'goal: g',
  'project: null',
  'kb: null',
  'costCeilingUsd: 5',
  'origin: seed',
  'nodes:',
  '  - { id: n, gate: human }',
  'edges: []',
  'triggers: []',
  '',
].join('\n');

test('loadFlowDefinition: a flow.yaml with no "accepts" field fails to load, naming the flow', () => {
  const path = tmpFlow(BASE); // no accepts: line at all
  assert.throws(
    () => loadFlowDefinition(path),
    (err: Error) => {
      assert.match(err.message, /my-flow/, 'names the flow');
      assert.match(err.message, /accepts/, 'names the missing field');
      return true;
    },
  );
});

test('loadFlowDefinition: "accepts: []" (present but empty) also fails to load', () => {
  const path = tmpFlow(BASE.replace('origin: seed\n', 'origin: seed\naccepts: []\n'));
  assert.throws(() => loadFlowDefinition(path), /non-empty/);
});

test('loadFlowDefinition: an unknown class inside "accepts" fails to load, naming the flow and the bad value', () => {
  const path = tmpFlow(BASE.replace('origin: seed\n', "origin: seed\naccepts: [code, sausages]\n"));
  assert.throws(
    () => loadFlowDefinition(path),
    (err: Error) => {
      assert.match(err.message, /my-flow/, 'names the flow');
      assert.match(err.message, /"sausages"/, 'names the offending value');
      assert.match(err.message, /code \| docs \| config \| infra/, 'names the valid set');
      return true;
    },
  );
});

test('loadFlowDefinition: a valid "accepts" list loads verbatim, in declared order', () => {
  const path = tmpFlow(BASE.replace('origin: seed\n', 'origin: seed\naccepts: [docs, code]\n'));
  const flow = loadFlowDefinition(path);
  assert.deepEqual(flow.accepts, ['docs', 'code']);
});

test('serializeFlowDefinition: round-trips "accepts"', () => {
  const path = tmpFlow(BASE.replace('origin: seed\n', 'origin: seed\naccepts: [config, infra]\n'));
  const flow = loadFlowDefinition(path);
  const yaml = serializeFlowDefinition(flow);
  assert.match(yaml, /accepts:\s*\n?\s*-?\s*(config)/, 'the serialized yaml carries accepts');
  // Round-trip through the loader again to prove it is not merely present but re-loadable.
  const dir = mkdtempSync(join(tmpdir(), 'flow-accepts-rt-'));
  const flowDir = join(dir, 'studio', 'flows', 'my-flow');
  mkdirSync(flowDir, { recursive: true });
  const p2 = join(flowDir, 'flow.yaml');
  writeFileSync(p2, yaml);
  const reloaded = loadFlowDefinition(p2);
  assert.deepEqual(reloaded.accepts, ['config', 'infra']);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Seam F6 half 2 (operator ruling 97): the optional `review.lenses` field.
// ---------------------------------------------------------------------------

test('loadFlowDefinition: no "review" key -> flow.review is absent (unchanged behaviour)', () => {
  const path = tmpFlow(BASE.replace('origin: seed\n', 'origin: seed\naccepts: [code]\n'));
  const flow = loadFlowDefinition(path);
  assert.equal(flow.review, undefined);
});

test('loadFlowDefinition: "review: { lenses: [] }" (empty) is a validation error', () => {
  const path = tmpFlow(
    BASE.replace('origin: seed\n', 'origin: seed\naccepts: [code]\nreview:\n  lenses: []\n'),
  );
  assert.throws(
    () => loadFlowDefinition(path),
    (err: Error) => {
      assert.match(err.message, /my-flow/);
      assert.match(err.message, /review\.lenses/);
      assert.match(err.message, /non-empty/);
      return true;
    },
  );
});

test('loadFlowDefinition: "review: { lenses: [correctness] }" loads verbatim', () => {
  const path = tmpFlow(
    BASE.replace('origin: seed\n', 'origin: seed\naccepts: [code]\nreview:\n  lenses: [correctness]\n'),
  );
  const flow = loadFlowDefinition(path);
  assert.deepEqual(flow.review, { lenses: ['correctness'] });
});

test('serializeFlowDefinition: round-trips "review.lenses"', () => {
  const path = tmpFlow(
    BASE.replace('origin: seed\n', 'origin: seed\naccepts: [code]\nreview:\n  lenses: [correctness, boundary]\n'),
  );
  const flow = loadFlowDefinition(path);
  const yaml = serializeFlowDefinition(flow);
  const dir = mkdtempSync(join(tmpdir(), 'flow-review-rt-'));
  const flowDir = join(dir, 'studio', 'flows', 'my-flow');
  mkdirSync(flowDir, { recursive: true });
  const p2 = join(flowDir, 'flow.yaml');
  writeFileSync(p2, yaml);
  const reloaded = loadFlowDefinition(p2);
  assert.deepEqual(reloaded.review, { lenses: ['correctness', 'boundary'] });
  rmSync(dir, { recursive: true, force: true });
});
