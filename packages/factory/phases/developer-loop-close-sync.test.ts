/**
 * Tests for the dev-loop's close-step local↔remote invariant assertion
 * (S1.3 — `assertLocalRemoteSynced` at dev-loop close).
 *
 * The dev-loop owns its own boundary-level invariant check at close —
 * separate from (and additional to) the orchestrator-level check in
 * `cycle.ts:enforceDevLoopCloseInvariant`. A per-WI push could fail
 * silently mid-loop (a transient network blip); the close-step assert
 * is the dev-loop's last chance to fail FAST with a phase-scoped,
 * classified event before handing off to the reviewer.
 *
 * `assertDevLoopCloseSync` (the helper under test):
 *   - calls `assertLocalRemoteSynced(worktreePath)`
 *   - on throw: emits `event_type: 'error'`, `message: 'dev-loop.branch-divergence'`
 *     with the captured ref hashes + detail, then re-throws
 *   - on OK: emits a `log` event with the same metadata shape
 *
 * No SDK. No Ralph. Real tmp git repos with a bare origin — same pattern
 * as `pr.test.ts` / `closure.test.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertDevLoopCloseSync } from './developer-loop.ts';
import { createLogger, type EventLogEntry } from '../logging.ts';

function sh(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

type Harness = {
  root: string;
  proj: string;
  logger: ReturnType<typeof createLogger>;
  events: () => EventLogEntry[];
  cleanup: () => void;
};

/**
 * A tmp project on `initiative-x` with a bare origin and one extra
 * commit on the initiative branch. Mirrors the dev-loop-close shape
 * exactly — `pr.test.ts:makeRepoWithOrigin` uses the same recipe.
 *
 * `pushed=true` publishes the branch to origin so the invariant holds.
 * `pushed=false` leaves the branch unpublished (a divergence the
 * close-step must catch).
 */
