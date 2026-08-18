'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { StudioNav } from '@/components/StudioNav';
import { FetchErrorState } from '@/components/FetchErrorState';
import { FilePackage } from '@/components/studio/FilePackage';
import { fetchHook, approveHook, overrideHookBlock, type HookDetail } from '@/lib/hook-client';
import { buildHookDetailView, type HookDetailView } from '@/lib/hook-library-view';

// ---------------------------------------------------------------------------
// Hook detail — /hooks/[id] (R3-03-F4). Three distinct outcomes, never
// conflated (house rule: no silent fallback):
//   - 'ready'     — the hook exists and loaded as a valid definition.
//   - 'not-found' — no such id (unknown OR malformed — D-4: the bridge 404s
//                   for both, deliberately, so a fabricated 200 carrying an
//                   invented scan report is structurally impossible).
//   - 'error'     — the bridge itself could not be reached / errored.
// ---------------------------------------------------------------------------

type PageState = 'loading' | 'ready' | 'not-found' | 'error';

export default function HookDetailPage() {
  const params = useParams();
  const id = (params?.id as string) ?? '';

  const [state, setState] = useState<PageState>('loading');
  const [detail, setDetail] = useState<HookDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // W7-A1 (library-13): the HTTP status when the bridge ANSWERED (a 400
  // "invalid hook id" is a refusal, not an outage) — undefined when it was
  // never reached. Drives FetchErrorState's framing.
  const [errorStatus, setErrorStatus] = useState<number | undefined>(undefined);
  const [approving, setApproving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');

  const load = useCallback(async (hookId: string) => {
    setState('loading');
    setActionError(null);
    const r = await fetchHook(hookId);
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
    setError(r.error ?? 'could not load this hook');
    setErrorStatus(r.status);
    setState('error');
  }, []);

  useEffect(() => {
    if (id) void load(id);
  }, [id, load]);

  async function handleApprove() {
    setApproving(true);
    setActionError(null);
    const r = await approveHook(id);
    setApproving(false);
    if (!r.ok) {
      setActionError(r.error ?? 'approve failed');
      return;
    }
    void load(id);
  }

  async function handleOverride() {
    setApproving(true);
    setActionError(null);
    const r = await overrideHookBlock(id, overrideReason);
    setApproving(false);
    if (!r.ok) {
      setActionError(r.error ?? 'override failed');
      return;
    }
    setOverrideReason('');
    void load(id);
  }

  const view = state === 'ready' && detail ? buildHookDetailView(detail) : null;

  return (
    <main
      data-page="hook-detail"
      data-hook-id={id}
      data-page-ready={state !== 'loading' ? 'true' : 'false'}
      {...(view ? { 'data-hook-event': view.on, 'data-hook-verdict': view.scanVerdict, 'data-hook-trust': view.trust, 'data-hook-runnable': view.runnable ? 'true' : 'false' } : {})}
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}
    >
      <StudioNav />
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 28px 64px', width: '100%' }}>
        <Link href="/hooks" style={{ fontSize: 12, color: 'var(--dim)', textDecoration: 'none' }}>&larr; Hooks</Link>

        {state === 'loading' && (
          <div style={{ color: 'var(--dim)', fontSize: 13.5, padding: '24px 0' }}>Loading…</div>
        )}

        {state === 'error' && (
          <div style={{ marginTop: 16 }}>
            <FetchErrorState what="this hook" error={error ?? 'could not load this hook'} status={errorStatus} onRetry={() => { if (id) void load(id); }} />
          </div>
        )}

        {state === 'not-found' && (
          <div style={{ marginTop: 16, color: 'var(--faint)', fontSize: 13.5, fontStyle: 'italic' }}>
            No hook &quot;{id}&quot; — either it doesn&apos;t exist, or it failed to load as a valid hook definition.
          </div>
        )}

        {state === 'ready' && view && (
          <HookDetailBody
            view={view}
            approving={approving}
            actionError={actionError}
            overrideReason={overrideReason}
            onOverrideReasonChange={setOverrideReason}
            onApprove={() => void handleApprove()}
            onOverride={() => void handleOverride()}
          />
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// HookDetailBody
// ---------------------------------------------------------------------------

function HookDetailBody({
  view,
  approving,
  actionError,
  overrideReason,
  onOverrideReasonChange,
  onApprove,
  onOverride,
}: {
  view: HookDetailView;
  approving: boolean;
  actionError: string | null;
  overrideReason: string;
  onOverrideReasonChange: (v: string) => void;
  onApprove: () => void;
  onOverride: () => void;
}) {
  const canApprove = view.scanVerdict !== 'blocked' && view.trust === 'needs-review';
  const canOverride = view.scanVerdict === 'blocked' && view.trust === 'needs-review';
  const resolved = view.trust === 'approved' || view.trust === 'overridden';

  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: '0 0 8px' }}>
          {view.name}
        </h1>
        {view.description && (
          <p style={{ fontSize: 13.5, color: 'var(--dim)', margin: 0, maxWidth: 560, lineHeight: 1.6 }}>
            {view.description}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <span className="badge">{view.on}</span>
          {view.matcher && <span className="badge">{view.matcher}</span>}
        </div>
      </div>

      <section>
        <SectionLabel>Package</SectionLabel>
        <FilePackage files={view.files} />
      </section>

      <section data-section="carried-by" data-carried-by-count={view.carriedByCount}>
        <SectionLabel>Carried by</SectionLabel>
        {view.carriedByCount === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--faint)', fontStyle: 'italic', margin: 0 }}>
            Unbound — bind it from an agent&apos;s builder.
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {view.carriedBy.map((slug) => (
              <Link key={slug} href={`/agents/${encodeURIComponent(slug)}`} data-carried-by-agent={slug} className="badge badge-agent" style={{ textDecoration: 'none' }}>
                {slug}
              </Link>
            ))}
          </div>
        )}
      </section>

      <ScanReportPanel view={view} />

      {!resolved && (
        <section style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius, 8px)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SectionLabel>Approval</SectionLabel>
          {canApprove && (
            <div>
              <button type="button" className="btn btn-primary" data-action="approve-hook" onClick={onApprove} disabled={approving}>
                {approving ? 'Approving…' : 'Approve'}
              </button>
            </div>
          )}
          {canOverride && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 12, color: 'var(--faint)', margin: 0 }}>
                This hook is blocked — approve refuses it. Overriding is a distinct, recorded act
                that never launders the scan verdict; the hook stays flagged as blocked forever.
              </p>
              <input
                type="text"
                data-field="override-reason"
                placeholder="why are you overriding this block?"
                value={overrideReason}
                onChange={(e) => onOverrideReasonChange(e.target.value)}
                style={{ fontSize: 12.5, padding: '6px 10px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 4, color: 'var(--text)' }}
              />
              <button
                type="button"
                className="btn"
                data-action="override-hook-block"
                onClick={onOverride}
                disabled={approving || !overrideReason.trim()}
                style={{ alignSelf: 'flex-start' }}
              >
                {approving ? 'Overriding…' : 'Override block'}
              </button>
            </div>
          )}
          {actionError && <span style={{ fontSize: 12, color: '#f87171' }}>{actionError}</span>}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScanReportPanel — the SECURITY SCAN panel (F2's verdict rendering)
// ---------------------------------------------------------------------------

const SEVERITY_STYLE: Record<string, React.CSSProperties> = {
  critical: { color: '#f87171', borderColor: 'rgba(248,113,113,.4)', background: 'rgba(248,113,113,.06)' },
  info: { color: 'var(--faint)', borderColor: 'var(--line-2)', background: 'rgba(255,255,255,.03)' },
};

function ScanReportPanel({ view }: { view: HookDetailView }) {
  const { scan } = view;
  return (
    <section
      data-section="scan-report"
      data-scan-verdict={scan.verdict}
      data-finding-count={scan.findingCount}
      data-critical-count={scan.criticalCount}
      style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius, 8px)', padding: '16px 18px' }}
    >
      <SectionLabel>Security scan</SectionLabel>
      <p style={{ fontSize: 11.5, color: 'var(--faint)', margin: '0 0 10px', fontStyle: 'italic' }}>
        A static scan of the hook&apos;s script — verdict: <strong>{scan.verdict}</strong>. A finding
        declared in the hook&apos;s permission manifest is downgraded, never hidden.
      </p>
      {scan.findings.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--faint)', fontStyle: 'italic', margin: 0 }}>No findings.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {scan.findings.map((f, i) => (
            <div
              key={`${f.category}-${i}`}
              data-finding-category={f.category}
              data-finding-severity={f.severity}
              data-finding-declared={f.declared ? 'true' : 'false'}
              style={{
                ...SEVERITY_STYLE[f.severity],
                border: '1px solid',
                borderRadius: 'var(--radius-sm, 6px)',
                padding: '8px 12px',
                fontSize: 12.5,
                opacity: f.declared ? 0.65 : 1,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2 }}>
                {f.category} — {f.severity}{f.declared ? ' (declared)' : ''}
              </div>
              <div>{f.message}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>
      {children}
    </h2>
  );
}
