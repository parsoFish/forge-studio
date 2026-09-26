/**
 * fence-attribution.test.ts — T1 rulings 1225/1226: a sibling-tree escape is
 * THIS RUN'S iff a descendant of the run's own root process was sampled,
 * during the run, inside that tree, OR the tree is the main checkout and the
 * growth is not gitignored. Everything else is UNATTRIBUTABLE, never red —
 * including a tree with no live process at all, A's S10 run 24 measured
 * defect (a sibling lane's `~/forge-m7-d-grp` reddened a run that never
 * touched it, because the fence used to ask "is anyone LIVE there NOW",
 * a snapshot-at-the-end guess `liveProcessRoots`/`liveSessionOwners`
 * (`fence-attribution.mjs`'s OTHER two exports) cannot avoid).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';

import { startDescendantSampler, attributeEscapes, describeAttribution, mainCheckoutRoot, MAIN_CHECKOUT_ROOT_UNKNOWN } from './fence-attribution.mjs';

// ------------------------------------------------------------- fixtures

/** A fake `/proc`: one `status` file per row, `PPid:` the only field
 *  `pidsDescendedFrom` (and this module's sampler) reads from it — same shape
 *  `reap-census.test.ts`'s own `procTree` uses, duplicated here rather than
 *  shared: a one-file fixture is not worth a cross-file test-utils module. */
function procTree(rows: Array<{ pid: string; ppid: string }>): string {
  const root = mkdtempSync(join(tmpdir(), 'fence-attr-proc-'));
  for (const { pid, ppid } of rows) {
    mkdirSync(join(root, pid));
    writeFileSync(join(root, pid, 'status'), `Name:\tfixture\nPPid:\t${ppid}\n`);
  }
  return root;
}

function rm(...paths: string[]) {
  for (const p of paths) rmSync(p, { recursive: true, force: true });
}

// ===================================================== attributeEscapes ===
// Pure logic — no `/proc` involved. `touchedRoots` and `sampleErrors` are
// exactly what `startDescendantSampler().stop()` would have handed back;
// tested here as plain inputs so the DECISION is provable in isolation from
// the sampling mechanism.

test('attributeEscapes: a descendant sampled in tree T -> T\'s growth is THIS-RUN', () => {
  const touchedRoots = new Map([['/sib/tree', { pid: 4242, at: '/sib/tree/work', via: 'cwd' }]]);
  const [got] = attributeEscapes([{ root: '/sib/tree', paths: ['a.txt'] }], { touchedRoots });
  assert.equal(got.owner, 'this-run');
  assert.match(got.reason, /pid 4242/);
  assert.match(got.reason, /cwd/);
});

test('attributeEscapes: a non-descendant live in T (T never sampled) -> UNATTRIBUTABLE', () => {
  // `live` here stands for what `siblingWorktreeEscapes` already reports from
  // `liveProcessRoots` — a real, unrelated process rooted in T. Attribution no
  // longer reads that field at all: only ancestry (`touchedRoots`) and the
  // main-checkout rule can turn an escape THIS-RUN.
  const escapes = [{ root: '/sib/tree', paths: ['a.txt'], live: { pid: 999, cwd: '/sib/tree', via: 'cwd' } }];
  const [got] = attributeEscapes(escapes, { touchedRoots: new Map(), longestGapMs: 0 });
  assert.equal(got.owner, 'unattributable');
  assert.match(got.reason, /no descendant of this run was seen in \/sib\/tree/);
});

test('attributeEscapes: an APPEARED tree with NO live process at all -> UNATTRIBUTABLE (tonight\'s case)', () => {
  // A's S10 run 24, reproduced at the decision layer: `live: null` used to
  // fall straight into `unownedEscapes` and RED the run. It no longer does —
  // absence of a live owner was never evidence this run wrote the tree.
  const escapes = [{ root: '/home/parso/forge-m7-d-grp', paths: ['projects/x/README.md'], live: null }];
  const [got] = attributeEscapes(escapes, { touchedRoots: new Map(), longestGapMs: 0 });
  assert.equal(got.owner, 'unattributable', 'the defect this brief closes: no owner is not evidence of authorship');
});

