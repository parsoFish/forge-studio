/**
 * W8-C3 WI-2 — per-project activity + progress on the projects index
 * (projects-08 / forge-j1e / bead forge-6gv.13.2).
 *
 * RED at branch base (`d17b4251`): `/projects` shows no last-activity signal
 * and no in-flight-work signal at all. Home already computes an attention
 * rollup for sessions and KBs; projects had no equivalent on their own index.
 *
 * DERIVED, never stored (exit row 4). Both inputs already exist and are
 * already derived per request by the server:
 *   · `GET /api/studio/projects/attention` — `buildProjectAttention`
 *     (`cli/bridge-studio.ts:1377`) re-scans the queue on every call;
 *   · `GET /api/cycles` — the live + recent cycle snapshot.
 * Nothing here is cached, and no `Project` gains an activity field.
 *
 * HONEST ABSENCE is pinned as hard as the happy path. A project the attention
 * aggregate carried NO row for has `queue: null` — UNKNOWN — never a
 * fabricated `{planned:0,…}` "nothing queued". That fabrication is the same
 * shape `parseKbLint` refuses and the same shape `project-cycle-ledger.ts`
 * refuses for cost (`costUsd: null`, never `$0.00`).
 *
 * RUN: npx vitest run lib/projects-index-activity.test.ts   (from forge-ui/)
 */
import { test, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ usePathname: () => '/projects' }));

import { deriveProjectActivity } from './projects-index-activity.ts';
import type { Cycle, ProjectAttentionItem } from './bridge-client.ts';
import type { Project } from './studio-client.ts';
import { ProjectCard } from '@/components/studio/LibraryCard';
import { ProjectsIndexBody } from '@/components/studio/ProjectsIndex';

function attn(projectId: string, over: Partial<ProjectAttentionItem> = {}): ProjectAttentionItem {
  return { projectId, name: projectId, link: `/projects/${projectId}`, planned: 0, inFlight: 0, gated: 0, merged: 0, flagged: 0, ...over };
}

function cyc(over: Partial<Cycle> & { cycleId: string }): Cycle {
  return { initiativeId: 'INIT-x', status: 'in-flight', ...over } as Cycle;
}

// ---------------------------------------------------------------------------
// Queue counts — carried from the aggregate, never invented
// ---------------------------------------------------------------------------

test('queue counts come verbatim from this project\'s attention row', () => {
  const a = deriveProjectActivity('gitpulse', [attn('other', { planned: 9 }), attn('gitpulse', { planned: 2, inFlight: 1, gated: 3, merged: 0, flagged: 1 })], []);
  expect(a.queue).toEqual({ planned: 2, inFlight: 1, gated: 3, merged: 0, flagged: 1 });
});

test('HONEST ABSENCE: a project with NO attention row has queue === null — never a fabricated all-zero row', () => {
  const a = deriveProjectActivity('gitpulse', [attn('other')], []);
  expect(a.queue).toBeNull();
  expect(a.openCount).toBeNull();
});

test('a genuine all-zero attention row is DISTINCT from an absent one: queue is the zeros, openCount is 0', () => {
  const a = deriveProjectActivity('gitpulse', [attn('gitpulse')], []);
  expect(a.queue).toEqual({ planned: 0, inFlight: 0, gated: 0, merged: 0, flagged: 0 });
  expect(a.openCount).toBe(0);
});

test('openCount is the sum of the four attention-bearing queue states — flagged is a QUALITY signal, not a queue state, and is excluded', () => {
  const a = deriveProjectActivity('p', [attn('p', { planned: 1, inFlight: 2, gated: 3, merged: 4, flagged: 5 })], []);
  expect(a.openCount).toBe(10);
});

// ---------------------------------------------------------------------------
// Last activity — from the cycle snapshot
// ---------------------------------------------------------------------------

test('lastActivityIso is the most recent time across this project\'s cycles', () => {
  const cycles = [
    cyc({ cycleId: 'c1', project: 'p', startedAt: '2026-01-01T00:00:00Z' }),
    cyc({ cycleId: 'c2', project: 'p', startedAt: '2026-03-01T00:00:00Z' }),
    cyc({ cycleId: 'c3', project: 'other', startedAt: '2026-09-01T00:00:00Z' }),
  ];
  expect(deriveProjectActivity('p', [], cycles).lastActivityIso).toBe('2026-03-01T00:00:00Z');
});

