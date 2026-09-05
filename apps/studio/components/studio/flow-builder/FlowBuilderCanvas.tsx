'use client';

/**
 * FlowBuilderCanvas — ReactFlow-based interactive canvas for the BUILD tab.
 *
 * Features:
 *   - Custom `flowNode` node type: hex clip-path shape, agent-ref label,
 *     in-handle (left) + out-handle (right), read-only badge for gate/fanOut/resumable
 *   - Palette drag → onDrop creates a node at cursor (screenToFlowPosition)
 *   - Port→port (onConnect) creates an edge → opens ArtifactPicker → sets artifact label
 *   - Node click → NodeMiniPanel (agent name/purpose/open/remove)
 *   - Toolbar: Clear, Layout (Kahn topological autolayout)
 *   - Pan/zoom (fitView), nodesConnectable, onNodesChange/applyNodeChanges
 *   - data-*: data-flow-node/data-node-id/data-agent-ref per node,
 *             canvas wrapper data-node-count/data-edge-count
 *
 * Position handling (ADR-033 / J3): a node's persisted {x,y} is honoured on
 * load; nodes without a saved position are autolaid-out (Kahn sort, COL_W=200,
 * ROW_H=120). On save, the current canvas positions are written back so a
 * hand-arranged flow survives a reload.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Position,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';

import type { Agent, FlowNode, FlowEdge } from '@/lib/studio-client';
import { ArtifactPicker } from './ArtifactPicker';
import { ARTIFACTS } from '@/lib/flow-artifact-catalog';
import { NodeMiniPanel } from './NodeMiniPanel';
import { decodeDragPayload } from './AgentPalette';
import {
  stationIdForRef,
  nextStationPosition,
  canConnect,
  pickerAnchorFor,
  cssEscape,
} from '@/lib/flow-builder-acts';
import {
  ConnectActsContext,
  NODE_TYPES,
  stationEdgeShape,
  type ConnectActs,
  type FlowNodeData,
} from './FlowStationNode';

// ---------------------------------------------------------------------------
// Layout constants (from the mockup autolayout logic)
// ---------------------------------------------------------------------------
const COL_W = 200;
const ROW_H = 120;
const PAD_X = 120;
const PAD_Y = 100;

// ---------------------------------------------------------------------------
// Kahn topological autolayout
// Returns a map from nodeId → {x, y}
// ---------------------------------------------------------------------------
function kahnLayout(
  nodes: Array<{ id: string }>,
  edges: Array<{ from: string; to: string }>,
): Map<string, { x: number; y: number }> {
  const ids = new Set(nodes.map((n) => n.id));
  const inDeg = new Map<string, number>();
  const outMap = new Map<string, string[]>();
  for (const n of nodes) { inDeg.set(n.id, 0); outMap.set(n.id, []); }
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
    outMap.get(e.from)?.push(e.to);
  }

  const visited = new Set<string>();
  const levels: string[][] = [];
  let frontier = nodes.filter((n) => (inDeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  if (frontier.length === 0 && nodes.length > 0) frontier = [nodes[0].id]; // cycle fallback

  while (frontier.length > 0) {
    levels.push(frontier.slice());
    frontier.forEach((id) => visited.add(id));
    const next: string[] = [];
    for (const id of frontier) {
      for (const t of (outMap.get(id) ?? [])) {
        if (!visited.has(t) && !next.includes(t)) next.push(t);
      }
    }
    frontier = next;
  }
  // Stragglers (cycles)
  for (const n of nodes) {
    if (!visited.has(n.id)) levels.push([n.id]);
  }

  const pos = new Map<string, { x: number; y: number }>();
  levels.forEach((col, ci) => {
    const totalH = (col.length - 1) * ROW_H;
    col.forEach((id, ri) => {
      const x = PAD_X + ci * COL_W;
      const y = PAD_Y + ri * ROW_H - totalH / 2 + 200;
      pos.set(id, { x, y });
    });
  });
  return pos;
}

// ---------------------------------------------------------------------------
// Custom flowNode type
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Edge label (artifact name on the edge)
// ---------------------------------------------------------------------------
type BuilderEdgeData = { artifact?: string };

// ---------------------------------------------------------------------------
// Map FlowNode/FlowEdge → ReactFlow Nodes/Edges
// ---------------------------------------------------------------------------
function flowNodesToRF(
  flowNodes: FlowNode[],
  agents: Agent[],
  positions: Map<string, { x: number; y: number }>,
): Node<FlowNodeData>[] {
  return flowNodes.map((fn) => {
    const agent = agents.find((a) => a.id === fn.agent);
    // Honour a persisted position; fall back to the computed autolayout.
    const pos =
      typeof fn.x === 'number' && typeof fn.y === 'number'
        ? { x: fn.x, y: fn.y }
        : positions.get(fn.id) ?? { x: 80, y: 80 };
    return {
      id: fn.id,
      type: 'flowNode',
      position: pos,
      data: {
        agentRef: fn.agent ?? fn.id,
        agentName: agent?.name ?? fn.agent ?? fn.id,
        gate: fn.gate,
        fanOut: fn.fanOut,
        resumable: fn.resumable,
        selected: false,
      },
      width: 96,
      height: 106,
    };
  });
}

function flowEdgesToRF(flowEdges: FlowEdge[]): Edge<BuilderEdgeData>[] {
  return flowEdges.map((fe) => {
    const artifact = fe.artifact
      ? ARTIFACTS.find((a) => a.id === fe.artifact)
      : undefined;
    return {
      id: `${fe.from}__${fe.to}`,
      source: fe.from,
      target: fe.to,
      sourceHandle: 'out',
      targetHandle: 'in',
      type: 'smoothstep',
      animated: true,
      label: artifact?.name ?? fe.artifact ?? '',
      labelStyle: {
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: 10,
        fill: 'var(--c-artifact, #fbbf24)',
      },
      labelBgStyle: {
        fill: 'var(--bg-2, #10151f)',
        stroke: 'rgba(251,191,36,0.4)',
        strokeWidth: 1,
        rx: 4,
      },
      style: { stroke: 'var(--line-2, #39455f)', strokeWidth: 2 },
      data: { artifact: fe.artifact },
    };
  });
}

// ---------------------------------------------------------------------------
// Map ReactFlow nodes/edges back to FlowNode/FlowEdge for save
// ---------------------------------------------------------------------------
export function rfNodesToFlow(rfNodes: Node<FlowNodeData>[]): FlowNode[] {
  return rfNodes.map((n) => ({
    id: n.id,
    agent: n.data.agentRef,
    ...(n.data.gate      ? { gate: n.data.gate }           : {}),
    ...(n.data.fanOut    ? { fanOut: n.data.fanOut }       : {}),
    ...(n.data.resumable ? { resumable: n.data.resumable } : {}),
    // Persist the canvas position so a hand-arranged layout survives reload (J3).
    x: Math.round(n.position.x),
    y: Math.round(n.position.y),
  }));
}

export function rfEdgesToFlow(rfEdges: Edge<BuilderEdgeData>[]): FlowEdge[] {
  return rfEdges.map((e) => ({
    from: e.source,
    to: e.target,
    artifact: e.data?.artifact,
  }));
}

// ---------------------------------------------------------------------------
// FitView helper (re-fits on node count change)
// ---------------------------------------------------------------------------
function FitOnChange({ count }: { count: number }): null {
  const rf = useReactFlow();
  useEffect(() => {
    const id = setTimeout(() => {
      rf.fitView({ padding: 0.2, duration: 300 });
    }, 60);
    return () => clearTimeout(id);
  }, [count, rf]);
  return null;
}

// ---------------------------------------------------------------------------
// FlowBuilderCanvas
// ---------------------------------------------------------------------------
export type CanvasHandle = {
  getNodes: () => Node<FlowNodeData>[];
  getEdges: () => Edge<BuilderEdgeData>[];
  /**
   * Place an agent on the canvas by ref. The palette's declared
   * `place-station-<ref>` handle crosses into the canvas through here — the
   * canvas owns the node state, so there is nowhere else the act can live.
   */
  placeStation: (agentRef: string) => void;
};

