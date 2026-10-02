/**
 * run.test.ts — WIRING DOORS for `run.mjs`'s teardown exit code, D's review
 * of #906, MUST 1.
 *
 * `main()` CANNOT BE EXERCISED AS A UNIT. It boots a real bridge, a real
 * Playwright browser, checks host locks and memory, and calls
 * `main().then((code) => process.exit(code))` at module scope — importing it
 * at all RUNS it. So these doors read the SOURCE TEXT instead, the same
 * shape `run-story.test.ts` and `reap.test.ts`'s "controls file raises
 * keepArtifacts BEFORE the reap" test use for the identical reason.
 *
 * WHAT THIS CAN AND CANNOT PROVE. `teardownExitCode` itself — the actual
 * decision logic — is a plain, pure function and is fully behaviourally
 * doored in `sweep-teardown.test.ts` (red before it existed, green after,
 * mutation-checked). What THIS file proves is narrower and cannot be proven
 * any other way: that `main()` actually CALLS that function with its own
 * `exitCode` and `stop`, and actually REASSIGNS `exitCode` from the result,
 * rather than computing a fold nobody reads — exactly the shape of MUST 1's
 * defect (a surviving daemon grandchild printed a REFUSING/DID NOT HOLD line
 * and the process still exited 0).
 *
 * ROW 166 FOLLOW-UP (bead `forge-8vfn.8.1.60`) — the anchor below now carries
 * `{ sinceMs: startedMs }`: `stopSchedulerCensusAndRelease` REQUIRES it
 * (fail-fast, its own header explains why a second, optional code path would
 * be the back-compat shim CLAUDE.md refuses), so a call without it throws
 * rather than silently skipping the deferred-initiative clear a DEFERRED
 * initiative — one still in flight when its story ended, by design — needs
 * at batch end. This flips a previously pinned exact-call-text anchor; the
 * shape it now pins is CALLED WITH the run's own window, never bare.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC_PATH = join(import.meta.dirname, 'run.mjs');
const src = () => readFileSync(SRC_PATH, 'utf8');
const STOP_CALL = 'const stop = await stopSchedulerCensusAndRelease(ROOT, { sinceMs: startedMs });';

test('MUST 1: teardownExitCode is imported from sweep-teardown.mjs', () => {
  assert.match(
    src(),
    /import\s*\{[^}]*\bteardownExitCode\b[^}]*\}\s*from\s*'\.\/sweep-teardown\.mjs';/,
    'teardownExitCode must be imported alongside stopSchedulerCensusAndRelease',
  );
});

test('MUST 1: the teardown\'s stop result is folded into exitCode, and exitCode is REASSIGNED from it', () => {
  const s = src();
  const stopAt = s.indexOf(STOP_CALL);
  assert.notEqual(
    stopAt, -1, 'the teardown call itself must still exist, unmoved, and still carry its window (row 166)',
  );
  const foldAt = s.indexOf('teardownExitCode(exitCode, stop)', stopAt);
  assert.notEqual(foldAt, -1, 'teardownExitCode must be called with the CURRENT exitCode and the stop it just produced, after the stop call');
  const reassignAt = s.indexOf('exitCode = teardown.exitCode;', foldAt);
  assert.notEqual(reassignAt, -1, 'exitCode must be REASSIGNED from the fold\'s result — computing it and discarding it is the exact defect MUST 1 closes');
});

test('MUST 1: the fold runs inside the SAME finally block as the teardown call, before that block ends', () => {
  const s = src();
  const finallyAt = s.indexOf('} finally {');
  const stopAt = s.indexOf(STOP_CALL);
  const reassignAt = s.indexOf('exitCode = teardown.exitCode;');
  const finallyCloses = s.indexOf('\n  }\n', reassignAt); // the finally block's own closing brace, first one after the reassignment
  assert.ok(finallyAt !== -1 && finallyAt < stopAt, 'the teardown call must be inside the finally block, not the try');
  assert.ok(stopAt < reassignAt, 'the fold must read the stop result the SAME pass produced, never a stale one');
  assert.ok(reassignAt < finallyCloses, 'the reassignment must land before the finally block ends, so the outer `return exitCode` sees it');
});

test('MUST 1: the final return still reads the SAME exitCode variable the teardown can now change', () => {
  const s = src();
  assert.match(s, /\n\s*return exitCode;\s*\n\}/, 'main() must still return the mutable exitCode, not a snapshot taken before the finally block');
});

/**
 * Row 146 (`forge-8vfn.8.1.52`) — a SIGTERM/SIGINT to this run's own process
 * group skips `main()`'s `finally` block entirely: Node terminates on either
 * signal, with no listener installed, before a pending `finally` ever runs
 * (`sweep.mjs`'s own header). S10 run 43 measured exactly that — its
 * own-artefacts clear never ran, and the next run's residue guard refused on
 * what it left (ruling 1911). These doors read the SOURCE TEXT for the same
 * reason the MUST 1 doors above do: `main()` cannot be exercised as a unit.
 */
