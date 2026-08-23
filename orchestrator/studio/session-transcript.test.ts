/**
 * Acceptance tests for orchestrator/studio/session-transcript.ts (R2-10,
 * PR1: the session-shell backend contract).
 *
 * The module under test does not exist yet — this file is RED at branch base
 * (ERR_MODULE_NOT_FOUND on the `./session-transcript.ts` import is the
 * expected red).
 *
 * AT numbers continue the flat R2-10 sequence started in
 * orchestrator/studio/session-kinds.test.ts (AT-1..AT-18, +AT-49..AT-56 in
 * the AT-amendment-2 round, +AT-61..AT-67 in AT-amendment-3). This file
 * covers AT-19..AT-37, +AT-57..AT-58 (AT-amendment-2), +AT-68..AT-69
 * (AT-amendment-3), +AT-75..AT-76 (R4-15), +AT-78 (R4-15 adversarial-review
 * amendment). cli/bridge-studio-sessions.test.ts covers AT-38..AT-48,
 * +AT-59..AT-60, +AT-70..AT-74, +AT-77 (R4-15).
 *
 * R4-15 (AT-75..78): `RoadmapDraftRow` gains a fifth field, `dependsOn:
 * string[]`, sourced from the manifest's `depends_on_initiatives` (already
 * parsed by `parseManifest`, orchestrator/manifest.ts, but dropped on the
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
 * blocked on the operator — orchestrator/interactive-session.ts's
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
 *   - `AnswerRound` (orchestrator/interactive-session.ts:303) carries no
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

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { deriveSessionTranscript, deriveSessionArtifact } from './session-transcript.ts';
import type { CleanupPlanAction } from './session-transcript.ts';
import type { SessionKindDescriptor } from './session-kinds.ts';
import { serializeManifest, type InitiativeManifest } from '../manifest.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];

function makeTmpDir(prefix: string): string {
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

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIVE_CAPTURE_DIR = join(REPO_ROOT, 'scripts', 'journeys', 'fixtures', 'r4-19-f2-live-capture');

/** The real 2681-byte agent-authored plan (as captured — see module header
 *  above), read once at file-load time so every test below drives the exact
 *  same on-disk bytes verbatim, never a paraphrase. */
const REAL_CLEANUP_PLAN_MD = readFileSync(join(LIVE_CAPTURE_DIR, 'cleanup-plan.md'), 'utf8');

/** The real captured session status.json, parsed once. `findings[].file` is
 *  ABSOLUTE by contract (cli/brain-lint.ts:54, `file: string; // absolute
 *  path`) — exactly the shape that broke the naive literal-string join this
 *  defect pins. */
type RealFinding = { readonly kind: string; readonly file: string; readonly category: string; readonly message: string; readonly check: string; readonly resolution: string };
const REAL_STATUS: { readonly findings: readonly RealFinding[] } = JSON.parse(readFileSync(join(LIVE_CAPTURE_DIR, 'status.json'), 'utf8'));

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
const REAL_FINDING_DANGLING = REAL_STATUS.findings.find((f) => f.kind === 'edge.dangling');
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
const REAL_DANGLING_TARGET_RELATIVE = REAL_DANGLING_TARGET_MATCH[1];
if (!REAL_FINDING_DANGLING.file.endsWith(`/${REAL_DANGLING_TARGET_RELATIVE}`)) {
  throw new Error(
    `R4-19-F2-fix fixture drift: the plan's edge.dangling target "${REAL_DANGLING_TARGET_RELATIVE}" is no longer a suffix of the real finding's absolute file "${REAL_FINDING_DANGLING.file}"`,
  );
}

function architectDescriptor(overrides: Partial<SessionKindDescriptor> = {}): SessionKindDescriptor {
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

function instructionsDescriptor(overrides: Partial<SessionKindDescriptor> = {}): SessionKindDescriptor {
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

function projectBrainDescriptor(overrides: Partial<SessionKindDescriptor> = {}): SessionKindDescriptor {
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
function demoDescriptor(overrides: Partial<SessionKindDescriptor> = {}): SessionKindDescriptor {
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
function onboardingDescriptor(overrides: Partial<SessionKindDescriptor> = {}): SessionKindDescriptor {
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
function authoringDescriptor(overrides: Partial<SessionKindDescriptor> = {}): SessionKindDescriptor {
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
 *  from cli/contract-stages.ts (this module stays a pure, fs-only
 *  derivation with no business importing the derivation module that
 *  computes these rows; the route (cli/bridge-studio-sessions.ts) is the
 *  layer that wires the real deriveContractStages output in). Mirrors this
 *  file's existing convention of hand-fixturing rather than cross-importing
 *  (see e.g. writeGeneration's own header note). */
function fixtureContractStages(): Array<{ stage: string; status: string; source: string; detail: string[]; bytes: number | null }> {
  return [
    { stage: 'contract', status: 'present', source: '.forge/project.json', detail: ['npm test'], bytes: null },
    { stage: 'instructions', status: 'absent', source: 'AGENTS.md', detail: [], bytes: null },
    { stage: 'secrets', status: 'absent', source: '.forge/project.json', detail: [], bytes: null },
    { stage: 'demo', status: 'absent', source: '.forge/project.json + .forge/demo/demo.lock.json', detail: [], bytes: null },
    { stage: 'roadmap', status: 'present', source: 'roadmap.md', detail: [], bytes: 42 },
  ];
}

function writeJson(sessionDir: string, name: string, value: unknown): void {
  writeFileSync(join(sessionDir, name), JSON.stringify(value, null, 2), 'utf8');
}

/** Writes one `generations/<n>/` snapshot fixture (demo-builder-runner.ts's
 *  R4-16 on-disk shape) directly onto a session dir — mirrors this file's
 *  existing `writeJson`/plain-fs fixture idiom, not a helper imported from
 *  the runner (this module must stay a pure, fs-only derivation, per the
 *  header's rationale for re-declaring constants rather than importing the
 *  live runner). `metaRaw`, when given, is written VERBATIM instead of a
 *  well-formed meta.json — for the malformed-metadata ATs. */
function writeGeneration(
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
 *  `copyStagingToLibrary` (orchestrator/interactive-finalizers.ts) sources
 *  `<sessionDir>/staging/` — `package/` predates the ADR and has zero
 *  production users, so it is renamed to match the ratified data rather than
 *  parameterising the finalizer. The rename is COMPLETE, not additive — see
 *  RED-2f below, which pins that a leftover `package/` dir is no longer
 *  scanned at all. */
function writeStagingFile(sessionDir: string, relPath: string, body: string): void {
  const abs = join(sessionDir, 'staging', relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

function okTurns(result: ReturnType<typeof deriveSessionTranscript>): Array<{ index: number; role: string; stage: string; text: string; source: string }> {
  assert.equal((result as { ok: boolean }).ok, true, `expected ok:true, got: ${JSON.stringify(result)}`);
  return (result as unknown as { turns: Array<{ index: number; role: string; stage: string; text: string; source: string }> }).turns;
}

// ===========================================================================
// Ordering — a 2-round architect fixture (AT-19)
// ===========================================================================

describe('deriveSessionTranscript — ordering (2-round architect fixture)', () => {
  it('AT-19: idea → r1 agent → r1 operator → r2 agent → r2 operator → pending agent → feedback operator, exact index+source pins', () => {
    const sessionDir = makeTmpDir('transcript-order-');
    writeFileSync(join(sessionDir, 'idea.md'), 'Build a thing.\n', 'utf8');
    writeJson(sessionDir, 'answers.json', [
      { round: 1, answers: [{ question: 'What kind of thing?', answer: 'A widget.' }] },
      { round: 2, answers: [{ question: 'What color?', answer: 'Blue.' }] },
    ]);
    writeJson(sessionDir, 'questions.json', [{ question: 'Any constraints?', header: 'Constraints', options: [{ label: 'None', description: 'No constraints' }] }]);
    writeFileSync(join(sessionDir, 'feedback.md'), 'Please add a budget section.\n', 'utf8');

    // AT-amendment-2: the pending questions.json turn now requires an
    // explicit phase === 'awaiting-answers' — the fixture's questions.json
    // is genuinely pending, so this is the real phase a live session would
    // carry at this checkpoint.
    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir, phase: 'awaiting-answers' });
    const turns = okTurns(result);

    assert.equal(turns.length, 7, `expected 7 turns, got: ${JSON.stringify(turns)}`);
    assert.deepEqual(turns.map((t) => t.index), [0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual(
      turns.map((t) => [t.role, t.source]),
      [
        ['operator', 'idea.md'],
        ['agent', 'answers.json#round-1'],
        ['operator', 'answers.json#round-1'],
        ['agent', 'answers.json#round-2'],
        ['operator', 'answers.json#round-2'],
        ['agent', 'questions.json'],
        ['operator', 'feedback.md'],
      ],
    );
    assert.equal(turns[0].text.trim(), 'Build a thing.');
    assert.equal(turns[1].text, 'What kind of thing?');
    assert.equal(turns[2].text, 'A widget.');
    assert.equal(turns[3].text, 'What color?');
    assert.equal(turns[4].text, 'Blue.');
    assert.equal(turns[5].text, 'Any constraints?');
    assert.equal(turns[6].text.trim(), 'Please add a budget section.');
  });
});

// ===========================================================================
// Stage defaulting is declared, not hardcoded (AT-20)
// ===========================================================================

describe('deriveSessionTranscript — stage defaulting comes from the descriptor', () => {
  it('AT-20: a descriptor whose defaultStage is a DIFFERENT token ("demo") — every turn follows it, not a hardcoded value', () => {
    const sessionDir = makeTmpDir('transcript-stage-');
    writeFileSync(join(sessionDir, 'prompt.md'), 'A brief.\n', 'utf8');

    const descriptor = instructionsDescriptor({ stages: ['demo'], defaultStage: 'demo' });
    const turns = okTurns(deriveSessionTranscript({ descriptor, sessionDir, phase: 'drafting' }));

    assert.equal(turns.length, 1);
    assert.equal(turns[0].stage, 'demo', 'the turn stage must come from descriptor.defaultStage, not a literal default baked into the derivation');
  });
});

// ===========================================================================
// Fail-closed on an unknown stage marker + the valid multi-stage companion
// (AT-21, AT-22)
// ===========================================================================

describe('deriveSessionTranscript — stage machinery is genuinely exercised (fail-closed + valid multi-stage)', () => {
  it('AT-21: a checkpoint stage marker OUTSIDE the descriptor\'s declared stages → {ok:false}, never defaults, never drops the turn, never returns ok:true', () => {
    const sessionDir = makeTmpDir('transcript-badstage-');
    writeJson(sessionDir, 'answers.json', [
      { round: 1, stage: 'no-such-stage', answers: [{ question: 'Q1?', answer: 'A1.' }] },
    ]);
    const descriptor = architectDescriptor({ stages: ['roadmap'], defaultStage: 'roadmap' });
    const result = deriveSessionTranscript({ descriptor, sessionDir, phase: 'awaiting-verdict' }) as { ok: boolean; error?: { message: string } };
    assert.equal(result.ok, false, 'an unknown stage marker must fail closed, not default or silently drop the turn');
    assert.ok(result.error && result.error.message.includes('no-such-stage'), 'error must name the offending value');
    assert.ok(result.error && result.error.message.includes('roadmap'), 'error must name the descriptor\'s allowed stage set');
  });

  it('AT-22: a valid multi-stage descriptor with turns tagged across ALL its stages — the machinery genuinely works even though every SHIPPED kind is single-stage', () => {
    const sessionDir = makeTmpDir('transcript-multistage-');
    writeJson(sessionDir, 'answers.json', [
      { round: 1, stage: 'contract', answers: [{ question: 'Contract Q?', answer: 'Contract A.' }] },
      { round: 2, stage: 'demo', answers: [{ question: 'Demo Q?', answer: 'Demo A.' }] },
      { round: 3, stage: 'roadmap', answers: [{ question: 'Roadmap Q?', answer: 'Roadmap A.' }] },
    ]);
    const descriptor = architectDescriptor({ stages: ['contract', 'instructions', 'secrets', 'demo', 'roadmap'], defaultStage: 'contract' });
    const turns = okTurns(deriveSessionTranscript({ descriptor, sessionDir, phase: 'awaiting-verdict' }));

    assert.equal(turns.length, 6, `expected 3 rounds × 2 turns, got: ${JSON.stringify(turns)}`);
    assert.deepEqual(
      turns.map((t) => t.stage),
      ['contract', 'contract', 'demo', 'demo', 'roadmap', 'roadmap'],
    );
  });
});

// ===========================================================================
// Empty session dir — honest, non-empty sourcesScanned (AT-23)
// ===========================================================================

describe('deriveSessionTranscript — empty session honesty', () => {
  it('AT-23: an empty session dir → {ok:true, turns:[]} with sourcesScanned NON-empty, naming the files it looked for', () => {
    const sessionDir = makeTmpDir('transcript-empty-');
    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir, phase: 'awaiting-verdict' });
    assert.ok(result.ok);
    assert.deepEqual(result.turns, []);
    assert.ok(Array.isArray(result.sourcesScanned) && result.sourcesScanned.length > 0, 'sourcesScanned must never be silently empty — it names what was scanned even when nothing was found');
    for (const name of ['idea.md', 'answers.json', 'questions.json', 'feedback.md']) {
      assert.ok(result.sourcesScanned.some((s) => s.includes(name)), `sourcesScanned must name "${name}"`);
    }
    // W8-B3 (ON-5): scanned names what we LOOKED for; found names what was
    // there. An empty dir must report the second as empty, never conflate them.
    assert.deepEqual([...result.sourcesFound], []);
  });
});

// ===========================================================================
// Malformed answers.json — fail closed, never fabricate (AT-24..27)
// ===========================================================================

describe('deriveSessionTranscript — malformed answers.json fails closed', () => {
  it('AT-24: answers.json is not an array at all → {ok:false}', () => {
    const sessionDir = makeTmpDir('transcript-malformed-a-');
    writeJson(sessionDir, 'answers.json', { round: 1, answers: [] });
    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir, phase: 'awaiting-verdict' }) as { ok: boolean };
    assert.equal(result.ok, false);
  });

  it('AT-25: a round object is missing the "answers" key → {ok:false}', () => {
    const sessionDir = makeTmpDir('transcript-malformed-b-');
    writeJson(sessionDir, 'answers.json', [{ round: 1 }]);
    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir, phase: 'awaiting-verdict' }) as { ok: boolean };
    assert.equal(result.ok, false);
  });

  it('AT-26: a round\'s "answers" is not an array (a string) → {ok:false}', () => {
    const sessionDir = makeTmpDir('transcript-malformed-c-');
    writeJson(sessionDir, 'answers.json', [{ round: 1, answers: 'not-an-array' }]);
    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir, phase: 'awaiting-verdict' }) as { ok: boolean };
    assert.equal(result.ok, false);
  });

  it('AT-27: an answer entry\'s "question" is not a string (a number) → {ok:false}, never a turn with undefined/empty text', () => {
    const sessionDir = makeTmpDir('transcript-malformed-d-');
    writeJson(sessionDir, 'answers.json', [{ round: 1, answers: [{ question: 42, answer: 'A1.' }] }]);
    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir, phase: 'awaiting-verdict' }) as { ok: boolean };
    assert.equal(result.ok, false, 'a non-string question must fail closed, never surface as a turn with undefined/empty text');
  });
});

// ===========================================================================
// project-brain — honestly ONE turn, no invented interview (AT-28)
// ===========================================================================

