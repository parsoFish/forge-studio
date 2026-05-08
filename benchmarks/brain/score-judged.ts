#!/usr/bin/env node
/**
 * Pair the metric (F1 + keyword) with an Opus LLM-judge verdict over the same
 * 18 cases. Validates whether the metric's "fail" set matches a human-shaped
 * standard of "wrong answer".
 *
 * Reads the latest primary-bench result file in `results/`, runs Opus over
 * each case's answer + cited-theme content, and writes a paired report to
 * `results-judged/<iso>.json`.
 *
 * Three numbers fall out:
 *   metric_pass_rate  — F1 ≥ 0.8 (current scoring)
 *   judge_pass_rate   — Opus says "acceptable answer"
 *   agreement_rate    — cases where both methods agree on pass/fail
 *
 * Usage: `npm run bench:brain:judge` (judges latest result)
 *        `npm run bench:brain:judge -- /path/to/result.json` (specific result)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { mapConcurrent } from '../_lib/concurrent.ts';
import { p95 } from '../_lib/percentile.ts';
import { judgeAnswer, loadCitedThemeContents, type JudgeVerdict } from './judge.ts';

const PASS_THRESHOLD = 0.65;
const CONCURRENCY = 4;
const SESSION_BUDGET_USD = 30; // Opus is materially more expensive than Haiku.

const here = import.meta.dirname;
const forgeRoot = resolve(here, '..', '..');

function findLatestResult(): string {
  const dir = resolve(here, 'results');
  if (!existsSync(dir)) throw new Error(`no results dir at ${dir}; run npm run bench:brain first`);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`no result files in ${dir}; run npm run bench:brain first`);
  return resolve(dir, files[files.length - 1]);
}

const sourcePath = process.argv[2] ?? findLatestResult();
process.stderr.write(`judging cases from: ${sourcePath}\n`);
const benchOutput = JSON.parse(readFileSync(sourcePath, 'utf8'));
const ranAt = new Date().toISOString();

type SourceCase = {
  id: string;
  score: number;
  expected: { sources: string[]; keywords: string[] };
  actual: { sources: string[]; answer: string; gap?: boolean } | null;
};

type JudgedCase = {
  id: string;
  metric_score: number;
  metric_pass: boolean;
  judge_pass: boolean | null;
  judge_severity: JudgeVerdict['severity'] | null;
  judge_reason: string | null;
  judge_missing_concepts: string[];
  judge_hallucinated_claims: string[];
  agreement: 'both_pass' | 'both_fail' | 'metric_only_fail' | 'judge_only_fail' | 'judge_unavailable';
  elapsed_ms: number;
  cost_usd: number;
  runner_error?: { kind: string; message: string };
};

const cases: SourceCase[] = benchOutput.cases;

// Map case id → original question text from the fixtures (we lose it when reading the result file).
const questionsByCaseId: Record<string, string> = {};
const qsPath = join(here, 'questions.json');
if (existsSync(qsPath)) {
  const qs = JSON.parse(readFileSync(qsPath, 'utf8')) as { id: string; question: string }[];
  for (const q of qs) questionsByCaseId[q.id] = q.question;
}

let totalCostUsd = 0;
let aborted = false;

const judged = await mapConcurrent(cases, CONCURRENCY, async (c): Promise<JudgedCase> => {
  const metricPass = c.score >= PASS_THRESHOLD;
  const baseline: Omit<JudgedCase, 'agreement'> = {
    id: c.id,
    metric_score: c.score,
    metric_pass: metricPass,
    judge_pass: null,
    judge_severity: null,
    judge_reason: null,
    judge_missing_concepts: [],
    judge_hallucinated_claims: [],
    elapsed_ms: 0,
    cost_usd: 0,
  };

  if (!c.actual) {
    return {
      ...baseline,
      agreement: metricPass ? 'judge_unavailable' : 'both_fail',
      runner_error: { kind: 'no_haiku_answer', message: 'source bench had no actual answer' },
    };
  }

  if (aborted || totalCostUsd >= SESSION_BUDGET_USD) {
    aborted = true;
    return {
      ...baseline,
      agreement: 'judge_unavailable',
      runner_error: {
        kind: 'session_budget_exceeded',
        message: `Aborted before judging ${c.id}: total $${totalCostUsd.toFixed(4)} crossed cap $${SESSION_BUDGET_USD}`,
      },
    };
  }

  const question = questionsByCaseId[c.id] ?? '(question text missing from fixtures)';
  const themeContents = loadCitedThemeContents(forgeRoot, c.actual.sources);

  let r;
  try {
    r = await judgeAnswer({
      question,
      answer: c.actual.answer,
      cited_sources: c.actual.sources,
      cited_theme_contents: themeContents,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...baseline, agreement: 'judge_unavailable', runner_error: { kind: 'thrown', message } };
  }

  totalCostUsd += r.costUsd;

  if (!r.verdict) {
    return {
      ...baseline,
      agreement: 'judge_unavailable',
      elapsed_ms: r.durationMs,
      cost_usd: r.costUsd,
      ...(r.runnerError ? { runner_error: r.runnerError } : {}),
    };
  }

  const judgePass = r.verdict.pass;
  const agreement: JudgedCase['agreement'] =
    metricPass && judgePass ? 'both_pass'
    : !metricPass && !judgePass ? 'both_fail'
    : metricPass && !judgePass ? 'judge_only_fail'
    : 'metric_only_fail';

  return {
    ...baseline,
    judge_pass: judgePass,
    judge_severity: r.verdict.severity,
    judge_reason: r.verdict.reason,
    judge_missing_concepts: r.verdict.missing_concepts,
    judge_hallucinated_claims: r.verdict.hallucinated_claims,
    agreement,
    elapsed_ms: r.durationMs,
    cost_usd: r.costUsd,
  };
});

const metricPasses = judged.filter((j) => j.metric_pass).length;
const judgePasses = judged.filter((j) => j.judge_pass === true).length;
const judgeAvailable = judged.filter((j) => j.judge_pass !== null).length;
const agreements = judged.filter((j) => j.agreement === 'both_pass' || j.agreement === 'both_fail').length;
const metricOnlyFail = judged.filter((j) => j.agreement === 'metric_only_fail').length;
const judgeOnlyFail = judged.filter((j) => j.agreement === 'judge_only_fail').length;
const elapsed = judged.map((j) => j.elapsed_ms).filter((n) => n > 0);

const out = {
  phase: 'brain-judged',
  source_bench_result: sourcePath,
  ran_at: ranAt,
  cases: judged,
  summary: {
    total: cases.length,
    judge_available: judgeAvailable,
    metric_pass_rate: cases.length === 0 ? 1 : metricPasses / cases.length,
    judge_pass_rate: judgeAvailable === 0 ? 0 : judgePasses / judgeAvailable,
    agreement_rate: judgeAvailable === 0 ? 1 : agreements / judgeAvailable,
    metric_only_fail: metricOnlyFail,
    judge_only_fail: judgeOnlyFail,
    p95_judge_ms: p95(elapsed),
    total_cost_usd: totalCostUsd,
    aborted_on_budget: aborted,
  },
};

const resultsDir = resolve(here, 'results-judged');
if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
const outPath = join(resultsDir, `${ranAt.replace(/[:.]/g, '-')}.json`);
writeFileSync(outPath, JSON.stringify(out, null, 2));

process.stdout.write(`Judged ${judgeAvailable}/${cases.length} cases against Opus.\n\n`);
process.stdout.write(`metric_pass_rate: ${(out.summary.metric_pass_rate * 100).toFixed(1)}% (${metricPasses}/${cases.length})\n`);
process.stdout.write(`judge_pass_rate:  ${(out.summary.judge_pass_rate * 100).toFixed(1)}% (${judgePasses}/${judgeAvailable})\n`);
process.stdout.write(`agreement_rate:   ${(out.summary.agreement_rate * 100).toFixed(1)}% (${agreements}/${judgeAvailable})\n`);
process.stdout.write(`metric-only-fail: ${metricOnlyFail} (judge says correct, metric says fail)\n`);
process.stdout.write(`judge-only-fail:  ${judgeOnlyFail} (metric says pass, judge says wrong)\n`);
process.stdout.write(`p95 judge latency: ${out.summary.p95_judge_ms.toFixed(0)}ms — judge cost $${totalCostUsd.toFixed(4)}\n`);
process.stdout.write(`results: ${outPath}\n`);
