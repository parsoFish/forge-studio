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
  pickerAnchorFor,
  cssEscape,
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

/* ------------------------------------------------------------------------ *
 * Bead `forge-8vfn.5.12.1` — a declared connect handle must not draw an edge
 * the loader cannot read back.
 *
 * Measured by M5-B with throwaway probe167 (2026-09-05, costless), each link
 * of the chain checked: `connectActs.completeInto` pushed
 * `stationEdgeShape(source, target)` with NO artifact — the POINTER path opens
 * the ArtifactPicker afterwards, the DECLARED handle did not — the save route's
 * `validateFlow` never calls `validateArtifactRef` (that pass is `forge studio
 * lint`-only), the PUT returned 200, `serializeFlowDefinition` wrote
 * `edges: [{from, to}]`, `loadFlowDefinition` threw `required string field
 * "artifact" is missing or empty`, `loadAllFlows` silently skipped the flow,
 * and `/flows/<id>` rendered `data-page="not-found"`. A flow built through the
 * builder's own declared handles saved "successfully" and was invisible on the
 * page the operator was redirected to.
 *
 * Ruling 175 splits the fix: the refusal belongs in `validateFlow`, which
 * moves into `packages/flows` with M5-A's split and is NOT yet there
 * (`orchestrator/studio/validate.ts` still holds it on main). This half makes
 * the declared path ASK — the same question the pointer path has always asked —
 * so the operator (and a story) can answer it.
 * ------------------------------------------------------------------------ */

describe('the declared connect handle asks the question the pointer path asks', () => {
  const VIEW = { width: 1280, height: 800 };

  test('a press has no cursor, so the anchor is derived from the target station it can measure', () => {
    // The pointer path anchors the picker at `event.clientX/Y`. A declared
    // press has neither. It does have the station it just wired INTO, and that
    // station has a screen rect — so the rule takes the MEASURED rect rather
    // than the node's flow-space `position`, which is not screen space at all
    // (the canvas `fitView`s, so there is a pan/zoom transform between them).
    // A rule that read `node.position` would claim to follow the station while
    // pointing somewhere else entirely.
    const anchor = pickerAnchorFor({ left: 400, top: 300, right: 520, bottom: 356 }, VIEW);
    expect(anchor).toEqual({ x: 520, y: 356 });
  });

  test('the anchor is clamped into the viewport for a station wired near its edge', () => {
    // Fail-CLOSED on geometry: a picker anchored past the viewport edge is a
    // picker no operator and no story can press. `ArtifactPicker` clamps its
    // own left edge but not its top, and clamping twice is cheaper than
    // reasoning about which of the two owns it.
    const anchor = pickerAnchorFor({ left: 1260, top: 780, right: 1400, bottom: 860 }, VIEW);
    expect(anchor!.x).toBeLessThanOrEqual(VIEW.width);
    expect(anchor!.y).toBeLessThanOrEqual(VIEW.height);
    expect(anchor!.x).toBeGreaterThanOrEqual(0);
    expect(anchor!.y).toBeGreaterThanOrEqual(0);
  });

  test('a station that could not be measured yields NO anchor, rather than a wrong one', () => {
    // §15.92: the failure branch is a distinct outcome. `{x:0,y:0}` here would
    // open a picker in the corner for an edge the operator cannot associate
    // with anything — worse than not opening it and saying why.
    expect(pickerAnchorFor(null, VIEW)).toBeNull();
  });

  test('a zero-area rect is not a measurement — an unmounted node measures 0×0', () => {
    // getBoundingClientRect on a detached or display:none element returns all
    // zeroes, which is indistinguishable from "the top-left corner" unless the
    // rule says so.
    expect(pickerAnchorFor({ left: 0, top: 0, right: 0, bottom: 0 }, VIEW)).toBeNull();
  });
});

describe('a station id reaches a selector escaped, never raw', () => {
  test('the ids the builder actually mints pass through unchanged', () => {
    expect(cssEscape('architect')).toBe('architect');
    expect(cssEscape('fn-9c2b71')).toBe('fn-9c2b71');
  });

  test('anything outside that alphabet is escaped rather than passed through', () => {
    // The fallback branch is what runs where `CSS.escape` is absent, and a
    // selector built from an unescaped id is how a lookup silently matches
    // nothing (or something else). Probed rather than assumed (§15.162).
    expect(cssEscape('a b')).not.toBe('a b');
    expect(cssEscape('a"]')).not.toContain('"]');
  });
});
