import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadSessionKinds } from '../../studio/session-kinds.ts';
import { validateSessionKinds } from '../../studio/session-kinds-validate.ts';

import { REPO_ROOT, baseDescriptor, byId, makeForgeRoot, writeAgentSkill, writeForgeUiRoute, writeSessionKindsYaml } from './test-fixtures/session-kinds-core.ts';

// ===========================================================================
// Real repo (AT-17, AT-18)
// ===========================================================================

describe('the real repo (studio/session-kinds.yaml) lints clean and matches the spec exactly', () => {
  it('AT-17: validateSessionKinds(REPO_ROOT) returns ZERO error-level findings — including zero unknown-agent errors, even though instructions-creator and project-brain-builder are both `library: false` internal agents', () => {
    const findings = validateSessionKinds(REPO_ROOT);
    const errors = findings.filter((f) => f.level === 'error');
    assert.deepEqual(errors, [], `expected 0 error-level findings in the real repo, got: ${JSON.stringify(errors)}`);
  });

  it('AT-18: loadSessionKinds(REPO_ROOT) returns EXACTLY the 7 shipped descriptors with their pinned real ids/agents/stages/defaultStage/artifact kinds+labels (R4-16 adds "demo"; R4-17 adds "onboarding"; R4-21 adds "authoring"; R4-19-F2 adds "kb-cleanup"; W6-CR-3\'s "community-refresh" was retired in W8-B5b)', () => {
    const descs = loadSessionKinds(REPO_ROOT);
    assert.equal(descs.length, 7, `expected exactly 7 real session kinds (R4-16 adds "demo", R4-17 adds "onboarding", R4-21 adds "authoring", R4-19-F2 adds "kb-cleanup"; W6-CR-3's "community-refresh" was retired in W8-B5b), got ids: ${descs.map((d) => d.id).join(', ')}`);
    // R4-19-F2 (this edit): the length check alone cannot tell "kb-cleanup
    // landed" apart from "some other 7th row landed under a wrong id" — this
    // set-equality assertion pins the exact membership (order-independent;
    // declaration order in the yaml is not this AT's concern, the individual
    // per-descriptor checks below are) so a wrong-row-added regression is
    // caught here, not silently passed through to the specific `byId` probes
    // below (which would simply not find a bogus id and throw on `!`).
    assert.deepEqual(
      descs.map((d) => d.id).sort(),
      ['architect', 'authoring', 'demo', 'instructions', 'kb-cleanup', 'onboarding', 'project-brain'].sort(),
      `expected exactly this 7-id set, got: ${descs.map((d) => d.id).join(', ')}`,
    );

    const architect = byId(descs, 'architect');
    assert.equal(architect.agent, 'architect');
    // W6-IA-8: /architect/[sessionId] + /architect/[sessionId]/interview were
    // pure path-shape moves, converted to next.config.mjs `redirects()`
    // entries with their page directories deleted outright — legacyRoutes is
    // now honestly [] (see studio/session-kinds.yaml's own comment).
    assert.deepEqual(architect.legacyRoutes, []);
    assert.deepEqual(architect.stages, ['roadmap']);
    assert.equal(architect.defaultStage, 'roadmap');
    assert.deepEqual(architect.artifact, { kind: 'roadmap-draft', label: 'Roadmap draft' });

    const instructions = byId(descs, 'instructions');
    assert.equal(instructions.agent, 'instructions-creator');
    // W6-IA-8: /instructions/[sessionId] converted to a next.config.mjs
    // `redirects()` entry, page directory deleted — legacyRoutes is now [].
    assert.deepEqual(instructions.legacyRoutes, []);
    assert.deepEqual(instructions.stages, ['instructions']);
    assert.equal(instructions.defaultStage, 'instructions');
    assert.deepEqual(instructions.artifact, { kind: 'markdown-draft', label: 'AGENTS.md draft' });

    const projectBrain = byId(descs, 'project-brain');
    assert.equal(projectBrain.agent, 'project-brain-builder');
    // W6-IA-8: /project-brain/[sessionId] converted to a next.config.mjs
    // `redirects()` entry, page directory deleted — legacyRoutes is now [].
    assert.deepEqual(projectBrain.legacyRoutes, []);
    assert.deepEqual(projectBrain.stages, ['brain']);
    assert.equal(projectBrain.defaultStage, 'brain');
    assert.deepEqual(projectBrain.artifact, { kind: 'brain-structure', label: 'Seeded structure' });

    // R4-16 AT-22: the new "demo" session kind. id is "demo" — NOT
    // "demo-builder" — because the bridge derives the session dir as
    // <projectsRoot>/<project>/_<descriptor.id>/<sessionId>, and real
    // demo-builder sessions live under _demo/<sid> (kills an implementation
    // that names the descriptor after the agent slug instead of the real
    // on-disk directory prefix). legacyRoutes:[] is legal (AT-51: an empty
    // list is never itself an error) — this is a brand-new session shell,
    // not a replacement for a pre-existing page.
    const demo = byId(descs, 'demo');
    assert.equal(demo.agent, 'demo-builder');
    assert.deepEqual(demo.legacyRoutes, []);
    assert.deepEqual(demo.stages, ['demo']);
    assert.equal(demo.defaultStage, 'demo');
    assert.deepEqual(demo.artifact, { kind: 'generation-gallery', label: 'Demo generations' });

    // R4-17: the new "onboarding" session kind (D1 — ONE descriptor shared by
    // both onboarding AND creation, D2 — the five-stage vocabulary drawn
    // straight from SESSION_STAGES minus "brain", D9's project-page-facing
    // artifact.label). legacyRoutes:[] — onboarding has never had a session
    // page before this initiative (evidence #3 in the spec: onboarding-agent
    // was a fire-and-forget dispatch with no session dir at all).
    const onboarding = byId(descs, 'onboarding');
    assert.equal(onboarding.agent, 'onboarding-agent');
    assert.deepEqual(onboarding.legacyRoutes, []);
    assert.deepEqual(
      onboarding.stages,
      ['contract', 'instructions', 'secrets', 'demo', 'roadmap'],
      'stages must be the D2 five-stage vocabulary, in this exact order — never including "brain" (project-brain owns that stage), never a parallel vocabulary',
    );
    assert.equal(onboarding.defaultStage, 'contract');
    assert.deepEqual(
      onboarding.artifact,
      { kind: 'contract-buildout', label: 'Contract build-out' },
      'the label is verbatim from the retired studio-endstate-v2 mockup (data.jsx SESSIONS[\'project-onboarding\'].artifactLabel; docs/reference/studio-copy.md) — pinned exactly, not paraphrased',
    );

    // R4-21: the new "authoring" session kind (creation-agent, file-package —
    // this file's RED-1a..1d above pin the SESSION_STAGES/SESSION_ARTIFACT_KINDS
    // vocabulary extensions this descriptor relies on). legacyRoutes:[] —
    // there was no predecessor authoring session ROUTE before this initiative
    // (creation-agent is new). A single-stage session: 'authoring' is
    // SESSION_STAGES's first-ever extension, unrelated to the ordered
    // onboarding sequence the other six tokens encode.
    const authoring = byId(descs, 'authoring');
    assert.equal(authoring.agent, 'creation-agent');
    assert.deepEqual(authoring.legacyRoutes, []);
    assert.deepEqual(authoring.stages, ['authoring']);
    assert.equal(authoring.defaultStage, 'authoring');
    assert.deepEqual(authoring.artifact, { kind: 'file-package', label: 'Package' });
    // W6-CR-3 once added a "community-refresh" descriptor here (reusing
    // 'file-package', its own 'community' SESSION_STAGES extension); it was
    // retired in W8-B5b, superseded by the deterministic `forge community
    // refresh` mechanism, so this descriptor no longer exists.
  });
});

