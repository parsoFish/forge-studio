import { wellFormedTurnSpec, turnSpecDescriptor } from './test-fixtures/session-kinds-turnspec.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadSessionKinds, type SessionKindDescriptor } from '../../studio/session-kinds.ts';
import { validateSessionKinds } from '../../studio/session-kinds-validate.ts';
import type { Finding } from '@forge/kernel';
import { runStudioLint } from '../../../../apps/forge/studio-lint.ts';
import { SLUG_RE } from '@forge/agents/skill-path.ts';

import { REPO_ROOT, byId, makeForgeRoot, writeAgentSkill, writeSessionKindsYaml } from './test-fixtures/session-kinds-core.ts';

// ===========================================================================
// AT-R422-1 .. AT-R422-10 — R4-22 WI-1, ADR-043: the additive-optional
// `turnSpec` field. See the file header for the pinned shape, the frozen
// registries, and why these tests use a DYNAMIC import.
// ===========================================================================



/** Findings this initiative's checks produce, isolated from every
 *  pre-existing session-kinds/* check so a probe that flips ONE field can
 *  assert in isolation even though the fixture also carries the other,
 *  still-valid turnSpec fields. */
function turnspecFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.check.startsWith('session-kinds/turnspec-'));
}

describe('validateSessionKinds — turnSpec (AT-R422-1..4): unknown value in a closed sub-vocabulary → error naming value + allowed set', () => {
  it('AT-R422-1: turnSpec.style outside TURN_STYLES → error naming the offending value AND every id in TURN_STYLES (kills an implementation that never validates style at all, or that validates it but hardcodes a stale/incomplete allowed-set string instead of deriving it from TURN_STYLES)', async () => {
    const mod = await import('../../studio/session-kinds.ts');
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const bogus = 'not-a-real-turn-style-at-all';
    writeSessionKindsYaml(root, [turnSpecDescriptor({ ...wellFormedTurnSpec(), style: bogus })]);

    const findings = turnspecFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/turnspec-unknown-style');
    assert.ok(f, `expected a session-kinds/turnspec-unknown-style finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes(bogus), 'message must name the offending value');
    const styles: readonly { id: string }[] = mod.TURN_STYLES ?? [];
    assert.ok(styles.length > 0, 'TURN_STYLES must be seeded (the ADR names style: agent | structured) for this allowed-set assertion to be meaningful');
    for (const row of styles) {
      assert.ok(f.message.includes(row.id), `message must name the allowed set (missing "${row.id}")`);
    }
  });

  it('AT-R422-2: a phase.step outside TURN_STEPS → error naming the offending value AND every id in TURN_STEPS (kills an implementation that validates style but forgets per-phase step validation — a distinct field, distinct check)', async () => {
    const mod = await import('../../studio/session-kinds.ts');
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const bogus = 'not-a-real-step-at-all';
    const turnSpec = wellFormedTurnSpec();
    (turnSpec.phases as Record<string, unknown>[])[0] = { ...(turnSpec.phases as Record<string, unknown>[])[0], step: bogus };
    writeSessionKindsYaml(root, [turnSpecDescriptor(turnSpec)]);

    const findings = turnspecFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/turnspec-unknown-step');
    assert.ok(f, `expected a session-kinds/turnspec-unknown-step finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes(bogus), 'message must name the offending value');
    const steps: readonly { id: string }[] = mod.TURN_STEPS ?? [];
    assert.ok(steps.length > 0, 'TURN_STEPS must be seeded (the ADR example uses agent/noop/finalize/terminal) for this allowed-set assertion to be meaningful');
    for (const row of steps) {
      assert.ok(f.message.includes(row.id), `message must name the allowed set (missing "${row.id}")`);
    }
  });

  it('AT-R422-3 (updated W6-B3 post-merge review): a phase.finalizer outside the DISPATCHABLE finalizer set (on an otherwise-valid step:finalize phase) → error naming the offending value AND every id `packages/sessions/interactive-finalizers.ts`\'s FINALIZERS registry actually implements — turnSpec.phases validates against the set dispatch will resolve, NOT the wider descriptive FINALIZER_IDS (kills an implementation that validates step but never resolves the finalizer id it names — a dangling reference would otherwise only fail at RUNTIME, mid-cycle, not at lint time; also kills an implementation that lint-approves a merely DESCRIPTIVE finalizer id turnSpec dispatch would throw on)', async () => {
    // Parity import (reviewer-preferred over a hand-maintained mirror): the
    // REAL registry a turnSpec finalize step actually dispatches through.
    const { FINALIZERS } = await import('../../interactive-finalizers.ts');
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const bogus = 'notARealFinalizerAtAll';
    const turnSpec = wellFormedTurnSpec();
    const phases = turnSpec.phases as Record<string, unknown>[];
    const committingIdx = phases.findIndex((p) => p.phase === 'committing');
    phases[committingIdx] = { ...phases[committingIdx], finalizer: bogus };
    writeSessionKindsYaml(root, [turnSpecDescriptor(turnSpec)]);

    const findings = turnspecFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/turnspec-unknown-finalizer');
    assert.ok(f, `expected a session-kinds/turnspec-unknown-finalizer finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes(bogus), 'message must name the offending value');
    assert.ok(FINALIZERS.length > 0, 'FINALIZERS must be seeded with at least copyStagingToLibrary for this allowed-set assertion to be meaningful');
    for (const row of FINALIZERS) {
      assert.ok(f.message.includes(row.id), `message must name the DISPATCHABLE allowed set (missing "${row.id}")`);
    }
    // The other direction (the actual reviewer finding): a merely
    // DESCRIPTIVE finalizer id (real in FINALIZER_IDS, but NOT implemented
    // by FINALIZERS) must NOT be lint-approved for turnSpec — see
    // W6-B3-11 below for the direct "this id passes on panel, fails on
    // turnSpec" pairing.
    for (const descriptiveOnlyId of ['writeToRepoRoot', 'recordLockedDemo']) {
      assert.ok(
        !FINALIZERS.some((row) => row.id === descriptiveOnlyId),
        `arrange: "${descriptiveOnlyId}" must be absent from the REAL FINALIZERS registry (a precondition of this test, not the assertion under test)`,
      );
    }
  });

  it('AT-R422-4: turnSpec.schema outside SCHEMA_IDS → error naming the offending value AND every id in SCHEMA_IDS (kills an implementation that resolves style/step/finalizer but skips schema — the 4th vocabulary the ADR names explicitly; if SCHEMA_IDS is seeded EMPTY for WI-1 this allowed-set loop is vacuously true — see the T3 report\'s flagged ambiguity, this assertion alone cannot distinguish "seeded empty" from "seeded correctly" and the offending-value assertion above it is what actually carries the pin)', async () => {
    const mod = await import('../../studio/session-kinds.ts');
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const bogus = 'not-a-real-schema-id-at-all';
    writeSessionKindsYaml(root, [turnSpecDescriptor({ ...wellFormedTurnSpec(), schema: bogus })]);

    const findings = turnspecFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/turnspec-unknown-schema');
    assert.ok(f, `expected a session-kinds/turnspec-unknown-schema finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes(bogus), 'message must name the offending value');
    const schemas: readonly { id: string }[] = mod.SCHEMA_IDS ?? [];
    for (const row of schemas) {
      assert.ok(f.message.includes(row.id), `message must name the allowed set (missing "${row.id}")`);
    }
  });
});

