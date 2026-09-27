/**
 * forge-mfv5.3.7 (operator ruling 2026-09-12): the per-initiative resource
 * namespace door test, split out of stop-conditions.test.ts. Two initiatives'
 * gate commands, run through the REAL spawn path (makeQualityGateFromCmd ->
 * runGateCapturing -> execFileSync, the seam production dev-loop gates run
 * through), must each receive FORGE_RESOURCE_PREFIX (a) present, (b) distinct
 * between the two initiatives, (c) stable across that initiative's
 * WIs/retries, and (d) safe as a cloud resource-name prefix. The dev loop
 * passes `initiativeId` via buildWiQualityGate (stations wi-quality-gate.ts,
 * pinned by developer-loop.gate-resource-prefix.test.ts). The worktree's
 * secrets.env reaches a gate child only when it declared requiredEnv/unsetEnv.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RESOURCE_PREFIX_ENV, RESOURCE_PREFIX_RE, RESOURCE_PREFIX_MAX_LENGTH, deriveResourcePrefix } from '@forge/kernel';

import { makeQualityGateFromCmd, type GateRunInfo } from '../../ralph/stop-conditions.ts';

test('makeQualityGateFromCmd: FORGE_RESOURCE_PREFIX is present, cloud-safe, and derived from initiativeId (door test a+d)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-gate-nsprefix-'));
  try {
    let info: GateRunInfo | undefined;
    const gate = makeQualityGateFromCmd(
      dir,
      ['sh', '-c', `echo "PREFIX=$${RESOURCE_PREFIX_ENV}"`],
      (i) => { info = i; },
      { initiativeId: 'initiative-alpha' },
    );
    assert.equal(gate(), true);
    const match = info!.stdoutTail.match(/PREFIX=(\S+)/);
    assert.ok(match, `gate child never saw ${RESOURCE_PREFIX_ENV}`);
    const prefix = match![1]!;
    assert.equal(prefix, deriveResourcePrefix('initiative-alpha'), 'the child must see the SAME value the pure derivation produces');
    assert.match(prefix, RESOURCE_PREFIX_RE, 'must be a safe cloud resource-name prefix');
    assert.ok(prefix.length <= RESOURCE_PREFIX_MAX_LENGTH);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: two initiatives running their gate commands through the real spawn path get DISTINCT prefixes (door test b)', () => {
  const dirA = mkdtempSync(join(tmpdir(), 'forge-gate-nsprefix-a-'));
  const dirB = mkdtempSync(join(tmpdir(), 'forge-gate-nsprefix-b-'));
  try {
    const readPrefix = (dir: string, initiativeId: string): string => {
      let info: GateRunInfo | undefined;
      const gate = makeQualityGateFromCmd(
        dir,
        ['sh', '-c', `echo "PREFIX=$${RESOURCE_PREFIX_ENV}"`],
        (i) => { info = i; },
        { initiativeId },
      );
      assert.equal(gate(), true);
      return info!.stdoutTail.match(/PREFIX=(\S+)/)![1]!;
    };
    // Interleaved — not two sequential runs of the SAME initiative — to prove
    // no shared mutable module-level state carries a value from one
    // initiative's call into the other's (the property that makes this safe
    // for two initiatives in flight concurrently, mirroring the per-call
    // env-composition pattern buildChildEnv already uses for agent spawns).
    const alphaFirst = readPrefix(dirA, 'initiative-alpha');
    const betaFirst = readPrefix(dirB, 'initiative-beta');
    const alphaSecond = readPrefix(dirA, 'initiative-alpha');
    const betaSecond = readPrefix(dirB, 'initiative-beta');

    assert.notEqual(alphaFirst, betaFirst, 'two concurrent initiatives must never share a resource prefix');
    assert.equal(alphaFirst, alphaSecond, 'stable across the same initiative\'s retries/WIs (door test c)');
    assert.equal(betaFirst, betaSecond, 'stable across the same initiative\'s retries/WIs (door test c)');
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: without initiativeId declared, FORGE_RESOURCE_PREFIX is absent (no namespace invented for a gate that never asked for one)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-gate-nsprefix-absent-'));
  try {
    let info: GateRunInfo | undefined;
    const gate = makeQualityGateFromCmd(
      dir,
      ['sh', '-c', `echo "PREFIX=\${${RESOURCE_PREFIX_ENV}:-UNSET}"`],
      (i) => { info = i; },
    );
    assert.equal(gate(), true);
    assert.match(info!.stdoutTail, /PREFIX=UNSET/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: an initiativeId alone never pulls the worktree secrets.env into an ordinary gate (forge-mfv5.3.7)', () => {
  // The prefix is non-secret; the live creds in secrets.env reach a gate child
  // ONLY when it declared requiredEnv/unsetEnv. Every WI gate carries an
  // initiativeId, and its stdout/stderr tail is persisted to the event log,
  // so an ordinary `npm test` that echoed its env would publish the creds.
  const dir = mkdtempSync(join(tmpdir(), 'forge-gate-nsprefix-nosecrets-'));
  const secretName = 'FORGE_TEST_SECRET_ONLY_IN_SECRETS_ENV';
  try {
    writeFileSync(join(dir, 'secrets.env'), `${secretName}=topsecretvalue\n`);
    let info: GateRunInfo | undefined;
    const gate = makeQualityGateFromCmd(
      dir,
      ['sh', '-c', `echo "SEEN=\${${secretName}:-UNSET} PREFIX=$${RESOURCE_PREFIX_ENV}"`],
      (i) => { info = i; },
      { initiativeId: 'initiative-alpha' },
    );
    assert.equal(gate(), true);
    assert.match(info!.stdoutTail, /SEEN=UNSET/, 'secrets.env must not reach a gate that declared no requiredEnv/unsetEnv');
    assert.match(info!.stdoutTail, /PREFIX=\S+/, 'the non-secret prefix still reaches it');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