test('attributeEscapes: main-checkout non-ignored growth, no descendant seen -> THIS-RUN (ruling 1226)', () => {
  const escapes = [{ root: '/home/parso/forge', paths: ['brain/projects/gitweave/profile.md'] }];
  const [got] = attributeEscapes(escapes, {
    touchedRoots: new Map(),
    mainRoot: '/home/parso/forge',
    isIgnored: () => false,
  });
  assert.equal(got.owner, 'this-run');
  assert.match(got.reason, /ruling 1226/);
  assert.match(got.reason, /brain\/projects\/gitweave\/profile\.md/, 'the verdict names the path');
});

test('attributeEscapes: main-checkout GITIGNORED growth -> UNATTRIBUTABLE', () => {
  const escapes = [{ root: '/home/parso/forge', paths: ['projects/story-s2/README.md'] }];
  const [got] = attributeEscapes(escapes, {
    touchedRoots: new Map(), longestGapMs: 0,
    mainRoot: '/home/parso/forge',
    isIgnored: () => true,
  });
  assert.equal(got.owner, 'unattributable', 'ignored growth in the main checkout gets no special-case red');
});

test('attributeEscapes: mixed main-checkout paths — only the non-ignored ones drive THIS-RUN, all are named', () => {
  const escapes = [{ root: '/home/parso/forge', paths: ['projects/story-s2/x', 'apps/studio/lib/__probe__.ts'] }];
  const [got] = attributeEscapes(escapes, {
    touchedRoots: new Map(),
    mainRoot: '/home/parso/forge',
    isIgnored: (p) => p.startsWith('projects/'),
  });
  assert.equal(got.owner, 'this-run', 'one non-ignored path is enough to red the tree');
  assert.match(got.reason, /apps\/studio\/lib\/__probe__\.ts/);
  assert.doesNotMatch(got.reason, /projects\/story-s2\/x/, 'the ignored path does not drive the reason');
});

// Row 96 / T1 1473 — blindness is a COVERAGE GAP (`longestGapMs` beyond
// `BLIND_GAP_FACTOR × intervalMs`), never a raw error COUNT. The pre-fix rule
// (`sampleErrors > 0`) turned every sibling-worktree growth into THIS-RUN the
// moment even ONE `/proc` listing failed and was retried away clean — S4
// funded run 2 (13/13 beats green) went red exactly this way on a sibling
// lane's own test leak.

test('attributeEscapes: longestGapMs beyond the bound -> BLIND, fail-closed to THIS-RUN, naming samples/erroredSamples/longestGapMs/errnos', () => {
  const escapes = [{ root: '/sib/tree', paths: ['a.txt'] }];
  const [got] = attributeEscapes(escapes, {
    touchedRoots: new Map(),
    samples: 12,
    erroredSamples: 5,
    errnos: { EACCES: 3, UNKNOWN: 2 },
    longestGapMs: 9000,
    intervalMs: 2000, // bound = 3 × 2000 = 6000; 9000 is over it
  });
  assert.equal(got.owner, 'this-run', 'a sampler blind for that long cannot prove this tree clean');
  assert.match(got.reason, /longestGapMs=9000/, 'the gap itself is named');
  assert.match(got.reason, /samples=12/, 'how many samples were taken is named');
  assert.match(got.reason, /erroredSamples=5/, 'how many of them errored is named');
  assert.match(got.reason, /errnos=.*EACCES/, 'the distinct errno codes seen are named');
});

test('attributeEscapes: erroredSamples alone, however many, no longer drives blindness — only a coverage GAP does (the row-96 defect)', () => {
  const escapes = [{ root: '/sib/tree', paths: ['a.txt'] }];
  const [got] = attributeEscapes(escapes, {
    touchedRoots: new Map(),
    erroredSamples: 40, // every one of them retried away clean, per-sample
    longestGapMs: 500, // well within the bound
    intervalMs: 2000,
  });
  assert.equal(got.owner, 'unattributable', 'a high error COUNT with no real coverage gap must never fail-close a run');
});

test('attributeEscapes: longestGapMs = 0 (a sampler that never failed) is NOT blind — an ordinary clean sample still excuses', () => {
  const escapes = [{ root: '/sib/tree', paths: ['a.txt'] }];
  const [got] = attributeEscapes(escapes, { touchedRoots: new Map(), longestGapMs: 0 });
  assert.equal(got.owner, 'unattributable');
});

