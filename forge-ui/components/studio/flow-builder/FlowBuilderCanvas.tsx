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
 * Position handling: autolayout-on-load (Kahn sort, COL_W=200, ROW_H=120).
 * Positions are NOT persisted to the flow YAML schema (M0 FlowNode has no x/y);
 * they are recomputed each time. On save, nodes are mapped back to {id, agent}
 * without x/y.
 */

import {
  useCallback,
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
import { ArtifactPicker, ARTIFACTS } from './ArtifactPicker';
import { NodeMiniPanel } from './NodeMiniPanel';
import { decodeDragPayload } from './AgentPalette';

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
type FlowNodeData = {
  agentRef: string;
  agentName: string;
  gate?: string;
  fanOut?: string;
  resumable?: boolean;
  selected?: boolean;
};

const HEX_CLIP = 'polygon(25% 3%, 75% 3%, 98% 50%, 75% 97%, 25% 97%, 2% 50%)';
const HANDLE_VISIBLE_STYLE: React.CSSProperties = {
  width: 12,
  height: 12,
  border: '2px solid var(--bg, #0b0e14)',
  borderRadius: '50%',
};

function FlowNodeComponent({ id, data, selected }: NodeProps<FlowNodeData>): JSX.Element {
  const truncate = (s: string, max: number) =>
    s && s.length > max ? `${s.slice(0, max - 1)}…` : s;

  const hexBorderColor = selected ? 'var(--ember, #ff9e4a)' : 'var(--line-2, #39455f)';

  return (
    <div
      data-flow-node=""
      data-node-id={id}
      data-agent-ref={data.agentRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        cursor: 'pointer',
        userSelect: 'none',
        position: 'relative',
        width: 96,
      }}
      title={data.agentName}
    >
      {/* Target handle — left (in-port) */}
      <Handle
        id="in"
        type="target"
        position={Position.Left}
        style={{
          ...HANDLE_VISIBLE_STYLE,
          background: 'var(--steel, #5cc8ff)',
          boxShadow: '0 0 8px rgba(92,200,255,0.4)',
          left: -6,
          top: '50%',
          transform: 'translateY(-50%)',
        }}
      />

      {/* Hex frame + body */}
      <div
        style={{
          clipPath: HEX_CLIP,
          padding: '1.5px',
          background: selected
            ? 'linear-gradient(135deg, var(--ember, #ff9e4a), var(--ember-hot, #ff6b35))'
            : hexBorderColor,
          display: 'inline-block',
          boxShadow: selected ? '0 0 20px rgba(255,158,74,0.4)' : undefined,
          width: 96,
          height: 88,
        }}
      >
        <div
          style={{
            clipPath: HEX_CLIP,
            background: 'var(--panel-2, #1a2230)',
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
          }}
        >
          {/* Agent dot indicator */}
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--c-agent, #ff9e4a)', marginBottom: 2 }} />

          {/* Agent name */}
          <span style={{
            fontFamily: 'var(--font-display, sans-serif)',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text, #e9eef6)',
            textAlign: 'center',
            lineHeight: 1.2,
            maxWidth: 72,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            padding: '0 4px',
          }}>
            {truncate(data.agentName || data.agentRef, 12)}
          </span>

          {/* Read-only badges for gate/fanOut/resumable */}
          {data.gate && (
            <span style={{ fontSize: 9, color: 'var(--amber, #fbbf24)', fontFamily: 'var(--font-mono, monospace)', background: 'rgba(251,191,36,0.12)', padding: '1px 4px', borderRadius: 2 }}>
              gate
            </span>
          )}
          {data.fanOut && (
            <span style={{ fontSize: 9, color: 'var(--steel, #5cc8ff)', fontFamily: 'var(--font-mono, monospace)', background: 'rgba(92,200,255,0.1)', padding: '1px 4px', borderRadius: 2 }}>
              fan-out
            </span>
          )}
          {data.resumable && (
            <span style={{ fontSize: 9, color: 'var(--green, #4ade80)', fontFamily: 'var(--font-mono, monospace)', background: 'rgba(74,222,128,0.1)', padding: '1px 4px', borderRadius: 2 }}>
              resumable
            </span>
          )}
        </div>
      </div>

      {/* Source handle — right (out-port) */}
      <Handle
        id="out"
        type="source"
        position={Position.Right}
        style={{
          ...HANDLE_VISIBLE_STYLE,
          background: 'var(--ember, #ff9e4a)',
          boxShadow: '0 0 8px rgba(255,158,74,0.6)',
          right: -6,
          top: '50%',
          transform: 'translateY(-50%)',
        }}
      />

      {/* Agent ref label below hex */}
      <div style={{
        marginTop: 5,
        fontSize: 10,
        color: 'var(--faint, #5b6779)',
        fontFamily: 'var(--font-mono, monospace)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: 90,
        textAlign: 'center',
      }}>
        {data.agentRef}
      </div>
    </div>
  );
}

