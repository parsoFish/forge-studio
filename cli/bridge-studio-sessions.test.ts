/**
 * Acceptance tests for cli/bridge-studio-sessions.ts (R2-10, PR1: the
 * session-shell backend contract).
 *
 * The module under test does not exist yet — this file is RED at branch base
 * (ERR_MODULE_NOT_FOUND on the `./bridge-studio-sessions.ts` import is the
 * expected red). Mirrors cli/bridge-studio-templates.test.ts's idiom: a real
 * bridge (startBridge) + fetch for the "happy" behavioral tests, plus direct
 * handler invocation for the passthrough contract AND the slug-validation
 * sweep (see the design-decision note below on why the sweep needs direct
 * invocation).
 *
 * AT numbers continue the flat R2-10 sequence started in
 * orchestrator/studio/session-kinds.test.ts (AT-1..AT-18) and continued in
 * orchestrator/studio/session-transcript.test.ts (AT-19..AT-37). This file
 * covers AT-38..AT-48, plus AT-59..AT-60 added in the AT-amendment-2 round
 * (session-kinds.test.ts gained AT-49..56, session-transcript.test.ts gained
 * AT-57..58 in the same round — see those files' headers), plus AT-70..AT-74
 * added in AT-amendment-3 (session-kinds.test.ts gained AT-61..67,
 * session-transcript.test.ts gained AT-68..69 in the same round).
 *
 * AT-amendment-2 additions in THIS file:
 *   AT-59 (A1, the review-flagged BLOCKER) — `phase` is read via
 *     `readSessionStatus` (orchestrator/interactive-session.ts), a plain
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
 *   - `sessionId` is validated with SAFE_ID_RE (cli/bridge-studio.ts), NOT
 *     SLUG_RE — real session ids are ISO-ish timestamps
 *     (`2026-08-05T10-00-00`) with an uppercase `T`, which SLUG_RE (strict
 *     lowercase-kebab) rejects. `project` is validated with SLUG_RE. This
 *     mirrors the EXACT precedent in cli/bridge-studio-runs.ts's plan-verdict
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

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import yaml from 'js-yaml';

import { startBridge } from './ui-bridge.ts';
import { handleStudioSessionsRoutes, type SessionsRouteContext } from './bridge-studio-sessions.ts';
import { serializeManifest, type InitiativeManifest } from '../orchestrator/manifest.ts';
import { guardedWriteSessionStatus } from '../orchestrator/interactive-session.ts';
import type { ProjectBrainStatus } from '../orchestrator/project-brain-builder-runner.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

const REAL_ARCHITECT_SESSION = '2026-08-01T10-00-00';
const REAL_INSTRUCTIONS_SESSION = '2026-08-02T11-00-00';
const REAL_PROJECT_BRAIN_SESSION = '2026-08-03T12-00-00';
const BADSTAGE_SESSION = '2026-08-04T13-00-00';
const VICTIM_SESSION = '2026-08-05T14-00-00';
const SECRET_MARKER = 'TOP-SECRET-BRIDGE-ESCAPE-MARKER-4471';
const STATUS_ESCAPE_SESSION = '2026-08-06T15-00-00';
const STATUS_SECRET_MARKER = 'LEAKED-STATUS-PHASE-MARKER-6602';
const REASK_SESSION = '2026-08-07T16-00-00';
// R4-15 (AT-77) — cross-initiative dependsOn over the REAL wire.
const DEPS_SESSION = '2026-08-09T18-00-00';
// AT-amendment-3, A3 — the five distinct status.json failure shapes.
const MISSING_STATUS_SESSION = '2026-08-08T17-00-00';
const INVALID_JSON_STATUS_SESSION = '2026-08-08T17-01-00';
const NON_OBJECT_STATUS_SESSION = '2026-08-08T17-02-00';
const NO_PHASE_STATUS_SESSION = '2026-08-08T17-03-00';
const NON_STRING_PHASE_STATUS_SESSION = '2026-08-08T17-04-00';
// R4-17 — onboarding / contract-buildout route-threading fixtures.
const ONBOARDING_SESSION = '2026-08-10T09-00-00';
const ONBOARDING_BAD_CONFIG_SESSION = '2026-08-10T09-01-00';
// R4-19-F2 — kb-cleanup read-branch fixture (an unresolvable kb_id).
const KB_CLEANUP_UNRESOLVABLE_SESSION = '2026-08-14T10-00-00';
// R4-19-F2 WI-4c — a kb-cleanup session whose kb_id DOES resolve (companion
// to KB_CLEANUP_UNRESOLVABLE_SESSION above). Originally seeded to pin the
// `kbId` wire field (since removed, W6-B9 — see the retired AT-KBID-1/2
// block, below the terminal-field tests); reused by the W6-B8 terminal/
// affordances tests, which need a 200 (not the 409 the unresolvable fixture
// deliberately produces).
const KB_CLEANUP_RESOLVABLE_SESSION = '2026-08-14T10-02-00';
const KB_CLEANUP_RESOLVABLE_KB_ID = 'kb-cleanup-wire-kb';
// W6-B8 — the `terminal` wire-field pins: a kb-cleanup session already at its
// turnSpec's terminal phase ('applied'), and an onboarding session at its
// panel's terminal phase ('complete').
const KB_CLEANUP_APPLIED_SESSION = '2026-08-14T10-03-00';
const ONBOARDING_COMPLETE_SESSION = '2026-08-10T09-02-00';
// LOW (reviewer finding on W6-B8) — the panel's OTHER terminal row
// ('failed', alongside 'complete' above) needs its own pin: both are
// declared `step: 'terminal'` in the real studio/session-kinds.yaml
// onboarding panel, and nothing before this fixture distinguished
// "only the FIRST terminal row happens to work" from "the whole table is
// read correctly".
const ONBOARDING_FAILED_SESSION = '2026-08-10T09-03-00';
// W6-B6 — a session whose status.json genuinely carries a kickoff-selected
// `modelTier` (W6-B5's write side), proving the read route threads it
// through rather than the stale `null` placeholder.
const MODEL_TIER_SESSION = '2026-08-15T11-00-00';

function writeSkillAgent(root: string, slug: string, opts: { libraryFalse?: boolean } = {}): void {
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

function writeSessionKindsYaml(root: string): void {
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
      // row's own shape, orchestrator/instructions-runner.ts:17-24), the
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
      // turnSpec table verbatim (see orchestrator/studio/session-kinds.test.ts's
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
function writeCleanupSessionWithUnresolvableKb(projectsRoot: string, project: string, sessionId: string): void {
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
 *  disk — mirrors `cli/ui-bridge-kb-cleanup.test.ts`'s own `writeKb` fixture
 *  idiom verbatim (that file's own AT-3/AT-4/AT-5 prove this exact minimal
 *  shape is sufficient for `computeAgentCleanupFindings`'s live
 *  `runBrainLint` pass to complete without throwing — no INDEX.md or other
 *  KBs required). This is what makes `KB_CLEANUP_RESOLVABLE_KB_ID` actually
 *  resolve via `resolveKbBrainDir`, unlike `KB_CLEANUP_UNRESOLVABLE_SESSION`'s
 *  fixture immediately above, which deliberately writes no `brain/` dir at
 *  all. */
function writeResolvableKb(forgeRoot: string, id: string): void {
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
function writeCleanupSessionWithResolvableKb(projectsRoot: string, project: string, sessionId: string, kbId: string): void {
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
function writeCleanupSessionApplied(projectsRoot: string, project: string, sessionId: string, kbId: string): void {
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
function writeOnboardingCompleteSession(projectsRoot: string, project: string, sessionId: string): void {
  const dir = join(projectsRoot, project, '_onboarding', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.md'), 'Onboard this project.\n', 'utf8');
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'complete' }), 'utf8');
}

/** LOW (reviewer finding on W6-B8) — the panel's OTHER terminal row
 *  ('failed', studio/session-kinds.yaml's onboarding panel), a sibling of
 *  writeOnboardingCompleteSession's 'complete' row above. */
function writeOnboardingFailedSession(projectsRoot: string, project: string, sessionId: string): void {
  const dir = join(projectsRoot, project, '_onboarding', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.md'), 'Onboard this project.\n', 'utf8');
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'failed' }), 'utf8');
}