describe('deriveSessionTranscript — project-brain has no interview', () => {
  it('AT-28: a project-brain session dir with only prompt.md → exactly ONE turn, never a fabricated agent turn', () => {
    const sessionDir = makeTmpDir('transcript-pbrain-');
    writeFileSync(join(sessionDir, 'prompt.md'), 'Seed the brain from the current code.\n', 'utf8');
    const turns = okTurns(deriveSessionTranscript({ descriptor: projectBrainDescriptor(), sessionDir, phase: 'analyzing' }));
    assert.equal(turns.length, 1, `project-brain must be honestly one turn, got: ${JSON.stringify(turns)}`);
    assert.equal(turns[0].role, 'operator');
    assert.equal(turns[0].source, 'prompt.md');
    assert.equal(turns[0].stage, 'brain');
  });
});

// ===========================================================================
// deriveSessionArtifact — roadmap-draft (AT-29, AT-30)
// ===========================================================================

function realManifest(overrides: Partial<InitiativeManifest> = {}): InitiativeManifest {
  return {
    initiative_id: 'INIT-2026-01-01-fixture-a',
    project: 'demoproj',
    project_repo_path: '/tmp/demoproj',
    created_at: '2026-01-01T00:00:00.000Z',
    iteration_budget: 10,
    cost_budget_usd: 5,
    phase: 'pending',
    origin: 'architect',
    body: '# Fixture initiative\n\nDo the thing.\n',
    ...overrides,
  } as InitiativeManifest;
}

describe('deriveSessionArtifact — roadmap-draft (real serializeManifest fixtures)', () => {
  it('AT-29: rows are derived from real manifests/*.md files, sorted by filename, fields pinned exactly', () => {
    const sessionDir = makeTmpDir('artifact-roadmap-');
    const manifestsDir = join(sessionDir, 'manifests');
    mkdirSync(manifestsDir, { recursive: true });
    writeFileSync(join(manifestsDir, 'INIT-2026-01-01-fixture-a.md'), serializeManifest(realManifest()), 'utf8');
    writeFileSync(
      join(manifestsDir, 'INIT-2026-01-02-fixture-b.md'),
      serializeManifest(realManifest({ initiative_id: 'INIT-2026-01-02-fixture-b', phase: 'in-flight', origin: 'human-directed' })),
      'utf8',
    );

    const artifact = deriveSessionArtifact({ descriptor: architectDescriptor(), sessionDir }) as {
      kind: string;
      rows: Array<{ initiativeId: string; project: string; phase: string; origin: string }>;
      sourcesScanned: string[];
    };
    assert.equal(artifact.kind, 'roadmap-draft');
    assert.deepEqual(
      artifact.rows.map((r) => r.initiativeId),
      ['INIT-2026-01-01-fixture-a', 'INIT-2026-01-02-fixture-b'],
    );
    assert.equal(artifact.rows[0].project, 'demoproj');
    assert.equal(artifact.rows[0].phase, 'pending');
    assert.equal(artifact.rows[0].origin, 'architect');
    assert.equal(artifact.rows[1].phase, 'in-flight');
    assert.equal(artifact.rows[1].origin, 'human-directed');
  });

  it('AT-30: zero manifests → an honest empty payload naming what was scanned, never a fabricated row', () => {
    const sessionDir = makeTmpDir('artifact-roadmap-empty-');
    const artifact = deriveSessionArtifact({ descriptor: architectDescriptor(), sessionDir }) as {
      rows: unknown[];
      sourcesScanned: string[];
    };
    assert.deepEqual(artifact.rows, []);
    assert.ok(Array.isArray(artifact.sourcesScanned) && artifact.sourcesScanned.length > 0);
    assert.ok(artifact.sourcesScanned.some((s) => s.includes('manifests')));
  });
});

// ===========================================================================
// deriveSessionArtifact — roadmap-draft rows carry cross-initiative
// dependency edges (R4-15, AT-75, AT-76). `RoadmapDraftRow` gains a fifth
// field, `dependsOn: string[]`, sourced from the manifest's
// `depends_on_initiatives` (already parsed by `parseManifest`,
// orchestrator/manifest.ts:73, but dropped on the floor by
// `deriveRoadmapDraft` today). Absent key ⇒ []. This layer never filters
// against the draft's own row set, never sorts, never de-duplicates — that
// is `dependencyDagView`'s (forge-ui/lib/dependency-dag.ts) job, a layer up.
// ===========================================================================

describe('deriveSessionArtifact — roadmap-draft rows carry dependsOn (R4-15)', () => {
  it('AT-75: a manifest with no depends_on_initiatives yields dependsOn: [] — never undefined, never dropped from the row entirely (today\'s defect)', () => {
    const sessionDir = makeTmpDir('artifact-roadmap-deps-absent-');
    const manifestsDir = join(sessionDir, 'manifests');
    mkdirSync(manifestsDir, { recursive: true });
    writeFileSync(join(manifestsDir, 'INIT-2026-01-01-fixture-a.md'), serializeManifest(realManifest()), 'utf8');

    const artifact = deriveSessionArtifact({ descriptor: architectDescriptor(), sessionDir }) as {
      rows: Array<{ initiativeId: string; dependsOn: string[] }>;
    };
    assert.equal(artifact.rows.length, 1);
    assert.deepEqual(artifact.rows[0].dependsOn, [], 'an absent depends_on_initiatives must default to [], never undefined or dropped');
  });

  it('AT-76: depends_on_initiatives round-trips VERBATIM — declared order preserved, and an entry pointing OUTSIDE this session\'s manifest set is never filtered out', () => {
    const sessionDir = makeTmpDir('artifact-roadmap-deps-present-');
    const manifestsDir = join(sessionDir, 'manifests');
    mkdirSync(manifestsDir, { recursive: true });
    writeFileSync(join(manifestsDir, 'INIT-2026-01-01-fixture-a.md'), serializeManifest(realManifest()), 'utf8');
    writeFileSync(
      join(manifestsDir, 'INIT-2026-01-02-fixture-b.md'),
      serializeManifest(
        realManifest({
          initiative_id: 'INIT-2026-01-02-fixture-b',
          // Deliberately NOT alphabetically sorted (2026 before 2025) — pins
          // that the deriver preserves DECLARED order, never re-sorts.
          depends_on_initiatives: ['INIT-2026-01-01-fixture-a', 'INIT-2025-06-01-already-merged'],
        }),
      ),
      'utf8',
    );

    const artifact = deriveSessionArtifact({ descriptor: architectDescriptor(), sessionDir }) as {
      rows: Array<{ initiativeId: string; dependsOn: string[] }>;
    };
    const rowA = artifact.rows.find((r) => r.initiativeId === 'INIT-2026-01-01-fixture-a')!;
    const rowB = artifact.rows.find((r) => r.initiativeId === 'INIT-2026-01-02-fixture-b')!;
    assert.ok(rowA, 'row A must be present');
    assert.ok(rowB, 'row B must be present');
    assert.deepEqual(rowA.dependsOn, []);
    assert.deepEqual(
      rowB.dependsOn,
      ['INIT-2026-01-01-fixture-a', 'INIT-2025-06-01-already-merged'],
      'dependsOn must round-trip verbatim: declared order preserved (never sorted), and the outside-set entry ' +
        '(INIT-2025-06-01-already-merged, not present under manifests/) must never be filtered out — an ' +
        'architect draft may legitimately depend on an already-merged initiative outside the draft set',
    );
  });

  // Adversarial-review amendment (2026-08-06), Amendment 2: the fix ruled
  // that de-duplication happens EXACTLY ONCE, in the view model
  // (dependency-dag.ts's DependencyDagNode.deps) — never at this layer. A
  // manifest declaring the SAME dependency twice must still round-trip with
  // the duplicate INTACT: this is the regression guard against the wrong
  // fix (deduping here, at the file-parsing layer, instead of only in the
  // view) — checked and confirmed NOT already covered by AT-75/76 above
  // (neither uses a duplicate entry). GREEN today (session-transcript.ts:484
  // already does a bare passthrough, `dependsOn: manifest.depends_on_initiatives
  // ?? []`, with no dedup) — a characterization pin, not a defect pin: it
  // earns its place because Amendment 2's fix touches a SIBLING module
  // (dependency-dag.ts) implementing the OPPOSITE behaviour (dedup), and a
  // careless implementer "fixing the table" by deduping at the wrong layer
  // instead would silently break this exact invariant.
  it('AT-78: a manifest declaring the SAME dependency twice round-trips with the duplicate INTACT — dependsOn is never de-duplicated at this layer (dedup is the view model\'s job, one layer up)', () => {
    const sessionDir = makeTmpDir('artifact-roadmap-deps-duplicate-');
    const manifestsDir = join(sessionDir, 'manifests');
    mkdirSync(manifestsDir, { recursive: true });
    writeFileSync(
      join(manifestsDir, 'INIT-2026-01-01-fixture-a.md'),
      serializeManifest(
        realManifest({
          depends_on_initiatives: ['INIT-2025-06-01-already-merged', 'INIT-2025-06-01-already-merged'],
        }),
      ),
      'utf8',
    );

    const artifact = deriveSessionArtifact({ descriptor: architectDescriptor(), sessionDir }) as {
      rows: Array<{ initiativeId: string; dependsOn: string[] }>;
    };
    assert.equal(artifact.rows.length, 1);
    assert.deepEqual(
      artifact.rows[0].dependsOn,
      ['INIT-2025-06-01-already-merged', 'INIT-2025-06-01-already-merged'],
      'a duplicate entry must survive verbatim at this layer — de-duplicating here would be the WRONG fix for the table/DAG disagreement',
    );
  });
});

// ===========================================================================
// deriveSessionArtifact — markdown-draft (AT-31, AT-32)
// ===========================================================================

describe('deriveSessionArtifact — markdown-draft (byte-faithful AGENTS.draft.md)', () => {
  it('AT-31: returns the real AGENTS.draft.md body byte-for-byte, including trailing newline', () => {
    const sessionDir = makeTmpDir('artifact-md-');
    const body = '# AGENTS.md\n\nSome instructions.\n\n- a\n- b\n';
    writeFileSync(join(sessionDir, 'AGENTS.draft.md'), body, 'utf8');
    const artifact = deriveSessionArtifact({ descriptor: instructionsDescriptor(), sessionDir }) as { body: string | null; hasDraft: boolean };
    assert.equal(artifact.body, body, 'body must be byte-identical, including the trailing newline');
    assert.equal(artifact.hasDraft, true);
  });

  it('AT-32: distinguishes "no draft yet" (missing file, body: null) from an "empty draft" (file exists, empty, body: "")', () => {
    const missingDir = makeTmpDir('artifact-md-missing-');
    const missing = deriveSessionArtifact({ descriptor: instructionsDescriptor(), sessionDir: missingDir }) as { body: string | null; hasDraft: boolean };
    assert.equal(missing.body, null, 'no draft file at all must be null, never "" masquerading as content');
    assert.equal(missing.hasDraft, false);

    const emptyDir = makeTmpDir('artifact-md-empty-');
    writeFileSync(join(emptyDir, 'AGENTS.draft.md'), '', 'utf8');
    const empty = deriveSessionArtifact({ descriptor: instructionsDescriptor(), sessionDir: emptyDir }) as { body: string | null; hasDraft: boolean };
    assert.equal(empty.body, '');
    assert.equal(empty.hasDraft, true, 'an existing-but-empty draft must be distinguishable from "no draft yet"');
  });
});

// ===========================================================================
// deriveSessionArtifact — brain-structure (AT-33)
// ===========================================================================

describe('deriveSessionArtifact — brain-structure (shared PackageFile shape)', () => {
  it('AT-33: themeCount + files count only real .md theme files; a stray non-.md file is excluded, not counted', () => {
    const sessionDir = makeTmpDir('artifact-brain-');
    const themesDir = join(sessionDir, 'themes');
    mkdirSync(themesDir, { recursive: true });
    writeFileSync(join(themesDir, 'alpha.md'), '# Alpha theme\n', 'utf8');
    writeFileSync(join(themesDir, 'beta.md'), '# Beta theme\n', 'utf8');
    writeFileSync(join(themesDir, 'notes.txt'), 'not a theme', 'utf8');

    const artifact = deriveSessionArtifact({ descriptor: projectBrainDescriptor(), sessionDir }) as {
      themeCount: number;
      files: Array<{ path: string; body: string }>;
    };
    assert.equal(artifact.themeCount, 2, 'the stray .txt file must not be counted as a theme');
    assert.equal(artifact.files.length, 2);
    assert.ok(!artifact.files.some((f) => f.path.includes('notes.txt')), 'the stray non-.md file must not appear in files at all');
    assert.ok(artifact.files.some((f) => f.path.includes('alpha.md') && f.body.includes('Alpha theme')));
  });
});

// ===========================================================================
// deriveSessionArtifact — reserved kind (AT-34)
// ===========================================================================

// AT-34 RETARGETED (R4-21, documented edit — T3): this AT used 'file-package'
// as its RESERVED-row example — but file-package is THE row R4-21 flips
// reserved→live (see this file's RED-2a/b/c, below), and per
// session-kinds.test.ts's AT-2 it was already the LAST reserved row in the
// whole vocabulary, so after this round SESSION_ARTIFACT_KINDS carries ZERO
// reserved rows — there is no other genuinely-reserved kind left anywhere to
// build a fresh fixture from. Retargeted (per the task brief's own
// instruction) rather than deleted: the underlying claim this AT protects —
// "an unrecognised artifact kind is never a stub, it throws naming itself" —
// still has a live code path to pin (deriveSessionArtifact's `state ===
// undefined` branch), so this AT now exercises THAT branch via a kind that
// is not, and never was, a member of SESSION_ARTIFACT_KINDS at all — proving
// the same "never a stub" contract without depending on a reserved row that
// no longer exists. GREEN both before and after the R4-21 flip lands (an
// entirely-unknown kind's behaviour is untouched by this round) — kept as
// coverage, not a fresh RED pin; RED-2a/b/c (below) are this round's actual
// RED pins for file-package itself.
describe('deriveSessionArtifact — an unrecognised artifact kind is never a stub', () => {
  it('AT-34 (retargeted): a descriptor whose artifact.kind is not a member of SESSION_ARTIFACT_KINDS at all → throws, naming the unrecognised kind', () => {
    const sessionDir = makeTmpDir('artifact-reserved-');
    const descriptor = architectDescriptor({ artifact: { kind: 'no-such-artifact-kind-at-all-9911' as SessionKindDescriptor['artifact']['kind'], label: 'Unrecognised' } });
    assert.throws(
      () => deriveSessionArtifact({ descriptor, sessionDir }),
      (err: unknown) => { assert.ok(err instanceof Error); assert.match(err.message, /no-such-artifact-kind-at-all-9911/); return true; },
    );
  });
});

// ===========================================================================
// R4-21 — deriveSessionArtifact — file-package (creation-agent authoring
// session). RED-2a/b/c (T3 pins for the OOTB authoring agent / skill-hook
// package producer): file-package flips reserved→live, backed by a real
// derivation reading the session's own `staging/` subdirectory (R4-21 phase
// 2, D2 rename — see writeStagingFile's own header note). Mirrors AT-33
// (brain-structure)'s file-derivation shape and AT-36/37's symlink-escape
// positive-control idiom exactly.
// ===========================================================================

