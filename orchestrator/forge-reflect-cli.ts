/**
 * S6B — slash-command CLI module for `/forge-reflect <id>`.
 *
 * Per council 06 `dx:01-cli-module-pattern`, every slash-command surface
 * exports two functions:
 *
 *   - `render(input)`         pure markdown rendering for the in-session prompt.
 *   - `writeOutput(input)`    persists the operator's answers + free-form
 *                             feedback to `_logs/<id>/user-feedback.md`,
 *                             then auto-invokes `forge reflect <id> --rerun`
 *                             by default (per CONTRACTS.md C9).
 *
 * `parseFeedback()` is exported for round-trip validation + downstream
 * consumers (the reflector reads `user-feedback.md` natively).
 *
 * No SDK calls live here. The rerun invocation is injectable via the
 * `_rerunImpl` option so tests don't have to spawn `runReflector`.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RenderInput = {
  cycleId: string;
  /** Defaults to `_logs` resolved against the forge root. */
  logsRoot?: string;
};

export type WriteOutputInput = {
  cycleId: string;
  /** Defaults to `_logs` resolved against the forge root. */
  logsRoot?: string;
  /**
   * Ordered list of operator answers, one per numbered question parsed from
   * `_logs/<id>/user-questions.md`. Empty strings preserved — the operator
   * may legitimately skip a question.
   */
  answers: string[];
  /** Free-form section content. Empty → "no additional feedback" placeholder. */
  freeform?: string;
  /**
   * `true` (default per CONTRACTS.md C9) → invoke `forge reflect <id> --rerun`.
   * `false` → write-only, no rerun.
   * `undefined` → default behaviour (rerun fires).
   */
  rerun?: boolean;
  /**
   * Injectable rerun implementation. Tests substitute a stub; the CLI's
   * `forge reflect <id>` subcommand wires the real `runReflector` re-call.
   */
  _rerunImpl?: (opts: { cycleId: string; logsRoot: string }) => Promise<void>;
};

export type WriteOutputResult = {
  feedbackPath: string;
  rerun: boolean;
};

export type ParsedFeedback = {
  answers: Array<{ question: string; answer: string }>;
  freeform: string;
};

/**
 * Cwc Amendment — the `AskUserQuestion`-shaped question struct the
 * `/forge-reflect` slash command passes to the tool. Mirrors the
 * native tool's input schema (header ≤12 chars, 2-4 options each
 * carrying a label + description). Source-of-truth is the
 * reflector's stage-2 emit (`user-questions.json` when present;
 * synthesised from `user-questions.md` otherwise).
 */
export type StructuredQuestion = {
  question: string;
  /** Short chip label, ≤12 chars per the AskUserQuestion constraint. */
  header: string;
  options: Array<{ label: string; description: string }>;
};

