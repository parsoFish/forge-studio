/**
 * bead forge-8vfn.5.2 — `declineHook`: the THIRD ledger review outcome
 * alongside approve/override, recording "an operator looked at this hook and
 * rejected it" (the live example the bead names: `pre-pr-security-review`).
 * Mirrors hook-revoke.test.ts's own fixture/shape for the sibling act.
 *
 * Contract pinned here:
 *   - A declined hook is NOT runnable (hookRunState is UNCHANGED by a
 *     decline — it never consults the declined ledger).
 *   - `readHookDeclinedLedger` applies the SAME strict validation discipline
 *     as `readHookApprovalLedger`: a malformed `declined[i]` entry throws,
 *     naming the file and the index — never a silent skip.
 *   - The ONE writer round-trips all three lists (`approved`/`revoked`/
 *     `declined`) without dropping any.
 *   - Declining supersedes a live approval; approving supersedes a live
 *     decline — the two outcomes are mutually exclusive on disk.
 *
 * Pinned RED at branch base: `declineHook`/`readHookDeclinedLedger` do not
 * exist.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import {
  approveHook,
  declineHook,
  hookRunState,
  readHookApprovalLedger,
  readHookDeclinedLedger,
  revokeHookApproval,
} from './hook-approval-ledger.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hook-decline-'));
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

test('a declined hook is recorded, reported declined, and stays NOT runnable', () => {
  assert.equal(hookRunState(root, 'h1').runnable, false, 'sanity: never-reviewed starts not runnable');

  declineHook({ forgeRoot: root, id: 'h1', reason: 'flagged by pre-pr-security-review' });

  const declined = readHookDeclinedLedger(root).get('h1');
  assert.ok(declined, 'expected a declined entry for h1');
  assert.equal(declined!.reason, 'flagged by pre-pr-security-review');
  assert.equal(typeof declined!.declinedAt, 'string');

  // GRANTS NOTHING: hookRunState never consults the declined ledger — a
  // declined hook computes exactly like a never-reviewed one.
  const state = hookRunState(root, 'h1');
  assert.equal(state.needsReview, true);
  assert.equal(state.runnable, false, 'a declined hook must NEVER be runnable — decline is a review outcome, not an approval');
  assert.equal(readHookApprovalLedger(root).get('h1'), undefined, 'declining must not write an approval entry');
});

test('declining a currently-approved hook supersedes the approval — the two outcomes are mutually exclusive', () => {
  approveHook({ forgeRoot: root, id: 'h1' });
  assert.equal(hookRunState(root, 'h1').runnable, true);

  declineHook({ forgeRoot: root, id: 'h1' });

  assert.equal(readHookApprovalLedger(root).get('h1'), undefined, 'decline must clear the live approval');
  assert.equal(hookRunState(root, 'h1').runnable, false);
  assert.ok(readHookDeclinedLedger(root).get('h1'), 'expected the decline to be recorded');
});

test('approving a previously-declined hook supersedes the decline — the mirror direction', () => {
  declineHook({ forgeRoot: root, id: 'h1' });
  assert.ok(readHookDeclinedLedger(root).get('h1'));

  approveHook({ forgeRoot: root, id: 'h1' });

  assert.equal(readHookDeclinedLedger(root).get('h1'), undefined, 'approving must clear the prior decline');
  assert.equal(hookRunState(root, 'h1').runnable, true);
});

test('a malformed declined[] entry throws, naming the file and the index — never a silent skip', () => {
  const ledgerPath = join(root, 'studio', 'hook-approvals.yaml');
  // Not-a-mapping — the same shape check parseHookApprovalLedgerEntries
  // applies to `approved[i]`, mirrored here for `declined[i]`.
  writeFileSync(ledgerPath, yaml.dump({ approved: [], declined: ['not-a-mapping'] }), 'utf8');

  assert.throws(
    () => readHookDeclinedLedger(root),
    (err: Error) => /declined\[0\]/.test(err.message) && err.message.includes(ledgerPath),
    'expected the throw to name both the file and the malformed index',
  );

  // A required field missing from an otherwise-well-shaped entry also
  // throws, never silently skipped — same discipline as approved's own
  // scriptHash/permissionsHash/triggerHash/approvedAt checks.
  writeFileSync(ledgerPath, yaml.dump({ approved: [], declined: [{ id: 'h1' /* missing declinedAt */ }] }), 'utf8');
  assert.throws(() => readHookDeclinedLedger(root), /declinedAt/);
});

test('a duplicate declined-hook id throws', () => {
  const ledgerPath = join(root, 'studio', 'hook-approvals.yaml');
  writeFileSync(
    ledgerPath,
    yaml.dump({
      approved: [],
      declined: [
        { id: 'h1', declinedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'h1', declinedAt: '2026-01-02T00:00:00.000Z' },
      ],
    }),
    'utf8',
  );

  assert.throws(() => readHookDeclinedLedger(root), /duplicate declined-hook id/);
});

test('a write round-trips all three lists (approved/revoked/declined) without dropping any', () => {
  // Second hook so approved and declined can coexist (different ids).
  const dir2 = join(root, 'studio', 'hooks', 'h2', 'scripts');
  mkdirSync(dir2, { recursive: true });
  writeFileSync(join(dir2, 'run.sh'), '#!/bin/bash\necho ok\n', 'utf8');
  writeFileSync(
    join(root, 'studio', 'hooks', 'h2', 'hook.yaml'),
    yaml.dump({ name: 'h2', description: 'd', on: 'SessionEnd', script: 'scripts/run.sh', permissions: { env: [], read: [], network: false } }),
    'utf8',
  );

  approveHook({ forgeRoot: root, id: 'h1' });
  revokeHookApproval({ forgeRoot: root, id: 'h1' }); // populates `revoked`
  approveHook({ forgeRoot: root, id: 'h1' }); // re-approve h1 — lands in `approved`
  declineHook({ forgeRoot: root, id: 'h2', reason: 'no' }); // lands in `declined`, h2 untouched by the above

  const doc = yaml.load(readFileSync(join(root, 'studio', 'hook-approvals.yaml'), 'utf8')) as Record<string, unknown>;
  const approved = doc['approved'] as Array<Record<string, unknown>>;
  const revoked = doc['revoked'] as Array<Record<string, unknown>>;
  const declined = doc['declined'] as Array<Record<string, unknown>>;

  assert.ok(Array.isArray(approved) && approved.some((e) => e['id'] === 'h1'), 'approved list must survive the decline write');
  assert.ok(Array.isArray(revoked) && revoked.some((e) => e['id'] === 'h1'), 'revoked history must survive the decline write');
  assert.ok(Array.isArray(declined) && declined.some((e) => e['id'] === 'h2'), 'declined list must survive an unrelated approve/revoke sequence');

  // And the reverse direction: readers agree with the raw doc.
  assert.equal(readHookApprovalLedger(root).get('h1')?.id, 'h1');
  assert.equal(readHookDeclinedLedger(root).get('h2')?.id, 'h2');
});
