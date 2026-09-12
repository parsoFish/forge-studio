/**
 * The door for `bead-preflight.sh` — `forge-8vfn.7.6.66`.
 *
 * §15.464 was written after lane M6-D closed lane M6-C's `forge-8vfn.7.6.56`
 * with its own reason text, having invented the id. The lane then did it again,
 * to M6-C's `7.6.60`, with §15.464 already on the record and named for the
 * first instance. A rule you have to remember is not a mechanism.
 *
 * The test that matters is the third one: an id that RESOLVES to a real record
 * belonging to somebody else must be refused, distinctly, and not merely
 * printed for a human to look at. Printing is what the lane version did, and
 * printing is what failed twice — the operator reads the title they expected.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(
  import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'bead-preflight.sh',
);

/** A stand-in for `bd`, so this door needs no beads database. It answers for
 *  exactly one id and fails for every other, which is the real tool's shape at
 *  the only boundary this script has. */
function stubBd(dir: string, knownId: string, body: string): string {
  const path = join(dir, 'bd-stub.sh');
  writeFileSync(
    path,
    `#!/usr/bin/env bash\n` +
      `[ "$1" = show ] || { echo "stub: unexpected \\"$1\\"" >&2; exit 9; }\n` +
      `[ "$2" = ${JSON.stringify(knownId)} ] || { echo "bead not found: $2" >&2; exit 1; }\n` +
      `cat <<'EOF'\n${body}\nEOF\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

function preflight(bd: string, ...args: string[]) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, BEAD_PREFLIGHT_BD: bd },
  });
}

describe('bead-preflight.sh — an id that resolves is not an id that is yours', () => {
  let dir = '';
  const REAL = 'forge-8vfn.7.6.56';
  // Four lines on purpose: the fourth is BELOW the three this script prints,
  // which is the shape that produced the last test in this file.
  const BODY = [
    'forge-8vfn.7.6.56  the run-controls door asserts the disabled reason',
    'status: open',
    'assignee: M6-C',
    'notes: the disabled reason must name the missing precondition',
  ].join('\n');

  test('an unresolvable id REFUSES, and prints no record to read', () => {
    dir = mkdtempSync(join(tmpdir(), 'bead-pf-'));
    try {
      const r = preflight(stubBd(dir, REAL, BODY), 'forge-8vfn.7.6.999', '--expect', 'anything');
      assert.equal(r.status, 3, r.stdout + r.stderr);
      assert.match(r.stdout, /does not resolve/);
      assert.doesNotMatch(r.stdout, /status: open/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a resolving id whose record matches the stated expectation passes', () => {
    dir = mkdtempSync(join(tmpdir(), 'bead-pf-'));
    try {
      const r = preflight(stubBd(dir, REAL, BODY), REAL, '--expect', 'run-controls door');
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /MATCH/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('THE ONE THAT MATTERS: a resolving id that is somebody ELSE’S work refuses', () => {
    dir = mkdtempSync(join(tmpdir(), 'bead-pf-'));
    try {
      // What the lane believed it was closing, against what 7.6.56 actually is.
      const r = preflight(stubBd(dir, REAL, BODY), REAL, '--expect', 'the bridge records its own broadcasts');
      assert.equal(r.status, 4, r.stdout + r.stderr);
      assert.match(r.stdout, /RESOLVES, but nothing in it contains/);
      // The record is still shown — the refusal explains itself — but the exit
      // code is what a caller branches on, and it is distinct from "no such id".
      assert.match(r.stdout, /status: open/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a match PRINTS THE LINE THAT MATCHED, even when it is below the three shown', () => {
    dir = mkdtempSync(join(tmpdir(), 'bead-pf-'));
    try {
      // Found by dogfooding, not by design: run against a real bead, the script
      // printed three lines and claimed the record "contains ledger" — a word
      // that appears only further down. Evidence and claim about different text
      // is precisely the confusion this script exists to prevent.
      const r = preflight(stubBd(dir, REAL, BODY), REAL, '--expect', 'missing precondition');
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /missing precondition/);
      // The verdict alone is not enough: the matched line must be on screen.
      assert.match(r.stdout, /4:.*missing precondition/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a missing --expect REFUSES rather than falling back to printing', () => {
    dir = mkdtempSync(join(tmpdir(), 'bead-pf-'));
    try {
      const r = preflight(stubBd(dir, REAL, BODY), REAL);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /usage/);
      // Printing the record with no expectation stated is EXACTLY the behaviour
      // that lost 7.6.56 and 7.6.60. It must not be reachable by omission.
      assert.doesNotMatch(r.stdout, /status: open/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a mistyped flag refuses instead of reading as "no expectation stated"', () => {
    dir = mkdtempSync(join(tmpdir(), 'bead-pf-'));
    try {
      const r = preflight(stubBd(dir, REAL, BODY), REAL, '--expct', 'run-controls door');
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /unexpected argument/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--new MINTS: the id is never typed, it is created', () => {
    dir = mkdtempSync(join(tmpdir(), 'bead-pf-'));
    try {
      // The stub records its argv so the mint is asserted on what `bd` was
      // actually handed, not on an exit code that any `true` would produce.
      const argvFile = join(dir, 'argv.txt');
      const bd = join(dir, 'bd-create-stub.sh');
      writeFileSync(bd, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${JSON.stringify(argvFile)}\n`);
      chmodSync(bd, 0o755);

      const r = preflight(bd, '--new', 'a new finding', 'forge-8vfn.7.6');
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const argv = readFileSync(argvFile, 'utf8').split('\n').filter((l) => l !== '');
      assert.deepEqual(argv, ['create', 'a new finding', '-t', 'task', '-p', '3', '--parent', 'forge-8vfn.7.6']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--new refuses without a parent — a hardcoded subtree mints in the wrong place', () => {
    dir = mkdtempSync(join(tmpdir(), 'bead-pf-'));
    try {
      const r = preflight(stubBd(dir, REAL, BODY), '--new', 'a title with no parent');
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /usage/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
