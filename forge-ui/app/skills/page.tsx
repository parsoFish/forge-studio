'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StudioPage } from '@/components/StudioPage';
import { fetchSkillLibrary, type SkillLibraryEntry } from '@/lib/skill-client';
import { groupSkillLibrary, skillBadges, filterSkills } from '@/lib/skill-library-view';
import { fetchCommunityIndex, type CommunityItem } from '@/lib/community-client';
import { hubLabel, signalsLabel, communityBadgeForSkill } from '@/lib/community-view';

// ---------------------------------------------------------------------------
// Skills library — /skills (R3-01-F3/F4, WI-3, D8: the ONE place "New skill"
// lives). Lists every plain composable skill (local, hand-authored or
// installed-from-community) plus every catalog community skill not yet
// installed. Studio agents (SKILL.md WITH a runtime: block) are NOT skills —
// they live under /agents.
//
// R3-07-F1: the per-card manual install affordance (a local-directory box +
// "Install" button) is RETIRED here — it was driven by zero journey beats
// and zero tests, and the cross-kind /community browser (linked above the
// search field) is now the one real install entry point, routing through
// the same install pipeline this page's cards still read from. What THIS
// page adds instead is honesty about provenance: a community-sourced card
// (badge `community`) shows its derived hub and hub-attributed signals,
// fetched independently from `/api/studio/community` and joined via
// `communityBadgeForSkill` (forge-ui/lib/community-view.ts) — gated on the
// skill entry's OWN `source === 'community'` AND (kind === 'skill', id), not
// id alone (a local skill sharing an id with a catalog community-skills
// entry must never inherit that entry's hub/signals/provenance — the round-6
// adversarial-review finding this join now closes). Never a re-derivation of
// a fact the community index didn't send, and never rendered at all when
// that fetch fails (absence is honest; a dead second fetch must never blank
// the primary skill list, which is why it is a wholly separate effect /
// failure mode).
// ---------------------------------------------------------------------------

const BADGE_STYLE: Record<string, React.CSSProperties> = {
  community: { color: 'var(--c-kb, #4ade80)', borderColor: 'rgba(74,222,128,.4)', background: 'rgba(74,222,128,.08)' },
  // W7-B3 (library-21): locally-authored (forge-authoring provenance) is its
  // own honest badge, never COMMUNITY; a registry-only reference row says so.
  authored: { color: 'var(--c-agent, #60a5fa)', borderColor: 'rgba(96,165,250,.4)', background: 'rgba(96,165,250,.08)' },
  reference: { color: 'var(--faint)', borderColor: 'var(--line-2)', background: 'rgba(255,255,255,.03)' },
  draft: { color: 'var(--c-artifact, #fbbf24)', borderColor: 'rgba(251,191,36,.4)', background: 'rgba(251,191,36,.08)' },
  'needs-review': { color: '#f87171', borderColor: 'rgba(248,113,113,.4)', background: 'rgba(248,113,113,.08)' },
};

