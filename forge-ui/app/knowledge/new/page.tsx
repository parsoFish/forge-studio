'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { StudioNav } from '@/components/StudioNav';
import { createKb } from '@/lib/studio-client';

// ---------------------------------------------------------------------------
// New knowledge base — minimal create form (ADR-033 / J6).
// Required: name + scope. Description optional. Mirrors the project-onboard
// pattern (only required fields up front).
// ---------------------------------------------------------------------------

const SCOPES = [
  { id: 'project', label: 'Project — knowledge for one project' },
  { id: 'flow', label: 'Flow — cross-cycle patterns for a flow' },
  { id: 'agent-integration', label: 'Agent integration — shared agent knowledge' },
];

export default function NewKbPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [scope, setScope] = useState('project');
  const [desc, setDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const canSubmit = name.trim().length > 0;

  async function onSubmit() {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);
    const result = await createKb({ id: slug, name: name.trim(), scope, desc: desc.trim() });
    if (result.ok) {
      router.push('/knowledge');
    } else {
      setError(result.error ?? 'could not create the knowledge base');
      setSaving(false);
    }
  }

  const labelStyle: React.CSSProperties = { fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--dim)', display: 'block', marginBottom: 5 };
  const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 13, padding: '8px 11px', outline: 'none', boxSizing: 'border-box' };

  return (
    <main data-page="knowledge-new" data-page-ready="true" style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <StudioNav />
      <div data-section="kb-new" style={{ maxWidth: 600, margin: '0 auto', padding: '40px 28px 64px', width: '100%' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>
          New knowledge base
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--dim)', lineHeight: 1.6, margin: '0 0 24px' }}>
          A knowledge base is where a flow&apos;s learning compounds across cycles. Give it a name and a
          scope to begin.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={labelStyle} htmlFor="kb-name">Name</label>
            <input id="kb-name" data-field="kb-name" style={inputStyle} value={name} placeholder="My knowledge base"
              onChange={(e) => setName(e.target.value)} />
            {slug && <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>id: {slug}</div>}
          </div>
          <div>
            <label style={labelStyle} htmlFor="kb-scope">Scope</label>
            <select id="kb-scope" data-field="kb-scope" style={inputStyle} value={scope} onChange={(e) => setScope(e.target.value)}>
              {SCOPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="kb-desc">Description</label>
            <textarea id="kb-desc" data-field="kb-desc" rows={2} style={inputStyle} value={desc}
              placeholder="What this knowledge base is for (optional)" onChange={(e) => setDesc(e.target.value)} />
          </div>
          {error && <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{error}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn btn-primary" data-action="create-kb" onClick={() => void onSubmit()}
              disabled={!canSubmit || saving} style={{ opacity: canSubmit && !saving ? 1 : 0.5 }}>
              {saving ? 'Creating…' : 'Create knowledge base →'}
            </button>
            {!canSubmit && <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>A name is required.</span>}
          </div>
        </div>
      </div>
    </main>
  );
}