describe('deriveSessionArtifact — file-package (R4-21, creation-agent authoring session)', () => {
  it('RED-2a: kind:"file-package" does NOT throw — returns {kind, label, files} reading the session dir\'s real staging/ files (RED today: deriveFilePackage still reads the phase-1 package/ dir, not staging/ — D2\'s rename has not landed)', () => {
    const sessionDir = makeTmpDir('artifact-filepackage-');
    writeStagingFile(sessionDir, 'SKILL.md', '# Authored Skill\n\nBody.\n');
    writeStagingFile(sessionDir, 'reference.md', 'Supporting reference content.\n');

    const artifact = deriveSessionArtifact({ descriptor: authoringDescriptor(), sessionDir }) as {
      kind: string;
      label: string;
      files: Array<{ path: string; body: string }>;
    };
    assert.equal(artifact.kind, 'file-package');
    assert.equal(artifact.files.length, 2, `expected 2 package files, got: ${JSON.stringify(artifact.files)}`);
    const byPath = new Map(artifact.files.map((f) => [f.path, f.body]));
    assert.equal(byPath.get('SKILL.md'), '# Authored Skill\n\nBody.\n');
    assert.equal(byPath.get('reference.md'), 'Supporting reference content.\n');
  });

  it('RED-2b (containment): a staging/ entry that is a symlink pointing OUTSIDE sessionDir contributes NO file, but a real sibling staged file IS surfaced (positive control) — mirrors safeReadFileInSession\'s existing containment contract exactly (AT-36/37\'s idiom)', () => {
    const outsideDir = makeTmpDir('filepackage-escape-outside-');
    const SECRET_MARKER = 'TOP-SECRET-PACKAGE-MARKER-6614';
    const secretPath = join(outsideDir, 'secret.md');
    writeFileSync(secretPath, SECRET_MARKER, 'utf8');

    const sessionDir = makeTmpDir('filepackage-escape-session-');
    const stagingDir = join(sessionDir, 'staging');
    mkdirSync(stagingDir, { recursive: true });
    symlinkSync(secretPath, join(stagingDir, 'evil.md'));
    // Positive control: a plain, non-symlinked sibling staged file — MUST
    // surface as a real file.
    const REAL_MARKER = 'REAL-NON-ESCAPED-PACKAGE-CONTENT-2207';
    writeFileSync(join(stagingDir, 'SKILL.md'), REAL_MARKER, 'utf8');

    const artifact = deriveSessionArtifact({ descriptor: authoringDescriptor(), sessionDir });
    const serialized = JSON.stringify(artifact);
    assert.ok(!serialized.includes(SECRET_MARKER), 'the escaped file\'s content must never appear in the derived file-package artifact');
    assert.ok(serialized.includes(REAL_MARKER), 'a plain, non-symlinked sibling staged file MUST still surface — the guard must discriminate, not just refuse to read anything');
  });

  it('RED-2c: the file-package artifact\'s label is threaded verbatim from descriptor.artifact.label, never re-derived', () => {
    const sessionDir = makeTmpDir('filepackage-label-');
    writeStagingFile(sessionDir, 'SKILL.md', '# x\n');
    const descriptor = authoringDescriptor({ artifact: { kind: 'file-package', label: 'Totally Custom Draft Label 8827' } });

    const artifact = deriveSessionArtifact({ descriptor, sessionDir }) as { label: string };
    assert.equal(artifact.label, 'Totally Custom Draft Label 8827', 'label must come from descriptor.artifact.label — never a hardcoded/re-derived string');
  });

  // -------------------------------------------------------------------------
  // T3 fix round (adversarial-review BLOCKER-1, R4-21 phase 1): deriveFilePackage
  // previously scanned only the TOP LEVEL of `staging/` via a flat
  // `listDirEntries` + per-name `safeReadFileInSession` read. A nested file
  // (e.g. `staging/scripts/run.sh` — exactly the shape skills/creation-agent/
  // SKILL.md instructs a hook draft to write: `staging/hook.yaml` +
  // `staging/scripts/run.sh`) has a DIRECTORY as its top-level `staging/`
  // entry name (`scripts`); `readFileSync` on a directory throws EISDIR,
  // caught by the existing try/catch, and the entry was dropped SILENTLY —
  // indistinguishable from a blocked symlink escape (declared-data-fails-open:
  // a real, non-malicious nested file vanishes with no signal). RED-2d pins
  // the fix: the walk must DESCEND a real directory entry, never attempt to
  // read it as a file.
  // -------------------------------------------------------------------------
  it('RED-2d (BLOCKER-1): a staging/ entry that is a real directory (e.g. staging/scripts/) is DESCENDED, not read-as-file — a nested file surfaces with its path relative to staging/, alongside a top-level sibling', () => {
    const sessionDir = makeTmpDir('filepackage-nested-');
    writeStagingFile(sessionDir, 'hook.yaml', 'name: test-hook\ndescription: a draft hook\n');
    writeStagingFile(sessionDir, 'scripts/run.sh', '#!/bin/sh\necho hi\n');

    const artifact = deriveSessionArtifact({ descriptor: authoringDescriptor(), sessionDir }) as {
      kind: string;
      files: Array<{ path: string; body: string }>;
    };
    assert.equal(artifact.kind, 'file-package');
    const byPath = new Map(artifact.files.map((f) => [f.path, f.body]));
    assert.equal(byPath.get('hook.yaml'), 'name: test-hook\ndescription: a draft hook\n', 'the top-level sibling must still surface');
    assert.equal(
      byPath.get('scripts/run.sh'),
      '#!/bin/sh\necho hi\n',
      'the nested file must surface with a path RELATIVE TO staging/ (PackageFile.path convention) — this is RED before D2\'s rename lands (deriveFilePackage still walks the phase-1 package/ dir, not staging/)',
    );
    assert.equal(artifact.files.length, 2, `expected exactly the 2 real files (1 top-level + 1 nested), got: ${JSON.stringify(artifact.files)}`);
  });

  it('RED-2e (BLOCKER-1 containment): a symlink NESTED inside a staging/ subdirectory that points OUTSIDE sessionDir contributes NO file, while a real sibling file in the SAME subdirectory still surfaces (positive control) — proves the recursive walk preserves the module\'s existing symlink-escape guard at every depth, not just the top level (mirrors RED-2b\'s idiom one level deeper)', () => {
    const outsideDir = makeTmpDir('filepackage-nested-escape-outside-');
    const SECRET_MARKER = 'TOP-SECRET-NESTED-PACKAGE-MARKER-7731';
    const secretPath = join(outsideDir, 'secret.md');
    writeFileSync(secretPath, SECRET_MARKER, 'utf8');

    const sessionDir = makeTmpDir('filepackage-nested-escape-session-');
    const scriptsDir = join(sessionDir, 'staging', 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    symlinkSync(secretPath, join(scriptsDir, 'evil.sh'));
    const REAL_MARKER = 'REAL-NESTED-NON-ESCAPED-SCRIPT-9013';
    writeFileSync(join(scriptsDir, 'run.sh'), REAL_MARKER, 'utf8');

    const artifact = deriveSessionArtifact({ descriptor: authoringDescriptor(), sessionDir });
    const serialized = JSON.stringify(artifact);
    assert.ok(!serialized.includes(SECRET_MARKER), 'the nested escaped file\'s content must never appear in the derived file-package artifact');
    assert.ok(serialized.includes(REAL_MARKER), 'a plain, non-symlinked sibling file in the same nested subdirectory MUST still surface');
  });

  // -------------------------------------------------------------------------
  // RED-2f (R4-21 phase 2, D2): the rename is COMPLETE, not additive. A
  // session dir carrying ONLY a leftover `package/` (the phase-1 dirname,
  // never renamed on disk by a real session that started before this phase)
  // must surface NOTHING — proves deriveFilePackage no longer scans `package/`
  // at all, rather than scanning BOTH dirs (which would silently resurrect a
  // stale phase-1 draft alongside a genuine staging/ one, or worse, let a
  // stale package/ masquerade as the session's current draft when staging/
  // is empty). Kills an "additive" fix that keeps the old package/ scan
  // around instead of replacing it.
  // -------------------------------------------------------------------------
  it('RED-2f (D2, rename is complete not additive): a session dir carrying ONLY a leftover package/ (no staging/ at all) surfaces ZERO files — the old dirname is never scanned, not even as a fallback', () => {
    const sessionDir = makeTmpDir('filepackage-leftover-package-');
    const leftoverDir = join(sessionDir, 'package');
    mkdirSync(leftoverDir, { recursive: true });
    writeFileSync(join(leftoverDir, 'SKILL.md'), '# STALE phase-1 leftover — must never surface\n', 'utf8');
    // Precondition, asserted before reading any verdict: the leftover file is
    // really there on disk.
    assert.ok(existsSync(join(leftoverDir, 'SKILL.md')), 'arrange: the leftover package/SKILL.md must exist before deriving');

    const artifact = deriveSessionArtifact({ descriptor: authoringDescriptor(), sessionDir }) as {
      kind: string;
      files: Array<{ path: string; body: string }>;
    };
    assert.equal(artifact.kind, 'file-package');
    assert.deepEqual(
      artifact.files,
      [],
      `a leftover package/ dir must contribute NOTHING once the session draft dir is staging/ — got: ${JSON.stringify(artifact.files)}`,
    );
  });
});

// ===========================================================================
// Traversal / escape — REAL symlinks, realpath is the only thing that catches
// them (a lexical prefix check on the entry's OWN path always passes, since
// the symlink itself lives inside sessionDir) (AT-35, 36, 37)
//
// AT amendment (reviewer finding): each escape AT below now carries a
// POSITIVE CONTROL — a plain, non-symlinked sibling file in the SAME fixture
// whose content MUST appear in the result. Without it, an implementation
// that simply never reads the target directory AT ALL would also pass
// (absence of the secret proves nothing if nothing was ever read). The
// positive control proves the guard actually DISCRIMINATES: real content in,
// escaped content out.
// ===========================================================================

describe('escape via symlink — realpath required, lexical prefix checks are insufficient', () => {
  it('AT-35: deriveSessionTranscript — idea.md is a symlink pointing OUTSIDE sessionDir → the escaped secret content is never returned, but a real sibling file IS (positive control)', () => {
    const outsideDir = makeTmpDir('transcript-escape-outside-');
    const secretPath = join(outsideDir, 'secret.txt');
    const SECRET_MARKER = 'TOP-SECRET-TRANSCRIPT-MARKER-8271';
    writeFileSync(secretPath, SECRET_MARKER, 'utf8');

    const sessionDir = makeTmpDir('transcript-escape-session-');
    // The symlink's OWN path is inside sessionDir — any check of the form
    // `path.startsWith(sessionDir)` on `idea.md`'s path trivially passes.
    // Only resolving via realpathSync(...) reveals the target escapes.
    symlinkSync(secretPath, join(sessionDir, 'idea.md'));
    // Positive control: a plain, non-symlinked sibling file the derivation
    // MUST still read and surface — proves the guard discriminates rather
    // than just refusing to read anything.
    const REAL_MARKER = 'REAL-NON-ESCAPED-FEEDBACK-CONTENT-3391';
    writeFileSync(join(sessionDir, 'feedback.md'), REAL_MARKER + '\n', 'utf8');

    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir, phase: 'awaiting-verdict' });
    const resultText = JSON.stringify(result);
    assert.ok(!resultText.includes(SECRET_MARKER), 'the escaped file\'s content must never appear in the derived transcript');
    assert.ok(resultText.includes(REAL_MARKER), 'a plain, non-symlinked sibling file\'s content MUST still appear — the guard must discriminate, not just refuse to read anything');
  });

  it('AT-36: deriveSessionArtifact (roadmap-draft) — a manifests/ entry is a symlink pointing OUTSIDE sessionDir → its content is never returned, but a real sibling manifest IS (positive control)', () => {
    const outsideDir = makeTmpDir('artifact-escape-outside-');
    const SECRET_MARKER = 'TOP-SECRET-MANIFEST-MARKER-5533';
    const secretManifestPath = join(outsideDir, 'secret-manifest.md');
    writeFileSync(secretManifestPath, serializeManifest(realManifest({ initiative_id: SECRET_MARKER })), 'utf8');

    const sessionDir = makeTmpDir('artifact-escape-session-');
    const manifestsDir = join(sessionDir, 'manifests');
    mkdirSync(manifestsDir, { recursive: true });
    symlinkSync(secretManifestPath, join(manifestsDir, 'evil.md'));
    // Positive control: a plain, non-symlinked sibling manifest — MUST
    // surface as a real row.
    const REAL_MARKER = 'INIT-2026-01-03-real-sibling-manifest';
    writeFileSync(join(manifestsDir, 'real-sibling.md'), serializeManifest(realManifest({ initiative_id: REAL_MARKER })), 'utf8');

    const artifact = deriveSessionArtifact({ descriptor: architectDescriptor(), sessionDir });
    const artifactText = JSON.stringify(artifact);
    assert.ok(!artifactText.includes(SECRET_MARKER), 'the escaped manifest\'s content must never surface as a row');
    assert.ok(artifactText.includes(REAL_MARKER), 'a plain, non-symlinked sibling manifest MUST still surface as a row — the guard must discriminate, not just refuse to read anything');
  });

  it('AT-37: deriveSessionArtifact (brain-structure) — a themes/ entry is a symlink pointing OUTSIDE sessionDir → its content is never returned, but a real sibling theme IS (positive control)', () => {
    const outsideDir = makeTmpDir('brain-escape-outside-');
    const SECRET_MARKER = 'TOP-SECRET-THEME-MARKER-9042';
    const secretThemePath = join(outsideDir, 'secret-theme.md');
    writeFileSync(secretThemePath, `# ${SECRET_MARKER}\n`, 'utf8');

    const sessionDir = makeTmpDir('brain-escape-session-');
    const themesDir = join(sessionDir, 'themes');
    mkdirSync(themesDir, { recursive: true });
    symlinkSync(secretThemePath, join(themesDir, 'evil.md'));
    // Positive control: a plain, non-symlinked sibling theme file — MUST
    // surface in files[].
    const REAL_MARKER = 'REAL-NON-ESCAPED-THEME-CONTENT-7714';
    writeFileSync(join(themesDir, 'real-sibling.md'), `# ${REAL_MARKER}\n`, 'utf8');

    const artifact = deriveSessionArtifact({ descriptor: projectBrainDescriptor(), sessionDir });
    const artifactText = JSON.stringify(artifact);
    assert.ok(!artifactText.includes(SECRET_MARKER), 'the escaped theme file\'s content must never surface in files[]');
    assert.ok(artifactText.includes(REAL_MARKER), 'a plain, non-symlinked sibling theme file MUST still surface in files[] — the guard must discriminate, not just refuse to read anything');
  });
});

// ===========================================================================
// AT-amendment-2 — questions.json pending-ness is phase-driven, not a
// text-based set-difference (AT-57, AT-58). See the module header for the
// full T2-ratified contract this supersedes.
// ===========================================================================

describe('deriveSessionTranscript — questions.json pending-ness is phase-driven (AT-amendment-2)', () => {
  it('AT-57: a question re-asked VERBATIM in questions.json, phase "awaiting-answers" → the pending agent turn IS present (the defect this pins — the old text-diff logic silently dropped this)', () => {
    const sessionDir = makeTmpDir('transcript-reask-');
    writeJson(sessionDir, 'answers.json', [
      { round: 1, answers: [{ question: 'What is the project name?', answer: 'Foo.' }] },
    ]);
    // A genuine, legitimate shape: the interview re-asks the SAME question
    // verbatim (e.g. the prior answer was ambiguous or rejected) — this is
    // NOT a stale leftover, the runner is truly waiting on it again.
    writeJson(sessionDir, 'questions.json', [{ question: 'What is the project name?', header: 'Name', options: [] }]);

    const turns = okTurns(deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir, phase: 'awaiting-answers' }));
    const pending = turns.find((t) => t.source === 'questions.json');
    assert.ok(pending, `expected a pending agent turn for the verbatim re-ask when phase is "awaiting-answers", got: ${JSON.stringify(turns)}`);
    assert.equal(pending!.role, 'agent');
    assert.equal(pending!.text, 'What is the project name?');
  });

  it('AT-58: a stale questions.json present but phase is NOT "awaiting-answers" → no pending turn is derived, regardless of the question\'s text', () => {
    const sessionDir = makeTmpDir('transcript-stale-question-');
    writeJson(sessionDir, 'answers.json', [
      { round: 1, answers: [{ question: 'Q1?', answer: 'A1.' }] },
    ]);
    // A genuinely NEW, never-before-answered question sitting in
    // questions.json — under the OLD text-diff contract this would have been
    // treated as "unanswered" and surfaced as pending; under the phase-driven
    // contract it must NOT, because the session has already moved past the
    // interview (phase: drafting) — this file is stale leftover.
    writeJson(sessionDir, 'questions.json', [{ question: 'A brand new never-answered question?', header: 'New', options: [] }]);

    const turns = okTurns(deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir, phase: 'drafting' }));
    assert.ok(!turns.some((t) => t.source === 'questions.json'), `expected NO pending turn when phase is not "awaiting-answers", got: ${JSON.stringify(turns)}`);
  });
});