// ===========================================================================
// R4-21 — the new `authoring` session kind (creation-agent, file-package)
// (RED-1c, RED-1d — T3 pins for the OOTB authoring agent / skill-hook
// package producer). Mirrors AT-6 (unknown-stage) and AT-12 (unknown-agent)'s
// existing shapes exactly — see those tests above for the sibling idiom this
// section follows.
// ===========================================================================

describe('R4-21 — the "authoring" session kind (creation-agent, file-package)', () => {
  // RED-1c: isolates the unknown-agent CHECK specifically — the descriptor's
  // stage/artifact fields are deliberately kept on TODAY's already-valid
  // vocabulary (stages:['roadmap'], artifact.kind:'roadmap-draft') so this
  // assertion is not entangled with RED-1a/RED-1d's SEPARATE "authoring" is
  // not yet a member of SESSION_STAGES concern. `discoverRuntimeAgentIds` is
  // strictly `skillsDir(forgeRoot)`-scoped with no fallback to the real repo
  // (confirmed empirically — a fixture root with no seeded skills/ dir at all
  // can never resolve "creation-agent" regardless of what exists on disk
  // elsewhere), so this fixture seeds it via `writeAgentSkill` exactly like
  // every other positive-case fixture in this file (AT-6/7/12's own idiom) —
  // `libraryFalse: true` since the real creation-agent ships `library: false`
  // (an operator-driven bridge-dispatched helper, mirrors demo-builder/
  // instructions-creator, never part of the composable Studio roster).
  it('RED-1c: a descriptor whose agent is "creation-agent" resolves via discoverRuntimeAgentIds with zero unknown-agent findings', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'creation-agent', { libraryFalse: true });
    writeSessionKindsYaml(root, [
      baseDescriptor({ id: 'authoring', agent: 'creation-agent', stages: ['roadmap'], defaultStage: 'roadmap', artifact: { kind: 'roadmap-draft', label: 'Authored package' } }),
    ]);
    const findings = validateSessionKinds(root);
    const unknownAgentFindings = findings.filter((f) => f.check === 'session-kinds/unknown-agent');
    assert.deepEqual(
      unknownAgentFindings,
      [],
      `expected zero unknown-agent findings once creation-agent resolves as a real runtime-bearing skill, got: ${JSON.stringify(unknownAgentFindings)}`,
    );
  });

  // RED-1d (fail-closed, mirrors AT-6 exactly): proves the vocabulary stays
  // CLOSED even after this round's extension — an out-of-vocabulary stage
  // token must still be rejected, and the rejection message must enumerate
  // the FULL, now-7-token allowed set (not just the 6 tokens SESSION_STAGES
  // carries today). The 7 expected tokens are hardcoded here (not read off
  // the live SESSION_STAGES import) deliberately — reading them off the
  // import would make this assertion trivially self-fulfilling regardless of
  // whether "authoring" was ever actually added, which is exactly the
  // declared-data-fails-open shape this module's own header warns against.
  it('RED-1d: a stage token outside SESSION_STAGES still yields session-kinds/unknown-stage naming the value + the FULL 7-token allowed set (proves the vocab stays closed after the "authoring" extension)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [baseDescriptor({ stages: ['not-a-real-stage'], defaultStage: 'not-a-real-stage' })]);
    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/unknown-stage');
    assert.ok(f, `expected a session-kinds/unknown-stage finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
    assert.ok(f!.message.includes('not-a-real-stage'), 'message must name the offending value');
    const expectedSevenTokens = ['contract', 'instructions', 'secrets', 'demo', 'roadmap', 'brain', 'authoring'];
    for (const s of expectedSevenTokens) {
      assert.ok(f!.message.includes(s), `message must name the full 7-token allowed set (missing "${s}") — got: ${f!.message}`);
    }
  });
});

// ===========================================================================
// A3 — legacyRoutes is no longer declared-data-fails-open (AT-49..52)
// ===========================================================================

describe('validateSessionKinds — legacyRoutes must resolve to a real apps/studio/app/ route (AT-amendment-2, A3)', () => {
  it('AT-49: a legacyRoutes entry that does not correspond to a real apps/studio/app/ directory → error naming ONLY the bogus entry, not the sibling that DOES resolve', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]'); // this one is real
    // '/totally-bogus-route/[sessionId]' has NO matching apps/studio/app/ dir.
    writeSessionKindsYaml(root, [
      baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', '/totally-bogus-route/[sessionId]'] }),
    ]);
    const findings = validateSessionKinds(root);
    // Exactly ONE finding proves the real, resolving sibling route was never
    // flagged (a false positive would produce a second finding for it).
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 bogus-route finding (not the real sibling too), got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes('/totally-bogus-route/[sessionId]'), `message must name the offending route, got: ${routeFindings[0].message}`);
  });

  it('AT-50: an empty/blank legacyRoutes entry → error', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', ''] })]);
    const findings = validateSessionKinds(root);
    const f = findings.find((x) => x.check === 'session-kinds/legacy-route-not-found');
    assert.ok(f, `expected a session-kinds/legacy-route-not-found finding for the blank entry, got: ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
  });

  it('AT-51: an EMPTY legacyRoutes list → allowed, no finding (a future kind may declare none)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: [] })]);
    const findings = validateSessionKinds(root);
    assert.deepEqual(findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found'), [], 'an empty legacyRoutes list must never itself be an error');
  });

  it('AT-52: the real repo — all three shipped descriptors\' legacyRoutes resolve to real apps/studio/app/ directories (verified independently of the validator too)', () => {
    const findings = validateSessionKinds(REPO_ROOT);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.deepEqual(routeFindings, [], `expected 0 legacy-route-not-found findings in the real repo, got: ${JSON.stringify(routeFindings)}`);

    // Independent verification (not just trusting the validator under test):
    // every shipped legacyRoutes entry really does exist as a apps/studio/app/ dir.
    const descs = loadSessionKinds(REPO_ROOT);
    for (const d of descs) {
      for (const route of d.legacyRoutes) {
        const segments = route.replace(/^\//, '').split('/').filter((s) => s.length > 0);
        const dirPath = join(REPO_ROOT, 'apps', 'studio', 'app', ...segments);
        assert.ok(existsSync(dirPath), `expected "${dirPath}" (from legacyRoutes entry "${route}" on session kind "${d.id}") to exist`);
      }
    }
  });
});

