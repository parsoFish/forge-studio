/**
 * R4-19-F2 — THE CONSTRAINT TEST (AGENT_RUNNERS half). SPEC §5's entire reason
 * for existing: a new interactive session kind is authored as turnSpec DATA
 * riding the EXISTING generic `runInteractiveTurn` spine — NEVER a new
 * orchestrator runner, NEVER a new `AGENT_RUNNERS` entry. Asserted against
 * the REAL source file, not a fixture or a hand-built registry snapshot —
 * this is the test that kills a "just add a fifth runner" implementation,
 * the exact per-kind re-invention SPEC §5.
 *
 * Split out of `packages/sessions/tests/contract/session-kinds-panel.test.ts`
 * (M7-E boundary fix): `AGENT_RUNNERS` moved (now at `apps/forge/agent-run.ts`)
 * — the CLI verb that composes agents with sessions/flows lives in the
 * assembly now — so `packages/sessions` — rank 5,
 * below the assembly — can no longer import it. This package may, since it
 * owns the file. The sibling `FINALIZER_IDS` check stayed behind in
 * `session-kinds-panel.test.ts`, since that table is still sessions' own.
 *
 * This check is ALREADY TRUE today (GREEN, not RED) — a regression ratchet
 * pinning an invariant a correct kb-cleanup implementation must never
 * violate, not a not-yet-built capability.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FORGE_ROOT } from '@forge/kernel';
import { AGENT_RUNNERS } from '../../agent-run.ts';

describe('R4-19-F2 — the constraint: no new orchestrator runner for kb-cleanup', () => {
  it('AGENT_RUNNERS (apps/forge/agent-run.ts) gains NO "kb-cleanup" key — the session rides the existing turnSpec dispatch fork in cmdAgentRun, not a new bespoke runner', () => {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(AGENT_RUNNERS, 'kb-cleanup'),
      `AGENT_RUNNERS must not gain a "kb-cleanup" entry — got keys: ${Object.keys(AGENT_RUNNERS).join(', ')}. A turnSpec-bearing descriptor is dispatched by cmdAgentRun's SPEC §5 fork BEFORE AGENT_RUNNERS is ever consulted (apps/forge/agent-run.ts); adding a key here re-opens the exact per-runner cap park SPEC §5.`,
    );
    // Belt-and-suspenders grep on the real source TEXT (not just the
    // imported object's own keys) — catches a "kb-cleanup" entry added under
    // a shape the plain object-key check above might not observe (e.g. a
    // computed-key assignment appended after the object literal).
    const src = readFileSync(join(FORGE_ROOT, 'apps', 'forge', 'agent-run.ts'), 'utf8');
    assert.doesNotMatch(
      src,
      /['"]kb-cleanup['"]\s*:/,
      'the real apps/forge/agent-run.ts source text must not declare a "kb-cleanup" key anywhere',
    );
  });
});
