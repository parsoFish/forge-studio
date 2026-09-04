/**
 * The shared head of the `session-transcript` contract suites — imports, the
 * session-dir builders and the `okTurns` unwrapper every assertion goes through.
 *
 * Extracted whole when `studio/session-transcript.test.ts` (2,215 lines) was
 * split on its own `// ===` banners (M4 exit row 5, C1). Seams fall between
 * tests; nothing here was rewritten, only re-anchored.
 */

/**
 * Acceptance tests for packages/sessions/studio/session-transcript.ts (R2-10,
 * PR1: the session-shell backend contract).
 *
 * The module under test does not exist yet — this file is RED at branch base
 * (ERR_MODULE_NOT_FOUND on the `./session-transcript.ts` import is the
 * expected red).
 *
 * AT numbers continue the flat R2-10 sequence started in
 * packages/sessions/studio/session-kinds.test.ts (AT-1..AT-18, +AT-49..AT-56 in
 * the AT-amendment-2 round, +AT-61..AT-67 in AT-amendment-3). This file
 * covers AT-19..AT-37, +AT-57..AT-58 (AT-amendment-2), +AT-68..AT-69
 * (AT-amendment-3), +AT-75..AT-76 (R4-15), +AT-78 (R4-15 adversarial-review
 * amendment). packages/sessions/bridge-studio-sessions.test.ts covers AT-38..AT-48,
 * +AT-59..AT-60, +AT-70..AT-74, +AT-77 (R4-15).
 *
 * R4-15 (AT-75..78): `RoadmapDraftRow` gains a fifth field, `dependsOn:
 * string[]`, sourced from the manifest's `depends_on_initiatives` (already
 * parsed by `parseManifest`, packages/flows/manifest.ts, but dropped on the
 * floor by `deriveRoadmapDraft` before this round). See the dedicated
 * describe block below for the full rationale. AT-78 (adversarial-review
 * amendment, 2026-08-06) is a GREEN characterization pin, not a defect pin
 * — see its own comment for why it still earns its place.
 *
 * AT-amendment-3, A2 (AT-68..69): `listDirEntries` (session-transcript.ts)
 * calls `readdirSync` on `manifests/`/`themes/` with no realpath containment
 * check on the SUBDIRECTORY itself — if that subdirectory is ITSELF a
 * symlink to an outside directory, `readdirSync` follows it. Per-file
 * content stays blocked (`safeReadFileInSession` still realpath-guards each
 * individual read), but the module's own comment claiming this "leaks
 * nothing" is not quite accurate: empirically verified (see the T3 report)
 * that for `brain-structure` the outside filename genuinely never surfaces
 * anywhere in the returned artifact today (the null-body entries are
 * silently skipped before `files`/`themeCount` are computed — already
 * correct), but for `roadmap-draft`, `sourcesScanned` reports
 * `${files.length} file(s) found` computed from the UN-filtered
 * `listDirEntries` result — which DOES reflect the escaped directory's real
 * file count. T2's ruling: the subdirectory gets the SAME realpath
 * containment as the files (an escaping dir-symlink is treated as absent,
 * exactly like a missing directory) — AT-68/69 pin that end state.
 *
 * AT-amendment-2 (T2-ratified, supersedes the implementer's original design):
 * `questions.json` pending-ness is no longer exact-text set-difference
 * against answered questions (that silently DROPPED a legitimately re-asked
 * VERBATIM question — a session genuinely `awaiting-answers` would render
 * with no pending turn, looking idle). `deriveSessionTranscript` now takes
 * the caller's real `phase` and a `questions.json` entry is a pending agent
 * turn IFF `phase === 'awaiting-answers'` (the same string both
 * architect-runner.ts and instructions-runner.ts write to status.json while
 * blocked on the operator — packages/sessions/interactive-session.ts's
 * questions/answers handoff). Any other phase ⇒ questions.json (if present)
 * is stale leftover and contributes no turn, regardless of its text. AT-57/58
 * pin the two directions; every pre-existing call site below was amended to
 * pass an explicit `phase` (most don't have a questions.json fixture at all,
 * so the exact value is inert for them — a real, grounded phase string is
 * used regardless, never a placeholder).
 *
 * Design decisions this file pins (see the T3 report for full rationale):
 *
 *   - Derivation is FILE-PRESENCE-DRIVEN, not descriptor.id-driven: it always
 *     scans the same fixed candidate list (idea.md, prompt.md, answers.json,
 *     questions.json, feedback.md) and reacts to whichever exist. This is
 *     what makes project-brain's "honestly one turn" fall out NATURALLY (its
 *     runner never writes answers.json/questions.json/feedback.md — there is
 *     no interview) rather than requiring a hardcoded per-kind branch, and is
 *     also what lets a synthetic, non-shipped descriptor exercise the
 *     multi-stage machinery (AT-21/AT-22) — the module must stay generic
 *     over descriptor shape, per the spec's explicit ask for a working
 *     multi-stage companion case.
 *   - Within one answered interview round, the AGENT turn (the round's
 *     question) and the OPERATOR turn (the round's answer) share the SAME
 *     `source` string, `answers.json#round-N` — both come from literally the
 *     same round object in the same file.
 *   - `AnswerRound` (packages/sessions/interactive-session.ts:303) carries no
 *     `stage` field in its documented shape today (every shipped kind is
 *     single-stage, so it never needs one). This module reads an OPTIONAL
 *     `stage` key on the round object when present — a forward-compatible
 *     superset the real runners never populate yet, but which is exactly the
 *     "stage marker" the spec's fail-closed/multi-stage ATs require the
 *     derivation to honor generically. Absent ⇒ descriptor.defaultStage.
 *   - Malformed answers.json (any shape violation, at any level) fails
 *     CLOSED — `{ok:false}` — rather than skipping the bad round and
 *     continuing; this keeps "never fabricate" unambiguous (no partial
 *     transcript with a silently-dropped round).
 *   - `deriveSessionArtifact` throws for a reserved artifact kind.
 */

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { deriveSessionTranscript } from '../../../studio/session-transcript.ts';
import type { SessionKindDescriptor } from '../../../studio/session-kinds.ts';
import type { InitiativeManifest } from '@forge/contracts/manifest-types.ts';

