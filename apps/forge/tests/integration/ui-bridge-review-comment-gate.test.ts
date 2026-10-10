/**
 * forge-mfv5.1.28 — through the real bridge: a blocking comment whose body
 * carries `python3 -m pytest tests/` derives a send-back whose criterion WHEN
 * runs it and whose `qualityGateCmd` is it, and the cycle log records the
 * extraction (`review.comment-gate-extracted`); a pipeline is refused by name
 * on an `error` event and the derived verdict keeps the project-gate fallback.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../ui-bridge.ts';

const CYCLE = '2026-10-10T01-55-59_INIT-2026-10-10-i1-honest-baseline';

async function post(url: string, path: string, body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const events = (forgeRoot: string): Array<Record<string, any>> => {
  const p = join(forgeRoot, '_logs', CYCLE, 'events.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

test('a blocking comment\'s inline runner command becomes the derived WHEN + qualityGateCmd, logged; a pipeline is refused on an error event', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'mfv5-1-28-gate-'));
  try {
    mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
    const { url, close } = await startBridge({ forgeRoot, port: 0 });
    try {
      const added = await post(url, `/api/review-comments/${CYCLE}`, { region: 'ac-2', body: 'AC2 unmet: `python3 -m pytest tests/` still deselects two tests', blocking: true });
      assert.equal(added.status, 200);
      const v = added.json.derivedVerdict;
      assert.equal(v.kind, 'send-back');
      assert.deepEqual(v.qualityGateCmd, ['python3', '-m', 'pytest', 'tests/']);
      assert.equal(v.acceptanceCriteria[0].when, 'the operator runs `python3 -m pytest tests/`');
      const ok = events(forgeRoot).filter((e) => e.message === 'review.comment-gate-extracted');
      assert.equal(ok.length, 1);
      assert.equal(ok[0]!.event_type, 'log');
      assert.deepEqual(ok[0]!.metadata, { comment_id: 'C-1', cmd: ['python3', '-m', 'pytest', 'tests/'] });

      // GET re-derives the same gate (no event — reading is not extracting).
      const got = await (await fetch(`${url}/api/review-comments/${CYCLE}`)).json() as any;
      assert.deepEqual(got.derivedVerdict.qualityGateCmd, ['python3', '-m', 'pytest', 'tests/']);
      assert.equal(events(forgeRoot).filter((e) => e.message === 'review.comment-gate-extracted').length, 1);

      // Edit to a pipeline: refused by name, fallback kept.
      const edited = await post(url, `/api/review-comments/${CYCLE}/edit`, { commentId: 'C-1', body: 'run `pytest tests/ | tee out.txt`' });
      assert.equal(edited.status, 200);
      assert.equal(edited.json.derivedVerdict.qualityGateCmd, undefined);
      const err = events(forgeRoot).filter((e) => e.message === 'review.comment-gate-extracted' && e.event_type === 'error');
      assert.equal(err.length, 1);
      assert.equal(err[0]!.metadata.cmd, 'pytest tests/ | tee out.txt');
      assert.match(err[0]!.metadata.reason, /pipeline/);
    } finally {
      await close();
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