test('attributeEscapes: ancestry (a) wins over blindness — a tree the sampler DID see is never excused into a false THIS-RUN reason', () => {
  const touchedRoots = new Map([['/sib/tree', { pid: 7, at: '/sib/tree', via: 'cwd' }]]);
  const [got] = attributeEscapes([{ root: '/sib/tree', paths: ['a.txt'] }], {
    touchedRoots, longestGapMs: 999999, intervalMs: 1, // deep in blind territory
  });
  assert.equal(got.owner, 'this-run');
  assert.match(got.reason, /pid 7/, 'the real evidence, not the blind fallback, explains the verdict');
});

test('attributeEscapes: describeAttribution names THIS-RUN and UNATTRIBUTABLE lines, one per path, with the reason', () => {
  const attributed = attributeEscapes(
    [
      { root: '/sib/a', paths: ['x.txt', 'y.txt'] },
      { root: '/sib/b', paths: ['z.txt'] },
    ],
    { touchedRoots: new Map([['/sib/a', { pid: 1, at: '/sib/a', via: 'cwd' }]]), longestGapMs: 0 },
  );
  const lines = describeAttribution(attributed);
  assert.equal(lines.length, 3);
  assert.ok(lines.some((l) => l.includes('THIS-RUN x.txt')));
  assert.ok(lines.some((l) => l.includes('THIS-RUN y.txt')));
  assert.ok(lines.some((l) => l.includes('UNATTRIBUTABLE z.txt')));
});

// ================================================== startDescendantSampler ===

test('startDescendantSampler: a descendant\'s cwd inside a real git worktree is recorded, an unrelated live pid is not', () => {
  const proc = procTree([
    { pid: '100', ppid: '1' },   // the run's own root — never a descendant of itself
    { pid: '200', ppid: '100' }, // a real descendant
    { pid: '300', ppid: '1' },   // NOT descended from 100 — must never be reported
  ]);
  const worktree = mkdtempSync(join(tmpdir(), 'fence-attr-wt-'));
  writeFileSync(join(worktree, '.git'), 'gitdir: /nowhere\n'); // a linked worktree's `.git` is a FILE
  try {
    const cwds: Record<string, string> = { 200: worktree, 300: worktree };
    const sampler = startDescendantSampler({
      rootPid: 100,
      procRoot: proc,
      listPids: () => ['100', '200', '300'],
      readCwd: (pid) => {
        const v = cwds[String(pid)];
        if (v === undefined) throw new Error('no cwd for this pid');
        return v;
      },
      listFds: () => [],
    });
    const { touchedRoots, erroredSamples } = sampler.stop();
    assert.equal(erroredSamples, 0);
    assert.ok(touchedRoots.has(worktree), 'the descendant\'s tree is recorded');
    const evidence = touchedRoots.get(worktree)!;
    assert.equal(evidence.pid, '200', 'only the actual descendant is credited, never the unrelated pid 300');
    assert.equal(evidence.via, 'cwd');
  } finally {
    rm(proc, worktree);
  }
});

test('startDescendantSampler: a read error on ONE pid\'s cwd is skipped, other descendants are still sampled', () => {
  const proc = procTree([
    { pid: '100', ppid: '1' },
    { pid: '201', ppid: '100' },
    { pid: '202', ppid: '100' },
  ]);
  const worktree = mkdtempSync(join(tmpdir(), 'fence-attr-wt2-'));
  mkdirSync(join(worktree, '.git'));
  try {
    const sampler = startDescendantSampler({
      rootPid: 100,
      procRoot: proc,
      listPids: () => ['100', '201', '202'],
      readCwd: (pid) => {
        if (String(pid) === '201') throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); // raced exit
        return worktree;
      },
      listFds: () => [],
    });
    const { touchedRoots } = sampler.stop();
    assert.ok(touchedRoots.has(worktree), '202 still gets sampled despite 201 failing');
  } finally {
    rm(proc, worktree);
  }
});

test('startDescendantSampler: an unreadable /proc LISTING is recorded as erroredSamples (after retrying), never read as "no descendants"', () => {
  const err = Object.assign(new Error('EACCES: cannot list /proc'), { code: 'EACCES' });
  const sampler = startDescendantSampler({
    rootPid: 100,
    procRoot: '/no-such-proc-root-fence-attribution',
    listPids: () => { throw err; },
  });
  const { touchedRoots, erroredSamples, samples, errnos, longestGapMs } = sampler.stop();
  assert.equal(touchedRoots.size, 0);
  assert.ok(erroredSamples >= 1, 'the failure is counted, not silently absorbed into an empty (and therefore "clean") result');
  assert.ok(samples >= 1);
  // Every RETRY attempt within the one errored sample tallies its own errno
  // (mirrors `livePidCwds`'s own retry count) — not just a single bare count.
  assert.ok(errnos.EACCES >= 1, 'the errno is named, not just a bare count');
  assert.ok(longestGapMs >= 0, 'a gap is tracked even for a single, immediately-stopped sample');
});

