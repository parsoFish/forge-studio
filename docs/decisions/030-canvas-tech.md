# ADR-030 — Flow Builder Canvas Technology

**Status:** Accepted 2026-06-13

## Context

M4 adds an interactive flow builder to the Studio UI (the BUILD tab on `/flows/[id]`). The builder requires:

- Drag-and-drop agent nodes onto a canvas
- Port-to-port edge drawing (bezier curves)
- Node mini-panel, artifact picker on connect
- Autolayout (Kahn topological order), pan/zoom, fitView

Two options were on the table:

1. **Extend ReactFlow** — already installed as a dep (`forge-ui/package.json` `reactflow ^11.11.4`) and already used in `AgentGraphCanvas.tsx` (672 LOC) with custom node types (`NODE_TYPES = {hex, tool, bubble}`), `Handle`/`Position`, `nodesConnectable={false}` (read-only monitor mode).
2. **Hand-roll drag math** — build the canvas interaction layer from scratch.

## Decision

Use **ReactFlow** for the flow-builder canvas.

The existing `AgentGraphCanvas.tsx` usage IS the spike evidence: custom node types with `Handle` port definitions, edge rendering, pan/zoom, and the full ReactFlow API are already exercised in production. The flow-builder extends exactly this pattern:

- Custom `flow-node` component with in/out `Handle`s (replacing the hex read-only node)
- `nodesConnectable={true}` + `onConnect` callback → creates an edge, opens `ArtifactPicker`, sets the edge artifact label
- `applyNodeChanges` for drag-based repositioning
- `fitView` on load and after autolayout
- Kahn topological autolayout writes `x`/`y` onto nodes (column × `COL_W=200`, row × `ROW_H=120`)

The mock (`flow-builder.html`) port-drag-to-port interaction maps 1:1 to ReactFlow's connection model.

`FlowTopology.tsx` (395 LOC, the M1 monitor renderer) is deliberately hand-rolled SVG and **stays the read-only monitor renderer**. It renders from a static `FlowDefinition` snapshot; no interactivity needed there.

## Rationale

PRINCIPLES: battle-tested tools over hand-rolled implementations. ReactFlow is the battle-tested drag-canvas library. Adding it separately would be the re-invention that the principles forbid — it is already present. No new dep is introduced.

## Consequences

- The BUILD tab renders inside the existing `/flows/[id]` page (tab state `'monitor' | 'build'`).
- `FlowTopology` is untouched (read-only monitor stays as-is).
- Node `gate`/`fanOut`/`resumable` flags are shown read-only on the node in M4 (full per-node-property editing is a follow-up).
- The forge-cycle flow stays the seed; M4 proves authoring a NEW flow + saving via `PUT /api/studio/flows/:id`.
