'use client';

import type { KbNode } from '@/lib/studio-client';

interface Props {
  nodes: KbNode[];
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
}

/**
 * Read-only list of a KB's theme-layer nodes (R6-08 WI-3, F1) — a text
 * alternative to picking a theme off the force-graph, and the reader the
 * `?theme=` deep-link alias (RULING 1) drives an operator toward. Reuses the
 * SAME `onSelectNode` callback the graph's node-click already calls — no
 * parallel selection machinery, just another way to invoke it.
 */
export function ThemeList({ nodes, selectedNodeId, onSelectNode }: Props) {
  const themes = nodes.filter((n) => n.layer === 'theme');

  return (
    <div data-component="theme-list" style={{ borderTop: '1px solid var(--line)' }}>
      <div className="panel-head">THEMES ({themes.length})</div>
      <div style={{ padding: '6px 10px', maxHeight: 260, overflowY: 'auto' }}>
        {themes.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--faint)', padding: '6px 4px' }}>No themes yet.</div>
        )}
        {themes.map((n) => {
          const active = n.id === selectedNodeId;
          return (
            <button
              key={n.id}
              type="button"
              data-theme-node={n.id}
              data-theme-active={active ? 'true' : 'false'}
              onClick={() => onSelectNode(n.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                background: active ? 'rgba(92,200,255,.1)' : 'transparent',
                color: active ? 'var(--text)' : 'var(--dim)',
                border: 'none', borderRadius: 4, cursor: 'pointer',
                padding: '5px 8px', fontSize: 12.5, fontFamily: 'var(--font-body)',
              }}
            >
              {n.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}
