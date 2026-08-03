'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StudioNav } from '@/components/StudioNav';
import {
  fetchSkillLibrary,
  installSkill,
  type SkillLibraryEntry,
} from '@/lib/studio-client';
import {
  groupSkillLibrary,
  skillBadges,
  filterSkills,
  installStateOf,
} from '@/lib/skill-library-view';

// ---------------------------------------------------------------------------
// Skills library — /skills (R3-01-F3/F4, WI-3, D8: the ONE place "New skill"
// lives). Lists every plain composable skill (local, hand-authored or
// installed-from-community) plus every catalog community skill not yet
// installed. Studio agents (SKILL.md WITH a runtime: block) are NOT skills —
// they live under /agents.
// ---------------------------------------------------------------------------

const BADGE_STYLE: Record<string, React.CSSProperties> = {
  community: { color: 'var(--c-kb, #4ade80)', borderColor: 'rgba(74,222,128,.4)', background: 'rgba(74,222,128,.08)' },
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
  const [installState, setInstallState] = useState<Record<string, 'none' | 'installing' | 'installed'>>({});
  const [installDirs, setInstallDirs] = useState<Record<string, string>>({});
  const [installError, setInstallError] = useState<Record<string, string>>({});

  async function load(): Promise<void> {
    const r = await fetchSkillLibrary();
    if (!r.ok) {
      setStatus('error');
      setError(r.error ?? 'could not reach the forge bridge');
      return;
    }
    setEntries(r.skills);
    setStatus('ready');
    setError(null);
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleInstall(id: string): Promise<void> {
    const packageDir = (installDirs[id] ?? '').trim();
    if (!packageDir) {
      setInstallError((s) => ({ ...s, [id]: 'a local package directory is required' }));
      return;
    }
    setInstallState((s) => ({ ...s, [id]: 'installing' }));
    setInstallError((s) => { const { [id]: _drop, ...rest } = s; return rest; });
    const r = await installSkill({ id, packageDir, upstream: { source: packageDir } });
    if (!r.ok) {
      setInstallState((s) => ({ ...s, [id]: 'none' }));
      setInstallError((s) => ({ ...s, [id]: r.error ?? 'install failed' }));
      return;
    }
    setInstallState((s) => ({ ...s, [id]: 'installed' }));
    void load(); // refresh so the installed draft's real trust/badges land
  }

  const filtered = filterSkills(entries, query);
  const grouped = groupSkillLibrary(filtered);

  return (
    <main
      data-page="skill-library"
      data-page-ready={status !== 'loading' ? 'true' : 'false'}
      data-skill-count={grouped.total}
      data-local-count={grouped.localCount}
      data-community-count={grouped.communityCount}
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}
    >
      <StudioNav />
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 28px 64px', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>
              Skills
            </h1>
            <p style={{ fontSize: 13.5, color: 'var(--dim)', margin: 0, maxWidth: 560, lineHeight: 1.6 }}>
              Reusable instruction packets an agent composes. Hand-authored skills are ready
              immediately; a skill installed from the community starts as a draft until you
              approve it.
            </p>
          </div>
          <Link href="/skills/new" data-action="new-skill" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
            + New skill
          </Link>
        </div>

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
          <SkillSection
            title="Local"
            entries={grouped.local}
            installState={installState}
            installDirs={installDirs}
            installError={installError}
            onInstallDirChange={(id, v) => setInstallDirs((s) => ({ ...s, [id]: v }))}
            onInstall={handleInstall}
          />
        )}

        {status === 'ready' && grouped.community.length > 0 && (
          <SkillSection
            title="Community"
            entries={grouped.community}
            installState={installState}
            installDirs={installDirs}
            installError={installError}
            onInstallDirChange={(id, v) => setInstallDirs((s) => ({ ...s, [id]: v }))}
            onInstall={handleInstall}
          />
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// SkillSection — a labelled grid of skill cards (local or community)
// ---------------------------------------------------------------------------

function SkillSection({
  title,
  entries,
  installState,
  installDirs,
  installError,
  onInstallDirChange,
  onInstall,
}: {
  title: string;
  entries: SkillLibraryEntry[];
  installState: Record<string, 'none' | 'installing' | 'installed'>;
  installDirs: Record<string, string>;
  installError: Record<string, string>;
  onInstallDirChange: (id: string, value: string) => void;
  onInstall: (id: string) => void;
}) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>
        {title} <span style={{ color: 'var(--faint)', fontWeight: 500 }}>({entries.length})</span>
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        {entries.map((entry) => (
          <SkillCard
            key={entry.id}
            entry={entry}
            installState={installState[entry.id] ?? (entry.installed ? 'installed' : 'none')}
            installDir={installDirs[entry.id] ?? ''}
            installErr={installError[entry.id]}
            onInstallDirChange={(v) => onInstallDirChange(entry.id, v)}
            onInstall={() => onInstall(entry.id)}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// SkillCard
// ---------------------------------------------------------------------------

function SkillCard({
  entry,
  installState,
  installDir,
  installErr,
  onInstallDirChange,
  onInstall,
}: {
  entry: SkillLibraryEntry;
  installState: 'none' | 'installing' | 'installed';
  installDir: string;
  installErr?: string;
  onInstallDirChange: (value: string) => void;
  onInstall: () => void;
}) {
  const badges = skillBadges(entry);
  const usedByCount = entry.usedBy.length;
  // A community entry that isn't installed has no on-disk package yet — the
  // detail route 404s for it, and the detail page renders that as an
  // explicit "not installed" state (not a crash, not an invented preview).
  // The card still links there; the manual-install affordance below is
  // additional, not a replacement for that link.
  const notInstalled = !entry.installed;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Link
        href={`/skills/${encodeURIComponent(entry.id)}`}
        className="lib-card"
        data-card-type="skill"
        data-skill-id={entry.id}
        data-skill-source={entry.source}
        data-skill-trust={entry.trust}
        data-skill-installed={entry.installed ? 'true' : 'false'}
        data-skill-used-by-count={usedByCount}
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
      </Link>

      {notInstalled && (
        // D2: this initiative consumes an already-materialised local
        // directory only — no hub fetch, no fabricated "vendored upstream"
        // content. A real hub browser + fetch is R3-07's job.
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 2px' }}>
          <input
            type="text"
            placeholder="local package directory to install from…"
            value={installDir}
            onChange={(e) => onInstallDirChange(e.target.value)}
            disabled={installState !== 'none'}
            style={{ fontSize: 11.5, padding: '5px 8px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 4, color: 'var(--text)' }}
          />
          <button
            type="button"
            className="btn"
            data-action="install-skill"
            data-install-skill-id={entry.id}
            data-install-state={installState}
            disabled={installState === 'installing'}
            onClick={onInstall}
            style={{ fontSize: 11.5, padding: '5px 10px', alignSelf: 'flex-start' }}
          >
            {installState === 'installing' ? 'Installing…' : installState === 'installed' ? 'Installed ✓' : 'Install'}
          </button>
          {installErr && <span style={{ fontSize: 11, color: '#f87171' }}>{installErr}</span>}
        </div>
      )}
    </div>
  );
}
