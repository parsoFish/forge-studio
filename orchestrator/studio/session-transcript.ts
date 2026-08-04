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
 */

import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';

import { parseManifest } from '../manifest.ts';
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
 *  enforced later, per-file, by safeReadFileInSession — this only lists
 *  names, which leaks nothing. */
function listDirEntries(sessionDir: string, dirRel: string, extension: string): string[] {
  const abs = join(sessionDir, dirRel);
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
};

export type RoadmapDraftArtifact = {
  readonly kind: 'roadmap-draft';
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
  /** null = no draft file at all; '' = an existing-but-empty draft (AT-32). */
  readonly body: string | null;
  readonly hasDraft: boolean;
};

export type BrainStructureArtifact = {
  readonly kind: 'brain-structure';
  readonly themeCount: number;
  // Mutable element array — see the identical rationale on RoadmapDraftArtifact.rows.
  readonly files: PackageFile[];
};

export type SessionArtifactPayload = RoadmapDraftArtifact | MarkdownDraftArtifact | BrainStructureArtifact;

function deriveRoadmapDraft(sessionDir: string): RoadmapDraftArtifact {
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
    rows.push({ initiativeId: manifest.initiative_id, project: manifest.project, phase: manifest.phase, origin: manifest.origin });
  }
  return {
    kind: 'roadmap-draft',
    rows,
    sourcesScanned: [`${MANIFESTS_DIRNAME}/*.md (${files.length} file(s) found)`],
  };
}

function deriveMarkdownDraft(sessionDir: string): MarkdownDraftArtifact {
  const body = safeReadFileInSession(sessionDir, AGENTS_DRAFT_FILENAME);
  return { kind: 'markdown-draft', body, hasDraft: body !== null };
}

function deriveBrainStructure(sessionDir: string): BrainStructureArtifact {
  const files = listDirEntries(sessionDir, THEMES_DIRNAME, '.md');
  const packageFiles: PackageFile[] = [];
  for (const file of files) {
    const body = safeReadFileInSession(sessionDir, join(THEMES_DIRNAME, file));
    if (body === null) continue; // missing/escaped entry — never surfaced
    packageFiles.push({ path: `${THEMES_DIRNAME}/${file}`, body });
  }
  return { kind: 'brain-structure', themeCount: packageFiles.length, files: packageFiles };
}

/**
 * Derives the artifact payload for a session's LIVE renderer kind. Throws
 * for a reserved (or otherwise unrecognised) artifact kind, naming it — zero
 * stub renderers exist anywhere for the reserved rows.
 */
export function deriveSessionArtifact(input: { descriptor: SessionKindDescriptor; sessionDir: string }): SessionArtifactPayload {
  const { descriptor, sessionDir } = input;
  const kind = descriptor.artifact.kind;
  const state = sessionArtifactKindState(kind);

  if (state === 'reserved') {
    throw new Error(`deriveSessionArtifact: artifact kind "${kind}" is reserved — no renderer has been implemented for it anywhere`);
  }
  if (state === undefined) {
    throw new Error(`deriveSessionArtifact: artifact kind "${kind}" is not a recognised session-artifact kind`);
  }

  switch (kind) {
    case 'roadmap-draft':
      return deriveRoadmapDraft(sessionDir);
    case 'markdown-draft':
      return deriveMarkdownDraft(sessionDir);
    case 'brain-structure':
      return deriveBrainStructure(sessionDir);
    default: {
      // Exhaustiveness guard: state === 'live' but the kind matched none of
      // the three known live renderers — only reachable if SESSION_ARTIFACT_KINDS
      // gains a new live row without a matching case here.
      throw new Error(`deriveSessionArtifact: unhandled live artifact kind "${kind}" — no renderer wired for it in session-transcript.ts`);
    }
  }
}
