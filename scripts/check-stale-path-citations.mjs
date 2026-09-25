#!/usr/bin/env node
/**
 * check-stale-path-citations — dead repo-path citations, as a shrinking
 * ratchet (bead forge-8vfn.13).
 *
 * THE DEFECT THIS CLOSES (historical: a census taken 2026-09-04, before the
 * host carve, found 2,481 mentions of `cli/<name>.ts` in code comments and
 * prose for files that had moved or been deleted — 1,289 caused by the carve
 * itself, 1,192 left behind by earlier package moves — and nothing checked
 * for it: `brain-lint` covers brain citations, a docs-claims checker covers
 * docs claims, and code comments plus general prose had no guard at all. A
 * library sweep separately found dead runners named as BARE WORDS, not
 * paths, that two path-keyed sweeps missed).
 *
 * WHAT COUNTS AS A FINDING.
 *   path  A path-shaped token — one of KNOWN_ROOTS, then one or more
 *         `/segment`s, ending in a code/doc extension (optionally followed
 *         by `:<line>`, which is not part of the match and is ignored) —
 *         whose exact repo-relative path does not exist in the tree.
 *   stem  A bare basename (e.g. a retired `legacy-loader.ts`) of a file this
 *         repo once tracked and later deleted, where NO file anywhere in the
 *         current tree carries that basename today. Curated (see computeRetiredStems)
 *         to a kebab/snake-shaped, 6+ char stem whose deleted extension was
 *         a code extension — the repo's own retired module names all take
 *         this shape, and ordinary English prose almost never does.
 *
 * WHERE. Code comments only (not live code) in `.ts .tsx .mjs .js` files —
 * comment extraction is a crude, line-based, quote-aware scanner, the same
 * trade this tree already makes in check-request-path-sinks.mjs: it does not
 * parse template-literal `${...}` interpolation or regex literals. Prose in
 * `.md` files, except `brain/` (brain-lint's job), `docs/decisions/`
 * (history — ADRs record what used to be true) and `_1.0/` (gitignored
 * campaign scratch, never a permanent artifact).
 *
 * SUPPRESSION. A literal `historical:` anywhere on the physical line, or a
 * `(now at ...)` annotation anywhere on it, suppresses every finding on that
 * line. Line-grained, not proximity-grained — the same grain check-identity.mjs
 * and check-request-path-sinks.mjs already use for this class of lint.
 *
 * THE RATCHET (content-keyed, forge-8vfn.13 PR review). `scripts/baselines/
 * stale-path-citations.json` — a JSON array of `{file, kind, cited, count}`
 * rows, each an AUDITED OCCURRENCE BUDGET for that citation in that file.
 * The key is `file, kind, cited` — NEVER the line number, which is display
 * only. A line-keyed ratchet turns any unrelated line inserted ABOVE a
 * baselined citation into a false red for every PR that touches that file
 * afterward — measured the hard way on this guard's own first PR, when a
 * main merge shifted lines under it. Mirrors `PROJECTS_ROOT_FOLD_ALLOWLIST`
 * in check-raw-fs-guarded.allowlist.mjs, which took the identical fix for
 * the identical reason first. A key with no baseline row has an implicit
 * budget of 0. FAILS when a key's LIVE count exceeds its budget — new or
 * grown, the excess occurrences named by line — or a baseline row's budget
 * exceeds its live count (stale — the debt was paid and the ratchet must be
 * told). `--write` regenerates SHRINK-ONLY: with no baseline file yet, it
 * bootstraps from every current row; with one, every existing row's budget
 * can only fall (`min(old, current)`) or the row is dropped once its live
 * count reaches 0 — no row is ever added and no budget ever rises, so
 * `--write` can retire debt but can never launder a new or grown citation
 * into the baseline.
 *
 * RUN: node scripts/check-stale-path-citations.mjs [--json] [--write]
 *        [--baseline <path>] [--root <path>]
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Scanned-for-comments source extensions. */
const CODE_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js'];
/** Scanned-for-prose extensions. */
const PROSE_EXTENSIONS = ['.md'];
/** Prose trees excluded — each for a reason named in the header above. */
const EXCLUDED_PROSE_TREES = ['brain', 'docs/decisions', '_1.0'];

