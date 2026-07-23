/**
 * R1-01-F4: the asymmetric brain-read policy (ADR-010 as amended) is UNCHANGED
 * by the KB binding rework. Rebinding `cycles` from `scope: flow` to
 * `binding: { kind: flow, ref: forge-develop }` is a descriptor-only change; it
 * must not alter *who reads the brain*. This guards the invariant at the source
 * level — the "lint assertion" alternative the R1-01-F4 acceptance criterion
 * allows: planners (PM + reflector) read the brain navigation surface; the
 * dev-loop and the reviewer/unifier do not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (f: string): string => readFileSync(resolve(__dirname, f), 'utf8');
const READS_BRAIN_NAV = /loadBrainIndex|loadBrainNavigation/;

test('R1-01-F4: planners (PM, reflector) still read the brain navigation surface post-rebind', () => {
  assert.match(src('pm-invocation.ts'), READS_BRAIN_NAV, 'PM must still load the brain navigation');
  assert.match(src('reflector-invocation.ts'), READS_BRAIN_NAV, 'reflector must still load the brain navigation');
});

test('R1-01-F4: dev-loop and reviewer/unifier do NOT read the forge brain (policy unchanged by the rebind)', () => {
  assert.doesNotMatch(src('dev-invocation.ts'), READS_BRAIN_NAV, 'dev-loop must not read the forge brain');
  assert.doesNotMatch(src('unifier-invocation.ts'), READS_BRAIN_NAV, 'reviewer/unifier must not read the forge brain');
});
