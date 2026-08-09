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
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadKbDescriptor, resolveKbProcesses } from './studio/registry.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (f: string): string => readFileSync(resolve(__dirname, f), 'utf8');
const READS_BRAIN_NAV = /loadBrainIndex|loadBrainNavigation/;

test('R1-01-F4: planners (PM, reflector) still read the brain navigation surface post-rebind', () => {
  assert.match(src('phases/pm-binding.ts'), READS_BRAIN_NAV, 'PM must still load the brain navigation');
  assert.match(src('phases/reflector-binding.ts'), READS_BRAIN_NAV, 'reflector must still load the brain navigation');
});

test('R1-01-F4: dev-loop and the reviewer do NOT read the forge brain (policy unchanged by the rebind)', () => {
  assert.doesNotMatch(src('phases/dev-binding.ts'), READS_BRAIN_NAV, 'dev-loop must not read the forge brain');
  assert.doesNotMatch(src('phases/adversarial-review.ts'), READS_BRAIN_NAV, 'the reviewer must not read the forge brain');
});

// ---------------------------------------------------------------------------
// R1-06 WI-1 group B (4): the asymmetric brain-read policy extends past the
// 4 phase-binding source files above to KB DESCRIPTORS. A flow-bound KB's
// resolved usage.readers may grant 'reviewer' ONLY when the binding is
// scoped to the review band (T1 ruling: the band-role map is ONLY
// review-band -> reviewer), AND ADR-010 must carry the amendment recording
// that scoped exception. The marker text T1 will add to
// docs/decisions/010-brain-first.md when landing the amendment:
//
//   "R1-06 band-scoped reviewer grant"
//
// Today NONE of this is enforced: `KbBinding` (orchestrator/studio/types.ts)
// has no `band` field at all, `parseKbBinding`
// (orchestrator/studio/kb-descriptor.ts) silently drops any `band` key
// present in kb.yaml, and ADR-010 does not yet carry the marker — so a
// banded, marker-backed grant is INDISTINGUISHABLE, once loaded through the
// real production loader, from a bandless one. Unlike the 4-file source grep
// above, this guard must walk every real `brain/*/kb.yaml` AND
// `brain/projects/*/kb.yaml` (both directory shapes) — the two fixtures
// below are planted at each shape to prove that.
// ---------------------------------------------------------------------------

const ADR_010_PATH = resolve(__dirname, '../docs/decisions/010-brain-first.md');
const R1_06_AMENDMENT_MARKER = 'R1-06 band-scoped reviewer grant';

/** Has ADR-010 landed the R1-06 amendment marker yet? (T1 lands the text — not this file.) */
function adr010HasR106Marker(): boolean {
  return readFileSync(ADR_010_PATH, 'utf8').includes(R1_06_AMENDMENT_MARKER);
}

/**
 * T1 ruling: the band-role map is ONLY review-band -> reviewer. A KB whose
 * resolved usage.readers grants 'reviewer' must be a flow binding scoped to
 * band:'review-band', AND ADR-010 must carry the amendment marker. Loads the
 * descriptor through the REAL production `loadKbDescriptor` +
 * `resolveKbProcesses` (orchestrator/studio/registry.ts) — not a hand-rolled
 * parse — so this genuinely exercises the loader's (missing) band support.
 */
function reviewerGrantIsBandScoped(kbYamlPath: string): boolean {
  const kb = loadKbDescriptor(kbYamlPath);
  const usage = resolveKbProcesses(kb).usage;
  if (!usage.readers.includes('reviewer')) return true; // no grant, nothing to scope
  const band = kb.binding.kind === 'flow' ? (kb.binding as { band?: string }).band : undefined;
  return band === 'review-band' && adr010HasR106Marker();
}

/** Writes a fixture kb.yaml granting the 'reviewer' reader role. */
function writeReviewerGrantKb(dir: string, id: string, bindingYaml: string): string {
  mkdirSync(dir, { recursive: true });
  const kbYamlPath = join(dir, 'kb.yaml');
  writeFileSync(
    kbYamlPath,
    `id: ${id}
name: Test KB
${bindingYaml}
desc: A test knowledge base.
processes:
  lint: { builtin: forge-brain-lint }
  ingest: { builtin: reflector-ingest }
  consolidate: { builtin: brain-fix }
  usage:
    readSurface: navigation-index
    readers: [reviewer]
`,
  );
  return kbYamlPath;
}

