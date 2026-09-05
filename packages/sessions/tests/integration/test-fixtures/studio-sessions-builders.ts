import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { serializeManifest, type InitiativeManifest } from '@forge/flows/manifest.ts';

/**
 * Acceptance tests for packages/sessions/bridge-studio-sessions.ts (R2-10, PR1: the
 * session-shell backend contract).
 *
 * The module under test does not exist yet — this file is RED at branch base
 * (ERR_MODULE_NOT_FOUND on the `./bridge-studio-sessions.ts` import is the
 * expected red). Mirrors packages/library/bridge-studio-templates.test.ts's idiom: a real
 * bridge (startBridge) + fetch for the "happy" behavioral tests, plus direct
 * handler invocation for the passthrough contract AND the slug-validation
 * sweep (see the design-decision note below on why the sweep needs direct
 * invocation).
 *
 * AT numbers continue the flat R2-10 sequence started in
 * packages/sessions/studio/session-kinds.test.ts (AT-1..AT-18) and continued in
 * packages/sessions/studio/session-transcript.test.ts (AT-19..AT-37). This file
 * covers AT-38..AT-48, plus AT-59..AT-60 added in the AT-amendment-2 round
 * (session-kinds.test.ts gained AT-49..56, session-transcript.test.ts gained
 * AT-57..58 in the same round — see those files' headers), plus AT-70..AT-74
 * added in AT-amendment-3 (session-kinds.test.ts gained AT-61..67,
 * session-transcript.test.ts gained AT-68..69 in the same round).
 *
 * AT-amendment-2 additions in THIS file:
 *   AT-59 (A1, the review-flagged BLOCKER) — `phase` is read via
 *     `readSessionStatus` (packages/sessions/interactive-session.ts), a plain
 *     `existsSync`/`readFileSync` on `status.json` with NO realpath
 *     containment check — a completely different (unguarded) read path from
 *     session-transcript.ts's `safeReadFileInSession`. A symlinked
 *     `status.json` pointing outside the session dir currently leaks its
 *     content into a 200 response. AT-59 plants exactly that symlink and
 *     pins the fixed behaviour: 404, marker never in the response.
 *   AT-60 (A2 route-level) — the `phase` the route already reads from
 *     status.json must be THREADED into `deriveSessionTranscript` so the
 *     phase-driven pending-turn contract (session-transcript.test.ts
 *     AT-57/58) actually reaches the wire, not just the unit level.
 *
 * AT-amendment-3, A3 additions in THIS file (AT-70..74) — coverage gap, not
 * a fresh defect: the AT-amendment-2 fix already produces TWO distinct 404
 * message buckets for a bad `status.json` (verified by reading the current
 * route: `session not found (status.json is missing, unreadable, or not
 * valid JSON)` for missing/malformed/non-object JSON, and `session not found
 * (status.json has no string "phase" field)` for a valid object with a
 * missing or non-string phase) — but nothing pinned either bucket, so a
 * revert to the old misleading "unreadable" wording for the has-no-phase
 * case would go uncaught. AT-70/71/72 pin the first bucket (3 distinct
 * causes); AT-73/74 pin the second (2 distinct causes) and explicitly assert
 * neither claims the file was "unreadable".
 *
 * R4-15 addition (AT-77): `RoadmapDraftRow` gains a fifth field, `dependsOn:
 * string[]` (session-transcript.test.ts's AT-75/76 pin the unit-level
 * derivation). AT-77 here drives the REAL route against a REAL on-disk
 * session dir with REAL `serializeManifest`'d manifests — the only way to
 * observe a field the route's own JSON serialization might drop, which a
 * unit test constructing its own row object cannot see (standing rule from
 * R2-09).
 *
 * Design decisions this file pins:
 *
 *   - `sessionId` is validated with SAFE_ID_RE (apps/forge/bridge-studio.ts), NOT
 *     SLUG_RE — real session ids are ISO-ish timestamps
 *     (`2026-08-05T10-00-00`) with an uppercase `T`, which SLUG_RE (strict
 *     lowercase-kebab) rejects. `project` is validated with SLUG_RE. This
 *     mirrors the EXACT precedent in packages/flows/bridge-studio-runs.ts's plan-verdict
 *     route ("project uses SLUG_RE ... sessionId uses SAFE_ID_RE").
 *   - The slug-validation variant sweep (AT-45/AT-46) uses DIRECT handler
 *     invocation, not real fetch() calls. Several required variants (a bare
 *     `..` path segment, an embedded null byte, a leading `/`) never survive
 *     a real HTTP client: WHATWG URL / undici's fetch() normalizes
 *     dot-segments client-side (a literal `..` segment gets collapsed away
 *     BEFORE the request is ever sent, so the server never sees it) and
 *     throws client-side on a raw NUL byte. Direct invocation hands the
 *     handler the exact raw `rawUrl` string a misbehaving/malicious HTTP
 *     client (or a proxy that does its own un-normalized forwarding) could
 *     produce, which is the only way to actually exercise the server-side
 *     guard for those variants.
 *   - `phase` in the response body is a passthrough of the session's
 *     `status.json.phase` field — not reinterpreted or validated against a
 *     closed vocabulary here (each runner owns its own phase enum).
 */

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------


