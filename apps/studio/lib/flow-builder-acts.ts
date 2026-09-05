/**
 * flow-builder-acts.ts — the two acts the flow builder exists for, as pure
 * rules: place a station, wire one station into another.
 *
 * WHY THIS MODULE EXISTS. Both acts were reachable only by pointer — an HTML5
 * dragstart from the palette onto the canvas, and a drag between two ReactFlow
 * `[data-handleid]` markup internals. A story's `do` step resolves
 * `[data-field=…]` and `[data-action=…]` only, so the single act the builder
 * exists for could not be expressed by anything driving forge-ui through its
 * own declared contract (bead `forge-8vfn.5.12`; S4 beat 4 reds with
 * `data-node-count: expected "4", got "3"`).
 *
 * The capability was never missing — the declared handle was. So the rules the
 * drop handler and the port-drag already applied are lifted here, and the new
 * `data-action` handles call the SAME rules rather than a parallel path. A
 * convention documented beside a call site is a defect waiting for the next
 * copy; a shape that cannot be half-applied is the fix (§15.80).
 */

/** The shape both acts need from a canvas node — id, where it sits, what it runs. */
export type StationNodeLike = {
  id: string;
  position: { x: number; y: number };
  data: { agentRef: string };
};

/** The shape both acts need from a canvas edge. */
export type StationEdgeLike = { id: string; source: string; target: string };

export type ConnectVerdict = { ok: true } | { ok: false; reason: string };

/** Horizontal gap between a placed station and the rightmost existing one. */
const STATION_GAP_X = 140;

/**
 * The node id running `agentRef`, or `null`.
 *
 * `null` rather than a best-effort fallback: a declared handle names an agent,
 * and resolving a missing one to "whichever station is first" would wire an
 * edge to the wrong station and report success (§15.92).
 */
export function stationIdForRef(
  nodes: readonly StationNodeLike[],
  agentRef: string,
): string | null {
  return nodes.find((n) => n.data.agentRef === agentRef)?.id ?? null;
}

/**
 * The edge id scheme, pinned. `flowEdgesToRF` mints this id when a flow loads
 * and `handleArtifactPick` looks an edge up by it; ReactFlow's auto-generated
 * id does not match, so an artifact label would land on no edge.
 */
export function edgeIdFor(source: string, target: string): string {
  return `${source}__${target}`;
}

/**
 * Where a station placed WITHOUT a cursor goes. A drop carries the pointer
 * position; a press does not, so the position has to be a rule — clear of
 * every existing station, on the same row as the leftmost one, so a following
 * auto-layout has something sane to work from.
 */
export function nextStationPosition(nodes: readonly StationNodeLike[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 0, y: 0 };
  const right = Math.max(...nodes.map((n) => n.position.x));
  const top = Math.min(...nodes.map((n) => n.position.y));
  return { x: right + STATION_GAP_X, y: top };
}

/**
 * Whether an edge may be drawn, and if not, WHY — every refusal names its
 * cause so a caller can surface it instead of no-op'ing silently.
 */
export function canConnect(
  nodes: readonly StationNodeLike[],
  edges: readonly StationEdgeLike[],
  sourceId: string,
  targetId: string,
): ConnectVerdict {
  if (sourceId === targetId) {
    return { ok: false, reason: `a station cannot be wired to itself ("${sourceId}")` };
  }
  for (const [role, id] of [['source', sourceId], ['target', targetId]] as const) {
    if (!nodes.some((n) => n.id === id)) {
      return { ok: false, reason: `no station "${id}" on the canvas to wire as the ${role}` };
    }
  }
  if (edges.some((e) => e.source === sourceId && e.target === targetId)) {
    return { ok: false, reason: `"${sourceId}" is already wired into "${targetId}"` };
  }
  return { ok: true };
}

/** A measured on-screen box — the shape `getBoundingClientRect()` returns. */
export type ScreenRect = { left: number; top: number; right: number; bottom: number };

/** How far the artifact picker sits from the station it belongs to. */
const PICKER_OFFSET = 0;

/**
 * Where to open the artifact picker for an edge drawn by a DECLARED handle
 * (bead `forge-8vfn.5.12.1`).
 *
 * The pointer path anchors the picker at `event.clientX/clientY`. A press has
 * no cursor — the same gap `nextStationPosition` closes for placement — so the
 * anchor is derived from the station the edge was wired INTO.
 *
 * It takes the station's MEASURED rect, never its `position`: a node's
 * `position` is flow space, the canvas applies a pan/zoom transform (it
 * `fitView`s on mount), and a rule reading `position` would claim to follow
 * the station while pointing somewhere else. Measuring is the caller's job;
 * deciding is this rule's.
 *
 * Returns null when there is nothing to anchor to — an absent node, or a rect
 * of zero area, which is what `getBoundingClientRect()` reports for a detached
 * or unrendered element and is indistinguishable from the top-left corner
 * unless it is named (§15.92). A null opens no picker and lets the caller say
 * why, rather than putting one in the corner for an edge nobody can associate
 * with it.
 */
export function pickerAnchorFor(
  rect: ScreenRect | null,
  viewport: { width: number; height: number },
): { x: number; y: number } | null {
  if (rect === null) return null;
  if (rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0) return null;
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(v, hi));
  return {
    x: clamp(rect.right + PICKER_OFFSET, viewport.width),
    y: clamp(rect.bottom + PICKER_OFFSET, viewport.height),
  };
}
