import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  globToRegExp,
  loadProjectConstraintBlocks,
  parseConstraintBlocks,
  selectorMatches,
  type ConstraintMatchContext,
} from './constraint-blocks.ts';

// ---------- parseConstraintBlocks: happy path ----------

test('parseConstraintBlocks: "all" selector, single block, id captured', () => {
  const source = [
    '# heading',
    '<!-- forge:constraint id: standing-x applies_to: all -->',
    'Every WI must do X.',
    '<!-- /forge:constraint -->',
    'trailer',
  ].join('\n');
  const blocks = parseConstraintBlocks(source, 'profile.md');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.id, 'standing-x');
  assert.deepEqual(blocks[0]!.selector, { kind: 'all' });
  assert.equal(blocks[0]!.content, 'Every WI must do X.');
  assert.equal(blocks[0]!.sourceFile, 'profile.md');
  assert.equal(blocks[0]!.startLine, 2);
});

test('parseConstraintBlocks: single wi.<field>=<glob> term', () => {
  const source = [
    '<!-- forge:constraint id: dereg-checklist applies_to: wi.kind=framework-migrate -->',
    'Deregister from SDKv2.',
    '<!-- /forge:constraint -->',
  ].join('\n');
  const blocks = parseConstraintBlocks(source, 'profile.md');
  assert.equal(blocks[0]!.id, 'dereg-checklist');
  assert.deepEqual(blocks[0]!.selector, {
    kind: 'and',
    terms: [{ namespace: 'wi', field: 'kind', glob: 'framework-migrate' }],
  });
});

test('parseConstraintBlocks: comma-separated AND terms across wi. and manifest.', () => {
  const source = [
    '<!-- forge:constraint id: and-terms applies_to: wi.status=pending,manifest.project=terraform-provider-* -->',
    'clause body',
    '<!-- /forge:constraint -->',
  ].join('\n');
  const blocks = parseConstraintBlocks(source, 'profile.md');
  assert.deepEqual(blocks[0]!.selector, {
    kind: 'and',
    terms: [
      { namespace: 'wi', field: 'status', glob: 'pending' },
      { namespace: 'manifest', field: 'project', glob: 'terraform-provider-*' },
    ],
  });
});

test('parseConstraintBlocks: multiple blocks in one source, content preserved verbatim', () => {
  const source = [
    '<!-- forge:constraint id: first applies_to: all -->',
    '- item one',
    '- item two',
    '',
    'a blank line above is preserved',
    '<!-- /forge:constraint -->',
    'some prose in between',
    '<!-- forge:constraint id: second applies_to: wi.status=complete -->',
    'second clause',
    '<!-- /forge:constraint -->',
  ].join('\n');
  const blocks = parseConstraintBlocks(source, 'themes/a.md');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]!.content, '- item one\n- item two\n\na blank line above is preserved');
  assert.equal(blocks[1]!.id, 'second');
  assert.equal(blocks[1]!.content, 'second clause');
  assert.equal(blocks[1]!.startLine, 8);
});

test('parseConstraintBlocks: no blocks present → empty array', () => {
  assert.deepEqual(parseConstraintBlocks('# just a heading\n\nsome prose\n', 'profile.md'), []);
});

test('parseConstraintBlocks: CRLF-authored source parses identically (\\r\\n and bare \\r normalized)', () => {
  const crlf = [
    '# heading',
    '<!-- forge:constraint id: crlf-block applies_to: wi.status=pending -->',
    'line one',
    'line two',
    '<!-- /forge:constraint -->',
  ].join('\r\n');
  const blocks = parseConstraintBlocks(crlf, 'profile.md');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.id, 'crlf-block');
  assert.equal(blocks[0]!.content, 'line one\nline two'); // no \r survives into content
  assert.ok(!blocks[0]!.content.includes('\r'));

  // Bare-\r (classic-Mac) line endings normalize too.
  const bareCr = crlf.replace(/\r\n/g, '\r');
  const crBlocks = parseConstraintBlocks(bareCr, 'profile.md');
  assert.equal(crBlocks.length, 1);
  assert.equal(crBlocks[0]!.content, 'line one\nline two');
});

// ---------- parseConstraintBlocks: malformed / loud errors ----------

test('parseConstraintBlocks: missing mandatory id attribute → throws with file+line', () => {
  const source = [
    '<!-- forge:constraint applies_to: all -->',
    'body',
    '<!-- /forge:constraint -->',
  ].join('\n');
  assert.throws(() => parseConstraintBlocks(source, 'profile.md'), /profile\.md:1:.*missing mandatory id/);
});

