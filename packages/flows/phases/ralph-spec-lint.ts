/**
 * ralph-spec-lint — deterministic PM-side check for vacuous test-selector
 * gates (REFINEMENT-PLAN §7; brain/cycles/themes/2026-07-11-pm-gate-vacuous-
 * pass-new-function-name.md).
 *
 * PM sometimes writes a WI's `quality_gate_cmd` naming a specific test
 * function/case that does not exist yet, e.g.
 * `go test -run TestResolveFrameworkAuth ./pkg/`. Runners that support a
 * named-selector flag exit 0 ("[no tests to run]") when nothing matches — the
 * gate reads exit-0 as PASS with zero work delivered. The runtime backstop
 * (`gateRequiredPaths` in `work-item.ts`, commit ba073ce) only catches this
 * AFTER dev-loop spend. This module proves — deterministically, no SDK —
 * whether a named selector can match ANYTHING: an existing test on the clean
 * project tree, or a test file in the WI's ENFORCED write set (the exact
 * `gateRequiredPaths` priority chain the runtime diff-touch backstop uses —
 * imported, not re-implemented, so the escape can never drift from the
 * enforcement).
 *
 * Verdict channels (a lint may only HARD-FAIL what it can PROVE):
 * - `errors`   — provable defects: empty gate, syntactically invalid selector
 *                regex, and a selector that matches no known test name where
 *                the search was COMPLETE and the corpus holds no dynamically-
 *                generated names. These fold into the PM pass's compileErrors.
 * - `warnings` — everything the extractors are KNOWN to under-approximate:
 *                the test-file walk hit its cap (an incomplete search proves
 *                nothing), or the searched corpus contains `.each`-style
 *                dynamically-named tests (their generated names are not
 *                statically extractable). Surfaced via the `pm.spec-lint`
 *                event; never fail the pass.
 * - `configError` — projectRoot missing/not a directory. That is a bug at the
 *                call site, not a WI verdict; the caller folds it into
 *                compileErrors and no WI verdicts are produced.
 *
 * Wired into the wi-spec-compile stage (`compileWorkItemSpecs`, right after
 * constraint injection) — see wi-spec-compile.ts.
 *
 * Table-driven: `GATE_EXTRACTORS` is the full set of recognised runner
 * patterns; a new runner is one entry. A gate command that matches none of
 * them passes through silently.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { gateRequiredPaths, type WorkItem } from '../work-item.ts';

// ---------- runner extractor table ----------

export type SelectorMatchKind =
  /**
   * `go test -run`: a slash-separated list of regexes, one per subtest
   * nesting level, each matched UNANCHORED. The lint validates every
   * segment's syntax (go errors at runtime on any invalid one) but matches
   * only the FIRST segment against known top-level test names — subtest
   * (`t.Run`) names are runtime strings and are not extracted.
   */
  | 'go-run'
  /**
   * vitest/jest `-t`/`--testNamePattern` and node `--test-name-pattern`:
   * a real regular expression matched UNANCHORED against test names (NOT a
   * substring). The lint matches against extracted `it`/`test` titles plus
   * `describe` titles (a runner matches the composed full name, and any
   * regex that matches a describe title also matches the full names under
   * it, bar `$`-anchoring).
   */
  | 'regex';

export type GateExtractor = {
  readonly name: string;
  /** Does this command invoke this runner? */
  readonly detect: (cmd: readonly string[]) => boolean;
  /** The named-selector value, or null when the command carries no selector flag. */
  readonly extractSelector: (cmd: readonly string[]) => string | null;
  readonly matchKind: SelectorMatchKind;
  /** Bounded set of test-file suffixes searched when resolving this runner's selector. */
  readonly testFileSuffixes: readonly string[];
  /** Pull candidate test names out of one test file's source text. */
  readonly extractTestNames: (content: string) => string[];
  /**
   * True when the file provably contains DYNAMICALLY-NAMED tests the static
   * extractor cannot enumerate (e.g. `test.each`). Such a file contributes an
   * "unprovable" sentinel to the corpus: a selector that fails exact matching
   * while sentinels exist is a WARNING, never a hard failure.
   */
  readonly detectUnprovableNames?: (content: string) => boolean;
};

/**
 * LAST value of `<flag> <val>` or `<flag>=<val>` for any of `flags` — Go's
 * flag package (and the JS runners) let a repeated flag override earlier
 * occurrences, so the last one is the one the runner obeys.
 */
function flagValue(cmd: readonly string[], ...flags: readonly string[]): string | null {
  let value: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const tok = cmd[i]!;
    for (const flag of flags) {
      if (tok === flag) value = cmd[i + 1] ?? null;
      else if (tok.startsWith(`${flag}=`)) value = tok.slice(flag.length + 1);
    }
  }
  return value;
}

