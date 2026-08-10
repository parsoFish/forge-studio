/**
 * Derives a typed chat transcript + artifact payload from a real on-disk
 * session dir (R2-10, PR1: the session-shell backend contract).
 *
 * Core principle (binding): NOTHING may be invented. There is no chat
 * transcript on disk — every turn is DERIVED from a real file and carries a
 * `source` naming that file (and round). `sourcesScanned` names every file
 * the derivation looked for, so an empty transcript reads "scanned N
 * sources, none found" — never "unknown, rendered empty".
 *
 * Derivation is FILE-PRESENCE-DRIVEN, not descriptor.id-driven: it always
 * scans the same fixed candidate list (idea.md, prompt.md, answers.json,
 * questions.json, feedback.md) and reacts to whichever exist. This is what
 * makes the shell generic AND what makes project-brain's transcript
 * honestly ONE turn fall out naturally — its runner
 * (project-brain-builder-runner.ts) never writes answers.json/
 * questions.json/feedback.md; there is no interview for that kind.
 *
 * Real on-disk shapes (verified against source, not guessed):
 *   - answers.json = AnswerRound[] (orchestrator/interactive-session.ts:303).
 *     Each round's answers[].question recovers that round's AGENT turn;
 *     answers[].answer is the OPERATOR turn. Both turns of a round share the
 *     source `answers.json#round-N`.
 *   - questions.json = InterviewQuestion[] (interactive-session.ts:292). A
 *     PENDING agent turn only when unanswered — see "questions.json
 *     pending-detection" below for how "unanswered" is derived.
 *   - architect dir: idea.md, answers.json, questions.json, feedback.md,
 *     manifests/*.md.
 *   - instructions dir: prompt.md, answers.json, questions.json, feedback.md,
 *     AGENTS.draft.md.
 *   - project-brain dir: prompt.md, themes/*.md. No interview at all.
 *
 * Stage carrying (ratified T2 decision — the forward contract R4-17 rides):
 * an AnswerRound MAY carry an optional `stage` key. Present ⇒ that round's
 * two turns take it; absent ⇒ descriptor.defaultStage (a DECLARED value,
 * never hardcoded here). A stage marker outside descriptor.stages fails
 * CLOSED — {ok:false}, naming the offending value and the allowed set  —
 * never defaults, never drops the turn, never returns ok:true.
 *
 * questions.json pending-detection (AT-amendment-2, T2-ratified — supersedes
 * an earlier exact-text set-difference design): a `questions.json` entry
 * contributes a PENDING agent turn iff the caller's real `phase` is exactly
 * `AWAITING_ANSWERS_PHASE` — the interview-handoff contract both
 * architect-runner.ts and instructions-runner.ts write to `status.json`
 * while blocked on the operator (see the questions.json ↔ answers.json
 * handoff documented at orchestrator/interactive-session.ts's "Interview
 * handoff" section). Any other phase means questions.json (if present) is
 * stale leftover from a prior round and contributes NO turn, regardless of
 * its text — text-based re-ask detection silently dropped a legitimately
 * re-asked verbatim question, which is the defect this supersedes.
 *
 * Accepted residual (read-only, self-healing, NOT fixed): `cli/ui-bridge.ts`
 * (~lines 1592-1596) writes `answers.json` then `status.json` as two separate
 * writes, not one atomic transaction. A crash between them leaves
 * `status.json` at `phase: 'awaiting-answers'` even though the round was
 * already answered, so this phase-driven check renders the just-answered
 * question as pending a SECOND time on the next read. Cosmetic (the operator
 * sees a stale pending question, not corrupted data) and self-healing (the
 * next real answer round overwrites it correctly). Deliberately not fixed
 * here: closing it would require `deriveSessionTranscript` to grow a `round`
 * parameter (or equivalent) purely to detect a narrow crash-window artifact,
 * widening this module's contract for a residual with no data-integrity
 * consequence.
 *
 * Malformed answers.json (not an array / a round missing "answers" /
 * "answers" not an array / a non-string question or answer) fails CLOSED —
 * {ok:false}. Never a partial parse, never a skip-and-continue turn.
 *
 * Traversal: neither deriveSessionTranscript nor deriveSessionArtifact may
 * read outside sessionDir. A lexical `startsWith(dir + sep)` check on a
 * symlink's OWN path is NOT sufficient (the symlink itself always lives
 * inside sessionDir) — `realpathSync` at the single choke point every file
 * read goes through (`safeReadFileInSession`) blocks every SYMLINK escape.
 *
 * Honest limit: realpath containment does NOT stop a HARDLINKED file — a
 * hardlink has no separate target to resolve away from (it IS the same inode
 * as the file it "points at"), so realpathSync on it returns its own
 * in-session path and the check passes. This is accepted, not fixed:
 * creating a hardlink inside a session dir requires the same local write
 * access to that dir as writing the outside content into the file directly,
 * so the vector adds essentially nothing over an attacker who can already
 * write into the session dir — an nlink check would be theatre with a real
 * false-positive surface (nlink > 1 is not inherently malicious) for
 * negligible added protection.
 *
 * Second honest limit, same trust tier (TOCTOU): `safeReadFileInSession` (and
 * the matching subdirectory guard in `listDirEntries`) calls `realpathSync`
 * and then a separate `readFileSync`/`readdirSync` — two syscalls on one
 * path, not one atomic operation. An attacker able to swap a symlink's
 * target in the gap between those two calls (e.g. `abs` resolves inside
 * sessionDir at check-time, then gets re-pointed outside before the read)
 * defeats containment. This is accepted, not fixed, on the same basis as the
 * hardlink residual above: it requires the same local write access inside
 * the session dir that would let an attacker write the outside content into
 * the session directly, so closing it (e.g. `open()` + `fstat` to read via a
 * held file descriptor instead of re-resolving the path) buys negligible
 * additional protection for real implementation cost — disclosed, not closed.
 */

