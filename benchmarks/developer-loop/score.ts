#!/usr/bin/env node
/**
 * Benchmark — Developer Loop. Skeleton. Walks `work-items/` for fixtures.
 */

import { readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dirname;
const fixturesDir = join(here, 'work-items');
const resultsDir = join(here, 'results');
if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
if (!existsSync(fixturesDir)) mkdirSync(fixturesDir, { recursive: true });

const fixtures = readdirSync(fixturesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const ranAt = new Date().toISOString();
const passed = 0;

const summary = {
  phase: 'developer-loop',
  ran_at: ranAt,
  cases: [],
  summary: {
    total: fixtures.length,
    passed,
    failed: fixtures.length - passed,
    accuracy: fixtures.length === 0 ? 1 : passed / fixtures.length,
  },
};

const out = JSON.stringify(summary, null, 2);
writeFileSync(join(resultsDir, `${ranAt.replace(/[:.]/g, '-')}.json`), out);
console.log(out);
console.log(`\n${passed}/${fixtures.length} fixtures passed`);
