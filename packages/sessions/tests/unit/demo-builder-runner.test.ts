import { logger, makeElementQueryFn, makeNoopQueryFn, makeWritingQueryFn, setup, writeComposedProcess } from './test-fixtures/demo-builder-runner-fixtures.ts';
import { test } from 'node:test';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runDemoBuilderTurn, DEMO_BUILDER_MODEL, DEMO_HTML_REL_PATH, DEMO_SKILL_REL_PATH, DEMO_LOCK_REL_PATH, type DemoBuilderStatus } from '../../kinds/demo-builder.ts';
import { type QueryFn } from '../../interactive-session.ts';
import { writeSessionStatus, readSessionStatus } from '../../interactive-session.ts';

// ---------------------------------------------------------------------------
// ADR-043 §3 amendment (wave-6 kickoff model-tier seam)
// ---------------------------------------------------------------------------

/** Like makeWritingQueryFn, but also captures the model handed to queryFn. */
function makeWritingQueryFnCapturingModel(onModel: (model: string | undefined) => void): QueryFn {
  return ({ options }) => {
    onModel((options as { model?: string }).model);
    const cwd = (options?.cwd as string) ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(cwd, '.forge', 'demo'), { recursive: true });
      mkdirSync(join(cwd, '.forge', 'skills', 'demo-design'), { recursive: true });
      writeFileSync(join(cwd, DEMO_SKILL_REL_PATH), '# demo-design');
      writeFileSync(join(cwd, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>sample</body></html>');
      yield { type: 'result', total_cost_usd: 0.05 };
    }
    return gen();
  };
}

test('status.modelTier is honored: an operator-requested "opus" reaches queryFn as options.model', async () => {
  const { projectRoot, logsRoot, sessionId } = setup({ modelTier: 'opus' });
  let capturedModel: string | undefined;
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT,
    queryFn: makeWritingQueryFnCapturingModel((m) => { capturedModel = m; }),
    logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.equal(capturedModel, 'claude-opus-4-8');
});

test('status.modelTier absent resolves to the unchanged default (sonnet) — byte-identical prior behavior', async () => {
  const { projectRoot, logsRoot, sessionId } = setup();
  let capturedModel: string | undefined;
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT,
    queryFn: makeWritingQueryFnCapturingModel((m) => { capturedModel = m; }),
    logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.equal(capturedModel, DEMO_BUILDER_MODEL);
  assert.equal(capturedModel, 'claude-sonnet-4-6');
});

test('status.modelTier outside the declared range throws naming the value and the allowed set', async () => {
  const { projectRoot, logsRoot, sessionId } = setup({ modelTier: 'haiku' });
  await assert.rejects(
    () => runDemoBuilderTurn({
      sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeWritingQueryFn(), logger: logger(logsRoot, sessionId), logsRoot,
    }),
    /requested model tier "haiku".*allowed tier\(s\): sonnet, opus/,
  );
});

// ---------------------------------------------------------------------------
// R4-16 — generation snapshots + choose-a-generation lock.
//
// TEST-FIRST PIN: none of this exists yet at branch base. `runGenerateStep`
// today writes ONLY into the project repo (.forge/demo/, .forge/skills/) and
// never touches `<sessionDir>/generations/`; `runLockStep` never reads
// `status.selectedGeneration` and `demo.lock.json` has no `generation` field.
// Every test below is RED for that reason — see each test's comment for the
// specific wrong implementation it kills.
// ---------------------------------------------------------------------------

/** A queryFn that writes DEMO.html + the demo-design SKILL.md with CALLER-
 *  CONTROLLED byte content each turn — lets a test drive two generations with
 *  distinct, independently-verifiable bytes (the R4-16 round-trip ATs). */
