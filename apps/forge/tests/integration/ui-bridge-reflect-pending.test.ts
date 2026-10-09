/**
 * forge-nk1y.3 — a reflection waiting on the operator is derived at read time
 * and served to Studio's Waiting on you; a reflection that asked nothing is
 * closed by one operator act, with no agent rerun.
 *
 * Stranger attempt 2 (Q9): the interactive reflector wrote its questions, the
 * cycle went to `done/`, and nothing in Studio listed the unanswered
 * reflection. The fixture below is the stranger's own `user-questions.json`
 * and `reflect-mode.json`, copied verbatim from its run dir.
 *
 *   GET  /api/reflections/pending            → { pending: PendingReflection[] }
 *   POST /api/reflect/<cycleId>/answer {close:true}
 *        → only when the cycle's questions are [] ; writes user-feedback.md,
 *          fires NO rerun ; else 409 by name, writes nothing
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { startBridge } from '../../ui-bridge.ts';
import { reconcileReflectFeedback } from '@forge/stations';

const FIXTURE = resolve(import.meta.dirname, '..', 'test-fixtures', 'reflection-stranger-a2');

const AWAITING = '2026-10-09T01-34-13_INIT-2026-10-09-min-commits-filter';
const UNASKED = '2026-10-09T02-00-00_INIT-2026-10-09-zero-ask';
const ANSWERED = '2026-10-09T03-00-00_INIT-2026-10-09-answered';
const AUTOMATED = '2026-10-09T04-00-00_INIT-2026-10-09-automated';
const PRE_R4_09 = '2026-07-11T17-26-34_INIT-2026-07-11-cli-sort-flag';
const UNREADABLE = '2026-10-09T05-00-00_INIT-2026-10-09-garbled';
const RUNNING = '2026-10-09T06-00-00_INIT-2026-10-09-still-reflecting';

type Pending = { cycleId: string; initiativeId: string; questions: number; status: string };

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;
let rerunCalls: number;

function cycle(id: string, files: Record<string, string>): void {
  const dir = join(forgeRoot, '_logs', id);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
}

const interactive = JSON.stringify({ mode: 'interactive' });

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-reflect-pending-'));
  mkdirSync(join(forgeRoot, '_queue'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs', AWAITING), { recursive: true });
  copyFileSync(join(FIXTURE, 'user-questions.json'), join(forgeRoot, '_logs', AWAITING, 'user-questions.json'));
  copyFileSync(join(FIXTURE, 'reflect-mode.json'), join(forgeRoot, '_logs', AWAITING, 'reflect-mode.json'));
  cycle(UNASKED, { 'reflect-mode.json': interactive, 'user-questions.json': '[]' });
  cycle(ANSWERED, { 'reflect-mode.json': interactive, 'user-questions.json': '[{"question":"q","header":"h","options":[]}]', 'user-feedback.md': '# fb\n' });
  cycle(AUTOMATED, { 'reflect-mode.json': JSON.stringify({ mode: 'automated' }), 'user-questions.json': '[{"question":"q","header":"h","options":[],"answer":"a"}]' });
  cycle(PRE_R4_09, { 'user-questions.json': '[{"question":"q","header":"h","options":[]}]' });
  cycle(UNREADABLE, { 'reflect-mode.json': interactive, 'user-questions.json': '{not json' });
  cycle(RUNNING, { 'reflect-mode.json': interactive });
  // Session and bridge dirs share _logs/ — never a reflection.
  mkdirSync(join(forgeRoot, '_logs', '_sessions'), { recursive: true });
  rerunCalls = 0;
  ({ url, close } = await startBridge({
    forgeRoot,
    port: 0,
    rerunReflector: () => { rerunCalls++; return Promise.resolve(); },
  }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

function post(id: string, body: unknown): Promise<Response> {
  return fetch(`${url}/api/reflect/${id}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
}

async function pending(): Promise<Pending[]> {
  const res = await fetch(`${url}/api/reflections/pending`);
  assert.equal(res.status, 200);
  return ((await res.json()) as { pending: Pending[] }).pending;
}

test('the stranger\'s unanswered interactive reflection is pending: awaiting, 4 questions', async () => {
  const row = (await pending()).find((p) => p.cycleId === AWAITING);
  assert.ok(row, 'the reflection the stranger never saw must be listed');
  assert.deepEqual(row, { cycleId: AWAITING, initiativeId: 'INIT-2026-10-09-min-commits-filter', questions: 4, status: 'awaiting' });
});

test('a zero-question interactive reflection is pending as unasked (the gate surfaces once for the close act)', async () => {
  const row = (await pending()).find((p) => p.cycleId === UNASKED);
  assert.deepEqual(row, { cycleId: UNASKED, initiativeId: 'INIT-2026-10-09-zero-ask', questions: 0, status: 'unasked' });
});

test('a malformed user-questions.json is pending as unreadable — named, never dropped', async () => {
  const row = (await pending()).find((p) => p.cycleId === UNREADABLE);
  assert.deepEqual(row, { cycleId: UNREADABLE, initiativeId: 'INIT-2026-10-09-garbled', questions: 0, status: 'unreadable' });
});

test('answered, automated, pre-R4-09 (no reflect-mode.json), still-reflecting and non-cycle dirs are not pending', async () => {
  const ids = (await pending()).map((p) => p.cycleId).sort();
  assert.deepEqual(ids, [AWAITING, UNASKED, UNREADABLE].sort());
});

test('close refused while questions are unanswered: 409 by name, nothing written, no rerun', async () => {
  rerunCalls = 0;
  const res = await fetch(`${url}/api/reflect/${AWAITING}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({ close: true }),
  });
  assert.equal(res.status, 409);
  assert.match(((await res.json()) as { error: string }).error, /4 questions unanswered/);
  assert.ok(!existsSync(join(forgeRoot, '_logs', AWAITING, 'user-feedback.md')));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(rerunCalls, 0);
});

test('close on a zero-question reflection: 200, records reflection-closed.json (NOT user-feedback.md), NO rerun, leaves pending, reads answered', async () => {
  rerunCalls = 0;
  const res = await post(UNASKED, { close: true });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, closed: true });
  const dir = join(forgeRoot, '_logs', UNASKED);
  assert.ok(existsSync(join(dir, 'reflection-closed.json')), 'the close is recorded in its own file');
  assert.ok(!existsSync(join(dir, 'user-feedback.md')), 'a close is not operator feedback for a rerun to distil');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(rerunCalls, 0, 'closing an empty reflection must not spend an agent turn');
  assert.ok(!(await pending()).some((p) => p.cycleId === UNASKED));
  const got = (await (await fetch(`${url}/api/reflect/${UNASKED}`)).json()) as { answered: boolean };
  assert.equal(got.answered, true, 'the gate shows a closed reflection as done');
});

test('a closed reflection is never re-run by the boot reconcile (review finding: the close used to look like fresh feedback)', async () => {
  const dir = join(forgeRoot, '_logs', UNASKED);
  writeFileSync(join(dir, 'events.jsonl'), JSON.stringify({ message: 'reflector.end', event_type: 'end', started_at: '2026-01-01T00:00:00.000Z' }) + '\n');
  let reran = 0;
  const done = await reconcileReflectFeedback({
    logsRoot: join(forgeRoot, '_logs'),
    queueRoot: join(forgeRoot, '_queue'),
    rerunReflector: async () => { reran++; },
    listCycleDirs: () => [UNASKED],
  });
  assert.deepEqual(done, []);
  assert.equal(reran, 0);
});

test('close refused by name: a second close, an automated cycle, a cycle that already has feedback', async () => {
  const again = await post(UNASKED, { close: true });
  assert.equal(again.status, 409);
  assert.match(((await again.json()) as { error: string }).error, /already closed/);
  cycle(`${AUTOMATED}-empty`, { 'reflect-mode.json': JSON.stringify({ mode: 'automated' }), 'user-questions.json': '[]' });
  const auto = await post(`${AUTOMATED}-empty`, { close: true });
  assert.equal(auto.status, 409);
  assert.match(((await auto.json()) as { error: string }).error, /not an interactive reflection/);
  cycle('2026-10-09T07-00-00_INIT-2026-10-09-fb-empty', { 'reflect-mode.json': interactive, 'user-questions.json': '[]', 'user-feedback.md': '# real answers\n' });
  const fb = await post('2026-10-09T07-00-00_INIT-2026-10-09-fb-empty', { close: true });
  assert.equal(fb.status, 409);
  assert.match(((await fb.json()) as { error: string }).error, /already answered/);
  assert.equal(readFileSync(join(forgeRoot, '_logs', '2026-10-09T07-00-00_INIT-2026-10-09-fb-empty', 'user-feedback.md'), 'utf8'), '# real answers\n');
});

test('GET /api/reflect/<id> names an unreadable question list instead of passing it off as "asked nothing"', async () => {
  const body = (await (await fetch(`${url}/api/reflect/${UNREADABLE}`)).json()) as { questions: unknown[]; filed: boolean; unreadable?: boolean };
  assert.deepEqual([body.questions.length, body.filed, body.unreadable], [0, true, true]);
  const close = await post(UNREADABLE, { close: true });
  assert.equal(close.status, 409);
});

test('a malformed percent-escape is a 400, never a bridge crash (security review: URIError escaped the handler)', async () => {
  const get = await fetch(`${url}/api/reflect/%E0%A4%A`);
  assert.equal(get.status, 400);
  const postRes = await fetch(`${url}/api/reflect/%E0%A4%A/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({ close: true }),
  });
  assert.equal(postRes.status, 400);
  assert.equal((await fetch(`${url}/api/health`)).status, 200, 'the bridge must still answer');
});

test('GET /api/reflect/<id> says whether the questions were filed: a still-running reflector is not "asked nothing"', async () => {
  const running = (await (await fetch(`${url}/api/reflect/${RUNNING}`)).json()) as { questions: unknown[]; filed: boolean };
  assert.deepEqual([running.questions.length, running.filed], [0, false]);
  const filed = (await (await fetch(`${url}/api/reflect/${AWAITING}`)).json()) as { questions: unknown[]; filed: boolean };
  assert.deepEqual([filed.questions.length, filed.filed], [4, true]);
});
