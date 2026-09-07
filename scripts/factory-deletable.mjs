#!/usr/bin/env node
/**
 * ADR 048 clause 3 — deletability is proven by EXECUTION, not claimed.
 *
 * Two halves, in order, because the second destroys the tree it runs in:
 *
 *   1. STATIC. No production file may import `@forge/factory` except the one
 *      resolution seam, `apps/forge/factory-wiring.ts` (clauses 1 and 2). This
 *      half is non-destructive and runs anywhere.
 *   2. LIVE. A THROWAWAY `git worktree` of HEAD is created without the example
 *      package, and the bridge is booted from THAT tree, in-process on an
 *      OS-assigned port, and asked to serve: `/api/health` must answer as
 *      `forge-bridge`, and a route that belongs to the example must answer
 *      501 — not 500, and not a wrong answer.
 *
 *      IT DOES NOT TOUCH THE TREE IT IS RUN FROM, and says so with a porcelain
 *      check either side (bead forge-8vfn.6.10.21). The first shape of this
 *      script deleted in place: CI's checkout is ephemeral so CI was fine, but
 *      `gate.sh` replicates every `ci.yml` step in a PERSISTENT worktree — one
 *      green gate left it with no example package and the next failed the
 *      build, 32 tests and four guards on empty populations. A proof that
 *      destroys the thing it is run against is not a proof.
 *
 * WHY THE BRIDGE AND NOT `forge studio`. `forge studio` is the bridge plus a
 * static Next build that talks to it over HTTP and imports no package at all
 * (`grep -rn "@forge/factory" apps/studio` = 0 — the UI cannot be broken by a
 * missing package it never names). The bridge is the half that resolves the
 * example, so it is the half whose boot proves anything. Booting it in-process
 * on port 0 also keeps the check off the host-global 4123/4124 pair, so it is
 * runnable next to a live studio session.
 *
 * SAFE TO RUN ANYWHERE with a committed `packages/factory`: the deletion happens
 * only in the throwaway worktree. It still refuses to start when `packages/factory`
 * has uncommitted changes, because a scratch worktree of HEAD would silently
 * prove the WRONG tree deletable.
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { createFactorylessWorktree, isFactoryless, porcelain } from './factory-deletable-scratch.mjs';

const ROOT = resolve(import.meta.dirname, '..');
/**
 * The FIXED, ENUMERATED set of assembly modules that may name the example. Two,
 * not one, and the second's own header records why: the demo entry points pull
 * the capture machinery into whatever module graph names them, and the bridge
 * resolves `factory-wiring.ts` at boot. Adding a third is a decision, not an
 * accident — this list is what makes it one.
 */
const SEAM = new Set(['apps/forge/factory-wiring.ts', 'apps/forge/factory-cli-wiring.ts']);
/**
 * Every module-syntax way of naming the package, because a check that missed
 * one would report a seam that is not there. The planted-control run that
 * proved this list found the third: a bare side-effect `import '@forge/...'`
 * has no `from` and no parenthesis, and the first draft sailed past it.
 *
 *  1. `… from '@forge/factory…'`   — static and re-export, including the
 *                                     multi-line form whose `from` is its own line
 *  2. `import(` / `require(`        — dynamic, and `typeof import(…)` in a type
 *  3. `import '@forge/factory…'`    — side effect, no binding at all
 *
 * A line that only MENTIONS the package in prose matches none of them.
 */
