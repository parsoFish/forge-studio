/**
 * Acceptance tests for orchestrator/studio/session-kinds.ts (R2-10, PR1: the
 * session-shell backend contract).
 *
 * The module under test does not exist yet — this file is RED at branch base
 * (ERR_MODULE_NOT_FOUND on the `./session-kinds.ts` import is the expected
 * red). Mirrors orchestrator/studio/template-library.ts / .test.ts's idiom:
 * real fs fixtures under mkdtempSync, plus the REAL repo (REPO_ROOT) for facts
 * that must stay true (the 3 shipped session kinds, their real agent ids).
 *
 * AT numbers below are a flat sequence AT-1..AT-48 spanning THREE files:
 *   AT-1  .. AT-18 — this file (session-kinds.ts)
 *   AT-19 .. AT-37 — orchestrator/studio/session-transcript.test.ts
 *   AT-38 .. AT-48 — cli/bridge-studio-sessions.test.ts
 * AT-amendment-2 round (T2-ratified, adversarial-review findings) adds:
 *   AT-49 .. AT-56 — this file (A3: legacyRoutes declared-data-fails-open;
 *                    A4: YAML structural coverage gap)
 *   AT-57 .. AT-58 — session-transcript.test.ts (A2: phase-driven pending)
 *   AT-59 .. AT-60 — bridge-studio-sessions.test.ts (A1: status.json symlink
 *                    escape blocker; A2 route-level re-ask case)
 * AT-amendment-3 round (fresh re-review of the amendment-2 fix, `8893ffcd`)
 * adds:
 *   AT-61 .. AT-67 — this file (A1: legacyRouteResolves has no containment
 *                    check — a regression the amendment-2 FIX ITSELF
 *                    introduced while closing the original declared-data
 *                    gap; see the AT-61..67 block below)
 *   AT-68 .. AT-69 — session-transcript.test.ts (A2: listDirEntries can
 *                    enumerate an outside directory when manifests/themes
 *                    is itself a dir-level symlink)
 *   AT-70 .. AT-74 — bridge-studio-sessions.test.ts (A3: the 404 message
 *                    buckets for every status.json failure shape)
 *
 * A3 (this file, AT-49..52): `legacyRoutes` was parsed, typed, and echoed
 * back, but never actually checked — declared-data-fails-open. New contract:
 * `validateSessionKinds` errors when a `legacyRoutes` entry is empty/blank OR
 * does not correspond to a real route directory under `forge-ui/app/` (route
 * path segments map 1:1 onto Next.js App Router directory names, including
 * literal `[sessionId]` dynamic-segment folders — e.g.
 * `/architect/[sessionId]/interview` → `forge-ui/app/architect/[sessionId]/interview`,
 * verified to exist on disk for AT-52).
 *
 * AT-amendment-3, A1 (this file, AT-61..67): the amendment-2 fix for A3
 * added `legacyRouteResolves(forgeRoot, route)`, which does
 * `existsSync(join(forgeRoot, 'forge-ui', 'app', ...segments))` with NO
 * check that the resolved path stays under `forge-ui/app/` — `path.join`
 * normalizes `..` segments before `existsSync` ever runs. A route entry
 * containing enough `..` escapes to ANY real directory (including, via
 * enough `..` segments to clamp past the filesystem root, arbitrary
 * absolute paths like `/etc`) and is wrongly accepted as "resolved". Every
 * AT below was empirically verified against the actual (unfixed)
 * `legacyRouteResolves`/`validateSessionKinds` before being written — see
 * each test's comment for whether it demonstrates a LIVE bypass (RED today)
 * or pins an already-safe shape (GREEN today, coverage only — reported
 * honestly per T2's brief, not disguised as a fresh catch).
 *
 * AT-R422-1 .. AT-R422-10 (this file) — R4-22 WI-1, ADR-043
 * (docs/decisions/043-generic-interactive-surface.md §1): the additive-optional
 * `turnSpec` field on SessionKindDescriptor. The module under test does NOT
 * carry `turnSpec`, `TURN_STYLES`, `TURN_STEPS`, `FINALIZER_IDS`, `SCHEMA_IDS`,
 * `turnStyleState`, `turnStepState`, `finalizerIdState`, or `schemaIdState` yet
 * — every AT-R422-* test is RED at branch base. Unlike the file's original
 * bring-up (where a missing STATIC import crashes the whole file), these use
 * a DYNAMIC `await import('./session-kinds.ts')` inside each test body so a
 * missing named export fails only that one test (the namespace object simply
 * has `undefined` for the missing key) — the pre-existing AT-1..AT-67 tests
 * keep running and passing throughout this file's RED phase.
 *
 * Design pinned here (proposed by T3; flagged as ambiguous in the report —
 * the ADR's worked example never exercises `schema` at all):
 *   - `turnSpec` shape: `{ kindDir, style, schema?, phases: [{ phase, step,
 *     writes?, next?, finalizer? }] }`. `schema` is a TOP-LEVEL optional
 *     field (a sibling of kindDir/style/phases), not per-phase — chosen
 *     because the ADR's only worked example (style: agent) never uses it,
 *     consistent with "structured-style sessions carry one schema" and
 *     avoiding inventing an un-cited 5th TURN_STEPS value.
 *   - Four frozen row-object registries (mirrors SESSION_ARTIFACT_KINDS's
 *     shape, not a bare string array, precisely so the deep-freeze-vs-shallow-
 *     freeze distinction is meaningful): `TURN_STYLES`, `TURN_STEPS`,
 *     `FINALIZER_IDS`, `SCHEMA_IDS`, each `readonly { id: string }[]`.
 *   - Four total lookup fns, one per registry, mirroring
 *     `sessionArtifactKindState`'s exact shape (`.find(...)?.id`, never
 *     throws, `undefined` for unknown): `turnStyleState`, `turnStepState`,
 *     `finalizerIdState`, `schemaIdState`.
 *   - New Finding check ids, mirroring the `session-kinds/unknown-*` family:
 *     `session-kinds/turnspec-unknown-style`, `-unknown-step`,
 *     `-unknown-finalizer`, `-unknown-schema`.
 *   - Validated set membership per AT-6/AT-9's shape: every error message
 *     names BOTH the offending value AND enumerates every id in the relevant
 *     imported registry (loop-based, self-adapting to however many ids the
 *     implementer seeds — including the degenerate case of an empty
 *     SCHEMA_IDS, which would make that one loop vacuous; see the T3 report).
 *
 * Design decisions this file pins (see the T3 report for the full rationale):
 *   - `studio/session-kinds.yaml` is a bare top-level YAML sequence of
 *     descriptor objects (mirrors nothing else in the repo exactly, but is
 *     the simplest shape for a single-purpose registry file).
 *   - `loadSessionKinds` is STRUCTURAL only (mirrors loadFlowDefinition /
 *     loadCatalog): it throws on missing file / unparseable YAML / a missing
 *     required scalar field, but does NOT validate closed-vocabulary
 *     membership (stage tokens, artifact kinds, agent refs, duplicate ids,
 *     slug shape) — those are SEMANTIC checks, live only in
 *     `validateSessionKinds`, exactly mirroring the load/validate split
 *     validate.ts already draws for agents/flows (validateAgent's slug check
 *     is a Finding, not a load-time throw).
 *   - Agent-ref resolution scans EVERY skill dir's SKILL.md (skills/<slug>/SKILL.md)
 *     with a `runtime:` block, REGARDLESS of `library: false` — NOT `listAgentDefinitions()`,
 *     which deliberately excludes `library: false` agents from the composable
 *     Studio roster (instructions-creator and project-brain-builder are both
 *     `library: false` internal agents dispatched by the bridge — see their
 *     SKILL.md frontmatter). Using `listAgentDefinitions()` for resolution
 *     would wrongly flag 2 of the 3 real session-kind descriptors. AT-17
 *     pins this against the real repo.
 *
 * AT-R422-11 .. AT-R422-19 (this file) — R4-22 WI-1 adversarial-review
 * findings (T3 gap-pin round): AT-R422-1..10 above proved WI-1 validates
 * turnSpec VOCABULARY MEMBERSHIP only (style/step/finalizer/schema each
 * resolve against a closed set) — but `turnSpec.phases` is a STATE MACHINE,
 * and its GRAPH COHERENCE is validated nowhere. Every gap below was
 * CONFIRMED BY EXECUTION against the real (unfixed) module before being
 * written — each loads clean, zero findings, today. New Finding check ids
 * (invented here, mirroring the `session-kinds/turnspec-unknown-*` naming
 * convention — the implementer must match these exact strings):
 *   `session-kinds/turnspec-unsafe-kind-dir`   (AT-R422-11, 12)
 *   `session-kinds/turnspec-dangling-next`     (AT-R422-13)
 *   `session-kinds/turnspec-finalize-missing-finalizer` (AT-R422-14)
 *   `session-kinds/turnspec-no-terminal-phase` (AT-R422-15)
 *   `session-kinds/turnspec-duplicate-phase`   (AT-R422-16)
 *   `session-kinds/turnspec-empty-phases`      (AT-R422-17)
 *   `session-kinds/turnspec-structured-unsupported` (AT-R422-18)
 * AT-R422-19 extends the AT-16/AT-R422-6 load/validate split to all six
 * graph-coherence checks in one combined fixture.
 *
 * CRITICAL for the implementer (AT-R422-12): `kindDir`'s sibling field
 * `d.id` is checked against `SLUG_RE` (`/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/`,
 * orchestrator/skill-path.ts) one screen up in the same function — but every
 * REAL `kindDir` value in this design is underscore-prefixed (`_authoring`,
 * `_architect`, `_demo`, ADR-043 §1's own worked example). SLUG_RE requires
 * a leading `a-z` letter, so it REJECTS every one of them. Reusing
 * SLUG_RE/CHECK_SLUG for kindDir would make every real shipped kindDir value
 * a lint error. The kindDir check must be a NEW, distinct "safe single path
 * segment" shape check (no separators, no `.`/`..`, no control characters —
 * mirrors `isSafeSegment` in cli/studio-path-guard.ts, which the generic
 * runner's own `resolveGuardedPath(projectRoot, [kindDir, sessionId])` relies
 * on one layer further down, but which nothing calls at LINT time today).
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import matter from 'gray-matter';

import {
  SESSION_STAGES,
  SESSION_ARTIFACT_KINDS,
  sessionArtifactKindState,
  loadSessionKinds,
  validateSessionKinds,
  FINALIZER_IDS,
  deriveSessionAffordances,
  type SessionKindDescriptor,
} from './session-kinds.ts';
// R4-19-F2 — the constraint test (ADR-043's whole point): a new interactive
// session kind must ride the EXISTING generic runInteractiveTurn spine, never
// a new AGENT_RUNNERS entry. Imported directly from the real production
// registry (cli/agent-run.ts), not re-derived, so the assertion below is
// against the actual dispatch table a "just add a fifth runner"
// implementation would touch. `cli/` importing FROM `orchestrator/studio/` is
// the established direction (this test file lives at
// orchestrator/studio/session-kinds.test.ts and imports cli/agent-run.ts, the
// mirror image of cli/agent-run.ts's own `import { loadSessionKinds } from
// '../orchestrator/studio/session-kinds.ts'` at its top) — no cycle: this
// TEST file is never itself imported by production code.
import { AGENT_RUNNERS } from '../../cli/agent-run.ts';
// The real Finding type (level/object/check/message) `validateSessionKinds`
// actually returns — imported directly rather than hand-narrowed/cast so the
// AT-R422-* assertions below typecheck against the SAME shape production
// code returns (TS2352 fix: a hand-narrowed `{ check: string }` local was
// too structurally distant from `{ level: string }` / `{ message: string }`
// for `as` to convert between them; the fix is a correct type, not a
// broader cast).
import type { Finding } from './validate.ts';
// Real production call path (Ruling 36): `runStudioLint` is what `forge
// studio lint` actually calls (cli/studio-lint.ts -> cmdStudioLint,
// orchestrator/cli.ts), and CI invokes exactly that command
// (.github/workflows/ci.yml: `node --experimental-strip-types
// orchestrator/cli.ts studio lint`). This import is STATIC (not dynamic)
// because runStudioLint already exists and works today — no RED risk here.
import { runStudioLint } from '../../cli/studio-lint.ts';
// SLUG_RE is the SAME regex CHECK_SLUG already applies one screen up in
// validateSessionKinds (`d.id` — the sibling field to `turnSpec.kindDir`).
// Imported directly (not re-derived) so AT-R422-12's sanity precondition
// tests the REAL regex the implementer might be tempted to reuse for
// kindDir, not a hand-copied guess of it.
import { SLUG_RE } from '../skill-path.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];

function makeForgeRoot(prefix = 'session-kinds-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

type FixtureDescriptor = {
  id: string;
  agent: string;
  title: string;
  legacyRoutes: string[];
  stages: string[];
  defaultStage: string;
  artifact: { kind: string; label: string };
};

function baseDescriptor(overrides: Partial<FixtureDescriptor> = {}): FixtureDescriptor {
  return {
    id: 'fixture-kind',
    agent: 'fixture-agent',
    title: 'Fixture Kind',
    legacyRoutes: ['/fixture/[sessionId]'],
    stages: ['roadmap'],
    defaultStage: 'roadmap',
    artifact: { kind: 'roadmap-draft', label: 'Fixture draft' },
    ...overrides,
  };
}

/** Write `studio/session-kinds.yaml` from a list of plain descriptor objects. */
function writeSessionKindsYaml(root: string, descriptors: unknown[]): string {
  const dir = join(root, 'studio');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'session-kinds.yaml');
  writeFileSync(p, yaml.dump(descriptors), 'utf8');
  return p;
}

