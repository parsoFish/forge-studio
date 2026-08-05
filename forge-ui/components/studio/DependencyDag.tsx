'use client';

import type { DependencyDagView } from '@/lib/dependency-dag';

// ---------------------------------------------------------------------------
// DependencyDag — reusable dependency-DAG renderer (R4-15).
//
// Modelled on FilePackage.tsx: one data prop, renders a view — but unlike a
// component that derives its own view internally, this one takes an
// ALREADY-COMPUTED `DependencyDagView<T>` rather than raw items and calling
// `dependencyDagView` itself (adversarial-review fix, 2026-08-06). The
// original shape called `dependencyDagView` a second time inside this
// component while a sibling table read a first computation's `row.dependsOn`
// verbatim — two independent passes over the same data that could disagree.
// The caller now computes the view ONCE and shares that single object with
// every surface that renders it (this component AND, for the roadmap-draft
// artifact, SessionArtifactPane.tsx's table) — they structurally cannot
// drift because there is only one value to read.
//
// `labelOf`/`statusOf` let the caller supply its own item shape's accessors,
// mirroring `dependencyDagView`'s own `idOf`/`depsOf` accessor pattern, so
// this component stays generic over `T` the same way the view model is.
//
// `data-dag-unresolved-count` is a DESIGN DECISION not otherwise pinned by a
// test: it counts unresolved EDGES (view.edges.filter(e => !e.resolved)),
// mirroring the sibling `data-dag-edge-count`'s unit (edges, not nodes).
// ---------------------------------------------------------------------------

function joinIds(ids: readonly string[]): string {
  return ids.length === 0 ? '' : ids.join(',');
}

export function DependencyDag<T>({
  view,
  labelOf,
  statusOf,
}: {
  view: DependencyDagView<T>;
  labelOf: (item: T) => string;
  statusOf?: (item: T) => string | undefined;
}) {
  const unresolvedEdgeCount = view.edges.filter((e) => !e.resolved).length;
  const cycleMemberSet = new Set(view.cycleMembers);

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
                const status = statusOf?.(node.item) ?? '';
                const isCycleMember = cycleMemberSet.has(node.id);
                return (
                  <div
                    key={node.id}
                    data-dag-node={node.id}
                    data-dag-node-level={node.level}
                    data-dag-node-status={status}
                    data-dag-node-cycle={isCycleMember ? 'true' : 'false'}
                    data-dag-depends-on={joinIds(node.deps)}
                    data-dag-unresolved={joinIds(node.unresolvedDeps)}
                    style={{
                      border: isCycleMember ? '2px solid var(--ember, #FF9E4A)' : '1px solid var(--line)',
                      borderRadius: 6,
                      padding: '8px 10px',
                      fontSize: 12,
                      background: 'var(--panel, transparent)',
                    }}
                  >
                    <div style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--text)' }}>{labelOf(node.item)}</div>
                    {status && <div style={{ fontSize: 11, color: 'var(--faint)' }}>{status}</div>}
                    {isCycleMember && (
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ember, #FF9E4A)' }}>part of a dependency cycle</div>
                    )}
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
