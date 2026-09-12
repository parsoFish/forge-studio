/**
 * The door for `residue.sh` — `forge-8vfn.7.6.78`, T1 ruling 875.
 *
 * THREE LANES, THREE OMISSIONS, ONE SHAPE. M6-C's launcher printed porcelain and
 * not the six queue counts (861). M6-A's printed the queue and not
 * `_logs/_agent-*` (873). M6-D's printed the queue and not porcelain, and
 * labelled a count `_agent-dirs` while counting only `_agent-*` (875). Each lane
 * had instrumented the item its own last incident was about.
 *
 * So the tests that matter here are not "does it count correctly" — they are
 * (a) EVERY item appears, every time, and (b) THE LABEL MATCHES WHAT WAS
 * COUNTED. A census whose label claims more than its glob covers is worse than a
 * missing line: it reads as coverage.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(
  import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'residue.sh',
);

/** A worktree with the structure a clean checkout has and nothing in it.
 *
 *  THE `.gitignore` IS NOT SCENERY. The repo ignores `_logs/*`, every
 *  `_queue/<state>/*`, `_worktrees/` and `_1.0` — which is exactly why 861
 *  happened: a real initiative sat in `ready-for-review` for thirteen hours
 *  while `git status --porcelain` printed nothing and "porcelain 0" stood as
 *  the clean-tree line. A fixture without these rules would let porcelain see
 *  every planted file, and the per-item tests below would pass for the wrong
 *  reason — they would be measuring a tree the campaign does not have. */
function cleanTree(): string {
  const d = mkdtempSync(join(tmpdir(), 'residue-'));
  spawnSync('git', ['init', '-q', d]);
  writeFileSync(
    join(d, '.gitignore'),
    ['_logs/*', '_queue/pending/*', '_queue/in-flight/*', '_queue/ready-for-review/*',
     '_queue/done/*', '_queue/merged/*', '_queue/failed/*', '_worktrees/', '_1.0', '.gitignore',
    ].join('\n') + '\n',
  );
  for (const q of ['pending', 'in-flight', 'ready-for-review', 'done', 'merged', 'failed']) {
    mkdirSync(join(d, '_queue', q), { recursive: true });
    writeFileSync(join(d, '_queue', q, '.gitkeep'), '');
  }
  mkdirSync(join(d, '_logs'), { recursive: true });
  mkdirSync(join(d, '_worktrees'), { recursive: true });
  return d;
}
const run = (d: string, ...extra: string[]) =>
  spawnSync('bash', [SCRIPT, d, ...extra], { encoding: 'utf8' });

/** Every `<label>=<value>` the census printed, as a map. */
function items(stdout: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const hit = line.match(/^\S+ RESIDUE ([^=]+)=(\S*)/);
    if (hit && hit[1] !== undefined && hit[2] !== undefined) m.set(hit[1], hit[2]);
  }
  return m;
}

/** Every item §15.427 names, by the exact label this tool must print. */
const GATING = [
  'porcelain.tracked', 'porcelain.untracked',
  '_queue/pending', '_queue/in-flight', '_queue/ready-for-review',
  '_queue/done', '_queue/merged', '_queue/failed',
  '_worktrees', '_logs/_agent-*', '_logs/_authoring-*', '_logs/<ts>_INIT-*',
];

