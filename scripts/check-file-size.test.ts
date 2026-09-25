/**
 * Proof that the 800-line hard cap ratchet BITES.
 *
 * `docs/roadmaps/1.0.md` §0 says "File hard cap 800 lines, enforced by lint
 * from M2". A cap that is only ever run against a tree it was baselined from
 * proves nothing, so these tests run the real checker against the real tree,
 * then against a tree with a fabricated offender and against three doctored
 * baselines, and assert it flips every time.
 *
 * RUN: node --test --experimental-strip-types scripts/check-file-size.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts/check-file-size.mjs');
const BASELINE = join(ROOT, 'scripts/baselines/file-size.json');

function run(args: string[] = []): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('node', [CHECKER, ...args], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function withBaseline(entries: Record<string, number>, body: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'cap-baseline-'));
  const path = join(dir, 'file-size.json');
  writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`);
  try {
    body(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the tree is at its baseline — no un-baselined file is over the cap', () => {
  const { code, out } = run();
  assert.equal(code, 0, out);
  assert.match(out, /check-file-size: PASS/);
});

test('it inspects a real population, not an empty set', () => {
  const json = JSON.parse(execFileSync('node', [CHECKER, '--json'], { cwd: ROOT, encoding: 'utf8' }));
  assert.equal(json.cap, 800, 'the cap is the §0 constant');
  assert.ok(json.checked >= 500, `expected the real code-file population, got ${json.checked}`);
  // NOT a floor on the debt. The old assertion here was `baselined >= 100`,
  // which is a number the 1.0 campaign exists to drive DOWN: M4 deleted the
  // last two `packages/knowledge/` rows, the count reached 98, and a guard
  // went red because the work it guards succeeded. What the assertion is
  // actually for is proving the checker READ a real baseline rather than an
  // empty one, and the invariant that says so without ever expiring is that
  // every row on disk was applied — which `stale: []` below then completes.
  const baselineRows = Object.keys(JSON.parse(readFileSync(BASELINE, 'utf8'))).length;
  assert.equal(json.baselined, baselineRows, `the checker must apply every on-disk baseline row, got ${json.baselined} of ${baselineRows}`);
  assert.ok(baselineRows > 0, 'the baseline must not be empty while any file is over the cap');
  assert.deepEqual(json.newOversize, []);
  assert.deepEqual(json.grown, []);
  assert.deepEqual(json.stale, []);
});

/**
 * Plants a fabricated N-line file under a `mkdtempSync` + `git init` root of
 * its own and returns the CLI args that point the checker at it — bead
 * forge-8vfn.5.64. This used to `writeFileSync(join(ROOT, rel))` real files
 * (`__cap_probe__.mjs`, `__headroom_probe__.mjs`) and `rmSync` them again in
 * a `finally`; `node --test` runs `scripts/*.test.ts` files concurrently, so
 * a probe planted and removed there raced every other scanner reading the
 * tree at that moment (`lineCount`'s own doc, above, names the CI failure).
 * `git init` (not just a bare mkdtemp dir) because `codeFiles()` shells out
 * to `git ls-files`, and an EMPTY (not the real) baseline so the fixture's
 * tiny population never collides with the real baseline's paths.
 */
