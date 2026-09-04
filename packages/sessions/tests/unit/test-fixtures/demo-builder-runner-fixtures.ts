/**
 * The demo-builder runner suite's scaffolding — its tmp-project `setup()`, the
 * writing query-fn builders and the logger/normaliser helpers.
 *
 * Extracted so the suite comes under the 800-line cap (M4 exit row 5, C3): the
 * head travelled with the only body piece and put the file at 860.
 *
 * NOT shared with `demo-builder-skill-prompt-setup.ts` — see the note in that
 * file. The two `setup()`s differ in five asserted-on ways and the two
 * `makeWritingQueryFn`s report different `total_cost_usd` values, so sharing
 * either would couple two suites through a fixture.
 */

import { test } from 'node:test';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runDemoBuilderTurn, demoSessionDir, demoBuilderAgentSpec, DEMO_BUILDER_MODEL,
  DEMO_HTML_REL_PATH, DEMO_SKILL_REL_PATH, DEMO_LOCK_REL_PATH, type DemoBuilderStatus,
} from '../../../kinds/demo-builder.ts';
import { REDACTED_THINKING_MARKER, type QueryFn } from '../../../interactive-session.ts';
import { writeSessionStatus, readSessionStatus } from '../../../interactive-session.ts';
import { createLogger } from '@forge/kernel';

/**
 * Tests for the demo-builder runner (Stage B). The write-enabled agent sits
 * behind an injectable `queryFn`; the stub writes DEMO.html as a side-effect to
 * simulate the real agent's file output. Each test uses a fresh tempdir.
 */




/** A queryFn simulating the agent writing BOTH the reusable demo-design skill and
 *  the sample DEMO.html into its cwd (the project repo). */
export function makeWritingQueryFn(capture?: (prompt: string) => void): QueryFn {
  return ({ prompt, options }) => {
    capture?.(prompt);
    const cwd = (options?.cwd as string) ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(cwd, '.forge', 'demo'), { recursive: true });
      mkdirSync(join(cwd, '.forge', 'skills', 'demo-design'), { recursive: true });
      writeFileSync(join(cwd, DEMO_SKILL_REL_PATH), '# demo-design\n\nRender before/after HTML of an initiative\'s changes.');
      writeFileSync(join(cwd, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>before/after sample</body></html>');
      yield { type: 'result', total_cost_usd: 0.05 };
    }
    return gen();
  };
}

/** A queryFn that writes ONLY the sample (missing the reusable skill). */
function makeSampleOnlyQueryFn(): QueryFn {
  return ({ options }) => {
    const cwd = (options?.cwd as string) ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(cwd, '.forge', 'demo'), { recursive: true });
      writeFileSync(join(cwd, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>sample</body></html>');
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };
}

/** A queryFn that does NOT write DEMO.html (the agent failed to produce output). */
export function makeNoopQueryFn(): QueryFn {
  return () => {
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };
}

export function setup(overrides?: Partial<DemoBuilderStatus>): {
  projectRoot: string;
  repoPath: string;
  logsRoot: string;
  sessionId: string;
  sessionDir: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'demo-runner-'));
  const projectRoot = join(root, 'project');
  const repoPath = join(root, 'repo');
  mkdirSync(join(repoPath, '.forge'), { recursive: true });
  writeFileSync(
    join(repoPath, '.forge', 'project.json'),
    JSON.stringify({ testProcess: { local: { cmd: ['npm', 'test'] } }, demoProcess: [{ kind: 'capture', text: 'Run the CLI on a sample.' }, { kind: 'verify', text: 'Output matches the golden file.' }] }),
  );
  const logsRoot = join(root, '_logs');
  const sessionId = '2026-06-24T11-00-00';
  const sessionDir = demoSessionDir(projectRoot, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const status: DemoBuilderStatus = {
    session_id: sessionId,
    project: 'demo',
    project_repo_path: repoPath,
    phase: 'generating',
    iteration: 1,
    prompt: 'Show the before/after of the headline command, dark and minimal.',
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  writeSessionStatus(sessionDir, status);
  return { projectRoot, repoPath, logsRoot, sessionId, sessionDir };
}

export const logger = (logsRoot: string, sid: string) => createLogger(`_demo-${sid}`, logsRoot);

test('generating → agent produces the demo skill + sample → awaiting-review', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup();
  const result = await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeWritingQueryFn(), logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.equal(result.phase, 'awaiting-review');
  assert.ok(existsSync(join(repoPath, DEMO_SKILL_REL_PATH)), 'reusable demo-design skill authored');
  assert.ok(existsSync(join(repoPath, DEMO_HTML_REL_PATH)), 'sample DEMO.html rendered');
  assert.equal(result.demoPath, join(repoPath, DEMO_HTML_REL_PATH));
  assert.equal(readSessionStatus<DemoBuilderStatus>(sessionDir)?.phase, 'awaiting-review');
});

