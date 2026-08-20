import { describe, it, expect } from 'vitest';

import {
  toActivityRows,
  deriveLastActivityLine,
  formatActivityCostTicker,
  ACTIVITY_THINKING_CLAMP_CHARS,
  ACTIVITY_LOG_MAX_ROWS,
  REDACTED_THINKING_MARKER,
} from './activity-log-view';
import type { EventLogEntry } from './bridge-client';

function ev(partial: Partial<EventLogEntry> & { event_id: string; event_type: string }): EventLogEntry {
  return {
    event_id: partial.event_id,
    initiative_id: 'init-1',
    started_at: '2026-08-15T00:00:00.000Z',
    phase: 'architect',
    skill: 'architect-runner',
    event_type: partial.event_type,
    message: partial.message,
    metadata: partial.metadata,
  };
}

describe('toActivityRows — tool_use rows', () => {
  it('derives a full-text tool row from metadata.tool + metadata.input_summary', () => {
    const rows = toActivityRows([
      ev({ event_id: 'e1', event_type: 'tool_use', metadata: { tool: 'Read', input_summary: 'src/foo.ts' } }),
    ]);
    expect(rows).toEqual([{ key: 'e1', kind: 'tool', tag: 'Read', text: 'src/foo.ts', clamp: null }]);
  });

  it('falls back to an empty detail when input_summary is absent (never fabricated)', () => {
    const rows = toActivityRows([ev({ event_id: 'e1', event_type: 'tool_use', metadata: { tool: 'Bash' } })]);
    expect(rows[0]).toEqual({ key: 'e1', kind: 'tool', tag: 'Bash', text: '', clamp: null });
  });

  it('falls back to the event skill when metadata.tool is missing', () => {
    const rows = toActivityRows([ev({ event_id: 'e1', event_type: 'tool_use', metadata: {} })]);
    expect(rows[0].tag).toBe('architect-runner');
  });

  it('derives the coalesced summary row from metadata.coalesced_count/sampled_out_count', () => {
    const rows = toActivityRows([
      ev({
        event_id: 'e1',
        event_type: 'tool_use',
        message: 'tool.coalesced',
        metadata: { coalesced: true, coalesced_count: 12, sampled_out_count: 30 },
      }),
    ]);
    expect(rows).toEqual([
      { key: 'e1', kind: 'tool-coalesced', tag: 'coalesced', text: '12 coalesced · 30 sampled out', clamp: null },
    ]);
  });

  it('coalesced row with only one non-zero count omits the other', () => {
    const rows = toActivityRows([
      ev({ event_id: 'e1', event_type: 'tool_use', metadata: { coalesced: true, coalesced_count: 5, sampled_out_count: 0 } }),
    ]);
    expect(rows[0].text).toBe('5 coalesced');
  });
});

describe('toActivityRows — thinking/reasoning clamp+expand model', () => {
  it('a thinking block at or under the clamp threshold gets clamp: null', () => {
    const text = 'a'.repeat(ACTIVITY_THINKING_CLAMP_CHARS);
    const rows = toActivityRows([ev({ event_id: 'e1', event_type: 'log', message: text, metadata: { kind: 'thinking' } })]);
    expect(rows[0]).toEqual({ key: 'e1', kind: 'thinking', tag: 'think', text, clamp: null });
  });

  it('a thinking block over the clamp threshold carries shown/restChars', () => {
    const text = 'a'.repeat(ACTIVITY_THINKING_CLAMP_CHARS + 50);
    const rows = toActivityRows([ev({ event_id: 'e1', event_type: 'log', message: text, metadata: { kind: 'thinking' } })]);
    expect(rows[0].kind).toBe('thinking');
    expect(rows[0].text).toBe(text);
    expect(rows[0].clamp).toEqual({ shown: 'a'.repeat(ACTIVITY_THINKING_CLAMP_CHARS), restChars: 50 });
  });

  it('reasoning rows get the same clamp treatment as thinking rows', () => {
    const text = 'b'.repeat(ACTIVITY_THINKING_CLAMP_CHARS + 10);
    const rows = toActivityRows([ev({ event_id: 'e1', event_type: 'log', message: text, metadata: { kind: 'reasoning' } })]);
    expect(rows[0]).toEqual({
      key: 'e1',
      kind: 'reasoning',
      tag: 'reason',
      text,
      clamp: { shown: 'b'.repeat(ACTIVITY_THINKING_CLAMP_CHARS), restChars: 10 },
    });
  });

  it('a log event with no kind (or an unrelated kind) produces no row', () => {
    const rows = toActivityRows([
      ev({ event_id: 'e1', event_type: 'log', message: 'plain operator-facing note' }),
      ev({ event_id: 'e2', event_type: 'log', message: 'x', metadata: { kind: 'something-else' } }),
    ]);
    expect(rows).toEqual([]);
  });
});

