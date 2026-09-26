/**
 * d12-demo-runs.test.ts — the pure core (`d12-demo-runs-core.mjs`) for the two
 * demo-pipeline verification runs (`forge-1rk5.3`): `control` and `positive`.
 *
 * The effectful shell (`d12-demo-runs.mjs`) is exercised only through its
 * `--plan-only` mode here (pure, touches nothing) — every live/dry-run mode is
 * the lane's job, never this suite's (it boots Studio, spawns an agent, and
 * touches GitHub).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  SUPPORTED_KINDS,
  DEFAULT_REMOTE_ACCOUNT,
  planRun,
  renderManifest,
  renderWorkItem,
  renderPlanOnly,
  judgeRun,
  hardClauseFailures,
} from './d12-demo-runs-core.mjs';

import { parseManifest } from '../../packages/flows/manifest.ts';
import { parseWorkItem, readWorkItemsFromDir, writeWorkItem } from '../../packages/flows/work-item.ts';
import { extractDrivableCommand } from '../../packages/contracts/demo-declaration.ts';
import { deriveDeltaSummary, deriveDemoModel } from '../../packages/stations/phases/derive-demo-model.ts';
import { derivePrBody } from '../../packages/stations/phases/derive-pr-body.ts';
import { embedDemoInPr, stripDemoSection } from '../../packages/flows/pr.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = join(HERE, 'd12-demo-runs.mjs');
const FAKE_FORGE_ROOT = '/tmp/d12-fake-forge-root';
const FIXED_NOW = new Date('2026-09-27T00:00:00.000Z');

function plan(kind, overrides = {}) {
  return planRun(kind, { forgeRoot: FAKE_FORGE_ROOT, now: FIXED_NOW, ...overrides });
}

// ---------------------------------------------------------------------------
// planRun — validation
// ---------------------------------------------------------------------------

describe('planRun validation', () => {
  test('accepts exactly control and positive', () => {
    assert.deepEqual(SUPPORTED_KINDS, ['control', 'positive']);
    assert.doesNotThrow(() => plan('control'));
    assert.doesNotThrow(() => plan('positive'));
  });

  test('refuses an unknown kind', () => {
    assert.throws(() => plan('sideways'), /kind must be one of control\|positive/);
  });

  test('refuses an unknown option key', () => {
    assert.throws(() => plan('control', { bogus: true }), /unknown option "bogus"/);
  });

  test('refuses a remote name without the story-d12- prefix', () => {
    assert.throws(
      () => plan('control', { project: 'story-not-d12-shaped' }),
      /does not carry the "story-d12-" prefix/,
    );
  });

  test('defaults account to parsoFish and derives the remote name', () => {
    const p = plan('control');
    assert.equal(DEFAULT_REMOTE_ACCOUNT, 'parsoFish');
    assert.equal(p.account, 'parsoFish');
    assert.equal(p.remoteName, 'parsoFish/story-d12-control');
  });

  test('honours an account override in the remote name', () => {
    const p = plan('positive', { account: 'someoneElse' });
    assert.equal(p.remoteName, 'someoneElse/story-d12-positive');
  });

  test('derives storyId, project and initiative_id from kind + now', () => {
    const p = plan('control');
    assert.equal(p.storyId, 'd12-control');
    assert.equal(p.project, 'story-d12-control');
    assert.equal(p.initiativeId, 'INIT-2026-09-27-d12-control');
  });

  test('is deterministic: same kind + opts produce a deep-equal plan', () => {
    assert.deepEqual(plan('control'), plan('control'));
    assert.deepEqual(plan('positive'), plan('positive'));
  });

  test('the plan is frozen, deeply', () => {
    const p = plan('control');
    assert.ok(Object.isFrozen(p));
    assert.ok(Object.isFrozen(p.manifest));
    assert.ok(Object.isFrozen(p.workItem));
    assert.ok(Object.isFrozen(p.workItem.acceptance_criteria));
    assert.throws(() => { p.kind = 'positive'; }, TypeError);
  });

  test('per-kind cost ceilings are 10 for control and 15 for positive', () => {
    assert.equal(plan('control').costCeilingUsd, 10);
    assert.equal(plan('positive').costCeilingUsd, 15);
  });

  test('worktreePath and projectRepoPath are anchored under the given forgeRoot', () => {
    const p = plan('control');
    assert.equal(p.projectRepoPath, `${FAKE_FORGE_ROOT}/projects/story-d12-control`);
    assert.equal(p.worktreePath, `${FAKE_FORGE_ROOT}/_worktrees/${p.initiativeId}`);
    assert.equal(p.branch, `forge/${p.initiativeId}`);
  });
});

// ---------------------------------------------------------------------------
// renderManifest / renderWorkItem — round-trip through the repo's own parsers
// ---------------------------------------------------------------------------

describe('renderManifest / renderWorkItem round-trip', () => {
  for (const kind of SUPPORTED_KINDS) {
    test(`${kind}: renderManifest round-trips through parseManifest`, () => {
      const p = plan(kind);
      const text = renderManifest(p);
      const parsed = parseManifest(text);
      assert.equal(parsed.initiative_id, p.initiativeId);
      assert.equal(parsed.project, p.project);
      assert.equal(parsed.project_repo_path, p.projectRepoPath);
      assert.equal(parsed.phase, 'pending');
      assert.equal(parsed.origin, 'human-directed');
      assert.equal(parsed.class, 'code');
      assert.equal(parsed.flow_id, 'forge-architect');
      assert.equal(parsed.disposable, true);
      assert.deepEqual(parsed.acceptance_criteria, p.manifest.acceptance_criteria);
    });

    test(`${kind}: renderWorkItem round-trips through parseWorkItem`, () => {
      const p = plan(kind);
      const text = renderWorkItem(p);
      const parsed = parseWorkItem(text);
      assert.equal(parsed.work_item_id, 'WI-1');
      assert.equal(parsed.initiative_id, p.initiativeId);
      assert.equal(parsed.status, 'pending');
      assert.deepEqual(parsed.files_in_scope, p.workItem.files_in_scope);
      assert.deepEqual(parsed.acceptance_criteria, p.workItem.acceptance_criteria);
      assert.deepEqual(parsed.quality_gate_cmd, ['npm', 'test']);
      assert.deepEqual(parsed.depends_on, []);
    });
  }

  test('control carries behavior_preserving: true; positive omits it', () => {
    const control = parseWorkItem(renderWorkItem(plan('control')));
    const positive = parseWorkItem(renderWorkItem(plan('positive')));
    assert.equal(control.behavior_preserving, true);
    assert.equal(positive.behavior_preserving, undefined);
  });

  test('a rendered WI-1.md, written to a real dir, round-trips through readWorkItemsFromDir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'd12-wi-'));
    try {
      const p = plan('positive');
      writeWorkItem(p.workItem, dir, { workItemsDir: dir });
      const { items, parseErrors } = readWorkItemsFromDir(dir);
      assert.deepEqual(parseErrors, {});
      assert.equal(items.length, 1);
      assert.equal(items[0].work_item_id, 'WI-1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Every AC's WHEN clause must be a drivable command (the checkpoint source)
// ---------------------------------------------------------------------------

describe('acceptance-criteria commands are drivable checkpoints', () => {
  for (const kind of SUPPORTED_KINDS) {
    const p = plan(kind);
    p.workItem.acceptance_criteria.forEach((ac, i) => {
      test(`${kind} AC${i + 1}'s WHEN clause extracts a bare, drivable command`, () => {
        const result = extractDrivableCommand(ac.when);
        assert.equal(result.ok, true, `AC${i + 1} when=${JSON.stringify(ac.when)} did not extract: ${JSON.stringify(result)}`);
      });
    });
  }

  test('control AC commands are exactly npm test and npm run demo', () => {
    const p = plan('control');
    const commands = p.workItem.acceptance_criteria.map((ac) => extractDrivableCommand(ac.when).command);
    assert.deepEqual(commands, ['npm test', 'npm run demo']);
  });

  test('positive AC commands are exactly node dist/cli.js --help and npm run demo', () => {
    const p = plan('positive');
    const commands = p.workItem.acceptance_criteria.map((ac) => extractDrivableCommand(ac.when).command);
    assert.deepEqual(commands, ['node dist/cli.js --help', 'npm run demo']);
  });
});

// ---------------------------------------------------------------------------
// judgeRun — PASS/FAIL per kind, against the REAL derivePrBody +
// embedDemoInPr output (packages/stations/phases/derive-pr-body.ts,
// packages/flows/pr.ts) — never a hand-typed sentence or a synthetic body.
// ---------------------------------------------------------------------------

function sh(cwd, args) {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

/** A real git repo, on `main`, one base commit, `origin` pointed at a GitHub
 *  URL — never pushed; `embedDemoInPr`'s `githubOwnerRepoForWorktree` only
 *  reads `git remote get-url origin` locally. Same technique
 *  `packages/flows/tests/integration/pr.test.ts`'s `makeRepoWithOrigin` +
 *  `pointOriginAtGitHub` use. */
