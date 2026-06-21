/**
 * Tests for orchestrator/review-comments.ts (S7 / DEC-5).
 *
 * The interactive review page anchors W3C-annotation-style comments to
 * `data-demo-region` sections and persists them as a JSON sidecar; the verdict
 * (approve / send-back) is DERIVED over those comments — any blocking, unresolved
 * comment ⇒ send-back, mapping each concern to a GIVEN/WHEN/THEN acceptance
 * criterion the existing /api/verdict drain consumes (ADR-026). No DB.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readReviewComments,
  writeReviewComments,
  appendReviewComment,
  resolveComment,
  deriveVerdictFromComments,
  reviewCommentsPath,
} from './review-comments.ts';

function withTmp(fn: (logsRoot: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'forge-review-comments-'));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const CID = '2026-06-21T00-00-00_INIT-2026-06-21-toc';

test('readReviewComments: returns an empty sidecar when none exists yet', () => {
  withTmp((logsRoot) => {
    const sidecar = readReviewComments(logsRoot, CID);
    assert.deepEqual(sidecar, { cycleId: CID, comments: [] });
  });
});

test('append → write → read round-trips, and ids are stable append-only', () => {
  withTmp((logsRoot) => {
    let sidecar = readReviewComments(logsRoot, CID);
    sidecar = appendReviewComment(sidecar, { region: 'ac-2', body: 'newline drifts on the 2nd write', blocking: true });
    sidecar = appendReviewComment(sidecar, { region: 'checkpoint-1', body: 'nice read-back', blocking: false });
    writeReviewComments(logsRoot, CID, sidecar);

    assert.ok(existsSync(reviewCommentsPath(logsRoot, CID)), 'sidecar file written under _logs/<cycleId>/');
    const reread = readReviewComments(logsRoot, CID);
    assert.equal(reread.comments.length, 2);
    assert.equal(reread.comments[0].region, 'ac-2');
    assert.equal(reread.comments[0].blocking, true);
    assert.equal(reread.comments[1].blocking, false);
    assert.notEqual(reread.comments[0].id, reread.comments[1].id, 'ids are unique');
    assert.ok(reread.comments[0].at, 'each comment carries a timestamp');

    // Appending a third must NOT renumber the existing ids (stable anchors).
    const firstId = reread.comments[0].id;
    const grown = appendReviewComment(reread, { region: 'ac-3', body: 'another', blocking: false });
    assert.equal(grown.comments[0].id, firstId, 'existing comment ids are stable across appends');
  });
});

test('deriveVerdictFromComments: no comments ⇒ approve', () => {
  assert.deepEqual(deriveVerdictFromComments([]), { kind: 'approve' });
});

test('deriveVerdictFromComments: only non-blocking / resolved comments ⇒ approve', () => {
  const v = deriveVerdictFromComments([
    { id: 'C-1', region: 'a', body: 'praise', blocking: false, resolved: false, at: 'x' },
    { id: 'C-2', region: 'b', body: 'was an issue, fixed', blocking: true, resolved: true, at: 'x' },
  ]);
  assert.deepEqual(v, { kind: 'approve' });
});

test('deriveVerdictFromComments: a blocking, unresolved comment ⇒ send-back with a non-empty GWT AC', () => {
  const v = deriveVerdictFromComments([
    { id: 'C-1', region: 'ac-2', body: 'a second --write must be byte-identical', blocking: true, resolved: false, at: 'x' },
  ]);
  assert.equal(v.kind, 'send-back');
  if (v.kind !== 'send-back') return;
  assert.equal(v.acceptanceCriteria.length, 1);
  const ac = v.acceptanceCriteria[0];
  assert.ok(ac.given.trim() && ac.when.trim() && ac.then.trim(), 'derived AC has non-empty given/when/then (the drain rejects blanks)');
  assert.ok(ac.then.includes('byte-identical'), 'the comment body seeds the THEN');
  assert.ok(v.rationale.includes('ac-2'), 'rationale references the anchored region');
});

test('deriveVerdictFromComments: an explicit GWT on the comment is used verbatim', () => {
  const v = deriveVerdictFromComments([
    {
      id: 'C-1', region: 'ac-2', body: 'see AC', blocking: true, resolved: false, at: 'x',
      ac: { given: 'a current doc', when: 'mdtoc --write runs twice', then: 'the file is byte-identical' },
    },
  ]);
  assert.equal(v.kind, 'send-back');
  if (v.kind !== 'send-back') return;
  assert.deepEqual(v.acceptanceCriteria[0], { given: 'a current doc', when: 'mdtoc --write runs twice', then: 'the file is byte-identical' });
});

test('resolveComment: marks one comment resolved (flipping the derived verdict to approve)', () => {
  let sidecar = { cycleId: CID, comments: [] as ReturnType<typeof readReviewComments>['comments'] };
  sidecar = appendReviewComment(sidecar, { region: 'ac-2', body: 'fix this', blocking: true });
  const id = sidecar.comments[0].id;
  assert.equal(deriveVerdictFromComments(sidecar.comments).kind, 'send-back');

  const resolved = resolveComment(sidecar, id);
  assert.equal(resolved.comments[0].resolved, true);
  assert.equal(deriveVerdictFromComments(resolved.comments).kind, 'approve', 'resolving the only blocker flips to approve');
});

test('writeReviewComments: rejects a path-traversal cycleId', () => {
  withTmp((logsRoot) => {
    assert.throws(() => writeReviewComments(logsRoot, '../../etc/evil', { cycleId: 'x', comments: [] }), /cycle/i);
    assert.deepEqual(readReviewComments(logsRoot, '../../etc/evil'), { cycleId: '../../etc/evil', comments: [] },
      'a traversal id reads empty, never escapes the logs root');
    assert.ok(!existsSync(join(logsRoot, '..', '..', 'etc', 'evil')), 'nothing written outside logsRoot');
  });
});
