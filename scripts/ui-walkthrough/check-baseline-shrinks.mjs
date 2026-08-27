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
// recorded — see assert.mjs isRegeneration) WHOSE SHA THIS SCRIPT VERIFIES FOR
// REAL (W8-F5): it must resolve to a commit (`git cat-file -e <sha>^{commit}`)
// and be an ancestor of the comparison base (`git merge-base --is-ancestor
// <sha> <base>`, base = --against when given, else HEAD). A shallow checkout
// gets exactly one bounded attempt to fetch that single object before this
// refuses the regeneration — fail-closed, no bypass. Reported as such; a drop
// in any `expectedRoutes.<env>` versus prev is called out loudly (coverage
// regressions must be justified in the PR).
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

function isShallowRepo() {
  try {
    return execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: FORGE_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() === 'true';
  } catch {
    return false;
  }
}

function commitExists(sha) {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: FORGE_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/** W8-F5 — the ONLY real check standing between a `main@<sha>` stamp and an
 *  accepted growth: the sha must resolve to a commit object, AND that commit
 *  must be an ancestor of `base`. A shallow checkout gets exactly ONE bounded
 *  attempt to fetch precisely that object before this fails closed — never a
 *  warn-and-continue, never a bypass env var. */
function verifyRegenerationSha(sha, base) {
  if (!commitExists(sha)) {
    if (isShallowRepo()) {
      try {
        // W8-F5 review: BOUNDED means bounded in wall-clock too — execFileSync
        // enforces no time limit unless `timeout` is passed, and a stalled remote
        // (auth prompt, dead proxy, DNS hang) would otherwise block the gate
        // indefinitely. 15 s is far more than a single-object fetch needs.
        execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', sha], { cwd: FORGE_ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 });
      } catch {
        // The re-check below reports the failure either way.
      }
    }
    if (!commitExists(sha)) {
      return {
        ok: false,
        reason: `sha ${sha} does not resolve to a commit object in this repository`
          + (isShallowRepo()
            ? ' (checkout is shallow; a bounded `git fetch --depth=1 origin <sha>` attempt also failed) — regenerate from a checkout that can see this commit (fetch-depth: 0) and re-run --write-baseline'
            : ' — this is not a real commit; regenerate with `--write-baseline` from an actual checkout of main so the stamp names a real sha'),
      };
    }
  }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, base], { cwd: FORGE_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true };
  } catch {
    // W8-F5 round 3, MEASURED: in a shallow checkout the bounded fetch above
    // can make the object RESOLVE while its ancestry link is still outside the
    // grafted history, so `--is-ancestor` answers "no" for a stamp that is
    // perfectly legitimate. The refusal stands either way (fail-closed is the
    // whole point), but the operator must be told the real cause — "your stamp
    // is bogus" and "this checkout cannot answer the question" are different
    // problems with different fixes.
    if (isShallowRepo()) {
      return {
        ok: false,
        reason: `sha ${sha} resolves, but this checkout is SHALLOW and cannot answer whether it is an ancestor of ${base} (the history is grafted, so \`git merge-base --is-ancestor\` says "no" for commits it simply cannot see) — refusing rather than guessing. Re-run where the full history is present (actions/checkout with fetch-depth: 0, and no later \`git fetch --depth=<n>\`, which re-shallows a full clone).`,
      };
    }
    return { ok: false, reason: `sha ${sha} resolves but is not an ancestor of ${base} — a regeneration stamp must name a commit actually on this history, not an arbitrary sha; re-stamp from a real ancestor commit and re-run --write-baseline` };
  }
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
// The commit the stamped sha must be an ancestor OF. `--against <ref>` names it
// explicitly (how every real gate invocation runs — CI passes
// `--against origin/$BASE_REF`, the wave gate passes `--against parsoFish/main`).
// A `--prev/--next` file comparison has no named base, so ancestry falls back to
// local `HEAD` — which on a PR checkout is the PR branch itself, a WEAKER
// question than "is this really on main". W8-F5 review: say so out loud rather
// than let a future caller mistake the weaker check for the strong one.
const compareBase = against ?? 'HEAD';
let stampRefusal = null;
const regenerated = isRegeneration(prev, next, {
  verifyStamp: (sha) => {
    if (!against) {
      console.warn(`[baseline-shrinks] NOTE — no --against ref given, so the regeneration stamp's ancestry is checked against local HEAD (${compareBase}), not a named base. A gate invocation should pass --against <ref>.`);
    }
    const v = verifyRegenerationSha(sha, compareBase);
    if (!v.ok) stampRefusal = v.reason;
    return v.ok;
  },
});
if (regenerated) {
  console.log(`[baseline-shrinks] REGENERATED baseline: ${String(prev.source ?? '(unstamped)').split(' — ')[0]} → ${String(next.source).split(' — ')[0]} (generatedAt ${prev.generatedAt ?? '?'} → ${next.generatedAt}) — growth (+${grew.length}) accepted only because this is a stamped regeneration from main; the host wave gate re-verifies it`);
  for (const k of COVERAGE_KEYS) {
    const before = prev.expectedRoutes?.[k];
    const after = next.expectedRoutes?.[k];
    // A key the previous file had that the regeneration LOST is not a lower
    // floor, it is no floor: the next crawl in that environment fails closed.
    // Fail here, at PR time (carry the other environment's expectation forward —
    // --write-baseline over the existing file does that; a fresh file does not).
    if (Number.isInteger(before) && !Number.isInteger(after)) {
      console.error(`[baseline-shrinks] FAIL — expectedRoutes.${k} was ${before} in the previous baseline and is missing from the regenerated one; regenerate over the existing file (--write-baseline scripts/ui-walkthrough/baseline.json) so the other environment's expectation is carried forward`);
      process.exit(1);
    }
    if (Number.isInteger(before) && Number.isInteger(after) && after < before) {
      console.log(`[baseline-shrinks] WARNING expectedRoutes.${k} dropped ${before} → ${after} — the coverage floor for ${k} just got lower; the PR must say why (routes retired?)`);
      if (process.env.GITHUB_ACTIONS) console.log(`::warning title=walkthrough coverage floor lowered::expectedRoutes.${k} ${before} → ${after}`);
    }
  }
} else if (grew.length) {
  console.error('[baseline-shrinks] FAIL — the walkthrough baseline may only shrink. New entries:');
  for (const e of grew) console.error(`  ${e.kind.padEnd(17)} ${e.route}  →  ${e.detail}`);
  if (stampRefusal) {
    console.error(`[baseline-shrinks] a \`main@<sha>\` stamp was present but REFUSED (fail-closed) — this growth is not an authorised regeneration: ${stampRefusal}`);
  }
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