test('generating but neither file produced → throws a clear, recoverable error', async () => {
  const { projectRoot, logsRoot, sessionId } = setup();
  await assert.rejects(
    () => runDemoBuilderTurn({ sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot }),
    /without producing .*DEMO\.html/,
  );
});

test('generating with the sample but NOT the reusable demo skill → throws (skill is required)', async () => {
  const { projectRoot, logsRoot, sessionId } = setup();
  await assert.rejects(
    () => runDemoBuilderTurn({ sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeSampleOnlyQueryFn(), logger: logger(logsRoot, sessionId), logsRoot }),
    /demo-design\/SKILL\.md/,
  );
});

test('generate prompt carries the demoProcess, look-and-feel, feedback, and the inlined base CSS', async () => {
  const { projectRoot, logsRoot, sessionId, sessionDir } = setup({ phase: 'generating' });
  writeFileSync(join(sessionDir, 'feedback.md'), 'Make the diff bigger and drop the footer.');
  let captured = '';
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeWritingQueryFn((p) => { captured = p; }), logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.match(captured, /Output matches the golden file/, 'demoProcess steps injected');
  assert.match(captured, /dark and minimal/, 'look-and-feel guidance injected');
  assert.match(captured, /drop the footer/, 'feedback injected');
  assert.match(captured, /--bg: #0a0e14/, 'forge demo base CSS inlined into the prompt');
  // Re-orientation (Fix 3): the task is a reusable per-initiative-change demo
  // skill + a real sample, NOT a generic current-state showcase.
  assert.match(captured, /demo-design\/SKILL\.md/, 'directs authoring the reusable demo skill');
  assert.match(captured, /INITIATIVE'S CHANGES|before\/after/i, 'scopes the demo to an initiative\'s changes');
  assert.match(captured, /git (log|diff)/i, 'directs sampling from a real recent change');
});

test('W6-B1: generating turn forwards thinking + coalesced redacted_thinking to the event log, and Read tool_use events are unsampled', async () => {
  const { projectRoot, logsRoot, sessionId } = setup();
  const READ_CALLS = 6;
  const queryFn: QueryFn = ({ options }) => {
    const cwd = (options?.cwd as string) ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      const reads = Array.from({ length: READ_CALLS }, (_, i) => ({
        type: 'tool_use', name: 'Read', input: { file_path: `f${i}.md` },
      }));
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: '  weighing the demo layout  ' },
            { type: 'redacted_thinking', data: 'opaque-1' },
            { type: 'redacted_thinking', data: 'opaque-2' }, // consecutive — must coalesce
            ...reads,
          ],
        },
      };
      mkdirSync(join(cwd, '.forge', 'demo'), { recursive: true });
      mkdirSync(join(cwd, '.forge', 'skills', 'demo-design'), { recursive: true });
      writeFileSync(join(cwd, DEMO_SKILL_REL_PATH), '# demo-design\n');
      writeFileSync(join(cwd, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>sample</body></html>');
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };

  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn, logger: logger(logsRoot, sessionId), logsRoot,
  });

  const events = readFileSync(join(logsRoot, `_demo-${sessionId}`, 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

  const thinkingEvents = events.filter((e) => e.metadata?.kind === 'thinking');
  assert.equal(thinkingEvents.length, 2, 'one real thinking row + ONE coalesced row for the two consecutive redacted markers');
  assert.equal(thinkingEvents[0].message, 'weighing the demo layout');
  assert.equal(thinkingEvents[1].message, REDACTED_THINKING_MARKER);

  const readToolUses = events.filter((e) => e.event_type === 'tool_use' && e.metadata?.tool === 'Read');
  assert.equal(readToolUses.length, READ_CALLS, 'sampler opts {readOnlySampleRate:1, cap:200} — every Read emitted, none sampled out');
});

