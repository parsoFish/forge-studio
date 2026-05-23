#!/usr/bin/env node
/**
 * Pair the metric (F1 + keyword) with a single batched Opus LLM-judge pass
 * over ALL cases. Validates whether the metric's "fail" set matches a
 * human-shaped standard of "wrong answer".
 *
 * Reads the latest primary-bench result file in `results/`, packs every
 * case's question + answer + cited-theme-content into ONE Opus prompt,
 * Opus returns N verdicts, written to `results-judged/<iso>.json`.
 *
 * Three numbers fall out:
 *   metric_pass_rate  — F1 ≥ 0.65 (current scoring)
 *   judge_pass_rate   — Opus says "acceptable answer"
 *   agreement_rate    — cases where both methods agree on pass/fail
 *
 * Usage: `npm run bench:brain:judge` (judges latest result)
 *        `npm run bench:brain:judge -- /path/to/result.json` (specific result)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { judgeAllCases, loadCitedThemeContents, type JudgeVerdict } from './judge.ts';

const PASS_THRESHOLD = 0.65;

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
};

const cases: SourceCase[] = benchOutput.cases;

// Map case id → original question text from the fixtures (lost in the result file).
const questionsByCaseId: Record<string, string> = {};
const qsPath = join(here, 'questions.json');
if (existsSync(qsPath)) {
  const qs = JSON.parse(readFileSync(qsPath, 'utf8')) as { id: string; question: string }[];
  for (const q of qs) questionsByCaseId[q.id] = q.question;
}

// Build the input for a single batched Opus call. Skip cases with no actual
// answer (Haiku hit a runner error — they get agreement='judge_unavailable').
const judgeInputs = cases
  .filter((c) => c.actual !== null)
  .map((c) => ({
    id: c.id,
    question: questionsByCaseId[c.id] ?? '(question text missing from fixtures)',
    answer: c.actual!.answer,
    cited_sources: c.actual!.sources,
    cited_theme_contents: loadCitedThemeContents(forgeRoot, c.actual!.sources),
  }));

const batchResult = await judgeAllCases(judgeInputs);
const verdictsById = new Map(batchResult.verdicts.map((v) => [v.id, v]));

const judged: JudgedCase[] = cases.map((c) => {
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
  };

  if (!c.actual) {
    return { ...baseline, agreement: metricPass ? 'judge_unavailable' : 'both_fail' };
  }

  const v = verdictsById.get(c.id);
  if (!v) {
    return { ...baseline, agreement: 'judge_unavailable' };
  }

  const judgePass = v.pass;
  const agreement: JudgedCase['agreement'] =
    metricPass && judgePass ? 'both_pass'
    : !metricPass && !judgePass ? 'both_fail'
    : metricPass && !judgePass ? 'judge_only_fail'
    : 'metric_only_fail';

  return {
    ...baseline,
    judge_pass: judgePass,
    judge_severity: v.severity,
    judge_reason: v.reason,
    judge_missing_concepts: v.missing_concepts,
    judge_hallucinated_claims: v.hallucinated_claims,
    agreement,
  };
});

const metricPasses = judged.filter((j) => j.metric_pass).length;
const judgePasses = judged.filter((j) => j.judge_pass === true).length;
const judgeAvailable = judged.filter((j) => j.judge_pass !== null).length;
const agreements = judged.filter((j) => j.agreement === 'both_pass' || j.agreement === 'both_fail').length;
const metricOnlyFail = judged.filter((j) => j.agreement === 'metric_only_fail').length;
const judgeOnlyFail = judged.filter((j) => j.agreement === 'judge_only_fail').length;

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
    judge_ms: batchResult.durationMs,
    total_cost_usd: batchResult.costUsd,
    ...(batchResult.runnerError ? { runner_error: batchResult.runnerError } : {}),
  },
};

const resultsDir = resolve(here, 'results-judged');
if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
const outPath = join(resultsDir, `${ranAt.replace(/[:.]/g, '-')}.json`);
writeFileSync(outPath, JSON.stringify(out, null, 2));

process.stdout.write(`Judged ${judgeAvailable}/${cases.length} cases in ONE Opus call.\n\n`);
process.stdout.write(`metric_pass_rate: ${(out.summary.metric_pass_rate * 100).toFixed(1)}% (${metricPasses}/${cases.length})\n`);
process.stdout.write(`judge_pass_rate:  ${(out.summary.judge_pass_rate * 100).toFixed(1)}% (${judgePasses}/${judgeAvailable})\n`);
process.stdout.write(`agreement_rate:   ${(out.summary.agreement_rate * 100).toFixed(1)}% (${agreements}/${judgeAvailable})\n`);
process.stdout.write(`metric-only-fail: ${metricOnlyFail} (judge says correct, metric says fail)\n`);
process.stdout.write(`judge-only-fail:  ${judgeOnlyFail} (metric says pass, judge says wrong)\n`);
process.stdout.write(`judge latency: ${batchResult.durationMs.toFixed(0)}ms — judge cost $${batchResult.costUsd.toFixed(4)}\n`);
process.stdout.write(`results: ${outPath}\n`);