export const REAL_ARCHITECT_SESSION = '2026-08-01T10-00-00';
export const REAL_INSTRUCTIONS_SESSION = '2026-08-02T11-00-00';
export const REAL_PROJECT_BRAIN_SESSION = '2026-08-03T12-00-00';
export const BADSTAGE_SESSION = '2026-08-04T13-00-00';
export const VICTIM_SESSION = '2026-08-05T14-00-00';
export const SECRET_MARKER = 'TOP-SECRET-BRIDGE-ESCAPE-MARKER-4471';
export const STATUS_ESCAPE_SESSION = '2026-08-06T15-00-00';
export const STATUS_SECRET_MARKER = 'LEAKED-STATUS-PHASE-MARKER-6602';
export const REASK_SESSION = '2026-08-07T16-00-00';
// R4-15 (AT-77) — cross-initiative dependsOn over the REAL wire.
export const DEPS_SESSION = '2026-08-09T18-00-00';
// AT-amendment-3, A3 — the five distinct status.json failure shapes.
export const MISSING_STATUS_SESSION = '2026-08-08T17-00-00';
export const INVALID_JSON_STATUS_SESSION = '2026-08-08T17-01-00';
export const NON_OBJECT_STATUS_SESSION = '2026-08-08T17-02-00';
export const NO_PHASE_STATUS_SESSION = '2026-08-08T17-03-00';
export const NON_STRING_PHASE_STATUS_SESSION = '2026-08-08T17-04-00';
// R4-17 — onboarding / contract-buildout route-threading fixtures.
export const ONBOARDING_SESSION = '2026-08-10T09-00-00';
export const ONBOARDING_BAD_CONFIG_SESSION = '2026-08-10T09-01-00';
// R4-19-F2 — kb-cleanup read-branch fixture (an unresolvable kb_id).
export const KB_CLEANUP_UNRESOLVABLE_SESSION = '2026-08-14T10-00-00';
// R4-19-F2 WI-4c — a kb-cleanup session whose kb_id DOES resolve (companion
// to KB_CLEANUP_UNRESOLVABLE_SESSION above). Originally seeded to pin the
// `kbId` wire field (since removed, W6-B9 — see the retired AT-KBID-1/2
// block, below the terminal-field tests); reused by the W6-B8 terminal/
// affordances tests, which need a 200 (not the 409 the unresolvable fixture
// deliberately produces).
export const KB_CLEANUP_RESOLVABLE_SESSION = '2026-08-14T10-02-00';
export const KB_CLEANUP_RESOLVABLE_KB_ID = 'kb-cleanup-wire-kb';
// W6-B8 — the `terminal` wire-field pins: a kb-cleanup session already at its
// turnSpec's terminal phase ('applied'), and an onboarding session at its
// panel's terminal phase ('complete').
export const KB_CLEANUP_APPLIED_SESSION = '2026-08-14T10-03-00';
export const ONBOARDING_COMPLETE_SESSION = '2026-08-10T09-02-00';
// LOW (reviewer finding on W6-B8) — the panel's OTHER terminal row
// ('failed', alongside 'complete' above) needs its own pin: both are
// declared `step: 'terminal'` in the real studio/session-kinds.yaml
// onboarding panel, and nothing before this fixture distinguished
// "only the FIRST terminal row happens to work" from "the whole table is
// read correctly".
export const ONBOARDING_FAILED_SESSION = '2026-08-10T09-03-00';
// W6-B6 — a session whose status.json genuinely carries a kickoff-selected
// `modelTier` (W6-B5's write side), proving the read route threads it
// through rather than the stale `null` placeholder.
export const MODEL_TIER_SESSION = '2026-08-15T11-00-00';

