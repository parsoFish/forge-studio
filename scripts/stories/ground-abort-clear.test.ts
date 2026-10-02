/**
 * `captureAndClearMintedSessionsSince` — the own-ground clear a SIGINT/SIGTERM
 * mid-story still needs. forge-8vfn.8.5.21, Defect B (row 184b fold).
 *
 * MEASURED: a story run killed by SIGINT mid-story left the story's minted
 * architect session standing in the REAL ground (`projects/gitpulse/
 * _architect/<sid>/…`), moving the ground's method-C hash off its pin. The
 * normal end-of-story path (`run-story.mjs`) captures and clears every
 * session a run minted; the SIGINT path skips that function entirely — it
 * `process.exit()`s before `runStory`'s own teardown ever runs — so nothing
 * in that path has EVER captured or cleared a minted session, for any run
 * stopped this way.
 *
 * This function is the abort path's own version of that same clear, built
 * from a before/after pair taken OUTSIDE `runStory` (which owns the before
 * snapshot internally and never exposes it) — never the drift CLASSIFIER
 * `run-story.mjs` uses for its containment report, which this path has no
 * need of: a session minted by the story in progress has no history before
 * this run at all, so every minted path is simply its own home.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { groundManifest } from './ground-hash.mjs';
import { groundClearDir } from './ground-clear.mjs';
import { captureAndClearMintedSessionsSince } from './ground-abort-clear.mjs';

const SESSION = '2026-10-02T11-51-15-80017b51';
const MINTED = `_architect/${SESSION}`;

/** A ground and a `_logs/` dir, both empty of any session — the state a
 *  story's own pre-beat snapshot would see. */
function fixture(): { root: string; ground: string; logsDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'ground-abort-clear-'));
  const ground = join(root, 'projects', 'gitpulse');
  mkdirSync(join(ground, 'src'), { recursive: true });
  writeFileSync(join(ground, 'README.md'), '# gitpulse\n');
  writeFileSync(join(ground, 'src', 'index.ts'), 'export const x = 1;\n');
  const logsDir = join(root, '_logs');
  mkdirSync(logsDir, { recursive: true });
  return { root, ground, logsDir };
}

/** The story minting a session, mid-run — exactly what a SIGINT catches in
 *  flight: a `_logs` dispatch dir AND the ground-side output it has written
 *  so far. */
function mintSession(root: string, ground: string): void {
  mkdirSync(join(root, '_logs', `_architect-${SESSION}`), { recursive: true });
  writeFileSync(join(root, '_logs', `_architect-${SESSION}`, 'turn.pid'), '4242\n');
  mkdirSync(join(ground, MINTED), { recursive: true });
  writeFileSync(join(ground, MINTED, 'status.json'), '{"phase":"awaiting-verdict"}\n');
  writeFileSync(join(ground, MINTED, 'PLAN.md'), '# the plan\n');
}

test('row 184b (Defect B): a session minted mid-story is captured, then cleared, and the ground hash comes back', () => {
  const { root, ground, logsDir } = fixture();
  try {
    const groundBefore = groundManifest(ground);
    const logsBefore = ['_project-brain']; // whatever else `_logs/` carried, irrelevant to this story
    assert.notEqual(groundBefore, null);

    mintSession(root, ground);

    const groundAfter = groundManifest(ground);
    assert.notEqual(
      groundAfter!.digest, groundBefore!.digest,
      'the minted session must actually move the hash, or this test proves nothing',
    );
    const logsAfter = [...logsBefore, `_architect-${SESSION}`];

    const out = captureAndClearMintedSessionsSince({
      root, project: 'gitpulse', storyId: 'S1', runStamp: '2026-10-02T11-51-30Z',
      groundBefore, groundAfter, logsBefore, logsAfter, logsDir,
      registeredKindIds: new Set(['architect']),
    });

    // CAPTURED — the plan survives, exactly as the normal end-of-story clear keeps it.
    const dest = groundClearDir(root, 'S1', '2026-10-02T11-51-30Z');
    assert.deepEqual(out.captured, [MINTED]);
    assert.equal(
      readFileSync(join(dest, MINTED, 'PLAN.md'), 'utf8'), '# the plan\n',
      'the capture must hold the session\'s actual output',
    );

    // CLEARED — and the ground hash is back at the pin the next run checks.
    assert.deepEqual(out.cleared, [MINTED]);
    assert.equal(existsSync(join(ground, MINTED)), false);
    assert.equal(
      groundManifest(ground)!.digest, groundBefore!.digest,
      'the acceptance criterion: this is what keeps the NEXT run\'s ground pin from refusing at $0',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('row 184b (positive control): a story that minted nothing before SIGINT leaves the ground untouched', () => {
  const { root, ground, logsDir } = fixture();
  try {
    const groundBefore = groundManifest(ground);
    const logsBefore = ['_project-brain'];
    const logsAfter = [...logsBefore]; // nothing new — the press never even got that far

    const out = captureAndClearMintedSessionsSince({
      root, project: 'gitpulse', storyId: 'S1', runStamp: '2026-10-02T11-51-30Z',
      groundBefore, groundAfter: groundBefore, logsBefore, logsAfter, logsDir,
      registeredKindIds: new Set(['architect']),
    });

    assert.deepEqual(out.captured, []);
    assert.deepEqual(out.cleared, []);
    assert.equal(out.dest, null);
    assert.equal(
      groundManifest(ground)!.digest, groundBefore!.digest,
      'nothing was minted, so nothing should have been touched at all',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
