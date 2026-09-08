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
  assert.equal(classify('apps/studio/lib/x.ts', 'orchestrator/config.ts'), 'studio-beyond-contracts');
});

test('rule 3 — legacy never reaches a package', () => {
  assert.equal(classify('orchestrator/cycle.ts', 'packages/flows/index.ts'), 'legacy-to-package-not-via-shim');
  assert.equal(classify('cli/ui-bridge.ts', 'packages/kernel/index.ts'), 'legacy-to-package-not-via-shim');
  // The `orchestrator/_pkg/` exemption is retired (M4-library B2): the M3
  // cutover deleted that directory, so the case below asserted a classification
  // for a path that cannot exist. It is replaced by the one that CAN — the
  // shim path now classifies like any other legacy file, which is the whole
  // point of retiring it.
  assert.equal(classify('orchestrator/_pkg/flows.ts', 'packages/flows/index.ts'), 'legacy-to-package-not-via-shim');
});

test('rule 4 — a package imports strictly lower ranks only', () => {
  assert.equal(classify('packages/contracts/index.ts', 'packages/kernel/config.ts'), 'package-layer-order');
  assert.equal(classify('packages/kernel/x.ts', 'packages/flows/y.ts'), 'package-layer-order');
  assert.equal(classify('packages/library/x.ts', 'packages/knowledge/y.ts'), 'package-layer-order', 'same rank is not lower');
  assert.equal(classify('packages/flows/x.ts', 'packages/kernel/y.ts'), null);
  assert.equal(classify('packages/factory/x.ts', 'packages/flows/y.ts'), null);
  assert.equal(classify('packages/flows/a.ts', 'packages/flows/b.ts'), null, 'intra-package is free');
});

test('rule 1b — a package may never import the ASSEMBLY (ruling 116)', () => {
  // The M4-flows host carve moves `cli/`'s modules into `apps/forge/`. Without
  // this rule the 38 `package-to-legacy` rows pointing at `cli/` would have
  // matched NO rule at their new path and vanished from the table — read as 38
  // violations fixed when nothing had been fixed. A package reaching up into
  // the assembly is the same inverted direction as reaching into `cli/`.
  assert.equal(classify('packages/kernel/index.ts', 'apps/forge/routes.ts'), 'package-to-assembly');
  assert.equal(classify('packages/flows/bridge-hooks.ts', 'apps/forge/ui-bridge.ts'), 'package-to-assembly');
});

test('rule 1b — the assembly may import every package, because that is what an assembly IS', () => {
  // The other half of ruling 116, and the half a one-sided rule would get
  // wrong: `apps/forge` binding each package's factory into a running bridge
  // (`makeRouteTable(deps)`, ruling 59) is the DESIGN, not debt. If this ever
  // returned a rule name, the carve would have traded 153 real closures for 153
  // new violations and the assembly could not do its job.
  assert.equal(classify('apps/forge/routes.ts', 'packages/flows/bridge-hooks.ts'), null);
  assert.equal(classify('apps/forge/ui-bridge.ts', 'packages/sessions/routes.ts'), null);
  assert.equal(classify('apps/forge/cli.ts', 'packages/contracts/studio/types.ts'), null);
});

test('rule 1c — the assembly reaching DOWN into a legacy tree stays visible', () => {
  // Debt with an owner (M5-A), not a free pass. Before this rule the
  // assembly's own 14 edges into `orchestrator/` and `cli/` matched nothing and
  // were unmeasured — the table said the assembly was clean because no rule
  // could see it.
  assert.equal(classify('apps/forge/dispatch-decision-capture.test.ts', 'orchestrator/test-fixtures/spawn-capture/normalize.ts'), 'assembly-to-legacy');
  assert.equal(classify('apps/forge/cli.ts', 'cli/studio-lint.ts'), 'assembly-to-legacy');
  assert.equal(classify('apps/forge/x.ts', 'loops/y.ts'), 'assembly-to-legacy');
});

test('an unknown package name is a failure, not a free pass', () => {
  assert.equal(classify('packages/typo/x.ts', 'packages/kernel/y.ts'), 'unknown-package');
});

