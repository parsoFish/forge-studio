/**
 * Per-KB lint summary (forge-2am, R6-07 option (b)).
 *
 * Extracted from cli/bridge-studio-kbs.ts (which must SHRINK, not grow) so the
 * per-check itemization logic `buildKbHealth` already used has ONE home, and
 * so the EXISTING `GET /api/studio/kbs` list route can fold a cheap per-KB
 * lint summary into its response — Home reads it through the SAME existing
 * `fetchStudioKbs()`, no new polling path, no persisted status field anywhere
 * (derive-don't-store, brain/cycles/themes/derive-status-dont-store-it.md).
 *
 * The findings-scoping helpers below (`findingUnderDir`, `scopeFindingsToKb`)
 * and the `CheckHealthStatus`/`CheckHealthEntry` types moved here from
 * cli/bridge-studio-kbs.ts — `buildKbHealth` there calls `computeKbLintChecks`
 * instead of carrying its own copy of the itemization logic, so there is
 * exactly ONE derivation.
 */

import { readdirSync, statSync, type Dirent } from 'node:fs';
import { join } from 'node:path';

import { pathUnderDir } from './brain-paths.ts';
import { tryGetKbBackend, type KbBackend } from './kb-backend.ts';
import { runBrainLint, classify, CHECK_NAMES, CHECK_SCOPE, themeScanFiles, type Finding, type RunBrainLintResult } from './brain-lint.ts';

// ---------------------------------------------------------------------------
// Findings-scoping helpers (moved verbatim from cli/bridge-studio-kbs.ts)
// ---------------------------------------------------------------------------

/**
 * R1-06 WI-3 review MAJOR 1 + MAJOR 2 — the ONE exact-dir scoping root both a
 * KB's health lint COUNT (read) and its consolidate/fix-auto obligation (WRITE)
 * share. A finding belongs to `kbId` iff its file resolves to a path AT or
 * nested UNDER the KB's OWN brain dir, covering BOTH `brain/<id>` and the
 * central per-project `brain/projects/<id>` (ADR 035). This entry point takes
 * an already-resolved `brainDir` (the drain and the bridge hold one); the
 * kbId-shaped question is `KbBackend.contains`, and both route through the ONE
 * comparison in `brain-paths.ts::pathUnderDir` so read scope and write scope
 * cannot drift apart.
 *
 * The two shapes this replaces were both live defects:
 *   - substring `f.file.includes(kbId)` (the old `scopeFindingsToKb`) folded a
 *     SIBLING like `alpha-two` into `alpha` — and because consolidate turns the
 *     scope into WRITES, consolidating `alpha` mutated `brain/projects/alpha-two/`
 *     (cross-KB write, MAJOR 2);
 *   - the hardcoded `brain/<id>` prefix (buildKbHealth's old filter) matched
 *     NOTHING for a project brain at `brain/projects/<id>`, so health reported
 *     lintFlags=0 and hid the Lint section for exactly the project KBs WI-3
 *     targets (declared-data-fails-open, MAJOR 1).
 *
 * Comparison is by identity-after-realpath (not a lexical prefix) — see
 * `pathUnderDir` for why, and for the TOCTOU fallback.
 */
export function findingUnderDir(forgeRoot: string, brainDir: string, f: Finding): boolean {
  return pathUnderDir(forgeRoot, brainDir, f.file);
}

/**
 * H8 — the KB's own store is reached through `KbBackend`, never resolved here.
 * `backend` is the seam, injected so this module never imports the resolution
 * it used to perform (SPEC.md §4: a per-KB read path that bypasses the backend
 * is a defect). It defaults to the real backend so no caller's signature moved;
 * `null` (an unknown kbId) is the same empty answer the direct resolution gave.
 */
export function scopeFindingsToKb(
  forgeRoot: string,
  kbId: string,
  findings: readonly Finding[],
  backend: KbBackend | null = tryGetKbBackend(forgeRoot, kbId),
): Finding[] {
  if (!backend) return [];
  return findings.filter((f) => (f.file ? backend.contains(f.file) : false));
}

