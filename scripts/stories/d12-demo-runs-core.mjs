/**
 * d12-demo-runs-core.mjs — the pure core of the two demo-pipeline verification
 * runs (bead `forge-1rk5.3`): `control` (a behaviour-preserving refactor, every
 * checkpoint must read `unchanged`) and `positive` (a real behaviour change,
 * every checkpoint must read `changed`). Both drive the SAME mechanism —
 * typed acceptance criteria (ADR 051) are the only thing that authors demo
 * checkpoints (`packages/stations/phases/derive-demo-model.ts`'s
 * `acDerivedCheckpoints`, delta honesty per bead `forge-mfv5.1.7`) and every
 * checkpoint is rendered as a recorded terminal capture (bead `forge-mfv5.2.1`,
 * `packages/factory/demo-capture.ts`'s `recordTerminal` — a `.webm` +
 * `.filmstrip.png` per side, even for a CLI checkpoint).
 *
 * PURE: no filesystem, no child process, no network, no clock read by default
 * (a caller may inject `now`/`forgeRoot`/`account` for determinism; the CLI
 * lets them default). `planRun` freezes everything downstream needs —
 * `renderManifest`/`renderWorkItem` are one-line calls onto the repo's own
 * `serializeManifest`/`serializeWorkItem` (so the file text this driver
 * produces is byte-for-byte what the real product would write, never a
 * hand-rolled YAML lookalike), and `judgeRun` is the PASS/FAIL verdict over
 * whatever `demo.json` + PR-body text a real run actually produced.
 *
 * The effectful shell (`d12-demo-runs.mjs`) is the only thing that touches a
 * disk, a git remote, a bridge or a `gh` binary.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serializeManifest, serializeWorkItem } from '@forge/flows';
// Not re-exported through `@forge/stations`'s package.json `exports` map
// (an internal band implementation detail, `packages/stations/phases/`) — a
// relative import bypasses that map (it only governs the bare `@forge/stations`
// specifier), the same precedent `writeManifest`'s import in
// `d12-demo-runs.mjs` already sets. Importing the REAL function, rather than
// typing the sentence it produces, is the point: `judgeRun` below can never
// drift from what the orchestrator's own derivation actually says.
import { deriveDeltaSummary } from '../../packages/stations/phases/derive-demo-model.ts';

/** Two levels up from `scripts/stories/` — the same convention
 *  `scripts/lib/boot-studio.mjs`'s `FORGE_ROOT` uses. Overridable via
 *  `planRun`'s `opts.forgeRoot` so a test can plan against a fake root without
 *  touching this process's real one. */
export const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const SUPPORTED_KINDS = Object.freeze(['control', 'positive']);

/** Operator-owned fallback account (mirrors `packages/projects/project-create.ts`'s
 *  own `REMOTE_ACCOUNT` — never re-derived from the host's active `gh` login). */
export const DEFAULT_REMOTE_ACCOUNT = 'parsoFish';

/** The fixture ground both runs provision from (`tests/stories/grounds/<name>/seed/`) —
 *  a real, dependency-free `gitpulse`-shaped CLI with its own `src/`, `test/`
 *  and `.forge/project.json` (`demoProcess` declares one `capture` step:
 *  `` Run `npm run demo` … ``, so a checkpoint whose AC names that exact
 *  command is deduped against it, never doubled). */
export const FIXTURE_NAME = 'node-cli-with-tests';

const CHANGED_BEHAVIOUR_SUBSTRING = 'changed behaviour';

/** A markdown image line naming a `.filmstrip.png` (either side, either query
 *  string or none) — control's PASS bar: SOME visual evidence was captured.
 *  Matches `packages/flows/pr-media.ts`'s `buildCaptureMediaBlock` output:
 *  `![<label> — <side>](<blobUrl>?raw=true)`. */
const FILMSTRIP_IMAGE_RE = /!\[[^\]]*\]\([^)]*\.filmstrip\.png(?:\?[^)]*)?\)/;

/**
 * Positive's stronger bar: an `after`-side filmstrip, COMMIT-PINNED (a GitHub
 * `blob/<sha>/…` path — never a branch name, which would go stale the moment
 * the branch moves) and carrying GitHub's `?raw=true` so the image renders
 * inline rather than linking to the HTML blob viewer. Exactly
 * `packages/flows/pr-media.ts`'s `buildCaptureMediaBlock`:
 *   `captureUrl = https://github.com/<ownerRepo>/blob/<ref>/<relDir>/.capture/<side>/<file>`
 *   image line = `![<label> — after](<captureUrl>?raw=true)`
 */
