'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { StudioNav } from '@/components/StudioNav';
import { NotFound } from '@/components/NotFound';
import { FilePackage } from '@/components/studio/FilePackage';
import { LibraryItemActions } from '@/components/studio/LibraryItemActions';
import { TemplateEditor } from '@/components/studio/TemplateEditor';
import {
  fetchTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  type TemplateDetail,
} from '@/lib/template-client';
import { templateBadges, previewClassFor } from '@/lib/template-library-view';

// ---------------------------------------------------------------------------
// Template detail — /templates/[id] (R3-06, WI-4)
//
// Four distinct outcomes, never conflated (house rule: no silent fallback):
//   - 'ready'     — the template exists in the registry; full package + scan.
//   - 'not-found' — no such id in the registry (the bridge 404s for it).
//   - 'error'     — the bridge itself could not be reached / errored.
// ---------------------------------------------------------------------------

type PageState = 'loading' | 'ready' | 'not-found' | 'error';

const CATEGORY_LABEL: Record<TemplateDetail['category'], string> = {
  'demo-output': 'Demo output',
  planning: 'Planning',
  'project-scaffold': 'Project scaffold',
};

const BADGE_STYLE: Record<string, React.CSSProperties> = {
  unverified: { color: 'var(--amber, #fbbf24)', borderColor: 'rgba(251,191,36,.4)', background: 'rgba(251,191,36,.08)' },
  error: { color: '#f87171', borderColor: 'rgba(248,113,113,.4)', background: 'rgba(248,113,113,.08)' },
};

