/**
 * forge-nk1y.6 — the row-75 "agent half" door must not hang, and a
 * SIGTERM-ignoring grandchild must die to SIGKILL inside the bound even when
 * the census cannot read the process table.
 *
 * Measured 2026-10-09 (cap-fix-onboarding re-verify of 863aa12f): the
 * `sweep-teardown-census.test.ts` door HUNG ~35 min, then red alone under load
 * ~10 — the grandchild survived. `reapCensusAndSweep` escalated to SIGKILL
 * only when the bound-time census returned a survivor LIST; a census that read
 * UNKNOWN at the bound (a /proc listing or an ancestry read that failed under
 * load — `censusSurvivors` returns null) skipped the escalation entirely, so
 * the SIGTERM-ignoring writer lived on. UNKNOWN is never "nothing to kill": the
 * fix SIGKILLs every identity this pass recorded (each re-verified by start
 * time, so a reused pid is never signalled), and the sweep stays refused
 * because the census still cannot vouch for an empty tree (§6.15).
 *
 * The UNKNOWN census is forced through the `listPids` seam (a listing that
 * throws). Every test is bounded (node:test `timeout`), so a regression reds
 * instead of hanging the suite.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reapCensusAndSweep } from './sweep-teardown.mjs';
import { killIfAlive, plantReapedRootWithGrandchild, plantInitManifest, fastQuiesce, waitForRalphPid } from './sweep-teardown-plant.mjs';

const BOUND_MS = 30_000;
const recorded = new Set<number>();
const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
after(() => { for (const pid of recorded) killIfAlive(pid); });

/** Is `pid` dead or a zombie (state Z) — SIGKILL delivered, awaiting reap by its parent/init. */
function deadOrZombie(pid: number): boolean {
  if (!isAlive(pid)) return true;
  try { return /\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return true; }
}

test('nk1y.6: a census that reads UNKNOWN at its bound still SIGKILLs the SIGTERM-ignoring grandchild (and refuses the sweep)', { timeout: BOUND_MS }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-agent-census-unknown-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sinceMs = Date.now() - 60_000;
  const ralphPidFile = join(root, 'ralph.pid');
  const heartbeat = plantInitManifest(root, sinceMs);
  const parent = await plantReapedRootWithGrandchild(t, root, `
    process.on('SIGTERM', () => {});
    setInterval(() => { try { require('node:fs').writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())); } catch {} }, 25);
    setInterval(() => {}, 1000);
  `, ralphPidFile);
  if (parent.pid) recorded.add(parent.pid);
  const grandchild = (await waitForRalphPid(ralphPidFile, { timeoutMs: 1000 })) ?? null;
  assert.ok(grandchild, 'the fixture grandchild must have started');
  recorded.add(grandchild);

  const result = await reapCensusAndSweep({
    root, storyId: 'S-unknown', sinceMs, evidenceDir: join(root, 'queue-claim'),
    reapedPids: [parent.pid],
    quiesce: fastQuiesce,
    censusBoundMs: 500, censusPollMs: 20, rereadDelayMs: 50,
    listPids: () => { throw Object.assign(new Error('EIO: /proc listing failed under load'), { code: 'EIO' }); },
  });

  assert.equal(result.census.empty, false, 'an UNKNOWN census never vouches for an empty tree');
  assert.equal(result.sweep, null, 'and the sweep stays refused (§6.15: never delete on UNKNOWN)');
  // The force-kill arrived: give the kernel a moment to deliver it.
  const deadline = performance.now() + 2_000;
  while (!deadOrZombie(grandchild) && performance.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  assert.equal(deadOrZombie(grandchild), true, 'the SIGTERM-ignoring grandchild must be SIGKILLed even though the census read UNKNOWN');
  assert.ok(result.lines.some((l) => /census read UNKNOWN — SIGKILL/.test(l)), `the escalation is named: ${result.lines.join('\n')}`);
});
