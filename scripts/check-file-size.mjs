#!/usr/bin/env node
/**
 * check-file-size — the 800-line hard file cap, as a shrinking ratchet.
 *
 * THE CONSTRAINT THIS ENFORCES. `docs/roadmaps/1.0.md` §0: "File hard cap
 * **800 lines**, enforced by lint from M2." The spec's governance section
 * (§8) states it the same way: "the 800-line file rule enforced by lint, not
 * prose". Prose is what it was until now — 115 code files are over the cap
 * on the day this lands, and nothing anywhere said so.
 *
 * HOW THE RATCHET WORKS. `scripts/baselines/file-size.json` records every
 * file that is over the cap today, with its line count. Three things fail:
 *
 *   new     a file over the cap with no baseline entry — the cap bites for
 *           every file written from M2 onwards, which is the point.
 *   grew    a baselined file whose count went UP — an exemption is a debt
 *           ceiling, not a licence.
 *   stale   a baseline entry for a file now under the cap or gone — the
 *           ratchet must be tightened when the debt is paid, or the next
 *           file to grow into that slot inherits a free pass.
 *
 * There is no `--write-baseline`. Shrinking the ratchet is a deliberate edit
 * to the JSON, and the `stale` failure tells you the exact line to remove.
 *
 * SCOPE. Code files only (`.ts .tsx .mjs .js .cjs`), tracked or untracked-
 * but-not-ignored (`git ls-files --cached --others --exclude-standard`), so a
 * file cannot dodge the cap by not being committed yet. `package-lock.json`
 * and generated lockfiles are not code. Markdown is NOT in scope: the docs
 * cull is a separate duty with its own budget (spec §4 "Docs").
 *
 * RUN: node scripts/check-file-size.mjs [--json] [--baseline <path>]
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** `docs/roadmaps/1.0.md` §0. The only place this number is written. */
export const HARD_CAP_LINES = 800;

const CODE_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.cjs'];
const NOT_CODE = new Set(['package-lock.json']);

/** Every code file git can see, committed or not, ignoring ignored paths. */
function codeFiles(root) {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((p) => CODE_EXTENSIONS.some((e) => p.endsWith(e)) && !NOT_CODE.has(p));
}

/**
 * `wc -l` semantics: the number of newline characters in the file.
 *
 * Returns `null` for a path that has VANISHED between the glob and this read.
 * The caller's `existsSync` above is a time-of-check/time-of-use gap, not a
 * guarantee: the checker walks the live tree, and a sibling guard test plants
 * and removes real files in that tree to prove its own checker sees them
 * (`scripts/check-disabled-reason.test.ts` and its
 * `apps/studio/components/__ratchet_probe__.tsx`). Test FILES run in parallel
 * processes under `node:test`, so this checker can glob a probe and then read
 * it after the sibling has deleted it — which crashed the whole audit with an
 * ENOENT stack and reds a lane's CI for a reason no diff caused
 * (`_1.0/known-flakes.md` #6, root-caused from a CI failure on PR #341).
 *
 * A file that no longer exists has no size to check, so skipping it is the
 * honest answer rather than a tolerance: it narrows nothing, widens nothing,
 * and no other error is swallowed — anything but ENOENT still throws.
 */
export function lineCount(absolute) {
  let text;
  try {
    text = readFileSync(absolute, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
  let n = 0;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) n += 1;
  return n;
}

function readBaseline(path) {
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path}: expected an object of "<path>": <lines>`);
  }
  return parsed;
}

/**
 * Compares the tree against the baseline. Returns the three failure classes
 * plus the population sizes, so a caller can prove the checker looked at
 * something.
 */
export function audit(root, baseline) {
  const files = codeFiles(root);
  const sizes = new Map();
  for (const rel of files) {
    const absolute = join(root, rel);
    if (!existsSync(absolute)) continue; // a deleted-but-staged path
    const lines = lineCount(absolute);
    if (lines === null) continue; // vanished after the check above — see lineCount
    sizes.set(rel, lines);
  }

  const newOversize = [];
  const grown = [];
  for (const [rel, lines] of sizes) {
    if (lines <= HARD_CAP_LINES) continue;
    const allowed = baseline[rel];
    if (allowed === undefined) newOversize.push({ path: rel, lines });
    else if (lines > allowed) grown.push({ path: rel, lines, allowed });
  }

  const stale = [];
  for (const rel of Object.keys(baseline)) {
    const lines = sizes.get(rel);
    if (lines === undefined) stale.push({ path: rel, reason: 'file no longer exists' });
    else if (lines <= HARD_CAP_LINES) stale.push({ path: rel, reason: `now ${lines} lines, at or under the cap` });
  }

  return { cap: HARD_CAP_LINES, checked: sizes.size, baselined: Object.keys(baseline).length, newOversize, grown, stale };
}

function main(argv) {
  const json = argv.includes('--json');
  const at = argv.indexOf('--baseline');
  const baselinePath = at === -1 ? join(ROOT, 'scripts/baselines/file-size.json') : resolve(argv[at + 1]);

  const result = audit(ROOT, readBaseline(baselinePath));
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }

  const failed = result.newOversize.length + result.grown.length + result.stale.length;
  if (failed === 0) {
    if (!json) {
      process.stdout.write(
        `check-file-size: PASS — ${result.checked} code files, ${result.baselined} baselined over the ${HARD_CAP_LINES}-line cap\n`,
      );
    }
    return 0;
  }

  if (!json) {
    for (const f of result.newOversize) {
      process.stdout.write(`  ${f.path}: ${f.lines} lines — over the ${HARD_CAP_LINES}-line cap and not baselined. Split it.\n`);
    }
    for (const f of result.grown) {
      process.stdout.write(`  ${f.path}: grew from ${f.allowed} to ${f.lines} lines — an exemption is a ceiling, not a licence.\n`);
    }
    for (const f of result.stale) {
      process.stdout.write(`  ${f.path}: stale baseline entry (${f.reason}) — remove it from the baseline to tighten the ratchet.\n`);
    }
    process.stdout.write(`check-file-size: FAIL — ${failed} violation(s) of the ${HARD_CAP_LINES}-line cap (1.0.md §0)\n`);
  }
  return 1;
}

// Run only when executed directly — helpers here are imported by tests and by
// tooling, and an import must not run the check.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