// ===========================================================================
// AT-amendment-3, A2 (AT-68, AT-69) — listDirEntries has no containment
// check on the SUBDIRECTORY itself (manifests/ or themes/ being ITSELF a
// symlink to an outside dir). See the module header for the full contract
// and what was empirically verified.
// ===========================================================================

describe('deriveSessionArtifact — a dir-level symlink (manifests/ or themes/ itself) gets realpath containment too (AT-amendment-3, A2)', () => {
  it('AT-68: themes/ is a symlink to an outside dir containing a uniquely-named .md file → brain-structure reports themeCount:0/files:[] and the outside FILENAME never appears anywhere in the result; a real (non-symlinked) themes/ in a separate session still enumerates correctly (positive control)', () => {
    const outsideThemesDir = makeTmpDir('brain-dirsymlink-outside-');
    const OUTSIDE_FILENAME_MARKER = 'UNIQUELY-NAMED-OUTSIDE-THEME-FILE-4471.md';
    writeFileSync(join(outsideThemesDir, OUTSIDE_FILENAME_MARKER), '# outside theme\n', 'utf8');

    const escapedSessionDir = makeTmpDir('brain-dirsymlink-session-');
    symlinkSync(outsideThemesDir, join(escapedSessionDir, 'themes'));

    const artifact = deriveSessionArtifact({ descriptor: projectBrainDescriptor(), sessionDir: escapedSessionDir }) as {
      themeCount: number;
      files: Array<{ path: string; body: string }>;
    };
    assert.equal(artifact.themeCount, 0, `an escaping themes/ dir-symlink must be treated as absent (empty), got: ${JSON.stringify(artifact)}`);
    assert.deepEqual(artifact.files, []);
    const serialized = JSON.stringify(artifact);
    assert.ok(!serialized.includes(OUTSIDE_FILENAME_MARKER), `the outside directory's real FILENAME must never appear anywhere in the result (not just its body), got: ${serialized}`);

    // Positive control: a real, non-symlinked themes/ in a SEPARATE session
    // still enumerates correctly — proves the fix (once applied) discriminates
    // rather than blocking every themes/ dir outright.
    const cleanSessionDir = makeTmpDir('brain-dirsymlink-clean-');
    mkdirSync(join(cleanSessionDir, 'themes'), { recursive: true });
    writeFileSync(join(cleanSessionDir, 'themes', 'real-theme.md'), '# a real theme\n', 'utf8');
    const cleanArtifact = deriveSessionArtifact({ descriptor: projectBrainDescriptor(), sessionDir: cleanSessionDir }) as {
      themeCount: number;
      files: Array<{ path: string; body: string }>;
    };
    assert.equal(cleanArtifact.themeCount, 1, 'a real, non-symlinked themes/ dir must still enumerate correctly');
    assert.ok(cleanArtifact.files.some((f) => f.path.includes('real-theme.md')));
  });

  it('AT-69: manifests/ is a symlink to an outside dir → roadmap-draft reports rows:[] AND sourcesScanned reports "0 file(s) found" (NOT the escaped directory\'s real file count — this is the part that currently fails); a real (non-symlinked) manifests/ in a separate session still enumerates correctly (positive control)', () => {
    const outsideManifestsDir = makeTmpDir('roadmap-dirsymlink-outside-');
    const OUTSIDE_MARKER = 'INIT-OUTSIDE-DIRSYMLINK-LEAK-9042';
    writeFileSync(join(outsideManifestsDir, 'outside-manifest.md'), serializeManifest(realManifest({ initiative_id: OUTSIDE_MARKER })), 'utf8');

    const escapedSessionDir = makeTmpDir('roadmap-dirsymlink-session-');
    symlinkSync(outsideManifestsDir, join(escapedSessionDir, 'manifests'));

    const artifact = deriveSessionArtifact({ descriptor: architectDescriptor(), sessionDir: escapedSessionDir }) as {
      rows: unknown[];
      sourcesScanned: string[];
    };
    assert.deepEqual(artifact.rows, [], 'an escaping manifests/ dir-symlink must never contribute a row');
    const serialized = JSON.stringify(artifact);
    assert.ok(!serialized.includes(OUTSIDE_MARKER), 'the escaped manifest\'s content must never surface');
    assert.ok(!serialized.includes('outside-manifest.md'), 'the outside directory\'s real FILENAME must never appear anywhere in the result');
    // The count leak: sourcesScanned must report the dir as EMPTY (treated as
    // absent), not the escaped directory's real file count.
    assert.ok(
      artifact.sourcesScanned.some((s) => s.includes('0 file(s) found')),
      `sourcesScanned must report "0 file(s) found" (the escaping dir treated as absent), got: ${JSON.stringify(artifact.sourcesScanned)}`,
    );

    // Positive control: a real, non-symlinked manifests/ in a SEPARATE
    // session still enumerates correctly.
    const cleanSessionDir = makeTmpDir('roadmap-dirsymlink-clean-');
    const cleanManifestsDir = join(cleanSessionDir, 'manifests');
    mkdirSync(cleanManifestsDir, { recursive: true });
    const REAL_MARKER = 'INIT-2026-01-09-real-manifest';
    writeFileSync(join(cleanManifestsDir, 'real.md'), serializeManifest(realManifest({ initiative_id: REAL_MARKER })), 'utf8');
    const cleanArtifact = deriveSessionArtifact({ descriptor: architectDescriptor(), sessionDir: cleanSessionDir }) as {
      rows: Array<{ initiativeId: string }>;
      sourcesScanned: string[];
    };
    assert.deepEqual(cleanArtifact.rows.map((r) => r.initiativeId), [REAL_MARKER]);
    assert.ok(cleanArtifact.sourcesScanned.some((s) => s.includes('1 file(s) found')));
  });
});

// ===========================================================================
// R4-16 — deriveSessionArtifact — generation-gallery (a new LIVE artifact
// kind). TEST-FIRST PIN: `deriveGenerationGallery` does not exist yet, and
// `generation-gallery` is still `reserved` in the real, unmodified
// session-kinds.ts (SESSION_ARTIFACT_KINDS) — every test below currently
// throws inside `deriveSessionArtifact`'s own `state === 'reserved'` gate
// (session-kinds.ts:531), before ever reaching a derivation. That is the
// correct RED: the reserved-kind guard IS the thing R4-16 must flip.
// ===========================================================================

describe('deriveSessionArtifact — generation-gallery (R4-16)', () => {
  it('R4-16 AT-10: number comes from meta.json.iteration, never array/directory position — generations sort ascending by number', () => {
    const sessionDir = makeTmpDir('gengallery-order-');
    writeGeneration(sessionDir, 5, { iteration: 5 });
    writeGeneration(sessionDir, 2, { iteration: 2 });
    const artifact = deriveSessionArtifact({ descriptor: demoDescriptor(), sessionDir }) as { generations: Array<{ number: number }> };
    assert.deepEqual(
      artifact.generations.map((g) => g.number),
      [2, 5],
      'kills an implementation that numbers by directory name / array position instead of reading meta.json.iteration',
    );
  });

  it('R4-16 AT-11: a generation dir whose meta.json is missing/unreadable/not JSON contributes NO generation — a visible gap, never a renumbered sequence', () => {
    const sessionDir = makeTmpDir('gengallery-gap-');
    writeGeneration(sessionDir, 1, { iteration: 1 });
    writeGeneration(sessionDir, 2, { metaRaw: 'not valid json {{{' });
    writeGeneration(sessionDir, 3, { iteration: 3 });
    const artifact = deriveSessionArtifact({ descriptor: demoDescriptor(), sessionDir }) as { generations: Array<{ number: number }> };
    assert.deepEqual(
      artifact.generations.map((g) => g.number),
      [1, 3],
      'positional numbering would (wrongly) report [1, 2] — this pins the visible GAP, not a renumber',
    );
  });

  it('R4-16 AT-12: a generation whose meta.json is missing "iteration" entirely (or non-numeric) also contributes no generation, same as unreadable', () => {
    const sessionDir = makeTmpDir('gengallery-bad-iteration-');
    writeGeneration(sessionDir, 1, { iteration: 1 });
    writeGeneration(sessionDir, 2, {
      metaRaw: JSON.stringify({ createdAt: '2026-08-06T10:00:00.000Z', feedback: null, targetElement: null, composed: false, skillRelPath: 'x' /* no "iteration" at all */ }),
    });
    writeGeneration(sessionDir, 3, {
      metaRaw: JSON.stringify({ iteration: 'three', createdAt: '2026-08-06T10:00:00.000Z', feedback: null, targetElement: null, composed: false, skillRelPath: 'x' }),
    });
    const artifact = deriveSessionArtifact({ descriptor: demoDescriptor(), sessionDir }) as { generations: Array<{ number: number }> };
    assert.deepEqual(artifact.generations.map((g) => g.number), [1], 'a missing or non-numeric "iteration" must never fabricate a generation row');
  });

  it('R4-16 AT-13: items are the real files present in the generation dir, EXCLUDING meta.json, sorted by filename', () => {
    const sessionDir = makeTmpDir('gengallery-items-');
    writeGeneration(sessionDir, 1, { iteration: 1, files: { 'SKILL.md': '# s', 'DEMO.html': '<html/>', 'notes.txt': 'stray file' } });
    const artifact = deriveSessionArtifact({ descriptor: demoDescriptor(), sessionDir }) as { generations: Array<{ items: Array<{ path: string; kind: string }> }> };
    const paths = artifact.generations[0].items.map((i) => i.path);
    assert.deepEqual(paths, ['DEMO.html', 'SKILL.md', 'notes.txt'], 'sorted by filename; a non-html/md file is still a real item (kind "file"), never dropped');
    assert.ok(!paths.includes('meta.json'), 'meta.json must never appear as an item — it is metadata, not gallery content');
  });

  it('R4-16 AT-14 (mandatory adversarial AT — bytes-from-file-not-meta): bytes is the REAL byte length read from disk, never a number copied from meta.json — a plausible-but-wrong metadata hint must not leak through', () => {
    const sessionDir = makeTmpDir('gengallery-bytes-');
    const dir = join(sessionDir, 'generations', '1');
    mkdirSync(dir, { recursive: true });
    const demoBody = '<html>only 27 bytes here</html>'; // a real, independently-computable length
    writeFileSync(join(dir, 'DEMO.html'), demoBody, 'utf8');
    // A plausible-but-WRONG size-ish field smuggled onto meta.json — no such
    // field exists in the declared meta.json contract; an implementation
    // that trusts ANY such hint instead of the real file's length is what
    // this kills.
    writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({ iteration: 1, createdAt: '2026-08-06T10:00:00.000Z', feedback: null, targetElement: null, composed: false, skillRelPath: 'x', bytes: 999999, sizeHint: 999999 }),
      'utf8',
    );
    const artifact = deriveSessionArtifact({ descriptor: demoDescriptor(), sessionDir }) as { generations: Array<{ items: Array<{ path: string; bytes: number }> }> };
    const demoItem = artifact.generations[0].items.find((i) => i.path === 'DEMO.html')!;
    const realBytes = Buffer.byteLength(demoBody, 'utf8');
    assert.equal(demoItem.bytes, realBytes, `bytes must be the REAL file length (${realBytes}), not the fabricated metadata hint (999999)`);
  });

  it('R4-16 AT-15: an empty/absent generations/ dir yields an honest empty payload naming what was scanned (including the found count) — never a bare pane', () => {
    const sessionDir = makeTmpDir('gengallery-empty-');
    const artifact = deriveSessionArtifact({ descriptor: demoDescriptor(), sessionDir }) as { generations: unknown[]; sourcesScanned: string[] };
    assert.deepEqual(artifact.generations, []);
    assert.ok(Array.isArray(artifact.sourcesScanned) && artifact.sourcesScanned.length > 0, 'sourcesScanned must never be silently empty');
    assert.ok(artifact.sourcesScanned.some((s) => s.includes('generations')), 'sourcesScanned must name "generations"');
    assert.ok(artifact.sourcesScanned.some((s) => /\b0\b/.test(s)), 'sourcesScanned must report the found count (0), so an empty gallery reads "scanned N, found none"');
  });

  it('R4-16 AT-16: deriveSessionArtifact dispatches "generation-gallery" to a real derivation carrying the descriptor\'s declared label — mirrors the label-threading contract every other live kind already honours', () => {
    const sessionDir = makeTmpDir('gengallery-dispatch-');
    writeGeneration(sessionDir, 1, { iteration: 1 });
    const artifact = deriveSessionArtifact({ descriptor: demoDescriptor(), sessionDir }) as { kind: string; label: string };
    assert.equal(artifact.kind, 'generation-gallery');
    assert.equal(artifact.label, 'Demo generations');
  });
});

// ===========================================================================
// R4-16 (mandatory adversarial AT — traversal, real escape attempts) —
// generations/ (and each generations/<n>/) must be realpath-contained the
// SAME way manifests/ and themes/ already are (AT-36/37/68/69's pattern).
// ===========================================================================

