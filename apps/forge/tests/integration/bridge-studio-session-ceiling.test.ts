/**
 * forge-nk1y.5 — the session-shell envelope carries the session's spend ceiling.
 *
 * Every session now starts with `costCeilingUsd` + `costCeilingSource` stamped
 * in status.json; the operator must SEE it. The envelope serves it as
 * `ceiling: {usd, source} | null`, ALWAYS present: null means the session
 * recorded none (legacy / pre-change) or recorded an unusable value — never a
 * fabricated figure, never an omitted key (absence would read as "uncapped").
 */
import { bridgeUrl, forgeRoot } from '../test-fixtures/studio-sessions-bridge.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT = 'demoproj';

function writeStatusSession(sessionId: string, extra: Record<string, unknown>): void {
  const dir = join(forgeRoot, '_logs', '_sessions', PROJECT, '_instructions', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'prompt.md'), 'Author AGENTS.md.\n', 'utf8');
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sessionId, project: PROJECT, phase: 'drafting', ...extra }), 'utf8');
}

async function ceilingOf(sessionId: string): Promise<unknown> {
  const res = await fetch(`${bridgeUrl}/api/studio/sessions/instructions/${sessionId}?project=${PROJECT}`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as Record<string, unknown>;
  assert.ok('ceiling' in body, 'the envelope must ALWAYS carry "ceiling" (null is the honest value, absence is not)');
  return body['ceiling'];
}

test('a session stamped costCeilingUsd 3 / agent-budget serves ceiling {usd: 3, source: "agent-budget"}', async () => {
  writeStatusSession('2026-10-09T10-00-00', { costCeilingUsd: 3, costCeilingSource: 'agent-budget' });
  assert.deepEqual(await ceilingOf('2026-10-09T10-00-00'), { usd: 3, source: 'agent-budget' });
});

test('each recorded source ("operator", "env") rides through verbatim', async () => {
  writeStatusSession('2026-10-09T10-01-00', { costCeilingUsd: 12.5, costCeilingSource: 'operator' });
  writeStatusSession('2026-10-09T10-02-00', { costCeilingUsd: 7, costCeilingSource: 'env' });
  assert.deepEqual(await ceilingOf('2026-10-09T10-01-00'), { usd: 12.5, source: 'operator' });
  assert.deepEqual(await ceilingOf('2026-10-09T10-02-00'), { usd: 7, source: 'env' });
});

test('a legacy session with no ceiling fields serves ceiling null (key present, not omitted)', async () => {
  writeStatusSession('2026-10-09T10-03-00', {});
  assert.equal(await ceilingOf('2026-10-09T10-03-00'), null);
});

test('a present-but-invalid costCeilingUsd (-1, 0, a string, NaN-as-null) serves ceiling null, never a fabricated figure', async () => {
  const cases: [string, unknown][] = [
    ['2026-10-09T10-04-00', -1],
    ['2026-10-09T10-04-01', 0],
    ['2026-10-09T10-04-02', '3'],
    ['2026-10-09T10-04-03', null],
  ];
  for (const [sid, bad] of cases) {
    writeStatusSession(sid, { costCeilingUsd: bad, costCeilingSource: 'agent-budget' });
    assert.equal(await ceilingOf(sid), null, `costCeilingUsd ${JSON.stringify(bad)} must serve null`);
  }
});

test('a present-but-unknown costCeilingSource serves ceiling null, never an unlabelled figure', async () => {
  writeStatusSession('2026-10-09T10-05-00', { costCeilingUsd: 3, costCeilingSource: 'vibes' });
  assert.equal(await ceilingOf('2026-10-09T10-05-00'), null);
  writeStatusSession('2026-10-09T10-05-01', { costCeilingUsd: 3 });
  assert.equal(await ceilingOf('2026-10-09T10-05-01'), null);
});