function writeArchitectSession(projectsRoot: string, project: string, sessionId: string): void {
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
function realManifest(overrides: Partial<InitiativeManifest> = {}): InitiativeManifest {
  return {
    initiative_id: 'INIT-2026-01-01-fixture-a',
    project: 'depsproj',
    project_repo_path: '/tmp/depsproj',
    created_at: '2026-01-01T00:00:00.000Z',
    iteration_budget: 10,
    cost_budget_usd: 5,
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
function writeArchitectSessionWithDeps(projectsRoot: string, project: string, sessionId: string): void {
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

function writeInstructionsSession(projectsRoot: string, project: string, sessionId: string): void {
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
function writeInstructionsSessionWithModelTier(projectsRoot: string, project: string, sessionId: string, modelTier: string): void {
  const dir = join(projectsRoot, project, '_instructions', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.md'), 'Author AGENTS.md.\n', 'utf8');
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'drafting', modelTier }), 'utf8');
}

function writeProjectBrainSession(projectsRoot: string, project: string, sessionId: string): void {
  const dir = join(projectsRoot, project, '_project-brain', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.md'), 'Seed the brain.\n', 'utf8');
  mkdirSync(join(dir, 'themes'), { recursive: true });
  writeFileSync(join(dir, 'themes', 'alpha.md'), '# Alpha\n', 'utf8');
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'analyzing' }), 'utf8');
}

// ---------------------------------------------------------------------------
// R4-19 WI-2 — the ".kb-" seeding-anchor carve-out fixture. CONTEXT: R1-06's
// KB-create hand-off (cli/bridge-studio-kbs.ts:1005-1044) anchors a
// non-project-bound KB's seeding session at
// `projects/.kb-<id>/_project-brain/<sid>/` (KB_SEEDING_ANCHOR_PREFIX =
// '.kb-', cli/bridge-studio-kbs.ts:690, unexported — mirrored here as a
// literal, same idiom this file already uses for `newProjectBrainSessionId`)
// so `discoverProjects` (which filters ALL dot-dirs) never surfaces it as a
// phantom project. This route's `invalidProjectReason` currently rejects
// EVERY project starting with "." via a bare SLUG_RE test, making that same
// anchor unreachable through the session shell.
// ---------------------------------------------------------------------------

const KB_SEEDING_ID = 'seedkb';
const KB_SEEDING_PROJECT = `.kb-${KB_SEEDING_ID}`;
const KB_SEEDING_SESSION = '2026-08-10T09-10-00';
const GITPULSE_SESSION = '2026-08-10T09-11-00';

/**
 * Mirrors the REAL create hand-off (cli/bridge-studio-kbs.ts:1026-1044)
 * byte-for-byte — same `guardedWriteSessionStatus` call, same dir segments
 * (`[sessionProject, '_project-brain', sessionId]`), same initial `phase:
 * 'briefing'` — rather than a hand-rolled `writeFileSync`, so this fixture's
 * on-disk shape is genuinely what a real KB create produces, never invented.
 * A `flow` binding with a `band` (R1-06 amendment, the reviewer's
 * band-scoped grant) is the realistic non-project case that forces the
 * dot-anchor branch (`binding.kind !== 'project'` in the real handler).
 */
function writeKbSeedingHandoffSession(projectsRoot: string, kbId: string, sessionId: string): void {
  const sessionProject = `.kb-${kbId}`;
  const written = guardedWriteSessionStatus<ProjectBrainStatus>(
    projectsRoot,
    [sessionProject, '_project-brain', sessionId],
    {
      session_id: sessionId,
      project: sessionProject,
      project_repo_path: join(projectsRoot, sessionProject),
      phase: 'briefing',
      prompt: '',
      updated_at: new Date().toISOString(),
      kb_id: kbId,
      kb_binding: { kind: 'flow', ref: 'review-flow', band: 'review-band' },
    },
  );
  if (written === null) {
    throw new Error(`test fixture: kb-seeding hand-off session write failed containment for "${kbId}"`);
  }
}

// R4-17 — the onboarding session dir (honestly one turn, D8: no fabricated
// interview) + a REAL project fixture with a well-formed `.forge/project.json`
// so `deriveContractStages` (cli/contract-stages.ts) has something real to
// derive over when the route threads it in.
function writeOnboardingSession(projectsRoot: string, project: string, sessionId: string): void {
  const dir = join(projectsRoot, project, '_onboarding', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.md'), 'Onboard this project.\n', 'utf8');
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'running' }), 'utf8');
}

function writeOnboardedProjectFixture(projectsRoot: string, project: string): void {
  const dir = join(projectsRoot, project);
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: { cmd: ['npm', 'test'] } } }), 'utf8');
  writeFileSync(join(dir, 'roadmap.md'), '# Roadmap\n', 'utf8');
}

/** A project whose `.forge/project.json` is deliberately malformed — proves
 *  the route surfaces `deriveContractStages`'s {ok:false} as a non-200 error
 *  naming the cause, never a 200 with an empty/silent artifact. */
