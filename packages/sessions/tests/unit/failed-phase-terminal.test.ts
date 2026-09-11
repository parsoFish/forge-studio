/**
 * forge-8vfn.7.3.3 — two paths publish one "this session failed" verdict, and
 * they disagree by KIND.
 *
 * WRITTEN. `packages/agents/agent-run.ts:249` and `:381` catch a throw out of
 * the turn and write `phase: 'failed'` via `writeSessionTerminalPhase`. Both
 * sites cover every kind — `:249` is the turnSpec path, `:381` the legacy
 * runners that `spawnAgentTurn` uses.
 *
 * DERIVED. `deriveSessionLifecycle` (bridge-studio-lifecycle.ts) never reads
 * that phase as terminal unless the kind's own table happens to list it.
 * `studio/session-kinds.yaml:262` declares `{ phase: failed, step: terminal }`
 * for exactly ONE kind — `onboarding`. The other six do not.
 *
 * So one written fact produces three derived answers:
 *   onboarding                     -> terminal          (rule 1)
 *   the six, stderr NEWER          -> crashed           (rule 2)
 *   the six, stderr older/absent   -> WORKING           (rule 5)
 *
 * The third is the one that matters. `phaseShapeFor` returns
 * `{ awaits: null, working: false }` for a phase no table lists, so nothing
 * else fires and the session derives as `working` with `needsYou: false` —
 * FOREVER. The session said it failed and the operator is shown work in
 * progress. That is the declared-data-fails-open shape: a value written,
 * surfaced, and enforced nowhere.
 *
 * `failed` is written by ONE shared helper for EVERY kind, which is exactly
 * what makes it a universal reserved phase like `cancelled` — not a per-kind
 * row six tables forgot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadSessionKinds } from '../../studio/session-kinds.ts';
import { isTerminalPhase } from '../../session-resolution.ts';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';

const kinds = loadSessionKinds(FORGE_ROOT);
const byId = (id: string) => {
  const d = kinds.find((k) => k.id === id);
  assert.ok(d, `the ${id} kind must exist — this test is about the real registry, not a fixture`);
  return d;
};

test('AT-7.3.3-1 (RED) every kind treats the written `failed` phase as terminal, not just the one that lists it', () => {
  // `agent-run.ts` writes `failed` for EVERY kind. A kind whose table omits it
  // derives `working` (or `crashed`, by stderr mtime) for a session that has
  // already said it failed.
  for (const d of kinds) {
    assert.equal(
      isTerminalPhase(d, 'failed'), true,
      `kind '${d.id}' must read a written 'failed' as terminal — agent-run.ts writes it for every kind, so a table that omits it leaves the session deriving as working with needsYou:false`,
    );
  }
});

test('AT-7.3.3-2 onboarding, which declares it in its own table, is unchanged', () => {
  // The positive control, and the proof that the universal check does not
  // merely paper over a missing row: this kind's answer was already `true`.
  assert.equal(isTerminalPhase(byId('onboarding'), 'failed'), true);
});

test('AT-7.3.3-3 the universal check does not make every phase terminal', () => {
  // Kills "return true": a working phase must stay non-terminal, or the fix
  // would end every session the moment it started.
  assert.equal(isTerminalPhase(byId('demo'), 'generating'), false);
  assert.equal(isTerminalPhase(byId('architect'), 'interviewing'), false);
});