test('parseConstraintBlocks: bare tag with neither id nor applies_to → missing-id error first', () => {
  const source = ['<!-- forge:constraint -->', 'body', '<!-- /forge:constraint -->'].join('\n');
  assert.throws(() => parseConstraintBlocks(source, 'profile.md'), /missing mandatory id/);
});

test('parseConstraintBlocks: invalid id charset (spaces) → malformed opening tag error', () => {
  const source = [
    '<!-- forge:constraint id: has spaces applies_to: all -->',
    'body',
    '<!-- /forge:constraint -->',
  ].join('\n');
  assert.throws(() => parseConstraintBlocks(source, 'profile.md'), /profile\.md:1:.*malformed/);
});

test('parseConstraintBlocks: duplicate id within one source → throws naming the id and both lines', () => {
  const source = [
    '<!-- forge:constraint id: dupe applies_to: all -->',
    'first',
    '<!-- /forge:constraint -->',
    '<!-- forge:constraint id: dupe applies_to: wi.status=pending -->',
    'second',
    '<!-- /forge:constraint -->',
  ].join('\n');
  assert.throws(
    () => parseConstraintBlocks(source, 'profile.md'),
    /profile\.md:4:.*duplicate constraint id "dupe".*line 1/,
  );
});

test('parseConstraintBlocks: id present but applies_to missing → malformed opening tag error', () => {
  const source = ['<!-- forge:constraint id: x -->', 'body', '<!-- /forge:constraint -->'].join('\n');
  assert.throws(() => parseConstraintBlocks(source, 'profile.md'), /profile\.md:1:.*malformed/);
});

test('parseConstraintBlocks: empty applies_to value → throws', () => {
  const source = ['<!-- forge:constraint id: x applies_to: -->', 'body', '<!-- /forge:constraint -->'].join('\n');
  assert.throws(() => parseConstraintBlocks(source, 'profile.md'), /malformed|empty applies_to/);
});

test('parseConstraintBlocks: malformed term (no "=") → throws', () => {
  const source = [
    '<!-- forge:constraint id: x applies_to: wi.kind -->',
    'body',
    '<!-- /forge:constraint -->',
  ].join('\n');
  assert.throws(() => parseConstraintBlocks(source, 'profile.md'), /malformed applies_to term/);
});

test('parseConstraintBlocks: unknown namespace → throws', () => {
  const source = [
    '<!-- forge:constraint id: x applies_to: project.kind=foo -->',
    'body',
    '<!-- /forge:constraint -->',
  ].join('\n');
  assert.throws(() => parseConstraintBlocks(source, 'profile.md'), /unknown applies_to namespace/);
});

test('parseConstraintBlocks: unterminated block → throws naming the opening line', () => {
  const source = ['<!-- forge:constraint id: x applies_to: all -->', 'body with no closer'].join('\n');
  assert.throws(() => parseConstraintBlocks(source, 'themes/x.md'), /themes\/x\.md:1:.*unterminated/);
});

test('parseConstraintBlocks: nested open before close → throws', () => {
  const source = [
    '<!-- forge:constraint id: outer applies_to: all -->',
    'outer body',
    '<!-- forge:constraint id: inner applies_to: wi.status=pending -->',
    'inner body',
    '<!-- /forge:constraint -->',
    '<!-- /forge:constraint -->',
  ].join('\n');
  assert.throws(() => parseConstraintBlocks(source, 'profile.md'), /nested forge:constraint/);
});

test('parseConstraintBlocks: stray close tag with no open → throws', () => {
  const source = ['prose', '<!-- /forge:constraint -->'].join('\n');
  assert.throws(() => parseConstraintBlocks(source, 'profile.md'), /stray forge:constraint close tag/);
});

// ---------- globToRegExp / selectorMatches ----------

test('globToRegExp: "*" matches any substring at that position, literal chars are anchored', () => {
  assert.ok(globToRegExp('framework-migrate*').test('framework-migrate-azuredevops'));
  assert.ok(globToRegExp('framework-migrate*').test('framework-migrate'));
  assert.ok(!globToRegExp('framework-migrate*').test('other-framework-migrate'));
  assert.ok(globToRegExp('*-betterado').test('terraform-provider-betterado'));
  assert.ok(globToRegExp('*').test('anything at all'));
  assert.ok(!globToRegExp('exact').test('exactly'));
});

test('selectorMatches: "all" always matches regardless of context', () => {
  const ctx: ConstraintMatchContext = { wi: {}, manifest: {} };
  assert.equal(selectorMatches({ kind: 'all' }, ctx), true);
});

