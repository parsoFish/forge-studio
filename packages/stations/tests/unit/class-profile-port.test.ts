/**
 * The one port (operator ruling, items 81/83): `createPhaseExecutor` takes an
 * OPTIONAL `ClassProfilePort`. With none bound, a station that needs the class
 * table must refuse by name rather than silently guess a default profile —
 * this is the RED-FIRST test for that refusal.
 *
 * Drives the port through the real seam (`createPhaseExecutor`, not the phase
 * function directly): a minimal `NodeExecContext` for the `developer-ralph`
 * ralph def, which `execAgent` routes to the developer-loop band
 * (`phases/executor-table.ts`). `wedgeDetector.active: false` skips the wedge
 * race so `runWithWedge` calls the phase function directly, and the refusal
 * fires before the function reads anything from `input` — a bogus worktree
 * path never has to resolve.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPhaseExecutor } from '../../phases/executor-table.ts';

/** The minimal ctx shape `execAgent` -> `execDev` -> `runWithWedge` reads.
 *  Typed `never` at the call site: this is deliberately NOT a full
 *  `NodeExecContext` — only the fields the dev-loop dispatch path touches. */
function devNodeCtx() {
  return {
    kind: 'agent',
    node: { agent: 'developer-ralph' },
    nodeId: 'dev',
    input: {
      initiativeId: 'INIT-class-profile-port-red',
      worktreePath: '/nonexistent/worktree',
      manifestPath: '/nonexistent/manifest.md',
    },
    nodeLogger: { emit: (p: unknown) => ({ ...(p as object), event_id: 'e1' }) },
    costLogger: { emit: (p: unknown) => ({ ...(p as object), event_id: 'e1' }) },
    wedgeDetector: { active: false },
    nodeBudget: undefined,
    state: {},
    agents: new Map([
      ['developer-ralph', { slug: 'developer-ralph', composition: { guards: [] }, runtime: { loopStrategy: 'ralph' } }],
    ]),
    inboundArtifacts: [],
  };
}

test('createPhaseExecutor with no classProfiles: the developer-loop station throws naming ClassProfilePort', async () => {
  const executor = createPhaseExecutor();
  await assert.rejects(
    () => executor.run('dev', devNodeCtx() as never),
    /station "developer-loop" needs a class profile table \(ClassProfilePort\)/,
  );
});
