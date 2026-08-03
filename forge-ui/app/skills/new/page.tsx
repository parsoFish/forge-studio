'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { StudioNav } from '@/components/StudioNav';
import { createSkill } from '@/lib/studio-client';

// ---------------------------------------------------------------------------
// Skill builder (P2) — author a plain composable skill in-platform. Minimal:
// name + description + instructions. Writes skills/<slug>/SKILL.md; the skill
// can then be composed into agents.
// ---------------------------------------------------------------------------

export default function SkillBuilderPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const canSubmit = name.trim().length > 0 && description.trim().length > 0;

  async function onSubmit() {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);
    const r = await createSkill({ name: name.trim(), description: description.trim(), body: body.trim() });
    if (r.ok) {
      router.push('/agents/new');
    } else {
      setError(r.error ?? 'could not create the skill');
      setSaving(false);
    }
  }

  const labelStyle: React.CSSProperties = { fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--dim)', display: 'block', marginBottom: 5 };
  const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 13, padding: '8px 11px', outline: 'none', boxSizing: 'border-box' };

  return (
    <main data-page="skill-builder" data-page-ready="true" style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <StudioNav />
      <div data-section="skill-new" style={{ maxWidth: 620, margin: '0 auto', padding: '40px 28px 64px', width: '100%' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>
          New skill
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--dim)', lineHeight: 1.6, margin: '0 0 24px' }}>
          A skill is a reusable instruction packet you can compose into agents. Give it a name, a
          one-line description, and the instructions it carries.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={labelStyle} htmlFor="sk-name">Name</label>
            <input id="sk-name" data-field="skill-name" style={inputStyle} value={name} placeholder="e.g. API contract review"
              onChange={(e) => setName(e.target.value)} />
            {slug && <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>id: {slug}</div>}
          </div>
          <div>
            <label style={labelStyle} htmlFor="sk-desc">Description</label>
            <input id="sk-desc" data-field="skill-description" style={inputStyle} value={description}
              placeholder="One line — what this skill does + when to use it" onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="sk-body">Instructions</label>
            <textarea id="sk-body" data-field="skill-body" rows={8} style={inputStyle} value={body}
              placeholder="The step-by-step instructions this skill provides to an agent…" onChange={(e) => setBody(e.target.value)} />
          </div>
          {error && <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{error}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn btn-primary" data-action="create-skill" onClick={() => void onSubmit()}
              disabled={!canSubmit || saving} style={{ opacity: canSubmit && !saving ? 1 : 0.5 }}>
              {saving ? 'Creating…' : 'Create skill →'}
            </button>
            {!canSubmit && <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>Name + description are required.</span>}
          </div>
        </div>
      </div>
    </main>
  );
}