// ===========================================================================
// A4 — YAML structural coverage gap (AT-53..56): these already work
// correctly against the shipped loader (loadSessionKindsSequence's
// `!Array.isArray(parsed)` guard, and parseSessionKindDescriptor's mapping
// guard) — reviewer-reproduced but previously UNPINNED. Each must yield
// EXACTLY ONE session-kinds/load-error finding, never a silent empty list.
// ===========================================================================

describe('validateSessionKinds — YAML structural coverage (AT-amendment-2, A4)', () => {
  function writeRawYaml(root: string, content: string): void {
    const dir = join(root, 'studio');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'session-kinds.yaml'), content, 'utf8');
  }

  function assertExactlyOneLoadError(root: string): void {
    assert.throws(() => loadSessionKinds(root), 'loadSessionKinds must throw — this is a structural violation, not a semantic one');
    const findings = validateSessionKinds(root);
    assert.equal(findings.length, 1, `expected exactly 1 finding, got: ${JSON.stringify(findings)}`);
    assert.equal(findings[0].check, 'session-kinds/load-error');
    assert.equal(findings[0].level, 'error');
  }

  it('AT-53: top-level YAML parses to a MAP (not a sequence) → exactly one session-kinds/load-error finding', () => {
    const root = makeForgeRoot();
    writeRawYaml(root, 'id: not-a-sequence-at-all\nagent: whatever\n');
    assertExactlyOneLoadError(root);
  });

  it('AT-54: top-level YAML parses to a BARE SCALAR (a plain string) → exactly one session-kinds/load-error finding', () => {
    const root = makeForgeRoot();
    writeRawYaml(root, 'just a bare scalar string\n');
    assertExactlyOneLoadError(root);
  });

  it('AT-55: top-level YAML parses to NULL/empty (an empty file, and an explicit "null") → exactly one session-kinds/load-error finding, in BOTH cases', () => {
    const emptyRoot = makeForgeRoot();
    writeRawYaml(emptyRoot, '');
    assertExactlyOneLoadError(emptyRoot);

    const nullRoot = makeForgeRoot();
    writeRawYaml(nullRoot, 'null\n');
    assertExactlyOneLoadError(nullRoot);
  });

  it('AT-56: a sequence item that is a BARE STRING rather than a mapping → exactly one session-kinds/load-error finding', () => {
    const root = makeForgeRoot();
    writeRawYaml(root, '- "just a string, not a mapping"\n- id: also-irrelevant\n');
    assertExactlyOneLoadError(root);
  });
});

