/**
 * W7-B4 (library-08) — revokeHookApproval: the INVERSE of approveHook that
 * never existed. Contract:
 *
 *   - Removes the hook's entry from the `approved` ledger list, so
 *     hookRunState() honestly reads needs-review / not-runnable again.
 *   - RECORDS the revocation (an appended `revoked` entry carrying the prior
 *     approval's hashes + revokedAt) — an audit trail, never a silent erase.
 *   - Throws when there is nothing to revoke (explicit error contract —
 *     ADR-042 pure-function boundary; the bridge maps it to 409).
 *   - readHookApprovalLedger still parses a ledger carrying a `revoked` list
 *     (forward-compat of the existing reader is part of the contract).
 *
 * Pinned RED at branch base: the export does not exist.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { approveHook, hookRunState, readHookApprovalLedger, revokeHookApproval, revokeHookApprovalIfPresent } from './hook-approval-ledger.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hook-revoke-'));
  const dir = join(root, 'studio', 'hooks', 'h1', 'scripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.sh'), '#!/bin/bash\necho ok\n', 'utf8');
  writeFileSync(
    join(root, 'studio', 'hooks', 'h1', 'hook.yaml'),
    yaml.dump({
      name: 'h1',
      description: 'd',
      on: 'SessionEnd',
      script: 'scripts/run.sh',
      permissions: { env: [], read: [], network: false },
    }),
    'utf8',
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test('revoke removes the approval and records the revocation', () => {
  approveHook({ forgeRoot: root, id: 'h1' });
  assert.equal(hookRunState(root, 'h1').runnable, true);

  revokeHookApproval({ forgeRoot: root, id: 'h1' });

  // Approval gone — honest needs-review again.
  const state = hookRunState(root, 'h1');
  assert.equal(state.runnable, false);
  assert.equal(state.needsReview, true);
  assert.equal(readHookApprovalLedger(root).get('h1'), undefined);

  // Revocation RECORDED, carrying the prior approval + a revokedAt stamp.
  const raw = readFileSync(join(root, 'studio', 'hook-approvals.yaml'), 'utf8');
  const doc = yaml.load(raw) as Record<string, unknown>;
  const revoked = doc['revoked'] as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(revoked) && revoked.length === 1);
  assert.equal(revoked[0]['id'], 'h1');
  assert.equal(typeof revoked[0]['revokedAt'], 'string');
  assert.equal(typeof revoked[0]['scriptHash'], 'string');
});

test('revoking with no approval on record throws (explicit contract)', () => {
  assert.throws(() => revokeHookApproval({ forgeRoot: root, id: 'h1' }), /no approval/i);
});

// ---------------------------------------------------------------------------
// revokeHookApprovalIfPresent (W8-B4, library-34) — the tolerant companion
// the DELETE route uses: silent when there is nothing to revoke, otherwise
// behaves exactly like revokeHookApproval.
// ---------------------------------------------------------------------------

test('revokeHookApprovalIfPresent is a silent no-op when there is no approval on record — never throws', () => {
  assert.doesNotThrow(() => revokeHookApprovalIfPresent({ forgeRoot: root, id: 'h1' }));
  // And it must not fabricate a ledger file that never existed.
  assert.equal(readHookApprovalLedger(root).get('h1'), undefined);
});

test('revokeHookApprovalIfPresent revokes and records exactly like revokeHookApproval when there IS an approval', () => {
  approveHook({ forgeRoot: root, id: 'h1' });
  assert.equal(hookRunState(root, 'h1').runnable, true);

  revokeHookApprovalIfPresent({ forgeRoot: root, id: 'h1' });

  const state = hookRunState(root, 'h1');
  assert.equal(state.runnable, false);
  assert.equal(state.needsReview, true);
  assert.equal(readHookApprovalLedger(root).get('h1'), undefined);

  const doc = yaml.load(readFileSync(join(root, 'studio', 'hook-approvals.yaml'), 'utf8')) as Record<string, unknown>;
  const revoked = doc['revoked'] as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(revoked) && revoked.some((r) => r['id'] === 'h1'), 'the revocation is RECORDED, same as revokeHookApproval');
});

test('readHookApprovalLedger tolerates a ledger carrying a revoked list', () => {
  approveHook({ forgeRoot: root, id: 'h1' });
  revokeHookApproval({ forgeRoot: root, id: 'h1' });
  // Approve again after a revocation — the ledger must round-trip cleanly.
  approveHook({ forgeRoot: root, id: 'h1' });
  assert.equal(hookRunState(root, 'h1').runnable, true);
  const doc = yaml.load(readFileSync(join(root, 'studio', 'hook-approvals.yaml'), 'utf8')) as Record<string, unknown>;
  assert.ok(Array.isArray(doc['revoked']), 'revocation history survives a re-approval');
});
