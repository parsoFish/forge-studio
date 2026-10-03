/**
 * forge-8vfn.8.5.44 (row 208) — proves the forge-repo-git fence is a REAL
 * enforcement point on the interactive-session spawn sites too, not merely
 * `runAgent`'s (`packages/agents/tests/integration/run-agent-forge-repo-git-fence.test.ts`).
 * The ruling binds EVERY agent kind, and architect/demo-builder/instructions-
 * creator/completeness-critic/fix-turn all run unattended inside a story run
 * exactly like a `runAgent` spawn does — `bash-fence.ts`'s write-root fence
 * does not cover them (it only applies to a kind that opts into
 * `bashFence: inspect`).
 *
 * Drives the REAL `runArchitectTurn`/`runDemoBuilderTurn` entry points
 * (never `hooksSpreadForAgent` or the fence directly) with a capturing
 * `queryFn` — the exact idiom `interactive-runners-golden.test.ts` already
 * uses — then invokes the captured `options.hooks.PreToolUse` callback with
 * the 2026-10-03 incident's own seq 52 and seq 46 shapes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runArchitectTurn, type ArchitectStatus } from '../../kinds/architect.ts';
import { runDemoBuilderTurn, demoSessionDir } from '../../kinds/demo-builder.ts';
import { DEMO_DECLARATION_REL_PATH, DEMO_HTML_REL_PATH, type DemoBuilderStatus } from '../../kinds/demo-session-store.ts';
import { writeSessionStatus, type QueryFn } from '../../interactive-session.ts';
import { createLogger, FORGE_ROOT } from '@forge/kernel';

const SESSION_ID = '2026-01-01T00-00-00';
const ARCHITECT_SKILL_FIXTURE = ['You are the forge architect (fence-wiring fixture).', '', '<!-- turn: interview -->', 'FIXTURE interview turn.', '', '<!-- turn: explore -->', 'FIXTURE explore turn.', '', '<!-- turn: draft -->', 'FIXTURE draft turn.', '', '<!-- turn: draft-force-emit -->', 'FIXTURE force-emit turn.'].join('\n');
const DEMO_BUILDER_SKILL_FIXTURE = ['You are the forge demo-builder (fence-wiring fixture).', '', '<!-- turn: generate-declaration -->', 'FIXTURE generate turn.', '', '<!-- turn: ground-it -->', 'FIXTURE ground turn.'].join('\n');

function gitInit(dir: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe' });
}

type Captured = { prompt: string; options: Record<string, unknown> };

function soleFenceCallback(options: Record<string, unknown>): (input: unknown) => Promise<Record<string, unknown>> {
  const hooks = options['hooks'] as { PreToolUse?: Array<{ hooks: Array<(input: unknown) => Promise<Record<string, unknown>>> }> } | undefined;
  assert.ok(hooks, 'the fence must always be present — it is not an opt-in bound hook');
  return hooks.PreToolUse![0]!.hooks[0]!;
}

const SEQ_52 = (forge: string) =>
  `cd ${forge} && git update-ref refs/heads/main 8be024930 && git branch -d x && git log --oneline main -3`;
const SEQ_46 = 'git add file.txt && git commit -m "legit project commit"';

test('runArchitectTurn (interviewing): the fence it spawns with really denies seq 52 and allows seq 46', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fence-wiring-architect-'));
  try {
    const projectRoot = join(root, 'projects', 'project');
    const sessionDir = join(projectRoot, '_architect', SESSION_ID);
    mkdirSync(sessionDir, { recursive: true });
    gitInit(projectRoot); // the project's own repo — a DIFFERENT identity from FORGE_ROOT
    const skillPromptPath = join(root, 'architect-skill-fixture.md');
    writeFileSync(skillPromptPath, ARCHITECT_SKILL_FIXTURE);

    const status: ArchitectStatus = {
      session_id: SESSION_ID,
      project: 'testproj',
      project_repo_path: projectRoot,
      phase: 'interviewing',
      round: 1,
      idea: 'fence-wiring fixture idea',
      updated_at: new Date(0).toISOString(),
    };
    writeFileSync(join(sessionDir, 'status.json'), JSON.stringify(status));

    const logsRoot = join(root, '_logs');
    const logger = createLogger(`_architect-${SESSION_ID}`, logsRoot);
    let captured: Captured | null = null;
    const queryFn: QueryFn = ({ prompt, options }) => {
      captured = { prompt, options: options ?? {} };
      async function* gen(): AsyncGenerator<unknown> {
        yield {
          type: 'result',
          subtype: 'success',
          total_cost_usd: 0.01,
          structured_output: { done: false, questions: [{ question: 'Q?', header: 'H', options: [{ label: 'A', description: 'a' }] }] },
        };
      }
      return gen();
    };

    await runArchitectTurn({ sessionId: SESSION_ID, projectRoot, queryFn, logsRoot, logger, skillPromptPath, brainCwd: root });
    assert.ok(captured, 'queryFn must have been invoked');

    // architect-structured-turn.ts's `runStructured` always uses the REAL
    // `FORGE_ROOT` (model-tier resolution needs the real `studio/catalog.yaml`
    // — see that call site's own comment), so the denied command names THIS
    // checkout's real root; the fence only ever PARSES the string, never runs it.
    const fence = soleFenceCallback((captured as unknown as Captured).options);
    const denied = await fence({ tool_name: 'Bash', tool_input: { command: SEQ_52(FORGE_ROOT) } });
    assert.ok((denied as { hookSpecificOutput?: unknown }).hookSpecificOutput, 'seq 52 must be refused for a real architect spawn');

    const allowed = await fence({ tool_name: 'Bash', tool_input: { command: SEQ_46 } });
    assert.equal('hookSpecificOutput' in allowed, false, 'a commit inside the project\'s own repo must not be refused');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runDemoBuilderTurn (generating): the fence it spawns with really denies a cross-repo escape to its OWN scratch forgeRoot', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fence-wiring-demo-'));
  try {
    const projectRoot = join(root, 'project');
    const repoPath = join(root, 'repo');
    mkdirSync(join(repoPath, '.forge'), { recursive: true });
    gitInit(root); // the scratch forgeRoot passed below — its OWN identity
    gitInit(repoPath); // the project's repo — a DIFFERENT identity
    writeFileSync(
      join(repoPath, '.forge', 'project.json'),
      JSON.stringify({ testProcess: { local: { cmd: ['npm', 'test'] } }, demoProcess: [{ kind: 'capture', text: 'x' }, { kind: 'verify', text: 'y' }] }),
    );
    const sessionDir = demoSessionDir(projectRoot, SESSION_ID);
    mkdirSync(sessionDir, { recursive: true });
    const skillPromptPath = join(root, 'demo-builder-skill-fixture.md');
    writeFileSync(skillPromptPath, DEMO_BUILDER_SKILL_FIXTURE);

    const status: DemoBuilderStatus = {
      session_id: SESSION_ID,
      project: 'testproj',
      project_repo_path: repoPath,
      phase: 'generating',
      iteration: 1,
      prompt: 'fence-wiring fixture',
      updated_at: new Date(0).toISOString(),
    };
    writeSessionStatus(sessionDir, status);

    const logsRoot = join(root, '_logs');
    const logger = createLogger(`_demo-${SESSION_ID}`, logsRoot);
    const captures: Captured[] = [];
    const queryFn: QueryFn = ({ prompt, options }) => {
      captures.push({ prompt, options: options ?? {} });
      const cwd = (options?.cwd as string | undefined) ?? '.';
      async function* gen(): AsyncGenerator<unknown> {
        // Mirrors `interactive-runners-golden.test.ts`'s own demo-builder
        // fixture: the WRITE pass must actually produce the demo files on
        // disk, or `runGenerateStep` throws before this test ever reaches
        // the fence — this test is not about demo content, only about the
        // fence every one of these three passes spawns with.
        mkdirSync(join(cwd, '.forge', 'demo'), { recursive: true });
        writeFileSync(join(cwd, DEMO_DECLARATION_REL_PATH), JSON.stringify([{ kind: 'capture', text: 'x' }]));
        writeFileSync(join(cwd, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>fixture</body></html>');
        yield { type: 'result', total_cost_usd: 0.01 };
      }
      return gen();
    };

    await runDemoBuilderTurn({ sessionId: SESSION_ID, projectRoot, forgeRoot: root, queryFn, logsRoot, logger, skillPromptPath });
    assert.ok(captures.length > 0, 'queryFn must have been invoked at least once');

    // `forgeRoot: root` above is THIS scratch dir — unlike the architect test,
    // demo-builder threads a genuinely injectable forgeRoot all the way
    // through `kind-turn.ts`'s plumbing, so the denied command names it.
    const fence = soleFenceCallback(captures[0]!.options);
    const denied = await fence({ tool_name: 'Bash', tool_input: { command: SEQ_52(root) } });
    assert.ok((denied as { hookSpecificOutput?: unknown }).hookSpecificOutput, 'seq 52 against the scratch forgeRoot must be refused');

    const allowed = await fence({ tool_name: 'Bash', tool_input: { command: SEQ_46 } });
    assert.equal('hookSpecificOutput' in allowed, false, 'a commit inside the project\'s own repo must not be refused');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
