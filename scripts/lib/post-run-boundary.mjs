/**
 * post-run-boundary — R5-01-F3 harness post-run boundary check.
 *
 * Why this exists: on 2026-07-16 a `ui:journey` run's bridge child
 * self-merged a REAL forge PR (#23) with the operator's own `gh` token, and
 * the harness exited green without noticing — nobody was checking whether
 * the world outside the harness had moved. A2 (dry-bridge seam) and A3
 * (route-coverage drift guard) close the hole at the source; this module is
 * the independent backstop — even if a guard fails, the harness must NOTICE
 * that the repo/PR state changed underneath it.
 *
 * A snapshot is captured with {@link captureBoundaryBaseline} BEFORE a
 * harness run and again AFTER; {@link compareBoundary} diffs the two;
 * {@link formatBoundaryReport} renders the result for the harness's own log.
 *
 * Two rules baked into the diff, both required by the R5-01-F3 spec:
 *   - gh degrade rule: a missing/unauthenticated `gh` records `prs: null`
 *     and PR-state checking is SKIPPED (not failed) — git checks stay hard,
 *     but a gh outage must never crash the harness on its own.
 *   - pre-existing-dirt rule: only NEW dirt (a path dirty in `current` that
 *     was clean in `baseline`) is a violation, so a legitimately-dirty
 *     operator tree never false-positives.
 */
import { spawnSync } from 'node:child_process';

/** Page size for the open-PR capture — far above any realistic open-PR count
 *  on a single-operator repo, so the snapshot is never silently truncated. */
const GH_PR_LIST_LIMIT = 200;

/**
 * @typedef {{ number: number, state: string, headRefName: string }} PrRecord
 * @typedef {{ headSha: string, statusPorcelain: string, prs: PrRecord[] | null }} BoundarySnapshot
 * @typedef {
 *   | { type: 'head-moved', before: string, after: string }
 *   | { type: 'tree-dirtied', path: string, before: null, after: string }
 *   | { type: 'pr-state-changed', prNumber: number, before: PrRecord | null, after: PrRecord | null }
 * } BoundaryViolation
 */

/**
 * Run a git subcommand against repoRoot. Git checks stay hard per the spec:
 * unlike the gh degrade rule, a git failure here throws — a repo forge is
 * supposedly protecting that git itself can't inspect is a harder failure
 * than a missing PR-state check.
 */