// F6 (wave-8) — "a linked session must be readable": legacy sessions whose
// state survives ONLY as the central _logs/_<kind>-<sid>/ dir. Shape A: no
// projects/<p>/_architect/<sid>/ dir anywhere. Shape B: a project-side dir
// exists but carries no status.json.
export const F6_SHAPE_A_SESSION = '2026-08-27T09-00-00-f6shapea';
export const F6_SHAPE_B_SESSION = '2026-08-27T09-01-00-f6shapeb';
export const F6_SHAPE_B_PROJECT = 'f6shapebproj';
export const F6_NOT_FOUND_SESSION = '2026-08-27T09-02-00-f6notfound';
export const F6_NO_EVENTS_SESSION = '2026-08-27T09-03-00-f6noevents';
export const F6_SYMLINK_ESCAPE_SESSION = '2026-08-27T09-04-00-f6symlink';
export const F6_SECRET_MARKER = 'TOP-SECRET-F6-ROUTE-ESCAPE-MARKER-7734';
export const F6_LAST_PHASE = 'awaiting-verdict';
export const F6_FIRST_PHASE = 'briefing';
export const F6_DERIVED_PROJECT = 'demoproj';
// AT-F6-R8 — the run-pointer thread: architect_session_id on a REAL queue
// manifest (_queue/pending/), for GET /api/runs/<id>.
export const F6_RUN_NOWHERE = 'INIT-2026-08-27-f6-run-nowhere';
export const F6_RUN_STATUS_BACKED = 'INIT-2026-08-27-f6-run-status';
export const F6_RUN_LEGACY = 'INIT-2026-08-27-f6-run-legacy';

