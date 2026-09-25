#!/usr/bin/env node
/**
 * `gitpulse` CLI entry point.
 *
 * Usage:
 *   gitpulse [repo-path]   print a commit-stats summary for a git repo
 *   gitpulse --help        show usage
 *
 * Reads commits (src/git.ts), aggregates them (src/stats.ts), renders the
 * report (src/format.ts), prints it. Validates argv at the boundary and fails
 * fast with a non-zero exit + a message on stderr — it never silently swallows
 * a bad flag or a non-repo path.
 */

import { readCommits, validateRef, readCommitsAtRef, readTags, readCommitsBetweenTags, resolveTagToSha } from './git.ts';
import type { Commit } from './git.ts';
import { filterAuthorCommits } from './author-filter.ts';
import { summarize } from './stats.ts';
import { renderSummary, serializeSummary, renderDelta, serializeDelta,
         renderSummaryCsv, renderCompareCsv,
         renderTagsTable, serializeTagsJson, renderTagsCsv,
         renderCoupling, couplingToJson, couplingToCSV,
         renderSummaryMarkdown, renderDeltaMarkdown,
         renderTagsMarkdown, renderCouplingMarkdown } from './format.ts';
import type { TagRangeAnnotation } from './format.ts';
import { filterCommitsByTagRange } from './tag-range.ts';
import { computeCoupling } from './coupling.ts';
import { computeDelta } from './compare.ts';
import { computeTagSpans, computeMedianGapDays } from './tags.ts';
import { matchGlob } from './glob.ts';
import { sortRecords, COLUMNS, NUMERIC_COLUMNS } from './sort.ts';
import type { CommandSlug } from './sort.ts';

export type CliResult = {
  /** Process exit code: 0 on success, non-zero on a usage/IO error. */
  readonly code: number;
  /** Text to write to stdout (the rendered report), if any. */
  readonly stdout: string;
  /** Text to write to stderr (usage / error), if any. */
  readonly stderr: string;
};

const USAGE = [
  'gitpulse — git repository commit-stats analytics',
  '',
  'Usage:',
  '  gitpulse [repo-path]   print a commit-stats summary (default ".")',
  '',
  'Options:',
  '  -h, --help             show this help',
  '  --json                 output summary as JSON instead of a table',
  '  --csv                  output summary as RFC-4180 CSV instead of a table',
  '  --markdown             output summary as a GFM markdown table instead of a table',
  '  --since <YYYY-MM-DD>   only include commits on or after this date',
  '  --until <YYYY-MM-DD>   only include commits on or before this date',
  '  --top <n>              cap each ranked list to the top n entries (n >= 1)',
  '  --compare <ref>        compare HEAD against a git ref (tag, branch, SHA)',
  '  --exclude <pattern>    exclude file paths matching a glob pattern (repeatable)',
  '  --include <pattern>    include only file paths matching a glob pattern (repeatable, OR\'d; applies before --exclude)',
  '  --sort <column>[:asc|:desc]  sort output by column (default direction: desc for numeric, asc for text)',
  '  --no-merges            exclude merge commits (commits with >1 parent)',
  '  --author <pattern>     filter commits by author name or email glob (* wildcard, repeatable, OR\'d)',
  '  --since-tag <tag>      only include commits after this tag\'s commit (exclusive of the tagged commit itself)',
  '  --until-tag <tag>      only include commits up to and including this tag\'s commit (inclusive)',
].join('\n');

/** Validate that a string matches YYYY-MM-DD format. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Apply exclude-pattern filtering to a set of commits.
 * Returns a new array of commits with excluded files removed from `files`,
 * and the set of distinct excluded file paths (for counting).
 */
function applyExclusions(
  commits: Commit[],
  patterns: readonly string[],
  excludedPaths: Set<string>,
): Commit[] {
  if (patterns.length === 0) return commits;
  return commits.map((c) => {
    const kept = c.files.filter((f) => {
      const excluded = patterns.some((p) => matchGlob(p, f.path));
      if (excluded) excludedPaths.add(f.path);
      return !excluded;
    });
    return { ...c, files: kept };
  });
}

function isValidDate(value: string): boolean {
  return DATE_RE.test(value);
}

/**
 * Apply include-pattern filtering to a set of commits.
 *
 * If `patterns` is empty, returns `commits` unchanged (no-op semantics).
 * Otherwise, retains only files whose path matches at least one of the given
 * glob patterns. An empty-string pattern matches nothing.  Commits whose every
 * file is dropped are removed entirely from the result (commit-count invariant).
 *
 * Mirrors `applyExclusions`; unlike that function no `excludedPaths` Set is
 * needed here — counting is deferred to the CLI layer in WI-2.
 */
