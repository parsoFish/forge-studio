/**
 * W7-B7 route pins (artifact-plan-15) — the review-comment sidecar's edit +
 * delete endpoints. The UI's only prior mutations were append + resolve, so a
 * non-blocking comment (no resolve affordance) was PERMANENT and a typo'd
 * concern could never be corrected. Both routes reuse the same proper-lockfile
 * guard and return the full sidecar + re-derived verdict, like append/resolve.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

const CYCLE = '2026-01-01T00-00-00_INIT-2026-01-01-b7-comments';

async function post(url: string, path: string, body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test('review-comments edit + delete round-trip: append → edit body/blocking → delete; verdict re-derived at each step', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'b7-rc-routes-'));
  try {
    mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
    for (const s of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
      mkdirSync(join(forgeRoot, '_queue', s), { recursive: true });
    }
    const { url, close } = await startBridge({ forgeRoot, port: 0 });
    try {
      // Append a NON-blocking comment (the class that used to be permanent).
      const added = await post(url, `/api/review-comments/${CYCLE}`, { region: 'ac-1', body: 'nit: label casing', blocking: false });
      assert.equal(added.status, 200);
      const id = added.json.comment.id as string;
      assert.equal(added.json.derivedVerdict.kind, 'approve');

      // Edit: escalate to blocking with a corrected body.
      const edited = await post(url, `/api/review-comments/${CYCLE}/edit`, { commentId: id, body: 'label casing breaks the AC', blocking: true });
      assert.equal(edited.status, 200);
      assert.equal(edited.json.comments[0].body, 'label casing breaks the AC');
      assert.equal(edited.json.comments[0].blocking, true);
      assert.equal(edited.json.derivedVerdict.kind, 'send-back', 'edit re-derives the verdict');

      // Empty patch refused.
      const nothing = await post(url, `/api/review-comments/${CYCLE}/edit`, { commentId: id });
      assert.equal(nothing.status, 400);

      // Delete clears it — the sidecar is empty and the verdict re-derives approve.
      const deleted = await post(url, `/api/review-comments/${CYCLE}/delete`, { commentId: id });
      assert.equal(deleted.status, 200);
      assert.equal(deleted.json.comments.length, 0);
      assert.equal(deleted.json.derivedVerdict.kind, 'approve');

      // Missing commentId → 400 (both routes).
      assert.equal((await post(url, `/api/review-comments/${CYCLE}/edit`, { body: 'x' })).status, 400);
      assert.equal((await post(url, `/api/review-comments/${CYCLE}/delete`, {})).status, 400);

      // Traversal cycleId → 400, never a write.
      assert.equal((await post(url, `/api/review-comments/${encodeURIComponent('../evil')}/delete`, { commentId: 'C-1' })).status, 400);
    } finally {
      await close();
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

/**
 * bead forge-8vfn.6.10.20 — ONE `isSafeCycleId`, and it is the flows one.
 *
 * The predicate was defined TWICE for one question: `packages/flows/manifest-path-guard.ts`
 * (type-checked, capped at 200 characters, regex) and `packages/factory/review-comments.ts`
 * (regex alone). The factory copy was the one guarding these routes, and it is
 * strictly weaker on two counts that are demonstrable rather than theoretical:
 * `SAFE_CYCLE_ID_RE.test(7)` is `true` (RegExp coerces its argument, and "7"
 * matches), and a 300-character id passes a pattern with no length bound.
 *
 * The LENGTH gap is asserted at the ROUTE, because that is where the weaker
 * guard actually stood — a unit test on the predicate would have passed against
 * the copy too; it was the callers that got the weak one.
 *
 * The TYPE gap is NOT asserted here, deliberately. A URL path segment is always
 * a string, so `isSafeCycleId(7)` is unreachable from the wire; a route test for
 * it would be green before and after this change and would prove nothing. It is
 * real in the copy and worth deleting, and that is what the structural
 * assertion below covers: the copy is gone, so the gap cannot come back.
 */
test('a cycle id past the 200-character cap is refused by the review-comment routes (kills: the factory copy of isSafeCycleId, whose regex has no length bound)', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'rc-cycleid-len-'));
  try {
    mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
    for (const s of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
      mkdirSync(join(forgeRoot, '_queue', s), { recursive: true });
    }
    const { url, close } = await startBridge({ forgeRoot, port: 0 });
    try {
      const tooLong = `A${'b'.repeat(220)}`;
      assert.equal(tooLong.length > 200, true, 'precondition: past the cap the flows predicate enforces');
      const res = await post(url, `/api/review-comments/${tooLong}`, { region: 'ac-1', body: 'x' });
      assert.equal(res.status, 400, 'an unbounded cycle id must be refused, not turned into a path segment');
    } finally { await close(); }
  } finally { rmSync(forgeRoot, { recursive: true, force: true }); }
});

test('the factory declares no cycle-id predicate of its own (kills: two definitions that agree today and drift tomorrow)', () => {
  const source = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'factory', 'review-comments.ts'), 'utf8');
  assert.equal(/export function isSafeCycleId/.test(source), false, 'the copy is deleted, not merely unused');
  assert.equal(/SAFE_CYCLE_ID_RE/.test(source), false, 'and so is its private regex');
  assert.match(source, /manifest-path-guard\.ts/, 'it imports the one predicate instead');
});