export function writeSkillAgent(root: string, slug: string, opts: { libraryFalse?: boolean } = {}): void {
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

export function writeSessionKindsYaml(root: string): void {
  const dir = join(root, 'studio');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'session-kinds.yaml'),
    yaml.dump([
      {
        id: 'architect',
        agent: 'architect',
        title: 'Architect',
        legacyRoutes: ['/architect/[sessionId]', '/architect/[sessionId]/interview'],
        stages: ['roadmap'],
        defaultStage: 'roadmap',
        artifact: { kind: 'roadmap-draft', label: 'Roadmap draft' },
      },
      // W6-B3 — carries `panel.phases` (the real studio/session-kinds.yaml
      // row's own shape, packages/sessions/instructions-runner.ts:17-24), the
      // fixture this file's own AT-39 test below drives affordance
      // assertions against (fixture phase 'drafting' -> [staged-review,
      // next-turn], see deriveSessionAffordances's own doc comment for why).
      {
        id: 'instructions',
        agent: 'instructions-creator',
        title: 'Instructions',
        legacyRoutes: ['/instructions/[sessionId]'],
        stages: ['instructions'],
        defaultStage: 'instructions',
        artifact: { kind: 'markdown-draft', label: 'AGENTS.md draft' },
        panel: {
          phases: [
            { phase: 'interviewing', step: 'agent' },
            { phase: 'awaiting-answers', step: 'noop', awaits: 'questions', next: 'interviewing' },
            { phase: 'drafting', step: 'agent', writes: ['draft'], next: 'awaiting-verdict' },
            { phase: 'awaiting-verdict', step: 'noop', awaits: 'verdict' },
            { phase: 'finalizing', step: 'finalize', finalizer: 'writeToRepoRoot', next: 'committed' },
            { phase: 'committed', step: 'terminal' },
            { phase: 'rejected', step: 'terminal' },
          ],
        },
      },
      {
        id: 'project-brain',
        agent: 'project-brain-builder',
        title: 'Project Brain',
        legacyRoutes: ['/project-brain/[sessionId]'],
        stages: ['brain'],
        defaultStage: 'brain',
        artifact: { kind: 'brain-structure', label: 'Seeded structure' },
      },
      // R4-17: the new "onboarding" session kind — D2's five-stage
      // vocabulary, D9's artifact.label the project page renders.
      // W6-B8: carries the REAL `panel.phases` table (studio/session-kinds.
      // yaml's own onboarding row) — needed so this file's own terminal-phase
      // tests (below) can prove `isTerminalPhase` derives onboarding's
      // terminal set from its `panel`, not the LEGACY_SESSION_TERMINAL_PHASES
      // table (which carries no 'onboarding' entry at all — see that
      // function's own doc comment on the gap this closes). Adding this
      // block does not change any EXISTING assertion in this file: no test
      // here checks `affordances` for onboarding, and 'running' (the phase
      // every pre-existing onboarding fixture uses) derives no affordances
      // either way (no writes/next declared on that row).
      {
        id: 'onboarding',
        agent: 'onboarding-agent',
        title: 'Onboarding session',
        legacyRoutes: [],
        stages: ['contract', 'instructions', 'secrets', 'demo', 'roadmap'],
        defaultStage: 'contract',
        artifact: { kind: 'contract-buildout', label: 'Contract build-out' },
        panel: {
          phases: [
            { phase: 'running', step: 'agent' },
            { phase: 'complete', step: 'terminal' },
            { phase: 'failed', step: 'terminal' },
          ],
        },
      },
      // R4-19-F2: the new "kb-cleanup" session kind — the ADR-043-shaped
      // turnSpec table verbatim (see packages/sessions/studio/session-kinds.test.ts's
      // own R4-19-F2 block for the pin against the REAL, checked-in yaml;
      // this file's fixture yaml is this file's OWN pre-existing convention
      // of hand-writing every shipped kind locally rather than reading the
      // real repo file — see e.g. the "onboarding" row immediately above,
      // added the same way by R4-17).
      {
        id: 'kb-cleanup',
        agent: 'brain-maintenance',
        title: 'KB cleanup session',
        legacyRoutes: [],
        stages: ['brain'],
        defaultStage: 'brain',
        artifact: { kind: 'cleanup-plan', label: 'Cleanup plan' },
        turnSpec: {
          kindDir: '_kb-cleanup',
          style: 'agent',
          phases: [
            { phase: 'drafting', step: 'agent', writes: ['plan'], next: 'awaiting-approval' },
            // verdicts (W6-B6 post-merge review): mirrors the real, shipped
            // studio/session-kinds.yaml row verbatim — approve-only, no
            // rejection semantics exist for a cleanup plan.
            { phase: 'awaiting-approval', step: 'noop', awaits: 'verdict', verdicts: ['approve'] },
            { phase: 'applied', step: 'terminal' },
          ],
        },
      },
    ]),
    'utf8',
  );
}