function writeMalformedContractProjectFixture(projectsRoot: string, project: string): void {
  const dir = join(projectsRoot, project);
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), '{ not valid json [[[', 'utf8');
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-sessions-'));
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'catalog.yaml'),
    ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []', 'community-skills: []', ''].join('\n'),
  );
  writeSessionKindsYaml(forgeRoot);
  writeSkillAgent(forgeRoot, 'architect');
  writeSkillAgent(forgeRoot, 'instructions-creator', { libraryFalse: true });
  writeSkillAgent(forgeRoot, 'project-brain-builder', { libraryFalse: true });
  writeSkillAgent(forgeRoot, 'onboarding-agent');

  const projectsRoot = join(forgeRoot, 'projects');
  writeArchitectSession(projectsRoot, 'demoproj', REAL_ARCHITECT_SESSION);
  writeInstructionsSession(projectsRoot, 'demoproj', REAL_INSTRUCTIONS_SESSION);
  writeProjectBrainSession(projectsRoot, 'demoproj', REAL_PROJECT_BRAIN_SESSION);
  writeArchitectSessionWithDeps(projectsRoot, 'depsproj', DEPS_SESSION);
  writeInstructionsSessionWithModelTier(projectsRoot, 'demoproj', MODEL_TIER_SESSION, 'opus');

  // R4-19 WI-2 — the ".kb-" seeding-anchor reachability fixture, plus a
  // normal (non-dot) project-brain session as the companion baseline.
  writeKbSeedingHandoffSession(projectsRoot, KB_SEEDING_ID, KB_SEEDING_SESSION);
  writeProjectBrainSession(projectsRoot, 'gitpulse', GITPULSE_SESSION);

  // R4-17 — onboarding session fixtures: a well-formed project (contract
  // stages derive cleanly) and a malformed one (deriveContractStages
  // {ok:false} must surface as a non-200, never a 200 with an empty artifact).
  writeOnboardingSession(projectsRoot, 'onboardedproj', ONBOARDING_SESSION);
  writeOnboardedProjectFixture(projectsRoot, 'onboardedproj');
  writeOnboardingSession(projectsRoot, 'malformedcontractproj', ONBOARDING_BAD_CONFIG_SESSION);
  writeMalformedContractProjectFixture(projectsRoot, 'malformedcontractproj');

  // R4-19-F2 — the kb-cleanup read-branch's "kb_id no longer resolves" fixture.
  writeSkillAgent(forgeRoot, 'brain-maintenance');
  writeCleanupSessionWithUnresolvableKb(projectsRoot, 'demoproj', KB_CLEANUP_UNRESOLVABLE_SESSION);

  // R4-19-F2 WI-4c BLOCKER fix — the companion RESOLVABLE-kb_id fixture (the
  // kbId-on-the-wire pin needs a 200, not the 409 the unresolvable fixture
  // above deliberately produces).
  writeResolvableKb(forgeRoot, KB_CLEANUP_RESOLVABLE_KB_ID);
  writeCleanupSessionWithResolvableKb(projectsRoot, 'demoproj', KB_CLEANUP_RESOLVABLE_SESSION, KB_CLEANUP_RESOLVABLE_KB_ID);

  // W6-B8 — the `terminal` wire-field pins (see the two fixture writers'
  // own doc comments above).
  writeCleanupSessionApplied(projectsRoot, 'demoproj', KB_CLEANUP_APPLIED_SESSION, KB_CLEANUP_RESOLVABLE_KB_ID);
  writeOnboardingCompleteSession(projectsRoot, 'onboardedproj', ONBOARDING_COMPLETE_SESSION);
  writeOnboardingFailedSession(projectsRoot, 'onboardedproj', ONBOARDING_FAILED_SESSION);

  // Fail-closed fixture: a round carrying a stage marker outside the
  // architect descriptor's declared stages (['roadmap']).
  const badStageDir = join(projectsRoot, 'badstageproj', '_architect', BADSTAGE_SESSION);
  mkdirSync(badStageDir, { recursive: true });
  writeFileSync(
    join(badStageDir, 'answers.json'),
    JSON.stringify([{ round: 1, stage: 'no-such-stage', answers: [{ question: 'Q?', answer: 'A.' }] }]),
    'utf8',
  );
  writeFileSync(join(badStageDir, 'status.json'), JSON.stringify({ session_id: BADSTAGE_SESSION, project: 'badstageproj', phase: 'awaiting-verdict' }), 'utf8');

  // Escape fixture: a REAL victim session holding a secret, and an
  // ATTACKER project whose `_architect/` dir contains a SYMLINK (not a
  // lexical path string) pointing at the victim's session dir. The
  // symlink's own on-disk path is safely inside the attacker's `_architect/`
  // — only realpathSync at the read choke point reveals it escapes.
  const victimDir = join(projectsRoot, 'victimproj', '_architect', VICTIM_SESSION);
  mkdirSync(victimDir, { recursive: true });
  writeFileSync(join(victimDir, 'idea.md'), SECRET_MARKER + '\n', 'utf8');
  writeFileSync(join(victimDir, 'status.json'), JSON.stringify({ session_id: VICTIM_SESSION, project: 'victimproj', phase: 'awaiting-verdict' }), 'utf8');
  const attackerArchitectDir = join(projectsRoot, 'attackerproj', '_architect');
  mkdirSync(attackerArchitectDir, { recursive: true });
  symlinkSync(victimDir, join(attackerArchitectDir, 'evil-session'));

  // AT-59 fixture (A1, the reviewer-flagged BLOCKER): a REAL, otherwise
  // legitimate session dir whose `status.json` is REPLACED by a symlink
  // pointing OUTSIDE the session dir at a file carrying a fabricated
  // "phase". The session dir itself is genuine (this is not the AT-47
  // whole-directory-symlink shape) — only the single `status.json` FILE
  // escapes, via `readSessionStatus`'s unguarded read path.
  const statusEscapeDir = join(projectsRoot, 'statusescapeproj', '_architect', STATUS_ESCAPE_SESSION);
  mkdirSync(statusEscapeDir, { recursive: true });
  writeFileSync(join(statusEscapeDir, 'idea.md'), 'A legitimate idea.\n', 'utf8');
  const statusOutsideDir = join(forgeRoot, '_status-escape-outside');
  mkdirSync(statusOutsideDir, { recursive: true });
  const outsideStatusPath = join(statusOutsideDir, 'fake-status.json');
  writeFileSync(outsideStatusPath, JSON.stringify({ session_id: STATUS_ESCAPE_SESSION, project: 'statusescapeproj', phase: STATUS_SECRET_MARKER }), 'utf8');
  symlinkSync(outsideStatusPath, join(statusEscapeDir, 'status.json'));

  // AT-60 fixture (A2 route-level): a session genuinely `awaiting-answers`
  // whose questions.json re-asks round 1's question VERBATIM — the phase
  // must reach deriveSessionTranscript for the pending turn to appear.
  const reaskDir = join(projectsRoot, 'reaskproj', '_architect', REASK_SESSION);
  mkdirSync(reaskDir, { recursive: true });
  writeFileSync(join(reaskDir, 'idea.md'), 'Build a re-ask fixture.\n', 'utf8');
  writeFileSync(
    join(reaskDir, 'answers.json'),
    JSON.stringify([{ round: 1, answers: [{ question: 'What is the project name?', answer: 'Foo.' }] }]),
    'utf8',
  );
  writeFileSync(
    join(reaskDir, 'questions.json'),
    JSON.stringify([{ question: 'What is the project name?', header: 'Name', options: [] }]),
    'utf8',
  );
  writeFileSync(join(reaskDir, 'status.json'), JSON.stringify({ session_id: REASK_SESSION, project: 'reaskproj', phase: 'awaiting-answers' }), 'utf8');

  // AT-amendment-3, A3 — the five distinct status.json failure shapes, each
  // a real, otherwise-legitimate session dir (idea.md present) differing
  // only in status.json's shape.
  const missingStatusDir = join(projectsRoot, 'statusbucketproj', '_architect', MISSING_STATUS_SESSION);
  mkdirSync(missingStatusDir, { recursive: true });
  writeFileSync(join(missingStatusDir, 'idea.md'), 'An idea.\n', 'utf8');
  // No status.json written at all.

  const invalidJsonStatusDir = join(projectsRoot, 'statusbucketproj', '_architect', INVALID_JSON_STATUS_SESSION);
  mkdirSync(invalidJsonStatusDir, { recursive: true });
  writeFileSync(join(invalidJsonStatusDir, 'idea.md'), 'An idea.\n', 'utf8');
  writeFileSync(join(invalidJsonStatusDir, 'status.json'), 'not valid json {{{', 'utf8');

  const nonObjectStatusDir = join(projectsRoot, 'statusbucketproj', '_architect', NON_OBJECT_STATUS_SESSION);
  mkdirSync(nonObjectStatusDir, { recursive: true });
  writeFileSync(join(nonObjectStatusDir, 'idea.md'), 'An idea.\n', 'utf8');
  writeFileSync(join(nonObjectStatusDir, 'status.json'), JSON.stringify([1, 2, 3]), 'utf8'); // valid JSON, but an array, not an object

  const noPhaseStatusDir = join(projectsRoot, 'statusbucketproj', '_architect', NO_PHASE_STATUS_SESSION);
  mkdirSync(noPhaseStatusDir, { recursive: true });
  writeFileSync(join(noPhaseStatusDir, 'idea.md'), 'An idea.\n', 'utf8');
  writeFileSync(join(noPhaseStatusDir, 'status.json'), JSON.stringify({ session_id: NO_PHASE_STATUS_SESSION, project: 'statusbucketproj' }), 'utf8'); // valid object, no "phase" key at all

  const nonStringPhaseStatusDir = join(projectsRoot, 'statusbucketproj', '_architect', NON_STRING_PHASE_STATUS_SESSION);
  mkdirSync(nonStringPhaseStatusDir, { recursive: true });
  writeFileSync(join(nonStringPhaseStatusDir, 'idea.md'), 'An idea.\n', 'utf8');
  writeFileSync(join(nonStringPhaseStatusDir, 'status.json'), JSON.stringify({ session_id: NON_STRING_PHASE_STATUS_SESSION, project: 'statusbucketproj', phase: 42 }), 'utf8'); // phase present but not a string

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 200 happy path — the three real kinds (AT-38, 39, 40)
// ---------------------------------------------------------------------------

