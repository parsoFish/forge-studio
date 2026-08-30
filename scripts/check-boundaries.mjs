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
 *   legacy imports a package only via orchestrator/_pkg/<pkg>.ts.
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
const LEGACY_SHIM = /^orchestrator\/_pkg\//;
/** `forge-ui/` is the tree that becomes `apps/studio`; both spellings bind. */
const STUDIO = /^(apps\/studio|forge-ui)\//;
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

  // 2. apps/studio imports contracts only
  if (STUDIO.test(from)) {
    if (LEGACY.test(to)) return 'studio-beyond-contracts';
    if (toPkg && toPkg !== 'contracts') return 'studio-beyond-contracts';
  }

  // 3. legacy imports a package only via orchestrator/_pkg/<pkg>.ts
  if (LEGACY.test(from) && !LEGACY_SHIM.test(from) && toPkg) return 'legacy-to-package-not-via-shim';

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
    for (const d of m.dependencies) out.push({ from: m.source, to: d.resolved });
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
  for (const { from, to } of all) {
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
