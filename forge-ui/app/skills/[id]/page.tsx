'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { StudioNav } from '@/components/StudioNav';
import { NotFound } from '@/components/NotFound';
import { FetchErrorState } from '@/components/FetchErrorState';
import { FilePackage } from '@/components/studio/FilePackage';
import { LibraryItemActions } from '@/components/studio/LibraryItemActions';
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

const REASON_TEXT: Record<string, string> = {
  'hash-drift': "This skill's files changed after it was approved — the pinned content hash no longer matches what's on disk. Review the diff before trusting it again.",
  'provenance-tampered': "This skill's provenance metadata doesn't check out — the recorded install info doesn't match reality.",
  'unregistered-install': "This skill wasn't installed through the tracked install pipeline, so its origin can't be verified.",
};

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

// ---------------------------------------------------------------------------
// SkillDetailBody
// ---------------------------------------------------------------------------

export function SkillDetailBody({
  detail,
  approving,
  approveError,
  onApprove,
}: {
  detail: SkillDetail;
  approving: boolean;
  approveError: string | null;
  onApprove: () => void;
}) {
  const usedBy = detail.usedBy;

  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: '0 0 8px' }}>
          {detail.name}
        </h1>
        {detail.description && (
          <p style={{ fontSize: 13.5, color: 'var(--dim)', margin: 0, maxWidth: 560, lineHeight: 1.6 }}>
            {detail.description}
          </p>
        )}
      </div>

      {detail.trust === 'needs-review' && (
        <section
          data-section="needs-review"
          style={{ fontSize: 13, color: '#f87171', padding: '12px 16px', border: '1px solid rgba(248,113,113,.35)', borderRadius: 'var(--radius-sm, 6px)', background: 'rgba(248,113,113,.06)' }}
        >
          {detail.reason ? REASON_TEXT[detail.reason] ?? detail.reason : 'This skill no longer matches its pinned content — it has dropped out of the palette until re-approved.'}
        </section>
      )}

      <section>
        <SectionLabel>Package</SectionLabel>
        <FilePackage files={detail.files} />
      </section>

      <section data-section="used-by" data-used-by-count={usedBy.length}>
        <SectionLabel>Used by</SectionLabel>
        {usedBy.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--faint)', fontStyle: 'italic', margin: 0 }}>
            Unbound — bind it from an agent's builder.
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {usedBy.map((slug) => (
              <Link key={slug} href={`/agents/${encodeURIComponent(slug)}`} data-used-by-agent={slug} className="badge badge-agent" style={{ textDecoration: 'none' }}>
                {slug}
              </Link>
            ))}
          </div>
        )}
      </section>

      {detail.provenance && (
        <section
          data-section="provenance"
          data-content-hash={detail.provenance.contentHash}
          data-upstream-source={detail.provenance.source}
          {...(detail.provenance.upstreamRef ? { 'data-upstream-ref': detail.provenance.upstreamRef } : {})}
        >
          <SectionLabel>Provenance</SectionLabel>
          <dl className="kv" style={{ fontSize: 12.5 }}>
            <dt>source</dt>
            <dd>{detail.provenance.source}</dd>
            {detail.provenance.upstreamRef && (<><dt>ref</dt><dd>{detail.provenance.upstreamRef}</dd></>)}
            <dt>content hash</dt>
            <dd style={{ fontFamily: 'var(--font-mono, monospace)' }}>{detail.provenance.contentHash}</dd>
            <dt>installed</dt>
            <dd>{detail.provenance.installedAt}</dd>
          </dl>
        </section>
      )}

      {/* W8-B4 (library-36): this used to be `detail.trust === 'draft' &&
          detail.scan` — the SECOND half of that guard is why widening only
          the trust check would not have been enough: the bridge only ever
          populates `scan` for a draft (cli/bridge-studio-skills.ts, "the scan
          is drafts-only"), so `needs-review` NEVER carries one. The scan
          preview/report below stays scan-gated (draft-only, by design); the
          Approve control itself is gated on TRUST alone so a needs-review
          skill — dropped after an edit, a hash drift, or a tampered/
          unregistered install — gets the same way back to composable a draft
          always had, mirroring `app/hooks/[id]/page.tsx`'s `!resolved` gate. */}
      {(detail.trust === 'draft' || detail.trust === 'needs-review') && (
        <section
          data-section="approval-gate"
          style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius, 8px)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <div>
            <SectionLabel>Approval gate</SectionLabel>
            <p style={{ fontSize: 12.5, color: 'var(--dim)', margin: '0 0 10px', lineHeight: 1.6 }}>
              {detail.trust === 'draft'
                ? 'This is an installed draft — quarantined, not palette-visible, and not runnable as an agent (D4). Read the full SKILL.md below, review the inventory, then approve if you trust it.'
                : 'This skill dropped out of the palette (see the reason above) — quarantined and not runnable as an agent until re-approved. Approving re-pins the content hash to what is on disk right now.'}
            </p>
            {detail.scan && (
              <pre style={{ margin: 0, padding: '12px 14px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm, 6px)', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' }}>
                <code>{detail.scan.body}</code>
              </pre>
            )}
          </div>

          {detail.scan && (
            <div
              data-section="scan-report"
              data-quarantined-count={detail.scan.quarantinedKeys.length}
              data-executable-count={detail.scan.executableFiles.length}
            >
              <SectionLabel>Scan — an inventory, not a verdict</SectionLabel>
              <p style={{ fontSize: 11.5, color: 'var(--faint)', margin: '0 0 8px', fontStyle: 'italic' }}>
                This lists facts for you to read before approving — it does not judge the skill safe
                or clean. Real security scanning applies to hooks, not skills.
              </p>
              <dl className="kv" style={{ fontSize: 12.5 }}>
                <dt>files</dt>
                <dd>{detail.scan.fileCount} ({detail.scan.totalBytes} bytes)</dd>
                <dt>quarantined keys</dt>
                <dd>{detail.scan.quarantinedKeys.length > 0 ? detail.scan.quarantinedKeys.join(', ') : 'none'}</dd>
                <dt>executable-extension files</dt>
                <dd>{detail.scan.executableFiles.length > 0 ? detail.scan.executableFiles.join(', ') : 'none'}</dd>
              </dl>
            </div>
          )}

          <div>
            <button
              type="button"
              className="btn btn-primary"
              data-action="approve-skill"
              onClick={onApprove}
              {...disabledAttrs(approving ? 'Approving…' : null)}
            >
              {approving ? 'Approving…' : 'Approve'}
            </button>
            {approveError && <span style={{ marginLeft: 10, fontSize: 12, color: '#f87171' }}>{approveError}</span>}
          </div>
        </section>
      )}
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