export function applyInclusions(
  commits: Commit[],
  patterns: readonly string[],
): Commit[] {
  if (patterns.length === 0) return commits;
  const nonEmpty = patterns.filter((p) => p !== '');
  const filtered = commits
    .map((c) => {
      const kept = c.files.filter((f) =>
        nonEmpty.some((p) => matchGlob(p, f.path)),
      );
      return { ...c, files: kept };
    })
    .filter((c) => c.files.length > 0);
  return filtered;
}

/**
 * Filter out merge commits (commits with more than one parent).
 *
 * Returns the filtered commit array and the count of excluded merge commits.
 * This is a pure function — no I/O — placed after applyExclusions so related
 * filter logic is colocated.
 */
export function filterMergeCommits(commits: Commit[]): { filtered: Commit[]; excludedCount: number } {
  const filtered = commits.filter((c) => c.parentCount <= 1);
  return { filtered, excludedCount: commits.length - filtered.length };
}

/**
 * Parse and validate a `--sort` flag value.
 *
 * Returns `{ column, direction }` on success, or a `CliResult` error on
 * validation failure (exit code 2).
 *
 * @param value   The raw flag value, e.g. `"commits"`, `"commits:asc"`.
 * @param slug    The command slug used to look up valid columns.
 */
function parseSortFlag(
  value: string,
  slug: CommandSlug,
): { column: string; direction: 'asc' | 'desc' } | CliResult {
  const parts = value.split(':');
  if (parts.length > 2) {
    return {
      code: 2,
      stdout: '',
      stderr: `gitpulse: invalid --sort value "${value}" — expected <column> or <column>:asc|:desc`,
    };
  }

  const column = parts[0];
  const dirRaw = parts[1];

  // Validate direction token if present.
  if (dirRaw !== undefined && dirRaw !== 'asc' && dirRaw !== 'desc') {
    return {
      code: 2,
      stdout: '',
      stderr: `gitpulse: invalid sort direction "${dirRaw}" — must be "asc" or "desc"`,
    };
  }

  // Validate column against the registry.
  const validCols = COLUMNS[slug];
  if (!validCols.has(column)) {
    const list = [...validCols].sort().join(', ');
    return {
      code: 2,
      stdout: '',
      stderr: `gitpulse: unknown sort column "${column}" for ${slug}. Valid columns: ${list}`,
    };
  }

  // Determine default direction.
  const direction: 'asc' | 'desc' =
    dirRaw === 'asc' || dirRaw === 'desc'
      ? dirRaw
      : NUMERIC_COLUMNS[slug].has(column)
        ? 'desc'
        : 'asc';

  return { column, direction };
}

/**
 * Handle the `gitpulse tags` subcommand.
 *
 * Parses flags (--json, --csv, --since, --until, --exclude) from remaining argv
 * (the 'tags' token has already been stripped). Reads tags, filters by date
 * window, fetches commits per span, computes spans + median, and renders.
 *
 * Injected io allows unit testing without git spawning.
 */