function makeVersionedWritingQueryFn(demoBytes: string, skillBytes: string): QueryFn {
  return ({ options }) => {
    const cwd = (options?.cwd as string) ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(cwd, '.forge', 'demo'), { recursive: true });
      mkdirSync(join(cwd, '.forge', 'skills', 'demo-design'), { recursive: true });
      writeFileSync(join(cwd, DEMO_SKILL_REL_PATH), skillBytes);
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

// R4-16 AT-1: a successful generate turn snapshots DEMO.html + SKILL.md +
// meta.json into generations/<iteration>/ — kills an implementation that
// never snapshots at all (today's runGenerateStep only writes into the repo).
test('R4-16 AT-1: generate turn snapshots DEMO.html + SKILL.md + meta.json into generations/<iteration>/', async () => {
  const { projectRoot, logsRoot, sessionId, sessionDir } = setup({ iteration: 1 });
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeVersionedWritingQueryFn('<html>V1 demo</html>', '# demo-design V1'), logger: logger(logsRoot, sessionId), logsRoot,
  });
  const gdir = generationDir(sessionDir, 1);
  assert.ok(existsSync(join(gdir, 'DEMO.html')), 'DEMO.html snapshotted');
  assert.ok(existsSync(join(gdir, 'SKILL.md')), 'SKILL.md snapshotted');
  assert.ok(existsSync(join(gdir, 'meta.json')), 'meta.json written');
  assert.equal(readFileSync(join(gdir, 'DEMO.html'), 'utf8'), '<html>V1 demo</html>');
  assert.equal(readFileSync(join(gdir, 'SKILL.md'), 'utf8'), '# demo-design V1');
});

// R4-16 AT-2: meta.json fidelity for a plain (non-composed, non-targetElement,
// no feedback) generation — kills an implementation that invents/omits fields
// or defaults feedback to "" instead of null.
test('R4-16 AT-2: meta.json carries iteration, a real createdAt, feedback:null, targetElement:null, composed:false, and the demo-design skillRelPath', async () => {
  const { projectRoot, logsRoot, sessionId, sessionDir } = setup({ iteration: 1 });
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeVersionedWritingQueryFn('<html>V1</html>', '# skill V1'), logger: logger(logsRoot, sessionId), logsRoot,
  });
  const meta = readMeta(sessionDir, 1);
  assert.equal(meta.iteration, 1);
  assert.ok(typeof meta.createdAt === 'string' && !Number.isNaN(Date.parse(meta.createdAt)), `createdAt must be a real ISO timestamp, got: ${meta.createdAt}`);
  assert.equal(meta.feedback, null, 'no feedback.md at turn end ⇒ feedback:null, never fabricated');
  assert.equal(meta.targetElement, null);
  assert.equal(meta.composed, false);
  assert.equal(meta.skillRelPath, DEMO_SKILL_REL_PATH);
});

// R4-16 AT-3: feedback attribution — the feedback.md content that drove THIS
// generation is captured verbatim; kills an implementation that fabricates,
// drops, or attributes the WRONG (e.g. a later) round's feedback.
test('R4-16 AT-3: meta.json.feedback captures the feedback.md content that drove THIS generation, verbatim', async () => {
  const { projectRoot, logsRoot, sessionId, sessionDir } = setup({ iteration: 2 });
  writeFileSync(join(sessionDir, 'feedback.md'), 'Make it punchier and shorter.');
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeVersionedWritingQueryFn('<html>V2</html>', '# skill V2'), logger: logger(logsRoot, sessionId), logsRoot,
  });
  const meta = readMeta(sessionDir, 2);
  assert.equal(meta.feedback, 'Make it punchier and shorter.');
});

// R4-16 AT-4: targetElement iteration snapshots the PER-ELEMENT skill (not the
// composer), and meta.json names the element + the real project-repo-relative
// skillRelPath it was copied from — kills an implementation that always
// snapshots the demo-design composer regardless of targetElement.
test('R4-16 AT-4: per-element iteration snapshots the element skill, and meta.json.skillRelPath + targetElement name it', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup({ phase: 'generating', targetElement: 'cli-capture', iteration: 1 });
  writeComposedProcess(repoPath);
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeElementQueryFn('cli-capture'), logger: logger(logsRoot, sessionId), logsRoot,
  });
  const meta = readMeta(sessionDir, 1);
  assert.equal(meta.targetElement, 'cli-capture');
  assert.equal(meta.skillRelPath, '.forge/skills/demo/cli-capture/SKILL.md');
  const gdir = generationDir(sessionDir, 1);
  assert.equal(readFileSync(join(gdir, 'SKILL.md'), 'utf8'), '# cli-capture element');
});

// R4-16 AT-5: a composed (multi-element) generate turn records composed:true
// and snapshots the composer skill (demo-design), not a per-element one —
// kills an implementation that hardcodes composed:false or snapshots the
// wrong skill for the composed case.
test('R4-16 AT-5: composed generate turn records composed:true and snapshots the demo-design composer skill', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup({ iteration: 1 });
  writeComposedProcess(repoPath);
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeWritingQueryFn(), logger: logger(logsRoot, sessionId), logsRoot,
  });
  const meta = readMeta(sessionDir, 1);
  assert.equal(meta.composed, true);
  assert.equal(meta.skillRelPath, DEMO_SKILL_REL_PATH);
});

