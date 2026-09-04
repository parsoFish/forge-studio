#!/usr/bin/env node
/**
 * check-boundaries — the §0 allow-graph, as a shrinking ratchet.
 *
 * THE CONSTRAINT THIS ENFORCES. `docs/roadmaps/1.0.md` §0, verbatim:
 *
 *   contracts ← kernel ← { library, knowledge, projects } ← agents ←
 *   sessions ← flows ← factory ← apps/{forge, studio}
 *   apps/studio imports contracts only.
 *   packages never import orchestrator/ cli/ loops/.
 *   legacy never imports a package at all.
 *
 * The spec calls this "enforced by dependency-cruiser; the violation
 * baseline may only shrink". This script is that enforcement.
 *
 * WHY A BASELINE OF VIOLATIONS AND NOT A COUNT. A count lets one violation
 * be swapped for another without the gate noticing. The baseline is the SET
 * of `<rule>|<from>|<to>` triples, so a new edge fails even when an old one
 * disappears in the same PR, and a disappeared edge fails as a stale entry
 * until the baseline is tightened. There is no `--write-baseline`.
 *
 * WHAT BINDS TODAY. `packages/` and `apps/` do not exist yet (they arrive
 * after H5), so rules 1, 3 and 4 have no population on this tree and are
 * unit-tested directly through the exported `classify()` instead. Rule 2 is
 * live: `forge-ui/` is the tree that becomes `apps/studio`, and its eight
 * edges into `orchestrator/`+`cli/` — all from test files — are the starting
 * baseline. They shrink to zero when the six parity tests repoint to
 * `@forge/contracts`.
 *
 * WHAT IS OUT OF SCOPE, AND WHY. `scripts/` and `tests/` are not cruised.
 * §0's allow-graph names `orchestrator/`, `cli/`, `loops/`, `packages/` and
 * `apps/` and nothing else: `scripts/` is repo tooling, not product, so it is
 * neither a package nor one of the three legacy trees, and no §0 rule can
 * apply to it. It IS subject to the 800-line cap, which is a property of a
 * file rather than of the graph.
 *
 * RUN: node scripts/check-boundaries.mjs [--json] [--baseline <path>]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cruise } from 'dependency-cruiser';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The `1.0.md` §0 chain, left to right. A package may import only strictly lower ranks. */
export const PACKAGE_RANK = Object.freeze({
  contracts: 0,
  kernel: 1,
  library: 2,
  knowledge: 2,
  projects: 2,
  agents: 3,
  sessions: 4,
  flows: 5,
  factory: 6,
});

/** The three legacy trees packages may never reach into. */
const LEGACY = /^(orchestrator|cli|loops)\//;
/** The one greppable shim per package through which legacy may reach a package. */
/** The studio app. `forge-ui/` was its path until the M2 move. */
const STUDIO = /^apps\/studio\//;
/**
 * The ASSEMBLY — the one tree that is allowed to know about everything, because
 * knowing about everything is what an assembly is FOR: it binds each package's
 * factory into a running bridge (`makeRouteTable(deps)`, ruling 59).
 *
 * It is named here because the M4-flows host carve moves `cli/`'s five modules
 * into it, and without this class the move would have been a BLINDING rather
 * than a closure (ruling 116). `packages/* -> cli/*` is a violation everyone can
 * see in the table; the same edge re-pointed at `apps/forge/` would have matched
 * no rule at all and vanished — a package would be importing the assembly, the
 * wrong direction, and the table would have reported 38 fewer violations as
 * though they had been fixed.
 */
const ASSEMBLY = /^apps\/forge\//;
const PACKAGE = /^packages\/([^/]+)\//;

/**
 * Returns the rule a single dependency edge violates, or null.
 * Pure — this is where the allow-graph lives, and it is unit-testable
 * without a tree that has `packages/` in it.
 */
export function classify(from, to) {
  const fromPkg = PACKAGE.exec(from)?.[1];
  const toPkg = PACKAGE.exec(to)?.[1];

  // 1. packages never import orchestrator/ cli/ loops/
  if (fromPkg && LEGACY.test(to)) return 'package-to-legacy';

  // 1b. packages never import the ASSEMBLY either (ruling 116). A package
  //     reaching up into `apps/forge/` is the same defect as reaching into
  //     `cli/` — it inverts the direction the assembly exists to provide — so
  //     it stays a named, visible violation instead of matching no rule.
  if (fromPkg && ASSEMBLY.test(to)) return 'package-to-assembly';

  // 1c. the assembly may import every package (that is its job), but reaching
  //     DOWN into a legacy tree is debt with an owner, and stays visible.
  if (ASSEMBLY.test(from) && LEGACY.test(to)) return 'assembly-to-legacy';

  // 2. apps/studio imports contracts only
  if (STUDIO.test(from)) {
    if (LEGACY.test(to)) return 'studio-beyond-contracts';
    if (toPkg && toPkg !== 'contracts') return 'studio-beyond-contracts';
  }

  // 3. legacy never imports a package.
  //
  // The rule once exempted imports routed through `orchestrator/_pkg/<pkg>.ts`.
  // The M3 cutover deleted that directory and `git ls-files` matches ZERO files
  // under it, so the exemption suppressed nothing on any real tree — and its
  // only remaining proof was a unit case classifying a SYNTHETIC path that
  // cannot exist, which would have passed forever whatever the tree did
  // (COMMON 15.140's shape). Retired by M4-library B2 because its subject is
  // gone, not because the check got weaker: the rule name is unchanged and
  // every real row it produces is unchanged.
  if (LEGACY.test(from) && toPkg) return 'legacy-to-package-not-via-shim';

  // 4. the chain: a package imports only strictly lower ranks
  if (fromPkg && toPkg && fromPkg !== toPkg) {
    const a = PACKAGE_RANK[fromPkg];
    const b = PACKAGE_RANK[toPkg];
    if (a === undefined || b === undefined) return 'unknown-package';
    if (b >= a) return 'package-layer-order';
  }

  return null;
}

