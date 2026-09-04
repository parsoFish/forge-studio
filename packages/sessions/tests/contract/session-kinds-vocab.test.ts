import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SESSION_STAGES, SESSION_ARTIFACT_KINDS, sessionArtifactKindState, loadSessionKinds, type SessionKindDescriptor } from '../../studio/session-kinds.ts';
import { validateSessionKinds } from '../../studio/session-kinds-validate.ts';

import { baseDescriptor, byId, makeForgeRoot, writeAgentSkill, writeSessionKindsYaml } from './test-fixtures/session-kinds-core.ts';

// ===========================================================================
// Vocabularies (AT-1, AT-2)
// ===========================================================================

describe('SESSION_STAGES + SESSION_ARTIFACT_KINDS — closed vocabularies', () => {
  // AT-1 UPDATED (R4-21, documented edit — T3, fulfils the RED-1a pin): the
  // frozen 6-token SESSION_STAGES vocabulary gains its FIRST-EVER extension —
  // a 7th token, 'authoring', backing the new single-stage `authoring`
  // session kind (creation-agent). Appended at the end (it is a standalone
  // single-stage session, unrelated to the ordered onboarding sequence
  // contract→instructions→secrets→demo→roadmap→brain the other 6 tokens
  // encode).
  //
  // W6-CR-3 briefly added 'community' as a SECOND extension — an 8th token,
  // backing the `community-refresh` session kind. W8-B5b retired that kind
  // (superseded by the deterministic `forge community refresh` mechanism)
  // and 'community' had no other consumer, so the vocabulary reverts to the
  // 7-token set this test now pins.
  it('AT-1: SESSION_STAGES is exactly the 7-token ordered vocabulary (R4-21 adds "authoring"), frozen', () => {
    assert.deepEqual([...SESSION_STAGES], ['contract', 'instructions', 'secrets', 'demo', 'roadmap', 'brain', 'authoring']);
    assert.ok(
      (SESSION_STAGES as readonly string[]).includes('authoring'),
      'RED-1a: SESSION_STAGES must include the "authoring" token',
    );
    assert.ok(
      !(SESSION_STAGES as readonly string[]).includes('community'),
      'W8-B5b: SESSION_STAGES must NOT include "community" — its only consumer, community-refresh, was retired',
    );
    assert.ok(Object.isFrozen(SESSION_STAGES), 'SESSION_STAGES must be frozen — a closed vocabulary is never mutated at runtime');
  });

  it('AT-2: SESSION_ARTIFACT_KINDS carries exactly 7 live + 0 reserved rows, in order, frozen (R4-16: generation-gallery flips reserved→live; R4-17: contract-buildout flips reserved→live, deriveContractBuildout wires the onboarding session\'s renderer; R4-21: file-package flips reserved→live, the creation-agent authoring session\'s renderer; R4-19-F2: cleanup-plan lands as a brand-new LIVE row, the brain-maintenance kb-cleanup session\'s renderer)', () => {
    const ids = SESSION_ARTIFACT_KINDS.map((k) => k.id);
    // R4-19-F2 (this edit): cleanup-plan is a NEW row (not a reserved→live
    // flip like its predecessors) — asserted as a SET, not a bare count, so
    // an implementation that lands a 7th row under the wrong id, or in the
    // wrong declared position, is still caught (a count alone cannot
    // distinguish "cleanup-plan appended last" from "some other row added").
    assert.deepEqual(ids, ['roadmap-draft', 'markdown-draft', 'brain-structure', 'file-package', 'contract-buildout', 'generation-gallery', 'cleanup-plan']);
    const live = SESSION_ARTIFACT_KINDS.filter((k) => k.status === 'live').map((k) => k.id);
    const reserved = SESSION_ARTIFACT_KINDS.filter((k) => k.status === 'reserved').map((k) => k.id);
    // R4-17: contract-buildout now has a real renderer (the onboarding
    // session's contractStages-consuming case in deriveSessionArtifact,
    // session-transcript.ts) — the row flips to live. Declaration ORDER is
    // unchanged (contract-buildout still sits between file-package and
    // generation-gallery); only its status flips, so the LIVE set gains it
    // at its DECLARED position (before generation-gallery), not appended at
    // the end.
    // R4-21 (this round): file-package — the LAST remaining reserved row —
    // also flips to live, backing the creation-agent authoring session's
    // deriveSessionArtifact case. This makes the whole vocabulary 6-live /
    // 0-reserved. This assertion is RED at branch base — today's real
    // session-kinds.ts still lists file-package reserved — and is the pin
    // for that flip (kills an implementation that ships the authoring
    // session's renderer but forgets to promote the row, leaving the
    // authoring descriptor a permanent lint error per validateSessionKinds's
    // reserved-artifact-kind check).
    // R4-19-F2 (stale-count fix — this edit): with the reserved set already
    // empty (R4-21 emptied it), cleanup-plan cannot be a reserved→live flip;
    // it lands as a brand-new row, appended last, straight to 'live'. This
    // grows the live set to 7 without ever re-opening the reserved set —
    // kills an implementation that ships cleanup-plan as 'reserved' (the
    // deriveSessionArtifact renderer already exists, so that would be a
    // permanent lint error) or that inserts it anywhere but the declared
    // last position.
    assert.deepEqual(live, ['roadmap-draft', 'markdown-draft', 'brain-structure', 'file-package', 'contract-buildout', 'generation-gallery', 'cleanup-plan']);
    assert.deepEqual(reserved, [], 'R4-21 empties the reserved set entirely — file-package was the last row; R4-19-F2\'s cleanup-plan never touches it (this edit)');
    assert.ok(Object.isFrozen(SESSION_ARTIFACT_KINDS));
  });

  it('AT-3: sessionArtifactKindState is a total function — live/reserved/unknown, never throws', () => {
    assert.equal(sessionArtifactKindState('roadmap-draft'), 'live');
    assert.equal(sessionArtifactKindState('brain-structure'), 'live');
    // R4-21 (this round): file-package is now LIVE, not reserved — kills a
    // vocabulary edit that flips SESSION_ARTIFACT_KINDS's declaration
    // without also flipping this total function's answer (same evidence as
    // AT-2, checked through the OTHER accessor). RED at branch base — the
    // real, unmodified session-kinds.ts still answers 'reserved' here.
    assert.equal(sessionArtifactKindState('file-package'), 'live');
    // R4-16 AT-21: generation-gallery is now LIVE, not reserved — kills a
    // vocabulary edit that flips SESSION_ARTIFACT_KINDS's declaration
    // without also flipping this total function's answer (they read the
    // same frozen array, so a real implementation cannot diverge here — this
    // is the same evidence as AT-2, checked through the OTHER accessor).
    assert.equal(sessionArtifactKindState('generation-gallery'), 'live');
    // R4-17: contract-buildout is now LIVE, not reserved — same evidence as
    // AT-2's flip, checked through this OTHER accessor (kills an
    // implementation that flips the array row but sessionArtifactKindState
    // somehow still answers stale — impossible if it genuinely reads the
    // same frozen array, but that is exactly the invariant this pins).
    assert.equal(sessionArtifactKindState('contract-buildout'), 'live');
    assert.equal(sessionArtifactKindState('no-such-kind-at-all'), undefined, 'an unrecognised kind must resolve to undefined, never a guess and never a throw');
  });
});

