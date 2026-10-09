/**
 * The reflector's operator-question handoff: `user-questions.md` (written by
 * the agent) → `user-questions.json` (read by Studio's ReflectionGate through
 * `GET /api/reflect/<cycleId>`), and the named zero-ask outcome.
 *
 * forge-nk1y.3: an interactive reflector that reaches its end with nothing to
 * ask the operator used to leave `[]` behind silently — the same shape as a
 * cycle whose questions were never read. It is now named:
 * `reflector.unasked` (event_type `error`) with the reason, and the caller
 * records the question count on `reflector.end`. A `.json` that cannot be
 * written is a failure by name, never a second silent `[]` attempt (§6.15).
 *
 * Moved out of `reflector.ts` with the derivation it extends (that file sits
 * near the 800-line cap).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { EventLogger } from '@forge/kernel';
import type { ReflectMode } from '@forge/flows';

/** Outcome of deriving the `.json`: how many questions it holds, or why it
 *  could not be written. `mdPresent` separates "the agent wrote no file" from
 *  "the file held no question". */
export type DerivedQuestions =
  | { ok: true; count: number; mdPresent: boolean }
  | { ok: false; error: string };

export type UnaskedReason = 'no-questions-file' | 'no-questions-parsed' | 'questions-unwritable';

/**
 * Which zero-ask reason applies, or `null` when the reflection is not a
 * zero-ask red: automated mode answers its own questions, and a rerun after
 * the operator answered (`feedbackPresent`) legitimately asks nothing new.
 */
export function unaskedReason(
  derived: DerivedQuestions,
  mode: ReflectMode,
  feedbackPresent: boolean,
): UnaskedReason | null {
  if (mode !== 'interactive' || feedbackPresent) return null;
  if (!derived.ok) return 'questions-unwritable';
  if (derived.count > 0) return null;
  return derived.mdPresent ? 'no-questions-parsed' : 'no-questions-file';
}

/** Emit `reflector.unasked` for a zero-ask interactive reflection. */
export function emitUnasked(opts: {
  logger: EventLogger;
  initiativeId: string;
  parentEventId: string;
  skill: string;
  reason: UnaskedReason;
  mode: ReflectMode;
  questionsPath: string;
  error?: string;
}): void {
  opts.logger.emit({
    initiative_id: opts.initiativeId,
    parent_event_id: opts.parentEventId,
    phase: 'reflection',
    skill: opts.skill,
    event_type: 'error',
    input_refs: [],
    output_refs: [opts.questionsPath],
    message: 'reflector.unasked',
    metadata: { reason: opts.reason, mode: opts.mode, ...(opts.error ? { error: opts.error } : {}) },
  });
}

/**
 * REF-1: Derive `user-questions.json` from `user-questions.md`.
 *
 * The agent writes only the .md (numbered headings). This function
 * synthesises the AskUserQuestion-shaped JSON array that the in-UI
 * /reflect screen expects, so the interview works in production without
 * requiring the agent to write two files.
 *
 * Parsing strategy: split on `## ` headings, use the heading text as
 * `header` (truncated to 12 chars per AskUserQuestion constraint) and the
 * body text as `question`. If the section supplies structured options (a
 * markdown bullet/dash list, optionally under an "Options:" marker) those
 * are parsed into `{label, description}`; otherwise `options` is left empty
 * so the /reflect screen renders a freeform textarea rather than a
 * one-size-fits-all generic triad. If the .md is absent or contains no
 * questions, an empty array is written (the UI treats that as "no questions
 * this cycle"). A read or write failure is returned, never swallowed.
 */
