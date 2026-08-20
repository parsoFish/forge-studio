import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SkillLibraryEntry } from '@/lib/skill-client';
import { groupSkillLibrary, skillBadges, installStateOf, shelfSkillPreview } from '@/lib/skill-library-view';
import type { HookLibraryEntry } from '@/lib/hook-client';
import { hookBadges } from '@/lib/hook-library-view';
import type { ConnectionWire } from '@/lib/connection-client';
import { readinessCounts, connectionBadges } from '@/lib/connection-library-view';
import type { TemplateLibraryEntry } from '@/lib/template-client';
import { groupTemplateLibrary, templateBadges } from '@/lib/template-library-view';
import type { CommunityHubWithCount, CommunityItem } from '@/lib/community-client';
import { hubLabel, installStateLabel } from '@/lib/community-view';
import { StudioPage } from '@/components/StudioPage';

// ---------------------------------------------------------------------------
// LibraryHub — the rebuilt `/library` page (W6-IA-4). Replaces the old
// landing page (hero, Operator Pulse, attention strip, projects/agents/
// flows/KB shelves — those all now have their own real index routes:
// /projects (IA-1), /agents (IA-3), /flows (IA-2), /knowledge). Library is
// now SHELVES ONLY: the five reusable-building-block island types every
// agent and flow composes from, in the operator-locked order Skills / Hooks
// / Connections / Templates / Community, plus a small cross-link card
// pointing at Knowledge (which now owns KB creation).
//
// Pure, props-driven presentational component (no fetch, no `useEffect`) —
// mirrors `ProjectsIndexBody` / `AgentsIndexView`'s own precedent exactly,
// so it renders identically under `react-dom/server`'s `renderToStaticMarkup`
// in a unit test (`lib/library-hub-render.test.ts`) and inside the real
// `app/library/page.tsx` fetch-and-`useState` wrapper. Each shelf reuses the
// SAME fetcher + pure derivation module its own full page already uses
// (`fetchSkillLibrary`/`groupSkillLibrary`/`skillBadges`, etc.) — counts and
// badges are never re-derived here, only rendered.
// ---------------------------------------------------------------------------

/** A single named constant (never a literal repeated at call sites) bounding
 *  how many cards a shelf shows inline — "browse all" is the way to see the
 *  rest. Shelves are a preview, not a second copy of the full list page. */
export const LIBRARY_SHELF_CARD_LIMIT = 6;

export type ShelfStatus = 'loading' | 'error' | 'ready';

export type LibraryHubProps = {
  skills: { status: ShelfStatus; entries: SkillLibraryEntry[]; error: string | null };
  hooks: { status: ShelfStatus; entries: HookLibraryEntry[]; error: string | null };
  connections: { status: ShelfStatus; entries: ConnectionWire[]; error: string | null };
  templates: { status: ShelfStatus; entries: TemplateLibraryEntry[]; error: string | null };
  community: { status: ShelfStatus; hubs: CommunityHubWithCount[]; items: CommunityItem[]; error: string | null };
  /** True once all five shelf fetches have settled (success or error) — a
   *  slow/broken shelf never blocks the others from rendering their own
   *  honest state; this only gates the page-level `data-page-ready`. */
  ready: boolean;
};