describe('deriveSessionArtifact — generation-gallery traversal escapes (R4-16)', () => {
  it('R4-16 AT-17: generations/ itself is a symlink to an outside dir → the gallery is empty, and nothing from outside is named or counted', () => {
    const outsideDir = makeTmpDir('gengallery-escape-outside-');
    const OUTSIDE_MARKER = 'OUTSIDE-GENERATIONS-DIR-MARKER-5521';
    mkdirSync(join(outsideDir, '1'), { recursive: true });
    writeFileSync(
      join(outsideDir, '1', 'meta.json'),
      JSON.stringify({ iteration: 1, createdAt: '2026-08-06T10:00:00.000Z', feedback: null, targetElement: null, composed: false, skillRelPath: OUTSIDE_MARKER }),
      'utf8',
    );

    const sessionDir = makeTmpDir('gengallery-escape-session-');
    symlinkSync(outsideDir, join(sessionDir, 'generations'));

    const artifact = deriveSessionArtifact({ descriptor: demoDescriptor(), sessionDir }) as { generations: unknown[]; sourcesScanned: string[] };
    assert.deepEqual(artifact.generations, [], 'an escaping generations/ dir-symlink must be treated as absent, exactly like manifests/themes (AT-68/69)');
    const serialized = JSON.stringify(artifact);
    assert.ok(!serialized.includes(OUTSIDE_MARKER), 'outside content must never surface anywhere in the result');
  });

  it('R4-16 AT-18: generations/2 is a symlink to an outside dir → that generation is absent, while a real generations/1 STILL renders (positive control — the guard must discriminate, not just refuse to read anything)', () => {
    const outsideDir = makeTmpDir('gengallery-escape2-outside-');
    const OUTSIDE_MARKER = 'OUTSIDE-GENERATION-2-MARKER-8834';
    writeFileSync(
      join(outsideDir, 'meta.json'),
      JSON.stringify({ iteration: 2, createdAt: '2026-08-06T10:00:00.000Z', feedback: null, targetElement: null, composed: false, skillRelPath: OUTSIDE_MARKER }),
      'utf8',
    );
    writeFileSync(join(outsideDir, 'DEMO.html'), `<html>${OUTSIDE_MARKER}</html>`, 'utf8');

    const sessionDir = makeTmpDir('gengallery-escape2-session-');
    mkdirSync(join(sessionDir, 'generations'), { recursive: true });
    writeGeneration(sessionDir, 1, { iteration: 1 }); // real, non-symlinked sibling
    symlinkSync(outsideDir, join(sessionDir, 'generations', '2'));

    const artifact = deriveSessionArtifact({ descriptor: demoDescriptor(), sessionDir }) as { generations: Array<{ number: number }> };
    assert.deepEqual(
      artifact.generations.map((g) => g.number),
      [1],
      'the escaping generation 2 must be absent, but the real generation 1 must still render',
    );
    const serialized = JSON.stringify(artifact);
    assert.ok(!serialized.includes(OUTSIDE_MARKER), 'outside content must never surface');
  });

  it('R4-16 AT-19: a symlinked FILE inside a real generation dir, pointing outside sessionDir → that ONE item is not surfaced, but the generation itself still renders its other real items (positive control)', () => {
    const outsideDir = makeTmpDir('gengallery-escape3-outside-');
    const OUTSIDE_MARKER = 'OUTSIDE-ITEM-CONTENT-MARKER-2290';
    const secretPath = join(outsideDir, 'secret.html');
    writeFileSync(secretPath, `<html>${OUTSIDE_MARKER}</html>`, 'utf8');

    const sessionDir = makeTmpDir('gengallery-escape3-session-');
    const gdir = join(sessionDir, 'generations', '1');
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, 'DEMO.html'), '<html>real demo</html>', 'utf8');
    writeFileSync(
      join(gdir, 'meta.json'),
      JSON.stringify({ iteration: 1, createdAt: '2026-08-06T10:00:00.000Z', feedback: null, targetElement: null, composed: false, skillRelPath: 'x' }),
      'utf8',
    );
    symlinkSync(secretPath, join(gdir, 'evil.html'));

    const artifact = deriveSessionArtifact({ descriptor: demoDescriptor(), sessionDir }) as { generations: Array<{ items: Array<{ path: string }> }> };
    const paths = artifact.generations[0].items.map((i) => i.path);
    assert.ok(paths.includes('DEMO.html'), 'a real, non-symlinked sibling item MUST still surface — the guard must discriminate, not just refuse to read the whole generation');
    assert.ok(!paths.includes('evil.html'), 'the symlinked item must not be surfaced at all, under any name');
    const serialized = JSON.stringify(artifact);
    assert.ok(!serialized.includes(OUTSIDE_MARKER), "the escaped file's content must never appear in the result");
  });
});

// ===========================================================================
// R4-17 — deriveSessionArtifact — contract-buildout. D4: `contract-buildout`
// consumes ALREADY-DERIVED, already-guarded `contractStages` rows passed in
// by the caller (the route derives them via cli/contract-stages.ts's
// deriveContractStages, which lives OUTSIDE this module's containment
// contract — it reads the PROJECT tree, not sessionDir). This module's own
// "may not read outside sessionDir" invariant is NOT relaxed: it does zero
// fs work for this kind, full stop — it just threads the supplied rows +
// the descriptor's label onto the typed artifact shape, and THROWS when
// contractStages is absent (never a silently empty/defaulted artifact).
// TEST-FIRST PIN: `contract-buildout` is still `reserved` in the real,
// unmodified session-kinds.ts today — every test below currently throws
// inside deriveSessionArtifact's own `state === 'reserved'` gate before ever
// reaching the case, exactly like R4-16's generation-gallery block did at
// ITS branch base (see that block's own header note for the precedent).
// ===========================================================================

describe('deriveSessionArtifact — contract-buildout (R4-17)', () => {
  it('R4-17 AT-1: contractStages supplied → returns {kind, label, stages, sourcesScanned} — label from descriptor.artifact.label (never re-derived), stages threaded VERBATIM (not re-sorted, not filtered)', () => {
    const sessionDir = makeTmpDir('contractbuildout-supplied-');
    const stages = fixtureContractStages();
    const artifact = deriveSessionArtifact({
      descriptor: onboardingDescriptor(),
      sessionDir,
      contractStages: stages,
    } as Parameters<typeof deriveSessionArtifact>[0] & { contractStages: typeof stages }) as {
      kind: string;
      label: string;
      stages: typeof stages;
      sourcesScanned: string[];
    };
    assert.equal(artifact.kind, 'contract-buildout');
    assert.equal(artifact.label, 'Contract build-out', 'label must come from descriptor.artifact.label — never a hardcoded/re-derived string');
    assert.deepEqual(artifact.stages, stages, 'the supplied rows must round-trip VERBATIM — this module performs no re-derivation, re-sorting, or filtering of them');
  });

  it('R4-17 AT-2: contractStages ABSENT → THROWS a named error, never returns an empty/defaulted artifact (D4\'s binding rule)', () => {
    const sessionDir = makeTmpDir('contractbuildout-missing-');
    assert.throws(
      () => deriveSessionArtifact({ descriptor: onboardingDescriptor(), sessionDir }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /contractStages/i, `error must name the missing input, got: ${err.message}`);
        return true;
      },
      'an implementation that defaults to an empty stages:[] artifact instead of throwing is exactly the defect this pins',
    );
  });

  it('R4-17 AT-3 (D4 — no fs read outside sessionDir, or ANYWHERE, for this kind): a sessionDir that does not even EXIST on disk still succeeds and returns the supplied rows unchanged — proves the module performs ZERO filesystem work for contract-buildout', () => {
    const nonExistentSessionDir = join(tmpdir(), 'contract-buildout-does-not-exist-on-disk-8827');
    const stages = fixtureContractStages();
    const artifact = deriveSessionArtifact({
      descriptor: onboardingDescriptor(),
      sessionDir: nonExistentSessionDir,
      contractStages: stages,
    } as Parameters<typeof deriveSessionArtifact>[0] & { contractStages: typeof stages }) as { stages: typeof stages };
    assert.deepEqual(
      artifact.stages,
      stages,
      'a non-existent sessionDir must have NO effect on the result — this module never reads sessionDir at all for contract-buildout (D4); an implementation that tries to read/list sessionDir for this kind would throw or return something different here instead',
    );
  });

  it('R4-17 AT-4: an EMPTY contractStages array (all five stages genuinely absent) is a legitimate, distinct input from "absent altogether" — round-trips as an empty array, never conflated with the missing-input throw of AT-2', () => {
    const sessionDir = makeTmpDir('contractbuildout-empty-');
    const artifact = deriveSessionArtifact({
      descriptor: onboardingDescriptor(),
      sessionDir,
      contractStages: [],
    } as Parameters<typeof deriveSessionArtifact>[0] & { contractStages: unknown[] }) as { stages: unknown[] };
    assert.deepEqual(artifact.stages, [], 'an explicitly empty array must be accepted and round-tripped, not treated as "absent" and thrown on');
  });
});

// ===========================================================================
// R4-19-F2 — deriveSessionArtifact — cleanup-plan (brain-maintenance's
// KB-cleanup session). RED at branch base: 'cleanup-plan' is not yet a member
// of SESSION_ARTIFACT_KINDS at all, so every test below currently throws
// inside deriveSessionArtifact's own `state === undefined` gate before ever
// reaching a 'cleanup-plan' case — mirrors this file's own precedent for
// every prior not-yet-shipped kind (see e.g. the contract-buildout block's
// header note above).
//
// DERIVE-DON'T-STORE (the binding contract, per the task brief): the session
// dir's plan/cleanup-plan.md supplies the agent's PROPOSED ACTIONS only. The
// CURRENT findings are ALWAYS supplied by the CALLER (a live, KB-scoped
// brain-lint run) — mirrors contract-buildout's D4 pattern exactly, just
// with a different caller-supplied field name. DESIGN CALL (stated
// explicitly, mirroring this file's own precedent for undeclared names,
// e.g. the R4-22/interactive-runner suite's "MY CALL" convention): the
// caller-supplied parameter is named `cleanupFindings` on
// deriveSessionArtifact's input object — this name is NOT dictated anywhere
// in ADR-043 or the task brief; if the implementer picks a different name,
// update the calls below to match (the BEHAVIOUR these tests pin — a
// caller-supplied findings list, DERIVED joins, a throw when absent — is the
// load-bearing contract, not this exact identifier).
// ===========================================================================

/** R4-19-F2: the new "kb-cleanup" session kind (studio/session-kinds.yaml —
 *  not shipped yet at branch base; see session-kinds.test.ts's own R4-19-F2
 *  block). deriveSessionArtifact never reads `stages` at all, so this stays
 *  decoupled from the SEPARATE SESSION_STAGES vocabulary concern, mirroring
 *  authoringDescriptor's own header note. */
function kbCleanupDescriptor(overrides: Partial<SessionKindDescriptor> = {}): SessionKindDescriptor {
  return {
    id: 'kb-cleanup',
    agent: 'brain-maintenance',
    title: 'KB cleanup session',
    legacyRoutes: [],
    stages: ['brain'],
    defaultStage: 'brain',
    artifact: { kind: 'cleanup-plan', label: 'Cleanup plan' },
    ...overrides,
  } as SessionKindDescriptor;
}

/** Writes the session dir's `plan/cleanup-plan.md` — the ONLY place the
 *  agent's proposed actions live (never the findings; those are ALWAYS
 *  caller-supplied — see the derive-don't-store header above). Mirrors this
 *  file's own `writeStagingFile` idiom: a DEDICATED subdirectory, so a
 *  kb-cleanup session's plan can never collide with the fixed
 *  CANDIDATE_SOURCE_FILES transcript scan every session dir is
 *  unconditionally scanned against regardless of kind. */