const SCOPE = ['orchestrator', 'cli', 'loops', 'skills', 'forge-ui', 'packages', 'apps'];

/**
 * The tsconfig `paths` alias every studio-side file already uses:
 * `forge-ui/tsconfig.json` maps `"@/*": ["./*"]`, rooted at `forge-ui/`.
 * dependency-cruiser does not apply it, so an aliased specifier arrives
 * unresolved and matches none of the rule regexes — `@/../orchestrator/config`
 * would be a real, forbidden studio → legacy import that classified as nothing.
 * The mapping is one line of config, so the lint applies it itself.
 */
const PATH_ALIASES = [
  { prefix: '@/', from: /^(apps\/studio)\//, base: (m) => `${m[1]}/` },
];

/** A workspace package specifier: `@forge/kernel` -> `packages/kernel/`. */
const WORKSPACE_SPECIFIER = /^@forge\/([^/]+)(\/.*)?$/;

/** A specifier that names a PATH — the only kind that can cross a boundary. */
const PATH_SHAPED = /^(\.|@\/|@forge\/)/;

/** Collapses `a/b/../c` to `a/c` so an alias cannot hide an escape behind `..`. */
function normalizeSegments(path) {
  const out = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/**
 * Turns a dependency-cruiser `resolved` value into a repo-relative path the
 * rules can classify, applying the tsconfig alias and the workspace
 * specifier. Returns null when the specifier names a path this lint could NOT
 * resolve — the caller treats that as a violation rather than as silence,
 * because a boundary you cannot see is a boundary you are not enforcing.
 */
export function normalizeTarget(from, resolved, couldNotResolve) {
  if (!couldNotResolve) return resolved;

  const pkg = WORKSPACE_SPECIFIER.exec(resolved);
  if (pkg) return `packages/${pkg[1]}/${pkg[2] ? pkg[2].slice(1) : 'index.ts'}`;

  for (const alias of PATH_ALIASES) {
    if (!resolved.startsWith(alias.prefix)) continue;
    const m = alias.from.exec(from);
    if (!m) continue;
    return normalizeSegments(alias.base(m) + resolved.slice(alias.prefix.length));
  }

  // A bare npm specifier (no leading `.`, `@/` or `@forge/`) is legitimately
  // unresolvable when the package ships no types; it cannot name a path inside
  // this repo, so it cannot cross a boundary.
  if (!PATH_SHAPED.test(resolved)) return resolved;

  return null;
}

/** Every dependency edge in the scoped trees, as `{from, to}`. */
async function edges(root) {
  const scope = SCOPE.filter((d) => existsSync(join(root, d)));
  const result = await cruise(scope, {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: 'node_modules|\\.next' },
    tsPreCompilationDeps: true,
    baseDir: root,
  });
  const out = [];
  for (const m of result.output.modules) {
    for (const d of m.dependencies) {
      out.push({ from: m.source, to: normalizeTarget(m.source, d.resolved, d.couldNotResolve === true), raw: d.resolved });
    }
  }
  return out;
}

function readBaseline(path) {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${path}: expected an array of "<rule>|<from>|<to>" strings`);
  return parsed;
}

/** Compares the tree's violation SET against the baseline SET. */
export async function audit(root, baseline) {
  const all = await edges(root);
  const current = new Set();
  for (const { from, to, raw } of all) {
    if (to === null) {
      current.add(`unresolvable-path-import|${from}|${raw}`);
      continue;
    }
    const rule = classify(from, to);
    if (rule) current.add(`${rule}|${from}|${to}`);
  }
  const allowed = new Set(baseline);
  return {
    edges: all.length,
    violations: current.size,
    baselined: allowed.size,
    introduced: [...current].filter((v) => !allowed.has(v)).sort(),
    stale: [...allowed].filter((v) => !current.has(v)).sort(),
  };
}

async function main(argv) {
  const json = argv.includes('--json');
  const at = argv.indexOf('--baseline');
  const baselinePath = at === -1 ? join(ROOT, 'scripts/baselines/boundaries.json') : resolve(argv[at + 1]);

  const result = await audit(ROOT, readBaseline(baselinePath));
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  const failed = result.introduced.length + result.stale.length;
  if (failed === 0) {
    if (!json) {
      process.stdout.write(
        `check-boundaries: PASS — ${result.edges} edges, ${result.violations} baselined allow-graph violation(s)\n`,
      );
    }
    return 0;
  }

  if (!json) {
    for (const v of result.introduced) {
      const [rule, from, to] = v.split('|');
      process.stdout.write(`  ${rule}: ${from} -> ${to} — a NEW allow-graph violation (1.0.md §0). Route it through the package that owns it.\n`);
    }
    for (const v of result.stale) {
      process.stdout.write(`  stale baseline entry: ${v} — the edge is gone; remove it from the baseline to tighten the ratchet.\n`);
    }
    process.stdout.write(`check-boundaries: FAIL — ${failed} allow-graph violation(s) off the baseline\n`);
  }
  return 1;
}

// Run only when executed directly — the test imports `classify` and must not
// trigger a full cruise on import.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
