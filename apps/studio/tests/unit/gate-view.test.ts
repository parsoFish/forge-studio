/**
 * The verdict gate's pure view logic (forge-mfv5.1.31).
 * Fixture shapes are the gitweave I1 verdict's own: `[WI-n]`-joined reviewer
 * prose, `(WI-n)`-prefixed criteria, `Plan n: WI-k` checkpoint labels.
 *
 * RUN: npx vitest run apps/studio/tests/unit/gate-view.test.ts
 */
import { test, expect } from 'vitest';

import {
  stripAnsi,
  splitByWorkItem,
  leadSentences,
  joinCriteria,
  groupFindings,
  groupCheckpoints,
  countBy,
  reviewHeadIsStale,
  defaultSideMode,
  parseDiffStat,
} from '@/lib/gate-view';

test('stripAnsi removes colour and cursor escapes, keeps the text', () => {
  expect(stripAnsi('\u001b[0m\u001b[1mInitializing the backend...\u001b[0m')).toBe('Initializing the backend...');
  expect(stripAnsi('plain')).toBe('plain');
  expect(stripAnsi(undefined)).toBe('');
});

test('splitByWorkItem splits reviewer prose at its [WI-n] / [unattributed] markers', () => {
  const text = '[WI-1] Deletes the spike. Adds a test. [WI-2] Fixes bootstrap. [unattributed] Demo files.';
  expect(splitByWorkItem(text)).toEqual([
    { id: 'WI-1', text: 'Deletes the spike. Adds a test.' },
    { id: 'WI-2', text: 'Fixes bootstrap.' },
    { id: 'unattributed', text: 'Demo files.' },
  ]);
});

test('splitByWorkItem keeps unmarked prose whole under an empty id, and drops nothing before the first marker', () => {
  expect(splitByWorkItem('One review, no chunks.')).toEqual([{ id: '', text: 'One review, no chunks.' }]);
  expect(splitByWorkItem('Preamble. [WI-3] Body.')).toEqual([{ id: '', text: 'Preamble.' }, { id: 'WI-3', text: 'Body.' }]);
  expect(splitByWorkItem('')).toEqual([]);
});

test('leadSentences returns the first n sentences and says how many were left out', () => {
  const t = 'Deletes metrics/src/main.py. Two assertions go. A new test lands. CI is green.';
  expect(leadSentences(t, 2)).toEqual({ sentences: ['Deletes metrics/src/main.py.', 'Two assertions go.'], omitted: 2 });
  expect(leadSentences('One.', 3)).toEqual({ sentences: ['One.'], omitted: 0 });
});

test('joinCriteria parses the (WI-n) prefix and joins each criterion to its own evaluation by text, never by position alone', () => {
  const criteria = ['(WI-1) GIVEN a WHEN `x` THEN y', '(WI-2) GIVEN b WHEN c THEN d', 'AC 3 holds'];
  const evals = [
    { criterion: '(WI-2) GIVEN b WHEN c THEN d', verdict: 'missed' as const, evidence: 'not run' },
    { criterion: '(WI-1) GIVEN a WHEN `x` THEN y', verdict: 'met' as const, evidence: 'exit 0' },
  ];
  expect(joinCriteria(criteria, evals)).toEqual([
    { regionId: 'ac-1', raw: criteria[0], wi: 'WI-1', text: 'GIVEN a WHEN `x` THEN y', verdict: 'met', evidence: 'exit 0' },
    { regionId: 'ac-2', raw: criteria[1], wi: 'WI-2', text: 'GIVEN b WHEN c THEN d', verdict: 'missed', evidence: 'not run' },
    { regionId: 'ac-3', raw: 'AC 3 holds', wi: '', text: 'AC 3 holds', verdict: null, evidence: '' },
  ]);
});

test('groupFindings groups by the id prefix in first-seen order, sorts each group by severity, and attaches that work item summary slice', () => {
  const doc = {
    summary: '[WI-1] Clean deletion. [WI-3] Three stale tests remain.',
    findings: [
      { id: 'WI-1/RF-2', severity: 'minor' as const, title: 'README lists metrics/' },
      { id: 'WI-3/RF-1', severity: 'major' as const, title: 'stale test fails' },
      { id: 'WI-1/RF-1', severity: 'major' as const, title: 'demo guide names a deleted file' },
      { id: 'unattributed/RF-1', severity: 'info' as const, title: 'docstring drift' },
    ],
  };
  const groups = groupFindings(doc);
  expect(groups.map((g) => g.id)).toEqual(['WI-1', 'WI-3', 'unattributed']);
  expect(groups[0].items.map((f) => f.id)).toEqual(['WI-1/RF-1', 'WI-1/RF-2']);
  expect(groups[0].summary).toBe('Clean deletion.');
  expect(groups[2].summary).toBe('');
});

test('groupCheckpoints groups by the work item named in the label, keeping each checkpoint index (its region id)', () => {
  const cps = [
    { label: 'Plan 1: WI-1', caption: 'a' },
    { label: 'Plan 2: WI-1', caption: 'b' },
    { label: 'Plan 4: WI-2', caption: 'c' },
    { label: 'Plan-7-WI-4-gknmf3', caption: 'Plan-7-WI-4-gknmf3' },
    { label: 'homepage', caption: 'd' },
  ];
  expect(groupCheckpoints(cps).map((g) => [g.wi, g.items.map((i) => i.index)])).toEqual([
    ['WI-1', [0, 1]], ['WI-2', [2]], ['WI-4', [3]], ['', [4]],
  ]);
});

test('countBy counts a key, treating an absent value as the fallback', () => {
  const rows = [{ d: 'changed' }, { d: 'unchanged' }, {}, { d: 'changed' }];
  expect(countBy(rows, (r) => r.d ?? 'unknown')).toEqual({ changed: 2, unchanged: 1, unknown: 1 });
});

test('reviewHeadIsStale is true only when both shas are known and differ', () => {
  expect(reviewHeadIsStale('e0a0a562ca15', '0162a36ae947')).toBe(true);
  expect(reviewHeadIsStale('0162a36', '0162a36ae947629b')).toBe(false);
  expect(reviewHeadIsStale(undefined, '0162a36')).toBe(false);
  expect(reviewHeadIsStale('0162a36', undefined)).toBe(false);
});

test('defaultSideMode prefers captured output, then the frame, then the video', () => {
  expect(defaultSideMode({ output: 'stdout', image: 'data:x', video: 'v.webm' })).toBe('output');
  expect(defaultSideMode({ output: '', image: 'data:x', video: 'v.webm' })).toBe('frame');
  expect(defaultSideMode({ output: null, image: null, video: 'v.webm' })).toBe('video');
  expect(defaultSideMode({})).toBe('note');
});

test('parseDiffStat reads files / insertions / deletions, and null on a shape it does not know', () => {
  expect(parseDiffStat('169 files changed, 2281 insertions(+), 26875 deletions(-)')).toEqual({ files: 169, insertions: 2281, deletions: 26875 });
  expect(parseDiffStat('1 file changed, 3 insertions(+)')).toEqual({ files: 1, insertions: 3, deletions: 0 });
  expect(parseDiffStat('+0 -0')).toBeNull();
});