/**
 * Directory names a citation may start with. Includes trees this repo no
 * longer has (`cli`, `orchestrator`, `loops`, `forge-ui`) on purpose: those
 * are EXACTLY the retired roots the bead's census names, and a citation into
 * one of them is the shape this guard exists to catch.
 */
const KNOWN_ROOTS = [
  'apps', 'packages', 'scripts', 'skills', 'docs', 'tests', 'demos',
  'brain', 'projects', 'studio', 'bin',
  'cli', 'orchestrator', 'loops', 'forge-ui',
];
/** Extensions a CITED target may carry. */
const CITED_EXTENSIONS = ['ts', 'tsx', 'mjs', 'js', 'cjs', 'md', 'json'];

/**
 * A path-shaped token. `:line` is not captured — `\b` after the extension
 * already stops the match cleanly before a trailing `:42`, so the digits are
 * simply left unconsumed on the line rather than needing their own group.
 *
 * historical: the root is anchored with `\b(?<!\w\/)`, NOT a plain `\b`
 * alone, because a plain `\b` also matches a KNOWN_ROOTS name sitting one
 * level deep inside some other path — a fictional `components/studio/…`
 * has a `/` right before `studio`, and `\b` is satisfied there too (word
 * char after non-word char), so the match starts mid-path. Found by this
 * file's own sweep: a `--write` replace against that partial match
 * corrupted a real citation. `(?<!\w\/)` rejects only the specific 2-char
 * "word-char then slash" 2-gram right before the root, so a genuinely
 * NESTED path (`word/root/…`) is rejected while a markdown-style relative
 * prefix (`./orchestrator/…`, `(./skills/…`) still matches — the char before
 * the `/` there is `.` or `(`, never a word char. Plain `\b` alone is kept
 * too: it is what rejects a root glued onto a longer identifier, so a
 * fictional `xcli` module must not read as the real `cli` root.
 */
const PATH_TOKEN_RE = new RegExp(
  `\\b(?<!\\w/)(?:${KNOWN_ROOTS.join('|')})(?:/[A-Za-z0-9_.-]+)+\\.(?:${CITED_EXTENSIONS.join('|')})\\b`,
  'g',
);

const URL_RE = /\bhttps?:\/\/\S+/g;
const NOW_AT_RE = /\(now at [^)]*\)/i;
const HISTORICAL_MARKER = 'historical:';

/** Only these extensions, at time of deletion, can seed a retired stem — a
 *  retired MODULE is code; a deleted `.md` or `.json` is not one. */
const RETIRED_STEM_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
/** Below this, a compound-shaped stem is still too likely to be incidental. */
const MIN_STEM_LEN = 6;

export const EXIT_CANNOT_MEASURE = 75;

/** Thrown ONLY when the corpus (git) could not be read — never for a real
 *  violation. Mirrors check-file-size.mjs's CorpusUnreadable: a checker that
 *  cannot see the tree has no verdict, and 75 says so instead of red's 1. */
export class CorpusUnreadable extends Error {
  constructor(args, cause) {
    super(`git ${args.join(' ')} failed: ${cause?.message ?? cause}`);
    this.name = 'CorpusUnreadable';
  }
}

// ---------------------------------------------------------------------------
// Repo inspection
// ---------------------------------------------------------------------------

function git(root, args) {
  let out;
  try {
    out = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new CorpusUnreadable(args, err);
  }
  return out;
}

/** Every file git can see, committed or not, ignoring ignored paths. */
function listFiles(root) {
  return git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean);
}

