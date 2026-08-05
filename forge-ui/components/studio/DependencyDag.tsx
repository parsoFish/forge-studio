'use client';

import { dependencyDagView } from '@/lib/dependency-dag';

// ---------------------------------------------------------------------------
// DependencyDag — reusable dependency-DAG renderer (R4-15).
//
// Modelled on FilePackage.tsx: one data prop, derives its view internally via
// the pure, shared `dependencyDagView` (lib/dependency-dag.ts) — no fetching,
// no bespoke leveling/cycle logic here. Generic over nothing here (the item
// shape is fixed to `DagItem`), but `dependencyDagView` itself stays generic
// over `T` so a future caller with a different item shape (e.g. R4-13's
// project-roadmap tab, work items rather than initiatives) can map its own
// data into `DagItem` and reuse this component unchanged.
//
// `data-dag-unresolved-count` is a DESIGN DECISION not otherwise pinned by a
// test: it counts unresolved EDGES (view.edges.filter(e => !e.resolved)),
// mirroring the sibling `data-dag-edge-count`'s unit (edges, not nodes).
// ---------------------------------------------------------------------------

export type DagItem = { id: string; label: string; status?: string; dependsOn: string[] };

function joinIds(ids: readonly string[]): string {
  return ids.length === 0 ? '' : ids.join(',');
}

export function DependencyDag({ items }: { items: DagItem[] }) {
  const view = dependencyDagView(
    items,
    (i) => i.id,
    (i) => i.dependsOn,
  );
  const unresolvedEdgeCount = view.edges.filter((e) => !e.resolved).length;

  return (
    <div
      data-component="dependency-dag"
      data-dag-node-count={view.nodes.length}
      data-dag-level-count={view.columns.length}
      data-dag-edge-count={view.edges.length}
      data-dag-cycle={view.hasCycle ? 'true' : 'false'}
      data-dag-unresolved-count={unresolvedEdgeCount}
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      {view.hasCycle && (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: 'var(--ember, #FF9E4A)',
            border: '1px solid var(--ember, #FF9E4A)',
            borderRadius: 6,
            padding: '6px 10px',
          }}
        >
          Dependency cycle detected: {view.cycleMembers.join(', ')}
        </div>
      )}
      {view.isEmpty ? (
        <div style={{ fontSize: 12.5, color: 'var(--faint)', fontStyle: 'italic' }}>No dependency data to render.</div>
      ) : (
        <div style={{ display: 'flex', gap: 20, overflowX: 'auto', padding: '4px 2px' }}>
          {view.columns.map((column, level) => (
            <div key={level} data-dag-level={level} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 170 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--faint)' }}>
                Level {level}
              </div>
              {column.map((node) => {
                const status = node.item.status ?? '';
                return (
                  <div
                    key={node.id}
                    data-dag-node={node.id}
                    data-dag-node-level={node.level}
                    data-dag-node-status={status}
                    data-dag-depends-on={joinIds(node.item.dependsOn)}
                    data-dag-unresolved={joinIds(node.unresolvedDeps)}
                    style={{
                      border: '1px solid var(--line)',
                      borderRadius: 6,
                      padding: '8px 10px',
                      fontSize: 12,
                      background: 'var(--panel, transparent)',
                    }}
                  >
                    <div style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--text)' }}>{node.item.label}</div>
                    {status && <div style={{ fontSize: 11, color: 'var(--faint)' }}>{status}</div>}
                    {node.unresolvedDeps.length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--ember, #FF9E4A)' }}>unresolved: {node.unresolvedDeps.join(', ')}</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