// R4-16 AT-6: accumulation — a later generation must never modify or delete an
// earlier one. Kills an implementation that snapshots into a single reused
// dir, or overwrites generation 1 when generation 2 is written.
test('R4-16 AT-6: generation snapshots accumulate — generation 1 is untouched after generation 2 is written', async () => {
  const { projectRoot, logsRoot, sessionId, sessionDir } = setup({ iteration: 1 });
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeVersionedWritingQueryFn('<html>GEN-ONE</html>', '# skill ONE'), logger: logger(logsRoot, sessionId), logsRoot,
  });
  // Advance to a second generate turn (operator gave feedback; iteration bumped).
  const afterGen1 = readSessionStatus<DemoBuilderStatus>(sessionDir)!;
  writeFileSync(join(sessionDir, 'feedback.md'), 'Round 2 feedback.');
  writeSessionStatus(sessionDir, { ...afterGen1, phase: 'generating', iteration: 2 });
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeVersionedWritingQueryFn('<html>GEN-TWO</html>', '# skill TWO'), logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.equal(readFileSync(join(generationDir(sessionDir, 1), 'DEMO.html'), 'utf8'), '<html>GEN-ONE</html>', 'generation 1 DEMO.html must be untouched by generation 2');
  assert.equal(readFileSync(join(generationDir(sessionDir, 1), 'SKILL.md'), 'utf8'), '# skill ONE');
  assert.equal(readFileSync(join(generationDir(sessionDir, 2), 'DEMO.html'), 'utf8'), '<html>GEN-TWO</html>');
});

// R4-16 AT-7 (mandatory adversarial AT — real-client-path round-trip): run the
// REAL runDemoBuilderTurn TWICE with an injected queryFn writing DIFFERENT
// DEMO.html + SKILL.md bytes each turn, then run the REAL lock step choosing
// generation 1 — the file the demo-runner would EXECUTE afterward must be
// generation 1's exact bytes, not the latest. Kills an implementation that
// ignores selectedGeneration and simply locks whatever is currently in the
// repo (today's runLockStep behaviour, unmodified).
test('R4-16 AT-7: choosing an earlier generation at lock restores ITS bytes to the repo, not the latest — real runner, real lock step, on-disk round-trip', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup({ iteration: 1 });

  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT,
    queryFn: makeVersionedWritingQueryFn('<html>GENERATION-ONE-BYTES</html>', '# GENERATION-ONE-SKILL'),
    logger: logger(logsRoot, sessionId), logsRoot,
  });

  const afterGen1 = readSessionStatus<DemoBuilderStatus>(sessionDir)!;
  writeFileSync(join(sessionDir, 'feedback.md'), 'The operator will actually pick the earlier draft.');
  writeSessionStatus(sessionDir, { ...afterGen1, phase: 'generating', iteration: 2 });
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT,
    queryFn: makeVersionedWritingQueryFn('<html>GENERATION-TWO-BYTES</html>', '# GENERATION-TWO-SKILL'),
    logger: logger(logsRoot, sessionId), logsRoot,
  });

  // Sanity: before locking, the repo holds the LATEST (generation 2) bytes.
  assert.equal(readFileSync(join(repoPath, DEMO_HTML_REL_PATH), 'utf8'), '<html>GENERATION-TWO-BYTES</html>');

  const afterGen2 = readSessionStatus<DemoBuilderStatus>(sessionDir)!;
  writeSessionStatus(sessionDir, { ...afterGen2, phase: 'locking', selectedGeneration: 1 });
  const result = await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.equal(result.phase, 'locked');

  assert.equal(
    readFileSync(join(repoPath, DEMO_HTML_REL_PATH), 'utf8'),
    '<html>GENERATION-ONE-BYTES</html>',
    "the repo's DEMO.html must hold generation 1's bytes after choosing it at lock — not the latest generation",
  );
  assert.equal(
    readFileSync(join(repoPath, DEMO_SKILL_REL_PATH), 'utf8'),
    '# GENERATION-ONE-SKILL',
    "the repo's demo-design SKILL.md must hold generation 1's bytes after choosing it at lock",
  );

  const lock = JSON.parse(readFileSync(join(repoPath, DEMO_LOCK_REL_PATH), 'utf8'));
  assert.equal(lock.generation, 1, 'demo.lock.json must record the CHOSEN generation, not the latest iteration');
});

