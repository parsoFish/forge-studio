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
  editComment,
  deleteComment,
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

// ---------------------------------------------------------------------------
// W7-B7 (artifact-plan-15) — edit + delete: a comment the operator authored
// must be correctable and clearable; a NON-BLOCKING comment (which never gets
// a resolve affordance) must be removable at all.
// ---------------------------------------------------------------------------

test('editComment: rewrites body and blocking flag; unknown id is a no-op', () => {
  let sidecar = { cycleId: CID, comments: [] as ReturnType<typeof readReviewComments>['comments'] };
  sidecar = appendReviewComment(sidecar, { region: 'ac-1', body: 'typo here', blocking: false });
  const id = sidecar.comments[0].id;

  const edited = editComment(sidecar, id, { body: 'typo here — and the label is wrong', blocking: true });
  assert.equal(edited.comments[0].body, 'typo here — and the label is wrong');
  assert.equal(edited.comments[0].blocking, true);
  assert.equal(edited.comments[0].id, id, 'the anchor id never changes on edit');
  assert.equal(deriveVerdictFromComments(edited.comments).kind, 'send-back', 'an edit to blocking re-derives the verdict');

  const untouched = editComment(sidecar, 'C-999', { body: 'nope' });
  assert.deepEqual(untouched.comments, sidecar.comments);
});

test('editComment: a partial patch leaves the other fields intact', () => {
  let sidecar = { cycleId: CID, comments: [] as ReturnType<typeof readReviewComments>['comments'] };
  sidecar = appendReviewComment(sidecar, { region: 'ac-1', body: 'original', blocking: true });
  const id = sidecar.comments[0].id;
  const edited = editComment(sidecar, id, { blocking: false });
  assert.equal(edited.comments[0].body, 'original');
  assert.equal(edited.comments[0].blocking, false);
});

// W7-B7 review r1: a stored `ac` is authored against the PRE-edit body, and
// acForComment PREFERS it — so a body edit that kept the ac would ship the
// stale acceptance criterion into the send-back fix loop while the operator
// believes their correction took effect. A body change drops the stored ac
// (derive-don't-store: the GWT fallback regenerates from the NEW body); a
// blocking-only patch keeps it (the criterion still matches the body).
test('editComment: a body change drops a stored ac so the derived AC follows the NEW body', () => {
  let sidecar = { cycleId: CID, comments: [] as ReturnType<typeof readReviewComments>['comments'] };
  sidecar = appendReviewComment(sidecar, {
    region: 'ac-2', body: 'the label is wrong', blocking: true,
    ac: { given: 'the demo page', when: 'the label renders', then: 'the label is wrong' },
  });
  const id = sidecar.comments[0].id;

  const edited = editComment(sidecar, id, { body: 'the label AND the count are wrong' });
  assert.equal(edited.comments[0].ac, undefined, 'stored ac dropped on body change');
  const v = deriveVerdictFromComments(edited.comments);
  assert.equal(v.kind, 'send-back');
  if (v.kind !== 'send-back') return;
  assert.ok(v.acceptanceCriteria[0].then.includes('the count'), 'the derived AC reflects the NEW body, not the stale stored one');
});

test('editComment: a blocking-only patch keeps the stored ac verbatim', () => {
  let sidecar = { cycleId: CID, comments: [] as ReturnType<typeof readReviewComments>['comments'] };
  sidecar = appendReviewComment(sidecar, {
    region: 'ac-2', body: 'see AC', blocking: false,
    ac: { given: 'a current doc', when: 'mdtoc --write runs twice', then: 'the file is byte-identical' },
  });
  const id = sidecar.comments[0].id;
  const edited = editComment(sidecar, id, { blocking: true });
  assert.deepEqual(edited.comments[0].ac, { given: 'a current doc', when: 'mdtoc --write runs twice', then: 'the file is byte-identical' });
});

test('editComment: a body patch equal to the current body keeps the stored ac (no-op change)', () => {
  let sidecar = { cycleId: CID, comments: [] as ReturnType<typeof readReviewComments>['comments'] };
  sidecar = appendReviewComment(sidecar, {
    region: 'ac-2', body: 'same body', blocking: true,
    ac: { given: 'g', when: 'w', then: 't' },
  });
  const id = sidecar.comments[0].id;
  const edited = editComment(sidecar, id, { body: 'same body' });
  assert.deepEqual(edited.comments[0].ac, { given: 'g', when: 'w', then: 't' });
});

test('deleteComment: removes the comment (the only way to clear a non-blocking one) and re-derives approve', () => {
  let sidecar = { cycleId: CID, comments: [] as ReturnType<typeof readReviewComments>['comments'] };
  sidecar = appendReviewComment(sidecar, { region: 'ac-1', body: 'non-blocking note', blocking: false });
  sidecar = appendReviewComment(sidecar, { region: 'ac-2', body: 'must fix', blocking: true });
  const [nonBlocking, blocker] = sidecar.comments;

  const afterDelete = deleteComment(sidecar, nonBlocking.id);
  assert.equal(afterDelete.comments.length, 1);
  assert.equal(afterDelete.comments[0].id, blocker.id, 'surviving ids are never renumbered');

  const cleared = deleteComment(afterDelete, blocker.id);
  assert.equal(deriveVerdictFromComments(cleared.comments).kind, 'approve');

  const noop = deleteComment(sidecar, 'C-999');
  assert.deepEqual(noop.comments, sidecar.comments, 'unknown id is a no-op');
});
