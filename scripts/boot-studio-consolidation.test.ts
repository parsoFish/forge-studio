/**
 * Acceptance test — ONE `forge studio` boot for the harnesses, proven by
 * DELETION (W7-C3, the dedupe A0 deferred).
 *
 * Immutable-gate, RED-first. Three harnesses each hand-rolled the same core:
 * spawn the canonical launcher, wait for its `forge-studio-ready {json}`
 * stdout line, kill the detached process GROUP on timeout. Three copies meant
 * three chances to drift — and the drift that actually bit was the missing
 * group-kill in e2e-deadpaths, which stranded a half-booted studio holding
 * ports 4123/4124 (2026-07-11 R3, fixed in one copy only).
 *
 * The acceptance is met only when the duplicates are GONE, not when a shared
 * module exists ALONGSIDE them — so this test proves the delta by ABSENCE:
 * the ready-line regex and the studio spawn appear EXACTLY ONCE across
 * scripts/, in the shared module, and each harness reaches it by import.
 *
 * Also pins the one piece of policy the shared module owns that has real
 * teeth: `bootStudio` REFUSES to boot over a healthy forge bridge (the
 * operator's live session, with any in-flight cycle, must never be taken over
 * by a harness). That branch is exercised for real against an ephemeral local
 * port — never 4123/4124 — and returns before anything is spawned.
 *
 * RUN: node --test --experimental-strip-types scripts/boot-studio-consolidation.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = join(ROOT, 'scripts', 'lib', 'boot-studio.mjs');

/** Every harness that boots a studio. Each must delegate, never re-implement. */
const CALLERS = [
  join(ROOT, 'scripts', 'e2e-deadpaths.mjs'),
  join(ROOT, 'scripts', 'verify-cycle.mjs'),
  join(ROOT, 'scripts', 'ui-walkthrough', 'crawl.mjs'),
];

/** The per-copy retired location — its survival would mean a 4th copy. */
const RETIRED = join(ROOT, 'scripts', 'ui-walkthrough', 'boot-studio.mjs');

const read = (p: string) => readFileSync(p, 'utf8');

test('the shared boot module exists and exports the three seams the harnesses need', async () => {
  assert.ok(existsSync(SHARED), 'scripts/lib/boot-studio.mjs must exist');
  const mod = await import(SHARED);
  for (const name of ['spawnStudioReady', 'bootStudio', 'probeHealthyBridge']) {
    assert.equal(typeof mod[name], 'function', `${name} must be exported`);
  }
});

test('the per-harness copy under scripts/ui-walkthrough/ is GONE (deletion, not addition)', () => {
  assert.equal(existsSync(RETIRED), false,
    'scripts/ui-walkthrough/boot-studio.mjs must be deleted — its callers import scripts/lib/boot-studio.mjs');
});

test('every studio-booting harness IMPORTS the shared module', () => {
  for (const caller of CALLERS) {
    const src = read(caller);
    // static `from '…'` or crawl.mjs's lazy `await import('…')` — either way
    // the module specifier must resolve to the ONE shared file.
    assert.match(src, /(?:from|import\()\s*'(?:\.{1,2}\/)+lib\/boot-studio\.mjs'/,
      `${caller} must import scripts/lib/boot-studio.mjs`);
  }
});

test('the ready-line parser lives in exactly ONE place — no harness re-implements it', () => {
  assert.match(read(SHARED), /forge-studio-ready/,
    'the shared module owns the ready-line contract');
  for (const caller of CALLERS) {
    const src = read(caller);
    // A comment may NAME the signal line; only a regex/match re-implementation
    // is a second copy.
    assert.doesNotMatch(src, /\/\^forge-studio-ready/,
      `${caller} still parses the ready line itself — that is the duplicated core`);
  }
});

test('the studio spawn lives in exactly ONE place — no harness spawns the launcher itself', () => {
  assert.match(read(SHARED), /'studio', '--no-open'/,
    'the shared module owns the launcher argv');
  for (const caller of CALLERS) {
    assert.doesNotMatch(read(caller), /'studio', '--no-open'/,
      `${caller} still spawns \`forge studio\` itself — that is the duplicated core`);
  }
});

test('the timeout path kills the process GROUP (the 2026-07-11 zombie-on-4123/4124 fix, now unduplicatable)', () => {
  const src = read(SHARED);
  assert.match(src, /process\.kill\(-proc\.pid/,
    'the negative pid (process GROUP) kill must be present — a plain proc.kill leaves the detached group alive');
  assert.match(src, /killGroup\('SIGKILL'\)[\s\S]{0,400}?rej\(/,
    'the timeout must kill BEFORE rejecting — rejecting without killing strands a studio holding the ports');
});

test('bootStudio REFUSES to boot over a healthy forge bridge (never takes over the operator session)', async () => {
  const { bootStudio } = await import(SHARED);
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ service: 'forge-bridge', pid: 4242, startedAt: '2026-08-21T00:00:00Z' }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  try {
    await assert.rejects(
      () => bootStudio({ bridgeUrl: `http://127.0.0.1:${port}` }),
      /healthy forge bridge \(pid 4242\)/,
      'a healthy bridge must abort the boot, naming the pid that holds it',
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('probeHealthyBridge treats a FOREIGN service on the port as "not a forge bridge", never as reusable', async () => {
  const { probeHealthyBridge } = await import(SHARED);
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ service: 'some-other-app', pid: 1 }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  try {
    assert.equal(await probeHealthyBridge(`http://127.0.0.1:${port}`), null);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('probeHealthyBridge returns null (never throws) when nothing is listening', async () => {
  const { probeHealthyBridge } = await import(SHARED);
  // Bind then immediately close, so the port is known-free rather than guessed.
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((r) => server.close(() => r()));
  assert.equal(await probeHealthyBridge(`http://127.0.0.1:${port}`), null);
});