// R4-16 AT-8 (mandatory adversarial AT — the guard that must fail): choosing a
// generation that has no readable/parsable snapshot must THROW, naming the
// requested number AND the generations that DO exist, and must leave the repo
// + demo.lock.json untouched (fail closed — the declared-data-fails-open
// antipattern this campaign keeps finding). Kills an implementation that
// silently falls back to locking the latest generation when the requested one
// is missing.
test('R4-16 AT-8: selectedGeneration naming a generation with no snapshot on disk throws, naming the requested + existing generations, and leaves the repo + demo.lock.json untouched', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup({ iteration: 1 });

  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT,
    queryFn: makeVersionedWritingQueryFn('<html>G1</html>', '# S1'),
    logger: logger(logsRoot, sessionId), logsRoot,
  });
  const afterGen1 = readSessionStatus<DemoBuilderStatus>(sessionDir)!;
  writeSessionStatus(sessionDir, { ...afterGen1, phase: 'generating', iteration: 2 });
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT,
    queryFn: makeVersionedWritingQueryFn('<html>G2-LATEST</html>', '# S2'),
    logger: logger(logsRoot, sessionId), logsRoot,
  });

  const afterGen2 = readSessionStatus<DemoBuilderStatus>(sessionDir)!;
  writeSessionStatus(sessionDir, { ...afterGen2, phase: 'locking', selectedGeneration: 99 });

  await assert.rejects(
    () => runDemoBuilderTurn({ sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /99/, 'must name the requested (nonexistent) generation');
      assert.match(err.message, /1/, 'must name a generation that DOES exist (1)');
      assert.match(err.message, /2/, 'must name a generation that DOES exist (2)');
      return true;
    },
  );

  assert.equal(
    readFileSync(join(repoPath, DEMO_HTML_REL_PATH), 'utf8'),
    '<html>G2-LATEST</html>',
    'no partial restore — the repo must still hold the LATEST bytes, untouched',
  );
  assert.ok(!existsSync(join(repoPath, DEMO_LOCK_REL_PATH)), 'no lock file must be written when the chosen generation cannot be restored');
  assert.equal(readSessionStatus<DemoBuilderStatus>(sessionDir)?.phase, 'locking', 'phase must NOT flip to locked on a failed restore');
});

// R4-16 AT-9: locking WITHOUT a selectedGeneration records generation:null in
// demo.lock.json — never attributed from status.iteration (a field that
// happens to be a number is not the same thing as "the chosen generation").
// Kills an implementation that omits the "generation" key entirely, or that
// defaults it to status.iteration.
test('R4-16 AT-9: locking without selectedGeneration records demo.lock.json.generation as null, never status.iteration', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId } = setup({ phase: 'locking', iteration: 7 });
  mkdirSync(join(repoPath, '.forge', 'demo'), { recursive: true });
  mkdirSync(join(repoPath, '.forge', 'skills', 'demo-design'), { recursive: true });
  writeFileSync(join(repoPath, DEMO_SKILL_REL_PATH), '# demo-design');
  writeFileSync(join(repoPath, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>demo</body></html>');

  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot,
  });
  const lock = JSON.parse(readFileSync(join(repoPath, DEMO_LOCK_REL_PATH), 'utf8'));
  assert.ok(Object.prototype.hasOwnProperty.call(lock, 'generation'), 'demo.lock.json must carry a "generation" key even when none was chosen');
  assert.strictEqual(lock.generation, null, 'no selectedGeneration ⇒ generation:null — must never be omitted, and must never be attributed from status.iteration (7)');
});

// ---------------------------------------------------------------------------
// R4-16 PIN 2 — round-2 adversarial findings against HEAD b1f59575 (backend
// a374805c already landed). Findings B + C: `readGenerationSnapshotMeta`
// (demo-builder-runner.ts) only checks `skillRelPath` is a non-empty string
// before `runLockStep` does `join(status.project_repo_path, meta.skillRelPath)`
// and WRITES to it — an unvalidated write target — and `demo.lock.json`'s
// `demo_skill` is hardcoded to `existsSync(DEMO_SKILL_REL_PATH) ? ... : null`,
// ignoring which skill this generation ACTUALLY restored.
// ---------------------------------------------------------------------------

