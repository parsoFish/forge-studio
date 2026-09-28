/**
 * sweep-cycle-artefacts.test.ts — row 146 (bead `forge-8vfn.8.1.52`).
 *
 * THE INCIDENT. S10 run 43 was STOPPED by the operator's SIGTERM to the
 * runner's process group. `run.mjs`'s own-artefacts clear only ever ran
 * inside its normal `finally` block, and Node terminates on SIGTERM without
 * running a pending `finally` (`sweep.mjs`'s own header) — so the clear never
 * ran, and `_logs/2026-09-28T03-48-26_INIT-…` plus
 * `_queue/done/INIT-….md` survived. The NEXT run's residue guard
 * (`.claude/skills/tiered-orchestration/scripts/residue.sh`) refused to
 * launch on them. Ruling 1911: "post-stop sweep = the guard's four targets,
 * incl. _queue/* and _logs/<ts>_INIT-*".
 *
 * `sweepCycleArtefacts` (split out of `sweepProductFixtures`, same file) is
 * the ONE place `claimQueueWrites` and `captureAndClearMintedRunArtefacts`
 * are called together — the normal trailing sweep and `run.mjs`'s SIGTERM/
 * SIGINT handler both call it, never a second copy of the claim-then-clear.
 * This file doors that function directly against the residue guard itself,
 * run for real on a fixture tree, rather than re-implementing its gating
 * rules a second time in TypeScript.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { sweepCycleArtefacts } from './sweep.mjs';
import { captureAndClearBornLogDirs } from './sweep-post-stop-logs.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'stories-sweep-cycle-'));

const RESIDUE_SCRIPT = join(
  import.meta.dirname, '..', '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'residue.sh',
);

/** A tree the residue guard can actually read: a real git repo with the same
 *  `.gitignore` rules the guard's own doors use (`scripts/residue.test.ts`),
 *  so gitignored queue/log/worktree entries do not read as porcelain. */
function initRepoFor(root: string): void {
  execFileSync('git', ['init', '-q', root]);
  writeFileSync(
    join(root, '.gitignore'),
    ['_logs/*', '_queue/pending/*', '_queue/in-flight/*', '_queue/ready-for-review/*',
      '_queue/done/*', '_queue/merged/*', '_queue/failed/*', '_worktrees/', '.gitignore',
    ].join('\n') + '\n',
  );
}

const runResidueGuard = (root: string) =>
  spawnSync('bash', [RESIDUE_SCRIPT, root], {
    encoding: 'utf8',
    // Off the host's real 4123/4124 — see `scripts/residue.test.ts`'s own note.
    env: { ...process.env, RESIDUE_STUDIO_PORTS: '18243,18244' },
  });