const NODE_TYPES: NodeTypes = { flowNode: FlowNodeComponent };

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
    const pos = positions.get(fn.id) ?? { x: 80, y: 80 };
    return {
      id: fn.id,
      type: 'flowNode',
      position: pos,
      data: {
        agentRef: fn.agent ?? fn.id,
        agentName: agent?.name ?? fn.agent ?? fn.id,
        gate: fn.kind === 'gate' ? fn.id : undefined,
        fanOut: fn.fanOut,
        resumable: false,
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
  nodesRef.current = rfNodes;
  edgesRef.current = rfEdges;
  useEffect(() => {
    onRef?.({
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

  const onConnect = useCallback(
    (connection: Connection, event?: MouseEvent | TouchEvent) => {
      // First add the edge without an artifact
      setRfEdges((eds) => addEdge({
        ...connection,
        sourceHandle: 'out',
        targetHandle: 'in',
        type: 'smoothstep',
        animated: true,
        style: { stroke: 'var(--line-2, #39455f)', strokeWidth: 2 },
        data: { artifact: undefined },
      }, eds));

      // Then open the artifact picker near the mouse position
      const x = event instanceof MouseEvent ? event.clientX : 400;
      const y = event instanceof MouseEvent ? event.clientY : 300;
      setPickerState({ x, y, connection });
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

  // ---------------------------------------------------------------------------
  // Drag-to-create node from palette
  // ---------------------------------------------------------------------------
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = useState<ReturnType<typeof useReactFlow> | null>(null);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('text/plain');
      const payload = decodeDragPayload(raw);
      if (!payload || payload.kind !== 'agent') return;

      const agentRef = payload.ref;
      const agent = agents.find((a) => a.id === agentRef);

      // Convert screen coords to ReactFlow coords
      const wrapper = reactFlowWrapper.current;
      if (!wrapper || !rfInstance) return;
      const rect = wrapper.getBoundingClientRect();
      const position = rfInstance.project({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });

      const newId = `fn-${Date.now().toString(36)}`;
      const newNode: Node<FlowNodeData> = {
        id: newId,
        type: 'flowNode',
        position,
        data: {
          agentRef,
          agentName: agent?.name ?? agentRef,
          selected: false,
        },
        width: 96,
        height: 106,
      };
      setRfNodes((nds) => [...nds, newNode]);
    },
    [agents, rfInstance],
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
        onConnect={(conn) => {
          onConnect(conn);
        }}
        onConnectEnd={(event) => {
          // Called after connection attempt; if pickerState was just set, update its position
          if (event instanceof MouseEvent) {
            setPickerState((prev) =>
              prev ? { ...prev, x: event.clientX, y: event.clientY } : prev,
            );
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
          onClose={() => setMiniPanel(null)}
          onRemove={handleRemoveNode}
        />
      )}
    </div>
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