/** Plants a kb-cleanup session directly on disk (never through a route) at
 *  `<projectsRoot>/<project>/_kb-cleanup/<sessionId>/status.json`, carrying
 *  a `kb_id` that resolves to NO real KB anywhere under `brain/` — the
 *  fixture for the bridge read-branch's "kb_id no longer resolves" fail-loud
 *  contract (task brief §4). Deliberately does NOT write a `brain/` dir at
 *  all — the whole point is that this kb_id is unresolvable. */
export function writeCleanupSessionWithUnresolvableKb(projectsRoot: string, project: string, sessionId: string): void {
  const dir = join(projectsRoot, project, '_kb-cleanup', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify({
      session_id: sessionId,
      project,
      phase: 'awaiting-approval',
      kb_id: 'no-such-kb-anywhere-on-disk',
      kb_binding: { kind: 'unique' },
      findings: [],
      updated_at: new Date().toISOString(),
    }),
    'utf8',
  );
}

/** Writes a minimal, real `brain/<id>/kb.yaml` (+ themes/ + _raw/) directly on
 *  disk — mirrors `apps/forge/ui-bridge-kb-cleanup.test.ts`'s own `writeKb` fixture
 *  idiom verbatim (that file's own AT-3/AT-4/AT-5 prove this exact minimal
 *  shape is sufficient for `computeAgentCleanupFindings`'s live
 *  `runBrainLint` pass to complete without throwing — no INDEX.md or other
 *  KBs required). This is what makes `KB_CLEANUP_RESOLVABLE_KB_ID` actually
 *  resolve via `resolveKbBrainDir`, unlike `KB_CLEANUP_UNRESOLVABLE_SESSION`'s
 *  fixture immediately above, which deliberately writes no `brain/` dir at
 *  all. */
export function writeResolvableKb(forgeRoot: string, id: string): void {
  const dir = join(forgeRoot, 'brain', id);
  mkdirSync(join(dir, 'themes'), { recursive: true });
  mkdirSync(join(dir, '_raw'), { recursive: true });
  writeFileSync(join(dir, 'kb.yaml'), `id: ${id}\nname: Fixture KB ${id}\nbinding: { kind: unique }\ndesc: A fixture KB for the kbId-on-the-wire pin.\n`, 'utf8');
}

/** Plants a kb-cleanup session directly on disk whose `kb_id` DOES resolve to
 *  a real `brain/<id>/kb.yaml` (via `writeResolvableKb`, which the caller
 *  must invoke first) — the companion, happy-path counterpart to
 *  `writeCleanupSessionWithUnresolvableKb` above. No `plan/cleanup-plan.md`
 *  is written — `deriveCleanupPlan` (orchestrator/studio/session-
 *  transcript.ts:929-930) tolerates an absent plan file, returning
 *  `{plan: null, actions: [], openFindingCount: 0}`, so this fixture stays
 *  minimal: only what the kbId-on-the-wire pin below actually needs. */
export function writeCleanupSessionWithResolvableKb(projectsRoot: string, project: string, sessionId: string, kbId: string): void {
  const dir = join(projectsRoot, project, '_kb-cleanup', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify({
      session_id: sessionId,
      project,
      phase: 'awaiting-approval',
      kb_id: kbId,
      kb_binding: { kind: 'unique' },
      findings: [],
      updated_at: new Date().toISOString(),
    }),
    'utf8',
  );
}

/** W6-B8 — companion to `writeCleanupSessionWithResolvableKb`, but at the
 *  turnSpec's TERMINAL phase ('applied', `{step:'terminal'}`) rather than
 *  'awaiting-approval' — the fixture the `terminal:true` wire-field pin
 *  needs. Still carries a RESOLVABLE kb_id: `deriveSessionArtifact`'s
 *  cleanup-plan branch always calls `computeAgentCleanupFindings` regardless
 *  of phase, so an unresolvable kb_id would 409 before the terminal-field
 *  assertion is ever reached. */
