/**
 * `reapCensusAndSweep` — finding row 75's agent half (T1 rulings 1258, 1332),
 * split out of `sweep-teardown.test.ts` when that file reached 807 lines
 * (split, never baseline). The doors here drive real processes through the
 * plants in `sweep-teardown-plant.mjs`: a detached grandchild that outlives
 * the reap, a sibling outside the run's dispatch tree, a TERM-respecting
 * child, and a census that refuses the sweep.
 */
import { test as nodeTest, after } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { reapCensusAndSweep } from './sweep-teardown.mjs';
import { sweepProductFixtures } from './sweep.mjs';
import {
  killIfAlive, plantReapedRootWithGrandchild, plantInitManifest, fastQuiesce, waitForFileToExist,
  waitForProcVisible, waitForRalphPid,
} from './sweep-teardown-plant.mjs';

/**
 * A HANG IS A NAMED FAILURE, AND TEARDOWN FORCE-KILLS (T3, tooling/gate-step-timeout).
 * These doors plant SIGTERM-ignoring writers; when SIGTERM did not stop one the
 * file hung ~60 min (the live child keeps node's event loop up) instead of
 * failing. Two bounds, both by RECORDED pid, never by name:
 *  - every test runs under `HANG_BOUND_MS`; losing the race fails THAT test with
 *    a message naming it (its plants' own `t.after` then SIGKILL their pids);
 *  - every fixture pid a test records is force-killed by the file-level
 *    `after()` after a bounded wait if still alive, and the final test asserts
 *    none survived (a failing describe/file `after()` exits 0 in node 22, so the
 *    assertion lives in a test, the kill in `after()`).
 * What the doors assert about `reapCensusAndSweep` is unchanged.
 */
const HANG_BOUND_MS = 55_000;
/** forge-nk1y.6 — node:test cancels a test past this, so a hang reds instead of stalling the suite. */
const NODE_TEST_TIMEOUT_MS = 60_000;
const TEARDOWN_WAIT_MS = 2_000;
const recordedPids = new Set<number>();
const record = (pid: number | undefined) => { if (pid) recordedPids.add(pid); };
const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const recordRalph = async (file: string) => record((await waitForRalphPid(file, { timeoutMs: 1000 })) ?? undefined);

function test(name: string, fn: (t: TestContext) => Promise<void>) {
  nodeTest(name, { timeout: NODE_TEST_TIMEOUT_MS }, async (t) => {
    let timer: NodeJS.Timeout | undefined;
    const hang = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(
        `HANG: "${name}" did not finish within ${HANG_BOUND_MS} ms — a SIGTERM-ignoring fixture writer was not stopped; its pid is force-killed by teardown`,
      )), HANG_BOUND_MS);
    });
    try { await Promise.race([fn(t), hang]); } finally { clearTimeout(timer); }
  });
}

async function forceKillSurvivors(): Promise<number[]> {
  const deadline = Date.now() + TEARDOWN_WAIT_MS;
  while ([...recordedPids].some(isAlive) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  const survivors = [...recordedPids].filter(isAlive);
  for (const pid of survivors) killIfAlive(pid);
  return survivors;
}
after(async () => { await forceKillSurvivors(); });

/**
 * Finding row 75's SECOND half (T1 rulings 1258, 1332) — the story's own
 * trailing sweep (`run-story.mjs`: `reapAgentRuns` → `quiesceWriters` →
 * `sweepProductFixtures`) had the identical shape: `quiesceWriters` only ever
 * PRINTED whether the tree settled, and the clear ran regardless. This is the
 * ralph-loop evidence row 75 actually came through — a develop cycle's phase
 * agent, dispatched the way `spawnAgentTurn` dispatches everything (detached,
 * its own process group), outliving `reapAgentRuns`'s own kill and rewriting
 * `_queue/in-flight/<init>.md.heartbeat` after this runner had already printed
 * CLEARED. `reapCensusAndSweep` gates `sweepProductFixtures` on a fresh census
 * of every reaped pid's descendants, exactly like `stopSchedulerCensusAndRelease`
 * gates the scheduler's release.
 */

test('finding row 75 (agent half) RED: the OLD sequence (sweepProductFixtures alone) leaves a heartbeat a live grandchild keeps rewriting', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-agent-census-red-'));
  const sinceMs = Date.now() - 60_000;
  const ralphPidFile = join(root, 'ralph.pid');
  const heartbeat = plantInitManifest(root, sinceMs);

  const parent = await plantReapedRootWithGrandchild(t, root, `
    process.on('SIGTERM', () => {}); // ignored — this is the writer that must be force-killed
    setInterval(() => { try { require('node:fs').writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())); } catch {} }, 25);
    setInterval(() => {}, 1000);
  `, ralphPidFile);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  record(parent.pid); await recordRalph(ralphPidFile);

  // The OLD sequence: `quiesceWriters` only prints, and the trailing sweep
  // ran regardless of what it found. Standing in for that here with the sweep
  // call alone, exactly as run-story.mjs made it before this fix.
  const evidenceDir = join(root, 'queue-claim');
  const sweep = sweepProductFixtures('S-red', root, { sinceMs, evidenceDir });
  assert.ok(sweep.artefacts.cleared.includes('_queue/in-flight/INIT-mine.md.heartbeat'), `must have cleared it: ${JSON.stringify(sweep)}`);

  assert.equal(
    await waitForFileToExist(heartbeat), true,
    'RED: the grandchild outlived reapAgentRuns and rewrote the heartbeat the old sequence just cleared',
  );
});

