'use client';

import { useState } from 'react';
import type { Catalog } from '@/lib/studio-client';
import type { Kind } from './CatalogPalette';

// ---------------------------------------------------------------------------
// DropZone — typed drop target; rejects wrong-kind drags with a toast callback
// ---------------------------------------------------------------------------

type Props = {
  kind: Kind;
  ids: string[];
  catalog: Catalog;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onReject: (msg: string) => void;
};

const ZONE_LABELS: Record<Kind, string> = {
  skill: 'Skills',
  tool:  'Tools & CLIs',
  mcp:   'MCP Servers',
  hook:  'Hooks',
};

const ZONE_HINTS: Record<Kind, string> = {
  skill: 'drag skills here — what this agent knows how to do',
  tool:  'drag tools here — CLIs and runtimes it can invoke',
  mcp:   'drag MCP servers here — structured data & action channels',
  hook:  'drag hooks here — at minimum attach event-log for observability',
};

const ZONE_IDS: Record<Kind, string> = {
  skill: 'zone-skills',
  tool:  'zone-tools',
  mcp:   'zone-mcps',
  hook:  'zone-hooks',
};

function kindOf(id: string): Kind | null {
  if (id.startsWith('sk-') || id.startsWith('skill-')) return 'skill';
  if (id.startsWith('tl-') || id.startsWith('tool-')) return 'tool';
  if (id.startsWith('mcp-')) return 'mcp';
  if (id.startsWith('hk-') || id.startsWith('hook-')) return 'hook';
  return null;
}

function catalogName(catalog: Catalog, id: string): string {
  const all = [
    ...(catalog.skills ?? []),
    ...(catalog.tools ?? []),
    ...(catalog.mcps ?? []),
    ...(catalog.hooks ?? []),
  ];
  return all.find((i) => i.id === id)?.name as string ?? id;
}

type DragState = 'idle' | 'over' | 'reject';

export function DropZone({ kind, ids, catalog, onAdd, onRemove, onReject }: Props) {
  const [drag, setDrag] = useState<DragState>('idle');

  function getDragKind(): Kind | null {
    // Try to read from data-kind on the currently dragging chip
    if (typeof document !== 'undefined') {
      const dragging = document.querySelector('.catalog-chip.dragging');
      if (dragging) {
        const dk = dragging.getAttribute('data-kind') as Kind | null;
        if (dk) return dk;
        const id = dragging.getAttribute('data-id');
        if (id) return kindOf(id);
      }
    }
    return null;
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    const dk = getDragKind();
    if (!dk || dk === kind) {
      e.dataTransfer.dropEffect = 'copy';
      setDrag('over');
    } else {
      e.dataTransfer.dropEffect = 'none';
      setDrag('reject');
    }
  }

  function handleDragLeave() {
    setDrag('idle');
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag('idle');
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;

    const dk = kindOf(id) ?? (e.dataTransfer.getData('application/x-forge-kind') as Kind | null);
    if (dk && dk !== kind) {
      const name = catalogName(catalog, id);
      const zoneLabel = ZONE_LABELS[dk] ?? dk;
      onReject(`"${name}" is a ${dk} — drop it in ${zoneLabel}.`);
      return;
    }

    if (!ids.includes(id)) {
      onAdd(id);
    }
  }

  const zoneClass = [
    'drop-zone',
    drag === 'over' ? 'drag-over' : '',
    drag === 'reject' ? 'reject' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      id={ZONE_IDS[kind]}
      className={zoneClass}
      data-accepts={kind}
      data-count={ids.length}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {ids.length === 0 ? (
        <span className="placeholder">{ZONE_HINTS[kind]}</span>
      ) : (
        ids.map((id) => {
          const name = catalogName(catalog, id);
          return (
            <span key={id} className="zone-chip" data-kind={kind} data-id={id}>
              <span className="dot" />
              {name}
              <span
                className="x"
                data-remove={id}
                title="Remove"
                role="button"
                tabIndex={0}
                onClick={() => onRemove(id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRemove(id); } }}
              >
                ×
              </span>
            </span>
          );
        })
      )}
    </div>
  );
}
