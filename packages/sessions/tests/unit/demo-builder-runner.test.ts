import { DRIVABLE_DECLARATION, logger, makeNoopQueryFn, makeWritingQueryFn, setup } from './test-fixtures/demo-builder-runner-fixtures.ts';
import { test } from 'node:test';
import { FORGE_ROOT } from '@forge/kernel';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runDemoBuilderTurn, DEMO_BUILDER_MODEL } from '../../kinds/demo-builder.ts';
import { DEMO_DECLARATION_REL_PATH, DEMO_HTML_REL_PATH, DEMO_LOCK_REL_PATH, type DemoBuilderStatus } from '../../kinds/demo-session-store.ts';
import { type QueryFn } from '../../interactive-session.ts';
import { writeSessionStatus, readSessionStatus } from '../../interactive-session.ts';

// ---------------------------------------------------------------------------
// SPEC §5 (wave-6 kickoff model-tier seam)
// ---------------------------------------------------------------------------

/** Like makeWritingQueryFn, but also captures the model handed to queryFn. */
function makeWritingQueryFnCapturingModel(onModel: (model: string | undefined) => void): QueryFn {
  return ({ options }) => {
    onModel((options as { model?: string }).model);
    const cwd = (options?.cwd as string) ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(cwd, '.forge', 'demo'), { recursive: true });
      writeFileSync(join(cwd, DEMO_DECLARATION_REL_PATH), JSON.stringify(DRIVABLE_DECLARATION));
      writeFileSync(join(cwd, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>sample</body></html>');
      yield { type: 'result', total_cost_usd: 0.05 };
    }
    return gen();
  };
}

test('status.modelTier is honored: an operator-requested "opus" reaches queryFn as options.model', async () => {
  const { project, projectRoot, logsRoot, sessionId } = setup({ modelTier: 'opus' });
  let capturedModel: string | undefined;
  await runDemoBuilderTurn({
    sessionId, project, projectRoot, forgeRoot: FORGE_ROOT,
    queryFn: makeWritingQueryFnCapturingModel((m) => { capturedModel = m; }),
    logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.equal(capturedModel, 'claude-opus-4-8');
});

test('status.modelTier absent resolves to the unchanged default (sonnet) — byte-identical prior behavior', async () => {
  const { project, projectRoot, logsRoot, sessionId } = setup();
  let capturedModel: string | undefined;
  await runDemoBuilderTurn({
    sessionId, project, projectRoot, forgeRoot: FORGE_ROOT,
    queryFn: makeWritingQueryFnCapturingModel((m) => { capturedModel = m; }),
    logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.equal(capturedModel, DEMO_BUILDER_MODEL);
  assert.equal(capturedModel, 'claude-sonnet-4-6');
});

test('status.modelTier outside the declared range throws naming the value and the allowed set', async () => {
  const { project, projectRoot, logsRoot, sessionId } = setup({ modelTier: 'haiku' });
  await assert.rejects(
    () => runDemoBuilderTurn({
      sessionId, project, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeWritingQueryFn(), logger: logger(logsRoot, sessionId), logsRoot,
    }),
    /requested model tier "haiku".*allowed tier\(s\): sonnet, opus/,
  );
});

// ---------------------------------------------------------------------------
// R4-16 — generation snapshots + choose-a-generation lock. Since bead
// forge-mfv5.2.8 a generation is the sample DEMO.html plus the proposed demo
// DECLARATION (`demo-process.json`), and locking one writes that declaration
// into `.forge/project.json` demoProcess.
// ---------------------------------------------------------------------------

/** A declaration that drives a checkpoint, distinguishable by `tag`. */
const declarationTagged = (tag: string) => [
  { kind: 'capture', text: `Run \`node bin/cli.js --${tag}\` on both trees.` },
  { kind: 'verify', text: `${tag} holds.` },
];

/** A queryFn that writes DEMO.html + the declaration draft with CALLER-
 *  CONTROLLED content each turn — lets a test drive two generations with
 *  distinct, independently-verifiable bytes (the R4-16 round-trip ATs). */
function makeVersionedWritingQueryFn(demoBytes: string, declaration: unknown): QueryFn {
  return ({ options }) => {
    const cwd = (options?.cwd as string) ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(cwd, '.forge', 'demo'), { recursive: true });
      writeFileSync(join(cwd, DEMO_DECLARATION_REL_PATH), JSON.stringify(declaration));
      writeFileSync(join(cwd, DEMO_HTML_REL_PATH), demoBytes);
      yield { type: 'result', total_cost_usd: 0.01 };
    }
    return gen();
  };
}

function generationDir(sessionDir: string, n: number | string): string {
  return join(sessionDir, 'generations', String(n));
}

function readMeta(sessionDir: string, n: number | string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(generationDir(sessionDir, n), 'meta.json'), 'utf8'));
}