import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, sep } from 'node:path';

import { parseManifest } from '../manifest.ts';
import { MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES } from './skill-library.ts';
import type { PackageFile } from './skill-library.ts';
import { sessionArtifactKindState, type SessionKindDescriptor, type SessionStage } from './session-kinds.ts';

// ---------------------------------------------------------------------------
// Named constants (no hardcoded values scattered through the derivation)
// ---------------------------------------------------------------------------

const IDEA_FILENAME = 'idea.md';
const PROMPT_FILENAME = 'prompt.md';
const ANSWERS_FILENAME = 'answers.json';
const QUESTIONS_FILENAME = 'questions.json';
const FEEDBACK_FILENAME = 'feedback.md';
/** The instructions-runner's draft filename (orchestrator/instructions-runner.ts
 *  `DRAFT_FILENAME`, currently 'AGENTS.draft.md'). Deliberately re-declared as
 *  its own constant here rather than imported: instructions-runner.ts pulls in
 *  the live SDK query chain (pinned-sdk-query.ts) at module top level, and this
 *  module is a pure, fs-only derivation with no business importing a live
 *  runner for a single filename string. Flagged in the T3 report for T2 to
 *  ratify or hoist to a shared leaf constant. */
const AGENTS_DRAFT_FILENAME = 'AGENTS.draft.md';
const MANIFESTS_DIRNAME = 'manifests';
const THEMES_DIRNAME = 'themes';

/** The phase token the questions/answers interview handoff uses while
 *  blocked on the operator — written to status.json by both
 *  architect-runner.ts and instructions-runner.ts (see
 *  orchestrator/interactive-session.ts's "Interview handoff" section). A
 *  questions.json entry is a pending agent turn iff the caller's real phase
 *  equals this constant; any other phase means questions.json is stale. */
const AWAITING_ANSWERS_PHASE = 'awaiting-answers';

/** The fixed candidate list every derivation scans, regardless of
 *  descriptor — file-presence-driven, never descriptor.id-driven. */
const CANDIDATE_SOURCE_FILES = [IDEA_FILENAME, PROMPT_FILENAME, ANSWERS_FILENAME, QUESTIONS_FILENAME, FEEDBACK_FILENAME] as const;

// ---------------------------------------------------------------------------
// Traversal choke point — every file read in this module goes through this
// one function. realpathSync resolves SYMLINKS; a target that resolves
// outside sessionDir is treated as absent (never surfaced), which is
// indistinguishable from "missing" to every caller — exactly what the
// file-presence-driven contract wants. Honest limit: this does NOT block a
// HARDLINKED file (no separate target to resolve away from) — accepted, not
// fixed; see the module header for why.
// ---------------------------------------------------------------------------

