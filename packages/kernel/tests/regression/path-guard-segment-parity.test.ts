/**
 * forge-8vfn.5.59 — `isSafeSegment` and `isSafeSubPath` are documented (see
 * `isSafeSubPath`'s own docstring in `path-guard.ts`) as ONE shared predicate
 * "so the cheap 400 layer and the containment 404 layer cannot drift" — but
 * today that claim is FALSE. `DEL_RE` (0x7f) and `ENCODED_TRAVERSAL_RE`
 * (`%2f`/`%5c`/`%00`/`%2e%2e`) are applied only inside `isSafeSubPath`, never
 * inside `isSafeSegment`. `resolveGuardedPath`'s own per-segment walk calls
 * `isSafeSegment` directly (never `isSafeSubPath`), so a segment carrying a
 * DEL byte or a literal percent-encoded traversal sequence is accepted by the
 * per-segment containment walk while a route that pre-validates the SAME
 * value with `isSafeSubPath` (the "cheap 400 layer") rejects it — the exact
 * drift the shared-predicate design was supposed to make structurally
 * impossible.
 *
 * THIS IS A PARITY TEST, not a containment-escape test: for any input with no
 * `/`, `isSafeSubPath` reduces to exactly one segment, so it MUST agree with
 * `isSafeSegment` on that same input — no other code exists between them
 * (`isSafeSubPath`'s own docstring: "it is `isSafeSegment` applied per
 * segment ... plus DEL and percent-encoded separators" — the "plus" is
 * precisely the drift). A single shared predicate makes `isSafeSubPath` on a
 * one-segment input structurally IDENTICAL to `isSafeSegment` on that input;
 * today it is not.
 *
 * MUTATION SELF-CHECK (for the fix, not committed here): removing either
 * `DEL_RE` or `ENCODED_TRAVERSAL_RE` from whichever function ends up holding
 * the shared check reintroduces exactly this test's failure — that is what
 * makes this a parity test rather than two independent unit tests that could
 * both pass by coincidence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeSegment, isSafeSubPath } from '../../path-guard.ts';

/** Adversarial battery: every input is a SINGLE segment (no `/`), so
 *  `isSafeSubPath` must reduce to exactly `isSafeSegment` on it. Each row
 *  documents which of the two functions is expected to be correct today. */
const SINGLE_SEGMENT_CASES: ReadonlyArray<{ label: string; seg: string }> = [
  { label: 'bare DEL (0x7f)', seg: '' },
  { label: 'DEL embedded in an otherwise-ordinary name', seg: 'agentid' },
  { label: 'encoded dot-dot ("%2e%2e")', seg: '%2e%2e' },
  { label: 'encoded dot-dot, uppercase ("%2E%2E")', seg: '%2E%2E' },
  { label: 'encoded forward slash ("%2f")', seg: 'a%2fb' },
  { label: 'encoded backslash ("%5c")', seg: 'a%5cb' },
  { label: 'encoded NUL ("%00")', seg: 'a%00b' },
  { label: 'ordinary safe name (non-regression)', seg: 'my-agent' },
  { label: 'a legitimate dot-dot-PREFIXED name (non-regression)', seg: '..foo' },
];

test('forge-8vfn.5.59 (RED until fixed): isSafeSegment and isSafeSubPath must agree on every single-segment input — no drift between the 400 layer and the 404 layer', () => {
  const mismatches: string[] = [];
  for (const { label, seg } of SINGLE_SEGMENT_CASES) {
    const segVerdict = isSafeSegment(seg);
    const subPathVerdict = isSafeSubPath(seg);
    if (segVerdict !== subPathVerdict) {
      mismatches.push(
        `${label} (${JSON.stringify(seg)}): isSafeSegment=${segVerdict}, isSafeSubPath=${subPathVerdict}`,
      );
    }
  }
  assert.deepEqual(
    mismatches,
    [],
    `isSafeSegment and isSafeSubPath disagree on ${mismatches.length} single-segment input(s) — this is the ` +
      `documented-one-predicate claim being false:\n${mismatches.join('\n')}`,
  );
});

test('forge-8vfn.5.59: both functions REJECT a DEL byte and a percent-encoded traversal sequence (the concrete drift shapes, pinned individually)', () => {
  assert.equal(isSafeSegment(''), false, 'isSafeSegment must reject a bare DEL byte');
  assert.equal(isSafeSubPath(''), false, 'isSafeSubPath must reject a bare DEL byte');
  assert.equal(isSafeSegment('%2e%2e'), false, 'isSafeSegment must reject an encoded dot-dot sequence');
  assert.equal(isSafeSubPath('%2e%2e'), false, 'isSafeSubPath must reject an encoded dot-dot sequence');
});

test('forge-8vfn.5.59: resolveGuardedPath\'s own per-segment walk uses isSafeSegment directly — a DEL/encoded-traversal segment must be rejected there too, not just in isSafeSubPath', async () => {
  const { resolveGuardedPath } = await import('../../path-guard.ts');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');

  const root = mkdtempSync(join(tmpdir(), 'path-guard-segment-parity-'));
  try {
    const delResult = resolveGuardedPath(root, ['fresh-id', 'agentid']);
    assert.equal(
      delResult.ok,
      false,
      `expected resolveGuardedPath to reject a segment carrying a DEL byte — got ${JSON.stringify(delResult)}`,
    );

    const encodedResult = resolveGuardedPath(root, ['fresh-id', 'a%2e%2eb']);
    assert.equal(
      encodedResult.ok,
      false,
      `expected resolveGuardedPath to reject a segment carrying an encoded traversal sequence — got ${JSON.stringify(encodedResult)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