/**
 * `git log --diff-filter=D` on a repo with zero commits (an "unborn branch")
 * exits 128 with "does not have any commits yet" — that is not a corpus we
 * cannot read, it is a corpus with NO deletion history, which every fixture
 * in this file's own test suite starts as before it plants any. Only that
 * specific, recognised shape is swallowed; anything else still throws as
 * CorpusUnreadable via the shared `git()` helper's error path.
 */
function gitLogDeletions(root) {
  try {
    return execFileSync(
      'git', ['log', '--no-renames', '--diff-filter=D', '--name-only', '--format='],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (err) {
    if (/does not have any commits yet/.test(err?.stderr ?? '')) return '';
    throw new CorpusUnreadable(['log', '--diff-filter=D', '--name-only'], err);
  }
}

function isExcludedProse(relPath) {
  return EXCLUDED_PROSE_TREES.some((t) => relPath === t || relPath.startsWith(`${t}/`));
}

function collectFiles(root) {
  const all = listFiles(root);
  const fullSet = new Set(all);
  const code = all.filter((p) => CODE_EXTENSIONS.some((ext) => p.endsWith(ext)));
  const prose = all.filter((p) => PROSE_EXTENSIONS.some((ext) => p.endsWith(ext)) && !isExcludedProse(p));
  return { fullSet, code, prose };
}

function basenameStem(relPath) {
  const base = relPath.split('/').pop();
  const dot = base.lastIndexOf('.');
  return dot === -1 ? base : base.slice(0, dot);
}

/**
 * The curated retired-stem set: a compound (`-`/`_`), 6+ char basename of a
 * file with a code extension that `git log` shows was deleted at some point,
 * AND that no file anywhere in the CURRENT tree still carries. Each clause
 * exists to keep false positives near zero (see the header):
 *   - code extension at deletion: a retired MODULE, not an incidental doc.
 *   - compound + length: this repo's real module names are kebab-case and
 *     rarely under 6 chars; ordinary short/plain English words are excluded.
 *   - not present today: a name still in use anywhere is not "retired".
 * `--no-renames` so a renamed-away file (delete of the old path) still
 * counts — a rename is exactly a retirement of the old basename.
 */
export function computeRetiredStems(root, fullSet) {
  const deleted = gitLogDeletions(root).split('\n');
  const present = new Set([...fullSet].map(basenameStem));
  const stems = new Set();
  for (const raw of deleted) {
    const p = raw.trim();
    if (!p) continue;
    const dot = p.lastIndexOf('.');
    if (dot === -1) continue;
    const ext = p.slice(dot);
    if (!RETIRED_STEM_EXTENSIONS.has(ext)) continue;
    const stem = basenameStem(p);
    if (!/[-_]/.test(stem)) continue;
    if (stem.length < MIN_STEM_LEN) continue;
    if (present.has(stem)) continue;
    stems.add(stem);
  }
  return stems;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One alternation regex for every curated stem, longest-first so a shorter
 *  stem that happens to prefix a longer one never shadows it. `null` when
 *  there is nothing to look for — the caller then skips the stem pass. */
export function buildStemRegex(stems) {
  if (stems.size === 0) return null;
  const escaped = [...stems].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'g');
}

// ---------------------------------------------------------------------------
// Comment extraction — crude and line-based, the house trade for this class
// of lint (see check-request-path-sinks.mjs's own documented blind spots:
// template-literal `${...}` interpolation and regex literals are not
// tokenized, so a `//` or `/*` inside either can misread as a comment
// boundary). It errs toward SCANNING MORE text, never toward skipping a real
// comment, which is the safe direction for a lint whose only job is to flag
// text that names a dead path.
// ---------------------------------------------------------------------------

/**
 * Comment span(s) on one physical line, carrying block-comment state across
 * lines. Returns `{ spans, inBlock }`; `spans` are `[start, end)` ranges of
 * `line` that are comment text.
 */
export function commentSpans(line, inBlockAtStart) {
  const spans = [];
  let i = 0;
  let inBlock = inBlockAtStart;
  if (inBlock) {
    const end = line.indexOf('*/');
    if (end === -1) return { spans: [[0, line.length]], inBlock: true };
    spans.push([0, end]);
    i = end + 2;
    inBlock = false;
  }
  let inStr = null;
  for (; i < line.length; i += 1) {
    const c = line[i];
    if (inStr) {
      if (c === '\\') { i += 1; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '/' && line[i + 1] === '/') {
      spans.push([i + 2, line.length]);
      return { spans, inBlock: false };
    }
    if (c === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2);
      if (end === -1) {
        spans.push([i + 2, line.length]);
        return { spans, inBlock: true };
      }
      spans.push([i + 2, end]);
      i = end + 1;
      continue;
    }
  }
  return { spans, inBlock: false };
}

// ---------------------------------------------------------------------------
// Line-level finding collection — shared by code-comment and prose scanning
// ---------------------------------------------------------------------------

function isSuppressed(rawLine) {
  return rawLine.includes(HISTORICAL_MARKER) || NOW_AT_RE.test(rawLine);
}

function maskUrls(text) {
  return text.replace(URL_RE, (m) => '\u0000'.repeat(m.length));
}

/**
 * Finds path and stem citations in `text` (the comment text for a code line,
 * or the whole line for prose) and pushes findings into `out`. Suppression is
 * checked against `rawLine` — the historical:/"(now at ...)" marker may sit
 * outside the matched comment span but still governs the whole physical line.
 * A path match is masked out of the working copy before the stem pass runs,
 * so a citation combining both shapes is one finding, not two.
 */
function collectLineFindings(relPath, lineNo, rawLine, text, fullSet, stemRe, out) {
  if (isSuppressed(rawLine)) return;
  const masked = maskUrls(text);
  let working = masked;
  const seen = new Set();

  PATH_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = PATH_TOKEN_RE.exec(masked)) !== null) {
    const cited = m[0];
    working = working.slice(0, m.index) + '\u0000'.repeat(cited.length) + working.slice(m.index + cited.length);
    if (fullSet.has(cited)) continue;
    const key = `path:${cited}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file: relPath, line: lineNo, kind: 'path', cited });
  }

  if (!stemRe) return;
  stemRe.lastIndex = 0;
  let s;
  while ((s = stemRe.exec(working)) !== null) {
    const cited = s[1];
    const key = `stem:${cited}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file: relPath, line: lineNo, kind: 'stem', cited });
  }
}