test('finding row 75 (agent half) DOOR: reapCensusAndSweep kills the grandchild, censuses empty, and the clear HOLDS', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-agent-census-green-'));
  const sinceMs = Date.now() - 60_000;
  const ralphPidFile = join(root, 'ralph.pid');
  const heartbeat = plantInitManifest(root, sinceMs);

  const parent = await plantReapedRootWithGrandchild(t, root, `
    process.on('SIGTERM', () => {});
    setInterval(() => { try { require('node:fs').writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())); } catch {} }, 25);
    setInterval(() => {}, 1000);
  `, ralphPidFile);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  record(parent.pid); await recordRalph(ralphPidFile);

  const evidenceDir = join(root, 'queue-claim');
  const result = await reapCensusAndSweep({
    root, storyId: 'S-green', sinceMs, evidenceDir,
    reapedPids: [parent.pid],
    quiesce: fastQuiesce,
    censusBoundMs: 3000, censusPollMs: 20, rereadDelayMs: 150,
  });

  assert.equal(result.census.empty, true, `census must settle: ${JSON.stringify(result.census)}`);
  assert.ok(result.sweep, 'the sweep must have run — census was empty');
  assert.ok(result.sweep.artefacts.cleared.includes('_queue/in-flight/INIT-mine.md.heartbeat'));
  assert.deepEqual(result.reappearedArtefacts, [], `nothing may reappear: ${JSON.stringify(result.lines)}`);
  assert.equal(existsSync(heartbeat), false, 'GREEN: the heartbeat stayed cleared — the writer was dead before the clear ran');

  const ralphPid = Number(readFileSync(ralphPidFile, 'utf8'));
  assert.throws(() => process.kill(ralphPid, 0), 'the grandchild must actually be dead');
  assert.throws(() => process.kill(parent.pid!, 0), 'and the reaped root too');
});

/**
 * D's review of #906, MUST 2, doored AT THE ORCHESTRATION LEVEL (not only in
 * `reap-census.test.ts`'s `verifiedKill` unit and real-process doors): a pid
 * `descendantsOf` finds in the pre-signal snapshot, but that CANNOT be
 * identified (no readable `stat` — the fixture below never creates one for
 * it, standing in for a pid already recycled or gone the instant the
 * snapshot was taken) must never reach the injected `kill` at all. This is
 * the exact wiring the review asked to see proven, not merely the shared
 * primitive underneath it.
 */
test('finding row 75 (agent half) DOOR: MUST 2 — a snapshotted descendant with no verifiable identity is never signalled', async (t) => {
  const procRoot = mkdtempSync(join(tmpdir(), 'reap-census-must2-proc-'));
  // The root (100) gets a real, matching identity — it must remain a
  // legitimate, usable census root so the test proves the ONE unidentifiable
  // descendant is skipped, not that the whole census gave up.
  mkdirSync(join(procRoot, '100'));
  writeFileSync(join(procRoot, '100', 'stat'), '100 (root) S 1 1 1 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 42');
  // pid 555 is what `descendantsOf` finds via the mocked table below, but it
  // has NO stat file here at all — `identifyPid` reads it as `startTime:
  // null`, standing in for a pid this run can no longer verify as its own.
  t.after(() => rmSync(procRoot, { recursive: true, force: true }));

  const sent: Array<[number, string]> = [];
  const result = await reapCensusAndSweep({
    root: '/does-not-matter', storyId: 'S-must2', sinceMs: Date.now(), evidenceDir: '/does-not-matter',
    reapedPids: [100],
    quiesce: async () => ({ pids: { gone: [], alive: [], waitedMs: 0, timedOut: false }, tree: { quiet: true, waitedMs: 0, timedOut: false, reads: 1 }, settled: true }),
    sweep: () => ({ removed: [], failed: [], claim: { claimed: [] }, artefacts: { cleared: [] }, lines: [] }),
    procTable: () => new Map([[100, { ppid: 1, pgrp: 100 }], [555, { ppid: 100, pgrp: 100 }]]),
    kill: (pid: number, sig: string) => { sent.push([pid, sig]); },
    listPids: () => ['100'], // 555 is not even alive — the point is it must never be SIGNALLED, not that it survives
    procRoot,
    censusBoundMs: 200, censusPollMs: 20,
  });

  assert.ok(!sent.some(([pid]) => String(pid) === '555'), `pid 555 must never be signalled without a verified identity: ${JSON.stringify(sent)}`);
  assert.ok(
    result.lines.some((l: string) => /555.*no longer the recorded process/.test(l)),
    `the refusal must be named: ${JSON.stringify(result.lines)}`,
  );
});

