/**
 * SEC-04 — LEAF-TAIL containment pin (the last raw-append leaves the gap-closure
 * appliers flagged after the status.json siblings were routed through the guard).
 *
 * Two independent real vectors, each RED on the pre-fix tree, GREEN after:
 *
 *   V1  interactive-session.ts `writeQuestions` / `readAnswerRounds`
 *       (via the STABLE `runInstructionsTurn` boundary — the sole shared caller).
 *       Both raw-appended `questions.json` / `answers.json` onto the ALREADY-
 *       contained session-dir realPath, so a symlinked leaf inside the genuinely-
 *       real session dir escaped:
 *         V1a — a symlinked `questions.json` let the interview WRITE its pending
 *               questions THROUGH the symlink to an out-of-root file.
 *         V1b — a symlinked `answers.json` let the interview READ an out-of-root
 *               file and fold its content into the replayed interview prompt (an
 *               out-of-root DISCLOSURE, observed on the captured `queryFn` prompt).
 *
 *   V3  contract-stages.ts — `loadProjectConfig(projectDir)` raw-reads
 *       `<projectDir>/.forge/project.json` (`join` + `readFileSync`, no per-leaf
 *       realpath). `projectDir` is realpath-contained, but a symlinked
 *       `.forge/project.json` leaf inside it resolved OUT of root and the outside
 *       file's `testProcess.local.cmd` leaked into the `contract` stage row's
 *       `gate command:` detail. (The sibling `safeReadFileInSession`-backed rows —
 *       instructions/demo/roadmap — realpath-contain their leaf and are NOT
 *       affected; a positive control below proves a REAL project.json still loads,
 *       so the fix does not over-reject and AT-28 stays intact.)
 *
 * All three RED assertions observe the FILESYSTEM / the captured prompt / the
 * row detail directly, never an exit code — a "wrote it and carried on" cannot
 * masquerade as "refused".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  lstatSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runInstructionsTurn, instructionsSessionDir, type InstructionsStatus } from '../../kinds/instructions.ts';
import { writeSessionStatus, type QueryFn } from '../../interactive-session.ts';
import { createLogger } from '@forge/kernel';
import { deriveContractStages } from '@forge/projects/contract-stages.ts';

// Belt-and-braces: no interactive turn in this pin should ever reach a live SDK.
process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
process.env.FORGE_DRY_BRIDGE = '1';

const SECRET = 'SEC04-LEAF-TAIL-OUT-OF-ROOT-SECRET';

/** A `queryFn` that records every prompt it is handed and returns a fixed
 *  structured result for the interview step (so the turn is fully offline). */
function recordingInterviewQuery(promptSink: string[], interview: unknown): QueryFn {
  return ({ prompt }) => {
    promptSink.push(prompt);
    let structured: unknown = null;
    if (prompt.includes('the interview step')) structured = interview;
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0, structured_output: structured };
    }
    return gen();
  };
}

