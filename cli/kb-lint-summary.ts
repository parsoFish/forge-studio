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
 * and the per-check itemization helpers (`listOwnThemeFiles`,
 * `findingIdentity`, `unionFindings`, the `KB_OWN_THEME_INDEX_FILES` set, and
 * the `CheckHealthStatus`/`CheckHealthEntry` types) moved here VERBATIM from
 * cli/bridge-studio-kbs.ts — `buildKbHealth` there still uses
 * `scopeFindingsToKb`/`findingUnderDir` directly (re-exported), and now calls
 * `computeKbLintChecks` instead of carrying its own copy of the itemization
 * logic, so there is exactly ONE derivation.
 */

import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { guardedReadDir } from './studio-path-guard.ts';
import { resolveKbBrainDir } from '../orchestrator/brain-paths.ts';
import { runBrainLint, CHECK_NAMES, CHECK_SCOPE, LINT_THEME_FILE_CHECKS, lintThemeFiles, type Finding } from './brain-lint.ts';

// ---------------------------------------------------------------------------
// Findings-scoping helpers (moved verbatim from cli/bridge-studio-kbs.ts)
// ---------------------------------------------------------------------------

/**
 * R1-06 WI-3 review MAJOR 1 + MAJOR 2 — the ONE exact-dir scoping root both a
 * KB's health lint COUNT (read) and its consolidate/fix-auto obligation (WRITE)
 * share. A finding belongs to `kbId` iff its file resolves to a path AT or
 * nested UNDER the KB's OWN resolved brain dir — `resolveKbBrainDir`, the SAME
 * resolution consolidate/lint/health use, covering BOTH `brain/<id>` and the
 * central per-project `brain/projects/<id>` (ADR 035).
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
 * Comparison is by identity-after-realpath (not a lexical prefix): the finding's
 * file is realpath'd where it exists, matching `resolveKbBrainDir`'s own
 * realpath'd return — so a symlinked forge-root component (e.g. macOS `/tmp`)
 * can't defeat the prefix check, and a theme reached through a symlink that
 * escapes the dir is correctly EXCLUDED from a write scope rather than folded in.
 */
export function findingUnderDir(forgeRoot: string, brainDir: string, f: Finding): boolean {
  if (!f.file) return false;
  const abs = resolve(forgeRoot, f.file);
  // Never let a realpath fs-throw (e.g. a TOCTOU unlink between existsSync and
  // realpathSync) escape the scoping path and 500 an otherwise-fine lint —
  // fall back to the lexical absolute path.
  let real = abs;
  try {
    if (existsSync(abs)) real = realpathSync(abs);
  } catch {
    real = abs;
  }
  return real === brainDir || real.startsWith(brainDir + sep);
}