describe('validateSessionKinds — turnSpec positive control + additive-optionality (AT-R422-5, AT-R422-9)', () => {
  it('AT-R422-9: the well-formed ADR-043 §1 authoring turnSpec validates CLEAN — zero turnspec-* findings (POSITIVE CONTROL: without this, AT-R422-1..4 could all pass for the wrong reason — an implementation that rejects every turnSpec unconditionally)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [turnSpecDescriptor(wellFormedTurnSpec())]);

    const findings = turnspecFindings(validateSessionKinds(root));
    assert.deepEqual(findings, [], `expected zero turnspec-* findings for the well-formed ADR example, got: ${JSON.stringify(findings)}`);
  });

  // UPDATED (R4-21 phase 2, WI-1, D1 — _wave5/unit-specs/R4-21-phase2.md):
  // this AT was written during R4-22 WI-1, when the real repo shipped 5
  // session kinds and NONE carried a turnSpec. R4-21 phase 1 (this branch,
  // rebased post-R4-22) already added a 6th real descriptor, "authoring" —
  // so the OLD assertion ("exactly 5, none with turnSpec") is stale on its
  // own terms (verified: it fails at branch base today, `6 !== 5`, BEFORE
  // this edit — a pre-existing broken pin from the rebase, not something WI-1
  // introduces). D1 makes "authoring" WI-1's own turnSpec consumer (ADR-043
  // §1's worked example IS this descriptor) — the additive-optionality
  // guarantee this AT exists to pin now has ONE declared exception, not zero.
  //
  // OLD assertion: descs.length === 5; every descriptor's turnSpec is
  // undefined.
  // NEW assertion: descs.length === 6; every descriptor OTHER than
  // "authoring" still has turnSpec === undefined (the additive-optionality
  // guarantee stays intact for the other 5 — NOT weakened by this edit);
  // "authoring" carries a turnSpec that deep-equals ADR-043 §1's exact table
  // (the same `wellFormedTurnSpec()` fixture this file's own AT-R422-9
  // positive control already uses), and validateSessionKinds emits zero
  // turnspec-* findings scoped to session-kind:authoring specifically (a
  // narrower, more targeted version of "zero findings for it" than AT-17's
  // repo-wide zero-error-findings check, which also covers this once
  // turnSpec is well-formed).
  // Why this is a CONTRACT CHANGE, not a weakening: the property "a
  // turnSpec-less descriptor is untouched by turnSpec validation" is
  // PRESERVED for every one of the 5 pre-existing kinds — this only adds the
  // POSITIVE half (a turnSpec-bearing real descriptor validates clean and
  // matches the ratified table) for the ONE kind D1 explicitly wires it onto.
  //
  // UPDATED AGAIN (R4-19-F2, this edit): commit 9342825f landed "kb-cleanup"
  // as ADR-043's SECOND turnSpec consumer (the commit message's own words:
  // "ADR-043 consumer #2") — so the "authoring is the ONE declared
  // exception" framing above is now stale on its own terms, same failure
  // shape as the R4-21-phase-2 rebase note directly above it: descs.length
  // is 7, not 6, and the turnSpec-less loop must also skip "kb-cleanup" or
  // it fails on the very row this initiative adds. The additive-optionality
  // guarantee itself is unweakened — it now has TWO declared exceptions
  // instead of one, and the other 5 kinds are still asserted turnSpec-less
  // exactly as before.
  it('AT-R422-5 (W8-B5b: "community-refresh" retired): ADDITIVE-OPTIONAL, proven against the REAL repo — 5 of the 7 real session kinds still carry no turnSpec at all (loadSessionKinds/validateSessionKinds(REPO_ROOT) behaves EXACTLY as before for them); "authoring" and "kb-cleanup" are the TWO declared exceptions, each turnSpec deep-equaling its own ratified table exactly (kills an implementation that makes turnSpec required on every kind, that emits a finding merely for its absence on the OTHER 5, or that ships any exception with a turnSpec that drifts from its ratified table)', () => {
    const descs = loadSessionKinds(REPO_ROOT);
    assert.equal(descs.length, 7, `expected exactly 7 real session kinds (R4-16 "demo", R4-17 "onboarding", R4-21 "authoring", R4-19-F2 "kb-cleanup"; W6-CR-3's "community-refresh" was retired in W8-B5b), got ids: ${descs.map((d) => d.id).join(', ')}`);
    // "authoring"/"kb-cleanup" are the turnSpec-bearing exceptions — excluded
    // from the turnSpec-less loop below, so their real turnSpecs do not trip
    // the negative-control assertion meant for the OTHER 5 kinds. W6-CR-3
    // once added "community-refresh" as a third exception here; W8-B5b
    // retired that descriptor along with the kind.
    for (const d of descs) {
      if (d.id === 'authoring' || d.id === 'kb-cleanup') continue;
      assert.equal(
        (d as SessionKindDescriptor & { turnSpec?: unknown }).turnSpec,
        undefined,
        `descriptor "${d.id}" has no turnSpec in the real yaml — must remain undefined, never defaulted to some non-optional shape`,
      );
    }

    const authoring = byId(descs, 'authoring');
    assert.ok(authoring.turnSpec, 'expected the real "authoring" descriptor to carry a turnSpec (D1 — ADR-043 §1 verbatim)');
    assert.deepEqual(
      authoring.turnSpec,
      wellFormedTurnSpec(),
      `authoring's real turnSpec must deep-equal ADR-043 §1's exact 4-phase table (kindDir:_authoring, style:agent, analyzing→awaiting-review→committing→committed), got: ${JSON.stringify(authoring.turnSpec)}`,
    );

    const findings = turnspecFindings(validateSessionKinds(REPO_ROOT)).filter((f) => f.object === 'session-kind:authoring');
    assert.deepEqual(findings, [], `expected zero turnspec-* findings for the real "authoring" descriptor, got: ${JSON.stringify(findings)}`);

    // R4-19-F2 (this edit): the SECOND turnSpec consumer, kb-cleanup, gets
    // the exact same positive-control treatment as authoring above — its own
    // ratified table (drafting→awaiting-approval→applied, mirroring the
    // literal shape pinned by this file's own "R4-19-F2 AT-1" below, kept as
    // an independent literal here rather than a cross-describe-block import
    // so this AT's assertion is not silently defeated by an unrelated edit
    // to that other block's local fixture).
    const kbCleanup = byId(descs, 'kb-cleanup');
    assert.ok(kbCleanup.turnSpec, 'expected the real "kb-cleanup" descriptor to carry a turnSpec (R4-19-F2 — ADR-043 consumer #2)');
    assert.deepEqual(
      kbCleanup.turnSpec,
      {
        kindDir: '_kb-cleanup',
        style: 'agent',
        phases: [
          { phase: 'drafting', step: 'agent', writes: ['plan'], next: 'awaiting-approval' },
          // verdicts (W7-C2, superseding W6-B6's approve-only ruling): the
          // full three-way branch — `revise` (feedback -> re-draft) and
          // `reject` (-> the terminal `rejected` row below) joined per
          // sessions-kinds-23. The approval gate ("no next" above) is
          // unchanged.
          { phase: 'awaiting-approval', step: 'noop', awaits: 'verdict', verdicts: ['approve', 'revise', 'reject'] },
          // W6-B4 adversarial-review fix: `applying` is the atomic-claim
          // marker `approveKbCleanup` (packages/knowledge/bridge-studio-kbs.ts) writes
          // SYNCHRONOUSLY before its one await, closing a live-reproduced
          // double-drain race. Unreachable via `next` (same as `applied`
          // always has been) — `approveKbCleanup` is its only writer.
          { phase: 'applying', step: 'terminal' },
          { phase: 'applied', step: 'terminal' },
          // W7-C2 — reject's terminal landing row.
          { phase: 'rejected', step: 'terminal' },
        ],
      },
      `kb-cleanup's real turnSpec must deep-equal its ratified table (kindDir:_kb-cleanup, style:agent, drafting→awaiting-approval→applying→applied, plus a direct awaiting-approval→rejected terminal, with NO "next" on awaiting-approval — that absence is the approval gate), got: ${JSON.stringify(kbCleanup.turnSpec)}`,
    );

    const kbCleanupFindings = turnspecFindings(validateSessionKinds(REPO_ROOT)).filter((f) => f.object === 'session-kind:kb-cleanup');
    assert.deepEqual(kbCleanupFindings, [], `expected zero turnspec-* findings for the real "kb-cleanup" descriptor, got: ${JSON.stringify(kbCleanupFindings)}`);
    // W6-CR-3 once added a THIRD turnSpec consumer here, "community-refresh"
    // (a 5-phase gathering→awaiting-review→committing→committed table with a
    // direct awaiting-review→rejected terminal). W8-B5b retired that
    // descriptor along with the kind, so only the two consumers above remain.
  });
});

