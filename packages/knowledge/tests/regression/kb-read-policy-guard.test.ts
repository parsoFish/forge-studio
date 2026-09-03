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
import { resolve } from 'node:path';

import { loadKbDescriptor, resolveKbProcesses } from '../../studio/kb-descriptor.ts';
import type { KbDescriptor, KbReaderRole } from '@forge/contracts/studio/types.ts';
import { kbReadPolicyViolation } from '../../kb-read-policy.ts';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';

// Anchored on kernel's FORGE_ROOT, never on a hand-counted `..` chain from
// this file's own depth. The chain here WAS correct at `orchestrator/` (one
// `..`); moving two levels deeper would have left every one of these four
// sites resolving short — and the two `doesNotMatch` assertions would then
// have passed VACUOUSLY on an unreadable path forever (COMMON §15.14, which
// this campaign has already paid for once).
const src = (f: string): string => readFileSync(resolve(FORGE_ROOT, f), 'utf8');
const READS_BRAIN_NAV = /loadBrainIndex|loadBrainNavigation/;

test('R1-01-F4: planners (PM, reflector) still read the brain navigation surface post-rebind', () => {
  assert.match(src('packages/factory/phases/pm-binding.ts'), READS_BRAIN_NAV, 'PM must still load the brain navigation');
  assert.match(src('packages/factory/phases/reflector-binding.ts'), READS_BRAIN_NAV, 'reflector must still load the brain navigation');
});

test('R1-01-F4: dev-loop and the reviewer do NOT read the forge brain (policy unchanged by the rebind)', () => {
  assert.doesNotMatch(src('packages/factory/phases/dev-binding.ts'), READS_BRAIN_NAV, 'dev-loop must not read the forge brain');
  assert.doesNotMatch(src('packages/factory/phases/adversarial-review.ts'), READS_BRAIN_NAV, 'the reviewer must not read the forge brain');
});

// ---------------------------------------------------------------------------
// R1-06 WI-1 group B (4): the asymmetric brain-read policy (ADR-010 as
// amended) extends past the 4 phase-binding source files above to KB
// DESCRIPTORS. The rule is now encoded as ONE pure, exported predicate —
// `kbReadPolicyViolation` (cli/kb-read-policy.ts) — that BOTH `forge studio
// lint` (the production wiring, cli/studio-lint.ts) and this guard drive, so
// there is a single source of the policy rather than a hand-rolled helper.
//
// The policy (T1 ruling + ADR-010 amendment "R1-06 band-scoped reviewer
// grant"):
//   - a `project` binding is ALWAYS exempt (Brain-3 legitimately grants the
//     full reader set incl. dev-loop + reviewer, ADR-010 / ADR-035);
//   - on a NON-project binding, granting `dev-loop` is NEVER ratified, and
//     granting `reviewer` is ratified ONLY on { kind: flow, band: review-band }.
//
// F3 defect closed here: the previous ad-hoc `reviewerGrantIsBandScoped`
// helper (a) FALSE-POSITIVED on every real project KB (it flagged the
// legitimate 'reviewer' grant that deriveKbUsageDefaults gives project
// bindings) and (b) UNDER-CHECKED — it inspected only 'reviewer', never
// 'dev-loop', which the ADR forbids on ANY non-project binding.
// ---------------------------------------------------------------------------

const ADR_010_PATH = resolve(FORGE_ROOT, 'docs/decisions/010-brain-first.md');
const R1_06_AMENDMENT_MARKER = 'R1-06 band-scoped reviewer grant';

/** The ratified exception is documented in ADR-010 (T1 landed the text). This
 *  guards that the amendment marker stays present — the predicate encodes the
 *  same exception in code. */
test('R1-06: ADR-010 carries the "R1-06 band-scoped reviewer grant" amendment marker', () => {
  assert.match(
    readFileSync(ADR_010_PATH, 'utf8'),
    new RegExp(R1_06_AMENDMENT_MARKER),
    'ADR-010 must document the one ratified band->reader exception the predicate encodes',
  );
});

/** The 4 real central per-project brains (ADR 035). */
const REAL_PROJECT_KB_PATHS = ['gitpulse', 'mdtoc', 'terraform-provider-betterado', 'trafficGame'].map((p) =>
  resolve(FORGE_ROOT, 'brain', 'projects', p, 'kb.yaml'),
);

/** Build a KbDescriptor directly (bypasses disk) — `readers` present ⇒ an
 *  explicit processes.usage grant; absent ⇒ resolveKbProcesses derives the
 *  default reader set for the binding. */