type SessionShellTurn = { index: number; role: string; stage: string; text: string; source: string };
type SessionShellBody = {
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

test('AT-38: GET /api/studio/sessions/architect/<id>?project=<p> returns the full shell payload', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${REAL_ARCHITECT_SESSION}?project=demoproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;

  assert.equal(body.ok, true);
  assert.equal(body.kind, 'architect');
  assert.equal(body.sessionId, REAL_ARCHITECT_SESSION);
  assert.equal(body.project, 'demoproj');
  assert.equal(body.phase, 'awaiting-verdict', 'phase must be the real value read from the session\'s status.json');
  assert.deepEqual(body.stages, ['roadmap']);
  assert.equal(body.defaultStage, 'roadmap');

  // The fixture is idea.md + a single answered round (no questions.json, no
  // feedback.md) — the exact, known transcript this session must derive.
  assert.equal(body.turns.length, 3, `expected idea.md + round-1 agent + round-1 operator, got: ${JSON.stringify(body.turns)}`);
  assert.deepEqual(body.turns.map((t) => t.source), ['idea.md', 'answers.json#round-1', 'answers.json#round-1']);
  assert.deepEqual(body.turns.map((t) => t.role), ['operator', 'agent', 'operator']);

  const artifact = body.artifact as { kind: string; rows: unknown[] };
  assert.equal(artifact.kind, 'roadmap-draft');
  assert.deepEqual(artifact.rows, [], 'the fixture\'s manifests/ dir is empty — the artifact must be an honest empty roadmap, not a fabricated row');

  // W6-B3 — architect carries NEITHER turnSpec NOR panel (permanently
  // bespoke, ADR-043 2026-08-15 amendment §4) — deriveSessionAffordances must
  // yield the honest empty answer, not a fabricated guess. modelTier is the
  // B5 placeholder, always null today.
  assert.deepEqual(body.affordances, [], 'architect has no turnSpec/panel — affordances must be [], never fabricated');
  assert.equal(body.modelTier, null);
});

test('AT-39: GET /api/studio/sessions/instructions/<id>?project=<p> returns the full shell payload', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${REAL_INSTRUCTIONS_SESSION}?project=demoproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;

  assert.equal(body.ok, true);
  assert.equal(body.kind, 'instructions');
  assert.equal(body.sessionId, REAL_INSTRUCTIONS_SESSION);
  assert.equal(body.project, 'demoproj');
  assert.equal(body.phase, 'drafting', 'phase must be the real value read from the session\'s status.json');
  assert.deepEqual(body.stages, ['instructions']);
  assert.equal(body.defaultStage, 'instructions');

  // The fixture is prompt.md only (no answers.json/questions.json/feedback.md).
  assert.equal(body.turns.length, 1, `expected the single prompt.md operator turn, got: ${JSON.stringify(body.turns)}`);
  assert.equal(body.turns[0].role, 'operator');
  assert.equal(body.turns[0].source, 'prompt.md');

  const artifact = body.artifact as { kind: string; body: string | null; hasDraft: boolean };
  assert.equal(artifact.kind, 'markdown-draft');
  assert.equal(artifact.body, '# AGENTS.md\n\nDraft body.\n', 'the draft body must be byte-faithful, including the trailing newline');
  assert.equal(artifact.hasDraft, true);

  // W6-B3 — a PANEL kind (instructions has no turnSpec) at phase "drafting"
  // ({ step: agent, writes: [draft], next: awaiting-verdict }) must derive
  // BOTH a staged-review affordance (from `writes`) AND a next-turn
  // affordance (from `next`) — proves the bridge threads panel.phases
  // through deriveSessionAffordances, not just turnSpec.phases.
  assert.deepEqual(
    body.affordances,
    [
      { id: 'drafting-staged-review', kind: 'staged-review', phase: 'drafting', meta: { writes: ['draft'] } },
      { id: 'drafting-next-turn', kind: 'next-turn', phase: 'drafting', meta: { next: 'awaiting-verdict' } },
    ],
    `expected the panel-derived affordances for phase "drafting", got: ${JSON.stringify(body.affordances)}`,
  );
  assert.equal(body.modelTier, null);
});

test('W6-B6: GET /api/studio/sessions/instructions/<id>?project=<p> threads a real status.json modelTier through, never the stale null placeholder', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${MODEL_TIER_SESSION}?project=demoproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.modelTier, 'opus', 'a real status.json.modelTier must reach the wire verbatim, not the B3-era null placeholder');
});

test('AT-40: GET /api/studio/sessions/project-brain/<id>?project=<p> returns the full shell payload, honestly one turn', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/project-brain/${REAL_PROJECT_BRAIN_SESSION}?project=demoproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;

  assert.equal(body.ok, true);
  assert.equal(body.kind, 'project-brain');
  assert.equal(body.sessionId, REAL_PROJECT_BRAIN_SESSION);
  assert.equal(body.project, 'demoproj');
  assert.equal(body.phase, 'analyzing', 'phase must be the real value read from the session\'s status.json');
  assert.deepEqual(body.stages, ['brain']);
  assert.equal(body.defaultStage, 'brain');

  // project-brain's runner has NO interview machinery (no answers.json/
  // questions.json/feedback.md ever exist for this kind) — one turn here is
  // the honest, complete transcript, not a truncation of something longer.
  assert.equal(body.turns.length, 1, `project-brain must surface honestly as one turn, no fabricated interview, got: ${JSON.stringify(body.turns)}`);
  assert.equal(body.turns[0].role, 'operator');
  assert.equal(body.turns[0].source, 'prompt.md');

  const artifact = body.artifact as { kind: string; themeCount: number; files: Array<{ path: string; body: string }> };
  assert.equal(artifact.kind, 'brain-structure');
  assert.equal(artifact.themeCount, 1);
  assert.ok(artifact.files.some((f) => f.path.includes('alpha.md')), 'the fixture\'s themes/alpha.md must appear in files');
});

// ---------------------------------------------------------------------------
// Passthrough contract — direct invocation (AT-41)
// ---------------------------------------------------------------------------

test('AT-41: handleStudioSessionsRoutes returns false for a non-matching URL (passthrough contract)', async () => {
  const mockRes = {
    writeHead: () => { throw new Error('must not write a response for a non-matching URL'); },
    end: () => { throw new Error('must not end a response for a non-matching URL'); },
  } as unknown as import('node:http').ServerResponse;
  const mockReq = {} as import('node:http').IncomingMessage;
  const ctx: SessionsRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), ensureSessionTail: () => {} };

  const handled = await handleStudioSessionsRoutes(mockReq, mockRes, ctx, '/api/studio/nonexistent', 'GET');
  assert.equal(handled, false, 'a non-matching studio-sessions URL must return false');
});

// ---------------------------------------------------------------------------
// 404 / 400 — unknown kind, unknown session, missing project (AT-42, 43, 44)
// ---------------------------------------------------------------------------

test('AT-42: GET /api/studio/sessions/no-such-kind/<id>?project=<p> returns 404 naming the allowed kinds', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/no-such-kind/${REAL_ARCHITECT_SESSION}?project=demoproj`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.ok(body.error.includes('no-such-kind'));
  for (const kind of ['architect', 'instructions', 'project-brain']) {
    assert.ok(body.error.includes(kind), `error must name allowed kind "${kind}", got: ${body.error}`);
  }
});

test('AT-43: GET /api/studio/sessions/architect/<unknown-id>?project=<p> returns 404 naming its ACTUAL cause (strengthened — must not be a generic catch-all)', async () => {
  const unknownId = '2099-01-01T00-00-00';
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${unknownId}?project=demoproj`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string; kind?: string; sessionId?: string; project?: string };
  // Exact-match the "session dir not found" message (distinct from the
  // "session found but status.json unreadable" 404 flavour) — this proves
  // the RIGHT branch fired, not any 404-shaped fallback.
  assert.equal(body.error, 'session not found', `expected the exact "session dir not found" message, got: ${JSON.stringify(body)}`);
  assert.equal(body.kind, 'architect', 'the 404 must echo back the requested kind, proving it reached the session-lookup branch');
  assert.equal(body.sessionId, unknownId, 'the 404 must echo back the requested sessionId');
  assert.equal(body.project, 'demoproj');
});

