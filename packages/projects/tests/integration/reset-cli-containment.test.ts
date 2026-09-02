/**
 * `forge project reset` — the CLI's own containment, pinned.
 *
 * The id reaching this command is request-derived (an operator argument today;
 * the same `cmdProjectReset` is what a Studio "Rebuild contract" route would
 * call), and the directory it resolves to becomes the TRUSTED `root` argument
 * for every `resolveGuardedPath`/`guardedRename` call inside `reset.ts`.
 * `resolveGuardedPath` performs no identity check on its own root — that is
 * precisely why a root must never be built by folding a request-derived name
 * into a config-derived directory.
 *
 * A security review of this feature found exactly that shape here: the command
 * used `resolve(projectsDir, id)` guarded only by a lexical
 * `startsWith(projectsDir + '/')` check, which an unresolved path satisfies
 * happily. With `projects/<id>` planted as a symlink, `realpathSync` inside
 * the first inner guard would have followed it and the whole reset would have
 * written outside the projects root with every inner guard reporting `ok`.
 *
 * These cases fail against that version and pass against the fix
 * (`resolveGuardedPath(projectsDir, [id])`, the same remedy
 * `cli/bridge-studio.ts:605` already applies to the same shape).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FORGE_ROOT } from '@forge/kernel/ids.ts';

const CONTRACT = {
  name: 'victim',
  northStar: 'do not rewrite me',
  testProcess: { local: { cmd: ['npm', 'test'] } },
};

/** A temp forge root with a projects dir, plus a separate outside dir. */
function scaffold(): { forgeRoot: string; projectsDir: string; outside: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'reset-cli-forge-'));
  const projectsDir = join(forgeRoot, 'projects');
  mkdirSync(projectsDir, { recursive: true });
  writeFileSync(join(forgeRoot, 'forge.config.json'), JSON.stringify({ projectsDir: 'projects' }), 'utf8');

  const outside = mkdtempSync(join(tmpdir(), 'reset-cli-outside-'));
  mkdirSync(join(outside, '.forge'), { recursive: true });
  writeFileSync(join(outside, '.forge', 'project.json'), `${JSON.stringify(CONTRACT, null, 2)}\n`, 'utf8');
  return { forgeRoot, projectsDir, outside };
}

/**
 * The projects root is pointed at the fixture through `FORGE_PROJECTS_DIR`,
 * which `resolveProjectsDir` (`packages/kernel/config.ts:179`) honours ahead
 * of both config and default. A `cwd:` would NOT work and that is itself worth
 * knowing: `apps/forge/cli.ts:51` runs `process.chdir(FORGE_ROOT)` before
 * dispatch, so every command sees the repo root as its cwd whatever the caller
 * had. Writing this test is what surfaced that the command was deriving its
 * forge root from `resolve('.')` — correct only because of that chdir two
 * files away, and wrong for any other caller of the same function.
 */
function reset(projectsDir: string, args: string[]): { code: number | null; out: string } {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', join(FORGE_ROOT, 'apps', 'forge', 'cli.ts'), 'project', 'reset', ...args],
    { encoding: 'utf8', env: { ...process.env, FORGE_PROJECTS_DIR: projectsDir } },
  );
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('reset CLI: a symlinked projects/<id> is REFUSED, and the symlink target is untouched', () => {
  const { forgeRoot, projectsDir, outside } = scaffold();
  try {
    symlinkSync(outside, join(projectsDir, 'victim'), 'dir');
    const before = readFileSync(join(outside, '.forge', 'project.json'), 'utf8');

    const r = reset(projectsDir, ['victim', '--apply']);

    assert.notEqual(r.code, 0, `expected a non-zero exit, got ${r.code}: ${r.out}`);
    assert.match(r.out, /containment check failed/i);
    assert.equal(
      readFileSync(join(outside, '.forge', 'project.json'), 'utf8'),
      before,
      'the symlink target contract must be byte-identical — nothing outside the projects root may be written',
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('reset CLI: an absent project id is refused before any write, and says so', () => {
  const { forgeRoot, projectsDir, outside } = scaffold();
  try {
    const r = reset(projectsDir, ['nosuchproject', '--apply']);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /no project directory/i);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('reset CLI: an id failing the id rule is refused with exit 2, before any path resolution', () => {
  const { forgeRoot, projectsDir, outside } = scaffold();
  try {
    const r = reset(projectsDir, ['../escape', '--apply']);
    assert.equal(r.code, 2);
    assert.match(r.out, /invalid project id/i);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