const AFTER_FILMSTRIP_RAW_RE =
  /!\[[^\]]*\]\([^)]*\/blob\/[0-9a-f]{7,40}\/[^)]*\.capture\/after\/[^)]*\.filmstrip\.png\?raw=true\)/;

/** A markdown link (not necessarily an image) naming a `.webm` — `pr-media.ts`'s
 *  `[▶ <label> — <side> (webm)](<captureUrl>)` (no `?raw=true` on the webm link). */
const WEBM_LINK_RE = /\[[^\]]*\]\([^)]*\.webm(?:\?[^)]*)?\)/;

/**
 * The private-repository rendering caveat, quoted VERBATIM from
 * `packages/flows/pr-media.ts`'s `buildCaptureMediaBlock` (bead
 * `forge-mfv5.2.5`) — not a heuristic: this exact clause is what it emits
 * whenever `isPrivate && anyInlined`.
 */
const PRIVATE_CAVEAT_TEXT = "needs the viewer's github.com session";

/** ISO date (YYYY-MM-DD) from a Date, with no timezone surprises for the
 *  initiative-id slug (`INIT-YYYY-MM-DD-…`, `packages/flows/work-item.ts`'s
 *  own `INITIATIVE_ID_PATTERN`). */
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/** Freeze `value` and every plain object/array reachable from it. Good enough
 *  for the JSON-shaped plan/manifest/work-item objects this module builds —
 *  never called on anything carrying a class instance, a Map or a Set. */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

/**
 * The two runs' fixed content (forge-1rk5.3's own §"the two runs"). Every
 * acceptance criterion's `when` clause carries EXACTLY one inline-code span
 * naming a bare, shell-metacharacter-free command — `extractDrivableCommand`
 * (`@forge/contracts`) is what turns that into a checkpoint, and the tests
 * assert every one of these six clauses passes it.
 */
