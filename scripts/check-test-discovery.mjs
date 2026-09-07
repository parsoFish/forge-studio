#!/usr/bin/env node
/**
 * check-test-discovery — every tracked test file is claimed by exactly one
 * runner, and a file the node runner claims actually declares a test.
 *
 * THE DEFECT THIS CLOSES (bead forge-8vfn.7.1; incident M2-A, 2026-08-31).
 * The `git mv forge-ui -> apps/studio` mid-state collapsed `test:ui` from 2741
 * to 2403 tests while several files silently collected ZERO, and the suite
 * still exited `passed`. Only a hand-held total-count comparison caught it, and
 * nothing structural stopped the next one. Same family as the seven-instrument
 * class: nothing observed prints as nothing wrong.
 *
 * Both halves were MEASURED on this repo at 38d96f3d before this file existed:
 *   - `node --test --experimental-strip-types <file declaring no test>` exits 0
 *     and prints `# pass 1` — the file itself counts as the passing test.
 *   - Four tracked `*.test.*` files matched NO runner glob and therefore ran
 *     nowhere: `projects/mdtoc/test/unit.test.ts` and three
 *     three under `studio/starters/projects/`. Both are content, not forge
 *     tests, so they are EXCEPTIONS below — named, with a reason, so the next
 *     unclaimed file is a failure instead of a fifth silent one.
 *   - `vitest run` 4.1.8 already reds a COLLECTED zero-test file ("No test
 *     suite found in file", exit 1). So the zero-test half of this check covers
 *     the node runner only; the discovery half covers both runners.
 *
 * WHY THIS EARNS A GUARD SLOT. It is the ratchet the M6 re-bucket is unsafe
 * without: moving 453 test files between directories is exactly the operation
 * that unhooks a file from its runner, and a suite that reads green over a file
 * it never ran cannot police its own move.
 *
 * SCOPE, honestly. `declaresATest` reads source with comments stripped; a
 * `test(` inside a string literal would still read as a declaration. That errs
 * toward silence on a file that has one, never toward failing a real test file.
 *
 * FIX A FAILURE:
 *   unclaimed     — move the file under a directory a runner glob covers, or
 *                   widen the glob in `package.json` / `apps/studio/vitest.config.ts`.
 *   double-claimed— narrow one of the two globs; a file run twice is counted twice.
 *   zero-tests    — the file declares no test. Delete it or give it its test.
 *   dead-glob     — a discovery glob matching nothing hides whatever should have
 *                   been there. Delete the glob or restore the files.
 *
 * RUN: node scripts/check-test-discovery.mjs [--json]
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VITEST_CONFIG = 'apps/studio/vitest.config.ts';
const VITEST_ROOT = dirname(VITEST_CONFIG);

/**
 * Tracked `*.test.*` files that belong to no forge runner. Each is CONTENT
 * shipped by the repo, not a test of the repo — so "runs nowhere" is correct
 * for it and wrong for anything else.
 */
const EXCEPTIONS = [
  { glob: 'projects/*/**', reason: 'a managed project ground — its suite is the project’s, driven by a forge cycle, not by forge’s own suite' },
  { glob: 'studio/starters/**', reason: 'starter template content copied into a NEW project on onboarding; never executed here' },
];

/** Glob → RegExp. `*` stops at `/`, `**` crosses it, `{a,b}` alternates, everything else is literal. */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      // `/**/` may match zero directories, so `lib/**/*.ts` covers `lib/x.ts`.
      if (out.endsWith('/') && glob[i + 2] === '/') { out = `${out.slice(0, -1)}(?:/.*)?/`; i += 2; }
      else { out += '.*'; i += 1; }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end < 0) { out += '\\{'; continue; }
      out += `(?:${glob.slice(i + 1, end).split(',').map((a) => a.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('|')})`;
      i = end;
    } else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

const COMMENTS = /\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g;