function scanCodeFile(root, relPath, fullSet, stemRe) {
  const lines = readFileSync(join(root, relPath), 'utf8').split('\n');
  const findings = [];
  let inBlock = false;
  lines.forEach((raw, idx) => {
    const spanResult = commentSpans(raw, inBlock);
    inBlock = spanResult.inBlock;
    if (spanResult.spans.length === 0) return;
    const text = spanResult.spans.map(([s, e]) => raw.slice(s, e)).join(' ');
    collectLineFindings(relPath, idx + 1, raw, text, fullSet, stemRe, findings);
  });
  return findings;
}

function scanProseFile(root, relPath, fullSet, stemRe) {
  const lines = readFileSync(join(root, relPath), 'utf8').split('\n');
  const findings = [];
  lines.forEach((raw, idx) => {
    collectLineFindings(relPath, idx + 1, raw, raw, fullSet, stemRe, findings);
  });
  return findings;
}

// ---------------------------------------------------------------------------
// Whole-tree scan + baseline comparison
// ---------------------------------------------------------------------------

export function scanAll(root) {
  const { fullSet, code, prose } = collectFiles(root);
  const stems = computeRetiredStems(root, fullSet);
  const stemRe = buildStemRegex(stems);
  const findings = [];
  for (const relPath of code) findings.push(...scanCodeFile(root, relPath, fullSet, stemRe));
  for (const relPath of prose) findings.push(...scanProseFile(root, relPath, fullSet, stemRe));
  findings.sort((a, b) => (a.file === b.file
    ? (a.line - b.line || a.cited.localeCompare(b.cited))
    : a.file.localeCompare(b.file)));
  return { findings, scannedCode: code.length, scannedProse: prose.length, retiredStemCount: stems.size };
}