test('finding row 75 (agent half) DOOR (second): a writer OUTSIDE this run\'s dispatch tree recreates a cleared artefact — caught only by the re-read', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-agent-census-sibling-'));
  const sinceMs = Date.now() - 60_000;
  const heartbeat = plantInitManifest(root, sinceMs);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // No planted root at all — `reapedPids` is empty, so the census is
  // vacuously empty immediately. The sibling below shares no ancestry with
  // anything this run dispatched, exactly the shape the census cannot see.
  const sibling = spawn(process.execPath, ['-e', `
    setInterval(() => { try { require('node:fs').writeFileSync(${JSON.stringify(heartbeat)}, 'sibling'); } catch {} }, 20);
    setInterval(() => {}, 1000);
  `], { stdio: 'ignore' });
  t.after(() => killIfAlive(sibling.pid!));
  record(sibling.pid);
  await waitForProcVisible(sibling.pid!); // wait on the event, not the clock (T1 1372)

  const evidenceDir = join(root, 'queue-claim');
  const result = await reapCensusAndSweep({
    root, storyId: 'S-sibling', sinceMs, evidenceDir,
    reapedPids: [],
    censusBoundMs: 2000, censusPollMs: 20, rereadDelayMs: 150,
    // The re-read's wait is the one seam this door cares about, and a clock
    // lost the race under full-suite load: the sibling was not scheduled
    // inside 150 ms, so the file was genuinely still absent at the re-read
    // (exit-proof run 3, 2026-09-27). Wait on the EVENT the re-read exists to
    // observe — the sibling's write landing again — under a generous bound
    // (T1 1372: wait on the event, not the clock).
    sleep: async () => {
      const deadline = Date.now() + 10_000;
      while (!existsSync(heartbeat) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    },
  });

  assert.equal(result.census.empty, true, 'legitimately empty — this run dispatched nothing');
  // The sibling writes every 20ms, racing the IMMEDIATE capture-then-verify
  // inside `captureAndClearMintedRunArtefacts` itself (rmSync then a same-
  // tick existsSync — no JS-level gap, but under heavy contention the OS can
  // still preempt this process between those two syscalls and let the
  // sibling's own write land in between). Both outcomes of that race are
  // SAFE and are asserted on here, per T1 1372 ("assert on outcome, not
  // timing"): either the immediate check already caught the sibling (never
  // counted as cleared at all, reported unremoved on the spot), or it looked
  // clear for an instant and the LATER, DELAYED re-read below catches it.
  // What must never happen, either way, is a silent, uncontested CLEARED —
  // asserted last, regardless of which path was taken.
  const cleared = result.sweep?.artefacts.cleared.includes('_queue/in-flight/INIT-mine.md.heartbeat') ?? false;
  const unremoved = (result.sweep?.artefacts.unremoved ?? []).some((u: { path: string }) => u.path.endsWith('INIT-mine.md.heartbeat'));
  assert.ok(cleared || unremoved, `the sibling must be caught one way or the other: ${JSON.stringify(result.sweep?.artefacts)}`);
  if (cleared) {
    assert.ok(
      result.reappearedArtefacts.includes('_queue/in-flight/INIT-mine.md.heartbeat'),
      `cleared immediately, so the re-read must catch the sibling's next write: ${JSON.stringify(result.lines)}`,
    );
  }
  assert.ok(
    result.lines.some((l: string) => /ARTEFACT CLEAR DID NOT HOLD/.test(l) || /NOT REMOVED|still present after removal/.test(l)),
    `never a silent CLEARED for a path a live writer outside the census still holds: ${JSON.stringify(result.lines)}`,
  );
});

