'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createGreenfieldProject, type ProjectStarter } from '@/lib/studio-client';

// ---------------------------------------------------------------------------
// CreateFromTemplate (R4-03) — the greenfield creation interview: name, north
// star, and a curated app-type template → scaffolds a project whose contract the
// starter filled as far as it honestly can (ruling 169 — the project page COUNTS what creation left open; POST /api/studio/projects/create).
// `forge-8vfn.7.6.29` — extracted verbatim out of `app/projects/[id]/page.tsx`
// (a whole concern, not a line-count trim) to pay back the 7.6.27 ratchet bump.
// ---------------------------------------------------------------------------

export function CreateFromTemplate({ appTypes }: { appTypes: ProjectStarter[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [northStar, setNorthStar] = useState('');
  const [appTypePicked, setAppTypePicked] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The default selection is DERIVED from the roster the root fetched, not
  // copied into state by an effect that could run before it arrives.
  const appType = appTypePicked ?? appTypes[0]?.id ?? '';

  const canSubmit = name.trim().length > 0 && northStar.trim().length > 0 && appType.length > 0;

  const onCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const r = await createGreenfieldProject({ name: name.trim(), appType, northStar: northStar.trim() });
      if (r.ok && r.id) router.push(`/projects/${encodeURIComponent(r.id)}`);
      else setError(r.error ?? 'create failed');
    } finally {
      setCreating(false);
    }
  };

  const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--dim)', margin: '10px 0 4px' } as const;
  const inputStyle = { width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 'var(--radius)', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--fg)' } as const;

  return (
    <div data-section="project-create" data-app-type-count={appTypes.length} style={{ maxWidth: 640, margin: '0 auto 64px', padding: '0 28px', width: '100%' }}>
      <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '20px 22px' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Or create a new project</h2>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
          Scaffold a greenfield repo from a framework template — the starter fills every contract element it can, and an agent generates the demo of this particular project afterwards.
        </p>
        <label style={labelStyle} htmlFor="create-name">Project name</label>
        <input id="create-name" data-field="create-name" style={inputStyle} value={name} placeholder="My new tool" onChange={(e) => setName(e.target.value)} />
        <label style={labelStyle} htmlFor="create-northstar">North star</label>
        <input id="create-northstar" data-field="create-north-star" style={inputStyle} value={northStar} placeholder="One sentence: what it's for" onChange={(e) => setNorthStar(e.target.value)} />
        <label style={labelStyle} htmlFor="create-apptype">App type</label>
        <select id="create-apptype" data-field="create-app-type" style={inputStyle} value={appType} onChange={(e) => setAppTypePicked(e.target.value)}>
          {appTypes.length === 0 && <option value="">(no templates found)</option>}
          {appTypes.map((t) => <option key={t.id} value={t.id}>{t.language === null ? t.label : `${t.label} — ${t.language}`}</option>)}
        </select>
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className="btn btn-primary"
            data-action="create-project"
            disabled={!canSubmit || creating}
            {...(!canSubmit ? { 'data-disabled-reason': 'Name, north star, and app type are required.', title: 'Name, north star, and app type are required.' } : {})}
            onClick={() => void onCreate()}
          >
            {creating ? 'Creating…' : 'Create project'}
          </button>
          {/* W7-B6 (crosscut-25): the disabled CTA explains itself, like the
              onboard form beside it already did. */}
          {!canSubmit && <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>Name, north star, and app type are required.</span>}
        </div>
        {error && <p className="save-hint save-hint-dirty" style={{ marginTop: 8 }}>{error}</p>}
      </div>
    </div>
  );
}