test('endedAt outranks startedAt for "last activity" — a cycle that finished later IS the later activity', () => {
  const cycles = [cyc({ cycleId: 'c1', project: 'p', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-02-01T00:00:00Z' })];
  expect(deriveProjectActivity('p', [], cycles).lastActivityIso).toBe('2026-02-01T00:00:00Z');
});

test('a cycle carrying NO timestamps falls back to the ISO its cycleId embeds — the exact gap projects-27 closed for the ledger', () => {
  const cycles = [cyc({ cycleId: '2026-07-11T17-26-34_INIT-abc', project: 'p' })];
  expect(deriveProjectActivity('p', [], cycles).lastActivityIso).toBe('2026-07-11T17:26:34Z');
});

test('a cycle with no usable time at all contributes nothing — an unparsable stamp must never become "now" or sort first', () => {
  const cycles = [
    cyc({ cycleId: 'nostamp', project: 'p', startedAt: 'garbage' }),
    cyc({ cycleId: 'blank', project: 'p', startedAt: '   ' }),
  ];
  expect(deriveProjectActivity('p', [], cycles).lastActivityIso).toBeNull();
});

test('a cycle with NO project anchor is attributed to NO project — never to all of them', () => {
  const cycles = [cyc({ cycleId: 'c1', startedAt: '2026-05-05T00:00:00Z' })];
  expect(deriveProjectActivity('p', [], cycles).lastActivityIso).toBeNull();
  expect(deriveProjectActivity('p', [], cycles).progress).toBeNull();
});

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

test('progress counts merged+done cycles against every cycle this project has — the same terminal-merge rule project-cycle-ledger.ts uses', () => {
  const cycles = [
    cyc({ cycleId: 'a', project: 'p', status: 'done' }),
    cyc({ cycleId: 'b', project: 'p', status: 'merged' }),
    cyc({ cycleId: 'c', project: 'p', status: 'in-flight' }),
    cyc({ cycleId: 'd', project: 'p', status: 'failed' }),
    cyc({ cycleId: 'e', project: 'other', status: 'done' }),
  ];
  expect(deriveProjectActivity('p', [], cycles).progress).toEqual({ done: 2, total: 4 });
});

test('HONEST ABSENCE: a project with no cycles at all has progress === null — not 0/0, which reads as "nothing shipped"', () => {
  expect(deriveProjectActivity('p', [], []).progress).toBeNull();
});

// ---------------------------------------------------------------------------
// Purity + immutability
// ---------------------------------------------------------------------------

test('deriveProjectActivity mutates neither input array nor any element', () => {
  const attention = [attn('p', { planned: 1 })];
  const cycles = [cyc({ cycleId: 'c', project: 'p', startedAt: '2026-01-01T00:00:00Z' })];
  const snapshot = JSON.stringify({ attention, cycles });
  deriveProjectActivity('p', attention, cycles);
  expect(JSON.stringify({ attention, cycles })).toBe(snapshot);
});

// ---------------------------------------------------------------------------
// Render — the card derives from the RAW SOURCES it is handed, never from a
// pre-computed activity value. Same rule as health: no derived value crosses a
// prop boundary, so no prop can carry a stale copy.
// ---------------------------------------------------------------------------

test('ProjectCard renders activity DERIVED from the raw sources — data-last-activity carries the server\'s own ISO verbatim', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectCard, {
    project: { id: 'p', name: 'P', skills: [] } as Project,
    kbs: [], index: 0,
    attention: [attn('p', { planned: 2, inFlight: 1 })],
    cycles: [cyc({ cycleId: 'c', project: 'p', startedAt: '2026-08-01T00:00:00Z' })],
    nowMs: Date.parse('2026-08-03T00:00:00Z'),
  }));
  expect(html).toContain('data-last-activity="2026-08-01T00:00:00Z"');
  expect(html).toContain('data-open-count="3"');
  expect(html).toContain('2d ago');
});

test('ProjectCard: a project the attention aggregate skipped reads "unknown", NOT 0 — the card must not invent quiet', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectCard, {
    project: { id: 'p', name: 'P', skills: [] } as Project,
    kbs: [], index: 0, attention: [], cycles: [], nowMs: 0,
  }));
  expect(html).toContain('data-open-count="unknown"');
  expect(html).toContain('data-last-activity="none"');
  expect(html).not.toContain('data-open-count="0"');
});

test('ProjectCard on a shelf that supplies NO activity sources renders no activity row at all — opting out is distinct from "unknown"', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectCard, {
    project: { id: 'p', name: 'P', skills: [] } as Project, kbs: [], index: 0,
  }));
  expect(html).not.toContain('data-field="project-activity"');
});

test('ProjectCard surfaces a flagged plan count — the plan-quality signal buildProjectAttention already computes and nothing rendered', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectCard, {
    project: { id: 'p', name: 'P', skills: [] } as Project,
    kbs: [], index: 0, attention: [attn('p', { flagged: 2 })], cycles: [], nowMs: 0,
  }));
  expect(html).toContain('data-flagged="2"');
});

test('the index declares whether its activity read succeeded — a failed secondary read must not read as a quiet roster', () => {
  const ok = renderToStaticMarkup(React.createElement(ProjectsIndexBody, {
    projects: [{ id: 'p', name: 'P', skills: [] } as Project], kbs: [], ready: true,
    attention: [attn('p')], cycles: [],
  }));
  expect(ok).toContain('data-activity-status="ok"');

  const failed = renderToStaticMarkup(React.createElement(ProjectsIndexBody, {
    projects: [{ id: 'p', name: 'P', skills: [] } as Project], kbs: [], ready: true,
    activityError: { message: 'bridge refused (HTTP 500)' },
  }));
  expect(failed).toContain('data-activity-status="error"');
  expect(failed).toContain('bridge refused (HTTP 500)');
  // The ROSTER still renders — a failed activity read degrades one signal, it
  // does not take the page down.
  expect(failed).toContain('data-card-id="p"');
});

test('the index reports activity as "loading" until the secondary read settles — never "ok" with empty sources', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectsIndexBody, {
    projects: [{ id: 'p', name: 'P', skills: [] } as Project], kbs: [], ready: true,
  }));
  expect(html).toContain('data-activity-status="loading"');
});