describe('loadSessionKinds — turnSpec is STRUCTURAL ONLY (AT-R422-6, mirrors AT-16\'s split for the pre-existing fields)', () => {
  it('AT-R422-6: a semantically-invalid turnSpec (bogus style) does NOT throw at load time and the parsed descriptor carries the turnSpec data INTACT, unmodified — semantic rejection is validateSessionKinds\'s job alone (kills an implementation that validates style inside parseSessionKindDescriptor/loadSessionKinds, breaking the AT-16 load/validate split every other field in this module already honors)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const bogusTurnSpec = { ...wellFormedTurnSpec(), style: 'not-a-real-style-at-all' };
    writeSessionKindsYaml(root, [turnSpecDescriptor(bogusTurnSpec)]);

    let descs: SessionKindDescriptor[] = [];
    assert.doesNotThrow(() => { descs = loadSessionKinds(root); }, 'loadSessionKinds must not throw on a semantically-bogus turnSpec — only a structurally malformed one');
    assert.equal(descs.length, 1);
    assert.deepEqual((descs[0] as SessionKindDescriptor & { turnSpec?: unknown }).turnSpec, bogusTurnSpec, 'the loader must carry the turnSpec object through unmodified, including the offending style value — the same evidence validateSessionKinds then flags');

    const findings = turnspecFindings(validateSessionKinds(root));
    assert.ok(findings.some((f) => f.check === 'session-kinds/turnspec-unknown-style'), 'validateSessionKinds must independently flag the exact value the loader silently accepted');
  });
});

