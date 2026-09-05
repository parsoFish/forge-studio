#!/usr/bin/env node
/**
 * ADR 048 clause 3 — deletability is proven by EXECUTION, not claimed.
 *
 * Two halves, in order, because the second destroys the tree it runs in:
 *
 *   1. STATIC. No production file may import `@forge/factory` except the one
 *      resolution seam, `apps/forge/factory-wiring.ts` (clauses 1 and 2). This
 *      half is non-destructive and runs anywhere.
 *   2. LIVE. `packages/factory` and its workspace link are REMOVED, then the
 *      bridge is booted in-process on an OS-assigned port and asked to serve:
 *      `/api/health` must answer as `forge-bridge`, and a route that belongs to
 *      the example must answer 501 — not 500, and not a wrong answer.
 *
 * WHY THE BRIDGE AND NOT `forge studio`. `forge studio` is the bridge plus a
 * static Next build that talks to it over HTTP and imports no package at all
 * (`grep -rn "@forge/factory" apps/studio` = 0 — the UI cannot be broken by a
 * missing package it never names). The bridge is the half that resolves the
 * example, so it is the half whose boot proves anything. Booting it in-process
 * on port 0 also keeps the check off the host-global 4123/4124 pair, so it is
 * runnable next to a live studio session.
 *
 * DESTRUCTIVE: run it last in a job, or in a disposable tree. It refuses to run
 * against a tree with uncommitted changes to `packages/factory`, so an operator
 * cannot lose work to it by accident.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

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

const dirty = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', 'packages/factory'], { encoding: 'utf8' }).trim();
if (dirty !== '') fail(`packages/factory has uncommitted changes; refusing to delete it:\n${dirty}`);

rmSync(join(ROOT, 'packages', 'factory'), { recursive: true, force: true });
rmSync(join(ROOT, 'node_modules', '@forge', 'factory'), { recursive: true, force: true });
if (existsSync(join(ROOT, 'packages', 'factory'))) fail('packages/factory still exists after removal');
console.log('factory-deletable: removed packages/factory and its workspace link.');

const { startBridge } = await import('../apps/forge/ui-bridge.ts');
const bridge = await startBridge({ forgeRoot: ROOT, port: 0 });
try {
  const health = await fetch(`${bridge.url}/api/health`);
  if (!health.ok) fail(`/api/health answered ${health.status} with no example installed`);
  const body = await health.json();
  if (body.service !== 'forge-bridge') fail(`/api/health served ${JSON.stringify(body.service)}, not forge-bridge`);
  console.log(`factory-deletable: live — the bridge booted at ${bridge.url} and serves /api/health as forge-bridge.`);

  const example = await fetch(`${bridge.url}/api/review-comments/TEST-no-example`);
  if (example.status !== 501) {
    fail(`an example-owned route answered ${example.status}; absence must be a SUPPORTED state (501), never a crash or a wrong answer`);
  }
  console.log('factory-deletable: live — an example-owned route answers 501, not 500 and not an answer.');
} finally {
  await bridge.close();
}

console.log('factory-deletable: PASS — the platform boots and serves with the example package deleted (ADR 048).');
