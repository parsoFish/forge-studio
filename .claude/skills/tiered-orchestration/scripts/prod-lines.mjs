#!/usr/bin/env node
// prod-lines.mjs — per-package production lines, by the repo's OWN definition of production.
//
//   node prod-lines.mjs [root]     root defaults to cwd
//
// The definition is `productionFiles()` from that root's `scripts/check-owner.mjs` (CODE
// extensions, the NOT_PRODUCTION regex, skills/*/SKILL.md) — the guard the repo already runs, so
// this number and the owner gate can never disagree about what counts.
//
// check-owner is resolved FROM THE ROOT BEING MEASURED, never from this script's own location:
// a measurement tool that resolves its input from somewhere else answers a different question in
// each checkout (§15.148 — `boundary-share.mjs` read main's baseline from inside a lane worktree
// and reported 25 where the worktree held 21). Every figure this prints names its root.
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? process.cwd());
const owner = join(root, 'scripts', 'check-owner.mjs');
if (!existsSync(owner)) {
  console.error(`prod-lines: no scripts/check-owner.mjs under ${root} — this is not a forge checkout`);
  process.exit(2);
}
const { productionFiles } = await import(pathToFileURL(owner).href);
const files = productionFiles(root);
const byPkg = new Map();
let total = 0;
for (const f of files) {
  const m = f.match(/^(packages\/[^/]+|apps\/[^/]+|orchestrator|cli|loops|skills)\//);
  const key = m ? m[1] : 'other';
  const n = readFileSync(join(root, f), 'utf8').split('\n').length - 1;
  byPkg.set(key, (byPkg.get(key) ?? 0) + n);
  total += n;
}
for (const [k, v] of [...byPkg].sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(8), k);
console.log(String(total).padStart(8), 'TOTAL', `(${files.length} files; root=${root})`);
