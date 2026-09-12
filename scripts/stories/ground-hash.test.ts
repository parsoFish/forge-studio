/**
 * The fence's second dimension: what a run did INSIDE a ground it does not own.
 *
 * Bead `forge-8vfn.6.11.26` / §15.219. `snapshotSiblingWorktrees` lists the
 * immediate CHILDREN of each ignored root, so a whole new ground appearing is
 * visible — but an edit inside a ground that already exists is not, and its own
 * comment said so before the incident proved it. S1 run 8 onboarded the MAIN
 * CHECKOUT's `projects/gitweave` (`adebdb6399d7453d` → `7fb19c79739ddd7c`:
 * `.gitignore` +5, `CLAUDE.md` +3, a whole `.forge/`, `roadmap.md`) and the
 * fence reported nothing, because `projects/gitweave` already existed. What
 * caught it was the launcher's own before/after hash, by hand. This makes that
 * hand check the fence's own.
 *
 * The digest is METHOD C — the campaign's recorded ground references
 * (`adebdb6399d7453d`, `3f4d76708ff073b3`, `2343d907ddb5703f`) are method-C
 * numbers, and a fence that printed a different number for the same tree could
 * not be compared with them. Parity is asserted below against the real
 * pipeline rather than assumed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { METHOD_C_CMD, groundManifest, groundChanges, snapshotSiblingGrounds, siblingGroundEscapes, mintedSessionPaths, classifyOwnGroundDrift, groundIgnoreFromGit, groundIgnoreNoneForTests,} from './ground-hash.mjs';

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ground-hash-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'CLAUDE.md'), 'project instructions\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
  writeFileSync(join(dir, 'src', 'main.py'), 'print("hi")\n');
  // Both excluded by method C — a ground is a real clone and walking these
  // twice a run is exactly the cost the depth-one listing existed to avoid.
  mkdirSync(join(dir, 'node_modules', 'left-pad'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;\n');
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  return dir;
}

/** The literal pipeline the launcher runs, so parity is measured, not claimed. */
function methodCByShell(dir: string): string {
  const out = execFileSync('sh', ['-c', `${METHOD_C_CMD} | sha256sum | cut -c1-16`], { cwd: dir, encoding: 'utf8' });
  return out.trim();
}

