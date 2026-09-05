/**
 * `forge gate docs` — spec §5 item 6.
 *
 * WHICH WRONG IMPLEMENTATION EACH TEST KILLS is named per case. The two that
 * carry the design are the word-boundary case and the anchor/absolute-link case:
 * both are the shapes that make a checker earn an allowlist, and an allowlist is
 * where a rule goes to die.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { docsGateFindings, runDocsGate } from './docs-gate.ts';

test('sections: a missing required heading is a finding naming the section', () => {
  const found = docsGateFindings(
    [{ path: 'a.md', content: '# Title\n\n## Overview\n\ntext\n' }],
    { sections: ['Overview', 'Contract'], links: false },
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]!.check, 'sections');
  assert.match(found[0]!.detail, /"Contract" is missing/);
});

test('sections: matched on heading TEXT at any level, and case-insensitively — kills "## only"', () => {
  const found = docsGateFindings(
    [{ path: 'a.md', content: '### contract\n#### Deep\n' }],
    { sections: ['Contract', 'deep'], links: false },
  );
  assert.deepEqual(found, []);
});

test('forbidden: a hit carries path AND line — kills "report a count"', () => {
  const found = docsGateFindings(
    [{ path: 'a.md', content: 'fine\nthe unifier ran\n' }],
    { forbidden: ['unifier'], links: false },
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]!.line, 2, 'a finding without a line sends its reader hunting');
  assert.match(found[0]!.detail, /forbidden term "unifier"/);
});

test('forbidden: WORD BOUNDARIES — "zep" does not hit "zeppelin" (kills the substring form)', () => {
  // The substring form is how a token check earns its own suppression: someone
  // adds an allowlist entry for the false positive, and the allowlist is where
  // the rule goes to die.
  const found = docsGateFindings(
    [{ path: 'a.md', content: 'the zeppelin docked\nzep is retired\n' }],
    { forbidden: ['zep'], links: false },
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]!.line, 2);
});

test('forbidden: a term with regex metacharacters is matched literally — kills "interpolate the token into a RegExp"', () => {
  const found = docsGateFindings(
    [{ path: 'a.md', content: 'forge v2 is retired\nforge vX is not\n' }],
    { forbidden: ['forge v2'], links: false },
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]!.line, 1);
});

test('links: a relative target that does not resolve is a finding; one that does is not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-docs-gate-'));
  try {
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'sub', 'real.md'), '# real\n');
    writeFileSync(join(dir, 'a.md'), '[ok](sub/real.md)\n[bad](sub/ghost.md)\n');
    const found = runDocsGate([join(dir, 'a.md')], { links: true });
    assert.equal(found.length, 1);
    assert.equal(found[0]!.line, 2);
    assert.match(found[0]!.detail, /does not resolve: sub\/ghost\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('links: anchors, absolute paths and URLs are NOT checked on disk — kills "resolve every bracket"', () => {
  // Each of these would be a false positive, and a link check that cries wolf
  // is turned off by the first person it inconveniences.
  const found = docsGateFindings(
    [{ path: '/tmp/a.md', content: '[a](#section)\n[b](https://example.com/x)\n[c](mailto:x@y.z)\n[d](/etc/passwd)\n' }],
    { links: true },
  );
  assert.deepEqual(found, []);
});

test('links: a target with an anchor is resolved by its PATH half — kills "the anchor breaks the path"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-docs-gate-anchor-'));
  try {
    writeFileSync(join(dir, 'real.md'), '# real\n');
    writeFileSync(join(dir, 'a.md'), '[ok](real.md#a-heading)\n');
    assert.deepEqual(runDocsGate([join(dir, 'a.md')], { links: true }), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a clean doc under all three checks produces nothing', () => {
  const found = docsGateFindings(
    [{ path: '/tmp/a.md', content: '# T\n\n## Overview\n\nprose [x](#y)\n' }],
    { sections: ['Overview'], forbidden: ['unifier'], links: true },
  );
  assert.deepEqual(found, []);
});

test('an absent file is empty content, not a crash — the verb reports a missing doc as missing sections', () => {
  const found = runDocsGate(['/tmp/definitely-not-here-forge-docs-gate.md'], { sections: ['Overview'], links: false });
  assert.equal(found.length, 1);
  assert.equal(found[0]!.check, 'sections');
});
