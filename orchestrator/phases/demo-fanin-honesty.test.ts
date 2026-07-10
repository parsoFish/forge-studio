/**
 * demo-fanin-honesty.ts — TDD (refinement plan 2.5).
 *
 * After the unifier fans in per-WI work, demo.json metadata can still describe
 * pre-fan-in state:
 *   - diffStat authored hours earlier no longer matches `git diff --stat
 *     main...HEAD` (2026-07-03 stale-demo-metadata theme: 84 files vs 172, a
 *     full unifier iteration burned on manual correction);
 *   - embedded checkpoint liveEvidence ids reference a resource from an
 *     EARLIER acceptance run while `.forge/live-evidence/` on the branch holds
 *     the current one (2026-07-03 live-evidence-id theme: 886543 vs 886548 —
 *     operator send-back).
 *
 * The check re-derives diff truth (mechanical git metadata → refreshed in
 * place, orchestrator-owned) and validates evidence identity + initiative
 * references (stale = HONEST failure, surfaced with specifics — never a
 * silent pass, never a vague fail).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkDemoFanInHonesty } from './demo-fanin-honesty.ts';

const INIT = 'INIT-2026-07-01-new-api-notification';

/** A branch worktree: main baseline, then a feature branch with 2 committed files. */
function gitWorktree(): { wt: string; git: (...args: string[]) => string; cleanup: () => void } {
  const wt = mkdtempSync(join(tmpdir(), 'forge-fanin-'));
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: wt, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@forge.test');
  git('config', 'user.name', 'forge-test');
  writeFileSync(join(wt, 'README.md'), '# base\n');
  git('add', '-A');
  git('commit', '-m', 'base');
  git('checkout', '-b', 'forge/init-test');
  writeFileSync(join(wt, 'a.txt'), 'aaa\n');
  writeFileSync(join(wt, 'b.txt'), 'bbb\n');
  git('add', '-A');
  git('commit', '-m', 'feat: work');
  return { wt, git, cleanup: () => rmSync(wt, { recursive: true, force: true }) };
}

/** The real `git diff --stat main...HEAD` for the harness worktree. */
function realDiffStat(wt: string): string {
  return execFileSync('git', ['diff', '--stat', 'main...HEAD'], {
    cwd: wt,
    stdio: 'pipe',
    encoding: 'utf8',
  }).trim();
}

type DemoOverrides = Record<string, unknown>;

/** Write a schema-valid demo.json fixture into demo/<INIT>/ and return its path. */
function writeDemo(wt: string, overrides: DemoOverrides = {}): string {
  const dir = join(wt, 'demo', INIT);
  mkdirSync(dir, { recursive: true });
  const model = {
    title: 'Notification subscriptions',
    essence: 'adds azuredevops_notification_subscription',
    project: 'terraform-provider-betterado',
    initiativeId: INIT,
    diffStat: realDiffStat(wt),
    checkpoints: [
      {
        label: 'acceptance-resource',
        kind: 'harness',
        caption: 'Live subscription GET',
      },
    ],
    ...overrides,
  };
  const p = join(dir, 'demo.json');
  writeFileSync(p, JSON.stringify(model, null, 2));
  return p;
}

function writeLiveEvidence(wt: string, url: string): void {
  const dir = join(wt, '.forge', 'live-evidence');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'acceptance-resource.json'),
    JSON.stringify({ label: 'acceptance-resource', url, response: '{"id": "x"}' }),
  );
}

// ---------------------------------------------------------------------------
// diffStat — mechanical git truth, refreshed in place
// ---------------------------------------------------------------------------

test('fresh diffStat + no live evidence → ok, nothing refreshed', () => {
  const { wt, git, cleanup } = gitWorktree();
  try {
    const demoJsonPath = writeDemo(wt);
    git('add', '-A');
    git('commit', '-m', 'demo');
    // Re-write with the post-demo-commit diff so the stored stat matches HEAD truth.
    writeFileSync(
      demoJsonPath,
      JSON.stringify({ ...JSON.parse(readFileSync(demoJsonPath, 'utf8')), diffStat: realDiffStat(wt) }, null, 2),
    );
    const before = readFileSync(demoJsonPath, 'utf8');
    const res = checkDemoFanInHonesty({ worktreePath: wt, demoJsonPath, initiativeId: INIT });
    assert.equal(res.ok, true);
    assert.deepEqual(res.failures, []);
    assert.equal(res.refreshedDiffStat, undefined);
    assert.equal(readFileSync(demoJsonPath, 'utf8'), before, 'demo.json untouched when fresh');
  } finally {
    cleanup();
  }
});

