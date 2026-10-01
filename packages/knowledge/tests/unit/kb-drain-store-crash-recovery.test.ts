/**
 * Crash recovery for a kb-cleanup apply interrupted by a hard bridge restart
 * (bead forge-8vfn.8.5.1).
 *
 * `approveKbCleanup`'s draft-apply arm (bridge-studio-kbs.ts) claims a
 * session SYNCHRONOUSLY by writing `phase: 'applying'` before its draft
 * writes land, and releases the claim back to `awaiting-approval` on any
 * CAUGHT write error. A HARD crash (the bridge process killed) between the
 * claim and the terminal `applied` stamp skips that release entirely — the
 * apply runs IN the bridge process, so a session still at `applying` after a
 * restart is necessarily orphaned, and nothing ever unwedged it.
 *
 * `releaseInterruptedKbCleanupApplies` is the fix: a boot-time reconcile,
 * called once from `apps/forge/ui-bridge.ts`, that walks every KB's own
 * `_kb-cleanup` sessions and releases any stuck at `applying`. Every draft
 * write is a whole-file replacement, so releasing unconditionally (no crash
 * forensics needed) makes a retry safe.
 *
 * Uses the REAL `testSessionStatusIo` (guardedFile-backed, same containment
 * primitive the production port uses) rather than a stub — this proves the
 * reconcile against actual on-disk status.json files, same as
 * `approveKbCleanup`'s own tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { releaseInterruptedKbCleanupApplies, KB_CLEANUP_RECONCILE_LOG_BUCKET } from '../../kb-drain-store.ts';
import { KB_SEEDING_ANCHOR_PREFIX } from '../../bridge-studio-kbs.ts';
import { testSessionStatusIo } from '../test-fixtures/session-status-io.ts';

/** Mirrors `apps/forge/tests/integration/ui-bridge-kb-cleanup.test.ts`'s own `writeKb` fixture. */
function writeKb(forgeRoot: string, id: string, bindingYaml = '{ kind: unique }'): void {
  const dir = join(forgeRoot, 'brain', id);
  mkdirSync(join(dir, 'themes'), { recursive: true });
  mkdirSync(join(dir, '_raw'), { recursive: true });
  writeFileSync(join(dir, 'kb.yaml'), `id: ${id}\nname: Fixture KB ${id}\nbinding: ${bindingYaml}\ndesc: A fixture KB for crash-recovery tests.\n`, 'utf8');
}

function makeRoot(): { forgeRoot: string; projectsRoot: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'kb-drain-store-crash-'));
  const projectsRoot = join(forgeRoot, 'projects');
  mkdirSync(projectsRoot, { recursive: true });
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  return { forgeRoot, projectsRoot };
}

test('releaseInterruptedKbCleanupApplies releases a kb-cleanup session a crash left at "applying" back to "awaiting-approval" with an apply_error naming the interruption', () => {
  const { forgeRoot, projectsRoot } = makeRoot();
  try {
    writeKb(forgeRoot, 'crash-kb');
    const anchor = `${KB_SEEDING_ANCHOR_PREFIX}crash-kb`;
    const dirSegs = [anchor, '_kb-cleanup', 'stuck-session'];
    testSessionStatusIo.write(projectsRoot, dirSegs, {
      session_id: 'stuck-session',
      project: anchor,
      phase: 'applying',
      kb_id: 'crash-kb',
    });

    const released = releaseInterruptedKbCleanupApplies(forgeRoot, projectsRoot, testSessionStatusIo);
    assert.equal(released, 1, 'exactly one orphaned session should be released');

    const status = testSessionStatusIo.read<{ phase?: unknown; apply_error?: unknown }>(projectsRoot, dirSegs);
    assert.ok(status, 'status.json must still exist and be readable');
    assert.equal(status!.phase, 'awaiting-approval', 'a crash-orphaned "applying" session must be released back to "awaiting-approval"');
    assert.equal(
      status!.apply_error,
      'apply interrupted: the bridge restarted before the draft finished; whole-file writes make a retry safe',
      'apply_error must name the interruption, exactly as a caught-write-error release does',
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('releaseInterruptedKbCleanupApplies never touches a session at "awaiting-approval" or "applied"', () => {
  const { forgeRoot, projectsRoot } = makeRoot();
  try {
    writeKb(forgeRoot, 'calm-kb');
    const anchor = `${KB_SEEDING_ANCHOR_PREFIX}calm-kb`;
    const awaitingSegs = [anchor, '_kb-cleanup', 'awaiting-session'];
    const appliedSegs = [anchor, '_kb-cleanup', 'applied-session'];
    testSessionStatusIo.write(projectsRoot, awaitingSegs, {
      session_id: 'awaiting-session', project: anchor, phase: 'awaiting-approval', kb_id: 'calm-kb',
    });
    testSessionStatusIo.write(projectsRoot, appliedSegs, {
      session_id: 'applied-session', project: anchor, phase: 'applied', kb_id: 'calm-kb', finalized: { kind: 'kb', id: 'calm-kb' },
    });

    const released = releaseInterruptedKbCleanupApplies(forgeRoot, projectsRoot, testSessionStatusIo);
    assert.equal(released, 0, 'neither fixture session is at "applying", so nothing should be released');

    const awaiting = testSessionStatusIo.read<{ phase?: unknown; apply_error?: unknown }>(projectsRoot, awaitingSegs);
    assert.equal(awaiting!.phase, 'awaiting-approval');
    assert.equal(awaiting!.apply_error, undefined, 'an untouched session must never gain an apply_error');

    const applied = testSessionStatusIo.read<{ phase?: unknown; apply_error?: unknown }>(projectsRoot, appliedSegs);
    assert.equal(applied!.phase, 'applied');
    assert.equal(applied!.apply_error, undefined);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('releaseInterruptedKbCleanupApplies emits a structured JSONL event per released session', () => {
  const { forgeRoot, projectsRoot } = makeRoot();
  try {
    writeKb(forgeRoot, 'logged-kb');
    const anchor = `${KB_SEEDING_ANCHOR_PREFIX}logged-kb`;
    const dirSegs = [anchor, '_kb-cleanup', 'logged-session'];
    testSessionStatusIo.write(projectsRoot, dirSegs, {
      session_id: 'logged-session', project: anchor, phase: 'applying', kb_id: 'logged-kb',
    });

    releaseInterruptedKbCleanupApplies(forgeRoot, projectsRoot, testSessionStatusIo);

    const eventsPath = join(forgeRoot, '_logs', KB_CLEANUP_RECONCILE_LOG_BUCKET, 'events.jsonl');
    const lines = readFileSync(eventsPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]['message'], 'kb-cleanup.apply-released');
    assert.deepEqual(lines[0]['metadata'], { project: anchor, sessionId: 'logged-session', kbId: 'logged-kb' });
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