function setup(pushed: boolean): Harness {
  const root = mkdtempSync(join(tmpdir(), 'forge-devloop-close-sync-'));
  const proj = join(root, 'proj');
  mkdirSync(proj, { recursive: true });
  sh(proj, ['init', '-q', '-b', 'main']);
  sh(proj, ['config', 'user.email', 't@forge']);
  sh(proj, ['config', 'user.name', 'forge-test']);
  writeFileSync(join(proj, 'README.md'), 'base\n');
  sh(proj, ['add', '.']);
  sh(proj, ['commit', '-q', '-m', 'base']);
  const origin = join(root, 'origin.git');
  sh(proj, ['init', '-q', '--bare', origin]);
  sh(proj, ['remote', 'add', 'origin', origin]);
  sh(proj, ['push', '-q', 'origin', 'main']);
  sh(proj, ['checkout', '-q', '-b', 'initiative-x']);
  writeFileSync(join(proj, 'feature.txt'), 'work\n');
  sh(proj, ['add', '.']);
  sh(proj, ['commit', '-q', '-m', 'feat: work']);
  if (pushed) {
    sh(proj, ['push', '-q', '--set-upstream', 'origin', 'initiative-x']);
  }

  const logsDir = join(root, '_logs');
  mkdirSync(logsDir, { recursive: true });
  const logger = createLogger('TEST-devloop-close', logsDir);

  return {
    root,
    proj,
    logger,
    events: () => {
      const txt = readFileSync(logger.logFilePath, 'utf8');
      return txt.split('\n').filter(Boolean).map((l) => JSON.parse(l) as EventLogEntry);
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('assertDevLoopCloseSync: THROWS + emits dev-loop.branch-divergence when local diverged from remote', () => {
  // Branch never pushed → origin/initiative-x does not exist → divergence.
  const h = setup(false);
  try {
    assert.throws(
      () => assertDevLoopCloseSync(h.proj, h.logger, 'INIT-x'),
      /local↔remote invariant violated/,
    );
    const events = h.events();
    const ev = events.find((e) => e.message === 'dev-loop.branch-divergence');
    assert.ok(ev, 'expected a dev-loop.branch-divergence event in the log');
    assert.equal(ev!.event_type, 'error');
    assert.equal(ev!.phase, 'developer-loop');
    assert.equal(ev!.initiative_id, 'INIT-x');
    const md = (ev!.metadata ?? {}) as Record<string, unknown>;
    assert.equal(md.branch, 'initiative-x');
    assert.ok(typeof md.detail === 'string' && md.detail.length > 0);
    // origin_head should be null (branch never pushed); localHead is a hash.
    assert.equal(md.origin_head, null);
    assert.ok(typeof md.local_head === 'string' && (md.local_head as string).length > 0);
  } finally {
    h.cleanup();
  }
});

test('assertDevLoopCloseSync: throws when local has an unpushed commit ahead of origin', () => {
  // Push, then add an unpushed commit → local diverged from remote.
  const h = setup(true);
  try {
    writeFileSync(join(h.proj, 'extra.txt'), 'unpushed\n');
    sh(h.proj, ['add', '.']);
    sh(h.proj, ['commit', '-q', '-m', 'unpushed work']);

    assert.throws(
      () => assertDevLoopCloseSync(h.proj, h.logger, 'INIT-x'),
      /local↔remote invariant violated/,
    );
    const ev = h.events().find((e) => e.message === 'dev-loop.branch-divergence');
    assert.ok(ev, 'expected a dev-loop.branch-divergence event in the log');
    const md = (ev!.metadata ?? {}) as Record<string, unknown>;
    assert.match(md.detail as string, /local diverged from remote/);
  } finally {
    h.cleanup();
  }
});

test('assertDevLoopCloseSync: silent OK when local == remote (no throw, no error event)', () => {
  // Branch pushed → origin == local HEAD → invariant holds.
  const h = setup(true);
  try {
    assert.doesNotThrow(() => assertDevLoopCloseSync(h.proj, h.logger, 'INIT-x'));
    const events = h.events();
    // No divergence error event.
    assert.equal(
      events.filter((e) => e.message === 'dev-loop.branch-divergence').length,
      0,
    );
    // An OK log event IS emitted (post-mortems can read the ref hashes).
    const ok = events.find((e) => e.message === 'dev-loop.branch-sync-ok');
    assert.ok(ok, 'expected a dev-loop.branch-sync-ok event');
    assert.equal(ok!.event_type, 'log');
    const md = (ok!.metadata ?? {}) as Record<string, unknown>;
    assert.equal(md.branch, 'initiative-x');
    assert.equal(md.origin_head, md.local_head);
  } finally {
    h.cleanup();
  }
});

test('assertDevLoopCloseSync: silent OK when local == remote even with --no-ff merge commits in history (Phase 4 step 5 fan-in shape)', () => {
  // Phase 4 step 5 replaces the old per-WI push with a push after every
  // successful merge-back (`git merge --no-ff <wiBranch>`), so a real
  // initiative branch's history is no longer linear — it carries one merge
  // commit per fanned-in WI. `assertLocalRemoteSynced` compares ref hashes
  // (`git rev-parse`), which is graph-shape-agnostic, but this proves it
  // end-to-end against a branch that actually LOOKS like a post-step-5
  // initiative branch, not just a straight-line commit chain.
  const h = setup(true);
  try {
    // Simulate a second WI branch, forked from initiative-x's tip, whose
    // work fans back in via --no-ff — the exact shape `mergeWiIntoCycle`
    // produces (see `wi-merge-back.ts`).
    sh(h.proj, ['checkout', '-q', '-b', 'wi-branch']);
    writeFileSync(join(h.proj, 'wi-work.txt'), 'wi content\n');
    sh(h.proj, ['add', '.']);
    sh(h.proj, ['commit', '-q', '-m', 'wi: work']);
    sh(h.proj, ['checkout', '-q', 'initiative-x']);
    sh(h.proj, ['merge', '--no-ff', 'wi-branch', '-m', 'wi(WI-1): merge']);
    sh(h.proj, ['push', '-q', 'origin', 'initiative-x']);

    // Sanity: the merge commit really does have two parents (not silently
    // fast-forwarded), so this test actually exercises non-linear history.
    const parents = execFileSync('git', ['-C', h.proj, 'log', '-1', '--pretty=%P'], {
      stdio: 'pipe',
      encoding: 'utf8',
    })
      .trim()
      .split(/\s+/);
    assert.equal(parents.length, 2, 'setup must produce a real --no-ff merge commit');

    assert.doesNotThrow(() => assertDevLoopCloseSync(h.proj, h.logger, 'INIT-x'));
    const events = h.events();
    assert.equal(
      events.filter((e) => e.message === 'dev-loop.branch-divergence').length,
      0,
      'a merge-commit-bearing history must not be misread as a divergence',
    );
    const ok = events.find((e) => e.message === 'dev-loop.branch-sync-ok');
    assert.ok(ok, 'expected a dev-loop.branch-sync-ok event');
    const md = (ok!.metadata ?? {}) as Record<string, unknown>;
    assert.equal(md.origin_head, md.local_head);
  } finally {
    h.cleanup();
  }
});
