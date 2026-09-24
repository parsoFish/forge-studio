/**
 * Proof that the one-door-imports ratchet (bead forge-8vfn.5.31) BITES.
 *
 * `scan()`/`audit()` are pure over a `root` argument, so every case runs
 * against a `mkdtempSync` fixture rather than the live tree — the same
 * reason `check-boundaries.mjs` takes `--root` (bead forge-8vfn.5.64): a
 * scanner racing another lane's concurrent `node --test` run over the real
 * tree is a false red neither lane caused.
 *
 * RUN: node --test --experimental-strip-types scripts/check-one-door-imports.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts/check-one-door-imports.mjs');

const { scan, audit, DOORED_PACKAGES } = (await import(new URL('./check-one-door-imports.mjs', import.meta.url).href)) as {
  scan: (root: string) => Set<string>;
  audit: (root: string, baseline: string[]) => { violations: number; baselined: number; introduced: string[]; stale: string[] };
  DOORED_PACKAGES: readonly string[];
};

/** A minimal git-tracked fixture tree `scan()` can `git ls-files` over. */
function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'one-door-fixture-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  return dir;
}

function commitAll(dir: string) {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: dir });
}

function run(dir: string, baselinePath: string, args: string[] = []): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('node', [CHECKER, '--root', dir, '--baseline', baselinePath, ...args], { encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

test('factory is not a doored package — ADR 048 keeps its door empty on purpose', () => {
  assert.equal(DOORED_PACKAGES.includes('factory'), false);
  assert.deepEqual(
    [...DOORED_PACKAGES].sort(),
    ['agents', 'contracts', 'flows', 'knowledge', 'kernel', 'library', 'projects', 'sessions'].sort(),
  );
});

test('a production deep import into another doored package IS a violation', () => {
  const dir = makeFixture();
  try {
    mkdirSync(join(dir, 'packages/kernel'), { recursive: true });
    writeFileSync(join(dir, 'packages/kernel/index.ts'), "export * from './ids.ts';\n");
    writeFileSync(join(dir, 'packages/kernel/ids.ts'), 'export const toId = (s: string) => s;\n');
    mkdirSync(join(dir, 'packages/agents'), { recursive: true });
    writeFileSync(join(dir, 'packages/agents/run-agent.ts'), "import { toId } from '@forge/kernel/ids.ts';\n");
    commitAll(dir);

    const violations = scan(dir);
    assert.deepEqual([...violations], ['kernel|packages/agents/run-agent.ts|ids.ts']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the same file\'s own package deep-importing itself is NOT a violation', () => {
  const dir = makeFixture();
  try {
    mkdirSync(join(dir, 'packages/kernel'), { recursive: true });
    writeFileSync(join(dir, 'packages/kernel/index.ts'), "export * from './ids.ts';\n");
    writeFileSync(join(dir, 'packages/kernel/ids.ts'), 'export const toId = (s: string) => s;\n');
    writeFileSync(join(dir, 'packages/kernel/other.ts'), "import { toId } from '@forge/kernel/ids.ts';\n");
    commitAll(dir);

    assert.deepEqual([...scan(dir)], []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a TEST file\'s deep import is out of scope — the door narrows via exports + tsc, not this scan', () => {
  const dir = makeFixture();
  try {
    mkdirSync(join(dir, 'packages/kernel'), { recursive: true });
    writeFileSync(join(dir, 'packages/kernel/index.ts'), 'export {};\n');
    mkdirSync(join(dir, 'packages/agents/tests'), { recursive: true });
    writeFileSync(join(dir, 'packages/agents/tests/run-agent.test.ts'), "import { toId } from '@forge/kernel/ids.ts';\n");
    commitAll(dir);

    assert.deepEqual([...scan(dir)], []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('audit(): a violation not in the baseline is INTRODUCED', () => {
  const dir = makeFixture();
  try {
    mkdirSync(join(dir, 'packages/kernel'), { recursive: true });
    writeFileSync(join(dir, 'packages/kernel/index.ts'), "export * from './ids.ts';\n");
    mkdirSync(join(dir, 'packages/agents'), { recursive: true });
    writeFileSync(join(dir, 'packages/agents/run-agent.ts'), "import { toId } from '@forge/kernel/ids.ts';\n");
    commitAll(dir);

    const result = audit(dir, []);
    assert.deepEqual(result.introduced, ['kernel|packages/agents/run-agent.ts|ids.ts']);
    assert.deepEqual(result.stale, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('audit(): a baseline entry the tree no longer has is STALE — the ratchet only shrinks', () => {
  const dir = makeFixture();
  try {
    mkdirSync(join(dir, 'packages/kernel'), { recursive: true });
    writeFileSync(join(dir, 'packages/kernel/index.ts'), "export * from './ids.ts';\n");
    commitAll(dir);

    const result = audit(dir, ['kernel|packages/agents/run-agent.ts|ids.ts']);
    assert.deepEqual(result.introduced, []);
    assert.deepEqual(result.stale, ['kernel|packages/agents/run-agent.ts|ids.ts']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: a fixture matching its baseline exactly PASSES (exit 0)', () => {
  const dir = makeFixture();
  const baseline = join(dir, 'baseline.json');
  try {
    mkdirSync(join(dir, 'packages/kernel'), { recursive: true });
    writeFileSync(join(dir, 'packages/kernel/index.ts'), "export * from './ids.ts';\n");
    mkdirSync(join(dir, 'packages/agents'), { recursive: true });
    writeFileSync(join(dir, 'packages/agents/run-agent.ts'), "import { toId } from '@forge/kernel/ids.ts';\n");
    commitAll(dir);
    writeFileSync(baseline, JSON.stringify(['kernel|packages/agents/run-agent.ts|ids.ts']));

    const { code, out } = run(dir, baseline);
    assert.equal(code, 0);
    assert.match(out, /PASS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: a NEW deep import beyond the baseline FAILS (exit 1) — the mutation this ratchet exists to catch', () => {
  const dir = makeFixture();
  const baseline = join(dir, 'baseline.json');
  try {
    mkdirSync(join(dir, 'packages/kernel'), { recursive: true });
    writeFileSync(join(dir, 'packages/kernel/index.ts'), "export * from './ids.ts';\nexport * from './config.ts';\n");
    mkdirSync(join(dir, 'packages/agents'), { recursive: true });
    writeFileSync(
      join(dir, 'packages/agents/run-agent.ts'),
      "import { toId } from '@forge/kernel/ids.ts';\nimport { loadConfig } from '@forge/kernel/config.ts';\n",
    );
    commitAll(dir);
    // Baseline only knows about the `ids.ts` deep import — `config.ts` is new.
    writeFileSync(baseline, JSON.stringify(['kernel|packages/agents/run-agent.ts|ids.ts']));

    const { code, out } = run(dir, baseline);
    assert.equal(code, 1);
    assert.match(out, /NEW\s+kernel\|packages\/agents\/run-agent\.ts\|config\.ts/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
