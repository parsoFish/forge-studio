#!/usr/bin/env node
/**
 * check-owner — every production file has exactly one owner package.
 *
 * THE CONSTRAINT THIS ENFORCES. The spec's governance section (§8): "One
 * session = one package: a lane may touch its package, its routes and tests,
 * plus additive-only contracts/kernel edits named in the PR title;
 * `check-owner.mjs` + dependency-cruiser fail anything else." A lane cannot
 * be held to one package while the tree has files no package claims — the
 * question "whose file is this?" has to have an answer before the M3 move,
 * and `QUARRY.md` is that answer.
 *
 * `QUARRY.md` (repo root) is the single source: one row per production file
 * under `orchestrator/ cli/ loops/ skills/`, giving the owner package, the
 * disposition it will be moved under, and its line count.
 *
 *     | path | owner | disposition | loc |
 *
 * WHAT FAILS. `unowned` — a file in the tree with no row — is ratcheted
 * through `scripts/baselines/owner.json` and must reach **zero** by the
 * skeleton PR. The other four classes have NO baseline and always fail,
 * because each is cheap to keep at zero and each makes the file silently
 * lie: an `orphan` row (no such file) makes the quarry describe a tree that
 * does not exist, a `duplicate` row gives one file two owners, and an owner
 * or disposition outside the vocabulary is a typo that would survive the
 * move.
 *
 * RUN: node scripts/check-owner.mjs [--json] [--quarry <path>] [--baseline <path>]
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The nine packages plus the two apps — `1.0.md` §0 and spec §3. */
export const OWNERS = Object.freeze([
  'contracts', 'kernel', 'library', 'knowledge', 'projects',
  'agents', 'sessions', 'flows', 'factory', 'apps/forge', 'apps/studio',
]);

/** `1.0.md` §4 M2 Lane A. */
export const DISPOSITIONS = Object.freeze(['verbatim', 'pruned', 'rewritten', 'deleted']);

/** The four legacy trees the quarry accounts for. */
const QUARRIED_TREES = ['orchestrator', 'cli', 'loops', 'skills'];
const CODE = ['.ts', '.tsx', '.mjs', '.js', '.cjs'];
const NOT_PRODUCTION = /(\.test\.[cm]?[jt]sx?$)|(^|\/)test-fixtures\//;

/**
 * The production files the quarry must account for: code under the four
 * legacy trees, plus the SKILL.md agent definitions, which are production
 * artifacts (ADR 024 — the SKILL.md IS the agent) and move as such.
 */
export function productionFiles(root) {
  const out = execFileSync('git', ['ls-files', ...QUARRIED_TREES], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((p) => !NOT_PRODUCTION.test(p))
    .filter((p) => CODE.some((e) => p.endsWith(e)) || /^skills\/[^/]+\/SKILL\.md$/.test(p))
    .sort();
}

/** Parses every `| path | owner | disposition | loc |` row out of QUARRY.md. */
export function parseQuarry(markdown) {
  const rows = [];
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    const [path, owner, disposition, loc] = cells;
    if (!QUARRIED_TREES.some((t) => path.startsWith(`${t}/`))) continue; // a header or a prose table
    rows.push({ path, owner, disposition, loc: Number.parseInt(loc, 10) });
  }
  return rows;
}

export function audit(root, quarryMarkdown) {
  const tree = new Set(productionFiles(root));
  const rows = parseQuarry(quarryMarkdown);

  const seen = new Map();
  const duplicates = [];
  for (const row of rows) {
    if (seen.has(row.path)) duplicates.push(row.path);
    else seen.set(row.path, row);
  }

  const unowned = [...tree].filter((p) => !seen.has(p)).sort();
  const orphans = [...seen.keys()].filter((p) => !tree.has(p)).sort();
  const badOwner = rows.filter((r) => !OWNERS.includes(r.owner)).map((r) => `${r.path} (owner "${r.owner}")`).sort();
  const badDisposition = rows.filter((r) => !DISPOSITIONS.includes(r.disposition)).map((r) => `${r.path} (disposition "${r.disposition}")`).sort();
  const badLoc = rows.filter((r) => !Number.isInteger(r.loc) || r.loc < 0).map((r) => r.path).sort();

  return { files: tree.size, rows: rows.length, unowned, orphans, duplicates: [...new Set(duplicates)].sort(), badOwner, badDisposition, badLoc };
}

function readBaseline(path) {
  if (!existsSync(path)) return { unowned: 0 };
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || !Number.isInteger(parsed.unowned)) {
    throw new Error(`${path}: expected { "unowned": <integer> }`);
  }
  return parsed;
}

function main(argv) {
  const json = argv.includes('--json');
  const qAt = argv.indexOf('--quarry');
  const bAt = argv.indexOf('--baseline');
  const quarryPath = qAt === -1 ? join(ROOT, 'QUARRY.md') : resolve(argv[qAt + 1]);
  const baselinePath = bAt === -1 ? join(ROOT, 'scripts/baselines/owner.json') : resolve(argv[bAt + 1]);

  if (!existsSync(quarryPath)) {
    process.stdout.write(`check-owner: FAIL — ${quarryPath} does not exist; the quarry is the source of ownership\n`);
    return 1;
  }

  const result = audit(ROOT, readFileSync(quarryPath, 'utf8'));
  const baseline = readBaseline(baselinePath);
  const over = result.unowned.length > baseline.unowned;
  const stale = result.unowned.length < baseline.unowned;
  const hard = result.orphans.length + result.duplicates.length + result.badOwner.length + result.badDisposition.length + result.badLoc.length;

  if (json) process.stdout.write(`${JSON.stringify({ ...result, baselineUnowned: baseline.unowned }, null, 2)}\n`);

  if (!over && !stale && hard === 0) {
    if (!json) {
      process.stdout.write(
        `check-owner: PASS — ${result.rows} rows own ${result.files} production files, unowned: ${result.unowned.length}\n`,
      );
    }
    return 0;
  }

  if (!json) {
    for (const p of result.unowned.slice(0, 20)) process.stdout.write(`  unowned: ${p} — add a QUARRY.md row naming its package\n`);
    if (result.unowned.length > 20) process.stdout.write(`  … and ${result.unowned.length - 20} more unowned\n`);
    for (const p of result.orphans) process.stdout.write(`  orphan row: ${p} — QUARRY.md claims a file that is not in the tree\n`);
    for (const p of result.duplicates) process.stdout.write(`  duplicate row: ${p} — a file has exactly one owner\n`);
    for (const p of result.badOwner) process.stdout.write(`  unknown owner: ${p} — one of ${OWNERS.join(', ')}\n`);
    for (const p of result.badDisposition) process.stdout.write(`  unknown disposition: ${p} — one of ${DISPOSITIONS.join(', ')}\n`);
    for (const p of result.badLoc) process.stdout.write(`  bad loc: ${p} — the row's line count must be a non-negative integer\n`);
    if (over) process.stdout.write(`check-owner: FAIL — ${result.unowned.length} unowned files, above the baseline of ${baseline.unowned}\n`);
    else if (stale) process.stdout.write(`check-owner: FAIL — ${result.unowned.length} unowned files, below the baseline of ${baseline.unowned}; tighten scripts/baselines/owner.json\n`);
    else process.stdout.write(`check-owner: FAIL — ${hard} row error(s); these have no baseline\n`);
  }
  return 1;
}

// Run only when executed directly — helpers here are imported by tests and by
// tooling, and an import must not run the check.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
