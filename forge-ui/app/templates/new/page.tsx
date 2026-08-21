'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { StudioPage } from '@/components/StudioPage';
import { createTemplate } from '@/lib/template-client';

// ---------------------------------------------------------------------------
// Template builder — /templates/new (W7-B4, library-17/library-01). A
// planning template (studio/artifact-templates/<id>.md) or demo element
// (studio/demo-elements/<id>.md) is ONE markdown file with frontmatter, so
// the builder is: category + id + the raw content, seeded with a valid
// scaffold per category. Validation is server-side by the REAL category
// loader — the same enforcement `forge studio lint` runs.
// ---------------------------------------------------------------------------

type WritableCategory = 'planning' | 'demo-output';

const CATEGORY_LABEL: Record<WritableCategory, string> = {
  planning: 'Planning (studio/artifact-templates)',
  'demo-output': 'Demo output (studio/demo-elements)',
};

function seedContent(category: WritableCategory, id: string): string {
  const safeId = id || 'my-template';
  if (category === 'planning') {
    return [
      '---',
      `id: ${safeId}`,
      `name: ${safeId}`,
      'kind: file',
      'schema:',
      '  requiredFiles: []',
      '  requiredFields: []',
      '  gitInvariants: []',
      '---',
      '',
      'Describe the artifact this template defines — what the producer writes',
      'and what the consumer needs to find in it.',
      '',
    ].join('\n');
  }
  return [
    '---',
    `id: ${safeId}`,
    `name: ${safeId}`,
    'phase: present',
    'description: What this demo element captures and why it is convincing.',
    '---',
    '',
    'Describe how the demo agent should produce this element.',
    '',
  ].join('\n');
}

export default function TemplateBuilderPage() {
  const router = useRouter();
  const [category, setCategory] = useState<WritableCategory>('planning');
  const [id, setId] = useState('');
  const [content, setContent] = useState('');
  const [contentTouched, setContentTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugOk = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id);
  const canSubmit = slugOk && (contentTouched ? content.trim().length > 0 : true);
  const effectiveContent = contentTouched ? content : seedContent(category, id);

  async function onSubmit() {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);
    const r = await createTemplate({ category, id, content: effectiveContent });
    if (r.ok) {
      router.push(`/templates/${encodeURIComponent(id)}`);
    } else {
      setError(r.error ?? 'could not create the template');
      setSaving(false);
    }
  }

  const labelStyle: React.CSSProperties = { fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--dim)', display: 'block', marginBottom: 5 };
  const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 13, padding: '8px 11px', boxSizing: 'border-box' };

  return (
    <StudioPage
      dataPage="template-builder"
      ready
      section="template-new"
      maxWidth={720}
      padding="40px 28px 64px"
      title="New template"
      lede={
        <>
          A template is one markdown definition file — a planning artifact template or a demo
          output element. Pick the category, name it, and edit the seeded definition. Project
          scaffolds stay repo-curated (they are whole directory trees, not single files).
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <label style={labelStyle} htmlFor="tpl-category">Category</label>
          <select
            id="tpl-category"
            data-field="template-category"
            style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}
            value={category}
            onChange={(e) => setCategory(e.target.value as WritableCategory)}
          >
            {(Object.keys(CATEGORY_LABEL) as WritableCategory[]).map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle} htmlFor="tpl-id">Id</label>
          <input
            id="tpl-id"
            data-field="template-id"
            style={inputStyle}
            value={id}
            placeholder="lowercase-kebab, e.g. release-notes"
            onChange={(e) => setId(e.target.value.trim())}
          />
          {id && !slugOk && (
            <div style={{ fontSize: 11, color: 'var(--amber, #fbbf24)', marginTop: 4 }}>
              must be a single lowercase-kebab segment (a-z, 0-9, hyphens)
            </div>
          )}
        </div>
        <div>
          <label style={labelStyle} htmlFor="tpl-content">Definition ({category === 'planning' ? 'artifact template' : 'demo element'} markdown)</label>
          <textarea
            id="tpl-content"
            data-field="template-content"
            rows={16}
            spellCheck={false}
            style={{ ...inputStyle, fontFamily: 'var(--font-mono, monospace)', fontSize: 12.5, lineHeight: 1.6, resize: 'vertical' }}
            value={effectiveContent}
            onChange={(e) => { setContent(e.target.value); setContentTouched(true); }}
          />
          <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>
            The frontmatter id must equal the id above; the server validates with the real
            category loader before anything is written.
          </div>
        </div>
        {error && <div data-component="template-create-error" style={{ fontSize: 12.5, color: '#f87171' }}>{error}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className="btn btn-primary"
            data-action="create-template"
            onClick={() => void onSubmit()}
            disabled={!canSubmit || saving}
            style={{ opacity: canSubmit && !saving ? 1 : 0.5 }}
          >
            {saving ? 'Creating…' : 'Create template →'}
          </button>
          {!slugOk && <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>A valid id is required.</span>}
        </div>
      </div>
    </StudioPage>
  );
}