export function scopeFindingsToKb(forgeRoot: string, kbId: string, findings: readonly Finding[]): Finding[] {
  const brainDir = resolveKbBrainDir(forgeRoot, kbId);
  if (!brainDir) return [];
  return findings.filter((f) => findingUnderDir(forgeRoot, brainDir, f));
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

/** Index/category pages that live alongside a KB's `themes/` dir siblings but
 *  are never themselves a theme — excluded from the KB's OWN theme-file list.
 *  Mirrors `orchestrator/kb-health.ts`'s `THEME_INDEX_FILES` listing style
 *  (kept local rather than imported — that module lives under `orchestrator/`,
 *  which this fix does not touch). */
const KB_OWN_THEME_INDEX_FILES = new Set([
  'README.md',
  'patterns.md',
  'antipatterns.md',
  'operations.md',
  'decisions.md',
  'reference.md',
]);

/**
 * R6-08 4on — a KB's OWN theme files (`<brainDir>/themes/*.md`, index pages
 * excluded), for ANY KB kind — including project/band KBs whose themes the
 * shared `readThemeFiles`-based checks (cli/brain-lint.ts) never scan. This is
 * what lets `buildKbHealth` give those KBs a REAL (not silently-passing)
 * verdict on the `LINT_THEME_FILE_CHECKS` subset via `lintThemeFiles`.
 *
 * Routed through `guardedReadDir` (a recognized containment-guard producer,
 * cli/studio-path-guard.ts) rather than a raw `readdirSync` — `brainDir` is
 * split back into its trusted base + its own leaf segment (mirrors this
 * file's `guardKbTail` convention) so the leaf re-enters as a `segments[]`
 * element and is identity-checked, never folded into the guard's `root`.
 */
function listOwnThemeFiles(brainDir: string): string[] {
  const names = guardedReadDir(dirname(brainDir), [basename(brainDir), 'themes']);
  if (!names) return [];
  return names
    .filter((name) => name.endsWith('.md') && !KB_OWN_THEME_INDEX_FILES.has(name))
    .map((name) => join(brainDir, 'themes', name));
}

/** Stable identity for a Finding, used to union `scopedFull` and `ownFindings`
 *  without double-counting the SAME defect surfaced by both lenses (e.g. a
 *  forge-side KB's theme scanned by both the shared `readThemeFiles`-based
 *  check and `lintThemeFiles` emit byte-identical check/file/message). Two
 *  DIFFERENT checks (e.g. `checkProjectBrainIndexes` vs `checkIndexSync`)
 *  independently flagging the same underlying theme are NOT deduped — they
 *  are two genuinely distinct, now-real per-check verdicts. */
function findingIdentity(f: Finding): string {
  return `${f.check ?? ''}::${f.file}::${f.message}`;
}

/** Union two finding lists by `findingIdentity`, preserving `a`'s findings
 *  first then any of `b`'s not already present. */
function unionFindings(a: readonly Finding[], b: readonly Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const f of a) seen.set(findingIdentity(f), f);
  for (const f of b) if (!seen.has(findingIdentity(f))) seen.set(findingIdentity(f), f);
  return [...seen.values()];
}

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
): { checks: CheckHealthEntry[]; lintErrors: number; lintFlags: number } {
  const brainDir = resolveKbBrainDir(forgeRoot, kbId);
  const brainRoot = join(forgeRoot, 'brain');

  const scopedFull = scopeFindingsToKb(forgeRoot, kbId, findings);

  const ownThemeFiles = brainDir ? listOwnThemeFiles(brainDir) : [];
  const ownFindings = ownThemeFiles.length > 0 ? lintThemeFiles(forgeRoot, ownThemeFiles) : [];

  // Is this KB's brain dir within a given check's CHECK_SCOPE domain?
  const isApplicableScoped = (name: string): boolean => {
    if (!brainDir) return false;
    switch (CHECK_SCOPE[name]) {
      case 'forge-themes':
        // readThemeFiles (brain-lint.ts) only ever walks brain/cycles/themes
        // and brain/forge-dev/themes — a project/band KB's dir is never one
        // of these two exact top-level dirs.
        return brainDir === join(brainRoot, 'cycles') || brainDir === join(brainRoot, 'forge-dev');
      case 'project-indexes':
        // checkProjectBrainIndexes walks brain/projects/* — applicable iff
        // this KB's dir is a direct child of brain/projects/.
        return dirname(brainDir) === join(brainRoot, 'projects');
      case 'global':
      default:
        // checkReflectorLoss (_queue/done) is never scoped to any one KB.
        return false;
    }
  };
  const isCoveredByOwn = (name: string): boolean => LINT_THEME_FILE_CHECKS.has(name) && ownThemeFiles.length > 0;

  const checks: CheckHealthEntry[] = CHECK_NAMES.map((name) => {
    const applicable = isApplicableScoped(name);
    const coveredByOwn = isCoveredByOwn(name);
    if (!applicable && !coveredByOwn) {
      // Never scanned THIS kb for this check — honest 'n/a', never 'pass'.
      return { check: name, status: 'n/a' as const, errorCount: 0, flagCount: 0 };
    }
    const fromScoped = applicable ? scopedFull.filter((f) => f.check === name) : [];
    const fromOwn = coveredByOwn ? ownFindings.filter((f) => f.check === name) : [];
    const list = unionFindings(fromScoped, fromOwn);
    const errorCount = list.filter((f) => f.category === 'error').length;
    const flagCount = list.filter((f) => f.category === 'flag' || f.category === 'auto-fix').length;
    const status: CheckHealthStatus = errorCount > 0 ? 'fail' : flagCount > 0 ? 'warn' : 'pass';
    return { check: name, status, errorCount, flagCount };
  });

  // The aggregate rolls up over the FULL union of scopedFull ∪ ownFindings —
  // EVERY finding, regardless of whether its `check` is one of CHECK_NAMES —
  // so a finding whose check name isn't itemized is never silently dropped
  // from the totals.
  const allFindings = unionFindings(scopedFull, ownFindings);
  const lintErrors = allFindings.filter((f) => f.category === 'error').length;
  const lintFlags = allFindings.filter((f) => f.category === 'flag' || f.category === 'auto-fix').length;

  return { checks, lintErrors, lintFlags };
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
 * `GET /api/studio/kbs` list route — ONE `runBrainLint(scope:'full')` call
 * for the WHOLE list (never a per-KB re-run, the exact cost
 * `_wave5/parks/R6-07-kb-skew-report-dont-patch.md` option (a) refused), then
 * `computeKbLintChecks` + `summarizeKbLintChecks` per kb over the shared
 * findings.
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
    findings = runBrainLint({ cwd: forgeRoot, scope: 'full' }).findings;
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
