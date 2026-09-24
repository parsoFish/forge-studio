#!/usr/bin/env node
/**
 * check-one-door-imports — the M4 ruling 31 "one door" rule, as a shrinking
 * ratchet (bead forge-8vfn.5.31).
 *
 * THE CONSTRAINT THIS ENFORCES. A package's public door is
 * `packages/<pkg>/index.ts` — the barrel M4 ruling 31 populated per package.
 * An external consumer (a production file outside `packages/<pkg>/`) reaches
 * that package through `@forge/<pkg>`, never through a deep specifier like
 * `@forge/<pkg>/brain-paths.ts`: a deep path names an internal file the
 * package is free to move, rename or delete, and a consumer pinned to it
 * breaks on a refactor the door was built to absorb.
 *
 * WHY A BASELINE AND NOT A HARD FAIL. M4 ruling 31 populated every door
 * without repointing importers, so the tree started this check with several
 * hundred deep imports already in place. Mirroring `check-boundaries.mjs`'s
 * shape: the baseline is the SET of `<pkg>|<importer>|<module>` triples, so
 * a new violation fails even when an old one is fixed in the same PR, and a
 * fixed violation must be REMOVED from the baseline or it fails as stale —
 * there is no way to fix a violation and leave the baseline saying it still
 * exists. There is no `--write-baseline`.
 *
 * SCOPE: PRODUCTION files only, over `packages/ apps/ scripts/` (the same
 * three trees the bead's own census instruction names) — `*.test.*` and
 * anything under a `test-fixtures/` directory are excluded, matching the
 * `NOT_PRODUCTION` convention `check-owner.mjs` already uses. This is
 * DELIBERATELY NOT `productionFiles()` from `check-owner.mjs`: that
 * function's scope is the QUARRY-owned trees (`orchestrator/ cli/ loops/
 * skills/ packages/ apps/forge`) for the LOC-cap and ownership gates, which
 * excludes `apps/studio` and `scripts/` — both in scope here, so reusing it
 * would silently under-scan the two trees the bead names.
 *
 * A test file's deep import is not scanned here on purpose: the bead's brief
 * prefers a documented test-only subpath (`exports: { '.': …, './testing':
 * … }`) over folding test-fixture internals into the production door, and a
 * test-only subpath is enforced by `package.json#exports` + `tsc` module
 * resolution once a package's `./*` wildcard is narrowed, not by this
 * checker.
 *
 * `factory` IS NOT a doored package here. ADR 048 keeps its `index.ts`
 * deliberately EMPTY (`export {}`) — a barrel would re-couple the bridge to
 * the demo-capture machinery the package exists to keep deletable — and
 * `packages/factory/contract.test.ts` already pins the exact two-seam set
 * that may deep-import it, measured from the seams themselves. A second,
 * cruder door mechanism here would contradict that design rather than
 * extend it.
 *
 * RUN: node scripts/check-one-door-imports.mjs [--json] [--baseline <path>] [--root <path>]
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The eight packages whose `index.ts` is the declared public door. `factory` is excluded — see the module doc. */
export const DOORED_PACKAGES = Object.freeze([
  'kernel',
  'contracts',
  'knowledge',
  'library',
  'projects',
  'agents',
  'sessions',
  'flows',
]);

const SCAN_TREES = ['packages', 'apps', 'scripts'];
const CODE_EXT = /\.(ts|tsx|mjs|js|cjs)$/;
/** Mirrors `check-owner.mjs`'s `NOT_PRODUCTION`: a test file, or anything staged under a fixtures directory. */
const NOT_PRODUCTION = /(\.test\.[cm]?[jt]sx?$)|(^|\/)tests?\/|(^|\/)test-fixtures\//;

/** Every tracked-or-untracked-but-not-ignored production code file under the scanned trees. */
function productionFilesInScope(root) {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...SCAN_TREES],
    { cwd: root, encoding: 'utf8' },
  );
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => CODE_EXT.test(f) && !NOT_PRODUCTION.test(f));
}

const OWN_PACKAGE = /^packages\/([^/]+)\//;

/** Matches `@forge/<pkg>/<deep path>.ts` — static `from`, dynamic `import()`, or a re-export, all share this text shape. */
function specifierPattern(pkg) {
  return new RegExp(`@forge/${pkg}/([A-Za-z0-9_./-]+\\.ts)`, 'g');
}

/** Every `<pkg>|<importer>|<module>` deep-import violation under the scanned trees. Pure over its `root` argument. */
export function scan(root) {
  const violations = new Set();
  for (const file of productionFilesInScope(root)) {
    const ownPkg = OWN_PACKAGE.exec(file)?.[1];
    let src;
    try {
      src = readFileSync(join(root, file), 'utf8');
    } catch {
      // Listed by git, gone by the time this reads it (a sibling worktree's
      // checkout) — not this file's violation to report; check-owner.mjs's
      // ENOENT lesson (§15.540) is about SUMMING, which this does not do.
      continue;
    }
    for (const pkg of DOORED_PACKAGES) {
      if (ownPkg === pkg) continue;
      const re = specifierPattern(pkg);
      let m;
      while ((m = re.exec(src))) {
        violations.add(`${pkg}|${file}|${m[1]}`);
      }
    }
  }
  return violations;
}

function readBaseline(path) {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${path}: expected an array of "<pkg>|<importer>|<module>" strings`);
  return parsed;
}

/** Compares the tree's violation SET against the baseline SET. */
export function audit(root, baseline) {
  const current = scan(root);
  const allowed = new Set(baseline);
  return {
    violations: current.size,
    baselined: allowed.size,
    introduced: [...current].filter((v) => !allowed.has(v)).sort(),
    stale: [...allowed].filter((v) => !current.has(v)).sort(),
  };
}

function main(argv) {
  const json = argv.includes('--json');
  const at = argv.indexOf('--baseline');
  const baselinePath = at === -1 ? join(ROOT, 'scripts/baselines/one-door-imports.json') : resolve(argv[at + 1]);
  const rootAt = argv.indexOf('--root');
  const root = rootAt === -1 ? ROOT : resolve(argv[rootAt + 1]);

  const result = audit(root, readBaseline(baselinePath));
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  const failed = result.introduced.length + result.stale.length;
  if (failed === 0) {
    if (!json) {
      process.stdout.write(`check-one-door-imports: PASS — ${result.violations} baselined deep-import(s)\n`);
    }
    return 0;
  }
  if (!json) {
    process.stderr.write('check-one-door-imports: FAIL\n');
    for (const v of result.introduced) process.stderr.write(`  NEW    ${v}\n`);
    for (const v of result.stale) process.stderr.write(`  STALE  ${v}\n`);
  }
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