/**
 * The injected manifest parser, as a REFUSING stub (M4 ruling 83 / 91).
 *
 * This file used to pass the real `parseManifest` from `@forge/flows` — a
 * `package-layer-order` row, since flows is rank 5 and this package rank 4 —
 * even though the artifact kinds exercised here (instructions, project-brain,
 * authoring, cleanup-plan, …) never parse a manifest. The six cases that DID
 * need the real functions moved to `apps/forge/roadmap-draft-integration.test.ts`,
 * where the assembly may import both.
 *
 * A throwing stub is strictly better than the real function here: it ASSERTS
 * that these kinds never reach the parser, where passing the real one merely
 * failed to notice.
 */
export const parseManifest = (): InitiativeManifest => {
  throw new Error(
    'parseManifest must not be reached by this artifact kind — the roadmap-draft cases that ' +
      'legitimately parse manifests live in apps/forge/roadmap-draft-integration.test.ts',
  );
};

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];

export function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// R4-19-F2-fix — ground truth from the REAL live agent run that surfaced the
// P1 (declared-data-fails-open: every real action read "cleared", both
// findings reported as already resolved while the brain was byte-unchanged).
// Read from disk via a path derived from THIS module's own location (never
// pasted inline) so these two files stay the single source of truth and can
// never silently drift from what actually shipped in
// scripts/journeys/fixtures/r4-19-f2-live-capture/.
// ---------------------------------------------------------------------------

const REPO_ROOT = FORGE_ROOT;
const LIVE_CAPTURE_DIR = join(REPO_ROOT, 'scripts', 'journeys', 'fixtures', 'r4-19-f2-live-capture');

/** The real 2681-byte agent-authored plan (as captured — see module header
 *  above), read once at file-load time so every test below drives the exact
 *  same on-disk bytes verbatim, never a paraphrase. */
export const REAL_CLEANUP_PLAN_MD = readFileSync(join(LIVE_CAPTURE_DIR, 'cleanup-plan.md'), 'utf8');

/** The real captured session status.json, parsed once. `findings[].file` is
 *  ABSOLUTE by contract (packages/knowledge/brain-lint.ts:54, `file: string; // absolute
 *  path`) — exactly the shape that broke the naive literal-string join this
 *  defect pins. */
