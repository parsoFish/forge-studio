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
 *         repo once tracked and later deleted, where NO file OR DIRECTORY
 *         anywhere in the current tree carries that basename today. Curated
 *         to a kebab/snake-shaped, 6+ char stem whose deleted extension was
 *         a code extension — the repo's own retired module names all take
 *         this shape, and ordinary English prose almost never does. See
 *         DETERMINISM below for where the candidate list comes from.
 *
 * DETERMINISM (forge-8vfn.13 CI incident, 2026-09-25). The CHECK never runs
 * `git log` — only `git ls-files` (the current tree, always complete
 * regardless of clone depth). Retired-stem CANDIDATES (the git-log-derived
 * half of "stem", above) are COMMITTED DATA: `scripts/baselines/stale-path-
 * retired-stems.json`, an array of stems, regenerated only by `--write`
 * (which may run `git log` — a developer's local clone, always full depth)
 * and read as-is by every plain check. CI's `actions/checkout` defaults to
 * a depth-1 (shallow) clone: `git log --diff-filter=D` on a shallow clone
 * sees no history, so EVERY stem the git-log path had ever curated read as
 * gone, and every stem baseline row FAILED as stale — a lint whose verdict
 * depends on clone depth is not deterministic, and this shape (343
 * violations, all "stale … now 0") is what that failure mode looks like.
 * The "is it still present" half of curation stays LIVE at check time (a
 * cheap `git ls-files`-only Set lookup, not history) so a committed
 * candidate whose name gets reused later is still correctly excluded —
 * committing the CANDIDATES, not the final curated set, keeps that
 * self-correcting property. Adding a newly-retired stem to the committed
 * set = running `--write` locally and committing the diff, reviewed like
 * any other baseline change.
 *
 * WHERE. Code comments only (not live code) in `.ts .tsx .mjs .js` files —
 * comment extraction is a crude, line-based, quote-aware scanner, the same
 * trade this tree already makes in check-request-path-sinks.mjs: it does not
 * parse template-literal `${...}` interpolation or regex literals. Prose in
 * `.md` files, except `brain/` (brain-lint's job), `docs/decisions/`
 * (history — ADRs record what used to be true), `_1.0/` (gitignored
 * campaign scratch, never a permanent artifact), and individual files named
 * in EXCLUDED_PROSE_FILES below (their own reason travels with each entry —
 * mirrors check-identity.mjs's EXCLUDED_FILES for the same class of file: a
 * record whose job is to be accurate about the PAST, not the present).
 *
 * SUPPRESSION. A literal marker anywhere on the physical line, or a
 * `(now at ...)` annotation anywhere on it, suppresses every finding on
 * that line. Line-grained, not proximity-grained — the same grain
 * check-identity.mjs and check-request-path-sinks.mjs already use for this
 * class of lint. Three markers, one mechanism (SUPPRESSION_MARKERS below;
 * add a fourth there, not a new code path, if another false-positive class
 * turns up) — pick the one that names WHY the cited path isn't a live
 * forge-repo citation:
 *   historical:  the path/stem WAS real, describing what used to be true
 *                (a past bug repro, a since-retired module, a split-out
 *                file) — never rewrite the sentence's meaning, only mark it.
 *   example:     the path is FICTIONAL — invented prose illustrating a
 *                pattern or format (example: `docs/foo.md:42` in a sentence
 *                explaining what a citation LOOKS like), never a real repo
 *                path at any point in time.
 *   project:     the path is real, but in the TARGET PROJECT's repo a
 *                skill/flow operates on (project: e.g. a `loops/ralph/runner.ts`
 *                a generated-project template ships) — never this repo,
 *                forge's own. Common in packages/forge-docs and any other
 *                skills/ tree that authors instructions FOR an agent
 *                working a managed project, not for forge itself.
 * Found via forge-docs skills reaching every one of the three shapes at
 * once on landing (bead forge-8vfn.13 PR review): a lint that only knew
 * `historical:` would either miss real dead forge citations forever (by
 * exempting every skills/ path) or red every new skill package that cites
 * its own examples or the project it instructs.
 *
 * WHY NOT A skills/ DEFAULT INSTEAD OF MARKERS. Considered defaulting any
 * skills/**\/SKILL.md citation whose root isn't a CURRENT forge top-level
 * dir to "assume project-relative, don't flag". Rejected: the retired
 * roots that make a citation project-relative in a target repo (`loops/`,
 * the ralph pattern) are the SAME retired roots (`cli/`, `orchestrator/`,
 * `forge-ui/`) this guard exists to catch when a skill's prose still cites
 * forge's OWN pre-carve structure — the property "root isn't current" is
 * exactly what makes BOTH shapes findings, so it can't tell them apart.
 * Defaulting would have silently un-caught the true positives this guard
 * was built for, in the one file class (skills/) most likely to carry
 * them. Markers stay explicit, one line at a time.
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
 *        [--baseline <path>] [--retired-stems-baseline <path>] [--root <path>]
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
 * Individual prose files excluded, each with its own reason — mirrors
 * check-identity.mjs's EXCLUDED_FILES. A tree-level exclusion doesn't fit a
 * single root-level file, and QUARRY.md is exactly that shape: a per-package
 * cap TABLE whose cells are an append-only log of dated "Raised X -> Y (…)"
 * notes every lane writes into, each citing the files as they stood AT THAT
 * DATE — the same kind of historical record CHANGELOG.md is, just inside a
 * table cell instead of a section. Main merges a new dated note on nearly
 * every PR, so without this exclusion the ratchet reds on almost any merge
 * that carved or moved a file QUARRY.md once named — never QUARRY.md's own
 * fault, and unfixable by repointing (the note is dated; repointing it would
 * misstate what was true on that date). QUARRY.md's LIVE claims — the
 * ownership table's rows, each naming a file that must exist and be tracked
 * — are a different concern and stay verified, by check-owner.mjs.
 */
const EXCLUDED_PROSE_FILES = new Map([
  ['QUARRY.md', 'cap-table cells are dated history; ownership rows are verified by check-owner'],
]);

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

/**
 * Suppression markers — see SUPPRESSION in the header for what each one
 * means and when to use it. A plain substring check, same as the original
 * `historical:` always was: cheap, greppable, and exactly as line-grained
 * as `isSuppressed`'s caller already commits to.
 */
const SUPPRESSION_MARKERS = ['historical:', 'example:', 'project:'];

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

/**
 * A story fixture ground seed (`tests/stories/grounds/<name>/seed/**`) is the
 * SOURCE project's own tree, copied byte-for-byte and frozen: its citations
 * name the source project's paths (project: gitpulse's `docs/usage.md`), not this
 * repo's, and rewriting them would be an unnamed PROVENANCE deviation that
 * breaks the digest `provisionFixtureGround` pins. Same glob and reasoning as
 * `check-file-size.mjs`'s `SEED_GROUND_RE` and `check-test-discovery.mjs`'s
 * exception (forge-1rk5.1). The ground's own `PROVENANCE.md`, outside
 * `seed/`, is still scanned.
 */
const SEED_GROUND_RE = /^tests\/stories\/grounds\/[^/]+\/seed\//;

function isExcludedProse(relPath) {
  if (EXCLUDED_PROSE_FILES.has(relPath) || SEED_GROUND_RE.test(relPath)) return true;
  return EXCLUDED_PROSE_TREES.some((t) => relPath === t || relPath.startsWith(`${t}/`));
}

function collectFiles(root) {
  const all = listFiles(root);
  const fullSet = new Set(all);
  const code = all.filter((p) => CODE_EXTENSIONS.some((ext) => p.endsWith(ext)) && !SEED_GROUND_RE.test(p));
  const prose = all.filter((p) => PROSE_EXTENSIONS.some((ext) => p.endsWith(ext)) && !isExcludedProse(p));
  return { fullSet, code, prose };
}

function basenameStem(relPath) {
  const base = relPath.split('/').pop();
  const dot = base.lastIndexOf('.');
  return dot === -1 ? base : base.slice(0, dot);
}

/**
 * `--write`-ONLY. Recomputes the retired-stem CANDIDATE set from `git log`
 * — a compound (`-`/`_`), 6+ char basename of a file with a code extension
 * that history shows was deleted at some point. `--no-renames` so a
 * renamed-away file (delete of the old path) still counts — a rename is
 * exactly a retirement of the old basename. NOT yet filtered by "still
 * present" — see `curateRetiredStems`, which applies that filter LIVE at
 * check time instead, from `git ls-files` alone. The CHECK path must never
 * call this function directly (see DETERMINISM in the header) — only
 * `main()`'s `--write` branch does.
 */
export function computeRetiredStemCandidatesFromHistory(root) {
  const deleted = gitLogDeletions(root).split('\n');
  const candidates = new Set();
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
    candidates.add(stem);
  }
  return candidates;
}

/**
 * The curated retired-stem set the check actually matches against: the
 * COMMITTED candidate set (see `readRetiredStemCandidates`) minus anything
 * still present today, as EITHER a file's own basename or a DIRECTORY
 * name — a stem still naming a live concept isn't "retired" just because no
 * FILE happens to share its exact basename. Measured false positive:
 * `demo-agent.ts` (a file) was deleted, but `skills/demo-agent/` (a
 * directory — the concept lives on as a skill + a runtime slug) still
 * exists, and a file-basename-only presence check couldn't see it — the
 * same real stem got hand-annotated `historical:` at five separate call
 * sites across three merges before a directory-aware presence check fixed
 * the root cause. `git ls-files` only (`fullSet`, already read for every
 * other part of the scan) — no `git log`, so this stays correct on a
 * shallow clone even though the candidate set it started from is a cache.
 */
export function curateRetiredStems(candidates, fullSet) {
  const present = new Set([...fullSet].map(basenameStem));
  for (const p of fullSet) {
    for (const seg of p.split('/').slice(0, -1)) present.add(seg);
  }
  const stems = new Set();
  for (const stem of candidates) {
    if (!present.has(stem)) stems.add(stem);
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
  return SUPPRESSION_MARKERS.some((m) => rawLine.includes(m)) || NOW_AT_RE.test(rawLine);
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

export function scanAll(root, stemsBaselinePath) {
  const { fullSet, code, prose } = collectFiles(root);
  const candidates = readRetiredStemCandidates(stemsBaselinePath);
  const stems = curateRetiredStems(candidates, fullSet);
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
export function audit(root, baselineRows, stemsBaselinePath) {
  const scan = scanAll(root, stemsBaselinePath);
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

/**
 * Reads the COMMITTED retired-stem candidate set — never via `git`, per
 * DETERMINISM in the header. A missing file reads as an empty Set: the
 * conservative direction (fewer stem findings, never a spurious one), and
 * the correct reading the very first time this ships before anyone has run
 * `--write` yet.
 */
function readRetiredStemCandidates(path) {
  if (!existsSync(path)) return new Set();
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.every((s) => typeof s === 'string')) {
    throw new Error(`${path}: expected an array of stem strings`);
  }
  return new Set(parsed);
}

function main(argv) {
  const json = argv.includes('--json');
  const write = argv.includes('--write');
  const atB = argv.indexOf('--baseline');
  const baselinePath = atB === -1 ? join(ROOT, 'scripts/baselines/stale-path-citations.json') : resolve(argv[atB + 1]);
  const atS = argv.indexOf('--retired-stems-baseline');
  const stemsBaselinePath = atS === -1
    ? join(ROOT, 'scripts/baselines/stale-path-retired-stems.json')
    : resolve(argv[atS + 1]);
  const atR = argv.indexOf('--root');
  const root = atR === -1 ? ROOT : resolve(argv[atR + 1]);

  let existing;
  let result;
  let stemsBefore = 0;
  let stemsAfter = 0;
  try {
    if (write) {
      // The ONLY place this script calls `git log` — see DETERMINISM in the
      // header. Full overwrite, not shrink: this file caches a historical
      // FACT (what was ever deleted), not a debt ratchet, so there is
      // nothing to preserve across a regeneration — audit() below then
      // reads back exactly what was just written, so the same run's FAIL/
      // PASS verdict and this write are never out of sync with each other.
      stemsBefore = readRetiredStemCandidates(stemsBaselinePath).size;
      const candidates = computeRetiredStemCandidatesFromHistory(root);
      stemsAfter = candidates.size;
      writeFileSync(stemsBaselinePath, `${JSON.stringify([...candidates].sort(), null, 2)}\n`);
    }
    existing = readBaselineRows(baselinePath);
    result = audit(root, existing ?? [], stemsBaselinePath);
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
    process.stdout.write(
      `check-stale-path-citations: retired-stem candidates written — ${stemsBefore} -> ${stemsAfter}\n`,
    );
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
