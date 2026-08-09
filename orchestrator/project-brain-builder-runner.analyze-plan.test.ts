/**
 * R4-19 WI-1 pins — the analyze-step read-source branch.
 *
 * `runAnalyzeStep` (project-brain-builder-runner.ts) hardcodes
 * `cwd: status.project_repo_path` and a prompt containing the literal line
 * `Project repo (your working directory — READ from here): <project_repo_path>`
 * for EVERY project-brain session, regardless of `status.kb_binding.kind`.
 * That is correct for a PROJECT-bound KB (the ordinary project-brain flow)
 * but wrong for a flow/band-bound KB (R1-06 `create-kb-cycle`, e.g.
 * `review-insights` bound to `{kind:'flow', ref:'forge-develop',
 * band:'review-band'}`) — that KB has NO project repo. Its evidence is the
 * forge-owned cycle archives (Brain 2, `brain/cycles/_raw` —
 * `cyclesRawDir`/brain-paths.ts is the SSOT; verified against the real
 * filesystem layout, NOT the stale top-level `brain/_raw/` leftover from the
 * pre-restructure layout) plus the logged review-band / adversarial-review
 * findings archived inside those cycles.
 *
 * These pins target a not-yet-extracted PURE helper, `buildAnalyzePlan`,
 * that `runAnalyzeStep` is expected to call to build its `{cwd, prompt}`
 * pair (R4-19 WI-1). It does not exist yet, so every test below currently
 * RED-fails at module load — `buildAnalyzePlan` is not a named export of
 * `./project-brain-builder-runner.ts` (proof in the WI-1 handoff). Once WI-1
 * extracts + branches the helper, each test independently proves one part of
 * the required contract:
 *
 *   1. RED  — a flow/band binding reads CYCLE evidence, never the project repo.
 *   2. companion — a project binding (or no binding at all) is BYTE-IDENTICAL
 *      to today's shipped project-brain plan — the branch must not regress it.
 *   3. companion — the WRITE contract (3-6 themes + profile.md into staging)
 *      is unchanged on the flow/band branch — only the READ source differs.
 *
 * Sibling file (not inline in project-brain-builder-runner.test.ts) so this
 * module-load-time SyntaxError doesn't collateral-fail that file's four
 * already-green pins while `buildAnalyzePlan` doesn't exist yet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { buildAnalyzePlan, type ProjectBrainStatus } from './project-brain-builder-runner.ts';
import { cyclesRawDir } from './brain-paths.ts';

const FORGE_ROOT = '/fake/forge-root';
const STAGING = '/fake/forge-root/projects/demoproj/_project-brain/2026-08-10T00-00-00/themes';
const SKILL = 'You are the forge project-brain builder.';

const PROJECT_REPO_PATH = '/fake/forge-root/projects/demoproj';

function baseStatus(overrides: Partial<ProjectBrainStatus> = {}): ProjectBrainStatus {
  return {
    session_id: '2026-08-10T00-00-00',
    project: 'demoproj',
    project_repo_path: PROJECT_REPO_PATH,
    phase: 'analyzing',
    prompt: 'focus on the build + test conventions',
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/** The exact prompt `runAnalyzeStep` assembles today (project-brain-builder-runner.ts ~201-214) —
 *  reproduced here so test (2) can assert byte-compatibility, not a loose substring match. */
function expectedProjectPrompt(status: ProjectBrainStatus, staging: string): string {
  return [
    SKILL,
    '',
    '## Your task this turn: read the project and author its initial brain.',
    '',
    `Project: ${status.project}`,
    `Project repo (your working directory — READ from here): ${status.project_repo_path}`,
    `Staging directory (WRITE every theme + profile.md here, as absolute paths): ${staging}`,
    '',
    'Operator focus / guidance:',
    status.prompt || '_(none — author a faithful, well-rounded initial brain)_',
    '',
    'Author 3–6 theme `.md` files plus a `profile.md` into the staging directory. Then stop.',
  ].join('\n');
}

