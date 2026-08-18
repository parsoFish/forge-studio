#!/usr/bin/env node
// W7-A0 — the walkthrough baseline may only SHRINK.
//
//   node scripts/ui-walkthrough/check-baseline-shrinks.mjs --against origin/main
//   node scripts/ui-walkthrough/check-baseline-shrinks.mjs --prev <file> --next <file>
//
// Compares the working-tree `baseline.json` (or --next) against the same file
// at a git ref (or --prev). Any entry present in next but not in prev is
// GROWTH → exit 1 listing the entries. A missing prev (the ref predates the
// baseline) is the file's first introduction → exit 0. Entries compare
// NORMALIZED (see assert.mjs), so id churn is not growth.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baselineGrowth } from './assert.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FORGE_ROOT = resolve(HERE, '..', '..');
const DEFAULT_BASELINE = resolve(HERE, 'baseline.json');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };

const nextFile = opt('--next') ?? DEFAULT_BASELINE;
const prevFile = opt('--prev');
const against = opt('--against');

function loadPrev() {
  if (prevFile) return existsSync(prevFile) ? JSON.parse(readFileSync(prevFile, 'utf8')) : null;
  if (!against) { console.error('usage: --against <gitref> | --prev <file> [--next <file>]'); process.exit(2); }
  const rel = relative(FORGE_ROOT, nextFile).split('\\').join('/');
  try {
    return JSON.parse(execFileSync('git', ['show', `${against}:${rel}`], { cwd: FORGE_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (e) {
    const msg = String(e?.stderr ?? e?.message ?? e);
    // Only "the file is not at that ref" is a first introduction. A bad ref
    // (typo, unfetched branch) must FAIL, not pass as "no previous baseline".
    if (/exists on disk, but not in|does not exist in/i.test(msg)) return null;
    throw new Error(`git show ${against}:${rel} failed: ${msg}`);
  }
}

const prev = loadPrev();
if (!existsSync(nextFile) && prev && (prev.entries?.length ?? 0) > 0) {
  console.error(`[baseline-shrinks] FAIL — ${nextFile} is missing but the previous baseline had ${prev.entries.length} entries; removing the file is not a shrink (the gate would lose every known defect). Restore it and drop only the entries your PR fixes.`);
  process.exit(1);
}
const next = existsSync(nextFile) ? JSON.parse(readFileSync(nextFile, 'utf8')) : { entries: [] };
if (!Array.isArray(next.entries)) { console.error(`[baseline-shrinks] FAIL — ${nextFile} has no entries array`); process.exit(1); }
const { grew, shrank } = baselineGrowth(prev, next);
const label = prevFile ?? `${against}:${relative(FORGE_ROOT, nextFile)}`;
if (!prev) {
  console.log(`[baseline-shrinks] no previous baseline at ${label} — first introduction (${next.entries?.length ?? 0} entries), OK`);
  process.exit(0);
}
console.log(`[baseline-shrinks] vs ${label}: ${prev.entries?.length ?? 0} → ${next.entries?.length ?? 0} entries (${shrank.length} removed, ${grew.length} added)`);
if (grew.length) {
  console.error('[baseline-shrinks] FAIL — the walkthrough baseline may only shrink. New entries:');
  for (const e of grew) console.error(`  ${e.kind.padEnd(16)} ${e.route}  →  ${e.detail}`);
  console.error('Fix the route/request instead of baselining it (baseline entries are wave-7 known defects, each owned by a lane).');
  process.exit(1);
}
process.exit(0);