export default function SkillLibraryPage() {
  const [entries, setEntries] = useState<SkillLibraryEntry[]>([]);
  // Distinguishes "haven't loaded yet" / "loaded, bridge unreachable" /
  // "loaded, reachable" — a genuinely empty library must never render like a
  // dead bridge, and vice versa (house rule: no silent empty-list fallback).
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // null = not yet resolved (loading OR the community fetch failed) — either
  // way, cards render with no hub/signals rather than a guessed value. Kept
  // as the raw item list (not pre-keyed by id) — communityBadgeForSkill does
  // the actual (source, kind, id) join per card, never id alone.
  const [communityItems, setCommunityItems] = useState<readonly CommunityItem[] | null>(null);
  // The join's OWN readiness, independent of `data-page-ready` (which tracks
  // only the primary skills fetch — that fetch is deliberately not raced by
  // this one, so the list renders even if the community index is slow or
  // unreachable). Without this, "still loading" and "the join failed" and
  // "this skill has no hub" all rendered identically (data-skill-hub simply
  // absent in every case) — a fabricated-absent state automation cannot tell
  // apart. `pending` -> `ready`|`unavailable`, never back.
  const [communityJoinStatus, setCommunityJoinStatus] = useState<'pending' | 'ready' | 'unavailable'>('pending');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const r = await fetchSkillLibrary();
      if (cancelled) return;
      if (!r.ok) {
        setStatus('error');
        setError(r.error ?? 'could not reach the forge bridge');
        return;
      }
      setEntries(r.skills);
      setStatus('ready');
      setError(null);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadCommunity() {
      const r = await fetchCommunityIndex();
      if (cancelled) return;
      if (!r.ok) {
        setCommunityJoinStatus('unavailable'); // absence, not a fabricated join — the skill list itself is unaffected
        return;
      }
      setCommunityItems(r.items);
      setCommunityJoinStatus('ready');
    }
    void loadCommunity();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = filterSkills(entries, query);
  const grouped = groupSkillLibrary(filtered);

  return (
    <StudioPage
      dataPage="skill-library"
      ready={status !== 'loading'}
      data={{
        'data-community-join': communityJoinStatus,
        'data-skill-count': grouped.total,
        'data-local-count': grouped.localCount,
        'data-community-count': grouped.communityCount,
      }}
      title="Skills"
      lede={
        <>
          Reusable instruction packets an agent composes. Hand-authored skills are ready
          immediately; a skill installed from the community starts as a draft until you
          approve it.
        </>
      }
      actions={
        <>
          <Link href="/community" data-action="browse-community" className="btn" style={{ whiteSpace: 'nowrap' }}>
            Browse community
          </Link>
          <Link href="/skills/new" data-action="new-skill" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
            + New skill
          </Link>
        </>
      }
    >

        <input
          type="text"
          data-field="skill-search"
          placeholder="Search skills by name or description…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: '100%', maxWidth: 420, marginBottom: 24, background: 'var(--bg-2)',
            border: '1px solid var(--line)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text)',
            fontSize: 13, padding: '8px 11px', outline: 'none', boxSizing: 'border-box',
          }}
        />

        {status === 'loading' && (
          <div style={{ color: 'var(--dim)', fontSize: 13.5, padding: '24px 0' }}>Loading skills…</div>
        )}

        {status === 'error' && (
          <div
            data-component="fetch-error"
            style={{ color: '#f87171', fontSize: 13, padding: '14px 16px', border: '1px solid rgba(248,113,113,.35)', borderRadius: 'var(--radius-sm, 6px)', background: 'rgba(248,113,113,.06)' }}
          >
            Could not reach the forge bridge — skills are unavailable ({error}). This is NOT the
            same as an empty library; retry once the bridge is back up.
          </div>
        )}

        {status === 'ready' && grouped.total === 0 && (
          <div style={{ color: 'var(--faint)', fontSize: 13, fontStyle: 'italic', padding: '24px 0' }}>
            {query ? 'No skills match your search.' : 'No skills yet — author one, or check the community list.'}
          </div>
        )}

        {status === 'ready' && grouped.local.length > 0 && (
          <SkillSection title="Local" entries={grouped.local} communityItems={communityItems} />
        )}

        {status === 'ready' && grouped.community.length > 0 && (
          <SkillSection title="Community" entries={grouped.community} communityItems={communityItems} />
        )}
    </StudioPage>
  );
}

// ---------------------------------------------------------------------------
// SkillSection — a labelled grid of skill cards (local or community)
// ---------------------------------------------------------------------------

function SkillSection({
  title,
  entries,
  communityItems,
}: {
  title: string;
  entries: SkillLibraryEntry[];
  communityItems: readonly CommunityItem[] | null;
}) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>
        {title} <span style={{ color: 'var(--faint)', fontWeight: 500 }}>({entries.length})</span>
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        {entries.map((entry) => (
          <SkillCard key={entry.id} entry={entry} community={communityItems === null ? null : communityBadgeForSkill(entry, communityItems)} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// SkillCard
// ---------------------------------------------------------------------------

function SkillCard({ entry, community }: { entry: SkillLibraryEntry; community: CommunityItem | null }) {
  const badges = skillBadges(entry);
  const usedByCount = entry.usedBy.length;

  return (
    <Link
      href={`/skills/${encodeURIComponent(entry.id)}`}
      className="lib-card"
      data-card-type="skill"
      data-skill-id={entry.id}
      data-skill-source={entry.source}
      data-skill-trust={entry.trust}
      data-skill-installed={entry.installed ? 'true' : 'false'}
      data-skill-used-by-count={usedByCount}
      data-skill-hub={community?.hub?.id}
      data-skill-has-signals={community ? (community.signals !== null ? 'true' : 'false') : undefined}
      style={{ display: 'block' }}
    >
      <div className="card-top">
        <span className="card-name">{entry.name || entry.id}</span>
        {badges.map((b) => (
          <span key={b} className="badge" style={BADGE_STYLE[b]}>{b}</span>
        ))}
      </div>
      <p className="card-body">{entry.description || 'No description.'}</p>
      {entry.error && (
        <p style={{ fontSize: 11.5, color: '#f87171', margin: '0 0 6px' }}>{entry.error}</p>
      )}
      <div className="card-meta">
        <span className="card-stat">{usedByCount} agent{usedByCount === 1 ? '' : 's'}</span>
        {!entry.paletteVisible && (
          <span className="badge badge-dim" title="Not palette-visible — an agent cannot compose this skill yet">
            hidden from palette
          </span>
        )}
      </div>
      {community && (
        <div className="card-meta">
          <span className="card-stat">{hubLabel(community.hub)}</span>
          <span className="card-stat">{signalsLabel(community.signals)}</span>
        </div>
      )}
    </Link>
  );
}
