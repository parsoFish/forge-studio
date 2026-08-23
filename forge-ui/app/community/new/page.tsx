'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { StudioNav } from '@/components/StudioNav';
import { NotFound } from '@/components/NotFound';
import {
  addRegistryItem,
  updateRegistryItem,
  fetchRegistryItem,
  type RegistryItemInput,
} from '@/lib/community-client';
import { MAIN_CONTENT_ID } from '@/lib/main-landmark';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { useDocumentTitle } from '@/lib/document-title';
import { disabledAttrs } from '@/lib/disabled-reason';
import {
  EMPTY_REGISTRY_FORM,
  isRegistryFieldRequired,
  registryEditLoadOutcome,
  registryFormDisabledReason,
  registryRequiredFilled,
  type RegistryEditLoadOutcome,
  type RegistryFormField,
  type RegistryFormState,
} from '@/lib/community-form';

// ---------------------------------------------------------------------------
// Registry item form — /community/new (W7-B3, community-23). Add a curated
// row to studio/community/registry.yaml, or edit one (?edit=<id>). The
// bridge validates through the SAME structural loader forge studio lint
// trusts and FORCES the hand-curated stamps (fetchedAt: null / fetchedBy:
// operator) — this form never fabricates a verification fact, which is why
// there is no "stars" number input: a hand-entered star count is exactly the
// invented signal the registry's own seed discipline forbids. Since the
// W7-B3 review (F4/F5) stars/starsDisplay/upstreamUpdatedAt are fully
// SERVER-OWNED (create → null; edit → carried from the existing row), and
// only the attribution note is operator text. Kind is fixed to "skill" —
// the index sources every other kind outside the registry (F1).
//
// Commit policy (decision, recorded in docs/community-registry-writes.md):
// Studio writes the repo-tracked file; the operator commits via their normal
// git flow. /community shows the uncommitted-changes state.
//
// W8-B5 (community-29 / community-30) — TWO fixes, both structural:
//   - Which fields are required is stated ONCE, in
//     `lib/community-form.ts`'s `REGISTRY_REQUIRED_FIELDS`. It drives the `*`
//     each `<Field>` renders, the submit gate, AND the disabled reason's
//     wording, so those three can no longer disagree (they did: the reason
//     named "description" — not required — and "upstream" — not a field
//     here — while leaving `category` and `provenance` unnamed).
//   - An `?edit=` id that does not exist renders the SHARED `NotFound`, not a
//     full edit form with a banner over it. A genuine 404 and a bridge that
//     is down are DIFFERENT facts (`registryEditLoadOutcome`): only the 404
//     may claim the row does not exist.
// ---------------------------------------------------------------------------

type FormState = RegistryFormState;

const EMPTY: FormState = EMPTY_REGISTRY_FORM;

function toInput(form: FormState): RegistryItemInput {
  // W7-B3 review F4/F5: stars/starsDisplay/upstreamUpdatedAt are SERVER-OWNED
  // — the bridge ignores any body value (create starts them null; edit
  // carries the existing row's values forward), so the form sends only the
  // operator-authored attribution note.
  const attributedTo = form.attributedTo.trim();
  return {
    id: form.id.trim(),
    kind: form.kind,
    name: form.name.trim(),
    ...(form.desc.trim() ? { desc: form.desc.trim() } : {}),
    category: form.category.trim(),
    sourceUrl: form.sourceUrl.trim(),
    provenance: form.provenance.trim(),
    ...(form.tier.trim() ? { tier: form.tier.trim() } : {}),
    ...(attributedTo ? { signals: { stars: null, starsDisplay: null, attributedTo } } : {}),
  };
}

