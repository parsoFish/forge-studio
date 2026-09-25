/**
 * forge-8vfn.8.1.11 — a DNS/resolver failure at push time classified
 * `failure_mode:"terminal" … "failure could not be classified"` instead of
 * environment/transient.
 *
 * THE DEFECT. The host's DNS resolver was down when the dev-loop tried to
 * publish the initiative branch. `classifyCycleFailure` had no signature for
 * "Could not resolve host" / `ENOTFOUND` / `EAI_AGAIN` / `getaddrinfo`, so a
 * clean environment outage fell through every rule to the unclassified
 * terminal default — the cycle landed in `failed/` instead of going back to
 * `pending` for an auto-retry once DNS recovered.
 *
 * VERBATIM REPLAY. The three events below are copied byte-for-byte (message
 * + metadata) from the cycle's real `events.jsonl`. Two carry the DNS text in
 * `metadata.reason` (`dev-loop.branch-push-failed`,
 * `cycle.dev-close-push-failed`); the third carries it in the message itself
 * (the orchestrator's own "could not publish the branch" throw).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCrash, classifyCycleFailure } from '../../failure-classifier.ts';
import type { EventLogEntry } from '@forge/kernel';

function ev(overrides: Partial<EventLogEntry>): EventLogEntry {
  return {
    event_id: 'e1',
    initiative_id: 'INIT-x',
    started_at: '2026-06-07T00:00:00.000Z',
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    ...overrides,
  } as EventLogEntry;
}

const DNS_STDERR =
  "fatal: unable to access 'https://github.com/parsoFish/gitpulse.git/': Could not resolve host: github.com\n";

/** Verbatim from the defect's events.jsonl. */
const REAL_TRACE: EventLogEntry[] = [
  ev({
    event_id: 'e1',
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'error',
    message: 'dev-loop.branch-push-failed',
    metadata: { work_item_id: 'WI-2', reason: DNS_STDERR, early_exit: true, outcome: 'complete' },
  }),
  ev({
    event_id: 'e2',
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: 'error',
    message: 'cycle.dev-close-push-failed',
    metadata: { reason: DNS_STDERR },
  }),
  ev({
    event_id: 'e3',
    phase: 'orchestrator',
    skill: 'cycle',
    event_type: 'error',
    message: `dev-loop close could not publish the branch: ${DNS_STDERR}`,
    metadata: {},
  }),
];

test('forge-8vfn.8.1.11: the real events.jsonl trace classifies environment + transient/recoverable, reason names the DNS failure', () => {
  const c = classifyCycleFailure(REAL_TRACE);
  assert.equal(c.environment, true, 'expected environment:true');
  assert.equal(c.kind, 'transient');
  assert.equal(c.recoverable, true);
  assert.match(c.reason, /dns|resolv/i);
});

test('forge-8vfn.8.1.11: dev-loop.branch-push-failed ALONE (reason lives in metadata.reason, not the message) classifies environment/transient', () => {
  const c = classifyCycleFailure([REAL_TRACE[0]!]);
  assert.equal(c.environment, true);
  assert.equal(c.kind, 'transient');
  assert.match(c.reason, /dns|resolv/i);
});

test('forge-8vfn.8.1.11: cycle.dev-close-push-failed ALONE (reason lives in metadata.reason) classifies environment/transient', () => {
  const c = classifyCycleFailure([REAL_TRACE[1]!]);
  assert.equal(c.environment, true);
  assert.equal(c.kind, 'transient');
  assert.match(c.reason, /dns|resolv/i);
});

test('forge-8vfn.8.1.11: the orchestrator\'s "could not publish the branch" throw ALONE (DNS text in the message itself) classifies environment/transient', () => {
  const c = classifyCycleFailure([REAL_TRACE[2]!]);
  assert.equal(c.environment, true);
  assert.equal(c.kind, 'transient');
  assert.match(c.reason, /dns|resolv/i);
});

test('forge-8vfn.8.1.11: negative control — an ordinary non-DNS push rejection stays NOT environment', () => {
  const events = [
    ev({
      phase: 'developer-loop',
      skill: 'developer-ralph',
      event_type: 'error',
      message: 'dev-loop.branch-push-failed',
      metadata: {
        work_item_id: 'WI-2',
        reason:
          "! [rejected]        HEAD -> feat/dns (fetch first)\n" +
          "error: failed to push some refs to 'https://github.com/parsoFish/gitpulse.git'\n" +
          'hint: Updates were rejected because the remote contains work that you do\n' +
          'hint: not have locally.',
        early_exit: true,
        outcome: 'complete',
      },
    }),
  ];
  const c = classifyCycleFailure(events);
  assert.equal(c.environment, false);
  assert.doesNotMatch(c.reason, /dns|resolv/i);
});

// ---------------------------------------------------------------------------
// classifyCrash — each REQUIRED signature form, isolated
// ---------------------------------------------------------------------------

test('classifyCrash: git\'s "Could not resolve host" stderr is transient', () => {
  const c = classifyCrash(DNS_STDERR, null);
  assert.equal(c.kind, 'transient');
  assert.match(c.reason, /resolve host/i);
});

test('classifyCrash: bare ENOTFOUND is transient', () => {
  const c = classifyCrash('Error: connect ENOTFOUND github.com', null);
  assert.equal(c.kind, 'transient');
});

test('classifyCrash: bare EAI_AGAIN is transient', () => {
  const c = classifyCrash('DNS lookup failed: EAI_AGAIN (temporary failure in name resolution) for github.com', null);
  assert.equal(c.kind, 'transient');
});

test('classifyCrash: bare getaddrinfo is transient', () => {
  const c = classifyCrash('Error: getaddrinfo github.com', null);
  assert.equal(c.kind, 'transient');
});

test('classifyCrash: the real Node/gh shape (getaddrinfo + ENOTFOUND together) is transient', () => {
  const c = classifyCrash('request to https://api.github.com/repos/x failed, reason: getaddrinfo ENOTFOUND api.github.com', null);
  assert.equal(c.kind, 'transient');
});

test('classifyCrash: negative control — an ordinary non-DNS push rejection stays deterministic/unknown, not transient', () => {
  const c = classifyCrash(
    "! [rejected]        HEAD -> feat/dns (fetch first)\nerror: failed to push some refs",
    null,
  );
  assert.notEqual(c.kind, 'transient');
});
