/**
 * `gate.sh`'s PIN_MANIFESTS line — which manifests a pin verdict is about.
 *
 * ITS OWN FILE BECAUSE `gate.test.ts` WAS AT 799 OF 800. One line of headroom,
 * and these two tests are 77 lines. §15.412 is the rule and this is its second
 * live instance: a cap passed with single-digit headroom is a deferred failure,
 * and the person who trips it is whoever adds the next test. Splitting on the
 * concern — `gate.sh`'s STEP LIST and log provenance there, its PIN BLOCK's
 * self-identification here — is still right when either file grows again;
 * splitting on the line count would land wherever 800 happened to fall.
 *
 * The fixture helpers below are deliberately duplicated rather than exported
 * from `gate.test.ts`: exporting them would edit a file this change otherwise
 * leaves byte-identical to main, and twenty lines of throwaway-tree setup is a
 * cheaper price than a pin declaration on a file that did not really move.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'gate.sh');

/** 649: this file must not inherit the lock vars, or an outer gate's exports
 *  would decide what the inner one measures. */
function gate(...args: string[]) {
  const { FORGE_SUITE_LOCK: _suite, FORGE_RUN_LOCK: _run, ...env } = process.env;
  const r = spawnSync('bash', [GATE, ...args], { encoding: 'utf8', env });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}
