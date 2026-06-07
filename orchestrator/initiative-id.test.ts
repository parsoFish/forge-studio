/**
 * Unit tests for the dual-ID resolver (S1.1 — plan 07b).
 *
 * Covers resolveInitiativeId + loadAliases semantics (C16b).
 * mint* functions were removed (zero prod callers); tests now set up the
 * registry by writing a hand-crafted JSON fixture so the test surface
 * matches what is actually exported.
 *
 * Each test stands up a fresh `_queue/_aliases.json` under a tempdir
 * so the live forge registry is never touched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  resolveInitiativeId,
  loadAliases,
  registryPath,
  type AliasRegistry,
} from './initiative-id.ts';

function tmpQueue(): { queueRoot: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'forge-init-ids-'));
  mkdirSync(join(root, '_queue'), { recursive: true });
  return {
    queueRoot: join(root, '_queue'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Write a minimal hand-crafted registry that maps one canonical → handle. */
function writeRegistry(queueRoot: string, reg: Partial<AliasRegistry>): void {
  const full: AliasRegistry = {
    version: 1,
    by_handle: {},
    by_canonical: {},
    by_name: {},
    by_project: {},
    counters: {},
    ...reg,
  };
  writeFileSync(registryPath(queueRoot), JSON.stringify(full, null, 2));
}

// ---------------------------------------------------------------------------
// resolveInitiativeId
// ---------------------------------------------------------------------------

test('resolveInitiativeId: returns canonical input as-is (no registry needed)', () => {
  const { queueRoot, cleanup } = tmpQueue();
  try {
    const canonical = 'INIT-2026-05-19-trafficgame-backpressure-live';
    const r = resolveInitiativeId(canonical, { queueRoot });
    assert.equal(r.kind, 'ok');
    if (r.kind === 'ok') {
      assert.equal(r.canonical, canonical);
      assert.equal(r.handle, ''); // unminted — empty string
    }
  } finally {
    cleanup();
  }
});

test('resolveInitiativeId: canonical input fills handle from registry when minted', () => {
  const { queueRoot, cleanup } = tmpQueue();
  try {
    const canonical = 'INIT-2026-05-19-trafficgame-backpressure-live';
    writeRegistry(queueRoot, {
      by_handle: { 'traf#1': canonical },
      by_canonical: { [canonical]: { handle: 'traf#1', name: null } },
      counters: { traf: 1 },
    });
    const r = resolveInitiativeId(canonical, { queueRoot });
    assert.equal(r.kind, 'ok');
    if (r.kind === 'ok') {
      assert.equal(r.canonical, canonical);
      assert.equal(r.handle, 'traf#1');
    }
  } finally {
    cleanup();
  }
});

test('resolveInitiativeId: resolves handle (proj#N) to canonical via by_handle map', () => {
  const { queueRoot, cleanup } = tmpQueue();
  try {
    const canonical = 'INIT-2026-05-19-trafficgame-backpressure-live';
    writeRegistry(queueRoot, {
      by_handle: { 'traf#1': canonical },
      by_canonical: { [canonical]: { handle: 'traf#1', name: null } },
      counters: { traf: 1 },
    });
    const r = resolveInitiativeId('traf#1', { queueRoot });
    assert.equal(r.kind, 'ok');
    if (r.kind === 'ok') {
      assert.equal(r.canonical, canonical);
      assert.equal(r.handle, 'traf#1');
    }
  } finally {
    cleanup();
  }
});

test('resolveInitiativeId: resolves named alias when globally unique', () => {
  const { queueRoot, cleanup } = tmpQueue();
  try {
    const canonical = 'INIT-2026-05-19-trafficgame-backpressure-live';
    writeRegistry(queueRoot, {
      by_handle: { 'traf#1': canonical },
      by_canonical: { [canonical]: { handle: 'traf#1', name: 'backpressure' } },
      by_name: { backpressure: canonical },
      counters: { traf: 1 },
    });
    const r = resolveInitiativeId('backpressure', { queueRoot });
    assert.equal(r.kind, 'ok');
    if (r.kind === 'ok') {
      assert.equal(r.canonical, canonical);
      assert.equal(r.name, 'backpressure');
    }
  } finally {
    cleanup();
  }
});

