/**
 * Bead forge-8vfn.6.10.24 — the reviewer's diff is cut at the WORK ITEM.
 *
 * G2 died here: `adversarial-review spawn terminated by the SDK
 * (error_max_turns)`, no findings artifact, no verdict gate, no merge. One
 * spawn read the whole initiative's diff, so its work scaled with the change
 * and its budget did not.
 *
 * WHICH WRONG IMPLEMENTATION EACH TEST KILLS is named per test. The partition
 * is a pure function precisely so these are decided by the suite rather than by
 * a funded run (§15.163).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { partitionChangedFiles, chunkLabel, UNATTRIBUTED_CHUNK_ID } from './review-chunks.ts';

const wi = (id: string, filesInScope: string[], creates?: string[]) => ({
  work_item_id: id,
  files_in_scope: filesInScope,
  ...(creates ? { creates } : {}),
});

test('kills "one chunk for everything": each work item that touches the diff gets its own chunk', () => {
  const chunks = partitionChangedFiles(
    ['a.ts', 'b.ts', 'c.ts'],
    [wi('WI-1', ['a.ts']), wi('WI-2', ['b.ts']), wi('WI-3', ['c.ts'])],
  );
  assert.deepEqual(chunks.map((c) => c.workItemId), ['WI-1', 'WI-2', 'WI-3']);
  assert.deepEqual(chunks.map((c) => [...c.files]), [['a.ts'], ['b.ts'], ['c.ts']]);
});

test('kills "files no work item claims are dropped": the remainder is its own chunk, so nothing escapes review', () => {
  const chunks = partitionChangedFiles(['a.ts', 'stray.md', 'b.ts'], [wi('WI-1', ['a.ts']), wi('WI-2', ['b.ts'])]);
  const last = chunks.at(-1)!;
  assert.equal(last.workItemId, null);
  assert.deepEqual([...last.files], ['stray.md']);
  assert.equal(chunkLabel(last), UNATTRIBUTED_CHUNK_ID);
});

test('kills "a file claimed twice is reviewed twice": the union of the chunks is the diff, exactly once each', () => {
  const changed = ['shared.ts', 'a.ts', 'b.ts'];
  const chunks = partitionChangedFiles(changed, [wi('WI-1', ['shared.ts', 'a.ts']), wi('WI-2', ['shared.ts', 'b.ts'])]);
  const all = chunks.flatMap((c) => [...c.files]);
  assert.deepEqual([...all].sort(), [...changed].sort(), 'every changed file appears');
  assert.equal(new Set(all).size, all.length, 'and none appears twice — two reviews of one hunk is two findings about it');
  assert.deepEqual([...chunks[0]!.files], ['shared.ts', 'a.ts'], 'the first claimant wins');
});

test('kills "a work item with nothing in the diff still costs a spawn": it produces no chunk', () => {
  const chunks = partitionChangedFiles(['a.ts'], [wi('WI-1', ['a.ts']), wi('WI-2', ['untouched.ts'])]);
  assert.deepEqual(chunks.map((c) => c.workItemId), ['WI-1']);
});

test('`creates` is claimed as well as `files_in_scope` — a WI\'s new file is its own to answer for', () => {
  const chunks = partitionChangedFiles(['new.ts', 'old.ts'], [wi('WI-1', ['old.ts'], ['new.ts'])]);
  assert.deepEqual(chunks.map((c) => c.workItemId), ['WI-1']);
  assert.deepEqual([...chunks[0]!.files], ['new.ts', 'old.ts']);
});

test('no work items at all: ONE unattributed chunk — the pre-chunking shape, and it is visible rather than silent', () => {
  const chunks = partitionChangedFiles(['a.ts', 'b.ts'], []);
  assert.deepEqual(chunks.map((c) => c.workItemId), [null]);
  assert.deepEqual([...chunks[0]!.files], ['a.ts', 'b.ts']);
});

test('an empty diff produces no chunks — there is nothing to review and no spawn to pay for', () => {
  assert.deepEqual(partitionChangedFiles([], [wi('WI-1', ['a.ts'])]), []);
});

test('the remainder keeps the DIFF\'s order, not a Set\'s iteration order', () => {
  const chunks = partitionChangedFiles(['z.md', 'a.ts', 'y.md'], [wi('WI-1', ['a.ts'])]);
  assert.deepEqual([...chunks.at(-1)!.files], ['z.md', 'y.md']);
});

// ---------------------------------------------------------------------------
// Merging the chunks back into ONE artifact. The verdict gate reads one file;
// chunking must not become a second output format.
// ---------------------------------------------------------------------------

import { mergeChunkRecords } from './review-chunks.ts';
import type { ReviewFindingsRecord } from '@forge/flows/flow-artifacts.ts';

const IDENT = { initiative_id: 'INIT-x', cycleId: 'CY-1', baseRef: 'origin/main', headSha: 'abc123' };

function rec(over: Partial<ReviewFindingsRecord> = {}): ReviewFindingsRecord {
  return {
    ...IDENT,
    reviewedAt: '2026-09-06T00:00:00Z',
    summary: 'a summary',
    findings: [],
    lenses: ['correctness'],
    acEvaluations: [],
    whyWhatHow: { why: 'w', what: 'h', how: 'o' },
    ...over,
  } as ReviewFindingsRecord;
}

const finding = (id: string, file: string) => ({
  id, severity: 'minor' as const, category: 'correctness', title: 't', detail: 'd',
  evidence: [{ file }],
});

test('kills "chunking produces N artifacts": the chunks merge into ONE record carrying every finding', () => {
  const merged = mergeChunkRecords(
    [
      { label: 'WI-1', record: rec({ findings: [finding('F1', 'a.ts')], summary: 'first' }) },
      { label: 'WI-2', record: rec({ findings: [finding('F1', 'b.ts')], summary: 'second' }) },
    ],
    [],
  );
  assert.equal(merged.findings.length, 2);
  assert.ok(merged.summary.includes('first') && merged.summary.includes('second'));
});

test('kills "two chunks author the same finding id": ids are namespaced by their chunk, so provenance survives the merge', () => {
  const merged = mergeChunkRecords(
    [
      { label: 'WI-1', record: rec({ findings: [finding('F1', 'a.ts')] }) },
      { label: 'WI-2', record: rec({ findings: [finding('F1', 'b.ts')] }) },
    ],
    [],
  );
  assert.deepEqual(merged.findings.map((f) => f.id), ['WI-1/F1', 'WI-2/F1']);
  assert.equal(new Set(merged.findings.map((f) => f.id)).size, 2);
});

test('kills "the union of per-chunk AC verdicts is lost": every chunk\'s acEvaluations reach the merged record', () => {
  const merged = mergeChunkRecords(
    [
      { label: 'WI-1', record: rec({ acEvaluations: [{ criterion: '(WI-1) GIVEN a WHEN b THEN c', verdict: 'met', evidence: 'e' }] }) },
      { label: 'WI-2', record: rec({ acEvaluations: [{ criterion: '(WI-2) GIVEN d WHEN e THEN f', verdict: 'partial', evidence: 'e' }] }) },
    ],
    [],
  );
  assert.deepEqual(merged.acEvaluations.map((e) => e.criterion), ['(WI-1) GIVEN a WHEN b THEN c', '(WI-2) GIVEN d WHEN e THEN f']);
});

test('kills "a work item that changed nothing is silently unjudged": the orchestrator authors its verdict, deterministically MISSED', () => {
  // A WI with acceptance criteria whose declared files are absent from the diff
  // produces no chunk, so no agent ever sees its criteria. That is not a reason
  // to leave them unjudged — nothing was delivered, which is a verdict the
  // orchestrator can reach without a model.
  const merged = mergeChunkRecords(
    [{ label: 'WI-1', record: rec() }],
    [{ criterion: '(WI-9) GIVEN a WHEN b THEN c', workItemId: 'WI-9' }],
  );
  const authored = merged.acEvaluations.find((e) => e.criterion.startsWith('(WI-9)'));
  assert.ok(authored, 'the criterion must be judged');
  assert.equal(authored.verdict, 'missed');
  assert.match(authored.evidence, /WI-9/, 'and the evidence must name the work item that delivered nothing');
});

test('the merged record keeps the run identity verbatim and the class lenses unchanged', () => {
  const merged = mergeChunkRecords([{ label: 'WI-1', record: rec() }], []);
  for (const k of ['initiative_id', 'cycleId', 'baseRef', 'headSha'] as const) assert.equal(merged[k], IDENT[k]);
  assert.deepEqual(merged.lenses, ['correctness']);
});

test('whyWhatHow is merged with its chunk labelled — one narrative per chunk, never one silently dropped', () => {
  const merged = mergeChunkRecords(
    [
      { label: 'WI-1', record: rec({ whyWhatHow: { why: 'why-1', what: 'what-1', how: 'how-1' } }) },
      { label: 'unattributed', record: rec({ whyWhatHow: { why: 'why-2', what: 'what-2', how: 'how-2' } }) },
    ],
    [],
  );
  for (const s of ['why-1', 'why-2', 'WI-1', 'unattributed']) assert.ok(merged.whyWhatHow.why.includes(s), `why must carry ${s}`);
  assert.ok(merged.whyWhatHow.what.includes('what-1') && merged.whyWhatHow.what.includes('what-2'));
  assert.ok(merged.whyWhatHow.how.includes('how-1') && merged.whyWhatHow.how.includes('how-2'));
});