function makeGithubRepo(remoteName) {
  const root = mkdtempSync(join(tmpdir(), 'd12-judge-repo-'));
  sh(root, ['init', '-q', '-b', 'main']);
  sh(root, ['config', 'user.email', 't@forge']);
  sh(root, ['config', 'user.name', 'forge-test']);
  sh(root, ['remote', 'add', 'origin', `https://github.com/${remoteName}.git`]);
  writeFileSync(join(root, 'README.md'), 'base\n');
  sh(root, ['add', '.']);
  sh(root, ['commit', '-q', '-m', 'base']);
  return root;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const WEBM_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

/** Seed + commit `<repo>/demo/<initiativeId>/` (no `.forge/project.json` in
 *  this tmp repo, so `artifactRoot` defaults to `.` — same convention
 *  `pr.test.ts`'s own `seedCaptureDemo` fixture uses). Unless
 *  `includeMedia` is false, one committed before+after filmstrip and one
 *  committed after-side webm are added too. Returns the demo dir + the real
 *  commit sha `embedDemoInPr` pins its links to. */
function seedDemoBundle(repo, initiativeId, { includeMedia }) {
  const relDir = `demo/${initiativeId}`;
  const demoDir = join(repo, relDir);
  mkdirSync(demoDir, { recursive: true });
  writeFileSync(join(demoDir, 'demo.json'), '{"title":"t"}\n');
  writeFileSync(join(demoDir, 'DEMO.md'), '# demo\n');
  const add = [`${relDir}/demo.json`, `${relDir}/DEMO.md`];
  if (includeMedia) {
    mkdirSync(join(demoDir, '.capture', 'before'), { recursive: true });
    mkdirSync(join(demoDir, '.capture', 'after'), { recursive: true });
    writeFileSync(join(demoDir, '.capture', 'before', 'checkpoint.filmstrip.png'), PNG_MAGIC);
    writeFileSync(join(demoDir, '.capture', 'after', 'checkpoint.filmstrip.png'), PNG_MAGIC);
    writeFileSync(join(demoDir, '.capture', 'after', 'checkpoint.webm'), WEBM_MAGIC);
    add.push(
      `${relDir}/.capture/before/checkpoint.filmstrip.png`,
      `${relDir}/.capture/after/checkpoint.filmstrip.png`,
      `${relDir}/.capture/after/checkpoint.webm`,
    );
  }
  sh(repo, ['add', ...add]);
  sh(repo, ['commit', '-q', '-m', 'demo capture']);
  const sha = sh(repo, ['rev-parse', 'HEAD']).trim();
  return { demoDir, sha };
}

/** The fixture ground's own declared demoProcess
 *  (tests/stories/grounds/node-cli-with-tests/seed/.forge/project.json) — one
 *  `capture` step naming `npm run demo`, the exact command every plan's AC2
 *  also names (so `deriveDemoModel` dedupes it against the AC-derived
 *  checkpoint rather than doubling it — see `acDerivedCheckpoints`). */
const FIXTURE_DEMO_PROCESS = Object.freeze([
  Object.freeze({
    kind: 'capture',
    text: 'Run `npm run demo` to build a deterministic fixture git repo, execute the built gitpulse CLI against it, and capture the real generated analytics report.',
  }),
]);

/**
 * The REAL demo model + REAL PR body for one run. Calls, in order:
 *   1. `deriveDemoModel` (the AC-derived checkpoints, deduped against
 *      `FIXTURE_DEMO_PROCESS`) — never hand-built.
 *   2. Stamps `delta` on each checkpoint (`deltas`, positional) — the one
 *      thing a real capture pass would have computed from before/after
 *      evidence; nothing here re-derives THAT comparison, only feeds its
 *      result forward, same as `judgeRun` itself takes it as input.
 *   3. `deriveDeltaSummary` + `reviseAfterCapture`'s own essence formula
 *      (`${baseEssence} ${deltaSummary}`.trim()) for `demoJson.essence`.
 *   4. `derivePrBody` for the base body, `embedDemoInPr` for the `## Demo`
 *      block, combined EXACTLY as `openPullRequest` combines them
 *      (`stripDemoSection(base) + '\n' + demoBlock`).
 * Nothing in this function, or in `judgeRun`, types the sentences being
 * checked for — every one of them is the real function's own output.
 */
function buildRealArtifacts(p, { deltas, includeMedia, isPrivate }) {
  const repo = makeGithubRepo(p.remoteName);
  try {
    const input = {
      initiativeId: p.initiativeId,
      title: p.manifest.title,
      project: p.project,
      diffStat: ' 1 file changed, 1 insertion(+)',
      headSha: 'pending',
      changedFiles: p.workItem.files_in_scope,
      workItems: [{ id: 'WI-1', title: p.manifest.title, status: 'complete' }],
      acceptanceCriteria: p.workItem.acceptance_criteria.map((ac) => ({ workItemId: 'WI-1', ...ac })),
      gateEvidence: [],
      demoProcess: FIXTURE_DEMO_PROCESS,
      capture: 'checkpoints',
    };
    const derived = deriveDemoModel(input);
    assert.ok(derived.ok, `deriveDemoModel failed: ${JSON.stringify(derived.errors ?? derived)}`);
    assert.equal(
      derived.model.checkpoints.length,
      2,
      'expected exactly the 2 AC-derived checkpoints (the demoProcess one dedupes against AC2)',
    );

    const checkpoints = derived.model.checkpoints.map((c, i) => ({ ...c, delta: deltas[i] }));
    const deltaSummary = deriveDeltaSummary(checkpoints);
    const essence = deltaSummary ? `${derived.model.essence} ${deltaSummary}`.trim() : derived.model.essence;
    const model = { ...derived.model, essence, checkpoints };

    const { demoDir, sha } = seedDemoBundle(repo, p.initiativeId, { includeMedia });
    const prInput = { ...input, headSha: sha };
    const prBase = derivePrBody(model, prInput);
    const demoBlock = embedDemoInPr(repo, p.initiativeId, sha, demoDir, isPrivate);
    const prBody = demoBlock ? `${stripDemoSection(prBase)}\n${demoBlock}\n` : prBase;

    return { demoJson: { essence, checkpoints }, prBody, deltaSummary };
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

describe('judgeRun — control (real derivePrBody + embedDemoInPr output)', () => {
  const p = plan('control');

  test('PASSes on a real, fully-unchanged private-repo run', () => {
    const { demoJson, prBody, deltaSummary } = buildRealArtifacts(p, {
      deltas: ['unchanged', 'unchanged'],
      includeMedia: true,
      isPrivate: true,
    });
    assert.equal(deltaSummary, 'No observable behaviour change was captured.');
    assert.ok(prBody.includes(deltaSummary), 'sanity: the real PR body really carries the real sentence');
    const verdict = judgeRun(p, { demoJson, prBody });
    assert.equal(verdict.pass, true, JSON.stringify(verdict.reasons, null, 2));
    assert.equal(verdict.reasons.length, 5);
  });

  test('FAILs when one checkpoint reads changed', () => {
    const { demoJson, prBody } = buildRealArtifacts(p, {
      deltas: ['changed', 'unchanged'],
      includeMedia: true,
      isPrivate: true,
    });
    const verdict = judgeRun(p, { demoJson, prBody });
    assert.equal(verdict.pass, false);
    assert.equal(verdict.reasons.find((r) => r.name.includes("delta is 'unchanged'")).pass, false);
  });

  test('FAILs when no capture media was committed at all', () => {
    const { demoJson, prBody } = buildRealArtifacts(p, {
      deltas: ['unchanged', 'unchanged'],
      includeMedia: false,
      isPrivate: true,
    });
    assert.ok(!/\.filmstrip\.png/.test(prBody), 'sanity: the real body really has no filmstrip reference');
    const verdict = judgeRun(p, { demoJson, prBody });
    assert.equal(verdict.pass, false);
    assert.equal(verdict.reasons.find((r) => r.name.includes('filmstrip image evidence')).pass, false);
  });
});

describe('judgeRun — positive (real derivePrBody + embedDemoInPr output)', () => {
  const p = plan('positive');

  test('PASSes on a real, fully-changed private-repo run', () => {
    const { demoJson, prBody, deltaSummary } = buildRealArtifacts(p, {
      deltas: ['changed', 'changed'],
      includeMedia: true,
      isPrivate: true,
    });
    assert.equal(deltaSummary, '2 of 2 captured checkpoints changed behaviour.');
    assert.match(
      prBody,
      /!\[[^\]]* — after\]\(https:\/\/github\.com\/parsoFish\/story-d12-positive\/blob\/[0-9a-f]{40}\/demo\/[^)]*\.capture\/after\/[^)]*\.filmstrip\.png\?raw=true\)/,
    );
    assert.match(prBody, /\[▶ [^\]]* — after \(webm\)\]\([^)]*\.webm\)/);
    assert.ok(prBody.includes("needs the viewer's github.com session"), 'sanity: the real caveat text is really there');
    const verdict = judgeRun(p, { demoJson, prBody });
    assert.equal(verdict.pass, true, JSON.stringify(verdict.reasons, null, 2));
    assert.equal(verdict.reasons.length, 6);
  });

  test('FAILs on a PUBLIC repo run — no private-session caveat is ever emitted', () => {
    const { demoJson, prBody } = buildRealArtifacts(p, {
      deltas: ['changed', 'changed'],
      includeMedia: true,
      isPrivate: false,
    });
    assert.ok(!prBody.includes("needs the viewer's github.com session"));
    const verdict = judgeRun(p, { demoJson, prBody });
    assert.equal(verdict.pass, false);
    assert.equal(verdict.reasons.find((r) => r.name.includes('private-repository rendering caveat')).pass, false);
  });

  test('FAILs when only one checkpoint changed', () => {
    const { demoJson, prBody } = buildRealArtifacts(p, {
      deltas: ['unchanged', 'changed'],
      includeMedia: true,
      isPrivate: true,
    });
    const verdict = judgeRun(p, { demoJson, prBody });
    assert.equal(verdict.pass, false);
    assert.equal(verdict.reasons.find((r) => r.name.includes("delta is 'changed'")).pass, false);
  });

  test('FAILs when the media block is absent entirely', () => {
    const { demoJson, prBody } = buildRealArtifacts(p, {
      deltas: ['changed', 'changed'],
      includeMedia: false,
      isPrivate: true,
    });
    const verdict = judgeRun(p, { demoJson, prBody });
    assert.equal(verdict.pass, false);
    assert.equal(verdict.reasons.find((r) => r.name.includes('commit-pinned after-side filmstrip')).pass, false);
    assert.equal(verdict.reasons.find((r) => r.name.includes('links a .webm')).pass, false);
    // isPrivate is still true, but buildCaptureMediaBlock only adds the caveat
    // when it actually inlined something — with no media committed, it inlined nothing.
    assert.equal(verdict.reasons.find((r) => r.name.includes('private-repository rendering caveat')).pass, false);
  });

  test('reports webmSizes verbatim when given, and [] when omitted', () => {
    const demoJson = { essence: '', checkpoints: [] };
    const withSizes = judgeRun(p, { demoJson, prBody: '', webmSizes: [{ path: '/tmp/a.webm', bytes: 12345 }] });
    assert.deepEqual(withSizes.webmSizes, [{ path: '/tmp/a.webm', bytes: 12345 }]);
    const withoutSizes = judgeRun(p, { demoJson, prBody: '' });
    assert.deepEqual(withoutSizes.webmSizes, []);
  });
});