/**
 * THE one per-KB finding lens: the single full-scope scan, scoped to this KB's
 * own resolved brain dir. Every read AND every fix path derives from here, so
 * the two can never diverge (derive-don't-store).
 *
 * It used to union that scan with a SECOND lens over the KB's own theme files
 * (`lintThemeFiles(listOwnThemeFiles(brainDir))`), because the shared
 * `readThemeFiles` scan walked `brain/cycles` + `brain/forge-dev` only and a
 * project or band KB was therefore never scanned at all. The scan now covers
 * every theme dir (ADR 035), so the compensator is not merely redundant but
 * actively wrong: `lintThemeFiles` resolves a project theme's category index in
 * the project's own dir and emits `checkIndexSync` for it, a finding the
 * full-scope lint does not report — Studio counted a flag `forge brain lint`
 * did not have, and the drain would have been dispatched to fix it.
 *
 * Every returned finding carries a `resolution` — an unstamped finding is
 * `classify()`-stamped; an already-classified one is passed through UNTOUCHED
 * (classify() re-derives kind/resolution from the check name, which would
 * clobber a caller-supplied classification).
 */
export function collectKbFindings(
  forgeRoot: string,
  kbId: string,
  findings: readonly Finding[],
  backend: KbBackend | null = tryGetKbBackend(forgeRoot, kbId),
): Finding[] {
  return scopeFindingsToKb(forgeRoot, kbId, findings, backend).map((f) => (f.resolution ? f : classify(f)));
}

// ---------------------------------------------------------------------------
// Per-check itemization (moved verbatim from cli/bridge-studio-kbs.ts)
// ---------------------------------------------------------------------------

/** R6-08 WI-1 — per-check itemization row. `status` is 'unknown' only when
 *  the whole lint run threw (RULING 3) — never a per-check outcome otherwise.
 *
 *  R6-08 4on (declared-data-fails-open fix) — `status:'n/a'` means this check
 *  never actually inspected THIS KB's content: neither the shared full-scope
 *  scan (`readThemeFiles`-based, forge-cycles/forge-dev only) nor this KB's
 *  own theme files (via `lintThemeFiles`) cover it. THE HONESTY INVARIANT: a
 *  check reports `'pass'` ONLY when it genuinely ran over this KB's content
 *  and found nothing — a check that never looked reports `'n/a'`, never a
 *  silent `'pass'`. */
export type CheckHealthStatus = 'pass' | 'warn' | 'fail' | 'unknown' | 'n/a';
export type CheckHealthEntry = { check: string; status: CheckHealthStatus; errorCount: number; flagCount: number };

// ---------------------------------------------------------------------------
// computeKbLintChecks — the itemization lifted out of buildKbHealth
// ---------------------------------------------------------------------------

/**
 * Itemize ALREADY-COMPUTED findings (from a single `runBrainLint` call) per
 * CHECK_NAMES for one KB. This is the exact logic `buildKbHealth`
 * (cli/bridge-studio-kbs.ts) used to carry inline — lifted out so both
 * `buildKbHealth` (per-KB detail route) and `attachKbLintSummaries` (list
 * route, one lint run for the WHOLE list) share ONE derivation.
 *
 * Deliberately takes `findings` as a parameter and does NOT call
 * `runBrainLint` itself — the caller decides how often the full corpus lint
 * runs (once per detail-route call for `buildKbHealth`; once total for the
 * whole list for `attachKbLintSummaries`).
 *
 * THE HONESTY INVARIANT: a check reports 'pass' ONLY if it actually inspected
 * THIS KB and found nothing. A check neither in this KB's scan domain
 * (CHECK_SCOPE) NOR covered by its own theme files (LINT_THEME_FILE_CHECKS)
 * reports 'n/a' — NEVER 'pass'.
 */
