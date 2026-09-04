/**
 * guard-stdout-flush.test.ts — a piped guard must deliver its WHOLE document.
 *
 * The defect this locks out, measured on `af3c8e6d`: every `scripts/check-*.mjs`
 * that ended in `process.exit(<call>)` tore its process down before an async
 * stdout pipe had drained. `check-raw-fs-guarded.mjs --json` emits ~313 KB, so a
 * reader piping it got a **truncated document ending in an unterminated string**
 * while the same command redirected to a file was complete. The cut point moves
 * with drain timing — 65,536 bytes (one pipe buffer) on the first measurement,
 * 145,840 when the fix was mutated back out to prove this test red — which is
 * why the assertion compares a piped run against a redirected one rather than
 * naming a byte count. `JSON.parse` then either
 * threw or — worse for a census — the reader hand-rolled a tolerant parse and
 * silently read a truncated document. Redirecting to a file hid it, which is why
 * it survived every lane that ever piped this guard.
 *
 * The siblings that were already correct (`check-boundaries`, `check-owner`,
 * `check-file-size`) all use `process.exitCode`; the fix makes the family
 * uniform rather than patching the one script whose output happened to be big
 * enough to cross the pipe buffer. The others were latent, not safe: a growing
 * violation list crosses 64 KiB on some future tree, and the failure mode is a
 * truncated report at exactly the moment a gate is red.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every guard in the family, GLOBBED — never a hand list (bead 5.34's lesson:
 *  a hand-written scope list is the next blind spot). */
function guardScripts(): string[] {
  return readdirSync(join(ROOT, 'scripts'))
    .filter((f) => f.startsWith('check-') && f.endsWith('.mjs'))
    .sort();
}

/** `process.exit(` as CODE — line comments and prose in backticks do not count. */
function codeExitCalls(src: string): string[] {
  return src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .filter((l) => /process\.exit\s*\(/.test(l.replace(/`[^`]*`/g, '')))
    .map((l) => l.trim());
}

test('the biggest guard document survives a PIPE, byte for byte (the repro)', () => {
  // RED against the unfixed code: the piped read stopped at 65,536 bytes with an
  // unterminated string, so both the equality and the parse below failed.
  const piped = execFileSync('node', ['scripts/check-raw-fs-guarded.mjs', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.ok(piped.length > 65_536, `the repro needs a document larger than the 64 KiB pipe buffer; got ${piped.length} bytes`);

  const parsed = JSON.parse(piped) as { suppressed: unknown[]; scanned: number };
  assert.ok(Array.isArray(parsed.suppressed) && parsed.suppressed.length > 0);

  // The row count is DERIVED from a second run whose stdout is a file, never
  // hardcoded — the invariant is "a pipe and a file agree", not a magic number.
  const dir = mkdtempSync(join(tmpdir(), 'flush-probe-'));
  try {
    const out = join(dir, 'rawfs.json');
    execFileSync('sh', ['-c', `node scripts/check-raw-fs-guarded.mjs --json > "${out}"`], { cwd: ROOT });
    const viaFile = readFileSync(out, 'utf8');
    assert.equal(piped.length, viaFile.length, 'a piped guard and a redirected guard must emit the same bytes');
    assert.equal(parsed.suppressed.length, (JSON.parse(viaFile) as { suppressed: unknown[] }).suppressed.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a FAILING guard still exits non-zero, and its report is not truncated', () => {
  // Kills the obvious wrong fix: dropping `process.exit()` for a bare
  // `process.exitCode` that is never assigned, which turns every red gate green.
  // Driven through a real breach (`--cap-override`), not a mocked return.
  let status = 0;
  let out = '';
  try {
    out = execFileSync('node', ['scripts/check-package-caps.mjs', '--cap-override', 'flows=1'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    status = e.status ?? 0;
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  assert.equal(status, 1, `a breached cap must exit 1; output was:\n${out}`);
  assert.match(out, /check-package-caps: FAIL/);
  assert.match(out, /flows/, 'the breached package is named in the report that survived the pipe');
});

test('no guard in the family terminates through process.exit() (the structural lock)', () => {
  // Derived from a glob, so a guard added tomorrow is covered with no edit here.
  const offenders = guardScripts()
    .map((f) => ({ file: f, calls: codeExitCalls(readFileSync(join(ROOT, 'scripts', f), 'utf8')) }))
    .filter((r) => r.calls.length > 0);
  assert.deepEqual(
    offenders,
    [],
    `these guards still call process.exit() in code — assign process.exitCode instead:\n${offenders
      .map((o) => `  ${o.file}: ${o.calls.join(' | ')}`)
      .join('\n')}`,
  );
});

test('the comment-stripping in the structural lock does not blind it', () => {
  // A control on the control: the filter above skips comment lines, so prove it
  // still SEES a real call, and prove the prose form does not trip it.
  assert.deepEqual(codeExitCalls('if (bad) process.exit(1);'), ['if (bad) process.exit(1);']);
  assert.deepEqual(codeExitCalls('// never `process.exit()` — it truncates'), []);
  assert.deepEqual(codeExitCalls(' * `process.exit()` tears the process down'), []);
});