type Props = {
  /** Initial flow nodes (loaded from the flow definition) */
  initialNodes: FlowNode[];
  /** Initial flow edges */
  initialEdges: FlowEdge[];
  /** Agent catalog (needed for name resolution) */
  agents: Agent[];
  /** Callback to expose current node/edge state for save */
  onRef?: (handle: CanvasHandle) => void;
};

export function FlowBuilderCanvas({
  initialNodes,
  initialEdges,
  agents,
  onRef,
}: Props): JSX.Element {
  // Compute initial positions via autolayout
  const initialPositions = useMemo(
    () => kahnLayout(initialNodes, initialEdges),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [rfNodes, setRfNodes] = useState<Node<FlowNodeData>[]>(() =>
    flowNodesToRF(initialNodes, agents, initialPositions),
  );
  const [rfEdges, setRfEdges] = useState<Edge<BuilderEdgeData>[]>(() =>
    flowEdgesToRF(initialEdges),
  );

  // Re-initialize when flow changes (load from parent)
  const prevInitRef = useRef({ initialNodes, initialEdges });
  useEffect(() => {
    const prev = prevInitRef.current;
    const nodesChanged = prev.initialNodes !== initialNodes;
    const edgesChanged = prev.initialEdges !== initialEdges;
    if (nodesChanged || edgesChanged) {
      prevInitRef.current = { initialNodes, initialEdges };
      const positions = kahnLayout(initialNodes, initialEdges);
      setRfNodes(flowNodesToRF(initialNodes, agents, positions));
      setRfEdges(flowEdgesToRF(initialEdges));
    }
  }, [initialNodes, initialEdges, agents]);

  // Expose current state via handle
  const nodesRef = useRef(rfNodes);
  const edgesRef = useRef(rfEdges);
  // The handle is published once (its effect depends on `onRef` alone), so the
  // placement act reaches it through a ref that is re-pointed every render
  // rather than by re-publishing the handle on every dependency change.
  const placeStationAtRef = useRef<(agentRef: string) => void>(() => {});
  nodesRef.current = rfNodes;
  edgesRef.current = rfEdges;
  useEffect(() => {
    onRef?.({
      placeStation: (agentRef: string) => placeStationAtRef.current(agentRef),
      getNodes: () => nodesRef.current,
      getEdges: () => edgesRef.current,
    });
  }, [onRef]);

  // Artifact picker state
  const [pickerState, setPickerState] = useState<{
    x: number;
    y: number;
    connection: Connection;
  } | null>(null);

  // Node mini-panel state
  const [miniPanel, setMiniPanel] = useState<{
    nodeId: string;
    x: number;
    y: number;
  } | null>(null);

  // ---------------------------------------------------------------------------
  // ReactFlow handlers
  // ---------------------------------------------------------------------------
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds));
    setMiniPanel(null);
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setRfEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  // pendingConnectionRef tracks a connection that was just made but whose
  // picker position will be set by onConnectEnd (which receives the real cursor).
  const pendingConnectionRef = useRef<Connection | null>(null);

  const onConnect = useCallback(
    (connection: Connection) => {
      // Add the edge immediately (no artifact yet). Force the id to the same
      // `${source}__${target}` scheme flowEdgesToRF uses on load, so
      // handleArtifactPick (which looks the edge up by that id) actually lands —
      // ReactFlow's auto-generated id would not match (B1).
      setRfEdges((eds) => addEdge({
        ...connection,
        ...stationEdgeShape(connection.source ?? '', connection.target ?? ''),
      }, eds));
      // Stash the connection; onConnectEnd will open the picker at the real cursor position
      pendingConnectionRef.current = connection;
    },
    [],
  );

  const handleArtifactPick = useCallback(
    (artifactId: string | null) => {
      if (!pickerState) return;
      const { connection } = pickerState;
      const edgeId = `${connection.source ?? ''}__${connection.target ?? ''}`;
      if (artifactId) {
        const artifact = ARTIFACTS.find((a) => a.id === artifactId);
        setRfEdges((eds) =>
          eds.map((e) =>
            e.id === edgeId
              ? {
                  ...e,
                  label: artifact?.name ?? artifactId,
                  labelStyle: {
                    fontFamily: 'var(--font-mono, monospace)',
                    fontSize: 10,
                    fill: 'var(--c-artifact, #fbbf24)',
                  },
                  labelBgStyle: {
                    fill: 'var(--bg-2, #10151f)',
                    stroke: 'rgba(251,191,36,0.4)',
                    strokeWidth: 1,
                    rx: 4,
                  },
                  data: { artifact: artifactId },
                }
              : e,
          ),
        );
      }
      setPickerState(null);
    },
    [pickerState],
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node<FlowNodeData>) => {
      const rect = (_event.currentTarget as HTMLElement).getBoundingClientRect?.();
      const x = _event.clientX ?? (rect?.left ?? 400) + 100;
      const y = _event.clientY ?? (rect?.top ?? 300);
      setMiniPanel({ nodeId: node.id, x, y });
    },
    [],
  );

  const handlePaneClick = useCallback(() => {
    setMiniPanel(null);
  }, []);

  const handleRemoveNode = useCallback((nodeId: string) => {
    setRfNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setRfEdges((eds) =>
      eds.filter((e) => e.source !== nodeId && e.target !== nodeId),
    );
    setMiniPanel(null);
  }, []);

  // B4: set node modifiers (gate / fanOut) — round-trips via rfNodesToFlow on save.
  const setNodeData = useCallback((nodeId: string, patch: Partial<FlowNodeData>) => {
    setRfNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)));
  }, []);
  const handleSetGate = useCallback((nodeId: string, gate: string | undefined) => setNodeData(nodeId, { gate }), [setNodeData]);
  const handleSetFanOut = useCallback((nodeId: string, fanOut: string | undefined) => setNodeData(nodeId, { fanOut }), [setNodeData]);

  // ---------------------------------------------------------------------------
  // Drag-to-create node from palette
  // ---------------------------------------------------------------------------
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = useState<ReturnType<typeof useReactFlow> | null>(null);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // R2-02-F3: belt-and-suspenders drop rejection banner (the palette chip
  // itself is the primary gate — a non-placeable chip can't start a drag —
  // this only fires if a drag somehow slips through). Auto-clears.
  const [dropReject, setDropReject] = useState<string | null>(null);
  const dropRejectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rejectDrop = useCallback((message: string) => {
    console.warn(`[flow-builder] ${message}`);
    setDropReject(message);
    if (dropRejectTimeoutRef.current) clearTimeout(dropRejectTimeoutRef.current);
    dropRejectTimeoutRef.current = setTimeout(() => setDropReject(null), 4000);
  }, []);
  useEffect(() => () => {
    if (dropRejectTimeoutRef.current) clearTimeout(dropRejectTimeoutRef.current);
  }, []);

  /**
   * The armed edge source, set by `connect-from-<agent>` and consumed by the
   * next `connect-into-<agent>`. A ref, not state: arming is not a rendered
   * condition, and making it one would re-render every node on each press.
   */
  const armedSourceRef = useRef<string | null>(null);

  const connectActs = useMemo<ConnectActs>(
    () => ({
      armFrom: (nodeId: string) => {
        armedSourceRef.current = nodeId;
      },
      completeInto: (targetId: string) => {
        const sourceId = armedSourceRef.current;
        if (sourceId === null) {
          // Named, not silent: a press that draws nothing has to say why, or a
          // story reads "the product refused" as "the product did nothing".
          rejectDrop('press a station\'s out-port ("connect-from-…") before wiring into another one.');
          return;
        }
        armedSourceRef.current = null;
        const verdict = canConnect(nodesRef.current, edgesRef.current, sourceId, targetId);
        if (!verdict.ok) {
          rejectDrop(verdict.reason);
          return;
        }
        setRfEdges((eds) => [...eds, stationEdgeShape(sourceId, targetId) as Edge<BuilderEdgeData>]);

        // forge-8vfn.5.12.1: ASK WHICH ARTIFACT, exactly as the pointer path
        // does. This branch used to stop at the line above, so an edge drawn
        // through the declared handles carried no artifact — the save route
        // accepted it (200; `validateArtifactRef` is a `forge studio lint`-only
        // pass), `serializeFlowDefinition` wrote `edges: [{from, to}]`,
        // `loadFlowDefinition` then THREW on the missing field, `loadAllFlows`
        // skipped the unreadable flow, and `/flows/<id>` rendered `not-found`.
        // The flow the operator had just built was invisible on the page they
        // were redirected to.
        //
        // A press has no cursor, so the anchor comes from the station just
        // wired into — MEASURED, not computed from `node.position`, which is
        // flow space (see `pickerAnchorFor`).
        const targetEl = document.querySelector(`.react-flow__node[data-id="${cssEscape(targetId)}"]`);
        const anchor = pickerAnchorFor(
          targetEl === null ? null : targetEl.getBoundingClientRect(),
          { width: window.innerWidth, height: window.innerHeight },
        );
        if (anchor === null) {
          // Named, never silent — the edge exists and is unlabelled, and the
          // operator has to know that rather than discover it at load time.
          rejectDrop(`the edge into "${targetId}" was drawn but its artifact picker could not be anchored — label it by dragging between the ports.`);
          return;
        }
        setPickerState({
          x: anchor.x,
          y: anchor.y,
          connection: { source: sourceId, target: targetId, sourceHandle: null, targetHandle: null },
        });
      },
    }),
    [rejectDrop],
  );


  /**
   * Place an agent as a station. ONE implementation, called by the pointer drop
   * and by the palette's declared `place-station-<ref>` handle — the drop's
   * only extra is the cursor position it can supply and a press cannot.
   * Keeping the interactive-agent refusal here is the point: a second placement
   * path would be one refactor away from not having it (§15.80).
   */
  const placeStationAt = useCallback(
    (agentRef: string, position?: { x: number; y: number }) => {
      const agent = agents.find((a) => a.id === agentRef);

      // R2-02-F3: an interactive agent (per the F1 capability descriptor)
      // cannot be placed as a plain flow node — it runs through the
      // interactive-session runner, not a flow node. Do NOT create the node.
      if (agent?.capability?.interactive) {
        rejectDrop(`"${agent.name}" is an interactive agent — interactive agents run through the interactive-session runner, not a flow node.`);
        return;
      }

      const newId = `fn-${Date.now().toString(36)}`;
      setRfNodes((nds) => [
        ...nds,
        {
          id: newId,
          type: 'flowNode',
          position: position ?? nextStationPosition(nds),
          data: {
            agentRef,
            agentName: agent?.name ?? agentRef,
            selected: false,
          },
          width: 96,
          height: 106,
        },
      ]);
    },
    [agents, rejectDrop],
  );
  placeStationAtRef.current = placeStationAt;

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('text/plain');
      const payload = decodeDragPayload(raw);
      if (!payload || payload.kind !== 'agent') return;

      // Convert screen coords to ReactFlow coords
      const wrapper = reactFlowWrapper.current;
      if (!wrapper || !rfInstance) return;
      const rect = wrapper.getBoundingClientRect();
      placeStationAt(payload.ref, rfInstance.project({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      }));
    },
    [rfInstance, placeStationAt],
  );

  // ---------------------------------------------------------------------------
  // Autolayout (Kahn)
  // ---------------------------------------------------------------------------
  const handleAutoLayout = useCallback(() => {
    const positions = kahnLayout(
      rfNodes.map((n) => ({ id: n.id })),
      rfEdges.map((e) => ({ from: e.source, to: e.target })),
    );
    setRfNodes((nds) =>
      nds.map((n) => {
        const pos = positions.get(n.id);
        return pos ? { ...n, position: pos } : n;
      }),
    );
    // fitView will be triggered by FitOnChange via node count (stable count, same nodes)
    // trigger a forced refit by temporarily bumping
    setTimeout(() => {
      rfInstance?.fitView({ padding: 0.2, duration: 400 });
    }, 100);
  }, [rfNodes, rfEdges, rfInstance]);

  // ---------------------------------------------------------------------------
  // Clear
  // ---------------------------------------------------------------------------
  const handleClear = useCallback(() => {
    if (!window.confirm('Remove all nodes and edges from this flow?')) return;
    setRfNodes([]);
    setRfEdges([]);
    setMiniPanel(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Mini-panel agent lookup
  // ---------------------------------------------------------------------------
  const miniPanelAgent = useMemo(() => {
    if (!miniPanel) return null;
    const node = rfNodes.find((n) => n.id === miniPanel.nodeId);
    if (!node) return null;
    return agents.find((a) => a.id === node.data.agentRef) ?? null;
  }, [miniPanel, rfNodes, agents]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <ConnectActsContext.Provider value={connectActs}>
    <div
      ref={reactFlowWrapper}
      data-component="flow-builder-canvas"
      data-node-count={rfNodes.length}
      data-edge-count={rfEdges.length}
      style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--bg, #0b0e14)',
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Canvas toolbar */}
      <div style={{
        position: 'absolute',
        top: 12,
        right: 14,
        display: 'flex',
        gap: 6,
        zIndex: 20,
      }}>
        <button
          onClick={handleClear}
          title="Clear all nodes and edges"
          data-action="clear-canvas"
          style={toolbarBtnStyle}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel-2)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
        >
          ✕ Clear
        </button>
        <button
          onClick={handleAutoLayout}
          title="Auto-arrange nodes (Kahn topological)"
          data-action="auto-layout"
          style={toolbarBtnStyle}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel-2)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
        >
          ⊞ Layout
        </button>
      </div>

      {/* R2-02-F3: drop-rejected banner (belt-and-suspenders — the palette
          chip is the primary gate) */}
      {dropReject && (
        <div
          data-component="canvas-drop-reject"
          data-drop-reject-message={dropReject}
          role="alert"
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 30,
            background: 'rgba(239,68,68,0.14)',
            border: '1px solid rgba(239,68,68,0.4)',
            color: '#fca5a5',
            fontSize: 12,
            padding: '6px 12px',
            borderRadius: 'var(--radius-sm)',
            maxWidth: '70%',
            textAlign: 'center',
          }}
        >
          {dropReject}
        </div>
      )}

      {/* Empty state hint */}
      {rfNodes.length === 0 && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: 'var(--faint)',
          fontSize: 13,
          fontFamily: 'var(--font-display)',
          pointerEvents: 'none',
          textAlign: 'center',
          userSelect: 'none',
          zIndex: 5,
        }}>
          <span style={{ display: 'block', fontSize: 28, marginBottom: 8, opacity: 0.4 }}>⬡</span>
          Drop an agent from the palette to begin building your flow
        </div>
      )}

      {/* ReactFlow */}
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={(event) => {
          // onConnectEnd fires after onConnect with the real cursor position.
          // Open the artifact picker here so it appears at the cursor, not at (400,300).
          const conn = pendingConnectionRef.current;
          if (conn && event instanceof MouseEvent) {
            pendingConnectionRef.current = null;
            setPickerState({ x: event.clientX, y: event.clientY, connection: conn });
          } else {
            pendingConnectionRef.current = null;
          }
        }}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        nodesConnectable
        nodesDraggable
        elementsSelectable
        zoomOnScroll
        panOnDrag
        minZoom={0.2}
        maxZoom={2}
        onInit={(instance) => setRfInstance(instance as unknown as ReturnType<typeof useReactFlow>)}
        style={{ width: '100%', height: '100%' }}
        connectionLineStyle={{ stroke: 'var(--ember, #ff9e4a)', strokeWidth: 2 }}
      >
        <Background color="rgba(57,69,95,0.6)" gap={28} size={1} />
        <Controls
          showInteractive={false}
          style={{ background: '#0c1115', border: '1px solid var(--line, #28324a)' }}
        />
        <FitOnChange count={rfNodes.length} />
      </ReactFlow>

      {/* Artifact picker popover */}
      {pickerState && (
        <ArtifactPicker
          anchorX={pickerState.x}
          anchorY={pickerState.y}
          onPick={handleArtifactPick}
          onClose={() => setPickerState(null)}
        />
      )}

      {/* Node mini-panel */}
      {miniPanel && (
        <NodeMiniPanel
          nodeId={miniPanel.nodeId}
          agent={miniPanelAgent}
          anchorX={miniPanel.x}
          anchorY={miniPanel.y}
          gate={rfNodes.find((n) => n.id === miniPanel.nodeId)?.data.gate}
          fanOut={rfNodes.find((n) => n.id === miniPanel.nodeId)?.data.fanOut}
          onClose={() => setMiniPanel(null)}
          onRemove={handleRemoveNode}
          onSetGate={handleSetGate}
          onSetFanOut={handleSetFanOut}
        />
      )}
    </div>
    </ConnectActsContext.Provider>
  );
}

const toolbarBtnStyle: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--dim)',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  padding: '5px 10px',
  transition: 'background 0.12s',
};