export type StructuredQuestionsResult = {
  /** Where the questions came from. `none` ⇒ no questions for this cycle. */
  source: 'json' | 'markdown' | 'none';
  questions: StructuredQuestion[];
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const FORGE_ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_LOGS_ROOT = resolve(FORGE_ROOT, '_logs');

function resolveLogsRoot(logsRoot: string | undefined): string {
  return logsRoot ? resolve(logsRoot) : DEFAULT_LOGS_ROOT;
}

function cycleDirPath(cycleId: string, logsRoot: string): string {
  return resolve(logsRoot, cycleId);
}

// ---------------------------------------------------------------------------
// render()
// ---------------------------------------------------------------------------

/**
 * Render the in-session prompt the operator sees when they invoke
 * `/forge-reflect <id>`. Pure: reads disk inputs and returns markdown.
 *
 * Cases:
 *   - cycle dir missing                → throws (operator likely fat-fingered the id).
 *   - cycle dir present, no questions  → stub render explaining the state +
 *                                         offering free-form feedback anyway.
 *   - cycle dir present + questions    → header + numbered questions with
 *                                         answer blocks + free-form prompt.
 */
export function render(input: RenderInput): string {
  const logsRoot = resolveLogsRoot(input.logsRoot);
  const cycleDir = cycleDirPath(input.cycleId, logsRoot);
  if (!existsSync(cycleDir)) {
    throw new Error(`cycle log directory does not exist: ${cycleDir}`);
  }

  const questionsPath = resolve(cycleDir, 'user-questions.md');
  const contextLinks = buildContextLinks(cycleDir);

  const header = [
    `# /forge-reflect — ${input.cycleId}`,
    '',
    '> Human moment — answer the numbered questions inline, then add any',
    '> free-form feedback. Your input is written to',
    `> \`_logs/${input.cycleId}/user-feedback.md\` and (by default) the`,
    '> reflector is re-invoked so your voice reaches the brain this cycle.',
    '',
  ];

  if (!existsSync(questionsPath)) {
    const lines = [
      ...header,
      '## Status',
      '',
      'The reflector has not emitted questions yet — either the cycle is still',
      'running, the reflector failed before stage 2, or no questions were warranted',
      'this cycle.',
      '',
      '## Free-form feedback',
      '',
      'Anything else for the brain? You can still record arbitrary feedback now;',
      "it will be appended to this cycle's `user-feedback.md`. Subsequent reflector",
      'runs will pick it up.',
      '',
      '> Your feedback:',
      '>',
      '',
      ...contextLinks,
    ];
    return lines.join('\n');
  }

  const questions = parseQuestions(readFileSync(questionsPath, 'utf8'));

  if (questions.length === 0) {
    const lines = [
      ...header,
      '## Status',
      '',
      '_(no questions to answer this cycle)_',
      '',
      'The reflector ran and judged no operator question was warranted.',
      '',
      '## Free-form feedback',
      '',
      'Anything else for the brain? (antipatterns observed, decisions to record, etc.)',
      '',
      '> Your feedback:',
      '>',
      '',
      ...contextLinks,
    ];
    return lines.join('\n');
  }

  const lines: string[] = [
    ...header,
    '## Answers to numbered questions',
    '',
  ];
  for (const q of questions) {
    lines.push(`### ${q.number}. ${q.text}`);
    if (q.context) {
      lines.push('', q.context);
    }
    lines.push('', '> Your answer:', '>', '');
  }
  lines.push(
    '## Free-form feedback',
    '',
    'Anything else for the brain? (antipatterns observed, decisions to record, etc.)',
    '',
    '> Your feedback:',
    '>',
    '',
    ...contextLinks,
  );
  return lines.join('\n');
}

function buildContextLinks(cycleDir: string): string[] {
  const retroPath = resolve(cycleDir, 'retro.md');
  const eventsPath = resolve(cycleDir, 'events.jsonl');
  const recapPath = resolve(cycleDir, 'recap.md');
  const out = ['## Context', ''];
  if (existsSync(retroPath)) out.push(`- retro: ${retroPath}`);
  if (existsSync(eventsPath)) out.push(`- events: ${eventsPath}`);
  if (existsSync(recapPath)) out.push(`- recap: ${recapPath}`);
  out.push('');
  return out;
}

// ---------------------------------------------------------------------------
// Question parsing
// ---------------------------------------------------------------------------

type ParsedQuestion = {
  number: number;
  text: string;
  context?: string;
};

/**
 * Parse `user-questions.md`. The reflector's stage-2 contract emits each
 * question as a numbered heading; we accept `## 1. Q?`, `### 1. Q?`, or
 * `## Question 1: Q?` shapes for resilience. The body between the heading
 * and the next heading is captured as `context`.
 */
/**
 * Cwc Amendment — read the reflector's stage-2 structured questions for the
 * `/forge-reflect` slash command. JSON is preferred (cwc shape, native
 * AskUserQuestion fields); falls back to converting `user-questions.md`
 * when only the legacy markdown emit is present (e.g. cycles closed before
 * the SKILL was amended).
 *
 * Returns `{ source: 'none', questions: [] }` when neither file is present —
 * the slash command's no-questions code path remains valid.
 */
export function readStructuredQuestions(
  cycleId: string,
  logsRoot?: string,
): StructuredQuestionsResult {
  const root = resolveLogsRoot(logsRoot);
  const cycleDir = cycleDirPath(cycleId, root);

  // 1. Prefer the JSON emit (post-cwc-amendment SKILL).
  const jsonPath = resolve(cycleDir, 'user-questions.json');
  if (existsSync(jsonPath)) {
    const parsed = parseStructuredQuestionsJson(readFileSync(jsonPath, 'utf8'));
    if (parsed !== null) {
      return { source: 'json', questions: parsed };
    }
    // JSON present but malformed — fall through to markdown.
  }

  // 2. Fall back to synthesising from the markdown emit.
  const mdPath = resolve(cycleDir, 'user-questions.md');
  if (existsSync(mdPath)) {
    const mdQuestions = parseQuestions(readFileSync(mdPath, 'utf8'));
    if (mdQuestions.length > 0) {
      return {
        source: 'markdown',
        questions: mdQuestions.map((q) => synthesiseFromMarkdown(q)),
      };
    }
  }

  return { source: 'none', questions: [] };
}

/**
 * Parse the JSON shape the SKILL emits. Validates every entry has
 * `question`, `header`, and a 2-4 length `options` array of
 * `{label, description}` objects. Returns null on any structural problem so
 * the caller can fall back to markdown gracefully.
 */
function parseStructuredQuestionsJson(text: string): StructuredQuestion[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: StructuredQuestion[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') return null;
    const e = entry as Record<string, unknown>;
    if (typeof e.question !== 'string' || e.question.length === 0) return null;
    if (typeof e.header !== 'string' || e.header.length === 0) return null;
    if (!Array.isArray(e.options)) return null;
    if (e.options.length < 2 || e.options.length > 4) return null;
    const options: Array<{ label: string; description: string }> = [];
    for (const opt of e.options) {
      if (!opt || typeof opt !== 'object') return null;
      const o = opt as Record<string, unknown>;
      if (typeof o.label !== 'string' || o.label.length === 0) return null;
      if (typeof o.description !== 'string') return null;
      options.push({ label: o.label, description: o.description });
    }
    out.push({ question: e.question, header: e.header, options });
  }
  return out;
}

/**
 * Synthesise a `StructuredQuestion` from a parsed markdown question. We
 * cannot reliably auto-extract specific options from prose, so this
 * returns a generic 3-option set that lets the operator pick a coarse
 * categorisation (or use the always-available "Other" override to type
 * a free-text answer). The header is heuristically truncated.
 */
function synthesiseFromMarkdown(q: ParsedQuestion): StructuredQuestion {
  return {
    question: q.text,
    header: synthesiseHeader(q.text),
    options: [
      { label: 'Nothing notable', description: 'No issue / agree with the reflector’s read.' },
      { label: 'Worth a theme', description: 'Capture as a brain theme — moderate signal.' },
      { label: 'Significant issue', description: 'Important enough to influence the next cycle.' },
    ],
  };
}

function synthesiseHeader(question: string): string {
  // Take the first 1-3 substantive words, cap at 12 chars per AUQ schema.
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  let header = '';
  for (const w of words) {
    if ((header + ' ' + w).trim().length > 12) break;
    header = (header + ' ' + w).trim();
  }
  if (header.length === 0) header = 'Question';
  return header[0].toUpperCase() + header.slice(1);
}

const STOPWORDS = new Set([
  'was', 'were', 'should', 'would', 'could', 'have', 'has', 'had', 'this',
  'that', 'the', 'and', 'for', 'with', 'about', 'from', 'into', 'what',
  'when', 'where', 'why', 'how', 'who', 'did', 'does', 'is', 'are', 'will',
]);

function parseQuestions(body: string): ParsedQuestion[] {
  const out: ParsedQuestion[] = [];
  const lines = body.split(/\r?\n/);
  let current: ParsedQuestion | null = null;
  let contextBuf: string[] = [];

  const headingRe = /^#{2,4}\s+(?:Question\s+)?(\d+)[\.:)]\s*(.*)$/i;

  const flush = () => {
    if (current) {
      const ctx = contextBuf.join('\n').trim();
      if (ctx) current.context = ctx;
      out.push(current);
    }
    current = null;
    contextBuf = [];
  };

  for (const line of lines) {
    const m = line.match(headingRe);
    if (m) {
      flush();
      current = { number: parseInt(m[1], 10), text: m[2].trim() };
    } else if (current) {
      contextBuf.push(line);
    }
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// writeOutput()
// ---------------------------------------------------------------------------

const RERUN_DEFAULT = true;

/**
 * Persist the operator's answers + free-form feedback as
 * `_logs/<cycleId>/user-feedback.md` in the SKILL's canonical format,
 * then (by default per C9) re-invoke the reflector.
 */
export async function writeOutput(
  input: WriteOutputInput,
): Promise<WriteOutputResult> {
  const logsRoot = resolveLogsRoot(input.logsRoot);
  const cycleDir = cycleDirPath(input.cycleId, logsRoot);
  if (!existsSync(cycleDir)) {
    throw new Error(`cycle log directory does not exist: ${cycleDir}`);
  }

  const feedbackPath = resolve(cycleDir, 'user-feedback.md');
  const questionsPath = resolve(cycleDir, 'user-questions.md');
  const questions = existsSync(questionsPath)
    ? parseQuestions(readFileSync(questionsPath, 'utf8'))
    : [];

  const lines: string[] = [
    `# Reflection feedback — ${input.cycleId}`,
    '',
  ];
  if (questions.length > 0) {
    lines.push('## Answers to numbered questions', '');
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const a = (input.answers[i] ?? '').trim();
      lines.push(`### ${q.number}. ${q.text}`, '');
      lines.push(a.length > 0 ? a : '_(skipped)_');
      lines.push('');
    }
  }
  lines.push('## Free-form feedback', '');
  const freeform = (input.freeform ?? '').trim();
  lines.push(freeform.length > 0 ? freeform : '_(no additional feedback this cycle)_');
  lines.push('');
  writeFileSync(feedbackPath, lines.join('\n'));

  const shouldRerun = input.rerun === undefined ? RERUN_DEFAULT : input.rerun;
  if (shouldRerun) {
    const rerunImpl = input._rerunImpl ?? defaultRerunImpl;
    await rerunImpl({ cycleId: input.cycleId, logsRoot });
  }

  return { feedbackPath, rerun: shouldRerun };
}

/**
 * Default rerun implementation — re-invokes `runReflector` for the cycle's
 * closed manifest. Resolved lazily so test consumers don't import the
 * reflector phase runner (which transitively pulls in the Anthropic SDK).
 *
 * The CLI subcommand `forge reflect <id> --rerun` calls into this path; the
 * slash command's `writeOutput()` reaches it through the same lookup.
 */
async function defaultRerunImpl(opts: {
  cycleId: string;
  logsRoot: string;
}): Promise<void> {
  // The standalone rerun helper lives next door so this module can stay free
  // of the heavy reflector + SDK dependency graph until rerun is actually
  // requested. Dynamic import keeps cold-path costs out of the slash-CLI.
  const mod = await import('./forge-reflect-rerun.ts');
  await mod.rerunReflector({ cycleId: opts.cycleId, logsRoot: opts.logsRoot });
}

// ---------------------------------------------------------------------------
// parseFeedback() — canonical round-trip
// ---------------------------------------------------------------------------

/**
 * Parse a `user-feedback.md` body produced by `writeOutput()`. Returns the
 * ordered answer list + the free-form section. Used by:
 *   - tests (round-trip validation)
 *   - downstream consumers that want structured access to the operator's
 *     answers without parsing markdown themselves.
 */
export function parseFeedback(body: string): ParsedFeedback {
  const answers: Array<{ question: string; answer: string }> = [];
  let freeform = '';

  // Split body into sections by `## ` headings.
  const sections: Array<{ heading: string; body: string }> = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^##\s+(.*)$/);
    if (m && !line.startsWith('### ')) {
      if (currentHeading !== null) {
        sections.push({ heading: currentHeading, body: currentLines.join('\n') });
      }
      currentHeading = m[1].trim();
      currentLines = [];
    } else if (currentHeading !== null) {
      currentLines.push(line);
    }
  }
  if (currentHeading !== null) {
    sections.push({ heading: currentHeading, body: currentLines.join('\n') });
  }

  for (const sec of sections) {
    if (/answers to numbered questions/i.test(sec.heading)) {
      const qLines = sec.body.split(/\r?\n/);
      let curr: { question: string; answer: string } | null = null;
      let buf: string[] = [];
      const flush = () => {
        if (curr) {
          curr.answer = buf.join('\n').trim();
          answers.push(curr);
        }
        curr = null;
        buf = [];
      };
      for (const ql of qLines) {
        const m = ql.match(/^###\s+\d+\.\s*(.*)$/);
        if (m) {
          flush();
          curr = { question: m[1].trim(), answer: '' };
        } else if (curr) {
          buf.push(ql);
        }
      }
      flush();
    } else if (/free-form feedback/i.test(sec.heading)) {
      freeform = sec.body.trim();
    }
  }

  return { answers, freeform };
}
