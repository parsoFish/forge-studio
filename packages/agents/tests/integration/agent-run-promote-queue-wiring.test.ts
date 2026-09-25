/**
 * Bead forge-8vfn.6.6 item 2 follow-up (coordinator ruling: no follow-up
 * beads, promoteToQueue must be reachable in a REAL spawn) — end-to-end
 * wiring of the manifest ports `promoteToQueue` needs
 * (`@forge/sessions/interactive-finalizers.ts`'s `QueuePorts`), through
 * `cmdAgentRun`'s ADR-043 §3 turnSpec fork.
 *
 * `@forge/flows` (rank 5) sits above `packages/sessions` (rank 4) AND
 * `packages/agents` (rank 3), so neither package may import
 * `promoteManifests`/`mintAndPersistManifestCycleId` directly — the real
 * functions are bound at `apps/forge` (unranked assembly) and ride down as
 * `AgentDispatchDeps.sessionKind` (mirrors `kinds/architect-ports.ts`'s
 * `ArchitectManifestPorts`/`architectManifestPorts` binding exactly, and is
 * carried by the SAME `deps` object `apps/forge/session-kind-deps.ts`
 * already assembles for architect — see its own `AGENT_DISPATCH_DEPS`).
 *
 * This test proves the FORWARDING half only (packages/agents/agent-run.ts's
 * turnSpec fork must thread `deps.sessionKind` into `runInteractiveTurn`'s
 * ctx, exactly like the pre-existing legacy-runner branch one function up
 * already does) — it drives the REAL cmdAgentRun -> runTurnSpecAgent ->
 * runInteractiveTurn -> runFinalizeStep -> resolveFinalizer('promoteToQueue')
 * chain with a FAKE QueuePorts (never the real @forge/flows functions —
 * those are apps/forge's own binding, proven structurally by
 * session-kind-deps.ts reusing `architectManifestPorts`, not re-tested
 * here) and asserts the ports were actually CALLED. No agent turn ever
 * spawns (the fixture seeds status straight at the finalize phase), so
 * there is no queryFn to fake.
 *
 * RED-NOW: `runTurnSpecAgent` never receives `deps` at all today, so
 * `ctx.manifestPorts` is never populated and `promoteToQueue` refuses
 * loudly ("FinalizerContext.manifestPorts is required") — this test fails
 * with exactly that error surfacing through cmdAgentRun's uncaught rethrow.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  run,
  withCwd,
  PROMOTE_QUEUE_ID,
  setupPromoteQueueFixture,
} from '../test-fixtures/interactive-runner-log-observer.ts';

// Deliberately NOT importing QueuePorts from `@forge/sessions/interactive-
// finalizers.ts` (rank 4) — this is a rank-3 packages/agents test, and
// deps.sessionKind is OPAQUE at this layer by design (see
// AgentDispatchDeps's own doc, agent-dispatch-cmd.ts): a rank-3 file must
// never import a rank-4 package's types either. Mirrored structurally, not
// by name.
type FakeQueuePorts = {
  promoteManifests: (manifestsDir: string, opts: { queueRoot: string }) => { writtenManifestPaths: string[]; writtenInitiativeIds: string[] };
  mintAndPersistManifestCycleId: (manifestPath: string, initiativeId: string) => string;
};

test('promoteToQueue is reachable end-to-end: cmdAgentRun forwards deps.sessionKind (manifestPorts) into runInteractiveTurn, and the REAL finalizer registry calls them', async () => {
  const fx = setupPromoteQueueFixture();
  try {
    const promoteCalls: { manifestsDir: string; queueRoot: string }[] = [];
    const mintCalls: { manifestPath: string; initiativeId: string }[] = [];
    const manifestPorts: FakeQueuePorts = {
      promoteManifests: (manifestsDir, opts) => {
        promoteCalls.push({ manifestsDir, queueRoot: opts.queueRoot });
        return { writtenManifestPaths: ['/fake/_queue/pending/init-1.md'], writtenInitiativeIds: ['init-1'] };
      },
      mintAndPersistManifestCycleId: (manifestPath, initiativeId) => {
        mintCalls.push({ manifestPath, initiativeId });
        return 'cycle-marker-b81f';
      },
    };

    const r = await withCwd(fx.forgeRoot, () => run(
      [PROMOTE_QUEUE_ID, fx.sessionId, '--project', fx.projectArg],
      fx.forgeRoot,
      { sessionKind: { manifestPorts } },
    ));

    assert.equal(r.exitCode, null, `expected the finalize turn to succeed — got exit(${r.exitCode}), stderr: ${r.err}`);
    assert.equal(promoteCalls.length, 1, `promoteToQueue must CALL the injected manifestPorts.promoteManifests exactly once — got stderr: ${r.err}`);
    assert.equal(promoteCalls[0].manifestsDir, join(fx.sessionDir, 'manifests'), 'must read from <sessionDir>/manifests — the real architect convention');
    assert.equal(promoteCalls[0].queueRoot, join(fx.forgeRoot, '_queue'), 'must target <forgeRoot>/_queue');
    assert.deepEqual(
      mintCalls,
      [{ manifestPath: '/fake/_queue/pending/init-1.md', initiativeId: 'init-1' }],
      'must mint a cycle id for the one written manifest, using promoteManifests\' OWN returned path + initiative id',
    );
  } finally {
    rmSync(fx.forgeRoot, { recursive: true, force: true });
  }
});