describe('turnSpec vocabularies — deep-frozen registries + total lookup fns (AT-R422-7, AT-R422-8)', () => {
  it('AT-R422-7: TURN_STYLES, TURN_STEPS, FINALIZER_IDS are each seeded (length > 0) and DEEP-frozen — the outer array AND every row are frozen, and an in-place mutation on a row never takes effect (kills an implementation that does `Object.freeze(array)` alone without freezing each row first — the exact shallow-freeze regression SESSION_ARTIFACT_KINDS\'s own header comment warns against, reproduced here). SCHEMA_IDS is DELIBERATELY EMPTY for R4-22 WI-1 (no `structured`-style turnSpec consumer exists anywhere in the repo yet — seeding a placeholder id would make a schema id lint-valid with no implementation behind it, which this codebase explicitly refuses to pretend) but is still frozen — an empty array can and must still be frozen. The `length === 0` assertion below IS this gap-pin\'s own expiry condition (immutable-gates discipline): it goes RED the moment anyone seeds the first real schema id, forcing whoever does that to consciously widen it to `length > 0` plus the allowed-set coverage AT-R422-1..3 already give the other three registries — a stronger pin than a blanket `length > 0` could ever be, because a blanket check cannot hold for a genuinely, deliberately empty vocabulary.', async () => {
    const mod = await import('../../studio/session-kinds.ts');

    // The three genuinely seeded turnSpec vocabularies — length > 0 is a real
    // invariant for these three (unlike SCHEMA_IDS, see below).
    const seededRegistries: Record<string, readonly { readonly id: string }[]> = {
      TURN_STYLES: mod.TURN_STYLES,
      TURN_STEPS: mod.TURN_STEPS,
      FINALIZER_IDS: mod.FINALIZER_IDS,
    };
    for (const [name, registry] of Object.entries(seededRegistries)) {
      assert.ok(Array.isArray(registry) && registry.length > 0, `${name} must exist and be seeded with at least one row`);
      // `Array.isArray`'s TS type predicate is `arg is any[]` — narrowing
      // through the check directly above silently erases `registry`'s
      // `readonly { readonly id: string }[]` typing for everything below it
      // (a known TS limitation, empirically confirmed while wiring this
      // amendment: left as `registry`, the `@ts-expect-error` two blocks down
      // has nothing to catch, i.e. exactly TS2578). Re-bind through a freshly,
      // explicitly typed local so the readonly typing this whole amendment
      // exists to enforce survives past the runtime array check — the runtime
      // check itself is unchanged, still real, still first.
      const rows: readonly { readonly id: string }[] = registry;
      assert.ok(Object.isFrozen(rows), `${name}'s outer array must be frozen`);
      for (const row of rows) {
        assert.ok(Object.isFrozen(row), `${name}'s row ${JSON.stringify(row)} must ALSO be frozen — shallow freeze alone leaves it mutable`);
      }
      const before = rows[0].id;
      try {
        // @ts-expect-error deliberate mutation attempt on a frozen, readonly-id row
        rows[0].id = 'HACKED';
      } catch {
        // Strict-mode ESM throws TypeError on a frozen-object write — that is
        // an ACCEPTABLE way for "does not take effect" to manifest; either
        // outcome is fine as long as the value below is unchanged.
      }
      assert.equal(rows[0].id, before, `${name}[0].id must be unchanged after a direct mutation attempt, whether it silently no-op'd or threw`);
    }

    // SCHEMA_IDS: deliberately empty — still frozen (there is no row to
    // freeze-check, but the OUTER array itself must be, same as the three
    // above), and `length === 0` is the assertion that expires this gap-pin
    // the instant it stops being true.
    const schemaIds: readonly { readonly id: string }[] = mod.SCHEMA_IDS;
    assert.ok(Array.isArray(schemaIds), 'SCHEMA_IDS must exist and be an array');
    assert.ok(Object.isFrozen(schemaIds), "SCHEMA_IDS's outer array must be frozen even though it is empty");
    assert.equal(
      schemaIds.length,
      0,
      'SCHEMA_IDS must be deliberately EMPTY for R4-22 WI-1 (no structured-style turnSpec consumer exists yet) — this assertion is a self-expiring gap-pin: the moment the first real schema id is seeded, THIS line must be consciously updated to length > 0 plus the allowed-set coverage AT-R422-1..3 already give TURN_STYLES/TURN_STEPS/FINALIZER_IDS',
    );
  });

  it('AT-R422-8: turnStyleState/turnStepState/finalizerIdState/schemaIdState are TOTAL — undefined for an unrecognised id, NEVER throw (kills an implementation using a non-total lookup like array indexing or a bang-asserted .find()! that throws or returns null instead of undefined for an unknown id)', async () => {
    const mod = await import('../../studio/session-kinds.ts');
    const lookups: [string, (id: string) => unknown][] = [
      ['turnStyleState', mod.turnStyleState],
      ['turnStepState', mod.turnStepState],
      ['finalizerIdState', mod.finalizerIdState],
      ['schemaIdState', mod.schemaIdState],
    ];
    for (const [name, fn] of lookups) {
      assert.equal(typeof fn, 'function', `${name} must be an exported function`);
      let result: unknown;
      assert.doesNotThrow(() => { result = fn('totally-unrecognised-id-xyz'); }, `${name} must never throw on an unrecognised id`);
      assert.equal(result, undefined, `${name} must return undefined (not null, not throw) for an unrecognised id`);
    }
  });
});

