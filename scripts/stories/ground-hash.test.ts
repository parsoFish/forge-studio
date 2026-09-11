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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { METHOD_C_CMD, groundManifest, groundChanges, snapshotSiblingGrounds, siblingGroundEscapes, mintedSessionPaths, classifyOwnGroundDrift,} from './ground-hash.mjs';

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
  const clean = classifyOwnGroundDrift(changes, minted);
  assert.equal(clean.undeclared.length, 0, `a green run must stay green: ${clean.undeclared.join(' | ')}`);
  assert.equal(clean.produced.length, 2, 'and its product is still reported, loudly');
});

test('594: A\'s case — an agent writing INTO the ground repo fails the run', () => {
  // Measured twice (§15.327). `.gitignore` and `CLAUDE.md` are nobody's declared
  // product, and no `_logs` entry licences them.
  const minted = ['_architect/2026-09-10T13-54-57-9eaf7fae'];
  const changes = {
    added: ['.forge/agent-run/PROMPT.md', 'brain/themes/x.md', 'roadmap.md'],
    removed: [],
    modified: ['.gitignore', 'CLAUDE.md'],
  };
  const { produced, undeclared } = classifyOwnGroundDrift(changes, minted);
  assert.equal(produced.length, 0);
  assert.equal(undeclared.length, 5, undeclared.join(' | '));
  assert.ok(undeclared.some((l) => l.endsWith('.gitignore')), undeclared.join(' | '));
  assert.ok(undeclared.some((l) => l.endsWith('CLAUDE.md')), undeclared.join(' | '));
});

test('594: a sibling session dir the run did NOT mint is undeclared, not product', () => {
  // D's case: a leftover `_onboarding` from an earlier run sitting in the ground.
  // "It looks like a session dir" is not the test — "this run made it" is.
  const { undeclared } = classifyOwnGroundDrift(
    { added: ['_onboarding/from-a-run-two-days-ago/status.json'], removed: [], modified: [] },
    ['_architect/2026-09-10T13-54-57-9eaf7fae'],
  );
  assert.equal(undeclared.length, 1, 'an unminted session dir must still fail the run');
});

test('594: a path that merely PREFIXES a minted one is not covered by it', () => {
  // `_architect/abc` must not licence `_architect/abcdef`.
  const { undeclared } = classifyOwnGroundDrift(
    { added: ['_architect/abcdef/PLAN.md'], removed: [], modified: [] },
    ['_architect/abc'],
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

  const { produced, undeclared } = classifyOwnGroundDrift(changes, minted);
  assert.deepEqual(undeclared, [], `the run's own session is its product, not drift: ${undeclared.join(' | ')}`);
  assert.equal(produced.length, 2, 'and both files are reported as produced');

  // The control still has to hold in the real shape: something nobody minted.
  writeFileSync(join(ground, 'CLAUDE.md'), 'written by an agent');
  const after = classifyOwnGroundDrift(groundChanges(before, groundManifest(ground)), minted);
  assert.equal(after.undeclared.length, 1, `an unminted write still fails: ${after.undeclared.join(' | ')}`);
  assert.ok(after.undeclared[0].endsWith('CLAUDE.md'), after.undeclared[0]);
});