export function safeReadFileInSession(sessionDir: string, relPath: string): string | null {
  const abs = join(sessionDir, relPath);
  let realSessionDir: string;
  try {
    realSessionDir = realpathSync(sessionDir);
  } catch {
    return null; // sessionDir itself doesn't exist / unreadable
  }
  let realAbs: string;
  try {
    realAbs = realpathSync(abs);
  } catch {
    return null; // missing file, broken symlink, or unreadable path segment
  }
  if (realAbs !== realSessionDir && !realAbs.startsWith(realSessionDir + sep)) {
    return null; // escapes sessionDir via a symlink — treated as absent, never returned
  }
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

/** Lists a subdirectory's entries filtered by extension, sorted by filename.
 *  A missing directory yields []. Entry CONTENT safety (symlink escape) is
 *  enforced later, per-file, by safeReadFileInSession — that guard alone
 *  does NOT cover this function: if the subdirectory itself (`manifests/` or
 *  `themes/`) is a symlink to an outside directory, `readdirSync` follows it
 *  and returns the OUTSIDE directory's real entry names/count — observable
 *  even when every individual file read is later blocked, because a caller
 *  (deriveRoadmapDraft's `sourcesScanned`) reports the raw entry COUNT before
 *  any per-file containment check runs (AT-amendment-3, A2 / AT-68, AT-69).
 *  This function therefore realpath-contains the subdirectory itself, at the
 *  same choke-point pattern as `safeReadFileInSession`: a `manifests/` or
 *  `themes/` that resolves outside `sessionDir` is treated as absent (empty
 *  listing) rather than followed. With that guard, this function leaks
 *  neither names nor a derived count from outside `sessionDir` — only entry
 *  NAMES from within a directory proven to be contained; entry CONTENT
 *  safety remains safeReadFileInSession's job when each name is later read. */
function listDirEntries(sessionDir: string, dirRel: string, extension: string): string[] {
  const abs = join(sessionDir, dirRel);
  let realSessionDir: string;
  try {
    realSessionDir = realpathSync(sessionDir);
  } catch {
    return []; // sessionDir itself doesn't exist / unreadable
  }
  let realAbs: string;
  try {
    realAbs = realpathSync(abs);
  } catch {
    return []; // missing subdirectory, broken symlink, or unreadable path segment
  }
  if (realAbs !== realSessionDir && !realAbs.startsWith(realSessionDir + sep)) {
    return []; // subdirectory escapes sessionDir via a symlink — treated as absent, never followed
  }
  let names: string[];
  try {
    names = readdirSync(abs);
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith(extension)).sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// deriveSessionTranscript
// ---------------------------------------------------------------------------

export type SessionTurnRole = 'agent' | 'operator';

export type SessionTurn = {
  readonly index: number;
  readonly role: SessionTurnRole;
  readonly stage: SessionStage;
  readonly text: string;
  readonly source: string;
};

export type DeriveTranscriptResult =
  | { readonly ok: true; readonly turns: readonly SessionTurn[]; readonly sourcesScanned: readonly string[] }
  | { readonly ok: false; readonly error: { readonly message: string } };

type ParsedAnswer = { readonly question: string; readonly answer: string };
type ParsedRound = { readonly round: number; readonly stage?: string; readonly answers: readonly ParsedAnswer[] };
type ParseOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

/** answers.json is fail-closed on ANY shape violation, at any level — see
 *  header. Never a partial parse, never a silently-dropped round. */
function parseAnswerRoundsJson(raw: string): ParseOutcome<ParsedRound[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, message: `${ANSWERS_FILENAME} is not valid JSON — ${(e as Error).message}` };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, message: `${ANSWERS_FILENAME} must be a JSON array of rounds, got ${typeof parsed}` };
  }
  const rounds: ParsedRound[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const r = parsed[i];
    if (r === null || typeof r !== 'object' || Array.isArray(r)) {
      return { ok: false, message: `${ANSWERS_FILENAME} round[${i}] must be an object, got ${Array.isArray(r) ? 'array' : typeof r}` };
    }
    const rec = r as Record<string, unknown>;
    if (!('answers' in rec) || !Array.isArray(rec.answers)) {
      return { ok: false, message: `${ANSWERS_FILENAME} round[${i}] is missing a valid "answers" array` };
    }
    if (rec.stage !== undefined && typeof rec.stage !== 'string') {
      return { ok: false, message: `${ANSWERS_FILENAME} round[${i}] "stage" must be a string when present, got ${typeof rec.stage}` };
    }
    const answers: ParsedAnswer[] = [];
    for (let j = 0; j < rec.answers.length; j++) {
      const a = rec.answers[j];
      if (a === null || typeof a !== 'object' || Array.isArray(a)) {
        return { ok: false, message: `${ANSWERS_FILENAME} round[${i}].answers[${j}] must be an object` };
      }
      const arec = a as Record<string, unknown>;
      if (typeof arec.question !== 'string') {
        return { ok: false, message: `${ANSWERS_FILENAME} round[${i}].answers[${j}].question must be a string, got ${typeof arec.question}` };
      }
      if (typeof arec.answer !== 'string') {
        return { ok: false, message: `${ANSWERS_FILENAME} round[${i}].answers[${j}].answer must be a string, got ${typeof arec.answer}` };
      }
      answers.push({ question: arec.question, answer: arec.answer });
    }
    const round = typeof rec.round === 'number' ? rec.round : i + 1;
    const stage = typeof rec.stage === 'string' ? rec.stage : undefined;
    rounds.push({ round, ...(stage !== undefined ? { stage } : {}), answers });
  }
  return { ok: true, value: rounds };
}

type ParsedQuestion = { readonly question: string };

/** questions.json — fails closed on the same principle as answers.json
 *  (not tested by an explicit AT, but "never fabricate" applies equally: a
 *  malformed pending-question file must never surface an invented turn). */
function parseQuestionsJson(raw: string): ParseOutcome<ParsedQuestion[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, message: `${QUESTIONS_FILENAME} is not valid JSON — ${(e as Error).message}` };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, message: `${QUESTIONS_FILENAME} must be a JSON array of questions, got ${typeof parsed}` };
  }
  const questions: ParsedQuestion[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const q = parsed[i];
    const question = q !== null && typeof q === 'object' && !Array.isArray(q) ? (q as Record<string, unknown>).question : undefined;
    if (typeof question !== 'string') {
      return { ok: false, message: `${QUESTIONS_FILENAME}[${i}] must be an object with a string "question" field` };
    }
    questions.push({ question });
  }
  return { ok: true, value: questions };
}

/**
 * Derives the transcript for a real session dir. See module header for the
 * ordering contract, stage-carrying rule, and fail-closed shapes.
 */
