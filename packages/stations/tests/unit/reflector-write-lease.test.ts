/**
 * forge-ler4 — `runReflector`'s brain-writing window (the SDK spawn plus its
 * post-exit brain writes: retention frontmatter patch, per-KB health) must
 * take the SAME brain-write lease a KB job's turn takes
 * (`packages/sessions/kinds/brain-fix.ts`), so the daemon and a Studio KB job
 * can never have their brain/ writes misattributed to each other.
 *
 * Mirrors `reflector.test.ts`'s harness (real FORGE_ROOT, stubbed sdkQuery —
 * see that file's own header for why). This test holds the SAME real lease
 * externally (`acquireBrainWriteLease`, not a mock) before calling
 * `runReflector`, mirroring `community-registry-lock.test.ts`'s CONTENTION
 * tests and `brain-fix-write-lease.test.ts`'s sibling coverage on the KB side.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runReflector } from '../../phases/reflector.ts';
import { createLogger, type EventLogEntry } from '@forge/kernel';
import type { CycleInput } from '@forge/flows';
import { acquireIsolatedReflectorLease } from '../test-fixtures/reflector-lease-test-fixture.ts';
import { canonicalDef } from '../test-fixtures/canonical-def-fixture.ts';

// Same forge root the reflector code itself resolves to (orchestrator/phases/ ⇒ ..).
const FORGE_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');

// forge-ler4 cross-file flake fix (mechanism: reflector-lease-test-fixture.ts):
// this file deliberately holds the lease externally to test contention, so
// BOTH the external hold and `runReflector`'s own acquire below route
// through this file's own private lock.

function uniqueCycleId(suffix: string): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `LER4-LEASE-TEST-${ts}-${rnd}-${suffix}`;
}

function setupHarness(suffix: string): {
  cycleId: string;
  manifestPath: string;
  cycleLogDir: string;
  events: () => EventLogEntry[];
  logger: ReturnType<typeof createLogger>;
  cleanup: () => void;
} {
  const cycleId = uniqueCycleId(suffix);
  const tmp = mkdtempSync(join(tmpdir(), 'reflector-lease-test-'));
  const manifestPath = join(tmp, 'manifest.md');
  writeFileSync(
    manifestPath,
    [
      '---',
      'initiative_id: INIT-2026-05-23-ler4',
      'project: demo-project',
      'created_at: 2026-05-23T12:00:00Z',
      'iteration_budget: 3',
      'cost_budget_usd: 1.0', 'class: code',
      'phase: done',
      'origin: architect',
      '---',
      '',
      'body',
      '',
    ].join('\n'),
  );

  const cycleLogDir = resolve(FORGE_ROOT, '_logs', cycleId);
  const logger = createLogger(cycleId, resolve(FORGE_ROOT, '_logs'));

  return {
    cycleId,
    manifestPath,
    cycleLogDir,
    logger,
    events: () => {
      if (!existsSync(logger.logFilePath)) return [];
      const raw = readFileSync(logger.logFilePath, 'utf8');
      const lines: EventLogEntry[] = [];
      for (const l of raw.split('\n')) {
        if (!l.trim()) continue;
        try {
          lines.push(JSON.parse(l));
        } catch {
          /* skip */
        }
      }
      return lines;
    },
    cleanup: () => {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      try {
        rmSync(cycleLogDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

function makeInput(h: { manifestPath: string; cycleId: string }): CycleInput {
  return {
    initiativeId: 'INIT-2026-05-23-ler4',
    manifestPath: h.manifestPath,
    projectRepoPath: FORGE_ROOT,
    worktreePath: FORGE_ROOT,
    cycleId: h.cycleId,
  };
}

/** Never actually reached when the lease is contended — the acquire must
 *  refuse BEFORE any spawn happens. If this stub runs, the test's own
 *  assertions on reflection_status will fail loudly, not silently. */
async function* fakeSdkQueryShouldNotRun(): AsyncIterable<unknown> {
  yield {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'brain/INDEX.md' } }] },
  };
  yield { type: 'result', subtype: 'success', total_cost_usd: 0.05, duration_ms: 100 };
}

test('forge-ler4: runReflector REFUSES (reflection_status:failed, cause brain-write-lease-contention) when another writer already holds the brain-write lease', async () => {
  const h = setupHarness('contention');
  try {
    const release = await acquireIsolatedReflectorLease(FORGE_ROOT);
    try {
      const result = await runReflector(makeInput(h), h.logger, {
        sdkQuery: fakeSdkQueryShouldNotRun,
        acquireBrainWriteLease: acquireIsolatedReflectorLease,
        agentDef: canonicalDef('reflector'),
      });
      assert.equal(
        result.reflection_status,
        'failed',
        'a reflect run that could not take the brain-write lease must never report closed',
      );
      assert.equal(result.lint_status, 'skipped');

      const events = h.events();
      const lost = events.find((e) => e.message === 'cycle.reflection-lost');
      assert.ok(lost, `expected a cycle.reflection-lost event — got ${JSON.stringify(events.map((e) => e.message))}`);
      assert.equal(lost!.metadata?.['cause'], 'brain-write-lease-contention');
    } finally {
      await release();
    }
  } finally {
    h.cleanup();
  }
});

test('forge-ler4: once the lease is free, runReflector proceeds normally', async () => {
  const h = setupHarness('free');
  try {
    async function* fakeSdkQueryClean(): AsyncIterable<unknown> {
      yield {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'brain/INDEX.md' } }] },
      };
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.05, duration_ms: 100 };
    }
    const result = await runReflector(makeInput(h), h.logger, {
      sdkQuery: fakeSdkQueryClean,
      brainLint: () => ({ findings: [], exitCode: 0 }),
      acquireBrainWriteLease: acquireIsolatedReflectorLease,
      agentDef: canonicalDef('reflector'),
    });
    assert.equal(result.reflection_status, 'closed');
  } finally {
    h.cleanup();
  }
});
