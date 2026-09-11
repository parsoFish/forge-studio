/**
 * Bead `forge-qm4d` (T1 ruling 673(ii)) — the BRIDGE says what it wrote into a
 * project ground.
 *
 * WHAT WAS MEASURED. S1 run 5 ended RED on containment with nine undeclared
 * changes in `projects/gitweave`. C's 663 attribution reads each session's own
 * `file_change` events and accounts for four. The other FIVE were written by no
 * session at all — the bridge wrote them, and emitted nothing:
 *
 *   .forge/agent-run/PROMPT.md              runAgent
 *   .forge/contract-compliance-report.json  the contract checker
 *   .gitignore · roadmap.md · brain/profile.md   the onboard scaffold
 *
 * So a containment check built on session logs can never account for them, and
 * every story that onboards a project fails containment for the product
 * WORKING — S1 most of all, whose whole subject is that forge creates
 * `.forge/` rather than the story creating it by hand.
 *
 * PROVENANCE IS PRODUCT BEHAVIOUR, not test scaffolding. Forge writes into an
 * operator's repository; it should be able to say what it wrote and why. The
 * story runner is the first consumer of that fact, not the reason for it.
 *
 * These helpers live in the kernel because all three writers must emit the SAME
 * event: one is in `packages/agents`, one in `packages/projects`, one in
 * `apps/forge`, and the kernel is the only layer all three already stand on.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { emitGroundFileChanges, writeProjectGroundFile } from '../../logging.ts';
import type { EventLogEntry } from '../../logging.ts';

function bridgeRuns(forgeRoot: string): string[] {
  const logs = join(forgeRoot, '_logs');
  return existsSync(logs) ? readdirSync(logs).filter((d) => d.startsWith('_bridge-')) : [];
}

function entriesOf(forgeRoot: string, dir: string): EventLogEntry[] {
  return readFileSync(join(forgeRoot, '_logs', dir, 'events.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l) as EventLogEntry);
}

test('forge-qm4d: a bridge write emits one durable file_change per path, in its own _bridge- run', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'qm4d-root-'));
  const projectRoot = mkdtempSync(join(tmpdir(), 'qm4d-proj-'));

  emitGroundFileChanges({
    forgeRoot, cause: 'POST /api/studio/projects', projectRoot,
    relPaths: ['.gitignore', 'roadmap.md', 'brain/profile.md'],
  });

  const runs = bridgeRuns(forgeRoot);
  assert.equal(runs.length, 1, 'the bridge writes belong to a run of their own, named by the request that caused them');

  const changes = entriesOf(forgeRoot, runs[0]!).filter((e) => e.event_type === 'file_change');
  assert.equal(changes.length, 3, 'one event per path — a summary event cannot be attributed path by path');
  assert.deepEqual(
    changes.map((e) => e.output_refs[0]).sort(),
    ['.gitignore', 'brain/profile.md', 'roadmap.md'].map((p) => join(projectRoot, p)).sort(),
    'output_refs carries the ABSOLUTE path, the same shape a session emits',
  );
  assert.equal(changes[0]!.message, 'file.write', 'and the same message shape — one vocabulary for session and bridge writes alike');
  assert.match(String(changes[0]!.metadata?.['cause']), /POST \/api\/studio\/projects/, 'the cause is recorded, because "forge wrote this" without "why" is half an answer');
});

test('forge-qm4d: an EMPTY list opens no run — nothing written means nothing to say', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'qm4d-empty-'));
  const projectRoot = mkdtempSync(join(tmpdir(), 'qm4d-eproj-'));

  const opened = emitGroundFileChanges({ forgeRoot, cause: 'a request that wrote nothing', projectRoot, relPaths: [] });

  // The scaffold skips every file the operator already has, so "created
  // nothing" is its ORDINARY outcome, not an error. A run directory per
  // no-op would bury the real ones.
  assert.equal(opened, null, 'nothing written, so nothing opened');
  assert.deepEqual(bridgeRuns(forgeRoot), [], 'and no directory minted for a no-op');
});

test('forge-qm4d: writeProjectGroundFile writes AND emits — a caller cannot do one without the other', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'qm4d-w-'));
  const projectRoot = mkdtempSync(join(tmpdir(), 'qm4d-wproj-'));
  mkdirSync(join(projectRoot, '.forge'), { recursive: true });

  writeProjectGroundFile({
    projectRoot, segments: ['.forge', 'contract-compliance-report.json'],
    body: '{"ok":true}\n', forgeRoot, cause: 'forge contract-compliance',
  });

  assert.equal(readFileSync(join(projectRoot, '.forge', 'contract-compliance-report.json'), 'utf8'), '{"ok":true}\n');
  const changes = entriesOf(forgeRoot, bridgeRuns(forgeRoot)[0]!).filter((e) => e.event_type === 'file_change');
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.output_refs[0], join(projectRoot, '.forge', 'contract-compliance-report.json'));
});