export function writeCleanupSessionApplied(projectsRoot: string, project: string, sessionId: string, kbId: string): void {
  const dir = join(projectsRoot, project, '_kb-cleanup', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify({
      session_id: sessionId,
      project,
      phase: 'applied',
      kb_id: kbId,
      kb_binding: { kind: 'unique' },
      findings: [],
      updated_at: new Date().toISOString(),
    }),
    'utf8',
  );
}

/** W6-B8 — an onboarding session already at its terminal 'complete' phase
 *  (the panel row this file's `writeSessionKindsYaml` fixture now declares,
 *  mirroring the real studio/session-kinds.yaml). Needed to prove
 *  `isTerminalPhase` derives onboarding's terminal set from its OWN `panel`
 *  table, not the LEGACY_SESSION_TERMINAL_PHASES table (which has no
 *  'onboarding' entry — see that function's doc comment on the gap this
 *  closes). */
export function writeOnboardingCompleteSession(projectsRoot: string, project: string, sessionId: string): void {
  const dir = join(projectsRoot, project, '_onboarding', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.md'), 'Onboard this project.\n', 'utf8');
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'complete' }), 'utf8');
}

/** LOW (reviewer finding on W6-B8) — the panel's OTHER terminal row
 *  ('failed', studio/session-kinds.yaml's onboarding panel), a sibling of
 *  writeOnboardingCompleteSession's 'complete' row above. */
export function writeOnboardingFailedSession(projectsRoot: string, project: string, sessionId: string): void {
  const dir = join(projectsRoot, project, '_onboarding', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.md'), 'Onboard this project.\n', 'utf8');
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'failed' }), 'utf8');
}

export function writeArchitectSession(projectsRoot: string, project: string, sessionId: string): void {
  const dir = join(projectsRoot, project, '_architect', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'idea.md'), 'Build a fixture thing.\n', 'utf8');
  writeFileSync(join(dir, 'answers.json'), JSON.stringify([{ round: 1, answers: [{ question: 'Q?', answer: 'A.' }] }]), 'utf8');
  mkdirSync(join(dir, 'manifests'), { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'awaiting-verdict' }), 'utf8');
}

// R4-15 (AT-77) — a REAL manifest, built the same way session-transcript.
// test.ts's `realManifest` does, so `serializeManifest` produces genuine
// on-disk frontmatter this route's real read path (deriveSessionArtifact →
// parseManifest) has to survive.
export function realManifest(overrides: Partial<InitiativeManifest> = {}): InitiativeManifest {
  return {
    initiative_id: 'INIT-2026-01-01-fixture-a',
    project: 'depsproj',
    project_repo_path: '/tmp/depsproj',
    created_at: '2026-01-01T00:00:00.000Z',
    iteration_budget: 10,
    cost_budget_usd: 5,
    class: 'code',
    acceptance_criteria: [],
    phase: 'pending',
    origin: 'architect',
    body: '# Fixture initiative\n\nDo the thing.\n',
    ...overrides,
  } as InitiativeManifest;
}