test('resolveInitiativeId: ambiguous canonical-substring match returns kind=ambiguous with all matches', () => {
  const { queueRoot, cleanup } = tmpQueue();
  try {
    const c1 = 'INIT-2026-05-19-trafficgame-backpressure-live';
    const c2 = 'INIT-2026-05-10-intersection-backpressure';
    writeRegistry(queueRoot, {
      by_handle: { 'traf#1': c1, 'inte#1': c2 },
      by_canonical: {
        [c1]: { handle: 'traf#1', name: null },
        [c2]: { handle: 'inte#1', name: null },
      },
      counters: { traf: 1, inte: 1 },
    });
    const r = resolveInitiativeId('backpressure', { queueRoot });
    assert.equal(r.kind, 'ambiguous');
    if (r.kind === 'ambiguous') {
      assert.equal(r.matches.length, 2);
      assert.ok(r.matches.includes(c1));
      assert.ok(r.matches.includes(c2));
    }
  } finally {
    cleanup();
  }
});

test('resolveInitiativeId: unknown input returns kind=not-found', () => {
  const { queueRoot, cleanup } = tmpQueue();
  try {
    const r = resolveInitiativeId('not-a-real-thing', { queueRoot });
    assert.equal(r.kind, 'not-found');
  } finally {
    cleanup();
  }
});

test('resolveInitiativeId: empty / missing registry treats as empty (canonical input still resolves to itself)', () => {
  const { queueRoot, cleanup } = tmpQueue();
  try {
    // No registry on disk. A canonical-shaped input should still
    // resolve to itself (with handle = '') so the CLI can short-circuit
    // without minting on every read.
    const canonical = 'INIT-2026-05-19-trafficgame-backpressure-live';
    const r = resolveInitiativeId(canonical, { queueRoot });
    assert.equal(r.kind, 'ok');
    if (r.kind === 'ok') {
      assert.equal(r.canonical, canonical);
      assert.equal(r.handle, '');
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// loadAliases — parse-failure and empty-registry semantics (C16b)
// ---------------------------------------------------------------------------

test('loadAliases: returns empty registry when file does not exist', () => {
  const { queueRoot, cleanup } = tmpQueue();
  try {
    const reg = loadAliases({ queueRoot });
    assert.equal(reg.version, 1);
    assert.deepEqual(reg.by_handle, {});
    assert.deepEqual(reg.by_canonical, {});
    assert.deepEqual(reg.counters, {});
  } finally {
    cleanup();
  }
});

test('loadAliases: corrupt JSON treated as empty registry (idempotent replay over silent skip)', () => {
  const { queueRoot, cleanup } = tmpQueue();
  try {
    writeFileSync(registryPath(queueRoot), '{ not valid json at all');
    const reg = loadAliases({ queueRoot });
    assert.equal(reg.version, 1);
    assert.deepEqual(reg.by_handle, {});
  } finally {
    cleanup();
  }
});

test('loadAliases: reads a well-formed registry with multiple entries', () => {
  const { queueRoot, cleanup } = tmpQueue();
  try {
    const canonical = 'INIT-2026-05-19-trafficgame-x';
    writeRegistry(queueRoot, {
      by_handle: { 'traf#1': canonical },
      by_canonical: { [canonical]: { handle: 'traf#1', name: null } },
      by_project: { trafficgame: 'traf' },
      counters: { traf: 1 },
    });
    const reg = loadAliases({ queueRoot });
    assert.equal(reg.version, 1);
    assert.equal(reg.by_handle['traf#1'], canonical);
    assert.equal(reg.by_canonical[canonical].handle, 'traf#1');
    assert.equal(reg.counters.traf, 1);
  } finally {
    cleanup();
  }
});
