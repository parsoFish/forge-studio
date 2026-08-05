'use client';

import { useState } from 'react';
import type { Catalog, CatalogItem } from '@/lib/studio-client';
import { catalogAddTarget } from '@/lib/agent-builder-view';

// ---------------------------------------------------------------------------
// CatalogPalette — left column, Component Library
// Search + collapsible groups + draggable chips + used-dimming
// ---------------------------------------------------------------------------

type Group = { key: keyof Pick<Catalog, 'skills' | 'tools' | 'mcps' | 'guards' | 'hooks'>; kind: Kind; label: string };
export type Kind = 'skill' | 'tool' | 'mcp' | 'guard' | 'hook';

const GROUPS: Group[] = [
  { key: 'skills', kind: 'skill', label: 'Skills' },
  { key: 'tools',  kind: 'tool',  label: 'Tools / CLIs' },
  { key: 'mcps',   kind: 'mcp',   label: 'MCP Servers' },
  { key: 'guards', kind: 'guard', label: 'Guards' },
  // Real library hooks (studio/hooks/<id>/) — a DISTINCT vocabulary from
  // guards (composition.hooks vs composition.guards, ADR-027 R3-03
  // amendment); the two must never merge in this palette either.
  { key: 'hooks',  kind: 'hook',  label: 'Hooks' },
];

type Props = {
  catalog: Catalog;
  usedIds: string[];
  /** C2 — click-to-add alongside the existing HTML5 drag-and-drop. Called
   *  with the chip's kind + id; the caller (page.tsx's `addToZone`) owns the
   *  idempotent-add guard, matching the drag path. */
  onAddToZone: (kind: Kind, id: string) => void;
};

export function CatalogPalette({ catalog, usedIds, onAddToZone }: Props) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const filter = search.toLowerCase().trim();

  function toggleGroup(kind: string) {
    setCollapsed((prev) => ({ ...prev, [kind]: !prev[kind] }));
  }

  function handleDragStart(e: React.DragEvent, item: CatalogItem, kind: Kind) {
    if (usedIds.includes(item.id)) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/plain', item.id);
    e.dataTransfer.setData('application/x-forge-kind', kind);
    e.dataTransfer.effectAllowed = 'copy';
    (e.currentTarget as HTMLElement).classList.add('dragging');
  }

  function handleDragEnd(e: React.DragEvent) {
    (e.currentTarget as HTMLElement).classList.remove('dragging');
  }

  let anyVisible = false;

  const groupEls = GROUPS.map((g) => {
    const items = (catalog[g.key] ?? []).filter((item) => {
      if (!filter) return true;
      const name = String(item.name ?? '').toLowerCase();
      const desc = String(item.desc ?? '').toLowerCase();
      return name.includes(filter) || desc.includes(filter);
    });
    if (items.length === 0) return null;
    anyVisible = true;
    const isCollapsed = !!collapsed[g.kind];

    return (
      <div className="catalog-group" data-group={g.kind} key={g.kind}>
        <div
          className={`catalog-group-header${isCollapsed ? ' collapsed' : ''}`}
          onClick={() => toggleGroup(g.kind)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(g.kind); } }}
        >
          <span>{g.label}</span>
          <span className="chevron" aria-hidden>▾</span>
        </div>
        <div className={`catalog-group-body${isCollapsed ? ' hidden' : ''}`}>
          {items.map((item) => {
            const isUsed = usedIds.includes(item.id);
            // C2: click (or Enter/Space) adds the chip alongside the existing
            // HTML5 drag-and-drop — it does not replace it. `catalogAddTarget`
            // is the same fail-closed kind→zone mapping DropZone.tsx's drag
            // path uses; a kind it doesn't recognise is a no-op, never a
            // default zone. An already-bound chip is dimmed + inert here
            // (mirrors `draggable={!isUsed}`) so click-to-add can't double-bind.
            const handleActivate = () => {
              if (isUsed) return;
              if (!catalogAddTarget(g.kind)) return;
              onAddToZone(g.kind, item.id);
            };
            return (
              <span
                key={item.id}
                className={`catalog-chip${isUsed ? ' used' : ''}`}
                draggable={!isUsed}
                data-id={item.id}
                data-kind={g.kind}
                data-desc={String(item.desc ?? '')}
                onDragStart={(e) => handleDragStart(e, item, g.kind)}
                onDragEnd={handleDragEnd}
                title={String(item.desc ?? '')}
                role="button"
                tabIndex={isUsed ? -1 : 0}
                aria-disabled={isUsed}
                onClick={handleActivate}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleActivate(); } }}
              >
                <span className="dot" />
                {String(item.name)}
              </span>
            );
          })}
        </div>
      </div>
    );
  });

  return (
    <aside className="col-left" id="col-library" data-component="catalog-palette">
      <div className="col-left-head">
        <h3>Component Library</h3>
        <input
          className="input"
          type="search"
          placeholder="Search skills, tools, guards…"
          autoComplete="off"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="catalog-scroll">
        {groupEls}
        {!anyVisible && filter && (
          <div className="search-empty">No components match &ldquo;{filter}&rdquo;.</div>
        )}
      </div>
    </aside>
  );
}