test('AT-44: GET /api/studio/sessions/architect/<id> with NO project query param returns 400 naming its ACTUAL cause (strengthened)', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${REAL_ARCHITECT_SESSION}`);
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'project query parameter is required', `expected the exact missing-project message, got: ${JSON.stringify(body)}`);
});

// ---------------------------------------------------------------------------
// Slug validation sweep — DIRECT invocation (AT-45, 46) — see the header note
// on why real fetch() cannot exercise every variant.
// ---------------------------------------------------------------------------

function captureResponse(): { res: import('node:http').ServerResponse; status: () => number | undefined; body: () => unknown } {
  let status: number | undefined;
  let raw = '';
  const res = {
    writeHead: (code: number) => { status = code; },
    end: (chunk?: unknown) => { if (typeof chunk === 'string') raw = chunk; },
  } as unknown as import('node:http').ServerResponse;
  return { res, status: () => status, body: () => (raw ? JSON.parse(raw) : undefined) };
}

// Shared traversal/malformed payloads that are representable as a NON-EMPTY
// single path segment (a bare '' segment can never appear in a URL that
// still matches `/api/studio/sessions/:kind/:sessionId` — a trailing slash
// with nothing after it simply fails to match the route at all, which is a
// different, already-covered passthrough/404 case, not this handler's 400).
const BAD_PATH_SEGMENT_VARIANTS: string[] = [
  '..',
  '.',
  'a%2Fb', // "a/b" as a single path segment — the raw traversal char is what's under test, not the segmentation
  '%2Fetc%2Fpasswd', // an absolute-path-shaped value
  '%00', // embedded null byte
  'a'.repeat(300), // overlong id — valid charset, invalid length
  '%2e%2e%2f', // URL-encoded traversal
  '%252e%252e%252f', // double-encoded traversal
  '%c0%af', // overlong UTF-8 encoding of '/'
];

// The project query param IS representable as an empty value (`?project=`),
// unlike a path segment — so '' is meaningful here and only here.
const BAD_QUERY_VALUE_VARIANTS: string[] = ['', ...BAD_PATH_SEGMENT_VARIANTS];

const OVERLONG_ID = 'a'.repeat(300);
const DOUBLE_ENCODED_TRAVERSAL = '%252e%252e%252f';

/** Strengthened per-variant message checks (reviewer finding: breadth alone
 *  doesn't prove the message is ACTIONABLE) — applied to the two variants
 *  T2 called out specifically. Asserts the message is a real length/charset
 *  explanation, never a leaked low-level OS error, and never empty/generic. */
function assertActionableMessage(variant: string, message: string): void {
  if (variant === OVERLONG_ID) {
    assert.ok(/exceed|too long|length/i.test(message), `300-char variant must carry an actionable LENGTH message, got: ${message}`);
    assert.ok(!/ENAMETOOLONG/i.test(message), `300-char variant must NEVER leak a raw OS error like ENAMETOOLONG, got: ${message}`);
  }
  if (variant === DOUBLE_ENCODED_TRAVERSAL) {
    // A single decode of '%252e%252e%252f' yields '%2e%2e%2f' (still
    // percent-encoded, not a real ".." traversal) — the message must name
    // THAT actual offending (once-decoded) value, not a blank/generic string.
    assert.ok(message.includes('%2e%2e%2f'), `double-encoded-traversal variant must name the once-decoded offending value "%2e%2e%2f", got: ${message}`);
  }
}

test('AT-45: sessionId slug validation rejects every traversal/malformed variant with 400, BEFORE any fs read', async () => {
  const ctx: SessionsRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), ensureSessionTail: () => {} };
  for (const variant of BAD_PATH_SEGMENT_VARIANTS) {
    const { res, status, body } = captureResponse();
    const rawUrl = `/api/studio/sessions/architect/${variant}?project=demoproj`;
    const handled = await handleStudioSessionsRoutes({} as import('node:http').IncomingMessage, res, ctx, rawUrl, 'GET');
    assert.equal(handled, true, `variant ${JSON.stringify(variant)} must be handled (not passthrough)`);
    assert.equal(status(), 400, `variant ${JSON.stringify(variant)} must be rejected with 400, got ${status()}`);
    const errorMessage = (body() as { error?: string })?.error;
    assert.ok(typeof errorMessage === 'string', `variant ${JSON.stringify(variant)} must carry an error message`);
    assertActionableMessage(variant, errorMessage!);
  }
});

test('AT-46: project slug validation rejects every traversal/malformed variant with 400, BEFORE any fs read', async () => {
  const ctx: SessionsRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), ensureSessionTail: () => {} };
  for (const variant of BAD_QUERY_VALUE_VARIANTS) {
    const { res, status, body } = captureResponse();
    const rawUrl = `/api/studio/sessions/architect/${REAL_ARCHITECT_SESSION}?project=${variant}`;
    const handled = await handleStudioSessionsRoutes({} as import('node:http').IncomingMessage, res, ctx, rawUrl, 'GET');
    assert.equal(handled, true, `variant ${JSON.stringify(variant)} must be handled (not passthrough)`);
    assert.equal(status(), 400, `project variant ${JSON.stringify(variant)} must be rejected with 400, got ${status()}`);
    const errorMessage = (body() as { error?: string })?.error;
    assert.ok(typeof errorMessage === 'string');
    assertActionableMessage(variant, errorMessage!);
  }
});

// ---------------------------------------------------------------------------
// Real escape probe — symlink, not a lexical path (AT-47)
// ---------------------------------------------------------------------------

test('AT-47: a sessionId resolving via a symlink into ANOTHER project\'s session dir is rejected, content never leaked', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/evil-session?project=attackerproj`);
  assert.notEqual(res.status, 200, 'a symlink escaping into another project\'s session dir must never resolve as a valid session');
  const text = await res.text();
  assert.ok(!text.includes(SECRET_MARKER), 'the victim session\'s content must never be returned, whatever the rejection status');
});

// ---------------------------------------------------------------------------
// Fail-closed unknown stage surfaces through the route (AT-48)
// ---------------------------------------------------------------------------

test('AT-48: an unknown-stage checkpoint surfaces as a non-200 (or ok:false), naming the offending value + allowed set — never smoothed into a 200 with defaulted stages', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${BADSTAGE_SESSION}?project=badstageproj`);
  const text = await res.text();
  let parsed: { ok?: boolean; error?: string; stages?: unknown } = {};
  try { parsed = JSON.parse(text); } catch { /* non-JSON is fine, handled below */ }

  const smoothedInto200 = res.status === 200 && parsed.ok !== false;
  assert.ok(!smoothedInto200, `an unknown-stage checkpoint must not be smoothed into a plain 200, got status=${res.status} body=${text}`);

  const message = parsed.error ?? text;
  assert.ok(message.includes('no-such-stage'), `response must name the offending value, got: ${message}`);
  assert.ok(message.includes('roadmap'), `response must name the allowed stage set, got: ${message}`);
});

// ---------------------------------------------------------------------------
// AT-59 (A1, the reviewer-flagged BLOCKER) — status.json symlink escape.
// `phase` is read via `readSessionStatus` (interactive-session.ts), a plain
// existsSync/readFileSync with NO realpath check — a different, unguarded
// read path from session-transcript.ts's `safeReadFileInSession`. The
// session DIRECTORY here is genuine and real (unlike AT-47's whole-dir
// symlink) — only the single status.json FILE inside it is a symlink
// pointing outside. Reviewer repro: this currently returns 200 with the
// fabricated phase leaked straight into the response.
// ---------------------------------------------------------------------------

test('AT-59: a session dir whose status.json is a symlink pointing OUTSIDE it is rejected (404) — the escaped phase value never appears anywhere in the response', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${STATUS_ESCAPE_SESSION}?project=statusescapeproj`);
  const text = await res.text();
  assert.ok(!text.includes(STATUS_SECRET_MARKER), `the escaped status.json content must never appear in the response, got: ${text}`);
  // The intended post-fix behaviour: treated the same as "no readable
  // status.json" — a 404, not a 200 with a guessed/leaked phase.
  assert.equal(res.status, 404, `expected 404 (escaped status.json treated as unreadable), got status=${res.status} body=${text}`);
});

