/**
 * W7-B4 review finding 3 — the builder's unsaved-edits oracle, extracted from
 * app/flows/[id]/page.tsx so it can be pinned directly.
 *
 * THE DEFECT THIS CLOSES. The dirty check compared two snapshots built from
 * DIFFERENT shapes: the clean baseline came from the raw `flowDef.nodes` read
 * off disk, while the live side came from `rfNodesToFlow(canvas.getNodes())`,
 * which ALWAYS synthesizes `x`/`y` from the autolayout positions. Seed flows
 * (forge-develop, forge-architect) ship with no node positions at all, so the
 * two snapshots could never match: every seed flow was permanently "dirty"
 * with zero operator edits. Two visible consequences:
 *
 *   1. Every tab-leave / flow-select out of BUILD popped "discard unsaved
 *      edits?" on a flow nobody had touched.
 *   2. Clicking Save on that untouched seed sent nodes carrying synthesized
 *      x/y, which defeats the server's no-op projection — the file is
 *      rewritten through serializeFlowDefinition, the version bumps, and the
 *      seed's hand-authored YAML comments are stripped. That is precisely
 *      what flows-12's no-op preservation exists to prevent.
 *
 * THE RULE. Positions participate in the comparison only when the SAVED file
 * actually carried them. A flow authored with positions still reports a drag
 * as an unsaved edit (J3's hand-arranged layout stays protected); a flow whose
 * file has no positions ignores the ones autolayout invented, because they are
 * the canvas's opinion rather than anything the operator expressed.
 */

/** The node fields the comparison understands. Extra fields are preserved. */
export type SnapshotNode = Record<string, unknown> & { x?: unknown; y?: unknown };

/** True when at least one saved node carries a position — i.e. the file's own
 *  layout is meaningful and must be compared. */
export function savedNodesCarryPositions(nodes: readonly unknown[] | null | undefined): boolean {
  if (!Array.isArray(nodes)) return false;
  return nodes.some(
    (n) =>
      n !== null &&
      typeof n === 'object' &&
      !Array.isArray(n) &&
      ((n as SnapshotNode).x !== undefined || (n as SnapshotNode).y !== undefined),
  );
}

function stripPositions(nodes: readonly unknown[]): unknown[] {
  return nodes.map((n) => {
    if (n === null || typeof n !== 'object' || Array.isArray(n)) return n;
    const { x: _x, y: _y, ...rest } = n as SnapshotNode;
    return rest;
  });
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

/**
 * Key-sorted JSON over {header, nodes, edges}. `includePositions` MUST carry
 * the same value for the baseline and the live snapshot being compared with
 * it — derive it once, from the saved file, via `savedNodesCarryPositions`.
 */
export function builderSnapshot(
  header: unknown,
  nodes: readonly unknown[],
  edges: readonly unknown[],
  includePositions: boolean,
): string {
  const shapedNodes = includePositions ? [...nodes] : stripPositions(nodes);
  return JSON.stringify(canonical({ header, nodes: shapedNodes, edges }));
}
