'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StudioPage } from '@/components/StudioPage';
import { fetchTemplateLibrary, type TemplateLibraryEntry } from '@/lib/template-client';
import { groupTemplateLibrary, filterTemplates, templateBadges, previewClassFor } from '@/lib/template-library-view';

// ---------------------------------------------------------------------------
// Templates library — /templates (R3-06, WI-4). Every registry item — the
// demo-output / planning / project-scaffold artifact templates a flow can
// declare — grouped and searchable, mirroring /skills's page shape. `usedBy`
// is server-derived (never re-derived here) and its `usedByDerivation`
// carries the scan provenance so an empty result reads as "scanned N,
// found none", never a bare zero or a blank that could be misread as
// "unknown" (the whole point of the field).
// ---------------------------------------------------------------------------

const BADGE_STYLE: Record<string, React.CSSProperties> = {
  unverified: { color: 'var(--amber, #fbbf24)', borderColor: 'rgba(251,191,36,.4)', background: 'rgba(251,191,36,.08)' },
  error: { color: '#f87171', borderColor: 'rgba(248,113,113,.4)', background: 'rgba(248,113,113,.08)' },
};

const CATEGORY_LABEL: Record<TemplateLibraryEntry['category'], string> = {
  'demo-output': 'Demo output',
  planning: 'Planning',
  'project-scaffold': 'Project scaffold',
};

export default function TemplateLibraryPage() {
  const [entries, setEntries] = useState<TemplateLibraryEntry[]>([]);
  // Distinguishes "haven't loaded yet" / "loaded, bridge unreachable" /
  // "loaded, reachable" — a genuinely empty library must never render like a
  // dead bridge, and vice versa (house rule: no silent empty-list fallback).
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  async function load(): Promise<void> {
    const r = await fetchTemplateLibrary();
    if (!r.ok) {
      setStatus('error');
      setError(r.error ?? 'could not reach the forge bridge');
      return;
    }
    setEntries(r.templates);
    setStatus('ready');
    setError(null);
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = filterTemplates(entries, query);
  const grouped = groupTemplateLibrary(filtered);

  return (
    <StudioPage
      dataPage="template-library"
      ready={status !== 'loading'}
      data={{
        'data-template-count': grouped.total,
        'data-planning-count': grouped.planningCount,
        'data-demo-output-count': grouped.demoOutputCount,
        'data-project-scaffold-count': grouped.projectScaffoldCount,
      }}
      title="Templates"
      lede={
        <>
          Artifact templates a flow can declare — demo-output narratives, planning
          documents, and project scaffolds. Usage is scanned from the real flow
          graph, not guessed.
        </>
      }
    >

        <input
          type="text"
          data-field="template-search"
          placeholder="Search templates by name or description…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: '100%', maxWidth: 420, marginBottom: 24, background: 'var(--bg-2)',
            border: '1px solid var(--line)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text)',
            fontSize: 13, padding: '8px 11px', outline: 'none', boxSizing: 'border-box',
          }}
        />

        {status === 'loading' && (
          <div style={{ color: 'var(--dim)', fontSize: 13.5, padding: '24px 0' }}>Loading templates…</div>
        )}

        {status === 'error' && (
          <div
            data-component="fetch-error"
            style={{ color: '#f87171', fontSize: 13, padding: '14px 16px', border: '1px solid rgba(248,113,113,.35)', borderRadius: 'var(--radius-sm, 6px)', background: 'rgba(248,113,113,.06)' }}
          >
            Could not reach the forge bridge — templates are unavailable ({error}). This is
            NOT the same as an empty library; retry once the bridge is back up.
          </div>
        )}

        {status === 'ready' && grouped.total === 0 && (
          <div style={{ color: 'var(--faint)', fontSize: 13, fontStyle: 'italic', padding: '24px 0' }}>
            {query ? 'No templates match your search.' : 'No templates registered yet.'}
          </div>
        )}

        {status === 'ready' && grouped.planning.length > 0 && (
          <TemplateSection title="Planning" entries={grouped.planning} />
        )}

        {status === 'ready' && grouped.demoOutput.length > 0 && (
          <TemplateSection title="Demo output" entries={grouped.demoOutput} />
        )}

        {status === 'ready' && grouped.projectScaffold.length > 0 && (
          <TemplateSection title="Project scaffold" entries={grouped.projectScaffold} />
        )}
    </StudioPage>
  );
}

// ---------------------------------------------------------------------------
// TemplateSection — a labelled grid of template cards for one category
// ---------------------------------------------------------------------------

function TemplateSection({ title, entries }: { title: string; entries: TemplateLibraryEntry[] }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>
        {title} <span style={{ color: 'var(--faint)', fontWeight: 500 }}>({entries.length})</span>
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        {entries.map((entry, index) => (
          <TemplateCard key={entry.id} entry={entry} index={index} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// TemplateCard
// ---------------------------------------------------------------------------

function TemplateCard({ entry, index }: { entry: TemplateLibraryEntry; index: number }) {
  const badges = templateBadges(entry);
  const usedByCount = entry.usedBy.length;
  // Honesty rule: an empty usedBy is a scan RESULT, not an absence of data —
  // it must never render as a bare "0" that could be misread as "unknown".
  const usedByLabel = usedByCount > 0
    ? `${usedByCount} use${usedByCount === 1 ? '' : 's'}`
    : `scanned ${entry.usedByDerivation.scanned}, none found`;

  return (
    <Link
      href={`/templates/${encodeURIComponent(entry.id)}`}
      className="lib-card"
      data-card-type="template"
      data-template-id={entry.id}
      data-template-category={entry.category}
      {...(entry.previewKind ? { 'data-template-preview': entry.previewKind } : {})}
      data-template-used-by-count={usedByCount}
      style={{ animationDelay: `${index * 0.045}s`, display: 'block' }}
    >
      <div className="card-top">
        <span className="card-name">{entry.name || entry.id}</span>
        {badges.map((b) => (
          <span key={b} className="badge" style={BADGE_STYLE[b]}>{b}</span>
        ))}
      </div>
      {entry.previewKind && (
        <div className={`tpl-preview ${previewClassFor(entry.previewKind)}`} aria-hidden="true">
          <span className="tpl-preview-glyph" />
        </div>
      )}
      <p className="card-body">{entry.description || 'No description.'}</p>
      {entry.error && (
        <p style={{ fontSize: 11.5, color: '#f87171', margin: '0 0 6px' }}>{entry.error}</p>
      )}
      <div className="card-meta">
        <span className="card-stat">{usedByLabel}</span>
        <span className="card-stat" title={`scanned from ${entry.usedByDerivation.source}`}>
          {entry.usedByDerivation.source}
        </span>
        <span className="badge badge-dim">{CATEGORY_LABEL[entry.category]}</span>
      </div>
    </Link>
  );
}