export function LibraryHub({ skills, hooks, connections, templates, community, ready }: LibraryHubProps) {
  const skillGroups = groupSkillLibrary(skills.entries);
  const connCounts = readinessCounts(connections.entries);
  const templateGroups = groupTemplateLibrary(templates.entries);

  return (
    <StudioPage
      dataPage="library"
      ready={ready}
      title="Library"
      lede="Reusable building blocks — the skills, hooks, connections, templates and community catalog every agent and flow composes from. Dashboards live on Home now; this page is shelves only."
      maxWidth={1240}
    >
      {/* ===== SKILLS ===== */}
      <ShelfSection
        section="skills"
        tint="agent"
        title="Skills"
        status={skills.status}
        count={skillGroups.total}
        errorText={skills.error}
        emptyText="No skills yet — author one, or check the community list."
        loadingText="Loading skills…"
        browseHref="/skills"
        browseAction="browse-skills"
        create={{ href: '/skills/new', action: 'new-skill', label: '+ New skill' }}
      >
        {/* W7-B3 (library-27): interleaved preview — a community entry can
            actually appear in the six slots the count claims to summarise. */}
        {shelfSkillPreview(skillGroups, LIBRARY_SHELF_CARD_LIMIT).map((entry) => (
          <ShelfSkillCard key={entry.id} entry={entry} />
        ))}
      </ShelfSection>

      {/* ===== HOOKS ===== */}
      <ShelfSection
        section="hooks"
        tint="flow"
        title="Hooks"
        status={hooks.status}
        count={hooks.entries.length}
        errorText={hooks.error}
        emptyText="No hooks yet — author one to get started."
        loadingText="Loading hooks…"
        browseHref="/hooks"
        browseAction="browse-hooks"
        create={{ href: '/hooks/new', action: 'new-hook', label: '+ New hook' }}
      >
        {hooks.entries.slice(0, LIBRARY_SHELF_CARD_LIMIT).map((entry) => (
          <ShelfHookCard key={entry.id} entry={entry} />
        ))}
      </ShelfSection>

      {/* ===== CONNECTIONS ===== — no create CTA: curation happens by PR to
          studio/catalog.yaml (D1, connection-library-view.ts's own header),
          not from Library or /connections itself. */}
      <ShelfSection
        section="connections"
        tint="project"
        title="Connections"
        status={connections.status}
        count={connCounts.total}
        errorText={connections.error}
        emptyText="No connections in the catalog."
        loadingText="Loading connections…"
        browseHref="/connections"
        browseAction="browse-connections"
      >
        {connections.entries.slice(0, LIBRARY_SHELF_CARD_LIMIT).map((entry) => (
          <ShelfConnectionCard key={entry.id} entry={entry} />
        ))}
      </ShelfSection>

      {/* ===== TEMPLATES ===== — authorable since W7-B4 (library-17/01):
          planning + demo-output templates are single-file packages created
          at /templates/new (scaffolds stay repo-curated). */}
      <ShelfSection
        section="templates"
        tint="artifact"
        title="Templates"
        status={templates.status}
        count={templateGroups.total}
        errorText={templates.error}
        emptyText="No templates registered yet."
        loadingText="Loading templates…"
        browseHref="/templates"
        browseAction="browse-templates"
        create={{ href: '/templates/new', action: 'new-template', label: '+ New template' }}
      >
        {templates.entries.slice(0, LIBRARY_SHELF_CARD_LIMIT).map((entry) => (
          <ShelfTemplateCard key={entry.id} entry={entry} />
        ))}
      </ShelfSection>

      {/* ===== COMMUNITY ===== — "Browse community" entry, never a create
          CTA (installs route through the owning pipeline's own page). */}
      <ShelfSection
        section="community"
        tint="kb"
        title="Community"
        status={community.status}
        count={community.items.length}
        errorText={community.error}
        emptyText="The community index is empty."
        loadingText="Loading the community index…"
        browseHref="/community"
        browseAction="browse-community"
        browseLabel="Browse community →"
      >
        {community.items.slice(0, LIBRARY_SHELF_CARD_LIMIT).map((item) => (
          <ShelfCommunityCard key={`${item.kind}/${item.id}`} item={item} />
        ))}
      </ShelfSection>

      {/* KB cross-link card REMOVED (W7-B4, library-02 — operator note 9):
          the pillar nav already carries Knowledge; the card duplicated it. */}
    </StudioPage>
  );
}

// ---------------------------------------------------------------------------
// ShelfSection — the shared shelf-row shell: header (badge, count, create
// CTA, browse link) + status-gated body (loading / error / empty / grid).
// ---------------------------------------------------------------------------

