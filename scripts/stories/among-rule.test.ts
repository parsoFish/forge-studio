/**
 * among-rule.test.ts — the doors for `forge-8vfn.26` part (b): a beat states a
 * RULE for which element may answer a key, never an id.
 *
 * THE DEFECT THESE STAND AGAINST. `proof.story.mjs` beat 1 bound
 * `<someProjectId>` from whichever project card came first, and "first" is a
 * property of the running checkout: `gitpulse` on one lane, `mdtoc` in CI,
 * `gitweave` in the committed sample. The artifact never converged.
 *
 * Every refusal below is a LOAD-TIME one on purpose: an unresolvable rule that
 * reached the beat would select no element, and the beat would red as though the
 * PRODUCT had rendered no cards — an environment failure reported as a product
 * defect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { trackedProjectIds } from './tracked-projects.mjs';
import { restrictNested } from './beats-page.mjs';
import { validateStory } from './story-file.mjs';

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'tracked-projects-'));
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'f@x.invalid']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'f']);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
    execFileSync('git', ['-C', dir, 'add', '--', rel]);
  }
  if (Object.keys(files).length > 0) execFileSync('git', ['-C', dir, 'commit', '-qm', 'base']);
  return dir;
}

const beat = (data: Record<string, string>, among?: unknown) => ({
  id: 's', ground: { project: 'mdtoc', realSpawn: false, budget_usd: 0 },
  docs: { kind: 'how-to', title: 't' },
  beats: [{ act: 'a', say: 's', expect: { route: '/x', data, ...(among === undefined ? {} : { among }) } }],
});

test('tracked ids come from git, and an UNTRACKED directory is not one of them', () => {
  const dir = repo({ 'projects/mdtoc/README.md': 'x' });
  mkdirSync(join(dir, 'projects', 'gitpulse'), { recursive: true });
  writeFileSync(join(dir, 'projects', 'gitpulse', 'README.md'), 'x');
  // gitpulse exists on disk and is not tracked — the exact shape that made the
  // artifact record one lane's checkout.
  assert.deepEqual(trackedProjectIds(dir), ['mdtoc']);
});

test('a file directly under projects/ names no project', () => {
  const dir = repo({ 'projects/README.md': 'x', 'projects/.gitkeep': '', 'projects/mdtoc/a.md': 'x' });
  assert.deepEqual(trackedProjectIds(dir), ['mdtoc']);
});

test('REFUSES in a non-git directory — a failed read is not an empty set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'not-a-repo-'));
  assert.throws(() => trackedProjectIds(dir), (e: Error) => {
    assert.match(e.message, /git ls-files exited/);
    assert.match(e.message, /Refusing/);
    return true;
  });
});

test('REFUSES when nothing is tracked — rather than blaming the product for an empty repo', () => {
  const dir = repo({ 'README.md': 'x' });
  assert.throws(() => trackedProjectIds(dir), /tracks no project under projects\//);
});

test('an UNKNOWN rule is refused at LOAD, naming the closed set', () => {
  assert.throws(
    () => validateStory(beat({ 'card-id': '<x>' }, { 'card-id': 'tracked-porjects' })),
    (e: Error) => {
      assert.match(e.message, /unknown rule "tracked-porjects"/);
      assert.match(e.message, /tracked-projects/, 'the refusal must name what IS allowed');
      assert.match(e.message, /would select no element/);
      return true;
    },
  );
});

test('a rule on a key the beat does not expect is refused — it would restrict nothing', () => {
  assert.throws(
    () => validateStory(beat({ 'card-id': '<x>' }, { 'card-type': 'tracked-projects' })),
    /restricts a key this beat does not expect/,
  );
});

test('among must be an object of key->rule', () => {
  assert.throws(() => validateStory(beat({ 'card-id': '<x>' }, ['tracked-projects'])), /expected an object/);
  assert.throws(() => validateStory(beat({ 'card-id': '<x>' }, {})), /at least one/);
});

test('a valid rule survives validation and is carried on the beat', () => {
  const st = validateStory(beat({ 'card-id': '<x>' }, { 'card-id': 'tracked-projects' }));
  assert.deepEqual(st.beats[0].expect.among, { 'card-id': 'tracked-projects' });
});

test('restrictNested drops the cards the rule excludes', () => {
  const b = { expect: { amongIds: { 'card-id': ['mdtoc'] } } };
  const out = restrictNested([{ 'card-id': 'gitpulse' }, { 'card-id': 'mdtoc' }], b);
  assert.deepEqual(out, [{ 'card-id': 'mdtoc' }]);
});

test('restrictNested KEEPS records that do not carry the key at all', () => {
  // The rule says which element may answer THAT key. Dropping unrelated records
  // would silently narrow every other key the beat asks about.
  const b = { expect: { amongIds: { 'card-id': ['mdtoc'] } } };
  const out = restrictNested([{ section: 'project-onboard' }, { 'card-id': 'gitpulse' }], b);
  assert.deepEqual(out, [{ section: 'project-onboard' }]);
});

test('a beat with no rule is untouched', () => {
  const records = [{ 'card-id': 'gitpulse' }, { 'card-id': 'mdtoc' }];
  assert.equal(restrictNested(records, { expect: { data: {} } }), records);
});