const RUN_SPECS = Object.freeze({
  control: Object.freeze({
    costCeilingUsd: 10,
    iterationBudget: 6,
    wiTitle: "Extract sort.ts's inline comparator into a named helper",
    filesInScope: Object.freeze(['src/sort.ts']),
    estimatedIterations: 2,
    behaviorPreserving: true,
    acceptanceCriteria: Object.freeze([
      Object.freeze({
        given: 'the unit suite',
        when: 'the operator runs `npm test`',
        then: 'every test stays green with no assertion changed',
      }),
      Object.freeze({
        given: 'the deterministic acceptance fixture',
        when: 'the operator runs `npm run demo`',
        then: 'the printed report is byte-identical to before the refactor',
      }),
    ]),
    nonGoals: Object.freeze([
      'Adding a new sort column or command slug.',
      "Changing numeric-vs-text detection (typeof record[column] === 'number' on the first non-null record).",
      'Touching test/sort.test.ts, test/cli-sort.test.ts or any other test file — the existing suite is the proof this refactor holds.',
    ]),
    body: [
      "# Extract sort.ts's inline comparator into a named helper",
      '',
      '`sortRecords` in `src/sort.ts` inlines its numeric-vs-text comparison logic',
      'directly inside the `Array.prototype.sort` callback: a branch that does',
      '`(av as number) - (bv as number)` when the column is numeric, and a direct',
      '`<`/`>` string comparison otherwise, before the `direction === \'desc\'`',
      'inversion and the stable `a.i - b.i` tie-break.',
      '',
      'Extract that branch into one small, named, pure helper — e.g.',
      '`compareByColumn(av, bv, isNumeric): number` — defined once in `src/sort.ts`',
      "and called from `sortRecords`'s sort callback. Everything else about",
      '`sortRecords` (its signature, the numeric-detection loop, the direction',
      'inversion, the stable tie-break) stays exactly where it is.',
      '',
      'This is a pure refactor: the same inputs to `sortRecords` must produce the',
      'exact same output, in the exact same order, before and after. `src/cli.ts`',
      '(the only consumer of `sortRecords`) is not touched.',
      '',
    ].join('\n'),
  }),
  positive: Object.freeze({
    costCeilingUsd: 15,
    iterationBudget: 8,
    wiTitle: 'Add --exclude-author <name> (inverse of --author)',
    filesInScope: Object.freeze([
      'src/author-filter.ts',
      'src/cli.ts',
      'test/unit.test.ts',
      'test/acceptance/run.ts',
    ]),
    estimatedIterations: 4,
    behaviorPreserving: false,
    acceptanceCriteria: Object.freeze([
      Object.freeze({
        given: "the CLI's usage text",
        when: 'the operator runs `node dist/cli.js --help`',
        then: 'a line documents `--exclude-author`',
      }),
      Object.freeze({
        given: 'the deterministic acceptance fixture',
        when: 'the operator runs `npm run demo`',
        then: 'the demo prints an exclude-author report whose commits omit Grace Hopper',
      }),
    ]),
    nonGoals: Object.freeze([
      "Changing --author's existing keep-matching semantics.",
      'Extending --exclude-author to the tags or coupling subcommands.',
    ]),
    body: [
      '# Add --exclude-author <name> — the inverse of --author',
      '',
      '`src/cli.ts` already supports `--author <pattern>` (repeatable, OR\'d, glob',
      'with `*`, case-insensitive — `filterAuthorCommits` in `src/author-filter.ts`),',
      'which KEEPS only commits whose author name or email matches at least one',
      'pattern. Add `--exclude-author <pattern>` with the same glob/repeatable/',
      "OR'd/case-insensitive matching, but DROPS commits that match instead of",
      'keeping them — the exact inverse.',
      '',
      '## Approach',
      '',
      '- Add a small pure function to `src/author-filter.ts` alongside',
      '  `filterAuthorCommits` — e.g. `excludeAuthorCommits(commits, patterns):',
      '  AuthorFilterResult` — reusing the same glob-to-RegExp construction and',
      '  returning commits that match NONE of the patterns.',
      "- Wire `--exclude-author` into `src/cli.ts`'s main argv loop (the single-",
      "  snapshot path), validated the same way `--author` is (requires a value,",
      '  rejects an empty-string pattern).',
      '- Add one line to the `USAGE` array documenting the new flag, next to the',
      '  existing `--author` line.',
      '- Add a FAIL-FIRST unit test to `test/unit.test.ts` — the ONE file `npm',
      '  test` runs (`package.json`\'s `"test"` script is `node --import tsx',
      '  --test test/unit.test.ts`, not a directory glob) — exercising the new',
      '  filter against a fixture with at least two distinct authors.',
      "- Extend `test/acceptance/run.ts`'s demo path with a run of the built CLI",
      '  as `--exclude-author "Grace Hopper"` against the existing deterministic',
      '  fixture repo (`makeFixtureRepo`, whose fixed commits already include an',
      '  author named exactly `Grace Hopper`), and assert the printed report\'s',
      "  author list omits her while Ada Lovelace's commits are unaffected.",
      '',
    ].join('\n'),
  }),
});

/**
 * Every HARD preflight clause that fails, as `<clause>: <detail>` — the scheduler refuses a develop claim on any of
 * them (forge-1rk5.3 / row 128). An absent or malformed report is itself a failure: it is never "nothing failed".
 */
export function hardClauseFailures(report) {
  if (!report || !Array.isArray(report.clauses)) return ['preflight report unavailable'];
  return report.clauses.filter((c) => c.hard && !c.pass).map((c) => `${c.clause}: ${c.detail}`);
}

/**
 * Validate `kind` and `opts`, then freeze a plan: everything the effectful
 * shell and the tests need, and nothing they have to re-derive.
 *
 * `opts`:
 *   - `account`   (string, default `DEFAULT_REMOTE_ACCOUNT`) — the remote's owner.
 *   - `forgeRoot` (string, default `FORGE_ROOT`) — anchors `projectRepoPath` /
 *                 `worktreePath` (both must round-trip `writeManifest`'s real
 *                 containment guard at write time — see
 *                 `packages/flows/manifest-path-guard.ts`).
 *   - `project`   (string, default `story-<storyId>`) — override for testing
 *                 ONLY the prefix refusal below; the CLI never sets this.
 *   - `now`       (Date, default `new Date()`) — the initiative-id's date stamp.
 *
 * @param {'control'|'positive'} kind
 * @param {{account?: string, forgeRoot?: string, project?: string, now?: Date}} [opts]
 */
