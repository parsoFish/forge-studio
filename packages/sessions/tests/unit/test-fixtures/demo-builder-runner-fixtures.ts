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
import { FORGE_ROOT } from '@forge/kernel';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runDemoBuilderTurn, demoSessionDir, demoBuilderAgentSpec, DEMO_BUILDER_MODEL,
} from '../../../kinds/demo-builder.ts';
import {
  DEMO_DECLARATION_REL_PATH, DEMO_HTML_REL_PATH, DEMO_LOCK_REL_PATH, type DemoBuilderStatus,
} from '../../../kinds/demo-session-store.ts';
import { REDACTED_THINKING_MARKER, type QueryFn } from '../../../interactive-session.ts';
import { writeSessionStatus, readSessionStatus } from '../../../interactive-session.ts';
import { createLogger } from '@forge/kernel';

/**
 * Tests for the demo-builder runner (Stage B). The write-enabled agent sits
 * behind an injectable `queryFn`; the stub writes DEMO.html as a side-effect to
 * simulate the real agent's file output. Each test uses a fresh tempdir.
 */




/** A declaration the drive rule accepts (bead forge-mfv5.2.8). */
export const DRIVABLE_DECLARATION = [
  { kind: 'capture', text: 'Run `node bin/cli.js --summary` on both trees.' },
  { kind: 'verify', text: 'Output matches the golden file.' },
];

/** A queryFn simulating the agent writing BOTH the declaration draft and the
 *  sample DEMO.html into its cwd (the project repo). */
export function makeWritingQueryFn(capture?: (prompt: string) => void, declaration: unknown = DRIVABLE_DECLARATION): QueryFn {
  return ({ prompt, options }) => {
    capture?.(prompt);
    const cwd = (options?.cwd as string) ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(cwd, '.forge', 'demo'), { recursive: true });
      writeFileSync(join(cwd, DEMO_DECLARATION_REL_PATH), JSON.stringify(declaration));
      writeFileSync(join(cwd, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>before/after sample</body></html>');
      yield { type: 'result', total_cost_usd: 0.05 };
    }
    return gen();
  };
}