test('locking → writes demo.lock.json + status locked', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup({ phase: 'locking', iteration: 3 });
  // A prior generate left the reusable skill + the sample in the repo.
  mkdirSync(join(repoPath, '.forge', 'demo'), { recursive: true });
  mkdirSync(join(repoPath, '.forge', 'skills', 'demo-design'), { recursive: true });
  writeFileSync(join(repoPath, DEMO_SKILL_REL_PATH), '# demo-design');
  writeFileSync(join(repoPath, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>demo</body></html>');

  const result = await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.equal(result.phase, 'locked');
  const lockPath = join(repoPath, DEMO_LOCK_REL_PATH);
  assert.ok(existsSync(lockPath));
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  assert.equal(lock.iterations, 3);
  assert.equal(lock.demo_html, DEMO_HTML_REL_PATH);
  assert.equal(lock.demo_skill, DEMO_SKILL_REL_PATH, 'lock records the reusable generator');
  // The locked demo is snapshotted to history/<sessionId>/ so it stays viewable.
  const histDemo = join(repoPath, '.forge', 'demo', 'history', sessionId, 'DEMO.html');
  assert.ok(existsSync(histDemo), 'locked demo archived to history');
  assert.ok(existsSync(join(repoPath, '.forge', 'demo', 'history', sessionId, 'meta.json')), 'history meta written');
  assert.equal(readSessionStatus<DemoBuilderStatus>(sessionDir)?.phase, 'locked');
});

test('locking with no DEMO.html in the repo → throws', async () => {
  const { projectRoot, logsRoot, sessionId } = setup({ phase: 'locking' });
  await assert.rejects(
    () => runDemoBuilderTurn({ sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot }),
    /cannot lock/,
  );
});

/** A queryFn that writes ONLY a per-element project-side skill + the sample. */
export function makeElementQueryFn(elementId: string, capture?: (p: string) => void): QueryFn {
  return ({ prompt, options }) => {
    capture?.(prompt);
    const cwd = (options?.cwd as string) ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(cwd, '.forge', 'demo'), { recursive: true });
      mkdirSync(join(cwd, '.forge', 'skills', 'demo', elementId), { recursive: true });
      writeFileSync(join(cwd, '.forge', 'skills', 'demo', elementId, 'SKILL.md'), `# ${elementId} element`);
      writeFileSync(join(cwd, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>element fragment</body></html>');
      yield { type: 'result', total_cost_usd: 0.02 };
    }
    return gen();
  };
}

export function writeComposedProcess(repoPath: string): void {
  writeFileSync(
    join(repoPath, '.forge', 'project.json'),
    JSON.stringify({
      testProcess: { local: { cmd: ['npm', 'test'] } },
      demoProcess: [
        { kind: 'present', text: 'Lead', element: 'narrative' },
        { kind: 'capture', text: 'node bin/x.js --write', element: 'cli-capture' },
        { kind: 'verify', text: 'npm test', element: 'test-evidence' },
      ],
    }),
  );
}

test('composed demo: the generate prompt lists the ordered elements + injects their generators', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId } = setup();
  writeComposedProcess(repoPath);
  let captured = '';
  const result = await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeWritingQueryFn((p) => { captured = p; }), logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.equal(result.phase, 'awaiting-review');
  assert.match(captured, /COMPOSED of demo elements/, 'composition framing present');
  assert.match(captured, /\[present\] narrative/, 'ordered element list (narrative first)');
  assert.match(captured, /\[capture\] cli-capture/, 'cli-capture in the order');
  assert.match(captured, /Element generators/, 'element generator bodies injected');
  assert.match(captured, /#### cli-capture/, 'the cli-capture generator block header is included');
  assert.match(captured, /REAL stdout on the baseline/, 'the cli-capture generator body text is included');
});