test('row 146: sweepCycleArtefacts captures then clears this run\'s own queue manifest, ' +
  'worktrees and logs cycle dir, and the residue guard reads clean afterwards', () => {
  const root = scratch();
  try {
    const id = 'INIT-2026-09-28-post-stop-sweep';
    const since = Date.now() - 60_000;

    mkdirSync(join(root, '_queue', 'done'), { recursive: true });
    writeFileSync(
      join(root, '_queue', 'done', `${id}.md`),
      `---\ninitiative_id: ${id}\nproject: gitpulse\ncreated_at: '${new Date().toISOString()}'\n---\n\n# x\n`,
    );
    mkdirSync(join(root, '_worktrees', id), { recursive: true });
    mkdirSync(join(root, '_worktrees', 'wi', id), { recursive: true });
    mkdirSync(join(root, '_logs', `2026-09-28T03-48-26_${id}`), { recursive: true });

    // Evidence lands under `_logs/`, gitignored same as every other capture
    // this run makes — a top-level `_evidence/` dir would itself be
    // untracked porcelain and confuse the very guard this test checks.
    const evidenceDir = join(root, '_logs', '_story-post-stop-sweep', 'stopped-run', String(since));
    const r = sweepCycleArtefacts('stopped-run', root, { sinceMs: since, evidenceDir }) as any;

    assert.equal(
      r.claim.claimed.length, 1,
      `expected the manifest to be claimed. Lines:\n${r.claim.lines.join('\n')}`,
    );
    assert.ok(existsSync(join(evidenceDir, 'done', `${id}.md`)), 'captured to evidence before removal');
    assert.equal(existsSync(join(root, '_queue', 'done', `${id}.md`)), false, 'manifest removed');
    assert.equal(existsSync(join(root, '_worktrees', id)), false, 'worktree cleared');
    assert.equal(existsSync(join(root, '_worktrees', 'wi', id)), false, 'wi worktree cleared');
    assert.deepEqual(existsSync(join(root, '_worktrees', 'wi')), false, 'the emptied wi container is gone');
    assert.equal(existsSync(join(root, '_logs', `2026-09-28T03-48-26_${id}`)), false, 'cycle dir cleared');

    initRepoFor(root);
    const guard = runResidueGuard(root);
    assert.equal(
      guard.status, 0,
      `expected the residue guard to read clean. Got:\n${guard.stdout}${guard.stderr}`,
    );
    assert.match(guard.stdout, /VERDICT clean/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('row 146 control: a dispatch dir and manifest from BEFORE this run\'s window are left alone', () => {
  const root = scratch();
  try {
    const olderId = 'INIT-2026-01-01-older-run';
    const since = Date.now() - 1_000;

    mkdirSync(join(root, '_queue', 'done'), { recursive: true });
    writeFileSync(
      join(root, '_queue', 'done', `${olderId}.md`),
      `---\ninitiative_id: ${olderId}\nproject: gitpulse\n` +
      `created_at: '2026-01-01T00:00:00.000Z'\n---\n\n# x\n`,
    );
    mkdirSync(join(root, '_worktrees', olderId), { recursive: true });
    mkdirSync(join(root, '_logs', `2026-01-01T00-00-00_${olderId}`), { recursive: true });

    const evidenceDir = join(root, '_logs', '_story-post-stop-sweep', 'stopped-run', String(since));
    const r = sweepCycleArtefacts('stopped-run', root, { sinceMs: since, evidenceDir }) as any;

    assert.equal(r.claim.claimed.length, 0, 'a manifest born before this run must never be claimed');
    assert.ok(
      r.claim.left.some((l: any) => l.path.endsWith(`${olderId}.md`)),
      `expected the older manifest to be LEFT, not claimed. Left:\n${JSON.stringify(r.claim.left)}`,
    );
    assert.equal(existsSync(join(root, '_queue', 'done', `${olderId}.md`)), true, 'older manifest untouched');
    assert.equal(
      existsSync(join(root, '_worktrees', olderId)), true,
      'older worktree untouched — never another run\'s',
    );
    assert.equal(
      existsSync(join(root, '_logs', `2026-01-01T00-00-00_${olderId}`)), true,
      'older cycle dir untouched',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * The follow-up: `residue.sh` also gates `_logs/_agent-*` and
 * `_logs/_authoring-*` (lines 68-69) — a stopped run strands a Studio agent
 * or authoring session exactly as it strands the queue/worktree/cycle-dir
 * targets above. `captureAndClearBornLogDirs` is the SAME born-time rule,
 * over the two families, in one loop.
 */
test('row 146: captureAndClearBornLogDirs clears _agent-*/_authoring-* dirs born in the ' +
  'window, and the residue guard reads clean afterwards', () => {
  const root = scratch();
  try {
    const since = Date.now() - 60_000;
    mkdirSync(join(root, '_logs', '_agent-2026-09-28T09-00-00'), { recursive: true });
    mkdirSync(join(root, '_logs', '_authoring-2026-09-28T09-05-00'), { recursive: true });

    const evidenceDir = join(root, '_logs', '_story-post-stop-sweep', 'stopped-run', String(since));
    const r = captureAndClearBornLogDirs(root, {
      prefixes: ['_agent-', '_authoring-'], sinceMs: since, evidenceDir,
    });

    assert.deepEqual(r.captured.sort(), ['_agent-2026-09-28T09-00-00', '_authoring-2026-09-28T09-05-00']);
    assert.deepEqual(r.cleared.sort(), r.captured.slice().sort());
    assert.equal(existsSync(join(root, '_logs', '_agent-2026-09-28T09-00-00')), false, 'agent dir cleared');
    assert.equal(
      existsSync(join(root, '_logs', '_authoring-2026-09-28T09-05-00')), false,
      'authoring dir cleared',
    );
    assert.equal(existsSync(join(evidenceDir, '_agent-2026-09-28T09-00-00')), true, 'agent dir captured');
    assert.equal(
      existsSync(join(evidenceDir, '_authoring-2026-09-28T09-05-00')), true,
      'authoring dir captured',
    );

    initRepoFor(root);
    const guard = runResidueGuard(root);
    assert.equal(
      guard.status, 0,
      `expected the residue guard to read clean. Got:\n${guard.stdout}${guard.stderr}`,
    );
    assert.match(guard.stdout, /VERDICT clean/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('row 146 control: _agent-*/_authoring-* dirs born BEFORE this run\'s window are left alone', () => {
  const root = scratch();
  try {
    const since = Date.now() - 60_000;
    const agentDir = join(root, '_logs', '_agent-2026-01-01T00-00-00');
    const authoringDir = join(root, '_logs', '_authoring-2026-01-01T00-00-00');
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(authoringDir, { recursive: true });
    const oldSeconds = (Date.now() - 3_600_000) / 1000;
    utimesSync(agentDir, oldSeconds, oldSeconds);
    utimesSync(authoringDir, oldSeconds, oldSeconds);

    const evidenceDir = join(root, '_logs', '_story-post-stop-sweep', 'stopped-run', String(since));
    const r = captureAndClearBornLogDirs(root, {
      prefixes: ['_agent-', '_authoring-'], sinceMs: since, evidenceDir,
    });

    assert.deepEqual(r.captured, [], 'a dir born before this run must never be captured');
    assert.equal(existsSync(agentDir), true, 'older agent dir untouched — never another run\'s');
    assert.equal(existsSync(authoringDir), true, 'older authoring dir untouched — never another run\'s');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