const readDemoProcess = (repoPath: string): unknown => JSON.parse(readFileSync(join(repoPath, '.forge', 'project.json'), 'utf8')).demoProcess;

/** Run a second generate turn after the first, as a revise does. */
async function generateAgain(ctx: ReturnType<typeof setup>, queryFn: QueryFn, feedback?: string): Promise<void> {
  const after = readSessionStatus<DemoBuilderStatus>(ctx.sessionDir)!;
  if (feedback) writeFileSync(join(ctx.sessionDir, 'feedback.md'), feedback);
  writeSessionStatus(ctx.sessionDir, { ...after, phase: 'generating', iteration: after.iteration + 1 });
  await runDemoBuilderTurn({ sessionId: ctx.sessionId, project: ctx.project, projectRoot: ctx.projectRoot, forgeRoot: FORGE_ROOT, queryFn, logger: logger(ctx.logsRoot, ctx.sessionId), logsRoot: ctx.logsRoot });
}

// R4-16 AT-1: a successful generate turn snapshots DEMO.html + the declaration
// + meta.json into generations/<iteration>/.
test('R4-16 AT-1: generate turn snapshots DEMO.html + demo-process.json + meta.json into generations/<iteration>/', async () => {
  const { project, projectRoot, logsRoot, sessionId, sessionDir } = setup({ iteration: 1 });
  await runDemoBuilderTurn({
    sessionId, project, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeVersionedWritingQueryFn('<html>V1 demo</html>', declarationTagged('v1')), logger: logger(logsRoot, sessionId), logsRoot,
  });
  const gdir = generationDir(sessionDir, 1);
  assert.equal(readFileSync(join(gdir, 'DEMO.html'), 'utf8'), '<html>V1 demo</html>');
  assert.deepEqual(JSON.parse(readFileSync(join(gdir, 'demo-process.json'), 'utf8')), declarationTagged('v1'));
  assert.ok(existsSync(join(gdir, 'meta.json')), 'meta.json written');
  assert.ok(!existsSync(join(gdir, 'SKILL.md')), 'no skill is snapshotted — there is none');
});

// R4-16 AT-2: meta.json fidelity — kills an implementation that invents/omits
// fields or defaults feedback to "" instead of null.
test('R4-16 AT-2: meta.json carries iteration, a real createdAt, feedback:null, targetElement:null — and no skill path', async () => {
  const { project, projectRoot, logsRoot, sessionId, sessionDir } = setup({ iteration: 1 });
  await runDemoBuilderTurn({
    sessionId, project, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeVersionedWritingQueryFn('<html>V1</html>', declarationTagged('v1')), logger: logger(logsRoot, sessionId), logsRoot,
  });
  const meta = readMeta(sessionDir, 1);
  assert.equal(meta.iteration, 1);
  assert.ok(typeof meta.createdAt === 'string' && !Number.isNaN(Date.parse(meta.createdAt)), `createdAt must be a real ISO timestamp, got: ${meta.createdAt}`);
  assert.equal(meta.feedback, null, 'no feedback.md at turn end ⇒ feedback:null, never fabricated');
  assert.equal(meta.targetElement, null);
  assert.deepEqual(Object.keys(meta).sort(), ['createdAt', 'feedback', 'iteration', 'targetElement']);
});

// R4-16 AT-3: feedback attribution — the feedback.md content that drove THIS
// generation is captured verbatim.
test('R4-16 AT-3: meta.json.feedback captures the feedback.md content that drove THIS generation, verbatim', async () => {
  const { project, projectRoot, logsRoot, sessionId, sessionDir } = setup({ iteration: 2 });
  writeFileSync(join(sessionDir, 'feedback.md'), 'Make it punchier and shorter.');
  await runDemoBuilderTurn({
    sessionId, project, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeVersionedWritingQueryFn('<html>V2</html>', declarationTagged('v2')), logger: logger(logsRoot, sessionId), logsRoot,
  });
  const meta = readMeta(sessionDir, 2);
  assert.equal(meta.feedback, 'Make it punchier and shorter.');
});

