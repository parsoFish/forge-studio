/**
 * G8 wave 2 (2026-07-12) — `resolveGitIdentity` (developer-loop.ts).
 *
 * Pure discrimination logic for which git identity a `makeAgentWithTelemetry`
 * call's spawned agent should commit as: the per-WI dev-loop call site always
 * carries a workItemId (→ per-WI `forge-ralph+<id>@forge.local`); BOTH
 * unifier item roles (packaging — no workItemId — and code-fix UWI — has one)
 * share the flat `forge-unifier` identity, so `workItemId` presence alone
 * must NOT discriminate the unifier phase. No SDK, no git — exercised
 * directly like `assertNonEmptyDelivery` in cycle-helpers.test.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveGitIdentity } from './developer-loop.ts';
import { ralphGitIdentity, UNIFIER_GIT_IDENTITY } from '../config.ts';

test('resolveGitIdentity: developer-loop phase with a workItemId → per-WI forge-ralph identity', () => {
  const identity = resolveGitIdentity({ phase: 'developer-loop', workItemId: 'WI-3' });
  assert.deepEqual(identity, ralphGitIdentity('WI-3'));
  assert.equal(identity.email, 'forge-ralph+WI-3@forge.local');
});

test('resolveGitIdentity: developer-loop phase WITHOUT a workItemId throws', () => {
  assert.throws(
    () => resolveGitIdentity({ phase: 'developer-loop' }),
    /workItemId/,
  );
});

test('resolveGitIdentity: unifier phase, packaging role (no workItemId) → flat forge-unifier identity', () => {
  const identity = resolveGitIdentity({ phase: 'unifier' });
  assert.deepEqual(identity, UNIFIER_GIT_IDENTITY);
});

test('resolveGitIdentity: unifier phase, code-fix UWI role (HAS a workItemId) → SAME flat forge-unifier identity', () => {
  // The discriminator is the phase alone — a code-fix UWI's workItemId must
  // NOT route it to ralphGitIdentity; the unifier composes/finishes WIs, it
  // isn't one, so every UWI role shares the one unifier identity.
  const identity = resolveGitIdentity({ phase: 'unifier', workItemId: 'UWI-1' });
  assert.deepEqual(identity, UNIFIER_GIT_IDENTITY);
});
