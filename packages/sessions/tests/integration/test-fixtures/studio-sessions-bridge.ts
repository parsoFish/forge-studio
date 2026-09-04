import { BADSTAGE_SESSION, DEPS_SESSION, F6_DERIVED_PROJECT, F6_FIRST_PHASE, F6_LAST_PHASE, F6_NO_EVENTS_SESSION, F6_RUN_LEGACY, F6_RUN_NOWHERE, F6_RUN_STATUS_BACKED, F6_SECRET_MARKER, F6_SHAPE_A_SESSION, F6_SHAPE_B_PROJECT, F6_SHAPE_B_SESSION, F6_SYMLINK_ESCAPE_SESSION, INVALID_JSON_STATUS_SESSION, KB_CLEANUP_APPLIED_SESSION, KB_CLEANUP_RESOLVABLE_KB_ID, KB_CLEANUP_RESOLVABLE_SESSION, KB_CLEANUP_UNRESOLVABLE_SESSION, MISSING_STATUS_SESSION, MODEL_TIER_SESSION, NON_OBJECT_STATUS_SESSION, NON_STRING_PHASE_STATUS_SESSION, NO_PHASE_STATUS_SESSION, ONBOARDING_BAD_CONFIG_SESSION, ONBOARDING_COMPLETE_SESSION, ONBOARDING_FAILED_SESSION, ONBOARDING_SESSION, REAL_ARCHITECT_SESSION, REAL_INSTRUCTIONS_SESSION, REAL_PROJECT_BRAIN_SESSION, REASK_SESSION, SECRET_MARKER, STATUS_ESCAPE_SESSION, STATUS_SECRET_MARKER, VICTIM_SESSION, realManifest, writeArchitectSession, writeArchitectSessionWithDeps, writeCleanupSessionApplied, writeCleanupSessionWithResolvableKb, writeCleanupSessionWithUnresolvableKb, writeInstructionsSession, writeInstructionsSessionWithModelTier, writeOnboardingCompleteSession, writeOnboardingFailedSession, writeProjectBrainSession, writeResolvableKb, writeSessionKindsYaml, writeSkillAgent } from './studio-sessions-builders.ts';
import { before, after } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startBridge } from '../../../../../apps/forge/ui-bridge.ts';
import { serializeManifest } from '@forge/flows/manifest.ts';
import { guardedWriteSessionStatus } from '../../../session-status-io.ts';
import type { ProjectBrainStatus } from '../../../kinds/project-brain.ts';

/** The bridge's own mutable state. It lives HERE, with the `before()` that
 *  assigns it, because a module cannot assign through an import binding —
 *  keeping it in the builders fixture made this file fail to compile. */
export let forgeRoot: string;
export let bridgeUrl: string;
export let closeBridge: () => Promise<void>;

// ---------------------------------------------------------------------------
// R4-19 WI-2 — the ".kb-" seeding-anchor carve-out fixture. CONTEXT: R1-06's
// KB-create hand-off (packages/knowledge/bridge-studio-kbs.ts:1005-1044) anchors a
// non-project-bound KB's seeding session at
// `projects/.kb-<id>/_project-brain/<sid>/` (KB_SEEDING_ANCHOR_PREFIX =
// '.kb-', packages/knowledge/bridge-studio-kbs.ts:690, unexported — mirrored here as a
// literal, same idiom this file already uses for `newProjectBrainSessionId`)
// so `discoverProjects` (which filters ALL dot-dirs) never surfaces it as a
// phantom project. This route's `invalidProjectReason` currently rejects
// EVERY project starting with "." via a bare SLUG_RE test, making that same
// anchor unreachable through the session shell.
// ---------------------------------------------------------------------------

const KB_SEEDING_ID = 'seedkb';
export const KB_SEEDING_PROJECT = `.kb-${KB_SEEDING_ID}`;
export const KB_SEEDING_SESSION = '2026-08-10T09-10-00';
export const GITPULSE_SESSION = '2026-08-10T09-11-00';
// W7-FIX-A4 (W7A4-02): the same anchor for a KB whose id is KB_ID_RE-valid
// but NOT SLUG_RE-valid — mixed case + digit-leading — exactly what the create
// route accepts and the seeding hand-off writes to disk.
const KB_SEEDING_MIXED_ID = '2026-MyNotes';
export const KB_SEEDING_MIXED_PROJECT = `.kb-${KB_SEEDING_MIXED_ID}`;
export const KB_SEEDING_MIXED_SESSION = '2026-08-19T09-12-00';

/**
 * Mirrors the REAL create hand-off (packages/knowledge/bridge-studio-kbs.ts:1026-1044)
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
// so `deriveContractStages` (packages/projects/contract-stages.ts) has something real to
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

// ---------------------------------------------------------------------------
// F6 (wave-8) — "a linked session must be readable" fixtures.
// ---------------------------------------------------------------------------

/** Shape A: a legacy session whose ONLY surviving state is its central event
 *  log, with NO project-side `_architect/<sid>/` dir anywhere. Real-shaped
 *  event lines (the same field set a genuine architect turn writes) with TWO
 *  different metadata.phase values so "last wins" is observable over the
 *  wire, and one metadata.project. */