test('stale diffStat (file count diverged after fan-in) → refreshed in place + DEMO.md re-derived', () => {
  const { wt, git, cleanup } = gitWorktree();
  try {
    const demoJsonPath = writeDemo(wt, { diffStat: ' 1 file changed, 1 insertion(+)' });
    git('add', '-A');
    git('commit', '-m', 'demo');
    // Fan-in reality: another file lands on the branch AFTER the demo was authored.
    writeFileSync(join(wt, 'c.txt'), 'ccc\n');
    git('add', '-A');
    git('commit', '-m', 'feat: late fan-in');

    const res = checkDemoFanInHonesty({ worktreePath: wt, demoJsonPath, initiativeId: INIT });
    assert.equal(res.ok, true, 'diffStat staleness is refreshable metadata, not an honesty failure');
    assert.ok(res.refreshedDiffStat, 'refresh recorded');
    assert.match(res.refreshedDiffStat!.from, /1 file changed/);
    assert.match(res.refreshedDiffStat!.to, /files changed/);

    const rewritten = JSON.parse(readFileSync(demoJsonPath, 'utf8')) as { diffStat: string };
    assert.equal(rewritten.diffStat, realDiffStat(wt), 'demo.json carries the re-derived git truth');
    const demoMd = join(wt, 'demo', INIT, 'DEMO.md');
    assert.ok(existsSync(demoMd), 'derived DEMO.md re-rendered');
    assert.ok(readFileSync(demoMd, 'utf8').includes('c.txt'), 'DEMO.md shows the post-fan-in diff');
  } finally {
    cleanup();
  }
});

test('unparseable stored diffStat (no summary line) → refreshed with git truth', () => {
  const { wt, git, cleanup } = gitWorktree();
  try {
    const demoJsonPath = writeDemo(wt, { diffStat: 'TODO: fill in' });
    git('add', '-A');
    git('commit', '-m', 'demo');
    const res = checkDemoFanInHonesty({ worktreePath: wt, demoJsonPath, initiativeId: INIT });
    assert.equal(res.ok, true);
    assert.ok(res.refreshedDiffStat);
    const rewritten = JSON.parse(readFileSync(demoJsonPath, 'utf8')) as { diffStat: string };
    assert.match(rewritten.diffStat, /files? changed/);
  } finally {
    cleanup();
  }
});