function runTagsCli(
  argv: readonly string[],
  io: {
    readTags: typeof readTags;
    readCommitsBetweenTags: typeof readCommitsBetweenTags;
  },
): CliResult {
  let repoPath: string | null = null;
  let since: string | null = null;
  let until: string | null = null;
  let json = false;
  let csv = false;
  let markdown = false;
  const excludePatterns: string[] = [];
  const includePatterns: string[] = [];
  const authorPatterns: string[] = [];
  let sortValue: string | null = null;

  const args = [...argv];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--json') { json = true; i += 1; continue; }
    if (arg === '--csv')  { csv  = true; i += 1; continue; }
    if (arg === '--markdown') { markdown = true; i += 1; continue; }
    if (arg === '--no-merges') { i += 1; continue; } // accepted, ignored for tags

    if (arg === '--since') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --since requires a value' };
      }
      if (!isValidDate(value)) {
        return { code: 2, stdout: '', stderr: `gitpulse: invalid date format for --since "${value}" — expected YYYY-MM-DD` };
      }
      since = value; i += 2; continue;
    }

    if (arg === '--until') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --until requires a value' };
      }
      if (!isValidDate(value)) {
        return { code: 2, stdout: '', stderr: `gitpulse: invalid date format for --until "${value}" — expected YYYY-MM-DD` };
      }
      until = value; i += 2; continue;
    }

    if (arg === '--exclude') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --exclude requires a value' };
      }
      if (value === '') {
        return { code: 2, stdout: '', stderr: 'gitpulse: --exclude pattern cannot be empty' };
      }
      excludePatterns.push(value); i += 2; continue;
    }

    if (arg === '--include') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --include requires a value' };
      }
      if (value === '') {
        return { code: 2, stdout: '', stderr: 'gitpulse: --include requires a non-empty pattern' };
      }
      includePatterns.push(value); i += 2; continue;
    }

    if (arg === '--author') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --author requires a value' };
      }
      if (value === '') {
        return { code: 2, stdout: '', stderr: 'gitpulse: --author pattern cannot be empty string' };
      }
      authorPatterns.push(value); i += 2; continue;
    }

    if (arg === '--sort') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --sort requires a value' };
      }
      sortValue = value; i += 2; continue;
    }

    // Reject unsupported flags for tags (top, compare are not applicable).
    if (arg === '--top' || arg === '--compare') {
      return { code: 2, stdout: '', stderr: `gitpulse tags: "${arg}" is not supported for the tags subcommand` };
    }

    // --since-tag / --until-tag are not supported for the tags subcommand.
    if (arg === '--since-tag' || arg === '--until-tag') {
      return {
        code: 2,
        stdout: '',
        stderr: 'gitpulse tags: --since-tag and --until-tag are not supported for the tags subcommand — tags operates on tag spans, not commit ranges',
      };
    }

    if (arg.startsWith('-')) {
      return { code: 2, stdout: '', stderr: `gitpulse: unknown option "${arg}"\n\n${USAGE}` };
    }

    if (repoPath !== null) {
      return { code: 2, stdout: '', stderr: 'gitpulse: more than one repo path given' };
    }
    repoPath = arg;
    i += 1;
  }

  if (csv && json) {
    return { code: 1, stdout: '', stderr: 'Error: --csv and --json are mutually exclusive' };
  }
  if (markdown && json) {
    return { code: 1, stdout: '', stderr: 'Error: --markdown and --json are mutually exclusive' };
  }
  if (markdown && csv) {
    return { code: 1, stdout: '', stderr: 'Error: --markdown and --csv are mutually exclusive' };
  }

  if (since !== null && until !== null && since > until) {
    return {
      code: 2,
      stdout: '',
      stderr: `gitpulse: invalid date window — --since (${since}) is after --until (${until})`,
    };
  }

  // Parse and validate --sort if present (tags slug).
  let sortColumn: string | null = null;
  let sortDirection: 'asc' | 'desc' = 'asc';
  if (sortValue !== null) {
    const parsed = parseSortFlag(sortValue, 'tags');
    if ('code' in parsed) return parsed;
    sortColumn = parsed.column;
    sortDirection = parsed.direction;
  }

  const target = repoPath ?? '.';

  try {
    // Read all tags (newest-first).
    let tags = io.readTags(target);

    // Apply --since / --until window filter.
    if (since !== null) {
      const sinceVal = since;
      tags = tags.filter((t) => t.date >= sinceVal);
    }
    if (until !== null) {
      const untilVal = until;
      tags = tags.filter((t) => t.date <= untilVal);
    }

    if (tags.length === 0) {
      if (json) return { code: 0, stdout: JSON.stringify({ tags: [], medianGapDays: null }, null, 2), stderr: '' };
      if (csv)  return { code: 0, stdout: 'Tag,Date,Commits Since Prev,Unique Authors,Days Since Prev\nMedian Gap Days,', stderr: '' };
      return { code: 0, stdout: 'no tags found', stderr: '' };
    }

    // For each tag, read commits in (prevTag..thisTag].
    // tags is newest-first: tags[0]=newest, tags[N-1]=oldest.
    // The span for tags[i] is from tags[i+1].sha to tags[i].sha.
    // For the oldest tag (no predecessor), use the git empty-tree SHA as the
    // lower bound so that `<empty-tree>..tagSha` returns all commits from the
    // beginning of history up to (and including) the oldest tag.
    const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    const commitsBySpan = tags.map((tag, idx) => {
      const prevSha = idx + 1 < tags.length ? tags[idx + 1].sha : EMPTY_TREE_SHA;
      let spanCommits = io.readCommitsBetweenTags(target, prevSha, tag.sha, excludePatterns.length > 0 ? excludePatterns : undefined);
      // Apply --include filter at the CLI layer (AC3: not threaded into readCommitsBetweenTags).
      if (includePatterns.length > 0) {
        spanCommits = applyInclusions(spanCommits, includePatterns);
      }
      // Apply --author filter per span (AC9).
      if (authorPatterns.length > 0) {
        spanCommits = filterAuthorCommits(spanCommits, authorPatterns).filtered;
      }
      return spanCommits;
    });

    let spans = computeTagSpans(tags, commitsBySpan);

    // Apply --sort if specified.
    if (sortColumn !== null) {
      spans = sortRecords(spans, sortColumn, sortDirection);
    }

    const medianGapDays = computeMedianGapDays(spans);

    if (json) return { code: 0, stdout: serializeTagsJson(spans, medianGapDays), stderr: '' };
    if (csv)  return { code: 0, stdout: renderTagsCsv(spans, medianGapDays), stderr: '' };
    if (markdown) return { code: 0, stdout: renderTagsMarkdown(spans, medianGapDays), stderr: '' };
    return { code: 0, stdout: renderTagsTable(spans, medianGapDays), stderr: '' };

  } catch (err) {
    const message = err instanceof Error ? err.message : `gitpulse: ${String(err)}`;
    return { code: 1, stdout: '', stderr: message };
  }
}

