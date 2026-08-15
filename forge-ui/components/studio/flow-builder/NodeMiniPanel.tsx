'use client';

/**
 * NodeMiniPanel — shown when a flow-node is clicked on the canvas.
 * Displays the agent's name + purpose, and action buttons:
 *   - "Open in Agent Builder" → links to /agents/<ref>
 *   - "Remove from flow" → deletes the node (and its edges)
 */

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import type { Agent } from '@/lib/studio-client';

type Props = {
  /** The selected ReactFlow node id */
  nodeId: string;
  /** The agent definition for this node (null if not found) */
  agent: Agent | null;
  /** Screen position (right edge of the canvas node) to anchor the panel */
  anchorX: number;
  anchorY: number;
  /** Called when the panel should close */
  onClose: () => void;
  /** Called when "Remove from flow" is clicked */
  onRemove: (nodeId: string) => void;
  /** B4: current node modifiers + setters (mark as gate / fan-out). */
  gate?: string;
  fanOut?: string;
  onSetGate: (nodeId: string, gate: string | undefined) => void;
  onSetFanOut: (nodeId: string, fanOut: string | undefined) => void;
};

export function NodeMiniPanel({ nodeId, agent, anchorX, anchorY, onClose, onRemove, gate, fanOut, onSetGate, onSetFanOut }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const PANEL_W = 220;
  const left = Math.min(anchorX + 8, viewportW - PANEL_W - 16);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left,
        top: anchorY - 60,
        width: PANEL_W,
        zIndex: 9998,
        background: 'var(--panel)',
        border: '1px solid var(--line-2)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow)',
        overflow: 'hidden',
      }}
      data-component="node-mini-panel"
      data-panel-node-id={nodeId}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        background: 'var(--panel-2)',
        borderBottom: '1px solid var(--line)',
      }}>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text)',
        }}>
          {agent?.name ?? nodeId}
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--faint)',
            fontSize: 14,
            cursor: 'pointer',
            padding: '0 2px',
            lineHeight: 1,
          }}
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: '10px 12px' }}>
        {agent?.purpose && (
          <p style={{
            fontSize: 11.5,
            color: 'var(--dim)',
            lineHeight: 1.5,
            margin: '0 0 10px',
          }}>
            {agent.purpose}
          </p>
        )}

        {/* B4: node modifiers — set on the canvas, round-trip through save. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
          <label data-modifier="gate" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--dim)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              data-action="toggle-gate"
              checked={Boolean(gate)}
              onChange={(e) => onSetGate(nodeId, e.target.checked ? 'verdict' : undefined)}
            />
            Human gate (verdict)
          </label>
          {/* R2-03-F3: the fanout toggle is enabled ONLY on fanout-capable
              agents (capability.fanoutCapable, the same wire fact validateFlow
              lints), and binds the node fanOut to the agent's DECLARED driving
              artifact — not a hardcoded 'work-items'. The server fanout-capability
              lint is the backstop if a stale client bypasses this. */}
          {(() => {
            const fanoutCapable = Boolean(agent?.capability?.fanoutCapable);
            const drivingArtifact = agent?.fanout?.drivingArtifact ?? 'work-items';
            return (
              <label
                data-modifier="fanout"
                data-fanout-capable={fanoutCapable ? 'true' : 'false'}
                title={fanoutCapable ? undefined : 'This agent is not fanout-capable — its definition declares no `fanout:` block.'}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: fanoutCapable ? 'var(--dim)' : 'var(--faint)', cursor: fanoutCapable ? 'pointer' : 'not-allowed', opacity: fanoutCapable ? 1 : 0.55 }}
              >
                <input
                  type="checkbox"
                  data-action="toggle-fanout"
                  disabled={!fanoutCapable}
                  checked={Boolean(fanOut)}
                  onChange={(e) => onSetFanOut(nodeId, e.target.checked ? drivingArtifact : undefined)}
                />
                Fan out (one run per {drivingArtifact === 'work-items' ? 'work item' : drivingArtifact})
              </label>
            );
          })()}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Open in Agent Builder */}
          <Link
            href={agent ? `/agents/${encodeURIComponent(agent.id)}` : '#'}
            aria-disabled={!agent}
            onClick={(e) => { if (!agent) e.preventDefault(); }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '6px 12px',
              fontFamily: 'var(--font-display)',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--dim)',
              background: 'transparent',
              border: '1px solid var(--line-2)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              textDecoration: 'none',
              transition: 'border-color 0.12s, background 0.12s',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLAnchorElement;
              el.style.borderColor = 'var(--faint)';
              el.style.background = 'var(--panel-2)';
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLAnchorElement;
              el.style.borderColor = 'var(--line-2)';
              el.style.background = 'transparent';
            }}
            data-action="open-in-agent-builder"
          >
            ⬡ Open in Agent Builder
          </Link>

          {/* Remove from flow */}
          <button
            onClick={() => { onRemove(nodeId); onClose(); }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '6px 12px',
              fontFamily: 'var(--font-display)',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--red)',
              background: 'transparent',
              border: '1px solid rgba(248,113,113,0.4)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              transition: 'border-color 0.12s, background 0.12s',
              width: '100%',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = 'rgba(248,113,113,0.08)';
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = 'transparent';
            }}
            data-action="remove-from-flow"
          >
            ✕ Remove from flow
          </button>
        </div>
      </div>
    </div>
  );
}
