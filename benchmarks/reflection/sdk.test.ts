/**
 * SDK setup + glue tests for the reflection bench. Uses a stub `queryFn` that
 * yields canned assistant messages + a result; no real Claude calls.
 *
 * Asserts:
 *   - Tempdir scaffolding (forge-tree symlinks; brain layered with fresh
 *     project themes/ + _raw/cycles/; manifest in _queue/done/; events.jsonl
 *     copied; user-feedback.md pre-populated by simulator).
 *   - Tool-use telemetry tallied across streamed messages.
 *   - Missing manifest / event log / merged tree reported as a thrown error
 *     (the bench harness can wrap them as runner errors).
 *   - The agent CAN write into brain/projects/<n>/themes/ and _raw/cycles/
 *     in the tempdir (verifies the layered-brain mask is read-write where
 *     needed and read-only elsewhere).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  cleanupTempdir,
  runReflector,
  setupTempdir,
  type ReflectorQueryFn,
  type RunReflectorInput,
} from './sdk.ts';

// ---------- fixture helpers ----------

const FIXTURE_MANIFEST = `---
initiative_id: INIT-test
project: slugifier
created_at: 2026-05-10T12:00:00Z
phase: done
features:
  - feature_id: FEAT-1
    title: Test feature
    depends_on: []
---

# Test initiative
`;

const FIXTURE_EVENTS =
  [
    JSON.stringify({ event_type: 'start', phase: 'orchestrator' }),
    JSON.stringify({ event_type: 'log', phase: 'project-manager', message: 'pm.work-item-emitted' }),
    JSON.stringify({ event_type: 'end', phase: 'review-loop', message: 'reviewer.merged' }),
  ].join('\n') + '\n';

function makeFixtureBundle(): {
  manifestPath: string;
  eventLogPath: string;
  brainGapsPath: string;
  mergedTreePath: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), 'forge-bench-reflect-fix-'));
  const manifestPath = join(root, 'manifest.md');
  writeFileSync(manifestPath, FIXTURE_MANIFEST);
  const eventLogPath = join(root, 'events.jsonl');
  writeFileSync(eventLogPath, FIXTURE_EVENTS);
  const brainGapsPath = join(root, 'brain-gaps.jsonl');
  // Intentionally not written — exercises the "tolerates missing brain-gaps" path.
  const mergedTreePath = join(root, 'merged-tree');
  mkdirSync(mergedTreePath, { recursive: true });
  writeFileSync(join(mergedTreePath, 'README.md'), '# Slugifier\n');
  return {
    manifestPath,
    eventLogPath,
    brainGapsPath,
    mergedTreePath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function makeInput(overrides: Partial<RunReflectorInput> = {}): RunReflectorInput {
  return {
    fixtureId: 'test-fixture',
    initiativeId: 'INIT-test',
    cycleId: 'CY-test',
    projectName: 'slugifier',
    manifestPath: '/required-override',
    eventLogPath: '/required-override',
    brainGapsPath: '/required-override',
    mergedTreePath: '/required-override',
    userFeedbackContent: '## Answers\n\nAll good.\n\n## Free-form\n\nNice cycle.\n',
    ...overrides,
  };
}

function fakeQueryFn(opts: {
  costUsd?: number;
  toolBlocks?: Array<{ type: 'tool_use'; name: string; input: unknown }>;
  durationMs?: number;
}): ReflectorQueryFn {
  return ({ prompt: _p, options: _o }) =>
    (async function* () {
      if (opts.toolBlocks && opts.toolBlocks.length > 0) {
        yield {
          type: 'assistant',
          message: { content: opts.toolBlocks },
        };
      }
      yield {
        type: 'result',
        subtype: 'success',
        duration_ms: opts.durationMs ?? 1000,
        total_cost_usd: opts.costUsd ?? 0.05,
      };
    })();
}

// ---------- setupTempdir ----------

test('setupTempdir: creates symlinks for forge tree', () => {
  const fix = makeFixtureBundle();
  try {
    const dir = setupTempdir(
      makeInput({
        manifestPath: fix.manifestPath,
        eventLogPath: fix.eventLogPath,
        brainGapsPath: fix.brainGapsPath,
        mergedTreePath: fix.mergedTreePath,
      }),
    );
    try {
      for (const sub of ['skills', 'docs', 'orchestrator', 'loops']) {
        const linkPath = resolve(dir, sub);
        assert.equal(existsSync(linkPath), true, `${sub} should exist`);
        assert.equal(lstatSync(linkPath).isSymbolicLink(), true, `${sub} should be a symlink`);
      }
    } finally {
      cleanupTempdir(dir);
    }
  } finally {
    fix.cleanup();
  }
});

test('setupTempdir: layers brain — INDEX.md is symlinked, target project themes/ is fresh dir', () => {
  const fix = makeFixtureBundle();
  try {
    const dir = setupTempdir(
      makeInput({
        manifestPath: fix.manifestPath,
        eventLogPath: fix.eventLogPath,
        brainGapsPath: fix.brainGapsPath,
        mergedTreePath: fix.mergedTreePath,
        projectName: 'slugifier',
      }),
    );
    try {
      const indexPath = resolve(dir, 'brain', 'INDEX.md');
      assert.equal(existsSync(indexPath), true, 'brain/INDEX.md should exist via symlink');
      assert.equal(lstatSync(indexPath).isSymbolicLink(), true);

      const themesDir = resolve(dir, 'brain', 'projects', 'slugifier', 'themes');
      assert.equal(existsSync(themesDir), true);
      assert.equal(lstatSync(themesDir).isSymbolicLink(), false, 'themes/ should be a real dir');
      assert.equal(statSync(themesDir).isDirectory(), true);

      const cyclesDir = resolve(dir, 'brain', '_raw', 'cycles');
      assert.equal(existsSync(cyclesDir), true);
      assert.equal(lstatSync(cyclesDir).isSymbolicLink(), false, '_raw/cycles/ should be a real dir');
    } finally {
      cleanupTempdir(dir);
    }
  } finally {
    fix.cleanup();
  }
});

test('setupTempdir: writes manifest into _queue/done/<id>.md', () => {
  const fix = makeFixtureBundle();
  try {
    const dir = setupTempdir(
      makeInput({
        manifestPath: fix.manifestPath,
        eventLogPath: fix.eventLogPath,
        brainGapsPath: fix.brainGapsPath,
        mergedTreePath: fix.mergedTreePath,
      }),
    );
    try {
      const dest = resolve(dir, '_queue', 'done', 'INIT-test.md');
      assert.equal(existsSync(dest), true);
      assert.equal(readFileSync(dest, 'utf8'), FIXTURE_MANIFEST);
    } finally {
      cleanupTempdir(dir);
    }
  } finally {
    fix.cleanup();
  }
});

test('setupTempdir: writes events.jsonl into _logs/<cycle-id>/', () => {
  const fix = makeFixtureBundle();
  try {
    const dir = setupTempdir(
      makeInput({
        manifestPath: fix.manifestPath,
        eventLogPath: fix.eventLogPath,
        brainGapsPath: fix.brainGapsPath,
        mergedTreePath: fix.mergedTreePath,
      }),
    );
    try {
      const dest = resolve(dir, '_logs', 'CY-test', 'events.jsonl');
      assert.equal(existsSync(dest), true);
      assert.equal(readFileSync(dest, 'utf8'), FIXTURE_EVENTS);
    } finally {
      cleanupTempdir(dir);
    }
  } finally {
    fix.cleanup();
  }
});

test('setupTempdir: simulator pre-populates user-feedback.md', () => {
  const fix = makeFixtureBundle();
  try {
    const canned = '## Answers\n\nstaging worked.\n\n## Free-form\n\nLooks good.\n';
    const dir = setupTempdir(
      makeInput({
        manifestPath: fix.manifestPath,
        eventLogPath: fix.eventLogPath,
        brainGapsPath: fix.brainGapsPath,
        mergedTreePath: fix.mergedTreePath,
        userFeedbackContent: canned,
      }),
    );
    try {
      const dest = resolve(dir, '_logs', 'CY-test', 'user-feedback.md');
      assert.equal(existsSync(dest), true);
      assert.equal(readFileSync(dest, 'utf8'), canned);
    } finally {
      cleanupTempdir(dir);
    }
  } finally {
    fix.cleanup();
  }
});

test('setupTempdir: throws when manifest missing', () => {
  const fix = makeFixtureBundle();
  try {
    assert.throws(
      () =>
        setupTempdir(
          makeInput({
            manifestPath: '/does/not/exist',
            eventLogPath: fix.eventLogPath,
            brainGapsPath: fix.brainGapsPath,
            mergedTreePath: fix.mergedTreePath,
          }),
        ),
      /manifest path does not exist/,
    );
  } finally {
    fix.cleanup();
  }
});

test('setupTempdir: throws when event log missing', () => {
  const fix = makeFixtureBundle();
  try {
    assert.throws(
      () =>
        setupTempdir(
          makeInput({
            manifestPath: fix.manifestPath,
            eventLogPath: '/does/not/exist.jsonl',
            brainGapsPath: fix.brainGapsPath,
            mergedTreePath: fix.mergedTreePath,
          }),
        ),
      /event log path does not exist/,
    );
  } finally {
    fix.cleanup();
  }
});

test('setupTempdir: throws when merged tree missing', () => {
  const fix = makeFixtureBundle();
  try {
    assert.throws(
      () =>
        setupTempdir(
          makeInput({
            manifestPath: fix.manifestPath,
            eventLogPath: fix.eventLogPath,
            brainGapsPath: fix.brainGapsPath,
            mergedTreePath: '/does/not/exist',
          }),
        ),
      /merged tree path does not exist/,
    );
  } finally {
    fix.cleanup();
  }
});

// ---------- runReflector ----------

test('runReflector: tallies tool use across streamed messages', async () => {
  const fix = makeFixtureBundle();
  try {
    const result = await runReflector(
      makeInput({
        manifestPath: fix.manifestPath,
        eventLogPath: fix.eventLogPath,
        brainGapsPath: fix.brainGapsPath,
        mergedTreePath: fix.mergedTreePath,
        queryFn: fakeQueryFn({
          toolBlocks: [
            { type: 'tool_use', name: 'Read', input: { file_path: 'brain/INDEX.md' } },
            { type: 'tool_use', name: 'Write', input: { file_path: 'brain/projects/slugifier/themes/foo.md' } },
            { type: 'tool_use', name: 'Write', input: { file_path: '_logs/CY-test/retro.md' } },
            { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
          ],
          costUsd: 0.12,
          durationMs: 4321,
        }),
      }),
    );
    try {
      assert.equal(result.toolUseSummary.brainReads, 1);
      assert.equal(result.toolUseSummary.themeWrites, 1);
      assert.equal(result.toolUseSummary.retroWrites, 1);
      assert.equal(result.toolUseSummary.bashCalls, 1);
      assert.equal(result.costUsd, 0.12);
      assert.equal(result.durationMs, 4321);
      assert.equal(result.resultSubtype, 'success');
    } finally {
      cleanupTempdir(result.tempdir);
    }
  } finally {
    fix.cleanup();
  }
});

test('runReflector: surfaces agent throw as runnerError', async () => {
  const fix = makeFixtureBundle();
  try {
    const result = await runReflector(
      makeInput({
        manifestPath: fix.manifestPath,
        eventLogPath: fix.eventLogPath,
        brainGapsPath: fix.brainGapsPath,
        mergedTreePath: fix.mergedTreePath,
        queryFn: () => {
          throw new Error('boom');
        },
      }),
    );
    try {
      assert.equal(result.runnerError?.kind, 'agent_threw');
      assert.match(result.runnerError?.message ?? '', /boom/);
    } finally {
      cleanupTempdir(result.tempdir);
    }
  } finally {
    fix.cleanup();
  }
});

test('runReflector: agent can write themes into the layered brain (write to fresh themes dir)', async () => {
  const fix = makeFixtureBundle();
  try {
    // Simulate the agent's write by performing it inside the queryFn's
    // generator — that proves the layered brain is writable at the masked path.
    const themePath = 'brain/projects/slugifier/themes/2026-05-10-sample.md';
    const result = await runReflector(
      makeInput({
        manifestPath: fix.manifestPath,
        eventLogPath: fix.eventLogPath,
        brainGapsPath: fix.brainGapsPath,
        mergedTreePath: fix.mergedTreePath,
        queryFn: ({ options }) =>
          (async function* () {
            const cwd = (options as { cwd?: string }).cwd!;
            // Write a theme file into the masked-out themes dir.
            writeFileSync(
              resolve(cwd, themePath),
              '---\ntitle: Sample\ndescription: x\ncategory: pattern\ncreated_at: 2026-05-10\nupdated_at: 2026-05-10\n---\n\nbody\n',
            );
            yield {
              type: 'result',
              subtype: 'success',
              duration_ms: 100,
              total_cost_usd: 0,
            };
          })(),
      }),
    );
    try {
      const written = resolve(result.tempdir, themePath);
      assert.equal(existsSync(written), true);
      // And the live brain wasn't touched (the symlink target is masked out).
      const liveCounterpart = resolve(
        import.meta.dirname,
        '..',
        '..',
        themePath,
      );
      assert.equal(existsSync(liveCounterpart), false, 'live brain must not have been modified');
    } finally {
      cleanupTempdir(result.tempdir);
    }
  } finally {
    fix.cleanup();
  }
});