/** Overwrites an EXISTING generation's meta.json (written by a real generate
 *  turn) with the given field overrides — used to smuggle a malicious
 *  `skillRelPath` past a real, already-verified-valid generation snapshot,
 *  exactly the shape an operator-facing bug or a compromised agent turn
 *  could produce (every OTHER field stays genuinely valid JSON). */
function overwriteGenerationMeta(sessionDir: string, n: number | string, overrides: Record<string, unknown>): void {
  const p = join(generationDir(sessionDir, n), 'meta.json');
  const current = JSON.parse(readFileSync(p, 'utf8'));
  writeFileSync(p, JSON.stringify({ ...current, ...overrides }, null, 2));
}

// Finding B (MAJOR) — skillRelPath is an unvalidated write target.

// R4-16 AT-43 (Finding B, relative escape): kills the current implementation,
// which happily writes ONE LEVEL ABOVE the repo because
// `readGenerationSnapshotMeta` only checks skillRelPath is a non-empty
// string — no allowlist, no containment.
test('R4-16 AT-43: a generation meta.json with skillRelPath="../OUTSIDE-pwned.md" is REJECTED at lock — no file written outside the repo, no lock file, phase unchanged', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup({ iteration: 1 });
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeVersionedWritingQueryFn('<html>G1</html>', '# S1'), logger: logger(logsRoot, sessionId), logsRoot,
  });
  overwriteGenerationMeta(sessionDir, 1, { skillRelPath: '../OUTSIDE-pwned.md' });

  const afterGen1 = readSessionStatus<DemoBuilderStatus>(sessionDir)!;
  writeSessionStatus(sessionDir, { ...afterGen1, phase: 'locking', selectedGeneration: 1 });

  await assert.rejects(
    () => runDemoBuilderTurn({ sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot }),
    (err: unknown) => { assert.ok(err instanceof Error); return true; },
  );
  // setup() lays out <root>/{project,repo} — "one level above the repo" is <root>.
  const rootAboveRepo = resolve(repoPath, '..');
  assert.ok(!existsSync(join(rootAboveRepo, 'OUTSIDE-pwned.md')), 'no file may ever be written outside the repo');
  assert.ok(!existsSync(join(repoPath, DEMO_LOCK_REL_PATH)), 'no lock file must be written when skillRelPath is rejected');
  assert.equal(readSessionStatus<DemoBuilderStatus>(sessionDir)?.phase, 'locking', 'phase must NOT flip to locked on a rejected skillRelPath');
});

// R4-16 AT-44 (Finding B, absolute-shaped path — a NAIVE ".."-blocklist fix
// would NOT catch this, since it contains zero ".." segments): empirically,
// `join(repoPath, '/tmp/x')` (this codebase uses `path.join`, never
// `path.resolve`/manual concatenation) does NOT escape the repo the way a
// relative "../…" does — it nests under the repo as `repoPath/tmp/x`
// (verified: `join('/a/b','/tmp/x') === '/a/b/tmp/x'`, NOT '/tmp/x'). This is
// still a real defect (an arbitrary write to an unintended in-repo location,
// never one of the two legitimate skill paths) and the CONTRACT's allowlist
// must reject it regardless of where it resolves — this AT is the proof that
// only a real allowlist (not a "no .." check") satisfies the contract, since
// this exact input would sail through a naive dot-dot filter.
test('R4-16 AT-44: skillRelPath="/tmp/OUTSIDE-abs-pwned.md" (absolute-shaped, zero ".." segments) is REJECTED at lock by the allowlist — never written anywhere, no lock file, phase unchanged', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup({ iteration: 1 });
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeVersionedWritingQueryFn('<html>G1</html>', '# S1'), logger: logger(logsRoot, sessionId), logsRoot,
  });
  overwriteGenerationMeta(sessionDir, 1, { skillRelPath: '/tmp/OUTSIDE-abs-pwned.md' });

  const afterGen1 = readSessionStatus<DemoBuilderStatus>(sessionDir)!;
  writeSessionStatus(sessionDir, { ...afterGen1, phase: 'locking', selectedGeneration: 1 });

  await assert.rejects(
    () => runDemoBuilderTurn({ sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot }),
    (err: unknown) => { assert.ok(err instanceof Error); return true; },
  );
  // Today's (buggy) actual write location, per path.join's real semantics —
  // must never exist once the allowlist rejects this shape.
  assert.ok(!existsSync(join(repoPath, 'tmp', 'OUTSIDE-abs-pwned.md')), 'an absolute-shaped skillRelPath must never be written anywhere, in or out of the repo');
  assert.ok(!existsSync(join(repoPath, DEMO_LOCK_REL_PATH)), 'no lock file must be written');
  assert.equal(readSessionStatus<DemoBuilderStatus>(sessionDir)?.phase, 'locking');
});