export function deriveUserQuestionsJson(mdPath: string, jsonPath: string, mode: ReflectMode = 'interactive'): DerivedQuestions {
  const mdPresent = existsSync(mdPath);
  try {
    const questions = mdPresent ? parseUserQuestionsMd(readFileSync(mdPath, 'utf8'), mode) : [];
    writeFileSync(jsonPath, JSON.stringify(questions, null, 2));
    return { ok: true, count: questions.length, mdPresent };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

type UserQuestion = {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  /** R4-09-F3 (automated mode): the reflector-inferred answer for this question. */
  answer?: string;
  /** R4-09-F3: true when `answer` was inferred (no human), for UI provenance. */
  inferred?: boolean;
};

/** R4-09-F3: the self-describing marker the automated prompt writes per question. */
const INFERRED_ANSWER_RE = /^\s*\*\*Inferred answer:\*\*\s*(.+)$/i;

/**
 * Parse the numbered heading format written by the agent:
 *   ## 1. <heading text>
 *   <body paragraphs>
 *
 * Returns one entry per `## ` heading found — nothing else is ever read as one, so
 * an H1/preamble prefix is dropped and a heading-less file yields `[]`, never a stand-in.
 */
export function parseUserQuestionsMd(raw: string, mode: ReflectMode = 'interactive'): UserQuestion[] {
  const out: UserQuestion[] = [];
  // Split on `## ` headings; drop any leading section that isn't one (REF-1 H1/preamble, forge-8vfn.8.1.35).
  const sections = raw.split(/^(?=## )/m).filter((s) => s.trim().startsWith('## '));
  for (const section of sections) {
    const lines = section.split(/\r?\n/);
    const heading = lines[0].replace(/^##\s+\d+\.\s*/, '').replace(/^##\s+/, '').trim();
    if (!heading) continue;
    const bodyLines = lines.slice(1);
    const options = parseSectionOptions(bodyLines);
    // R4-09-F3: in automated mode, lift the self-describing `**Inferred
    // answer:**` line into `answer` + `inferred: true`, and strip it from the
    // question text so it isn't duplicated into the prompt. Interactive runs
    // ignore any such line — the JSON shape is byte-identical to pre-F3.
    let answer: string | undefined;
    let inferred: boolean | undefined;
    let contentLines = bodyLines;
    if (mode === 'automated') {
      const idx = bodyLines.findIndex((l) => INFERRED_ANSWER_RE.test(l));
      if (idx >= 0) {
        const m = bodyLines[idx].match(INFERRED_ANSWER_RE);
        answer = m?.[1]?.trim();
        inferred = true;
        contentLines = bodyLines.filter((_, i) => i !== idx);
      }
    }
    const body = contentLines.join('\n').trim();
    // The question text is the body with any parsed option lines stripped, so
    // the freeform/options content isn't duplicated into the prompt.
    const question = stripOptionLines(body) || heading;
    // header must be ≤12 chars (AskUserQuestion constraint).
    const header = heading.slice(0, 12);
    const entry: UserQuestion = { question, header, options };
    if (answer !== undefined) entry.answer = answer;
    if (inferred) entry.inferred = true;
    out.push(entry);
  }
  return out;
}

/**
 * Parse a markdown bullet/dash list of options from a question section body.
 *
 * A "meaningful" option line looks like `- Label` or `* Label — description`
 * (em-dash, en-dash, or " - " as the label/description separator). Lines are
 * only treated as options when there are at least two of them — a single
 * stray bullet inside prose is prose, not a choice set. When no structured
 * options are present we return [] so the UI falls back to a freeform answer
 * rather than synthesizing a generic triad that fits no question.
 */
function parseSectionOptions(bodyLines: string[]): Array<{ label: string; description: string }> {
  const opts: Array<{ label: string; description: string }> = [];
  for (const line of bodyLines) {
    const m = line.match(/^\s*[-*]\s+(.+)$/);
    if (!m) continue;
    const text = m[1].trim();
    if (!text) continue;
    // Split label from description on em/en dash or " - ".
    const sep = text.match(/\s+(?:—|–|-)\s+/);
    if (sep && sep.index !== undefined) {
      const label = text.slice(0, sep.index).trim();
      const description = text.slice(sep.index + sep[0].length).trim();
      opts.push({ label, description });
    } else {
      opts.push({ label: text, description: '' });
    }
  }
  return opts.length >= 2 ? opts : [];
}

/** Drop markdown bullet/dash lines from a body so option text isn't duplicated into the question prompt. */
function stripOptionLines(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((l) => !/^\s*[-*]\s+/.test(l))
    .join('\n')
    .trim();
}