function ShelfSection({
  section,
  tint,
  title,
  status,
  count,
  errorText,
  emptyText,
  loadingText,
  browseHref,
  browseAction,
  browseLabel = 'browse all →',
  create,
  children,
}: {
  section: string;
  tint: 'agent' | 'flow' | 'project' | 'artifact' | 'kb';
  title: string;
  status: ShelfStatus;
  count: number;
  errorText: string | null;
  emptyText: string;
  loadingText: string;
  browseHref: string;
  browseAction: string;
  browseLabel?: string;
  create?: { href: string; action: string; label: string };
  children: ReactNode;
}) {
  const hasCards = status === 'ready' && count > 0;
  return (
    <section className="lib-section" data-section={section} data-count={count} style={{ marginBottom: 40 }}>
      <div className="lib-section-head" style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 14 }}>
        <span className={`badge badge-${tint}`}>{title}</span>
        <span
          className="lib-count"
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)',
            background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 4, padding: '1px 7px',
          }}
        >
          {count}
        </span>
        <span style={{ flex: 1 }} />
        {create && (
          <Link className="btn btn-sm" href={create.href} data-action={create.action} style={{ textDecoration: 'none' }}>
            {create.label}
          </Link>
        )}
        <Link className="btn btn-sm" href={browseHref} data-action={browseAction} style={{ textDecoration: 'none' }}>
          {browseLabel}
        </Link>
      </div>

      {status === 'loading' && (
        <div data-component={`${section}-loading`} className="muted" style={{ fontStyle: 'italic', fontSize: 13, padding: '10px 0' }}>
          {loadingText}
        </div>
      )}
      {status === 'error' && (
        <div
          data-component={`${section}-error`}
          style={{ color: '#f87171', fontSize: 13, padding: '12px 14px', border: '1px solid rgba(248,113,113,.35)', borderRadius: 'var(--radius-sm, 6px)', background: 'rgba(248,113,113,.06)' }}
        >
          Could not reach the forge bridge — {title.toLowerCase()} are unavailable{errorText ? ` (${errorText})` : ''}.
        </div>
      )}
      {status === 'ready' && count === 0 && (
        <div data-component={`${section}-empty`} className="muted" style={{ fontStyle: 'italic', fontSize: 13, padding: '10px 0' }}>
          {emptyText}
        </div>
      )}
      {hasCards && (
        <div className="card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {children}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shelf cards — compact previews, reusing each source page's OWN badge
// derivation functions (never re-derived here), linking to the real detail
// route each full library page already owns.
// ---------------------------------------------------------------------------

function ShelfSkillCard({ entry }: { entry: SkillLibraryEntry }) {
  const badges = skillBadges(entry);
  return (
    <Link
      href={`/skills/${encodeURIComponent(entry.id)}`}
      className="lib-card"
      data-card-type="skill"
      data-skill-id={entry.id}
      style={{ display: 'block' }}
    >
      <div className="card-top">
        <span className="card-name">{entry.name || entry.id}</span>
        {badges.map((b) => <span key={b} className="badge">{b}</span>)}
        <InstallStateBadge entry={entry} />
      </div>
      <p className="card-body">{entry.description || 'No description.'}</p>
    </Link>
  );
}

/** W7-B4 (library-04): the DOM-as-metrics `data-skill-installed` attribute
 *  finally gets its HUMAN-VISIBLE counterpart — one badge, derived from the
 *  same `installStateOf` the /skills page uses (never re-derived). */
export function InstallStateBadge({ entry }: { entry: SkillLibraryEntry }) {
  const state = installStateOf(entry);
  const installed = state === 'installed';
  return (
    <span
      className="badge"
      data-component="install-state"
      data-installed={installed ? 'true' : 'false'}
      style={installed ? { color: 'var(--sage, #7cb87c)' } : { color: 'var(--faint)', fontStyle: 'italic' }}
    >
      {installed ? 'installed' : 'not installed'}
    </span>
  );
}

function ShelfHookCard({ entry }: { entry: HookLibraryEntry }) {
  if (!entry.ok) {
    return (
      <Link href={`/hooks/${encodeURIComponent(entry.id)}`} className="lib-card" data-card-type="hook" data-hook-id={entry.id} style={{ display: 'block' }}>
        <div className="card-top">
          <span className="card-name">{entry.id}</span>
          <span className="badge">malformed</span>
        </div>
        <p style={{ fontSize: 11.5, color: '#f87171', margin: 0 }}>{entry.error}</p>
      </Link>
    );
  }
  const badges = hookBadges(entry);
  return (
    <Link href={`/hooks/${encodeURIComponent(entry.id)}`} className="lib-card" data-card-type="hook" data-hook-id={entry.id} style={{ display: 'block' }}>
      <div className="card-top">
        <span className="card-name">{entry.name}</span>
        {badges.map((b) => <span key={b} className="badge">{b}</span>)}
      </div>
      <p className="card-body">{entry.description || 'No description.'}</p>
      <div className="card-meta">
        <span className="card-stat">{entry.on}</span>
      </div>
    </Link>
  );
}

function ShelfConnectionCard({ entry }: { entry: ConnectionWire }) {
  const badges = connectionBadges(entry);
  return (
    <Link href={`/connections/${encodeURIComponent(entry.id)}`} className="lib-card" data-card-type="connection" data-connection-id={entry.id} style={{ display: 'block' }}>
      <div className="card-top">
        <span className="status-dot" data-status={entry.probe.state === 'available' ? 'complete' : 'pending'} />
        <span className="card-name">{entry.name}</span>
        <span className="badge">{entry.kind === 'mcp' ? 'MCP' : 'Tool'}</span>
        {badges.map((b) => <span key={b} className="badge">{b}</span>)}
      </div>
      <p className="card-body">{entry.desc || 'No description.'}</p>
    </Link>
  );
}

function ShelfTemplateCard({ entry }: { entry: TemplateLibraryEntry }) {
  const badges = templateBadges(entry);
  return (
    <Link href={`/templates/${encodeURIComponent(entry.id)}`} className="lib-card" data-card-type="template" data-template-id={entry.id} style={{ display: 'block' }}>
      <div className="card-top">
        <span className="card-name">{entry.name || entry.id}</span>
        {badges.map((b) => <span key={b} className="badge">{b}</span>)}
      </div>
      <p className="card-body">{entry.description || 'No description.'}</p>
    </Link>
  );
}

function ShelfCommunityCard({ item }: { item: CommunityItem }) {
  return (
    <Link
      href={`/community/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.id)}`}
      className="lib-card"
      data-card-type="community-item"
      data-item-id={item.id}
      data-item-kind={item.kind}
      style={{ display: 'block' }}
    >
      <div className="card-top">
        <span className="card-name">{item.name}</span>
        <span className="badge">{item.kind}</span>
      </div>
      <p className="card-body">{item.desc}</p>
      <div className="card-meta">
        <span className="card-stat">{hubLabel(item.hub)}</span>
        <span className="card-stat">{installStateLabel(item.installState)}</span>
      </div>
    </Link>
  );
}