// ===========================================================================
// loadSessionKinds — structural parse only (AT-4, AT-5)
// ===========================================================================

describe('loadSessionKinds — structural parse (fixture-driven)', () => {
  it('AT-4: parses a valid 3-descriptor fixture; ids unique; shape matches SessionKindDescriptor', () => {
    const root = makeForgeRoot();
    writeSessionKindsYaml(root, [
      baseDescriptor({ id: 'alpha', agent: 'alpha-agent' }),
      baseDescriptor({ id: 'beta', agent: 'beta-agent' }),
      baseDescriptor({ id: 'gamma', agent: 'gamma-agent' }),
    ]);
    const descs = loadSessionKinds(root);
    assert.equal(descs.length, 3);
    assert.deepEqual(descs.map((d) => d.id).sort(), ['alpha', 'beta', 'gamma']);
    const alpha = byId(descs, 'alpha');
    assert.equal(alpha.agent, 'alpha-agent');
    assert.equal(alpha.title, 'Fixture Kind');
    assert.deepEqual(alpha.legacyRoutes, ['/fixture/[sessionId]']);
    assert.deepEqual(alpha.stages, ['roadmap']);
    assert.equal(alpha.defaultStage, 'roadmap');
    assert.deepEqual(alpha.artifact, { kind: 'roadmap-draft', label: 'Fixture draft' });
  });

  it('AT-5: order is deterministic — a reverse-alpha fixture is returned in DECLARATION order, never silently resorted', () => {
    const root = makeForgeRoot();
    writeSessionKindsYaml(root, [
      baseDescriptor({ id: 'zzz-kind', agent: 'z-agent' }),
      baseDescriptor({ id: 'mmm-kind', agent: 'm-agent' }),
      baseDescriptor({ id: 'aaa-kind', agent: 'a-agent' }),
    ]);
    const ids = loadSessionKinds(root).map((d) => d.id);
    assert.deepEqual(ids, ['zzz-kind', 'mmm-kind', 'aaa-kind'], 'loadSessionKinds must preserve YAML declaration order, not re-sort alphabetically');
  });
});