function capFixture(rel: string, lines: number): { args: string[]; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'cap-probe-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const victim = join(root, rel);
  mkdirSync(dirname(victim), { recursive: true });
  // `lineCount` counts newline-terminated lines, so N joined lines + a trailing
  // newline is N lines on disk.
  writeFileSync(victim, `${Array.from({ length: lines }, (_, i) => `// line ${i}`).join('\n')}\n`);
  const baseline = join(root, 'empty-baseline.json');
  writeFileSync(baseline, '{}\n');
  return {
    args: ['--root', root, '--baseline', baseline],
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('it FAILS on a NEW file over the cap (the defect it exists for)', () => {
  const rel = 'scripts/__cap_probe__.mjs';
  const { args, cleanup } = capFixture(rel, 900);
  try {
    const { code, out } = run(args);
    assert.equal(code, 1, `a new 900-line file must fail the cap — got exit 0:\n${out}`);
    assert.match(out, /scripts\/__cap_probe__\.mjs/);
    assert.match(out, /over the 800-line cap and not baselined/);
  } finally {
    cleanup();
  }
});

test('it FAILS when a baselined file GREW — the ratchet only turns one way', () => {
  const real = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>;
  const [path] = Object.entries(real)[0]!;
  // The planted ceiling is derived from the file's ACTUAL length, not from its
  // baseline row. Deriving it from the row meant this test only measured
  // anything while that one file sat exactly at its ceiling: the moment a PR
  // shrank it (M6-A: 1,464 → 1,410) the planted `baseline - 1` was still above
  // the real size, nothing "grew", and the ratchet's own pin passed green
  // without exercising the branch it exists for. §15.192's shape — an
  // expectation that moves with what it measures measures nothing.
  const actual = readFileSync(join(ROOT, path), 'utf8').split('\n').length - 1;
  withBaseline({ ...real, [path]: actual - 1 }, (b) => {
    const { code, out } = run(['--baseline', b]);
    assert.equal(code, 1, `a file above its baseline must fail — got exit 0:\n${out}`);
    assert.match(out, /grew/);
    assert.ok(out.includes(path), `the offender is named: ${out}`);
  });
});

test('it FAILS on a stale baseline entry — a file that no longer needs the exemption', () => {
  withBaseline({ 'scripts/check-file-size.mjs': 5000 }, (b) => {
    const { code, out } = run(['--baseline', b]);
    assert.equal(code, 1, `an entry for a file under the cap must fail as stale — got exit 0:\n${out}`);
    assert.match(out, /stale baseline entry/);
  });
});

test('it FAILS on a baseline entry whose file is gone', () => {
  withBaseline({ 'scripts/__deleted_long_ago__.ts': 1200 }, (b) => {
    const { code, out } = run(['--baseline', b]);
    assert.equal(code, 1, `an entry for a missing file must fail as stale — got exit 0:\n${out}`);
    assert.match(out, /stale baseline entry/);
  });
});

// ---------------------------------------------------------------------------
// forge-8vfn.5.61 — SLACK: a ceiling above the live file passes green today,
// with no hint that it could be tightened, so a shrunk file's exemption never
// shrinks with it (declared-data-fails-open).
// ---------------------------------------------------------------------------

/** A real baselined row and its true, live line count — the same derivation
 *  the GREW test above uses, so slack is measured against reality, not the
 *  baseline's own (possibly already-slack) number. */
function aBaselinedRow(): { path: string; actual: number } {
  const real = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>;
  const [path] = Object.entries(real)[0]!;
  const actual = readFileSync(join(ROOT, path), 'utf8').split('\n').length - 1;
  return { path, actual };
}

test('it FAILS on a baseline entry with SLACK — ceiling above the live file, with the exact figure', () => {
  const real = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>;
  const { path, actual } = aBaselinedRow();
  withBaseline({ ...real, [path]: actual + 50 }, (b) => {
    const { code, out } = run(['--baseline', b]);
    assert.equal(code, 1, `a ceiling above the live file must fail — got exit 0:\n${out}`);
    assert.match(out, /slack/);
    assert.ok(out.includes(path), `the offender is named: ${out}`);
    assert.ok(out.includes(`ceiling ${actual + 50}`), `the ceiling figure must be exact — got:\n${out}`);
    assert.ok(out.includes(`${actual} lines`), `the live figure must be exact — got:\n${out}`);
    assert.match(out, /tighten: \d+/, 'a tighten hint, the thing this bead says is missing today');
  });
});

test('it does NOT double-count slack as "grown" — one row, one finding', () => {
  const real = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>;
  const { path, actual } = aBaselinedRow();
  withBaseline({ ...real, [path]: actual + 50 }, (b) => {
    const { code, out } = run(['--json', '--baseline', b]);
    assert.equal(code, 1, out);
    const json = JSON.parse(out) as {
      slack: { path: string }[];
      grown: { path: string }[];
    };
    assert.ok(json.slack.some((s) => s.path === path));
    assert.ok(!json.grown.some((s) => s.path === path), 'slack and grown are opposite directions, never both');
  });
});

test('--write tightens a slack ceiling to the live size, and only that', () => {
  const real = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>;
  const entries = Object.entries(real);
  const [slackPath, slackActual] = [entries[0]![0], readFileSync(join(ROOT, entries[0]![0]), 'utf8').split('\n').length - 1];
  // A second real row, GROWN beyond its ceiling — never a genuine state on
  // main, but --write must not "fix" a violation by raising the ceiling to
  // match it; the fixture proves that boundary without needing a real one.
  const grownPath = entries[1]![0];
  const grownActual = readFileSync(join(ROOT, grownPath), 'utf8').split('\n').length - 1;

  withBaseline({ ...real, [slackPath]: slackActual + 30, [grownPath]: grownActual - 5 }, (b) => {
    const before = run(['--baseline', b]);
    assert.equal(before.code, 1, `the doctored baseline must start red:\n${before.out}`);

    const written = run(['--baseline', b, '--write']);
    assert.equal(written.code, 0, `--write must exit 0 — got:\n${written.out}`);
    assert.match(written.out, /check-file-size: WROTE/);

    const rewritten = JSON.parse(readFileSync(b, 'utf8')) as Record<string, number>;
    assert.equal(rewritten[slackPath], slackActual, 'the slack row is tightened to the live size');
    assert.equal(rewritten[grownPath], grownActual - 5, 'a GROWN row is never touched — --write only ever lowers a ceiling');

    const after = run(['--baseline', b]);
    assert.equal(after.code, 1, '--write does not silently launder a real violation; the grown row still fails');
    assert.match(after.out, /grew/);
    assert.doesNotMatch(after.out, /slack/, 'the tightened row no longer has slack');
  });
});


// ---------------------------------------------------------------------------
// known-flakes #6 — a file that vanishes between the glob and the read
// ---------------------------------------------------------------------------

test('lineCount SKIPS a path that vanished between glob and read (known-flakes #6)', async () => {
  const { lineCount } = await import('./check-file-size.mjs');
  const gone = join(ROOT, 'scripts', '__vanished_probe__.ts');
  // POSITIVE CONTROL, deterministic rather than raced: the exact condition the
  // audit hit on CI — a globbed path that is not there when it is read.
  assert.equal(lineCount(gone), null, 'a vanished path has no size to check, so it is skipped, not a crash');
});

test('lineCount still COUNTS a real file, and still THROWS on any error but ENOENT', async () => {
  const { lineCount } = await import('./check-file-size.mjs');
  // NEGATIVE CONTROL 1 — the ordinary path is untouched.
  const real = join(ROOT, 'package.json');
  const n = lineCount(real);
  assert.ok(typeof n === 'number' && n > 0, `expected a real line count, got ${String(n)}`);

  // NEGATIVE CONTROL 2 — a DIRECTORY reads as EISDIR, not ENOENT, and must
  // still throw. Swallowing every read error would turn this fix into a
  // blanket tolerance, which is exactly what it must not be.
  assert.throws(
    () => lineCount(join(ROOT, 'scripts')),
    (err: NodeJS.ErrnoException) => err.code !== 'ENOENT',
    'only ENOENT is a skip — every other read failure still fails loud',
  );
});

test('a baselined file that is genuinely GONE still reports stale — the fix changes no verdict', () => {
  // NEGATIVE CONTROL 3 (the `audit` semantics ruling 84 names): the skip is in
  // lineCount, not in the stale-row logic, so a baseline row whose file no
  // longer exists is reported exactly as before.
  const json = JSON.parse(execFileSync('node', [CHECKER, '--json'], { cwd: ROOT, encoding: 'utf8' }));
  assert.deepEqual(json.stale, [], 'the live tree has no stale rows; the reporting path is unchanged by the ENOENT skip');
});

// ------------------------------------------------------- forge-8vfn.7.6.107
/**
 * 800 IS SILENT AND 801 IS RED, so the guard was a trap primed for the next
 * author rather than a warning to the current one. Measured by C at `9f7d624a`:
 * two files at EXACTLY 800, seven within three lines, 36 within sixty — and the
 * output said none of it.
 *
 * It is not hypothetical. `gate.test.ts` sat at 741 and four doors took it to
 * 813; the gate refused, correctly, AFTER the work was written. A notice at 741
 * would have said "59 left" before it was.
 *
 * `run.mjs` was the live case when this was written: 799, blocking its own next
 * edit, which is why `forge-0fli` stopped being a tidy-up. It then sat at
 * exactly 800 on main for about four days before #758 split it to 381. Kept as
 * history rather than deleted — the notice's whole argument is that a file
 * approaching the cap is a trap for whoever touches it next, and this is the
 * one case where that was measured end to end.
 *
 * The notice is NOT a verdict: nothing in it can fail a run, and these doors
 * assert that as hard as they assert the listing.
 */
function planted(lines: number, body: (rel: string, args: string[]) => void): void {
  const rel = 'scripts/__headroom_probe__.mjs';
  const { args, cleanup } = capFixture(rel, lines);
  try { body(rel, args); } finally { cleanup(); }
}

test('7.6.107: a file 5 under the cap is NOTICED, with its headroom, and nothing fails', () => {
  planted(795, (rel, args) => {
    const { code, out } = run(args);
    assert.equal(code, 0, `a file UNDER the cap has broken no rule — the notice must not fail a run:\n${out}`);
    assert.match(out, /check-file-size: HEADROOM —/, out);
    assert.match(out, new RegExp(`${rel.replace('/', '\\/')}: 795 lines — 5 line\\(s\\) left`), out);
    // And it must not be reported as a violation by another name.
    assert.doesNotMatch(out, new RegExp(`${rel.replace('/', '\\/')}.*over the 800-line cap`), out);
  });
});

test('7.6.107: a file 25 under the cap is NOT noticed — the window is 20, not "nearly"', () => {
  planted(775, (rel, args) => {
    const { code, out } = run(args);
    assert.equal(code, 0);
    assert.doesNotMatch(out, new RegExp(rel.replace('/', '\\/')), `775 is outside the 20-line window:\n${out}`);
  });
});

test('7.6.107: a file AT the cap says it has no room left, and still does not fail', () => {
  // The row that matters most, and the one the campaign already has two of:
  // exactly 800 is legal, silent before this, and one line from red.
  planted(800, (rel, args) => {
    const { code, out } = run(args);
    assert.equal(code, 0, `800 is at the cap, not over it — it must not fail:\n${out}`);
    assert.match(out, new RegExp(`${rel.replace('/', '\\/')}: 800 lines — NO room left`), out);
  });
});

test('7.6.107: the notice reaches --json as data, and a file over the cap is NOT in it twice', () => {
  planted(900, (rel, args) => {
    const { code, out } = run(['--json', ...args]);
    assert.equal(code, 1, 'a 900-line file is still a violation');
    const json = JSON.parse(out) as {
      headroomWindow: number;
      // Nothing reads `nearCap` today — no import of audit(), and CI runs this
      // file without --json. This door is the entire contract for that field's
      // shape; it is not a redundant assertion you can drop.
      nearCap: { path: string; lines: number; headroom: number }[];
      newOversize: { path: string }[];
    };
    assert.equal(json.headroomWindow, 20);
    assert.ok(json.newOversize.some((f) => f.path === rel), 'over the cap is a violation');
    assert.ok(!json.nearCap.some((f) => f.path === rel), 'and must not ALSO be listed as near it — one file, one finding');
  });
});
/*
 * `forge-8vfn.7.6.108` — a fatal and a verdict must not share exit 1.
 *
 * Every guard in this tree exits 1 on a VIOLATION. This one also exited 1 when
 * `git ls-files` failed, so a caller reading the exit code could not tell "this
 * tree breaks the cap" from "I never read this tree". §15.504 at the process
 * boundary: green, red and UNKNOWN are three states, and UNKNOWN was being
 * spelled with red's number.
 *
 * The trigger is `ROOT` resolved from `import.meta.url` — a copy of the checker
 * at another path enumerates whatever sits above it, which is how D met this:
 * a scratch copy exited 1 on a `fatal:` and read as a violation. These doors
 * reproduce that exactly, by running a COPY from a directory whose parent is
 * not a git repository. That is the real mechanism rather than a mocked git.
 */
describe('7.6.108: "could not measure" has its own exit code', () => {
  /** Run a COPY of the checker from a directory outside any git repository, so
   *  its ROOT (dirname/..) is not a work tree and `git ls-files` genuinely fails. */
  function runDetached(): { code: number; stdout: string; stderr: string } {
    const dir = mkdtempSync(join(tmpdir(), 'cfs-detached-'));
    const copy = join(dir, 'check-file-size.mjs');
    writeFileSync(copy, readFileSync(CHECKER, 'utf8'));
    try {
      const stdout = execFileSync('node', [copy], { cwd: dir, encoding: 'utf8' });
      return { code: 0, stdout, stderr: '' };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('a tree it cannot enumerate exits 75, not 1, and says which it is', () => {
    const { code, stderr } = runDetached();
    assert.equal(code, 75, `a corpus that cannot be enumerated is UNKNOWN, not a violation — got ${code}`);
    assert.match(stderr, /REFUSED/, stderr);
    assert.match(stderr, /NOT a cap violation/, 'the refusal must say what it is not — the whole defect is the two reading alike');
    assert.match(stderr, /git ls-files could not enumerate/, stderr);
  });

  test('a real violation still exits 1 — the fix must not soften the cap', () => {
    planted(900, (_rel, args) => {
      const { code } = run(args);
      assert.equal(code, 1, 'a 900-line file is a violation and keeps red\'s number');
    });
  });

  test('the two are separable from the EXIT CODE ALONE, with no stdout parsing', () => {
    // The point of the bead: a caller branches on the code, never on prose.
    const cannotMeasure = runDetached().code;
    let violation = 0;
    planted(900, (_rel, args) => { violation = run(args).code; });
    const clean = run().code;
    assert.notEqual(cannotMeasure, violation, 'UNKNOWN must not share a code with a violation');
    assert.notEqual(cannotMeasure, clean, 'UNKNOWN must not share a code with a pass');
    assert.deepEqual(
      [clean, violation, cannotMeasure],
      [0, 1, 75],
      'three states, three codes: 0 pass / 1 violation / 75 could-not-measure',
    );
  });
});
