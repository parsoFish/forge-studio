/**
 * Proof that the one-owner-per-file gate BITES.
 *
 * The spec §8 makes "one session = one package" enforceable only if every
 * production file has an owner. These tests run the real checker against the
 * real `QUARRY.md`, then against six doctored quarries, and assert it flips
 * every time — a checker that always exits 0 cannot pass them.
 *
 * RUN: node --test --experimental-strip-types scripts/check-owner.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// `audit` is `main()`'s own entry point — see the untracked-probe test below for
// why that test drives it directly instead of the CLI.
import { audit } from './check-owner.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts/check-owner.mjs');
const QUARRY = join(ROOT, 'QUARRY.md');

function run(args: string[] = []): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('node', [CHECKER, ...args], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** Runs the checker against the real quarry plus one extra or altered row. */
function withQuarry(mutate: (rows: string[]) => string[], body: (quarryPath: string, baselinePath: string) => void): void {
  const rows = readFileSync(QUARRY, 'utf8').split('\n');
  const dir = mkdtempSync(join(tmpdir(), 'quarry-'));
  const quarryPath = join(dir, 'QUARRY.md');
  const baselinePath = join(dir, 'owner.json');
  writeFileSync(quarryPath, `${mutate(rows).join('\n')}\n`);
  writeFileSync(baselinePath, `${JSON.stringify({ unowned: 0 })}\n`);
  try {
    body(quarryPath, baselinePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the real quarry owns every production file', () => {
  const { code, out } = run();
  assert.equal(code, 0, out);
  assert.match(out, /check-owner: PASS/);
  assert.match(out, /unowned: 0/);
});

test('it accounts for a real population, not an empty set', () => {
  const json = JSON.parse(execFileSync('node', [CHECKER, '--json'], { cwd: ROOT, encoding: 'utf8' }));
  assert.ok(json.files >= 200, `expected the real production population, got ${json.files}`);
  assert.equal(json.rows, json.files, 'exactly one row per production file');
  assert.deepEqual(json.unowned, []);
  assert.deepEqual(json.orphans, []);
  assert.deepEqual(json.duplicates, []);
});

/**
 * The subject these four fixtures manipulate, DERIVED rather than named.
 *
 * §15.93: a guard self-test that hardcodes a real repo path is coupled to every
 * carve — this file named `packages/flows/flow-runner.ts` and went red the moment
 * that file moved into its package. Failing loudly was the good outcome; the
 * bad one is a fixture that keeps passing while pointing at nothing. Taking the
 * first `packages/` row out of the live QUARRY table means the next move cannot
 * strand it, and the assertion below still names whatever it picked.
 */
function aQuarriedProductionFile(): string {
  const row = readFileSync(QUARRY, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^\| packages\/[^|]+\.ts \|/.test(l));
  assert.ok(row, 'QUARRY.md must carry at least one packages/ production row');
  return row!.split('|')[1].trim();
}

test('it FAILS on an unowned file — a row removed (the defect it exists for)', () => {
  const subject = aQuarriedProductionFile();
  withQuarry((rows) => rows.filter((l) => !l.includes(`| ${subject} |`)), (q, b) => {
    const { code, out } = run(['--quarry', q, '--baseline', b]);
    assert.equal(code, 1, `a file with no row must fail — got exit 0:\n${out}`);
    assert.ok(out.includes(`unowned: ${subject}`), `the offending file must be named — got:\n${out}`);
  });
});

test('it FAILS on an orphan row — the quarry describing a file that is not there', () => {
  withQuarry((rows) => [...rows, '| orchestrator/__never_existed__.ts | kernel | verbatim | 12 |'], (q, b) => {
    const { code, out } = run(['--quarry', q, '--baseline', b]);
    assert.equal(code, 1, `a row for a missing file must fail — got exit 0:\n${out}`);
    assert.match(out, /orphan row: orchestrator\/__never_existed__\.ts/);
  });
});

test('it FAILS on a duplicate row — a file has exactly one owner', () => {
  const subj = aQuarriedProductionFile();
  withQuarry((rows) => [...rows, `| ${subj} | flows | verbatim | 1 |`], (q, b) => {
    const { code, out } = run(['--quarry', q, '--baseline', b]);
    assert.equal(code, 1, `two rows for one file must fail — got exit 0:\n${out}`);
    assert.ok(out.includes(`duplicate row: ${subj}`), `the duplicate must be named — got:\n${out}`);
  });
});

test('it FAILS on an owner outside the eleven-package vocabulary', () => {
  const subj = aQuarriedProductionFile();
  withQuarry((rows) => rows.map((l) => (l.includes(`| ${subj} |`) ? `| ${subj} | kernal | verbatim | 1 |` : l)), (q, b) => {
    const { code, out } = run(['--quarry', q, '--baseline', b]);
    assert.equal(code, 1, `a typo'd owner must fail — got exit 0:\n${out}`);
    assert.ok(out.includes(`unknown owner: ${subj} (owner "kernal")`), `the offending owner must be named — got:\n${out}`);
  });
});

test('it FAILS on a disposition outside verbatim|pruned|rewritten|deleted', () => {
  const subj = aQuarriedProductionFile();
  withQuarry((rows) => rows.map((l) => (l.includes(`| ${subj} |`) ? `| ${subj} | kernel | moved | 1 |` : l)), (q, b) => {
    const { code, out } = run(['--quarry', q, '--baseline', b]);
    assert.equal(code, 1, `an invented disposition must fail — got exit 0:\n${out}`);
    assert.ok(out.includes(`unknown disposition: ${subj} (disposition "moved")`), `the offending disposition must be named — got:\n${out}`);
  });
});

test('it FAILS when unowned drops BELOW the baseline — the ratchet must be tightened', () => {
  const dir = mkdtempSync(join(tmpdir(), 'quarry-baseline-'));
  const baselinePath = join(dir, 'owner.json');
  writeFileSync(baselinePath, `${JSON.stringify({ unowned: 5 })}\n`);
  try {
    const { code, out } = run(['--baseline', baselinePath]);
    assert.equal(code, 1, `a slack baseline must fail — got exit 0:\n${out}`);
    assert.match(out, /below the baseline of 5/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('it FAILS when QUARRY.md is absent — ownership has no other source', () => {
  const { code, out } = run(['--quarry', join(ROOT, 'NO_SUCH_QUARRY.md')]);
  assert.equal(code, 1, out);
  assert.match(out, /does not exist/);
});

// ---------------------------------------------------------------------------
// forge-8vfn.5.18 — the NUMBERS: disposition summary, per-row loc, per-
// package columns. `check-owner` verified every file had exactly one row;
// nothing verified the row said anything TRUE.
// ---------------------------------------------------------------------------

test('it FAILS on a row LOC that disagrees with the real file — the defect this bead is about', () => {
  // `--json` rather than the prose list: the prose list is capped (readable,
  // not a flood — see the near-real-tree drift this bead itself found), and
  // this asserts the underlying finding, not where it lands in a printed
  // top-15. A dedicated fixture below covers the cap itself.
  const subject = aQuarriedProductionFile();
  withQuarry(
    (rows) => rows.map((l) => (l.trim().startsWith(`| ${subject} |`) ? l.replace(/\|\s*\d+\s*\|$/, '| 999999 |') : l)),
    (q, b) => {
      const { code, out } = run(['--quarry', q, '--baseline', b, '--json']);
      assert.equal(code, 1, `a wrong row loc must fail — got exit 0:\n${out}`);
      const json = JSON.parse(out) as { locDrift: { path: string; quarried: number; measured: number }[] };
      const found = json.locDrift.find((d) => d.path === subject);
      assert.ok(found, `${subject} must be in locDrift — got:\n${JSON.stringify(json.locDrift)}`);
      assert.equal(found!.quarried, 999999, 'the row names the QUARRY number');
      assert.ok(Number.isInteger(found!.measured) && found!.measured >= 0, 'and the real, measured number');
    },
  );
});

test('the loc drift list in prose output is capped, not a flood — a fixture with many offenders', () => {
  // Doctors EVERY packages/ row's loc to a shared wrong value in an isolated
  // fixture QUARRY, rather than relying on the live tree's own drift count
  // (which the data-fix commit in this bead reduces to zero).
  const rows = readFileSync(QUARRY, 'utf8').split('\n');
  let mutated = 0;
  const doctored = rows.map((l) => {
    const t = l.trim();
    if (/^\| packages\/[^|]+\.ts \|/.test(t) && mutated < 20) {
      mutated += 1;
      return l.replace(/\|\s*\d+\s*\|$/, '| 1 |');
    }
    return l;
  });
  assert.ok(mutated >= 16, `fixture needs enough packages/ rows to exceed the 15-row cap, got ${mutated}`);
  const dir = mkdtempSync(join(tmpdir(), 'quarry-cap-'));
  const quarryPath = join(dir, 'QUARRY.md');
  const baselinePath = join(dir, 'owner.json');
  writeFileSync(quarryPath, `${doctored.join('\n')}\n`);
  writeFileSync(baselinePath, `${JSON.stringify({ unowned: 0 })}\n`);
  try {
    const { code, out } = run(['--quarry', quarryPath, '--baseline', baselinePath]);
    assert.equal(code, 1, out);
    const printed = (out.match(/^  loc drift: /gm) ?? []).length;
    assert.equal(printed, 15, `the printed list must be capped at 15 — got ${printed}`);
    assert.match(out, /more loc drift row\(s\)/, 'and say how many more, not just stop silently');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('it FAILS on a disposition summary count that disagrees with the per-file table', () => {
  withQuarry(
    (rows) => rows.map((l) => (l.trim().startsWith('| `verbatim`') ? l.replace(/\|\s*\d+\s*\|$/, '| 999999 |') : l)),
    (q, b) => {
      const { code, out } = run(['--quarry', q, '--baseline', b]);
      assert.equal(code, 1, `a wrong disposition summary count must fail — got exit 0:\n${out}`);
      assert.ok(
        out.includes('disposition summary drift: `verbatim` — header says 999999'),
        `the disposition and the header number must be named — got:\n${out}`,
      );
    },
  );
});

test('it FAILS on a per-package "files" column that disagrees with the rows', () => {
  withQuarry(
    (rows) => rows.map((l) => (l.trim().startsWith('| `kernel` |') ? l.replace(/^(\|\s*`kernel`\s*\|)\s*\d+\s*\|/, '$1 999999 |') : l)),
    (q, b) => {
      const { code, out } = run(['--quarry', q, '--baseline', b]);
      assert.equal(code, 1, `a wrong package files column must fail — got exit 0:\n${out}`);
      assert.ok(
        out.includes('package table drift: `kernel` files — header says 999999'),
        `the package and the header number must be named — got:\n${out}`,
      );
    },
  );
});

test('it FAILS on the **total** row when it disagrees with the sum of the packages', () => {
  withQuarry(
    (rows) => rows.map((l) => (l.trim().startsWith('| **total**') ? l.replace(/(\|\s*\*\*total\*\*\s*\|\s*\*\*)\d+(\*\*\s*\|)/, '$1999999$2') : l)),
    (q, b) => {
      const { code, out } = run(['--quarry', q, '--baseline', b]);
      assert.equal(code, 1, `a wrong total row must fail — got exit 0:\n${out}`);
      assert.ok(
        out.includes('package table drift: `total` files — header says 999999'),
        `the total row and the header number must be named — got:\n${out}`,
      );
    },
  );
});

test('--write recomputes loc, the disposition summary and the package columns from the rows, then the checker passes', () => {
  const subject = aQuarriedProductionFile();
  withQuarry(
    (rows) => rows.map((l) => {
      if (l.trim().startsWith(`| ${subject} |`)) return l.replace(/\|\s*\d+\s*\|$/, '| 999999 |');
      if (l.trim().startsWith('| `verbatim`')) return l.replace(/\|\s*\d+\s*\|$/, '| 999999 |');
      if (l.trim().startsWith('| `kernel` |')) return l.replace(/^(\|\s*`kernel`\s*\|)\s*\d+\s*\|/, '$1 999999 |');
      return l;
    }),
    (q, b) => {
      const before = run(['--quarry', q, '--baseline', b]);
      assert.equal(before.code, 1, `the doctored quarry must start red:\n${before.out}`);

      const written = run(['--quarry', q, '--baseline', b, '--write']);
      assert.equal(written.code, 0, `--write must exit 0 — got:\n${written.out}`);
      assert.match(written.out, /check-owner: WROTE/);

      const after = run(['--quarry', q, '--baseline', b]);
      assert.equal(after.code, 0, `the checker must pass after --write — got:\n${after.out}`);
      assert.match(after.out, /check-owner: PASS/);

      const rewritten = readFileSync(q, 'utf8');
      assert.ok(!rewritten.includes('999999'), `every doctored number must have been recomputed — got:\n${rewritten}`);
    },
  );
});

test('--write fixes the loc NUMBER on a row that carries a ceiling-rekey note, and keeps the note', () => {
  // A handful of real rows glue a rationale note onto the loc cell with no
  // separating pipe — `664 **Ceiling re-keyed +4 (…):** …` — because a past
  // `--write`-shaped bug (caught before it reached QUARRY.md) compared the
  // FULL cell string to a bare number and overwrote the whole cell, silently
  // deleting the note. This fixture reproduces that shape without depending
  // on which real row still carries one today.
  const subject = aQuarriedProductionFile();
  withQuarry(
    (rows) => rows.map((l) => (
      l.trim().startsWith(`| ${subject} |`)
        ? l.replace(/\|\s*(\d+)\s*\|$/, '| $1 **A note that must survive --write.** |')
        : l
    )),
    (q, b) => {
      const written = run(['--quarry', q, '--baseline', b, '--write']);
      assert.equal(written.code, 0, written.out);

      const after = readFileSync(q, 'utf8');
      assert.ok(after.includes('A note that must survive --write.'), `the note must survive an unrelated --write — got:\n${after}`);
      const afterCell = after.split('\n').find((l) => l.trim().startsWith(`| ${subject} |`))!;
      // Only the leading digits may ever change; the note stays attached
      // verbatim, whether or not the number itself needed correcting.
      assert.match(afterCell, /^\| [^|]+ \| [^|]+ \| [^|]+ \| \d+ \*\*A note that must survive --write\.\*\* \|$/, afterCell);
    },
  );
});

test('an UNTRACKED production file is still unowned — a file cannot dodge the gate by not being committed', () => {
  // The tree is PLANTED, not assumed. `orchestrator/` is empty as of M6-C, but
  // it stays in check-owner's QUARRIED_TREES so a file reappearing there is
  // still accounted for — and that is exactly the claim this probe makes, so
  // the probe has to be able to make it whether or not the tree exists today.
  //
  // PLANTED IN A TEMPORARY REPOSITORY, NOT IN THE LIVE TREE — T1 ruling 512.
  // This probe used to `mkdirSync` `orchestrator/` in the real checkout and
  // `rmSync(dirname(victim), { recursive: true })` it again on the way out,
  // while `check-raw-fs-guarded.mjs`'s reachability walk was walking
  // `['cli','orchestrator','packages','apps']` from another test file. `node
  // --test` runs files concurrently, so the removal landed between that walk's
  // `existsSync` and its `readdirSync` and the whole suite went red with an
  // ENOENT on a directory that existed a millisecond earlier. The walk was
  // right; this probe was moving the ground under it.
  //
  // The claim survives intact because `audit(root, quarry)` TAKES its root —
  // it is `main()`'s own entry point, and the untracked half of the claim is
  // `productionFiles`' `--others --exclude-standard`, which is what is exercised
  // here. It needs a real repository (`git ls-files` walks up and refuses
  // outside one), so the fixture is `git init`ed; the CLI wiring around it is
  // covered by every other test in this file, which all go through `run()`.
  const root = mkdtempSync(join(tmpdir(), 'owner-untracked-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const victim = join(root, 'orchestrator/__untracked_owner_probe__.ts');
  mkdirSync(dirname(victim), { recursive: true });
  writeFileSync(victim, 'export const probe = 1;\n');
  try {
    const result = audit(root, readFileSync(join(ROOT, 'QUARRY.md'), 'utf8'));
    assert.ok(
      result.unowned.includes('orchestrator/__untracked_owner_probe__.ts'),
      `an untracked production file must be counted unowned — got:\n${JSON.stringify(result.unowned)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * SEAM F1 (packages/kernel/discovery-roots.ts) made `packages/<pkg>/skills/
 * <slug>/SKILL.md` a second discovery root — a package can ship an agent as
 * data. `productionFiles()`'s SKILL.md filter only ever matched the
 * TOP-LEVEL `skills/<slug>/SKILL.md` form, so a package-owned agent
 * definition was invisible to this gate: not production, not unowned, not
 * anything — `check-owner` would PASS with the file silently uncounted,
 * which is worse than failing loud, because "unowned: 0" is a lie once a
 * package ships one.
 *
 * PLANTED IN A TEMPORARY REPOSITORY, NOT THE LIVE TREE — same reason as the
 * untracked-probe test above (`audit(root, quarry)` takes its own root).
 */
test('a package-owned SKILL.md is production and unowned until a QUARRY row names it', () => {
  const root = mkdtempSync(join(tmpdir(), 'owner-pkg-skill-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const rel = 'packages/demo-pkg/skills/x/SKILL.md';
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, '---\nname: x\n---\nA package-owned agent.\n');
  try {
    const withoutRow = audit(root, '');
    assert.ok(
      withoutRow.unowned.includes(rel),
      `a package-owned SKILL.md must be counted as production and reported unowned with no QUARRY row — got:\n${JSON.stringify(withoutRow.unowned)}`,
    );

    const withRow = audit(root, `| ${rel} | library | verbatim | 3 |\n`);
    assert.ok(
      !withRow.unowned.includes(rel),
      `a QUARRY.md row naming the package-owned SKILL.md must own it — still unowned:\n${JSON.stringify(withRow.unowned)}`,
    );
    assert.equal(withRow.rows, 1);
    assert.deepEqual(withRow.orphans, [], 'the row must match a real file, not describe one that is not there');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A package's OWN package is a valid owner (G3: a second factory ships as a
 * package and must need no tooling edit to exist). Owners are the fixed apps
 * plus every real directory under `packages/` of the audited root; a name
 * that is neither is still refused.
 */
test('a row may be owned by any real package directory; an owner that names nothing is refused', () => {
  const root = mkdtempSync(join(tmpdir(), 'owner-pkg-owner-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const rel = 'packages/demo-pkg/skills/x/SKILL.md';
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), '---\nname: x\n---\nA package-owned agent.\n');
  try {
    assert.deepEqual(audit(root, `| ${rel} | demo-pkg | rewritten | 3 |\n`).badOwner, [], 'its own package must be a valid owner');
    assert.deepEqual(audit(root, `| ${rel} | demo-pkgg | rewritten | 3 |\n`).badOwner, [`${rel} (owner "demo-pkgg")`]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The "Per-package LOC caps" table's row pattern must accept a hyphenated
// package name. `forge-docs` (the G3 second factory) is real, but
// `parsePackageTable`'s row regex was `` /^`([a-z/]+)`$/ `` — no hyphen, no
// digit — so its aggregate row parsed as "not a package row" and both
// `audit`'s packageDrift check and `--write`'s recompute silently skipped it:
// not flagged, not corrected, not visible anywhere, exactly the "cap-table
// parser accepts a hyphenated package name" gap check-package-caps.mjs's
// `parseCaps` already had one fix for (see that file's own test of the same
// name) — this is the sibling regex in the OTHER guard that reads this table.
// ---------------------------------------------------------------------------

test('it FAILS on a per-package "files" column that disagrees with the rows — a hyphenated package (forge-docs)', () => {
  withQuarry(
    (rows) => rows.map((l) => (l.trim().startsWith('| `forge-docs` |') ? l.replace(/^(\|\s*`forge-docs`\s*\|)\s*\d+\s*\|/, '$1 999999 |') : l)),
    (q, b) => {
      const { code, out } = run(['--quarry', q, '--baseline', b]);
      assert.equal(code, 1, `a wrong forge-docs files column must fail — got exit 0:\n${out}`);
      assert.ok(
        out.includes('package table drift: `forge-docs` files — header says 999999'),
        `the hyphenated package and the header number must be named — got:\n${out}`,
      );
    },
  );
});

test('--write recomputes a hyphenated package (forge-docs) files/loc, not just the total', () => {
  withQuarry(
    (rows) => rows.map((l) => (
      l.trim().startsWith('| `forge-docs` |')
        ? l.replace(/^(\|\s*`forge-docs`\s*\|)\s*\d+\s*\|\s*\d+\s*\|/, '$1 999999 | 999999 |')
        : l
    )),
    (q, b) => {
      const before = run(['--quarry', q, '--baseline', b]);
      assert.equal(before.code, 1, `the doctored forge-docs row must start red:\n${before.out}`);

      const written = run(['--quarry', q, '--baseline', b, '--write']);
      assert.equal(written.code, 0, `--write must exit 0 — got:\n${written.out}`);
      assert.match(written.out, /check-owner: WROTE/);

      const after = run(['--quarry', q, '--baseline', b]);
      assert.equal(after.code, 0, `the checker must pass after --write — got:\n${after.out}`);

      const rewrittenRow = readFileSync(q, 'utf8').split('\n').find((l) => l.trim().startsWith('| `forge-docs` |'));
      assert.ok(rewrittenRow && !rewrittenRow.includes('999999'), `forge-docs's doctored files/loc must have been recomputed — got:\n${rewrittenRow}`);
    },
  );
});