export function computeKbLintChecks(
  forgeRoot: string,
  kbId: string,
  findings: readonly Finding[],
  backend: KbBackend | null = tryGetKbBackend(forgeRoot, kbId),
): { checks: CheckHealthEntry[]; lintErrors: number; lintFlags: number } {
  const scopedFull = scopeFindingsToKb(forgeRoot, kbId, findings, backend);

  // Is this KB's brain dir within a given check's CHECK_SCOPE domain? Every
  // arm DERIVES the answer from cli/brain-lint.ts — this function holds no
  // copy of what the scan covers. It used to hardcode the two forge sub-wikis
  // here, which stayed silently correct only for as long as `readThemeFiles`
  // walked exactly those two.
  const scanReadThisKb =
    backend !== null && themeScanFiles(forgeRoot).some((f) => backend.ownsTheme(f));
  const isApplicableScoped = (name: string): boolean => {
    if (!backend) return false;
    switch (CHECK_SCOPE[name]) {
      case 'themes':
        // Applicable iff the full-scope scan actually READ a theme of this KB.
        return scanReadThisKb;
      case 'forge-themes':
        // The ADR 018 category→sub-wiki routing rules; forge sub-wikis only.
        return backend.placement() === 'forge';
      case 'project-indexes':
        // checkProjectBrainIndexes walks brain/projects/* — applicable iff
        // this KB is a central per-project brain (ADR 035).
        return backend.placement() === 'project';
      case 'global':
      default:
        // checkReflectorLoss (_queue/done) is never scoped to any one KB.
        return false;
    }
  };

  const checks: CheckHealthEntry[] = CHECK_NAMES.map((name) => {
    if (!isApplicableScoped(name)) {
      // Never scanned THIS kb for this check — honest 'n/a', never 'pass'.
      return { check: name, status: 'n/a' as const, errorCount: 0, flagCount: 0 };
    }
    const list = scopedFull.filter((f) => f.check === name);
    const errorCount = list.filter((f) => f.category === 'error').length;
    const flagCount = list.filter((f) => f.category === 'flag' || f.category === 'auto-fix').length;
    const status: CheckHealthStatus = errorCount > 0 ? 'fail' : flagCount > 0 ? 'warn' : 'pass';
    return { check: name, status, errorCount, flagCount };
  });

  // The aggregate rolls up over EVERY finding scoped to this KB, regardless of
  // whether its `check` is one of CHECK_NAMES — so a finding whose check name
  // isn't itemized is never silently dropped from the totals.
  const lintErrors = scopedFull.filter((f) => f.category === 'error').length;
  const lintFlags = scopedFull.filter((f) => f.category === 'flag' || f.category === 'auto-fix').length;

  return { checks, lintErrors, lintFlags };
}

// ---------------------------------------------------------------------------
// Full-scope lint memoization (ADR 044 — read-path memoization, W6-P2)
// ---------------------------------------------------------------------------