/** Write a minimal SKILL.md with a `runtime:` block (a resolvable agent),
 *  optionally `library: false` (an internal agent, still resolvable — this is
 *  the exact shape instructions-creator / project-brain-builder use). */
function writeAgentSkill(root: string, slug: string, opts: { libraryFalse?: boolean } = {}): void {
  const dir = join(root, 'skills', slug);
  mkdirSync(dir, { recursive: true });
  const data: Record<string, unknown> = {
    name: slug,
    description: `Fixture agent ${slug}.`,
    purpose: 'Fixture purpose.',
    composition: { skills: [], tools: [], mcps: [], guards: [] },
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
    brainAccess: 'none',
    interactivity: 'Fixture.',
    'allowed-tools': [],
    'disallowed-tools': [],
    budgets: {},
  };
  if (opts.libraryFalse) data.library = false;
  writeFileSync(join(dir, 'SKILL.md'), matter.stringify('\nFixture body.\n', data), 'utf8');
}

function byId(descs: readonly SessionKindDescriptor[], id: string): SessionKindDescriptor {
  const d = descs.find((x) => x.id === id);
  assert.ok(d, `expected descriptor "${id}" to be present`);
  return d!;
}

/** Creates a REAL `forge-ui/app/<...segments>/` directory under `root` for a
 *  legacyRoutes entry like `/fixture-kind/[sessionId]` — route path segments
 *  map 1:1 onto Next.js App Router directory names, including a literal
 *  `[sessionId]` dynamic-segment folder (verified against the real repo:
 *  `forge-ui/app/architect/[sessionId]/interview/page.tsx` exists on disk). */