function descriptor(id: string, binding: KbDescriptor['binding'], readers?: KbReaderRole[]): KbDescriptor {
  return {
    id,
    name: id,
    binding,
    desc: 'test descriptor',
    processes: readers
      ? {
          lint: { builtin: 'forge-brain-lint' },
          ingest: { builtin: 'reflector-ingest' },
          consolidate: { builtin: 'brain-fix' },
          usage: { readSurface: 'navigation-index', readers },
        }
      : undefined,
    path: `/tmp/${id}/kb.yaml`,
  };
}

test('F3: all 4 real project KBs PASS the read-policy predicate (project bindings are exempt — the old helper flagged them)', () => {
  for (const path of REAL_PROJECT_KB_PATHS) {
    const kb = loadKbDescriptor(path);
    // Fixture precondition FIRST: this IS a project binding whose resolved
    // reader set really grants 'reviewer' — so the exemption is doing real
    // work, not passing merely because there is no reviewer grant to catch.
    assert.equal(kb.binding.kind, 'project', `precondition: ${path} must be a project binding`);
    assert.ok(
      resolveKbProcesses(kb).usage.readers.includes('reviewer'),
      `precondition: ${path} resolves to a reviewer grant (deriveKbUsageDefaults for a project)`,
    );

    const verdict = kbReadPolicyViolation(kb);
    assert.equal(
      verdict.ok,
      true,
      `real project KB ${kb.id} must PASS the read-policy predicate (project bindings are exempt) — ` +
        `got ${JSON.stringify(verdict)}`,
    );
  }
});

test('F3: a review-band flow KB granting the reviewer PASSES (the one ratified exception)', () => {
  // (a) default-derived: a { kind: flow, band: review-band } binding resolves
  // to readers incl. reviewer via deriveKbUsageDefaults, with no processes block.
  const derived = descriptor('review-band-derived', { kind: 'flow', ref: 'forge-develop', band: 'review-band' });
  assert.ok(
    resolveKbProcesses(derived).usage.readers.includes('reviewer'),
    'precondition: a review-band flow binding derives a reviewer grant by default',
  );
  assert.equal(kbReadPolicyViolation(derived).ok, true, 'review-band flow KB (derived reviewer) must pass');

  // (b) explicit: the same binding with a hand-declared reviewer grant.
  const explicit = descriptor('review-band-explicit', { kind: 'flow', ref: 'forge-develop', band: 'review-band' }, ['reviewer']);
  assert.equal(kbReadPolicyViolation(explicit).ok, true, 'review-band flow KB (explicit reviewer) must pass');
});

test('F3: a bandless flow KB granting the reviewer FAILS', () => {
  const kb = descriptor('bandless-reviewer', { kind: 'flow', ref: 'forge-develop' }, ['reviewer']);
  // Precondition: bandless flow binding, resolved readers really include reviewer.
  assert.equal(kb.binding.kind === 'flow' ? kb.binding.band : 'n/a', undefined, 'precondition: no band declared');
  assert.ok(resolveKbProcesses(kb).usage.readers.includes('reviewer'), 'precondition: grants reviewer');

  const verdict = kbReadPolicyViolation(kb);
  assert.equal(verdict.ok, false, 'a bandless flow reviewer grant must FAIL');
  if (!verdict.ok) assert.match(verdict.reason, /reviewer/, 'reason must name the reviewer grant');
});

test('F3: a flow KB granting dev-loop FAILS — even scoped to review-band (dev-loop is never ratified off a project binding)', () => {
  // With review-band: reviewer would be ratified, but dev-loop never is.
  const banded = descriptor('devloop-banded', { kind: 'flow', ref: 'forge-develop', band: 'review-band' }, ['reviewer', 'dev-loop']);
  assert.ok(resolveKbProcesses(banded).usage.readers.includes('dev-loop'), 'precondition: grants dev-loop');
  const v1 = kbReadPolicyViolation(banded);
  assert.equal(v1.ok, false, 'a dev-loop grant on a flow binding must FAIL even with band:review-band');
  if (!v1.ok) assert.match(v1.reason, /dev-loop/, 'reason must name the dev-loop grant');

  // Plain flow binding granting dev-loop.
  const plain = descriptor('devloop-plain', { kind: 'flow', ref: 'forge-develop' }, ['dev-loop']);
  assert.equal(kbReadPolicyViolation(plain).ok, false, 'a dev-loop grant on a bandless flow binding must FAIL');
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
