/**
 * Bead `forge-qm4d` — the onboard scaffold's writes are ATTRIBUTABLE, and the
 * attribution is derived from what it WROTE, not from what it might write.
 *
 * S1 run 5 ended RED on containment with nine undeclared paths in
 * `projects/gitweave`. Three of them are this scaffold's: `.gitignore`,
 * `roadmap.md` and `brain/profile.md`. No session wrote them, so no session log
 * could account for them, and the story failed for the product working.
 *
 * WHY THE RETURNED LIST AND NOT THE CONTAINMENT LIST. The route computes a
 * containment list at `bridge-studio-project-onboard.ts:352` — every path it
 * COULD write, checked before anything is written (SEC-03's two-phase rule).
 * Every scaffold write site is then `existsSync`-guarded. So the two lists
 * differ the moment an operator already has one of these files, and reporting
 * the candidates would claim forge wrote a file it deliberately left alone.
 * `scaffoldContractArtifacts` already returns the outcome; that is the source.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { emitGroundFileChanges, type EventLogEntry } from '@forge/kernel';
import { scaffoldContractArtifacts } from '../../project-contract-scaffold.ts';

const readArtifactRootFake = (_projectRoot: string): string => '.';

/** Exactly what the route does: scaffold, then emit from what came back. */
function scaffoldAndEmit(projectRoot: string, forgeRoot: string): string[] {
  const created = scaffoldContractArtifacts(projectRoot, 'demo', projectRoot, readArtifactRootFake);
  emitGroundFileChanges({
    forgeRoot, cause: 'POST /api/studio/projects', projectRoot,
    relPaths: created.filter((p) => p !== '.git/'),
  });
  return created;
}

function changedPaths(forgeRoot: string): string[] {
  const runs = readdirSync(join(forgeRoot, '_logs')).filter((d) => d.startsWith('_bridge-'));
  assert.equal(runs.length, 1, 'one bridge run for one request');
  return readFileSync(join(forgeRoot, '_logs', runs[0]!, 'events.jsonl'), 'utf8')
    .split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as EventLogEntry)
    .filter((e) => e.event_type === 'file_change')
    .map((e) => e.output_refs[0]!);
}

test('forge-qm4d: S1 run 5\'s three scaffold paths appear as file_change lines, from the real writer', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'qm4d-scaffold-'));
  const forgeRoot = mkdtempSync(join(tmpdir(), 'qm4d-forge-'));
  try {
    scaffoldAndEmit(projectRoot, forgeRoot);
    const paths = changedPaths(forgeRoot);

    for (const rel of ['.gitignore', 'roadmap.md', 'brain/profile.md']) {
      assert.ok(
        paths.includes(join(projectRoot, rel)),
        `${rel} was undeclared on S1 run 5 and must now be attributable — got: ${paths.join(', ')}`,
      );
      assert.ok(existsSync(join(projectRoot, rel)), `and the file must really be there — an event for a file nobody wrote is worse than no event`);
    }
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('forge-qm4d: a file the operator already had is NOT claimed — the outcome differs from the candidates', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'qm4d-kept-'));
  const forgeRoot = mkdtempSync(join(tmpdir(), 'qm4d-kforge-'));
  try {
    // The operator's own roadmap. The scaffold skips it (`if (!existsSync…)`),
    // so a report derived from the CANDIDATE list would tell them forge wrote
    // a file it deliberately left untouched.
    writeFileSync(join(projectRoot, 'roadmap.md'), '# my own roadmap\n', 'utf8');

    const created = scaffoldAndEmit(projectRoot, forgeRoot);
    const paths = changedPaths(forgeRoot);

    assert.equal(created.includes('roadmap.md'), false, 'the scaffold did not create it');
    assert.equal(paths.includes(join(projectRoot, 'roadmap.md')), false, 'so nothing may claim it did');
    assert.equal(readFileSync(join(projectRoot, 'roadmap.md'), 'utf8'), '# my own roadmap\n', 'and it is untouched');
    assert.ok(paths.includes(join(projectRoot, '.gitignore')), 'the files it DID write are still reported');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