export function deriveSessionTranscript(input: { descriptor: SessionKindDescriptor; sessionDir: string; phase: string }): DeriveTranscriptResult {
  const { descriptor, sessionDir, phase } = input;
  const turns: SessionTurn[] = [];
  let index = 0;

  const resolveStage = (raw: string | undefined): ParseOutcome<SessionStage> => {
    const stage = raw ?? descriptor.defaultStage;
    if (!descriptor.stages.includes(stage)) {
      return {
        ok: false,
        message: `stage "${stage}" is not a member of this session kind's declared stages [${descriptor.stages.join(', ')}]`,
      };
    }
    return { ok: true, value: stage as SessionStage };
  };

  // idea.md / prompt.md — the opening operator turn. Real runners write at
  // most one of the two; both are scanned unconditionally (file-presence,
  // never descriptor.id-driven).
  for (const filename of [IDEA_FILENAME, PROMPT_FILENAME] as const) {
    const body = safeReadFileInSession(sessionDir, filename);
    if (body === null) continue;
    const staged = resolveStage(undefined);
    if (!staged.ok) return { ok: false, error: { message: staged.message } };
    turns.push({ index: index++, role: 'operator', stage: staged.value, text: body, source: filename });
  }

  // answers.json — each round: an AGENT turn (the question) then an
  // OPERATOR turn (the answer), sharing `answers.json#round-N`.
  const answersRaw = safeReadFileInSession(sessionDir, ANSWERS_FILENAME);
  let rounds: readonly ParsedRound[] = [];
  if (answersRaw !== null) {
    const parsed = parseAnswerRoundsJson(answersRaw);
    if (!parsed.ok) return { ok: false, error: { message: parsed.message } };
    rounds = parsed.value;
  }
  for (const round of rounds) {
    const staged = resolveStage(round.stage);
    if (!staged.ok) return { ok: false, error: { message: staged.message } };
    const source = `${ANSWERS_FILENAME}#round-${round.round}`;
    for (const a of round.answers) {
      turns.push({ index: index++, role: 'agent', stage: staged.value, text: a.question, source });
      turns.push({ index: index++, role: 'operator', stage: staged.value, text: a.answer, source });
    }
  }

  // questions.json — a PENDING agent turn IFF phase === AWAITING_ANSWERS_PHASE
  // (AT-amendment-2, T2-ratified). Any other phase ⇒ questions.json (if
  // present) is stale leftover from a prior round and contributes no turn,
  // regardless of its text — see the module header for the full contract.
  const questionsRaw = safeReadFileInSession(sessionDir, QUESTIONS_FILENAME);
  if (questionsRaw !== null) {
    const parsedQ = parseQuestionsJson(questionsRaw);
    if (!parsedQ.ok) return { ok: false, error: { message: parsedQ.message } };
    if (phase === AWAITING_ANSWERS_PHASE && parsedQ.value.length > 0) {
      const staged = resolveStage(undefined);
      if (!staged.ok) return { ok: false, error: { message: staged.message } };
      turns.push({
        index: index++,
        role: 'agent',
        stage: staged.value,
        text: parsedQ.value.map((q) => q.question).join('\n\n'),
        source: QUESTIONS_FILENAME,
      });
    }
  }

  // feedback.md — an honest single operator turn (the revision note between
  // draft rounds).
  const feedbackBody = safeReadFileInSession(sessionDir, FEEDBACK_FILENAME);
  if (feedbackBody !== null) {
    const staged = resolveStage(undefined);
    if (!staged.ok) return { ok: false, error: { message: staged.message } };
    turns.push({ index: index++, role: 'operator', stage: staged.value, text: feedbackBody, source: FEEDBACK_FILENAME });
  }

  return { ok: true, turns, sourcesScanned: CANDIDATE_SOURCE_FILES };
}

// ---------------------------------------------------------------------------
// deriveSessionArtifact
// ---------------------------------------------------------------------------

export type RoadmapDraftRow = {
  readonly initiativeId: string;
  readonly project: string;
  readonly phase: string;
  readonly origin: string;
  // Mutable element array (not `readonly string[]`) — same rationale as
  // RoadmapDraftArtifact.rows below: the pinned AT idiom casts the derived
  // artifact to a plain `{ rows: Array<{ ...; dependsOn: string[] }> }`
  // shape, and a `readonly string[]` is never assignable to a mutable
  // `string[]` target.
  //
  // Sourced verbatim from the manifest's `depends_on_initiatives`
  // (orchestrator/manifest.ts:73, already parsed by `parseManifest`) —
  // absent on the manifest ⇒ `[]`, never undefined and never dropped from
  // the row. This field is DERIVED, never fabricated: it is exactly what
  // the manifest declares, in declared order, with no filtering,
  // de-duplication, or re-sorting at this layer.
  //
  // Resolving an edge against this session's OWN draft row set (which
  // dependency ids are "real" vs. dangling) is deliberately NOT this
  // layer's job — it is the VIEW layer's (forge-ui/lib/dependency-dag.ts's
  // `dependencyDagView`). An edge pointing at an initiative outside the
  // draft set (e.g. one that already merged before this architect session
  // started) is real information the operator needs to see, not noise to
  // be silently dropped here.
  readonly dependsOn: string[];
};

export type RoadmapDraftArtifact = {
  readonly kind: 'roadmap-draft';
  /** The session-kind descriptor's declared `artifact.label`
   *  (studio/session-kinds.yaml), threaded through verbatim — never
   *  re-derived or defaulted here. See `deriveSessionArtifact`. */
  readonly label: string;
  // Mutable element arrays (not `readonly T[]`) — deliberately, so a direct
  // `as { rows: Array<...>; sourcesScanned: string[] }` cast (the pinned AT
  // idiom in session-transcript.test.ts) type-checks: a `readonly T[]` is
  // never assignable to a mutable `T[]` target, which is a real TS
  // constraint, not a laxness. The exported *properties* stay non-reassignable
  // (no `readonly` array TYPE, but callers still get a fresh object per call —
  // immutability is preserved by never mutating an already-returned array).
  readonly rows: RoadmapDraftRow[];
  readonly sourcesScanned: string[];
};

export type MarkdownDraftArtifact = {
  readonly kind: 'markdown-draft';
  /** The session-kind descriptor's declared `artifact.label` — see
   *  RoadmapDraftArtifact.label. */
  readonly label: string;
  /** null = no draft file at all; '' = an existing-but-empty draft (AT-32). */
  readonly body: string | null;
  readonly hasDraft: boolean;
};

export type BrainStructureArtifact = {
  readonly kind: 'brain-structure';
  /** The session-kind descriptor's declared `artifact.label` — see
   *  RoadmapDraftArtifact.label. */
  readonly label: string;
  readonly themeCount: number;
  // Mutable element array — see the identical rationale on RoadmapDraftArtifact.rows.
  readonly files: PackageFile[];
};

