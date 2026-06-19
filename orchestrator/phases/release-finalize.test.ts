/**
 * Tests for orchestrator/phases/release-finalize.ts (WS-A · final-loop).
 *
 * Covers:
 *   - opt-in skip: no `releaseProcess` in the project config → release_status:
 *     'skipped', no SDK call, no events, no release.json.
 *   - finalise-then-record: a releaseProcess project → the agent runs, the
 *     terminal `release.finalized` event fires, and release.json is written.
 *   - version scrape: a finalised changelog heading is scraped onto the record.
 *   - log-and-continue: a thrown SDK → release_status: 'failed' + a notify, and
 *     the function returns (does NOT throw) so the caller can still merge.
 *   - non-success subtype → 'failed' + notify (still log-and-continue).
 *
 * The agent SDK is stubbed via `deps.sdkQuery`. The branch resolver is stubbed
 * via `deps.currentBranch` so no real git runs. A tempdir holds the project
 * config + worktree changelog; logs go to a tempdir `_logs`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runReleaseFinalize, type RunReleaseFinalizeInput } from './release-finalize.ts';
import { createLogger, type EventLogEntry } from '../logging.ts';

type Harness = {
  cycleId: string;
  worktreePath: string;
  projectRepoPath: string;
  logsRoot: string;
  input: RunReleaseFinalizeInput;
  events: () => EventLogEntry[];
  logger: ReturnType<typeof createLogger>;
  cleanup: () => void;
};

function uniqueCycleId(suffix: string): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `WSA-TEST-${ts}-${rnd}-${suffix}`;
}

/** Write a minimal valid `.forge/project.json` into `repoRoot`. */
function writeProjectConfig(repoRoot: string, withRelease: boolean, changelogPath = 'CHANGELOG.md'): void {
  const cfg: Record<string, unknown> = {
    demo: { shape: 'none' },
    quality_gate_cmd: ['true'],
  };
  if (withRelease) {
    cfg.releaseProcess = {
      changelogPath,
      steps: [
        { kind: 'changelog', phase: 'in-cycle', text: 'draft an Unreleased entry' },
        { kind: 'version', phase: 'pre-merge', text: 'bump the version' },
      ],
    };
  }
  mkdirSync(join(repoRoot, '.forge'), { recursive: true });
  writeFileSync(join(repoRoot, '.forge', 'project.json'), JSON.stringify(cfg, null, 2));
}

function setupHarness(opts: { suffix: string; withRelease: boolean; changelog?: string }): Harness {
  const cycleId = uniqueCycleId(opts.suffix);
  const tmp = mkdtempSync(join(tmpdir(), 'forge-release-finalize-'));
  // The worktree IS the project repo for these tests (project.json + changelog live there).
  const worktreePath = join(tmp, 'wt');
  mkdirSync(worktreePath, { recursive: true });
  writeProjectConfig(worktreePath, opts.withRelease);
  if (opts.changelog !== undefined) {
    writeFileSync(join(worktreePath, 'CHANGELOG.md'), opts.changelog);
  }
  const logsRoot = join(tmp, '_logs');
  mkdirSync(logsRoot, { recursive: true });
  const logger = createLogger(cycleId, logsRoot);

  const input: RunReleaseFinalizeInput = {
    initiativeId: 'INIT-2026-06-19-release',
    cycleId,
    projectName: 'release-test',
    worktreePath,
    projectRepoPath: worktreePath,
    logsRoot,
  };

  return {
    cycleId,
    worktreePath,
    projectRepoPath: worktreePath,
    logsRoot,
    input,
    logger,
    events: () => {
      if (!existsSync(logger.logFilePath)) return [];
      const raw = readFileSync(logger.logFilePath, 'utf8');
      const out: EventLogEntry[] = [];
      for (const l of raw.split('\n')) {
        if (!l.trim()) continue;
        try { out.push(JSON.parse(l)); } catch { /* skip */ }
      }
      return out;
    },
    cleanup: () => {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
    },
  };
}

/** Stub SDK that streams a successful result. Optionally writes a finalised
 *  changelog into the worktree first (modelling the agent's edit). */
function fakeSdkSuccess(worktreePath: string, finalisedChangelog?: string) {
  return async function* (_: { prompt: string; options: Record<string, unknown> }): AsyncIterable<unknown> {
    if (finalisedChangelog !== undefined) {
      writeFileSync(join(worktreePath, 'CHANGELOG.md'), finalisedChangelog);
    }
    yield {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'CHANGELOG.md' } }] },
    };
    yield { type: 'result', subtype: 'success', total_cost_usd: 0.03, duration_ms: 900 };
  };
}