export default function TemplateDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = (params?.id as string) ?? '';

  const [state, setState] = useState<PageState>('loading');
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // W7-B4 (library-17): edit / duplicate / delete state. Only the two
  // single-file categories are writable; scaffolds render the reason.
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  const load = useCallback(async (templateId: string) => {
    setState('loading');
    const r = await fetchTemplate(templateId);

    if (r.ok && r.detail) {
      setDetail(r.detail);
      setState('ready');
      return;
    }

    setDetail(null);
    if (r.status === 404) {
      setState('not-found');
      return;
    }
    setError(r.error ?? 'could not load this template');
    setState('error');
  }, []);

  useEffect(() => {
    if (id) void load(id);
  }, [id, load]);

  // ---- W7-B4 (library-17): authoring actions -----------------------------

  const writable = detail !== null && detail.category !== 'project-scaffold';

  function toggleEdit() {
    if (!editing && detail) {
      setEditContent(detail.files[0]?.body ?? '');
      setActionError(null);
    }
    setEditing((v) => !v);
  }

  async function handleSaveEdit() {
    setSavingEdit(true);
    setActionError(null);
    const r = await updateTemplate(id, editContent);
    setSavingEdit(false);
    if (!r.ok) {
      setActionError(r.error ?? 'save failed');
      return;
    }
    setEditing(false);
    void load(id);
  }

  async function handleDelete() {
    setDeleting(true);
    setActionError(null);
    const r = await deleteTemplate(id);
    setDeleting(false);
    if (!r.ok) {
      setActionError(r.error ?? 'delete failed');
      return;
    }
    router.push('/templates');
  }

  async function handleDuplicate() {
    if (!detail || detail.category === 'project-scaffold') return;
    const suggested = `${id}-copy`;
    const newId = window.prompt('Id for the duplicate (lowercase-kebab):', suggested);
    if (!newId) return;
    setDuplicating(true);
    setActionError(null);
    const r = await createTemplate({ category: detail.category, id: newId.trim(), duplicateOf: id });
    setDuplicating(false);
    if (!r.ok) {
      setActionError(r.error ?? 'duplicate failed');
      return;
    }
    router.push(`/templates/${encodeURIComponent(newId.trim())}`);
  }

  const categoryAttr = state === 'ready' ? detail!.category : undefined;
  const endpointsVerifiedAttr =
    state === 'ready' && detail!.endpointsVerified !== undefined
      ? (detail!.endpointsVerified ? 'true' : 'false')
      : undefined;

  // W7-A4 (crosscut-27): unknown id → the ONE shared not-found treatment.
  if (state === 'not-found') {
    return <NotFound kind="template" id={id} backHref="/templates" backLabel="Templates" />;
  }

  return (
    <main
      data-page="template-detail"
      data-template-id={id}
      {...(categoryAttr ? { 'data-template-category': categoryAttr } : {})}
      {...(endpointsVerifiedAttr ? { 'data-endpoints-verified': endpointsVerifiedAttr } : {})}
      data-page-ready={state !== 'loading' ? 'true' : 'false'}
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}
    >
      <StudioNav />
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 28px 64px', width: '100%' }}>
        <Link href="/templates" style={{ fontSize: 12, color: 'var(--dim)', textDecoration: 'none' }}>&larr; Templates</Link>

        {state === 'loading' && (
          <div style={{ color: 'var(--dim)', fontSize: 13.5, padding: '24px 0' }}>Loading…</div>
        )}

        {state === 'error' && (
          <div
            data-component="fetch-error"
            style={{ marginTop: 16, color: '#f87171', fontSize: 13, padding: '14px 16px', border: '1px solid rgba(248,113,113,.35)', borderRadius: 'var(--radius-sm, 6px)', background: 'rgba(248,113,113,.06)' }}
          >
            Could not reach the forge bridge ({error}).
          </div>
        )}

        {state === 'ready' && detail && (
          <>
            {/* W7-B4 (library-17): templates gain create/edit/duplicate/
                delete. Scaffolds are whole directory trees — read-only,
                WITH the reason shown, never a silently-absent affordance. */}
            <div style={{ marginTop: 16 }}>
              {writable ? (
                <LibraryItemActions
                  kind="template"
                  id={id}
                  editing={editing}
                  onToggleEdit={toggleEdit}
                  onDelete={() => void handleDelete()}
                  deleting={deleting}
                  deleteBlockReason={
                    detail.usedBy.length > 0
                      ? `still used by: ${detail.usedBy.join(', ')} — detach those first`
                      : null
                  }
                  error={actionError}
                  extra={
                    <button
                      type="button"
                      className="btn btn-sm"
                      data-action="duplicate-template"
                      onClick={() => void handleDuplicate()}
                      disabled={duplicating}
                    >
                      {duplicating ? 'Duplicating…' : 'Duplicate'}
                    </button>
                  }
                />
              ) : (
                <p data-component="template-readonly" style={{ fontSize: 12.5, color: 'var(--faint)', fontStyle: 'italic', margin: 0 }}>
                  Project scaffolds are whole directory trees curated in the repo
                  (studio/starters/projects) — not editable as a single file from Studio.
                </p>
              )}
            </div>
            {editing && writable && (
              <div style={{ marginTop: 14 }}>
                <TemplateEditor
                  content={editContent}
                  onChange={setEditContent}
                  onSave={() => void handleSaveEdit()}
                  onCancel={toggleEdit}
                  saving={savingEdit}
                  error={actionError}
                />
              </div>
            )}
            <TemplateDetailBody detail={detail} />
          </>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// TemplateDetailBody
// ---------------------------------------------------------------------------

function TemplateDetailBody({ detail }: { detail: TemplateDetail }) {
  const badges = templateBadges(detail);
  const usedBy = detail.usedBy;
  const usedByLabel = usedBy.length > 0
    ? null
    : `scanned ${detail.usedByDerivation.scanned}, none found`;

  // Planning-only, and only when something was actually declared — the
  // server (and template-client's parse) leaves `endpointsVerified`
  // undefined whenever neither declaredProducer nor declaredConsumer is
  // present, so its presence alone is the gate (no separate category check
  // needed, but the section is planning-only by construction anyway).
  const hasDeclaredEndpoints = detail.declaredProducer !== undefined || detail.declaredConsumer !== undefined;

  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
            {detail.name}
          </h1>
          <span className="badge badge-dim">{CATEGORY_LABEL[detail.category]}</span>
          {badges.map((b) => (
            <span key={b} className="badge" style={BADGE_STYLE[b]}>{b}</span>
          ))}
        </div>
        {detail.description && (
          <p style={{ fontSize: 13.5, color: 'var(--dim)', margin: 0, maxWidth: 560, lineHeight: 1.6 }}>
            {detail.description}
          </p>
        )}
      </div>

      {detail.error && (
        <section
          data-section="parse-error"
          style={{ fontSize: 13, color: '#f87171', padding: '12px 16px', border: '1px solid rgba(248,113,113,.35)', borderRadius: 'var(--radius-sm, 6px)', background: 'rgba(248,113,113,.06)' }}
        >
          {detail.error}
        </section>
      )}

      {detail.previewKind && (
        <section>
          <SectionLabel>Preview</SectionLabel>
          <div
            className={`tpl-preview tpl-preview-lg ${previewClassFor(detail.previewKind)}`}
            data-template-preview={detail.previewKind}
            aria-hidden="true"
            style={{ maxWidth: 320 }}
          >
            <span className="tpl-preview-glyph" />
          </div>
        </section>
      )}

      <section data-section="definition">
        <SectionLabel>Definition</SectionLabel>
        <dl className="kv" style={{ fontSize: 12.5 }}>
          {detail.format && (<><dt>format</dt><dd>{detail.format}</dd></>)}
          <dt>provenance</dt>
          <dd>{detail.provenance}</dd>
          <dt>definition ref</dt>
          <dd style={{ fontFamily: 'var(--font-mono, monospace)' }}>{detail.definitionRef}</dd>
        </dl>
      </section>

      {hasDeclaredEndpoints && (
        <section
          data-section="endpoints"
          style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius, 8px)', padding: '14px 16px' }}
        >
          <SectionLabel>Producer / consumer</SectionLabel>
          {detail.endpointsVerified === true ? (
            <p style={{ fontSize: 12, color: 'var(--faint)', margin: '0 0 10px', fontStyle: 'italic' }}>
              Verified against the real flow graph.
            </p>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--amber, #fbbf24)', margin: '0 0 10px', fontStyle: 'italic' }}>
              Declared, but unverifiable — this template carries zero flow edges, so the claim
              below could not be cross-checked against the flow graph.
            </p>
          )}
          <dl className="kv" style={{ fontSize: 12.5 }}>
            {detail.declaredProducer !== undefined && (
              <>
                <dt>producer</dt>
                <dd>
                  {detail.declaredProducer}
                  {detail.endpointsVerified === false && (
                    <span style={{ marginLeft: 6, color: 'var(--faint)', fontStyle: 'italic' }}>(declared, unverifiable)</span>
                  )}
                </dd>
              </>
            )}
            {detail.declaredConsumer !== undefined && (
              <>
                <dt>consumer</dt>
                <dd>
                  {detail.declaredConsumer}
                  {detail.endpointsVerified === false && (
                    <span style={{ marginLeft: 6, color: 'var(--faint)', fontStyle: 'italic' }}>(declared, unverifiable)</span>
                  )}
                </dd>
              </>
            )}
          </dl>
        </section>
      )}

      <section data-section="used-by" data-used-by-count={usedBy.length}>
        <SectionLabel>Used by</SectionLabel>
        <p style={{ fontSize: 11, color: 'var(--faint)', margin: '0 0 8px', fontStyle: 'italic' }}>
          Scanned from {detail.usedByDerivation.source}.
        </p>
        {usedByLabel ? (
          <p style={{ fontSize: 13, color: 'var(--faint)', fontStyle: 'italic', margin: 0 }}>
            {usedByLabel}
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {usedBy.map((label) => (
              <span key={label} data-used-by-entry={label} className="badge badge-dim">
                {label}
              </span>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionLabel>Package</SectionLabel>
        <FilePackage files={detail.files} />
      </section>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>
      {children}
    </h2>
  );
}
