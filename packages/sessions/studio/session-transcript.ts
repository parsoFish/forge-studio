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
 * (kinds/project-brain.ts) never writes answers.json/
 * questions.json/feedback.md; there is no interview for that kind.
 *
 * Real on-disk shapes (verified against source, not guessed):
 *   - answers.json = AnswerRound[] (packages/sessions/interactive-session.ts:303).
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
 * kinds/architect.ts and kinds/instructions.ts write to `status.json`
 * while blocked on the operator (see the questions.json ↔ answers.json
 * handoff documented at packages/sessions/interactive-session.ts's "Interview
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

import {
  deriveBrainStructure,
  deriveCleanupPlan,
  deriveFilePackage,
  deriveGenerationGallery,
  deriveMarkdownDraft,
  listDirEntries,
  safeReadFileInSession,
  type CleanupFinding,
  type CleanupScan,
  type ContractStageRow,
  type SessionArtifactPayload,
} from './session-artifact-derivers.ts';
/** The artifact vocabulary `deriveSessionArtifact` (below) returns. It is this
 *  module's own signature, so it is exported from here as well as from where it
 *  is declared — not a shim: a function's module owns its return type. */
export {
  safeReadFileInSession,
  type CleanupFinding,
  type CleanupScan,
  type CleanupPlanAction,
  type ContractStage,
  type ContractStageRow,
  type ContractStageStatus,
  type SessionArtifactPayload,
} from './session-artifact-derivers.ts';


import { sessionArtifactKindState, type SessionKindDescriptor, type SessionStage } from './session-kinds.ts';

// ---------------------------------------------------------------------------
// Named constants (no hardcoded values scattered through the derivation)
// ---------------------------------------------------------------------------

const IDEA_FILENAME = 'idea.md';
const PROMPT_FILENAME = 'prompt.md';
const ANSWERS_FILENAME = 'answers.json';
const QUESTIONS_FILENAME = 'questions.json';
const FEEDBACK_FILENAME = 'feedback.md';
/** The instructions kind's draft filename (`kinds/instructions.ts`
 *  `DRAFT_FILENAME`, 'AGENTS.draft.md'). Re-declared rather than imported: that
 *  module pulls the live SDK query chain in at load, and this one is a pure
 *  fs-only derivation with no business importing a runner for one string. */

/** The phase token the questions/answers interview handoff uses while
 *  blocked on the operator — written to status.json by both
 *  kinds/architect.ts and kinds/instructions.ts (see
 *  packages/sessions/interactive-session.ts's "Interview handoff" section). A
 *  questions.json entry is a pending agent turn iff the caller's real phase
 *  equals this constant; any other phase means questions.json is stale. */
const AWAITING_ANSWERS_PHASE = 'awaiting-answers';

/** W7-C2 (sessions-kinds-29) — the durable operator-verdict record: the
 *  generic affordance write route (cli/bridge-studio-affordances.ts) appends
 *  `{at, verdict, notes?}` here after every ACCEPTED verdict, so a reject/
 *  approve (and its rationale) is never invisible in the transcript. The
 *  revise verdict's feedback text is deliberately NOT copied into a record —
 *  feedback.md already renders its own operator turn; the revise record is
 *  the bare decision. */
const VERDICTS_FILENAME = 'verdicts.json';

/** The fixed candidate list every derivation scans, regardless of
 *  descriptor — file-presence-driven, never descriptor.id-driven. */
const CANDIDATE_SOURCE_FILES = [IDEA_FILENAME, PROMPT_FILENAME, ANSWERS_FILENAME, QUESTIONS_FILENAME, FEEDBACK_FILENAME, VERDICTS_FILENAME] as const;

// ---------------------------------------------------------------------------
// Traversal choke point — every file read in this module goes through this
// one function. realpathSync resolves SYMLINKS; a target that resolves
// outside sessionDir is treated as absent (never surfaced), which is
// indistinguishable from "missing" to every caller — exactly what the
// file-presence-driven contract wants. Honest limit: this does NOT block a
// HARDLINKED file (no separate target to resolve away from) — accepted, not
// fixed; see the module header for why.
// ---------------------------------------------------------------------------

// Ruling 83's row-5 split moved the roadmap-draft artifact to
// `./roadmap-draft.ts`; the three types are RE-EXPORTED, not repointed, because
// ten files name them (see `../design.md`).
export type { ParseManifestPort, RoadmapDraftRow, RoadmapDraftArtifact } from './roadmap-draft.ts';
import { deriveRoadmapDraft } from './roadmap-draft.ts';
import type { ParseManifestPort } from './roadmap-draft.ts';


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
  | {
      readonly ok: true;
      readonly turns: readonly SessionTurn[];
      readonly sourcesScanned: readonly string[];
      /** W8-B3 (ON-5) — the subset of `sourcesScanned` that ACTUALLY EXISTS in
       *  this session dir, in scan order. `sourcesScanned` alone can only ever
       *  say "we looked"; this says what was found, so a caller can decide
       *  whether a transcript pane belongs on the page WITHOUT keeping its own
       *  per-kind guess about which kinds record turns.
       *
       *  This replaces the wire's old `transcript: descriptor.turnSpec ===
       *  undefined` boolean (packages/sessions/bridge-studio-sessions.ts), which was a
       *  STORED PROXY and factually wrong: `authoring` declares a `turnSpec`
       *  yet its start route (`writeAuthoringSession`, cli/ui-bridge.ts)
       *  writes `prompt.md` before the generic spine ever runs, so the proxy
       *  claimed "records no turns" for a kind that records one from second
       *  zero. Derived from the same reads that build `turns` — there is no
       *  field anywhere for a writer to leave a stale copy in. */
      readonly sourcesFound: readonly string[];
    }
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

type ParsedVerdictRecord = {
  readonly at: string;
  readonly verdict: string;
  readonly notes?: string;
  readonly feedback?: string;
};

/** verdicts.json — fails closed on the same principle as answers.json (a
 *  malformed verdict record must never surface an invented turn, and must
 *  never be silently dropped either). Shape: an array of records each
 *  carrying a string `at` (W7-C2 T1 review, A13 — REQUIRED, and now
 *  actually READ: the records are ordered by it below, so an
 *  out-of-sequence file renders chronologically instead of in write order)
 *  and a string `verdict`; `notes` and `feedback` optional (string when
 *  present). `feedback` is the revise round's OWN words (W7-C2 T1 review,
 *  P0-2) — feedback.md holds only the CURRENT pending note and is
 *  overwritten by each revise, so it could never carry round 1's rationale
 *  once round 2 landed. */
function parseVerdictsJson(raw: string): ParseOutcome<ParsedVerdictRecord[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, message: `${VERDICTS_FILENAME} is not valid JSON — ${(e as Error).message}` };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, message: `${VERDICTS_FILENAME} must be a JSON array of verdict records, got ${typeof parsed}` };
  }
  const records: ParsedVerdictRecord[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const r = parsed[i];
    if (r === null || typeof r !== 'object' || Array.isArray(r)) {
      return { ok: false, message: `${VERDICTS_FILENAME} record[${i}] must be an object, got ${Array.isArray(r) ? 'array' : typeof r}` };
    }
    const rec = r as Record<string, unknown>;
    if (typeof rec.verdict !== 'string') {
      return { ok: false, message: `${VERDICTS_FILENAME} record[${i}] must carry a string "verdict" field` };
    }
    if (typeof rec.at !== 'string' || rec.at.length === 0) {
      return { ok: false, message: `${VERDICTS_FILENAME} record[${i}] must carry a non-empty string "at" timestamp` };
    }
    if ('notes' in rec && rec.notes !== undefined && typeof rec.notes !== 'string') {
      return { ok: false, message: `${VERDICTS_FILENAME} record[${i}] has a non-string "notes" field` };
    }
    if ('feedback' in rec && rec.feedback !== undefined && typeof rec.feedback !== 'string') {
      return { ok: false, message: `${VERDICTS_FILENAME} record[${i}] has a non-string "feedback" field` };
    }
    records.push({
      at: rec.at,
      verdict: rec.verdict,
      ...(typeof rec.notes === 'string' ? { notes: rec.notes } : {}),
      ...(typeof rec.feedback === 'string' ? { feedback: rec.feedback } : {}),
    });
  }
  return { ok: true, value: records };
}

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
  const sourcesFound: string[] = [];
  let index = 0;

  /** The ONE read every candidate goes through, so `sourcesFound` cannot
   *  drift from what was actually read (a second, hand-kept existence check
   *  would be exactly the stale-copy shape this field exists to remove). */
  const readCandidate = (filename: string): string | null => {
    const body = safeReadFileInSession(sessionDir, filename);
    if (body !== null) sourcesFound.push(filename);
    return body;
  };

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
    const body = readCandidate(filename);
    if (body === null) continue;
    // W8-B3 (ON-5) — a BLANK opener is not a turn. Three real brief routes
    // (`/api/project-brain/brief`, `/api/instructions/brief`,
    // `/api/demo-builder/brief`, cli/ui-bridge.ts) write `body.brief ?? ''`,
    // so an operator who skips the optional brief gets a zero-byte
    // `prompt.md` — which rendered as an EMPTY operator bubble in the
    // transcript. The file is still reported in `sourcesFound` (it really is
    // there); it just does not manufacture a turn out of nothing, which is
    // this module's binding "NOTHING may be invented" rule applied to the
    // empty string. Measured on real code, not hypothesised: probing
    // project-brain with a blank brief produced `turns=1 text=""`.
    if (body.trim().length === 0) continue;
    const staged = resolveStage(undefined);
    if (!staged.ok) return { ok: false, error: { message: staged.message } };
    turns.push({ index: index++, role: 'operator', stage: staged.value, text: body, source: filename });
  }

  // answers.json — each round: an AGENT turn (the question) then an
  // OPERATOR turn (the answer), sharing `answers.json#round-N`.
  const answersRaw = readCandidate(ANSWERS_FILENAME);
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
  const questionsRaw = readCandidate(QUESTIONS_FILENAME);
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

  // feedback.md — an honest single operator turn: the CURRENT, not-yet-
  // consumed revision note. W7-C2 T1 review (P0-2): this file is transient
  // by design — each revise overwrites it and the next agent turn CONSUMES
  // it (packages/sessions/interactive-runner.ts deletes it once it has been
  // folded into a prompt), so it can only ever hold the newest round's
  // words. The DURABLE per-round record is verdicts.json's own `feedback`
  // field, rendered below.
  const feedbackBody = readCandidate(FEEDBACK_FILENAME);

  // verdicts.json (W7-C2, sessions-kinds-29) — one operator turn per
  // recorded decision: "Verdict: <verdict>" plus the rationale when one was
  // given, plus (W7-C2 T1 review, P0-2) that round's OWN revise words.
  //
  // Ordered by `at` (W7-C2 T1 review, A13 — the field was stamped and never
  // read, so a multi-round file rendered in write order regardless of when
  // the decisions were actually made). Sorting is LEXICOGRAPHIC, which is
  // chronological for the ISO-8601 stamps `appendVerdictRecord` writes, and
  // STABLE, so two records sharing a stamp keep their file order. Cross-
  // SOURCE chronology is deliberately NOT attempted: idea.md / answers.json /
  // questions.json / feedback.md carry no timestamps at all, so interleaving
  // them would mean inventing an order — the verdict block stays a block,
  // internally chronological, appended after the untimestamped sources.
  //
  // `#<n>` in `source` is the record's POSITION IN THE FILE (1-based), not
  // its display position — it names the durable record a reader can go find.
  const verdictsRaw = readCandidate(VERDICTS_FILENAME);
  let verdictRecords: readonly ParsedVerdictRecord[] = [];
  if (verdictsRaw !== null) {
    const parsedV = parseVerdictsJson(verdictsRaw);
    if (!parsedV.ok) return { ok: false, error: { message: parsedV.message } };
    verdictRecords = parsedV.value;
  }

  // W8-B3 (sessions-kinds-R05) — the same revise instruction was rendered
  // TWICE: once as a bare operator turn from `feedback.md`, then again inside
  // "Verdict: revise <the identical text>" from the durable verdicts.json
  // record the SAME write created. Every revise round doubled the transcript
  // and an operator re-reading their own history saw each instruction twice.
  //
  // Derived, not de-duplicated by guesswork: the feedback.md turn is dropped
  // only when a verdict record verifiably CARRIES that exact text, so the
  // record shows it with its decision. If no record carries it — a
  // feedback.md written by any path that did not also append a verdict — the
  // turn still renders, because dropping it would lose the operator's words.
  //
  // The `.trim().length > 0` arm is the same blank-source rule the opener
  // above applies, for the same reason: an empty file is not a turn, and
  // rendering one produced a blank operator bubble.
  //
  // ORDERING NOTE: reading verdicts.json before PUSHING the feedback turn does
  // not move either turn. The pushes still happen in the same order (feedback,
  // then the verdict block), so `index` numbering is unchanged wherever the
  // feedback turn survives — and where it is suppressed the indices are one
  // shorter, which is exactly right, because there is one fewer turn.
  if (feedbackBody !== null && feedbackBody.trim().length > 0) {
    const carriedByAVerdict = verdictRecords.some(
      (r) => r.feedback !== undefined && r.feedback.trim() === feedbackBody.trim(),
    );
    if (!carriedByAVerdict) {
      const staged = resolveStage(undefined);
      if (!staged.ok) return { ok: false, error: { message: staged.message } };
      turns.push({ index: index++, role: 'operator', stage: staged.value, text: feedbackBody, source: FEEDBACK_FILENAME });
    }
  }

  if (verdictRecords.length > 0) {
    const staged = resolveStage(undefined);
    if (!staged.ok) return { ok: false, error: { message: staged.message } };
    const ordered = verdictRecords
      .map((record, position) => ({ record, position }))
      .sort((a, b) => (a.record.at < b.record.at ? -1 : a.record.at > b.record.at ? 1 : a.position - b.position));
    for (const { record, position } of ordered) {
      const headline = record.notes !== undefined && record.notes.length > 0
        ? `Verdict: ${record.verdict} — ${record.notes}`
        : `Verdict: ${record.verdict}`;
      const text = record.feedback !== undefined && record.feedback.length > 0
        ? `${headline}\n\n${record.feedback}`
        : headline;
      turns.push({ index: index++, role: 'operator', stage: staged.value, text, source: `${VERDICTS_FILENAME}#${position + 1}` });
    }
  }

  return { ok: true, turns, sourcesScanned: CANDIDATE_SOURCE_FILES, sourcesFound };
}

