/**
 * `rootManagesProject` — bead `forge-8vfn.6.11.26`, T1 rulings 309 and 315.
 *
 * Brain 3 is CENTRAL: it lives under the forge root (ADR 035) while a project's
 * own files live under its project dir. A writer handed both is only coherent
 * when the root manages that project. S1 run 5 (M5-B session 8) was handed a
 * mismatched pair and split ONE fix across two trees — `roadmap.md` into the
 * lane's ground, `brain/projects/gitweave/profile.md` into a different checkout
 * entirely, which then reported `fence: clean` because nothing looked there.
 *
 * The predicate lives in the kernel beside `projectBrainDir`, `projectThemesDir`
 * and `resolveProjectsDir` — every path it reasons about (ruling 315).
 *
 * `FORGE_PROJECTS_DIR` is asserted because the predicate MUST honour the same
 * override the rest of forge does: a host that relocates its projects would
 * otherwise have every legitimate pair refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { rootManagesProject, rootMismatchReason } from './project-layout.ts';

const ROOT = '/srv/forge';

test('6.11.26: a project under the root\'s own projects dir is managed by it', () => {
  assert.equal(rootManagesProject(ROOT, join(ROOT, 'projects', 'gitweave')), true);
});

test('6.11.26: a project under a DIFFERENT root is not — the incident, as a predicate', () => {
  assert.equal(rootManagesProject('/home/parso/forge', '/home/parso/forge-m5-b/projects/gitweave'), false);
});

test('6.11.26: the projects dir itself is not a project', () => {
  // `relative()` returns '' here. Without the explicit check that reads as
  // "contained", and the caller would scaffold a brain for a directory that is
  // not a project.
  assert.equal(rootManagesProject(ROOT, join(ROOT, 'projects')), false);
});

test('6.11.26: a sibling path that merely SHARES A PREFIX is not contained', () => {
  // The string-prefix trap: `/srv/forge/projects-old` starts with
  // `/srv/forge/projects`. Path-relative containment rejects it; `startsWith`
  // on the raw string would not.
  assert.equal(rootManagesProject(ROOT, '/srv/forge/projects-old/gitweave'), false);
});

test('6.11.26: a traversal out of the projects dir is not contained', () => {
  assert.equal(rootManagesProject(ROOT, join(ROOT, 'projects', '..', '..', 'elsewhere')), false);
});

test('6.11.26: FORGE_PROJECTS_DIR is honoured, like every other caller', () => {
  const prev = process.env.FORGE_PROJECTS_DIR;
  process.env.FORGE_PROJECTS_DIR = '/mnt/work/managed';
  try {
    assert.equal(rootManagesProject(ROOT, '/mnt/work/managed/gitweave'), true);
    // …and the default location stops being managed once the override is set.
    assert.equal(rootManagesProject(ROOT, join(ROOT, 'projects', 'gitweave')), false);
  } finally {
    if (prev === undefined) delete process.env.FORGE_PROJECTS_DIR;
    else process.env.FORGE_PROJECTS_DIR = prev;
  }
});

test('6.11.26: the refusal names BOTH roots — one log line must be enough', () => {
  const reason = rootMismatchReason('/home/parso/forge', '/home/parso/forge-m5-b/projects/gitweave');
  assert.ok(reason.includes('/home/parso/forge'), 'names the root that was handed in');
  assert.ok(reason.includes('/home/parso/forge-m5-b/projects/gitweave'), 'names the project refused');
  assert.ok(reason.includes('ADR 035'), 'cites why Brain 3 is central at all');
});