// ---------------------------------------------------------------------------
// AT-60 (A2 route-level) — the route's already-known `phase` must be
// threaded into deriveSessionTranscript so the phase-driven pending-turn
// contract (session-transcript.test.ts AT-57/58) reaches the wire.
// ---------------------------------------------------------------------------

test('AT-60: a session genuinely awaiting-answers, with a VERBATIM re-asked question → the pending agent turn IS present in the route response', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${REASK_SESSION}?project=reaskproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.phase, 'awaiting-answers');
  const pending = body.turns.find((t) => t.source === 'questions.json');
  assert.ok(pending, `expected a pending agent turn for the verbatim re-ask (phase awaiting-answers), got turns: ${JSON.stringify(body.turns)}`);
  assert.equal(pending!.role, 'agent');
  assert.equal(pending!.text, 'What is the project name?');
});

// ---------------------------------------------------------------------------
// AT-amendment-3, A3 (AT-70..74) — the 404 message buckets for every
// status.json failure shape. Confirmed by reading the current route (not
// guessed): bucket 1 = "session not found (status.json is missing,
// unreadable, or not valid JSON)" for missing/malformed-JSON/non-object;
// bucket 2 = 'session not found (status.json has no string "phase" field)'
// for a valid object with a missing or non-string phase. All five ATs below
// are GREEN ON ARRIVAL — this is coverage against regression, not a fresh
// catch; reported honestly rather than implied as a new defect.
// ---------------------------------------------------------------------------

const STATUS_MISSING_OR_MALFORMED_MESSAGE = 'session not found (status.json is missing, unreadable, or not valid JSON)';
const STATUS_NO_PHASE_MESSAGE = 'session not found (status.json has no string "phase" field)';

test('AT-70: status.json missing entirely → 404, the exact "missing/unreadable/not-JSON" bucket message', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${MISSING_STATUS_SESSION}?project=statusbucketproj`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, STATUS_MISSING_OR_MALFORMED_MESSAGE);
});

test('AT-71: status.json present but not valid JSON → 404, the exact "missing/unreadable/not-JSON" bucket message', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${INVALID_JSON_STATUS_SESSION}?project=statusbucketproj`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, STATUS_MISSING_OR_MALFORMED_MESSAGE);
});

test('AT-72: status.json is valid JSON but NOT an object (an array) → 404, the exact "missing/unreadable/not-JSON" bucket message', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${NON_OBJECT_STATUS_SESSION}?project=statusbucketproj`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, STATUS_MISSING_OR_MALFORMED_MESSAGE);
});

test('AT-73: status.json is a valid object with NO "phase" field → 404, the exact "no string phase" bucket message — must NOT claim the file was unreadable', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${NO_PHASE_STATUS_SESSION}?project=statusbucketproj`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, STATUS_NO_PHASE_MESSAGE);
  assert.ok(!body.error.toLowerCase().includes('unreadable'), `a valid, readable status.json missing "phase" must NOT be described as unreadable, got: ${body.error}`);
});

test('AT-74: status.json\'s "phase" is present but NOT a string (a number) → 404, the exact "no string phase" bucket message — must NOT claim the file was unreadable', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${NON_STRING_PHASE_STATUS_SESSION}?project=statusbucketproj`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, STATUS_NO_PHASE_MESSAGE);
  assert.ok(!body.error.toLowerCase().includes('unreadable'), `a valid, readable status.json with a non-string phase must NOT be described as unreadable, got: ${body.error}`);
});

// ---------------------------------------------------------------------------
// R4-15 (AT-77) — roadmap-draft rows carry cross-initiative dependsOn edges
// over the REAL wire. This drives the REAL route against a REAL on-disk
// session dir with REAL serializeManifest'd manifests — a unit test that
// constructs its own row object cannot observe a field dropped by the
// route's JSON serialization (standing rule from R2-09: any claim about a
// value surviving a round trip needs at least one AT on the real client
// path).
// ---------------------------------------------------------------------------

test('AT-77: GET /api/studio/sessions/architect/<id>?project=<p> carries "dependsOn" on each roadmap-draft row, verbatim, over the REAL route + REAL serialized manifests', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/architect/${DEPS_SESSION}?project=depsproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;

  const artifact = body.artifact as { kind: string; rows: Array<{ initiativeId: string; dependsOn: unknown }> };
  assert.equal(artifact.kind, 'roadmap-draft');
  const rowA = artifact.rows.find((r) => r.initiativeId === 'INIT-2026-01-01-fixture-a');
  const rowB = artifact.rows.find((r) => r.initiativeId === 'INIT-2026-01-02-fixture-b');
  assert.ok(rowA, `expected row A in the wire response, got: ${JSON.stringify(artifact.rows)}`);
  assert.ok(rowB, `expected row B in the wire response, got: ${JSON.stringify(artifact.rows)}`);
  assert.deepEqual(rowA!.dependsOn, [], 'row A declares no deps — must serialize as [] over the wire, never dropped/undefined');
  assert.deepEqual(
    rowB!.dependsOn,
    ['INIT-2026-01-01-fixture-a', 'INIT-2025-06-01-already-merged'],
    'row B\'s dependsOn must survive the REAL route\'s JSON serialization verbatim, including the entry pointing outside this session\'s own manifest set',
  );
});

// ---------------------------------------------------------------------------
// R4-17 — the "onboarding" session kind threads deriveContractStages
// (cli/contract-stages.ts) into the contract-buildout artifact. This is the
// REAL wire (route → deriveContractStages → deriveSessionArtifact), not a
// unit-level fixture — the standing R2-09 rule that a value's survival
// through the route's own serialization needs at least one real-client-path
// AT.
// ---------------------------------------------------------------------------

test('R4-17 AT-1: GET /api/studio/sessions/onboarding/<id>?project=<p> derives contract-buildout via the REAL deriveContractStages over a REAL onboarded project fixture — 200, honestly one turn, five stage rows in order', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/onboarding/${ONBOARDING_SESSION}?project=onboardedproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;

  assert.equal(body.ok, true);
  assert.equal(body.kind, 'onboarding');
  assert.equal(body.phase, 'running', 'phase must be the real value read from status.json');
  assert.deepEqual(body.stages, ['contract', 'instructions', 'secrets', 'demo', 'roadmap']);
  assert.equal(body.defaultStage, 'contract');

  // D8 — no fabricated interview: the onboarding-agent asks no questions,
  // so the honest transcript is exactly the one prompt.md operator turn.
  assert.equal(body.turns.length, 1, `onboarding must surface honestly as one turn, no fabricated interview questions, got: ${JSON.stringify(body.turns)}`);
  assert.equal(body.turns[0].role, 'operator');
  assert.equal(body.turns[0].source, 'prompt.md');

  const artifact = body.artifact as { kind: string; label: string; stages: Array<{ stage: string; status: string }> };
  assert.equal(artifact.kind, 'contract-buildout');
  assert.equal(artifact.label, 'Contract build-out');
  assert.deepEqual(
    artifact.stages.map((s) => s.stage),
    ['contract', 'instructions', 'secrets', 'demo', 'roadmap'],
    'the derived rows must reach the wire in the declared D2 order, all five, never a dropped row',
  );
  // The fixture's REAL on-disk shape: testProcess.local.cmd + roadmap.md
  // exist; AGENTS.md/CLAUDE.md and the acceptance/demo blocks do not.
  const byStage = (s: string): { status: string } => artifact.stages.find((r) => r.stage === s)!;
  assert.equal(byStage('contract').status, 'present');
  assert.equal(byStage('instructions').status, 'absent');
  assert.equal(byStage('secrets').status, 'absent');
  assert.equal(byStage('demo').status, 'absent');
  assert.equal(byStage('roadmap').status, 'present');
});

test('R4-17 AT-2: a malformed .forge/project.json → deriveContractStages\'s {ok:false} surfaces as a NON-200 error naming the cause, never a 200 with an empty/silent artifact', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/onboarding/${ONBOARDING_BAD_CONFIG_SESSION}?project=malformedcontractproj`);
  assert.notEqual(res.status, 200, 'a malformed project.json must never be smoothed into a 200 — this is the "declared data fails open" shape this campaign keeps finding');
  const body = (await res.json()) as { error?: string; ok?: boolean };
  assert.ok(
    typeof body.error === 'string' && body.error.length > 0,
    `the error response must name the cause, got: ${JSON.stringify(body)}`,
  );
  assert.notEqual(body.ok, true, 'the response must not claim ok:true alongside an error');
});