test('per-element iteration: targetElement focuses the turn + requires the element skill', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId } = setup({ phase: 'generating', targetElement: 'cli-capture' });
  writeComposedProcess(repoPath);
  let captured = '';
  const result = await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeElementQueryFn('cli-capture', (p) => { captured = p; }), logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.equal(result.phase, 'awaiting-review');
  assert.match(captured, /Iterate ONE element: 'cli-capture'/, 'focused on the one element');
  // It required + accepted the per-element skill (NOT the demo-design composer).
  assert.ok(existsSync(join(repoPath, '.forge', 'skills', 'demo', 'cli-capture', 'SKILL.md')));
});

test('per-element iteration: missing the element skill → throws naming that element skill', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId } = setup({ phase: 'generating', targetElement: 'cli-capture' });
  writeComposedProcess(repoPath);
  await assert.rejects(
    () => runDemoBuilderTurn({ sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot }),
    /demo\/cli-capture\/SKILL\.md/,
  );
});

test('briefing turn is a no-op (the operator provides notes before the agent runs)', async () => {
  const { projectRoot, logsRoot, sessionId } = setup({ phase: 'briefing', mode: 'update' });
  const result = await runDemoBuilderTurn({ sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot });
  assert.equal(result.phase, 'briefing');
  assert.equal(result.wrote.length, 0);
});

test('update mode: the generate prompt carries an UPDATE framing referencing the locked skill + sample', async () => {
  const { projectRoot, logsRoot, sessionId } = setup({ phase: 'generating', mode: 'update' });
  let captured = '';
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeWritingQueryFn((p) => { captured = p; }), logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.match(captured, /UPDATE MODE/, 'update framing present');
  assert.match(captured, /demo-design\/SKILL\.md/, 'references the existing generator');
  assert.match(captured, /change-notes/i, 'frames the brief as change-notes');
});

test('awaiting-review turn is a no-op (bridge owns the wait state)', async () => {
  const { projectRoot, logsRoot, sessionId } = setup({ phase: 'awaiting-review' });
  const result = await runDemoBuilderTurn({ sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot });
  assert.equal(result.phase, 'awaiting-review');
  assert.equal(result.wrote.length, 0);
});

test('missing status.json throws a clear error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'demo-runner-'));
  await assert.rejects(
    runDemoBuilderTurn({ sessionId: 'nope', projectRoot: join(root, 'p'), forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn() }),
    /no status\.json/,
  );
});

test('ADR-024: demoBuilderAgentSpec derives phase (demo), tier (sonnet), and write tools', () => {
  // W7-C3 review (A-M10): the frontmatter still declared the RETIRED `unifier`
  // phase while every event row said `demo` (sessions-kinds-26). ADR-024 makes
  // the frontmatter the source of intent; the two must not contradict.
  assert.equal(demoBuilderAgentSpec.phase, 'demo');
  assert.equal(demoBuilderAgentSpec.tier, 'sonnet');
  assert.equal(DEMO_BUILDER_MODEL, 'claude-sonnet-4-6');
  assert.ok(demoBuilderAgentSpec.allowedTools.includes('Write'), 'demo-builder writes the machinery + HTML');
  assert.ok(demoBuilderAgentSpec.allowedTools.includes('Bash'), 'demo-builder runs the project for real output');
});
