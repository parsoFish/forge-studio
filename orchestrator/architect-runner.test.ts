/**
 * Tests for the in-UI architect runner (ADR 020).
 *
 * The runner is a bounded, file-checkpointed turn driven by an injectable
 * `queryFn` seam (the `runCouncil` pattern) — so the full state machine is
 * exercised here without a live LLM. Each test uses a fresh tempdir; nothing
 * escapes into the real `_queue/` or `_logs/`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runArchitectTurn,
  writeStatus,
  readStatus,
  listArchitectSessions,
  readArchitectSessionStats,
  architectAgentSpec,
  ARCHITECT_MODEL,
  type ArchitectStatus,
  type QueryFn,
} from './architect-runner.ts';
import { createLogger } from './logging.ts';
import { parseManifest } from './manifest.ts';

// ---------------------------------------------------------------------------
// Fakes — async generators yielding SDK-shaped `result` messages.
// ---------------------------------------------------------------------------

function* nothing(): Generator<never> {}

/** A queryFn whose structured output is chosen by the prompt content. */
function makeQueryFn(spec: {
  interview?: unknown;
  draft?: unknown;
}): QueryFn {
  return ({ prompt }) => {
    let structured: unknown = null;
    if (prompt.includes('the interview step')) structured = spec.interview;
    else if (prompt.includes('draft the initiative')) structured = spec.draft;
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', subtype: 'success', total_cost_usd: 0, structured_output: structured };
    }
    return structured === null ? (nothing() as unknown as AsyncIterable<unknown>) : gen();
  };
}

function setupSession(overrides?: Partial<ArchitectStatus>): {
  projectRoot: string;
  logsRoot: string;
  queueRoot: string;
  sessionId: string;
  sessionDir: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'arch-runner-'));
  const projectRoot = join(root, 'project');
  const logsRoot = join(root, '_logs');
  const queueRoot = join(root, '_queue');
  const sessionId = '2026-05-29T10-00-00';
  const sessionDir = join(projectRoot, '_architect', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const status: ArchitectStatus = {
    session_id: sessionId,
    project: 'demo',
    project_repo_path: projectRoot,
    phase: 'interviewing',
    round: 1,
    idea: 'Add a dark-mode toggle to the settings page.',
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  writeStatus(sessionDir, status);
  return { projectRoot, logsRoot, queueRoot, sessionId, sessionDir };
}

function logger(logsRoot: string, sessionId: string) {
  return createLogger(`_architect-${sessionId}`, logsRoot);
}

// ---------------------------------------------------------------------------
// Interview phase
// ---------------------------------------------------------------------------

test('interviewing → needs answers: writes questions.json + status awaiting-answers', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId, sessionDir } = setupSession();
  const queryFn = makeQueryFn({
    interview: {
      done: false,
      questions: [
        {
          question: 'Should dark mode follow the OS setting?',
          header: 'OS sync',
          options: [
            { label: 'Follow OS', description: 'Match the system theme automatically.' },
            { label: 'Manual only', description: 'Operator toggles it explicitly.' },
          ],
        },
      ],
    },
  });

  const result = await runArchitectTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queueRoot,
    queryFn,
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(result.phase, 'awaiting-answers');
  assert.equal(result.questions?.length, 1);
  const questionsPath = join(sessionDir, 'questions.json');
  assert.ok(existsSync(questionsPath));
  const written = JSON.parse(readFileSync(questionsPath, 'utf8'));
  assert.equal(written[0].header, 'OS sync');
  assert.equal(readStatus(sessionDir)?.phase, 'awaiting-answers');
});

test('interviewing → done flows straight through to drafting → awaiting-verdict + PLAN', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId, sessionDir } = setupSession();
  // Operator already answered a round.
  writeFileSync(
    join(sessionDir, 'answers.json'),
    JSON.stringify([
      { round: 1, answers: [{ question: 'Follow OS?', answer: 'Follow OS' }] },
    ]),
  );
  const queryFn = makeQueryFn({
    interview: { done: true },
    draft: {
      vision: 'Operator wants a dark-mode toggle that follows the OS by default.',
      initiatives: [
        {
          slug: 'dark-mode-toggle',
          title: 'Dark mode toggle',
          iteration_budget: 4,
          cost_budget_usd: 6,
          body: '## Dark mode\n\nGiven settings exist, when toggled, then theme persists.\n\nGiven OS dark mode is active, when app loads, then dark theme is applied.',
        },
      ],
    },
  });

  const result = await runArchitectTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queueRoot,
    queryFn,
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(result.phase, 'awaiting-verdict');
  assert.ok(result.planPath && existsSync(result.planPath));
  assert.ok(existsSync(join(sessionDir, 'PLAN.html')));
  // Draft manifest written (not yet promoted).
  const manifestsDir = join(sessionDir, 'manifests');
  const drafts = readdirSync(manifestsDir).filter((f) => f.endsWith('.md'));
  assert.equal(drafts.length, 1);
  assert.match(drafts[0], /^INIT-\d{4}-\d{2}-\d{2}-dark-mode-toggle\.md$/);
  // No escalations.json written (council removed).
  assert.ok(!existsSync(join(sessionDir, 'escalations.json')));
  // Nothing in the queue yet.
  assert.ok(!existsSync(join(queueRoot, 'pending')));
  assert.equal(readStatus(sessionDir)?.phase, 'awaiting-verdict');
});