export type GenerationGalleryItem = {
  readonly path: string;
  readonly kind: 'html' | 'markdown' | 'file';
  /** The byte length of the content actually READ from disk — never a number
   *  copied from meta.json (R4-16 AT-14: a plausible-but-wrong metadata hint
   *  must never leak through). */
  readonly bytes: number;
};

export type GenerationGalleryEntry = {
  /** Sourced from the snapshot's OWN meta.json `iteration` — never array or
   *  directory position (R4-16 AT-10). A generation whose meta.json is
   *  missing/unreadable/unparsable/missing-or-mistyped-iteration contributes
   *  NO entry, leaving a visible gap rather than a renumbered sequence. */
  readonly number: number;
  readonly createdAt: string;
  readonly feedback: string | null;
  readonly targetElement: string | null;
  // Mutable element array — same rationale as RoadmapDraftArtifact.rows: the
  // pinned AT idiom casts the derived artifact to a plain mutable-array
  // shape, and a `readonly T[]` is never assignable to a mutable `T[]` target.
  readonly items: GenerationGalleryItem[];
};

export type GenerationGalleryArtifact = {
  readonly kind: 'generation-gallery';
  /** The session-kind descriptor's declared `artifact.label` — see
   *  RoadmapDraftArtifact.label. */
  readonly label: string;
  // Mutable element array — see RoadmapDraftArtifact.rows.
  readonly generations: GenerationGalleryEntry[];
  readonly sourcesScanned: string[];
};

// ---------------------------------------------------------------------------
// contract-buildout (R4-17) — presence-only rows for the onboarding session's
// five stages. D4 (binding): this module's "may not read outside sessionDir"
// invariant is NOT relaxed for this kind — it performs ZERO filesystem work
// here, full stop. The real derivation (`deriveContractStages`) lives in
// `cli/contract-stages.ts`, which reads the PROJECT tree (outside any
// sessionDir) via its own realpath-guarded containment; this module only
// threads ALREADY-DERIVED, already-guarded rows the caller (cli/bridge-studio-
// sessions.ts) supplies, and throws when they are absent — never a silently
// empty/defaulted artifact (see `deriveSessionArtifact`'s `contract-buildout`
// case below).
//
// `ContractStageRow`/`ContractBuildoutArtifact` are declared HERE, not in
// `cli/contract-stages.ts`, so the ONE type has ONE canonical owner and
// `cli/contract-stages.ts` imports it from here — the same direction that
// file already needs for `safeReadFileInSession` and `SESSION_STAGES`
// (`session-kinds.ts`), so this adds no new import direction and creates no
// cycle (verified: `orchestrator/` already imports plain VALUES from `cli/`
// in ~30 files today, e.g. `orchestrator/manifest.ts` -> `cli/manifest-path-
// guard.ts`, so a `cli/` -> `orchestrator/` type import here is the
// established direction, not a reversal).
// ---------------------------------------------------------------------------

/** Presence, never a verdict (D11) — `forge preflight`'s exit code is the
 *  only authoritative contract-green signal; a row says "this artifact is
 *  present/absent, here is its source", never "this clause passes". */
export type ContractStageStatus = 'present' | 'absent';

/** The five onboarding stages — SESSION_STAGES minus 'brain' (project-brain
 *  owns that stage; D2). */
export type ContractStage = Exclude<SessionStage, 'brain'>;

export type ContractStageRow = {
  readonly stage: ContractStage;
  readonly status: ContractStageStatus;
  /** Which real on-disk artifact this row's presence answer is about — named
   *  even when `status` is 'absent' (a dropped row is indistinguishable from
   *  "we never looked"; naming the source at least says "we looked here"). */
  readonly source: string;
  /** Presence facts only (D11) — never verdict language ("pass"/"fail"/
   *  "clause"/"green"/"red"/"compliant"). */
  readonly detail: string[];
  /** The real byte length read from disk for the two prose-file-backed
   *  stages (`instructions`, `roadmap`); `null` for the three config/lock-
   *  JSON-backed stages (`contract`, `secrets`, `demo`). */
  readonly bytes: number | null;
};

export type ContractBuildoutArtifact = {
  readonly kind: 'contract-buildout';
  /** The session-kind descriptor's declared `artifact.label` — see
   *  RoadmapDraftArtifact.label. */
  readonly label: string;
  /** Threaded VERBATIM from the caller — never re-derived, re-sorted, or
   *  filtered here (D4). */
  readonly stages: ContractStageRow[];
  readonly sourcesScanned: string[];
};

// ---------------------------------------------------------------------------
// file-package (R4-21) — the creation-agent authoring session's accumulating
// draft skill/hook package. Reads the session dir's own `staging/`
// subdirectory (a DEDICATED subdirectory, never the bare session root — see
// this module's shared `manifests/`/`themes/` per-kind-subdirectory
// convention, mirrored exactly here, so a creation-agent session's
// accumulating draft package can never collide with the fixed
// CANDIDATE_SOURCE_FILES transcript scan every session dir is unconditionally
// scanned against regardless of kind). Reuses the SAME realpath-guarded
// choke points (`safeReadFileInSession`/`listDirEntries`) every other
// derivation in this module already goes through — no new fs call path.
//
// R4-21 phase 2, WI-1, D2 (_wave5/unit-specs/R4-21-phase2.md): this
// subdirectory was named `package/` in R4-21 phase 1, predating ADR-043
// (docs/decisions/043-generic-interactive-surface.md §1), whose ratified
// `turnSpec` table declares `writes: [staging]`. Renamed here to match the
// ratified data rather than parameterising the finalizer. The rename is
// COMPLETE, not additive — a leftover `package/` dir is never scanned, not
// even as a fallback (RED-2f, session-transcript.test.ts).
// ---------------------------------------------------------------------------

