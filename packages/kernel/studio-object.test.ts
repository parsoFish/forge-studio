/**
 * The generic studio-object loader (M4-agents, §4 M4 "registry loaders split
 * from the registry module"; ruling 13).
 *
 * THE SEAM THIS PINS. Reading a frontmatter document is generic; deciding what
 * a valid one MEANS belongs to the kind. `orchestrator/studio/registry.ts`
 * fused the two — the file read, the gray-matter parse and every Agent field
 * name lived in one module, so the Flow kind and the Agent kind each carried a
 * private copy of the reading half. Kernel takes the reading half and NOTHING
 * else: the shape comes from a validator the caller passes in.
 *
 * The last test is the load-bearing one. A generic loader that quietly learns
 * one kind's vocabulary stops being generic, and nothing about the code would
 * look wrong at the time — so the invariant is asserted against the module's
 * own source, not left to review.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadStudioObject, readFrontmatter, type FrontmatterDoc } from './studio-object.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'kernel-studio-object-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A kind kernel has never heard of — the point being that it needs to know nothing. */
type Widget = { id: string; spokes: number; body: string };

function validateWidget(doc: FrontmatterDoc): Widget {
  const id = doc.data['id'];
  const spokes = doc.data['spokes'];
  if (typeof id !== 'string') throw new Error(`${doc.path}: "id" must be a string`);
  if (typeof spokes !== 'number') throw new Error(`${doc.path}: "spokes" must be a number`);
  return { id, spokes, body: doc.content.trim() };
}

test('readFrontmatter returns the parsed data, the body and the path', () =>
  withTmp((dir) => {
    const path = join(dir, 'WIDGET.md');
    writeFileSync(path, '---\nid: cog\nspokes: 8\n---\n\nA cog.\n');
    const doc = readFrontmatter(path);
    assert.ok(doc);
    assert.deepEqual(doc!.data, { id: 'cog', spokes: 8 });
    assert.equal(doc!.content.trim(), 'A cog.');
    assert.equal(doc!.path, path);
  }));

test('readFrontmatter returns null for an unreadable file — absence is not an error here', () =>
  withTmp((dir) => {
    assert.equal(readFrontmatter(join(dir, 'nope.md')), null);
  }));

test('readFrontmatter returns null for frontmatter that is not an object', () =>
  withTmp((dir) => {
    // A bare scalar parses fine as YAML and would hand every caller a
    // non-indexable `data`; the predicates built on this all treat it as
    // "not one of mine".
    const path = join(dir, 'SCALAR.md');
    writeFileSync(path, '---\njust-a-string\n---\n\nbody\n');
    assert.equal(readFrontmatter(path), null);
  }));

test('readFrontmatter opts out of the parse cache — two documents never share one data object', () =>
  withTmp((dir) => {
    // gray-matter memoises by content, so two files with IDENTICAL bytes come
    // back as the SAME object unless the cache is opted out of. A caller that
    // normalises its own copy would then mutate the other file's. The registry
    // this replaces passed `{}` for exactly that reason; the reason has to
    // survive the move, so it is asserted rather than commented.
    const a = join(dir, 'A.md');
    const b = join(dir, 'B.md');
    const bytes = '---\nid: cog\nspokes: 8\n---\n\nsame\n';
    writeFileSync(a, bytes);
    writeFileSync(b, bytes);
    const da = readFrontmatter(a)!;
    const db = readFrontmatter(b)!;
    assert.notEqual(da.data, db.data, 'two reads must not share one data object');
    (da.data as Record<string, unknown>)['spokes'] = 99;
    assert.equal(db.data['spokes'], 8, 'mutating one document changed the other');
  }));

test('loadStudioObject shapes the document with the CALLER\'s validator', () =>
  withTmp((dir) => {
    const path = join(dir, 'WIDGET.md');
    writeFileSync(path, '---\nid: cog\nspokes: 8\n---\n\nA cog.\n');
    assert.deepEqual(loadStudioObject(path, validateWidget), { id: 'cog', spokes: 8, body: 'A cog.' });
  }));

test('loadStudioObject lets the validator\'s own error through, unwrapped', () =>
  withTmp((dir) => {
    const path = join(dir, 'BAD.md');
    writeFileSync(path, '---\nid: cog\nspokes: "eight"\n---\n\nbody\n');
    assert.throws(() => loadStudioObject(path, validateWidget), /"spokes" must be a number/);
  }));

test('loadStudioObject names the PATH when the file cannot be read', () =>
  withTmp((dir) => {
    const path = join(dir, 'missing.md');
    // A loader that throws a bare ENOENT makes the caller guess which of a
    // hundred SKILL.mds it was.
    assert.throws(() => loadStudioObject(path, validateWidget), new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }));

test('loadStudioObject refuses a document whose frontmatter is not an object, naming the path', () =>
  withTmp((dir) => {
    const path = join(dir, 'SCALAR.md');
    writeFileSync(path, '---\njust-a-string\n---\n\nbody\n');
    assert.throws(() => loadStudioObject(path, validateWidget), /frontmatter/);
  }));

test('THE INVARIANT: kernel names NO field of any single kind — the loader is generic or it is not a loader', () => {
  // Asserted against the module's own source. A generic loader that quietly
  // learns one kind's vocabulary stops being generic, and the commit that does
  // it looks harmless line by line. `runtime`/`composition`/`brainAccess` are
  // the Agent kind's; `bands`/`stations` are the Flow kind's.
  const source = readFileSync(join(HERE, 'studio-object.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const kindVocabulary = [
    'runtime',
    'composition',
    'brainAccess',
    'interactivity',
    'loopStrategy',
    'quarantined',
    'provenance',
    'starter',
    'bands',
    'stations',
    'agent',
    'flow',
    'skill',
  ];
  const found = kindVocabulary.filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(code));
  assert.deepEqual(
    found,
    [],
    `kernel's generic loader has learned a specific kind's vocabulary: ${found.join(', ')}. The shape belongs to the caller's validator.`,
  );
});