// ===========================================================================
// validateSessionKinds — semantic errors, each its own AT (AT-6..AT-15)
// ===========================================================================

describe('validateSessionKinds — semantic errors', () => {
  it('AT-6: a stage token outside SESSION_STAGES → error naming the value and the allowed set', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [baseDescriptor({ stages: ['not-a-real-stage'], defaultStage: 'not-a-real-stage' })]);
    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/unknown-stage');
    assert.ok(f, `expected a session-kinds/unknown-stage finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('not-a-real-stage'), 'message must name the offending value');
    for (const s of SESSION_STAGES) assert.ok(f!.message.includes(s), `message must name the allowed set (missing "${s}")`);
  });

  it('AT-7: defaultStage not a member of the descriptor\'s OWN stages → error naming both', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [baseDescriptor({ stages: ['roadmap'], defaultStage: 'brain' })]);
    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/default-stage-not-in-stages');
    assert.ok(f, `expected a session-kinds/default-stage-not-in-stages finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('brain'), 'message must name the offending defaultStage');
    assert.ok(f!.message.includes('roadmap'), 'message must name the descriptor\'s own declared stages');
  });

  it('AT-8: an empty stages list → error', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [baseDescriptor({ stages: [] })]);
    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/empty-stages');
    assert.ok(f, `expected a session-kinds/empty-stages finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('fixture-kind'), 'message must name the offending descriptor id');
  });

  it('AT-9: an artifact kind outside SESSION_ARTIFACT_KINDS entirely → error naming the value and the allowed set', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [baseDescriptor({ artifact: { kind: 'no-such-kind-at-all', label: 'x' } })]);
    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/unknown-artifact-kind');
    assert.ok(f, `expected a session-kinds/unknown-artifact-kind finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('no-such-kind-at-all'));
    for (const k of SESSION_ARTIFACT_KINDS.map((x) => x.id)) assert.ok(f!.message.includes(k), `message must name the allowed set (missing "${k}")`);
  });

  // AT-10 RETARGETED (R4-21, documented edit — T3): this AT used
  // 'file-package' as its "IS a reserved row" fixture — but file-package is
  // THE row R4-21 flips reserved→live, and (per AT-2) it was already the
  // LAST reserved row in the whole vocabulary, so after this round
  // SESSION_ARTIFACT_KINDS carries ZERO reserved rows — there is no other
  // real kind left to build a fresh "still-reserved" fixture from. Deleting
  // this AT outright would silently drop the "reserved vs unknown are
  // DISTINCT findings" coverage it also carried; instead it is retargeted
  // (mirrors the ruling on session-transcript.test.ts's AT-34, same file
  // pair, same reason) to pin the INVERSE now that the flip has landed: a
  // descriptor declaring file-package produces ZERO reserved-artifact-kind
  // findings AND zero unknown-artifact-kind findings — proving the flip
  // reaches THIS validator (not just the raw SESSION_ARTIFACT_KINDS/
  // sessionArtifactKindState accessors AT-2/AT-3 already cover). RED at
  // branch base: today's real, unmodified session-kinds.ts still lists
  // file-package reserved, so this descriptor DOES trip
  // reserved-artifact-kind today — the assertion below fails until the flip
  // lands.
  it('AT-10 (retargeted, R4-21): file-package, now live, trips NEITHER reserved-artifact-kind NOR unknown-artifact-kind', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [baseDescriptor({ artifact: { kind: 'file-package', label: 'x' } })]);
    const findings = validateSessionKinds(root);
    assert.ok(
      !findings.some((x) => x.check === 'session-kinds/reserved-artifact-kind'),
      `file-package must no longer trip reserved-artifact-kind once it is live, got: ${JSON.stringify(findings)}`,
    );
    assert.ok(
      !findings.some((x) => x.check === 'session-kinds/unknown-artifact-kind'),
      `file-package must resolve as a KNOWN (live) kind, never fall through to unknown-artifact-kind, got: ${JSON.stringify(findings)}`,
    );
  });

  it('AT-11: duplicate descriptor ids → error naming the id', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [baseDescriptor({ id: 'dupe' }), baseDescriptor({ id: 'dupe' })]);
    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/duplicate-id');
    assert.ok(f, `expected a session-kinds/duplicate-id finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('dupe'));
  });

  it('AT-12: an agent ref that resolves to no real agent definition → error naming BOTH the offending value AND the known-agent set (strengthened — mirrors AT-6/AT-9\'s shape, a reviewer-flagged gap)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'real-agent-fixture');
    writeAgentSkill(root, 'another-real-agent-fixture');
    writeSessionKindsYaml(root, [baseDescriptor({ agent: 'ghost-agent-does-not-exist' })]);
    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/unknown-agent');
    assert.ok(f, `expected a session-kinds/unknown-agent finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('ghost-agent-does-not-exist'), 'message must name the offending agent id');
    // Strengthened: AT-6 (unknown stage) and AT-9 (unknown artifact kind)
    // both enumerate the full allowed set in their message — the unknown-agent
    // message must meet the same bar, not just name the bad value in isolation.
    assert.ok(f!.message.includes('real-agent-fixture'), `message must enumerate the known-agent set (missing "real-agent-fixture"), got: ${f!.message}`);
    assert.ok(f!.message.includes('another-real-agent-fixture'), `message must enumerate the known-agent set (missing "another-real-agent-fixture"), got: ${f!.message}`);
  });

  it('AT-13: a missing studio/session-kinds.yaml → loadSessionKinds throws; validateSessionKinds returns exactly one error finding, never a silent empty list', () => {
    const root = makeForgeRoot();
    // No studio/ dir at all — the file is entirely absent.
    assert.throws(() => loadSessionKinds(root), 'loadSessionKinds must throw on a missing file (mirrors loadFlowDefinition/loadCatalog)');
    const findings = validateSessionKinds(root);
    assert.equal(findings.length, 1, `expected exactly 1 finding on a missing file, got: ${JSON.stringify(findings)}`);
    assert.equal(findings[0].check, 'session-kinds/load-error');
    assert.equal(findings[0].level, 'error');
    assert.ok(findings[0].message.length > 0);
  });

  it('AT-14: a malformed (unparseable) session-kinds.yaml → loadSessionKinds throws; validateSessionKinds returns exactly one error finding naming the file', () => {
    const root = makeForgeRoot();
    const dir = join(root, 'studio');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'session-kinds.yaml');
    writeFileSync(p, '- id: broken\n    this is not valid yaml: [\n', 'utf8');
    assert.throws(() => loadSessionKinds(root));
    const findings = validateSessionKinds(root);
    assert.equal(findings.length, 1, `expected exactly 1 finding on malformed YAML, got: ${JSON.stringify(findings)}`);
    assert.equal(findings[0].check, 'session-kinds/load-error');
    assert.equal(findings[0].level, 'error');
    assert.ok(findings[0].message.includes('session-kinds.yaml'), 'message must name the offending file');
  });

  it('AT-15: a descriptor id that is not a valid slug → error', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [baseDescriptor({ id: 'Not_A_Valid_Slug' })]);
    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/slug');
    assert.ok(f, `expected a session-kinds/slug finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('Not_A_Valid_Slug'));
  });
});

// ===========================================================================
// Defense-in-depth — validate reads the SAME evidence load does (AT-16)
// ===========================================================================

describe('defense-in-depth — validate must not check a more permissive parse than load', () => {
  it('AT-16: loadSessionKinds ACCEPTS a descriptor with an unknown stage (structural parse is lenient); validateSessionKinds still flags the SAME value', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [baseDescriptor({ stages: ['not-a-real-stage'], defaultStage: 'not-a-real-stage' })]);

    // The loader must not throw or drop the descriptor — semantic validation
    // is validateSessionKinds's job, not the loader's.
    let descs: SessionKindDescriptor[] = [];
    assert.doesNotThrow(() => { descs = loadSessionKinds(root); });
    assert.equal(descs.length, 1);
    assert.deepEqual(descs[0].stages, ['not-a-real-stage'], 'the loader must carry the same offending value through, unmodified');

    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/unknown-stage');
    assert.ok(f, 'validateSessionKinds must flag the exact value the loader accepted — the same evidence, not a different, more permissive parse');
    assert.ok(f!.message.includes('not-a-real-stage'));
  });
});