describe('the real production call path — forge studio lint (AT-R422-10, Ruling 36)', () => {
  it('AT-R422-10: runStudioLint(root) — the exact function cmdStudioLint (apps/forge/cli.ts) calls, which `forge studio lint` runs and which CI invokes via `node --experimental-strip-types apps/forge/cli.ts studio lint` (.github/workflows/ci.yml) — surfaces the turnspec-unknown-style finding produced by validateSessionKinds (kills an implementation where the new check exists and is directly callable but is not actually wired into (or is swallowed by) the studio-lint aggregation path an operator/CI actually runs; validateSessionKinds alone being correct is NOT sufficient — this is the "guard exists, no call site calls it" defect class named in the brief)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const bogus = 'not-a-real-turn-style-at-all';
    writeSessionKindsYaml(root, [turnSpecDescriptor({ ...wellFormedTurnSpec(), style: bogus })]);

    const result = runStudioLint(root);
    const findings = turnspecFindings(result.findings);
    const f = findings.find((x) => x.check === 'session-kinds/turnspec-unknown-style');
    assert.ok(f, `expected runStudioLint to surface a session-kinds/turnspec-unknown-style finding, got turnspec-* findings: ${JSON.stringify(findings)}`);
    assert.ok(f.message.includes(bogus), 'the finding reaching the real CLI aggregation path must still name the offending value');
    assert.ok(result.errorCount >= 1, 'runStudioLint.errorCount must reflect the new error-level finding — this is the number the CI gate actually checks non-zero on');
  });
});