// A revision builds on what the operator just reviewed: the newest earlier
// generation's draft is the declaration the next turn revises, not the
// project's already-declared steps.
test('R4-16 AT-5: a revision turn revises the newest earlier generation\'s declaration', async () => {
  const ctx = setup({ iteration: 1 });
  await runDemoBuilderTurn({
    sessionId: ctx.sessionId, project: ctx.project, projectRoot: ctx.projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeVersionedWritingQueryFn('<html>G1</html>', declarationTagged('draft-one')), logger: logger(ctx.logsRoot, ctx.sessionId), logsRoot: ctx.logsRoot,
  });
  const prompts: string[] = [];
  const capturing: QueryFn = (args) => { prompts.push(args.prompt as string); return makeVersionedWritingQueryFn('<html>G2</html>', declarationTagged('draft-two'))(args); };
  await generateAgain(ctx, capturing, 'Tighter.');
  assert.match(prompts[1]!, /--draft-one/, "generation 1's draft is the current declaration");
  assert.doesNotMatch(prompts[1]!, /Run the CLI on a sample\./, "the project's own steps are superseded by the draft");
});

// R4-16 AT-6: accumulation — a later generation must never modify or delete an
// earlier one.
test('R4-16 AT-6: generation snapshots accumulate — generation 1 is untouched after generation 2 is written', async () => {
  const ctx = setup({ iteration: 1 });
  await runDemoBuilderTurn({
    sessionId: ctx.sessionId, project: ctx.project, projectRoot: ctx.projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeVersionedWritingQueryFn('<html>GEN-ONE</html>', declarationTagged('one')), logger: logger(ctx.logsRoot, ctx.sessionId), logsRoot: ctx.logsRoot,
  });
  await generateAgain(ctx, makeVersionedWritingQueryFn('<html>GEN-TWO</html>', declarationTagged('two')), 'Round 2 feedback.');
  assert.equal(readFileSync(join(generationDir(ctx.sessionDir, 1), 'DEMO.html'), 'utf8'), '<html>GEN-ONE</html>', 'generation 1 DEMO.html must be untouched by generation 2');
  assert.deepEqual(JSON.parse(readFileSync(join(generationDir(ctx.sessionDir, 1), 'demo-process.json'), 'utf8')), declarationTagged('one'));
  assert.equal(readFileSync(join(generationDir(ctx.sessionDir, 2), 'DEMO.html'), 'utf8'), '<html>GEN-TWO</html>');
});

// R4-16 AT-7 (mandatory adversarial AT — real-client-path round-trip): choosing
// generation 1 at lock writes ITS declaration and restores ITS sample — kills
// an implementation that ignores selectedGeneration and locks the latest.
test('R4-16 AT-7: choosing an earlier generation at lock writes ITS declaration and restores ITS sample, not the latest', async () => {
  const ctx = setup({ iteration: 1 });
  await runDemoBuilderTurn({
    sessionId: ctx.sessionId, project: ctx.project, projectRoot: ctx.projectRoot, forgeRoot: FORGE_ROOT,
    queryFn: makeVersionedWritingQueryFn('<html>GENERATION-ONE-BYTES</html>', declarationTagged('generation-one')),
    logger: logger(ctx.logsRoot, ctx.sessionId), logsRoot: ctx.logsRoot,
  });
  await generateAgain(ctx, makeVersionedWritingQueryFn('<html>GENERATION-TWO-BYTES</html>', declarationTagged('generation-two')), 'The operator will actually pick the earlier draft.');
  assert.equal(readFileSync(join(ctx.repoPath, DEMO_HTML_REL_PATH), 'utf8'), '<html>GENERATION-TWO-BYTES</html>', 'sanity: the repo holds the latest sample');

  writeSessionStatus(ctx.sessionDir, { ...readSessionStatus<DemoBuilderStatus>(ctx.sessionDir)!, phase: 'locking', selectedGeneration: 1 });
  const result = await runDemoBuilderTurn({
    sessionId: ctx.sessionId, project: ctx.project, projectRoot: ctx.projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(ctx.logsRoot, ctx.sessionId), logsRoot: ctx.logsRoot,
  });
  assert.equal(result.phase, 'locked');
  assert.equal(readFileSync(join(ctx.repoPath, DEMO_HTML_REL_PATH), 'utf8'), '<html>GENERATION-ONE-BYTES</html>', "generation 1's sample is restored");
  assert.deepEqual(readDemoProcess(ctx.repoPath), declarationTagged('generation-one'), "generation 1's declaration is written");
  assert.equal(JSON.parse(readFileSync(join(ctx.repoPath, DEMO_LOCK_REL_PATH), 'utf8')).generation, 1, 'demo.lock.json records the CHOSEN generation');
});

