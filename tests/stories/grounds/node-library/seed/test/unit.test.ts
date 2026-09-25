/**
 * Unit suite — the project's quality gate (contract C1).
 *
 * Fast, deterministic, creds-free, < 1 s. Genuinely discriminating: each test
 * pins a behaviour the implementation must satisfy, so the suite fails before
 * the work exists and passes only when it is correct. Run: `npm test`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractHeadings } from '../src/headings.ts';
import { slugBase, createSlugger } from '../src/anchor.ts';
import { renderToc } from '../src/toc.ts';
import { runCli } from '../src/cli.ts';

// --- headings ---

test('extractHeadings finds ATX headings with their levels', () => {
  const md = '# One\n\n## Two\n\ntext\n\n### Three';
  const hs = extractHeadings(md);
  assert.equal(hs.length, 3);
  assert.deepEqual(
    hs.map((h) => [h.level, h.text]),
    [
      [1, 'One'],
      [2, 'Two'],
      [3, 'Three'],
    ],
  );
});

test('extractHeadings ignores headings inside fenced code blocks', () => {
  const md = '# Real\n\n```\n# Not a heading\n```\n\n## AlsoReal';
  const hs = extractHeadings(md);
  assert.deepEqual(
    hs.map((h) => h.text),
    ['Real', 'AlsoReal'],
  );
});

test('extractHeadings strips trailing closing hashes', () => {
  const hs = extractHeadings('## Title ##');
  assert.equal(hs[0].text, 'Title');
});

test('extractHeadings rejects a non-string input', () => {
  assert.throws(() => extractHeadings(42 as unknown as string), TypeError);
});

// --- anchor ---

test('slugBase lowercases, strips punctuation, and hyphenates spaces', () => {
  assert.equal(slugBase('Hello, World!'), 'hello-world');
  assert.equal(slugBase('  Spaced   Out  '), 'spaced-out');
  assert.equal(slugBase('API & SDK (v2)'), 'api-sdk-v2');
});

test('createSlugger disambiguates duplicate slugs with a numeric suffix', () => {
  const slug = createSlugger();
  assert.equal(slug('Setup'), 'setup');
  assert.equal(slug('Setup'), 'setup-1');
  assert.equal(slug('Setup'), 'setup-2');
});

// --- toc ---

test('renderToc nests by relative heading depth', () => {
  const md = '# Top\n\n## Child\n\n### Grandchild\n\n## Sibling';
  assert.equal(
    renderToc(md),
    [
      '- [Top](#top)',
      '  - [Child](#child)',
      '    - [Grandchild](#grandchild)',
      '  - [Sibling](#sibling)',
    ].join('\n'),
  );
});

test('renderToc honours the min/max level window', () => {
  const md = '# Doc\n\n## Keep\n\n### Drop';
  assert.equal(renderToc(md, { minLevel: 2, maxLevel: 2 }), '- [Keep](#keep)');
});

test('renderToc re-bases indentation to the shallowest kept heading', () => {
  const md = '# Doc\n\n## A\n\n## B';
  // With H1 filtered out, A and B become the base level (no indent).
  assert.equal(renderToc(md, { minLevel: 2 }), '- [A](#a)\n- [B](#b)');
});

test('renderToc returns empty string when no heading survives the filter', () => {
  assert.equal(renderToc('# Only H1', { minLevel: 3 }), '');
});

test('renderToc rejects an inverted level window', () => {
  assert.throws(() => renderToc('# x', { minLevel: 4, maxLevel: 2 }), RangeError);
});

// --- cli ---

const stubIo = (files: Record<string, string>) => ({
  readStdin: () => files['<stdin>'] ?? '',
  readFile: (path: string) => {
    if (!(path in files)) throw new Error(`ENOENT: ${path}`);
    return files[path];
  },
});

test('runCli renders the TOC of a file to stdout', () => {
  const r = runCli(['doc.md'], stubIo({ 'doc.md': '# Title\n\n## Section' }));
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '- [Title](#title)\n  - [Section](#section)');
});

test('runCli applies --min/--max flags', () => {
  const r = runCli(['--min', '2', '--max', '2', 'doc.md'], stubIo({ 'doc.md': '# A\n## B\n### C' }));
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '- [B](#b)');
});

test('runCli reports a non-integer flag value with exit 2', () => {
  const r = runCli(['--min', 'x', 'doc.md'], stubIo({ 'doc.md': '# A' }));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /requires an integer/);
});

test('runCli reports an unreadable file with exit 1', () => {
  const r = runCli(['missing.md'], stubIo({}));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /cannot read input/);
});

test('runCli rejects an unknown option', () => {
  const r = runCli(['--frobnicate', 'doc.md'], stubIo({ 'doc.md': '# A' }));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown option/);
});