// ===========================================================================
// AT-R422-11 .. AT-R422-19 — adversarial-review T3 gap-pin round: WI-1
// validates turnSpec VOCABULARY MEMBERSHIP only; `turnSpec.phases` is a STATE
// MACHINE and its GRAPH COHERENCE is validated nowhere. Every gap below was
// CONFIRMED BY EXECUTION against the real module (loads clean, zero
// findings) before being written. See the file header for the full check-id
// list and the SLUG_RE-vs-underscore-prefix determination (AT-R422-12).
// ===========================================================================

describe('validateSessionKinds — turnSpec.kindDir must be a safe single path segment (AT-R422-11, AT-R422-12)', () => {
  it('AT-R422-11: turnSpec.kindDir that is NOT a safe single path segment → error naming the offending value, for every shape a reviewer confirmed slips through today (kills an implementation that never validates kindDir\'s shape at all — reviewer-confirmed by EXECUTION: kindDir: ".." and kindDir: "a/b" both loaded clean with ZERO findings against the real module. ADR-043 §1 names kindDir verbatim as "the ONE containment segment" — it becomes `resolveGuardedPath(projectRoot, [kindDir, sessionId])` in the generic runner (docs/decisions/043-generic-interactive-surface.md:47), the SEC-04 guard root. This is the single most important gap in the whole review: an unvalidated kindDir is a path-traversal primitive one lint pass away from being wired to a real filesystem write.)', () => {
    const badKindDirs = [
      '..',
      'a/b',
      '.',
      '/leading-slash-value',
      'bad' + String.fromCharCode(0) + 'dir', // C0 control character (NUL) — mirrors this file's own AT-65 null-byte precedent; built at RUNTIME, never a raw byte in the source file
    ];
    for (const bad of badKindDirs) {
      const root = makeForgeRoot();
      writeAgentSkill(root, 'fixture-agent');
      writeSessionKindsYaml(root, [turnSpecDescriptor({ ...wellFormedTurnSpec(), kindDir: bad })]);

      const findings = turnspecFindings(validateSessionKinds(root));
      const f = findings.find((x) => x.check === 'session-kinds/turnspec-unsafe-kind-dir');
      assert.ok(f, `expected a session-kinds/turnspec-unsafe-kind-dir finding for kindDir ${JSON.stringify(bad)}, got: ${JSON.stringify(findings)}`);
      assert.equal(f.level, 'error');
      assert.ok(f.message.includes(bad), `message must name the offending kindDir value ${JSON.stringify(bad)}, got: ${f.message}`);
    }
  });

  it('AT-R422-12: turnSpec.kindDir POSITIVE CONTROL — legitimate underscore-prefixed dir names (`_authoring` per the ADR §1 worked example, plus `_architect`/`_demo`, the real values this design actually uses) validate CLEAN (without this, a blanket-reject kindDir implementation would pass every negative probe in AT-R422-11 for the WRONG reason). Also asserts the determination the implementer needs: SLUG_RE (imported straight from packages/agents/skill-path.ts — the SAME regex CHECK_SLUG already applies to the sibling `d.id` field one screen up in validateSessionKinds) does NOT accept these values, because it requires a leading a-z letter — reusing SLUG_RE/CHECK_SLUG for kindDir would make every REAL shipped kindDir value a permanent lint error, so a distinct check is required.', () => {
    for (const good of ['_authoring', '_architect', '_demo']) {
      assert.ok(
        !SLUG_RE.test(good),
        `sanity precondition: SLUG_RE (${SLUG_RE}) must reject "${good}" (leading underscore) — this is WHY a dedicated kindDir-shape check, distinct from SLUG_RE/CHECK_SLUG, is required`,
      );
      const root = makeForgeRoot();
      writeAgentSkill(root, 'fixture-agent');
      writeSessionKindsYaml(root, [turnSpecDescriptor({ ...wellFormedTurnSpec(), kindDir: good })]);

      const findings = turnspecFindings(validateSessionKinds(root));
      assert.deepEqual(findings, [], `expected zero turnspec-* findings for legitimate kindDir "${good}", got: ${JSON.stringify(findings)}`);
    }
  });
});