/** The CONTENT key a baseline row and a live finding are compared by. Never
 *  includes the line — see the header's THE RATCHET section for why. */
export function contentKey(f) {
  return `${f.file}\u0000${f.kind}\u0000${f.cited}`;
}

function byFileKindCited(a, b) {
  if (a.file !== b.file) return a.file.localeCompare(b.file);
  if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
  return a.cited.localeCompare(b.cited);
}

/**
 * Groups raw per-line findings into one row per (file, kind, cited): a
 * COUNT (the number of distinct lines bearing that citation in that file)
 * and the ordered list of lines it was found on, kept for display only.
 */
export function groupFindings(findings) {
  const rows = new Map();
  for (const f of findings) {
    const key = contentKey(f);
    let row = rows.get(key);
    if (!row) {
      row = { file: f.file, kind: f.kind, cited: f.cited, count: 0, lines: [] };
      rows.set(key, row);
    }
    row.count += 1;
    row.lines.push(f.line);
  }
  return rows;
}

/**
 * Compares a live scan against a baseline — an array of `{file, kind, cited,
 * count}` audited-occurrence-budget rows (see THE RATCHET in the header).
 * `introduced` rows exceed their budget (or have none, budget 0); each
 * carries `newLines`, the occurrences beyond the audited budget, for a
 * human to find. `stale` rows have a live count BELOW their budget — the
 * ratchet has room to tighten, reported non-fatally so `--write` has
 * something to shrink.
 */
