/**
 * The door for item 76's follow-up (coordinator finding, real gate run):
 * `gate.sh`'s local gate PASSED the stories step and then went
 * `GATE_SH_EXIT=3` on its own LATER pins check, because the story runner
 * regenerates tracked artefacts — `demos/stories/{smoke,proof}/story.json` +
 * frames, the proof story's how-to page, `demos/stories/index.html` — and
 * `gate-stories.sh` left them dirty for every later step to read. A gate is
 * a read of the tree as it stood when invoked; leaving the run's own output
 * in place made the pins check see it as this PR's undeclared change
 * ("UNDECLARED: M6-C:demos/stories/proof/story.json …").
 *
 * The fix restores `scripts/stories/gallery.mjs`'s own `GENERATED_TREES`
 * scope after the step, and REFUSES up front rather than guessing when that
 * scope is already dirty before the step ever runs.
 *
 * Split from `gate-stories.test.ts` — a different concern (tree hygiene, not
 * the RUN/REFUSED/lock classification that file already pins) and that file
 * is already a few hundred lines on its own.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const SCRIPTS_DIR = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts');
const GATE = join(SCRIPTS_DIR, 'gate.sh');
const GATE_STORIES = join(SCRIPTS_DIR, 'gate-stories.sh');
const HOWTO = 'apps/docs/src/content/docs/guides/how-to';
const MEDIA = 'apps/docs/public/media/stories';

function strippedEnv(extra: Record<string, string> = {}) {
  const { FORGE_SUITE_LOCK: _s, FORGE_RUN_LOCK: _r, ...env } = process.env;
  return { ...env, ...extra };
}

/** A real git repo seeded with one tracked file, so a stub "story" has
 *  something committed to rewrite — `git restore --source=HEAD` needs HEAD
 *  to hold the original bytes. */
function gitRepoWithTrackedFile(relPath: string, content: string): string {
  const d = mkdtempSync(join(tmpdir(), 'gate-stories-restore-'));
  const git = (...a: string[]) => spawnSync('git', ['-C', d, ...a], { encoding: 'utf8' });
  mkdirSync(join(d, dirname(relPath)), { recursive: true });
  writeFileSync(join(d, relPath), content);
  git('init', '-q');
  git('config', 'user.email', 'gate@test');
  git('config', 'user.name', 'gate');
  git('add', '-A');
  git('commit', '-qm', 'seed');
  return d;
}

function gitStatus(repo: string, ...pathspec: string[]): string {
  return (spawnSync('git', ['-C', repo, 'status', '--porcelain', '--', ...pathspec], { encoding: 'utf8' }).stdout ?? '');
}

