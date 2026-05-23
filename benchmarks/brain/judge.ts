/**
 * Opus LLM-judge for the brain benchmark — single batched pass over all cases.
 *
 * Pre-2026-05-23-evening: one Opus query per case (N=26 → 26 Opus invocations,
 * ~$8 total). Each call loaded full theme content + per-case prompt overhead.
 *
 * Post-2026-05-23-evening: one Opus query for ALL cases in one prompt — the
 * judge sees every Q/A/cited-content together and emits a JSON array of N
 * verdicts. Same accuracy guarantee, ~5x cheaper.
 *
 * Output is paired with the F1+keyword metric so three numbers fall out:
 *   - metric_pass_rate (F1 ≥ 0.65 per case)
 *   - judge_pass_rate  (Opus says yes)
 *   - agreement_rate   (cases where metric and judge agree)
 *
 * If judge_pass_rate >> metric_pass_rate, the metric is squeezing too hard.
 * If they agree, the squeeze is real.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

import { normalisePath } from './scoring.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');

export type JudgeQueryFn = (params: {
  prompt: string;
  options?: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export type JudgeVerdict = {
  id: string;
  pass: boolean;
  severity: 'pass' | 'minor_issue' | 'major_issue' | 'fatal';
  reason: string;
  missing_concepts: string[];
  hallucinated_claims: string[];
};

const BATCH_VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          pass: { type: 'boolean' },
          severity: { type: 'string', enum: ['pass', 'minor_issue', 'major_issue', 'fatal'] },
          reason: { type: 'string' },
          missing_concepts: { type: 'array', items: { type: 'string' } },
          hallucinated_claims: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'pass', 'severity', 'reason', 'missing_concepts', 'hallucinated_claims'],
      },
    },
  },
  required: ['verdicts'],
};

const SYSTEM_PROMPT = [
  'You are a strict-but-fair forge engineer judging whether brain-query answers are acceptable.',
  '',
  'Acceptance criteria (an answer passes if ALL hold):',
  '1. **Factually correct**: every claim is supported by the cited theme content.',
  '2. **No hallucinations**: no invented concepts, file paths, terminology, or numbers absent from cited themes.',
  '3. **Substantively complete**: addresses the core of the question. Minor omissions OK; missing the central point is not.',
  '4. **Citations reasonable**: cited themes are the genuine source. 1 extra tangential citation = minor; 5+ tangential = major issue.',
  '',
  'You are NOT scoring against an expected-keyword or expected-source list. You read the answer + cited theme content and decide if the answer is correct, complete, and grounded.',
  '',
  'Severity tiers:',
  '- **pass**: meets all four. `pass: true`.',
  '- **minor_issue**: small gap or one citation extra. `pass: true`.',
  '- **major_issue**: incomplete, missing key concept, or significant citation noise. `pass: false`.',
  '- **fatal**: hallucinated content, wrong on a core claim. `pass: false`.',
  '',
  'You will be given N cases in a single prompt. Return a JSON object {"verdicts": [...]} with exactly one verdict per case, matching ids.',
].join('\n');

export type JudgeCase = {
  id: string;
  question: string;
  answer: string;
  cited_sources: string[];
  cited_theme_contents: { path: string; content: string }[];
};

export type JudgeBatchResult = {
  verdicts: JudgeVerdict[];
  durationMs: number;
  costUsd: number;
  runnerError?: { kind: string; message: string };
};

function renderBatchPrompt(cases: JudgeCase[]): string {
  const lines = [
    `# ${cases.length} brain-query answers to judge`,
    '',
    'For each case below, decide if the answer is acceptable per the criteria. Reply with a JSON `{"verdicts": [...]}` array containing one verdict per case id.',
    '',
  ];
  for (const c of cases) {
    lines.push('---');
    lines.push(`## Case ${c.id}`);
    lines.push('');
    lines.push('### Question');
    lines.push(c.question);
    lines.push('');
    lines.push('### Answer being judged');
    lines.push(c.answer);
    lines.push('');
    lines.push(`### Citations (${c.cited_sources.length})`);
    for (const s of c.cited_sources) lines.push(`- ${s}`);
    lines.push('');
    lines.push('### Cited theme content');
    for (const t of c.cited_theme_contents) {
      lines.push(`#### ${t.path}`);
      lines.push(t.content);
      lines.push('');
    }
  }
  lines.push('---');
  lines.push('Return your verdicts JSON.');
  return lines.join('\n');
}

export async function judgeAllCases(
  cases: JudgeCase[],
  queryFn?: JudgeQueryFn,
): Promise<JudgeBatchResult> {
  if (cases.length === 0) return { verdicts: [], durationMs: 0, costUsd: 0 };

  const qfn: JudgeQueryFn = queryFn ?? (sdkQuery as unknown as JudgeQueryFn);
  const prompt = renderBatchPrompt(cases);

  const options: Record<string, unknown> = {
    cwd: FORGE_ROOT,
    systemPrompt: SYSTEM_PROMPT,
    model: 'claude-opus-4-7',
    permissionMode: 'plan',
    allowedTools: [],
    maxTurns: 3,
    outputFormat: { type: 'json_schema', schema: BATCH_VERDICT_SCHEMA },
  };

  let durationMs = 0;
  let costUsd = 0;
  let verdicts: JudgeVerdict[] = [];
  let runnerError: JudgeBatchResult['runnerError'];

  for await (const msg of qfn({ prompt, options })) {
    const m = msg as {
      type?: string;
      subtype?: string;
      total_cost_usd?: number;
      duration_ms?: number;
      structured_output?: unknown;
    };
    if (m.type !== 'result') continue;
    if (typeof m.duration_ms === 'number') durationMs = m.duration_ms;
    if (typeof m.total_cost_usd === 'number') costUsd = m.total_cost_usd;
    const subtype = m.subtype ?? 'success';
    if (subtype !== 'success') {
      runnerError = { kind: subtype, message: `judge subtype: ${subtype}` };
      break;
    }
    if (!m.structured_output) {
      runnerError = { kind: 'no_structured_output', message: 'judge produced no verdicts' };
      break;
    }
    const out = m.structured_output as { verdicts: JudgeVerdict[] };
    verdicts = out.verdicts ?? [];
    break;
  }

  return { verdicts, durationMs, costUsd, ...(runnerError ? { runnerError } : {}) };
}

export function loadCitedThemeContents(forgeRoot: string, sources: string[]): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  for (const s of sources) {
    const norm = normalisePath(s);
    const full = resolve(forgeRoot, norm);
    if (!existsSync(full)) continue;
    out.push({ path: norm, content: readFileSync(full, 'utf8') });
  }
  return out;
}
