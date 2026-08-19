#!/usr/bin/env node
// W7-A0 — the walkthrough baseline may only SHRINK.
//
//   node scripts/ui-walkthrough/check-baseline-shrinks.mjs --against origin/main
//   node scripts/ui-walkthrough/check-baseline-shrinks.mjs --prev <file> --next <file>
//     [--crawled <crawl.json>] [--fail-unproven]
//
// Compares the working-tree `baseline.json` (or --next) against the same file
// at a git ref (or --prev). Any entry present in next but not in prev is
// GROWTH → exit 1 listing the entries. A missing prev at the REF (the ref
// predates the baseline) is the file's first introduction → exit 0; an
// explicitly passed --prev that does not exist is a usage error → exit 2
// (W7-A0-7). Entries compare NORMALIZED (see assert.mjs), so id churn is not
// growth.
//
// The one way the file may grow: a stamped REGENERATION from main
// (`source: "main@<sha> …"` with a new sha, newer generatedAt, expectedRoutes
// recorded — see assert.mjs isRegeneration). Reported as such; a drop in any
// `expectedRoutes.<env>` versus prev is called out loudly (coverage regressions
// must be justified in the PR).
//
// W7-A0-4 — removals are cross-checked against what the gate crawl actually
// visited (`--crawled <crawl.json>`): a removed entry whose route the crawl
// never reached is UNPROVEN — the crawl gate could not have contradicted the
// removal in this environment. Printed loudly (`::warning::` in CI) and exit 0
// by default, because CI's clean-checkout Studio structurally cannot reach the
// host-only routes (run/session pages); `--fail-unproven` turns it into exit 1
// for the environment that CAN prove them (the operator host / wave gate).
// A stamped regeneration's removals are proven by the regeneration crawl
// itself and are not cross-checked.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baselineGrowth, isRegeneration, unprovenShrinks, COVERAGE_KEYS } from './assert.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FORGE_ROOT = resolve(HERE, '..', '..');
const DEFAULT_BASELINE = resolve(HERE, 'baseline.json');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const usage = (msg) => { console.error(`[baseline-shrinks] usage error: ${msg}\nusage: --against <gitref> | --prev <file> [--next <file>] [--crawled <crawl.json>] [--fail-unproven]`); process.exit(2); };

const nextFile = opt('--next') ?? DEFAULT_BASELINE;
const prevFile = opt('--prev');
const against = opt('--against');
const crawledFile = opt('--crawled');
const failUnproven = args.includes('--fail-unproven');
if (args.includes('--crawled') && !crawledFile) usage('--crawled needs a file');

function loadPrev() {
  if (prevFile) {
    if (!existsSync(prevFile)) usage(`--prev ${prevFile} does not exist (an absent previous baseline is only "first introduction" when the --against ref predates the file)`);
    return JSON.parse(readFileSync(prevFile, 'utf8'));
  }
  if (!against) usage('one of --against <gitref> or --prev <file> is required');
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

function loadCrawledRoutes() {
  if (!crawledFile) return null;
  if (!existsSync(crawledFile)) usage(`--crawled ${crawledFile} does not exist — the cross-check needs the crawl that ran (a missing crawl is not "nothing to check")`);
  const crawl = JSON.parse(readFileSync(crawledFile, 'utf8'));
  if (!Array.isArray(crawl?.results)) usage(`--crawled ${crawledFile} is not a crawl.json (no results array)`);
  return crawl.results.map((r) => String(r.route));
}

const prev = loadPrev();
const crawledRoutes = loadCrawledRoutes();
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
const regenerated = isRegeneration(prev, next);
if (regenerated) {
  console.log(`[baseline-shrinks] REGENERATED baseline: ${String(prev.source ?? '(unstamped)').split(' — ')[0]} → ${String(next.source).split(' — ')[0]} (generatedAt ${prev.generatedAt ?? '?'} → ${next.generatedAt}) — growth (+${grew.length}) accepted only because this is a stamped regeneration from main; the host wave gate re-verifies it`);
  for (const k of COVERAGE_KEYS) {
    const before = prev.expectedRoutes?.[k];
    const after = next.expectedRoutes?.[k];
    if (Number.isInteger(before) && Number.isInteger(after) && after < before) {
      console.log(`[baseline-shrinks] WARNING expectedRoutes.${k} dropped ${before} → ${after} — the coverage floor for ${k} just got lower; the PR must say why (routes retired?)`);
      if (process.env.GITHUB_ACTIONS) console.log(`::warning title=walkthrough coverage floor lowered::expectedRoutes.${k} ${before} → ${after}`);
    }
  }
} else if (grew.length) {
  console.error('[baseline-shrinks] FAIL — the walkthrough baseline may only shrink. New entries:');
  for (const e of grew) console.error(`  ${e.kind.padEnd(17)} ${e.route}  →  ${e.detail}`);
  console.error('Fix the route/request instead of baselining it (baseline entries are wave-7 known defects, each owned by a lane). The only accepted growth is a stamped `main@<sha>` regeneration via --write-baseline.');
  process.exit(1);
}
if (crawledRoutes && !regenerated && shrank.length) {
  const unproven = unprovenShrinks(shrank, crawledRoutes);
  if (unproven.length) {
    const head = `[baseline-shrinks] UNPROVEN removal${unproven.length === 1 ? '' : 's'} — ${unproven.length} of ${shrank.length} removed entr${shrank.length === 1 ? 'y was' : 'ies were'} on routes this crawl (${crawledRoutes.length} routes) never visited, so the gate could not contradict the removal:`;
    (failUnproven ? console.error : console.log)(head);
    for (const e of unproven) (failUnproven ? console.error : console.log)(`  ${e.kind.padEnd(17)} ${e.route}  →  ${e.detail}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=walkthrough baseline: unproven removal::${unproven.length} removed baseline entr${unproven.length === 1 ? 'y' : 'ies'} on routes the CI crawl never visited — verified only by the host wave gate`);
    if (failUnproven) {
      console.error('[baseline-shrinks] FAIL (--fail-unproven) — re-crawl the routes (operator host / wave gate) or regenerate the baseline from main.');
      process.exit(1);
    }
    console.log('[baseline-shrinks] (not failing: this environment may be unable to reach those routes — the operator-host wave gate runs with --fail-unproven)');
  } else {
    console.log(`[baseline-shrinks] every removed entry's route was crawled by this run — the crawl gate itself proves the removals`);
  }
}
process.exit(0);