test('the baseline names only rule kinds the checker can actually produce', () => {
  // Anti-blinding, and deliberately NOT a floor on any kind's COUNT: bead 5.49
  // removed the `violations >= 1` floor precisely because a floor on debt goes
  // red at the moment the campaign succeeds. What must never happen instead is
  // a baseline row keyed to a rule name `classify()` cannot return — a typo, or
  // a kind renamed on one side only. Such a row matches nothing forever: it is
  // reported as stale if you are lucky and silently carried if you are not.
  const KINDS = new Set([
    'package-to-legacy',
    'package-to-assembly',
    'assembly-to-legacy',
    'studio-beyond-contracts',
    'legacy-to-package-not-via-shim',
    'package-layer-order',
    'unknown-package',
  ]);
  // Every kind in the set is REACHABLE — a name nothing can produce is as dead
  // as a baseline row nothing can match, so the vocabulary is proven, not
  // asserted. `unknown-package` and the two new kinds included.
  const produced = new Set([
    classify('packages/flows/x.ts', 'cli/y.ts'),
    classify('packages/flows/x.ts', 'apps/forge/y.ts'),
    classify('apps/forge/x.ts', 'orchestrator/y.ts'),
    classify('apps/studio/lib/x.ts', 'orchestrator/y.ts'),
    classify('cli/x.ts', 'packages/kernel/y.ts'),
    classify('packages/contracts/x.ts', 'packages/flows/y.ts'),
    classify('packages/nosuchpkg/x.ts', 'packages/kernel/y.ts'),
  ]);
  assert.deepEqual([...produced].sort(), [...KINDS].sort(),
    'every rule kind the baseline may use must be producible by classify(), and vice versa');

  const rows = JSON.parse(readFileSync(BASELINE, 'utf8')) as string[];
  const unknown = [...new Set(rows.map((r) => r.split('|')[0]!))].filter((k) => !KINDS.has(k));
  assert.deepEqual(unknown, [], `baseline rows keyed to a rule the checker cannot produce: ${unknown.join(', ')}`);
});

test('the real tree is at its baseline', () => {
  const { code, out } = run();
  assert.equal(code, 0, out);
  assert.match(out, /check-boundaries: PASS/);
});

test('it inspects a real dependency graph, not an empty one', () => {
  const json = JSON.parse(execFileSync('node', [CHECKER, '--json'], { cwd: ROOT, encoding: 'utf8' }));
  assert.ok(json.edges >= 3000, `expected the real graph, got ${json.edges} edges`);
  // Bead forge-8vfn.5.49. This used to also assert `json.violations >= 1`,
  // "the live rule has a real population to ratchet down" — a FLOOR on the very
  // debt the ratchet exists to remove, so it goes red at the moment the
  // campaign succeeds and `violations` reaches 0.
  //
  // It is removed rather than replaced, because everything it protected is
  // already asserted here and nothing was left uncovered:
  //   - "the graph is real, not empty" is `edges >= 3000`, above;
  //   - "the baseline was actually applied" is `stale === []` — a checker that
  //     stopped finding violations leaves every on-disk row unmatched, so
  //     `stale` becomes the whole baseline and this test fails loudly;
  //   - "nothing new slipped in" is `introduced === []`.
  // A derived restatement (`baselined === <rows on disk>`) was considered and
  // rejected as tautological: the checker reports `baselined` AS the on-disk
  // set's size (`check-boundaries.mjs:199`), so such an assertion compares the
  // baseline file to itself.
  assert.deepEqual(json.introduced, []);
  assert.deepEqual(json.stale, []);
});

/**
 * The legacy module a probe points at is PLANTED, not found.
 *
 * §15.93, chapter one: this test hardcoded `orchestrator/flow-runner.ts` and
 * went red the moment that file was carved into its package. Failing loudly was
 * the right outcome; the wrong one is a probe that keeps passing while pointing
 * at nothing. So it took a live `orchestrator/*.ts` from git instead, on the
 * reasoning that no carve could strand it.
 *
 * Chapter two, and the reason that reasoning expired: M6 is emptying the legacy
 * tree ON PURPOSE. The shared spawn-capture and flow-run-request fixtures left
 * for `packages/kernel/tests/` and `packages/flows/tests/`, and with them the
 * last non-test module under `orchestrator/` — so the derivation asserted its
 * way to red on a tree that was doing exactly what the milestone asked.
 *
 * A rule about a PATH CLASS should not depend on that class having a surviving
 * inhabitant. So chapter three plants nothing under the legacy tree at all, and
 * splits the claim in two.
 *
 * CHAPTER THREE — T1 ruling 512. Planting the far end meant `mkdirSync`ing
 * `orchestrator/` in the live checkout and removing only the FILE, so every run
 * of this suite left an empty legacy directory behind: the tree the milestone
 * deleted, back, untracked, after `npm test`. Worse, `check-owner.test.ts`
 * planted in the same directory and removed it recursively, while
 * `check-raw-fs-guarded.mjs`'s reachability walk walked
 * `['cli','orchestrator','packages','apps']` from a third file. `node --test`
 * runs files concurrently, so that removal landed between the walk's
 * `existsSync` and its `readdirSync` and the suite went red with an ENOENT on a
 * directory that existed a millisecond earlier. `scripts/probe-hygiene.test.ts`
 * is the door that keeps all three honest.
 *
 * WHERE THE TWO HALVES OF THE CLAIM LIVE NOW.
 *
 *   - The LEGACY branch (`check-boundaries.mjs:104`, `STUDIO → LEGACY`) is
 *     proven by the `classify()` unit tests above, which assert exactly
 *     `classify('apps/studio/lib/x.ts', 'orchestrator/config.ts') ===
 *     'studio-beyond-contracts'`. They need no tree at all, which is the
 *     strongest possible form of "does not depend on a surviving inhabitant".
 *   - THIS test proves the rule is WIRED — that a real edge in a real cruise
 *     reaches it — through the sibling branch (`:105`, `STUDIO → any package
 *     that is not contracts`), which returns the SAME `studio-beyond-contracts`
 *     verdict and needs only a package that already exists. One file is planted,
 *     in a directory that was already there, exactly as the package-to-assembly
 *     probe below does it.
 *
 * A cruise-driven legacy edge would need a legacy FILE, and a legacy file needs
 * a legacy DIRECTORY: there is no version of this test that cruises `:104` and
 * leaves the tree alone. Between "cruise the branch that can be cruised without
 * moving the tree, and unit-test the other" and "keep resurrecting a deleted
 * directory under three concurrent scanners", the split is the honest trade —
 * and it is stated here rather than left for the next reader to discover that
 * `:104` has no end-to-end probe.
 */