export type RealFinding = { readonly kind: string; readonly file: string; readonly category: string; readonly message: string; readonly check: string; readonly resolution: string };
export const REAL_STATUS: { readonly findings: readonly RealFinding[] } = JSON.parse(readFileSync(join(LIVE_CAPTURE_DIR, 'status.json'), 'utf8'));

// Sanity-check the fixtures themselves at load time — if either file is ever
// edited out from under these tests, fail loud immediately rather than let
// every downstream test below silently test the wrong thing.
if (REAL_STATUS.findings.length !== 2) {
  throw new Error(`R4-19-F2-fix fixture drift: expected exactly 2 real findings in status.json, got ${REAL_STATUS.findings.length}`);
}
if (!REAL_STATUS.findings.every((f) => f.file.startsWith('/'))) {
  throw new Error('R4-19-F2-fix fixture drift: every real finding.file must be an absolute path — the fixture no longer reproduces the defect this file pins');
}

const REAL_FINDING_SOFT_CAP = REAL_STATUS.findings.find((f) => f.kind === 'length.soft-cap');
export const REAL_FINDING_DANGLING = REAL_STATUS.findings.find((f) => f.kind === 'edge.dangling');
if (!REAL_FINDING_SOFT_CAP || !REAL_FINDING_DANGLING) {
  throw new Error(`R4-19-F2-fix fixture drift: expected one "length.soft-cap" and one "edge.dangling" finding, got kinds: ${REAL_STATUS.findings.map((f) => f.kind).join(', ')}`);
}
/** The real repo-relative target string the real markdown plan actually
 *  writes for the edge.dangling action — read straight back out of
 *  REAL_CLEANUP_PLAN_MD rather than hand-typed, so it can never drift from
 *  the fixture. */
const REAL_DANGLING_TARGET_LINE = REAL_CLEANUP_PLAN_MD.split('\n').find((l) => l.includes('[edge.dangling]'));
if (!REAL_DANGLING_TARGET_LINE) {
  throw new Error('R4-19-F2-fix fixture drift: expected an "[edge.dangling]" action line in the real cleanup-plan.md fixture');
}
const REAL_DANGLING_TARGET_MATCH = /\[edge\.dangling\]\s+(\S+)/.exec(REAL_DANGLING_TARGET_LINE);
if (!REAL_DANGLING_TARGET_MATCH) {
  throw new Error(`R4-19-F2-fix fixture drift: could not extract the edge.dangling action's target from: ${REAL_DANGLING_TARGET_LINE}`);
}
/** e.g. "brain/forge-dev/themes/exploration-vs-implementation-initiatives.md"
 *  — repo-relative, exactly as skills/brain-maintenance/SKILL.md mandates. */
export const REAL_DANGLING_TARGET_RELATIVE = REAL_DANGLING_TARGET_MATCH[1];
if (!REAL_FINDING_DANGLING.file.endsWith(`/${REAL_DANGLING_TARGET_RELATIVE}`)) {
  throw new Error(
    `R4-19-F2-fix fixture drift: the plan's edge.dangling target "${REAL_DANGLING_TARGET_RELATIVE}" is no longer a suffix of the real finding's absolute file "${REAL_FINDING_DANGLING.file}"`,
  );
}

export function architectDescriptor(overrides: Partial<SessionKindDescriptor> = {}): SessionKindDescriptor {
  return {
    id: 'architect',
    agent: 'architect',
    title: 'Architect',
    legacyRoutes: ['/architect/[sessionId]', '/architect/[sessionId]/interview'],
    stages: ['roadmap'],
    defaultStage: 'roadmap',
    artifact: { kind: 'roadmap-draft', label: 'Roadmap draft' },
    ...overrides,
  } as SessionKindDescriptor;
}

export function instructionsDescriptor(overrides: Partial<SessionKindDescriptor> = {}): SessionKindDescriptor {
  return {
    id: 'instructions',
    agent: 'instructions-creator',
    title: 'Instructions',
    legacyRoutes: ['/instructions/[sessionId]'],
    stages: ['instructions'],
    defaultStage: 'instructions',
    artifact: { kind: 'markdown-draft', label: 'AGENTS.md draft' },
    ...overrides,
  } as SessionKindDescriptor;
}