test('startDescendantSampler: a LISTING failure is retried under a bound (mirrors livePidCwds\' UNKNOWN_READ_RETRIES) — a listing that fails once then succeeds within the SAME sample leaves erroredSamples at 0, but still records the errno seen', () => {
  let calls = 0;
  const sampler = startDescendantSampler({
    rootPid: 100,
    procRoot: '/unused-for-this-test',
    // Never actually fires on its own: the constructor's own immediate
    // `sampleOnce()` call is the only sample this test observes.
    intervalMs: 10_000_000,
    listPids: () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('EIO: transient'), { code: 'EIO' });
      return []; // the retry, within the same sample, succeeds
    },
  });
  const { samples, erroredSamples, errnos } = sampler.stop();
  assert.equal(samples, 1);
  assert.ok(calls >= 2, 'the failed first attempt must have been retried');
  assert.equal(erroredSamples, 0, 'every attempt did NOT fail, so this sample is not errored');
  assert.equal(errnos.EIO, 1, 'the one failed attempt is still visible, even though the sample recovered');
});

test('startDescendantSampler: continuous /proc-listing failure for longer than the blind bound leaves longestGapMs over it', async () => {
  const sampler = startDescendantSampler({
    rootPid: 100,
    procRoot: '/unused-for-this-test',
    intervalMs: 10,
    listPids: () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); },
  });
  await new Promise((r) => setTimeout(r, 80)); // several real ticks, ALL failing — well past 3 × 10ms
  const { erroredSamples, longestGapMs, samples } = sampler.stop();
  assert.ok(samples >= 4, `expected several samples over 80ms at a 10ms interval, got ${samples}`);
  assert.ok(erroredSamples >= 1);
  assert.ok(longestGapMs > 30, `longestGapMs (${longestGapMs}) must exceed the 3×10ms bound — nothing ever succeeded`);
  const [got] = attributeEscapes([{ root: '/sib/tree', paths: ['a.txt'] }], { touchedRoots: new Map(), erroredSamples, longestGapMs, intervalMs: 10 });
  assert.equal(got.owner, 'this-run', 'a sustained blackout must fail-close');
  assert.match(got.reason, /longestGapMs/, 'the line names the gap');
  assert.match(got.reason, /30|bound/, 'the line names the bound it exceeded');
});

test('startDescendantSampler: an exception from pidsDescendedFrom (or a per-pid read) inside one sample is contained — the interval keeps running and later samples still succeed', async () => {
  let calls = 0;
  // A pid whose OWN stringification throws — `pidsDescendedFrom` calls
  // `String(startPid)` with no try/catch around that specific line, so this
  // reaches all the way out of `pidsDescendedFrom` itself, never re-implemented
  // here: this is the shape the brief calls out, not a fake substitute for it.
  const poisonPid = { toString() { throw new Error('cannot stringify this pid'); } };
  const sampler = startDescendantSampler({
    rootPid: 100,
    procRoot: '/unused-for-this-test',
    intervalMs: 10,
    listPids: () => {
      calls += 1;
      return calls === 1 ? [poisonPid] : []; // poison ONLY the very first sample
    },
  });
  await new Promise((r) => setTimeout(r, 60)); // several real ticks beyond the poisoned one
  const { samples, erroredSamples, touchedRoots } = sampler.stop();
  assert.ok(samples >= 3, `the interval must have kept firing after the poisoned sample, got ${samples}`);
  assert.ok(erroredSamples >= 1, 'the poisoned sample is counted as errored, never silently read as clean');
  assert.equal(touchedRoots.size, 0);
});