test('F-W5-1: structured interview/draft steps must NOT run the SDK in plan mode', async () => {
  // Regression for F-W5-1 (2026-05-30, surfaced by the claude-harness UI
  // validation run): `permissionMode: 'plan'` made the real draft agent end its
  // turn by calling `ExitPlanMode` (presenting a prose plan) instead of emitting
  // the `outputFormat` structured result, so `structured_output` came back empty
  // and `runDraftStep` threw "draft step returned no initiatives". Read-only must
  // be enforced by the allowedTools whitelist alone, never plan mode.
  const { projectRoot, logsRoot, queueRoot, sessionId, sessionDir } = setupSession();
  writeFileSync(
    join(sessionDir, 'answers.json'),
    JSON.stringify([{ round: 1, answers: [{ question: 'Follow OS?', answer: 'Follow OS' }] }]),
  );
  const capturedOptions: Array<Record<string, unknown>> = [];
  const queryFn: QueryFn = ({ prompt, options }) => {
    capturedOptions.push((options ?? {}) as Record<string, unknown>);
    let structured: unknown = null;
    if (prompt.includes('the interview step')) structured = { done: true };
    else if (prompt.includes('draft the initiative')) {
      structured = {
        vision: 'A one-glance compact view of a cycle trail.',
        initiatives: [
          {
            slug: 'compact-flag',
            title: 'Compact flag',
            iteration_budget: 3,
            cost_budget_usd: 2,
            body: '## Compact\n\nGiven a cycle trail exists, when --compact flag is used, then only title+summary+verdict are shown.',
          },
        ],
      };
    }
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', subtype: 'success', total_cost_usd: 0, structured_output: structured };
    }
    return gen();
  };
  const result = await runArchitectTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queueRoot,
    queryFn,
    logger: logger(logsRoot, sessionId),
  });

  // The turn must reach a PLAN — proving the structured draft was consumed.
  assert.equal(result.phase, 'awaiting-verdict');
  // Both structured steps (interview + draft) flow through runStructured and
  // carry `outputFormat`; none may run in plan mode.
  const structuredCalls = capturedOptions.filter((o) => 'outputFormat' in o);
  assert.ok(structuredCalls.length >= 1, 'expected runStructured to pass outputFormat options');
  for (const o of structuredCalls) {
    // Cause 2: plan mode makes the agent ExitPlanMode instead of emitting output.
    assert.notEqual(o.permissionMode, 'plan', 'structured step must not run in plan mode (F-W5-1)');
    // Cause 1: the SDK's outputFormat must be wrapped as { type:'json_schema', schema } —
    // passing the bare schema silently disables structured output.
    const of = o.outputFormat as { type?: string; schema?: unknown } | undefined;
    assert.equal(of?.type, 'json_schema', 'outputFormat must be { type: "json_schema", schema } (F-W5-1)');
    assert.ok(of?.schema && typeof of.schema === 'object', 'outputFormat.schema must carry the JSON schema (F-W5-1)');
  }
});

// ---------------------------------------------------------------------------
// Finalize phase
// ---------------------------------------------------------------------------

test('finalizing: bakes resolved decisions + promotes manifest to _queue/pending', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId, sessionDir } = setupSession({
    phase: 'finalizing',
  });
  // Seed feedback.md directly (the bridge writes it on approve).
  writeFileSync(
    join(sessionDir, 'feedback.md'),
    '## Resolved design decisions\n\n- Default theme: Follow OS\n',
  );

  let draftPrompt = '';
  const queryFn: QueryFn = ({ prompt, options }) => {
    if (prompt.includes('draft the initiative')) draftPrompt = prompt;
    async function* gen(): AsyncGenerator<unknown> {
      const structured = prompt.includes('draft the initiative')
        ? {
            vision: 'Dark mode that follows the OS.',
            initiatives: [
              {
                slug: 'dark-mode-toggle',
                title: 'Dark mode toggle',
                iteration_budget: 4,
                cost_budget_usd: 6,
                body: '## Dark mode\n\nGiven settings exist, when toggled, then theme persists.',
              },
            ],
          }
        : null;
      yield { type: 'result', total_cost_usd: 0, structured_output: structured };
    }
    void options;
    return gen();
  };

  const result = await runArchitectTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queueRoot,
    queryFn,
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(result.phase, 'committed');
  assert.equal(result.promotedManifestPaths?.length, 1);
  // The resolved decision was fed into the draft prompt.
  assert.match(draftPrompt, /Resolved design decisions/);
  assert.match(draftPrompt, /Follow OS/);
  // Manifest landed in the queue and is valid.
  const pending = join(queueRoot, 'pending');
  const queued = readdirSync(pending).filter((f) => f.endsWith('.md'));
  assert.equal(queued.length, 1);
  const m = parseManifest(readFileSync(join(pending, queued[0]), 'utf8'));
  assert.equal(m.project, 'demo');
  assert.equal(m.origin, 'architect');
  assert.equal(readStatus(sessionDir)?.phase, 'committed');
});

