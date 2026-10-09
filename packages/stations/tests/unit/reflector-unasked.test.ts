/**
 * forge-nk1y.3 — an interactive reflector that asks the operator nothing is
 * named, never a silent pass.
 *
 * Stranger attempt 2 (2026-10-09, Q9): after the merge the interactive
 * reflector ran to `reflector.end` and nothing reached the operator. Its run
 * dir shows it DID write `user-questions.md`; the surfacing half lives in the
 * bridge (`apps/forge/reflection-pending.ts`). This file holds the other half:
 * when an interactive reflector reaches its end with NO question for the
 * operator (no `.md`, a `.md` with no `## ` question, or a `.json` that could
 * not be written), `runReflector` emits `reflector.unasked` naming why, and
 * `reflector.end` carries the question count — so a zero-ask reflection is a
 * named red, not an empty array nobody reads.
 *
 * Not a red: automated mode (the reflector answers its own questions) and a
 * rerun after the operator answered (`user-feedback.md` present — the rerun
 * legitimately asks nothing new).
 *
 * The question fixture is the stranger's own `user-questions.md`, copied
 * verbatim from its run dir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runReflector as runReflectorReal, type ReflectorDeps } from '../../phases/reflector.ts';
import { createLogger } from '@forge/kernel';
import type { CycleInput } from '@forge/flows';
import type { RunBrainLintResult } from '@forge/knowledge';
import { acquireIsolatedReflectorLease } from '../test-fixtures/reflector-lease-test-fixture.ts';
import { canonicalDef } from '../test-fixtures/canonical-def-fixture.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
const STRANGER_QUESTIONS_MD = readFileSync(
  resolve(import.meta.dirname, '..', 'test-fixtures', 'reflector-stranger-a2', 'user-questions.md'),
  'utf8',
);

type Ev = { message?: string; event_type?: string; metadata?: Record<string, unknown> };

type Harness = {
  cycleId: string;
  manifestPath: string;
  cycleLogDir: string;
  logsRoot: string;
  logger: ReturnType<typeof createLogger>;
  events: () => Ev[];
  cleanup: () => void;
};

function setup(suffix: string): Harness {
  const cycleId = `UNASKED-TEST-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${suffix}`;
  const tmp = mkdtempSync(join(tmpdir(), 'reflector-unasked-test-'));
  const manifestPath = join(tmp, 'manifest.md');
  writeFileSync(manifestPath, [
    '---',
    'initiative_id: INIT-2026-10-09-unasked',
    'project: demo-project',
    'created_at: 2026-10-09T12:00:00Z',
    'iteration_budget: 3',
    'cost_budget_usd: 1.0',
    'class: code',
    'phase: done',
    'origin: architect',
    '---',
    '',
    'body',
    '',
  ].join('\n'));
  const logsRoot = join(tmp, '_logs');
  const cycleLogDir = resolve(logsRoot, cycleId);
  const logger = createLogger(cycleId, logsRoot);
  return {
    cycleId,
    manifestPath,
    cycleLogDir,
    logsRoot,
    logger,
    events: () => {
      if (!existsSync(logger.logFilePath)) return [];
      return readFileSync(logger.logFilePath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Ev);
    },
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
  };
}

function input(h: Harness, mode?: 'interactive' | 'automated'): CycleInput {
  return {
    initiativeId: 'INIT-2026-10-09-unasked',
    manifestPath: h.manifestPath,
    projectRepoPath: FORGE_ROOT,
    worktreePath: FORGE_ROOT,
    cycleId: h.cycleId,
    logsRoot: h.logsRoot,
    ...(mode ? { mode } : {}),
  };
}

/** A fake agent: one brain Read (clears the F-13 brain gate), optionally
 *  writes `user-questions.md` the way the real agent's Write tool would,
 *  then a successful result. */
function fakeAgent(h: Harness, questionsMd: string | null) {
  return async function* (): AsyncIterable<unknown> {
    yield { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'brain/INDEX.md' } }] } };
    if (questionsMd !== null) {
      mkdirSync(h.cycleLogDir, { recursive: true });
      writeFileSync(resolve(h.cycleLogDir, 'user-questions.md'), questionsMd);
    }
    yield { type: 'result', subtype: 'success', total_cost_usd: 0.05, duration_ms: 1234 };
  };
}

const cleanLint = (): ((opts: { cwd: string; cycleId: string }) => RunBrainLintResult) => () => ({ findings: [], exitCode: 0 });

