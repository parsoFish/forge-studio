/**
 * SEC-04 FINAL-CLOSURE PINS — the architect module's OWN raw-leaf-append helpers
 * that the earlier passes (2d5b1ab9 → cb3c44f3) did NOT route through the leaf
 * guard. The prior passes contained the architect session DIR (runner leg +
 * listArchitectSessions + plan-verdict) and the shared interactive-session
 * status pair, but architect's bespoke per-session-file helpers still raw-append
 * their leaf onto a bare `paths.sessionDir` builder result:
 *
 *   (1) writeQuestions  — `join(sessionDir, 'questions.json')` + writeFileSync.
 *       A symlinked `questions.json` LEAF inside a genuinely real, contained
 *       `_architect/<sid>` dir is followed by the write → the out-of-root file
 *       the symlink points at is CLOBBERED with the pending questions.
 *   (2) readInterview   — `join(sessionDir, 'answers.json')` + readFileSync.
 *       A symlinked `answers.json` LEAF discloses the out-of-root file's content
 *       INTO the interview prompt (priorQa) → an out-of-root read escape.
 *
 * And the contract sidecar leaf in loadProjectConfig (cli/contract-stages ->
 * orchestrator/project-config):
 *   (3) `.forge/quality_gate_cmd` sidecar — raw readFileSync. project.json's
 *       leaf was guarded by the contract-stages caller, but loadProjectConfig
 *       then raw-reads the sidecar; a symlinked sidecar folds OUT-OF-ROOT cmd
 *       tokens into `testProcess.local.cmd` when project.json omits `cmd`.
 *   (4) AGENT_INSTRUCTION_FILES (AGENTS.md / CLAUDE.md) — raw readFileSync; a
 *       symlinked AGENTS.md discloses an out-of-root file as the project's
 *       `instructions`.
 *
 * DISCIPLINE (mirrors the proven SEC-04 harness): real scratch fs; victims
 * planted OUTSIDE both projectsRoot AND forgeRoot; the escape is asserted by
 * EXECUTION only (the out-of-root victim's bytes, or the disclosed sentinel);
 * every `(RED)` FAILS on the pre-fix worktree and the positive controls pass
 * before AND after. Symlink-dependent vectors skip cleanly where the fs cannot
 * make one; the traversal vectors need no symlink.
 *
 * These are driven through the STABLE entry points (`runArchitectTurn`,
 * `loadProjectConfig`) — never the helper signatures, which the fix changes —
 * so the same test is RED then GREEN across the fix.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runArchitectTurn, type QueryFn } from './architect-runner.ts';
import { loadProjectConfig } from '@forge/projects/project-config.ts';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

let forgeRoot: string;
let projectsRoot: string;
let logsRoot: string;
const outsideDirs: string[] = [];
let symlinksUnavailable = false;

function newOutsideDir(prefix: string): string {
  const d = tmp(prefix);
  outsideDirs.push(d);
  return d;
}

function plantStatusJson(dir: string, status: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify({ updated_at: new Date().toISOString(), ...status }, null, 2),
  );
}

function skipIfNoSymlinks(t: { skip: (msg?: string) => void }): boolean {
  if (symlinksUnavailable) {
    t.skip('symlink creation unavailable in this environment');
    return true;
  }
  return false;
}

/** A queryFn that RECORDS every prompt it is handed and returns one interview
 *  question (done:false), keeping the turn on the interview→writeQuestions leg. */
function recordingInterviewQueryFn(prompts: string[]): QueryFn {
  return ({ prompt }: { prompt: string }) => {
    prompts.push(prompt);
    async function* gen(): AsyncGenerator<unknown> {
      yield {
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0,
        structured_output: {
          done: false,
          questions: [
            {
              question: 'Should the toggle follow the OS theme?',
              header: 'OS sync',
              options: [
                { label: 'Follow OS', description: 'Match the system theme.' },
                { label: 'Manual', description: 'Operator toggles it.' },
              ],
            },
          ],
        },
      };
    }
    return gen() as unknown as AsyncIterable<unknown>;
  };
}