// R4-15 (AT-77) — a real architect session whose manifests/ dir carries two
// REAL serializeManifest'd manifests: one with no depends_on_initiatives,
// one whose depends_on_initiatives names BOTH a sibling in this same session
// (INIT-2026-01-01-fixture-a) AND an initiative NOT present under this
// session's manifests/ at all (INIT-2025-06-01-already-merged) — an
// architect draft may legitimately depend on an already-merged initiative
// outside the draft set. This is the "REAL on-disk session dir with REAL
// serialized manifests" fixture the wire-level AT needs (a unit test that
// constructs its own row object cannot observe a field dropped by the
// route's serialization — standing rule from R2-09).
export function writeArchitectSessionWithDeps(projectsRoot: string, project: string, sessionId: string): void {
  const dir = join(projectsRoot, project, '_architect', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'idea.md'), 'Build a deps fixture thing.\n', 'utf8');
  const manifestsDir = join(dir, 'manifests');
  mkdirSync(manifestsDir, { recursive: true });
  writeFileSync(join(manifestsDir, 'INIT-2026-01-01-fixture-a.md'), serializeManifest(realManifest({ project })), 'utf8');
  writeFileSync(
    join(manifestsDir, 'INIT-2026-01-02-fixture-b.md'),
    serializeManifest(
      realManifest({
        project,
        initiative_id: 'INIT-2026-01-02-fixture-b',
        depends_on_initiatives: ['INIT-2026-01-01-fixture-a', 'INIT-2025-06-01-already-merged'],
      }),
    ),
    'utf8',
  );
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'awaiting-verdict' }), 'utf8');
}

export function writeInstructionsSession(projectsRoot: string, project: string, sessionId: string): void {
  const dir = join(projectsRoot, project, '_instructions', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.md'), 'Author AGENTS.md.\n', 'utf8');
  writeFileSync(join(dir, 'AGENTS.draft.md'), '# AGENTS.md\n\nDraft body.\n', 'utf8');
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'drafting' }), 'utf8');
}

// W6-B6 — same shape as writeInstructionsSession, plus a real `modelTier`
// key (the W6-B5 write side's own field name), so the read route's
// `typeof statusParsed.modelTier === 'string' ? statusParsed.modelTier : null`
// branch has a genuine non-null case to prove against.
export function writeInstructionsSessionWithModelTier(projectsRoot: string, project: string, sessionId: string, modelTier: string): void {
  const dir = join(projectsRoot, project, '_instructions', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.md'), 'Author AGENTS.md.\n', 'utf8');
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'drafting', modelTier }), 'utf8');
}

export function writeProjectBrainSession(projectsRoot: string, project: string, sessionId: string): void {
  const dir = join(projectsRoot, project, '_project-brain', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.md'), 'Seed the brain.\n', 'utf8');
  mkdirSync(join(dir, 'themes'), { recursive: true });
  writeFileSync(join(dir, 'themes', 'alpha.md'), '# Alpha\n', 'utf8');
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'analyzing' }), 'utf8');
}

export type SessionShellBody = {
  ok: boolean; kind: string; sessionId: string; project: string; phase: string;
  stages: string[]; defaultStage: string; turns: SessionShellTurn[]; artifact: unknown;
  // W6-B3 — always present (never omitted): affordances is [] when the
  // descriptor carries neither turnSpec nor panel (architect). W6-B6 —
  // modelTier is read live off status.json ('opus'|'sonnet'|'haiku'|null);
  // still typed loosely here since most fixtures below carry no modelTier.
  affordances: { id: string; kind: string; phase: string; meta?: { writes?: string[]; next?: string } }[];
  modelTier: string | null;
  // W6-B8 — always present (never omitted), true iff the descriptor's OWN
  // phase table (turnSpec.phases, or panel.phases for a legacy kind) marks
  // this phase `step: 'terminal'` — the SAME derivation `isTerminalPhase`
  // already used server-side to gate event-tailing, now also threaded onto
  // the wire so the generic panel can gate its ActivityLog drawer without a
  // second, client-side terminal-phase table.
  terminal: boolean;
};
export function captureResponse(): { res: import('node:http').ServerResponse; status: () => number | undefined; body: () => unknown } {
  let status: number | undefined;
  let raw = '';
  const res = {
    writeHead: (code: number) => { status = code; },
    end: (chunk?: unknown) => { if (typeof chunk === 'string') raw = chunk; },
  } as unknown as import('node:http').ServerResponse;
  return { res, status: () => status, body: () => (raw ? JSON.parse(raw) : undefined) };
}

export type SessionShellTurn = { index: number; role: string; stage: string; text: string; source: string };