// ---------------------------------------------------------------------------
// --plan-only — pure CLI mode, touches nothing
// ---------------------------------------------------------------------------

describe('--plan-only', () => {
  test('renderPlanOnly embeds the rendered manifest and work item verbatim', () => {
    const p = plan('control');
    const out = renderPlanOnly(p);
    assert.match(out, /PLAN ONLY \(control\)/);
    assert.match(out, new RegExp(p.initiativeId));
    assert.ok(out.includes(renderManifest(p)));
    assert.ok(out.includes(renderWorkItem(p)));
    for (const c of p.expectedPassCriteria) assert.ok(out.includes(c));
  });

  test('the CLI --plan-only mode prints the plan and exits 0, touching nothing on disk', () => {
    const out = execFileSync(
      process.execPath,
      ['--experimental-strip-types', DRIVER, 'positive', '--plan-only'],
      { encoding: 'utf8' },
    );
    assert.match(out, /PLAN ONLY \(positive\)/);
    assert.match(out, /INIT-\d{4}-\d{2}-\d{2}-d12-positive/);
    assert.match(out, /story-d12-positive/);
  });

  test('the CLI refuses an unknown kind before touching anything', () => {
    assert.throws(() => {
      execFileSync(process.execPath, ['--experimental-strip-types', DRIVER, 'sideways', '--plan-only'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }, /Command failed/);
  });
});

test('hardClauseFailures names every failing HARD clause with its detail, and ignores advisory ones (row 128)', () => {
  const report = { ok: false, clauses: [
    { clause: 'C1', hard: true, pass: true, detail: 'ok' },
    { clause: 'C4', hard: true, pass: false, detail: 'missing brain/projects/x/profile.md' },
    { clause: 'DEMO-SKILL', hard: false, pass: false, detail: 'advisory' },
  ] };
  assert.deepEqual(hardClauseFailures(report), ['C4: missing brain/projects/x/profile.md']);
  assert.deepEqual(hardClauseFailures({ ok: true, clauses: [{ clause: 'C4', hard: true, pass: true, detail: '' }] }), []);
  assert.deepEqual(hardClauseFailures(undefined), ['preflight report unavailable'], 'an absent report is never "no failures"');
});

