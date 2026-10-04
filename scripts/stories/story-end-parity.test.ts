/**
 * Row 207 (forge-8vfn.8.5.57, T1 1973qo): story-end parity prints its
 * per-channel trail. Run 3's log at 5e58de00 carried no story-end parity
 * line at all — the verdict gated, but ok / satisfied / PRODUCT RED /
 * DEFERRED never reached the operator.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { storyEndParity } from './run-observe.mjs';

test('storyEndParity logs one line per judged channel and returns the verdict', () => {
  const root = mkdtempSync(join(tmpdir(), 'story-end-parity-'));
  const out: string[] = [];
  const log = console.log;
  try {
    mkdirSync(join(root, 'studio'), { recursive: true });
    writeFileSync(join(root, 'studio', 'session-kinds.yaml'), '[]\n');
    const dir = join(root, '_logs', '_agent-onboarding-agent-2026-10-05T00-00-00-000-abcd');
    mkdirSync(dir, { recursive: true });
    const row = (event_id: string, event_type: string, parent_event_id?: string) =>
      JSON.stringify({ event_id, cycle_id: 'c', started_at: '2026-10-05T00:00:00.000Z', phase: 'agent', skill: 'onboarding-agent', event_type, parent_event_id, input_refs: [], output_refs: [] });
    writeFileSync(join(dir, 'events.jsonl'), `${row('EV_a', 'start')}\n${row('EV_b', 'end', 'EV_a')}\n`);
    console.log = (...a: unknown[]) => { out.push(a.join(' ')); };
    const parity = storyEndParity({ root, startedMs: 0, reapedDirs: new Set(), deferInto: [] });
    console.log = log;
    assert.equal(parity.verdict.results.length, 1);
    assert.ok(out.some((l) => l.includes('agent-parity:') && l.includes(dir)), out.join('\n'));
  } finally {
    console.log = log;
    rmSync(root, { recursive: true, force: true });
  }
});