// R4-16 AT-8 (mandatory adversarial AT — the guard that must fail): choosing a
// generation with no snapshot THROWS, naming the requested number AND the
// generations that DO exist, and leaves project.json, the repo and
// demo.lock.json untouched (fail closed).
test('R4-16 AT-8: selectedGeneration naming a generation with no snapshot on disk throws, naming the requested + existing generations, and writes nothing', async () => {
  const ctx = setup({ iteration: 1 });
  await runDemoBuilderTurn({
    sessionId: ctx.sessionId, project: ctx.project, projectRoot: ctx.projectRoot, forgeRoot: FORGE_ROOT,
    queryFn: makeVersionedWritingQueryFn('<html>G1</html>', declarationTagged('g1')),
    logger: logger(ctx.logsRoot, ctx.sessionId), logsRoot: ctx.logsRoot,
  });
  await generateAgain(ctx, makeVersionedWritingQueryFn('<html>G2-LATEST</html>', declarationTagged('g2')));
  const declaredBefore = readDemoProcess(ctx.repoPath);
  writeSessionStatus(ctx.sessionDir, { ...readSessionStatus<DemoBuilderStatus>(ctx.sessionDir)!, phase: 'locking', selectedGeneration: 99 });

  await assert.rejects(
    () => runDemoBuilderTurn({ sessionId: ctx.sessionId, project: ctx.project, projectRoot: ctx.projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(ctx.logsRoot, ctx.sessionId), logsRoot: ctx.logsRoot }),
    /generation 99 has no readable snapshot .*Generations on disk: 1, 2\./,
  );
  assert.equal(readFileSync(join(ctx.repoPath, DEMO_HTML_REL_PATH), 'utf8'), '<html>G2-LATEST</html>', 'no partial restore');
  assert.deepEqual(readDemoProcess(ctx.repoPath), declaredBefore, 'project.json untouched');
  assert.ok(!existsSync(join(ctx.repoPath, DEMO_LOCK_REL_PATH)), 'no lock file');
  assert.equal(readSessionStatus<DemoBuilderStatus>(ctx.sessionDir)?.phase, 'locking', 'phase must NOT flip to locked on a failed restore');
});

// R4-16 AT-9: locking WITHOUT a selectedGeneration locks the NEWEST generation
// and records it — never attributed from status.iteration.
test('R4-16 AT-9: locking without selectedGeneration locks the newest generation and records it, never status.iteration', async () => {
  const ctx = setup({ iteration: 1 });
  await runDemoBuilderTurn({
    sessionId: ctx.sessionId, project: ctx.project, projectRoot: ctx.projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeVersionedWritingQueryFn('<html>G1</html>', declarationTagged('g1')), logger: logger(ctx.logsRoot, ctx.sessionId), logsRoot: ctx.logsRoot,
  });
  await generateAgain(ctx, makeVersionedWritingQueryFn('<html>G2</html>', declarationTagged('g2')));
  writeSessionStatus(ctx.sessionDir, { ...readSessionStatus<DemoBuilderStatus>(ctx.sessionDir)!, phase: 'locking', iteration: 7 });
  await runDemoBuilderTurn({
    sessionId: ctx.sessionId, project: ctx.project, projectRoot: ctx.projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(ctx.logsRoot, ctx.sessionId), logsRoot: ctx.logsRoot,
  });
  assert.equal(JSON.parse(readFileSync(join(ctx.repoPath, DEMO_LOCK_REL_PATH), 'utf8')).generation, 2, 'the newest generation, never status.iteration (7)');
  assert.deepEqual(readDemoProcess(ctx.repoPath), declarationTagged('g2'));
});

