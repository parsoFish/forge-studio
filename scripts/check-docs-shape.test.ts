/**
 * check-docs-shape ratchet — proof the gate BITES.
 *
 * Two rules: (A) site how-tos name their story, and no docs/ page carries
 * `generated_from:`; (B) no internal ledger from dev/ appears on the site.
 * The checker runs as a subprocess (the CI path) against fabricated trees in
 * mkdtempSync roots, plus the real repo for its PASS line.
 *
 * RUN: node --test --experimental-strip-types scripts/check-docs-shape.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts/check-docs-shape.mjs');

function run(root: string): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('node', [CHECKER, root], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const SITE = 'apps/docs/src/content/docs';
const HOWTO = `${SITE}/guides/how-to`;

/** A generated how-to page, with the header `npm run stories` writes. */
function generated(id: string): string {
  return `---\ntitle: ${id}\ntype: how-to\ngenerated_from: tests/stories/${id}.story.mjs\n---\n\nStep.\n`;
}

/** Writes `files` and the story files for `storyIds` under a fresh temp root. */
function fixture(files: Record<string, string>, storyIds: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'docs-shape-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  }
  for (const id of storyIds) {
    const abs = join(root, `tests/stories/${id}.story.mjs`);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `export const story = { id: '${id}' };\n`, 'utf8');
  }
  return root;
}

function check(files: Record<string, string>, storyIds: string[] = []): { code: number; out: string } {
  const root = fixture(files, storyIds);
  const result = run(root);
  rmSync(root, { recursive: true, force: true });
  return result;
}

test('rule A: a site how-to without a generated_from header FAILS', () => {
  const { code, out } = check({ [`${HOWTO}/onboard.md`]: '---\ntitle: Onboard\ntype: how-to\n---\n\nStep.\n' }, ['S1']);
  assert.equal(code, 1, out);
  assert.match(out, /guides\/how-to\/onboard\.md/);
  assert.match(out, /generated_from/);
});

test('rule A: a site how-to whose generated_from names no story FAILS', () => {
  const { code, out } = check({ [`${HOWTO}/onboard.md`]: generated('S9') }, ['S1']);
  assert.equal(code, 1, out);
  assert.match(out, /tests\/stories\/S9\.story\.mjs/);
});

test('rule A: a docs/ page carrying generated_from FAILS', () => {
  const { code, out } = check({ 'docs/how-to/S3.md': generated('S3') }, ['S3']);
  assert.equal(code, 1, out);
  assert.match(out, /docs\/how-to\/S3\.md/);
  assert.match(out, /apps\/docs/);
});

test('rule A: how-tos naming existing stories PASS and are counted', () => {
  const { code, out } = check({ [`${HOWTO}/a.md`]: generated('S1'), [`${HOWTO}/b.md`]: generated('S3') }, ['S1', 'S3']);
  assert.equal(code, 0, out);
  assert.match(out, /PASS — 2 generated how-tos name their story, 0 dev\/ ledgers absent from the site/);
});

test('rule B: a dev/ ledger republished on the site under the same basename FAILS, naming it', () => {
  const { code, out } = check({ 'dev/foo.md': '# Ledger\n', [`${SITE}/reference/foo.md`]: '# Foo\n' });
  assert.equal(code, 1, out);
  assert.match(out, /internal ledger foo\.md belongs in dev\/, never on the published site/);
});

test('rule B: a site page whose generated_from points into dev/ FAILS', () => {
  const { code, out } = check({ [`${SITE}/reference/sinks.md`]: '---\ntitle: Sinks\ngenerated_from: dev/sinks.md\n---\n\nx\n' });
  assert.equal(code, 1, out);
  assert.match(out, /reference\/sinks\.md/);
  assert.match(out, /dev\//);
});

test('rule B: dev/ ledgers with no site twin PASS and are counted', () => {
  const { code, out } = check({ 'dev/foo.md': '# Ledger\n', 'dev/bar.md': '# Ledger\n', [`${SITE}/reference/other.md`]: '# Other\n' });
  assert.equal(code, 0, out);
  assert.match(out, /0 generated how-tos name their story, 2 dev\/ ledgers absent from the site/);
});

test('rule B: no dev/ directory means nothing to check, not an error', () => {
  const { code, out } = check({ [`${SITE}/reference/foo.md`]: '# Foo\n' });
  assert.equal(code, 0, out);
  assert.match(out, /0 dev\/ ledgers absent/);
});

test('the real repo passes and the checker ran', () => {
  const { code, out } = run(ROOT);
  assert.equal(code, 0, out);
  assert.match(out, /check-docs-shape: PASS — \d+ generated how-tos name their story, \d+ dev\/ ledgers absent from the site/);
});