const stubBranch = () => 'feat/some-initiative';

// ---------- tests ----------

test('opt-in skip: no releaseProcess → release_status:skipped, no SDK call, no events', async () => {
  const h = setupHarness({ suffix: 'skip', withRelease: false });
  try {
    let sdkCalled = false;
    const result = await runReleaseFinalize(h.input, h.logger, {
      sdkQuery: async function* () { sdkCalled = true; yield { type: 'result', subtype: 'success' }; },
      currentBranch: stubBranch,
    });
    assert.equal(result.release_status, 'skipped');
    assert.equal(sdkCalled, false, 'SDK must NOT be called when no releaseProcess');
    assert.equal(h.events().length, 0, 'no events on the skip path');
    assert.equal(existsSync(join(h.logsRoot, h.cycleId, 'artifacts', 'release.json')), false);
  } finally {
    h.cleanup();
  }
});

test('finalise: releaseProcess project → release.finalized event + release.json + scraped version', async () => {
  const h = setupHarness({
    suffix: 'finalise',
    withRelease: true,
    changelog: '# Changelog\n\n## [Unreleased]\n\n- Added a thing\n',
  });
  try {
    const finalised = '# Changelog\n\n## [Unreleased]\n\n## [1.3.0] - 2026-06-19\n\n- Added a thing\n';
    const result = await runReleaseFinalize(h.input, h.logger, {
      sdkQuery: fakeSdkSuccess(h.worktreePath, finalised),
      currentBranch: stubBranch,
    });

    assert.equal(result.release_status, 'finalized');
    assert.equal(result.version, '1.3.0', 'version scraped from the finalised changelog');

    const events = h.events();
    const start = events.find((e) => e.message === 'release-finalize.start');
    assert.ok(start, 'expected release-finalize.start');
    const end = events.find((e) => e.message === 'release.finalized');
    assert.ok(end, 'expected release.finalized terminal event');
    assert.equal(end!.phase, 'release-finalize');
    assert.equal(end!.metadata?.['version'], '1.3.0');

    const releaseJsonPath = join(h.logsRoot, h.cycleId, 'artifacts', 'release.json');
    assert.ok(existsSync(releaseJsonPath), 'expected release.json terminal record');
    const rec = JSON.parse(readFileSync(releaseJsonPath, 'utf8'));
    assert.equal(rec.version, '1.3.0');
    assert.equal(rec.branch, 'feat/some-initiative');
    assert.equal(rec.changelogPath, 'CHANGELOG.md');
    assert.ok(typeof rec.finalizedAt === 'string' && rec.finalizedAt.length > 0);
  } finally {
    h.cleanup();
  }
});

test('log-and-continue: thrown SDK → release_status:failed + notify, does NOT throw', async () => {
  const h = setupHarness({ suffix: 'throw', withRelease: true, changelog: '# Changelog\n\n## [Unreleased]\n' });
  try {
    const notes: string[] = [];
    const result = await runReleaseFinalize(h.input, h.logger, {
      sdkQuery: async function* () { throw new Error('sdk exploded'); },
      currentBranch: stubBranch,
      notify: (m) => notes.push(m),
    });
    assert.equal(result.release_status, 'failed');
    assert.equal(notes.length, 1, 'a notify fires on failure');
    assert.match(notes[0], /fallback/i);
    const events = h.events();
    assert.ok(events.find((e) => e.message === 'release-finalize.crashed'), 'expected crashed event');
    // No release.json written on the failure path.
    assert.equal(existsSync(join(h.logsRoot, h.cycleId, 'artifacts', 'release.json')), false);
  } finally {
    h.cleanup();
  }
});

test('non-success subtype → release_status:failed + notify (still log-and-continue)', async () => {
  const h = setupHarness({ suffix: 'nonsuccess', withRelease: true, changelog: '# Changelog\n\n## [Unreleased]\n' });
  try {
    const notes: string[] = [];
    const result = await runReleaseFinalize(h.input, h.logger, {
      sdkQuery: async function* () {
        yield { type: 'result', subtype: 'error_max_turns', total_cost_usd: 0.1, duration_ms: 500 };
      },
      currentBranch: stubBranch,
      notify: (m) => notes.push(m),
    });
    assert.equal(result.release_status, 'failed');
    assert.equal(notes.length, 1);
    const events = h.events();
    assert.ok(events.find((e) => e.message === 'release-finalize.non-success'), 'expected non-success event');
  } finally {
    h.cleanup();
  }
});
