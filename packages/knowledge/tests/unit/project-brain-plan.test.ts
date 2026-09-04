/**
 * R4-19 WI-1 pins — the analyze-step read-source branch.
 *
 * `runAnalyzeStep` (now the project-brain kind's analyzing step) hardcodes
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
 * Sibling file (not inline in the project-brain runner's own test) so this
 * module-load-time SyntaxError doesn't collateral-fail that file's four
 * already-green pins while `buildAnalyzePlan` doesn't exist yet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAnalyzePlan, type ProjectBrainAnalyzeInput } from '../../project-brain-build.ts';
import { cyclesRawDir } from '../../brain-paths.ts';

/**
 * The fixture keeps the fields the runner's own wider status carries but
 * `buildAnalyzePlan` never reads — `session_id`, `phase`, `updated_at`. That
 * is the point: passing a wider object proves the function ignores the rest,
 * which is exactly how the runner calls it.
 */
type TestStatus = ProjectBrainAnalyzeInput & {
  session_id: string;
  phase: string;
  updated_at: string;
  kb_id?: string;
};

const FORGE_ROOT = '/fake/forge-root';
const STAGING = '/fake/forge-root/projects/demoproj/_project-brain/2026-08-10T00-00-00/themes';
const SKILL = 'You are the forge project-brain builder.';

/**
 * R4-23 WI-3: `buildAnalyzePlan`'s 4th parameter changed from a pre-loaded
 * `skill: string` to a per-turn supplier `skillFor: (turnId) => string` — it
 * now selects its own turn section (the task PROSE moved out to
 * skills/project-brain-builder/SKILL.md; see the immutable
 * project-brain-skill-prompt.test.ts for that contract). This fixture
 * supplier stands in for the real `loadSkillTurnPrompt` call and encodes the
 * selected turnId into its own output so assertions below can also confirm
 * the correct turn id was requested per branch.
 */
const skillFor = (turnId: string) => `${SKILL} [[turn:${turnId}]]`;

const PROJECT_REPO_PATH = '/fake/forge-root/projects/demoproj';