const PACKAGE_DIRNAME = 'staging';

export type FilePackageArtifact = {
  readonly kind: 'file-package';
  /** The session-kind descriptor's declared `artifact.label` — see
   *  RoadmapDraftArtifact.label. */
  readonly label: string;
  // Mutable element array — see RoadmapDraftArtifact.rows for the identical
  // rationale (the pinned AT idiom casts to a plain mutable-array shape).
  readonly files: PackageFile[];
};

/** Same realpath-containment guard as `listDirEntries`, but returns typed
 *  `Dirent[]` (not just filtered names) so `walkPackageFiles` can tell a
 *  real subdirectory from a file/symlink/other WITHOUT a second stat call.
 *  A directory that escapes `sessionDir` via a symlink (or doesn't exist)
 *  yields `[]` — exactly `listDirEntries`'s contract, just with entry TYPE
 *  preserved. Sorted by name for deterministic output. Not a replacement
 *  for `listDirEntries` (every other derivation in this module keeps using
 *  that flat, extension-filtered scan unchanged) — this is `staging/`'s own
 *  recursive-walk primitive (R4-21 BLOCKER-1 fix, see `walkPackageFiles`). */
function listDirEntriesTyped(sessionDir: string, dirRel: string): Dirent[] {
  const abs = join(sessionDir, dirRel);
  let realSessionDir: string;
  try {
    realSessionDir = realpathSync(sessionDir);
  } catch {
    return []; // sessionDir itself doesn't exist / unreadable
  }
  let realAbs: string;
  try {
    realAbs = realpathSync(abs);
  } catch {
    return []; // missing subdirectory, broken symlink, or unreadable path segment
  }
  if (realAbs !== realSessionDir && !realAbs.startsWith(realSessionDir + sep)) {
    return []; // this directory (or a symlink to it) escapes sessionDir — treated as absent, never followed
  }
  try {
    return readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** Recursively walks `staging/` (and every REAL subdirectory beneath it),
 *  appending each file found into `out` with a path RELATIVE TO `staging/`,
 *  POSIX-separated (`PackageFile.path` convention — e.g. `scripts/run.sh`,
 *  matching `installSkillPackage`/`readSkillPackage`'s own recursive-walk
 *  path shape in skill-library.ts).
 *
 *  R4-21 BLOCKER-1 fix: the previous flat, single-level scan
 *  (`listDirEntries(sessionDir, 'package', '')` + per-name
 *  `safeReadFileInSession`) called `readFileSync` on every top-level
 *  `staging/` entry NAME unconditionally — including a DIRECTORY entry
 *  (e.g. `scripts/`, written by a hook draft alongside `hook.yaml` per
 *  skills/creation-agent/SKILL.md). `readFileSync` on a directory throws
 *  EISDIR, caught by the existing try/catch, and the entry was dropped
 *  SILENTLY — indistinguishable from a blocked symlink escape
 *  (declared-data-fails-open: a real, non-malicious nested file vanished
 *  with no signal). This walk instead uses `listDirEntriesTyped` to check
 *  each entry's TYPE before deciding what to do with it:
 *
 *    - A real directory entry (`entry.isDirectory()`) is DESCENDED, never
 *      read-as-file.
 *    - Every other entry kind — a plain file, a symlink of ANY kind
 *      (`fs.Dirent`'s type check is on the raw dirent, so a symlink is
 *      never `isDirectory()`/`isFile()` — it is its own third category),
 *      or any exotic dirent type — is attempted ONLY through
 *      `safeReadFileInSession`, this module's one realpath-guarded read
 *      choke point. A symlink escaping `sessionDir` (to a file OR a
 *      directory) resolves outside, is treated as absent by that guard,
 *      and contributes no file — it is never descended into either,
 *      preserving the module's existing "escaping entry ⇒ never surfaced"
 *      contract at every depth, not just the top level. A symlink pointing
 *      at an IN-BOUNDS directory also contributes nothing (`readFileSync`
 *      on it still throws EISDIR, caught, dropped) — a deliberately
 *      conservative choice: this walk never follows a symlink to descend
 *      into a directory, only a real one.
 *
 *  Bounded by the SAME `MAX_PACKAGE_FILES`/`MAX_PACKAGE_BYTES` caps
 *  `installSkillPackage` validates against at INSTALL time
 *  (skill-library.ts) — reused here as a soft READ-side bound, not a
 *  validation gate: once either limit is reached the walk simply stops
 *  collecting further files (never throws, never fabricates a truncation
 *  marker) rather than rendering an unbounded tree from a runaway/
 *  malicious session dir. `totalBytes` is a boxed counter (not a return
 *  value) purely so every recursive call shares the same running total. */
function walkPackageFiles(sessionDir: string, dirRelToSession: string, dirRelToPackage: string, out: PackageFile[], totalBytes: { value: number }): void {
  if (out.length >= MAX_PACKAGE_FILES || totalBytes.value >= MAX_PACKAGE_BYTES) return;
  const entries = listDirEntriesTyped(sessionDir, dirRelToSession);
  for (const entry of entries) {
    if (out.length >= MAX_PACKAGE_FILES || totalBytes.value >= MAX_PACKAGE_BYTES) return;
    const childRelToSession = join(dirRelToSession, entry.name);
    const childRelToPackage = dirRelToPackage ? `${dirRelToPackage}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walkPackageFiles(sessionDir, childRelToSession, childRelToPackage, out, totalBytes);
      continue;
    }
    const body = safeReadFileInSession(sessionDir, childRelToSession);
    if (body === null) continue; // missing/escaped/unreadable (incl. EISDIR on a symlinked dir) — never surfaced
    const bytes = Buffer.byteLength(body, 'utf8');
    if (totalBytes.value + bytes > MAX_PACKAGE_BYTES) return; // would exceed the cap — stop walking
    totalBytes.value += bytes;
    out.push({ path: childRelToPackage, body });
  }
}

/** `staging/` — recursively walks every real file under the session dir's
 *  `staging/` subdirectory (a package may legitimately carry SKILL.md,
 *  reference.md, scripts/run.sh, ...) via `walkPackageFiles` (R4-21
 *  BLOCKER-1 fix — see that function's header for the nested-file defect
 *  this replaces and the containment/DoS-bound contract it preserves). An
 *  escaping symlinked entry (file, OR a subdirectory at any depth)
 *  contributes NO file — never surfaced — while a real, non-symlinked
 *  sibling still reads normally, at every depth (the guard discriminates,
 *  it does not just refuse to read anything). */
function deriveFilePackage(sessionDir: string, label: string): FilePackageArtifact {
  const files: PackageFile[] = [];
  walkPackageFiles(sessionDir, PACKAGE_DIRNAME, '', files, { value: 0 });
  return { kind: 'file-package', label, files };
}

export type SessionArtifactPayload =
  | RoadmapDraftArtifact
  | MarkdownDraftArtifact
  | BrainStructureArtifact
  | GenerationGalleryArtifact
  | ContractBuildoutArtifact
  | FilePackageArtifact;

function deriveRoadmapDraft(sessionDir: string, label: string): RoadmapDraftArtifact {
  const files = listDirEntries(sessionDir, MANIFESTS_DIRNAME, '.md');
  const rows: RoadmapDraftRow[] = [];
  for (const file of files) {
    const body = safeReadFileInSession(sessionDir, join(MANIFESTS_DIRNAME, file));
    if (body === null) continue; // missing/escaped entry — never surfaced
    let manifest;
    try {
      manifest = parseManifest(body);
    } catch {
      continue; // an unparsable manifest contributes no row; never fabricated
    }
    rows.push({
      initiativeId: manifest.initiative_id,
      project: manifest.project,
      phase: manifest.phase,
      origin: manifest.origin,
      // Verbatim, never filtered/sorted/de-duplicated here — see the field's
      // doc comment on RoadmapDraftRow.
      dependsOn: manifest.depends_on_initiatives ?? [],
    });
  }
  return {
    kind: 'roadmap-draft',
    label,
    rows,
    sourcesScanned: [`${MANIFESTS_DIRNAME}/*.md (${files.length} file(s) found)`],
  };
}

function deriveMarkdownDraft(sessionDir: string, label: string): MarkdownDraftArtifact {
  const body = safeReadFileInSession(sessionDir, AGENTS_DRAFT_FILENAME);
  return { kind: 'markdown-draft', label, body, hasDraft: body !== null };
}

function deriveBrainStructure(sessionDir: string, label: string): BrainStructureArtifact {
  const files = listDirEntries(sessionDir, THEMES_DIRNAME, '.md');
  const packageFiles: PackageFile[] = [];
  for (const file of files) {
    const body = safeReadFileInSession(sessionDir, join(THEMES_DIRNAME, file));
    if (body === null) continue; // missing/escaped entry — never surfaced
    packageFiles.push({ path: `${THEMES_DIRNAME}/${file}`, body });
  }
  return { kind: 'brain-structure', label, themeCount: packageFiles.length, files: packageFiles };
}

const GENERATIONS_DIRNAME = 'generations';
const GENERATION_META_FILENAME = 'meta.json';

function kindForGalleryItemFilename(name: string): 'html' | 'markdown' | 'file' {
  if (name.endsWith('.html')) return 'html';
  if (name.endsWith('.md')) return 'markdown';
  return 'file';
}

type ParsedGenerationMeta = {
  readonly iteration: number;
  readonly createdAt: string;
  readonly feedback: string | null;
  readonly targetElement: string | null;
};

/** Parses one generation's meta.json — fails CLOSED (returns null) on ANY
 *  shape violation the R4-16 contract cares about: not JSON, or a missing /
 *  non-numeric "iteration". A generation whose meta.json fails this parse
 *  contributes NO row — never a fabricated one, and never a renumbered
 *  successor (R4-16 AT-11/AT-12). `createdAt`/`feedback`/`targetElement` are
 *  written by the runner under our own control (demo-builder-runner.ts) so
 *  they're read defensively (coerced to a safe default on the wrong type)
 *  rather than failing the whole generation — only `iteration` is load-bearing
 *  for numbering/ordering. */
function parseGenerationMeta(raw: string): ParsedGenerationMeta | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.iteration !== 'number') return null;
  return {
    iteration: rec.iteration,
    createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : '',
    feedback: typeof rec.feedback === 'string' ? rec.feedback : null,
    targetElement: typeof rec.targetElement === 'string' ? rec.targetElement : null,
  };
}

/** `generations/<n>/` — see the module header for the shared realpath
 *  containment contract (`safeReadFileInSession`/`listDirEntries`); this
 *  derivation adds NO new fs call path, reusing both choke points exactly
 *  like `deriveRoadmapDraft`/`deriveBrainStructure` do for `manifests/`/
 *  `themes/`. `listDirEntries(sessionDir, dir, '')` lists every entry — see
 *  that function's header for why an empty extension is universally matching. */
function deriveGenerationGallery(sessionDir: string, label: string): GenerationGalleryArtifact {
  const dirNames = listDirEntries(sessionDir, GENERATIONS_DIRNAME, '');
  const generations: GenerationGalleryEntry[] = [];

  for (const dirName of dirNames) {
    const metaRel = join(GENERATIONS_DIRNAME, dirName, GENERATION_META_FILENAME);
    const metaRaw = safeReadFileInSession(sessionDir, metaRel);
    if (metaRaw === null) continue; // missing / unreadable / escaped — never fabricated
    const meta = parseGenerationMeta(metaRaw);
    if (meta === null) continue; // not JSON / missing or mistyped iteration — a visible gap

    const entryNames = listDirEntries(sessionDir, join(GENERATIONS_DIRNAME, dirName), '');
    const items: GenerationGalleryItem[] = [];
    for (const name of entryNames) {
      if (name === GENERATION_META_FILENAME) continue; // metadata, not gallery content
      const body = safeReadFileInSession(sessionDir, join(GENERATIONS_DIRNAME, dirName, name));
      if (body === null) continue; // missing/escaped entry (e.g. a symlinked item) — never surfaced
      items.push({ path: name, kind: kindForGalleryItemFilename(name), bytes: Buffer.byteLength(body, 'utf8') });
    }
    // listDirEntries sorts with localeCompare (locale-aware — case-insensitive
    // under the default locale), but the pinned contract here is plain
    // filename (code-unit) order — re-sort explicitly rather than trust
    // listDirEntries's sort verbatim (checked, not assumed, per the task brief).
    items.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    generations.push({
      number: meta.iteration,
      createdAt: meta.createdAt,
      feedback: meta.feedback,
      targetElement: meta.targetElement,
      items,
    });
  }
  generations.sort((a, b) => a.number - b.number);

  return {
    kind: 'generation-gallery',
    label,
    generations,
    // Mirrors deriveRoadmapDraft's exact idiom: names what was scanned
    // INCLUDING the count found, so an empty gallery reads "scanned N, found
    // none" rather than a bare, unexplained empty pane.
    sourcesScanned: [`${GENERATIONS_DIRNAME}/*/${GENERATION_META_FILENAME} (${dirNames.length} file(s) found)`],
  };
}

/**
 * Derives the artifact payload for a session's LIVE renderer kind. Throws
 * for a reserved (or otherwise unrecognised) artifact kind, naming it — zero
 * stub renderers exist anywhere for the reserved rows.
 *
 * `label` is sourced from `descriptor.artifact.label` (studio/session-kinds.
 * yaml, via SessionKindDescriptor) and threaded straight into whichever
 * artifact shape is derived — never re-derived from `kind` or defaulted.
 * This is the single place the label is attached: the label lives on the
 * descriptor, which every deriver already receives, so there is exactly one
 * copy of "kind → label" (the YAML) rather than a second lookup here or at
 * the route (cli/bridge-studio-sessions.ts), which forwards this artifact
 * object unchanged into the 200 response.
 */
export function deriveSessionArtifact(input: {
  descriptor: SessionKindDescriptor;
  sessionDir: string;
  /** R4-17 — only consumed by the 'contract-buildout' kind; see that case
   *  below and the module-header note on D4. Ignored for every other kind. */
  contractStages?: ContractStageRow[];
}): SessionArtifactPayload {
  const { descriptor, sessionDir, contractStages } = input;
  const kind = descriptor.artifact.kind;
  const label = descriptor.artifact.label;
  const state = sessionArtifactKindState(kind);

  if (state === 'reserved') {
    throw new Error(`deriveSessionArtifact: artifact kind "${kind}" is reserved — no renderer has been implemented for it anywhere`);
  }
  if (state === undefined) {
    throw new Error(`deriveSessionArtifact: artifact kind "${kind}" is not a recognised session-artifact kind`);
  }

  switch (kind) {
    case 'roadmap-draft':
      return deriveRoadmapDraft(sessionDir, label);
    case 'markdown-draft':
      return deriveMarkdownDraft(sessionDir, label);
    case 'brain-structure':
      return deriveBrainStructure(sessionDir, label);
    case 'generation-gallery':
      return deriveGenerationGallery(sessionDir, label);
    case 'file-package':
      return deriveFilePackage(sessionDir, label);
    case 'contract-buildout': {
      // D4: zero filesystem work here — `sessionDir` is not even touched
      // (AT-3 pins a non-existent sessionDir has no effect on the result).
      if (contractStages === undefined) {
        throw new Error(
          'deriveSessionArtifact: artifact kind "contract-buildout" requires contractStages to be supplied by the caller ' +
            '(cli/bridge-studio-sessions.ts derives them via cli/contract-stages.ts\'s deriveContractStages) — never defaults to an empty/silent artifact',
        );
      }
      return {
        kind: 'contract-buildout',
        label,
        stages: contractStages,
        sourcesScanned: ['contractStages supplied by the caller (cli/contract-stages.ts) — this module performs no filesystem scanning for this kind (D4)'],
      };
    }
    default: {
      // Exhaustiveness guard: state === 'live' but the kind matched none of
      // the three known live renderers — only reachable if SESSION_ARTIFACT_KINDS
      // gains a new live row without a matching case here.
      throw new Error(`deriveSessionArtifact: unhandled live artifact kind "${kind}" — no renderer wired for it in session-transcript.ts`);
    }
  }
}