const SPECIFIER = [
  /(?:^|[^.\w])from\s*['"]@forge\/factory/,
  /\b(?:import|require)\s*\(\s*['"]@forge\/factory/,
  /^\s*(?:import|export)\s+['"]@forge\/factory/,
];

function fail(msg) {
  console.error(`factory-deletable: FAIL — ${msg}`);
  process.exit(1);
}

/** Every production `.ts`/`.tsx` under a directory: no tests, no fixtures, no node_modules. */
function productionFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'test-fixtures' || entry === 'tests') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { productionFiles(full, out); continue; }
    if (!/\.tsx?$/.test(entry) || entry.includes('.test.')) continue;
    out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Static: one seam, and only one.
// ---------------------------------------------------------------------------
const offenders = [];
for (const dir of ['apps', 'packages', 'scripts']) {
  const full = join(ROOT, dir);
  if (!existsSync(full)) continue;
  for (const file of productionFiles(full)) {
    const rel = relative(ROOT, file);
    if (SEAM.has(rel) || rel.startsWith('packages/factory/')) continue;
    for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
      if (SPECIFIER.some((re) => re.test(line))) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    }
  }
}
if (offenders.length > 0) {
  fail(
    `${offenders.length} production file(s) import @forge/factory outside the ${SEAM.size} seam module(s) — ` +
      `a package that cannot be removed is not deletable (ADR 048 clauses 1-2):\n  ${offenders.join('\n  ')}`,
  );
}
console.log(`factory-deletable: static — the ${SEAM.size} seam module(s) are the only production importers of @forge/factory.`);

// ---------------------------------------------------------------------------
// 2. Live: remove the example and serve without it.
// ---------------------------------------------------------------------------
if (process.argv.includes('--static-only')) {
  console.log('factory-deletable: --static-only, skipping the destructive half.');
  process.exit(0);
}

const dirty = porcelain(ROOT, 'packages/factory');
if (dirty !== '') fail(`packages/factory has uncommitted changes; a scratch worktree of HEAD would prove the wrong tree:\n${dirty}`);

const { dir: scratch, cleanup } = createFactorylessWorktree(ROOT);
try {
  if (!isFactoryless(scratch)) fail('the scratch worktree still carries the example package — the proof would prove nothing');
  console.log(`factory-deletable: scratch worktree ${scratch} has no packages/factory and no workspace link to one.`);

  const { startBridge } = await import(join(scratch, 'apps', 'forge', 'ui-bridge.ts'));
  const bridge = await startBridge({ forgeRoot: scratch, port: 0 });
  try {
    const health = await fetch(`${bridge.url}/api/health`);
    if (!health.ok) fail(`/api/health answered ${health.status} with no example installed`);
    const body = await health.json();
    if (body.service !== 'forge-bridge') fail(`/api/health served ${JSON.stringify(body.service)}, not forge-bridge`);
    console.log(`factory-deletable: live — the bridge booted at ${bridge.url} and serves /api/health as forge-bridge.`);

    // THE SURVIVAL PROBE (T1 ruling 485). This used to assert that an
    // example-owned route answers 501. That subject moved: the review-comment
    // store is platform code now, so it answers 200 with the example deleted,
    // and no route 501s any more.
    //
    // What replaced it is a stronger reading of the same clause. `/api/reflect/
    // <id>/answer` fires the reflector rerun, which IS the example's work, and
    // with no example installed this exact request used to end the process:
    // the route sends its 200 first, `example()` threw synchronously past it,
    // and the outer catch tried to send a 500 on an answered response —
    // ERR_HTTP_HEADERS_SENT. "Absence is a supported state, never a crash and
    // never a wrong answer" is therefore proven by SURVIVING the request rather
    // than by a status code: the platform answers, the example's part is
    // skipped on the record, and the bridge is still there afterwards.
    const cycleId = 'FACTORY-DELETABLE-probe';
    mkdirSync(join(scratch, '_logs', cycleId), { recursive: true });
    writeFileSync(join(scratch, '_logs', cycleId, 'events.jsonl'), '');
    const answered = await fetch(`${bridge.url}/api/reflect/${cycleId}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1', origin: bridge.url },
      body: JSON.stringify({ freeform: 'factory-deletable probe' }),
    });
    if (answered.status !== 200) {
      fail(`the reflect-answer route answered ${answered.status} with no example installed; capture is the platform's own bookkeeping and must proceed`);
    }
    const stillAlive = await fetch(`${bridge.url}/api/health`);
    if (!stillAlive.ok) fail('the bridge stopped answering after a request that reaches the example — absence must not be fatal');

    const events = readFileSync(join(scratch, '_logs', cycleId, 'events.jsonl'), 'utf8');
    if (!events.includes('bridge.reflect-rerun-skipped-no-example')) {
      fail('the skipped rerun left no record — a skip nothing reports is indistinguishable from a rerun that silently did nothing');
    }
    console.log('factory-deletable: live — the example\'s work is SKIPPED ON THE RECORD, the route still answers 200, and the bridge survives.');
  } finally {
    await bridge.close();
  }
} finally {
  cleanup();
}

// The property the first shape of this script did not have. Asserted, not assumed.
const after = porcelain(ROOT, 'packages/factory');
if (after !== '') fail(`the proof MODIFIED the tree it was run from — that is the defect this check exists to never repeat:\n${after}`);
if (!existsSync(join(ROOT, 'packages', 'factory'))) fail('the proof deleted the caller\'s packages/factory');
console.log('factory-deletable: the tree this ran from is untouched (packages/factory present, git clean).');

console.log('factory-deletable: PASS — the platform boots and serves with the example package deleted (ADR 048).');