describe('residue.sh — the list is printed IN FULL or the tool is the defect', () => {
  test('a clean tree prints EVERY item, all zero, and exits 0', () => {
    const d = cleanTree();
    try {
      const r = run(d);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const got = items(r.stdout);
      for (const label of GATING) {
        assert.ok(got.has(label), `missing item: ${label}`);
        assert.equal(got.get(label), '0', `${label} should be 0 on a clean tree`);
      }
      assert.ok(got.has('_logs/_bridge-*'), 'the informational bridge count must still be printed');
      assert.equal(got.get('_logs/daemon/forge.pid'), 'absent');
      assert.equal(got.get('_1.0/'), 'absent');
      assert.match(r.stdout, /VERDICT clean/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('ONE DATE: every line carries the same stamp', () => {
    const d = cleanTree();
    try {
      const stamps = new Set(
        run(d).stdout.split('\n').filter((l) => l.includes(' RESIDUE ')).map((l) => l.split(' ')[0]),
      );
      // Two stamps in one census let a reader take two measurements for one.
      assert.equal(stamps.size, 1, `expected one stamp, got ${[...stamps].join(', ')}`);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  // THE LABEL MATCHES WHAT WAS COUNTED — one fixture per item, each planted
  // alone, so a glob that quietly covers a neighbour is caught by the neighbour's
  // own count moving.
  const fixtures: ReadonlyArray<readonly [string, (d: string) => void]> = [
    ['_queue/pending', (d) => writeFileSync(join(d, '_queue/pending/INIT-x.md'), 'x')],
    ['_queue/in-flight', (d) => writeFileSync(join(d, '_queue/in-flight/INIT-x.md'), 'x')],
    ['_queue/ready-for-review', (d) => writeFileSync(join(d, '_queue/ready-for-review/INIT-x.md'), 'x')],
    ['_queue/done', (d) => writeFileSync(join(d, '_queue/done/INIT-x.md'), 'x')],
    ['_queue/merged', (d) => writeFileSync(join(d, '_queue/merged/INIT-x.md'), 'x')],
    ['_queue/failed', (d) => writeFileSync(join(d, '_queue/failed/INIT-x.md'), 'x')],
    ['_worktrees', (d) => mkdirSync(join(d, '_worktrees/wi-1'), { recursive: true })],
    ['_logs/_agent-*', (d) => mkdirSync(join(d, '_logs/_agent-story-s5-1'), { recursive: true })],
    ['_logs/_authoring-*', (d) => mkdirSync(join(d, '_logs/_authoring-1'), { recursive: true })],
    ['_logs/<ts>_INIT-*', (d) => mkdirSync(join(d, '_logs/2026-09-12T00-00-00_INIT-x'), { recursive: true })],
  ];

  for (const [label, plant] of fixtures) {
    test(`${label}: the item that moves is the item that was planted, and it gates`, () => {
      const d = cleanTree();
      try {
        const before = items(run(d).stdout);
        plant(d);
        const r = run(d);
        const after = items(r.stdout);

        assert.equal(after.get(label), '1', `${label} should count the planted entry`);
        for (const other of GATING) {
          if (other === label) continue;
          assert.equal(
            after.get(other), before.get(other),
            `planting ${label} moved ${other} — a label is covering something it does not name`,
          );
        }
        assert.equal(r.status, 1, 'a non-zero gating item must exit 1');
        assert.match(r.stdout, new RegExp(`VERDICT NOT CLEAN.*${label.replace(/[*<>/\-]/g, '\\$&')}`));
      } finally { rmSync(d, { recursive: true, force: true }); }
    });
  }

  test('the cycle-dir glob covers BOTH spellings the rulings use', () => {
    const d = cleanTree();
    try {
      // 875 wrote `_logs/<ts>_INIT-*`; the bead writes `_logs/_INIT-*`. A glob
      // that matched only one would silently miss the cycle dirs 864 is about —
      // the ones whose spend the ceiling's collector cannot see. Both are
      // planted here so the count, not my reading of a pattern, settles it.
      mkdirSync(join(d, '_logs/2026-09-12T00-00-00_INIT-bar'), { recursive: true });
      mkdirSync(join(d, '_logs/_INIT-foo'), { recursive: true });
      const r = run(d);
      assert.equal(items(r.stdout).get('_logs/<ts>_INIT-*'), '2');
      assert.equal(r.status, 1);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('.gitkeep is structure, not work — a queue holding only it is zero', () => {
    const d = cleanTree();
    try {
      assert.equal(items(run(d).stdout).get('_queue/pending'), '0');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('porcelain is SPLIT: an untracked file is not a tracked change', () => {
    const d = cleanTree();
    try {
      writeFileSync(join(d, 'note.txt'), 'x');
      const got = items(run(d).stdout);
      // 861: `.gitignore` hid a real queue entry from porcelain for thirteen
      // hours while "porcelain 0" stood as the clean-tree line. The two halves
      // are different claims and are never collapsed.
      assert.equal(got.get('porcelain.untracked'), '1');
      assert.equal(got.get('porcelain.tracked'), '0');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a daemon pid file for a DEAD process is reported and removed; a LIVE one gates', () => {
    const d = cleanTree();
    try {
      mkdirSync(join(d, '_logs/daemon'), { recursive: true });
      writeFileSync(join(d, '_logs/daemon/forge.pid'), '2147480000'); // not a live pid
      const dead = run(d);
      assert.match(dead.stdout, /_logs\/daemon\/forge\.pid=dead-and-removed/);
      assert.equal(existsSync(join(d, '_logs/daemon/forge.pid')), false, 'the dead pid file must be gone');

      writeFileSync(join(d, '_logs/daemon/forge.pid'), String(process.pid)); // demonstrably alive
      const live = run(d);
      assert.match(live.stdout, new RegExp(`_logs/daemon/forge\\.pid=LIVE:${process.pid}`));
      assert.equal(live.status, 1, 'a live daemon must gate');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a campaign dir inside the worktree is residue, not config (746)', () => {
    const d = cleanTree();
    try {
      mkdirSync(join(d, '_1.0'), { recursive: true });
      const r = run(d);
      assert.match(r.stdout, /_1\.0\/=present/);
      assert.equal(r.status, 1);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('the bridge count is printed and NEVER gates (872)', () => {
    const d = cleanTree();
    try {
      mkdirSync(join(d, '_logs/_bridge-2026-09-12T00-00-00-abc'), { recursive: true });
      const r = run(d);
      assert.equal(items(r.stdout).get('_logs/_bridge-*'), '1');
      assert.equal(r.status, 0, 'the bridge opens its own dir at boot — it is not a dispatched turn');
      assert.match(r.stdout, /VERDICT clean/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('REFUSES what it does not understand rather than answering a different question', () => {
    const d = cleanTree();
    try {
      assert.equal(run(d, '--quiet').status, 2, 'an unrecognised flag must refuse, not be ignored');
      assert.equal(run('/nope/not/a/worktree').status, 2);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