function writeCleanupPlanFile(sessionDir: string, body: string): void {
  const abs = join(sessionDir, 'plan', 'cleanup-plan.md');
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

/** A minimal caller-supplied finding, shaped like skills/brain-maintenance/
 *  SKILL.md's own documented input contract (`check`, `kind`, `file`,
 *  `message`) — deliberately NOT imported from cli/brain-lint.ts's real
 *  `Finding` type: this module stays a pure, fs-only derivation with no
 *  business importing the lint engine (mirrors `fixtureContractStages`'s own
 *  header rationale, above, for hand-fixturing rather than cross-importing —
 *  the route, cli/bridge-studio-sessions.ts, is the layer that wires the
 *  real `runBrainLint`/`lintThemeFiles` output in). */
function fixtureFinding(kind: string, file: string, message = 'fixture finding'): { check: string; kind: string; file: string; message: string } {
  return { check: kind, kind, file, message };
}

// The exact byte form skills/brain-maintenance/SKILL.md's output-contract
// section mandates verbatim: `- [<kind>] <theme-file-path> — <one-sentence
// proposal>` (an em dash, "—", not a hyphen).
const PLAN_TWO_ACTIONS = [
  '# Cleanup plan',
  '',
  'Two proposed actions from the drafting turn.',
  '',
  '- [edge.dangling] brain/forge-dev/themes/foo.md — repoint the related_themes entry at `2026-05-17-foo`.',
  '- [theme.duplicate] brain/cycles/themes/bar.md — merge into baz.md, the richer survivor.',
  '',
].join('\n');

describe('deriveSessionArtifact — cleanup-plan (R4-19-F2, brain-maintenance KB-cleanup session)', () => {
  // Kills: a renderer that ignores the plan file entirely and returns
  // actions:[]; a renderer that mis-splits the `[<kind>] <target> — <proposal>`
  // line shape (e.g. swaps kind/target, or includes the leading "- " marker
  // in `target`); a renderer that marks every action "open" unconditionally
  // regardless of whether its finding is actually present in the
  // caller-supplied list.
  it('R4-19-F2 AT-1: parses the plan\'s action lines into actions[] with kind/target/proposal, each marked "open" when its matching finding IS present in the caller-supplied list', () => {
    const sessionDir = makeTmpDir('cleanupplan-parse-');
    writeCleanupPlanFile(sessionDir, PLAN_TWO_ACTIONS);
    const findings = [
      fixtureFinding('edge.dangling', 'brain/forge-dev/themes/foo.md'),
      fixtureFinding('theme.duplicate', 'brain/cycles/themes/bar.md'),
    ];

    const artifact = deriveSessionArtifact({
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: findings,
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: typeof findings }) as {
      kind: string;
      label: string;
      plan: string | null;
      actions: Array<{ kind: string; target: string; proposal: string; state: string }>;
      openFindingCount: number;
    };

    assert.equal(artifact.kind, 'cleanup-plan');
    assert.equal(artifact.actions.length, 2, `expected 2 parsed actions, got: ${JSON.stringify(artifact.actions)}`);
    const byTarget = new Map(artifact.actions.map((a) => [a.target, a]));
    const foo = byTarget.get('brain/forge-dev/themes/foo.md');
    assert.ok(foo, `expected an action targeting brain/forge-dev/themes/foo.md, got: ${JSON.stringify(artifact.actions)}`);
    assert.equal(foo!.kind, 'edge.dangling');
    assert.equal(foo!.proposal, 'repoint the related_themes entry at `2026-05-17-foo`.');
    assert.equal(foo!.state, 'open');
    const bar = byTarget.get('brain/cycles/themes/bar.md');
    assert.ok(bar, `expected an action targeting brain/cycles/themes/bar.md, got: ${JSON.stringify(artifact.actions)}`);
    assert.equal(bar!.kind, 'theme.duplicate');
    assert.equal(bar!.proposal, 'merge into baz.md, the richer survivor.');
    assert.equal(bar!.state, 'open');
    assert.equal(artifact.openFindingCount, 2);
  });

  // Kills: a renderer that defaults to an empty actions:[]/openFindingCount:0
  // artifact when the caller supplies nothing — the exact "declared-data-
  // fails-open" antipattern the contract-buildout precedent (D4) exists to
  // rule out; mirrors that block's own AT-2 exactly, one screen up.
  it('R4-19-F2 AT-2: cleanupFindings ABSENT -> THROWS a named error naming the missing input, never returns a silent empty/defaulted artifact', () => {
    const sessionDir = makeTmpDir('cleanupplan-missing-findings-');
    writeCleanupPlanFile(sessionDir, PLAN_TWO_ACTIONS);
    assert.throws(
      () => deriveSessionArtifact({ descriptor: kbCleanupDescriptor(), sessionDir }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /finding/i, `error must name the missing caller-supplied input, got: ${err.message}`);
        return true;
      },
      'an implementation that defaults to actions:[]/openFindingCount:0 instead of throwing is exactly the defect this pins',
    );
  });

  // DERIVE-DON'T-STORE — the repo's #1 defect class, per the task brief.
  // Kills: any implementation that stores a per-action status field
  // (in the plan file, in status.json, or anywhere else) instead of
  // deriving `state` fresh from the caller-supplied findings on EVERY call.
  // Proven by calling deriveSessionArtifact TWICE against the SAME
  // byte-unchanged plan file with two DIFFERENT findings lists — a
  // stored-status implementation would report 'open' both times (whatever
  // was written once); a correctly-derived implementation must flip.
  //
  // AMENDED (R4-19-F2-fix, ORCHESTRATOR RULING): the NOW-ABSENT finding's
  // action flips to 'unknown', NOT 'cleared'. This is a CORRECTION, not a
  // weakening of what this test proves: it still requires `state` to flip
  // between two genuinely DIFFERENT values across the two calls (proving
  // fresh derivation, never a stored field) — it just lands on the value the
  // ruling actually mandates. 'cleared' is a POSITIVE claim that the target
  // was scanned and found clean; `fixtureFinding`'s minimal shape and
  // `deriveCleanupPlan`'s own inputs (sessionDir, label, cleanupFindings)
  // carry no scanned-domain evidence for `brain/cycles/themes/bar.md`, so
  // 'cleared' here would be exactly the fail-open defect this whole file
  // exists to close out (see the fail-safe block below for the full
  // contract). The ORIGINAL 'cleared' expectation was itself an instance of
  // "a fixture whose two sides happen to agree is what let the P1 ship."
  it('R4-19-F2 AT-3 (DERIVE-DON\'T-STORE, amended): with the plan file BYTE-UNCHANGED across two calls, removing one action\'s finding from the caller-supplied list flips ONLY that action\'s state to "unknown" (never silently "cleared") and lowers openFindingCount — state is derived at read time, never stored', () => {
    const sessionDir = makeTmpDir('cleanupplan-derive-');
    writeCleanupPlanFile(sessionDir, PLAN_TWO_ACTIONS);
    const planPath = join(sessionDir, 'plan', 'cleanup-plan.md');
    const planBytesBefore = readFileSync(planPath, 'utf8');

    const bothFindings = [
      fixtureFinding('edge.dangling', 'brain/forge-dev/themes/foo.md'),
      fixtureFinding('theme.duplicate', 'brain/cycles/themes/bar.md'),
    ];
    type Artifact = { actions: Array<{ target: string; state: string }>; openFindingCount: number };
    const before = deriveSessionArtifact({
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: bothFindings,
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: typeof bothFindings }) as Artifact;
    assert.equal(before.actions.find((a) => a.target === 'brain/forge-dev/themes/foo.md')?.state, 'open', 'arrange: both actions start open');
    assert.equal(before.actions.find((a) => a.target === 'brain/cycles/themes/bar.md')?.state, 'open', 'arrange: both actions start open');
    assert.equal(before.openFindingCount, 2, 'arrange: both findings open');

    // The SECOND finding is now resolved elsewhere (e.g. auto-fixed by a
    // later lint pass) — the CALLER supplies a shorter list. The plan file
    // on disk is never touched between these two calls.
    const oneFindingLeft = [fixtureFinding('edge.dangling', 'brain/forge-dev/themes/foo.md')];
    const after = deriveSessionArtifact({
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: oneFindingLeft,
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: typeof oneFindingLeft }) as Artifact;

    assert.equal(
      readFileSync(planPath, 'utf8'),
      planBytesBefore,
      'the plan file on disk must be BYTE-UNCHANGED between the two calls — the state flip must come purely from the different findings list, never a write to the plan',
    );
    assert.equal(after.actions.find((a) => a.target === 'brain/forge-dev/themes/foo.md')?.state, 'open', 'the still-present finding\'s action must stay open');
    assert.equal(
      after.actions.find((a) => a.target === 'brain/cycles/themes/bar.md')?.state,
      'unknown',
      'the NOW-ABSENT finding\'s action must flip to "unknown", proving state is derived at read time from the findings list, never a stored per-action status field anywhere — it must NOT flip to "cleared": deriveCleanupPlan\'s inputs (sessionDir, label, cleanupFindings) carry no scanned-domain evidence that would justify the positive claim "cleared" makes',
    );
    assert.equal(after.openFindingCount, 1, 'openFindingCount must drop from 2 to 1 as the resolved finding leaves the caller-supplied list — and must NOT count the now-"unknown" action, proving openFindingCount counts state===\'open\' specifically, not merely state!==\'cleared\'');
  });

  // Kills: a renderer that treats "the plan has no matching action lines" the
  // SAME as "there is no plan at all" — e.g. returning plan:null whenever
  // actions[] is empty, which would silently hide a drafted-but-malformed
  // plan from the operator (the exact "no actions and no plan" failure mode
  // the task brief calls out by name).
  it('R4-19-F2 AT-4: a plan file present but with ZERO parseable action lines yields actions:[] AND a non-null plan carrying the raw text — never silently "no actions and no plan"', () => {
    const sessionDir = makeTmpDir('cleanupplan-unparseable-');
    const RAW_PROSE = '# Cleanup plan\n\nI looked at the findings but none of them warrant a structured action yet — more investigation needed before I can propose anything concrete.\n';
    writeCleanupPlanFile(sessionDir, RAW_PROSE);

    const artifact = deriveSessionArtifact({
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [],
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: unknown[] }) as { plan: string | null; actions: unknown[] };

    assert.deepEqual(artifact.actions, [], 'zero lines match the mandated action-line format, so actions must be empty');
    assert.equal(
      artifact.plan,
      RAW_PROSE,
      'the raw plan text must still surface verbatim even with zero parseable action lines — a renderer returning plan:null here is indistinguishable from "no plan file at all" (AT-5 below), the exact ambiguity this pins',
    );
  });

  // Kills: a renderer that throws, or fabricates a plan string, when the
  // session simply hasn't reached a drafted turn yet (e.g. read before the
  // first agent turn ran).
  it('R4-19-F2 AT-5: no plan file at all yields plan:null and actions:[] without throwing', () => {
    const sessionDir = makeTmpDir('cleanupplan-noplan-');
    const artifact = deriveSessionArtifact({
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [],
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: unknown[] }) as { plan: string | null; actions: unknown[] };
    assert.equal(artifact.plan, null);
    assert.deepEqual(artifact.actions, []);
  });

  // Kills: a renderer that reads plan/cleanup-plan.md via a raw
  // join()+readFileSync (or any path that skips the module's shared
  // realpath-containment choke point) — mirrors deriveFilePackage's own
  // RED-2b/RED-2e symlink-escape guard exactly, one screen up in this file,
  // just at the single-file granularity cleanup-plan uses instead of a
  // recursive walk.
  it('R4-19-F2 AT-6 (containment): a plan/ directory that is a symlink escaping the session dir contributes NO file — mirrors deriveFilePackage/walkPackageFiles\'s existing containment guarantee (RED-2b/RED-2e\'s idiom)', () => {
    const outsideDir = makeTmpDir('cleanupplan-escape-outside-');
    const SECRET_MARKER = 'TOP-SECRET-CLEANUP-PLAN-MARKER-5541';
    writeFileSync(join(outsideDir, 'cleanup-plan.md'), `- [edge.dangling] brain/x/themes/y.md — ${SECRET_MARKER}\n`, 'utf8');

    const sessionDir = makeTmpDir('cleanupplan-escape-session-');
    symlinkSync(outsideDir, join(sessionDir, 'plan'));
    assert.ok(existsSync(join(sessionDir, 'plan')), 'arrange: the symlinked plan/ must resolve to something');

    const artifact = deriveSessionArtifact({
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [],
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: unknown[] }) as { plan: string | null; actions: unknown[] };

    const serialized = JSON.stringify(artifact);
    assert.ok(!serialized.includes(SECRET_MARKER), 'the escaped file\'s content must never appear anywhere in the derived cleanup-plan artifact');
    assert.equal(artifact.plan, null, 'a plan/ that escapes the session dir must contribute NO file — collapsed to the same "no plan file at all" outcome as AT-5');
    assert.deepEqual(artifact.actions, []);
  });
});

// ===========================================================================
// R4-19-F2-fix — the P1 fix: `deriveCleanupPlan` joined a caller-supplied
// ABSOLUTE `Finding.file` against a parsed REPO-RELATIVE plan `target` with
// no normalization, so no real action ever matched and every one silently
// read "cleared" (declared-data-fails-open in its most dangerous direction —
// see this file's own module-header precedent for that phrase, and the task
// brief's incident writeup). This block pins the ORCHESTRATOR RULING that
// closes it: `state` widens from 'open' | 'cleared' to 'open' | 'cleared' |
// 'unknown', where 'cleared' is a POSITIVE claim requiring scanned-domain
// evidence, and 'unknown' is the honest default when that evidence isn't
// establishable.
//
// TESTABILITY NOTE (read before touching this block): `deriveCleanupPlan`
// only ever receives (sessionDir, label, cleanupFindings) — see
// deriveSessionArtifact's 'cleanup-plan' case and cli/bridge-studio-
// sessions.ts's call site, neither of which threads a forgeRoot/kbBrainDir
// or any other scanned-domain signal through. Under THIS signature there is
// NO way to ever positively establish "this target's absence from
// cleanupFindings means it was scanned and found clean" — so every test
// below that exercises a genuinely unmatched target pins 'unknown', not
// 'cleared', and no test in this file ever asserts 'cleared' is reachable at
// all under the current 3-argument call shape. See this file's own T3-style
// report for the explicit statement that the 'cleared' vs 'unknown' split is
// NOT testable from these inputs alone, and what the implementer needs to
// add to ever make 'cleared' reachable.
// ===========================================================================

describe('deriveSessionArtifact — cleanup-plan state (R4-19-F2-fix: path normalization + fail-safe cleared/unknown split)', () => {
  // Type-level pin (BUILD-time, via `tsc`/`npm run build` — node's own
  // `--experimental-strip-types` test run strips type annotations without
  // checking them, so this assignment produces no runtime signal under the
  // scoped `node --test` command; it is a real compile error today because
  // CleanupPlanAction['state'] is currently the narrower 'open' | 'cleared'
  // union, and becomes valid once the implementer widens it per the
  // ORCHESTRATOR RULING). Kills: an implementation that satisfies every
  // runtime assertion below by returning the STRING 'unknown' while leaving
  // the exported TYPE at 'open' | 'cleared' (e.g. via an `as any`/unchecked
  // cast at the return site) — that would pass every `assert.equal` in this
  // file yet leave every real caller of `CleanupPlanAction` (e.g. forge-ui's
  // eventual renderer) type-unsound.
  it('R4-19-F2-fix TYPE-1: CleanupPlanAction[\'state\'] is widened to include \'unknown\' (compile-time pin — see TESTABILITY NOTE above)', () => {
    const widenedStateMustBeAssignable: CleanupPlanAction['state'] = 'unknown' as 'open' | 'cleared' | 'unknown';
    assert.equal(widenedStateMustBeAssignable, 'unknown', 'the widened-union value must round-trip at runtime too, not just type-check');
  });

  // THE REGRESSION LOCK (task brief item 4) — the ONE test that would have
  // caught the live P1: the REAL captured plan text (scripts/journeys/
  // fixtures/r4-19-f2-live-capture/cleanup-plan.md) driven against the REAL
  // captured findings (.../status.json's findings[], absolute `.file` per
  // cli/brain-lint.ts's contract). The live bug reported openFindingCount:0
  // with BOTH actions 'cleared'; both findings were genuinely still live.
  // Kills: the exact defect — comparing an absolute Finding.file directly
  // against a repo-relative parsed target with no normalization.
  it('R4-19-F2-fix REGRESSION-LOCK: the REAL captured plan against the REAL captured findings yields BOTH actions "open" and openFindingCount === 2 (the live run wrongly reported both "cleared" and openFindingCount: 0)', () => {
    const sessionDir = makeTmpDir('cleanupplan-live-capture-');
    writeCleanupPlanFile(sessionDir, REAL_CLEANUP_PLAN_MD);

    const artifact = deriveSessionArtifact({
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: REAL_STATUS.findings,
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: readonly RealFinding[] }) as {
      plan: string | null;
      actions: Array<{ kind: string; target: string; state: string }>;
      openFindingCount: number;
    };

    assert.equal(artifact.plan, REAL_CLEANUP_PLAN_MD, 'the real plan text must surface verbatim');
    assert.equal(artifact.actions.length, 2, `expected exactly 2 parsed actions from the real plan, got: ${JSON.stringify(artifact.actions)}`);
    for (const action of artifact.actions) {
      assert.equal(
        action.state,
        'open',
        `action targeting "${action.target}" (kind "${action.kind}") must be "open" — its finding IS present in the real captured findings; ` +
          `the live P1 reported this as "cleared" because it compared the repo-relative target literally against the absolute Finding.file with no normalization`,
      );
    }
    assert.equal(artifact.openFindingCount, 2, 'openFindingCount must be 2 for the real capture — the live bug reported 0');
  });

  // Path normalization, direction 1 (relative target -> absolute finding,
  // isolated to ONE real pair) — pins the exact real (kind, target, file)
  // triple from the capture, independent of the full-plan parse the
  // regression-lock test above also exercises.
  it('R4-19-F2-fix NORM-1: a repo-relative parsed target matches a live finding whose `.file` is the ABSOLUTE path to that same file (the real captured edge.dangling pair)', () => {
    const sessionDir = makeTmpDir('cleanupplan-norm-relative-');
    writeCleanupPlanFile(sessionDir, `- [edge.dangling] ${REAL_DANGLING_TARGET_RELATIVE} — drop the dangling entry.\n`);

    const artifact = deriveSessionArtifact({
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [REAL_FINDING_DANGLING!],
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: readonly RealFinding[] }) as { actions: Array<{ target: string; state: string }> };

    assert.equal(artifact.actions.length, 1);
    assert.equal(
      artifact.actions[0]!.state,
      'open',
      `a repo-relative target ("${REAL_DANGLING_TARGET_RELATIVE}") must match the real absolute finding.file ("${REAL_FINDING_DANGLING!.file}") — a literal string-equality join (the P1 defect) would never match these two forms`,
    );
  });

  // Path normalization, direction 2 (reverse: an ALREADY-ABSOLUTE parsed
  // target matches the same absolute finding). Kills: an implementation that
  // unconditionally does `join(someRoot, target)` to normalize — Node's
  // `path.join` does NOT discard the first argument when the second is
  // already absolute (`join('/a/b', '/c/d')` -> `/a/b/c/d`, not `/c/d`), so a
  // normalizer that fails to check `isAbsolute(target)` first would mangle
  // an already-absolute target and miss this match.
  it('R4-19-F2-fix NORM-2: an ALREADY-ABSOLUTE parsed target matches a live finding with that exact `.file`', () => {
    const sessionDir = makeTmpDir('cleanupplan-norm-absolute-');
    writeCleanupPlanFile(sessionDir, `- [edge.dangling] ${REAL_FINDING_DANGLING!.file} — drop the dangling entry.\n`);

    const artifact = deriveSessionArtifact({
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [REAL_FINDING_DANGLING!],
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: readonly RealFinding[] }) as { actions: Array<{ target: string; state: string }> };

    assert.equal(artifact.actions.length, 1);
    assert.equal(artifact.actions[0]!.target, REAL_FINDING_DANGLING!.file, 'arrange: the parsed target must be the literal absolute path');
    assert.equal(artifact.actions[0]!.state, 'open', 'an already-absolute target equal to the finding\'s own absolute `.file` must match');
  });

  // Path normalization, direction 3 (a `./`-prefixed relative target).
  // Kills: a normalizer that suffix-matches the absolute finding.file against
  // the RAW target without first stripping a leading `./` — `absPath.endsWith
  // ('/' + './brain/...')` is false even though `./brain/...` and `brain/...`
  // name the same file, so an implementation that skips this stripping step
  // would report 'unknown' (or, pre-fix, 'cleared') here instead of 'open'.
  it('R4-19-F2-fix NORM-3: a "./"-prefixed repo-relative target matches the same live finding as its un-prefixed form', () => {
    const sessionDir = makeTmpDir('cleanupplan-norm-dotslash-');
    writeCleanupPlanFile(sessionDir, `- [edge.dangling] ./${REAL_DANGLING_TARGET_RELATIVE} — drop the dangling entry.\n`);

    const artifact = deriveSessionArtifact({
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [REAL_FINDING_DANGLING!],
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: readonly RealFinding[] }) as { actions: Array<{ target: string; state: string }> };

    assert.equal(artifact.actions.length, 1);
    assert.equal(
      artifact.actions[0]!.state,
      'open',
      `a "./"-prefixed target ("./${REAL_DANGLING_TARGET_RELATIVE}") must match the same finding as its un-prefixed form — a normalizer that only strips a KNOWN prefix (never a leading "./") would miss this`,
    );
  });

  // THE HEART OF IT (task brief item 2 + item 3) — fail SAFE, not open. An
  // action with NO matching live finding must default to 'unknown', never
  // silently 'cleared' — and openFindingCount must count ONLY 'open' actions,
  // not merely "not cleared" (which would wrongly include 'unknown'). Two
  // actions in one plan (one matched, one not) so this also proves the two
  // are computed INDEPENDENTLY, per-action — not a single plan-wide verdict.
  // Kills: (a) the original P1 shape (unmatched -> 'cleared'); (b) an
  // over-permissive fix that defaults unmatched to 'open' instead of
  // 'unknown'; (c) an openFindingCount computed as `actions.length -
  // clearedCount` or `state !== 'cleared'`, which would wrongly count the
  // 'unknown' action as open (2, not 1).
  it('R4-19-F2-fix FAIL-SAFE-1: an action with NO matching live finding reports "unknown" (never "cleared") even while a SIBLING action in the same plan IS matched — and openFindingCount counts ONLY the matched one', () => {
    const sessionDir = makeTmpDir('cleanupplan-failsafe-sibling-');
    const NO_MATCH_TARGET = 'brain/forge-dev/themes/no-such-finding-exists-for-this-target.md';
    writeCleanupPlanFile(
      sessionDir,
      [
        `- [edge.dangling] ${REAL_DANGLING_TARGET_RELATIVE} — drop the dangling entry.`,
        `- [length.soft-cap] ${NO_MATCH_TARGET} — condense this theme.`,
        '',
      ].join('\n'),
    );

    const artifact = deriveSessionArtifact({
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [REAL_FINDING_DANGLING!], // only the FIRST action's finding is live
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: readonly RealFinding[] }) as {
      actions: Array<{ target: string; state: string }>;
      openFindingCount: number;
    };

    assert.equal(artifact.actions.length, 2);
    const matched = artifact.actions.find((a) => a.target === REAL_DANGLING_TARGET_RELATIVE);
    const unmatched = artifact.actions.find((a) => a.target === NO_MATCH_TARGET);
    assert.equal(matched?.state, 'open', 'the sibling WITH a live finding must be open');
    assert.equal(
      unmatched?.state,
      'unknown',
      'the action with NO matching live finding must be "unknown" — deriveCleanupPlan has no scanned-domain evidence for this target, so "cleared" (a positive claim of verified absence) would be exactly the fail-open defect this pins',
    );
    assert.equal(
      artifact.openFindingCount,
      1,
      'openFindingCount must be 1, not 2 — it must count actions whose state IS "open", never actions that are merely "not cleared" (which would wrongly include the "unknown" one)',
    );
  });

  // Same fail-safe contract, but from the "genuinely clean scan" angle: an
  // EMPTY cleanupFindings list looks, superficially, like "the KB was
  // scanned and nothing is wrong" — but deriveCleanupPlan cannot structurally
  // tell that apart from "the caller passed [] for some other reason" (the
  // exact ambiguity the live P1 exploited: the caller-supplied list was
  // non-empty in production, yet the join still silently produced the same
  // "everything looks resolved" outcome). Reuses the REAL plan text again so
  // this stays grounded in the real capture, not an invented shape.
  it('R4-19-F2-fix FAIL-SAFE-2: an EMPTY caller-supplied findings list against the REAL plan yields "unknown" for every action (never "cleared") and openFindingCount === 0', () => {
    const sessionDir = makeTmpDir('cleanupplan-failsafe-empty-');
    writeCleanupPlanFile(sessionDir, REAL_CLEANUP_PLAN_MD);

    const artifact = deriveSessionArtifact({
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [],
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: RealFinding[] }) as {
      actions: Array<{ target: string; state: string }>;
      openFindingCount: number;
    };

    assert.equal(artifact.actions.length, 2);
    for (const action of artifact.actions) {
      assert.equal(
        action.state,
        'unknown',
        `action targeting "${action.target}" must be "unknown" with an empty caller-supplied findings list — deriveCleanupPlan cannot tell "genuinely scanned and clean" apart from "no domain evidence supplied" from its current inputs alone, so it must never claim "cleared"`,
      );
    }
    assert.equal(artifact.openFindingCount, 0);
  });
});