test('RED (R4-19 WI-1): a flow/band kb_binding reads CYCLE evidence, not the (nonexistent) project repo', () => {
  const status = baseStatus({
    kb_id: 'review-insights',
    kb_binding: { kind: 'flow', ref: 'forge-develop', band: 'review-band' },
  });

  const plan = buildAnalyzePlan(status, FORGE_ROOT, STAGING, SKILL);

  // cwd must NOT be the (nonexistent, for this binding) project repo — it
  // must be the forge-owned cycle-evidence scope. Grounded in the real
  // brain layout via the brain-paths.ts SSOT (brain/cycles/_raw — verified
  // against the actual on-disk archive, 81 files), not an invented path.
  assert.notEqual(plan.cwd, status.project_repo_path, 'cwd must not be the project repo for a flow/band binding');
  assert.equal(
    plan.cwd,
    cyclesRawDir(FORGE_ROOT),
    'cwd must be the cycle-archives dir (brain/cycles/_raw via cyclesRawDir) for a flow/band-bound KB',
  );

  // The prompt must not carry the project-repo framing at all...
  assert.ok(
    !plan.prompt.includes('Project repo (your working directory — READ from here)'),
    'prompt must not tell the agent to read a project repo that does not exist for this binding',
  );
  assert.ok(
    !plan.prompt.includes(status.project_repo_path),
    'prompt must not reference project_repo_path at all on the flow/band branch',
  );
  // ...and it must instead point the agent at the cycle archives + the
  // review-band / adversarial-review findings logged inside them.
  assert.ok(
    plan.prompt.includes(cyclesRawDir(FORGE_ROOT)),
    'prompt must reference the cycle-archives dir as the read source',
  );
  assert.ok(
    /cycle/i.test(plan.prompt) && /archiv/i.test(plan.prompt),
    'prompt must reference the cycle archives as evidence',
  );
  assert.ok(
    plan.prompt.includes('review-band') && /adversarial-review|finding/i.test(plan.prompt),
    'prompt must reference the review-band / adversarial-review findings as evidence',
  );
});

test('companion (R4-19 WI-1): a project kb_binding stays byte-compatible with the shipped project-brain plan', () => {
  const status = baseStatus({ kb_binding: { kind: 'project', ref: 'demoproj' } });

  const plan = buildAnalyzePlan(status, FORGE_ROOT, STAGING, SKILL);

  assert.equal(plan.cwd, status.project_repo_path, 'a project binding must still read from the project repo');
  assert.equal(
    plan.prompt,
    expectedProjectPrompt(status, STAGING),
    'a project binding must produce byte-identical prompt text to the pre-WI-1 project-brain flow',
  );
});

test('companion (R4-19 WI-1): an absent kb_binding (the ordinary, non-KB-scoped flow) also stays byte-compatible', () => {
  const status = baseStatus(); // no kb_binding at all — the historical default path

  const plan = buildAnalyzePlan(status, FORGE_ROOT, STAGING, SKILL);

  assert.equal(plan.cwd, status.project_repo_path, 'no kb_binding must still read from the project repo (historical default)');
  assert.equal(
    plan.prompt,
    expectedProjectPrompt(status, STAGING),
    'no kb_binding must produce byte-identical prompt text to the pre-WI-1 project-brain flow',
  );
});

test('companion (R4-19 WI-1): the flow/band branch keeps the unchanged WRITE contract (3-6 themes + profile.md into staging)', () => {
  const status = baseStatus({
    kb_id: 'review-insights',
    kb_binding: { kind: 'flow', ref: 'forge-develop', band: 'review-band' },
  });

  const plan = buildAnalyzePlan(status, FORGE_ROOT, STAGING, SKILL);

  // Only the READ source differs on this branch — the WRITE contract (staging
  // dir + theme-count guidance) must be untouched, matching the project
  // branch's closing instruction verbatim.
  assert.ok(
    plan.prompt.includes(`Staging directory (WRITE every theme + profile.md here, as absolute paths): ${STAGING}`),
    'flow/band prompt must still name the staging dir as the WRITE target',
  );
  assert.ok(
    plan.prompt.includes('Author 3–6 theme `.md` files plus a `profile.md` into the staging directory. Then stop.'),
    'flow/band prompt must still instruct authoring 3-6 themes + profile.md — the write contract is unchanged',
  );
});