test('startDescendantSampler (real /proc, real rootPid): a listing that throws once mid-run then reads real /proc stays SIGHTED — attributeEscapes never fail-closes a sibling growth it never saw', async () => {
  let calls = 0;
  const realListPids = () =>
    readdirSync('/proc', { withFileTypes: true }).filter((e) => /^[0-9]+$/.test(e.name)).map((e) => e.name);
  const sampler = startDescendantSampler({
    rootPid: process.pid,
    intervalMs: 10,
    listPids: () => {
      calls += 1;
      if (calls === 2) throw Object.assign(new Error('EIO: injected, once'), { code: 'EIO' });
      return realListPids();
    },
  });
  await new Promise((r) => setTimeout(r, 80)); // several real ticks on the real kernel
  const result = sampler.stop();
  assert.ok(result.samples >= 4);
  assert.ok(result.erroredSamples <= 1, 'a single transient failure, retried, costs at most one errored sample');
  assert.ok(result.errnos.EIO >= 1, 'the transient failure\'s errno is still recorded, whether or not the retry saved the sample');
  const [got] = attributeEscapes(
    [{ root: '/definitely/not/a/real/descendants/tree', paths: ['a.txt'] }],
    { ...result, mainRoot: null },
  );
  assert.equal(got.owner, 'unattributable', 'one retried hiccup on a real kernel must never fail-close a real run');
});

test('startDescendantSampler: an open file inside a tree is also evidence, not only cwd', () => {
  const proc = procTree([
    { pid: '100', ppid: '1' },
    { pid: '200', ppid: '100' },
  ]);
  const worktree = mkdtempSync(join(tmpdir(), 'fence-attr-wt3-'));
  mkdirSync(join(worktree, '.git'));
  try {
    const sampler = startDescendantSampler({
      rootPid: 100,
      procRoot: proc,
      listPids: () => ['100', '200'],
      readCwd: () => { throw new Error('cwd unreadable, e.g. a permission this host will never grant'); },
      listFds: (pid) => (String(pid) === '200' ? ['3'] : []),
      readFd: () => join(worktree, 'open-file.log'),
    });
    const { touchedRoots } = sampler.stop();
    assert.ok(touchedRoots.has(worktree), 'a tree reached only through an open fd is still recorded');
    assert.equal(touchedRoots.get(worktree)!.via, 'open file');
  } finally {
    rm(proc, worktree);
  }
});

test('startDescendantSampler: stop() clears the interval — the process is left free to exit', () => {
  const sampler = startDescendantSampler({
    rootPid: process.pid,
    procRoot: '/proc',
    intervalMs: 5,
    listPids: () => [],
  });
  const result = sampler.stop();
  assert.equal(result.touchedRoots.size, 0);
  // A second stop() must not throw — clearInterval is idempotent by design,
  // and a caller that stops twice (an early return followed by cleanup) must
  // not crash the run on top of whatever else went wrong.
  assert.doesNotThrow(() => sampler.stop());
});

// ================================================ mainCheckoutRoot ===

test('mainCheckoutRoot: the FIRST worktree `git worktree list` names, realpath\'d', () => {
  const main = mkdtempSync(join(tmpdir(), 'fence-attr-main-'));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: main, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(main, 'README.md'), '# r\n');
  git('add', 'README.md');
  git('commit', '-qm', 'init');
  const sibling = join(mkdtempSync(join(tmpdir(), 'fence-attr-sib-')), 'lane');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'lane', sibling], { cwd: main, stdio: 'pipe' });
  try {
    const got = mainCheckoutRoot(sibling); // asked FROM the sibling — must still resolve to the main tree
    assert.equal(got, execFileSync('realpath', [main], { encoding: 'utf8' }).trim());
  } finally {
    rm(main, sibling);
  }
});

test('control: mainCheckoutRoot — a genuine "not a git repository" (rc 128) is still null, never throws (row 102b/11)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fence-attr-notgit-'));
  try {
    assert.equal(mainCheckoutRoot(dir), null);
  } finally {
    rm(dir);
  }
});

test('ROW 102b (RED) finding 11: an exec failure OTHER than "not a git repository" is UNKNOWN, never read as "no main tree"', () => {
  // A nonexistent cwd fails at the spawn level (ENOENT on the cwd itself),
  // never reaching git at all — a different fact from git's own "not a repo".
  const gone = join(tmpdir(), 'fence-attr-does-not-exist-' + Date.now());
  assert.equal(existsSync(gone), false);
  const got = mainCheckoutRoot(gone);
  assert.equal(got, MAIN_CHECKOUT_ROOT_UNKNOWN, `expected the UNKNOWN sentinel, not null: ${String(got)}`);
});