function runGit(repoRoot, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.error) {
    throw new Error(`post-run-boundary: git ${args.join(' ')} failed to spawn: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`post-run-boundary: git ${args.join(' ')} exited ${result.status}: ${(result.stderr ?? '').trim()}`);
  }
  return result.stdout;
}

/**
 * Default PR capture: `gh pr list --json number,state,headRefName`, scoped
 * to whichever repo `repoRoot`'s git remote points at (never hardcoded).
 * Returns `null` on ANY failure — missing binary, no auth, network error,
 * non-JSON output — the gh-degrade rule: a gh outage must never crash the
 * harness by itself.
 * @param {string} repoRoot
 * @returns {PrRecord[] | null}
 */
export function defaultGhPrList(repoRoot) {
  const result = spawnSync(
    'gh',
    ['pr', 'list', '--json', 'number,state,headRefName', '--limit', String(GH_PR_LIST_LIMIT)],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((pr) => ({ number: pr.number, state: pr.state, headRefName: pr.headRefName }));
  } catch {
    return null;
  }
}

/**
 * Capture a point-in-time snapshot of a repo's git/PR boundary. Call this
 * once before a harness run (the "baseline") and once after (the
 * "current"), then diff the two with {@link compareBoundary}.
 * @param {{ repoRoot: string, ghPrList?: (repoRoot: string) => PrRecord[] | null }} opts
 * @returns {BoundarySnapshot}
 */
export function captureBoundaryBaseline({ repoRoot, ghPrList = defaultGhPrList }) {
  if (!repoRoot) throw new Error('post-run-boundary: repoRoot is required');
  const headSha = runGit(repoRoot, ['log', '-1', '--format=%H']).trim();
  // --untracked-files=all: git's default porcelain collapses a wholly-untracked
  // directory to its shallowest line (`?? demos/` even though only
  // demos/e2e/index.html was written); expanding to per-file paths keeps the
  // ignore-prefix matching in compareBoundary segment-exact.
  const statusPorcelain = runGit(repoRoot, ['status', '--porcelain', '--untracked-files=all']);
  const prs = ghPrList(repoRoot);
  return { headSha, statusPorcelain, prs };
}

/**
 * Parse `git status --porcelain` (v1) text into Map<path, rawLine>. Porcelain
 * v1 lines are always `XY<space>PATH` (3 leading chars); rename lines
 * (`R  old -> new`) key on the destination path.
 */
function parsePorcelainPaths(statusPorcelain) {
  const map = new Map();
  for (const line of statusPorcelain.split('\n')) {
    if (!line) continue;
    const rest = line.slice(3);
    const arrowIndex = rest.indexOf(' -> ');
    const path = arrowIndex >= 0 ? rest.slice(arrowIndex + 4) : rest;
    map.set(path, line);
  }
  return map;
}

/**
 * Diff two boundary snapshots.
 *
 * `ignorePathPrefixes` lets a caller declare ITS OWN known/expected write
 * surface (e.g. a demo gallery the harness itself regenerates every run) so
 * that legitimate harness output isn't reported as a stray mutation. Each
 * caller supplies its own list — the module never hardcodes one. Matching is
 * segment-exact: a directory entry (normalized to a trailing '/') excuses
 * only paths under that exact directory — never a bare string prefix, so
 * `demos/e2e/` does NOT excuse `demos/e2e-extra.txt` or `demos/e` — and an
 * entry without a trailing '/' also excuses that one exact file path (e.g.
 * `brain/INDEX.md`).
 *
 * @param {BoundarySnapshot} baseline
 * @param {BoundarySnapshot} current
 * @param {{ ignorePathPrefixes?: string[] }} [options]
 * @returns {{ clean: boolean, violations: BoundaryViolation[], prsSkipped: boolean }}
 */
export function compareBoundary(baseline, current, options = {}) {
  const { ignorePathPrefixes = [] } = options;
  // One-directional, segment-exact matching (capture uses --untracked-files=all
  // so reported paths are always real per-file paths, never a collapsed parent
  // directory): a path is excused iff it equals an entry verbatim (exact-file
  // exemption) or sits under an entry as a directory (normalized to '/').
  const dirPrefixes = ignorePathPrefixes.map((p) => (p.endsWith('/') ? p : `${p}/`));
  const isIgnored = (path) => ignorePathPrefixes.includes(path)
    || dirPrefixes.some((prefix) => path.startsWith(prefix));
  const violations = [];

  if (baseline.headSha !== current.headSha) {
    violations.push({ type: 'head-moved', before: baseline.headSha, after: current.headSha });
  }

  const baselinePaths = parsePorcelainPaths(baseline.statusPorcelain);
  const currentPaths = parsePorcelainPaths(current.statusPorcelain);
  for (const [path, line] of currentPaths) {
    if (baselinePaths.has(path) || isIgnored(path)) continue;
    violations.push({ type: 'tree-dirtied', path, before: null, after: line });
  }

  const prsSkipped = baseline.prs === null || current.prs === null;
  if (!prsSkipped) {
    const beforeByNumber = new Map(baseline.prs.map((pr) => [pr.number, pr]));
    const afterByNumber = new Map(current.prs.map((pr) => [pr.number, pr]));
    const allNumbers = new Set([...beforeByNumber.keys(), ...afterByNumber.keys()]);
    for (const prNumber of allNumbers) {
      const before = beforeByNumber.get(prNumber) ?? null;
      const after = afterByNumber.get(prNumber) ?? null;
      const changed = !before || !after
        || before.state !== after.state
        || before.headRefName !== after.headRefName;
      if (changed) violations.push({ type: 'pr-state-changed', prNumber, before, after });
    }
  }

  return { clean: violations.length === 0, violations, prsSkipped };
}

/**
 * Render the human-readable boundary report. Callers print this
 * unconditionally — success or failure — same "the video always finishes"
 * philosophy the rest of the harness follows.
 * @param {{ clean: boolean, violations: BoundaryViolation[], prsSkipped: boolean }} result
 * @param {{ label?: string }} [options]
 * @returns {string}
 */
export function formatBoundaryReport(result, options = {}) {
  const { label = 'post-run boundary' } = options;
  const { clean, violations, prsSkipped } = result;
  const lines = [`[${label}] ${clean ? 'CLEAN' : `${violations.length} VIOLATION(S)`}`];
  for (const violation of violations) {
    if (violation.type === 'head-moved') {
      lines.push(`  ✗ head-moved: ${violation.before} -> ${violation.after}`);
    } else if (violation.type === 'tree-dirtied') {
      lines.push(`  ✗ tree-dirtied: new dirt at ${violation.path} (${violation.after.trim()})`);
    } else {
      const describe = (pr) => (pr ? `#${pr.number} ${pr.state} (${pr.headRefName})` : '(absent)');
      lines.push(`  ✗ pr-state-changed: ${describe(violation.before)} -> ${describe(violation.after)}`);
    }
  }
  lines.push(`  pr-state: ${prsSkipped ? 'skipped (gh unavailable)' : 'checked'}`);
  return lines.join('\n');
}
