/**
 * bridge-studio-session-helpers.test.ts — the carved session-route helper layer.
 *
 * The tests that matter here are about the `/start` repo-path guard's SHAPE, not
 * only its answers. `invalidProjectRepoPath` carries a written precondition —
 * its `candidate` is `JSON.parse` output from a request body, and that is what
 * makes its value space closed — and states that it "is deliberately NOT
 * exported". The carve could not honour that literally, because its four callers
 * turned out to be the four `/start` routes across three family modules. So the
 * invariant is kept structurally: the module exports one guard that reads the
 * field off a parsed body itself, and the raw predicate stays private.
 *
 * A comment cannot enforce that. These tests can, and the export-surface test
 * exists so that a future "just export it" shows up RED rather than as a quiet
 * widening of a guarded value space.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import * as helpers from './bridge-studio-session-helpers.ts';
import { rejectStartProjectRepoPath } from './bridge-studio-session-helpers.ts';

const ROOTS = { forgeRoot: '/home/parso/forge', projectsRoot: '/home/parso/forge/projects' };

/**
 * The shipped containment guard's contract, stubbed.
 *
 * It RESOLVES before comparing, because that is the contract: a lexical
 * `startsWith` would call `<projects>/../../etc` contained and this stub would
 * then be testing itself rather than the guard. (Written naively first; the
 * traversal case caught it, which is the case earning its place.)
 */
const contained = (candidate: string, roots: { forgeRoot: string; projectsRoot: string }) => {
  const real = resolve(candidate);
  return real === roots.projectsRoot || real.startsWith(`${roots.projectsRoot}/`);
};

// ------------------------------------------------------- the export surface

test('the raw predicate is NOT exported — the guarded value space stays closed', () => {
  const exported = Object.keys(helpers);
  assert.ok(
    !exported.includes('invalidProjectRepoPath'),
    `invalidProjectRepoPath must stay module-private; exporting it reopens the value space its own comment protects. Exports: ${exported.join(', ')}`,
  );
  assert.ok(!exported.includes('describeRejectedValue'), 'the 400-renderer is an implementation detail of the guard');
  assert.ok(exported.includes('rejectStartProjectRepoPath'), 'the body-shaped guard IS the exported way in');
});

// ------------------------------------------- the guard, table-driven per case

const CASES = [
  { name: 'absent is allowed — the field is optional', body: {}, expect: null },
  { name: "empty string is ABSENT, not invalid — every call site defaults with || not ??", body: { projectRepoPath: '' }, expect: null },
  { name: 'a contained path is allowed', body: { projectRepoPath: '/home/parso/forge/projects/mdtoc' }, expect: null },
  {
    name: 'a traversal escape is rejected and echoed',
    body: { projectRepoPath: '/home/parso/forge/projects/../../etc' },
    expect: '/home/parso/forge/projects/../../etc',
  },
  { name: 'an unrelated absolute path is rejected', body: { projectRepoPath: '/etc/passwd' }, expect: '/etc/passwd' },
  {
    name: 'a sibling sharing a prefix is NOT inside — projects-evil',
    body: { projectRepoPath: '/home/parso/forge/projects-evil/x' },
    expect: '/home/parso/forge/projects-evil/x',
  },
];

for (const c of CASES) {
  test(`/start repo-path guard: ${c.name}`, () => {
    assert.equal(rejectStartProjectRepoPath(c.body, ROOTS, contained), c.expect);
  });
}

test('a non-string value fails CLOSED with a rendered reason, never a raw TypeError', () => {
  // The request body is untrusted JSON: the static type is a lie about what can
  // arrive. `0`, `null`, `{}` and `[]` must each produce a 400 reason naming the
  // value rather than falling through to a path call.
  for (const value of [0, null, {}, [], true]) {
    const reason = rejectStartProjectRepoPath({ projectRepoPath: value }, ROOTS, contained);
    assert.ok(typeof reason === 'string' && reason.length > 0, `non-string ${JSON.stringify(value)} must be rejected with a reason`);
  }
});

test('the containment check is INJECTED — the guard never reaches for a rank-above import', () => {
  // `isContainedProjectRepoPath` ships in `@forge/flows`, which is above this
  // package; naming it even in type position would mint a boundary row. Proof
  // that it is a parameter and not a hidden import: a stub that refuses
  // everything changes the verdict for a path the real guard would allow.
  const refuseAll = () => false;
  assert.equal(rejectStartProjectRepoPath({ projectRepoPath: '/home/parso/forge/projects/mdtoc' }, ROOTS, contained), null);
  assert.equal(
    rejectStartProjectRepoPath({ projectRepoPath: '/home/parso/forge/projects/mdtoc' }, ROOTS, refuseAll),
    '/home/parso/forge/projects/mdtoc',
    'the injected check decides containment — if this passed regardless, the module had imported its own',
  );
});
