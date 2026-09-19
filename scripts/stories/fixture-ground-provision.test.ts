/**
 * fixture-ground-provision.test.ts — what `provisionFixtureGround` leaves
 * behind when it fails after the copy, what its commit sha depends on, and
 * that the seed list reaches git literally (M7-D, bead `forge-1rk5.1`).
 *
 * FAILURE AFTER THE COPY. Once `cpSync` has written the ground, any failure
 * removes it and rethrows the ORIGINAL error; when that removal fails too,
 * both are thrown as one `AggregateError` whose message leads with the
 * original, so a cleanup failure never hides why provisioning failed. Both
 * cases are forced deterministically by a stand-in `git` first on `PATH`: it
 * exits 1 on the first git call (`git init`, which runs after the copy) and,
 * in the second case, first makes the ground read-only so its removal hits
 * EACCES.
 *
 * DETERMINISM. The sha depends on the seed's tree, the fixture name and
 * `FIXTURE_COMMIT_ENV` — not on which story provisioned it, and not on the
 * host's git config: a global `core.hooksPath` hook that rewrites the
 * message, an `init.templateDir` hook, `core.autocrlf=true` on a CRLF file,
 * `init.defaultObjectFormat=sha256` and a non-UTF-8 `i18n.commitEncoding`
 * all leave it unchanged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { provisionFixtureGround, teardownFixtureGround } from './fixture-ground.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'fixture-ground-provision-'));

/** Plant `tests/stories/grounds/<name>/{seed/…, PROVENANCE.md}` under `root`. */
function seedFixture(root: string, files: Record<string, string>, name = 'demo-seed'): string {
  const seedDir = join(root, 'tests', 'stories', 'grounds', name, 'seed');
  mkdirSync(seedDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(seedDir, rel, '..'), { recursive: true });
    writeFileSync(join(seedDir, rel), content);
  }
  writeFileSync(join(root, 'tests', 'stories', 'grounds', name, 'PROVENANCE.md'), '# provenance\n');
  return seedDir;
}

/** Run `fn` with a stand-in `git` (a `/bin/sh` script) first on `PATH`. */
function withFakeGit(script: string, fn: () => void) {
  const bin = join(scratch(), 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'git'), `#!/bin/sh\n${script}`, { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = `${bin}:${saved}`;
  try {
    fn();
  } finally {
    process.env.PATH = saved;
  }
}

/** Run `fn` with `GIT_CONFIG_GLOBAL` pointing at a file holding `config`. */
function withGlobalGitConfig(config: string, fn: () => void) {
  const file = join(scratch(), 'gitconfig');
  writeFileSync(file, config);
  const saved = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = file;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = saved;
  }
}

// ── failure after the copy ──────────────────────────────────────────────────

test('a git failure after the copy removes the ground and rethrows the ORIGINAL error unchanged', () => {
  const root = scratch();
  seedFixture(root, { 'README.md': '# demo seed\n' });
  const dest = join(root, 'projects', 'story-s8');

  withFakeGit('echo "stand-in git refuses" >&2\nexit 1\n', () => {
    assert.throws(
      () => provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'demo-seed' }),
      (err: unknown) => {
        assert.ok(!(err instanceof AggregateError), `a clean removal must not wrap the error. Got: ${String(err)}`);
        assert.match(String((err as Error).message), /git init exited 1 — stand-in git refuses/);
        return true;
      },
    );
  });
  assert.equal(existsSync(dest), false, 'everything the failed provision wrote must be gone');
});