test('draft: empty initiatives triggers a forced-emit retry that succeeds → awaiting-verdict', async () => {
  // Regression (2026-06-08): a research-heavy idea burned the turn budget and the
  // draft returned ZERO initiatives, throwing a fatal error that left the session
  // stuck in `drafting`. The runner now re-issues one forced-emit turn.
  const { projectRoot, logsRoot, queueRoot, sessionId, sessionDir } = setupSession({ phase: 'drafting' });
  let drafts = 0;
  let sawEmitNow = false;
  const queryFn: QueryFn = ({ prompt }) => {
    const isDraft = prompt.includes('draft the initiative');
    const isRetry = prompt.includes('EMIT NOW');
    if (isDraft) drafts += 1;
    if (isRetry) sawEmitNow = true;
    async function* gen(): AsyncGenerator<unknown> {
      const structured = !isDraft
        ? null
        : isRetry
          ? {
              vision: 'Dark mode that follows the OS.',
              initiatives: [
                { slug: 'dark-mode-toggle', title: 'Dark mode toggle', iteration_budget: 4, cost_budget_usd: 6,
                  body: '## Dark mode\n\nGiven settings, when toggled, then theme persists.' },
              ],
            }
          : { vision: 'Dark mode that follows the OS.', initiatives: [] }; // first call: empty → must retry
      yield { type: 'result', subtype: 'success', total_cost_usd: 0, structured_output: structured };
    }
    return gen();
  };

  const result = await runArchitectTurn({ sessionId, projectRoot, logsRoot, queueRoot, queryFn, logger: logger(logsRoot, sessionId) });

  assert.equal(result.phase, 'awaiting-verdict');
  assert.equal(drafts, 2, 'the draft ran twice: initial (empty) + forced-emit retry');
  assert.ok(sawEmitNow, 'the retry used the forced-emit prompt (no further research)');
  assert.equal(readStatus(sessionDir)?.phase, 'awaiting-verdict');
});

test('draft: still-empty after the forced-emit retry throws a clear, recoverable error', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId } = setupSession({ phase: 'drafting' });
  let drafts = 0;
  const queryFn: QueryFn = ({ prompt }) => {
    if (prompt.includes('draft the initiative')) drafts += 1;
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', subtype: 'success', total_cost_usd: 0, structured_output: { vision: 'x', initiatives: [] } };
    }
    return gen();
  };

  await assert.rejects(
    () => runArchitectTurn({ sessionId, projectRoot, logsRoot, queueRoot, queryFn, logger: logger(logsRoot, sessionId) }),
    /no initiatives after a forced-emit retry/,
  );
  assert.equal(drafts, 2, 'it tried the initial draft + one forced-emit retry before giving up');
});

test('drafting: architect emits cross-initiative build order → manifest depends_on_initiatives', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId, sessionDir } = setupSession({
    phase: 'finalizing',
  });
  // Seed feedback.md so finalize reads resolved decisions.
  writeFileSync(join(sessionDir, 'feedback.md'), '## Resolved design decisions\n\n- none\n');

  const queryFn: QueryFn = ({ prompt }) => {
    async function* gen(): AsyncGenerator<unknown> {
      const structured = prompt.includes('draft the initiative')
        ? {
            vision: 'Green CI first, then the feature.',
            initiatives: [
              {
                slug: 'ci-green',
                title: 'Green the CI',
                iteration_budget: 3,
                cost_budget_usd: 4,
                body: '## CI\n\nGiven red CI exists, when lint and fmt are fixed, then all checks pass.',
              },
              {
                slug: 'release-folder',
                title: 'release_folder resource',
                iteration_budget: 5,
                cost_budget_usd: 8,
                // valid dep + a self-ref + an unknown ref — last two must drop.
                depends_on: ['ci-green', 'release-folder', 'does-not-exist'],
                body: '## release_folder\n\nGiven green CI exists, when release_folder resource is added, then CRUD operations work.',
              },
            ],
          }
        : null;
      yield { type: 'result', total_cost_usd: 0, structured_output: structured };
    }
    return gen();
  };

  await runArchitectTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queueRoot,
    queryFn,
    logger: logger(logsRoot, sessionId),
  });

  const pending = join(queueRoot, 'pending');
  const byId = Object.fromEntries(
    readdirSync(pending)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        const m = parseManifest(readFileSync(join(pending, f), 'utf8'));
        return [m.initiative_id, m];
      }),
  );
  const ids = Object.keys(byId);
  const ci = ids.find((id) => id.endsWith('-ci-green'))!;
  const folder = ids.find((id) => id.endsWith('-release-folder'))!;
  assert.ok(ci && folder, 'both initiatives promoted');
  // The dependent carries the prerequisite's full id; self + unknown refs dropped.
  assert.deepEqual(byId[folder].depends_on_initiatives, [ci]);
  // The independent prerequisite carries no dependency.
  assert.equal(byId[ci].depends_on_initiatives, undefined);
});

