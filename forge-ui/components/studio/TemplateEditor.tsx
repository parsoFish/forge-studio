'use client';

// ---------------------------------------------------------------------------
// TemplateEditor — W7-B4 (library-17). The single-file template editor: a
// planning template (studio/artifact-templates/<id>.md) or demo element
// (studio/demo-elements/<id>.md) IS one markdown file with frontmatter, so
// the honest editor is the raw content. Validation is server-side by the
// REAL category loader; an invalid save leaves the file untouched and the
// loader's own message renders here verbatim.
//
// Pure + props-driven (renderToStaticMarkup-testable); the page owns fetch.
// ---------------------------------------------------------------------------

export function TemplateEditor({
  content,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
}: {
  content: string;
  onChange: (next: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <div data-component="template-editor" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <textarea
        data-field="template-content"
        value={content}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        rows={Math.min(32, Math.max(12, content.split('\n').length + 2))}
        style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 12.5,
          lineHeight: 1.6,
          padding: '12px 14px',
          background: 'var(--bg-2)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-sm, 6px)',
          color: 'var(--text)',
          resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" className="btn btn-primary btn-sm" data-action="save-template" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save template'}
        </button>
        <button type="button" className="btn btn-sm" data-action="cancel-template-edit" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        {error && (
          <span data-component="template-save-error" style={{ fontSize: 12, color: '#f87171' }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
