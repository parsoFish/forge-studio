#!/usr/bin/env node
/**
 * Benchmark — Brain. Skeleton runner. Reads questions.json, would invoke
 * the brain-query skill against each, and scores. With an empty questions
 * file, prints "0/0 cases passed" so the harness is provably wired.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type Case = {
  id: string;
  question: string;
  expected_sources: string[];
  expected_keywords: string[];
  scope?: string | null;
  category?: string | null;
};

const here = import.meta.dirname;
const questionsPath = join(here, 'questions.json');
const resultsDir = join(here, 'results');
if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });

const cases: Case[] = JSON.parse(readFileSync(questionsPath, 'utf8'));
const ranAt = new Date().toISOString();

const results = cases.map((c) => ({
  id: c.id,
  // TODO: invoke brain-query skill via @anthropic-ai/claude-agent-sdk; score.
  score: 0,
  expected: { sources: c.expected_sources, keywords: c.expected_keywords },
  actual: null as null | { sources: string[]; answer: string },
  elapsed_ms: 0,
}));

const passed = results.filter((r) => r.score >= 0.8).length;
const summary = {
  phase: 'brain',
  ran_at: ranAt,
  cases: results,
  summary: {
    total: cases.length,
    passed,
    failed: cases.length - passed,
    accuracy: cases.length === 0 ? 1 : passed / cases.length,
  },
};

const out = JSON.stringify(summary, null, 2);
writeFileSync(join(resultsDir, `${ranAt.replace(/[:.]/g, '-')}.json`), out);
console.log(out);
console.log(`\n${passed}/${cases.length} cases passed`);