test('selectorMatches: AND semantics — every term must match', () => {
  const selector = {
    kind: 'and' as const,
    terms: [
      { namespace: 'wi' as const, field: 'status', glob: 'pending' },
      { namespace: 'manifest' as const, field: 'project', glob: 'terraform-provider-*' },
    ],
  };
  const matchingCtx: ConstraintMatchContext = {
    wi: { status: 'pending' },
    manifest: { project: 'terraform-provider-betterado' },
  };
  assert.equal(selectorMatches(selector, matchingCtx), true);

  const partialCtx: ConstraintMatchContext = {
    wi: { status: 'complete' }, // fails this term
    manifest: { project: 'terraform-provider-betterado' },
  };
  assert.equal(selectorMatches(selector, partialCtx), false);
});

test('selectorMatches: missing field on the context object never matches', () => {
  const selector = { kind: 'and' as const, terms: [{ namespace: 'wi' as const, field: 'kind', glob: '*' }] };
  assert.equal(selectorMatches(selector, { wi: {}, manifest: {} }), false);
});

test('selectorMatches: array field values match if ANY element matches the glob', () => {
  const selector = {
    kind: 'and' as const,
    terms: [{ namespace: 'wi' as const, field: 'files_in_scope', glob: '*.go' }],
  };
  const ctx: ConstraintMatchContext = {
    wi: { files_in_scope: ['README.md', 'internal/client.go'] },
    manifest: {},
  };
  assert.equal(selectorMatches(selector, ctx), true);
});

// ---------- loadProjectConstraintBlocks ----------

test('loadProjectConstraintBlocks: missing profile.md and themes dir → empty, no throw', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-constraint-blocks-'));
  try {
    assert.deepEqual(loadProjectConstraintBlocks(forgeRoot, 'nonexistent-project'), []);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('loadProjectConstraintBlocks: reads profile.md + every themes/*.md file, sorted, and concatenates blocks', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-constraint-blocks-'));
  try {
    const projectDir = join(forgeRoot, 'brain', 'projects', 'demo');
    const themesDir = join(projectDir, 'themes');
    mkdirSync(themesDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'profile.md'),
      ['<!-- forge:constraint id: from-profile applies_to: all -->', 'from profile', '<!-- /forge:constraint -->'].join(
        '\n',
      ),
    );
    writeFileSync(
      join(themesDir, 'b-second.md'),
      ['<!-- forge:constraint id: from-b applies_to: all -->', 'from b', '<!-- /forge:constraint -->'].join('\n'),
    );
    writeFileSync(
      join(themesDir, 'a-first.md'),
      ['<!-- forge:constraint id: from-a applies_to: all -->', 'from a', '<!-- /forge:constraint -->'].join('\n'),
    );
    // Non-markdown file in the themes dir must be ignored, not read.
    writeFileSync(join(themesDir, 'notes.txt'), '<!-- forge:constraint id: broken applies_to: -->broken');

    const blocks = loadProjectConstraintBlocks(forgeRoot, 'demo');
    assert.deepEqual(
      blocks.map((b) => b.content),
      ['from profile', 'from a', 'from b'],
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('loadProjectConstraintBlocks: duplicate id across two project sources → throws naming both files', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-constraint-blocks-'));
  try {
    const projectDir = join(forgeRoot, 'brain', 'projects', 'demo');
    const themesDir = join(projectDir, 'themes');
    mkdirSync(themesDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'profile.md'),
      ['<!-- forge:constraint id: shared-id applies_to: all -->', 'from profile', '<!-- /forge:constraint -->'].join(
        '\n',
      ),
    );
    writeFileSync(
      join(themesDir, 'theme.md'),
      ['<!-- forge:constraint id: shared-id applies_to: all -->', 'from theme', '<!-- /forge:constraint -->'].join('\n'),
    );
    assert.throws(
      () => loadProjectConstraintBlocks(forgeRoot, 'demo'),
      (err: unknown) =>
        err instanceof Error &&
        /duplicate constraint id "shared-id"/.test(err.message) &&
        /profile\.md/.test(err.message) &&
        /theme\.md/.test(err.message),
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('loadProjectConstraintBlocks: a malformed block inside an existing source throws, naming that file', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-constraint-blocks-'));
  try {
    const projectDir = join(forgeRoot, 'brain', 'projects', 'demo');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'profile.md'),
      '<!-- forge:constraint id: x applies_to: -->\nbody\n<!-- /forge:constraint -->',
    );
    assert.throws(() => loadProjectConstraintBlocks(forgeRoot, 'demo'), /profile\.md/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