export function projectBrainDescriptor(overrides: Partial<SessionKindDescriptor> = {}): SessionKindDescriptor {
  return {
    id: 'project-brain',
    agent: 'project-brain-builder',
    title: 'Project Brain',
    legacyRoutes: ['/project-brain/[sessionId]'],
    stages: ['brain'],
    defaultStage: 'brain',
    artifact: { kind: 'brain-structure', label: 'Seeded structure' },
    ...overrides,
  } as SessionKindDescriptor;
}

/** R4-16: the new "demo" session kind (studio/session-kinds.yaml — not shipped
 *  yet at branch base). id "demo" — NOT "demo-builder" — matches the real
 *  descriptor's contract (session-kinds.test.ts AT-22). */
export function demoDescriptor(overrides: Partial<SessionKindDescriptor> = {}): SessionKindDescriptor {
  return {
    id: 'demo',
    agent: 'demo-builder',
    title: 'Demo capability session',
    legacyRoutes: [],
    stages: ['demo'],
    defaultStage: 'demo',
    artifact: { kind: 'generation-gallery', label: 'Demo generations' },
    ...overrides,
  } as SessionKindDescriptor;
}

/** R4-17: the new "onboarding" session kind (studio/session-kinds.yaml — not
 *  shipped yet at branch base). D1: ONE descriptor shared by onboarding AND
 *  creation (session-kinds.test.ts's real-repo AT pins the real, on-disk
 *  values this mirrors). */
export function onboardingDescriptor(overrides: Partial<SessionKindDescriptor> = {}): SessionKindDescriptor {
  return {
    id: 'onboarding',
    agent: 'onboarding-agent',
    title: 'Onboarding session',
    legacyRoutes: [],
    stages: ['contract', 'instructions', 'secrets', 'demo', 'roadmap'],
    defaultStage: 'contract',
    artifact: { kind: 'contract-buildout', label: 'Contract build-out' },
    ...overrides,
  } as SessionKindDescriptor;
}

/** R4-21: the new "authoring" session kind (studio/session-kinds.yaml — not
 *  shipped yet at branch base; see session-kinds.test.ts's RED-1a..1d). One
 *  OOTB interactive agent (`creation-agent`, skills/creation-agent/SKILL.md —
 *  does not exist yet either) that authors a skill/hook file-package through
 *  an R2-10 session; artifact kind 'file-package' (this file's RED-2a/b/c,
 *  below). `stages`/`defaultStage` deliberately use the CURRENT,
 *  already-shipped 'roadmap' token rather than the not-yet-shipped
 *  'authoring' SESSION_STAGES token — deriveSessionArtifact (unlike
 *  deriveSessionTranscript) never reads `stages` at all, so this keeps the
 *  file-package fixtures below fully decoupled from the SEPARATE
 *  SESSION_STAGES extension pinned in session-kinds.test.ts. */
export function authoringDescriptor(overrides: Partial<SessionKindDescriptor> = {}): SessionKindDescriptor {
  return {
    id: 'authoring',
    agent: 'creation-agent',
    title: 'Authoring session',
    legacyRoutes: [],
    stages: ['roadmap'],
    defaultStage: 'roadmap',
    artifact: { kind: 'file-package', label: 'Draft package' },
    ...overrides,
  } as SessionKindDescriptor;
}

/** A minimal, hand-fixtured `ContractStageRow[]` — deliberately NOT imported
 *  from packages/projects/contract-stages.ts (this module stays a pure, fs-only
 *  derivation with no business importing the derivation module that
 *  computes these rows; the route (packages/sessions/bridge-studio-sessions.ts) is the
 *  layer that wires the real deriveContractStages output in). Mirrors this
 *  file's existing convention of hand-fixturing rather than cross-importing
 *  (see e.g. writeGeneration's own header note). */