const run = (h: Harness, mode: 'interactive' | 'automated' | undefined, deps: Partial<ReflectorDeps>) =>
  runReflectorReal(input(h, mode), h.logger, {
    acquireBrainWriteLease: acquireIsolatedReflectorLease,
    agentDef: canonicalDef('reflector'),
    brainLint: cleanLint(),
    ...deps,
  });

const unasked = (h: Harness) => h.events().filter((e) => e.message === 'reflector.unasked');
const endEvent = (h: Harness) => h.events().find((e) => e.message === 'reflector.end');

test('nk1y.3 RED path: interactive reflector writes no user-questions.md → reflector.unasked (no-questions-file), end.questions = 0', async () => {
  const h = setup('no-md');
  try {
    await run(h, 'interactive', { sdkQuery: fakeAgent(h, null) });
    const named = unasked(h);
    assert.equal(named.length, 1, 'a zero-ask interactive reflection must be named exactly once, never silent');
    assert.equal(named[0].event_type, 'error');
    assert.equal(named[0].metadata?.['reason'], 'no-questions-file');
    assert.equal(named[0].metadata?.['mode'], 'interactive');
    assert.equal(endEvent(h)?.metadata?.['questions'], 0);
    // The .json still exists — the Studio gate reads `[]` as "nothing asked" and offers the close act.
    assert.deepEqual(JSON.parse(readFileSync(resolve(h.cycleLogDir, 'user-questions.json'), 'utf8')), []);
  } finally {
    h.cleanup();
  }
});

test('nk1y.3 RED path: absent mode defaults to interactive and is named too', async () => {
  const h = setup('no-md-default');
  try {
    await run(h, undefined, { sdkQuery: fakeAgent(h, null) });
    assert.equal(unasked(h).length, 1);
  } finally {
    h.cleanup();
  }
});

test('nk1y.3 RED path: a user-questions.md with no "## " question → reflector.unasked (no-questions-parsed)', async () => {
  const h = setup('no-headings');
  try {
    await run(h, 'interactive', { sdkQuery: fakeAgent(h, '# User questions\n\nNothing warranted this cycle.\n') });
    const named = unasked(h);
    assert.equal(named.length, 1);
    assert.equal(named[0].metadata?.['reason'], 'no-questions-parsed');
    assert.equal(endEvent(h)?.metadata?.['questions'], 0);
  } finally {
    h.cleanup();
  }
});

test('nk1y.3 green: the stranger\'s own user-questions.md → 4 questions, no reflector.unasked, end.questions = 4', async () => {
  const h = setup('stranger');
  try {
    await run(h, 'interactive', { sdkQuery: fakeAgent(h, STRANGER_QUESTIONS_MD) });
    assert.equal(unasked(h).length, 0, 'a reflector that asked must not be reported unasked');
    assert.equal(endEvent(h)?.metadata?.['questions'], 4);
    const json = JSON.parse(readFileSync(resolve(h.cycleLogDir, 'user-questions.json'), 'utf8')) as unknown[];
    assert.equal(json.length, 4);
  } finally {
    h.cleanup();
  }
});

test('nk1y.3: automated mode asks nothing by design — not named unasked', async () => {
  const h = setup('automated');
  try {
    await run(h, 'automated', { sdkQuery: fakeAgent(h, null) });
    assert.equal(unasked(h).length, 0);
    assert.equal(endEvent(h)?.metadata?.['questions'], 0);
  } finally {
    h.cleanup();
  }
});

test('nk1y.3: a rerun after the operator answered (user-feedback.md present) asks nothing new — not named unasked', async () => {
  const h = setup('rerun');
  try {
    mkdirSync(h.cycleLogDir, { recursive: true });
    writeFileSync(resolve(h.cycleLogDir, 'user-feedback.md'), '# Reflection feedback\n');
    await run(h, 'interactive', { sdkQuery: fakeAgent(h, null) });
    assert.equal(unasked(h).length, 0);
  } finally {
    h.cleanup();
  }
});

test('nk1y.3 RED path: user-questions.json that cannot be written → reflector.unasked (questions-unwritable), never a silent []', async () => {
  const h = setup('unwritable');
  try {
    // A DIRECTORY where the .json must go: writeFileSync throws EISDIR. The
    // old derivation swallowed this into a second silent write attempt.
    mkdirSync(resolve(h.cycleLogDir, 'user-questions.json'), { recursive: true });
    await run(h, 'interactive', { sdkQuery: fakeAgent(h, STRANGER_QUESTIONS_MD) });
    const named = unasked(h);
    assert.equal(named.length, 1);
    assert.equal(named[0].metadata?.['reason'], 'questions-unwritable');
    assert.match(String(named[0].metadata?.['error'] ?? ''), /EISDIR/);
  } finally {
    h.cleanup();
  }
});