// R4-16 AT-45 (Finding B, symlinked directory — proves the allowlist ALONE
// is not sufficient, realpath containment is also required): the path
// STRING here (".forge/skills/demo/evil/SKILL.md") lexically matches the
// legitimate per-element shape exactly — only realpath resolution reveals
// that "demo/evil" is a symlink to an outside directory. Kills an
// implementation that validates skillRelPath by regex/shape alone.
test('R4-16 AT-45: a symlinked .forge/skills/demo/evil/ directory + a LEXICALLY-legitimate skillRelPath (".forge/skills/demo/evil/SKILL.md") is still REJECTED — realpath containment catches what the allowlist shape alone cannot', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup({ iteration: 1 });
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeVersionedWritingQueryFn('<html>G1</html>', '# S1'), logger: logger(logsRoot, sessionId), logsRoot,
  });
  const outsideDir = mkdtempSync(join(tmpdir(), 'skillrelpath-escape-outside-'));
  try {
    mkdirSync(join(repoPath, '.forge', 'skills', 'demo'), { recursive: true });
    symlinkSync(outsideDir, join(repoPath, '.forge', 'skills', 'demo', 'evil'));
    overwriteGenerationMeta(sessionDir, 1, { skillRelPath: '.forge/skills/demo/evil/SKILL.md' });

    const afterGen1 = readSessionStatus<DemoBuilderStatus>(sessionDir)!;
    writeSessionStatus(sessionDir, { ...afterGen1, phase: 'locking', selectedGeneration: 1 });

    await assert.rejects(
      () => runDemoBuilderTurn({ sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot }),
      (err: unknown) => { assert.ok(err instanceof Error); return true; },
    );
    assert.ok(!existsSync(join(outsideDir, 'SKILL.md')), 'no file may be written through a symlinked directory outside the repo, even when the path STRING lexically matches the allowlist shape');
    assert.ok(!existsSync(join(repoPath, DEMO_LOCK_REL_PATH)), 'no lock file must be written');
    assert.equal(readSessionStatus<DemoBuilderStatus>(sessionDir)?.phase, 'locking');
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// R4-16 AT-46 (Finding B, positive control — the per-element legitimate
// shape): GREEN today, not a defect pin (today has no allowlist at all, so
// nothing rejects this legitimate path either) — it earns its place as the
// regression guard against the WRONG fix for AT-43/44/45: an allowlist
// implemented too narrowly (e.g. only ever accepting the exact composer path)
// would silently start rejecting real per-element locks the moment it ships.
// The composer-path positive control is ALREADY covered end-to-end by AT-7
// (its round-trip restores through the default DEMO_SKILL_REL_PATH shape) —
// not duplicated here.
test('R4-16 AT-46 (positive control, green today): a per-element generation restores end-to-end through its real skillRelPath at lock — the legitimate shape must keep working once the allowlist ships, not just be rejected', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup({ phase: 'generating', targetElement: 'cli-capture', iteration: 1 });
  writeComposedProcess(repoPath);
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeElementQueryFn('cli-capture'), logger: logger(logsRoot, sessionId), logsRoot,
  });
  // Overwrite the repo's copies with stale content so a real restore is
  // provably what put the correct bytes back, not "it was already there".
  writeFileSync(join(repoPath, '.forge', 'skills', 'demo', 'cli-capture', 'SKILL.md'), '# STALE — must be overwritten by the restore');
  writeFileSync(join(repoPath, DEMO_HTML_REL_PATH), '<html>STALE — must be overwritten</html>');

  const afterGen1 = readSessionStatus<DemoBuilderStatus>(sessionDir)!;
  writeSessionStatus(sessionDir, { ...afterGen1, phase: 'locking', selectedGeneration: 1 });
  const result = await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.equal(result.phase, 'locked', 'the legitimate per-element shape must still lock successfully once the allowlist ships');
  assert.equal(
    readFileSync(join(repoPath, '.forge', 'skills', 'demo', 'cli-capture', 'SKILL.md'), 'utf8'),
    '# cli-capture element',
    'the real snapshot content must have been restored — proves this is a genuine restore, not a no-op pass-through',
  );
});