/** A throwaway tree with its own ci.yml — the point is that the gate reads THIS one. */
function tree(ci: string) {
  const d = mkdtempSync(join(tmpdir(), 'gate-pinfp-tree-'));
  mkdirSync(join(d, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(d, '.github', 'workflows', 'ci.yml'), ci);
  return d;
}
/** The gate voids any verdict on a tree whose `@forge/kernel` resolves outside
 *  it (§15.13), so a fixture that wants to reach the pin block must own its
 *  install. */
function installedInPlace(d: string) {
  mkdirSync(join(d, 'packages', 'kernel'), { recursive: true });
  mkdirSync(join(d, 'node_modules', '@forge'), { recursive: true });
  symlinkSync(join(d, 'packages', 'kernel'), join(d, 'node_modules', '@forge', 'kernel'));
}

describe('gate.sh — the pin block says WHICH manifests it measured (forge-8vfn.7.6.32)', () => {
  // The incident, in one sentence: M6-C amended `M6-C.sha256` fourteen seconds
  // after M6-D's `pin-precheck` read the gate's pin block, and the precheck
  // reported two undeclared failures that re-derived `OK` on a direct check
  // seconds later. Neither instrument was wrong; each was correct about a
  // different instant.
  //
  // The asymmetry is why this is P2 and not tidy-up. That instance printed a
  // false REFUSAL — loud, self-correcting, costs a re-gate. Had the amendment
  // ADDED rows rather than rehashed them, the precheck would have printed
  // `PIN_PRECHECK_OK` against a manifest that already disagreed with the tree,
  // and the merge would have gone through on it.
  //
  // THIS TEST'S FIRST DRAFT COMPUTED THE FINGERPRINT ITSELF AND PASSED WITHOUT
  // `gate.sh` CHANGING AT ALL — it asserted `sha256sum`, not the gate. §15.400's
  // question is not "does it fail when the fix is reverted" but "what else could
  // make this assertion pass", and the answer was "anything". It now runs a real
  // gate and reads the line out of the pin block.
  const PIN_CI = `name: CI
on: [push]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: Trivial
        run: echo pin-fingerprint-fixture
`;

  function campaignWith(counts: string) {
    const camp = mkdtempSync(join(tmpdir(), 'gate-pinfp-'));
    mkdirSync(join(camp, 'gate-manifests'), { recursive: true });
    writeFileSync(join(camp, 'gate-manifests', 'X.sha256'), `${'0'.repeat(64)}  README.md\n`);
    writeFileSync(join(camp, 'gate-manifests', 'X.counts'), counts);
    return camp;
  }
  const fingerprintOf = (out: string) => out.match(/^PIN_MANIFESTS=([0-9a-f]{16})$/m)?.[1] ?? null;

  test('the gate PRINTS PIN_MANIFESTS in its pin block', () => {
    const d = tree(PIN_CI);
    installedInPlace(d);
    const camp = campaignWith('paths=1 head=deadbeef\n');
    try {
      const r = gate(d, camp);
      assert.match(r.out, /^== pins ==$/m, 'the pin block must be present at all');
      assert.notEqual(fingerprintOf(r.out), null,
        `the pin block must carry PIN_MANIFESTS=<16 hex>; got:\n${r.out}`);
    } finally {
      rmSync(d, { recursive: true, force: true });
      rmSync(camp, { recursive: true, force: true });
    }
  });

  test('a .counts edit MOVES the fingerprint — head= decides whether a failing set blocks or proceeds', () => {
    // Scoping the fingerprint to `.sha256` alone was M6-D's proposal and M6-C's
    // catch: `pin-precheck.sh:107` reads `${m%.sha256}.counts` for `head=`, and
    // `:129` uses it to choose between rc 4 (unreadable across skew, proceeds
    // loudly) and rc 3 (undeclared drift, blocks). Opposite outcomes at the
    // merge slot, so a `.counts` edit must move this number.
    const d = tree(PIN_CI);
    installedInPlace(d);
    const camp = campaignWith('paths=1 head=deadbeef\n');
    try {
      const before = fingerprintOf(gate(d, camp).out);
      assert.notEqual(before, null, 'baseline fingerprint must be printed');

      writeFileSync(join(camp, 'gate-manifests', 'X.counts'), 'paths=1 head=cafe1234\n');
      const after = fingerprintOf(gate(d, camp).out);

      assert.notEqual(after, null, 'fingerprint must still be printed after the edit');
      assert.notEqual(after, before, 'a .counts edit must move the fingerprint');
    } finally {
      rmSync(d, { recursive: true, force: true });
      rmSync(camp, { recursive: true, force: true });
    }
  });
});

describe('gate.sh — a pin declaration that names nothing REFUSES (forge-8vfn.7.6.43)', () => {
  // C's case, relayed at ruling 773: `--expect-pin-fail M6-C:tests/stories/S7.story.mjs`
  // was accepted without a diagnostic although only `M1-C-S7` pins that path. It
  // surfaced at all only because a REAL undeclared failure happened to sit beside
  // it. A declaration is the PR's claim about ITSELF, so one matching nothing is
  // today indistinguishable from one that matched — and `--expect-pin-fail` is
  // the flag that makes a red gate green.
  //
  // C's taxonomy is the reason the message must say WHICH: a refusal that catches
  // only the third leaves two ways to write a declaration that looks like cover.
  const DECL_CI = `name: CI
on: [push]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: Trivial
        run: echo decl-fixture
`;

  /** Two manifests: A pins one path, B pins another. */
  function campaign() {
    const camp = mkdtempSync(join(tmpdir(), 'gate-decl-'));
    mkdirSync(join(camp, 'gate-manifests'), { recursive: true });
    writeFileSync(join(camp, 'gate-manifests', 'M-A.sha256'), `${'0'.repeat(64)}  alpha.txt\n`);
    writeFileSync(join(camp, 'gate-manifests', 'M-A.counts'), 'paths=1 head=deadbeef owner=M-A\n');
    writeFileSync(join(camp, 'gate-manifests', 'M-B.sha256'), `${'1'.repeat(64)}  beta.txt\n`);
    writeFileSync(join(camp, 'gate-manifests', 'M-B.counts'), 'paths=1 head=deadbeef owner=M-B\n');
    return camp;
  }
  const run = (decl: string) => {
    const d = tree(DECL_CI);
    installedInPlace(d);
    const camp = campaign();
    try {
      return { ...gate(d, camp, '--expect-pin-fail', decl), camp };
    } finally {
      rmSync(d, { recursive: true, force: true });
      rmSync(camp, { recursive: true, force: true });
    }
  };

  test('class 1 — the MANIFEST does not exist: refused, and says so', () => {
    const r = run('M-NOPE:alpha.txt');
    assert.notEqual(r.status, 0, `expected a refusal, got rc 0:\n${r.out}${r.err}`);
    assert.match(r.out + r.err, /declaration names nothing: M-NOPE:alpha\.txt/);
    assert.match(r.out + r.err, /no manifest/i, 'and names WHICH of the three it is');
  });

  test('class 2 — the PATH is in no manifest at all: refused, and says so', () => {
    const r = run('M-A:typo.txt');
    assert.notEqual(r.status, 0, `expected a refusal, got rc 0:\n${r.out}${r.err}`);
    assert.match(r.out + r.err, /declaration names nothing: M-A:typo\.txt/);
    assert.match(r.out + r.err, /no manifest pins/i, 'distinguished from the wrong-pair case');
  });

  test('class 3 — real manifest, real path, WRONG PAIR: refused, and names the right owner', () => {
    // C's actual case. The most dangerous of the three, because both halves are
    // real and a reader checking either one in isolation finds it.
    const r = run('M-A:beta.txt');
    assert.notEqual(r.status, 0, `expected a refusal, got rc 0:\n${r.out}${r.err}`);
    // SCOPED TO THE DECLARATION LINE, not the whole output. The first draft
    // asserted `/M-B/` against everything the gate printed — and the pin block
    // lists every manifest by name, so `M-B` was always present and the
    // assertion passed against a gate that had collapsed the wrong-pair case
    // into the typo message. Mutation found it; §15.400's question is "what else
    // could make this pass", and the answer was "the listing above it".
    const line = (r.out + r.err).split('\n').find((l) => l.includes('declaration names nothing')) ?? '';
    assert.match(line, /declaration names nothing: M-A:beta\.txt/, `${r.out}${r.err}`);
    assert.match(line, /M-B/, 'the LINE names the manifest that DOES pin it, so the fix is one edit');
    assert.doesNotMatch(line, /at all|typo/, 'and is not the typo wording — these are different findings');
  });

  test('a manifest-level declaration naming a real manifest is ACCEPTED', () => {
    // The positive control. Without it every assertion above passes equally well
    // against a gate that refuses every declaration ever written.
    const d = tree(DECL_CI);
    installedInPlace(d);
    const camp = campaign();
    try {
      const r = gate(d, camp, '--expect-pin-fail', 'M-A');
      assert.doesNotMatch(r.out + r.err, /declaration names nothing/,
        `a real manifest must not be refused:\n${r.out}${r.err}`);
    } finally {
      rmSync(d, { recursive: true, force: true });
      rmSync(camp, { recursive: true, force: true });
    }
  });

  test('a path-level declaration that DOES match a pinned row is ACCEPTED', () => {
    const d = tree(DECL_CI);
    installedInPlace(d);
    const camp = campaign();
    try {
      const r = gate(d, camp, '--expect-pin-fail', 'M-A:alpha.txt');
      assert.doesNotMatch(r.out + r.err, /declaration names nothing/,
        `a real pair must not be refused:\n${r.out}${r.err}`);
    } finally {
      rmSync(d, { recursive: true, force: true });
      rmSync(camp, { recursive: true, force: true });
    }
  });
});

/**
 * Per-manifest fingerprints — bead `forge-8vfn.7.6.80`, T1 ruling 879.
 *
 * WHY. `PIN_MANIFESTS` is one number over EVERY manifest, so any lane's
 * reconcile moves it and `pin-precheck` refuses every merge whose gate finished
 * before that reconcile. Measured on three consecutive merges in one evening —
 * #701 (`9cfcb49c…` → `2ee2401b…`), #705 (`5718043768091866` → `0c3fbf11…`) and
 * one of lane A's — and in all of them the refusing lane's OWN manifest was
 * untouched. The refusal is correct by its own rule and the rule is too wide:
 * a merge's pin precondition is about the manifests it declares and touches,
 * not about every manifest on the box. With three lanes merging, a four-minute
 * gate almost always lands into a changed aggregate, and the retry starves.
 *
 * A per-manifest line is what makes the narrower comparison possible at all —
 * the precheck cannot compare a relevant SUBSET against a single aggregate
 * number. The aggregate stays: it is still the honest one-line answer to "did
 * anything move", and a log carrying only the aggregate must remain readable
 * until every lane's gate emits the new lines.
 */
describe('gate.sh — the pin block fingerprints EACH manifest, not only the set (forge-8vfn.7.6.80)', () => {
  const PIN_CI = `name: CI
on: [push]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: Trivial
        run: echo per-manifest-fixture
`;
  /** Two manifests, so "only the edited one moves" is observable at all. */
  function campaignWithTwo() {
    const camp = mkdtempSync(join(tmpdir(), 'gate-permanifest-'));
    mkdirSync(join(camp, 'gate-manifests'), { recursive: true });
    for (const n of ['ALPHA', 'BETA']) {
      writeFileSync(join(camp, 'gate-manifests', `${n}.sha256`), `${'0'.repeat(64)}  README.md\n`);
      writeFileSync(join(camp, 'gate-manifests', `${n}.counts`), `paths=1 head=deadbeef owner=${n}\n`);
    }
    return camp;
  }
  const lineFor = (out: string, name: string) =>
    out.match(new RegExp(`^PIN_MANIFEST ${name}=([0-9a-f]{16})$`, 'm'))?.[1] ?? null;

  test('7.6.80: one PIN_MANIFEST line per manifest, beside the aggregate', () => {
    const d = tree(PIN_CI);
    installedInPlace(d);
    const camp = campaignWithTwo();
    try {
      const r = gate(d, camp);
      assert.match(r.out, /^PIN_MANIFESTS=[0-9a-f]{16}$/m, 'the aggregate stays — a log with only it must remain readable');
      assert.notEqual(lineFor(r.out, 'ALPHA'), null, `expected PIN_MANIFEST ALPHA=<16 hex>; got:\n${r.out}`);
      assert.notEqual(lineFor(r.out, 'BETA'), null, 'and one for every other manifest');
    } finally {
      rmSync(d, { recursive: true, force: true });
      rmSync(camp, { recursive: true, force: true });
    }
  });

  test('7.6.80: editing ONE manifest moves ONLY its line — the property the narrower comparison rests on', () => {
    const d = tree(PIN_CI);
    installedInPlace(d);
    const camp = campaignWithTwo();
    try {
      const before = gate(d, camp).out;
      const alphaBefore = lineFor(before, 'ALPHA');
      const betaBefore = lineFor(before, 'BETA');
      assert.notEqual(alphaBefore, null);
      assert.notEqual(betaBefore, null);

      // A sibling reconciles: exactly what refused #701 and #705.
      writeFileSync(join(camp, 'gate-manifests', 'BETA.counts'), 'paths=1 head=cafe1234 owner=BETA\n');
      const after = gate(d, camp).out;

      assert.notEqual(lineFor(after, 'BETA'), betaBefore, "the reconciled manifest's fingerprint must move");
      assert.equal(
        lineFor(after, 'ALPHA'), alphaBefore,
        'and the untouched one must NOT — without this, a per-manifest line is just the aggregate written N times ' +
          'and the relevant-set comparison it exists to enable is impossible',
      );
    } finally {
      rmSync(d, { recursive: true, force: true });
      rmSync(camp, { recursive: true, force: true });
    }
  });
});
