import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  READY_SIGNAL_PREFIX,
  formatReadySignal,
  parseReadySignal,
  writeReadyFile,
  pollUntilReady,
  isValidPort,
} from './forge-watch.ts';

/**
 * M7-6: the deterministic ready signal + health-poll loop are the pure,
 * machine-readable contract both harnesses depend on (M7-7). These tests pin
 * the format/parse round-trip, file atomicity, and the poll control-flow with
 * an injected probe + clock — no real server required.
 */

const INFO = { bridgeUrl: 'http://127.0.0.1:4123', uiUrl: 'http://localhost:4124' };

test('formatReadySignal: single greppable line with the fixed prefix + JSON', () => {
  const line = formatReadySignal(INFO);
  assert.equal(line, `${READY_SIGNAL_PREFIX} {"bridgeUrl":"http://127.0.0.1:4123","uiUrl":"http://localhost:4124"}`);
  assert.ok(line.startsWith('forge-studio-ready '), 'prefix must be greppable');
  assert.ok(!line.includes('\n'), 'must be a single line');
});

test('parseReadySignal: round-trips a formatted signal', () => {
  assert.deepEqual(parseReadySignal(formatReadySignal(INFO)), INFO);
});

test('parseReadySignal: tolerates surrounding whitespace (mid-chunk lines)', () => {
  assert.deepEqual(parseReadySignal(`  ${formatReadySignal(INFO)}  `), INFO);
});

test('parseReadySignal: rejects non-signal lines and malformed payloads', () => {
  assert.equal(parseReadySignal('Ready in 1200ms'), null);
  assert.equal(parseReadySignal('[forge studio] bridge at http://127.0.0.1:4123'), null);
  assert.equal(parseReadySignal('forge-studio-ready not-json'), null);
  // Valid JSON but missing required keys → null (fail-closed).
  assert.equal(parseReadySignal('forge-studio-ready {"bridgeUrl":"x"}'), null);
  assert.equal(parseReadySignal('forge-studio-ready {"uiUrl":1,"bridgeUrl":"x"}'), null);
});

test('writeReadyFile: writes atomically and the final file is complete JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-ready-'));
  const path = join(dir, 'ready.json');
  writeReadyFile(path, INFO);
  assert.ok(existsSync(path), 'ready file must exist after write');
  assert.ok(!existsSync(`${path}.tmp`), 'temp file must be renamed away (atomic)');
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), INFO);
});

test('isValidPort: accepts in-range integer ports', () => {
  assert.equal(isValidPort('4123'), true);
  assert.equal(isValidPort('1'), true);
  assert.equal(isValidPort('65535'), true);
});

test('isValidPort: rejects missing value, flags, and out-of-range/non-integer', () => {
  // The load-bearing case: `--bridge-port --no-open` hands the next flag as the
  // value; Number('--no-open') is NaN and must NOT silently become a port.
  assert.equal(isValidPort('--no-open'), false);
  assert.equal(isValidPort(undefined), false);
  assert.equal(isValidPort(''), false);
  assert.equal(isValidPort('0'), false);
  assert.equal(isValidPort('65536'), false);
  assert.equal(isValidPort('-1'), false);
  assert.equal(isValidPort('4123.5'), false);
  assert.equal(isValidPort('abc'), false);
});

test('pollUntilReady: returns true immediately when first probe succeeds', async () => {
  let calls = 0;
  const ok = await pollUntilReady('http://x', {
    probe: async () => { calls += 1; return true; },
    now: () => 0,
    wait: async () => {},
  });
  assert.equal(ok, true);
  assert.equal(calls, 1, 'should not poll again once ready');
});

test('pollUntilReady: retries until the probe flips ready', async () => {
  let calls = 0;
  const ok = await pollUntilReady('http://x', {
    probe: async () => { calls += 1; return calls >= 3; },
    timeoutMs: 10_000,
    intervalMs: 50,
    now: () => 0, // clock frozen so the deadline never trips
    wait: async () => {},
  });
  assert.equal(ok, true);
  assert.equal(calls, 3);
});

test('pollUntilReady: returns false when the deadline elapses', async () => {
  let t = 0;
  let calls = 0;
  const ok = await pollUntilReady('http://x', {
    probe: async () => { calls += 1; return false; },
    timeoutMs: 300,
    intervalMs: 100,
    now: () => t,
    wait: async (ms) => { t += ms; },
  });
  assert.equal(ok, false);
  assert.ok(calls >= 1, 'probes at least once before giving up');
});
