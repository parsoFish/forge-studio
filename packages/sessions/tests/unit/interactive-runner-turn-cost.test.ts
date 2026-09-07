/**
 * S9 beat 8 — "cost recorded" — the SPINE half. Exit row 2 of the M6-A brief.
 *
 * `packages/sessions/interactive-runner.ts` said so about itself in a comment:
 * "`costUsd` also stays `null`: this spine emits no `cost_usd` on any event".
 * The consequence is measurable rather than theoretical — S9 run 4
 * (`_1.0/reports/m6-a-S9-1.log`, 2026-09-07) dispatched a real creation-agent
 * turn and the runner reported `spend: UNMEASURED … no priced event reached
 * its log`. Every kind on the generic spine is in that state; the two legacy
 * kinds that DO emit (`kinds/architect-steps.ts`, `kinds/demo-builder.ts`)
 * each hand-rolled it.
 *
 * This test drives the DOOR (ruling 326): a real `runInteractiveTurn` over a
 * stubbed SDK, then the same read the product's session route performs
 * (`readSessionCostUsd`) against the log the turn actually wrote. It asserts
 * the figure, not the emission's shape, so a later refactor of the event's
 * fields cannot make it pass while the operator's question stays unanswered.
 *
 * The emitted event must be AUTHORITATIVE under `kernel/event-cost.ts`: this
 * phase emits no `iteration` events, so one plain per-turn row counts once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runInteractiveTurn } from '../../interactive-runner.ts';
import { loadSessionKinds, type SessionKindDescriptor } from '../../studio/session-kinds.ts';
import { writeSessionStatus, type QueryFn } from '../../interactive-session.ts';
import { readSessionCostUsd } from '../../session-readability.ts';

const TURN_COST_USD = 0.4231;

/** One real agent (`project-brain-builder`), a fixture-local kind id and dir —
 *  the spine's emission is what is under test, never a shipped kind's phases. */
const FIXTURE_SESSION_KINDS_YAML = `
- id: turncostkind
  agent: project-brain-builder
  title: Turn Cost Test Kind
  stages: [analyzing]
  defaultStage: analyzing
  artifact: { kind: file-package, label: "Test artifact" }
  turnSpec:
    kindDir: _turncost
    style: agent
    phases:
      - { phase: analyzing, step: agent, writes: [staging], next: awaiting-review }
      - { phase: awaiting-review, step: noop }
`;

type TestStatus = { session_id: string; phase: string; updated_at: string };

function descriptorFor(forgeRoot: string, id: string): SessionKindDescriptor {
  const found = loadSessionKinds(forgeRoot).find((d) => d.id === id);
  if (!found) throw new Error(`test fixture bug: no descriptor "${id}" in the fixture yaml`);
  return found;
}

/** The SDK's own result message carries `total_cost_usd`; the turn already
 *  reads it (`interactive-session.ts`) and, before this fix, threw it away. */
function pricedQueryFn(sessionDir: string): QueryFn {
  return () => {
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(sessionDir, 'staging'), { recursive: true });
      writeFileSync(join(sessionDir, 'staging', 'draft.md'), '# staged\n');
      yield { type: 'result', total_cost_usd: TURN_COST_USD };
    }
    return gen();
  };
}

test('a spine turn records what it spent where the session route reads it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'interactive-runner-turn-cost-'));
  const forgeRoot = join(root, 'forge');
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), FIXTURE_SESSION_KINDS_YAML);
  const projectRoot = join(root, 'project');
  const logsRoot = join(root, '_logs');
  const sessionId = '2026-09-07T00-00-00-turncost';
  const sessionDir = join(projectRoot, '_turncost', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, {
    session_id: sessionId,
    phase: 'analyzing',
    updated_at: new Date().toISOString(),
  });

  // No `logger` passed on purpose: the runner must write to the SAME log dir
  // the session route reads (`_logs/_<kind>-<sessionId>`), or the figure is
  // recorded somewhere no surface looks — the exact defect the log-dir
  // co-location ratchet exists for.
  await runInteractiveTurn(descriptorFor(forgeRoot, 'turncostkind'), {
    sessionId,
    projectRoot,
    forgeRoot,
    logsRoot,
    queryFn: pricedQueryFn(sessionDir),
  });

  assert.equal(
    readSessionCostUsd({ logsRoot, kind: 'turncostkind', sessionId }),
    TURN_COST_USD,
    'the operator asking "what has this session cost" must get the turn\'s own spend',
  );
});

test('a turn the SDK never priced records no figure — null, not a fabricated 0', async () => {
  const root = mkdtempSync(join(tmpdir(), 'interactive-runner-turn-cost-'));
  const forgeRoot = join(root, 'forge');
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), FIXTURE_SESSION_KINDS_YAML);
  const projectRoot = join(root, 'project');
  const logsRoot = join(root, '_logs');
  const sessionId = '2026-09-07T00-00-00-unpriced';
  const sessionDir = join(projectRoot, '_turncost', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, {
    session_id: sessionId,
    phase: 'analyzing',
    updated_at: new Date().toISOString(),
  });

  const unpricedQueryFn: QueryFn = () => {
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(sessionDir, 'staging'), { recursive: true });
      writeFileSync(join(sessionDir, 'staging', 'draft.md'), '# staged\n');
      yield { type: 'result' };
    }
    return gen();
  };

  await runInteractiveTurn(descriptorFor(forgeRoot, 'turncostkind'), {
    sessionId,
    projectRoot,
    forgeRoot,
    logsRoot,
    queryFn: unpricedQueryFn,
  });

  assert.equal(readSessionCostUsd({ logsRoot, kind: 'turncostkind', sessionId }), null);
});