const NON_CONTRACTS_PACKAGE = 'packages/kernel/config.ts';

test('it FAILS on a NEW studio → beyond-contracts import (the defect it exists for)', () => {
  const victim = join(ROOT, 'apps/studio/lib/__boundary_probe__.ts');
  writeFileSync(victim, `import '../../../${NON_CONTRACTS_PACKAGE}';\nexport const probe = 1;\n`);
  try {
    const { code, out } = run();
    assert.equal(code, 1, `a new apps/studio -> non-contracts package import must fail — got exit 0:\n${out}`);
    assert.match(out, /studio-beyond-contracts/);
    assert.match(out, /__boundary_probe__\.ts/);
  } finally {
    rmSync(victim, { force: true });
  }
});

test('it FAILS on a NEW package -> assembly import (ruling 116, driven through the real cruise)', () => {
  // The unit tests above prove `classify()`; this proves the RULE IS WIRED —
  // that a real edge in a real cruise reaches it. A rule that classifies
  // correctly but is never consulted is the same blindness by another door.
  //
  // The victim is planted and removed here, in the live tree, because
  // dependency-cruiser must cruise the real graph to produce the edge at all.
  // That is known-flake #6's shape and it is why this file's probes are named
  // `__…_probe__` and deleted in a `finally`.
  const victim = join(ROOT, 'packages/kernel/__assembly_probe__.ts');
  writeFileSync(victim, "import '../../apps/forge/routes.ts';\nexport const probe = 1;\n");
  try {
    const { code, out } = run();
    assert.equal(code, 1, `a new packages/kernel -> apps/forge import must fail — got exit 0:\n${out}`);
    assert.match(out, /package-to-assembly/);
    assert.match(out, /__assembly_probe__\.ts/);
  } finally {
    rmSync(victim, { force: true });
  }
});

test('it FAILS on a stale baseline entry — the ratchet must be tightened when an edge goes', () => {
  const real = JSON.parse(readFileSync(BASELINE, 'utf8')) as string[];
  const dir = mkdtempSync(join(tmpdir(), 'boundaries-baseline-'));
  const path = join(dir, 'boundaries.json');
  writeFileSync(path, `${JSON.stringify([...real, 'studio-beyond-contracts|apps/studio/lib/gone.ts|orchestrator/gone.ts'], null, 2)}\n`);
  try {
    const { code, out } = run(['--baseline', path]);
    assert.equal(code, 1, `an entry with no matching edge must fail as stale — got exit 0:\n${out}`);
    assert.match(out, /stale baseline entry/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('normalizeTarget applies the studio tsconfig alias — an aliased escape is still an escape', () => {
  // `@/` is rooted at the studio DIRECTORY, so an escape costs one `..` per
  // segment of that directory's path — two, now that it is `apps/studio/`.
  assert.equal(normalizeTarget('apps/studio/lib/x.ts', '@/../orchestrator/config', true), 'apps/orchestrator/config');
  assert.equal(normalizeTarget('apps/studio/lib/x.ts', '@/../../orchestrator/config', true), 'orchestrator/config');
  assert.equal(normalizeTarget('apps/studio/lib/x.ts', '@/components/Foo', true), 'apps/studio/components/Foo');
  // One `..` lands in `apps/`, which is not a legacy tree — correctly NOT a
  // violation. It takes two to reach `orchestrator/`, and that one is.
  assert.equal(classify('apps/studio/lib/x.ts', normalizeTarget('apps/studio/lib/x.ts', '@/../orchestrator/config', true)!), null);
  assert.equal(
    classify('apps/studio/lib/x.ts', normalizeTarget('apps/studio/lib/x.ts', '@/../../orchestrator/config', true)!),
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
  assert.equal(normalizeTarget('apps/studio/lib/x.ts', '@/nope', true), 'apps/studio/nope');
  assert.equal(normalizeTarget('orchestrator/x.ts', '@/nope', true), null, 'the alias binds only inside the studio tree');
});

test('it FAILS on an ALIASED studio -> legacy import — the shape a relative-path-only test cannot see', () => {
  const victim = join(ROOT, 'apps/studio/lib/__alias_probe__.ts');
  writeFileSync(victim, "import { MAX_KICKOFF_COST_CEILING_USD } from '@/../../orchestrator/config';\nexport const probe = MAX_KICKOFF_COST_CEILING_USD;\n");
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
  const victim = join(ROOT, 'apps/studio/lib/__ws_probe__.ts');
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