/**
 * COMPLETENESS TABLE — every `FULL_SCOPE_CHECKS` function's fs reads
 * (cli/brain-lint.ts), enumerated from each check's OWN code, not assumed
 * from a walk. Re-verify this table by hand whenever a check in that
 * registry changes what it reads — it is the proof that `statWalkFingerprint`
 * below actually covers the derivation's real inputs (ADR 044 rule 2), not
 * documentation of what a walk happens to do.
 *
 *   checkFrontmatter          readThemeFiles(brain/)                              → confined to brain/
 *   checkIndexSync            readThemeFiles + readIndexEntries(brain/{cycles,
 *                              forge-dev}/<indexFile>)                            → confined to brain/
 *   checkSourceLinks          readThemeFiles + existsSync(resolve(dirname(theme
 *                              File), relLink)) for every markdown-link target in
 *                              a theme body, PLUS findThemeBySlug(brain/) for
 *                              wikilinks (:539)                                   → relLink resolution is
 *                              UNBOUNDED BY DESIGN (cli/brain-lint.ts:525): a
 *                              theme author's relative link can climb `../` any
 *                              number of times and land anywhere under forgeRoot.
 *                              The real corpus today (verified by grep,
 *                              2026-08-15) reaches PRINCIPLES.md, ARCHITECTURE.md,
 *                              cli/, docs/, apps/studio/, orchestrator/, scripts/,
 *                              .github/ — a curated allowlist would already be
 *                              incomplete against it and would silently rot the
 *                              next time a theme cites a new top-level path. This
 *                              is why the walk below covers forgeRoot itself
 *                              rather than a hand-picked root list.
 *   checkStaleness             readThemeFiles + existsSync(resolve(forgeRoot,p))
 *                              for p prefixed docs/ orchestrator/ skills/ loops/
 *                              (cli/brain-lint.ts:601)                           → bounded to exactly
 *                              those 4 prefixes; brain/-prefixed and any other
 *                              prefix are explicitly skipped (:596/:600/:613) —
 *                              already a subset of what checkSourceLinks forces
 *                              this fingerprint to cover anyway.
 *   checkOrphans               collectIndexLinkTargets(brain/INDEX.md + brain/
 *                              {cycles,forge-dev}/*.md) + readThemeFiles         → confined to brain/
 *   checkProjectBrainIndexes   readdirSync(brain/projects) + per-project themes/
 *                              index files                                       → confined to brain/projects/
 *   checkLengthSoftCap         readThemeFiles(brain/)                            → confined to brain/
 *   checkCategoryScope         readThemeFiles(brain/)                            → confined to brain/
 *   checkReflectorLoss         readdirSync(_queue/done) + readdirSync(brain/
 *                              cycles/_raw)                                      → _queue/done is OUTSIDE
 *                              brain/ — the other bounded exception (besides
 *                              checkSourceLinks' unbounded one above).
 *   checkDanglingEdges         collectAllThemeSlugs(brain/{cycles,forge-dev,
 *                              projects/*}/themes) + readThemeFiles;
 *                              related_themes is tested by SET MEMBERSHIP only
 *                              (cli/brain-lint.ts:970), never resolved to a path → confined to brain/
 *   checkDuplicateThemes       pure — operates on readThemeFiles' already-parsed
 *                              results, no fs read of its own                    → confined to brain/
 *   checkCleanupCandidates     brain/cycles/_raw                                 → EXCLUDED: only runs
 *                              under `scope:'cleanup-dry-run'` (runBrainLint's
 *                              conditional spread), never reached by
 *                              `runBrainLintFullMemoized`/`FullFresh`'s fixed
 *                              `scope:'full'` — not part of this derivation.
 *
 * Net: every check's domain is brain/, except checkReflectorLoss (_queue/done,
 * bounded) and checkSourceLinks (forgeRoot-wide, unbounded). Given that, the
 * walk below covers forgeRoot itself (minus a defensive exclude-list of
 * gitignored runtime/vendor state that no check reads and that would
 * otherwise grow the walk without bound), not a curated allowlist.
 */

/** Directory names skipped ANYWHERE in the tree, dir or file (this worktree's
 *  own `.git` is a file, not a directory) — vendor/VCS internals no check
 *  reads and that can be arbitrarily large (an npm-workspace `node_modules`
 *  under `apps/studio/`, for one). */
const FINGERPRINT_SKIP_ANYWHERE = new Set(['node_modules', '.git', '.next']);

/** Top-level directories (relative to forgeRoot) skipped entirely: gitignored
 *  runtime/managed-project state that grows without bound over a campaign's
 *  lifetime and that no `FULL_SCOPE_CHECKS` function reads (see the
 *  completeness table above). `_queue` is handled separately below — only
 *  `_queue/done/` (`checkReflectorLoss`'s actual input) is walked; its
 *  siblings (`in-flight/pending/failed`) are excluded for the same reason. */
const FINGERPRINT_SKIP_TOPLEVEL = new Set([
  '_logs', 'projects', '.forge',
  // Agent-harness + campaign scratch (gitignored, no check reads them). The
  // 2026-08-15 wave-6 bridge measured 64k files / 290ms per fingerprint on a
  // tree carrying 27 `.claude/worktrees/*` clones (22 GB) — the key cost
  // exceeded the lint it memoized. Anything matching /^_wave\d+$/ is also
  // skipped below. Git-tracked dirs (demos/) stay WALKED — a theme
  // may cite them (checkSourceLinks' domain is unbounded).
  '.claude', '_dry-bridge',
]);
const FINGERPRINT_SKIP_TOPLEVEL_RE = /^_wave\d+$/;