test('finalize is DETERMINISTIC: promotes the approved draft + appends decisions, no 2nd LLM draft', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId, sessionDir } = setupSession({
    phase: 'finalizing',
  });
  // Pre-seed the approved draft manifest (as the awaiting-verdict draft would
  // have written) so finalize takes the deterministic branch.
  const manifestsDir = join(sessionDir, 'manifests');
  mkdirSync(manifestsDir, { recursive: true });
  const seeded = [
    '---',
    'initiative_id: INIT-2026-05-29-seeded',
    'project: demo',
    `project_repo_path: ${projectRoot}`,
    "created_at: '2026-05-29T10:00:00.000Z'",
    'iteration_budget: 4',
    'cost_budget_usd: 6',
    'phase: pending',
    'origin: architect',
    '---',
    '',
    '## Seeded body',
    '',
    'Given x exists, when y is done, then z is observable.',
  ].join('\n');
  writeFileSync(join(manifestsDir, 'INIT-2026-05-29-seeded.md'), seeded);
  // Seed feedback.md (operator rationale written by the bridge on approve).
  writeFileSync(join(sessionDir, 'feedback.md'), '## Resolved design decisions\n\n- Default theme: Follow OS\n');
  // A queryFn that FAILS the test if any DRAFT turn is attempted. The
  // completeness critic (a distinct, intentionally-gated call) is expected to
  // run exactly once — it returns null structured_output here (a clean pass,
  // zero findings) so finalize still proceeds to promote deterministically.
  let sdkCalls = 0;
  let draftCalls = 0;
  const queryFn: QueryFn = ({ prompt }) => {
    sdkCalls += 1;
    if (prompt.includes('draft the initiative')) draftCalls += 1;
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0, structured_output: null };
    }
    return gen();
  };

  const result = await runArchitectTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queueRoot,
    queryFn,
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(result.phase, 'committed');
  assert.equal(draftCalls, 0, 'deterministic finalize must NOT run a second LLM draft');
  assert.equal(sdkCalls, 1, 'exactly one completeness-critic call is expected on first finalize');
  const pending = join(queueRoot, 'pending');
  const queued = readdirSync(pending).filter((f) => f.endsWith('.md'));
  assert.deepEqual(queued, ['INIT-2026-05-29-seeded.md'], 'promotes EXACTLY the approved draft');
  const m = parseManifest(readFileSync(join(pending, queued[0]), 'utf8'));
  assert.match(m.body, /## Seeded body/, 'keeps the approved body');
  assert.match(m.body, /Resolved design decisions/, 'appends the resolved decisions');
  assert.match(m.body, /Follow OS/);
});

// ---------------------------------------------------------------------------
// Completeness critic (FINALIZE gate)
// ---------------------------------------------------------------------------

/** Seed an approved draft manifest + resolved feedback.md so `runFinalizeStep`
 *  takes the deterministic (no-draft-call) branch, isolating the critic call. */
function seedApprovedManifest(sessionDir: string, projectRoot: string): void {
  const manifestsDir = join(sessionDir, 'manifests');
  mkdirSync(manifestsDir, { recursive: true });
  const seeded = [
    '---',
    'initiative_id: INIT-2026-05-29-seeded',
    'project: demo',
    `project_repo_path: ${projectRoot}`,
    "created_at: '2026-05-29T10:00:00.000Z'",
    'iteration_budget: 4',
    'cost_budget_usd: 6',
    'phase: pending',
    'origin: architect',
    '---',
    '',
    '## Seeded body',
    '',
    'Given x exists, when y is done, then z is observable.',
  ].join('\n');
  writeFileSync(join(manifestsDir, 'INIT-2026-05-29-seeded.md'), seeded);
  writeFileSync(join(sessionDir, 'feedback.md'), '## Resolved design decisions\n\n- none\n');
}

test('completeness critic: findings block promotion and reset the session to awaiting-verdict', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId, sessionDir } = setupSession({
    phase: 'finalizing',
  });
  seedApprovedManifest(sessionDir, projectRoot);

  const queryFn: QueryFn = () => {
    async function* gen(): AsyncGenerator<unknown> {
      yield {
        type: 'result',
        total_cost_usd: 0,
        structured_output: {
          findings: [{ severity: 'high', gap: 'data_source_x is never covered by any initiative.' }],
        },
      };
    }
    return gen();
  };

  const result = await runArchitectTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queueRoot,
    queryFn,
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(result.phase, 'awaiting-verdict');
  assert.deepEqual(result.wrote, []);
  assert.equal(result.promotedManifestPaths, undefined);

  const pending = join(queueRoot, 'pending');
  const queued = existsSync(pending) ? readdirSync(pending).filter((f) => f.endsWith('.md')) : [];
  assert.deepEqual(queued, [], 'manifest must NOT promote while findings are unacknowledged');

  const status = readStatus(sessionDir);
  assert.equal(status?.phase, 'awaiting-verdict');
  assert.equal(status?.completenessCritic?.findings.length, 1);
  assert.equal(status?.completenessCritic?.findings[0].severity, 'high');
  assert.ok(status?.completenessCritic?.ranAt);
});

test('completeness critic: a clean pass (zero findings) promotes normally and stamps status', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId, sessionDir } = setupSession({
    phase: 'finalizing',
  });
  seedApprovedManifest(sessionDir, projectRoot);

  const queryFn: QueryFn = () => {
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0, structured_output: { findings: [] } };
    }
    return gen();
  };

  const result = await runArchitectTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queueRoot,
    queryFn,
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(result.phase, 'committed');
  assert.equal(result.promotedManifestPaths?.length, 1);

  const status = readStatus(sessionDir);
  assert.equal(status?.phase, 'committed');
  assert.deepEqual(status?.completenessCritic?.findings, []);
  assert.ok(status?.completenessCritic?.ranAt);
});