test('ROW 102b (RED) finding 11: attributeEscapes fails the fence CLOSED (THIS-RUN) when mainCheckoutRoot is UNKNOWN, never unattributable', () => {
  const escapes = [{ root: '/sib/tree', paths: ['a.txt'] }];
  const [got] = attributeEscapes(escapes, { touchedRoots: new Map(), longestGapMs: 0, mainRoot: MAIN_CHECKOUT_ROOT_UNKNOWN });
  assert.equal(got.owner, 'this-run', `an UNKNOWN main checkout must never fall through to unattributable: ${JSON.stringify(got)}`);
  assert.match(got.reason, /main checkout could not be determined/);
});

test('ROW 102b (RED) finding 10: a non-ENOENT realpath failure on the escape root defaults to THIS-RUN, never unattributable', () => {
  // A self-referential symlink: realpathSync throws ELOOP, never ENOENT.
  const dir = mkdtempSync(join(tmpdir(), 'fence-attr-eloop-'));
  const loop = join(dir, 'loop');
  symlinkSync(loop, loop);
  try {
    const [got] = attributeEscapes([{ root: loop, paths: ['a.txt'] }], { touchedRoots: new Map(), longestGapMs: 0 });
    assert.equal(got.owner, 'this-run', `an unresolvable escape root must never read as unattributable: ${JSON.stringify(got)}`);
    assert.match(got.reason, /could not be resolved/);
  } finally {
    rm(dir);
  }
});

test('control: attributeEscapes — a genuinely absent escape root (ENOENT) still falls back to resolve() and is judged normally', () => {
  const escapes = [{ root: '/definitely/does/not/exist/fence-attr-row10-ctrl', paths: ['a.txt'] }];
  const [got] = attributeEscapes(escapes, { touchedRoots: new Map(), longestGapMs: 0 });
  // ENOENT is not UNKNOWN — it must reach the ordinary unattributable path,
  // exactly as an absent tree always has.
  assert.equal(got.owner, 'unattributable');
});

// ============================================== real-process end to end ===

/**
 * Spawns a "run" (`root`) that itself spawns a grandchild `cd`ing into
 * `worktree`. The grandchild's own pid is written to `gcPidFile` the instant
 * it is known — NOT via a process-group kill (`detached: true` on the
 * grandchild gives it its OWN session, per `setsid()`, so a group-kill of
 * `root` never reaches it) — so the caller can kill it directly, by pid, the
 * same discipline the brief requires of this test.
 */
function spawnRunWithDescendantIn(worktree: string, gcPidFile: string): { root: ReturnType<typeof spawn>; runnerFile: string } {
  const runnerFile = join(mkdtempSync(join(tmpdir(), 'fence-attr-runner-')), 'runner.mjs');
  writeFileSync(
    runnerFile,
    [
      "import { spawn } from 'node:child_process';",
      "import { writeFileSync } from 'node:fs';",
      'const worktree = process.env.FENCE_TEST_WORKTREE;',
      'const gcPidFile = process.env.FENCE_TEST_GC_PIDFILE;',
      "const gc = spawn('bash', ['-c', `cd \"${worktree}\" && echo touched > touched.txt && sleep 30`], { stdio: 'ignore' });",
      'writeFileSync(gcPidFile, String(gc.pid));',
      'setInterval(() => {}, 5000);',
    ].join('\n'),
  );
  const root = spawn('node', [runnerFile], {
    env: { ...process.env, FENCE_TEST_WORKTREE: worktree, FENCE_TEST_GC_PIDFILE: gcPidFile },
    detached: true,
    stdio: 'ignore',
  });
  root.unref();
  return { root, runnerFile };
}

/** Poll until `predicate()` is true or `deadlineMs` elapses. */
async function waitUntil(predicate: () => boolean, deadlineMs = 5000) {
  const stop = Date.now() + deadlineMs;
  while (!predicate()) {
    if (Date.now() >= stop) throw new Error('waitUntil: condition never became true — this test cannot mean anything without it');
    execFileSync('sleep', ['0.02']);
  }
}