// Finding C (MAJOR) — demo.lock.json's demo_skill is hardcoded to the
// composer path, ignoring which generator this generation ACTUALLY restored.

// R4-16 AT-47 (Finding C, false negative): kills
// `demo_skill: existsSync(DEMO_SKILL_REL_PATH) ? DEMO_SKILL_REL_PATH : null`
// — today this reports null for a per-element lock even though the REAL
// generator (the element skill) is sitting right there on disk.
test('R4-16 AT-47: finalizing a per-element generation (no composer skill anywhere in the repo) records demo_skill as the ELEMENT path, never null', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup({ phase: 'generating', targetElement: 'cli-capture', iteration: 1 });
  writeComposedProcess(repoPath);
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeElementQueryFn('cli-capture'), logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.ok(!existsSync(join(repoPath, DEMO_SKILL_REL_PATH)), 'sanity: the composer skill genuinely does not exist for this generation');

  const afterGen1 = readSessionStatus<DemoBuilderStatus>(sessionDir)!;
  writeSessionStatus(sessionDir, { ...afterGen1, phase: 'locking', selectedGeneration: 1 });
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot,
  });
  const lock = JSON.parse(readFileSync(join(repoPath, DEMO_LOCK_REL_PATH), 'utf8'));
  assert.equal(
    lock.demo_skill,
    '.forge/skills/demo/cli-capture/SKILL.md',
    `demo_skill must name the ACTUAL generator restored for this generation, not fall back to null just because the (irrelevant) composer path is absent — got: ${JSON.stringify(lock.demo_skill)}`,
  );
});

// R4-16 AT-48 (Finding C, false positive — the WORSE direction): kills the
// same hardcoded read pairing a STALE composer skill (left over from an
// earlier, composed generation) with a LATER, per-element generation's
// DEMO.html — today's demo.lock.json would claim the wrong generator entirely.
test('R4-16 AT-48: finalizing a per-element generation 2 after a composed generation 1 left a stale composer skill on disk — demo_skill must name generation 2\'s OWN skillRelPath, never the stale composer', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup({ iteration: 1 });
  writeComposedProcess(repoPath);
  // Generation 1: composed — writes a REAL composer skill to the repo.
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeWritingQueryFn(), logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.ok(existsSync(join(repoPath, DEMO_SKILL_REL_PATH)), "sanity: generation 1 really did leave a composer skill on disk");

  // Generation 2: per-element — the stale composer from generation 1 is left
  // untouched in the repo (makeElementQueryFn never writes DEMO_SKILL_REL_PATH).
  const afterGen1 = readSessionStatus<DemoBuilderStatus>(sessionDir)!;
  writeFileSync(join(sessionDir, 'feedback.md'), 'Refine just the cli-capture element.');
  writeSessionStatus(sessionDir, { ...afterGen1, phase: 'generating', iteration: 2, targetElement: 'cli-capture' });
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeElementQueryFn('cli-capture'), logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.ok(existsSync(join(repoPath, DEMO_SKILL_REL_PATH)), 'sanity: the STALE composer skill is still sitting in the repo, untouched');

  const afterGen2 = readSessionStatus<DemoBuilderStatus>(sessionDir)!;
  writeSessionStatus(sessionDir, { ...afterGen2, phase: 'locking', selectedGeneration: 2 });
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot,
  });
  const lock = JSON.parse(readFileSync(join(repoPath, DEMO_LOCK_REL_PATH), 'utf8'));
  assert.notEqual(lock.demo_skill, DEMO_SKILL_REL_PATH, "demo_skill must NOT pair generation 2's DEMO.html with generation 1's stale composer skill");
  assert.equal(lock.demo_skill, '.forge/skills/demo/cli-capture/SKILL.md', "demo_skill must name generation 2's OWN skillRelPath");
});

test("W7-C3 (sessions-kinds-26): every event row carries phase 'demo' — never the retired 'unifier'", async () => {
  const { projectRoot, logsRoot, sessionId } = setup();
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeWritingQueryFn(), logger: logger(logsRoot, sessionId), logsRoot,
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