function writeForgeUiRoute(root: string, routePath: string): void {
  const segments = routePath.replace(/^\//, '').split('/').filter((s) => s.length > 0);
  mkdirSync(join(root, 'forge-ui', 'app', ...segments), { recursive: true });
}

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
  // W6-CR-3 (this edit): 'community' is the SECOND extension — an 8th
  // token, mirroring 'authoring's own precedent exactly, backing the new
  // single-stage `community-refresh` session kind.
  it('AT-1: SESSION_STAGES is exactly the 8-token ordered vocabulary (R4-21 adds "authoring", W6-CR-3 adds "community"), frozen', () => {
    assert.deepEqual([...SESSION_STAGES], ['contract', 'instructions', 'secrets', 'demo', 'roadmap', 'brain', 'authoring', 'community']);
    assert.ok(
      (SESSION_STAGES as readonly string[]).includes('authoring'),
      'RED-1a: SESSION_STAGES must include the "authoring" token',
    );
    assert.ok(
      (SESSION_STAGES as readonly string[]).includes('community'),
      'W6-CR-3: SESSION_STAGES must include the new "community" token',
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

// ===========================================================================
// Real repo (AT-17, AT-18)
// ===========================================================================

describe('the real repo (studio/session-kinds.yaml) lints clean and matches the spec exactly', () => {
  it('AT-17: validateSessionKinds(REPO_ROOT) returns ZERO error-level findings — including zero unknown-agent errors, even though instructions-creator and project-brain-builder are both `library: false` internal agents', () => {
    const findings = validateSessionKinds(REPO_ROOT);
    const errors = findings.filter((f) => f.level === 'error');
    assert.deepEqual(errors, [], `expected 0 error-level findings in the real repo, got: ${JSON.stringify(errors)}`);
  });

  it('AT-18: loadSessionKinds(REPO_ROOT) returns EXACTLY the 8 shipped descriptors with their pinned real ids/agents/stages/defaultStage/artifact kinds+labels (R4-16 adds "demo"; R4-17 adds "onboarding"; R4-21 adds "authoring"; R4-19-F2 adds "kb-cleanup"; W6-CR-3 adds "community-refresh")', () => {
    const descs = loadSessionKinds(REPO_ROOT);
    assert.equal(descs.length, 8, `expected exactly 8 real session kinds (R4-16 adds "demo", R4-17 adds "onboarding", R4-21 adds "authoring", R4-19-F2 adds "kb-cleanup", W6-CR-3 adds "community-refresh"), got ids: ${descs.map((d) => d.id).join(', ')}`);
    // R4-19-F2 (this edit): the length check alone cannot tell "kb-cleanup
    // landed" apart from "some other 7th row landed under a wrong id" — this
    // set-equality assertion pins the exact membership (order-independent;
    // declaration order in the yaml is not this AT's concern, the individual
    // per-descriptor checks below are) so a wrong-row-added regression is
    // caught here, not silently passed through to the specific `byId` probes
    // below (which would simply not find a bogus id and throw on `!`).
    assert.deepEqual(
      descs.map((d) => d.id).sort(),
      ['architect', 'authoring', 'community-refresh', 'demo', 'instructions', 'kb-cleanup', 'onboarding', 'project-brain'].sort(),
      `expected exactly this 8-id set, got: ${descs.map((d) => d.id).join(', ')}`,
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
      'the label is verbatim from the mockup (mockups/studio-endstate-v2/data.jsx SESSIONS[\'project-onboarding\'].artifactLabel) — pinned exactly, not paraphrased',
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

    // W6-CR-3: the new "community-refresh" session kind. artifact.kind is
    // REUSED 'file-package' (ADR-043's "prefer reuse" discipline) — never a
    // new reserved row (SESSION_ARTIFACT_KINDS' own AT-2 above stays a
    // 7-live/0-reserved count, unmodified by this addition). A single-stage
    // session: 'community' is SESSION_STAGES's SECOND extension (this file's
    // AT-1 above), mirroring 'authoring's own precedent.
    const communityRefresh = byId(descs, 'community-refresh');
    assert.equal(communityRefresh.agent, 'community-refresh');
    assert.deepEqual(communityRefresh.legacyRoutes, []);
    assert.deepEqual(communityRefresh.stages, ['community']);
    assert.equal(communityRefresh.defaultStage, 'community');
    assert.deepEqual(communityRefresh.artifact, { kind: 'file-package', label: 'Registry draft' });
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

describe('validateSessionKinds — legacyRoutes must resolve to a real forge-ui/app/ route (AT-amendment-2, A3)', () => {
  it('AT-49: a legacyRoutes entry that does not correspond to a real forge-ui/app/ directory → error naming ONLY the bogus entry, not the sibling that DOES resolve', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]'); // this one is real
    // '/totally-bogus-route/[sessionId]' has NO matching forge-ui/app/ dir.
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

  it('AT-52: the real repo — all three shipped descriptors\' legacyRoutes resolve to real forge-ui/app/ directories (verified independently of the validator too)', () => {
    const findings = validateSessionKinds(REPO_ROOT);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.deepEqual(routeFindings, [], `expected 0 legacy-route-not-found findings in the real repo, got: ${JSON.stringify(routeFindings)}`);

    // Independent verification (not just trusting the validator under test):
    // every shipped legacyRoutes entry really does exist as a forge-ui/app/ dir.
    const descs = loadSessionKinds(REPO_ROOT);
    for (const d of descs) {
      for (const route of d.legacyRoutes) {
        const segments = route.replace(/^\//, '').split('/').filter((s) => s.length > 0);
        const dirPath = join(REPO_ROOT, 'forge-ui', 'app', ...segments);
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

// ===========================================================================
// AT-amendment-3, A1 (AT-61..67) — legacyRouteResolves has NO containment
// check. `existsSync(join(forgeRoot, 'forge-ui', 'app', ...segments))` is
// evaluated on the path.join()-NORMALIZED result — `..` segments collapse
// BEFORE existsSync runs, so a route entry can point anywhere `existsSync`
// can see. Every scenario below was run against the actual, unfixed
// `legacyRouteResolves`/`validateSessionKinds` before being written (see
// each test's comment for the empirically-verified outcome).
// ===========================================================================

describe('validateSessionKinds — legacyRouteResolves has NO containment check (AT-amendment-3, A1)', () => {
  it('AT-61: a legacyRoutes entry escaping upward to a REAL directory OUTSIDE forge-ui/app → error (empirically verified: currently returns true, i.e. wrongly "resolves" — LIVE bypass)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]'); // negative control: the real, legitimate sibling
    mkdirSync(join(root, 'escaped-outside-target'), { recursive: true }); // the escape target REALLY exists
    const evilRoute = '../../escaped-outside-target'; // forge-ui/app/../.. => root; + escaped-outside-target
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', evilRoute] })]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 finding (the escape, not the real sibling), got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes(evilRoute), `message must name the offending route, got: ${routeFindings[0].message}`);
  });

  it('AT-62: a legacyRoutes entry of exactly "../../.." → error (empirically verified: normalizes ONE level above forgeRoot — not forgeRoot itself, but still a real, always-present directory — currently returns true — LIVE bypass)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    const evilRoute = '../../..';
    // Sanity precondition (not the assertion under test): confirm the target
    // this route actually resolves to is real, so the AT can't pass for the
    // wrong reason (a route that resolves to nothing would be correctly
    // rejected even by the buggy code).
    const target = join(root, 'forge-ui', 'app', '..', '..', '..');
    assert.ok(existsSync(target), `precondition failed: "${target}" (what "../../.." resolves to) must exist for this AT to mean anything`);
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', evilRoute] })]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 finding, got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes(evilRoute));
  });

  it('AT-63: legacyRoutes entries reaching absolute filesystem paths via excess ".." segments (clamps past the root, then descends into "/etc" and a self-controlled outside dir) → error for EACH (empirically verified: both currently return true — LIVE bypass; a literal bare "/etc" string does NOT bypass on this codebase — see AT-64\'s neighbor note — this is the actual reachable shape)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    const outsideAbsDir = makeForgeRoot('legacy-abs-outside-target-'); // a REAL, independent absolute dir
    const manyDotDot = Array(30).fill('..').join('/'); // safely more than any real nesting depth
    const routeToEtc = `${manyDotDot}/etc`;
    const routeToOutsideAbsDir = manyDotDot + outsideAbsDir; // outsideAbsDir already starts with '/'
    writeSessionKindsYaml(root, [
      baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', routeToEtc, routeToOutsideAbsDir] }),
    ]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 2, `expected exactly 2 findings (both absolute escapes, not the real sibling), got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings.some((f) => f.message.includes(routeToEtc)), `expected a finding naming the /etc escape, got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings.some((f) => f.message.includes(routeToOutsideAbsDir)), `expected a finding naming the outside-dir escape, got: ${JSON.stringify(routeFindings)}`);
  });

  it('AT-64: a legacyRoutes entry containing a BACKSLASH separator → error (empirically verified: this does NOT bypass containment today — POSIX treats "\\\\" as a plain filename character, not a separator, so the literal-backslash "filename" simply never exists; ALREADY correctly rejected — pinned as coverage, not a fresh catch)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    const backslashRoute = '..\\..\\escaped-outside-target';
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', backslashRoute] })]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 finding, got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes(backslashRoute));
  });

  it('AT-65: a legacyRoutes entry containing a NULL BYTE → error (empirically verified: does NOT bypass — existsSync neither throws nor matches a literal-NUL "filename"; ALREADY correctly rejected — pinned as coverage, not a fresh catch)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    mkdirSync(join(root, 'escaped-outside-target'), { recursive: true }); // real target — proves the NUL, not a missing dir, is what blocks it
    const nullByteRoute = '../../escaped-outside-target' + String.fromCharCode(0);
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', nullByteRoute] })]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 finding, got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes('escaped-outside-target'));
  });

  it('AT-66: a legacyRoutes entry containing a URL-ENCODED traversal ("%2e%2e%2f...") → error (empirically verified: never URL-decoded anywhere in this code path — the literal percent-text is just an opaque filename that never exists; ALREADY correctly rejected — pinned as coverage, not a fresh catch)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    const encodedRoute = '%2e%2e%2fescaped-outside-target';
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', encodedRoute] })]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 finding, got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes(encodedRoute));
  });

  it('AT-67: a legacyRoutes entry that escapes and comes back down to the SAME real, legitimate directory → error (T2 ruling: a declared route is a Studio route path, not a filesystem expression — "../app/fixture-kind/[sessionId]" numerically round-trips to the real target, but the STRING contains ".." and must be rejected regardless; empirically verified: currently returns true — LIVE bypass, and the most dangerous shape since it looks harmless on inspection)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    const roundTripRoute = '../app/fixture-kind/[sessionId]'; // normalizes right back to the real target
    // Sanity precondition: confirm this route really does round-trip to the
    // legitimate target (so the AT is pinning "must reject despite being
    // numerically legitimate", not accidentally pinning a missing-dir case).
    const target = join(root, 'forge-ui', 'app', '..', 'app', 'fixture-kind', '[sessionId]');
    assert.ok(existsSync(target), `precondition failed: "${target}" must exist (it's the same real dir as the legitimate route)`);
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', roundTripRoute] })]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 finding — a route string containing ".." must be rejected even when it numerically resolves back to a legitimate target, got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes(roundTripRoute));
  });
});

// ===========================================================================
// AT-R422-1 .. AT-R422-10 — R4-22 WI-1, ADR-043: the additive-optional
// `turnSpec` field. See the file header for the pinned shape, the frozen
// registries, and why these tests use a DYNAMIC import.
// ===========================================================================

/** The exact ADR-043 §1 worked example (kindDir: _authoring, style: agent,
 *  4-phase table) — the POSITIVE control every negative probe below is a
 *  one-field mutation of. */
function wellFormedTurnSpec(): Record<string, unknown> {
  return {
    kindDir: '_authoring',
    style: 'agent',
    phases: [
      { phase: 'analyzing', step: 'agent', writes: ['staging'], next: 'awaiting-review' },
      // verdicts (W6-B6 post-merge review): the real, live authoring row
      // declares `verdicts: [approve]` — there is no rejection path for a
      // drafted package — kept in lockstep here so this literal stays a
      // truthful mirror of the checked-in yaml, not just the ADR's original
      // 4-phase shape. requires (W6-B9, reviewer finding on W6-B8): approve
      // ALSO needs an operator-supplied `id` beyond `verdict` itself — same
      // lockstep reasoning.
      { phase: 'awaiting-review', step: 'noop', awaits: 'verdict', verdicts: ['approve'], requires: ['id'] },
      { phase: 'committing', step: 'finalize', finalizer: 'copyStagingToLibrary', next: 'committed' },
      { phase: 'committed', step: 'terminal' },
    ],
  };
}

/** A descriptor fixture carrying `turnSpec`, otherwise identical to
 *  baseDescriptor() — legacyRoutes forced to [] so the unrelated
 *  legacy-route-not-found check never pollutes the turnspec-specific
 *  assertions below (a fresh tmp root has no forge-ui/app/ dir at all). */
function turnSpecDescriptor(turnSpec: Record<string, unknown>): FixtureDescriptor & { turnSpec: Record<string, unknown> } {
  return { ...baseDescriptor({ legacyRoutes: [] }), turnSpec };
}

/** Findings this initiative's checks produce, isolated from every
 *  pre-existing session-kinds/* check so a probe that flips ONE field can
 *  assert in isolation even though the fixture also carries the other,
 *  still-valid turnSpec fields. */
function turnspecFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.check.startsWith('session-kinds/turnspec-'));
}

describe('validateSessionKinds — turnSpec (AT-R422-1..4): unknown value in a closed sub-vocabulary → error naming value + allowed set', () => {
  it('AT-R422-1: turnSpec.style outside TURN_STYLES → error naming the offending value AND every id in TURN_STYLES (kills an implementation that never validates style at all, or that validates it but hardcodes a stale/incomplete allowed-set string instead of deriving it from TURN_STYLES)', async () => {
    const mod = await import('./session-kinds.ts');
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
    const mod = await import('./session-kinds.ts');
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

  it('AT-R422-3 (updated W6-B3 post-merge review): a phase.finalizer outside the DISPATCHABLE finalizer set (on an otherwise-valid step:finalize phase) → error naming the offending value AND every id `orchestrator/interactive-finalizers.ts`\'s FINALIZERS registry actually implements — turnSpec.phases validates against the set dispatch will resolve, NOT the wider descriptive FINALIZER_IDS (kills an implementation that validates step but never resolves the finalizer id it names — a dangling reference would otherwise only fail at RUNTIME, mid-cycle, not at lint time; also kills an implementation that lint-approves a merely DESCRIPTIVE finalizer id turnSpec dispatch would throw on)', async () => {
    // Parity import (reviewer-preferred over a hand-maintained mirror): the
    // REAL registry a turnSpec finalize step actually dispatches through.
    const { FINALIZERS } = await import('../interactive-finalizers.ts');
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
    const mod = await import('./session-kinds.ts');
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
  it('AT-R422-5 (updated for W6-CR-3): ADDITIVE-OPTIONAL, proven against the REAL repo — 5 of the 8 real session kinds still carry no turnSpec at all (loadSessionKinds/validateSessionKinds(REPO_ROOT) behaves EXACTLY as before for them); "authoring", "kb-cleanup", and "community-refresh" are the THREE declared exceptions, each turnSpec deep-equaling its own ratified table exactly (kills an implementation that makes turnSpec required on every kind, that emits a finding merely for its absence on the OTHER 5, or that ships any exception with a turnSpec that drifts from its ratified table)', () => {
    const descs = loadSessionKinds(REPO_ROOT);
    assert.equal(descs.length, 8, `expected exactly 8 real session kinds (R4-16 "demo", R4-17 "onboarding", R4-21 "authoring", R4-19-F2 "kb-cleanup", W6-CR-3 "community-refresh"), got ids: ${descs.map((d) => d.id).join(', ')}`);
    // W6-CR-3 (this edit): "community-refresh" joins "authoring"/"kb-cleanup"
    // as a turnSpec-bearing exception — excluded from the turnSpec-less loop
    // below same as the other two always have been, so its real turnSpec
    // does not trip the negative-control assertion meant for the OTHER 5
    // kinds.
    for (const d of descs) {
      if (d.id === 'authoring' || d.id === 'kb-cleanup' || d.id === 'community-refresh') continue;
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
          // verdicts (W6-B6 post-merge review): approve-only, same reasoning
          // as the "no next" comment above — no rejection semantics exist
          // anywhere in this repo for a cleanup plan.
          { phase: 'awaiting-approval', step: 'noop', awaits: 'verdict', verdicts: ['approve'] },
          // W6-B4 adversarial-review fix: `applying` is the atomic-claim
          // marker `approveKbCleanup` (cli/bridge-studio-kbs.ts) writes
          // SYNCHRONOUSLY before its one await, closing a live-reproduced
          // double-drain race. Unreachable via `next` (same as `applied`
          // always has been) — `approveKbCleanup` is its only writer.
          { phase: 'applying', step: 'terminal' },
          { phase: 'applied', step: 'terminal' },
        ],
      },
      `kb-cleanup's real turnSpec must deep-equal its ratified 4-phase table (kindDir:_kb-cleanup, style:agent, drafting→awaiting-approval→applying→applied, with NO "next" on awaiting-approval — that absence is the approval gate), got: ${JSON.stringify(kbCleanup.turnSpec)}`,
    );

    const kbCleanupFindings = turnspecFindings(validateSessionKinds(REPO_ROOT)).filter((f) => f.object === 'session-kind:kb-cleanup');
    assert.deepEqual(kbCleanupFindings, [], `expected zero turnspec-* findings for the real "kb-cleanup" descriptor, got: ${JSON.stringify(kbCleanupFindings)}`);

    // W6-CR-3 (this edit): the THIRD turnSpec consumer, community-refresh,
    // gets the exact same positive-control treatment as authoring/kb-cleanup
    // above.
    const communityRefresh = byId(descs, 'community-refresh');
    assert.ok(communityRefresh.turnSpec, 'expected the real "community-refresh" descriptor to carry a turnSpec (W6-CR-3 — ADR-043 consumer #3)');
    assert.deepEqual(
      communityRefresh.turnSpec,
      {
        kindDir: '_community-refresh',
        style: 'agent',
        phases: [
          { phase: 'gathering', step: 'agent', writes: ['staging'], next: 'awaiting-review' },
          { phase: 'awaiting-review', step: 'noop', awaits: 'verdict', verdicts: ['approve', 'reject'] },
          { phase: 'committing', step: 'finalize', finalizer: 'commitRegistryDraft', next: 'committed' },
          { phase: 'committed', step: 'terminal' },
          { phase: 'rejected', step: 'terminal' },
        ],
      },
      `community-refresh's real turnSpec must deep-equal its ratified 5-phase table (kindDir:_community-refresh, style:agent, gathering→awaiting-review→committing→committed, plus a direct awaiting-review→rejected terminal), got: ${JSON.stringify(communityRefresh.turnSpec)}`,
    );

    const communityRefreshFindings = turnspecFindings(validateSessionKinds(REPO_ROOT)).filter((f) => f.object === 'session-kind:community-refresh');
    assert.deepEqual(communityRefreshFindings, [], `expected zero turnspec-* findings for the real "community-refresh" descriptor, got: ${JSON.stringify(communityRefreshFindings)}`);
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
    const mod = await import('./session-kinds.ts');

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
    const mod = await import('./session-kinds.ts');
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
  it('AT-R422-10: runStudioLint(root) — the exact function cmdStudioLint (orchestrator/cli.ts) calls, which `forge studio lint` runs and which CI invokes via `node --experimental-strip-types orchestrator/cli.ts studio lint` (.github/workflows/ci.yml) — surfaces the turnspec-unknown-style finding produced by validateSessionKinds (kills an implementation where the new check exists and is directly callable but is not actually wired into (or is swallowed by) the studio-lint aggregation path an operator/CI actually runs; validateSessionKinds alone being correct is NOT sufficient — this is the "guard exists, no call site calls it" defect class named in the brief)', () => {
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

  it('AT-R422-12: turnSpec.kindDir POSITIVE CONTROL — legitimate underscore-prefixed dir names (`_authoring` per the ADR §1 worked example, plus `_architect`/`_demo`, the real values this design actually uses) validate CLEAN (without this, a blanket-reject kindDir implementation would pass every negative probe in AT-R422-11 for the WRONG reason). Also asserts the determination the implementer needs: SLUG_RE (imported straight from orchestrator/skill-path.ts — the SAME regex CHECK_SLUG already applies to the sibling `d.id` field one screen up in validateSessionKinds) does NOT accept these values, because it requires a leading a-z letter — reusing SLUG_RE/CHECK_SLUG for kindDir would make every REAL shipped kindDir value a permanent lint error, so a distinct check is required.', () => {
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
    const idx = phases.findIndex((p) => p.step === 'terminal');
    // Flip the terminal row to `noop` (not remove it) so no `next` becomes
    // dangling — this isolates "no terminal phase" from AT-R422-13's gap.
    phases[idx] = { ...phases[idx], step: 'noop' };
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

// ===========================================================================
// R4-19-F2 — the "kb-cleanup" session kind (ADR-043 §1/§2/§3, brain-
// maintenance / cleanup-plan). RED at branch base: `studio/session-kinds.yaml`
// carries no "kb-cleanup" row yet, and `SESSION_ARTIFACT_KINDS` carries no
// "cleanup-plan" row yet. This block pins the DESCRIPTOR/REGISTRY half of the
// feature only — the renderer lives in session-transcript.test.ts, the turn
// spine in interactive-runner.test.ts, the routes in
// cli/ui-bridge-kb-cleanup.test.ts, and dry-bridge coverage in
// cli/dry-bridge-coverage.test.ts.
// ===========================================================================

describe('R4-19-F2 — the "kb-cleanup" session kind (brain-maintenance, cleanup-plan)', () => {
  // The exact ADR-043-shaped turnSpec table the task brief specifies
  // verbatim. Binding note (deliberate, the approval gate this whole feature
  // hinges on): "awaiting-approval" carries NO `next` — re-running the turn
  // while a session sits there must never advance it.
  const KB_CLEANUP_TURNSPEC = {
    kindDir: '_kb-cleanup',
    style: 'agent',
    phases: [
      { phase: 'drafting', step: 'agent', writes: ['plan'], next: 'awaiting-approval' },
      // verdicts (W6-B6 post-merge review): approve-only, mirroring the
      // "no next" comment above — no rejection semantics exist anywhere in
      // this repo for a cleanup plan.
      { phase: 'awaiting-approval', step: 'noop', awaits: 'verdict', verdicts: ['approve'] },
      // W6-B4 adversarial-review fix: the atomic-claim marker
      // `approveKbCleanup` writes synchronously before its one await —
      // see session-kinds.yaml's own comment on this row.
      { phase: 'applying', step: 'terminal' },
      { phase: 'applied', step: 'terminal' },
    ],
  };

  // Kills: a "kb-cleanup" row that never lands in the real
  // studio/session-kinds.yaml at all (RED today — this is the primary red);
  // a row whose turnSpec drifts from the ADR-043-shaped table (e.g. a `next`
  // added to awaiting-approval, which would silently defeat the approval
  // gate item #11 below pins); a wrong kindDir/agent/artifact.
  it('R4-19-F2 AT-1: loadSessionKinds(REPO_ROOT) returns a "kb-cleanup" descriptor with the exact agent/title/legacyRoutes/stages/defaultStage/artifact/turnSpec', () => {
    const descs = loadSessionKinds(REPO_ROOT);
    const kbCleanup = descs.find((d) => d.id === 'kb-cleanup');
    assert.ok(
      kbCleanup,
      'expected a "kb-cleanup" row in the real studio/session-kinds.yaml — not present yet (this IS the RED this test pins)',
    );
    assert.equal(kbCleanup!.agent, 'brain-maintenance');
    assert.equal(kbCleanup!.title, 'KB cleanup session');
    assert.deepEqual(kbCleanup!.legacyRoutes, []);
    assert.deepEqual(kbCleanup!.stages, ['brain']);
    assert.equal(kbCleanup!.defaultStage, 'brain');
    assert.deepEqual(kbCleanup!.artifact, { kind: 'cleanup-plan', label: 'Cleanup plan' });
    assert.deepEqual(
      kbCleanup!.turnSpec,
      KB_CLEANUP_TURNSPEC,
      `kb-cleanup's turnSpec must deep-equal the ADR-043-shaped table exactly — in particular "awaiting-approval" must declare NO "next" key at all (that absence IS the approval gate); got: ${JSON.stringify(kbCleanup!.turnSpec)}`,
    );
  });

  // Kills: a "kb-cleanup" row whose `agent:` does not resolve to a
  // runtime-bearing SKILL.md (a typo, or brain-maintenance shipped without a
  // `runtime:` block) — validateSessionKinds' unknown-agent check is the one
  // place that would catch it. The positive control (asserting the
  // descriptor genuinely exists) matters here: filtering findings down to
  // `session-kind:kb-cleanup` would trivially yield `[]` if the row is
  // simply ABSENT, which would make a bare "findings must be empty"
  // assertion pass for the wrong reason.
  it('R4-19-F2 AT-2: validateSessionKinds(REPO_ROOT) reports ZERO findings scoped to session-kind:kb-cleanup, and the descriptor genuinely exists (non-vacuous)', () => {
    const descs = loadSessionKinds(REPO_ROOT);
    assert.ok(
      descs.some((d) => d.id === 'kb-cleanup'),
      'positive control: the "kb-cleanup" descriptor must actually exist, or a zero-findings result below is vacuous (an absent row trivially has zero findings scoped to it)',
    );
    const findings = validateSessionKinds(REPO_ROOT).filter((f) => f.object === 'session-kind:kb-cleanup');
    assert.deepEqual(findings, [], `expected zero findings for session-kind:kb-cleanup, got: ${JSON.stringify(findings)}`);
  });

  // Kills: shipping the 'cleanup-plan' artifact renderer without promoting
  // its row in SESSION_ARTIFACT_KINDS (leaving kb-cleanup a permanent
  // reserved-artifact-kind lint error, mirroring every prior reserved->live
  // flip's own pin above); a row added as a plain mutable object instead of
  // individually Object.freeze()'d (defeating the registry's whole
  // deep-freeze discipline, per this file's own header note on
  // SESSION_ARTIFACT_KINDS).
  it('R4-19-F2 AT-3: SESSION_ARTIFACT_KINDS gains a frozen {id:"cleanup-plan", status:"live"} row, and sessionArtifactKindState("cleanup-plan") === "live" — a mutation attempt on the row must never take effect', () => {
    const row = SESSION_ARTIFACT_KINDS.find((k) => k.id === 'cleanup-plan');
    assert.ok(row, 'expected a "cleanup-plan" row in SESSION_ARTIFACT_KINDS — not present yet (this IS the RED this test pins)');
    assert.equal(row!.status, 'live', 'cleanup-plan must ship live (a real renderer) — never reserved');
    assert.ok(
      Object.isFrozen(row),
      'each row must be individually frozen — SESSION_ARTIFACT_KINDS.push(Object.freeze({...})) is not enough; the file header is explicit that Object.freeze is SHALLOW on the outer array alone',
    );
    assert.equal(sessionArtifactKindState('cleanup-plan'), 'live');
    assert.ok(Object.isFrozen(SESSION_ARTIFACT_KINDS), 'the outer array must stay frozen');
    // A mutation attempt on a genuinely-frozen row either throws (strict
    // mode) or silently no-ops — either way the total lookup function's
    // answer must be unaffected, proving the freeze is real, not merely
    // present in name.
    try {
      (row as { status: string }).status = 'HACKED';
    } catch {
      /* a strict-mode TypeError is an equally valid proof of the freeze */
    }
    assert.equal(sessionArtifactKindState('cleanup-plan'), 'live', 'a row mutation attempt must never actually change what the total lookup function reports');
  });
});

// ===========================================================================
// R4-19-F2 — THE CONSTRAINT TEST. ADR-043's entire reason for existing: a new
// interactive session kind is authored as turnSpec DATA riding the EXISTING
// generic `runInteractiveTurn` spine — NEVER a new orchestrator runner, NEVER
// a new `AGENT_RUNNERS` entry, NEVER a new `FINALIZER_IDS` row (kb-cleanup's
// phase table — drafting(agent) -> awaiting-approval(noop) -> applied
// (terminal) — has no `finalize` step at all, so it needs no finalizer).
// Asserted against the REAL source files, not a fixture or a hand-built
// registry snapshot — this is the test that kills a "just add a fifth
// runner" implementation, the exact per-kind re-invention ADR-043 dissolves.
//
// Both checks below are ALREADY TRUE today (GREEN, not RED) — they are
// regression ratchets pinning an invariant a correct kb-cleanup
// implementation must never violate, not a not-yet-built capability like
// AT-1..AT-3 above.
// ===========================================================================

describe('R4-19-F2 — the constraint: no new orchestrator runner for kb-cleanup', () => {
  it('AGENT_RUNNERS (cli/agent-run.ts) gains NO "kb-cleanup" key — the session rides the existing turnSpec dispatch fork in cmdAgentRun, not a new bespoke runner', () => {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(AGENT_RUNNERS, 'kb-cleanup'),
      `AGENT_RUNNERS must not gain a "kb-cleanup" entry — got keys: ${Object.keys(AGENT_RUNNERS).join(', ')}. A turnSpec-bearing descriptor is dispatched by cmdAgentRun's ADR-043 §3 fork BEFORE AGENT_RUNNERS is ever consulted (cli/agent-run.ts); adding a key here re-opens the exact per-runner cap park ADR-043 dissolved.`,
    );
    // Belt-and-suspenders grep on the real source TEXT (not just the
    // imported object's own keys) — catches a "kb-cleanup" entry added under
    // a shape the plain object-key check above might not observe (e.g. a
    // computed-key assignment appended after the object literal).
    const src = readFileSync(join(REPO_ROOT, 'cli', 'agent-run.ts'), 'utf8');
    assert.doesNotMatch(
      src,
      /['"]kb-cleanup['"]\s*:/,
      'the real cli/agent-run.ts source text must not declare a "kb-cleanup" key anywhere',
    );
  });

  it('FINALIZER_IDS (orchestrator/studio/session-kinds.ts) gains no new row FOR kb-cleanup specifically — its phase table declares no `finalize` step, so a correct implementation needs no finalizer for it (updated W6-B3: FINALIZER_IDS DOES grow, for a DIFFERENT reason — the new panel.phases finalize steps on demo/instructions need named finalizer identities; updated W6-CR-3: FINALIZER_IDS grows again for a THIRD reason — community-refresh IS a real dispatchable turnSpec finalizer; this assertion is scoped to "not because of kb-cleanup", not "never grows at all")', () => {
    assert.deepEqual(
      FINALIZER_IDS.map((f) => f.id),
      ['copyStagingToLibrary', 'writeToRepoRoot', 'recordLockedDemo', 'commitRegistryDraft'],
      `FINALIZER_IDS must be exactly these four rows post-W6-CR-3 — copyStagingToLibrary (authoring's real turnSpec finalizer, pre-existing), writeToRepoRoot/recordLockedDemo (W6-B3's panel.phases-only finalizer identities for instructions/demo), plus commitRegistryDraft (community-refresh's real turnSpec finalizer, W6-CR-3) — kb-cleanup's own turnSpec (drafting -> awaiting-approval -> applied) still declares no "finalize" step anywhere, so it still contributes none of these four. Got: ${JSON.stringify(FINALIZER_IDS.map((f) => f.id))}`,
    );
  });
});

// ===========================================================================
// W6-B3 — the additive-optional `panel` field (ADR-043 2026-08-15 amendment
// §2: the read-half twin of `turnSpec` for a legacy kind — demo, onboarding,
// instructions gain `panel.phases`; architect keeps none, permanently) +
// `deriveSessionAffordances` (the read-half affordance view B6's UI will
// consume). Mirrors the AT-R422-* idiom above: fixture-driven vocab/exclusivity
// coverage, plus real-repo pins for the checked-in yaml.
// ===========================================================================

/** A well-formed 3-phase panel table — NOT copied from any real kind, just
 *  small enough to isolate one-field mutations cleanly (mirrors
 *  wellFormedTurnSpec's own role for turnSpec fixtures). */
function wellFormedPanel(): Record<string, unknown> {
  return {
    phases: [
      { phase: 'drafting', step: 'agent', writes: ['draft'], next: 'awaiting-review' },
      { phase: 'awaiting-review', step: 'noop', awaits: 'verdict' },
      { phase: 'done', step: 'terminal' },
    ],
  };
}

/** A descriptor fixture carrying `panel`, otherwise identical to
 *  baseDescriptor() — legacyRoutes forced to [] for the same reason
 *  turnSpecDescriptor does (a fresh tmp root has no forge-ui/app/ dir). */
function panelDescriptor(panel: Record<string, unknown>): FixtureDescriptor & { panel: Record<string, unknown> } {
  return { ...baseDescriptor({ legacyRoutes: [] }), panel };
}

/** Findings scoped to panel-* checks, isolated the same way turnspecFindings
 *  isolates turnspec-* checks. */
function panelFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.check.startsWith('session-kinds/panel-'));
}

describe('validateSessionKinds — panel (W6-B3): reuses the SAME frozen phase-row vocab as turnSpec.phases, under panel-* check ids', () => {
  it('W6-B3-1: a panel phase.step outside TURN_STEPS → session-kinds/panel-unknown-step naming the offending value AND every id in TURN_STEPS (the panel-side counterpart to AT-R422-2)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const bogus = 'not-a-real-step-at-all';
    const panel = wellFormedPanel();
    (panel.phases as Record<string, unknown>[])[0] = { ...(panel.phases as Record<string, unknown>[])[0], step: bogus };
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const findings = panelFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/panel-unknown-step');
    assert.ok(f, `expected a session-kinds/panel-unknown-step finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes(bogus), 'message must name the offending value');
    for (const row of TURN_STEPS_FOR_TEST()) {
      assert.ok(f.message.includes(row), `message must name the allowed set (missing "${row}")`);
    }
  });

  it('W6-B3-2: a panel phase.finalizer outside FINALIZER_IDS → session-kinds/panel-unknown-finalizer naming the offending value AND every id in FINALIZER_IDS', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const bogus = 'notARealFinalizerAtAll';
    const panel = wellFormedPanel();
    const phases = panel.phases as Record<string, unknown>[];
    phases[phases.length - 1] = { phase: 'finalizing', step: 'finalize', finalizer: bogus }; // replace the terminal row so no-terminal-phase doesn't also fire
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const findings = panelFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/panel-unknown-finalizer');
    assert.ok(f, `expected a session-kinds/panel-unknown-finalizer finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes(bogus), 'message must name the offending value');
    assert.ok(f.message.includes('copyStagingToLibrary'), 'message must name the allowed set (missing "copyStagingToLibrary")');
    assert.ok(f.message.includes('writeToRepoRoot'), 'message must name the allowed set (missing "writeToRepoRoot")');
    assert.ok(f.message.includes('recordLockedDemo'), 'message must name the allowed set (missing "recordLockedDemo")');
  });

  it('W6-B3-3: a panel.phases table with NO `step: terminal` row anywhere → session-kinds/panel-no-terminal-phase naming the offending descriptor', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const panel = wellFormedPanel();
    const phases = panel.phases as Record<string, unknown>[];
    const idx = phases.findIndex((p) => p.step === 'terminal');
    phases[idx] = { ...phases[idx], step: 'noop' };
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const findings = panelFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/panel-no-terminal-phase');
    assert.ok(f, `expected a session-kinds/panel-no-terminal-phase finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('fixture-kind'));
  });

  it('W6-B3-4: an EMPTY panel.phases list → session-kinds/panel-empty-phases naming the offending descriptor', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [panelDescriptor({ phases: [] })]);

    const findings = panelFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/panel-empty-phases');
    assert.ok(f, `expected a session-kinds/panel-empty-phases finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('fixture-kind'));
  });

  it('W6-B3-12 (the reviewer\'s HIGH finding, missing-awaits rejection): a panel `step: noop` phase that OMITS `awaits` ENTIRELY → session-kinds/panel-noop-missing-awaits naming the kind, the phase, AND the allowed set — no fallback, no silent misclassification', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const panel = wellFormedPanel();
    const phases = panel.phases as Record<string, unknown>[];
    const idx = phases.findIndex((p) => p.phase === 'awaiting-review');
    phases[idx] = { phase: 'awaiting-review', step: 'noop' }; // `awaits` key genuinely absent, not merely undefined-valued
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const findings = panelFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/panel-noop-missing-awaits');
    assert.ok(f, `expected a session-kinds/panel-noop-missing-awaits finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('fixture-kind'), 'message must name the offending kind');
    assert.ok(f.message.includes('awaiting-review'), 'message must name the offending phase');
    assert.ok(f.message.includes('questions'), 'message must name the allowed set (missing "questions")');
    assert.ok(f.message.includes('verdict'), 'message must name the allowed set (missing "verdict")');
  });

  it('W6-B3-13: a panel phase.awaits present but outside AWAITS_KINDS → session-kinds/panel-unknown-awaits naming the offending value AND the allowed set', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const bogus = 'not-a-real-awaits-value';
    const panel = wellFormedPanel();
    const phases = panel.phases as Record<string, unknown>[];
    const idx = phases.findIndex((p) => p.phase === 'awaiting-review');
    phases[idx] = { ...phases[idx], awaits: bogus };
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const findings = panelFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/panel-unknown-awaits');
    assert.ok(f, `expected a session-kinds/panel-unknown-awaits finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes(bogus), 'message must name the offending value');
    assert.ok(f.message.includes('questions') && f.message.includes('verdict'), 'message must name the allowed set');
  });

  it('W6-B6-1 (the reviewer\'s HIGH finding, unknown-verdict rejection): a panel verdict row declaring a "verdicts" entry outside VERDICT_VALUES -> session-kinds/panel-unknown-verdict naming the offending value AND the allowed set', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const bogus = 'not-a-real-verdict-value';
    const panel = wellFormedPanel();
    const phases = panel.phases as Record<string, unknown>[];
    const idx = phases.findIndex((p) => p.phase === 'awaiting-review');
    phases[idx] = { ...phases[idx], verdicts: [bogus] };
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const findings = panelFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/panel-unknown-verdict');
    assert.ok(f, `expected a session-kinds/panel-unknown-verdict finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes(bogus), 'message must name the offending value');
    assert.ok(f.message.includes('approve') && f.message.includes('reject'), 'message must name the allowed set');
  });

  it('W6-B6-2: "verdicts" declared on a row that is NOT a noop+awaits:verdict row -> session-kinds/panel-verdicts-misplaced (the field is meaningless anywhere else — dead, confusing authored data, never silently ignored)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const panel = wellFormedPanel();
    const phases = panel.phases as Record<string, unknown>[];
    const idx = phases.findIndex((p) => p.phase === 'drafting');
    phases[idx] = { ...phases[idx], verdicts: ['approve'] }; // "drafting" is step:agent, not noop+awaits:verdict
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const findings = panelFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/panel-verdicts-misplaced');
    assert.ok(f, `expected a session-kinds/panel-verdicts-misplaced finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('drafting'), 'message must name the offending phase');
  });

  it('W6-B9 (reviewer finding on W6-B8): "requires" declared on a row that is NOT a noop+awaits:verdict row -> session-kinds/panel-requires-misplaced (mirrors verdicts-misplaced\'s exact shape — the field is meaningless anywhere else)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const panel = wellFormedPanel();
    const phases = panel.phases as Record<string, unknown>[];
    const idx = phases.findIndex((p) => p.phase === 'drafting');
    phases[idx] = { ...phases[idx], requires: ['id'] }; // "drafting" is step:agent, not noop+awaits:verdict
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const findings = panelFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/panel-requires-misplaced');
    assert.ok(f, `expected a session-kinds/panel-requires-misplaced finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('drafting'), 'message must name the offending phase');
  });

  it('W6-B9 (derivation): a noop+awaits:verdict row declaring "requires: [id]" derives a verdict affordance whose meta.requires deep-equals it verbatim; a row declaring none omits the key entirely (never a fabricated [])', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const panel = wellFormedPanel();
    const phases = panel.phases as Record<string, unknown>[];
    const idx = phases.findIndex((p) => p.phase === 'awaiting-review');
    phases[idx] = { ...phases[idx], requires: ['id'] };
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const descs = loadSessionKinds(root);
    const withRequires = descs.find((d) => d.id === 'fixture-kind');
    assert.ok(withRequires, 'expected the fixture descriptor to load');
    const affordances = deriveSessionAffordances(withRequires as SessionKindDescriptor, 'awaiting-review');
    assert.deepEqual(
      affordances,
      [{ id: 'awaiting-review-verdict', kind: 'verdict', phase: 'awaiting-review', meta: { verdicts: ['approve', 'reject'], requires: ['id'] } }],
      `expected meta.requires to deep-equal the authored ["id"] list, got: ${JSON.stringify(affordances)}`,
    );

    // Negative control: the SAME row with no "requires" key at all omits it
    // entirely from meta — never defaults to [].
    const panelNoRequires = wellFormedPanel();
    writeSessionKindsYaml(root, [panelDescriptor(panelNoRequires)]);
    const descsNoRequires = loadSessionKinds(root);
    const withoutRequires = descsNoRequires.find((d) => d.id === 'fixture-kind');
    assert.ok(withoutRequires, 'expected the fixture descriptor to load');
    const affordancesNoRequires = deriveSessionAffordances(withoutRequires as SessionKindDescriptor, 'awaiting-review');
    assert.equal(affordancesNoRequires.length, 1);
    assert.equal(
      Object.prototype.hasOwnProperty.call(affordancesNoRequires[0].meta ?? {}, 'requires'),
      false,
      `a row with no "requires" key must omit it from meta entirely, got: ${JSON.stringify(affordancesNoRequires[0].meta)}`,
    );
  });

  it('W6-B6-3 (positive control): a panel verdict row declaring "verdicts: [approve]" (kb-cleanup/authoring\'s real shape) validates CLEAN — zero panel-* findings, and derives ONLY an approve button, never a fabricated reject', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const panel = wellFormedPanel();
    const phases = panel.phases as Record<string, unknown>[];
    const idx = phases.findIndex((p) => p.phase === 'awaiting-review');
    phases[idx] = { ...phases[idx], verdicts: ['approve'] };
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const findings = panelFindings(validateSessionKinds(root));
    assert.deepEqual(findings, [], `expected zero panel-* findings for a well-formed approve-only verdict row, got: ${JSON.stringify(findings)}`);

    const [descriptor] = loadSessionKinds(root);
    const affordances = deriveSessionAffordances(descriptor, 'awaiting-review');
    const verdictAffordance = affordances.find((a) => a.kind === 'verdict');
    assert.ok(verdictAffordance, 'expected a verdict affordance to derive for "awaiting-review"');
    assert.deepEqual(
      verdictAffordance!.meta,
      { verdicts: ['approve'] },
      `expected the authored approve-only list to derive verbatim (never the ['approve','reject'] default), got: ${JSON.stringify(verdictAffordance!.meta)}`,
    );
  });

  it('W6-B3-5 (positive control): the well-formed panel fixture validates CLEAN — zero panel-* findings (without this, W6-B3-1..4 could all pass for the wrong reason — an implementation that rejects every panel unconditionally)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [panelDescriptor(wellFormedPanel())]);
    const findings = panelFindings(validateSessionKinds(root));
    assert.deepEqual(findings, [], `expected zero panel-* findings for a well-formed panel, got: ${JSON.stringify(findings)}`);
  });

  it('W6-B3-11 (the finalizer-vocab-split reviewer finding, direct pairing): a turnSpec row naming "writeToRepoRoot" FAILS lint (it is real and descriptive but not in the DISPATCHABLE set — resolveFinalizer would throw at spawn time), while the IDENTICAL finalizer id on a panel row (never dispatched) PASSES', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const turnSpec = wellFormedTurnSpec();
    const turnSpecPhases = turnSpec.phases as Record<string, unknown>[];
    const committingIdx = turnSpecPhases.findIndex((p) => p.phase === 'committing');
    turnSpecPhases[committingIdx] = { ...turnSpecPhases[committingIdx], finalizer: 'writeToRepoRoot' };

    const panel = wellFormedPanel();
    const panelPhases = panel.phases as Record<string, unknown>[];
    panelPhases[panelPhases.length - 1] = { phase: 'finalizing', step: 'finalize', finalizer: 'writeToRepoRoot' }; // replaces the terminal row — see W6-B3-2's own note on this shape

    writeSessionKindsYaml(root, [
      { ...turnSpecDescriptor(turnSpec), id: 'turnspec-writetorepo-kind' },
      { ...panelDescriptor(panel), id: 'panel-writetorepo-kind' },
    ]);

    const findings = validateSessionKinds(root);
    const turnSpecFinding = findings.find((f) => f.object === 'session-kind:turnspec-writetorepo-kind' && f.check === 'session-kinds/turnspec-unknown-finalizer');
    assert.ok(
      turnSpecFinding,
      `expected a session-kinds/turnspec-unknown-finalizer finding for the turnSpec row naming "writeToRepoRoot" (it would throw at spawn — resolveFinalizer/FINALIZERS has no such id), got: ${JSON.stringify(findings)}`,
    );
    assert.ok(turnSpecFinding!.message.includes('writeToRepoRoot'), 'message must name the offending value');

    const panelUnknownFinalizerFindings = findings.filter((f) => f.object === 'session-kind:panel-writetorepo-kind' && f.check === 'session-kinds/panel-unknown-finalizer');
    assert.deepEqual(
      panelUnknownFinalizerFindings,
      [],
      `the IDENTICAL finalizer id on a panel row must pass — panel is never dispatched (invisible to cmdAgentRun's turnSpec fork), so it validates against the full DESCRIPTIVE FINALIZER_IDS, which does carry "writeToRepoRoot". Got: ${JSON.stringify(panelUnknownFinalizerFindings)}`,
    );
  });
});

/** Local literal mirror of TURN_STEPS' ids, used only so the allowed-set
 *  assertion above doesn't have to (dynamically) import the module a second
 *  time — the four ids TURN_STEPS is documented to be exactly. */
function TURN_STEPS_FOR_TEST(): string[] {
  return ['agent', 'noop', 'finalize', 'terminal'];
}

describe('validateSessionKinds — turnSpec ⊕ panel mutual exclusion (W6-B3, ADR-043 2026-08-15 amendment §2)', () => {
  it('W6-B3-6: a descriptor declaring BOTH turnSpec AND panel → EXACTLY ONE finding (session-kinds/turnspec-panel-exclusive), naming the kind AND both field names — and NEITHER field\'s own phase-table checks run (no turnspec-* or panel-* secondary findings, even though both tables here are individually well-formed)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [
      { ...baseDescriptor({ legacyRoutes: [] }), turnSpec: wellFormedTurnSpec(), panel: wellFormedPanel() },
    ]);

    const findings = validateSessionKinds(root).filter((f) => f.object === 'session-kind:fixture-kind');
    const exclusive = findings.filter((f) => f.check === 'session-kinds/turnspec-panel-exclusive');
    assert.equal(exclusive.length, 1, `expected exactly ONE exclusivity finding, got: ${JSON.stringify(findings)}`);
    assert.equal(exclusive[0].level, 'error');
    assert.ok(exclusive[0].message.includes('fixture-kind'), 'message must name the offending kind');
    assert.ok(exclusive[0].message.includes('turnSpec'), 'message must name the "turnSpec" field');
    assert.ok(exclusive[0].message.includes('panel'), 'message must name the "panel" field');

    const secondary = findings.filter(
      (f) => f.check !== 'session-kinds/turnspec-panel-exclusive' && (f.check.startsWith('session-kinds/turnspec-') || f.check.startsWith('session-kinds/panel-')),
    );
    assert.deepEqual(
      secondary,
      [],
      `both wellFormedTurnSpec() and wellFormedPanel() are individually valid — a doubly-declared descriptor must produce ONLY the exclusivity finding, not also run either field's phase-table checks. Got secondary findings: ${JSON.stringify(secondary)}`,
    );
  });

  it('W6-B3-7 (positive controls): turnSpec-only and panel-only descriptors never trip the exclusivity check', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [
      turnSpecDescriptor(wellFormedTurnSpec()),
      { ...panelDescriptor(wellFormedPanel()), id: 'panel-only-kind' },
    ]);
    const findings = validateSessionKinds(root);
    assert.deepEqual(
      findings.filter((f) => f.check === 'session-kinds/turnspec-panel-exclusive'),
      [],
      `a descriptor carrying only ONE of turnSpec/panel must never trip the exclusivity check, got: ${JSON.stringify(findings)}`,
    );
  });
});

describe('loadSessionKinds — panel is STRUCTURAL ONLY (mirrors AT-R422-6\'s split for turnSpec)', () => {
  it('W6-B3-8: a semantically-invalid panel (bogus step) does NOT throw at load time and the parsed descriptor carries the panel data INTACT, unmodified', () => {
    const root = makeForgeRoot();
    const bogusPanel = { phases: [{ phase: 'x', step: 'not-a-real-step' }] };
    writeSessionKindsYaml(root, [panelDescriptor(bogusPanel)]);
    let descs: SessionKindDescriptor[] = [];
    assert.doesNotThrow(() => { descs = loadSessionKinds(root); }, 'loadSessionKinds must not throw on a semantically-bogus panel — only a structurally malformed one');
    assert.deepEqual((descs[0] as SessionKindDescriptor & { panel?: unknown }).panel, bogusPanel, 'the loader must carry the panel object through unmodified, including the offending step value');
  });
});

describe('the real repo (studio/session-kinds.yaml) — panel.phases on demo/instructions/onboarding, architect gains none (W6-B3)', () => {
  it('W6-B3-9: loadSessionKinds(REPO_ROOT) — demo, instructions, and onboarding each carry a `panel` with the exact phase table this initiative authored; project-brain, authoring, kb-cleanup, and architect carry NO panel at all', () => {
    const descs = loadSessionKinds(REPO_ROOT);

    const demo = byId(descs, 'demo');
    assert.deepEqual(
      demo.panel,
      {
        phases: [
          // W6-B10: every demo session is minted straight into 'briefing'
          // (POST /api/demo-builder/start) — this row is what lets the
          // dedicated /sessions/demo/<sid> screen actually get one started.
          { phase: 'briefing', step: 'noop', awaits: 'questions' },
          { phase: 'generating', step: 'agent', writes: ['demo'], next: 'awaiting-review' },
          { phase: 'awaiting-review', step: 'noop', awaits: 'verdict' },
          { phase: 'locking', step: 'finalize', finalizer: 'recordLockedDemo', next: 'locked' },
          { phase: 'locked', step: 'terminal' },
          { phase: 'abandoned', step: 'terminal' },
        ],
      },
      `demo's panel must deep-equal the briefing->generating->awaiting-review->locking->locked/abandoned table mirroring demo-builder-runner.ts:15-20, got: ${JSON.stringify(demo.panel)}`,
    );

    const instructions = byId(descs, 'instructions');
    assert.deepEqual(
      instructions.panel,
      {
        phases: [
          // W6-B9 — the pre-interview briefing checkpoint (POST
          // /api/instructions/start lands every new session here); reuses
          // `question-form` (`awaits: 'questions'`), same as awaiting-answers.
          { phase: 'briefing', step: 'noop', awaits: 'questions', next: 'interviewing' },
          { phase: 'interviewing', step: 'agent' },
          { phase: 'awaiting-answers', step: 'noop', awaits: 'questions', next: 'interviewing' },
          { phase: 'drafting', step: 'agent', writes: ['draft'], next: 'awaiting-verdict' },
          { phase: 'awaiting-verdict', step: 'noop', awaits: 'verdict' },
          { phase: 'finalizing', step: 'finalize', finalizer: 'writeToRepoRoot', next: 'committed' },
          { phase: 'committed', step: 'terminal' },
          { phase: 'rejected', step: 'terminal' },
        ],
      },
      `instructions' panel must deep-equal the briefing->interviewing->...->committed/rejected table mirroring instructions-runner.ts:17-24 + W6-B9's briefing row, got: ${JSON.stringify(instructions.panel)}`,
    );

    const onboarding = byId(descs, 'onboarding');
    assert.deepEqual(
      onboarding.panel,
      { phases: [{ phase: 'running', step: 'agent' }, { phase: 'complete', step: 'terminal' }, { phase: 'failed', step: 'terminal' }] },
      `onboarding's panel must deep-equal the thin running->complete/failed table mirroring writeSessionTerminalPhase (cli/agent-run.ts:198), got: ${JSON.stringify(onboarding.panel)}`,
    );

    for (const id of ['architect', 'project-brain', 'authoring', 'kb-cleanup']) {
      const d = byId(descs, id);
      assert.equal(
        (d as SessionKindDescriptor & { panel?: unknown }).panel,
        undefined,
        `"${id}" must carry NO panel field — architect keeps its bespoke panel permanently (ADR-043 amendment §4); authoring/kb-cleanup already have turnSpec, which is mutually exclusive with panel; project-brain has neither yet`,
      );
    }
  });

  it('W6-B3-10: validateSessionKinds(REPO_ROOT) reports ZERO panel-* and ZERO turnspec-panel-exclusive findings (the real yaml round-trips clean end to end — reinforces AT-17\'s blanket zero-errors assertion with a check specific to this initiative\'s own new checks)', () => {
    const findings = validateSessionKinds(REPO_ROOT);
    const scoped = findings.filter((f) => f.check.startsWith('session-kinds/panel-') || f.check === 'session-kinds/turnspec-panel-exclusive');
    assert.deepEqual(scoped, [], `expected zero panel-scoped findings in the real repo, got: ${JSON.stringify(scoped)}`);
  });
});

// ===========================================================================
// W6-B3 — deriveSessionAffordances: the derivation table, one test per
// mapping (ADR-043 §1 "affordances are derived, not authored" + the
// 2026-08-15 amendment's worked mapping — see the function's own doc comment
// in session-kinds.ts for the full rule set this table exercises).
// ===========================================================================

describe('deriveSessionAffordances — derivation table (W6-B3)', () => {
  const PANEL_DESCRIPTOR: SessionKindDescriptor = {
    ...baseDescriptor(),
    panel: {
      phases: [
        { phase: 'interviewing', step: 'agent' },
        { phase: 'awaiting-answers', step: 'noop', awaits: 'questions', next: 'interviewing' },
        { phase: 'drafting', step: 'agent', writes: ['draft'], next: 'awaiting-verdict' },
        { phase: 'awaiting-verdict', step: 'noop', awaits: 'verdict' },
        { phase: 'finalizing', step: 'finalize', finalizer: 'writeToRepoRoot', next: 'committed' },
        { phase: 'committed', step: 'terminal' },
      ],
    },
  } as SessionKindDescriptor;

  const NO_TABLE_DESCRIPTOR: SessionKindDescriptor = { ...baseDescriptor() } as SessionKindDescriptor;

  it('a descriptor with NEITHER turnSpec NOR panel (architect\'s real shape) → [] for any phase — the honest "no derivable affordances" answer', () => {
    assert.deepEqual(deriveSessionAffordances(NO_TABLE_DESCRIPTOR, 'anything'), []);
  });

  it('an unknown/undeclared phase (not in the table at all) → [] — fail closed, never fabricate', () => {
    assert.deepEqual(deriveSessionAffordances(PANEL_DESCRIPTOR, 'not-a-real-phase'), []);
  });

  it('a terminal phase → [] (ADR: "terminal ⇒ none"), even though this fixture\'s "committed" row could otherwise be reached via no other field', () => {
    assert.deepEqual(deriveSessionAffordances(PANEL_DESCRIPTOR, 'committed'), []);
  });

  it('a `noop` phase with `awaits: "questions"` (here, named "awaiting-answers") → [question-form] — driven by the AUTHORED `awaits` field, not the phase name — also carries next-turn from its `next` field', () => {
    const result = deriveSessionAffordances(PANEL_DESCRIPTOR, 'awaiting-answers');
    assert.deepEqual(result, [
      { id: 'awaiting-answers-question-form', kind: 'question-form', phase: 'awaiting-answers' },
      { id: 'awaiting-answers-next-turn', kind: 'next-turn', phase: 'awaiting-answers', meta: { next: 'interviewing' } },
    ]);
  });

  it('W6-B3 post-merge review — the misclassification fix, direct proof: a `noop` phase named SOMETHING OTHER THAN "awaiting-answers" (e.g. "awaiting-input") still derives [question-form] when its `awaits` field says so — a bare phase-NAME match would have silently mis-derived this as `verdict`', () => {
    const differentlyNamedQuestionPhase: SessionKindDescriptor = {
      ...baseDescriptor(),
      panel: { phases: [{ phase: 'awaiting-input', step: 'noop', awaits: 'questions' }] },
    } as SessionKindDescriptor;
    assert.deepEqual(deriveSessionAffordances(differentlyNamedQuestionPhase, 'awaiting-input'), [
      { id: 'awaiting-input-question-form', kind: 'question-form', phase: 'awaiting-input' },
    ]);
  });

  it('W6-B3 post-merge review — the converse proof: a `noop` phase LITERALLY named "awaiting-answers" but with `awaits: "verdict"` derives [verdict], NOT [question-form] — proves derivation reads `awaits`, never the phase name (the old `row.phase === \'awaiting-answers\'` heuristic would have gotten this one right for the wrong reason)', () => {
    const namedLikeAQuestionButIsAVerdict: SessionKindDescriptor = {
      ...baseDescriptor(),
      panel: { phases: [{ phase: 'awaiting-answers', step: 'noop', awaits: 'verdict' }] },
    } as SessionKindDescriptor;
    assert.deepEqual(deriveSessionAffordances(namedLikeAQuestionButIsAVerdict, 'awaiting-answers'), [
      // verdicts defaults to ['approve','reject'] (the ADR default) — this
      // fixture row declares no `verdicts:` of its own.
      { id: 'awaiting-answers-verdict', kind: 'verdict', phase: 'awaiting-answers', meta: { verdicts: ['approve', 'reject'] } },
    ]);
  });

  it('any OTHER `noop` phase (e.g. "awaiting-verdict") → [verdict], never question-form', () => {
    const result = deriveSessionAffordances(PANEL_DESCRIPTOR, 'awaiting-verdict');
    // verdicts defaults to ['approve','reject'] — PANEL_DESCRIPTOR's
    // "awaiting-verdict" row declares no `verdicts:` of its own.
    assert.deepEqual(result, [{ id: 'awaiting-verdict-verdict', kind: 'verdict', phase: 'awaiting-verdict', meta: { verdicts: ['approve', 'reject'] } }]);
  });

  it('an `agent` step with `writes` AND `next` (e.g. "drafting") → [staged-review, next-turn], in that order', () => {
    const result = deriveSessionAffordances(PANEL_DESCRIPTOR, 'drafting');
    assert.deepEqual(result, [
      { id: 'drafting-staged-review', kind: 'staged-review', phase: 'drafting', meta: { writes: ['draft'] } },
      { id: 'drafting-next-turn', kind: 'next-turn', phase: 'drafting', meta: { next: 'awaiting-verdict' } },
    ]);
  });

  it('an `agent` step with NEITHER `writes` NOR `next` (e.g. "interviewing", a branching phase) → [] — nothing for the operator to do while the agent is actively working', () => {
    assert.deepEqual(deriveSessionAffordances(PANEL_DESCRIPTOR, 'interviewing'), []);
  });

  it('a `finalize` step with `next` but no `writes` (e.g. "finalizing") → [next-turn] only', () => {
    const result = deriveSessionAffordances(PANEL_DESCRIPTOR, 'finalizing');
    assert.deepEqual(result, [{ id: 'finalizing-next-turn', kind: 'next-turn', phase: 'finalizing', meta: { next: 'committed' } }]);
  });

  it('positive control: a REAL turnSpec descriptor (authoring, the ADR-043 §1 worked example) derives correctly through turnSpec.phases, not just panel.phases — "analyzing" → [staged-review, next-turn]', () => {
    const authoring: SessionKindDescriptor = {
      ...baseDescriptor(),
      turnSpec: {
        kindDir: '_authoring',
        style: 'agent',
        phases: [
          { phase: 'analyzing', step: 'agent', writes: ['staging'], next: 'awaiting-review' },
          { phase: 'awaiting-review', step: 'noop', awaits: 'verdict' },
          { phase: 'committing', step: 'finalize', finalizer: 'copyStagingToLibrary', next: 'committed' },
          { phase: 'committed', step: 'terminal' },
        ],
      },
    } as SessionKindDescriptor;

    assert.deepEqual(deriveSessionAffordances(authoring, 'analyzing'), [
      { id: 'analyzing-staged-review', kind: 'staged-review', phase: 'analyzing', meta: { writes: ['staging'] } },
      { id: 'analyzing-next-turn', kind: 'next-turn', phase: 'analyzing', meta: { next: 'awaiting-review' } },
    ]);
    // verdicts defaults to ['approve','reject'] — this LOCAL fixture's own
    // "awaiting-review" row declares no `verdicts:` (unlike the real,
    // checked-in authoring row, which declares `verdicts: [approve]` — see
    // wellFormedTurnSpec() above).
    assert.deepEqual(deriveSessionAffordances(authoring, 'awaiting-review'), [{ id: 'awaiting-review-verdict', kind: 'verdict', phase: 'awaiting-review', meta: { verdicts: ['approve', 'reject'] } }]);
    assert.deepEqual(deriveSessionAffordances(authoring, 'committed'), []);
  });

  it('the real repo — every panel-bearing kind EXCEPT onboarding derives at least one non-empty affordance set somewhere in its table, and every terminal phase in every REAL turnSpec/panel table derives []', () => {
    const descs = loadSessionKinds(REPO_ROOT);
    // onboarding is deliberately excluded from the non-empty assertion: its
    // real table is running(agent, no writes/next, branches to complete OR
    // failed) -> complete(terminal) -> failed(terminal) — EVERY row derives
    // [] (running has neither writes nor next; both others are terminal).
    // This is the HONEST correct answer for a fire-and-forget dispatch with
    // no operator-facing decision point (ADR-043 §Consequences: "onboarding
    // is explicitly out of scope... a different path") — not a gap this
    // table's design failed to fill. See the dedicated onboarding assertion
    // below instead.
    for (const id of ['demo', 'instructions', 'authoring', 'kb-cleanup']) {
      const d = byId(descs, id);
      const table = d.turnSpec?.phases ?? d.panel?.phases;
      assert.ok(table, `expected "${id}" to carry a turnSpec or panel table`);
      const nonEmpty = table!.some((p) => deriveSessionAffordances(d, p.phase).length > 0);
      assert.ok(nonEmpty, `expected at least one phase in "${id}"'s real table to derive a non-empty affordance set`);
      for (const p of table!.filter((p) => p.step === 'terminal')) {
        assert.deepEqual(deriveSessionAffordances(d, p.phase), [], `terminal phase "${p.phase}" of "${id}" must derive []`);
      }
    }

    const onboarding = byId(descs, 'onboarding');
    for (const p of onboarding.panel!.phases) {
      assert.deepEqual(deriveSessionAffordances(onboarding, p.phase), [], `onboarding phase "${p.phase}" must derive [] — the fire-and-forget table has no operator-facing decision point anywhere`);
    }

    const architect = byId(descs, 'architect');
    assert.deepEqual(deriveSessionAffordances(architect, architect.defaultStage), [], 'architect has neither table — must derive [] regardless of phase');
  });
});
