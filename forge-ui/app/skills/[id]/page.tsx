'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { StudioNav } from '@/components/StudioNav';
import { NotFound } from '@/components/NotFound';
import { FetchErrorState } from '@/components/FetchErrorState';
import { FilePackage } from '@/components/studio/FilePackage';
import { LibraryItemActions } from '@/components/studio/LibraryItemActions';
import { SkillDetailBody } from '@/components/studio/SkillDetailBody';
import {
  fetchSkill,
  fetchSkillLibrary,
  approveSkill,
  updateSkill,
  deleteSkill,
  type SkillDetail,
  type SkillLibraryEntry,
} from '@/lib/skill-client';
import { MAIN_CONTENT_ID } from '@/lib/main-landmark';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { useDocumentTitle } from '@/lib/document-title';
import { disabledAttrs } from '@/lib/disabled-reason';

/** Strip the leading YAML frontmatter block from a SKILL.md's raw bytes —
 *  the edit form edits the CONTENT; name/description are their own fields
 *  and the server owns re-assembling the frontmatter. */
function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/^\n+/, '');
}

// ---------------------------------------------------------------------------
// Skill detail — /skills/[id] (R3-01-F3/F4, WI-3)
//
// Three distinct outcomes, never conflated (house rule: no silent fallback):
//   - 'ready'        — the skill exists on disk; full package + trust + scan.
//   - 'not-installed'— a catalog community skill with no on-disk package yet
//                       (the bridge 404s for it by design — D2, no fabricated
//                       preview).
//   - 'not-found'     — no such id anywhere (neither on disk nor in the catalog).
//   - 'error'         — the bridge itself could not be reached / errored.
// ---------------------------------------------------------------------------

type PageState = 'loading' | 'ready' | 'not-installed' | 'not-found' | 'error';

