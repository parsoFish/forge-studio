/**
 * ACCEPTANCE TESTS (forge-01u) — every entry point in the guard family
 * (`resolveGuardedPath`, `guardedFile`, `guardedReadFile`, `guardedReadDir`,
 * `guardedWriteFile`) is a STRUCTURAL boundary: any request-influenced value
 * can arrive here, not just a string that happens to fail the charset/shape
 * checks. `isSafeSegment(seg: string)` is typed to accept only a string, but
 * nothing upstream of it enforces that at runtime — a JSON request body can
 * hand it any JSON-representable shape (an array, a plain object, a number,
 * a boolean, `null`) or, when called directly from TypeScript with a type
 * assertion, any JS value at all (`undefined`, a `Symbol`).
 *
 * A non-string segment must be rejected with the guard's ORDINARY,
 * already-documented failure value — `{ok:false, reason}` for
 * `resolveGuardedPath`, `null` for every `guarded*` wrapper — and must NEVER
 * throw and NEVER touch the filesystem. Today, several non-string shapes
 * (most importantly a plain array, e.g. `['abc']`) slip past
 * `isSafeSegment`'s checks — `Array.prototype.includes` is element-wise so
 * `!seg.includes('/')` is `true`, `seg.length > 0` is `true` for a non-empty
 * array, and the control-char regex coerces its argument to a string before
 * testing it — and only fail much later, when the accepted "safe" segment is
 * hand ed to `path.join()`, which throws a raw, untyped
 * `TypeError [ERR_INVALID_ARG_TYPE]`. That is a fail-CLOSED outcome (nothing
 * is read or written) but the WRONG SHAPE: an uncaught exception out of a
 * pure validation function, surfaced by its caller (the HTTP route) as a
 * generic 500 instead of the guard's own normal 400-shaped rejection.
 *
 * These tests pin the REQUIRED fix shape without pinning its exact location:
 * a structural `typeof seg === 'string'` gate somewhere in the guard family
 * such that every non-string segment collapses to the family's ordinary
 * rejection value, never an exception.
 *
 * HOUSE STYLE followed from `cli/studio-path-guard.test.ts`: `mkdtempSync`
 * fixtures, `try/finally` cleanup, property assertions (not brittle message
 * matching), and mandatory positive controls that must keep passing both
 * before and after the fix.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { resolveGuardedPath, guardedFile, guardedReadFile, guardedReadDir, guardedWriteFile } from './studio-path-guard.ts';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Recursive, sorted listing of every entry under `root` (relative paths) —
 *  used to prove a rejected call mutated NOTHING anywhere in the tree, not
 *  just at the one leaf under test. */
function snapshotTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      out.push(r);
      if (entry.isDirectory()) walk(join(dir, entry.name), r);
    }
  };
  if (existsSync(root)) walk(root, '');
  return out.sort();
}

/** Call `resolveGuardedPath(root, [value])` and assert the required shape:
 *  no throw, `{ok:false}`, non-empty `reason`. Returns the result so a
 *  caller can add further assertions. */