// Plain funcs (`func TestFoo(`) AND receiver methods (`func (s *Suite) TestFoo(`
// — testify-style suites); a selector naming either must not read as vacuous.
const GO_TEST_FUNC = /^func\s+(?:\([^)]*\)\s*)?(Test[A-Za-z0-9_]*)\s*\(/gm;
function extractGoTestNames(content: string): string[] {
  return [...content.matchAll(GO_TEST_FUNC)].map((m) => m[1]!);
}

// it('name')/test('name')/describe('name') incl. chained modifiers
// (it.only, test.skip, …), single/double/backtick quoted. describe titles are
// included because runners match the composed "describe > test" full name.
const JS_TEST_CALL = /\b(?:it|test|describe)(?:\.\w+)*\s*\(\s*(['"`])((?:(?!\1)[\s\S])*)\1/g;
function extractJsTestNames(content: string): string[] {
  return [...content.matchAll(JS_TEST_CALL)].map((m) => m[2]!);
}

// test.each / it.each / describe.each — template-literal (test.each`…`) or
// array (test.each([...])(name, fn)) form. Their test names are composed at
// runtime; statically unprovable.
const JS_EACH_CALL = /\b(?:it|test|describe)(?:\.\w+)*\.each\s*[(`]/;
function detectJsEach(content: string): boolean {
  return JS_EACH_CALL.test(content);
}

const JS_TEST_SUFFIXES = ['.test.ts', '.test.js', '.spec.ts', '.spec.js'] as const;

export const GATE_EXTRACTORS: readonly GateExtractor[] = [
  {
    name: 'go-test',
    detect: (cmd) => cmd[0] === 'go' && cmd.includes('test'),
    // Go's flag package accepts single- and double-dash forms; last wins.
    extractSelector: (cmd) => flagValue(cmd, '-run', '--run'),
    matchKind: 'go-run',
    testFileSuffixes: ['_test.go'],
    extractTestNames: extractGoTestNames,
  },
  {
    name: 'vitest',
    detect: (cmd) => cmd.some((tok) => tok === 'vitest' || tok.endsWith('/vitest')),
    extractSelector: (cmd) => flagValue(cmd, '-t', '--testNamePattern'),
    matchKind: 'regex',
    testFileSuffixes: [
      '.test.ts', '.test.tsx', '.test.js', '.test.jsx',
      '.spec.ts', '.spec.tsx', '.spec.js', '.spec.jsx',
    ],
    extractTestNames: extractJsTestNames,
    detectUnprovableNames: detectJsEach,
  },
  {
    name: 'node-test',
    detect: (cmd) => cmd[0] === 'node' && cmd.includes('--test'),
    extractSelector: (cmd) => flagValue(cmd, '--test-name-pattern'),
    matchKind: 'regex',
    testFileSuffixes: ['.test.js', '.test.ts', '.test.mjs', '.test.cjs'],
    extractTestNames: extractJsTestNames,
    detectUnprovableNames: detectJsEach,
  },
  {
    name: 'npm-test-dash-t',
    detect: (cmd) => cmd[0] === 'npm' && cmd.includes('test') && cmd.includes('--'),
    extractSelector: (cmd) => flagValue(cmd, '-t'),
    matchKind: 'regex',
    testFileSuffixes: JS_TEST_SUFFIXES,
    extractTestNames: extractJsTestNames,
    detectUnprovableNames: detectJsEach,
  },
  {
    name: 'jest',
    detect: (cmd) => cmd.some((tok) => tok === 'jest' || tok.endsWith('/jest')),
    extractSelector: (cmd) => flagValue(cmd, '-t', '--testNamePattern'),
    matchKind: 'regex',
    testFileSuffixes: JS_TEST_SUFFIXES,
    extractTestNames: extractJsTestNames,
    detectUnprovableNames: detectJsEach,
  },
];

function findExtractor(cmd: readonly string[]): GateExtractor | null {
  return GATE_EXTRACTORS.find((e) => e.detect(cmd)) ?? null;
}

// ---------- bounded, deterministic test-file walk ----------

const SKIP_DIRS = new Set([
  'node_modules', 'vendor', 'dist', 'build', 'out', 'coverage',
  '.git', '.next', '.forge', '.terraform', '__pycache__', 'target',
]);
/** Default bound on directory entries visited per runner per lint pass. */
export const MAX_FILES_WALKED = 20000;
/** Per-file read cap — a test file larger than this is skipped (and counted). */
export const MAX_TEST_FILE_BYTES = 1024 * 1024;

type WalkResult = { files: string[]; truncated: boolean };

/**
 * Deterministic (sorted-entry DFS) bounded walk. `truncated` is true only
 * when the cap actually cut the search short — a complete walk that happens
 * to land exactly on the cap is not truncated.
 */
function walkTestFiles(root: string, suffixes: readonly string[], cap: number): WalkResult {
  const files: string[] = [];
  const stack: string[] = [root];
  let visited = 0;
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir — best-effort, not fatal
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const subdirs: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      if (visited >= cap) return { files, truncated: true };
      visited++;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        subdirs.push(full);
      } else if (suffixes.some((suf) => entry.name.endsWith(suf))) {
        files.push(full);
      }
    }
    // Reverse so the stack pops subdirectories in sorted order.
    for (let i = subdirs.length - 1; i >= 0; i--) stack.push(subdirs[i]!);
  }
  return { files, truncated: false };
}

// ---------- corpus (per-extractor, cached per lint pass) ----------

type Corpus = {
  names: string[];
  /** Count of files carrying dynamically-generated test names (`.each`). */
  sentinelFiles: number;
  truncated: boolean;
  skippedFiles: number;
};

function buildCorpus(extractor: GateExtractor, root: string, cap: number): Corpus {
  const walk = walkTestFiles(root, extractor.testFileSuffixes, cap);
  const names: string[] = [];
  let sentinelFiles = 0;
  let skippedFiles = 0;
  for (const file of walk.files) {
    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      skippedFiles++;
      continue;
    }
    if (size > MAX_TEST_FILE_BYTES) {
      skippedFiles++;
      continue;
    }
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      skippedFiles++;
      continue;
    }
    names.push(...extractor.extractTestNames(content));
    if (extractor.detectUnprovableNames?.(content)) sentinelFiles++;
  }
  return { names, sentinelFiles, truncated: walk.truncated, skippedFiles };
}

// ---------- verdict ----------

export type RalphSpecLintOptions = {
  /** The PROJECT's worktree root (NOT forgeRoot) — where existing test files are searched. */
  projectRoot: string;
  /** Walk-cap override (defaults to MAX_FILES_WALKED); primarily a test seam. */
  maxFilesWalked?: number;
};

export type RalphSpecLintResult = {
  checked: number;
  flagged: number;
  warned: number;
  /** Provable defects — folded into the PM pass's compileErrors (fail the pass). */
  errors: string[];
  /** Known-under-approximation downgrades — event-surfaced only, never fail the pass. */
  warnings: string[];
  /** True when any corpus walk hit its cap (the search was incomplete). */
  truncated: boolean;
  /** Test files skipped (read error or > MAX_TEST_FILE_BYTES). */
  skippedFiles: number;
  /** Set when projectRoot is missing/not a directory — a call-site bug, no WI verdicts produced. */
  configError: string | null;
};

/**
 * Deterministic vacuous-gate check across a batch of work items. For each
 * WI: extract a named test selector from `quality_gate_cmd` (table-driven,
 * `GATE_EXTRACTORS`), then verdict:
 * - selector matches an existing test name → pass
 * - the WI's ENFORCED write set (`gateRequiredPaths` — creates, else
 *   verification_artifact, else files_in_scope) contains a file matching the
 *   runner's test-file pattern → pass (write-first protocol; the runtime
 *   diff-touch backstop enforces delivery)
 * - the corpus search was truncated, or the corpus carries dynamically-named
 *   tests (`.each`) → WARNING (the lint cannot prove vacuousness)
 * - otherwise → hard failure (vacuous-pass risk, ADR 037)
 * Empty/whitespace gates and syntactically invalid selector regexes are hard
 * failures regardless (provable without any search). Unrecognised runners
 * pass through silently.
 */
export function ralphSpecLintWorkItems(
  items: readonly WorkItem[],
  opts: RalphSpecLintOptions,
): RalphSpecLintResult {
  // projectRoot must be a real directory — anything else is a bug at the
  // call site (the PM pass passes the project worktree), not a WI verdict.
  let rootIsDir = false;
  try {
    rootIsDir = statSync(opts.projectRoot).isDirectory();
  } catch {
    rootIsDir = false;
  }
  if (!rootIsDir) {
    return {
      checked: 0,
      flagged: 0,
      warned: 0,
      errors: [],
      warnings: [],
      truncated: false,
      skippedFiles: 0,
      configError:
        `projectRoot "${opts.projectRoot}" does not exist or is not a directory — ` +
        `ralph-spec-lint needs the project worktree to search test files (call-site config bug)`,
    };
  }

  const cap = opts.maxFilesWalked ?? MAX_FILES_WALKED;
  const corpusCache = new Map<string, Corpus>();
  const corpusFor = (extractor: GateExtractor): Corpus => {
    const cached = corpusCache.get(extractor.name);
    if (cached) return cached;
    const corpus = buildCorpus(extractor, opts.projectRoot, cap);
    corpusCache.set(extractor.name, corpus);
    return corpus;
  };

  let checked = 0;
  let flagged = 0;
  let warned = 0;
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const item of items) {
    checked++;
    const cmd = item.quality_gate_cmd;
    const cmdText = (cmd ?? []).join(' ');

    if (!cmd || cmd.length === 0 || cmd.every((tok) => tok.trim().length === 0)) {
      flagged++;
      errors.push(
        `${item.work_item_id}: quality_gate_cmd is empty/whitespace — the gate must be a real runnable ` +
          `command whose exit code is the verdict (ADR 037)`,
      );
      continue;
    }

    const extractor = findExtractor(cmd);
    if (!extractor) continue; // unrecognised runner — pass through, nothing this lint can prove

    const selector = extractor.extractSelector(cmd);
    if (selector === null || selector.trim().length === 0) continue; // no named selector — nothing to prove

    // Compile the selector. Syntax errors are provable without any search —
    // the runner itself would error at runtime — so they hard-fail even when
    // a later corpus search would have been truncated.
    let matches: ((name: string) => boolean) | null = null;
    let invalid: { segment: string; err: string } | null = null;
    if (extractor.matchKind === 'go-run') {
      // Slash-separated regex list, one per subtest level; go compiles every
      // segment (any invalid one errors at runtime), but only the FIRST names
      // a top-level test function — subtest names are runtime strings.
      const segments = selector.split('/');
      for (const [idx, segment] of segments.entries()) {
        try {
          const re = new RegExp(segment);
          if (idx === 0) matches = (name) => re.test(name);
        } catch (err) {
          invalid = { segment, err: (err as Error).message };
          break;
        }
      }
    } else {
      try {
        const re = new RegExp(selector);
        matches = (name) => re.test(name);
      } catch (err) {
        invalid = { segment: selector, err: (err as Error).message };
      }
    }
    if (invalid || !matches) {
      flagged++;
      const detail = invalid
        ? invalid.segment !== selector
          ? `segment "${invalid.segment}": ${invalid.err}`
          : invalid.err
        : 'no matchable selector';
      errors.push(
        `${item.work_item_id}: quality_gate_cmd [${cmdText}] selector "${selector}" is not a valid regular ` +
          `expression for ${extractor.name} (${detail}) — would error at runtime, fix the selector`,
      );
      continue;
    }

    const corpus = corpusFor(extractor);
    if (corpus.names.some(matches)) continue; // exercises an existing test — fine

    // Write-first escape: EXACTLY the runtime diff-touch backstop's path set
    // (gateRequiredPaths priority chain: creates, else verification_artifact,
    // else files_in_scope) — imported, so lint and enforcement cannot drift.
    // A test file merely listed in files_in_scope while creates is non-empty
    // is NOT enforced, so it does not escape.
    const enforced = gateRequiredPaths(item);
    const writeFirst = enforced.some((path) =>
      extractor.testFileSuffixes.some((suf) => path.endsWith(suf)),
    );
    if (writeFirst) continue;

    if (corpus.truncated) {
      warned++;
      warnings.push(
        `${item.work_item_id}: quality_gate_cmd [${cmdText}] names test '${selector}' with no provable match, ` +
          `but the test-file search was truncated at ${cap} entries — an incomplete search proves nothing; ` +
          `verify the selector manually`,
      );
      continue;
    }
    if (corpus.sentinelFiles > 0) {
      warned++;
      warnings.push(
        `${item.work_item_id}: quality_gate_cmd [${cmdText}] names test '${selector}' with no provable match, ` +
          `but ${corpus.sentinelFiles} test file(s) use dynamically-generated names (.each) the lint cannot ` +
          `enumerate — the selector may match a generated name; verify manually`,
      );
      continue;
    }

    flagged++;
    errors.push(
      `${item.work_item_id}: quality_gate_cmd [${cmdText}] names test '${selector}' that neither exists nor is ` +
        `created by this WI — vacuous pass risk (a non-matching ${extractor.name} selector exits 0 with no tests ` +
        `run), ADR 037. Fix: add the test's file to creates: (write-first protocol), or point the gate at an ` +
        `existing test.`,
    );
  }

  let truncated = false;
  let skippedFiles = 0;
  for (const corpus of corpusCache.values()) {
    truncated = truncated || corpus.truncated;
    skippedFiles += corpus.skippedFiles;
  }

  return { checked, flagged, warned, errors, warnings, truncated, skippedFiles, configError: null };
}