// ===========================================================================
// R4-19-F2, cleanupScan (ORCHESTRATOR RULING) — the positive control for
// 'cleared'. The block immediately above (R4-19-F2-fix) correctly proved
// 'cleared' is UNREACHABLE under `deriveCleanupPlan`'s old 3-argument shape
// (sessionDir, label, cleanupFindings) and pinned every unmatched target to
// 'unknown' — right, because absence from cleanupFindings is not evidence of
// a genuine scan without also knowing what region the scan covered. That
// correctly leaves a hole: 'cleared' must become reachable, or the product
// can never show an operator that an approved repair actually landed.
//
// `deriveSessionArtifact` gains one ADDITIVE-OPTIONAL field (mirrors
// `contractStages`'s own disclose-not-park threading, ADR 042):
//
//   cleanupScan?: { readonly forgeRoot: string; readonly brainDir: string }
//
// `forgeRoot` is the absolute path repo-relative action targets resolve
// against; `brainDir` is the absolute directory the caller's
// `cleanupFindings` were actually scanned from (cli/bridge-studio-
// sessions.ts resolves this via `resolveKbBrainDir`). Derived semantics:
//
//   'open'    — a live finding matches the action (kind + target, both
//               normalized to absolute).
//   'cleared' — no live finding matches, cleanupScan IS supplied, AND the
//               action's normalized target lies INSIDE brainDir. Absence is
//               then real evidence: the region was scanned and came back
//               clean.
//   'unknown' — no live finding matches and coverage cannot be established:
//               cleanupScan absent, OR the target resolves OUTSIDE
//               brainDir.
//
// This block does not touch (weaken/delete/renumber) any test in the block
// above — those 6 reds belong to the implementer landing `cleanupScan`
// end-to-end; every test below is a NEW, separate red proving the positive
// path once that lands.
// ===========================================================================

describe('deriveSessionArtifact — cleanup-plan cleared reachability (R4-19-F2, cleanupScan scanned-domain signal — ORCHESTRATOR RULING)', () => {
  const CLEARED_TARGET_RELATIVE = 'brain/forge-dev/themes/foo.md';

  /** Builds a real `forgeRoot`/`brainDir` on disk (`<forgeRoot>/brain/
   *  forge-dev`, containing the real target file at
   *  `themes/foo.md`) plus a session dir whose plan has ONE action targeting
   *  it, repo-relative. Used by SCAN-1, SCAN-2, and SCAN-5 so their content
   *  is identical — only the tmp-dir paths themselves (arbitrary
   *  infrastructure `mkdtempSync` hands out) legitimately differ between
   *  calls. */
  function buildClearedFixture(): { sessionDir: string; forgeRoot: string; brainDir: string } {
    const forgeRoot = makeTmpDir('cleanupplan-scan-root-');
    const brainDir = join(forgeRoot, 'brain', 'forge-dev');
    mkdirSync(join(brainDir, 'themes'), { recursive: true });
    writeFileSync(join(brainDir, 'themes', 'foo.md'), '# foo\n', 'utf8');
    const sessionDir = makeTmpDir('cleanupplan-scan-session-');
    writeCleanupPlanFile(sessionDir, `- [edge.dangling] ${CLEARED_TARGET_RELATIVE} — repoint the related_themes entry.\n`);
    return { sessionDir, forgeRoot, brainDir };
  }

  it('R4-19-F2 SCAN-1 (POSITIVE CONTROL — "cleared" IS reachable): a target inside brainDir, cleanupScan supplied, and NO matching finding reports "cleared"', () => {
    const { sessionDir, forgeRoot, brainDir } = buildClearedFixture();
    const artifact = deriveSessionArtifact({
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [],
      cleanupScan: { forgeRoot, brainDir },
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupScan: { forgeRoot: string; brainDir: string } }) as {
      actions: Array<{ target: string; state: string }>;
      openFindingCount: number;
    };

    assert.equal(artifact.actions.length, 1);
    assert.equal(
      artifact.actions[0]!.state,
      'cleared',
      'a target inside the scanned brainDir with NO matching live finding must report "cleared" — this is the repair-landed story: an implementation that leaves "cleared" permanently unreachable (e.g. never widening the join past open|unknown even once cleanupScan is threaded through) fails here',
    );
    assert.equal(artifact.openFindingCount, 0, 'a "cleared" action must never be counted by openFindingCount');
  });

  it('R4-19-F2 SCAN-2 ("cleared" requires coverage): byte-identical inputs to SCAN-1 but with cleanupScan OMITTED report "unknown", never "cleared"', () => {
    const { sessionDir } = buildClearedFixture();
    const artifact = deriveSessionArtifact({
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [],
      // cleanupScan deliberately OMITTED — everything else matches SCAN-1's fixture verbatim.
    }) as { actions: Array<{ target: string; state: string }> };

    assert.equal(artifact.actions.length, 1);
    assert.equal(
      artifact.actions[0]!.state,
      'unknown',
      'omitting cleanupScan must fall back to "unknown" — an implementation that treats an unmatched action as "repair landed" whenever cleanupScan simply happens to be missing (never actually gating on its presence) is exactly the fail-open shortcut this kills',
    );
  });

  it('R4-19-F2 SCAN-3 (outside the scanned region): cleanupScan IS supplied, but the action targets a file OUTSIDE brainDir (another KB\'s brain dir) with no matching finding — reports "unknown", not "cleared"', () => {
    const forgeRoot = makeTmpDir('cleanupplan-scan3-root-');
    const brainDir = join(forgeRoot, 'brain', 'forge-dev');
    mkdirSync(join(brainDir, 'themes'), { recursive: true });
    const otherKbTarget = 'brain/cycles/themes/bar.md';
    mkdirSync(join(forgeRoot, 'brain', 'cycles', 'themes'), { recursive: true });
    writeFileSync(join(forgeRoot, 'brain', 'cycles', 'themes', 'bar.md'), '# bar\n', 'utf8');

    const sessionDir = makeTmpDir('cleanupplan-scan3-session-');
    writeCleanupPlanFile(sessionDir, `- [theme.duplicate] ${otherKbTarget} — merge into baz.md, the richer survivor.\n`);

    const artifact = deriveSessionArtifact({
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [],
      cleanupScan: { forgeRoot, brainDir }, // this call only scanned brain/forge-dev, NOT brain/cycles
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupScan: { forgeRoot: string; brainDir: string } }) as {
      actions: Array<{ target: string; state: string }>;
    };

    assert.equal(artifact.actions.length, 1);
    assert.equal(
      artifact.actions[0]!.state,
      'unknown',
      'a target outside the scanned brainDir must stay "unknown" even though cleanupScan was supplied — an implementation that treats cleanupScan\'s mere PRESENCE as "the whole repo was scanned" (a "supplied means scanned" shortcut that ignores brainDir containment entirely) fails here, wrongly reporting "cleared" for a region the lint never walked',
    );
  });

  it('R4-19-F2 SCAN-4 (mixed plan, all three states in one call): one action open (has a matching finding), one cleared (inside brainDir, no match), one unknown (outside brainDir, no match) — openFindingCount counts ONLY the open one', () => {
    const forgeRoot = makeTmpDir('cleanupplan-scan4-root-');
    const brainDir = join(forgeRoot, 'brain', 'forge-dev');
    mkdirSync(join(brainDir, 'themes'), { recursive: true });
    writeFileSync(join(brainDir, 'themes', 'open-target.md'), '# open\n', 'utf8');
    writeFileSync(join(brainDir, 'themes', 'cleared-target.md'), '# cleared\n', 'utf8');
    mkdirSync(join(forgeRoot, 'brain', 'cycles', 'themes'), { recursive: true });
    writeFileSync(join(forgeRoot, 'brain', 'cycles', 'themes', 'unknown-target.md'), '# unknown\n', 'utf8');

    const OPEN_TARGET = 'brain/forge-dev/themes/open-target.md';
    const CLEARED_TARGET = 'brain/forge-dev/themes/cleared-target.md';
    const UNKNOWN_TARGET = 'brain/cycles/themes/unknown-target.md';

    const sessionDir = makeTmpDir('cleanupplan-scan4-session-');
    writeCleanupPlanFile(
      sessionDir,
      [
        `- [edge.dangling] ${OPEN_TARGET} — fix the dangling edge.`,
        `- [edge.dangling] ${CLEARED_TARGET} — fix the dangling edge.`,
        `- [theme.duplicate] ${UNKNOWN_TARGET} — merge into baz.md, the richer survivor.`,
        '',
      ].join('\n'),
    );

    const artifact = deriveSessionArtifact({
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [fixtureFinding('edge.dangling', join(forgeRoot, OPEN_TARGET))],
      cleanupScan: { forgeRoot, brainDir },
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupScan: { forgeRoot: string; brainDir: string } }) as {
      actions: Array<{ target: string; state: string }>;
      openFindingCount: number;
    };

    assert.equal(artifact.actions.length, 3);
    const byTarget = new Map(artifact.actions.map((a) => [a.target, a.state]));
    assert.equal(byTarget.get(OPEN_TARGET), 'open', 'the action WITH a matching live finding must be open');
    assert.equal(byTarget.get(CLEARED_TARGET), 'cleared', 'the sibling action inside brainDir with NO matching finding must be cleared');
    assert.equal(byTarget.get(UNKNOWN_TARGET), 'unknown', 'the sibling action outside brainDir with NO matching finding must be unknown');
    assert.equal(
      artifact.openFindingCount,
      1,
      'openFindingCount must count ONLY the state==="open" action — an implementation that collapses the three states, or computes the count as "not cleared" (which would wrongly include the unknown action too, giving 2), fails this',
    );
  });

  it('R4-19-F2 SCAN-5 ("cleared" never overrides a real match): an action inside brainDir WITH a matching live finding stays "open" even though cleanupScan is supplied', () => {
    const { sessionDir, forgeRoot, brainDir } = buildClearedFixture();
    const artifact = deriveSessionArtifact({
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [fixtureFinding('edge.dangling', join(forgeRoot, CLEARED_TARGET_RELATIVE))],
      cleanupScan: { forgeRoot, brainDir },
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupScan: { forgeRoot: string; brainDir: string } }) as {
      actions: Array<{ target: string; state: string }>;
      openFindingCount: number;
    };

    assert.equal(artifact.actions.length, 1);
    assert.equal(
      artifact.actions[0]!.state,
      'open',
      'a genuine match must win over the "cleared" derivation — an implementation with a precedence inversion (e.g. checking cleanupScan/brainDir-containment BEFORE checking for a matching finding, so "inside the scanned region" short-circuits straight to "cleared") would wrongly report "cleared" here',
    );
    assert.equal(artifact.openFindingCount, 1);
  });

  it('R4-19-F2 SCAN-6 (containment sanity on brainDir — the repo\'s recurring escape shape): a target that textually starts with the brainDir STRING but does not actually resolve inside it must NOT be treated as inside — neither via a literal ".." escape nor a sibling-directory prefix collision', () => {
    const forgeRoot = makeTmpDir('cleanupplan-scan6-root-');
    const brainDir = join(forgeRoot, 'brain', 'forge-dev');
    mkdirSync(brainDir, { recursive: true });

    // Shape 1: `<brainDir>/../elsewhere/x.md` — an ALREADY-ABSOLUTE target
    // (mirrors NORM-2's already-absolute branch, above) whose RAW string
    // textually starts with brainDir, but whose ".." segment, once resolved,
    // lands one level OUTSIDE brainDir (in a sibling "elsewhere" directory
    // under the same parent, brainDir's own ".." — never itself a symlink;
    // this is pure "..''-in-the-string" escape, distinct from AT-6's
    // symlink-escape concern).
    const elsewhereDir = join(forgeRoot, 'brain', 'elsewhere');
    mkdirSync(elsewhereDir, { recursive: true });
    writeFileSync(join(elsewhereDir, 'x.md'), '# elsewhere\n', 'utf8');
    const dotDotEscapeTarget = `${brainDir}/../elsewhere/x.md`;
    assert.ok(
      dotDotEscapeTarget.startsWith(brainDir),
      'arrange: the RAW target must textually start with brainDir — that raw prefix match is exactly what makes a naive (unresolved) containment check wrong',
    );

    // Shape 2: `<brainDir>-sibling/x.md` — a genuinely SIBLING directory
    // (same parent as brainDir, name collision on the prefix only: "…
    // forge-dev-sibling" textually starts with "…forge-dev") that is never
    // nested inside brainDir.
    const siblingDir = `${brainDir}-sibling`;
    mkdirSync(siblingDir, { recursive: true });
    writeFileSync(join(siblingDir, 'x.md'), '# sibling\n', 'utf8');
    const siblingCollisionTarget = `${siblingDir}/x.md`;
    assert.ok(
      siblingCollisionTarget.startsWith(brainDir),
      'arrange: the RAW target must textually start with brainDir — a bare `startsWith(brainDir)` with no trailing-separator guard would wrongly match this sibling-directory collision',
    );

    const sessionDir = makeTmpDir('cleanupplan-scan6-session-');
    writeCleanupPlanFile(
      sessionDir,
      [
        `- [edge.dangling] ${dotDotEscapeTarget} — fix the dangling edge.`,
        `- [edge.dangling] ${siblingCollisionTarget} — fix the dangling edge.`,
        '',
      ].join('\n'),
    );

    const artifact = deriveSessionArtifact({
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [],
      cleanupScan: { forgeRoot, brainDir },
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupScan: { forgeRoot: string; brainDir: string } }) as {
      actions: Array<{ target: string; state: string }>;
    };

    assert.equal(artifact.actions.length, 2);
    const byTarget = new Map(artifact.actions.map((a) => [a.target, a.state]));
    assert.equal(
      byTarget.get(dotDotEscapeTarget),
      'unknown',
      'the ".."-escaping target must be "unknown", not "cleared" — a `target.startsWith(brainDir)` check performed on the UNRESOLVED raw string (never normalizing/resolving the ".." segment first) would wrongly treat this as inside brainDir',
    );
    assert.equal(
      byTarget.get(siblingCollisionTarget),
      'unknown',
      'the sibling-directory target must be "unknown", not "cleared" — a `startsWith(brainDir)` check with no trailing-separator guard (i.e. not `startsWith(brainDir + sep)`, mirroring this very module\'s own safeReadFileInSession containment idiom) would wrongly treat this string-prefix collision as inside brainDir',
    );
  });
});