test('a removal that fails too is ATTACHED to the original error, never thrown in its place — AggregateError, original first, the ground named as still on disk', (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('running as root — permission bits are not enforced, so the forced EACCES never occurs');
    return;
  }
  const root = scratch();
  seedFixture(root, { 'README.md': '# demo seed\n' });
  const dest = join(root, 'projects', 'story-s8');

  try {
    // `$2` is the `-C <dest>` argument: the stand-in locks the copied ground
    // before failing, so the provisioner's own removal of it cannot succeed.
    withFakeGit('chmod 555 "$2"\necho "stand-in git refuses" >&2\nexit 1\n', () => {
      assert.throws(
        () => provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'demo-seed' }),
        (err: unknown) => {
          assert.ok(err instanceof AggregateError, `expected an AggregateError. Got: ${String(err)}`);
          const [original, cleanup] = (err as AggregateError).errors;
          assert.match(String(original?.message), /^provisionFixtureGround: git init exited 1 — stand-in git refuses$/);
          assert.equal((cleanup as NodeJS.ErrnoException)?.code, 'EACCES', `the second error is the removal's own. Got: ${String(cleanup)}`);
          const message = (err as Error).message;
          assert.ok(message.startsWith(original.message), `the message must lead with the original error. Got: ${message}`);
          assert.ok(message.includes(dest), `the message must name the ground left on disk. Got: ${message}`);
          return true;
        },
      );
    });
    assert.equal(existsSync(dest), true, 'the removal failed, so the ground is still there — and the error said so');
  } finally {
    if (existsSync(dest)) chmodSync(dest, 0o755);
  }
});

// ── determinism ─────────────────────────────────────────────────────────────

test('two stories that provision the same seed commit to the SAME sha — the story is not part of the commit', () => {
  const root = scratch();
  seedFixture(root, { 'README.md': '# demo seed\n', 'src/a.ts': 'export const a = 1;\n' });

  const s8 = provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'demo-seed' });
  const s5 = provisionFixtureGround(root, { storyId: 'S5', project: 'story-s5', fixture: 'demo-seed' });
  assert.equal(s5.commit, s8.commit, 'anything quoting "the demo-seed commit" from one story must hold for the other');
});

test('the host git config does not take part: hostile hooks, template, line endings, object format and encoding leave the sha unchanged', () => {
  const root = scratch();
  seedFixture(root, { 'README.md': '# demo seed\n', 'crlf.txt': 'one\r\ntwo\r\n' });

  let clean = '';
  withGlobalGitConfig('', () => {
    clean = provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'demo-seed' }).commit;
  });
  teardownFixtureGround(root, { storyId: 'S8', project: 'story-s8' });

  const hostile = scratch();
  const rewrite = '#!/bin/sh\necho "rewritten by a host hook" >> "$1"\n';
  mkdirSync(join(hostile, 'hooks'), { recursive: true });
  writeFileSync(join(hostile, 'hooks', 'prepare-commit-msg'), rewrite, { mode: 0o755 });
  mkdirSync(join(hostile, 'template', 'hooks'), { recursive: true });
  writeFileSync(join(hostile, 'template', 'hooks', 'prepare-commit-msg'), rewrite, { mode: 0o755 });
  const config = [
    '[core]',
    `\thooksPath = ${join(hostile, 'hooks')}`,
    '\tautocrlf = true',
    '[init]',
    `\ttemplateDir = ${join(hostile, 'template')}`,
    '\tdefaultObjectFormat = sha256',
    '[i18n]',
    '\tcommitEncoding = ISO-8859-1',
    '',
  ].join('\n');

  withGlobalGitConfig(config, () => {
    const second = provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'demo-seed' }).commit;
    assert.match(second, /^[0-9a-f]{40}$/, `expected a 40-hex sha1, got ${second}`);
    assert.equal(second, clean, 'the host git config must not reach the commit');
  });
});

// ── the seed list reaches git literally ─────────────────────────────────────

test('every seed file is committed as itself — a name that is pathspec magic or a glob is added literally', () => {
  const root = scratch();
  seedFixture(root, {
    'README.md': '# demo seed\n',
    ':(exclude)README.md': 'a file whose name is pathspec magic\n',
    'a*b.txt': 'a file whose name is a glob\n',
  });

  const result = provisionFixtureGround(root, { storyId: 'S8', project: 'story-s8', fixture: 'demo-seed' });
  const listed = spawnSync('git', ['-C', result.dir, 'ls-files', '-z'], { encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  const committed = listed.stdout.split('\0').filter((p) => p !== '').sort();
  assert.deepEqual(committed, [...result.files], 'the commit must hold EXACTLY the seed file list');
  assert.equal(committed.length, 3);
});