export function planRun(kind, opts = {}) {
  if (!SUPPORTED_KINDS.includes(kind)) {
    throw new TypeError(`planRun: kind must be one of ${SUPPORTED_KINDS.join('|')}, got ${JSON.stringify(kind)}`);
  }
  const allowed = new Set(['account', 'forgeRoot', 'project', 'now']);
  for (const key of Object.keys(opts)) {
    if (!allowed.has(key)) {
      throw new TypeError(`planRun: unknown option ${JSON.stringify(key)} — allowed: ${[...allowed].sort().join(', ')}`);
    }
  }

  const account = opts.account ?? DEFAULT_REMOTE_ACCOUNT;
  if (typeof account !== 'string' || account.trim() === '') {
    throw new TypeError(`planRun: account must be a non-empty string, got ${JSON.stringify(account)}`);
  }
  const forgeRoot = opts.forgeRoot ?? FORGE_ROOT;
  if (typeof forgeRoot !== 'string' || forgeRoot.trim() === '') {
    throw new TypeError('planRun: forgeRoot must be a non-empty string');
  }
  const now = opts.now ?? new Date();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('planRun: now must be a valid Date');
  }

  const storyId = `d12-${kind}`;
  const project = opts.project ?? `story-${storyId}`;
  if (!project.startsWith('story-d12-')) {
    throw new Error(
      `planRun: project ${JSON.stringify(project)} does not carry the "story-d12-" prefix the residue sweep ` +
      "(scripts/stories/sweep.mjs's storyFixtureNames) and the remote-delete guard both trust — refusing.",
    );
  }
  const remoteName = `${account}/${project}`;

  const spec = RUN_SPECS[kind];
  const initiativeId = `INIT-${isoDate(now)}-${storyId}`;
  const projectRepoPath = join(forgeRoot, 'projects', project);
  const worktreePath = join(forgeRoot, '_worktrees', initiativeId);
  const branch = `forge/${initiativeId}`;

  const acceptance_criteria = spec.acceptanceCriteria.map((c) => ({ ...c }));

  const manifest = {
    initiative_id: initiativeId,
    title: spec.wiTitle,
    project,
    project_repo_path: projectRepoPath,
    created_at: now.toISOString(),
    iteration_budget: spec.iterationBudget,
    cost_budget_usd: spec.costCeilingUsd,
    phase: 'pending',
    origin: 'human-directed',
    class: 'code',
    acceptance_criteria,
    body: `# ${spec.wiTitle}\n\nSee \`WI-1\` for the full spec. One work item, no decomposition.\n`,
    // Required so the develop-start hand-off (`enqueueDevelopRun`'s
    // `allowRepointFrom: ['forge-architect']`) repoints without asking for
    // confirmation it has no operator to give — see the driver's own header.
    flow_id: 'forge-architect',
    // cascade-v4 #7: this is a throwaway verification cycle; it must never be
    // approved/merged (the driver stops at ready-for-review), but marking it
    // is cheap and honest regardless of whether reflection is ever reached.
    disposable: true,
  };

  const workItem = {
    work_item_id: 'WI-1',
    initiative_id: initiativeId,
    status: 'pending',
    depends_on: [],
    acceptance_criteria: spec.acceptanceCriteria.map((c) => ({ ...c })),
    files_in_scope: [...spec.filesInScope],
    estimated_iterations: spec.estimatedIterations,
    quality_gate_cmd: ['npm', 'test'],
    non_goals: [...spec.nonGoals],
    body: spec.body,
    ...(spec.behaviorPreserving ? { behavior_preserving: true } : {}),
  };

  const expectedPassCriteria =
    kind === 'control'
      ? [
          "every captured checkpoint's delta is 'unchanged'",
          "essence and PR body both carry deriveDeltaSummary's real sentence for those checkpoints",
          'the PR body makes no "changed behaviour" claim',
          'the PR body shows filmstrip image evidence',
        ]
      : [
          "both AC checkpoints' delta is 'changed'",
          "essence and PR body both carry deriveDeltaSummary's real sentence for those checkpoints",
          'the PR body inlines a commit-pinned after-side filmstrip image (?raw=true)',
          'the PR body links a .webm capture',
          'the PR body carries the private-repository rendering caveat (pr-media.ts)',
        ];

  return deepFreeze({
    kind,
    storyId,
    project,
    account,
    remoteName,
    forgeRoot,
    initiativeId,
    branch,
    projectRepoPath,
    worktreePath,
    fixture: FIXTURE_NAME,
    costCeilingUsd: spec.costCeilingUsd,
    manifest,
    workItem,
    expectedPassCriteria,
  });
}

