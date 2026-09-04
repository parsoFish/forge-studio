/**
 * flow-builder-acts.test.ts — the two acts the flow builder exists for, as
 * pure rules, so the pointer path and the declared-handle path cannot diverge.
 *
 * THE MEASURED DEFECT (bead `forge-8vfn.5.12`, S4 beat 4, re-measured by M5-B
 * on 2026-09-04 at `b442e079`): placing a station is an HTML5 dragstart onto
 * the canvas and drawing an edge is a drag between two ReactFlow `[data-handleid]`
 * markup internals. A story's `do` step resolves `[data-field=…]` and
 * `[data-action=…]` only, so the single act the builder exists for could not be
 * named by anything driving forge-ui through its own declared contract —
 * `data-node-count: expected "4", got "3"`.
 *
 * The capability was never missing; the declared HANDLE was. These rules are
 * extracted so the new handle calls the SAME code the drop and the port-drag
 * call — §15.80: a shape that cannot be half-applied, rather than a convention
 * documented beside a call site.
 */
import { describe, test, expect } from 'vitest';
import {
  stationIdForRef,
  edgeIdFor,
  nextStationPosition,
  canConnect,
} from './flow-builder-acts';

const nodes = [
  { id: 'plan', position: { x: 0, y: 0 }, data: { agentRef: 'plan' } },
  { id: 'dev', position: { x: 140, y: 0 }, data: { agentRef: 'dev' } },
  { id: 'review', position: { x: 280, y: 0 }, data: { agentRef: 'review' } },
];
const edges = [
  { id: 'plan__dev', source: 'plan', target: 'dev' },
  { id: 'dev__review', source: 'dev', target: 'review' },
];

describe('naming a station by the agent it runs', () => {
  test('a declared handle names an agent ref; the rule resolves it to the node id', () => {
    expect(stationIdForRef(nodes, 'dev')).toBe('dev');
  });

  test('an agent that is not on the canvas resolves to null, not to a wrong node', () => {
    // §15.92: the failure branch is a distinct outcome. A best-effort fallback
    // here would wire an edge to whichever station happened to be first.
    expect(stationIdForRef(nodes, 'architect')).toBeNull();
  });

  test('the node id is found by agent ref even when it is not the node id', () => {
    const placed = [{ id: 'fn-abc123', position: { x: 0, y: 0 }, data: { agentRef: 'architect' } }];
    expect(stationIdForRef(placed, 'architect')).toBe('fn-abc123');
  });
});

describe('the edge id scheme is the one the loader and the artifact picker share', () => {
  test('an edge id is `${source}__${target}`', () => {
    // Pinned deliberately: `flowEdgesToRF` mints this id on load and
    // `handleArtifactPick` looks an edge up by it. ReactFlow's auto-generated
    // id does not match, which is defect B1 — an artifact label that lands on
    // no edge.
    expect(edgeIdFor('architect', 'plan')).toBe('architect__plan');
  });
});

describe('a connection is refused with a REASON, never silently', () => {
  test('a station cannot be wired to itself', () => {
    const r = canConnect(nodes, edges, 'dev', 'dev');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/itself/);
  });

  test('the same edge cannot be drawn twice', () => {
    const r = canConnect(nodes, edges, 'plan', 'dev');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/already/);
  });

  test('an unknown station is named in the refusal', () => {
    const r = canConnect(nodes, edges, 'architect', 'plan');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/architect/);
  });

  test('a new edge between two real stations is allowed', () => {
    const placed = [...nodes, { id: 'fn-1', position: { x: 0, y: 0 }, data: { agentRef: 'architect' } }];
    expect(canConnect(placed, edges, 'fn-1', 'plan')).toEqual({ ok: true });
  });
});

describe('a click has no cursor, so the position is a rule', () => {
  test('a placed station lands clear of every existing station', () => {
    const p = nextStationPosition(nodes);
    expect(p.x).toBeGreaterThan(280);
  });

  test('the first station on an empty canvas lands at the origin of the viewport', () => {
    expect(nextStationPosition([])).toEqual({ x: 0, y: 0 });
  });
});