describe('validateSessionKinds — turnSpec.phases graph coherence (AT-R422-13..18)', () => {
  it('AT-R422-13: a phase whose `next` names a phase absent from the table ("dangling next") → error naming the offending value AND the real phase names that DO exist (mirrors the existing `defaultStage ∈ stages` precedent one screen up in validateSessionKinds — this is `next ∈ phase-names`; kills an implementation that resolves style/step/finalizer/schema in isolation but never checks a phase\'s `next` actually points somewhere reachable, silently producing a dead-end the generic runner\'s dispatch loop can walk into at RUNTIME)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const turnSpec = wellFormedTurnSpec();
    const phases = turnSpec.phases as Record<string, unknown>[];
    const idx = phases.findIndex((p) => p.phase === 'analyzing');
    phases[idx] = { ...phases[idx], next: 'phase-that-does-not-exist' };
    writeSessionKindsYaml(root, [turnSpecDescriptor(turnSpec)]);

    const findings = turnspecFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/turnspec-dangling-next');
    assert.ok(f, `expected a session-kinds/turnspec-dangling-next finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('phase-that-does-not-exist'), 'message must name the offending next value');
    for (const p of phases) {
      assert.ok(f.message.includes(p.phase as string), `message must name the real phase-name set (missing "${p.phase}")`);
    }
  });

  it('AT-R422-14: a `step: finalize` phase that OMITS `finalizer` ENTIRELY (the key itself is absent, not merely undefined-valued) → error (kills the existing check\'s literal blind spot: `if (phase.finalizer !== undefined && finalizerIdState(phase.finalizer) === undefined)` only ever fires when `finalizer` IS present — a finalize phase with the key left out entirely never enters that branch and passes clean, silently reaching the generic runner\'s step:finalize dispatch with nothing to call)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const turnSpec = wellFormedTurnSpec();
    const phases = turnSpec.phases as Record<string, unknown>[];
    const idx = phases.findIndex((p) => p.phase === 'committing');
    phases[idx] = { phase: 'committing', step: 'finalize', next: 'committed' }; // no `finalizer` key at all
    writeSessionKindsYaml(root, [turnSpecDescriptor(turnSpec)]);

    const findings = turnspecFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/turnspec-finalize-missing-finalizer');
    assert.ok(f, `expected a session-kinds/turnspec-finalize-missing-finalizer finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('committing'), 'message must name the offending phase');
  });

  it('W6-B3-14 (the turnSpec-side twin of AT-R422-14, same shape, `awaits` instead of `finalizer` — the reviewer\'s HIGH finding): a turnSpec `step: noop` phase that OMITS `awaits` ENTIRELY → session-kinds/turnspec-noop-missing-awaits naming the kind, the phase, AND the allowed set', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const turnSpec = wellFormedTurnSpec();
    const phases = turnSpec.phases as Record<string, unknown>[];
    const idx = phases.findIndex((p) => p.phase === 'awaiting-review');
    phases[idx] = { phase: 'awaiting-review', step: 'noop' }; // no `awaits` key at all
    writeSessionKindsYaml(root, [turnSpecDescriptor(turnSpec)]);

    const findings = turnspecFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/turnspec-noop-missing-awaits');
    assert.ok(f, `expected a session-kinds/turnspec-noop-missing-awaits finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('fixture-kind'), 'message must name the offending kind');
    assert.ok(f.message.includes('awaiting-review'), 'message must name the offending phase');
    assert.ok(f.message.includes('questions') && f.message.includes('verdict'), 'message must name the allowed set');
  });

  it('AT-R422-15: a turnSpec.phases table containing NO `step: terminal` row anywhere ("no terminal phase", an unterminated state machine) → error naming the offending descriptor (kills an implementation that validates every individual step/finalizer/next value in isolation but never checks the table as a WHOLE has a terminal state — the generic runner\'s dispatch loop then has no phase it can legally stop advancing from)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const turnSpec = wellFormedTurnSpec();
    const phases = turnSpec.phases as Record<string, unknown>[];
    // Flip EVERY terminal row to `noop` (not remove them) so no `next`
    // becomes dangling — this isolates "no terminal phase" from
    // AT-R422-13's gap. (W7-C2: the fixture now carries TWO terminal rows —
    // committed AND rejected — so a single findIndex flip would leave a
    // terminal row standing and vacate this test.)
    turnSpec.phases = phases.map((p) => (p.step === 'terminal' ? { ...p, step: 'noop' } : p));
    writeSessionKindsYaml(root, [turnSpecDescriptor(turnSpec)]);

    const findings = turnspecFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/turnspec-no-terminal-phase');
    assert.ok(f, `expected a session-kinds/turnspec-no-terminal-phase finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('fixture-kind'), 'message must name the offending descriptor id');
  });

  it('AT-R422-16: duplicate `phase` names within one turnSpec.phases table → error naming the duplicated name (mirrors the existing CHECK_DUPLICATE_ID precedent for descriptor ids — a state machine with two rows claiming the same phase name is ambiguous: which "analyzing" does a `next: "analyzing"` elsewhere in the table actually mean?)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const turnSpec = wellFormedTurnSpec();
    const phases = turnSpec.phases as Record<string, unknown>[];
    // Append a duplicate — every EXISTING `next:` reference stays resolvable,
    // isolating "duplicate phase" from AT-R422-13's dangling-next gap.
    phases.push({ phase: 'analyzing', step: 'noop' });
    writeSessionKindsYaml(root, [turnSpecDescriptor(turnSpec)]);

    const findings = turnspecFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/turnspec-duplicate-phase');
    assert.ok(f, `expected a session-kinds/turnspec-duplicate-phase finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('analyzing'), 'message must name the duplicated phase name');
  });

  it('AT-R422-17: an EMPTY turnSpec.phases list → error naming the offending descriptor (kills an implementation that only does `for (const phase of ts.phases)` — a zero-length array makes that loop vacuously pass with no findings at all, silently accepting a turnSpec that can never run a single turn)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [turnSpecDescriptor({ ...wellFormedTurnSpec(), phases: [] })]);

    const findings = turnspecFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/turnspec-empty-phases');
    assert.ok(f, `expected a session-kinds/turnspec-empty-phases finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('fixture-kind'), 'message must name the offending descriptor id');
  });

  it('AT-R422-18: turnSpec.style "structured" → an HONEST error stating it is not usable until a schema is registered, NOT a silent pass (SCHEMA_IDS ships deliberately empty for R4-22 WI-1 — reviewer-confirmed by EXECUTION: today ANY `schema` value errors via turnspec-unknown-schema, which means a `structured` turnSpec can NEVER be made valid, yet nothing says so — a `structured` style with no `schema` field never even enters the schema-check branch, so it validates clean today); must NOT fire for style: "agent" (negative control — the ADR\'s only real worked example)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [turnSpecDescriptor({ ...wellFormedTurnSpec(), style: 'structured' })]);

    const findings = turnspecFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/turnspec-structured-unsupported');
    assert.ok(f, `expected a session-kinds/turnspec-structured-unsupported finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(/structured/i.test(f.message), `message must name the offending style value, got: ${f.message}`);
    assert.ok(/schema/i.test(f.message), `message must explain WHY — no schema is registered yet (SCHEMA_IDS is empty) — not just reject blindly, got: ${f.message}`);

    const agentRoot = makeForgeRoot();
    writeAgentSkill(agentRoot, 'fixture-agent');
    writeSessionKindsYaml(agentRoot, [turnSpecDescriptor(wellFormedTurnSpec())]);
    const agentFindings = turnspecFindings(validateSessionKinds(agentRoot));
    assert.ok(
      !agentFindings.some((x) => x.check === 'session-kinds/turnspec-structured-unsupported'),
      `style: "agent" must never trip the structured-unsupported check, got: ${JSON.stringify(agentFindings)}`,
    );
  });
});

describe('loadSessionKinds — the six new graph-coherence checks are STRUCTURAL ONLY too (AT-R422-19, extends AT-16/AT-R422-6\'s split to every check added in AT-R422-11..18)', () => {
  it('AT-R422-19: a SINGLE turnSpec combining all six new graph-coherence defects at once (unsafe kindDir, dangling next, a finalize phase missing its finalizer key, no terminal phase, a duplicate phase name, and style: structured) does NOT throw at load time, and the parsed descriptor carries every offending value through UNMODIFIED — semantic rejection is validateSessionKinds\'s job alone, exactly like every pre-existing field in this module (AT-16); validateSessionKinds then independently flags EACH of the six on that SAME carried-through evidence', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const kitchenSinkTurnSpec: Record<string, unknown> = {
      kindDir: '..',
      style: 'structured',
      phases: [
        { phase: 'analyzing', step: 'agent', writes: ['staging'], next: 'phase-that-does-not-exist' },
        { phase: 'awaiting-review', step: 'noop' },
        { phase: 'committing', step: 'finalize', next: 'committed' }, // finalizer key genuinely absent
        { phase: 'committed', step: 'noop' }, // was terminal — table now has none
        { phase: 'analyzing', step: 'noop' }, // duplicate of phases[0]'s name
      ],
    };
    writeSessionKindsYaml(root, [turnSpecDescriptor(kitchenSinkTurnSpec)]);

    let descs: SessionKindDescriptor[] = [];
    assert.doesNotThrow(() => { descs = loadSessionKinds(root); }, 'loadSessionKinds must not throw on a semantically-incoherent-but-structurally-valid turnSpec');
    assert.equal(descs.length, 1);
    assert.deepEqual(
      (descs[0] as SessionKindDescriptor & { turnSpec?: unknown }).turnSpec,
      kitchenSinkTurnSpec,
      'the loader must carry every offending value through unmodified — the same evidence validateSessionKinds then independently flags',
    );

    const findings = turnspecFindings(validateSessionKinds(root));
    const checks = new Set(findings.map((f) => f.check));
    for (const expected of [
      'session-kinds/turnspec-unsafe-kind-dir',
      'session-kinds/turnspec-dangling-next',
      'session-kinds/turnspec-finalize-missing-finalizer',
      'session-kinds/turnspec-no-terminal-phase',
      'session-kinds/turnspec-duplicate-phase',
      'session-kinds/turnspec-structured-unsupported',
    ]) {
      assert.ok(
        checks.has(expected),
        `expected validateSessionKinds to independently flag "${expected}" on the SAME evidence the loader carried through unmodified, got checks: ${[...checks].join(', ')}`,
      );
    }
  });
});

