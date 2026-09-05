/**
 * `gh repo create` at project creation — bead `forge-8vfn.6.11.2`,
 * operator ruling 168 as carried by T1 ruling 255.
 *
 * S2 beat 5 asserts `resolution-user-count: '0'`: nothing is waiting on the
 * operator. It cannot read `'0'` while C6 is unresolved, and `checkC6`
 * (`preflight-repo.ts:183`) passes iff `git remote get-url origin` names a
 * github.com remote. A greenfield project is its own git repo from birth
 * (W7-B6/projects-11) but has no remote, so S2 run 3 measured
 * `failing 3 / user 1` against the expected `2 / 0` — exactly and only this.
 *
 * Design constraints, each from the bead or the ruling:
 *   - no new dependency: `gh` is already forge's PR tool;
 *   - a network side effect is OUTWARD-FACING, so it happens only when the
 *     caller asks for it — absent `remote`, this path is byte-identical to
 *     today and makes no `gh` call at all;
 *   - `gh` auth absent -> the creation FAILS LOUD naming it, never a
 *     local-only silent fallback (the bead's own park);
 *   - the account and visibility are CONSTANTS, never inline literals.
 *
 * ORDERING IS A CONTAINMENT PROPERTY, not a preference. The remote is created
 * LAST, after every local step has already succeeded, because the unwind can
 * delete a staged directory and CANNOT delete a GitHub repository — deletion
 * needs a dedicated token the operator has not yet issued. A remote created
 * before a local failure would be an orphan nobody in this lane can remove.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scaffoldGreenfieldProject } from '../../project-create.ts';

const FORGE = '/home/parso/forge-m5-b';

/** A forge root with the real starters, so the scaffold is the real one. */
function plantRoot() {
  const root = mkdtempSync(join(tmpdir(), 'create-remote-'));
  mkdirSync(join(root, 'projects'), { recursive: true });
  mkdirSync(join(root, 'brain', 'projects'), { recursive: true });
  cpSync(join(FORGE, 'studio', 'starters'), join(root, 'studio', 'starters'), { recursive: true });
  return root;
}

const manifest = {
  name: 'Story Remote Fixture',
  appType: 'typescript-cli',
  language: 'typescript',
  northStar: 'A fixture project proving the creation path can mint its own GitHub remote.',
};

test('AT-6.11.2-1 (RED) with `remote` asked for, the creation path runs gh and reports the URL', () => {
  const root = plantRoot();
  const calls: string[][] = [];
  try {
    const res = scaffoldGreenfieldProject({
      manifest: manifest as never,
      forgeRoot: root,
      remote: {
        create: true,
        runGh: (args: string[]) => {
          calls.push(args);
          if (args[0] === 'auth') return 'Logged in to github.com';
          return 'https://github.com/parsoFish/story-remote-fixture';
        },
      },
    } as never) as never as { remoteUrl?: string; projectDir: string };

    assert.equal(res.remoteUrl, 'https://github.com/parsoFish/story-remote-fixture');
    assert.deepEqual(calls[0], ['auth', 'status'], 'auth is checked BEFORE anything outward-facing');
    const create = calls[1];
    assert.equal(create[0], 'repo');
    assert.equal(create[1], 'create');
    assert.match(create[2], /^parsoFish\/story-remote-fixture$/, `account/name from constants: ${create[2]}`);
    assert.ok(create.includes('--private'), `visibility declared: ${create.join(' ')}`);
    assert.ok(create.includes('--push'), `the scaffold commit is pushed: ${create.join(' ')}`);
    assert.ok(create.includes('--source'), `sourced from the project dir: ${create.join(' ')}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-6.11.2-2 (RED) gh auth absent FAILS LOUD naming gh, and creates NO remote', () => {
  const root = plantRoot();
  const calls: string[][] = [];
  try {
    assert.throws(
      () => scaffoldGreenfieldProject({
        manifest: manifest as never,
        forgeRoot: root,
        remote: {
          create: true,
          runGh: (args: string[]) => {
            calls.push(args);
            if (args[0] === 'auth') throw new Error('gh: You are not logged into any GitHub hosts');
            return '';
          },
        },
      } as never),
      /gh/i,
    );
    assert.deepEqual(calls.map((c) => c[0]), ['auth'], 'it stopped at auth — no repo was created');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-6.11.2-3 (positive control) with NO `remote`, gh is never invoked and the result is unchanged', () => {
  const root = plantRoot();
  try {
    const res = scaffoldGreenfieldProject({ manifest: manifest as never, forgeRoot: root }) as never as {
      remoteUrl?: string; projectDir: string; id: string;
    };
    assert.equal(res.remoteUrl, undefined, 'no remote asked for, none reported');
    assert.ok(existsSync(join(res.projectDir, '.git')), 'still its own git repo from birth (W7-B6)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-6.11.2-4 the remote is created LAST — a local failure can never orphan one', () => {
  // The unwind deletes a staged directory; it CANNOT delete a GitHub repo,
  // because deletion needs a token the operator has not issued. So `gh` must
  // not have been called at all when the local half throws.
  const root = plantRoot();
  const calls: string[][] = [];
  try {
    assert.throws(
      () => scaffoldGreenfieldProject({
        manifest: { ...manifest, appType: 'no-such-template' } as never,
        forgeRoot: root,
        remote: { create: true, runGh: (args: string[]) => { calls.push(args); return ''; } },
      } as never),
      /unknown appType/,
    );
    assert.deepEqual(calls, [], 'a local refusal must precede every outward-facing call');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
