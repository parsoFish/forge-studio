'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { StudioNav } from '@/components/StudioNav';
import {
  addRegistryItem,
  updateRegistryItem,
  fetchRegistryItem,
  COMMUNITY_KINDS,
  type CommunityKind,
  type RegistryItemInput,
} from '@/lib/community-client';

// ---------------------------------------------------------------------------
// Registry item form — /community/new (W7-B3, community-23). Add a curated
// row to studio/community/registry.yaml, or edit one (?edit=<id>). The
// bridge validates through the SAME structural loader forge studio lint
// trusts and FORCES the hand-curated stamps (fetchedAt: null / fetchedBy:
// operator) — this form never fabricates a verification fact, which is why
// there is no "stars" number input: a hand-entered star count is exactly the
// invented signal the registry's own seed discipline forbids. starsDisplay +
// attribution stay curated display text.
//
// Commit policy (decision, recorded in docs/community-registry-writes.md):
// Studio writes the repo-tracked file; the operator commits via their normal
// git flow. /community shows the uncommitted-changes state.
// ---------------------------------------------------------------------------

type FormState = {
  id: string;
  kind: CommunityKind;
  name: string;
  desc: string;
  category: string;
  sourceUrl: string;
  provenance: string;
  tier: string;
  starsDisplay: string;
  attributedTo: string;
};

const EMPTY: FormState = { id: '', kind: 'skill', name: '', desc: '', category: '', sourceUrl: '', provenance: '', tier: '', starsDisplay: '', attributedTo: '' };

function toInput(form: FormState): RegistryItemInput {
  const starsDisplay = form.starsDisplay.trim();
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
    ...(starsDisplay || attributedTo
      ? { signals: { stars: null, starsDisplay: starsDisplay || null, attributedTo: attributedTo || null } }
      : {}),
  };
}

function RegistryItemFormInner(): JSX.Element {
  const router = useRouter();
  const editId = useSearchParams().get('edit');
  const editing = editId !== null && editId !== '';

  const [form, setForm] = useState<FormState>(EMPTY);
  const [loaded, setLoaded] = useState(!editing);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    fetchRegistryItem(editId).then((r) => {
      if (cancelled) return;
      if (!r.ok || !r.item) {
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
        starsDisplay: r.item.signals?.starsDisplay ?? '',
        attributedTo: r.item.signals?.attributedTo ?? '',
      });
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [editing, editId]);

  const requiredFilled =
    form.id.trim() && form.name.trim() && form.category.trim() && form.sourceUrl.trim() && form.provenance.trim();

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

  return (
    <main
      data-page="community-registry-form"
      data-form-mode={editing ? 'edit' : 'add'}
      data-page-ready={loaded ? 'true' : 'false'}
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}
    >
      <StudioNav />
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '32px 28px 64px', width: '100%' }}>
        <Link href="/community" style={{ fontSize: 12, color: 'var(--dim)', textDecoration: 'none' }}>
          &larr; Community
        </Link>
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
          <Field label="id (slug)" required>
            <input data-field="registry-id" value={form.id} onChange={set('id')} disabled={editing} placeholder="my-skill-id" style={inputStyle} />
          </Field>
          <Field label="kind" required>
            <select data-field="registry-kind" value={form.kind} onChange={set('kind')} style={inputStyle}>
              {COMMUNITY_KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </Field>
          <Field label="name" required>
            <input data-field="registry-name" value={form.name} onChange={set('name')} style={inputStyle} />
          </Field>
          <Field label="description">
            <input data-field="registry-desc" value={form.desc} onChange={set('desc')} style={inputStyle} />
          </Field>
          <Field label="category" required>
            <input data-field="registry-category" value={form.category} onChange={set('category')} placeholder="planning, memory, review, …" style={inputStyle} />
          </Field>
          <Field label="source URL" required>
            <input data-field="registry-source-url" value={form.sourceUrl} onChange={set('sourceUrl')} placeholder="https://github.com/owner/repo" style={inputStyle} />
          </Field>
          <Field label="provenance (who curates/publishes it)" required>
            <input data-field="registry-provenance" value={form.provenance} onChange={set('provenance')} style={inputStyle} />
          </Field>
          <Field label="tier">
            <input data-field="registry-tier" value={form.tier} onChange={set('tier')} placeholder="haiku / sonnet / opus (optional)" style={inputStyle} />
          </Field>
          <Field label="signals — curated display text (optional)">
            <div style={{ display: 'flex', gap: 8 }}>
              <input data-field="registry-stars-display" value={form.starsDisplay} onChange={set('starsDisplay')} placeholder="e.g. 228k" style={{ ...inputStyle, maxWidth: 140 }} />
              <input data-field="registry-attributed-to" value={form.attributedTo} onChange={set('attributedTo')} placeholder="attributed to…" style={inputStyle} />
            </div>
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
          disabled={!requiredFilled || submitting || Boolean(loadError)}
          onClick={() => void onSubmit()}
          style={{ marginTop: 16, opacity: requiredFilled && !loadError ? 1 : 0.5 }}
        >
          {submitting ? 'Saving…' : editing ? 'Save changes' : 'Add item'}
        </button>
      </div>
    </main>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
        {required ? ' *' : ''}
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
