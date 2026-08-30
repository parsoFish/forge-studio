/**
 * Proof that the §0 allow-graph ratchet BITES.
 *
 * Two halves, because the tree it guards does not exist yet:
 *
 *   1. `classify()` is pure, so every rule in the chain is unit-tested
 *      directly — including the three (`package-to-legacy`,
 *      `legacy-to-package-not-via-shim`, `package-layer-order`) that have no
 *      population until `packages/` lands after H5. A rule with no test and
 *      no population is decoration.
 *   2. The live rule, `studio-beyond-contracts`, is exercised end-to-end
 *      against the real tree: at its baseline it passes, with a fabricated
 *      `forge-ui` file importing `orchestrator/` it fails, and against a
 *      doctored baseline it fails as stale.
 *
 * RUN: node --test --experimental-strip-types scripts/check-boundaries.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts/check-boundaries.mjs');
const BASELINE = join(ROOT, 'scripts/baselines/boundaries.json');

const { classify, PACKAGE_RANK, normalizeTarget } = (await import(
  new URL('./check-boundaries.mjs', import.meta.url).href
)) as {
  classify: (from: string, to: string) => string | null;
  PACKAGE_RANK: Record<string, number>;
  normalizeTarget: (from: string, resolved: string, couldNotResolve: boolean) => string | null;
};

function run(args: string[] = []): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('node', [CHECKER, ...args], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

test('the chain is exactly the one 1.0.md §0 states', () => {
  assert.deepEqual(PACKAGE_RANK, {
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
});

test('rule 1 — a package may never import orchestrator/ cli/ loops/', () => {
  assert.equal(classify('packages/kernel/logging.ts', 'orchestrator/config.ts'), 'package-to-legacy');
  assert.equal(classify('packages/flows/pr.ts', 'cli/ui-bridge.ts'), 'package-to-legacy');
  assert.equal(classify('packages/agents/run.ts', 'loops/ralph/runner.ts'), 'package-to-legacy');
  assert.equal(classify('packages/kernel/logging.ts', 'packages/contracts/index.ts'), null);
});

test('rule 2 — apps/studio imports contracts and nothing else', () => {
  assert.equal(classify('apps/studio/lib/x.ts', 'packages/contracts/index.ts'), null);
  assert.equal(classify('apps/studio/lib/x.ts', 'packages/kernel/config.ts'), 'studio-beyond-contracts');
  assert.equal(classify('apps/studio/lib/x.ts', 'orchestrator/config.ts'), 'studio-beyond-contracts');
  assert.equal(classify('forge-ui/lib/x.ts', 'orchestrator/config.ts'), 'studio-beyond-contracts');
});

test('rule 3 — legacy reaches a package only through orchestrator/_pkg/', () => {
  assert.equal(classify('orchestrator/cycle.ts', 'packages/flows/index.ts'), 'legacy-to-package-not-via-shim');
  assert.equal(classify('cli/ui-bridge.ts', 'packages/kernel/index.ts'), 'legacy-to-package-not-via-shim');
  assert.equal(classify('orchestrator/_pkg/flows.ts', 'packages/flows/index.ts'), null);
});

test('rule 4 — a package imports strictly lower ranks only', () => {
  assert.equal(classify('packages/contracts/index.ts', 'packages/kernel/config.ts'), 'package-layer-order');
  assert.equal(classify('packages/kernel/x.ts', 'packages/flows/y.ts'), 'package-layer-order');
  assert.equal(classify('packages/library/x.ts', 'packages/knowledge/y.ts'), 'package-layer-order', 'same rank is not lower');
  assert.equal(classify('packages/flows/x.ts', 'packages/kernel/y.ts'), null);
  assert.equal(classify('packages/factory/x.ts', 'packages/flows/y.ts'), null);
  assert.equal(classify('packages/flows/a.ts', 'packages/flows/b.ts'), null, 'intra-package is free');
});

test('an unknown package name is a failure, not a free pass', () => {
  assert.equal(classify('packages/typo/x.ts', 'packages/kernel/y.ts'), 'unknown-package');
});

test('the real tree is at its baseline', () => {
  const { code, out } = run();
  assert.equal(code, 0, out);
  assert.match(out, /check-boundaries: PASS/);
});

test('it inspects a real dependency graph, not an empty one', () => {
  const json = JSON.parse(execFileSync('node', [CHECKER, '--json'], { cwd: ROOT, encoding: 'utf8' }));
  assert.ok(json.edges >= 3000, `expected the real graph, got ${json.edges} edges`);
  assert.ok(json.violations >= 1, 'the live rule has a real population to ratchet down');
  assert.deepEqual(json.introduced, []);
  assert.deepEqual(json.stale, []);
});

test('it FAILS on a NEW studio → legacy import (the defect it exists for)', () => {
  const victim = join(ROOT, 'forge-ui/lib/__boundary_probe__.ts');
  writeFileSync(victim, "import { MAX_KICKOFF_COST_CEILING_USD } from '../../orchestrator/config.ts';\nexport const probe = MAX_KICKOFF_COST_CEILING_USD;\n");
  try {
    const { code, out } = run();
    assert.equal(code, 1, `a new forge-ui -> orchestrator import must fail — got exit 0:\n${out}`);
    assert.match(out, /studio-beyond-contracts/);
    assert.match(out, /__boundary_probe__\.ts/);
  } finally {
    rmSync(victim, { force: true });
  }
});

test('it FAILS on a stale baseline entry — the ratchet must be tightened when an edge goes', () => {
  const real = JSON.parse(readFileSync(BASELINE, 'utf8')) as string[];
  const dir = mkdtempSync(join(tmpdir(), 'boundaries-baseline-'));
  const path = join(dir, 'boundaries.json');
  writeFileSync(path, `${JSON.stringify([...real, 'studio-beyond-contracts|forge-ui/lib/gone.ts|orchestrator/gone.ts'], null, 2)}\n`);
  try {
    const { code, out } = run(['--baseline', path]);
    assert.equal(code, 1, `an entry with no matching edge must fail as stale — got exit 0:\n${out}`);
    assert.match(out, /stale baseline entry/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('normalizeTarget applies the forge-ui tsconfig alias — an aliased escape is still an escape', () => {
  assert.equal(normalizeTarget('forge-ui/lib/x.ts', '@/../orchestrator/config', true), 'orchestrator/config');
  // `@/` is rooted at the studio DIRECTORY, so the escape needs one `..` per
  // segment of that directory's path: one from `forge-ui/`, two from `apps/studio/`.
  assert.equal(normalizeTarget('apps/studio/lib/x.ts', '@/../orchestrator/config', true), 'apps/orchestrator/config');
  assert.equal(normalizeTarget('apps/studio/lib/x.ts', '@/../../orchestrator/config', true), 'orchestrator/config');
  assert.equal(normalizeTarget('forge-ui/lib/x.ts', '@/components/Foo', true), 'forge-ui/components/Foo');
  assert.equal(
    classify('forge-ui/lib/x.ts', normalizeTarget('forge-ui/lib/x.ts', '@/../orchestrator/config', true)!),
    'studio-beyond-contracts',
  );
});

test('normalizeTarget maps a workspace specifier — this is how packages will import each other', () => {
  assert.equal(normalizeTarget('packages/flows/a.ts', '@forge/kernel', true), 'packages/kernel/index.ts');
  assert.equal(normalizeTarget('packages/flows/a.ts', '@forge/kernel/config.ts', true), 'packages/kernel/config.ts');
  assert.equal(classify('packages/contracts/i.ts', normalizeTarget('packages/contracts/i.ts', '@forge/kernel', true)!), 'package-layer-order');
  assert.equal(classify('apps/studio/x.ts', normalizeTarget('apps/studio/x.ts', '@forge/kernel', true)!), 'studio-beyond-contracts');
});

test('a bare npm specifier is not a path and is left alone; an unresolvable PATH is a violation', () => {
  assert.equal(normalizeTarget('orchestrator/x.ts', '@octokit/webhooks-methods', true), '@octokit/webhooks-methods');
  assert.equal(normalizeTarget('orchestrator/x.ts', 'gray-matter', true), 'gray-matter');
  assert.equal(normalizeTarget('orchestrator/x.ts', './does-not-exist.ts', true), null, 'a path this lint cannot resolve is not silence');
  assert.equal(normalizeTarget('forge-ui/lib/x.ts', '@/nope', true), 'forge-ui/nope');
  assert.equal(normalizeTarget('orchestrator/x.ts', '@/nope', true), null, 'the alias binds only inside the studio tree');
});

test('it FAILS on an ALIASED studio -> legacy import — the shape a relative-path-only test cannot see', () => {
  const victim = join(ROOT, 'forge-ui/lib/__alias_probe__.ts');
  writeFileSync(victim, "import { MAX_KICKOFF_COST_CEILING_USD } from '@/../orchestrator/config';\nexport const probe = MAX_KICKOFF_COST_CEILING_USD;\n");
  try {
    const { code, out } = run();
    assert.equal(code, 1, `an aliased forge-ui -> orchestrator import must fail — got exit 0:\n${out}`);
    assert.match(out, /studio-beyond-contracts/);
    assert.match(out, /__alias_probe__\.ts -> orchestrator\/config/);
  } finally {
    rmSync(victim, { force: true });
  }
});

test('it FAILS on a workspace-specifier import from the studio tree', () => {
  const victim = join(ROOT, 'forge-ui/lib/__ws_probe__.ts');
  writeFileSync(victim, "import { x } from '@forge/kernel';\nexport const probe = x;\n");
  try {
    const { code, out } = run();
    assert.equal(code, 1, `apps/studio may import contracts only — got exit 0:\n${out}`);
    assert.match(out, /studio-beyond-contracts/);
    assert.match(out, /packages\/kernel/);
  } finally {
    rmSync(victim, { force: true });
  }
});