test('no main/master base in the repo → diffStat check skipped (indeterminate, never false-fails)', () => {
  const wt = mkdtempSync(join(tmpdir(), 'forge-fanin-nobase-'));
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: wt, stdio: 'pipe', encoding: 'utf8' });
  try {
    git('init', '-b', 'work');
    git('config', 'user.email', 'test@forge.test');
    git('config', 'user.name', 'forge-test');
    const dir = join(wt, 'demo', INIT);
    mkdirSync(dir, { recursive: true });
    const demoJsonPath = join(dir, 'demo.json');
    writeFileSync(
      demoJsonPath,
      JSON.stringify({
        title: 't', essence: 'e', project: 'p', initiativeId: INIT,
        diffStat: ' 1 file changed, 1 insertion(+)',
        checkpoints: [{ label: 'x', caption: 'c' }],
      }),
    );
    git('add', '-A');
    git('commit', '-m', 'demo');
    const res = checkDemoFanInHonesty({ worktreePath: wt, demoJsonPath, initiativeId: INIT });
    assert.equal(res.ok, true);
    assert.equal(res.refreshedDiffStat, undefined);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// liveEvidence identity — stale ids are an HONEST failure, never auto-fixed
// ---------------------------------------------------------------------------

test('demo.json embeds a liveEvidence url absent from .forge/live-evidence → honest failure with specifics', () => {
  const { wt, git, cleanup } = gitWorktree();
  try {
    const demoJsonPath = writeDemo(wt, {
      checkpoints: [
        {
          label: 'acceptance-resource',
          kind: 'harness',
          caption: 'Live subscription GET',
          liveEvidence: { url: 'https://dev.azure.com/org/_apis/notification/subscriptions/886543' },
        },
      ],
    });
    git('add', '-A');
    git('commit', '-m', 'demo');
    writeFileSync(demoJsonPath, readFileSync(demoJsonPath, 'utf8')); // keep bytes identical
    // The CURRENT acceptance run (orchestrator-executed gate) persisted a NEWER resource.
    writeLiveEvidence(wt, 'https://dev.azure.com/org/_apis/notification/subscriptions/886548');

    const res = checkDemoFanInHonesty({ worktreePath: wt, demoJsonPath, initiativeId: INIT });
    assert.equal(res.ok, false);
    assert.equal(res.staleEvidence.length, 1);
    assert.equal(res.staleEvidence[0]!.label, 'acceptance-resource');
    assert.match(res.staleEvidence[0]!.url, /886543/);
    assert.deepEqual(res.freshEvidenceUrls, [
      'https://dev.azure.com/org/_apis/notification/subscriptions/886548',
    ]);
    assert.ok(
      res.failures.some((f) => f.includes('886543') && f.includes('886548')),
      `failure names BOTH the stale and the fresh id: ${JSON.stringify(res.failures)}`,
    );
  } finally {
    cleanup();
  }
});

test('demo.json liveEvidence matches the persisted evidence → ok', () => {
  const { wt, git, cleanup } = gitWorktree();
  try {
    const url = 'https://dev.azure.com/org/_apis/notification/subscriptions/886548';
    const demoJsonPath = writeDemo(wt, {
      checkpoints: [
        { label: 'acceptance-resource', kind: 'harness', caption: 'Live GET', liveEvidence: { url } },
      ],
    });
    git('add', '-A');
    git('commit', '-m', 'demo');
    writeLiveEvidence(wt, url);
    const res = checkDemoFanInHonesty({ worktreePath: wt, demoJsonPath, initiativeId: INIT });
    assert.equal(res.ok, true);
    assert.deepEqual(res.staleEvidence, []);
  } finally {
    cleanup();
  }
});

test('persisted live evidence NOT represented in demo.json at all → honest failure (demo pre-dates evidence)', () => {
  const { wt, git, cleanup } = gitWorktree();
  try {
    const demoJsonPath = writeDemo(wt); // checkpoint without liveEvidence
    git('add', '-A');
    git('commit', '-m', 'demo');
    writeLiveEvidence(wt, 'https://dev.azure.com/org/_apis/notification/subscriptions/886548');
    const res = checkDemoFanInHonesty({ worktreePath: wt, demoJsonPath, initiativeId: INIT });
    assert.equal(res.ok, false);
    assert.ok(
      res.failures.some((f) => f.includes('886548')),
      'failure names the unrepresented fresh evidence',
    );
  } finally {
    cleanup();
  }
});

test('no .forge/live-evidence dir → evidence check skipped', () => {
  const { wt, git, cleanup } = gitWorktree();
  try {
    const demoJsonPath = writeDemo(wt, {
      checkpoints: [
        {
          label: 'acceptance-resource',
          kind: 'harness',
          caption: 'Live GET',
          liveEvidence: { url: 'https://dev.azure.com/org/x/886543' },
        },
      ],
    });
    git('add', '-A');
    git('commit', '-m', 'demo');
    const res = checkDemoFanInHonesty({ worktreePath: wt, demoJsonPath, initiativeId: INIT });
    assert.equal(res.ok, true, 'nothing to compare against — not a staleness signal');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Initiative reference — a demo.json describing a DIFFERENT initiative
// ---------------------------------------------------------------------------

test('demo.json initiativeId names a different initiative → honest failure', () => {
  const { wt, git, cleanup } = gitWorktree();
  try {
    const demoJsonPath = writeDemo(wt, { initiativeId: 'INIT-2026-06-30-some-other-work' });
    git('add', '-A');
    git('commit', '-m', 'demo');
    const res = checkDemoFanInHonesty({ worktreePath: wt, demoJsonPath, initiativeId: INIT });
    assert.equal(res.ok, false);
    assert.ok(
      res.failures.some((f) => f.includes('INIT-2026-06-30-some-other-work') && f.includes(INIT)),
      'failure names both initiative ids',
    );
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Robustness — schema/parse problems belong to the pr_self_contained gate
// ---------------------------------------------------------------------------

test('missing or unparseable demo.json → ok (the schema gate owns that failure)', () => {
  const { wt, cleanup } = gitWorktree();
  try {
    const missing = checkDemoFanInHonesty({
      worktreePath: wt,
      demoJsonPath: join(wt, 'demo', INIT, 'demo.json'),
      initiativeId: INIT,
    });
    assert.equal(missing.ok, true);

    const dir = join(wt, 'demo', INIT);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'demo.json');
    writeFileSync(p, '{not json');
    const unparseable = checkDemoFanInHonesty({ worktreePath: wt, demoJsonPath: p, initiativeId: INIT });
    assert.equal(unparseable.ok, true);
  } finally {
    cleanup();
  }
});
