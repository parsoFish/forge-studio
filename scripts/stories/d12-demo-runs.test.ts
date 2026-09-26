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
} from './d12-demo-runs-core.mjs';

import { parseManifest } from '../../packages/flows/manifest.ts';
import { parseWorkItem, readWorkItemsFromDir, writeWorkItem } from '../../packages/flows/work-item.ts';
import { extractDrivableCommand } from '../../packages/contracts/demo-declaration.ts';

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

  test('a rendered WI-1.md, written to a real dir, round-trips through readWorkItemsFromDir', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
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
// judgeRun — PASS/FAIL per kind
// ---------------------------------------------------------------------------

/** A PR body carrying every positive-only marker `judgeRun` looks for. */
const POSITIVE_PASS_BODY = [
  '# forge: INIT-2026-09-27-d12-positive',
  '',
  '## How',
  '',
  '- `node dist/cli.js --help` — usage text documents --exclude-author (changed)',
  '- `npm run demo` — exclude-author report omits Grace Hopper (changed)',
  '',
  '2 of 2 captured checkpoints changed behaviour.',
  '',
  '![after](https://github.com/parsoFish/story-d12-positive/blob/abc1234567/.capture/after/ac-2-demo.filmstrip.png?raw=true)',
  '',
  '[after capture](https://github.com/parsoFish/story-d12-positive/blob/abc1234567/.capture/after/ac-2-demo.webm?raw=true)',
  '',
  '_This repository is private — embedded images and video links may not render for reviewers without repo access._',
  '',
].join('\n');

const CONTROL_PASS_BODY = [
  '# forge: INIT-2026-09-27-d12-control',
  '',
  '## How',
  '',
  '- `npm test` — every test stays green (unchanged)',
  '- `npm run demo` — printed report is byte-identical (unchanged)',
  '',
  'No observable behaviour change was captured.',
  '',
  '![before](https://github.com/parsoFish/story-d12-control/blob/def7654321/.capture/before/ac-2-demo.filmstrip.png?raw=true)',
  '![after](https://github.com/parsoFish/story-d12-control/blob/def7654321/.capture/after/ac-2-demo.filmstrip.png?raw=true)',
  '',
].join('\n');

describe('judgeRun — control', () => {
  const p = plan('control');

  test('PASSes when every checkpoint is unchanged and the body carries the honest sentences', () => {
    const demoJson = {
      essence: `${p.workItem.body.split('\n')[0]} No observable behaviour change was captured.`,
      checkpoints: [
        { label: 'AC 1: WI-1', delta: 'unchanged' },
        { label: 'AC 2: WI-1', delta: 'unchanged' },
      ],
    };
    const verdict = judgeRun(p, { demoJson, prBody: CONTROL_PASS_BODY });
    assert.equal(verdict.pass, true, JSON.stringify(verdict.reasons, null, 2));
    assert.equal(verdict.reasons.length, 5);
    assert.ok(verdict.reasons.every((r) => r.pass));
  });

  test('FAILs when one checkpoint reads changed', () => {
    const demoJson = {
      essence: 'x 1 of 2 captured checkpoints changed behaviour.',
      checkpoints: [
        { label: 'AC 1: WI-1', delta: 'changed' },
        { label: 'AC 2: WI-1', delta: 'unchanged' },
      ],
    };
    const verdict = judgeRun(p, { demoJson, prBody: CONTROL_PASS_BODY });
    assert.equal(verdict.pass, false);
    const row = verdict.reasons.find((r) => r.name.includes("delta is 'unchanged'"));
    assert.equal(row.pass, false);
  });

  test('FAILs when the PR body makes a "changed behaviour" claim', () => {
    const demoJson = {
      essence: 'No observable behaviour change was captured.',
      checkpoints: [
        { label: 'AC 1: WI-1', delta: 'unchanged' },
        { label: 'AC 2: WI-1', delta: 'unchanged' },
      ],
    };
    const body = `${CONTROL_PASS_BODY}\n1 of 2 captured checkpoints changed behaviour.\n`;
    const verdict = judgeRun(p, { demoJson, prBody: body });
    assert.equal(verdict.pass, false);
    const row = verdict.reasons.find((r) => r.name.includes('no "changed behaviour" claim'));
    assert.equal(row.pass, false);
  });

  test('FAILs when the PR body has no filmstrip image line', () => {
    const demoJson = {
      essence: 'No observable behaviour change was captured.',
      checkpoints: [
        { label: 'AC 1: WI-1', delta: 'unchanged' },
        { label: 'AC 2: WI-1', delta: 'unchanged' },
      ],
    };
    const body = 'No observable behaviour change was captured.\n(no images here)\n';
    const verdict = judgeRun(p, { demoJson, prBody: body });
    assert.equal(verdict.pass, false);
    const row = verdict.reasons.find((r) => r.name.includes('filmstrip image evidence'));
    assert.equal(row.pass, false);
  });
});

describe('judgeRun — positive', () => {
  const p = plan('positive');

  test('PASSes when both checkpoints are changed and the body carries every marker', () => {
    const demoJson = {
      essence: 'x 2 of 2 captured checkpoints changed behaviour.',
      checkpoints: [
        { label: 'AC 1: WI-1', delta: 'changed' },
        { label: 'AC 2: WI-1', delta: 'changed' },
      ],
    };
    const verdict = judgeRun(p, { demoJson, prBody: POSITIVE_PASS_BODY });
    assert.equal(verdict.pass, true, JSON.stringify(verdict.reasons, null, 2));
    assert.equal(verdict.reasons.length, 6);
    assert.ok(verdict.reasons.every((r) => r.pass));
  });

  test('FAILs when only one checkpoint changed', () => {
    const demoJson = {
      essence: 'x 1 of 2 captured checkpoints changed behaviour.',
      checkpoints: [
        { label: 'AC 1: WI-1', delta: 'unchanged' },
        { label: 'AC 2: WI-1', delta: 'changed' },
      ],
    };
    const verdict = judgeRun(p, { demoJson, prBody: POSITIVE_PASS_BODY });
    assert.equal(verdict.pass, false);
    const row = verdict.reasons.find((r) => r.name.includes("delta is 'changed'"));
    assert.equal(row.pass, false);
  });

  test('FAILs when the PR body has no commit-pinned after-side filmstrip image', () => {
    const demoJson = {
      essence: '2 of 2 captured checkpoints changed behaviour.',
      checkpoints: [
        { label: 'AC 1: WI-1', delta: 'changed' },
        { label: 'AC 2: WI-1', delta: 'changed' },
      ],
    };
    const body = POSITIVE_PASS_BODY.replace(/!\[after\]\([^)]*\)\n\n/, '');
    const verdict = judgeRun(p, { demoJson, prBody: body });
    assert.equal(verdict.pass, false);
    const row = verdict.reasons.find((r) => r.name.includes('commit-pinned after-side filmstrip'));
    assert.equal(row.pass, false);
  });

  test('FAILs when the PR body has no private-repo caveat', () => {
    const demoJson = {
      essence: '2 of 2 captured checkpoints changed behaviour.',
      checkpoints: [
        { label: 'AC 1: WI-1', delta: 'changed' },
        { label: 'AC 2: WI-1', delta: 'changed' },
      ],
    };
    const body = POSITIVE_PASS_BODY.replace(/_This repository is private[^\n]*\n/, '');
    const verdict = judgeRun(p, { demoJson, prBody: body });
    assert.equal(verdict.pass, false);
    const row = verdict.reasons.find((r) => r.name.includes('private-repository rendering caveat'));
    assert.equal(row.pass, false);
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