test('RED (R1-06): a reviewer grant WITH band:review-band + the ADR-010 amendment marker passes the read-policy guard (both brain/*/kb.yaml and brain/projects/*/kb.yaml shapes)', () => {
  const tmpBrainRoot = mkdtempSync(join(tmpdir(), 'kb-read-policy-guard-'));

  // Shape 1: brain/<id>/kb.yaml (top-level, e.g. brain/cycles/kb.yaml)
  const topLevelPath = writeReviewerGrantKb(
    join(tmpBrainRoot, 'example-flow-kb'),
    'example-flow-kb',
    'binding: { kind: flow, ref: forge-develop, band: review-band }',
  );
  // Shape 2: brain/projects/<name>/kb.yaml (nested, e.g. brain/projects/gitpulse/kb.yaml)
  const projectShapePath = writeReviewerGrantKb(
    join(tmpBrainRoot, 'projects', 'example-flow-kb-2'),
    'example-flow-kb-2',
    'binding: { kind: flow, ref: forge-develop, band: review-band }',
  );

  for (const kbYamlPath of [topLevelPath, projectShapePath]) {
    // Fixture precondition FIRST: the raw yaml text really declares the band
    // and the reviewer grant, before we read any verdict off the loader.
    const raw = readFileSync(kbYamlPath, 'utf8');
    assert.match(raw, /band:\s*review-band/, `fixture precondition: ${kbYamlPath} must declare band: review-band`);
    assert.match(raw, /readers:\s*\[reviewer\]/, `fixture precondition: ${kbYamlPath} must grant readers: [reviewer]`);

    const kb = loadKbDescriptor(kbYamlPath);
    assert.ok(
      resolveKbProcesses(kb).usage.readers.includes('reviewer'),
      `fixture precondition: ${kbYamlPath} must resolve to a reviewer grant`,
    );

    assert.equal(
      reviewerGrantIsBandScoped(kbYamlPath),
      true,
      `a reviewer grant scoped to band:review-band (with the ADR-010 marker) must pass the guard for ${kbYamlPath} — ` +
        `today it fails because loadKbDescriptor drops binding.band entirely (kb.binding.band is undefined) AND ` +
        `ADR-010 does not yet carry the "${R1_06_AMENDMENT_MARKER}" marker`,
    );
  }
});

test('companion (RED (R1-06) above): the SAME reviewer grant WITHOUT a review-band binding fails the read-policy guard', () => {
  const tmpBrainRoot = mkdtempSync(join(tmpdir(), 'kb-read-policy-guard-bandless-'));
  const kbYamlPath = writeReviewerGrantKb(
    join(tmpBrainRoot, 'bandless-flow-kb'),
    'bandless-flow-kb',
    'binding: { kind: flow, ref: forge-develop }',
  );

  const raw = readFileSync(kbYamlPath, 'utf8');
  assert.doesNotMatch(raw, /band:/, 'fixture precondition: bandless fixture must declare no band key at all');
  assert.match(raw, /readers:\s*\[reviewer\]/, 'fixture precondition: fixture must grant readers: [reviewer]');

  const kb = loadKbDescriptor(kbYamlPath);
  assert.ok(
    resolveKbProcesses(kb).usage.readers.includes('reviewer'),
    'fixture precondition: fixture must resolve to a reviewer grant',
  );

  assert.equal(
    reviewerGrantIsBandScoped(kbYamlPath),
    false,
    'a reviewer grant on a bandless flow binding must fail the read-policy guard',
  );
});

// ---------------------------------------------------------------------------
// RATCHET (green-at-birth, disclosed): the two R1-01-F4 tests above still
// assert phases/dev-binding.ts + phases/adversarial-review.ts never match
// READS_BRAIN_NAV — the R1-06 band-grant work above is descriptor-scoped
// (KB binding/usage), NOT a phase-binding source change, so that invariant
// is untouched by this WI. This test proves READS_BRAIN_NAV is not a
// vacuously-always-passing check by feeding it a deliberately mutated
// dev-binding-shaped source that DOES (re)introduce a forge-brain nav read,
// and asserting the pattern flags it.
// ---------------------------------------------------------------------------

test('RATCHET: READS_BRAIN_NAV has teeth — a mutated dev-binding-shaped source IS flagged (non-vacuity proof)', () => {
  const mutatedDevBindingSource = `
import { loadBrainIndex } from '../brain-navigation.ts';

export async function runDeveloperLoop(): Promise<void> {
  // A regression: dev-loop must NEVER read the forge brain navigation surface.
  const nav = await loadBrainIndex();
  void nav;
}
`;
  // False-negative rule: assert the mutation actually landed in the fixture
  // text BEFORE reading any verdict off the check.
  assert.ok(
    mutatedDevBindingSource.includes('loadBrainIndex'),
    'fixture must actually contain the mutated forge-brain-nav read call',
  );

  assert.match(
    mutatedDevBindingSource,
    READS_BRAIN_NAV,
    'non-vacuity: READS_BRAIN_NAV must flag a source that (re)introduces a forge-brain nav read in dev-binding/adversarial-review — ' +
      'otherwise the two R1-01-F4 tests above would pass even if the policy silently regressed',
  );
});