describe('toActivityRows — redacted literal + cap-marker rows', () => {
  it('renders the literal [thinking redacted] marker verbatim, unclamped', () => {
    const rows = toActivityRows([
      ev({ event_id: 'e1', event_type: 'log', message: REDACTED_THINKING_MARKER, metadata: { kind: 'thinking' } }),
    ]);
    expect(rows).toEqual([
      { key: 'e1', kind: 'thinking-redacted', tag: 'think', text: REDACTED_THINKING_MARKER, clamp: null },
    ]);
  });

  it('a metadata.capped thinking row renders as a capped row, not a plain thinking row', () => {
    const rows = toActivityRows([
      ev({
        event_id: 'e1',
        event_type: 'log',
        message: '[thinking capped after 300 rows]',
        metadata: { kind: 'thinking', capped: true },
      }),
    ]);
    expect(rows).toEqual([
      { key: 'e1', kind: 'capped', tag: 'think', text: '[thinking capped after 300 rows]', clamp: null },
    ]);
  });

  it('a metadata.capped reasoning row renders as a capped row tagged reason', () => {
    const rows = toActivityRows([
      ev({
        event_id: 'e1',
        event_type: 'log',
        message: '[reasoning capped after 300 rows]',
        metadata: { kind: 'reasoning', capped: true },
      }),
    ]);
    expect(rows[0].kind).toBe('capped');
    expect(rows[0].tag).toBe('reason');
  });
});

describe('toActivityRows — row cap + ordering', () => {
  it('keeps only the newest ACTIVITY_LOG_MAX_ROWS rows, in order', () => {
    const events: EventLogEntry[] = [];
    for (let i = 0; i < ACTIVITY_LOG_MAX_ROWS + 20; i++) {
      events.push(ev({ event_id: `e${i}`, event_type: 'tool_use', metadata: { tool: 'Read', input_summary: `f${i}.ts` } }));
    }
    const rows = toActivityRows(events);
    expect(rows).toHaveLength(ACTIVITY_LOG_MAX_ROWS);
    expect(rows[0].key).toBe('e20');
    expect(rows[rows.length - 1].key).toBe(`e${ACTIVITY_LOG_MAX_ROWS + 19}`);
  });

  it('ignores event types the drawer has no row for', () => {
    const rows = toActivityRows([
      ev({ event_id: 'e1', event_type: 'agent_heartbeat', metadata: {} }),
      ev({ event_id: 'e2', event_type: 'file_change', metadata: { path: 'a.ts', op: 'edit' } }),
      ev({ event_id: 'e3', event_type: 'start', message: 'turn start' }),
    ]);
    expect(rows).toEqual([]);
  });
});

describe('deriveLastActivityLine', () => {
  it('is the honest empty state when there are no rows yet', () => {
    expect(deriveLastActivityLine([])).toBe('Waiting for activity…');
  });

  it('summarises the newest row as "tag · detail"', () => {
    const rows = toActivityRows([ev({ event_id: 'e1', event_type: 'tool_use', metadata: { tool: 'Grep', input_summary: 'TODO @ src/' } })]);
    expect(deriveLastActivityLine(rows)).toBe('Grep · TODO @ src/');
  });

  it('falls back to the bare tag when the newest row has no detail text', () => {
    const rows = toActivityRows([ev({ event_id: 'e1', event_type: 'tool_use', metadata: { tool: 'Bash' } })]);
    expect(deriveLastActivityLine(rows)).toBe('Bash');
  });

  it('truncates a long detail to 80 chars with an ellipsis', () => {
    const long = 'x'.repeat(120);
    const rows = toActivityRows([ev({ event_id: 'e1', event_type: 'tool_use', metadata: { tool: 'Read', input_summary: long } })]);
    expect(deriveLastActivityLine(rows)).toBe(`Read · ${'x'.repeat(80)}…`);
  });
});

describe('formatActivityCostTicker', () => {
  it('returns null when nothing is wired (never fabricates a $0.00)', () => {
    expect(formatActivityCostTicker({})).toBeNull();
  });

  it('formats cost only', () => {
    expect(formatActivityCostTicker({ costUsd: 0.184 })).toBe('$0.18');
  });

  it('formats tokens under 1000 as a bare count', () => {
    expect(formatActivityCostTicker({ tokensTotal: 420 })).toBe('420 tok');
  });

  it('formats tokens at/over 1000 in k-notation', () => {
    expect(formatActivityCostTicker({ tokensTotal: 41300 })).toBe('41.3k tok');
  });

  it('formats sub-minute elapsed as bare seconds', () => {
    expect(formatActivityCostTicker({ elapsedMs: 45_000 })).toBe('45s');
  });

  it('formats multi-minute elapsed as Xm Ys', () => {
    expect(formatActivityCostTicker({ elapsedMs: 192_000 })).toBe('3m 12s');
  });

  it('joins every provided field with " · " in order', () => {
    expect(formatActivityCostTicker({ costUsd: 0.18, tokensTotal: 41300, elapsedMs: 192_000 })).toBe('$0.18 · 41.3k tok · 3m 12s');
  });
});

// ---------------------------------------------------------------------------
// W7-B2 (knowledge-01) — metadata.kind:'progress' rows render (the kb-drain
// loop's own per-transition events); plain kind-less log rows still don't.
// ---------------------------------------------------------------------------

it('W7-B2: a log event with metadata.kind "progress" renders a progress row with the transition tag', () => {
  const rows = toActivityRows([
    {
      event_id: 'p1', event_type: 'log',
      message: 'kb-drain.turn-start (brain-read-policy.md · checkStaleness · 1/3)',
      metadata: { kind: 'progress', file: '/x/brain-read-policy.md' },
    } as never,
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe('progress');
  expect(rows[0].tag).toBe('turn-start');
  expect(rows[0].text).toContain('brain-read-policy.md');
});

it('W7-B2: a plain kind-less log row still renders NOTHING (progress is opt-in per event)', () => {
  const rows = toActivityRows([
    { event_id: 'l1', event_type: 'log', message: 'some operator-facing line', metadata: {} } as never,
  ]);
  expect(rows).toHaveLength(0);
});
