/**
 * Pins for the ONE lenient theme-frontmatter parser (W7 FIX-B-KB).
 *
 * The load-bearing pin: the regex fallback (taken when gray-matter throws,
 * e.g. an unquoted `:` inside a description value) must decode inline
 * `[a, b]` flow lists into REAL arrays — `keywords` and `related_themes`
 * are exactly this shape. The first cut stored them as raw strings, so
 * `danglingEdgeFindings`' `Array.isArray(related)` tolerance clause
 * silently skipped every dangling edge on any theme that needed the
 * fallback — a declared-data-fails-open hole the kb-drain journey beat hit
 * as a false instant "green" (zero findings for a deliberately-seeded
 * agent-tier fixture).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseThemeRaw } from './theme-frontmatter.ts';

const INVALID_YAML_THEME = [
  '---',
  'title: Fallback list fixture',
  // The unquoted `: ` makes gray-matter throw -> regex fallback path.
  'description: A fixture: unquoted colon forces the lenient fallback',
  'category: pattern',
  'keywords: [e2e-journey, scratch-kb, kb-drain]',
  'related_themes: [journey-scratch-nonexistent-theme]',
  'created_at: 2026-01-01T00:00:00Z',
  'updated_at: 2026-01-01T00:00:00Z',
  '---',
  '',
  '# body',
  '',
].join('\n');

test('parseThemeRaw fallback: inline [a, b] flow lists decode to real string arrays — a related_themes left as a raw string means every dangling-edge check silently skips it (W7 FIX-B-KB false-green drain)', () => {
  const { data } = parseThemeRaw(INVALID_YAML_THEME);
  // Sanity: this content really took the fallback (gray-matter would have thrown).
  assert.equal(data.title, 'Fallback list fixture');
  assert.deepEqual(
    data.related_themes,
    ['journey-scratch-nonexistent-theme'],
    `related_themes must be a real array through the fallback, got ${JSON.stringify(data.related_themes)}`,
  );
  assert.deepEqual(
    data.keywords,
    ['e2e-journey', 'scratch-kb', 'kb-drain'],
    `keywords must be a real array through the fallback, got ${JSON.stringify(data.keywords)}`,
  );
});

test('parseThemeRaw fallback: empty [] decodes to an empty array, quoted entries are unquoted, and non-list scalars stay strings', () => {
  const { data } = parseThemeRaw([
    '---',
    'title: Edge shapes: colon forces fallback',
    "related_themes: ['quoted-slug', \"double-quoted\", bare ]",
    'keywords: []',
    'category: pattern',
    '---',
    '',
  ].join('\n'));
  assert.deepEqual(data.related_themes, ['quoted-slug', 'double-quoted', 'bare']);
  assert.deepEqual(data.keywords, []);
  assert.equal(data.category, 'pattern', 'plain scalars must stay strings');
});

test('parseThemeRaw: VALID yaml still routes through gray-matter untouched (arrays already real, colon-free)', () => {
  const { data, content } = parseThemeRaw([
    '---',
    'title: Valid fixture',
    'description: no colon here',
    'related_themes: [a-slug]',
    '---',
    '',
    'body text',
    '',
  ].join('\n'));
  assert.deepEqual(data.related_themes, ['a-slug']);
  assert.equal(data.description, 'no colon here');
  assert.match(content, /body text/);
});