test('completeness critic: a re-approve after findings SKIPS the critic and promotes straight through', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId, sessionDir } = setupSession({
    phase: 'finalizing',
  });
  seedApprovedManifest(sessionDir, projectRoot);

  let firstTurnCalls = 0;
  const findingsQueryFn: QueryFn = () => {
    firstTurnCalls += 1;
    async function* gen(): AsyncGenerator<unknown> {
      yield {
        type: 'result',
        total_cost_usd: 0,
        structured_output: { findings: [{ severity: 'medium', gap: 'ambiguous ownership of release_folder.' }] },
      };
    }
    return gen();
  };

  const firstResult = await runArchitectTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queueRoot,
    queryFn: findingsQueryFn,
    logger: logger(logsRoot, sessionId),
  });
  assert.equal(firstResult.phase, 'awaiting-verdict');
  assert.equal(firstTurnCalls, 1);

  // The bridge's re-approve always sets phase → 'finalizing' regardless of
  // prior findings (applyPlanVerdict); `completenessCritic` stays on status.
  const afterFirst = readStatus(sessionDir)!;
  writeStatus(sessionDir, { ...afterFirst, phase: 'finalizing' });

  const secondQueryFn: QueryFn = () => {
    throw new Error('the critic must NOT be called again on a second finalize turn');
  };

  const secondResult = await runArchitectTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queueRoot,
    queryFn: secondQueryFn,
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(secondResult.phase, 'committed');
  assert.equal(secondResult.promotedManifestPaths?.length, 1);
  const status = readStatus(sessionDir);
  assert.equal(status?.completenessCritic?.findings.length, 1, 'the acknowledged finding is preserved on status');
});

test('completeness critic: a crash is advisory — finalize still promotes and a loud error event is emitted', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId, sessionDir } = setupSession({
    phase: 'finalizing',
  });
  seedApprovedManifest(sessionDir, projectRoot);

  const queryFn: QueryFn = () => {
    throw new Error('sdk unavailable');
  };

  const result = await runArchitectTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queueRoot,
    queryFn,
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(result.phase, 'committed');
  assert.equal(result.promotedManifestPaths?.length, 1, 'a critic crash must not block promotion');

  const status = readStatus(sessionDir);
  assert.deepEqual(status?.completenessCritic?.findings, []);
  assert.equal(status?.completenessCritic?.crashed, true);

  const logPath = join(logsRoot, `_architect-${sessionId}`, 'events.jsonl');
  const events = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const errEv = events.find(
    (e) => e.event_type === 'error' && e.skill === 'architect-completeness-critic',
  );
  assert.ok(errEv, 'a loud error event must be emitted on crash');
  assert.match(errEv.message, /architect\.completeness-critic\.crashed/);
  assert.equal(errEv.metadata.error, 'sdk unavailable', 'the crash event carries the bounded error detail');
});

test('completeness critic: the one-shot flag is durable — a promotion crash after a clean pass does not re-arm the critic', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId, sessionDir } = setupSession({
    phase: 'finalizing',
  });
  seedApprovedManifest(sessionDir, projectRoot);

  let sdkCalls = 0;
  const queryFn: QueryFn = () => {
    sdkCalls += 1;
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0, structured_output: { findings: [] } };
    }
    return gen();
  };

  // A queueRoot that is a regular FILE makes promoteManifests throw AFTER the
  // critic has already run — simulating a crash between critic and promotion.
  const blockedQueueRoot = join(sessionDir, 'queue-root-as-file');
  writeFileSync(blockedQueueRoot, 'not a directory');

  await assert.rejects(() =>
    runArchitectTurn({
      sessionId,
      projectRoot,
      logsRoot,
      queueRoot: blockedQueueRoot,
      queryFn,
      logger: logger(logsRoot, sessionId),
    }),
  );
  assert.equal(sdkCalls, 1, 'the critic ran once before the promotion crash');

  // The one-shot flag must already be durable on disk (persisted BEFORE promotion).
  const afterCrash = readStatus(sessionDir);
  assert.ok(
    afterCrash?.completenessCritic,
    'status.completenessCritic must be persisted before promoteManifests runs',
  );

  // Retry the finalize turn with a working queue — the critic must NOT re-run.
  const retry = await runArchitectTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queueRoot,
    queryFn,
    logger: logger(logsRoot, sessionId),
  });
  assert.equal(retry.phase, 'committed');
  assert.equal(retry.promotedManifestPaths?.length, 1);
  assert.equal(sdkCalls, 1, 'the retry turn must NOT re-invoke the critic');
});

