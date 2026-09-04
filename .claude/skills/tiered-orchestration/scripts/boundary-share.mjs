#!/usr/bin/env node
// T1(M4)-owned. Per-package share of scripts/baselines/boundaries.json under the
// M4 attribution rule: a row belongs to the package that must fix it — the FROM
// package when the importer is a package, else the TO package; studio-beyond-
// contracts rows belong to `studio`. Usage: node _1.0/boundary-share.mjs [pkg]
// With [pkg]: prints that package's rows (rule|from|to) and exits 1 if any remain.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
// Baseline resolved from the CALLER'S tree (cwd upward), never from this script's own
// location — fixed 2026-09-02 after knowledge measured the old form reading the MAIN
// checkout's baseline from inside a lane worktree (54 reported where the worktree held 53).
let dir = process.cwd();
for (;;) {
  if (existsSync(resolve(dir, 'scripts/baselines/boundaries.json'))) break;
  const up = dirname(dir);
  if (up === dir) { console.error(`boundary-share: no scripts/baselines/boundaries.json above ${process.cwd()}`); process.exit(2); }
  dir = up;
}
const baselinePath = resolve(dir, 'scripts/baselines/boundaries.json');
console.log(`baseline: ${baselinePath}`);
const rows = JSON.parse(readFileSync(baselinePath, 'utf8'));
const pkg = (p) => /^packages\/([^/]+)\//.exec(p)?.[1] ?? (p.startsWith('apps/studio/') ? 'studio' : null);
const owner = (rule, from, to) => rule === 'studio-beyond-contracts' ? 'studio' : ((pkg(from) && pkg(from) !== 'studio' ? pkg(from) : pkg(to)) ?? 'other');
const share = new Map();
for (const row of rows) { const [r, f, t] = row.split('|'); const o = owner(r, f, t); (share.get(o) ?? share.set(o, []).get(o)).push(row); }
const want = process.argv[2];
if (!want) {
  console.log(`N=${rows.length}`);
  for (const [o, rs] of [...share].sort((a, b) => b[1].length - a[1].length)) console.log(`${String(rs.length).padStart(4)}  ${o}`);
} else {
  const rs = share.get(want) ?? [];
  for (const r of rs) console.log(r);
  console.log(`${want}: ${rs.length} row(s)`);
  process.exitCode = rs.length ? 1 : 0;
}