/**
 * Cheap stat-walk fingerprint of `runBrainLint({ scope: 'full' })`'s actual
 * inputs, per the completeness table above: `readdir` + `stat` only, no file
 * content reads, so this stays low-ms even over forge's own ~2000-file
 * reachable tree (measured; see the commit that introduced/extended this
 * function for the number). Every `.md` file under `brain/` gets the same
 * `.md`-only filter as before (`brain-lint.ts` never reads a non-`.md` file
 * there — checked, no `kb.yaml` reference anywhere in that file, so a kb.yaml
 * edit alone still does not invalidate the memo); everywhere else, ALL file
 * types count, because `checkStaleness`/`checkSourceLinks` can cite a path of
 * any extension. Symlinked directories are never followed
 * (`Dirent.isDirectory()` reflects the link itself, not its target), which
 * also rules out a symlink cycle blowing the stack.
 *
 * Throws on any unexpected `readdir`/`stat` failure (permission error,
 * ENOTDIR from a path component that turned out to be a plain file, a TOCTOU
 * unlink between listing and stat) — every caller (`runBrainLintFullMemoized`,
 * `runBrainLintFullFresh`) treats a throw as ADR 044 rule 4's "any doubt" and
 * falls straight through to (or forces) an uncached `runBrainLint` call. A
 * directory that legitimately does not exist yet (`_queue/done` before any
 * cycle has completed, or a `brain/` subdir not yet created) is NOT an error
 * — it contributes zero files, the same as `readThemeFiles`'s own
 * `existsSync` guard treats it.
 */
export type BrainTreeFingerprint = { fileCount: number; maxMtimeMs: number; totalSize: number };

