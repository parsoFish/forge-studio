/**
 * Acceptance tests for `runCreate` (forge-qb5, P2) — the exported, pure-ish
 * core of `cmdCreate` (`forge create`), extracted so its decision logic can
 * be driven hermetically:
 *
 *   - `cmdCreate` was NOT exported, so no test could call it at all.
 *   - it called `process.exit()` inline three times, so any in-process test
 *     that did reach it would kill the test runner.
 *   - `FORGE_ROOT` was a module-level constant with no override point, so a
 *     test could never point the command at a throwaway temp directory.
 *
 * `runCreate(rest, { forgeRoot })` returns an explicit result object, never
 * calls `process.exit`, and takes `forgeRoot` as an injected parameter — ADR
 * 042 boundary 3 (export-for-testability of a pure function with an explicit
 * error contract).
 *
 * Every fixture here is either hand-written directly into a fresh
 * `mkdtempSync` root, or `cpSync`'d verbatim from the REAL, already-shipped
 * `studio/starters/projects/cli` template — never produced by
 * calling `runCreate`/`scaffoldGreenfieldProject` itself, so a fix to the bug
 * under test can't quietly invalidate its own fixture.
 *
 * Each test names the wrong implementation it kills:
 *   1. "injected forgeRoot is genuinely used" — kills an implementation that
 *      still reads the module-level `FORGE_ROOT` constant instead of
 *      `opts.forgeRoot` (a temp root has ZERO app types; the real FORGE_ROOT
 *      has three — a leak through the module constant flips this assertion).
 *   2. "missing required flags" — kills an implementation that kept the
 *      inline `process.exit(2)` (the process would be dead, so the second
 *      call and the trailing assertion could never run) or that dropped the
 *      exit-code contract.
 *   3. "unknown app-type" — kills an implementation that lets
 *      `scaffoldGreenfieldProject`'s thrown error escape uncaught, or that
 *      loses the original error message.
 *   4/5. "hard-green" / "not-hard-green" — together they kill an
 *      implementation that hardcodes either branch of the original
 *      `out.hardGreen ? 0 : 1` ternary.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCreate } from './cli.ts';

const REAL_TYPESCRIPT_CLI_TEMPLATE = resolve(
  import.meta.dirname,
  '..',
  '..',
  'studio',
  'starters',
  'projects',
  'cli',
);

/** A fresh root somewhere the real FORGE_ROOT (this checkout) could never be:
 *  a random dir under the OS temp root, unrelated to this repo entirely. */
function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), 'forge-create-test-'));
}

test('runCreate: injected forgeRoot is genuinely used, not the module FORGE_ROOT', () => {
  const root = freshRoot();
  try {
    // No studio/starters/projects/ under this root at all.
    const result = runCreate(['list'], { forgeRoot: root });
    assert.equal(result.ok, true);
    assert.equal(result.kind, 'list');
    // The real FORGE_ROOT ships api/cli/webapp.
    // If the implementation ignored opts.forgeRoot and fell back to the
    // module constant, this list would come back non-empty.
    assert.deepEqual(result.appTypes, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runCreate: missing required flags -> exit-2 failure result, process stays alive', () => {
  const root = freshRoot();
  let result;
  try {
    result = runCreate(['--name', 'only-a-name'], { forgeRoot: root });
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'invalid-args');
    assert.equal(result.exitCode, 2);

    // Proof the test process is genuinely still alive: a SECOND call after
    // the "would have exited" branch still returns a normal result, and a
    // plain assertion below still runs. A `process.exit(2)` still present in
    // this path would have killed the whole test file before either ran.
    const again = runCreate(['list'], { forgeRoot: root });
    assert.equal(again.ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.equal(result?.exitCode, 2);
});

test('runCreate: unknown app-type -> caught scaffold error, exit 1, process stays alive', () => {
  const root = freshRoot();
  let result;
  try {
    result = runCreate(
      ['--name', 'x', '--app-type', 'not-a-real-type', '--north-star', 'n'],
      { forgeRoot: root },
    );
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'error');
    assert.equal(result.exitCode, 1);
    assert.match(result.message, /unknown appType/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  // Still alive afterwards.
  assert.equal(typeof process.pid, 'number');
});

test('runCreate: hard-green scaffold against a temp root -> scaffolded result, exit 0', () => {
  const root = freshRoot();
  try {
    cpSync(
      REAL_TYPESCRIPT_CLI_TEMPLATE,
      join(root, 'studio', 'starters', 'projects', 'cli'),
      { recursive: true },
    );
    const result = runCreate(
      ['--name', 'probe project', '--app-type', 'cli', '--north-star', 'a probe project for testing'],
      { forgeRoot: root },
    );
    assert.equal(result.ok, true);
    assert.equal(result.kind, 'scaffolded');
    assert.equal(result.out.hardGreen, true);
    assert.equal(result.out.failingClauses.length, 0);
    assert.equal(result.exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runCreate: not-hard-green scaffold against a temp root -> scaffolded result, exit 1', () => {
  const root = freshRoot();
  try {
    // A template with a single trivial file — enough to scaffold, nowhere
    // near enough to satisfy the hard preflight clauses (no AGENTS.md, no
    // .gitignore, no package.json / test command, no roadmap.md).
    const tplDir = join(root, 'studio', 'starters', 'projects', 'bare-minimum');
    mkdirSync(tplDir, { recursive: true });
    writeFileSync(join(tplDir, 'README.md'), '# {{TITLE}}\n\n{{NORTH_STAR}}\n', 'utf8');

    const result = runCreate(
      ['--name', 'probe two', '--app-type', 'bare-minimum', '--north-star', 'a bare probe'],
      { forgeRoot: root },
    );
    assert.equal(result.ok, true);
    assert.equal(result.kind, 'scaffolded');
    assert.equal(result.out.hardGreen, false);
    assert.ok(result.out.failingClauses.length > 0);
    assert.equal(result.exitCode, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