test('completeness critic: oversized manifest bodies are truncated in the critic prompt', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId, sessionDir } = setupSession({
    phase: 'finalizing',
  });
  const manifestsDir = join(sessionDir, 'manifests');
  mkdirSync(manifestsDir, { recursive: true });
  const hugeBody = `## Huge scope\n\n${'x'.repeat(60_000)}\n\nGiven a, when b, then c.`;
  const seeded = [
    '---',
    'initiative_id: INIT-2026-05-29-huge',
    'project: demo',
    `project_repo_path: ${projectRoot}`,
    "created_at: '2026-05-29T10:00:00.000Z'",
    'iteration_budget: 4',
    'cost_budget_usd: 6',
    'phase: pending',
    'origin: architect',
    '---',
    '',
    hugeBody,
  ].join('\n');
  writeFileSync(join(manifestsDir, 'INIT-2026-05-29-huge.md'), seeded);
  writeFileSync(join(sessionDir, 'feedback.md'), '## Resolved design decisions\n\n- none\n');

  let captured = '';
  const queryFn: QueryFn = ({ prompt }) => {
    captured = prompt;
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0, structured_output: { findings: [] } };
    }
    return gen();
  };

  const result = await runArchitectTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queueRoot,
    queryFn,
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(result.phase, 'committed');
  assert.match(captured, /\[truncated \d+ chars\]/, 'the oversized body carries an explicit truncation marker');
  assert.ok(
    captured.length < 60_000,
    `the 60k-char manifest body must not pass through unbounded (prompt was ${captured.length} chars)`,
  );
});

// ---------------------------------------------------------------------------
// Waiting / terminal phases are no-ops
// ---------------------------------------------------------------------------

test('awaiting-answers turn is a no-op (bridge owns the wait state)', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId } = setupSession({
    phase: 'awaiting-answers',
  });
  const result = await runArchitectTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queueRoot,
    queryFn: makeQueryFn({}),
    logger: logger(logsRoot, sessionId),
  });
  assert.equal(result.phase, 'awaiting-answers');
  assert.equal(result.wrote.length, 0);
});

test('missing status.json throws a clear error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arch-runner-'));
  await assert.rejects(
    runArchitectTurn({ sessionId: 'nope', projectRoot: join(root, 'p'), queryFn: makeQueryFn({}) }),
    /no status\.json/,
  );
});

// ---------------------------------------------------------------------------
// Session discovery
// ---------------------------------------------------------------------------

test('runner streams tool_use events from the agent stream (drives the architect hex)', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId, sessionDir } = setupSession();
  writeFileSync(
    join(sessionDir, 'answers.json'),
    JSON.stringify([{ round: 1, answers: [{ question: 'Follow OS?', answer: 'Follow OS' }] }]),
  );
  // queryFn yields an assistant message carrying tool_use blocks, THEN a result.
  const queryFn: QueryFn = ({ prompt }) => {
    const structured = prompt.includes('the interview step')
      ? { done: true }
      : {
          vision: 'v',
          initiatives: [
            {
              slug: 'dark-mode',
              title: 'Dark mode',
              iteration_budget: 3,
              cost_budget_usd: 5,
              body: '## x\n\nGiven a precondition, when b action occurs, then c is observable.',
            },
          ],
        };
    async function* gen(): AsyncGenerator<unknown> {
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Grep', input: { pattern: 'theme' } },
            { type: 'tool_use', name: 'Read', input: { file_path: 'roadmap.md' } },
          ],
        },
      };
      yield { type: 'result', total_cost_usd: 0, structured_output: structured };
    }
    return gen();
  };

  await runArchitectTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queueRoot,
    queryFn,
    logger: logger(logsRoot, sessionId),
  });

  const log = readFileSync(join(logsRoot, `_architect-${sessionId}`, 'events.jsonl'), 'utf8');
  const events = log.trim().split('\n').map((l) => JSON.parse(l));
  const toolUses = events.filter((e) => e.event_type === 'tool_use' && e.metadata?.tool);
  assert.ok(toolUses.length >= 2, `expected tool_use events, got ${toolUses.length}`);
  assert.ok(toolUses.every((e) => e.phase === 'architect'));
  assert.ok(toolUses.some((e) => e.metadata.tool === 'Grep'));
});

test('listArchitectSessions discovers sessions across projects, skipping _archived', async () => {
  const { projectRoot, sessionId } = setupSession();
  const projectsRoot = join(projectRoot, '..'); // the `projects/` parent in the fixture
  const found = listArchitectSessions(projectsRoot);
  assert.ok(found.some((s) => s.session_id === sessionId && s.project === 'demo'));
});

// ---------------------------------------------------------------------------
// ARCH-1: brain-query event + brain_context population
// ---------------------------------------------------------------------------

test('ARCH-1: runner emits a brain-query event on every turn', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId } = setupSession();
  const queryFn = makeQueryFn({
    interview: { done: false, questions: [{ question: 'Q?', header: 'hdr', options: [{ label: 'A', description: 'a' }] }] },
  });

  await runArchitectTurn({
    sessionId, projectRoot, logsRoot, queueRoot,
    queryFn,
    logger: logger(logsRoot, sessionId),
  });

  const log = readFileSync(join(logsRoot, `_architect-${sessionId}`, 'events.jsonl'), 'utf8');
  const events = log.trim().split('\n').map((l) => JSON.parse(l));
  const brainEv = events.find((e) => e.event_type === 'brain-query');
  assert.ok(brainEv, 'brain-query event must be emitted each turn');
  assert.equal(brainEv.metadata?.project, 'demo');
});

