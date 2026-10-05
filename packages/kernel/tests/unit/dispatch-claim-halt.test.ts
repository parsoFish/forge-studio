/**
 * The emergency halt at the dispatch claim (D-03): `claimDispatchSlot`
 * refuses with `Halted` before writing anything, and the shared envelope maps
 * it to 409 { error: 'halted', since }.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ServerResponse } from 'node:http';

import { claimDispatchSlot } from '../../dispatch-claim.ts';
import { Halted, DispatchInFlight, sendIfDispatchRefused } from '../../http-envelope.ts';
import { writeHalt, readHalt } from '../../halt.ts';

function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { out.push(`${p}/`); walk(p); } else out.push(`${p}:${readFileSync(p, 'utf8')}`);
    }
  };
  walk(dir);
  return out;
}

function mockRes(): { res: ServerResponse; captured: { status: number | null; body: string } } {
  const captured = { status: null as number | null, body: '' };
  const res = {
    writeHead(status: number) { captured.status = status; return res; },
    end(payload?: string) { if (payload !== undefined) captured.body = payload; return res; },
  } as unknown as ServerResponse;
  return { res, captured };
}

test('claimDispatchSlot under halt throws Halted and writes nothing (tree byte-identical)', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-halt-'));
  try {
    mkdirSync(join(root, '_logs', 'run-1'), { recursive: true });
    mkdirSync(join(root, '_queue'), { recursive: true });
    const rec = writeHalt(join(root, '_queue'), 'operator');
    const before = snapshot(root);
    assert.throws(
      () => claimDispatchSlot(root, 'run-1', 'run-1', () => false),
      (err: unknown) => {
        assert.ok(err instanceof Halted);
        assert.equal((err as Halted).since, rec.since);
        return true;
      },
    );
    assert.deepEqual(snapshot(root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimDispatchSlot under a corrupt halt record refuses (fail closed)', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-halt-corrupt-'));
  try {
    mkdirSync(join(root, '_queue'), { recursive: true });
    mkdirSync(join(root, '_logs'), { recursive: true });
    // unparseable record
    writeFileSync(join(root, '_queue', 'halt.json'), '{oops');
    assert.throws(() => claimDispatchSlot(root, 'run-1', 'run-1', () => false), (e: unknown) => e instanceof Halted && e.since === null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('claimDispatchSlot without a halt claims as before', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-nohalt-'));
  try {
    mkdirSync(join(root, '_logs'), { recursive: true });
    assert.equal(readHalt(join(root, '_queue')), null);
    claimDispatchSlot(root, 'run-1', 'run-1', () => false);
    assert.match(readFileSync(join(root, '_logs', 'run-1', 'turn.pid'), 'utf8'), /claiming/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sendIfDispatchRefused: Halted -> 409 { error: "halted", since }', () => {
  const { res, captured } = mockRes();
  assert.equal(sendIfDispatchRefused(res, new Halted('2026-10-04T10:00:00.000Z'), 'http://localhost:4124'), true);
  assert.equal(captured.status, 409);
  assert.deepEqual(JSON.parse(captured.body), { error: 'halted', since: '2026-10-04T10:00:00.000Z' });
});

test('sendIfDispatchRefused: DispatchInFlight still maps; other errors are not handled', () => {
  const a = mockRes();
  assert.equal(sendIfDispatchRefused(a.res, new DispatchInFlight(1, 'r'), 'null'), true);
  assert.equal(a.captured.status, 409);
  const b = mockRes();
  assert.equal(sendIfDispatchRefused(b.res, new Error('boom'), 'null'), false);
  assert.equal(b.captured.status, null);
});