test('row 146: run.mjs imports sweepCycleArtefacts — same claim-then-clear as the trailing sweep', () => {
  assert.match(
    src(),
    /import\s*\{[^}]*\bsweepCycleArtefacts\b[^}]*\}\s*from\s*'\.\/sweep-cycle-artefacts\.mjs';/,
    'the post-stop sweep must reuse sweepProductFixtures\' own function, never a second copy of the claim',
  );
});

test('row 146: SIGTERM and SIGINT are both handled, so a stop gets a chance to sweep before exit', () => {
  const s = src();
  assert.match(s, /process\.once\(\s*'SIGTERM'/, 'SIGTERM must be handled — otherwise Node exits unswept');
  assert.match(s, /process\.once\(\s*'SIGINT'/, 'SIGINT must be handled for the same reason');
});

test('row 146: the signal handler calls sweepCycleArtefacts scoped to this run\'s startedMs window', () => {
  const s = src();
  const handlerAt = s.indexOf('const onStopSignal =');
  assert.notEqual(
    handlerAt, -1,
    'the post-stop handler must exist as one named function, not inlined twice for the two signals',
  );
  const callAt = s.indexOf('sweepCycleArtefacts(', handlerAt);
  assert.notEqual(callAt, -1, 'the handler must call sweepCycleArtefacts');
  const sinceAt = s.indexOf('sinceMs: startedMs', callAt);
  assert.notEqual(
    sinceAt, -1,
    'the sweep must be scoped to startedMs — never another run\'s artefacts (born-within-this-run)',
  );
});

test('row 146: both signals are wired to the SAME handler, not two independent copies of it', () => {
  const s = src();
  assert.match(s, /process\.once\(\s*'SIGTERM',\s*\(\)\s*=>\s*onStopSignal\('SIGTERM'\)\)/);
  assert.match(s, /process\.once\(\s*'SIGINT',\s*\(\)\s*=>\s*onStopSignal\('SIGINT'\)\)/);
});

test('row 146: the handler also clears _agent-*/_authoring-* dirs residue.sh gates, same window', () => {
  const s = src();
  assert.match(
    s,
    /import\s*\{[^}]*\bcaptureAndClearBornLogDirs\b[^}]*\}\s*from\s*'\.\/sweep-post-stop-logs\.mjs';/,
    'the two Studio-session families residue.sh gates (lines 68-69) need the same post-stop clear',
  );
  const handlerAt = s.indexOf('const onStopSignal =');
  const callAt = s.indexOf('captureAndClearBornLogDirs(', handlerAt);
  assert.notEqual(callAt, -1, 'the handler must call captureAndClearBornLogDirs');
  const sinceAt = s.indexOf('sinceMs: startedMs', callAt);
  assert.notEqual(
    sinceAt, -1,
    'the born-log clear must share the SAME startedMs window, never another run\'s',
  );
  assert.match(s.slice(callAt, sinceAt), /_agent-.*_authoring-|_authoring-.*_agent-/s);
});

/**
 * Row 184b (forge-8vfn.8.5.21), Defect B fold — the SAME `onStopSignal` gap,
 * two more ways. A story run killed by SIGINT mid-story left (a) its own
 * minted architect session standing in the REAL ground, moving its method-C
 * hash off the pin the next run's launcher checks, and (b) its own `forge
 * studio` bridge — and `next-server`, the bridge's own child — bound to
 * 4123/4124 for as long as ten minutes, refusing the next run's boot. Both
 * SOURCE-TEXT doors for the same reason row 146's own doors are: `main()`
 * cannot be exercised as a unit.
 */
test('row 184b: bridgeProc and inProgressGround are declared BEFORE the signal listeners, never after', () => {
  // A `let` a closure reads before its OWN declaration line has run throws
  // (TDZ) rather than running the handler — and `onStopSignal` is wired to
  // the listener well before either variable's natural call site further
  // down `main()`. Declaring them here, ahead of `process.once`, is what
  // keeps a SIGINT arriving early in the run from crashing the handler
  // instead of running it.
  const s = src();
  const bridgeDeclAt = s.indexOf('let bridgeProc = null;');
  const groundDeclAt = s.indexOf('let inProgressGround = null;');
  const listenAt = s.indexOf("process.once('SIGTERM'");
  assert.notEqual(bridgeDeclAt, -1, 'bridgeProc must still be declared somewhere');
  assert.notEqual(groundDeclAt, -1, 'inProgressGround must be declared');
  assert.notEqual(listenAt, -1);
  assert.ok(bridgeDeclAt < listenAt, 'bridgeProc must be declared before the SIGTERM/SIGINT listeners are wired');
  assert.ok(groundDeclAt < listenAt, 'inProgressGround must be declared before the SIGTERM/SIGINT listeners are wired');
});

