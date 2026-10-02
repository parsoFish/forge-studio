/**
 * agent-wait-liveness-handle.test.ts — row 192 (bead `forge-8vfn.8.5.30`),
 * T1 ruling 1973er: a `do` step's PRE-act wait (`waitForHandleOrStall` /
 * `waitOffSession`, `beats-page.mjs`) gets the SAME inactivity-window
 * treatment row 179b already gave the consequence wait (`waitForConsequence`,
 * proved against a real capture in `agent-wait-liveness-run7-capture.test.ts`)
 * — only for a beat that declares `wait: { for: 'agent' }`. The declared
 * bound becomes an inactivity window the watched agent's own liveness can
 * push out, under the same absolute `CYCLE_WAIT_WALL_CEILING_MS`; a
 * published-phase stop (`stopNow`, the stall door) is unaffected either way.
 *
 * `makeLivenessWindow`/`cycleWaitDeadline` are already proved elsewhere
 * (`agent-wait-liveness-run7-capture.test.ts`'s own doors, row 179b's own
 * module tests), so these doors exist only to show THIS wait is actually
 * wired to them: a live agent still advancing outlasts the OLD declared
 * bound, and an idle one still reds at exactly that bound — never later,
 * and never at all unless the beat declared an agent wait.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { waitForHandleOrStall } from './beats-page.mjs';

const HANDLE = '[data-field="session-answer"]';
const BEATS_PAGE = join(import.meta.dirname, 'beats-page.mjs');

/** A page off any session route (`sessionScope: null`) that never grows HANDLE. */
function quietPage() {
  const node = { getAttribute: () => null };
  const locator = (): any => ({ first: () => locator(), count: async () => 0, evaluate: async (fn: any) => fn(node) });
  return { url: () => 'http://localhost:4124/artifact', locator };
}

/** Reports fresh activity (`idle: 0`) until `quietAt`, then goes silent. */
const liveUntil = (quietAt: number) => (_runId: string | null, _boundRunId: string | null, now: number) =>
  (now < quietAt ? 0 : now - quietAt);

/** Never reports activity at all — every reading's implied last-write predates the wait's own start. */
const neverLive = (startedAt: number) => (_r: string | null, _b: string | null, now: number) => now - startedAt + 1;

test('row 192 (RED before the fix): a live agent still advancing outlasts the OLD declared bound on the do-step\'s own wait', async () => {
  const boundMs = 200;
  const started = Date.now();
  const quietAt = started + boundMs + 150; // keeps "writing" well past the old bound
  const stall = await waitForHandleOrStall(quietPage() as never, HANDLE, boundMs, null, null, null, true, liveUntil(quietAt), null);
  const took = Date.now() - started;
  assert.equal(stall, null, 'never doored — no stall door was passed; this only asserts the TIMING the liveness window buys');
  assert.ok(took > boundMs + 100, `must outlast the old ${boundMs} ms bound while the agent is still writing — took ${took} ms`);
  assert.ok(took < boundMs + 150 + 400, `must still end near the agent's own last write, not run away past it — took ${took} ms`);
});

test('row 192: an agent with NO liveness ever seen still reds at exactly the declared bound — never extended', async () => {
  const boundMs = 200;
  const started = Date.now();
  const stall = await waitForHandleOrStall(quietPage() as never, HANDLE, boundMs, null, null, null, true, neverLive(started), null);
  const took = Date.now() - started;
  assert.equal(stall, null);
  assert.ok(took >= boundMs && took < boundMs + 150, `a silent agent must red at the declared bound, not later — took ${took} ms of ${boundMs}`);
});

test('row 192: a beat that did NOT declare `for: \'agent\'` ignores a supplied liveness reader entirely', async () => {
  const boundMs = 200;
  const started = Date.now();
  const quietAt = started + 10_000; // "still writing" for the whole test, if it were consulted at all
  const stall = await waitForHandleOrStall(quietPage() as never, HANDLE, boundMs, null, null, null, false, liveUntil(quietAt), null);
  const took = Date.now() - started;
  assert.equal(stall, null);
  assert.ok(took >= boundMs && took < boundMs + 150, `agentScaleWait=false must keep the plain bound even with a live reader — took ${took} ms`);
});

test('row 192 wiring: the session-scoped branch of waitForHandleOrStall ALSO builds the liveness window, not only waitOffSession', () => {
  const s = readFileSync(BEATS_PAGE, 'utf8');
  const fnAt = s.indexOf('export async function waitForHandleOrStall');
  const delegateAt = s.indexOf('return waitOffSession(', fnAt);
  const offSessionAt = s.indexOf('\nasync function waitOffSession', delegateAt);
  assert.ok(fnAt !== -1 && delegateAt !== -1 && offSessionAt !== -1 && fnAt < delegateAt && delegateAt < offSessionAt);
  const sessionBody = s.slice(delegateAt, offSessionAt);
  assert.match(sessionBody, /makeLivenessWindow\(/, 'the session-scoped branch must build its own liveness window');
  assert.match(sessionBody, /effectiveDeadline/, 'and judge against an effective deadline, not the plain one');
  const offSessionBody = s.slice(offSessionAt);
  assert.match(offSessionBody, /makeLivenessWindow\(/, 'waitOffSession must build its own liveness window too');
  assert.match(offSessionBody, /effectiveDeadline/);
});

test('row 192 wiring: beats-drive.mjs hands performSteps the SAME readAgentLivenessNow and boundRunId waitForConsequence already trusts', () => {
  const s = readFileSync(join(import.meta.dirname, 'beats-drive.mjs'), 'utf8');
  const callAt = s.indexOf('const steps_ = await performSteps(');
  assert.notEqual(callAt, -1);
  const call = s.slice(callAt, s.indexOf(';', callAt));
  assert.match(call, /(?<![.\w])readAgentLivenessNow(?![.\w:])/, 'the same reader must reach performSteps');
  assert.match(call, /(?<![.\w])boundRunId(?![.\w:])/, 'the same bound run id must reach performSteps');
  assert.match(call, /beat\.wait\?\.for === 'agent'/, 'agentScaleWait must be derived from the beat\'s OWN declared wait, scoped to "agent" (never "settle")');
});

test('row 192 wiring: performSteps hands waitForHandleOrStall the SAME agentScaleWait/readHandleLivenessNow/boundRunId it received', () => {
  const s = readFileSync(join(import.meta.dirname, 'beats-steps.mjs'), 'utf8');
  const sigAt = s.indexOf('export async function performSteps(');
  const sigEnd = s.indexOf(') {', sigAt);
  assert.ok(sigAt !== -1 && sigEnd !== -1);
  const signature = s.slice(sigAt, sigEnd);
  assert.match(signature, /(?<![.\w])agentScaleWait = false(?![.\w:])/);
  assert.match(signature, /(?<![.\w])readHandleLivenessNow = null(?![.\w:])/);
  assert.match(signature, /(?<![.\w])boundRunId = null(?![.\w:])/);
  const callAt = s.indexOf('const stall = await waitForHandleOrStall(');
  assert.notEqual(callAt, -1);
  const call = s.slice(callAt, s.indexOf(');', callAt));
  assert.match(call, /(?<![.\w])agentScaleWait(?![.\w:])/);
  assert.match(call, /(?<![.\w])readHandleLivenessNow(?![.\w:])/);
  assert.match(call, /(?<![.\w])boundRunId(?![.\w:])/);
});