// ---------------------------------------------------------------------------
// R4-19 WI-2 — the ".kb-" seeding-anchor carve-out. AT-1 is the RED pin that
// flips green on the fix (invalidProjectReason currently rejects ANY
// dot-leading project, full stop, so the real KB-seeding anchor is
// unreachable). AT-2..AT-7 are the containment RATCHET the fix must not
// break — every one of them is a bare SLUG_RE rejection today (nothing in
// the current code special-cases ".kb-" at all, so a leading "." is ALWAYS
// a 400 pre-fix), and MUST remain a 400 once the bounded exact-".kb-"+
// valid-slug carve-out exists, proving the carve-out never widens into a
// general "." allow. AT-8 is the companion pin: the ordinary non-dot path
// is untouched by the carve-out, both before and after.
// ---------------------------------------------------------------------------

test('R4-19 WI-2 AT-1 (RED — reachability, flips green on the fix): GET /api/studio/sessions/project-brain/<sid>?project=.kb-<id> returns the REAL session status (200), not 400', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/project-brain/${KB_SEEDING_SESSION}?project=${KB_SEEDING_PROJECT}`);
  const text = await res.text();
  assert.equal(
    res.status,
    200,
    `a ".kb-" seeding-anchor session must be reachable via a BOUNDED exact-prefix carve-out (R4-19 WI-2) — expected 200, got ${res.status}: ${text}`,
  );
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.ok, true);
  assert.equal(body.kind, 'project-brain');
  assert.equal(body.sessionId, KB_SEEDING_SESSION);
  assert.equal(body.project, KB_SEEDING_PROJECT, 'the dot-anchored project id must be echoed back verbatim, not stripped/normalized');
  assert.equal(body.phase, 'briefing', 'phase must be the REAL value written by the create hand-off (guardedWriteSessionStatus), never fabricated');
});

test('R4-19 WI-2 AT-2 (containment guard — must stay 400 after the fix): a traversal-shaped ".kb-x/../../etc" project param is rejected, never resolving through the exact-prefix carve-out', async () => {
  const ctx: SessionsRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), ensureSessionTail: () => {} };
  const { res, status, body } = captureResponse();
  const rawUrl = `/api/studio/sessions/project-brain/${KB_SEEDING_SESSION}?project=.kb-x/../../etc`;
  const handled = await handleStudioSessionsRoutes({} as import('node:http').IncomingMessage, res, ctx, rawUrl, 'GET');
  assert.equal(handled, true, 'must be handled (not passthrough)');
  assert.equal(status(), 400, `expected 400, got ${status()}: ${JSON.stringify(body())}`);
});

test('R4-19 WI-2 AT-3 (containment guard — must stay 400 after the fix): ".kb-" with an EMPTY slug after the prefix is rejected', async () => {
  const ctx: SessionsRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), ensureSessionTail: () => {} };
  const { res, status, body } = captureResponse();
  const rawUrl = `/api/studio/sessions/project-brain/${KB_SEEDING_SESSION}?project=.kb-`;
  const handled = await handleStudioSessionsRoutes({} as import('node:http').IncomingMessage, res, ctx, rawUrl, 'GET');
  assert.equal(handled, true, 'must be handled (not passthrough)');
  assert.equal(status(), 400, `expected 400, got ${status()}: ${JSON.stringify(body())}`);
});

test('R4-19 WI-2 AT-4 (containment guard — must stay 400 after the fix): "../secret" (no ".kb-" prefix at all) is rejected', async () => {
  const ctx: SessionsRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), ensureSessionTail: () => {} };
  const { res, status, body } = captureResponse();
  const rawUrl = `/api/studio/sessions/project-brain/${KB_SEEDING_SESSION}?project=../secret`;
  const handled = await handleStudioSessionsRoutes({} as import('node:http').IncomingMessage, res, ctx, rawUrl, 'GET');
  assert.equal(handled, true, 'must be handled (not passthrough)');
  assert.equal(status(), 400, `expected 400, got ${status()}: ${JSON.stringify(body())}`);
});

test('R4-19 WI-2 AT-5 (containment guard — must stay 400 after the fix): ".foo" is dot-prefixed but NOT the ".kb-" prefix — rejected, proving the carve-out is never a general "." allow', async () => {
  const ctx: SessionsRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), ensureSessionTail: () => {} };
  const { res, status, body } = captureResponse();
  const rawUrl = `/api/studio/sessions/project-brain/${KB_SEEDING_SESSION}?project=.foo`;
  const handled = await handleStudioSessionsRoutes({} as import('node:http').IncomingMessage, res, ctx, rawUrl, 'GET');
  assert.equal(handled, true, 'must be handled (not passthrough)');
  assert.equal(status(), 400, `expected 400, got ${status()}: ${JSON.stringify(body())}`);
});

test('R4-19 WI-2 AT-6 (containment guard — must stay 400 after the fix): ".kb-<id>" whose id contains a "/" is rejected — proves the carve-out validates the POST-prefix slug, not just the literal prefix', async () => {
  const ctx: SessionsRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), ensureSessionTail: () => {} };
  const { res, status, body } = captureResponse();
  // %2F decodes (via URLSearchParams, same as AT-46's 'a%2Fb' variant) to a
  // literal "/" embedded inside the post-prefix slug.
  const rawUrl = `/api/studio/sessions/project-brain/${KB_SEEDING_SESSION}?project=.kb-abc%2Fdef`;
  const handled = await handleStudioSessionsRoutes({} as import('node:http').IncomingMessage, res, ctx, rawUrl, 'GET');
  assert.equal(handled, true, 'must be handled (not passthrough)');
  assert.equal(status(), 400, `expected 400, got ${status()}: ${JSON.stringify(body())}`);
});

test('R4-19 WI-2 AT-7 (containment guard — must stay 400 after the fix): ".kb-<id>" whose id contains an embedded NUL byte is rejected', async () => {
  const ctx: SessionsRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), ensureSessionTail: () => {} };
  const { res, status, body } = captureResponse();
  // %00 decodes (via URLSearchParams, same as AT-46's '%00' variant) to a
  // literal NUL byte embedded inside the post-prefix slug.
  const rawUrl = `/api/studio/sessions/project-brain/${KB_SEEDING_SESSION}?project=.kb-abc%00def`;
  const handled = await handleStudioSessionsRoutes({} as import('node:http').IncomingMessage, res, ctx, rawUrl, 'GET');
  assert.equal(handled, true, 'must be handled (not passthrough)');
  assert.equal(status(), 400, `expected 400, got ${status()}: ${JSON.stringify(body())}`);
});

test('R4-19 WI-2 AT-8 (companion — unaffected by the carve-out, both before and after): GET /api/studio/sessions/project-brain/<sid>?project=gitpulse still resolves its session unchanged', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/project-brain/${GITPULSE_SESSION}?project=gitpulse`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.ok, true);
  assert.equal(body.kind, 'project-brain');
  assert.equal(body.project, 'gitpulse');
  assert.equal(body.phase, 'analyzing', 'phase must be the real value read from the session\'s status.json — the non-dot path\'s behavior must be identical to AT-40');
});