test('real process: the sampler, rooted at a spawned "run", reports its grandchild\'s worktree; a non-descended sibling\'s tree is not reported', async () => {
  const main = mkdtempSync(join(tmpdir(), 'fence-attr-realmain-'));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: main, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(main, 'README.md'), '# r\n');
  git('add', 'README.md');
  git('commit', '-qm', 'init');

  const worktreeA = join(mkdtempSync(join(tmpdir(), 'fence-attr-wta-')), 'a');
  const worktreeB = join(mkdtempSync(join(tmpdir(), 'fence-attr-wtb-')), 'b');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'lane-a', worktreeA], { cwd: main, stdio: 'pipe' });
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'lane-b', worktreeB], { cwd: main, stdio: 'pipe' });

  const gcPidFile = join(mkdtempSync(join(tmpdir(), 'fence-attr-gcpid-')), 'gc.pid');
  const { root, runnerFile } = spawnRunWithDescendantIn(worktreeA, gcPidFile);
  // A SIBLING process, spawned directly by this test (never by `root`), that
  // writes into a SECOND worktree — the negative control the brief asks for.
  const sibling = spawn('bash', ['-c', `cd "${worktreeB}" && echo touched > touched.txt && sleep 30`], { stdio: 'ignore' });

  try {
    await waitUntil(() => existsSync(gcPidFile));
    await waitUntil(() => existsSync(join(worktreeA, 'touched.txt')));
    await waitUntil(() => existsSync(join(worktreeB, 'touched.txt')));

    const sampler = startDescendantSampler({ rootPid: root.pid!, intervalMs: 30 });
    // Give the interval at least one more real tick beyond the immediate
    // sample, on a host where the grandchild's `cd` raced the first read.
    await new Promise((r) => setTimeout(r, 150));
    const { touchedRoots } = sampler.stop();

    const rootsSeen = [...touchedRoots.keys()];
    assert.ok(
      rootsSeen.some((r) => r === execFileSync('realpath', [worktreeA], { encoding: 'utf8' }).trim()),
      `worktree A must be reported; saw: ${rootsSeen.join(', ')}`,
    );
    assert.ok(
      !rootsSeen.some((r) => r === execFileSync('realpath', [worktreeB], { encoding: 'utf8' }).trim()),
      'worktree B (the non-descended sibling) must NOT be reported',
    );
  } finally {
    // Kill only what this test spawned, by pid — never a process-group signal:
    // `root`'s own `detached: true` (needed so ITS pid survives independent of
    // this test's own process group) does not extend to the grandchild, which
    // `spawnRunWithDescendantIn` wrote to `gcPidFile` for exactly this.
    let gcPid: string | null = null;
    try { gcPid = existsSync(gcPidFile) ? readFileSync(gcPidFile, 'utf8').trim() : null; } catch { /* never spawned */ }
    if (gcPid) { try { process.kill(Number(gcPid), 'SIGKILL'); } catch { /* already gone */ } }
    try { process.kill(root.pid!, 'SIGKILL'); } catch { /* already gone */ }
    try { process.kill(sibling.pid!, 'SIGKILL'); } catch { /* already gone */ }
    rm(main, worktreeA, worktreeB, runnerFile, gcPidFile);
  }
});

test('attributeEscapes: NO sampler coverage figure at all is blind, never sighted — an absent reading fails closed (row 96 review)', () => {
  // A caller that forgot to spread the sampler's result (or a sampler that
  // never ran) must not read as a sampler with perfect coverage: `?? 0` would
  // have made the missing figure the BEST possible one.
  const [got] = attributeEscapes([{ root: '/sib/tree', paths: ['a.txt'] }], { touchedRoots: new Map() });
  assert.equal(got.owner, 'this-run', `a missing longestGapMs must not excuse sibling growth: ${got.reason}`);
  assert.match(got.reason, /no sampler coverage figure/);
});

test('startDescendantSampler: a LATE tick with no failed sample is not a coverage gap — only a window containing a failure counts (row 96 review)', async () => {
  // Synchronous work blocks the event loop well past 3× the interval with
  // every listing succeeding: that is the runner being busy (host load, a
  // hashing pass), which the pre-row-96 contract always accepted. Counting it
  // as blindness would trade one false red for another.
  const sampler = startDescendantSampler({ rootPid: process.pid, intervalMs: 10, listPids: () => [] });
  const until = Date.now() + 120;
  while (Date.now() < until) { /* block the loop: no tick can run */ }
  await new Promise((r) => setTimeout(r, 30));
  const result = sampler.stop();
  assert.equal(result.erroredSamples, 0);
  assert.equal(result.longestGapMs, 0, 'no failed sample, so no failure window');
  const [got] = attributeEscapes([{ root: '/sib/tree', paths: ['a.txt'] }], { ...result, mainRoot: null });
  assert.equal(got.owner, 'unattributable');
});