function assertSingleSegmentRejectsCleanly(root: string, value: unknown, label: string) {
  let threw: unknown = undefined;
  let result: ReturnType<typeof resolveGuardedPath> | undefined;
  try {
    result = resolveGuardedPath(root, [value] as unknown as readonly string[]);
  } catch (err) {
    threw = err;
  }
  assert.equal(
    threw,
    undefined,
    `${label}: resolveGuardedPath must NOT throw for a non-string segment — threw ${
      threw instanceof Error ? `${threw.constructor.name}: ${threw.message}` : String(threw)
    }`,
  );
  assert.ok(result, `${label}: expected resolveGuardedPath to return a result`);
  assert.equal(result!.ok, false, `${label}: expected {ok:false} for a non-string segment — got ${JSON.stringify(result)}`);
  if (!result!.ok) {
    assert.equal(typeof result!.reason, 'string', `${label}: reason must be a string`);
    assert.ok(result!.reason.length > 0, `${label}: reason must be non-empty`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// A. `resolveGuardedPath` — single non-string segment, every shape a JSON
//    request body (or a direct TS call with a type assertion) can produce.
// ---------------------------------------------------------------------------

const NON_STRING_SEGMENT_CASES: ReadonlyArray<{ label: string; value: unknown; redAtBase: boolean; baseBehavior: string }> = [
  {
    label: 'array ["abc"]',
    value: ['abc'],
    redAtBase: true,
    baseBehavior: 'isSafeSegment returns true (array .includes is element-wise); path.join(verified, seg) then throws TypeError',
  },
  {
    label: 'array ["a","b"]',
    value: ['a', 'b'],
    redAtBase: true,
    baseBehavior: 'same as ["abc"] — a multi-element array also slips past isSafeSegment and throws in path.join',
  },
  {
    label: 'null',
    value: null,
    redAtBase: true,
    baseBehavior: "isSafeSegment reads `seg.length` on null, which throws TypeError before any join is ever reached",
  },
  {
    label: 'undefined',
    value: undefined,
    redAtBase: true,
    baseBehavior: "isSafeSegment reads `seg.length` on undefined, which throws TypeError before any join is ever reached",
  },
  {
    label: "Symbol('x')",
    value: Symbol('x'),
    redAtBase: true,
    baseBehavior:
      'isSafeSegment itself returns false (no .length on a Symbol) with no throw, but the CALLER\'s rejection-message template literal (`unsafe path segment "${seg}"`) throws converting the Symbol to a string',
  },
  {
    label: 'plain object {}',
    value: {},
    redAtBase: false,
    baseBehavior: 'already rejects cleanly today — isSafeSegment: `{}.length` is undefined, so `seg.length > 0` is false',
  },
  {
    label: 'object with custom toString',
    value: { toString: () => 'abc' },
    redAtBase: false,
    baseBehavior: 'already rejects cleanly today — isSafeSegment reads `.length`, never consults `.toString`, so this behaves identically to a bare {}',
  },
  {
    label: 'number 42',
    value: 42,
    redAtBase: false,
    baseBehavior: 'already rejects cleanly today — a number has no `.length` property, so `seg.length > 0` is false',
  },
  {
    label: 'boolean true',
    value: true,
    redAtBase: false,
    baseBehavior: 'already rejects cleanly today — a boolean has no `.length` property, so `seg.length > 0` is false',
  },
];

for (const { label, value, redAtBase, baseBehavior } of NON_STRING_SEGMENT_CASES) {
  test(`resolveGuardedPath rejects a non-string segment cleanly, never throws — ${label} (${redAtBase ? 'RED at base' : 'already passes at base'}: ${baseBehavior})`, () => {
    const root = tmp('path-guard-nonstring-single-');
    try {
      assertSingleSegmentRejectsCleanly(root, value, label);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

// ---------------------------------------------------------------------------
// B. A non-string segment in a LATER position — the up-front per-segment
//    validation loop (which runs over every segment before any lstat/join)
//    must catch it regardless of where in the array it sits, not just at
//    index 0. `validdir` is a REAL, pre-existing directory so this exercises
//    the per-segment identity walk's own `join()`, not only create-mode
//    reassembly.
// ---------------------------------------------------------------------------

test('resolveGuardedPath rejects a non-string segment cleanly at a LATER position (RED at base: throws inside the per-segment walk, past a real, existing first segment)', () => {
  const root = tmp('path-guard-nonstring-later-');
  try {
    mkdirSync(join(root, 'validdir'));
    let threw: unknown = undefined;
    let result: ReturnType<typeof resolveGuardedPath> | undefined;
    try {
      result = resolveGuardedPath(root, ['validdir', ['abc']] as unknown as readonly string[]);
    } catch (err) {
      threw = err;
    }
    assert.equal(
      threw,
      undefined,
      `resolveGuardedPath must not throw for a non-string segment at index 1 — threw ${
        threw instanceof Error ? `${threw.constructor.name}: ${threw.message}` : String(threw)
      }`,
    );
    assert.ok(result, 'expected a result object');
    assert.equal(result!.ok, false, `expected {ok:false} — got ${JSON.stringify(result)}`);
    if (!result!.ok) {
      assert.ok(result!.reason.length > 0, 'reason must be non-empty');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// C. The whole guard FAMILY fails safely — every ergonomic wrapper collapses
//    a non-string segment to its OWN documented failure value (`null`), never
//    throws, and never touches the filesystem (proved with a before/after
//    recursive snapshot of the whole root, not just the one leaf under test).
// ---------------------------------------------------------------------------

test('guardedFile(mode="read") returns null (no throw, no fs mutation) for a non-string segment', () => {
  const root = tmp('path-guard-nonstring-guardedfile-read-');
  try {
    const before = snapshotTree(root);
    let threw = false;
    let result: string | null = 'unset';
    try {
      result = guardedFile(root, [['abc']] as unknown as readonly string[], 'read');
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'guardedFile(read) must not throw for a non-string segment');
    assert.equal(result, null, 'guardedFile(read) must return null for a non-string segment');
    assert.deepEqual(snapshotTree(root), before, 'guardedFile(read) must not create anything anywhere under root');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('guardedFile(mode="write") returns null (no throw, no fs mutation) for a non-string segment', () => {
  const root = tmp('path-guard-nonstring-guardedfile-write-');
  try {
    const before = snapshotTree(root);
    let threw = false;
    let result: string | null = 'unset';
    try {
      result = guardedFile(root, [['abc']] as unknown as readonly string[], 'write');
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'guardedFile(write) must not throw for a non-string segment');
    assert.equal(result, null, 'guardedFile(write) must return null for a non-string segment');
    assert.deepEqual(snapshotTree(root), before, 'guardedFile(write) must not create anything anywhere under root — it only resolves, never writes');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('guardedFile(mode="readdir") returns null (no throw, no fs mutation) for a non-string segment', () => {
  const root = tmp('path-guard-nonstring-guardedfile-readdir-');
  try {
    const before = snapshotTree(root);
    let threw = false;
    let result: string | null = 'unset';
    try {
      result = guardedFile(root, [['abc']] as unknown as readonly string[], 'readdir');
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'guardedFile(readdir) must not throw for a non-string segment');
    assert.equal(result, null, 'guardedFile(readdir) must return null for a non-string segment');
    assert.deepEqual(snapshotTree(root), before, 'guardedFile(readdir) must not create anything anywhere under root');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('guardedReadFile returns null (no throw, no fs mutation) for a non-string segment', () => {
  const root = tmp('path-guard-nonstring-readfile-');
  try {
    const before = snapshotTree(root);
    let threw = false;
    let result: string | null = 'unset';
    try {
      result = guardedReadFile(root, [['abc']] as unknown as readonly string[]);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'guardedReadFile must not throw for a non-string segment');
    assert.equal(result, null, 'guardedReadFile must return null for a non-string segment');
    assert.deepEqual(snapshotTree(root), before, 'guardedReadFile must not create anything anywhere under root');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('guardedReadDir returns null (no throw, no fs mutation) for a non-string segment', () => {
  const root = tmp('path-guard-nonstring-readdir-');
  try {
    const before = snapshotTree(root);
    let threw = false;
    let result: string[] | null = ['unset'];
    try {
      result = guardedReadDir(root, [['abc']] as unknown as readonly string[]);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'guardedReadDir must not throw for a non-string segment');
    assert.equal(result, null, 'guardedReadDir must return null for a non-string segment');
    assert.deepEqual(snapshotTree(root), before, 'guardedReadDir must not create anything anywhere under root');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('guardedWriteFile returns null (no throw) AND writes NOTHING anywhere under root for a non-string segment', () => {
  const root = tmp('path-guard-nonstring-writefile-');
  try {
    const before = snapshotTree(root);
    assert.deepEqual(before, [], 'precondition: a freshly created temp root must start empty');
    let threw = false;
    let result: string | null = 'unset';
    try {
      result = guardedWriteFile(root, [['abc']] as unknown as readonly string[], 'ATTACKER-DATA');
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'guardedWriteFile must not throw for a non-string segment');
    assert.equal(result, null, 'guardedWriteFile must return null for a non-string segment');
    assert.deepEqual(snapshotTree(root), before, 'guardedWriteFile must not write anything anywhere under root — the write must never happen');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// D. Positive controls — MUST pass before AND after the fix. A `typeof`
//    gate must reject ONLY non-string segments; every legitimate string
//    shape (safe or unsafe) must keep behaving exactly as it does today.
// ---------------------------------------------------------------------------

test('positive control (passes before AND after any fix): a legitimate single string segment resolves {ok:true}', () => {
  const root = tmp('path-guard-nonstring-positive-single-');
  try {
    const result = resolveGuardedPath(root, ['legit-agent']);
    assert.equal(result.ok, true, `expected a legitimate single segment to resolve — got ${JSON.stringify(result)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('positive control (passes before AND after any fix): a legitimate nested string path resolves {ok:true}', () => {
  const root = tmp('path-guard-nonstring-positive-nested-');
  try {
    mkdirSync(join(root, 'legit-agent'));
    const result = resolveGuardedPath(root, ['legit-agent', 'SKILL.md']);
    assert.equal(result.ok, true, `expected a legitimate nested path to resolve — got ${JSON.stringify(result)}`);
    if (result.ok) {
      assert.equal(result.exists, false, 'the leaf does not exist yet — this is a create-mode save');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('positive control (passes before AND after any fix): genuinely unsafe STRING segments still reject with {ok:false} — the fix must not weaken isSafeSegment', () => {
  const root = tmp('path-guard-nonstring-positive-unsafe-');
  try {
    // Confirmed empirically unsafe TODAY (unlike a bare leading-space segment,
    // which this suite does NOT claim is unsafe — see the report's discrepancy
    // note): a literal ".." or "." token, an embedded separator, and an empty
    // segment are all rejected by isSafeSegment's existing string-shape checks.
    for (const seg of ['..', 'a/b', '', '.']) {
      const result = resolveGuardedPath(root, [seg]);
      assert.equal(result.ok, false, `expected "${seg}" to still be rejected as an unsafe STRING segment — got ${JSON.stringify(result)}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