/** A queryFn that writes ONLY the sample (missing the declaration). */
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
  project: string;
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
  const project = 'demo';
  const sessionDir = demoSessionDir(logsRoot, project, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const status: DemoBuilderStatus = {
    session_id: sessionId,
    project,
    project_repo_path: repoPath,
    phase: 'generating',
    iteration: 1,
    prompt: 'Show the before/after of the headline command, dark and minimal.',
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  writeSessionStatus(sessionDir, status);
  return { project, projectRoot, repoPath, logsRoot, sessionId, sessionDir };
}

export const logger = (logsRoot: string, sid: string) => createLogger(`_demo-${sid}`, logsRoot);

test('generating → agent produces the declaration + sample → awaiting-review', async () => {
  const { project, projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup();
  const result = await runDemoBuilderTurn({
    sessionId, project, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeWritingQueryFn(), logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.equal(result.phase, 'awaiting-review');
  assert.equal(readFileSync(join(sessionDir, 'generations', '1', 'demo-process.json'), 'utf8'), JSON.stringify(DRIVABLE_DECLARATION), 'the declaration draft is the generation');
  assert.ok(!existsSync(join(repoPath, DEMO_DECLARATION_REL_PATH)), 'the draft never stays in the repo beside demoProcess');
  assert.ok(!existsSync(join(repoPath, '.forge', 'skills')), 'no composer SKILL.md (or any skill) is written');
  assert.ok(existsSync(join(repoPath, DEMO_HTML_REL_PATH)), 'sample DEMO.html rendered');
  assert.equal(result.demoPath, join(repoPath, DEMO_HTML_REL_PATH));
  assert.equal(readSessionStatus<DemoBuilderStatus>(sessionDir)?.phase, 'awaiting-review');
});

test('generating but neither file produced → throws a clear, recoverable error', async () => {
  const { project, projectRoot, logsRoot, sessionId } = setup();
  await assert.rejects(
    () => runDemoBuilderTurn({ sessionId, project, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot }),
    /without producing .*DEMO\.html/,
  );
});

test('generating with the sample but NOT the declaration → throws (the declaration is the output)', async () => {
  const { project, projectRoot, logsRoot, sessionId } = setup();
  await assert.rejects(
    () => runDemoBuilderTurn({ sessionId, project, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeSampleOnlyQueryFn(), logger: logger(logsRoot, sessionId), logsRoot }),
    /without producing \.forge\/demo\/demo-process\.json — /,
  );
});

test('generate prompt carries the demoProcess, look-and-feel, feedback, and the inlined base CSS', async () => {
  const { project, projectRoot, logsRoot, sessionId, sessionDir } = setup({ phase: 'generating' });
  writeFileSync(join(sessionDir, 'feedback.md'), 'Make the diff bigger and drop the footer.');
  // Bead 7.3.6 (T1 ruling 642): a generate turn now runs THREE agent passes —
  // READ, then WRITE, then GROUND — so `prompts[1]` is the write pass. 6.11.49
  // wrote this comment when there were two and `prompts[0]` was the write pass;
  // the index moved when the read pass went in front of it, and an index that
  // silently means a different pass is how these assertions would start
  // proving something nobody asked for.
  const prompts: string[] = [];
  await runDemoBuilderTurn({
    sessionId, project, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeWritingQueryFn((p) => { prompts.push(p); }), logger: logger(logsRoot, sessionId), logsRoot,
  });
  const captured = prompts[1];
  assert.match(captured, /Output matches the golden file/, 'demoProcess steps injected');
  assert.match(captured, /dark and minimal/, 'look-and-feel guidance injected');
  assert.match(captured, /drop the footer/, 'feedback injected');
  assert.match(captured, /--bg: #0a0e14/, 'forge demo base CSS inlined into the prompt');
  // forge-mfv5.2.8: the task is the demo DECLARATION + a real sample it
  // drives, and never a composer skill.
  assert.match(captured, /\.forge\/demo\/demo-process\.json/, 'directs authoring the declaration');
  assert.doesNotMatch(captured, /demo-design\/SKILL\.md/, 'never directs authoring a composer skill');
  assert.match(captured, /before\/after/i, 'scopes the demo to an initiative\'s changes');
  // Moved, not dropped: sampling a real recent change is what the GROUNDING
  // pass is for, and it is the pass that has Bash to do it (6.11.49).
  assert.match(prompts[2], /git (log|diff)/i, 'the grounding pass directs sampling from a real recent change');
  assert.doesNotMatch(captured, /git (log|diff)/i, 'the write pass is not sent looking for a commit it cannot run');
});

test('W6-B1: generating turn forwards thinking + coalesced redacted_thinking to the event log, and Read tool_use events are unsampled', async () => {
  const { project, projectRoot, logsRoot, sessionId } = setup();
  const READ_CALLS = 6;
  // 6.11.49: a generate turn runs two agent passes. The stream under test is
  // emitted by the WRITE pass only — this test is about how ONE pass's blocks
  // are forwarded and coalesced, and a fake that replayed the same stream twice
  // would assert the pass COUNT under the name of the sink's behaviour.
  let pass = 0;
  const queryFn: QueryFn = ({ options }) => {
    const cwd = (options?.cwd as string) ?? '.';
    const first = ++pass === 1;
    async function* gen(): AsyncGenerator<unknown> {
      const reads = first ? Array.from({ length: READ_CALLS }, (_, i) => ({
        type: 'tool_use', name: 'Read', input: { file_path: `f${i}.md` },
      })) : [];
      if (first) yield {
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
      writeFileSync(join(cwd, DEMO_DECLARATION_REL_PATH), JSON.stringify(DRIVABLE_DECLARATION));
      writeFileSync(join(cwd, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>sample</body></html>');
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };

  await runDemoBuilderTurn({
    sessionId, project, projectRoot, forgeRoot: FORGE_ROOT, queryFn, logger: logger(logsRoot, sessionId), logsRoot,
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

test('locking → writes the declaration into demoProcess + demo.lock.json + status locked', async () => {
  const { project, projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup();
  await runDemoBuilderTurn({
    sessionId, project, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeWritingQueryFn(), logger: logger(logsRoot, sessionId), logsRoot,
  });
  writeSessionStatus(sessionDir, { ...readSessionStatus<DemoBuilderStatus>(sessionDir)!, phase: 'locking', iteration: 3 });

  const result = await runDemoBuilderTurn({
    sessionId, project, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.equal(result.phase, 'locked');
  assert.deepEqual(JSON.parse(readFileSync(join(repoPath, '.forge', 'project.json'), 'utf8')).demoProcess, DRIVABLE_DECLARATION);
  const lockPath = join(repoPath, DEMO_LOCK_REL_PATH);
  assert.ok(existsSync(lockPath));
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  assert.equal(lock.iterations, 3);
  assert.equal(lock.demo_html, DEMO_HTML_REL_PATH);
  assert.deepEqual(lock.declaration, DRIVABLE_DECLARATION, 'lock records the declaration it wrote');
  assert.equal(Object.prototype.hasOwnProperty.call(lock, 'demo_skill'), false, 'no composer skill is recorded');
  // The locked demo is snapshotted to history/<sessionId>/ so it stays viewable.
  const histDemo = join(repoPath, '.forge', 'demo', 'history', sessionId, 'DEMO.html');
  assert.ok(existsSync(histDemo), 'locked demo archived to history');
  assert.ok(existsSync(join(repoPath, '.forge', 'demo', 'history', sessionId, 'meta.json')), 'history meta written');
  assert.equal(readSessionStatus<DemoBuilderStatus>(sessionDir)?.phase, 'locked');
});

test('locking with no generation on disk → throws', async () => {
  const { project, projectRoot, logsRoot, sessionId } = setup({ phase: 'locking' });
  await assert.rejects(
    () => runDemoBuilderTurn({ sessionId, project, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot }),
    /cannot lock — no generation on disk/,
  );
});

test('the generate prompt carries the current declaration and the demo-element library', async () => {
  const { project, projectRoot, logsRoot, sessionId } = setup();
  const prompts: string[] = [];
  await runDemoBuilderTurn({
    sessionId, project, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeWritingQueryFn((p) => { prompts.push(p); }), logger: logger(logsRoot, sessionId), logsRoot,
  });
  const captured = prompts[1];
  assert.match(captured, /## The current demo declaration/, 'the declaration to revise is framed');
  assert.match(captured, /"text": "Run the CLI on a sample\."/, "the project's declared steps are the current declaration");
  assert.match(captured, /`cli-capture` \(CLI before\/after, phase: capture\)/, 'the element library is listed');
  assert.doesNotMatch(captured, /Revise ONLY the steps bound to/, 'no element narrowing without a target');
});

test('per-element iteration: targetElement narrows the revision to that element\'s steps', async () => {
  const { project, projectRoot, logsRoot, sessionId, sessionDir } = setup({ phase: 'generating', targetElement: 'cli-capture' });
  const prompts: string[] = [];
  const result = await runDemoBuilderTurn({
    sessionId, project, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeWritingQueryFn((p) => { prompts.push(p); }), logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.equal(result.phase, 'awaiting-review');
  assert.match(prompts[1], /Revise ONLY the steps bound to element 'cli-capture'/);
  assert.equal(JSON.parse(readFileSync(join(sessionDir, 'generations', '1', 'meta.json'), 'utf8')).targetElement, 'cli-capture');
});

test('briefing turn is a no-op (the operator provides notes before the agent runs)', async () => {
  const { project, projectRoot, logsRoot, sessionId } = setup({ phase: 'briefing', mode: 'update' });
  const result = await runDemoBuilderTurn({ sessionId, project, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot });
  assert.equal(result.phase, 'briefing');
  assert.equal(result.wrote.length, 0);
});

test('update mode: the generate prompt carries an UPDATE framing over the locked declaration', async () => {
  const { project, projectRoot, logsRoot, sessionId } = setup({ phase: 'generating', mode: 'update' });
  // Bead 6.11.49: a generate turn now runs TWO agent passes, so a capture that
  // keeps the last prompt would silently start asserting against the grounding
  // pass. `captured` is the WRITE pass's prompt — the one these assertions have
  // always been about.
  const prompts: string[] = [];
  await runDemoBuilderTurn({
    sessionId, project, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeWritingQueryFn((p) => { prompts.push(p); }), logger: logger(logsRoot, sessionId), logsRoot,
  });
  const captured = prompts[1];
  assert.match(captured, /UPDATE MODE/, 'update framing present');
  assert.match(captured, /REVISE it per the operator's change-notes/, 'revises the locked declaration');
  assert.match(captured, /change-notes/i, 'frames the brief as change-notes');
});

test('awaiting-review turn is a no-op (bridge owns the wait state)', async () => {
  const { project, projectRoot, logsRoot, sessionId } = setup({ phase: 'awaiting-review' });
  const result = await runDemoBuilderTurn({ sessionId, project, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot });
  assert.equal(result.phase, 'awaiting-review');
  assert.equal(result.wrote.length, 0);
});

test('missing status.json throws a clear error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'demo-runner-'));
  await assert.rejects(
    runDemoBuilderTurn({ sessionId: 'nope', project: 'p', projectRoot: join(root, 'p'), forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn() }),
    /no status\.json/,
  );
});

test('SPEC §1: demoBuilderAgentSpec derives phase (demo), tier (sonnet), and write tools', () => {
  // W7-C3 review (A-M10): the frontmatter still declared the RETIRED `unifier`
  // phase while every event row said `demo` (sessions-kinds-26). SPEC §1 makes
  // the frontmatter the source of intent; the two must not contradict.
  assert.equal(demoBuilderAgentSpec.phase, 'demo');
  assert.equal(demoBuilderAgentSpec.tier, 'sonnet');
  assert.equal(DEMO_BUILDER_MODEL, 'claude-sonnet-4-6');
  assert.ok(demoBuilderAgentSpec.allowedTools.includes('Write'), 'demo-builder writes the machinery + HTML');
  assert.ok(demoBuilderAgentSpec.allowedTools.includes('Bash'), 'demo-builder runs the project for real output');
});