function writeF6ShapeALogOnly(forgeRoot: string, sessionId: string): void {
  const dir = join(forgeRoot, '_logs', `_architect-${sessionId}`);
  mkdirSync(dir, { recursive: true });
  const lines = [
    {
      event_id: 'ev-f6-1', cycle_id: 'c-f6', started_at: '2026-08-27T09:00:00.000Z',
      initiative_id: 'INIT-f6-fixture', phase: 'architect', skill: 'architect',
      event_type: 'log', message: 'session started',
      metadata: { session_id: sessionId, phase: F6_FIRST_PHASE, project: F6_DERIVED_PROJECT },
    },
    {
      event_id: 'ev-f6-2', cycle_id: 'c-f6', started_at: '2026-08-27T09:05:00.000Z',
      initiative_id: 'INIT-f6-fixture', phase: 'architect', skill: 'architect',
      event_type: 'log', message: 'roadmap drafted',
      metadata: { session_id: sessionId, phase: F6_LAST_PHASE },
    },
  ];
  writeFileSync(join(dir, 'events.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, 'utf8');
}

/** Shape B: a project-side `_architect/<sid>/` dir exists (no status.json)
 *  plus the companion log dir. */
function writeF6ShapeBFixture(forgeRoot: string, projectsRoot: string, project: string, sessionId: string): void {
  mkdirSync(join(projectsRoot, project, '_architect', sessionId), { recursive: true });
  const dir = join(forgeRoot, '_logs', `_architect-${sessionId}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'events.jsonl'),
    `${JSON.stringify({
      event_id: 'ev-f6-b1', cycle_id: 'c-f6b', started_at: '2026-08-27T09:01:00.000Z',
      initiative_id: 'INIT-f6-fixture-b', phase: 'architect', skill: 'architect',
      event_type: 'log', message: 'shape b',
      metadata: { session_id: sessionId, phase: 'analyzing' },
    })}\n`,
    'utf8',
  );
}

/** A log dir that exists but has NO events.jsonl (only stderr.log) — the
 *  spec's "a dir with neither status.json nor events.jsonl stays 404". */
function writeF6LogDirWithNoEvents(forgeRoot: string, sessionId: string): void {
  const dir = join(forgeRoot, '_logs', `_architect-${sessionId}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'stderr.log'), 'some runner noise, no events.jsonl here\n', 'utf8');
}

/** AT-F6-R7: a legacy log dir whose events.jsonl is a SYMLINK to a file
 *  OUTSIDE `_logs`, carrying a secret marker. */
function writeF6SymlinkEscapeFixture(forgeRoot: string, sessionId: string): void {
  const dir = join(forgeRoot, '_logs', `_architect-${sessionId}`);
  mkdirSync(dir, { recursive: true });
  const outsideDir = join(forgeRoot, '_f6-escape-outside');
  mkdirSync(outsideDir, { recursive: true });
  const outsidePath = join(outsideDir, 'evil-events.jsonl');
  writeFileSync(outsidePath, `${JSON.stringify({ metadata: { phase: F6_SECRET_MARKER, project: F6_SECRET_MARKER } })}\n`, 'utf8');
  symlinkSync(outsidePath, join(dir, 'events.jsonl'));
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
  writeKbSeedingHandoffSession(projectsRoot, KB_SEEDING_MIXED_ID, KB_SEEDING_MIXED_SESSION);
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

  // F6 (wave-8) — "a linked session must be readable" fixtures.
  writeF6ShapeALogOnly(forgeRoot, F6_SHAPE_A_SESSION);
  writeF6ShapeBFixture(forgeRoot, projectsRoot, F6_SHAPE_B_PROJECT, F6_SHAPE_B_SESSION);
  writeF6LogDirWithNoEvents(forgeRoot, F6_NO_EVENTS_SESSION);
  writeF6SymlinkEscapeFixture(forgeRoot, F6_SYMLINK_ESCAPE_SESSION);
  // AT-F6-R8 — a queue manifest whose architect_session_id resolves NOWHERE
  // (no project dir, no log dir); one whose id is a REAL status-backed
  // session; one whose id is a REAL legacy-only (Shape A) session.
  writeFileSync(
    join(forgeRoot, '_queue', 'pending', `${F6_RUN_NOWHERE}.md`),
    serializeManifest(realManifest({ initiative_id: F6_RUN_NOWHERE, project: 'demoproj', architect_session_id: 'nowhere-session-id-000000' })),
    'utf8',
  );
  writeFileSync(
    join(forgeRoot, '_queue', 'pending', `${F6_RUN_STATUS_BACKED}.md`),
    serializeManifest(realManifest({ initiative_id: F6_RUN_STATUS_BACKED, project: 'demoproj', architect_session_id: REAL_ARCHITECT_SESSION })),
    'utf8',
  );
  writeFileSync(
    join(forgeRoot, '_queue', 'pending', `${F6_RUN_LEGACY}.md`),
    serializeManifest(realManifest({ initiative_id: F6_RUN_LEGACY, project: 'demoproj', architect_session_id: F6_SHAPE_A_SESSION })),
    'utf8',
  );

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

