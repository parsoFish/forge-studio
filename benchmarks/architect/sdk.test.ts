/**
 * Tests for runArchitect — the SDK-invocation glue. The SDK's `query` is
 * dependency-injectable; the fake yields message sequences and writes
 * manifests into the agent's tempdir to simulate the real flow.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  cleanupTempdir,
  runArchitect,
  setupTempdir,
  type ArchitectQueryFn,
  type RunArchitectInput,
} from './sdk.ts';

function fakeQueryFn(messages: unknown[], onCall?: (cwd: string) => void): ArchitectQueryFn {
  return ({ options }) => {
    if (onCall && options) onCall((options as { cwd?: string }).cwd ?? '');
    async function* gen() {
      for (const m of messages) yield m;
    }
    return gen();
  };
}

const baseInput: Omit<RunArchitectInput, 'queryFn'> = {
  fixtureId: 'TEST',
  userPrompt: 'add OAuth login',
  projectName: 'simplarr',
  expected: { min_features: 1, max_features: 5 },
};

test('setupTempdir: creates _architect (post-S2A) and _queue/pending (legacy fallback), symlinks brain', () => {
  const dir = setupTempdir({ ...baseInput });
  try {
    assert.ok(existsSync(resolve(dir, 'projects/simplarr/_architect')), '_architect dir scaffolded');
    assert.ok(existsSync(resolve(dir, '_queue/pending')), 'legacy _queue/pending kept as fallback');
    assert.ok(existsSync(resolve(dir, 'projects/simplarr')));
    assert.ok(existsSync(resolve(dir, 'brain')));
    assert.ok(existsSync(resolve(dir, 'skills')));
  } finally {
    cleanupTempdir(dir);
  }
});

test('setupTempdir: writes roadmap.md when projectContext is supplied', () => {
  const dir = setupTempdir({ ...baseInput, projectContext: '# fake roadmap' });
  try {
    const roadmap = resolve(dir, 'projects/simplarr/roadmap.md');
    assert.ok(existsSync(roadmap));
  } finally {
    cleanupTempdir(dir);
  }
});

test('runArchitect: reads back the manifest the agent wrote into _architect/<sid>/manifests/', async () => {
  const queryFn = fakeQueryFn([
    {
      type: 'result',
      subtype: 'success',
      duration_ms: 1234,
      total_cost_usd: 0.0042,
    },
  ], (cwd) => {
    // Simulate a post-S2A architect agent: writes to _architect/<sid>/manifests/
    const sessionDir = resolve(cwd, 'projects/simplarr/_architect/2026-05-24T00-00-00');
    const manifestsDir = resolve(sessionDir, 'manifests');
    mkdirSync(manifestsDir, { recursive: true });
    writeFileSync(
      resolve(manifestsDir, 'INIT-2026-05-24-test.md'),
      '---\ninitiative_id: INIT-2026-05-24-test\nproject: simplarr\n---\nbody',
    );
    writeFileSync(resolve(sessionDir, 'PLAN.md'), '<!-- verdict: approve | revise | reject -->\n\n# Plan\n');
  });

  const r = await runArchitect({ ...baseInput, queryFn });
  try {
    assert.equal(r.runnerError, undefined);
    assert.equal(r.durationMs, 1234);
    assert.equal(r.costUsd, 0.0042);
    assert.notEqual(r.manifestText, null);
    assert.ok(r.manifestText?.includes('initiative_id: INIT-2026-05-24-test'));
    assert.equal(
      r.manifestPath,
      'projects/simplarr/_architect/2026-05-24T00-00-00/manifests/INIT-2026-05-24-test.md',
    );
    // PLAN.md surfaces via findPlanArtifacts
    assert.ok(r.planDoc.includes('# Plan'));
  } finally {
    cleanupTempdir(r.tempdir);
  }
});

test('runArchitect: legacy _queue/pending fallback still works when agent writes the old way', async () => {
  const queryFn = fakeQueryFn([
    { type: 'result', subtype: 'success', duration_ms: 100, total_cost_usd: 0.001 },
  ], (cwd) => {
    const pending = resolve(cwd, '_queue/pending');
    mkdirSync(pending, { recursive: true });
    writeFileSync(
      resolve(pending, 'INIT-2026-05-08-legacy.md'),
      '---\ninitiative_id: INIT-2026-05-08-legacy\nproject: simplarr\n---\nbody',
    );
  });
  const r = await runArchitect({ ...baseInput, queryFn });
  try {
    assert.equal(r.runnerError, undefined);
    assert.equal(r.manifestPath, '_queue/pending/INIT-2026-05-08-legacy.md');
    assert.ok(r.manifestText?.includes('INIT-2026-05-08-legacy'));
  } finally {
    cleanupTempdir(r.tempdir);
  }
});

test('runArchitect: tallies brain reads, writes, and bash calls from assistant messages', async () => {
  const queryFn = fakeQueryFn([
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: 'brain/forge/themes/x.md' } },
          { type: 'tool_use', name: 'Grep', input: { pattern: 'thing', path: 'brain/' } },
          { type: 'tool_use', name: 'Read', input: { file_path: 'docs/phases/architect.md' } }, // not brain
          { type: 'tool_use', name: 'Write', input: { file_path: '_queue/pending/x.md' } },
          { type: 'tool_use', name: 'Edit', input: { file_path: '_queue/pending/x.md' } },
          { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    },
    {
      type: 'result',
      subtype: 'success',
      duration_ms: 100,
      total_cost_usd: 0.001,
    },
  ], (cwd) => {
    const pending = resolve(cwd, '_queue/pending');
    mkdirSync(pending, { recursive: true });
    writeFileSync(resolve(pending, 'INIT-2026-05-08-x.md'), '---\nx: 1\n---\nbody');
  });

  const r = await runArchitect({ ...baseInput, queryFn });
  try {
    assert.equal(r.toolUseSummary.brainReads, 2);
    assert.equal(r.toolUseSummary.writes, 2);
    assert.equal(r.toolUseSummary.bashCalls, 1);
  } finally {
    cleanupTempdir(r.tempdir);
  }
});

test('runArchitect: missing manifest surfaces as no_manifest_written', async () => {
  const queryFn = fakeQueryFn([
    { type: 'result', subtype: 'success', duration_ms: 100, total_cost_usd: 0.001 },
  ]);

  const r = await runArchitect({ ...baseInput, queryFn });
  try {
    assert.equal(r.manifestText, null);
    assert.equal(r.runnerError?.kind, 'no_manifest_written');
    // Error message mentions the new _architect path
    assert.match(r.runnerError?.message ?? '', /_architect/);
  } finally {
    cleanupTempdir(r.tempdir);
  }
});

test('runArchitect: maps error_max_turns subtype to a typed runner_error', async () => {
  const queryFn = fakeQueryFn([
    { type: 'result', subtype: 'error_max_turns', duration_ms: 500, total_cost_usd: 0.01 },
  ]);

  const r = await runArchitect({ ...baseInput, queryFn });
  try {
    assert.equal(r.runnerError?.kind, 'error_max_turns');
    assert.equal(r.durationMs, 500);
  } finally {
    cleanupTempdir(r.tempdir);
  }
});

test('runArchitect: maps error_max_budget_usd subtype', async () => {
  const queryFn = fakeQueryFn([
    { type: 'result', subtype: 'error_max_budget_usd', duration_ms: 200, total_cost_usd: 0.5 },
  ]);

  const r = await runArchitect({ ...baseInput, queryFn });
  try {
    assert.equal(r.runnerError?.kind, 'error_max_budget_usd');
  } finally {
    cleanupTempdir(r.tempdir);
  }
});

test('runArchitect: empty iterator surfaces as no_result', async () => {
  const queryFn = fakeQueryFn([]);

  const r = await runArchitect({ ...baseInput, queryFn });
  try {
    // no_result is set first; no_manifest_written is not overwritten
    assert.equal(r.runnerError?.kind, 'no_result');
  } finally {
    cleanupTempdir(r.tempdir);
  }
});

test('runArchitect: detects multiple manifests as multiple_manifests_written (in _architect)', async () => {
  const queryFn = fakeQueryFn([
    { type: 'result', subtype: 'success', duration_ms: 100, total_cost_usd: 0.001 },
  ], (cwd) => {
    const manifestsDir = resolve(cwd, 'projects/simplarr/_architect/2026-05-24T00-00-00/manifests');
    mkdirSync(manifestsDir, { recursive: true });
    writeFileSync(resolve(manifestsDir, 'INIT-2026-05-24-a.md'), 'one');
    writeFileSync(resolve(manifestsDir, 'INIT-2026-05-24-b.md'), 'two');
  });

  const r = await runArchitect({ ...baseInput, queryFn });
  try {
    assert.notEqual(r.manifestText, null);
    assert.equal(r.runnerError?.kind, 'multiple_manifests_written');
    // Sibling collection picks up the other manifest
    assert.equal(r.siblingManifestTexts.length, 1);
  } finally {
    cleanupTempdir(r.tempdir);
  }
});