export function statWalkFingerprint(forgeRoot: string): BrainTreeFingerprint {
  let fileCount = 0;
  let maxMtimeMs = 0;
  let totalSize = 0;

  const walk = (dir: string, relFromRoot: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      if (FINGERPRINT_SKIP_ANYWHERE.has(entry.name)) continue;
      const full = join(dir, entry.name);
      const rel = relFromRoot === '' ? entry.name : `${relFromRoot}/${entry.name}`;
      if (entry.isDirectory()) {
        if (relFromRoot === '' && (FINGERPRINT_SKIP_TOPLEVEL.has(entry.name) || FINGERPRINT_SKIP_TOPLEVEL_RE.test(entry.name))) continue;
        if (relFromRoot === '' && entry.name === '_queue') {
          // Only checkReflectorLoss's actual input matters — done/ — not its
          // siblings, which can be large and change constantly mid-campaign.
          walk(join(full, 'done'), `${rel}/done`);
          continue;
        }
        walk(full, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      // brain-lint.ts never reads a non-.md file under brain/; everywhere
      // else a check can cite ANY extension (checkStaleness/checkSourceLinks
      // resolve whatever string the theme content names), so only brain/
      // gets the .md filter.
      if (rel.startsWith('brain/') && !entry.name.endsWith('.md')) continue;
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch (err) {
        // TOCTOU: unlinked between readdir and stat — skip it rather than
        // failing the whole walk (mirrors findingUnderDir's own TOCTOU stance
        // above).
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
      fileCount += 1;
      if (st.mtimeMs > maxMtimeMs) maxMtimeMs = st.mtimeMs;
      totalSize += st.size;
    }
  };

  walk(forgeRoot, '');

  return { fileCount, maxMtimeMs, totalSize };
}

function fingerprintKey(fp: BrainTreeFingerprint): string {
  return `${fp.fileCount}:${fp.maxMtimeMs}:${fp.totalSize}`;
}

/** Memory-only, keyed per forgeRoot (ADR 044 rule 3 — dies with the process,
 *  never persisted). A test process spinning up many isolated `forgeRoot`
 *  fixtures never collides across them. */
const brainLintFullMemoByRoot = new Map<string, { key: string; result: RunBrainLintResult }>();

/**
 * Memory-only, mtime-keyed memo of `runBrainLint({ cwd: forgeRoot, scope:
 * 'full' })` (ADR 044). Every full-scope read path behind the Studio bridge
 * — `GET /api/studio/kbs` (via `attachKbLintSummaries` below), the per-KB
 * detail/health route, the kb-cleanup session's live findings, and the KB
 * maintenance `op:'lint'` action, all in cli/bridge-studio-kbs.ts — shares
 * this ONE memo keyed by forgeRoot, so a long-lived bridge process serving
 * many requests against an unchanged brain tree pays the full ~500-file lint
 * once, not once per request.
 *
 * Same derivation, always (ADR 044 rule 1): a cache hit and a cache miss
 * return the exact `RunBrainLintResult` `runBrainLint` itself would produce
 * for the current on-disk state — this function never computes anything
 * `runBrainLint` doesn't. On any doubt about the fingerprint (the stat-walk
 * throws), this falls straight through to an uncached `runBrainLint` call
 * and does NOT update the memo — a memo can never be the only way to
 * produce the value (rule 4).
 *
 * The CLI's own `forge brain lint` command (cli/brain-lint.ts's `main`) and
 * `applyAutoFixesUntilStable`'s internal fixed-point re-lint loop are
 * DELIBERATELY not routed through this: the CLI runs as its own short-lived
 * process (never imports this module, so it can't touch this memo even by
 * accident), and the fixed-point loop's whole job is to observe its OWN
 * writes on each iteration — exactly the freshness a memo would risk
 * undermining on a fast filesystem where two writes could land in the same
 * millisecond.
 *
 * ONLY for a read that has no writes of its own to observe. A read that must
 * see writes made earlier in the SAME call — e.g. a post-mutation re-lint —
 * cannot trust this: see `runBrainLintFullFresh` below.
 */
export function runBrainLintFullMemoized(forgeRoot: string): RunBrainLintResult {
  let key: string | null;
  try {
    key = fingerprintKey(statWalkFingerprint(forgeRoot));
  } catch {
    key = null;
  }

  if (key !== null) {
    const cached = brainLintFullMemoByRoot.get(forgeRoot);
    if (cached && cached.key === key) return cached.result;
  }

  const result = runBrainLint({ cwd: forgeRoot, scope: 'full' });
  if (key !== null) {
    brainLintFullMemoByRoot.set(forgeRoot, { key, result });
  } else {
    // Don't leave a stale entry behind a fingerprint we couldn't trust.
    brainLintFullMemoByRoot.delete(forgeRoot);
  }
  return result;
}

/**
 * ALWAYS forces the real `runBrainLint({ scope: 'full' })` derivation —
 * NEVER consults the memo — then REPLACES the memo entry for `forgeRoot`
 * with this fresh result, keyed on a fingerprint computed AFTER the fresh
 * run. Reviewer-flagged (2026-08-15): a post-mutation re-lint that runs
 * moments after a PRE-mutation `runBrainLintFullMemoized` read in the same
 * function (`runBrainConsolidateNow`, cli/bridge-studio-kbs.ts) cannot trust
 * the memo it may have just seeded — a size-neutral write landing in the
 * same millisecond as the pre-mutation read is exactly the blind spot
 * `statWalkFingerprint` accepts by design (same trade-off ADR 044 names for
 * every stat-based fingerprint in this codebase), and this call is the one
 * place that blind spot would silently corrupt an operator-visible count
 * (`clearedCount`) rather than just serve a page a beat late.
 *
 * Because this never reads the cache, its RETURN VALUE is correct
 * regardless of any fingerprint collision — the only thing a collision could
 * affect is whether the memo entry THIS call writes matches an entry a
 * DIFFERENT, later collision could reuse, which is the same accepted
 * blind spot every memoized read already lives with, not a new one.
 *
 * Every OTHER full-scope call site (a pre-mutation read, or a route that
 * performs no write of its own — `attachKbLintSummaries`, `buildKbHealth`,
 * `computeAgentCleanupFindings`, the maintenance `op:'lint'` action, and
 * `runBrainConsolidateNow`'s own initial scan) stays on
 * `runBrainLintFullMemoized` — forcing every read would defeat the whole
 * point of W6-P2.
 */
export function runBrainLintFullFresh(forgeRoot: string): RunBrainLintResult {
  const result = runBrainLint({ cwd: forgeRoot, scope: 'full' });
  let key: string | null;
  try {
    key = fingerprintKey(statWalkFingerprint(forgeRoot));
  } catch {
    key = null;
  }
  if (key !== null) {
    brainLintFullMemoByRoot.set(forgeRoot, { key, result });
  } else {
    brainLintFullMemoByRoot.delete(forgeRoot);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Cheap per-KB summary for the list route (forge-2am)
// ---------------------------------------------------------------------------

export type KbLintSummary = { errors: number; flags: number; checksRun: number; checksTotal: number; error?: string };

/** Roll a `computeKbLintChecks` result up into the cheap `KbLintSummary` the
 *  list route serializes. `checksRun` counts only checks with a REAL verdict
 *  (`pass`/`warn`/`fail`) — a `'n/a'` (never scanned) or `'unknown'` (whole
 *  lint threw) check never counts as run (the honesty invariant). */
export function summarizeKbLintChecks(r: ReturnType<typeof computeKbLintChecks>): KbLintSummary {
  const checksRun = r.checks.filter((c) => c.status === 'pass' || c.status === 'warn' || c.status === 'fail').length;
  return {
    errors: r.lintErrors,
    flags: r.lintFlags,
    checksRun,
    checksTotal: CHECK_NAMES.length,
  };
}

/**
 * Fold a per-KB lint summary onto each kb descriptor for the
 * `GET /api/studio/kbs` list route — ONE `runBrainLintFullMemoized` call
 * for the WHOLE list (never a per-KB re-run, the exact cost
 * `_wave5/parks/R6-07-kb-skew-report-dont-patch.md` option (a) refused), then
 * `computeKbLintChecks` + `summarizeKbLintChecks` per kb over the shared
 * findings. `runBrainLintFullMemoized` (ADR 044, above) serves this from the
 * in-process memo when the brain tree hasn't changed since the last call —
 * the SAME `runBrainLint({ scope: 'full' })` derivation either way, so this
 * function's own output is unaffected by whether the call underneath it was
 * a cache hit or a cold run.
 *
 * Returns NEW objects — the input `kbs` array and its elements are never
 * mutated. If the single lint run itself throws, EVERY kb gets an honest
 * failure summary (`checksRun:0`, `error:<message>`) — never a silent clean
 * result (RULING 3, mirrored from `buildKbHealth`).
 */
export function attachKbLintSummaries<T extends { id: string }>(
  forgeRoot: string,
  kbs: readonly T[],
): (T & { lint: KbLintSummary })[] {
  let findings: readonly Finding[] | null = null;
  let runError: string | undefined;
  try {
    findings = runBrainLintFullMemoized(forgeRoot).findings;
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
  }

  return kbs.map((kb) => {
    if (findings === null) {
      return {
        ...kb,
        lint: { errors: 0, flags: 0, checksRun: 0, checksTotal: CHECK_NAMES.length, error: runError },
      };
    }
    try {
      const computed = computeKbLintChecks(forgeRoot, kb.id, findings);
      return { ...kb, lint: summarizeKbLintChecks(computed) };
    } catch (err) {
      // Never silently swallow a per-kb failure into a fake-clean summary —
      // degrade THIS kb honestly without failing the whole list response.
      return {
        ...kb,
        lint: {
          errors: 0,
          flags: 0,
          checksRun: 0,
          checksTotal: CHECK_NAMES.length,
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  });
}