test('ARCH-1: draft turn populates brain_context from agent brain/ reads', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId, sessionDir } = setupSession();
  writeFileSync(
    join(sessionDir, 'answers.json'),
    JSON.stringify([{ round: 1, answers: [{ question: 'Follow OS?', answer: 'Follow OS' }] }]),
  );

  // queryFn yields a brain/ Read tool_use block before the structured result.
  const queryFn: QueryFn = ({ prompt }) => {
    const structured = prompt.includes('the interview step')
      ? { done: true }
      : {
          vision: 'Brain-aware plan.',
          initiatives: [{
            slug: 'feature-x',
            title: 'Feature X',
            iteration_budget: 3,
            cost_budget_usd: 4,
            body: '## Feature X\n\nGiven env is set up, when used, then it works.',
          }],
        };
    async function* gen(): AsyncGenerator<unknown> {
      if (prompt.includes('draft the initiative')) {
        // Simulate the agent reading a brain theme
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Read', input: { file_path: 'brain/cycles/themes/wi-sizing.md' } },
              { type: 'tool_use', name: 'Read', input: { file_path: 'projects/demo/brain/profile.md' } },
              // A duplicate — should be deduped
              { type: 'tool_use', name: 'Read', input: { file_path: 'brain/cycles/themes/wi-sizing.md' } },
            ],
          },
        };
      }
      yield { type: 'result', total_cost_usd: 0, structured_output: structured };
    }
    return gen();
  };

  const result = await runArchitectTurn({
    sessionId, projectRoot, logsRoot, queueRoot,
    queryFn,
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(result.phase, 'awaiting-verdict');
  // brain_context should be non-empty and deduped
  const planMd = readFileSync(result.planPath!, 'utf8');
  assert.match(planMd, /brain\/cycles\/themes\/wi-sizing\.md/, 'brain theme path appears in PLAN.md brain context');
  assert.match(planMd, /projects\/demo\/brain\/profile\.md/, 'project brain path appears in PLAN.md brain context');
  // Duplicate is deduped — count occurrences of wi-sizing.md in the brain context section
  const bcStart = planMd.indexOf('## Brain context');
  const bcEnd = planMd.indexOf('\n## ', bcStart + 1);
  const bcBlock = planMd.slice(bcStart, bcEnd >= 0 ? bcEnd : undefined);
  const wiSizingCount = (bcBlock.match(/wi-sizing\.md/g) ?? []).length;
  assert.equal(wiSizingCount, 1, 'duplicate brain read must be deduped in brain_context');
});

// ---------------------------------------------------------------------------
// ARCH-6: rejected phase → archiveSessionDir
// ---------------------------------------------------------------------------

test('ARCH-6: rejected turn archives the session dir and does not throw', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId, sessionDir } = setupSession({ phase: 'rejected' });

  const result = await runArchitectTurn({
    sessionId, projectRoot, logsRoot, queueRoot,
    queryFn: makeQueryFn({}),
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(result.phase, 'rejected');
  // Session dir must be moved to _archived/
  assert.ok(!existsSync(sessionDir), 'original session dir must be gone after archive');
  const archivedDir = join(projectRoot, '_architect', '_archived', sessionId);
  assert.ok(existsSync(archivedDir), 'session must be in _archived/');
  // Archived session should no longer appear in listArchitectSessions
  const projectsRoot = join(projectRoot, '..');
  const found = listArchitectSessions(projectsRoot);
  assert.ok(!found.some((s) => s.session_id === sessionId), 'archived session must not appear in active list');
});

test('ARCH-6: rejected turn on already-archived session does not throw (idempotent)', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId, sessionDir } = setupSession({ phase: 'rejected' });
  // Pre-archive: move the dir to _archived/ so the session dir is already gone.
  const archivedRoot = join(projectRoot, '_architect', '_archived');
  mkdirSync(archivedRoot, { recursive: true });
  renameSync(sessionDir, join(archivedRoot, sessionId));

  // Should not throw — archiveSessionDir error is swallowed.
  const result = await runArchitectTurn({
    sessionId, projectRoot, logsRoot, queueRoot,
    queryFn: makeQueryFn({}),
    logger: logger(logsRoot, sessionId),
  });
  assert.equal(result.phase, 'rejected');
});

// ---------------------------------------------------------------------------
// P4: readArchitectSessionStats — compute cost + duration from session event log
// ---------------------------------------------------------------------------

test('P4: readArchitectSessionStats sums cost_usd and computes duration from started_at', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arch-stats-'));
  const logsRoot = join(dir, '_logs');
  const sid = 'sid-stats-test';
  const sessionLogDir = join(logsRoot, `_architect-${sid}`);
  mkdirSync(sessionLogDir, { recursive: true });

  const t0 = '2026-06-08T10:00:00.000Z';
  const t1 = '2026-06-08T10:01:00.000Z'; // 60 000 ms after t0
  const t2 = '2026-06-08T10:02:30.000Z'; // 150 000 ms after t0

  const events = [
    { event_id: 'EV1', cycle_id: `_architect-${sid}`, started_at: t0, cost_usd: 0.10 },
    { event_id: 'EV2', cycle_id: `_architect-${sid}`, started_at: t1, cost_usd: 0.23 },
    { event_id: 'EV3', cycle_id: `_architect-${sid}`, started_at: t2, cost_usd: 0.13 },
  ];
  writeFileSync(
    join(sessionLogDir, 'events.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );

  const stats = readArchitectSessionStats(logsRoot, sid);
  assert.ok(stats !== null, 'expected non-null stats');
  // Cost: sum of all cost_usd fields → 0.10 + 0.23 + 0.13 = 0.46
  assert.ok(Math.abs(stats!.cost_usd - 0.46) < 1e-9, `cost_usd: expected 0.46, got ${stats!.cost_usd}`);
  // Duration: last − first → 150 000 ms
  assert.equal(stats!.duration_ms, 150000);
});

test('P4: readArchitectSessionStats returns null when log is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arch-stats-missing-'));
  const stats = readArchitectSessionStats(join(dir, '_logs'), 'no-such-sid');
  assert.equal(stats, null);
});

