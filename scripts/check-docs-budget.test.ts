import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore -- plain .mjs module
import { countWords, pageType, CEILINGS, median, buildReport } from './check-docs-budget.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-docs-budget.mjs');

test('countWords strips frontmatter', () => {
  assert.equal(countWords('---\ntitle: Hello there\ntype: guide\n---\none two three'), 3);
});

test('countWords strips fenced code (backtick and tilde)', () => {
  assert.equal(countWords('a b\n```ts\nconst x = 1;\n```\nc'), 3);
  assert.equal(countWords('a b\n~~~\nfoo bar baz\n~~~\nc'), 3);
});

test('countWords strips indented code after a blank line', () => {
  assert.equal(countWords('a b\n\n    code line here\n\nc'), 3);
});

test('countWords strips table lines', () => {
  assert.equal(countWords('a\n| h1 | h2 |\n|----|----|\n| x | y |\nb'), 2);
});

test('countWords strips MDX import/export and tags but keeps inner text', () => {
  const md =
    "import { Card } from '@astrojs/starlight/components';\nexport const x = 1;\n<Card title=\"Hi there\">inner words</Card>\n<Br />\nend";
  assert.equal(countWords(md), 3);
});

test('countWords strips HTML comments', () => {
  assert.equal(countWords('a <!-- hidden words here --> b'), 2);
  assert.equal(countWords('a\n<!--\nmulti line\n-->\nb'), 2);
});

test('countWords keeps link text, drops URL', () => {
  assert.equal(countWords('see [the docs page](https://example.com/a/b) now'), 5);
});

test('countWords drops images entirely', () => {
  assert.equal(countWords('a ![alt text here](img.png) b'), 2);
});

test('countWords: markers are not words, inline code is one word', () => {
  assert.equal(countWords('# Title here\n- item one\n1. item two\n**bold** and *it* `a b c`'), 10);
});

test('countWords: punctuation-only tokens are not words', () => {
  assert.equal(countWords('a - b — c ... d'), 4);
  assert.equal(countWords(''), 0);
});

test('pageType: frontmatter wins', () => {
  assert.equal(pageType('docs/how-to/x.md', { type: 'reference' }), 'reference');
  assert.equal(pageType('docs/how-to/x.md', { type: 'bogus' }), 'how-to');
});

test('pageType: path rules', () => {
  const cases: Array<[string, string]> = [
    ['docs/how-to/a.md', 'how-to'],
    ['docs/tutorials/a.md', 'tutorial'],
    ['docs/reference/a.md', 'reference'],
    ['docs/explanation/a.md', 'explanation'],
    ['docs/guides/a.md', 'guide'],
    ['apps/docs/src/content/docs/index.mdx', 'landing'],
    ['apps/docs/src/content/docs/index.md', 'landing'],
    ['apps/docs/src/content/docs/guides/how-to/a.mdx', 'how-to'],
    ['apps/docs/src/content/docs/guides/a.mdx', 'guide'],
    ['apps/docs/src/content/docs/reference/a.mdx', 'reference'],
    ['docs/misc.md', 'other'],
  ];
  for (const [p, t] of cases) assert.equal(pageType(p, {}), t, p);
});

test('CEILINGS is frozen with the R22 values', () => {
  assert.ok(Object.isFrozen(CEILINGS));
  assert.deepEqual(
    { ...CEILINGS },
    { guide: 1000, 'how-to': 800, tutorial: 800, reference: 2000, explanation: 2000, landing: 600 },
  );
});

test('median', () => {
  assert.equal(median([]), 0);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('buildReport classifies pct thresholds', () => {
  const r = buildReport([
    { path: 'a', type: 'guide', words: 700 },
    { path: 'b', type: 'guide', words: 701 },
    { path: 'c', type: 'guide', words: 1001 },
    { path: 'd', type: 'other', words: 5000 },
  ]);
  assert.deepEqual(r.over70.map((x: any) => x.path), ['b', 'c']);
  assert.deepEqual(r.over100.map((x: any) => x.path), ['c']);
  assert.equal(r.rows[0].pct, 70);
  assert.equal(r.rows[3].pct, null);
  assert.equal(r.rows[3].ceiling, null);
  assert.equal(r.byType.guide.count, 3);
  assert.equal(r.byType.guide.median, 701);
  assert.equal(r.overall.count, 4);
  assert.equal(r.overall.median, 851);
});

function makeRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'docs-budget-'));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  return root;
}
const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('CLI --report lists pages and summary, exits 0', () => {
  const root = makeRoot({
    'docs/how-to/a.md': 'one two three',
    'docs/reference/b.md': 'four five',
    'docs/misc.md': 'six',
  });
  try {
    const r = run('--report', '--root', root);
    assert.equal(r.status, 0, r.stderr);
    for (const p of ['docs/how-to/a.md', 'docs/reference/b.md', 'docs/misc.md']) {
      assert.ok(r.stdout.includes(p), p);
    }
    assert.ok(r.stdout.includes('== summary =='));
    assert.ok(r.stdout.includes('above 70% of ceiling:'));
    assert.ok(r.stdout.includes('above ceiling:'));
    assert.ok(r.stdout.includes('(none)'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI exits 0 even when a page is over its ceiling', () => {
  const root = makeRoot({ 'docs/how-to/big.md': Array(900).fill('word').join(' ') });
  try {
    const r = run('--report', '--root', root);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /above ceiling:\n.*docs\/how-to\/big\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI unknown flag or missing --report exits 2', () => {
  assert.equal(run('--bogus').status, 2);
  assert.equal(run().status, 2);
});