export function fixtureContractStages(): Array<{ stage: string; status: string; source: string; detail: string[]; bytes: number | null }> {
  return [
    { stage: 'contract', status: 'present', source: '.forge/project.json', detail: ['npm test'], bytes: null },
    { stage: 'instructions', status: 'absent', source: 'AGENTS.md', detail: [], bytes: null },
    { stage: 'secrets', status: 'absent', source: '.forge/project.json', detail: [], bytes: null },
    { stage: 'demo', status: 'absent', source: '.forge/project.json + .forge/demo/demo.lock.json', detail: [], bytes: null },
    { stage: 'roadmap', status: 'present', source: 'roadmap.md', detail: [], bytes: 42 },
  ];
}

export function writeJson(sessionDir: string, name: string, value: unknown): void {
  writeFileSync(join(sessionDir, name), JSON.stringify(value, null, 2), 'utf8');
}

/** Writes one `generations/<n>/` snapshot fixture (demo-builder-runner.ts's
 *  R4-16 on-disk shape) directly onto a session dir — mirrors this file's
 *  existing `writeJson`/plain-fs fixture idiom, not a helper imported from
 *  the runner (this module must stay a pure, fs-only derivation, per the
 *  header's rationale for re-declaring constants rather than importing the
 *  live runner). `metaRaw`, when given, is written VERBATIM instead of a
 *  well-formed meta.json — for the malformed-metadata ATs. */
export function writeGeneration(
  sessionDir: string,
  n: number | string,
  opts: {
    iteration?: number | string;
    createdAt?: string;
    feedback?: string | null;
    targetElement?: string | null;
    composed?: boolean;
    skillRelPath?: string;
    files?: Record<string, string>;
    metaRaw?: string;
    extraMetaFields?: Record<string, unknown>;
  } = {},
): void {
  const dir = join(sessionDir, 'generations', String(n));
  mkdirSync(dir, { recursive: true });
  const files = opts.files ?? { 'DEMO.html': `<html>generation ${n}</html>`, 'SKILL.md': `# skill ${n}` };
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body, 'utf8');
  if (opts.metaRaw !== undefined) {
    writeFileSync(join(dir, 'meta.json'), opts.metaRaw, 'utf8');
    return;
  }
  const meta = {
    iteration: opts.iteration ?? n,
    createdAt: opts.createdAt ?? '2026-08-06T10:00:00.000Z',
    feedback: opts.feedback === undefined ? null : opts.feedback,
    targetElement: opts.targetElement === undefined ? null : opts.targetElement,
    composed: opts.composed ?? false,
    skillRelPath: opts.skillRelPath ?? '.forge/skills/demo-design/SKILL.md',
    ...(opts.extraMetaFields ?? {}),
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
}

/** Writes one file into a file-package session's `staging/` subdirectory
 *  (R4-21 phase 2, D2) — mirrors this file's own `manifests/`/`themes/`/
 *  `generations/` fixture idiom (see writeGeneration's own header note): a
 *  DEDICATED subdirectory, never the bare session root, so a creation-agent
 *  session's accumulating draft package can never collide with the fixed
 *  CANDIDATE_SOURCE_FILES transcript scan (idea.md/prompt.md/answers.json/
 *  questions.json/feedback.md) that deriveSessionTranscript unconditionally
 *  scans on every session dir regardless of kind.
 *
 *  RENAMED from `package/` (R4-21 phase 1) to `staging/` (R4-21 phase 2, D2,
 *  `_wave5/unit-specs/R4-21-phase2.md`): ADR-043 §1's ratified turnSpec row
 *  declares `writes: [staging]` for the `analyzing` phase, and
 *  `copyStagingToLibrary` (packages/sessions/interactive-finalizers.ts) sources
 *  `<sessionDir>/staging/` — `package/` predates the ADR and has zero
 *  production users, so it is renamed to match the ratified data rather than
 *  parameterising the finalizer. The rename is COMPLETE, not additive — see
 *  RED-2f below, which pins that a leftover `package/` dir is no longer
 *  scanned at all. */
export function writeStagingFile(sessionDir: string, relPath: string, body: string): void {
  const abs = join(sessionDir, 'staging', relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

export function okTurns(result: ReturnType<typeof deriveSessionTranscript>): Array<{ index: number; role: string; stage: string; text: string; source: string }> {
  assert.equal((result as { ok: boolean }).ok, true, `expected ok:true, got: ${JSON.stringify(result)}`);
  return (result as unknown as { turns: Array<{ index: number; role: string; stage: string; text: string; source: string }> }).turns;
}