export function audit(root, baselineRows) {
  const scan = scanAll(root);
  const grouped = groupFindings(scan.findings);
  const budgets = new Map(baselineRows.map((row) => [contentKey(row), row.count]));

  const introduced = [];
  for (const row of grouped.values()) {
    const budget = budgets.get(contentKey(row)) ?? 0;
    if (row.count > budget) {
      introduced.push({
        file: row.file, kind: row.kind, cited: row.cited,
        budget, count: row.count, newLines: row.lines.slice(budget),
      });
    }
  }
  introduced.sort(byFileKindCited);

  const stale = [];
  for (const row of baselineRows) {
    const current = grouped.get(contentKey(row))?.count ?? 0;
    if (current < row.count) {
      stale.push({ file: row.file, kind: row.kind, cited: row.cited, budget: row.count, current });
    }
  }
  stale.sort(byFileKindCited);

  const currentRows = [...grouped.values()]
    .map(({ file, kind, cited, count }) => ({ file, kind, cited, count }))
    .sort(byFileKindCited);

  return {
    scannedCode: scan.scannedCode,
    scannedProse: scan.scannedProse,
    retiredStems: scan.retiredStemCount,
    totalFindings: scan.findings.length,
    totalKeys: grouped.size,
    baselinedKeys: baselineRows.length,
    currentRows,
    introduced,
    stale,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readBaselineRows(path) {
  if (!existsSync(path)) return null; // signals "no baseline yet" to --write
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${path}: expected an array of {file, kind, cited, count} rows`);
  }
  for (const row of parsed) {
    const shapeOk = row && typeof row === 'object'
      && typeof row.file === 'string' && typeof row.kind === 'string'
      && typeof row.cited === 'string' && Number.isInteger(row.count) && row.count > 0;
    if (!shapeOk) {
      throw new Error(`${path}: every row needs {file, kind, cited, count>0} — got ${JSON.stringify(row)}`);
    }
  }
  return parsed;
}

function main(argv) {
  const json = argv.includes('--json');
  const write = argv.includes('--write');
  const atB = argv.indexOf('--baseline');
  const baselinePath = atB === -1 ? join(ROOT, 'scripts/baselines/stale-path-citations.json') : resolve(argv[atB + 1]);
  const atR = argv.indexOf('--root');
  const root = atR === -1 ? ROOT : resolve(argv[atR + 1]);

  let existing;
  let result;
  try {
    existing = readBaselineRows(baselinePath);
    result = audit(root, existing ?? []);
  } catch (err) {
    if (!(err instanceof CorpusUnreadable)) throw err;
    process.stderr.write(
      `check-stale-path-citations: REFUSED — ${err.message}\n` +
      `  This is NOT a finding. The corpus could not be enumerated, so there is no\n` +
      `  verdict to give; exiting ${EXIT_CANNOT_MEASURE} rather than 1. Root read as ${root}.\n`,
    );
    return EXIT_CANNOT_MEASURE;
  }

  if (write) {
    // SHRINK-ONLY, count-aware. No baseline on disk yet -> bootstrap from
    // every current row (first-time creation). A baseline that already
    // exists -> each row's budget can only fall to `min(old, current live
    // count)`, and a row whose live count is now 0 is dropped entirely — no
    // row is ever added and no budget ever rises, so --write can retire
    // debt but never launder a new or grown citation in.
    const liveCounts = new Map(result.currentRows.map((r) => [contentKey(r), r.count]));
    const before = existing === null ? 0 : existing.length;
    const beforeTotal = existing === null ? 0 : existing.reduce((sum, r) => sum + r.count, 0);
    const nextBaseline = existing === null
      ? result.currentRows
      : existing
        .map((row) => ({ ...row, count: Math.min(row.count, liveCounts.get(contentKey(row)) ?? 0) }))
        .filter((row) => row.count > 0)
        .sort(byFileKindCited);
    const afterTotal = nextBaseline.reduce((sum, r) => sum + r.count, 0);
    writeFileSync(baselinePath, `${JSON.stringify(nextBaseline, null, 2)}\n`);
    process.stdout.write(
      `check-stale-path-citations: baseline written — ${before} -> ${nextBaseline.length} row(s), ` +
      `${beforeTotal} -> ${afterTotal} total citation(s) (shrink-only; a new/grown row is never added by --write)\n`,
    );
    return 0;
  }

  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  const failed = result.introduced.length + result.stale.length;
  if (failed === 0) {
    if (!json) {
      process.stdout.write(
        `check-stale-path-citations: PASS — ${result.totalFindings} citation(s) across ${result.totalKeys} key(s) baselined ` +
        `(${result.scannedCode} code files, ${result.scannedProse} prose files, ` +
        `${result.retiredStems} curated retired stem(s))\n`,
      );
    }
    return 0;
  }

  if (!json) {
    for (const f of result.introduced) {
      const what = f.kind === 'stem' ? 'a retired-module bare basename' : 'a dead path citation';
      const at = `line${f.newLines.length === 1 ? '' : 's'} ${f.newLines.join(', ')}`;
      if (f.budget === 0) {
        process.stdout.write(`  ${f.file}: NEW — ${what} "${f.cited}" (${at})\n`);
      } else {
        process.stdout.write(
          `  ${f.file}: EXCEEDED budget for ${what} "${f.cited}" — audited ${f.budget}, now ${f.count} (new occurrence(s) at ${at})\n`,
        );
      }
    }
    for (const s of result.stale) {
      process.stdout.write(
        `  stale baseline entry: ${s.file} ${s.kind} "${s.cited}" — audited ${s.budget}, now ${s.current}; run --write to tighten the ratchet.\n`,
      );
    }
    process.stdout.write(`check-stale-path-citations: FAIL — ${failed} violation(s) (forge-8vfn.13)\n`);
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
