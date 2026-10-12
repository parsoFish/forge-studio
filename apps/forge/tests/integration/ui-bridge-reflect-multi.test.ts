/**
 * forge-nk1y.26 — a reflection question marked multi takes several choices; a single-choice one is
 * refused by name when sent several. gitweave I1's Q3 ("which roadblock is worth a forge fix") was a
 * radio, so the operator's four picks went into the freeform box. The two questions below are I1's
 * Q2 (single choice) and Q3 (now marked multi), as `user-questions.json` carries them.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from '../../ui-bridge.ts';

const CYCLE_ID = 'INIT-2026-10-10-i1-reflect-multi';
const Q2 = 'Did the implementation match the design intent?';
const Q3 = 'Which roadblock is worth a forge fix or new tool?';
const QUESTIONS = [
  { question: Q2, header: 'Did the impl', options: [{ label: 'Exact match', description: '' }, { label: 'Minor divergence', description: '' }, { label: 'Scope drift', description: '' }] },
  { question: Q3, header: 'Which roadbl', multi: true, options: [{ label: '(a) Skip already-green WIs on send-back', description: '' }, { label: '(b) Full failing-test audit before PM decomposition', description: '' }, { label: '(c) Per-WI legal-text verification anchor', description: '' }, { label: 'None', description: '' }] },
];

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;
let reruns = 0;
const feedback = () => join(forgeRoot, '_logs', CYCLE_ID, 'user-feedback.md');

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-reflect-multi-'));
  mkdirSync(join(forgeRoot, '_queue'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs', CYCLE_ID), { recursive: true });
  writeFileSync(join(forgeRoot, '_logs', CYCLE_ID, 'user-questions.json'), JSON.stringify(QUESTIONS));
  ({ url, close } = await startBridge({ forgeRoot, port: 0, rerunReflector: () => { reruns++; return Promise.resolve(); } }));
});
after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

const post = (answers: unknown[]) => fetch(`${url}/api/reflect/${CYCLE_ID}/answer`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
  body: JSON.stringify({ answers, freeform: '' }),
});

test('refusal: several choices for a single-choice question are refused by name; nothing is written or rerun', async () => {
  reruns = 0;
  const res = await post([{ question: Q2, answer: ['Exact match', 'Minor divergence'] }, { question: Q3, answer: ['None'] }]);
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: `refused — "${Q2}" takes one choice; got 2`, cycleId: CYCLE_ID });
  assert.equal(existsSync(feedback()), false);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(reruns, 0);
});

test('refusal: a choice list for a question the reflection did not ask is refused by name', async () => {
  const res = await post([{ question: 'Something else?', answer: ['x', 'y'] }]);
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, 'refused — "Something else?" is not one of this reflection\'s questions');
  assert.equal(existsSync(feedback()), false);
});

test('refusal: a pick that is not one of the question\'s options is refused by name', async () => {
  const res = await post([{ question: Q3, answer: ['(a) Skip already-green WIs on send-back', '(z) invented'] }]);
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, `refused — "(z) invented" is not a choice of "${Q3}"`);
});

test('refusal: a choice list that repeats a pick is refused by name', async () => {
  const res = await post([{ question: Q3, answer: ['None', 'None'] }]);
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, `refused — "${Q3}" lists a choice twice`);
});

test('several picks for the multi question are recorded, one per line, and the fold rerun fires', async () => {
  reruns = 0;
  const res = await post([
    { question: Q2, answer: 'Minor divergence' },
    { question: Q3, answer: ['(a) Skip already-green WIs on send-back', '(b) Full failing-test audit before PM decomposition', '(c) Per-WI legal-text verification anchor'] },
  ]);
  assert.equal(res.status, 200);
  const text = readFileSync(feedback(), 'utf8');
  assert.match(text, /### Which roadblock[^\n]*\n\n- \(a\) Skip already-green WIs on send-back\n- \(b\) Full failing-test audit before PM decomposition\n- \(c\) Per-WI legal-text verification anchor\n/);
  assert.match(text, /### Did the implementation[^\n]*\n\nMinor divergence\n/);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(reruns, 1);
});