// ===========================================================================
// R4-19-F2 — the kb-cleanup read branch's fail-loud contract (task brief §4,
// NOT among the 16 explicitly numbered acceptance tests — flagged separately
// in this WI's report as a gap in the enumerated list, but load-bearing per
// the brief's own wording: "A session whose kb_id no longer resolves must
// fail loud, not render an empty artifact"). This is the single test in this
// file exercising that branch; the renderer-level throw-on-missing-findings
// contract is pinned exhaustively in session-transcript.test.ts's own
// R4-19-F2 block instead.
// ===========================================================================

// Kills: a bridge read branch that catches deriveContractStages/lint-lookup
// failures the wrong way and falls through to `deriveSessionArtifact({
// descriptor, sessionDir })` with no cleanupFindings — which (once
// 'cleanup-plan' ships live) throws a DIFFERENT error ("cleanupFindings
// required") that gets smoothed into a generic 500 with no mention of the
// actual root cause (the unresolvable kb_id); also kills a branch that
// swallows the kb_id-resolution failure and renders a 200 with an empty
// cleanup-plan artifact — the exact "declared-data-fails-open" shape this
// whole campaign guards against.
test('R4-19-F2: GET /api/studio/sessions/kb-cleanup/<id>?project=<p> whose stored kb_id resolves to NO real KB fails loud (a non-200 naming the cause), never a 200 with an empty/silent cleanup-plan artifact', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/kb-cleanup/${KB_CLEANUP_UNRESOLVABLE_SESSION}?project=demoproj`);
  assert.notEqual(
    res.status,
    200,
    'a session whose kb_id no longer resolves to any real KB must never be smoothed into a 200 — the fixture\'s status.json genuinely has kb_id:"no-such-kb-anywhere-on-disk" with no matching brain/ dir anywhere',
  );
  const body = (await res.json()) as { error?: string; ok?: boolean };
  assert.ok(
    typeof body.error === 'string' && body.error.length > 0,
    `the error response must name the cause, got: ${JSON.stringify(body)}`,
  );
  assert.notEqual(body.ok, true, 'the response must not claim ok:true alongside an error');
  // Tightened beyond a bare non-200: the error must actually name the
  // UNRESOLVABLE kb_id itself, not just some unrelated failure incidentally
  // reached first (e.g. "cleanup-plan" not yet being a recognised artifact
  // kind at all, today's status quo) — this is what makes this test a real
  // RED pin for the branch-specific fail-loud behaviour rather than a
  // vacuous pass from an earlier-stage failure.
  assert.match(
    body.error!,
    /no-such-kb-anywhere-on-disk/,
    `the error must name the specific unresolvable kb_id the fixture's status.json carries, not a generic/unrelated failure — got: ${body.error}`,
  );
});

// W6-B9 (reviewer finding on W6-B8): the `kbId` field these two tests used
// to pin (R4-19-F2 WI-4c) is REMOVED from the session-shell read route's 200
// wire payload — its one reader, SessionCleanupPanel.tsx, is deleted (W6-B8
// migrated kb-cleanup onto the generic session shell; the generic write
// route reads `status.kb_id` server-side, never off this wire field). The
// AT-KBID-1 affordances assertion this block also carried (kb-cleanup's
// turnSpec-derived verdict shape at "awaiting-approval") is preserved below,
// folded into the existing W6-B8 terminal:false test against the SAME
// fixture session, rather than dropped.

// ===========================================================================
// W6-B8 — `terminal` on the session-shell read route's 200 payload. Threads
// the SAME `isTerminalPhase` derivation the route already used internally to
// gate `ensureSessionTail` (this file's header, W6-B2 review fix) onto the
// wire, so the generic `SessionInteractivePanel` can gate its ActivityLog
// drawer without a second, hand-kept terminal-phase table client-side.
//
// The panel-fallback fix this pins: `isTerminalPhase` previously checked
// ONLY `descriptor.turnSpec` before falling back to
// `LEGACY_SESSION_TERMINAL_PHASES` — a descriptor carrying `panel` instead
// (onboarding, demo, instructions) fell straight to the legacy table, which
// has NO 'onboarding' entry at all (see that table, cli/bridge-studio.ts),
// so onboarding was *always* reported non-terminal, at every phase including
// its own declared-terminal 'complete'/'failed' rows. The fix derives from
// `descriptor.turnSpec?.phases ?? descriptor.panel?.phases` first, exactly
// mirroring `deriveSessionAffordances`'s own precedent — the demo/
// instructions tests below prove this is a no-op for those two kinds (their
// panel-derived terminal set already matches the legacy table verbatim).
// ===========================================================================

test('W6-B8: GET /api/studio/sessions/kb-cleanup/<id> — terminal:false at a non-terminal turnSpec phase ("awaiting-approval")', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/kb-cleanup/${KB_CLEANUP_RESOLVABLE_SESSION}?project=demoproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.terminal, false, `phase "awaiting-approval" (step: noop) is not terminal — got terminal=${JSON.stringify(body.terminal)}`);

  // Folded in from the retired AT-KBID-1 (W6-B9): a TURNSPEC kind
  // (kb-cleanup) at phase "awaiting-approval" ({ step: noop }, no
  // writes/next — that absence IS the approval gate) must derive exactly a
  // "verdict" affordance — proves the bridge threads turnSpec.phases through
  // deriveSessionAffordances, the counterpart to the AT-39 instructions
  // (panel-kind) affordance assertion above.
  assert.deepEqual(
    body.affordances,
    [{ id: 'awaiting-approval-verdict', kind: 'verdict', phase: 'awaiting-approval', meta: { verdicts: ['approve'] } }],
    `expected the turnSpec-derived affordances for phase "awaiting-approval", got: ${JSON.stringify(body.affordances)}`,
  );
});

test('W6-B8: GET /api/studio/sessions/kb-cleanup/<id> — terminal:true at the turnSpec\'s own terminal phase ("applied")', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/kb-cleanup/${KB_CLEANUP_APPLIED_SESSION}?project=demoproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.phase, 'applied');
  assert.equal(body.terminal, true, `phase "applied" (step: terminal) must report terminal=true — got ${JSON.stringify(body.terminal)}`);
});

test('W6-B8 (the panel-fallback fix): GET /api/studio/sessions/onboarding/<id> — terminal:false at a non-terminal PANEL phase ("running")', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/onboarding/${ONBOARDING_SESSION}?project=onboardedproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.phase, 'running');
  assert.equal(body.terminal, false, `phase "running" (step: agent) is not terminal — got terminal=${JSON.stringify(body.terminal)}`);
});

test('W6-B8 (the panel-fallback fix): GET /api/studio/sessions/onboarding/<id> — terminal:true at the panel\'s own terminal phase ("complete") — REGRESSION LOCK: onboarding has no LEGACY_SESSION_TERMINAL_PHASES entry, so before the fix this always read terminal:false, even here', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/onboarding/${ONBOARDING_COMPLETE_SESSION}?project=onboardedproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.phase, 'complete');
  assert.equal(body.terminal, true, `phase "complete" (the panel's own step:'terminal' row) must report terminal=true — got ${JSON.stringify(body.terminal)}`);
});

test('LOW (reviewer finding on W6-B8): GET /api/studio/sessions/onboarding/<id> — terminal:true at the panel\'s OTHER terminal phase ("failed") — proves the fix reads the whole panel.phases table, not just the first terminal row it happens to find', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/onboarding/${ONBOARDING_FAILED_SESSION}?project=onboardedproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.phase, 'failed');
  assert.equal(body.terminal, true, `phase "failed" (the panel's OTHER step:'terminal' row) must report terminal=true — got ${JSON.stringify(body.terminal)}`);
});

test('W6-B8: GET /api/studio/sessions/instructions/<id> — terminal:false at "drafting" (a panel-derived kind whose legacy-table set already agreed — proves the fix is a no-op here)', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${REAL_INSTRUCTIONS_SESSION}?project=demoproj`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as SessionShellBody;
  assert.equal(body.phase, 'drafting');
  assert.equal(body.terminal, false);
});