test('P4: readArchitectSessionStats returns null on empty log', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arch-stats-empty-'));
  const logsRoot = join(dir, '_logs');
  const sid = 'sid-empty';
  mkdirSync(join(logsRoot, `_architect-${sid}`), { recursive: true });
  writeFileSync(join(logsRoot, `_architect-${sid}`, 'events.jsonl'), '');
  const stats = readArchitectSessionStats(logsRoot, sid);
  assert.equal(stats, null);
});

test('P4: readArchitectSessionStats handles events without cost_usd gracefully (non-LLM events)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arch-stats-nocost-'));
  const logsRoot = join(dir, '_logs');
  const sid = 'sid-nocost';
  const sessionLogDir = join(logsRoot, `_architect-${sid}`);
  mkdirSync(sessionLogDir, { recursive: true });

  const t0 = '2026-06-08T09:00:00.000Z';
  const t1 = '2026-06-08T09:00:05.000Z'; // 5 000 ms after t0
  const events = [
    // No cost_usd on start events — they're orchestrator bookkeeping
    { event_id: 'EV1', started_at: t0 },
    { event_id: 'EV2', started_at: t1, cost_usd: 0.05 },
  ];
  writeFileSync(
    join(sessionLogDir, 'events.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );

  const stats = readArchitectSessionStats(logsRoot, sid);
  assert.ok(stats !== null);
  assert.equal(stats!.cost_usd, 0.05);
  assert.equal(stats!.duration_ms, 5000);
});

// ---------------------------------------------------------------------------
// ADR-024 / M2-4: architectAgentSpec derives correctly from SKILL.md
// ---------------------------------------------------------------------------

test('ADR-024: architectAgentSpec derives phase, tier, and tool lists from SKILL.md', () => {
  assert.equal(architectAgentSpec.phase, 'architect');
  assert.equal(architectAgentSpec.tier, 'sonnet');
  assert.deepEqual([...architectAgentSpec.allowedTools], ['Read', 'Grep', 'Glob', 'Bash']);
  assert.deepEqual([...architectAgentSpec.disallowedTools], []);
  assert.equal(architectAgentSpec.skill, 'skills/architect/SKILL.md');
});

test('ADR-024: ARCHITECT_MODEL resolves to the concrete sonnet model id', () => {
  assert.equal(ARCHITECT_MODEL, 'claude-sonnet-4-6');
});

test('ADR-024: runStructured passes model + derived allowedTools to the queryFn options', async () => {
  const { projectRoot, logsRoot, queueRoot, sessionId, sessionDir } = setupSession();
  writeFileSync(
    join(sessionDir, 'answers.json'),
    JSON.stringify([{ round: 1, answers: [{ question: 'Follow OS?', answer: 'Follow OS' }] }]),
  );

  const capturedOptions: Array<Record<string, unknown>> = [];
  const queryFn: QueryFn = ({ prompt, options }) => {
    capturedOptions.push((options ?? {}) as Record<string, unknown>);
    let structured: unknown = null;
    if (prompt.includes('the interview step')) structured = { done: true };
    else if (prompt.includes('draft the initiative')) {
      structured = {
        vision: 'A spec-derived model test.',
        initiatives: [
          {
            slug: 'spec-test',
            title: 'Spec test',
            iteration_budget: 2,
            cost_budget_usd: 1,
            body: '## Spec\n\nGiven the spec is derived, when runStructured is called, then model + allowedTools match the spec.',
          },
        ],
      };
    }
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', subtype: 'success', total_cost_usd: 0, structured_output: structured };
    }
    return gen();
  };

  const result = await runArchitectTurn({
    sessionId,
    projectRoot,
    logsRoot,
    queueRoot,
    queryFn,
    logger: logger(logsRoot, sessionId),
  });

  assert.equal(result.phase, 'awaiting-verdict');
  // Every structured call (interview + draft) must carry model + allowedTools from the spec.
  const structuredCalls = capturedOptions.filter((o) => 'outputFormat' in o);
  assert.ok(structuredCalls.length >= 1, 'expected at least one runStructured call');
  for (const o of structuredCalls) {
    assert.equal(o.model, ARCHITECT_MODEL, 'model must be set from architectAgentSpec');
    assert.deepEqual(
      o.allowedTools,
      architectAgentSpec.allowedTools,
      'allowedTools must be set from architectAgentSpec',
    );
  }
});