function baseStatus(overrides: Partial<TestStatus> = {}): TestStatus {
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

/**
 * The DATA-half prompt `buildAnalyzePlan` assembles for the ordinary
 * (project-repo) branch. R4-23 WI-3: the `## Your task this turn: …`
 * header and the closing `Author 3–6 theme … Then stop.` instruction moved
 * to SKILL.md's `analyze-project-repo` turn section (pinned by the
 * immutable project-brain-skill-prompt.test.ts AT-1) — `buildAnalyzePlan`
 * itself now only composes `skillFor('analyze-project-repo')` + the DATA
 * lines, so this helper drops those two lines and asserts turn selection via
 * `skillFor` instead.
 */
function expectedProjectPrompt(status: TestStatus, staging: string): string {
  return [
    skillFor('analyze-project-repo'),
    '',
    `Project: ${status.project}`,
    `Project repo (your working directory — READ from here): ${status.project_repo_path}`,
    `Staging directory (WRITE every theme + profile.md here, as absolute paths): ${staging}`,
    '',
    'Operator focus / guidance:',
    status.prompt || '_(none — author a faithful, well-rounded initial brain)_',
  ].join('\n');
}

test('RED (R4-19 WI-1): a flow/band kb_binding reads CYCLE evidence, not the (nonexistent) project repo', () => {
  const status = baseStatus({
    kb_id: 'review-insights',
    kb_binding: { kind: 'flow', ref: 'forge-develop', band: 'review-band' },
  });

  const plan = buildAnalyzePlan(status, FORGE_ROOT, STAGING, skillFor);

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

  // The prompt must not carry the project-repo READ framing — the flow/band
  // agent reads cycle evidence, not a project working directory.
  assert.ok(
    !plan.prompt.includes('Project repo (your working directory — READ from here)'),
    'prompt must not tell the agent to read a project repo that does not exist for this binding',
  );
  // NOTE (T1, R4-19 WI-1): the original pin also asserted the prompt never
  // contains `status.project_repo_path` at all. That is logically impossible
  // for the REAL flow/band shape: the create hand-off sets
  // project_repo_path = join(projectsRoot, '.kb-<id>') (packages/knowledge/bridge-studio-kbs.ts),
  // i.e. the PARENT of the .kb-anchored STAGING dir — and the verbatim
  // staging-dir WRITE line (companion test below) necessarily contains STAGING,
  // hence its parent. The real intent (no project-repo READ) is fully captured
  // by the assertion above; the removed check contradicted the WRITE contract.
  // ...and it must instead point the agent at the cycle archives dir as its
  // working directory.
  assert.ok(
    plan.prompt.includes(`Cycle archives (your working directory — READ from here): ${cyclesRawDir(FORGE_ROOT)}`),
    'prompt must reference the cycle-archives dir as the read source',
  );
  // R4-23 WI-3: the "read the cycle archives / synthesize the review-band
  // findings" PROSE moved to SKILL.md's analyze-cycle-archives turn section
  // (pinned by the immutable project-brain-skill-prompt.test.ts AT-1/AT-3);
  // buildAnalyzePlan itself now only supplies the VALUES as named data lines
  // the SKILL.md prose refers to.
  assert.ok(plan.prompt.includes('Evidence flow: forge-develop'), 'prompt must carry the evidence flow (binding.ref) as a named data line');
  assert.ok(plan.prompt.includes('Evidence band: review-band'), 'prompt must carry the evidence band (binding.band) as a named data line');
  assert.ok(
    plan.prompt.startsWith(skillFor('analyze-cycle-archives')),
    'the flow/band branch must select the analyze-cycle-archives turn id via skillFor',
  );
});

test('companion (R4-19 WI-1): a project kb_binding stays byte-compatible with the shipped project-brain plan', () => {
  const status = baseStatus({ kb_binding: { kind: 'project', ref: 'demoproj' } });

  const plan = buildAnalyzePlan(status, FORGE_ROOT, STAGING, skillFor);

  assert.equal(plan.cwd, status.project_repo_path, 'a project binding must still read from the project repo');
  assert.equal(
    plan.prompt,
    expectedProjectPrompt(status, STAGING),
    'a project binding must produce the same DATA-half prompt shape as before — the header/closing PROSE now ' +
      'lives in SKILL.md (R4-23 WI-3), selected via skillFor("analyze-project-repo")',
  );
});

test('companion (R4-19 WI-1): an absent kb_binding (the ordinary, non-KB-scoped flow) also stays byte-compatible', () => {
  const status = baseStatus(); // no kb_binding at all — the historical default path

  const plan = buildAnalyzePlan(status, FORGE_ROOT, STAGING, skillFor);

  assert.equal(plan.cwd, status.project_repo_path, 'no kb_binding must still read from the project repo (historical default)');
  assert.equal(
    plan.prompt,
    expectedProjectPrompt(status, STAGING),
    'no kb_binding must produce the same DATA-half prompt shape as before — the header/closing PROSE now lives ' +
      'in SKILL.md (R4-23 WI-3), selected via skillFor("analyze-project-repo")',
  );
});

test('companion (R4-19 WI-1): the flow/band branch keeps the unchanged WRITE contract (3-6 themes + profile.md into staging)', () => {
  const status = baseStatus({
    kb_id: 'review-insights',
    kb_binding: { kind: 'flow', ref: 'forge-develop', band: 'review-band' },
  });

  const plan = buildAnalyzePlan(status, FORGE_ROOT, STAGING, skillFor);

  // Only the READ source differs on this branch — the WRITE contract (staging
  // dir) is DATA and must be untouched. The "Author 3-6 themes… Then stop."
  // instruction itself moved to SKILL.md's analyze-cycle-archives turn
  // section (R4-23 WI-3) — pinned there by the immutable
  // project-brain-skill-prompt.test.ts AT-1, not by buildAnalyzePlan's own
  // (now prose-free) composition.
  assert.ok(
    plan.prompt.includes(`Staging directory (WRITE every theme + profile.md here, as absolute paths): ${STAGING}`),
    'flow/band prompt must still name the staging dir as the WRITE target',
  );
  assert.ok(
    plan.prompt.startsWith(skillFor('analyze-cycle-archives')),
    'flow/band branch must select the analyze-cycle-archives turn id via skillFor',
  );
});