// ---------------------------------------------------------------------------
// deriveSessionArtifact
// ---------------------------------------------------------------------------


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
 * the route (packages/sessions/bridge-studio-sessions.ts), which forwards this artifact
 * object unchanged into the 200 response.
 */
export function deriveSessionArtifact(input: {
  descriptor: SessionKindDescriptor;
  sessionDir: string;
  /** R4-17 — only consumed by the 'contract-buildout' kind; see that case
   *  below and the module-header note on D4. Ignored for every other kind. */
  contractStages?: ContractStageRow[];
  /** R4-19-F2 — only consumed by the 'cleanup-plan' kind; see that case
   *  below and the cleanup-plan section's own header note (derive-don't-
   *  store). Ignored for every other kind. */
  cleanupFindings?: readonly CleanupFinding[];
  /** R4-19-F2 fail-safe fix (ORCHESTRATOR RULING) — additive-optional
   *  (ADR-042 disclose-not-park), only consumed by the 'cleanup-plan' kind.
   *  See CleanupScan's own doc for the full contract this unlocks. Omitted
   *  entirely ⇒ every unmatched action derives 'unknown', never 'cleared' —
   *  the fail-safe default. Ignored for every other kind. */
  cleanupScan?: CleanupScan;
  /** Only consumed by the 'roadmap-draft' kind, which REFUSES without it.
   *  Ignored for every other kind. */
  parseManifest?: ParseManifestPort;
}): SessionArtifactPayload {
  const { descriptor, sessionDir, contractStages, cleanupFindings, cleanupScan, parseManifest } = input;
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
      // No silent default (ruling 77): an empty roadmap-draft would look like a
      // session that produced nothing rather than one that could not be read.
      if (!parseManifest) {
        throw new Error('deriveSessionArtifact: the "roadmap-draft" kind needs the parseManifest port, bound at `apps/forge`; it was not injected.');
      }
      return deriveRoadmapDraft(sessionDir, label, parseManifest, { listDirEntries, safeReadFileInSession });
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
            '(packages/sessions/bridge-studio-sessions.ts derives them via packages/projects/contract-stages.ts\'s deriveContractStages) — never defaults to an empty/silent artifact',
        );
      }
      return {
        kind: 'contract-buildout',
        label,
        stages: contractStages,
        sourcesScanned: ['contractStages supplied by the caller (packages/projects/contract-stages.ts) — this module performs no filesystem scanning for this kind (D4)'],
      };
    }
    case 'cleanup-plan': {
      // DERIVE-DON'T-STORE: cleanupFindings is REQUIRED — a caller that
      // omits it gets a NAMED throw, never a silent empty/defaulted
      // artifact (mirrors the contract-buildout throw immediately above).
      if (cleanupFindings === undefined) {
        throw new Error(
          'deriveSessionArtifact: artifact kind "cleanup-plan" requires cleanupFindings to be supplied by the caller ' +
            '(packages/sessions/bridge-studio-sessions.ts derives them via a live, KB-scoped brain-lint scan, packages/knowledge/bridge-studio-kbs.ts\'s ' +
            'computeAgentCleanupFindings) — never defaults to an empty/silent artifact',
        );
      }
      return deriveCleanupPlan(sessionDir, label, cleanupFindings, cleanupScan);
    }
    default: {
      // Exhaustiveness guard: state === 'live' but the kind matched none of
      // the three known live renderers — only reachable if SESSION_ARTIFACT_KINDS
      // gains a new live row without a matching case here.
      throw new Error(`deriveSessionArtifact: unhandled live artifact kind "${kind}" — no renderer wired for it in session-transcript.ts`);
    }
  }
}