/** The manifest's exact file content, in the repo's own format
 *  (`serializeManifest`, `@forge/flows`) — this is what `writeManifest` would
 *  write, byte for byte. */
export function renderManifest(plan) {
  return serializeManifest(plan.manifest);
}

/** `WI-1.md`'s exact file content (`serializeWorkItem`, `@forge/flows`). */
export function renderWorkItem(plan) {
  return serializeWorkItem(plan.workItem);
}

/** `--plan-only`'s pure output: what the plan IS, and the exact file bytes it
 *  would write, with nothing touched. */
export function renderPlanOnly(plan) {
  const lines = [
    `d12-demo-runs: PLAN ONLY (${plan.kind})`,
    '',
    `  storyId            ${plan.storyId}`,
    `  project             ${plan.project}`,
    `  initiative_id       ${plan.initiativeId}`,
    `  branch              ${plan.branch}`,
    `  fixture             ${plan.fixture}`,
    `  remote              ${plan.remoteName}`,
    `  cost ceiling        $${plan.costCeilingUsd}`,
    `  worktreePath        ${plan.worktreePath}`,
    `  projectRepoPath     ${plan.projectRepoPath}`,
    '',
    'Expected PASS criteria:',
    ...plan.expectedPassCriteria.map((c) => `  - ${c}`),
    '',
    `--- _queue/pending/${plan.initiativeId}.md ---`,
    renderManifest(plan),
    '--- .forge/work-items/WI-1.md ---',
    renderWorkItem(plan),
  ];
  return lines.join('\n');
}

/** Every checkpoint `demoJson` carries, or `[]` when it carries none/is malformed. */
function checkpointsOf(demoJson) {
  return Array.isArray(demoJson?.checkpoints) ? demoJson.checkpoints : [];
}

function essenceOf(demoJson) {
  return typeof demoJson?.essence === 'string' ? demoJson.essence : '';
}

/** One named PASS/FAIL row — the same `{name, pass, detail}` shape
 *  `scripts/lib/verify-outcomes.mjs`'s `OutcomeCheck` already uses. */
function reason(name, pass, detail) {
  return Object.freeze({ name, pass, detail });
}

/**
 * The essence/PR-body delta-SUMMARY check, shared by both kinds: rather than
 * matching a hand-typed sentence, this calls `deriveDeltaSummary` on the SAME
 * checkpoints the run captured and requires the essence/PR body to carry
 * exactly what that real function says about THEM — so a demo.json/PR body
 * that drifted from its own checkpoints (stale essence, wrong count) fails
 * here even if it happens to contain some OTHER honest-sounding sentence.
 * `null` (no checkpoint carries a delta yet) is its own named failure, never
 * silently coerced into a string compare.
 */
function summaryReasons(checkpoints, essence, prBody) {
  const expected = deriveDeltaSummary(checkpoints);
  if (expected === null) {
    const detail = 'deriveDeltaSummary(checkpoints) returned null — no checkpoint carries a delta yet';
    return [reason('essence and PR body carry the real delta-summary sentence', false, detail)];
  }
  const inEssence = essence.includes(expected);
  const inBody = prBody.includes(expected);
  return [
    reason(
      'essence contains deriveDeltaSummary\'s real sentence for these checkpoints',
      inEssence,
      inEssence ? `present: "${expected}"` : `expected "${expected}", essence: ${JSON.stringify(essence)}`,
    ),
    reason(
      'PR body contains deriveDeltaSummary\'s real sentence for these checkpoints',
      inBody,
      inBody ? `present: "${expected}"` : `expected "${expected}", not found in the PR body`,
    ),
  ];
}