/** Does `src` declare at least one test? Comments stripped first. */
export function declaresATest(src) {
  return /(^|[^\w.])(test|it|describe|suite)\s*(\.\w+)?\s*\(/.test(src.replace(COMMENTS, '$1'));
}

/** The path arguments of the `npm test` command — every token that is not the binary or a flag. */
export function parseNodeGlobs(script) {
  return script.trim().split(/\s+/).slice(1).filter((t) => !t.startsWith('-'));
}

/** The `include: [...]` array of a vitest config. Refuses a config that declares none. */
export function parseVitestIncludes(src) {
  const m = src.match(/include\s*:\s*\[([^\]]*)\]/);
  if (!m) throw new Error(`${VITEST_CONFIG}: no \`include\` array — this check cannot know what vitest collects`);
  const entries = [...m[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((e) => e[1]);
  if (entries.length === 0) throw new Error(`${VITEST_CONFIG}: \`include\` is empty`);
  return entries;
}

/**
 * @param {{files: string[], nodeGlobs: string[], vitestGlobs: string[], vitestRoot: string,
 *          exceptions: {glob: string, reason: string}[], read: (p: string) => string}} input
 */
export function runCheck({ files, nodeGlobs, vitestGlobs, vitestRoot, exceptions, read }) {
  const findings = [];
  const matchers = [
    ...nodeGlobs.map((glob) => ({ glob, runner: 'node', re: globToRegExp(glob) })),
    ...vitestGlobs.map((glob) => ({ glob, runner: 'vitest', re: globToRegExp(`${vitestRoot}/${glob}`) })),
  ];
  const exceptionMatchers = exceptions.map((e) => ({ ...e, re: globToRegExp(e.glob) }));
  const hit = new Map(matchers.map((m) => [m.glob, 0]));
  const exceptionHit = new Map(exceptionMatchers.map((e) => [e.glob, 0]));

  for (const file of files) {
    const claims = matchers.filter((m) => m.re.test(file));
    for (const c of claims) hit.set(c.glob, hit.get(c.glob) + 1);
    const excused = exceptionMatchers.filter((e) => e.re.test(file));
    for (const e of excused) exceptionHit.set(e.glob, exceptionHit.get(e.glob) + 1);

    if (claims.length === 0) {
      if (excused.length === 0) findings.push({ kind: 'unclaimed', path: file });
      continue;
    }
    if (claims.length > 1) {
      findings.push({ kind: 'double-claimed', path: file, detail: claims.map((c) => c.glob).join(' + ') });
      continue;
    }
    if (claims[0].runner === 'node' && !declaresATest(read(file))) {
      findings.push({ kind: 'zero-tests', path: file });
    }
  }

  for (const [glob, n] of hit) if (n === 0) findings.push({ kind: 'dead-glob', glob });
  for (const [glob, n] of exceptionHit) if (n === 0) findings.push({ kind: 'dead-glob', glob, detail: 'exception' });
  return { checked: files.length, findings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = execFileSync('git', ['ls-files', '*.test.*'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\n').filter(Boolean);
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const result = runCheck({
    files,
    nodeGlobs: parseNodeGlobs(pkg.scripts.test),
    vitestGlobs: parseVitestIncludes(readFileSync(join(ROOT, VITEST_CONFIG), 'utf8')),
    vitestRoot: VITEST_ROOT,
    exceptions: EXCEPTIONS,
    read: (p) => readFileSync(join(ROOT, p), 'utf8'),
  });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.findings.length > 0) {
    console.error(`check-test-discovery: FAIL — ${result.findings.length} finding(s) across ${result.checked} tracked test file(s):\n`);
    for (const f of result.findings) {
      console.error(`  ✗ ${f.kind.padEnd(14)} ${f.path ?? f.glob}${f.detail ? ` (${f.detail})` : ''}`);
    }
    console.error('\nSee the header of scripts/check-test-discovery.mjs for what each kind means and how to fix it.');
    process.exitCode = 1;
  } else {
    console.log(`check-test-discovery: PASS — ${result.checked} tracked test file(s), every one claimed by exactly one runner, ${EXCEPTIONS.length} named exception(s)`);
  }
}