before(() => {
  forgeRoot = tmp('sec04-arch-leaf-forge-');
  projectsRoot = join(forgeRoot, 'projects');
  logsRoot = join(forgeRoot, '_logs');
  mkdirSync(projectsRoot, { recursive: true });
  mkdirSync(logsRoot, { recursive: true });
  mkdirSync(join(projectsRoot, 'legit', '_architect'), { recursive: true });

  const probe = tmp('sec04-arch-leaf-probe-');
  try {
    symlinkSync(probe, join(projectsRoot, '__symlink_probe__'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }
  rmSync(join(projectsRoot, '__symlink_probe__'), { force: true });
  rmSync(probe, { recursive: true, force: true });
});

after(() => {
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  for (const d of outsideDirs) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Positive control — a legit in-root interviewing session writes questions.json
// as a REAL file and returns awaiting-answers (proves the harness drives the
// interview→writeQuestions leg, so the RED failures below are the ESCAPE).
// ---------------------------------------------------------------------------

test('positive control: a legit in-root interviewing turn writes a REAL questions.json and returns awaiting-answers', async () => {
  const sid = 'leaf-legit-ctrl';
  const sessionDir = join(projectsRoot, 'legit', '_architect', sid);
  plantStatusJson(sessionDir, {
    session_id: sid,
    project: 'legit',
    project_repo_path: join(projectsRoot, 'legit'),
    phase: 'interviewing',
    round: 1,
    idea: 'Add a dark-mode toggle.',
  });
  const prompts: string[] = [];
  const r = await runArchitectTurn({
    sessionId: sid,
    projectRoot: join(projectsRoot, 'legit'),
    logsRoot,
    brainCwd: forgeRoot,
    queryFn: recordingInterviewQueryFn(prompts),
  });
  assert.equal(r.phase, 'awaiting-answers');
  const written = JSON.parse(readFileSync(join(sessionDir, 'questions.json'), 'utf8'));
  assert.equal(written[0].header, 'OS sync');
});

// ===========================================================================
// (1) writeQuestions LEAF — symlinked questions.json inside a REAL contained
//     session dir. The write must NOT be followed through the symlink.
// ===========================================================================

test('(RED) runArchitectTurn must NOT write questions.json through a symlinked leaf to an out-of-root file', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-arch-leaf-wq-outside-');
  const victim = join(outside, 'victim-questions.json');
  const SENTINEL = 'OUT-OF-ROOT-QUESTIONS-VICTIM-do-not-clobber';
  writeFileSync(victim, SENTINEL);

  const sid = 'leaf-writequestions';
  const sessionDir = join(projectsRoot, 'legit', '_architect', sid);
  plantStatusJson(sessionDir, {
    session_id: sid,
    project: 'legit',
    project_repo_path: join(projectsRoot, 'legit'),
    phase: 'interviewing',
    round: 1,
    idea: 'Add a dark-mode toggle.',
  });
  // The LEAF is a symlink out of root; the containing session dir is genuinely real.
  symlinkSync(victim, join(sessionDir, 'questions.json'), 'file');

  try {
    await runArchitectTurn({
      sessionId: sid,
      projectRoot: join(projectsRoot, 'legit'),
      logsRoot,
      brainCwd: forgeRoot,
      queryFn: recordingInterviewQueryFn([]),
    });
  } catch {
    /* fail-closed refusal is the intended post-fix behaviour */
  }

  assert.equal(
    readFileSync(victim, 'utf8'),
    SENTINEL,
    'writeQuestions followed a symlinked questions.json LEAF and CLOBBERED an out-of-root file with the pending questions',
  );
});

// ===========================================================================
// (2) readInterview LEAF — symlinked answers.json inside a REAL contained
//     session dir must NOT disclose the out-of-root file into the prompt.
// ===========================================================================

test('(RED) runArchitectTurn must NOT read answers.json through a symlinked leaf and disclose out-of-root content into the interview prompt', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-arch-leaf-ri-outside-');
  const victim = join(outside, 'victim-answers.json');
  const SENTINEL = 'OUT-OF-ROOT-ANSWER-SENTINEL-9c1f';
  writeFileSync(
    victim,
    JSON.stringify([{ round: 1, answers: [{ question: 'q', answer: SENTINEL }] }]),
  );

  const sid = 'leaf-readinterview';
  const sessionDir = join(projectsRoot, 'legit', '_architect', sid);
  plantStatusJson(sessionDir, {
    session_id: sid,
    project: 'legit',
    project_repo_path: join(projectsRoot, 'legit'),
    phase: 'interviewing',
    round: 2,
    idea: 'Add a dark-mode toggle.',
  });
  symlinkSync(victim, join(sessionDir, 'answers.json'), 'file');

  const prompts: string[] = [];
  try {
    await runArchitectTurn({
      sessionId: sid,
      projectRoot: join(projectsRoot, 'legit'),
      logsRoot,
      brainCwd: forgeRoot,
      queryFn: recordingInterviewQueryFn(prompts),
    });
  } catch {
    /* a refusal is acceptable; the assertion is on disclosure */
  }

  assert.ok(
    !prompts.some((p) => p.includes(SENTINEL)),
    'readInterview followed a symlinked answers.json LEAF and disclosed the out-of-root file content into the interview prompt',
  );
});

// ===========================================================================
// (3) sidecar LEAF — a symlinked `.forge/quality_gate_cmd` must not fold
//     out-of-root cmd tokens into testProcess.local.cmd when project.json
//     omits `cmd`.
// ===========================================================================

test('(RED) loadProjectConfig must NOT fold an out-of-root symlinked quality_gate_cmd sidecar into the contract', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-sidecar-outside-');
  const EVIL = 'EVIL-OUT-OF-ROOT-GATE-CMD';
  const outsideSidecar = join(outside, 'evil_gate_cmd');
  writeFileSync(outsideSidecar, `${EVIL} --run-attacker-suite`);

  const projectDir = join(projectsRoot, 'legit');
  mkdirSync(join(projectDir, '.forge'), { recursive: true });
  // project.json declares testProcess.local WITHOUT cmd — the sidecar is the
  // only source of the gate command.
  writeFileSync(
    join(projectDir, '.forge', 'project.json'),
    JSON.stringify({ testProcess: { local: {} } }),
  );
  symlinkSync(outsideSidecar, join(projectDir, '.forge', 'quality_gate_cmd'), 'file');

  let cmd: string[] | null = null;
  let threw = false;
  try {
    cmd = loadProjectConfig(projectDir)?.quality_gate_cmd ?? null;
  } catch {
    threw = true; // fail-closed: no cmd source once the symlinked sidecar is refused
  } finally {
    rmSync(join(projectDir, '.forge'), { recursive: true, force: true });
  }

  assert.ok(
    threw || !(cmd ?? []).some((tok) => tok.includes(EVIL)),
    'a symlinked quality_gate_cmd sidecar folded out-of-root cmd tokens into testProcess.local.cmd',
  );
});

// ===========================================================================
// (4) AGENTS.md LEAF — a symlinked instruction file must not disclose an
//     out-of-root file as the project's `instructions`.
// ===========================================================================

test('(RED) loadProjectConfig must NOT disclose an out-of-root symlinked AGENTS.md as the project instructions', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-agents-outside-');
  const SENTINEL = 'EVIL-OUT-OF-ROOT-AGENTS-INSTRUCTIONS-7b2e';
  const outsideAgents = join(outside, 'evil_agents.md');
  writeFileSync(outsideAgents, SENTINEL);

  const projectDir = join(projectsRoot, 'legit');
  mkdirSync(join(projectDir, '.forge'), { recursive: true });
  // A well-formed project.json (WITH a cmd) so loading does not fail-closed for
  // an unrelated reason — the only variable under test is the AGENTS.md leaf.
  writeFileSync(
    join(projectDir, '.forge', 'project.json'),
    JSON.stringify({ testProcess: { local: { cmd: ['npm', 'test'] } } }),
  );
  symlinkSync(outsideAgents, join(projectDir, 'AGENTS.md'), 'file');

  let instructions: string | undefined;
  try {
    instructions = loadProjectConfig(projectDir)?.instructions;
  } finally {
    rmSync(join(projectDir, '.forge'), { recursive: true, force: true });
    rmSync(join(projectDir, 'AGENTS.md'), { force: true });
  }

  assert.ok(
    !(instructions ?? '').includes(SENTINEL),
    'a symlinked AGENTS.md disclosed an out-of-root file as the project instructions',
  );
});
