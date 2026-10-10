/**
 * Bead forge-mfv5.1.25 — security review of the kickoff fact reader. Each case
 * is a manifest or work-item shape that must read as BUILT (never the Kickoff
 * gate), so a malformed or tampered initiative is never re-started:
 *   - a work-item status outside the enum, or none at all (parseWorkItem would
 *     normalise both to `pending`);
 *   - a cycle_id that escapes the logs root (a manifest that bypassed writeManifest);
 *   - a stale all-pending snapshot next to a worktree whose work items are built
 *     (every source counts, not the first that has files).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { kickoffBuiltReason } from '@forge/contracts';
import { manifestAwaitsKickoff, readKickoffFacts } from '../../kickoff-facts.ts';
import { parseManifest } from '../../manifest.ts';
import { plantStrandedKickoff, STRANDED_INIT } from '../test-fixtures/stranded-kickoff.ts';

function withStranded(fn: (root: string, paths: ReturnType<typeof plantStrandedKickoff>) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'forge-kickoff-facts-'));
  try { fn(root, plantStrandedKickoff(root)); } finally { rmSync(root, { recursive: true, force: true }); }
}

const source = (root: string, manifestPath: string) => ({
  queueDir: 'ready-for-review', manifest: parseManifest(readFileSync(manifestPath, 'utf8')), logsRoot: join(root, '_logs'), forgeRoot: root,
});

function setWi1(dir: string, statusLine: string | null): void {
  const p = join(dir, 'WI-1.md');
  const lines = readFileSync(p, 'utf8').split('\n').filter((l) => !l.startsWith('status:'));
  if (statusLine !== null) lines.splice(1, 0, statusLine);
  writeFileSync(p, lines.join('\n'));
}

test('control: the planted stranded shape awaits kickoff', () => {
  withStranded((root, p) => assert.equal(manifestAwaitsKickoff(source(root, p.manifestPath)), true));
});

test('a work-item status outside the enum reads as built, never kickoff', () => {
  withStranded((root, p) => {
    setWi1(p.snapshotDir, 'status: DONE');
    const s = source(root, p.manifestPath);
    assert.equal(manifestAwaitsKickoff(s), false);
    assert.match(kickoffBuiltReason(readKickoffFacts(s)) ?? '', /unreadable/);
  });
});

test('a work item with no status reads as built, never kickoff', () => {
  withStranded((root, p) => {
    setWi1(p.snapshotDir, null);
    assert.equal(manifestAwaitsKickoff(source(root, p.manifestPath)), false);
  });
});

test('a cycle_id that escapes the logs root is refused as unreadable, and its files are never read', () => {
  withStranded((root, p) => {
    const outside = join(root, 'outside', 'work-items-snapshot');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'WI-1.md'), `---\nwork_item_id: WI-1\ninitiative_id: ${STRANDED_INIT}\nstatus: pending\n---\n`);
    writeFileSync(p.manifestPath, readFileSync(p.manifestPath, 'utf8').replace(/^cycle_id: .*$/m, 'cycle_id: ../../outside'));
    const s = source(root, p.manifestPath);
    assert.equal(manifestAwaitsKickoff(s), false);
    assert.match(kickoffBuiltReason(readKickoffFacts(s)) ?? '', /unreadable/);
  });
});

test('a stale all-pending snapshot never hides built work items in the worktree', () => {
  withStranded((root, p) => {
    const wt = join(root, '_worktrees', STRANDED_INIT, '.forge', 'work-items');
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, 'WI-1.md'), `---\nwork_item_id: WI-1\ninitiative_id: ${STRANDED_INIT}\nstatus: complete\n---\n`);
    const s = source(root, p.manifestPath);
    assert.equal(manifestAwaitsKickoff(s), false);
    assert.match(kickoffBuiltReason(readKickoffFacts(s)) ?? '', /complete/);
  });
});
