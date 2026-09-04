'use client';

/**
 * FlowStationNode — one station on the builder canvas, and the two acts that
 * draw an edge between two of them.
 *
 * SPLIT OUT of FlowBuilderCanvas when the declared handles landed
 * (`forge-8vfn.5.12`, M5-B): the canvas was already a baselined 851-line file
 * and `check-file-size` treats a baseline as a CEILING, not a licence. The node
 * is the natural seam — it owns its own markup, its ports and its handles, and
 * the canvas owns state and orchestration.
 */
import { createContext, useContext } from 'react';
import { Handle, Position, type NodeProps, type NodeTypes } from 'reactflow';
import { edgeIdFor } from '@/lib/flow-builder-acts';

export type FlowNodeData = {
  agentRef: string;
  agentName: string;
  gate?: string;
  fanOut?: string;
  resumable?: boolean;
  selected?: boolean;
};

/**
 * The two acts that draw an edge, published to the node component.
 *
 * `NODE_TYPES` is a module constant, so a node cannot take canvas callbacks as
 * props, and the node's `data` is SERIALISED on save — putting a callback there
 * would write it into `flow.yaml`. A context is the one channel that is neither.
 */
export type ConnectActs = {
  /** Arm this station as the edge's source. */
  armFrom: (nodeId: string) => void;
  /** Draw the armed edge into this station. */
  completeInto: (nodeId: string) => void;
};
export const ConnectActsContext = createContext<ConnectActs | null>(null);

/**
 * Every field an edge between two stations carries, in ONE place. The
 * port-drag and the declared handle both build their edge from it, so an edge
 * drawn by keyboard-reachable handle and an edge drawn by pointer cannot come
 * out different — the divergence that would make S4's verdict a lie about what
 * an operator gets.
 */
export function stationEdgeShape(source: string, target: string) {
  return {
    id: edgeIdFor(source, target),
    source,
    target,
    sourceHandle: 'out',
    targetHandle: 'in',
    type: 'smoothstep',
    animated: true,
    style: { stroke: 'var(--line-2, #39455f)', strokeWidth: 2 },
    data: { artifact: undefined },
  };
}

const HEX_CLIP = 'polygon(25% 3%, 75% 3%, 98% 50%, 75% 97%, 25% 97%, 2% 50%)';
const HANDLE_VISIBLE_STYLE: React.CSSProperties = {
  width: 12,
  height: 12,
  border: '2px solid var(--bg, #0b0e14)',
  borderRadius: '50%',
};

function FlowNodeComponent({ id, data, selected }: NodeProps<FlowNodeData>): JSX.Element {
  const connectActs = useContext(ConnectActsContext);
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
        // The declared handle for "wire a station INTO this one". It sits on the
        // very element the pointer act drops onto, so the automated act and the
        // operator's act are the same element, not two parallel affordances.
        data-action={`connect-into-${data.agentRef}`}
        onClick={() => connectActs?.completeInto(id)}
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
        // The declared handle for "wire FROM this station". Pressing it arms the
        // source; the next `connect-into-<agent>` draws the edge. Two presses,
        // because that is what the pointer act is — grab the out-port, release
        // on an in-port — and a single action naming both ends would need one
        // element per ordered pair.
        data-action={`connect-from-${data.agentRef}`}
        onClick={() => connectActs?.armFrom(id)}
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
        color: 'var(--faint)',
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


export const NODE_TYPES: NodeTypes = { flowNode: FlowNodeComponent };
