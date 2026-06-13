'use client';

import { useState } from 'react';
import type { Catalog, CatalogItem } from '@/lib/studio-client';

// ---------------------------------------------------------------------------
// CatalogPalette — left column, Component Library
// Search + collapsible groups + draggable chips + used-dimming
// ---------------------------------------------------------------------------

type Group = { key: keyof Pick<Catalog, 'skills' | 'tools' | 'mcps' | 'hooks'>; kind: Kind; label: string };
export type Kind = 'skill' | 'tool' | 'mcp' | 'hook';

const GROUPS: Group[] = [
  { key: 'skills', kind: 'skill', label: 'Skills' },
  { key: 'tools',  kind: 'tool',  label: 'Tools / CLIs' },
  { key: 'mcps',   kind: 'mcp',   label: 'MCP Servers' },
  { key: 'hooks',  kind: 'hook',  label: 'Hooks' },
];

type Props = {
  catalog: Catalog;
  usedIds: string[];
};

export function CatalogPalette({ catalog, usedIds }: Props) {
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
          placeholder="Search skills, tools, hooks…"
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
