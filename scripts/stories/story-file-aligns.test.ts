/**
 * `aligns` validation — split out from `story-file.test.ts` (forge-1rk5.2,
 * plan D7) rather than grown into it: that file sits at 794 lines, five
 * lines under the 800-line cap, and the cut follows the SUBJECT the sibling
 * split files already establish (`story-file-fixture.test.ts` did the same
 * for `ground.fixture`).
 *
 * MECHANISM ONLY. This tests the SHAPE `validateStory` accepts for an
 * optional top-level `aligns: [{ path, digest, why }]` — no filesystem or git
 * access happens here, matching how this module validates every other
 * optional field (pure, at load). Whether a pinned digest still matches the
 * cited file's CURRENT bytes is `alignment.mjs`'s job
 * (`scripts/stories/alignment.test.ts`), not this file's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStory } from './story-file.mjs';

const base = {
  id: 'S1',
  ground: { project: 'mdtoc', realSpawn: false, budget_usd: 0 },
  docs: { kind: 'how-to' as const, title: 't' },
  beats: [{ act: 'a', say: 's', expect: { route: '/', data: { x: '1' } } }],
};

const validEntry = {
  path: 'docs/decisions/001-claude-agent-sdk.md',
  digest: '0123456789abcdef',
  why: 'S1 demonstrates the pattern this ADR pins.',
};

test('a well-formed aligns entry validates and rides in the frozen story', () => {
  const v = validateStory({ ...base, aligns: [validEntry] });
  assert.deepEqual(v.aligns, [validEntry]);
  assert.ok(Object.isFrozen(v.aligns), 'aligns must be frozen like every other field');
  assert.ok(Object.isFrozen(v.aligns[0]), 'each aligns entry must be frozen');
});

test('a story with no aligns declares none — every story authored before this keeps working', () => {
  const v = validateStory(base);
  assert.equal(v.aligns, undefined);
});

test('a brain theme path validates too — aligns is not ADR-only', () => {
  const entry = { ...validEntry, path: 'brain/forge-dev/themes/2026-07-01-architect-coverage-scope-fidelity.md' };
  const v = validateStory({ ...base, aligns: [entry] });
  assert.deepEqual(v.aligns, [entry]);
});

test('an empty aligns array is rejected — an empty declaration asserts nothing', () => {
  assert.throws(() => validateStory({ ...base, aligns: [] }), /aligns/);
});

test('a non-array aligns is rejected, naming the field', () => {
  assert.throws(() => validateStory({ ...base, aligns: 'x' }), /aligns/);
});

test('an aligns entry that is not an object is rejected, naming the story and the index', () => {
  assert.throws(
    () => validateStory({ ...base, aligns: ['x'] }),
    /aligns\[0\].*S1|S1.*aligns\[0\]/s,
  );
});

test('an absolute aligns path is refused', () => {
  assert.throws(
    () => validateStory({ ...base, aligns: [{ ...validEntry, path: '/docs/decisions/001-claude-agent-sdk.md' }] }),
    /aligns\[0\]\.path/,
  );
});

test('an aligns path with .. traversal is refused', () => {
  assert.throws(
    () => validateStory({ ...base, aligns: [{ ...validEntry, path: 'docs/../secrets.md' }] }),
    /aligns\[0\]\.path/,
  );
});

test('an aligns path under _1.0/ is refused, naming the field and the story', () => {
  // MUTATION TARGET (b): a validator that forgot this refusal would let a
  // permanent artifact (the story file) cite a path inside the gitignored
  // campaign dir, which CLAUDE.md forbids outright.
  assert.throws(
    () => validateStory({ ...base, aligns: [{ ...validEntry, path: '_1.0/reports/x.md' }] }),
    /aligns\[0\]\.path.*S1|S1.*aligns\[0\]\.path/s,
  );
});

test('an aligns digest that is not exactly 16 lowercase hex chars is refused', () => {
  for (const bad of ['0123456789ABCDEF', '0123456789abcde', '0123456789abcdef0', 'not-hex-at-all!!', '']) {
    assert.throws(
      () => validateStory({ ...base, aligns: [{ ...validEntry, digest: bad }] }),
      /aligns\[0\]\.digest/,
      `expected a refusal for digest ${JSON.stringify(bad)}`,
    );
  }
});

test('an empty aligns why is refused', () => {
  assert.throws(
    () => validateStory({ ...base, aligns: [{ ...validEntry, why: '' }] }),
    /aligns\[0\]\.why/,
  );
});

test('an aligns why over 200 chars is refused', () => {
  assert.throws(
    () => validateStory({ ...base, aligns: [{ ...validEntry, why: 'x'.repeat(201) }] }),
    /aligns\[0\]\.why/,
  );
});

test('an aligns why exactly 200 chars is accepted', () => {
  const v = validateStory({ ...base, aligns: [{ ...validEntry, why: 'x'.repeat(200) }] });
  assert.equal(v.aligns[0].why.length, 200);
});

test('an aligns why containing a newline is refused — one line only', () => {
  assert.throws(
    () => validateStory({ ...base, aligns: [{ ...validEntry, why: 'line one\nline two' }] }),
    /aligns\[0\]\.why/,
  );
});

test('multiple aligns entries all survive validation, in order', () => {
  const two = { ...validEntry, path: 'brain/forge-dev/themes/2026-07-01-architect-coverage-scope-fidelity.md', digest: 'fedcba9876543210' };
  const v = validateStory({ ...base, aligns: [validEntry, two] });
  assert.deepEqual(v.aligns, [validEntry, two]);
});

test('validateStory never mutates an input aligns array', () => {
  const input = { ...base, aligns: [{ ...validEntry }] };
  const snapshot = structuredClone(input);
  validateStory(input);
  assert.deepEqual(input, snapshot);
});
