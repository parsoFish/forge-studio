#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dirname;
const casesPath = join(here, 'initiatives.json');
const resultsDir = join(here, 'results');
if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });

const cases: unknown[] = JSON.parse(readFileSync(casesPath, 'utf8'));
const ranAt = new Date().toISOString();
const passed = 0;

const summary = {
  phase: 'project-manager',
  ran_at: ranAt,
  cases: [],
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