function seedInstructionsSession(overrides?: Partial<InstructionsStatus>): {
  base: string;
  projectRoot: string;
  logsRoot: string;
  sessionId: string;
  sessionDir: string;
  repoPath: string;
} {
  const base = mkdtempSync(join(tmpdir(), 'sec04-leaf-tail-'));
  const projectRoot = join(base, 'projects', 'proj');
  const repoPath = join(base, 'repo');
  const logsRoot = join(base, '_logs');
  const sessionId = '2026-08-09T00-00-00';
  const sessionDir = instructionsSessionDir(projectRoot, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(repoPath, { recursive: true });
  writeSessionStatus(sessionDir, {
    session_id: sessionId,
    project: 'proj',
    project_repo_path: repoPath,
    phase: 'interviewing',
    round: 1,
    prompt: 'Author AGENTS.md.',
    updated_at: new Date().toISOString(),
    ...overrides,
  } as InstructionsStatus);
  return { base, projectRoot, logsRoot, sessionId, sessionDir, repoPath };
}

const logger = (logsRoot: string, sid: string) => createLogger(`_instructions-${sid}`, logsRoot);

test('V1a: a symlinked questions.json leaf cannot be WRITTEN through (no out-of-root write)', async () => {
  const s = seedInstructionsSession();
  try {
    // Plant the escape: questions.json inside the (real, contained) session dir
    // is a symlink to an out-of-root file holding a known sentinel.
    const outside = join(s.base, 'OUTSIDE-questions.json');
    writeFileSync(outside, SECRET);
    symlinkSync(outside, join(s.sessionDir, 'questions.json'));

    // --- preconditions (false-negative discipline)
    assert.ok(
      lstatSync(join(s.sessionDir, 'questions.json')).isSymbolicLink(),
      'fixture: questions.json must be the planted symlink',
    );
    assert.equal(readFileSync(outside, 'utf8'), SECRET, 'fixture: out-of-root target holds the sentinel');

    // interview asks a question ⇒ the runner reaches writeQuestions.
    const queryFn = recordingInterviewQuery([], {
      done: false,
      questions: [{ question: 'Off-limits?', header: 'Off', options: [] }],
    });

    let threw = false;
    try {
      await runInstructionsTurn({ sessionId: s.sessionId, projectRoot: s.projectRoot, logsRoot: s.logsRoot, queryFn, logger: logger(s.logsRoot, s.sessionId) });
    } catch {
      threw = true;
    }

    // --- containment: the out-of-root file must NOT have been overwritten with
    //     the pending questions. RED pre-fix (raw writeFileSync followed the
    //     symlink and clobbered it); GREEN post-fix (guardedFile ⇒ null ⇒ refuse).
    assert.equal(
      readFileSync(outside, 'utf8'),
      SECRET,
      'containment breach: writeQuestions wrote pending questions THROUGH the symlinked leaf to an out-of-root file',
    );
    assert.ok(threw, 'containment: the runner must refuse the escaping questions.json leaf and throw');
  } finally {
    rmSync(s.base, { recursive: true, force: true });
  }
});

test('V1b: a symlinked answers.json leaf cannot be READ (no out-of-root disclosure into the prompt)', async () => {
  const s = seedInstructionsSession();
  try {
    // Plant the escape: answers.json is a symlink to an out-of-root file holding
    // a prior-round answer with the sentinel as its text.
    const outside = join(s.base, 'OUTSIDE-answers.json');
    writeFileSync(
      outside,
      JSON.stringify([{ round: 1, answers: [{ question: 'What secret?', answer: SECRET }] }]),
    );
    symlinkSync(outside, join(s.sessionDir, 'answers.json'));
    assert.ok(
      lstatSync(join(s.sessionDir, 'answers.json')).isSymbolicLink(),
      'fixture: answers.json must be the planted symlink',
    );

    // Interview asks a question so the turn stops at awaiting-answers AFTER
    // reading answers.json into the interview prompt (questions.json here is a
    // normal file, so writeQuestions succeeds and the turn returns cleanly).
    const prompts: string[] = [];
    const queryFn = recordingInterviewQuery(prompts, {
      done: false,
      questions: [{ question: 'Next?', header: 'Next', options: [] }],
    });

    await runInstructionsTurn({ sessionId: s.sessionId, projectRoot: s.projectRoot, logsRoot: s.logsRoot, queryFn, logger: logger(s.logsRoot, s.sessionId) });

    // --- containment: the out-of-root answer text must NOT appear in any prompt
    //     the runner built. RED pre-fix (readAnswerRounds read the symlinked file
    //     and replayed the answer into priorQa); GREEN post-fix ([] ⇒ absent).
    const leaked = prompts.find((p) => p.includes(SECRET));
    assert.equal(
      leaked,
      undefined,
      'containment breach: readAnswerRounds leaked out-of-root answers.json content into the interview prompt',
    );
    // sanity: the interview step DID run (so the assertion above is meaningful).
    assert.ok(prompts.some((p) => p.includes('the interview step')), 'the interview step must have run');
  } finally {
    rmSync(s.base, { recursive: true, force: true });
  }
});

test('V3: a symlinked .forge/project.json leaf cannot leak an out-of-root gate command into the contract row', () => {
  const base = mkdtempSync(join(tmpdir(), 'sec04-leaf-tail-cs-'));
  try {
    const projectsRoot = join(base, 'projects');
    const projectDir = join(projectsRoot, 'victimproj');
    mkdirSync(join(projectDir, '.forge'), { recursive: true });
    // Plant the escape: .forge/project.json is a symlink to an out-of-root config
    // whose gate command is the sentinel.
    const outsideCfg = join(base, 'OUTSIDE-project.json');
    writeFileSync(outsideCfg, JSON.stringify({ testProcess: { local: { cmd: [SECRET] } } }));
    symlinkSync(outsideCfg, join(projectDir, '.forge', 'project.json'));

    // --- preconditions
    assert.ok(
      lstatSync(join(projectDir, '.forge', 'project.json')).isSymbolicLink(),
      'fixture: .forge/project.json must be the planted symlink',
    );

    const res = deriveContractStages({ forgeRoot: base, projectsRoot, projectId: 'victimproj' });

    // --- containment: the outside gate command must NOT surface anywhere.
    //     RED pre-fix (loadProjectConfig raw-read the symlink and the contract
    //     row carried `gate command: <SECRET>`); GREEN post-fix (guarded leaf ⇒
    //     null ⇒ config absent ⇒ contract row 'absent', no detail).
    const flat = JSON.stringify(res);
    assert.ok(!flat.includes(SECRET), `containment breach: out-of-root gate command leaked into contract-stages: ${flat.slice(0, 400)}`);
    if (res.ok) {
      const contractRow = res.rows.find((r) => r.stage === 'contract');
      assert.equal(contractRow?.status, 'absent', 'a symlinked-out config must read as absent, never present');
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('V3 positive control: a REAL contained .forge/project.json still loads (fix does not over-reject; AT-28 intact)', () => {
  const base = mkdtempSync(join(tmpdir(), 'sec04-leaf-tail-cs-ok-'));
  try {
    const projectsRoot = join(base, 'projects');
    const projectDir = join(projectsRoot, 'realproj');
    mkdirSync(join(projectDir, '.forge'), { recursive: true });
    const realCmd = 'npm-test-real-gate';
    writeFileSync(
      join(projectDir, '.forge', 'project.json'),
      JSON.stringify({ testProcess: { local: { cmd: [realCmd] } } }),
    );

    const res = deriveContractStages({ forgeRoot: base, projectsRoot, projectId: 'realproj' });
    assert.ok(res.ok, 'a real contained project.json must derive cleanly');
    if (res.ok) {
      const contractRow = res.rows.find((r) => r.stage === 'contract');
      assert.equal(contractRow?.status, 'present', 'a real contained config must read as present');
      assert.ok(
        contractRow?.detail.some((d) => d.includes(realCmd)),
        'the real (in-root) gate command must still surface — the leaf guard must not block a genuine config',
      );
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