describe('gate-stories.sh — restoring its own generated-tree scope', () => {
  test('a green run that rewrote a tracked file and created an untracked one is fully restored', () => {
    const d = gitRepoWithTrackedFile('demos/stories/x.txt', 'original\n');
    try {
      const r = spawnSync('bash', [GATE_STORIES, 'echo RAN && printf changed >> demos/stories/x.txt && echo untracked > demos/stories/new.txt'], {
        encoding: 'utf8',
        cwd: d,
        env: strippedEnv({ FORGE_CHROMIUM_EXECUTABLE: '/bin/true', FORGE_STORIES_GENERATED_TREES: 'demos/stories' }),
      });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /RAN/, 'the command itself still ran');
      assert.equal(gitStatus(d, 'demos/stories'), '', 'the tree must read exactly as it was found');
      assert.equal(readFileSync(join(d, 'demos', 'stories', 'x.txt'), 'utf8'), 'original\n');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('a FAILING run is still restored, and keeps its own exit code rather than 75', () => {
    const d = gitRepoWithTrackedFile('demos/stories/x.txt', 'original\n');
    try {
      const r = spawnSync('bash', [GATE_STORIES, 'printf changed >> demos/stories/x.txt && exit 3'], {
        encoding: 'utf8',
        cwd: d,
        env: strippedEnv({ FORGE_CHROMIUM_EXECUTABLE: '/bin/true', FORGE_STORIES_GENERATED_TREES: 'demos/stories' }),
      });
      assert.equal(r.status, 3, 'a real failure is not laundered into a refusal by the restore');
      assert.equal(gitStatus(d, 'demos/stories'), '', 'the tree is still restored even though the story itself failed');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('a scope that is ALREADY dirty before the step refuses rather than restoring over real work', () => {
    const d = gitRepoWithTrackedFile('demos/stories/x.txt', 'original\n');
    writeFileSync(join(d, 'demos', 'stories', 'x.txt'), 'operator was here\n');
    try {
      const r = spawnSync('bash', [GATE_STORIES, 'echo SHOULD-NOT-RUN'], {
        encoding: 'utf8',
        cwd: d,
        env: strippedEnv({ FORGE_CHROMIUM_EXECUTABLE: '/bin/true', FORGE_STORIES_GENERATED_TREES: 'demos/stories' }),
      });
      assert.equal(r.status, 75);
      assert.match(r.stdout, /^\[stories-guard\]/m);
      assert.doesNotMatch(r.stdout, /SHOULD-NOT-RUN/, 'a refused step must never have run the command at all');
      assert.equal(readFileSync(join(d, 'demos', 'stories', 'x.txt'), 'utf8'), 'operator was here\n', 'the pre-existing edit must be untouched');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('a run that writes nothing under the scope leaves it alone — no restore noise on the common case', () => {
    const d = gitRepoWithTrackedFile('demos/stories/x.txt', 'original\n');
    try {
      const r = spawnSync('bash', [GATE_STORIES, 'echo nothing-written'], {
        encoding: 'utf8',
        cwd: d,
        env: strippedEnv({ FORGE_CHROMIUM_EXECUTABLE: '/bin/true', FORGE_STORIES_GENERATED_TREES: 'demos/stories' }),
      });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.doesNotMatch(r.stdout, /restoring/, 'nothing changed, so there is nothing to report restoring');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('an empty scope (FORGE_STORIES_GENERATED_TREES="") never touches the tree at all', () => {
    const d = gitRepoWithTrackedFile('demos/stories/x.txt', 'original\n');
    try {
      const r = spawnSync('bash', [GATE_STORIES, 'printf changed >> demos/stories/x.txt'], {
        encoding: 'utf8',
        cwd: d,
        env: strippedEnv({ FORGE_CHROMIUM_EXECUTABLE: '/bin/true', FORGE_STORIES_GENERATED_TREES: '' }),
      });
      assert.equal(r.status, 0);
      // An explicitly empty scope opts OUT of the restore entirely — this
      // only pins that the opt-out is honoured, never a claim about the real
      // (unset) default, which genuine callers always get.
      assert.notEqual(gitStatus(d, 'demos/stories'), '', 'an empty scope must not restore anything');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('REGRESSION: the real default scope (no override at all) restores ALL THREE trees, including the last', () => {
    // The three trees are the story runner's outputs: demos/stories, the docs
    // site's generated how-to pages, and the frames published for them.
    // Pins the exact bug measured on a real gate run: an earlier version of
    // this script derived its scope from a spawned node subprocess's
    // stdout, piped through `while read -r t; do …` — and the LAST line,
    // `docs/how-to` with no trailing newline after it, silently dropped out
    // of the scope, because `read`'s own loop condition fails on a final
    // line with no newline to terminate it. The scope is now a literal bash
    // array with no such seam; this proves the three real paths it names —
    // not a stand-in — all come back clean, `docs/how-to` included, with
    // FORGE_STORIES_GENERATED_TREES entirely unset (every other test in
    // this file sets it; this is the one path that exercises the real
    // default).
    const d = gitRepoWithTrackedFile('demos/stories/x.txt', 'original\n');
    for (const dir of [HOWTO, MEDIA]) {
      mkdirSync(join(d, dir), { recursive: true });
      writeFileSync(join(d, dir, 'y.txt'), 'original\n');
    }
    spawnSync('git', ['-C', d, 'add', '-A']);
    spawnSync('git', ['-C', d, 'commit', '-qm', 'add the other two trees']);
    try {
      const r = spawnSync(
        'bash',
        [GATE_STORIES, `printf changed >> demos/stories/x.txt && printf changed >> ${HOWTO}/y.txt && printf changed >> ${MEDIA}/y.txt && printf new > ${MEDIA}/born.png`],
        {
          encoding: 'utf8',
          cwd: d,
          env: strippedEnv({ FORGE_CHROMIUM_EXECUTABLE: '/bin/true' }), // deliberately no FORGE_STORIES_GENERATED_TREES
        },
      );
      assert.equal(r.status, 0, r.stdout + r.stderr);
      for (const dir of ['demos/stories', HOWTO, MEDIA]) {
        assert.equal(gitStatus(d, dir), '', `${dir} must be restored — got dirty: ${gitStatus(d, dir)}`);
      }
      assert.equal(readFileSync(join(d, MEDIA, 'y.txt'), 'utf8'), 'original\n', 'the media tree — the LAST tree in the scope — must not be dropped');
      assert.equal(existsSync(join(d, MEDIA, 'born.png')), false, 'a frame born in the run is removed');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('gate.sh — the stories step restores before the pins check reads the tree', () => {
  function tree(ci: string) {
    const dir = mkdtempSync(join(tmpdir(), 'gate-stories-pin-tree-'));
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), ci);
    return dir;
  }
  function installedInPlace(d: string) {
    mkdirSync(join(d, 'packages', 'kernel'), { recursive: true });
    mkdirSync(join(d, 'node_modules', '@forge'), { recursive: true });
    spawnSync('ln', ['-s', join(d, 'packages', 'kernel'), join(d, 'node_modules', '@forge', 'kernel')]);
  }
  function gitify(d: string) {
    const git = (...a: string[]) => spawnSync('git', ['-C', d, ...a], { encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 'gate@test');
    git('config', 'user.name', 'gate');
    git('add', '-A');
    git('commit', '-qm', 'fixture');
    return (git('rev-parse', 'HEAD').stdout ?? '').trim();
  }
  function campWithPinOn(parent: string, treeDir: string, relPath: string, head: string) {
    const camp = join(parent, 'camp');
    mkdirSync(join(camp, 'gate-manifests'), { recursive: true });
    const sum = spawnSync('sha256sum', [relPath], { cwd: treeDir, encoding: 'utf8' }).stdout ?? '';
    writeFileSync(join(camp, 'gate-manifests', 'M6-FIX.sha256'), sum);
    writeFileSync(join(camp, 'gate-manifests', 'M6-FIX.counts'), `paths=1 head=${head}\n`);
    return camp;
  }

  const CI_REWRITES_TRACKED = `jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: Build
        run: npm run build
  stories:
    runs-on: ubuntu-latest
    steps:
      - name: Run the harness proof stories
        run: |
          echo SMOKE-OK
          printf 'rewritten-by-stub-story\\n' >> demos/stories/pinned-sample.txt
`;

  test('a stub story that rewrites a PINNED tracked file under demos/stories is restored before the pins check reads it', () => {
    const d = tree(CI_REWRITES_TRACKED);
    mkdirSync(join(d, 'demos', 'stories'), { recursive: true });
    writeFileSync(join(d, 'demos', 'stories', 'pinned-sample.txt'), 'original\n');
    installedInPlace(d);
    const head = gitify(d);
    const parent = mkdtempSync(join(tmpdir(), 'gate-stories-pin-'));
    const campaign = campWithPinOn(parent, d, 'demos/stories/pinned-sample.txt', head);
    try {
      const r = spawnSync('bash', [GATE, d, campaign], {
        encoding: 'utf8',
        env: strippedEnv({ FORGE_CHROMIUM_EXECUTABLE: '/bin/true', FORGE_STORIES_GENERATED_TREES: 'demos/stories' }),
      });
      const out = r.stdout ?? '';
      assert.match(out, /^PASS .*gate-stories\.sh/m, `expected the stories step to pass; got:\n${out}`);
      assert.match(out, /M6-FIX\.sha256: 0 FAILED of 1/, `expected the pin to read clean after restore; got:\n${out}`);
      assert.doesNotMatch(out, /UNDECLARED:\s*M6-FIX/, "the pins check must never see this run's own regenerated bytes");
      assert.equal(gitStatus(d, 'demos/stories'), '', 'the tree must come back exactly as it was found');
    } finally {
      rmSync(d, { recursive: true, force: true });
      rmSync(parent, { recursive: true, force: true });
    }
  });

});