test('finding row 75 (agent half) DOOR (third): a TERM-respecting grandchild exits within the bound — no escalation needed', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-agent-census-term-'));
  const sinceMs = Date.now() - 60_000;
  const ralphPidFile = join(root, 'ralph.pid');
  const cleanExitMarker = join(root, 'clean-exit.marker');
  const heartbeat = plantInitManifest(root, sinceMs);

  const parent = await plantReapedRootWithGrandchild(t, root, `
    process.on('SIGTERM', () => {
      require('node:fs').writeFileSync(${JSON.stringify(cleanExitMarker)}, 'clean');
      process.exit(0);
    });
    setInterval(() => {}, 1000);
  `, ralphPidFile);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  record(parent.pid); await recordRalph(ralphPidFile);

  const evidenceDir = join(root, 'queue-claim');
  const result = await reapCensusAndSweep({
    root, storyId: 'S-term', sinceMs, evidenceDir,
    reapedPids: [parent.pid],
    quiesce: fastQuiesce,
    censusBoundMs: 3000, censusPollMs: 20, rereadDelayMs: 100,
  });

  assert.equal(result.census.empty, true);
  assert.ok(result.census.waitedMs < 1500, `a TERM-respecting child must not consume the full bound: waited ${result.census.waitedMs} ms`);
  assert.equal(existsSync(cleanExitMarker), true, 'the grandchild exited on its own SIGTERM handler, never SIGKILLed');
  assert.equal(existsSync(heartbeat), false);
});

test('finding row 75 (agent half): a non-empty census refuses the sweep entirely — nothing is cleared, nothing is claimed', async (t) => {
  // A pure unit check, fully injected: `procTable`/`kill`/`listPids` never
  // touch the real /proc or a real process at all — pid 999 is fabricated and
  // `listPids` reports it alive on every call, so the census can never settle.
  // MUST 2 (D's review): a root now needs a MATCHING recorded identity to be
  // usable at all, so the fixture procRoot gives 999 a real `stat` — the same
  // shape `identifyPid` reads at snapshot time and `verifiedKill` re-reads
  // before any signal — kept static across every call in this test so the
  // identity always matches and 999 survives for the full bound on its own
  // ground, not because its identity could not be verified at all.
  const procRoot = mkdtempSync(join(tmpdir(), 'reap-census-refuse-proc-'));
  mkdirSync(join(procRoot, '999'));
  writeFileSync(join(procRoot, '999', 'stat'), '999 (fixture) S 1 1 1 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 42');
  t.after(() => rmSync(procRoot, { recursive: true, force: true }));

  let sweepCalled = false;
  const killed: Array<[number, string]> = [];
  const result = await reapCensusAndSweep({
    root: '/does-not-matter', storyId: 'S-refuse', sinceMs: Date.now(), evidenceDir: '/does-not-matter',
    reapedPids: [999],
    quiesce: async () => ({ pids: { gone: [], alive: [], waitedMs: 0, timedOut: false }, tree: { quiet: true, waitedMs: 0, timedOut: false, reads: 1 }, settled: true }),
    sweep: () => { sweepCalled = true; return { removed: [], failed: [], claim: { claimed: [] }, artefacts: { cleared: [] }, lines: [] }; },
    procTable: () => new Map([[999, { ppid: 1, pgrp: 999 }]]),
    kill: (pid: number, sig: string) => { killed.push([pid, sig]); },
    listPids: () => ['999'],
    procRoot,
    censusBoundMs: 100, censusPollMs: 20,
  });

  assert.equal(result.census.empty, false);
  assert.equal(result.sweep, null);
  assert.equal(sweepCalled, false, 'the clear must never run when the census could not settle');
  assert.ok(result.lines.some((l: string) => /REFUSING to run the trailing sweep/.test(l)));
  assert.ok(
    killed.some(([pid, sig]) => String(pid) === '999' && sig === 'SIGKILL'),
    // census.survivors comes from the (mocked) live listing, which reports
    // pids as strings — the escalation must still reach it regardless.
    `the survivor must still have been escalated to SIGKILL: ${JSON.stringify(killed)}`,
  );
});

nodeTest('teardown: no recorded fixture pid survives the doors above (a survivor is force-killed AND fails here, named)', async () => {
  const survivors = await forceKillSurvivors();
  assert.deepEqual(survivors, [], `census fixtures still alive after the doors — SIGTERM did not stop them; force-killed pids: ${survivors.join(', ')}`);
});
