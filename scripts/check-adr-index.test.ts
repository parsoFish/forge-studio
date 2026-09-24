/**
 * check-adr-index ratchet — proof the gate BITES on a dangling href.
 *
 * forge-ui7b: check-adr-index.mjs's "every Active row links to a file that
 * exists on disk" check (its own header docstring) actually validates the
 * row's link by NUMBER only (fileMatch[1] === number, onDiskNumbers.has(...))
 * and never resolves the literal href to a file. A row can point at a
 * nonexistent filename while the real, correctly-numbered ADR file stays on
 * disk, and the gate stays green.
 *
 * The checker resolves its own repo root from `import.meta.url`'s directory
 * (no argv), so each fixture COPIES the real script one level under a scratch
 * root (`<root>/scripts/check-adr-index.mjs`) with a `docs/decisions/` tree
 * beside it — the same shape the bead's own repro uses.
 *
 * RUN: node --test --experimental-strip-types scripts/check-adr-index.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REAL_CHECKER = join(ROOT, 'scripts/check-adr-index.mjs');

/** A scratch `<root>/scripts/check-adr-index.mjs` + `<root>/docs/decisions/`
 *  tree. `adrs` maps `NNN-slug.md` to its body; `readme` is the full
 *  docs/decisions/README.md text. */
function fixture(readme: string, adrs: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'adr-index-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'docs/decisions'), { recursive: true });
  copyFileSync(REAL_CHECKER, join(root, 'scripts/check-adr-index.mjs'));
  writeFileSync(join(root, 'docs/decisions/README.md'), readme, 'utf8');
  for (const [name, body] of Object.entries(adrs)) {
    writeFileSync(join(root, 'docs/decisions', name), body, 'utf8');
  }
  return root;
}

function run(root: string): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('node', [join(root, 'scripts/check-adr-index.mjs')], { encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const VALID_README = `# ADR Index

## Active

| ADR | Title | Role |
|---|---|---|
| [001](./001-foo.md) | Foo | ... |

## Retired

| ADR | Was | Where the surviving intent lives |
|---|---|---|

next free: **002**
`;

test('baseline: a correctly-linked Active row PASSES', () => {
  const root = fixture(VALID_README, { '001-foo.md': '# ADR 001\n\nFoo.\n' });
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 0, `a valid index must pass, got:\n${out}`);
});

test('an Active row whose href points at a NONEXISTENT filename FAILS, even though a same-numbered file exists on disk', () => {
  // The row links to "001-does-not-exist.md"; the real file on disk is
  // "001-foo.md" — same number, different filename. Number-only validation
  // (fileMatch[1] === '001', onDiskNumbers.has('001')) passes this; a real
  // existsSync(join(DECISIONS_DIR, file)) check must not.
  const danglingReadme = VALID_README.replace('(./001-foo.md)', '(./001-does-not-exist.md)');
  const root = fixture(danglingReadme, { '001-foo.md': '# ADR 001\n\nFoo.\n' });
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 1, `a dangling href must fail even when a same-numbered file exists, got:\n${out}`);
  assert.match(out, /001-does-not-exist\.md/, 'the violation must name the missing filename the row actually links to');
});

test('positive control: removing the on-disk file entirely still fails (unaffected by the fix)', () => {
  const root = fixture(VALID_README, {});
  const { code, out } = run(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(code, 1, `a missing file must still fail, got:\n${out}`);
});