/**
 * Handle the `gitpulse coupling` subcommand.
 *
 * Parses flags (--top, --json, --csv, --exclude, --since, --until,
 * --since-tag, --until-tag) from remaining argv (the 'coupling' token has
 * already been stripped). Reads commits, applies exclude-glob filtering per
 * commit BEFORE passing to computeCoupling, then renders via renderCoupling /
 * couplingToJson / couplingToCSV.
 *
 * Injected io allows unit testing without git spawning.
 */
function runCouplingCli(
  argv: readonly string[],
  io: {
    readCommits: typeof readCommits;
    resolveTagToSha?: typeof resolveTagToSha;
  },
): CliResult {
  let repoPath: string | null = null;
  let since: string | null = null;
  let until: string | null = null;
  let top: number | null = null;
  let json = false;
  let csv = false;
  let markdown = false;
  const excludePatterns: string[] = [];
  const includePatterns: string[] = [];
  const authorPatterns: string[] = [];
  let sinceTagName: string | null = null;
  let untilTagName: string | null = null;

  const args = [...argv];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--json') { json = true; i += 1; continue; }
    if (arg === '--csv')  { csv  = true; i += 1; continue; }
    if (arg === '--markdown') { markdown = true; i += 1; continue; }
    if (arg === '--no-merges') { i += 1; continue; } // accepted, ignored for coupling

    if (arg === '--since') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --since requires a value' };
      }
      if (!isValidDate(value)) {
        return { code: 2, stdout: '', stderr: `gitpulse: invalid date format for --since "${value}" — expected YYYY-MM-DD` };
      }
      since = value; i += 2; continue;
    }

    if (arg === '--until') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --until requires a value' };
      }
      if (!isValidDate(value)) {
        return { code: 2, stdout: '', stderr: `gitpulse: invalid date format for --until "${value}" — expected YYYY-MM-DD` };
      }
      until = value; i += 2; continue;
    }

    if (arg === '--top') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --top requires a value' };
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || String(parsed) !== value) {
        return { code: 2, stdout: '', stderr: `gitpulse: --top requires an integer value, got "${value}"` };
      }
      if (parsed < 1) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --top must be >= 1' };
      }
      top = parsed; i += 2; continue;
    }

    if (arg === '--exclude') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --exclude requires a value' };
      }
      if (value === '') {
        return { code: 2, stdout: '', stderr: 'gitpulse: --exclude pattern cannot be empty' };
      }
      excludePatterns.push(value); i += 2; continue;
    }

    if (arg === '--include') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --include requires a value' };
      }
      if (value === '') {
        return { code: 2, stdout: '', stderr: 'gitpulse: --include requires a non-empty pattern' };
      }
      includePatterns.push(value); i += 2; continue;
    }

    if (arg === '--author') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --author requires a value' };
      }
      if (value === '') {
        return { code: 2, stdout: '', stderr: 'gitpulse: --author pattern cannot be empty string' };
      }
      authorPatterns.push(value); i += 2; continue;
    }

    if (arg === '--since-tag') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --since-tag requires a value' };
      }
      sinceTagName = value; i += 2; continue;
    }

    if (arg === '--until-tag') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --until-tag requires a value' };
      }
      untilTagName = value; i += 2; continue;
    }

    if (arg.startsWith('-')) {
      return { code: 2, stdout: '', stderr: `gitpulse: unknown option "${arg}"\n\n${USAGE}` };
    }

    if (repoPath !== null) {
      return { code: 2, stdout: '', stderr: 'gitpulse: more than one repo path given' };
    }
    repoPath = arg;
    i += 1;
  }

  if (csv && json) {
    return { code: 1, stdout: '', stderr: 'Error: --csv and --json are mutually exclusive' };
  }
  if (markdown && json) {
    return { code: 1, stdout: '', stderr: 'Error: --markdown and --json are mutually exclusive' };
  }
  if (markdown && csv) {
    return { code: 1, stdout: '', stderr: 'Error: --markdown and --csv are mutually exclusive' };
  }

  const target = repoPath ?? '.';

  try {
    let commits = io.readCommits(target);

    // Resolve --since-tag / --until-tag before filtering.
    let sinceTagSha: string | undefined;
    let untilTagSha: string | undefined;
    if (sinceTagName !== null || untilTagName !== null) {
      const doResolveTag = io.resolveTagToSha ?? resolveTagToSha;
      if (sinceTagName !== null) {
        sinceTagSha = doResolveTag(target, sinceTagName);
      }
      if (untilTagName !== null) {
        untilTagSha = doResolveTag(target, untilTagName);
      }
    }

    // Apply date-window filter.
    if (since !== null) {
      const sinceVal = since;
      commits = commits.filter((c) => c.date >= sinceVal);
    }
    if (until !== null) {
      const untilVal = until;
      commits = commits.filter((c) => c.date <= untilVal);
    }

    // Apply tag-range filter (AC3).
    if (sinceTagSha !== undefined || untilTagSha !== undefined) {
      commits = filterCommitsByTagRange(commits, { sinceTagSha, untilTagSha });
    }

    // Apply include-glob filtering before exclude and before computeCoupling (AC4).
    if (includePatterns.length > 0) {
      commits = applyInclusions(commits, includePatterns);
    }

    // Apply exclude-glob filtering per commit BEFORE computeCoupling (AC4).
    // Track distinct excluded paths for excludedCount.
    const excludedPaths = new Set<string>();
    if (excludePatterns.length > 0) {
      commits = commits.map((c) => {
        const kept = c.files.filter((f) => {
          const excluded = excludePatterns.some((p) => matchGlob(p, f.path));
          if (excluded) excludedPaths.add(f.path);
          return !excluded;
        });
        return { ...c, files: kept };
      });
    }
    const excludedCount = excludedPaths.size;

    // Apply --author filter after exclusions, before computeCoupling (AC10).
    if (authorPatterns.length > 0) {
      commits = filterAuthorCommits(commits, authorPatterns).filtered;
    }

    const rows = computeCoupling(commits);

    if (json) {
      return { code: 0, stdout: couplingToJson(rows, excludedCount), stderr: '' };
    }
    if (csv) {
      return { code: 0, stdout: couplingToCSV(rows), stderr: '' };
    }
    if (markdown) {
      return { code: 0, stdout: renderCouplingMarkdown(rows, { top: top ?? undefined, excludedCount }), stderr: '' };
    }

    // Text table (default).
    const rendered = renderCoupling(rows, {
      top: top ?? undefined,
      excludedCount,
    });
    return { code: 0, stdout: rendered, stderr: '' };

  } catch (err) {
    const message = err instanceof Error ? err.message : `gitpulse: ${String(err)}`;
    return { code: 1, stdout: '', stderr: message };
  }
}