function judgeControl(checkpoints, essence, prBody) {
  const allUnchanged = checkpoints.length > 0 && checkpoints.every((c) => c?.delta === 'unchanged');
  const offenders = checkpoints
    .filter((c) => c?.delta !== 'unchanged')
    .map((c) => `${c?.label ?? '(no label)'}: delta=${JSON.stringify(c?.delta)}`);
  const claimsChanged = prBody.toLowerCase().includes(CHANGED_BEHAVIOUR_SUBSTRING);
  const hasFilmstrip = FILMSTRIP_IMAGE_RE.test(prBody);

  return [
    reason(
      "every captured checkpoint's delta is 'unchanged'",
      allUnchanged,
      allUnchanged
        ? `${checkpoints.length} checkpoint(s), all unchanged`
        : checkpoints.length === 0
          ? 'no checkpoints were captured'
          : `not unchanged: ${offenders.join('; ')}`,
    ),
    ...summaryReasons(checkpoints, essence, prBody),
    reason(
      'PR body makes no "changed behaviour" claim',
      !claimsChanged,
      claimsChanged ? 'the PR body contains the substring "changed behaviour"' : 'no such claim found',
    ),
    reason(
      'PR body shows filmstrip image evidence',
      hasFilmstrip,
      hasFilmstrip ? 'a markdown image line naming a .filmstrip.png is present' : 'no .filmstrip.png image line found',
    ),
  ];
}

function judgePositive(checkpoints, essence, prBody) {
  const bothChanged = checkpoints.length === 2 && checkpoints.every((c) => c?.delta === 'changed');
  const offenders = checkpoints
    .filter((c) => c?.delta !== 'changed')
    .map((c) => `${c?.label ?? '(no label)'}: delta=${JSON.stringify(c?.delta)}`);
  const hasAfterFilmstrip = AFTER_FILMSTRIP_RAW_RE.test(prBody);
  const hasWebmLink = WEBM_LINK_RE.test(prBody);
  const hasCaveat = prBody.includes(PRIVATE_CAVEAT_TEXT);

  return [
    reason(
      "both AC checkpoints' delta is 'changed'",
      bothChanged,
      bothChanged
        ? '2 checkpoints, both changed'
        : `expected exactly 2 checkpoints, all changed — got ${checkpoints.length}` +
          (offenders.length > 0 ? `; not changed: ${offenders.join('; ')}` : ''),
    ),
    ...summaryReasons(checkpoints, essence, prBody),
    reason(
      'PR body inlines a commit-pinned after-side filmstrip image (?raw=true)',
      hasAfterFilmstrip,
      hasAfterFilmstrip ? 'present' : 'no blob/<sha>/…capture/after/….filmstrip.png?raw=true image line found',
    ),
    reason(
      'PR body links a .webm capture',
      hasWebmLink,
      hasWebmLink ? 'present' : 'no markdown link naming a .webm file found',
    ),
    reason(
      'PR body carries the private-repository rendering caveat',
      hasCaveat,
      hasCaveat ? 'present' : `expected the substring ${JSON.stringify(PRIVATE_CAVEAT_TEXT)} (pr-media.ts) — not found`,
    ),
  ];
}

/**
 * PASS/FAIL, with named reasons, for a real run's captured `demo.json` +
 * PR body (`gh pr view --json body`). `webmSizes`, when given, is
 * PASSED THROUGH verbatim for the report — never re-read from disk (this stays
 * pure): `[{path, bytes}, …]`, one entry per committed `.webm` the caller
 * already `statSync`'d, so the JSON evidence report can carry the size bound
 * check without this function touching a filesystem.
 *
 * @param {ReturnType<typeof planRun>} plan
 * @param {{demoJson: unknown, prBody: string, webmSizes?: {path: string, bytes: number}[]}} evidence
 */
export function judgeRun(plan, { demoJson, prBody, webmSizes } = {}) {
  if (!plan || !SUPPORTED_KINDS.includes(plan.kind)) {
    throw new TypeError('judgeRun: plan.kind must be one of ' + SUPPORTED_KINDS.join('|'));
  }
  if (typeof prBody !== 'string') {
    throw new TypeError('judgeRun: prBody must be a string (the PR body text)');
  }
  const checkpoints = checkpointsOf(demoJson);
  const essence = essenceOf(demoJson);
  const reasons = plan.kind === 'control' ? judgeControl(checkpoints, essence, prBody) : judgePositive(checkpoints, essence, prBody);
  const pass = reasons.every((r) => r.pass);

  return deepFreeze({
    kind: plan.kind,
    pass,
    reasons,
    webmSizes: Array.isArray(webmSizes) ? webmSizes.map((w) => ({ path: w.path, bytes: w.bytes })) : [],
  });
}
