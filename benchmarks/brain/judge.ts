/**
 * Opus LLM-judge for the brain benchmark — meta-evaluation of the F1+keyword
 * metric.
 *
 * The metric is harsh in failure modes that don't reflect "wrong answer":
 * paraphrased keywords, citation extras that are tangentially relevant, etc.
 * The judge asks Opus a different question: "given this question, this answer,
 * and the content of the cited themes — is the answer correct, complete, and
 * grounded in the brain?"
 *
 * Output is paired with the metric score so we can produce three numbers:
 *   - metric_pass_rate (F1 ≥ 0.8 per case)
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
  pass: boolean;
  severity: 'pass' | 'minor_issue' | 'major_issue' | 'fatal';
  reason: string;
  missing_concepts: string[];
  hallucinated_claims: string[];
};

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    severity: { type: 'string', enum: ['pass', 'minor_issue', 'major_issue', 'fatal'] },
    reason: { type: 'string' },
    missing_concepts: { type: 'array', items: { type: 'string' } },
    hallucinated_claims: { type: 'array', items: { type: 'string' } },
  },
  required: ['pass', 'severity', 'reason', 'missing_concepts', 'hallucinated_claims'],
};

const SYSTEM_PROMPT = [
  'You are a strict-but-fair forge engineer judging whether a brain-query answer is acceptable.',
  '',
  'Acceptance criteria (the answer passes if ALL hold):',
  '1. **Factually correct**: every claim in the answer is supported by content in the cited theme files (provided below).',
  '2. **No hallucinations**: the answer does not invent concepts, file paths, terminology, or numbers absent from the cited themes.',
  '3. **Substantively complete**: the answer addresses the core of the question. Minor omissions of supporting nuance are fine; missing the central point is not.',
  '4. **Citations are reasonable**: the cited themes are genuinely the source of the claims. Citing one extra tangentially-relevant theme is a minor issue, not a fail. Citing 5+ tangential themes is a major issue.',
  '',
  'You are NOT scoring against an expected-keyword list or an expected-source list. You are reading the answer and the cited theme content, and judging whether the answer is correct and well-grounded.',
  '',
  'Severity levels:',
  '- **pass**: meets all four criteria. Set `pass: true`.',
  '- **minor_issue**: small gap or one citation extra. Still set `pass: true`.',
  '- **major_issue**: incomplete, missing a key concept, or significant citation noise. Set `pass: false`.',
  '- **fatal**: hallucinated content, wrong on a core claim. Set `pass: false`.',
  '',
  'In `missing_concepts` list any specific concepts the answer should have mentioned but didn\'t. In `hallucinated_claims` list any claims in the answer that aren\'t supported by the cited theme content. Empty arrays are fine.',
].join('\n');

export type JudgeInput = {
  question: string;
  answer: string;
  cited_sources: string[];
  cited_theme_contents: { path: string; content: string }[];
  queryFn?: JudgeQueryFn;
};

export type JudgeResult = {
  verdict: JudgeVerdict | null;
  durationMs: number;
  costUsd: number;
  runnerError?: { kind: string; message: string };
};

function renderJudgePrompt(input: JudgeInput): string {
  const lines = [
    `# Question`,
    input.question,
    '',
    `# Answer being judged`,
    input.answer,
    '',
    `# Citations (${input.cited_sources.length} source${input.cited_sources.length === 1 ? '' : 's'})`,
    ...input.cited_sources.map((s) => `- ${s}`),
    '',
    `# Cited theme content`,
  ];
  for (const t of input.cited_theme_contents) {
    lines.push('');
    lines.push(`## ${t.path}`);
    lines.push(t.content);
  }
  lines.push('');
  lines.push('Judge the answer against the criteria. Return your structured verdict.');
  return lines.join('\n');
}

export async function judgeAnswer(input: JudgeInput): Promise<JudgeResult> {
  const queryFn: JudgeQueryFn = input.queryFn ?? (sdkQuery as unknown as JudgeQueryFn);
  const prompt = renderJudgePrompt(input);

  const options: Record<string, unknown> = {
    cwd: FORGE_ROOT,
    systemPrompt: SYSTEM_PROMPT,
    model: 'claude-opus-4-7',
    permissionMode: 'plan',
    allowedTools: [],
    maxTurns: 5,
    maxBudgetUsd: 2,
    outputFormat: { type: 'json_schema', schema: JUDGE_SCHEMA },
  };

  let durationMs = 0;
  let costUsd = 0;
  let verdict: JudgeVerdict | null = null;
  let runnerError: JudgeResult['runnerError'];

  for await (const msg of queryFn({ prompt, options })) {
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
      runnerError = { kind: 'no_structured_output', message: 'judge produced no verdict' };
      break;
    }
    verdict = m.structured_output as JudgeVerdict;
    break;
  }

  return { verdict, durationMs, costUsd, runnerError };
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