function RegistryItemFormInner(): JSX.Element {
  const router = useRouter();
  const editId = useSearchParams().get('edit');
  const editing = editId !== null && editId !== '';

  const [form, setForm] = useState<FormState>(EMPTY);
  const [loaded, setLoaded] = useState(!editing);
  // W8-B5 (community-30): the load's OUTCOME, not just an error string. A
  // real 404 renders the shared NotFound; an unreachable/erroring bridge
  // keeps the banner, because "the bridge is down" is never evidence that
  // the row does not exist.
  const [loadOutcome, setLoadOutcome] = useState<RegistryEditLoadOutcome | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    fetchRegistryItem(editId).then((r) => {
      if (cancelled) return;
      const outcome = registryEditLoadOutcome(r);
      setLoadOutcome(outcome);
      if (outcome !== 'ok' || !r.item) {
        setLoadError(r.error ?? `no registry item "${editId}"`);
        setLoaded(true);
        return;
      }
      setForm({
        id: r.item.id,
        kind: r.item.kind,
        name: r.item.name,
        desc: r.item.desc ?? '',
        category: r.item.category,
        sourceUrl: r.item.sourceUrl,
        provenance: r.item.provenance,
        tier: r.item.tier ?? '',
        attributedTo: r.item.signals?.attributedTo ?? '',
      });
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [editing, editId]);

  // ONE predicate, shared with the disabled reason and with each Field's `*`
  // marker (lib/community-form.ts). Never a second hand-written conjunction.
  const requiredFilled = registryRequiredFilled(form);
  const disabledReason = registryFormDisabledReason({ form, submitting, loadFailed: loadError !== null });

  async function onSubmit(): Promise<void> {
    if (!requiredFilled || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const input = toInput(form);
      const r = editing ? await updateRegistryItem(editId!, input) : await addRegistryItem(input);
      if (!r.ok) {
        setError(r.error ?? 'the bridge refused the write');
        return;
      }
      router.push(`/community/${encodeURIComponent(input.kind)}/${encodeURIComponent(input.id)}`);
    } finally {
      setSubmitting(false);
    }
  }

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  // W7-C3 review (A-H4): per-route tab title.
  useDocumentTitle(editing ? `Edit ${editId}` : 'Add a registry item', 'Community');

  // W8-B5 (community-30): the bridge ANSWERED, and what it said is "no
  // registry item with that id" — the shared not-found treatment, not an
  // edit form for a row that does not exist. Deliberately gated on the
  // OUTCOME and not on `loadError`: an unreachable bridge also sets
  // `loadError`, and rendering "No registry item …" for it would fabricate an
  // absence claim out of a transport failure.
  if (editing && loadOutcome === 'not-found') {
    return (
      <NotFound
        kind="registry item"
        id={editId}
        backHref="/community"
        backLabel="Community"
        detail={<>Nothing with that id is in <code>studio/community/registry.yaml</code> — it may have been removed, or the link is stale.</>}
      />
    );
  }

  return (
    <main
      id={MAIN_CONTENT_ID}
      data-page="community-registry-form"
      data-form-mode={editing ? 'edit' : 'add'}
      data-page-ready={loaded ? 'true' : 'false'}
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}
    >
      <StudioNav />
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '32px 28px 64px', width: '100%' }}>
        <Breadcrumbs items={[{ label: 'Library', href: '/library' }, { label: 'Community', href: '/community' }, { label: editing ? `Edit ${editId}` : 'Add a registry item' }]} />
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: '14px 0 6px' }}>
          {editing ? `Edit registry item — ${editId}` : 'Add a registry item'}
        </h1>
        <p style={{ fontSize: 12.5, color: 'var(--dim)', margin: '0 0 18px', lineHeight: 1.6 }}>
          Writes <code>studio/community/registry.yaml</code> (a repo-tracked file — commit it via your normal
          git flow afterwards). Hand-curated rows are stamped <code>fetchedBy: operator</code> and read
          &ldquo;never verified&rdquo; until a community-refresh pass checks them; there is deliberately no
          star-count field — a number nobody fetched is a fabricated signal.
        </p>

        {loadError && (
          <div data-component="fetch-error" style={{ color: '#f87171', fontSize: 13, marginBottom: 14 }}>
            {loadError}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="id (slug)" field="id">
            <input data-field="registry-id" value={form.id} onChange={set('id')} disabled={editing} placeholder="my-skill-id" style={inputStyle} />
          </Field>
          <Field label="kind" field="kind">
            {/* W7-B3 review F1: the registry CRUD surface admits ONLY skills —
                the community index sources hooks from vendored packages and
                mcp/tool from studio/catalog.yaml, so a hand-added row of any
                other kind would be invisible and un-curatable (the bridge
                refuses them with the same explanation). */}
            <input data-field="registry-kind" value="skill" readOnly disabled style={{ ...inputStyle, opacity: 0.7 }} />
            <span style={{ fontSize: 11.5, color: 'var(--muted, #8a8f98)' }}>
              only skills live in the registry — hooks are vendored packages; mcp/tool connections live in the catalog
            </span>
          </Field>
          <Field label="name" field="name">
            <input data-field="registry-name" value={form.name} onChange={set('name')} style={inputStyle} />
          </Field>
          <Field label="description" field="desc">
            <input data-field="registry-desc" value={form.desc} onChange={set('desc')} style={inputStyle} />
          </Field>
          <Field label="category" field="category">
            <input data-field="registry-category" value={form.category} onChange={set('category')} placeholder="planning, memory, review, …" style={inputStyle} />
          </Field>
          <Field label="source URL" field="sourceUrl">
            <input data-field="registry-source-url" value={form.sourceUrl} onChange={set('sourceUrl')} placeholder="https://github.com/owner/repo" style={inputStyle} />
          </Field>
          <Field label="provenance (who curates/publishes it)" field="provenance">
            <input data-field="registry-provenance" value={form.provenance} onChange={set('provenance')} style={inputStyle} />
          </Field>
          <Field label="tier" field="tier">
            <input data-field="registry-tier" value={form.tier} onChange={set('tier')} placeholder="haiku / sonnet / opus (optional)" style={inputStyle} />
          </Field>
          <Field label="attributed to (curation note, optional)" field="attributedTo">
            {/* W7-B3 review F4/F5: no starsDisplay input either — stars,
                starsDisplay and upstreamUpdatedAt are SERVER-OWNED fetch
                facts (a refresh pass stamps them; an edit carries them
                forward untouched). Only the attribution note is operator
                text. */}
            <input data-field="registry-attributed-to" value={form.attributedTo} onChange={set('attributedTo')} placeholder="attributed to…" style={inputStyle} />
          </Field>
        </div>

        {error && (
          <div data-component="registry-form-error" style={{ color: '#f87171', fontSize: 12.5, marginTop: 12 }}>
            {error}
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary"
          data-action={editing ? 'save-registry-item' : 'submit-registry-item'}
          {...disabledAttrs(disabledReason)}
          onClick={() => void onSubmit()}
          style={{ marginTop: 16, opacity: requiredFilled && !loadError ? 1 : 0.5 }}
        >
          {submitting ? 'Saving…' : editing ? 'Save changes' : 'Add item'}
        </button>
      </div>
    </main>
  );
}

/**
 * W8-B5 (community-29): `required` is DERIVED from the field name, never
 * passed in. Before this a caller could mark a field with a `*` that the
 * submit gate did not enforce (or the reverse) — the same class of drift the
 * disabled reason itself had. Now the asterisk, the gate and the reason all
 * read `REGISTRY_REQUIRED_FIELDS`.
 */
function Field({ label, field, children }: { label: string; field: RegistryFormField; children: React.ReactNode }): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
        {isRegistryFieldRequired(field) ? ' *' : ''}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--bg-2)', color: 'var(--text)',
  border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px', fontSize: 13,
};

export default function RegistryItemFormPage(): JSX.Element {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', fontSize: 13 }}>
          Loading…
        </div>
      }
    >
      <RegistryItemFormInner />
    </Suspense>
  );
}