// ===========================================================================
// W7-C2 (sessions-kinds-29) — verdicts.json: the durable rationale record.
// Every operator verdict (approve/reject/revise) appends {at, verdict,
// notes?} to the session dir's verdicts.json (written by the generic
// affordance write route, cli/bridge-studio-affordances.ts, only after a
// 2xx); deriveSessionTranscript renders each record as an OPERATOR turn so a
// reject is never invisible in the record. Fail-closed like answers.json: a
// malformed verdicts.json errors, never fabricates or drops turns silently.
// W7-C2 T1 review (P0-2): a revise record now carries its OWN `feedback`
// words, because feedback.md is transient (each revise overwrites it, and the
// consuming turn deletes it) and could therefore only ever hold the NEWEST
// round. Records are ordered by their `at` stamp (A13).
// ===========================================================================

describe('W7-C2 — verdicts.json renders operator verdict turns', () => {
  it('C2-V1: a reject record with notes renders one operator turn carrying the verdict AND the rationale', () => {
    const sessionDir = makeTmpDir('c2-verdicts-1-');
    writeFileSync(join(sessionDir, 'verdicts.json'), JSON.stringify([
      { at: '2026-08-21T10:00:00.000Z', verdict: 'reject', notes: 'Too broad — split the roadmap first.' },
    ]));
    const turns = okTurns(deriveSessionTranscript({ descriptor: instructionsDescriptor(), sessionDir, phase: 'rejected' }));
    const verdictTurns = turns.filter((t) => t.source.startsWith('verdicts.json'));
    assert.equal(verdictTurns.length, 1);
    assert.equal(verdictTurns[0].role, 'operator');
    assert.match(verdictTurns[0].text, /reject/i);
    assert.match(verdictTurns[0].text, /Too broad — split the roadmap first\./);
  });

  it('C2-V2: a revise record renders the decision turn WITHOUT duplicating feedback.md (whose own turn still renders)', () => {
    const sessionDir = makeTmpDir('c2-verdicts-2-');
    writeFileSync(join(sessionDir, 'feedback.md'), 'Tighten the intro section.');
    writeFileSync(join(sessionDir, 'verdicts.json'), JSON.stringify([
      { at: '2026-08-21T10:00:00.000Z', verdict: 'revise' },
    ]));
    const turns = okTurns(deriveSessionTranscript({ descriptor: instructionsDescriptor(), sessionDir, phase: 'drafting' }));
    const feedbackTurns = turns.filter((t) => t.source === 'feedback.md');
    const verdictTurns = turns.filter((t) => t.source.startsWith('verdicts.json'));
    assert.equal(feedbackTurns.length, 1, 'feedback.md keeps its own turn');
    assert.equal(verdictTurns.length, 1);
    assert.match(verdictTurns[0].text, /revise/i);
    assert.ok(!verdictTurns[0].text.includes('Tighten the intro section.'), 'the revise record must not duplicate the feedback text');
  });

  it('C2-V3: approve without notes renders the bare decision', () => {
    const sessionDir = makeTmpDir('c2-verdicts-3-');
    writeFileSync(join(sessionDir, 'verdicts.json'), JSON.stringify([
      { at: '2026-08-21T10:00:00.000Z', verdict: 'approve' },
    ]));
    const turns = okTurns(deriveSessionTranscript({ descriptor: instructionsDescriptor(), sessionDir, phase: 'committed' }));
    const verdictTurns = turns.filter((t) => t.source.startsWith('verdicts.json'));
    assert.equal(verdictTurns.length, 1);
    assert.match(verdictTurns[0].text, /approve/i);
  });

  it('C2-V4: a malformed verdicts.json (non-array) fails CLOSED — {ok:false} naming the file, never fabricated turns', () => {
    const sessionDir = makeTmpDir('c2-verdicts-4-');
    writeFileSync(join(sessionDir, 'verdicts.json'), JSON.stringify({ verdict: 'approve' }));
    const result = deriveSessionTranscript({ descriptor: instructionsDescriptor(), sessionDir, phase: 'committed' }) as { ok: boolean; error?: { message: string } };
    assert.equal(result.ok, false);
    assert.match(result.error!.message, /verdicts\.json/);
  });

  it('C2-V5: a record whose "verdict" is not a string fails CLOSED', () => {
    const sessionDir = makeTmpDir('c2-verdicts-5-');
    writeFileSync(join(sessionDir, 'verdicts.json'), JSON.stringify([{ at: 'x', verdict: 42 }]));
    const result = deriveSessionTranscript({ descriptor: instructionsDescriptor(), sessionDir, phase: 'committed' }) as { ok: boolean; error?: { message: string } };
    assert.equal(result.ok, false);
    assert.match(result.error!.message, /verdicts\.json/);
  });

  // W7-C2 T1 review (P0-2 / F1) — the multi-round case the shipped suite
  // could not see: C2-V1..V5 only ever write ONE record. A revise
  // OVERWRITES feedback.md, so once round 2 lands, round 1's rationale is
  // recoverable from nowhere unless the record itself carries it.
  it('C2-V6: TWO revise rounds each render their OWN words — round 1\'s rationale is still in the transcript after round 2 overwrote feedback.md', () => {
    const sessionDir = makeTmpDir('c2-verdicts-6-');
    writeFileSync(join(sessionDir, 'feedback.md'), 'Actually make it red.');
    writeFileSync(join(sessionDir, 'verdicts.json'), JSON.stringify([
      { at: '2026-08-21T10:00:00.000Z', verdict: 'revise', feedback: 'Make the button blue.' },
      { at: '2026-08-21T11:00:00.000Z', verdict: 'revise', feedback: 'Actually make it red.' },
    ]));
    const turns = okTurns(deriveSessionTranscript({ descriptor: instructionsDescriptor(), sessionDir, phase: 'drafting' }));
    const verdictTurns = turns.filter((t) => t.source.startsWith('verdicts.json'));
    assert.equal(verdictTurns.length, 2);
    assert.ok(verdictTurns[0].text.includes('Make the button blue.'), `round 1's words must survive: ${verdictTurns[0].text}`);
    assert.ok(verdictTurns[1].text.includes('Actually make it red.'), `round 2's words must render: ${verdictTurns[1].text}`);
  });

  // W7-C2 T1 review (A13) — `at` was stamped by the writer and read by
  // nobody, so records rendered in write order no matter when the decisions
  // were made.
  it('C2-V7: verdict turns are ordered by `at`, not by position in the file', () => {
    const sessionDir = makeTmpDir('c2-verdicts-7-');
    writeFileSync(join(sessionDir, 'verdicts.json'), JSON.stringify([
      { at: '2026-08-21T12:00:00.000Z', verdict: 'approve', notes: 'later' },
      { at: '2026-08-21T09:00:00.000Z', verdict: 'revise', notes: 'earlier' },
    ]));
    const turns = okTurns(deriveSessionTranscript({ descriptor: instructionsDescriptor(), sessionDir, phase: 'committed' }));
    const verdictTurns = turns.filter((t) => t.source.startsWith('verdicts.json'));
    assert.ok(verdictTurns[0].text.includes('earlier'), `the 09:00 decision must render first: ${JSON.stringify(verdictTurns.map((t) => t.text))}`);
    assert.ok(verdictTurns[1].text.includes('later'));
    assert.equal(verdictTurns[0].source, 'verdicts.json#2', 'source names the record\'s position IN THE FILE, so a reader can go find it');
  });

  it('C2-V8: a record with no `at` fails CLOSED — the ordering key is required, never defaulted to write order', () => {
    const sessionDir = makeTmpDir('c2-verdicts-8-');
    writeFileSync(join(sessionDir, 'verdicts.json'), JSON.stringify([{ verdict: 'approve' }]));
    const result = deriveSessionTranscript({ descriptor: instructionsDescriptor(), sessionDir, phase: 'committed' }) as { ok: boolean; error?: { message: string } };
    assert.equal(result.ok, false);
    assert.match(result.error!.message, /"at"/);
  });

  it('C2-V9: a non-string `feedback` fails CLOSED (same discipline as `notes`)', () => {
    const sessionDir = makeTmpDir('c2-verdicts-9-');
    writeFileSync(join(sessionDir, 'verdicts.json'), JSON.stringify([{ at: '2026-08-21T10:00:00.000Z', verdict: 'revise', feedback: 42 }]));
    const result = deriveSessionTranscript({ descriptor: instructionsDescriptor(), sessionDir, phase: 'drafting' }) as { ok: boolean; error?: { message: string } };
    assert.equal(result.ok, false);
    assert.match(result.error!.message, /feedback/);
  });
});

// ===========================================================================
// W8-B3 (operator note ON-5) — `sourcesFound`, and the blank-opener rule.
//
// The wire used to carry `transcript: descriptor.turnSpec === undefined`
// (cli/bridge-studio-sessions.ts) as a per-kind proxy for "does this kind
// record turns". It was a stored copy of a fact this module already knows, and
// it was WRONG for `authoring` — that kind declares a `turnSpec`, yet its start
// route (`writeAuthoringSession`, cli/ui-bridge.ts) writes `prompt.md` before
// the generic spine ever runs, so the proxy claimed "no turns" for a kind that
// has one from second zero. `sourcesFound` replaces it with the derived fact.
// ===========================================================================

describe('deriveSessionTranscript — W8-B3 sourcesFound + blank-opener rule (ON-5)', () => {
  it('W8-B3: sourcesFound reports exactly the candidate sources that EXIST, in scan order — never the whole scanned list', () => {
    const dir = makeTmpDir('b3-sources-found');
    writeFileSync(join(dir, 'idea.md'), 'ship the thing');
    writeJson(dir, 'verdicts.json', [{ at: '2026-08-23T00:00:00.000Z', verdict: 'approve' }]);

    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir: dir, phase: 'awaiting-verdict' });
    assert.ok(result.ok);
    assert.deepEqual([...result.sourcesFound], ['idea.md', 'verdicts.json']);
    // The scanned list is unchanged and still names everything looked for, so
    // "scanned 6, found 2" stays a readable, honest report.
    assert.ok(result.sourcesScanned.length > result.sourcesFound.length);
    for (const found of result.sourcesFound) assert.ok(result.sourcesScanned.includes(found));
  });

    it('W8-B3: sourcesFound is [] for a session dir holding none of the candidates — the kb-cleanup / community-refresh shape before any verdict', () => {
    const dir = makeTmpDir('b3-sources-none');
    writeFileSync(join(dir, 'status.json'), '{"phase":"drafting"}');
    const result = deriveSessionTranscript({ descriptor: authoringDescriptor(), sessionDir: dir, phase: 'drafting' });
    assert.ok(result.ok);
    assert.deepEqual([...result.sourcesFound], []);
    assert.equal(result.turns.length, 0);
  });

    it('W8-B3: a BLANK prompt.md produces NO turn (never an empty operator bubble), while still being reported as a source that exists', () => {
    // Live shape, not invented: `/api/project-brain/brief`, `/api/instructions/
    // brief` and `/api/demo-builder/brief` all write `body.brief ?? ''`, so an
    // operator who skips the optional brief lands a zero-byte prompt.md.
    for (const body of ['', '   \n\t  \n']) {
      const dir = makeTmpDir('b3-blank-prompt');
      writeFileSync(join(dir, 'prompt.md'), body);
      const result = deriveSessionTranscript({ descriptor: projectBrainDescriptor(), sessionDir: dir, phase: 'analyzing' });
      assert.ok(result.ok);
      assert.equal(result.turns.length, 0, `blank prompt.md (${JSON.stringify(body)}) must not manufacture a turn`);
      assert.deepEqual([...result.sourcesFound], ['prompt.md'], 'the file really is there — presence is not the same as content');
    }
  });

    it('W8-B3: a prompt.md with real content still produces exactly one operator turn (the blank rule must not swallow real briefs)', () => {
    const dir = makeTmpDir('b3-real-prompt');
    writeFileSync(join(dir, 'prompt.md'), 'emphasise the build/test conventions');
    const result = deriveSessionTranscript({ descriptor: projectBrainDescriptor(), sessionDir: dir, phase: 'analyzing' });
    assert.ok(result.ok);
    assert.equal(result.turns.length, 1);
    assert.equal(result.turns[0].role, 'operator');
    assert.equal(result.turns[0].source, 'prompt.md');
    assert.equal(result.turns[0].text, 'emphasise the build/test conventions');
  });
});
