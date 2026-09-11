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