// R4-16 AT-43 (retargeted by forge-mfv5.2.8): a generation's meta.json can no
// longer name a write target — the lock writes only fixed paths. A meta.json
// smuggling the old `skillRelPath` escape is inert.
test('R4-16 AT-43: a generation meta.json carrying skillRelPath="../OUTSIDE-pwned.md" names no write target — nothing lands outside the repo', async () => {
  const ctx = setup({ iteration: 1 });
  await runDemoBuilderTurn({
    sessionId: ctx.sessionId, project: ctx.project, projectRoot: ctx.projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeVersionedWritingQueryFn('<html>G1</html>', declarationTagged('g1')), logger: logger(ctx.logsRoot, ctx.sessionId), logsRoot: ctx.logsRoot,
  });
  const metaPath = join(generationDir(ctx.sessionDir, 1), 'meta.json');
  writeFileSync(metaPath, JSON.stringify({ ...JSON.parse(readFileSync(metaPath, 'utf8')), skillRelPath: '../OUTSIDE-pwned.md' }));
  writeSessionStatus(ctx.sessionDir, { ...readSessionStatus<DemoBuilderStatus>(ctx.sessionDir)!, phase: 'locking', selectedGeneration: 1 });
  const result = await runDemoBuilderTurn({
    sessionId: ctx.sessionId, project: ctx.project, projectRoot: ctx.projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(ctx.logsRoot, ctx.sessionId), logsRoot: ctx.logsRoot,
  });
  assert.equal(result.phase, 'locked');
  assert.ok(!existsSync(join(resolve(ctx.repoPath, '..'), 'OUTSIDE-pwned.md')), 'no file may ever be written outside the repo');
});

// forge-mfv5.2.8 — the lock gate: a declaration that drives no checkpoint is
// refused with the drive rule's own reason, and nothing is written.
test('locking an undrivable declaration is refused with the rule\'s reason — project.json, DEMO.html and the lock are untouched', async () => {
  const ctx = setup({ iteration: 1 });
  await runDemoBuilderTurn({
    sessionId: ctx.sessionId, project: ctx.project, projectRoot: ctx.projectRoot, forgeRoot: FORGE_ROOT,
    queryFn: makeVersionedWritingQueryFn('<html>G1</html>', [{ kind: 'capture', text: 'Run `npm run demo | tee out` to see it.' }]),
    logger: logger(ctx.logsRoot, ctx.sessionId), logsRoot: ctx.logsRoot,
  });
  const declaredBefore = readDemoProcess(ctx.repoPath);
  writeFileSync(join(ctx.repoPath, DEMO_HTML_REL_PATH), '<html>REPO</html>');
  writeSessionStatus(ctx.sessionDir, { ...readSessionStatus<DemoBuilderStatus>(ctx.sessionDir)!, phase: 'locking' });
  await assert.rejects(
    () => runDemoBuilderTurn({ sessionId: ctx.sessionId, project: ctx.project, projectRoot: ctx.projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(ctx.logsRoot, ctx.sessionId), logsRoot: ctx.logsRoot }),
    /generation 1's declaration is refused: capture step 0 .* shell metacharacters in `npm run demo \| tee out`/,
  );
  assert.deepEqual(readDemoProcess(ctx.repoPath), declaredBefore);
  assert.equal(readFileSync(join(ctx.repoPath, DEMO_HTML_REL_PATH), 'utf8'), '<html>REPO</html>');
  assert.ok(!existsSync(join(ctx.repoPath, DEMO_LOCK_REL_PATH)));
});

test('locking a declaration draft that is not JSON is refused naming the generation', async () => {
  const ctx = setup({ iteration: 1 });
  await runDemoBuilderTurn({
    sessionId: ctx.sessionId, project: ctx.project, projectRoot: ctx.projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeVersionedWritingQueryFn('<html>G1</html>', declarationTagged('g1')), logger: logger(ctx.logsRoot, ctx.sessionId), logsRoot: ctx.logsRoot,
  });
  writeFileSync(join(generationDir(ctx.sessionDir, 1), 'demo-process.json'), '{not json');
  writeSessionStatus(ctx.sessionDir, { ...readSessionStatus<DemoBuilderStatus>(ctx.sessionDir)!, phase: 'locking' });
  await assert.rejects(
    () => runDemoBuilderTurn({ sessionId: ctx.sessionId, project: ctx.project, projectRoot: ctx.projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(ctx.logsRoot, ctx.sessionId), logsRoot: ctx.logsRoot }),
    /generation 1's declaration is not JSON/,
  );
  assert.ok(!existsSync(join(ctx.repoPath, DEMO_LOCK_REL_PATH)));
});

test("W7-C3 (sessions-kinds-26): every event row carries phase 'demo' — never the retired 'unifier'", async () => {
  const { project, projectRoot, logsRoot, sessionId } = setup();
  await runDemoBuilderTurn({
    sessionId, project, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeWritingQueryFn(), logger: logger(logsRoot, sessionId), logsRoot,
  });

  const events = readFileSync(join(logsRoot, `_demo-${sessionId}`, 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.ok(events.length > 0, 'the turn emitted events');
  for (const e of events) {
    assert.equal(e.phase, 'demo', `event ${e.event_type} "${e.message}" filed under phase "${e.phase}" — demo sessions must not bill the retired unifier phase`);
  }
});