test('groundManifest: the digest IS method C — byte-for-byte the number the launcher records', () => {
  const dir = fixture();
  try {
    const m = groundManifest(dir);
    assert.notEqual(m, null, 'a present ground must produce a manifest');
    assert.equal(m!.digest, methodCByShell(dir), 'the fence and the launcher must name the same ground by the same number');
    assert.match(m!.digest, /^[0-9a-f]{16}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('groundManifest: node_modules and .git are excluded — the cost objection the depth-one listing raised', () => {
  const dir = fixture();
  try {
    const files = [...groundManifest(dir)!.files.keys()];
    assert.ok(files.every((f) => !f.includes('node_modules') && !f.includes('.git/')), `excluded paths leaked in: ${files.join(', ')}`);
    // BARE, not `./`-prefixed. `METHOD_C_CMD` is `find . …`, so these arrived
    // with a `./` until S10 run 7 showed what that cost: every other path in the
    // runner is repo-relative and bare, `classifyOwnGroundDrift` compared the two
    // shapes, matched nothing, and failed a run on containment for the session it
    // had just minted. Normalised at the source in `groundManifest`; the digest
    // hashes the raw text stream, so no ground hash moved.
    assert.deepEqual(files.sort(), ['.gitignore', 'CLAUDE.md', 'src/main.py']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('groundManifest: an absent ground is null, not an empty manifest — "never existed" and "emptied" are different findings', () => {
  assert.equal(groundManifest(join(tmpdir(), 'ground-hash-no-such-dir-xyz')), null);
});

test('groundChanges: names the files — a digest alone tells the operator something moved, not what', () => {
  const dir = fixture();
  try {
    const before = groundManifest(dir)!;
    writeFileSync(join(dir, 'CLAUDE.md'), 'project instructions\nplus a gate command\n');
    writeFileSync(join(dir, 'roadmap.md'), '# roadmap\n');
    rmSync(join(dir, 'src', 'main.py'));
    const changes = groundChanges(before, groundManifest(dir)!);
    assert.deepEqual(changes.modified, ['CLAUDE.md']);
    assert.deepEqual(changes.added, ['roadmap.md']);
    assert.deepEqual(changes.removed, ['src/main.py']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('siblingGroundEscapes: a planted edit inside a sibling worktree\'s ground is a finding, naming the file', () => {
  const sibling = mkdtempSync(join(tmpdir(), 'ground-sibling-'));
  try {
    const ground = join(sibling, 'projects', 'gitweave');
    mkdirSync(ground, { recursive: true });
    writeFileSync(join(ground, 'CLAUDE.md'), 'instructions\n');

    const dirs = () => [sibling];
    const before = snapshotSiblingGrounds('gitweave', { dirs });

    // Exactly the shape of S1 run 8: the agent appended the C2 .gitignore block
    // and the gate command to a ground in a tree the run did not own.
    writeFileSync(join(ground, '.gitignore'), '.forge/work-items/\n');
    writeFileSync(join(ground, 'CLAUDE.md'), 'instructions\nrun: pytest\n');

    const found = siblingGroundEscapes('gitweave', before, { dirs });
    assert.equal(found.length, 1, 'the changed ground must be reported');
    assert.equal(found[0].root, sibling);
    assert.deepEqual(found[0].changes.added, ['.gitignore']);
    assert.deepEqual(found[0].changes.modified, ['CLAUDE.md']);
    assert.notEqual(found[0].before, found[0].after, 'the two method-C digests must differ and both be reported');
  } finally {
    rmSync(sibling, { recursive: true, force: true });
  }
});

test('siblingGroundEscapes: an UNTOUCHED ground is not a finding — the positive control', () => {
  const sibling = mkdtempSync(join(tmpdir(), 'ground-sibling-clean-'));
  try {
    const ground = join(sibling, 'projects', 'gitweave');
    mkdirSync(ground, { recursive: true });
    writeFileSync(join(ground, 'CLAUDE.md'), 'instructions\n');
    const dirs = () => [sibling];
    const before = snapshotSiblingGrounds('gitweave', { dirs });
    assert.deepEqual(siblingGroundEscapes('gitweave', before, { dirs }), []);
  } finally {
    rmSync(sibling, { recursive: true, force: true });
  }
});

test('siblingGroundEscapes: a ground APPEARING in a tree that had none is a finding too', () => {
  const sibling = mkdtempSync(join(tmpdir(), 'ground-sibling-new-'));
  try {
    const dirs = () => [sibling];
    const before = snapshotSiblingGrounds('gitweave', { dirs });
    const ground = join(sibling, 'projects', 'gitweave');
    mkdirSync(ground, { recursive: true });
    writeFileSync(join(ground, 'CLAUDE.md'), 'planted\n');
    const found = siblingGroundEscapes('gitweave', before, { dirs });
    assert.equal(found.length, 1);
    assert.equal(found[0].before, null, 'the ground was absent before');
    assert.deepEqual(found[0].changes.added, ['CLAUDE.md']);
  } finally {
    rmSync(sibling, { recursive: true, force: true });
  }
});

test('siblingGroundEscapes: with no ground declared the fence asks nothing — a story without a ground has none to protect', () => {
  assert.deepEqual(siblingGroundEscapes(null, new Map(), { dirs: () => ['/nonexistent'] }), []);
});

/**
 * The run's OWN ground — T1 ruling 594. The fence proves the ground is unchanged
 * in every OTHER worktree; nobody checked the one the run is using, and three
 * lanes each paid a run to find that gap in a different place.
 */
test('594: the run\'s own product is derived from what it MINTED, never from a list', () => {
  const logs = mkdtempSync(join(tmpdir(), 'forge-logs-'));
  const session = (name: string) => {
    mkdirSync(join(logs, name), { recursive: true });
    writeFileSync(join(logs, name, 'events.jsonl'), '{}');
  };
  session('_architect-2026-08-03T01-09-32');
  session('_architect-2026-09-10T13-54-57-9eaf7fae');
  session('_demo-abc123');
  const before = ['_architect-2026-08-03T01-09-32', 'sessions'];
  const after = [...before, '_architect-2026-09-10T13-54-57-9eaf7fae', '_demo-abc123'];

  assert.deepEqual(mintedSessionPaths(before, after, logs), [
    '_architect/2026-09-10T13-54-57-9eaf7fae',
    '_demo/abc123',
  ]);
  // A list of allowed directory names goes stale silently; this cannot, because
  // it is read from the run's own evidence. Nothing minted, nothing allowed.
  assert.deepEqual(mintedSessionPaths(before, before, logs), []);

  // THE NAME SHAPE IS NOT ENOUGH, and this assertion is why the rule is not the
  // regex alone: the runner's OWN `_logs/_story-red-evidence` parses as kind
  // `story`, id `red-evidence`, and would otherwise have licensed a
  // `_story/red-evidence` path in the ground that no session ever writes.
  mkdirSync(join(logs, '_story-red-evidence'), { recursive: true });
  assert.deepEqual(mintedSessionPaths([], ['_story-red-evidence', 'notes.txt'], logs), []);
});

test('594: the run\'s own product is reported, and anything else FAILS the run', () => {
  // Run 5's real shape: the architect wrote its plan into the ground, which is
  // the product WORKING. Failing on it would fail every green run, and
  // nine-green is the exit criterion.
  const minted = ['_architect/2026-09-10T13-54-57-9eaf7fae'];
  const changes = {
    added: [
      '_architect/2026-09-10T13-54-57-9eaf7fae/PLAN.md',
      '_architect/2026-09-10T13-54-57-9eaf7fae/manifests/INIT-1.md',
    ],
    removed: [],
    modified: [],
  };
  const clean = classifyOwnGroundDrift(changes, minted, new Map(), groundIgnoreNoneForTests());
  assert.equal(clean.undeclared.length, 0, `a green run must stay green: ${clean.undeclared.join(' | ')}`);
  assert.equal(clean.produced.length, 2, 'and its product is still reported, loudly');
});

test('594/663: A\'s case — a ground write NO minted session declared fails the run', () => {
  // Measured twice (§15.327). Ruling 663 narrowed what "declared" means rather
  // than loosening it: a write is the product only if the session that made it
  // SAYS SO in its own event log. Here nothing does — the writes-by-session map
  // is empty — so all five still fail, exactly as before.
  const minted = ['_architect/2026-09-10T13-54-57-9eaf7fae'];
  const changes = {
    added: ['.forge/agent-run/PROMPT.md', 'brain/themes/x.md', 'roadmap.md'],
    removed: [],
    modified: ['.gitignore', 'CLAUDE.md'],
  };
  const { produced, undeclared } = classifyOwnGroundDrift(changes, minted, new Map(), groundIgnoreNoneForTests());
  assert.equal(produced.length, 0);
  assert.equal(undeclared.length, 5, undeclared.join(' | '));
  assert.ok(undeclared.some((l) => l.startsWith('M .gitignore ')), undeclared.join(' | '));
  assert.ok(undeclared.some((l) => l.startsWith('M CLAUDE.md ')), undeclared.join(' | '));

  // The 663 converse, held beside it so the pair cannot drift: let ONE minted
  // session's log declare `CLAUDE.md` and that line — and only that line —
  // moves, naming the session that accounts for it.
  const declared = classifyOwnGroundDrift(changes, minted, new Map([[minted[0], ['CLAUDE.md']]]), groundIgnoreNoneForTests());
  assert.deepEqual(declared.produced, [`M CLAUDE.md — written by ${minted[0]}`]);
  assert.equal(declared.undeclared.length, 4, declared.undeclared.join(' | '));
});

test('594: a sibling session dir the run did NOT mint is undeclared, not product', () => {
  // D's case: a leftover `_onboarding` from an earlier run sitting in the ground.
  // "It looks like a session dir" is not the test — "this run made it" is.
  const { undeclared } = classifyOwnGroundDrift(
    { added: ['_onboarding/from-a-run-two-days-ago/status.json'], removed: [], modified: [] },
    ['_architect/2026-09-10T13-54-57-9eaf7fae'],
    new Map(),
    groundIgnoreNoneForTests(),
  );
  assert.equal(undeclared.length, 1, 'an unminted session dir must still fail the run');
});

test('594: a path that merely PREFIXES a minted one is not covered by it', () => {
  // `_architect/abc` must not licence `_architect/abcdef`.
  const { undeclared } = classifyOwnGroundDrift(
    { added: ['_architect/abcdef/PLAN.md'], removed: [], modified: [] },
    ['_architect/abc'],
    new Map(),
    groundIgnoreNoneForTests(),
  );
  assert.equal(undeclared.length, 1, 'prefix matching would licence a directory the run never minted');
});

test('594 REGRESSION: the ownership test runs against the shape `groundManifest` REALLY emits', () => {
  // RED BEFORE THE FIX, and bought by S10 run 7 at $3.2562.
  //
  // Every door test above hand-wrote its changed paths as `_architect/<id>/…`.
  // `groundManifest` shells `find .`, so what it emitted was
  // `./_architect/<id>/…`, and the ownership test — `p === m ||
  // p.startsWith(m + '/')` — matched none of it. The run reported all nine files
  // of the architect session it had just minted as UNDECLARED and failed itself
  // on containment: the exact false red ruling 594 chose (a) to avoid, shipped
  // by the check whose whole job is noticing when something wrote where it
  // should not have.
  //
  // A HAND-WRITTEN FIXTURE IS A SECOND IMPLEMENTATION OF THE THING UNDER TEST,
  // AND IT IS ALWAYS THE ONE THAT AGREES WITH YOU. So this test does not
  // describe the shape — it drives the REAL function over a real tree and feeds
  // the real output through.
  const ground = mkdtempSync(join(tmpdir(), 'forge-own-ground-'));
  // A ground always has files. It matters here: `METHOD_C_CMD` ends in
  // `xargs -0 sha256sum`, and with no input `sha256sum` reads STDIN and reports
  // one phantom entry named `-`, so an EMPTY dir's manifest is not empty. Not
  // reachable in production — no ground is empty — and deliberately not fixed in
  // this PR, because `METHOD_C_CMD` is the recipe the ledger's INTENTs quote and
  // lanes run by hand; changing it belongs in its own change, not folded into a
  // regression fix. Filed in `_1.0/plans/M6-C-post-run-integrity.md`.
  writeFileSync(join(ground, 'README.md'), 'the ground');
  const before = groundManifest(ground);

  const runId = '_architect-2026-09-10T23-10-42-0f5e5f27';
  mkdirSync(join(ground, '_architect', '2026-09-10T23-10-42-0f5e5f27', 'manifests'), { recursive: true });
  writeFileSync(join(ground, '_architect', '2026-09-10T23-10-42-0f5e5f27', 'PLAN.md'), '# plan');
  writeFileSync(join(ground, '_architect', '2026-09-10T23-10-42-0f5e5f27', 'manifests', 'INIT-1.md'), 'x');

  const changes = groundChanges(before, groundManifest(ground));
  // The contract the fix establishes: names are repo-relative and bare, like
  // every other path in the runner. Pinned here so a future `find` change that
  // re-introduces a prefix fails loudly instead of silently un-owning every
  // session again.
  assert.ok(
    changes.added.length > 0 && changes.added.every((p) => !p.startsWith('./')),
    `manifest names must be bare: ${JSON.stringify(changes.added)}`,
  );

  const logs = mkdtempSync(join(tmpdir(), 'forge-own-logs-'));
  mkdirSync(join(logs, runId), { recursive: true });
  writeFileSync(join(logs, runId, 'events.jsonl'), '{}');
  const minted = mintedSessionPaths([], [runId], logs);

  const { produced, undeclared } = classifyOwnGroundDrift(changes, minted, new Map(), groundIgnoreNoneForTests());
  assert.deepEqual(undeclared, [], `the run's own session is its product, not drift: ${undeclared.join(' | ')}`);
  assert.equal(produced.length, 2, 'and both files are reported as produced');

  // The control still has to hold in the real shape: something nobody minted.
  writeFileSync(join(ground, 'CLAUDE.md'), 'written by an agent');
  const after = classifyOwnGroundDrift(groundChanges(before, groundManifest(ground)), minted, new Map(), groundIgnoreNoneForTests());
  assert.equal(after.undeclared.length, 1, `an unminted write still fails: ${after.undeclared.join(' | ')}`);
  assert.ok(after.undeclared[0].startsWith('A CLAUDE.md '), after.undeclared[0]);
});

// ---------------------------------------------------------------------------
// 7.6.38 — the ground's own ignore rules (T1 ruling 756(ii))
// ---------------------------------------------------------------------------

test('7.6.38: an unattributed path the GROUND ignores is its own class, not undeclared', () => {
  // S1 run 8's real shape: 4500 undeclared paths, every one gitweave's own
  // toolchain — `.venv/` 4442, `__pycache__/` 49, `.pytest_cache/` 5,
  // `infra/.terraform*` 4 — built by the demo builder running `pytest` to learn
  // what to demo. Method C excludes `node_modules` and `.git`: a
  // JavaScript-shaped exclusion list judging a Python-and-Terraform ground.
  const changes = {
    added: ['.venv/bin/pip', 'tests/__pycache__/test_structure.pyc', 'roadmap.md'],
    removed: [],
    modified: [],
  };
  const ignore = {
    isIgnored: (p: string) => p.startsWith('.venv/') || p.includes('__pycache__/'),
    source: 'gitweave/.gitignore',
  };
  const r = classifyOwnGroundDrift(changes, [], new Map(), ignore);
  assert.deepEqual(r.ignored, [
    'A .venv/bin/pip — ignored by the ground (gitweave/.gitignore)',
    'A tests/__pycache__/test_structure.pyc — ignored by the ground (gitweave/.gitignore)',
  ]);
  // The one path the ground does NOT ignore is still a containment failure.
  assert.deepEqual(r.undeclared, ['A roadmap.md — nothing this run minted accounts for it']);
  assert.equal(r.ignoreSource, 'gitweave/.gitignore');
});

test('7.6.38: ATTRIBUTION WINS — a forge write into an ignored path stays PRODUCED', () => {
  // The load-bearing ordering, and the reason the ignore file cannot launder a
  // breach. The ground's ignore rules say who is EXPECTED to have written a
  // path — "a human's toolchain writes here" — which is a different claim from
  // "forge did not write here". The two coincide for gitweave's 4500 and come
  // apart the instant a forge writer touches an ignored path.
  const changes = { added: ['.venv/bin/forge-wrote-this'], removed: [], modified: [] };
  const ignore = { isIgnored: () => true, source: 'x/.gitignore' };

  const attributed = classifyOwnGroundDrift(
    changes, [], new Map([['_demo/abc', ['.venv/bin/forge-wrote-this']]]), ignore,
  );
  assert.deepEqual(attributed.produced, ['A .venv/bin/forge-wrote-this — written by _demo/abc']);
  assert.equal(attributed.ignored.length, 0, 'an attributed write is never demoted to the ignored class');

  // Same path, same ignore rule, nobody claims it → the ignored class takes it.
  const orphan = classifyOwnGroundDrift(changes, [], new Map(), ignore);
  assert.equal(orphan.produced.length, 0);
  assert.equal(orphan.ignored.length, 1);
});

test('7.6.38: a session-dir home also beats the ignore rule', () => {
  const changes = { added: ['_demo/abc/generations/1/DEMO.html'], removed: [], modified: [] };
  const r = classifyOwnGroundDrift(changes, ['_demo/abc'], new Map(), {
    isIgnored: () => true, source: 'x/.gitignore',
  });
  assert.equal(r.produced.length, 1);
  assert.equal(r.ignored.length, 0);
});

test('7.6.38: the ignored class is REPORTED AT ZERO — e8dn, not a silent absence', () => {
  // `0 ignored` and "no ignore check ran" must never render the same. C's run 12
  // printed `0` from `ls <path that has never existed> | wc -l` and that zero
  // reached the campaign ledger as a measurement.
  const changes = { added: ['roadmap.md'], removed: [], modified: [] };
  const r = classifyOwnGroundDrift(changes, [], new Map(), {
    isIgnored: () => false, source: 'gitweave/.gitignore',
  });
  assert.deepEqual(r.ignored, [], 'the class EXISTS and is empty');
  assert.equal(r.ignoreSource, 'gitweave/.gitignore', 'and it still names the rule that produced the zero');
});

test('7.6.38: the ignore argument is REQUIRED — a caller cannot skip the check silently', () => {
  // Same reason the writes-by-session map has no default: a caller that skipped
  // the check would report a working run as a containment failure and look
  // exactly like a passing one.
  const changes = { added: ['x'], removed: [], modified: [] };
  // The message must be the REFUSAL, not any throw. Deleting the guard still
  // throws — `groundIgnore.isIgnored` on undefined is a TypeError whose text
  // contains "isIgnored", so a /ignore/i door passes against no guard at all.
  // Measured: that door stayed green under the mutation that removes the check.
  assert.throws(
    () => (classifyOwnGroundDrift as unknown as (...a: unknown[]) => unknown)(changes, [], new Map()),
    (e: unknown) => {
      const m = (e as Error).message;
      assert.match(m, /a ground-ignore classifier is REQUIRED/);
      assert.match(m, /groundIgnoreNoneForTests/, 'and it names the explicit opt-out');
      return true;
    },
  );
  // A malformed classifier is refused too, not just an absent one.
  assert.throws(
    () => (classifyOwnGroundDrift as unknown as (...a: unknown[]) => unknown)(changes, [], new Map(), {}),
    /a ground-ignore classifier is REQUIRED/,
  );
});

test('7.6.38: groundIgnoreFromGit is INDEX-AWARE — a tracked file matching a pattern is NOT ignored', () => {
  // The one-flag difference T1 asked to pin. `--no-index` calls a tracked
  // `*.pyc` ignored; plain `check-ignore` does not, because a tracked file is
  // part of the project's state whatever the patterns say. Without this door,
  // adding `--no-index` would quietly reclassify tracked files as toolchain
  // noise and nothing would go red.
  const g = mkdtempSync(join(tmpdir(), 'forge-ignore-'));
  const git = (...a: string[]) => execFileSync('git', ['-C', g, ...a], { encoding: 'utf8' });
  git('init', '-q', '.');
  git('config', 'user.email', 'a@b');
  git('config', 'user.name', 'c');
  writeFileSync(join(g, '.gitignore'), 'build/\n*.pyc\n');
  mkdirSync(join(g, 'src'), { recursive: true });
  mkdirSync(join(g, 'build'), { recursive: true });
  writeFileSync(join(g, 'src/keep.txt'), 'k');
  writeFileSync(join(g, 'src/tracked.pyc'), 'q');   // matches *.pyc but is COMMITTED
  writeFileSync(join(g, 'build/out.o'), 'o');
  git('add', '-f', '.gitignore', 'src/keep.txt', 'src/tracked.pyc');
  git('commit', '-qm', 'init');

  const ig = groundIgnoreFromGit(g);
  assert.equal(ig.isIgnored('build/out.o'), true, 'untracked + matching → ignored');
  assert.equal(ig.isIgnored('src/keep.txt'), false, 'tracked + not matching → not ignored');
  assert.equal(ig.isIgnored('src/tracked.pyc'), false, 'TRACKED and matching → NOT ignored (never --no-index)');

  // The removed-path case, which is why this is `check-ignore` and not
  // `ls-files -co --exclude-standard`: that lists the not-ignored set of files
  // that EXIST, so a deleted path is absent from it for the same reason an
  // ignored one is — and a run that deleted a real tracked file would have the
  // deletion classified as ignored and dropped out of the undeclared count.
  rmSync(join(g, 'build/out.o'));
  assert.equal(ig.check(['build/out.o']).has('build/out.o'), true, 'still answers after the file is gone');
  assert.equal(ig.check(['never/existed.pyc']).has('never/existed.pyc'), true);

  rmSync(g, { recursive: true, force: true });
});

test('7.6.38: groundIgnoreFromGit REFUSES outside a git repo — a failed read is not a state', () => {
  // The fail-open direction silently converts every unattributed path into a
  // clean one, which is the single move this change must not make. rc 128 is
  // "not a git repository"; rc 0 and 1 are the only answers.
  const notARepo = mkdtempSync(join(tmpdir(), 'forge-norepo-'));
  // The premise the door rests on, asserted rather than assumed: if TMPDIR ever
  // sat inside a repo, git would answer instead of refusing and this door would
  // silently become a no-op. Checked here so a failure reads as "the premise
  // broke" and not as "the refusal regressed".
  let probe = '';
  try {
    probe = execFileSync('git', ['-C', notARepo, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    probe = 'not-a-repo'; // rev-parse exits 128 outside a work tree, which is the premise holding
  }
  assert.notEqual(probe, 'true', `premise broken: ${notARepo} is inside a git work tree`);
  const ig = groundIgnoreFromGit(notARepo);
  assert.throws(() => ig.isIgnored('anything'), (e: unknown) => {
    assert.match((e as Error).message, /Refusing rather than reporting an unchecked remainder as clean/);
    assert.match((e as Error).message, /exited 128|not a git repository/i, 'and it names the status it got');
    return true;
  });
  rmSync(notARepo, { recursive: true, force: true });
});

test('7.6.38: an empty path list asks git nothing and returns nothing', () => {
  // Cheap, but it is the difference between "no paths to check" and a spawn
  // whose empty stdin git could answer however it likes.
  const ig = groundIgnoreFromGit(mkdtempSync(join(tmpdir(), 'forge-empty-')));
  assert.equal(ig.check([]).size, 0);
});

test('7.6.38: no PRODUCTION story module may call groundIgnoreNoneForTests', () => {
  // C's objection, made structural. In a real call site the test-only opt-out
  // would be a one-word way to switch the IGNORED-BY-GROUND class off while
  // every other door still passed — constraint 3 defeated by the export written
  // to enforce it. The rename makes it visible; this makes it fail.
  //
  // It scans the production story scripts, not a list of known callers: a list
  // goes stale the moment someone adds a module, which is the same defect class
  // the bead is about.
  const dir = new URL('.', import.meta.url).pathname;
  const production = readdirSync(dir)
    .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
    .filter((f) => f !== 'ground-hash.mjs'); // its definition site
  assert.ok(production.length >= 3, `expected several production story modules, saw ${production.length}`);

  const offenders = production.filter((f) =>
    readFileSync(join(dir, f), 'utf8').includes('groundIgnoreNoneForTests'));
  assert.deepEqual(
    offenders, [],
    `production modules must pass a REAL ignore classifier (groundIgnoreFromGit): ${offenders.join(', ')}`,
  );

  // The positive control — without it this passes just as well when the scan is
  // pointed at an empty directory or the substring is misspelled.
  const selfCheck = readdirSync(dir).filter((f) =>
    f.endsWith('.test.ts') && readFileSync(join(dir, f), 'utf8').includes('groundIgnoreNoneForTests'));
  assert.ok(selfCheck.length > 0, 'the scan can find the symbol when it IS present');
});