export default function SkillDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = (params?.id as string) ?? '';

  const [state, setState] = useState<PageState>('loading');
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [libraryEntry, setLibraryEntry] = useState<SkillLibraryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  // W7-A1 (library-13): the HTTP status when the bridge ANSWERED (a 400
  // "invalid skill id" is a refusal, not an outage) — undefined when it was
  // never reached. Drives FetchErrorState's framing.
  const [errorStatus, setErrorStatus] = useState<number | undefined>(undefined);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  // W7-B4 (library-05): edit / delete state.
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editBody, setEditBody] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (skillId: string) => {
    setState('loading');
    setApproveError(null);
    // W7-A4 (crosscut-10 / library-03): the roster is consulted FIRST — a
    // community-only (not-installed) skill has no on-disk package, so the
    // detail route is not fetched for it (no 404 spam); the page renders the
    // roster's own metadata + the community link instead.
    const libraryResult = await fetchSkillLibrary();
    const entry = libraryResult.ok ? libraryResult.skills.find((e) => e.id === skillId) ?? null : null;
    setLibraryEntry(entry);
    if (entry && entry.source === 'community' && !entry.installed) {
      setDetail(null);
      setState('not-installed');
      return;
    }
    const skillResult = await fetchSkill(skillId);

    if (skillResult.ok && skillResult.detail) {
      setDetail(skillResult.detail);
      setState('ready');
      return;
    }

    setDetail(null);
    if (skillResult.status === 404) {
      setState('not-found');
      return;
    }
    setError(skillResult.error ?? 'could not load this skill');
    setErrorStatus(skillResult.status);
    setState('error');
  }, []);

  useEffect(() => {
    if (id) void load(id);
  }, [id, load]);

  async function handleApprove() {
    setApproving(true);
    setApproveError(null);
    const r = await approveSkill(id);
    setApproving(false);
    if (!r.ok) {
      setApproveError(r.error ?? 'approve failed');
      return;
    }
    void load(id);
  }

  // ---- W7-B4 (library-05): edit / delete --------------------------------

  function toggleEdit() {
    if (!editing && detail) {
      const skillMd = detail.files.find((f) => f.path === 'SKILL.md') ?? detail.files[0];
      setEditName(detail.name);
      setEditDescription(detail.description ?? '');
      setEditBody(skillMd ? stripFrontmatter(skillMd.body) : '');
      setActionError(null);
    }
    setEditing((v) => !v);
  }

  async function handleSaveEdit() {
    setSavingEdit(true);
    setActionError(null);
    const r = await updateSkill(id, { name: editName, description: editDescription, body: editBody });
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
    const r = await deleteSkill(id);
    setDeleting(false);
    if (!r.ok) {
      setActionError(r.error ?? 'delete failed');
      return;
    }
    router.push('/skills');
  }

  const trustAttr = state === 'ready' ? detail!.trust : state === 'not-installed' ? libraryEntry?.trust : undefined;
  const sourceAttr = state === 'ready' ? detail!.source : state === 'not-installed' ? libraryEntry?.source : undefined;

  // W7-C3 review (A-H4): this route shipped the bare product name as its
  // tab title. Called before the early returns below.
  useDocumentTitle(detail?.name ?? libraryEntry?.name ?? id, 'Skills');

  // W7-A4 (crosscut-27): unknown id → the ONE shared not-found treatment.
  if (state === 'not-found') {
    return <NotFound kind="skill" id={id} backHref="/skills" backLabel="Skills" detail="Neither on disk nor in the community catalog." />;
  }

  return (
    <main
      id={MAIN_CONTENT_ID}
      data-page="skill-detail"
      data-skill-id={id}
      {...(trustAttr ? { 'data-skill-trust': trustAttr } : {})}
      {...(sourceAttr ? { 'data-skill-source': sourceAttr } : {})}
      data-page-ready={state !== 'loading' ? 'true' : 'false'}
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}
    >
      <StudioNav />
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 28px 64px', width: '100%' }}>
        <Breadcrumbs items={[{ label: 'Library', href: '/library' }, { label: 'Skills', href: '/skills' }, { label: detail?.name ?? libraryEntry?.name ?? id }]} />

        {state === 'loading' && (
          <div style={{ color: 'var(--dim)', fontSize: 13.5, padding: '24px 0' }}>Loading…</div>
        )}

        {state === 'error' && (
          <div style={{ marginTop: 16 }}>
            <FetchErrorState what="this skill" error={error ?? 'could not load this skill'} status={errorStatus} onRetry={() => { if (id) void load(id); }} />
          </div>
        )}

        {state === 'not-installed' && (
          <div style={{ marginTop: 16 }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: '0 0 8px' }}>
              {libraryEntry?.name ?? id}
            </h1>
            <p style={{ fontSize: 13.5, color: 'var(--dim)', margin: '0 0 16px', maxWidth: 560, lineHeight: 1.6 }}>
              {libraryEntry?.description}
            </p>
            <div
              data-component="not-installed"
              style={{ fontSize: 13, color: 'var(--faint)', fontStyle: 'italic', padding: '14px 16px', border: '1px dashed var(--line-2)', borderRadius: 'var(--radius-sm, 6px)' }}
            >
              Not installed — nothing to show yet.{' '}
              <Link href={`/community/skill/${encodeURIComponent(id)}`} style={{ color: 'var(--dim)' }}>
                View it in the community browser
              </Link>{' '}
              to install it from there.
            </div>
          </div>
        )}

        {state === 'ready' && detail && (
          <>
            {/* W7-B4 (library-05): a Studio-authored skill is finally
                editable, renamable and deletable from Studio. */}
            <div style={{ marginTop: 16 }}>
              <LibraryItemActions
                kind="skill"
                id={id}
                editing={editing}
                onToggleEdit={toggleEdit}
                onDelete={() => void handleDelete()}
                deleting={deleting}
                deleteBlockReason={
                  detail.usedBy.length > 0
                    ? `still composed by ${detail.usedBy.length} agent(s): ${detail.usedBy.join(', ')} — unbind it from their builders first`
                    : null
                }
                error={actionError}
              />
            </div>
            {editing && (
              <section data-component="skill-edit-form" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid var(--line)', borderRadius: 'var(--radius, 8px)', padding: '14px 16px' }}>
                <label style={{ fontSize: 12, color: 'var(--dim)' }}>
                  Name
                  <input
                    data-field="skill-edit-name"
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    style={{ display: 'block', width: '100%', marginTop: 4, fontSize: 13, padding: '7px 10px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 4, color: 'var(--text)', boxSizing: 'border-box' }}
                  />
                </label>
                <label style={{ fontSize: 12, color: 'var(--dim)' }}>
                  Description
                  <input
                    data-field="skill-edit-description"
                    type="text"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    style={{ display: 'block', width: '100%', marginTop: 4, fontSize: 13, padding: '7px 10px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 4, color: 'var(--text)', boxSizing: 'border-box' }}
                  />
                </label>
                <label style={{ fontSize: 12, color: 'var(--dim)' }}>
                  SKILL.md body
                  <textarea
                    data-field="skill-edit-body"
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={Math.min(24, Math.max(8, editBody.split('\n').length + 2))}
                    spellCheck={false}
                    style={{ display: 'block', width: '100%', marginTop: 4, fontFamily: 'var(--font-mono, monospace)', fontSize: 12.5, lineHeight: 1.6, padding: '10px 12px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 4, color: 'var(--text)', boxSizing: 'border-box', resize: 'vertical' }}
                  />
                </label>
                {detail.provenance && (
                  <p style={{ fontSize: 11.5, color: 'var(--faint)', fontStyle: 'italic', margin: 0 }}>
                    This skill was installed from the community — editing it changes the pinned
                    content hash, so it will honestly drop to needs-review until re-approved.
                  </p>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-primary btn-sm" data-action="save-skill-edit" onClick={() => void handleSaveEdit()} {...disabledAttrs(savingEdit ? 'Saving…' : !editName.trim() ? 'Give the skill a name first' : null)}>
                    {savingEdit ? 'Saving…' : 'Save changes'}
                  </button>
                  <button type="button" className="btn btn-sm" data-action="cancel-skill-edit" onClick={toggleEdit} disabled={savingEdit}>
                    Cancel
                  </button>
                </div>
              </section>
            )}
            <SkillDetailBody
              detail={detail}
              approving={approving}
              approveError={approveError}
              onApprove={() => void handleApprove()}
            />
          </>
        )}
      </div>
    </main>
  );
}