/**
 * Pure arg → result core. The git reader is injected so this is fully testable
 * without spawning git or touching a real repository.
 */
export function runCli(
  argv: readonly string[],
  io: {
    readCommits: typeof readCommits;
    validateRef?: typeof validateRef;
    readCommitsAtRef?: typeof readCommitsAtRef;
    readTags?: typeof readTags;
    readCommitsBetweenTags?: typeof readCommitsBetweenTags;
    resolveTagToSha?: typeof resolveTagToSha;
  },
): CliResult {
  if (argv.includes('-h') || argv.includes('--help')) {
    return { code: 0, stdout: '', stderr: USAGE };
  }

  // Subcommand dispatch: if the first non-flag positional is a known subcommand,
  // route to the appropriate handler before parsing the rest of the argv.
  const firstPositional = argv.find((a) => !a.startsWith('-'));
  if (firstPositional === 'tags') {
    const remainingArgv = argv.filter((a) => a !== firstPositional);
    return runTagsCli(remainingArgv, {
      readTags: io.readTags ?? readTags,
      readCommitsBetweenTags: io.readCommitsBetweenTags ?? readCommitsBetweenTags,
    });
  }
  if (firstPositional === 'coupling') {
    // Strip only the first occurrence of 'coupling' from argv.
    const idx = argv.indexOf('coupling');
    const remainingArgv = [...argv.slice(0, idx), ...argv.slice(idx + 1)];
    return runCouplingCli(remainingArgv, {
      readCommits: io.readCommits,
      resolveTagToSha: io.resolveTagToSha,
    });
  }

  let repoPath: string | null = null;
  let since: string | null = null;
  let until: string | null = null;
  let top: number | null = null;
  let json = false;
  let csv = false;
  let markdown = false;
  let compare: string | null = null;
  let noMerges = false;
  const excludePatterns: string[] = [];
  const includePatterns: string[] = [];
  const authorPatterns: string[] = [];
  let sortValue: string | null = null;
  let sinceTagName: string | null = null;
  let untilTagName: string | null = null;

  const args = [...argv];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--json') {
      json = true;
      i += 1;
      continue;
    }

    if (arg === '--csv') {
      csv = true;
      i += 1;
      continue;
    }

    if (arg === '--markdown') {
      markdown = true;
      i += 1;
      continue;
    }

    if (arg === '--since') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --since requires a value' };
      }
      if (!isValidDate(value)) {
        return {
          code: 2,
          stdout: '',
          stderr: `gitpulse: invalid date format for --since "${value}" — expected YYYY-MM-DD`,
        };
      }
      since = value;
      i += 2;
      continue;
    }

    if (arg === '--until') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --until requires a value' };
      }
      if (!isValidDate(value)) {
        return {
          code: 2,
          stdout: '',
          stderr: `gitpulse: invalid date format for --until "${value}" — expected YYYY-MM-DD`,
        };
      }
      until = value;
      i += 2;
      continue;
    }

    if (arg === '--top') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --top requires a value' };
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || String(parsed) !== value) {
        return {
          code: 2,
          stdout: '',
          stderr: `gitpulse: --top requires an integer value, got "${value}"`,
        };
      }
      if (parsed < 1) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --top must be >= 1' };
      }
      top = parsed;
      i += 2;
      continue;
    }

    if (arg === '--compare') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --compare requires a value' };
      }
      compare = value;
      i += 2;
      continue;
    }

    if (arg === '--exclude') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --exclude requires a value' };
      }
      if (value === '') {
        return { code: 2, stdout: '', stderr: 'gitpulse: --exclude pattern cannot be empty' };
      }
      excludePatterns.push(value);
      i += 2;
      continue;
    }

    if (arg === '--include') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --include requires a value' };
      }
      if (value === '') {
        return { code: 2, stdout: '', stderr: 'gitpulse: --include requires a non-empty pattern' };
      }
      includePatterns.push(value);
      i += 2;
      continue;
    }

    if (arg === '--sort') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --sort requires a value' };
      }
      sortValue = value;
      i += 2;
      continue;
    }

    if (arg === '--no-merges') {
      noMerges = true;
      i += 1;
      continue;
    }

    if (arg === '--author') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --author requires a value' };
      }
      if (value === '') {
        return { code: 2, stdout: '', stderr: 'gitpulse: --author pattern cannot be empty string' };
      }
      authorPatterns.push(value);
      i += 2;
      continue;
    }

    if (arg === '--since-tag') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --since-tag requires a value' };
      }
      sinceTagName = value;
      i += 2;
      continue;
    }

    if (arg === '--until-tag') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { code: 2, stdout: '', stderr: 'gitpulse: --until-tag requires a value' };
      }
      untilTagName = value;
      i += 2;
      continue;
    }

    if (arg.startsWith('-')) {
      return { code: 2, stdout: '', stderr: `gitpulse: unknown option "${arg}"\n\n${USAGE}` };
    }

    if (repoPath !== null) {
      return { code: 2, stdout: '', stderr: 'gitpulse: more than one repo path given' };
    }
    repoPath = arg;
    i += 1;
  }

  // Mutual-exclusion guard: --csv and --json cannot be combined.
  if (csv && json) {
    return { code: 1, stdout: '', stderr: 'Error: --csv and --json are mutually exclusive' };
  }
  if (markdown && json) {
    return { code: 1, stdout: '', stderr: 'Error: --markdown and --json are mutually exclusive' };
  }
  if (markdown && csv) {
    return { code: 1, stdout: '', stderr: 'Error: --markdown and --csv are mutually exclusive' };
  }

  // Validate window consistency.
  if (since !== null && until !== null && since > until) {
    return {
      code: 2,
      stdout: '',
      stderr: `gitpulse: invalid date window — --since (${since}) is after --until (${until})`,
    };
  }

  // Determine command slug for --sort validation.
  // compare → 'compare'; otherwise → 'authors' (primary output for single snapshot).
  const commandSlug: CommandSlug = compare !== null ? 'compare' : 'authors';

  // Parse and validate --sort if present.
  let sortColumn: string | null = null;
  let sortDirection: 'asc' | 'desc' = 'asc';
  if (sortValue !== null) {
    const parsed = parseSortFlag(sortValue, commandSlug);
    if ('code' in parsed) return parsed;
    sortColumn = parsed.column;
    sortDirection = parsed.direction;
  }

  const target = repoPath ?? '.';

  try {
    // --- Resolve --since-tag / --until-tag to SHAs (shared by both paths) ---
    let sinceTagSha: string | undefined;
    let untilTagSha: string | undefined;
    let tagRange: TagRangeAnnotation | undefined;
    if (sinceTagName !== null || untilTagName !== null) {
      const doResolveTag = io.resolveTagToSha ?? resolveTagToSha;
      if (sinceTagName !== null) {
        sinceTagSha = doResolveTag(target, sinceTagName);
      }
      if (untilTagName !== null) {
        untilTagSha = doResolveTag(target, untilTagName);
      }
      tagRange = {
        sinceTag: sinceTagName ?? '',
        untilTag: untilTagName ?? '',
        sinceSha: sinceTagSha ?? '',
        untilSha: untilTagSha ?? '',
      };
    }

    // --- Compare path ---
    if (compare !== null) {
      // Validate the ref (throws with 'gitpulse: unknown ref ...' on failure).
      const doValidateRef = io.validateRef ?? validateRef;
      doValidateRef(target, compare);

      // Read HEAD commits.
      let headCommits = io.readCommits(target);
      if (since !== null) {
        const sinceVal = since;
        headCommits = headCommits.filter((c) => c.date >= sinceVal);
      }
      if (until !== null) {
        const untilVal = until;
        headCommits = headCommits.filter((c) => c.date <= untilVal);
      }

      // Apply tag-range filter to headCommits (AC2).
      if (sinceTagSha !== undefined || untilTagSha !== undefined) {
        headCommits = filterCommitsByTagRange(headCommits, { sinceTagSha, untilTagSha });
      }

      // Read base commits (commits reachable from compare ref).
      const doReadCommitsAtRef = io.readCommitsAtRef ?? readCommitsAtRef;
      let baseCommits = doReadCommitsAtRef(target, compare);

      // Apply tag-range filter to baseCommits (AC2).
      if (sinceTagSha !== undefined || untilTagSha !== undefined) {
        baseCommits = filterCommitsByTagRange(baseCommits, { sinceTagSha, untilTagSha });
      }

      // Apply include-glob filtering to BOTH head and base commits before exclusions (AC2).
      let includeFilteredCount = 0;
      if (includePatterns.length > 0) {
        const beforeHeadPaths = headCommits.flatMap((c) => c.files.map((f) => f.path));
        const beforeBasePaths = baseCommits.flatMap((c) => c.files.map((f) => f.path));
        headCommits = applyInclusions(headCommits, includePatterns);
        baseCommits = applyInclusions(baseCommits, includePatterns);
        const afterPaths = new Set([
          ...headCommits.flatMap((c) => c.files.map((f) => f.path)),
          ...baseCommits.flatMap((c) => c.files.map((f) => f.path)),
        ]);
        const droppedPaths = new Set([
          ...beforeHeadPaths.filter((p) => !afterPaths.has(p)),
          ...beforeBasePaths.filter((p) => !afterPaths.has(p)),
        ]);
        includeFilteredCount = droppedPaths.size;
      }

      // Apply exclusions to both HEAD and base commits.
      const excludedPaths = new Set<string>();
      headCommits = applyExclusions(headCommits, excludePatterns, excludedPaths);
      baseCommits = applyExclusions(baseCommits, excludePatterns, excludedPaths);
      const excludedCount = excludedPaths.size;

      const options: { top?: number } = {};
      if (top !== null) options.top = top;

      const headSummary = summarize(headCommits, options);
      const baseSummary = summarize(baseCommits, options);
      let result = computeDelta(baseSummary, headSummary, compare);

      // Apply --sort to the authorDeltas array.
      if (sortColumn !== null) {
        const sortedDeltas = sortRecords(result.authorDeltas as unknown as Record<string, unknown>[], sortColumn, sortDirection);
        result = { ...result, authorDeltas: sortedDeltas as unknown as typeof result.authorDeltas };
      }

      if (json) {
        const obj = JSON.parse(serializeDelta(result)) as Record<string, unknown>;
        if (excludePatterns.length > 0) obj['excluded'] = excludedCount;
        if (includePatterns.length > 0) obj['includeFiltered'] = includeFilteredCount;
        if (tagRange !== undefined) obj['range'] = tagRange;
        const report = JSON.stringify(obj, null, 2);
        return { code: 0, stdout: report, stderr: '' };
      }
      if (csv) {
        let csvOut = renderCompareCsv(result);
        if (includePatterns.length > 0) {
          csvOut = `# includeFiltered: ${includeFilteredCount}\n${csvOut}`;
        }
        return { code: 0, stdout: csvOut, stderr: '' };
      }
      if (markdown) {
        return { code: 0, stdout: renderDeltaMarkdown(result, { top: top ?? undefined }), stderr: '' };
      }
      let report = renderDelta(result, { top: top ?? undefined });
      if (includePatterns.length > 0 && includeFilteredCount > 0) {
        const lines = report.split('\n');
        lines[0] = `${lines[0]} (${includeFilteredCount} paths excluded by include filter)`;
        report = lines.join('\n');
      }
      if (excludePatterns.length > 0) {
        const lines = report.split('\n');
        lines[0] = `${lines[0]} (${excludedCount} paths excluded)`;
        report = lines.join('\n');
      }
      return { code: 0, stdout: report, stderr: '' };
    }

    // --- Single-snapshot path ---
    let commits = io.readCommits(target);

    // Apply date-window filter (inclusive on both ends; string comparison is
    // correct for ISO-8601 YYYY-MM-DD dates).
    if (since !== null) {
      const sinceVal = since;
      commits = commits.filter((c) => c.date >= sinceVal);
    }
    if (until !== null) {
      const untilVal = until;
      commits = commits.filter((c) => c.date <= untilVal);
    }

    // Apply tag-range filter (AC1).
    if (sinceTagSha !== undefined || untilTagSha !== undefined) {
      commits = filterCommitsByTagRange(commits, { sinceTagSha, untilTagSha });
    }

    // Apply include-glob filtering first (AC1: before applyExclusions, --no-merges, --author).
    let includeFilteredCount = 0;
    if (includePatterns.length > 0) {
      const beforePaths = commits.flatMap((c) => c.files.map((f) => f.path));
      commits = applyInclusions(commits, includePatterns);
      const afterPaths = new Set(commits.flatMap((c) => c.files.map((f) => f.path)));
      const droppedPaths = new Set(beforePaths.filter((p) => !afterPaths.has(p)));
      includeFilteredCount = droppedPaths.size;
    }

    // Apply exclusions.
    const excludedPaths = new Set<string>();
    commits = applyExclusions(commits, excludePatterns, excludedPaths);
    const excludedCount = excludedPaths.size;

    // Apply --no-merges filter after exclusions and before author filter.
    let mergesExcluded = 0;
    if (noMerges) {
      const result = filterMergeCommits(commits);
      commits = result.filtered;
      mergesExcluded = result.excludedCount;
    }

    // Apply --author filter after no-merges, before summarize (AC1, AC4).
    let authorsFiltered = 0;
    if (authorPatterns.length > 0) {
      const result = filterAuthorCommits(commits, authorPatterns);
      commits = result.filtered;
      authorsFiltered = result.excludedCount;
    }

    const options: { top?: number; repoPath?: string } = { repoPath: target };
    if (top !== null) options.top = top;

    let summary = summarize(commits, options);

    // Apply --sort to the byAuthor array (the primary ranked list).
    if (sortColumn !== null) {
      const sortedByAuthor = sortRecords(
        summary.byAuthor as unknown as Record<string, unknown>[],
        sortColumn,
        sortDirection,
      );
      summary = { ...summary, byAuthor: sortedByAuthor as unknown as typeof summary.byAuthor };
    }

    if (json) {
      const obj = JSON.parse(serializeSummary(summary, { tagRange })) as Record<string, unknown>;
      if (excludePatterns.length > 0) obj['excluded'] = excludedCount;
      if (includePatterns.length > 0) obj['includeFiltered'] = includeFilteredCount;
      if (noMerges && mergesExcluded > 0) obj['mergesExcluded'] = mergesExcluded;
      if (authorPatterns.length > 0) obj['authorsFiltered'] = authorsFiltered;
      const report = JSON.stringify(obj, null, 2);
      return { code: 0, stdout: report, stderr: '' };
    }
    if (csv) {
      let csvOut = renderSummaryCsv(summary, { tagRange });
      if (includePatterns.length > 0) {
        csvOut = `# includeFiltered: ${includeFilteredCount}\n${csvOut}`;
      }
      if (authorPatterns.length > 0) {
        csvOut = `# authorsFiltered: ${authorsFiltered}\n${csvOut}`;
      }
      return { code: 0, stdout: csvOut, stderr: '' };
    }
    if (markdown) {
      return { code: 0, stdout: renderSummaryMarkdown(summary, { tagRange }), stderr: '' };
    }
    let report = renderSummary(summary, { tagRange });
    if (includePatterns.length > 0 && includeFilteredCount > 0) {
      const lines = report.split('\n');
      lines[0] = `${lines[0]} (${includeFilteredCount} paths excluded by include filter)`;
      report = lines.join('\n');
    }
    if (excludePatterns.length > 0) {
      const lines = report.split('\n');
      lines[0] = `${lines[0]} (${excludedCount} paths excluded)`;
      report = lines.join('\n');
    }
    if (noMerges && mergesExcluded > 0) {
      const lines = report.split('\n');
      lines[0] = `${lines[0]} (${mergesExcluded} merge commits excluded)`;
      report = lines.join('\n');
    }
    if (authorPatterns.length > 0 && authorsFiltered > 0) {
      const lines = report.split('\n');
      lines[0] = `${lines[0]} (${authorsFiltered} commits excluded by author filter)`;
      report = lines.join('\n');
    }
    return { code: 0, stdout: report, stderr: '' };
  } catch (err) {
    const message = err instanceof Error ? err.message : `gitpulse: ${String(err)}`;
    // Unknown ref errors exit code 2; other errors exit code 1.
    const code = (message.includes('unknown ref') || message.includes('unknown tag')) ? 2 : 1;
    return { code, stdout: '', stderr: message };
  }
}

/** Thin wrapper that wires `runCli` to the real git reader. */
export function main(argv: readonly string[]): number {
  const result = runCli(argv, { readCommits, validateRef, readCommitsAtRef, readTags, readCommitsBetweenTags, resolveTagToSha });
  if (result.stdout) process.stdout.write(result.stdout + '\n');
  if (result.stderr) process.stderr.write(result.stderr + '\n');
  return result.code;
}

// Run when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