test('row 184b: the handler kills THIS run\'s own bridge process group, not only the ordinary finally block', () => {
  const s = src();
  assert.match(
    s,
    /import\s*\{[^}]*\bkillBridgeProcessGroup\b[^}]*\}\s*from\s*'\.\/bridge\.mjs';/,
    'killBridgeProcessGroup must be imported alongside the other bridge helpers',
  );
  const handlerAt = s.indexOf('const onStopSignal =');
  const exitAt = s.indexOf('process.exit(signal ===', handlerAt);
  assert.notEqual(handlerAt, -1);
  assert.notEqual(exitAt, -1, 'the handler must still end in process.exit');
  const killAt = s.indexOf('killBridgeProcessGroup(bridgeProc', handlerAt);
  assert.notEqual(killAt, -1, 'the handler must call killBridgeProcessGroup(bridgeProc, …) — a bridge this run booted must not survive a SIGINT/SIGTERM');
  assert.ok(killAt < exitAt, 'the kill must run BEFORE process.exit, or the signal to the bridge never gets sent');
});

test('row 184b: the finally block\'s OWN bridge teardown reuses the SAME helper, never a second copy of the kill', () => {
  const s = src();
  const finallyAt = s.indexOf('} finally {');
  const handlerAt = s.indexOf('const onStopSignal =');
  const killCalls = [...s.matchAll(/killBridgeProcessGroup\(/g)].map((m) => m.index);
  assert.ok(killCalls.length >= 2, `expected at least 2 call sites (onStopSignal + finally), found ${killCalls.length}`);
  assert.ok(killCalls.some((i) => i > handlerAt && i < finallyAt), 'one call must be inside onStopSignal');
  assert.ok(killCalls.some((i) => i > finallyAt), 'one call must be inside the ordinary finally block');
  // The raw `process.kill(-bridgeProc.pid` this used to be, inline, must be
  // gone — a second copy of the same kill is exactly how the two drift.
  assert.doesNotMatch(s, /process\.kill\(-bridgeProc\.pid/, 'the finally block must no longer inline its own process-group kill');
});

test('row 184b: the handler captures + clears the IN-PROGRESS story\'s own minted ground sessions', () => {
  const s = src();
  assert.match(
    s,
    /import\s*\{[^}]*\bcaptureAndClearMintedSessionsSince\b[^}]*\}\s*from\s*'\.\/ground-abort-clear\.mjs';/,
    'captureAndClearMintedSessionsSince must be imported from the abort-path module',
  );
  const handlerAt = s.indexOf('const onStopSignal =');
  const exitAt = s.indexOf('process.exit(signal ===', handlerAt);
  const gateAt = s.indexOf('if (inProgressGround !== null)', handlerAt);
  assert.notEqual(gateAt, -1, 'the clear must be gated on a story actually being in progress');
  assert.ok(gateAt < exitAt, 'the gate must run before process.exit');
  const callAt = s.indexOf('captureAndClearMintedSessionsSince(', gateAt);
  assert.notEqual(callAt, -1, 'the handler must actually call the clear inside that gate');
  assert.ok(callAt < exitAt, 'the call must run before process.exit');
});

test('row 184b: the per-story loop snapshots the project\'s ground BEFORE marking the story started', () => {
  const s = src();
  const loopAt = s.indexOf('for (const story of stories) {');
  const setAt = s.indexOf('inProgressGround = project === null ? null :', loopAt);
  const startedAt = s.indexOf('startedStoryIds.add(story.id);', loopAt);
  const runStoryAt = s.indexOf('await runStory(story,', loopAt);
  const resetAt = s.indexOf('inProgressGround = null;', runStoryAt);
  assert.notEqual(loopAt, -1);
  assert.notEqual(setAt, -1, 'the per-story ground snapshot must be set inside the story loop');
  assert.notEqual(startedAt, -1);
  assert.notEqual(runStoryAt, -1);
  assert.notEqual(resetAt, -1, 'inProgressGround must be reset once runStory returns — its OWN teardown already cleared what it minted');
  assert.ok(setAt < startedAt, 'the snapshot must be taken before the story is marked started, same as startedStoryIds itself');
  assert.ok(startedAt < runStoryAt, 'started must be marked before runStory is awaited');
  assert.ok(runStoryAt < resetAt, 'the reset must happen only AFTER runStory returns, never before');
});
