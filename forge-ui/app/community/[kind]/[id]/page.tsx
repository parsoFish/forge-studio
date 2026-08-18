'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { StudioNav } from '@/components/StudioNav';
import { NotFound } from '@/components/NotFound';
import { FilePackage } from '@/components/studio/FilePackage';
import {
  fetchCommunityItemDetail,
  installCommunityItem,
  COMMUNITY_KINDS,
  type CommunityItemDetail,
  type CommunitySkillDetail,
  type CommunityHookDetail,
  type CommunityConnectionDetail,
  type CommunityKind,
  type CommunityInstallOutcome,
  type HookScanReport,
} from '@/lib/community-client';
import { installStateLabel, signalsLabel, hubLabel } from '@/lib/community-view';

// ---------------------------------------------------------------------------
// Community item detail — /community/[kind]/[id] (R3-07-F1). The pre-install
// consumable page for every kind: hub + signals, kind-appropriate depth
// (security scan pre-install for hooks, curated capabilities for MCPs, the
// vendored file package for skills/hooks), then a single install control
// that ROUTES to the owning pipeline — never approves, overrides or
// re-pins anything itself (D2).
//
// Four distinct outcomes, never conflated (house rule: no silent fallback):
//   - 'ready'     — the item resolved to a real community record.
//   - 'not-found' — unknown kind/id (the bridge 404s for both).
//   - 'error'     — the bridge itself could not be reached / errored.
// The state-derived attributes (`data-item-kind`, `data-install-state`) are
// ABSENT for every state except 'ready' — an unvalidated route param is
// never asserted as fact before the server confirms it.
// ---------------------------------------------------------------------------

// W7-A4 (community-11): the two failure modes are DISTINCT states — an
// unrecognised kind never reaches the bridge, an unknown id 404s there.
type PageState = 'loading' | 'ready' | 'unknown-kind' | 'not-found' | 'error';

function isCommunityKind(x: string): x is CommunityKind {
  return (COMMUNITY_KINDS as readonly string[]).includes(x);
}

function hasFiles(item: CommunityItemDetail): item is CommunitySkillDetail | CommunityHookDetail {
  return 'files' in item;
}

function hasScan(item: CommunityItemDetail): item is CommunityHookDetail {
  return 'scan' in item;
}

function isConnectionDetail(item: CommunityItemDetail): item is CommunityConnectionDetail {
  return 'install' in item;
}

function owningHrefFor(item: CommunityItemDetail): string {
  if (item.kind === 'skill') return `/skills/${encodeURIComponent(item.id)}`;
  if (item.kind === 'hook') return `/hooks/${encodeURIComponent(item.id)}`;
  return `/connections/${encodeURIComponent(item.id)}`;
}

function routedToForKind(kind: CommunityKind): CommunityInstallOutcome['routedTo'] {
  if (kind === 'skill') return 'skill-draft';
  if (kind === 'hook') return 'hook-needs-approval';
  return 'connection-install';
}

export default function CommunityDetailPage() {
  const params = useParams();
  const kindParam = (params?.kind as string) ?? '';
  const id = (params?.id as string) ?? '';

  const [state, setState] = useState<PageState>('loading');
  const [item, setItem] = useState<CommunityItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [installOutcome, setInstallOutcome] = useState<CommunityInstallOutcome | null>(null);

  const load = useCallback(async (k: string, itemId: string) => {
    setState('loading');
    setActionError(null);
    if (!isCommunityKind(k)) {
      setItem(null);
      setState('unknown-kind');
      return;
    }
    const r = await fetchCommunityItemDetail(k, itemId);
    if (r.ok && r.item) {
      setItem(r.item);
      setState('ready');
      return;
    }
    setItem(null);
    if (r.status === 404) {
      setState('not-found');
      return;
    }
    setError(r.error ?? 'could not load this community item');
    setState('error');
  }, []);

  useEffect(() => {
    if (kindParam && id) void load(kindParam, id);
  }, [kindParam, id, load]);

  async function handleInstall() {
    if (!item) return;
    setInstalling(true);
    setActionError(null);
    setInstallOutcome(null);
    const r = await installCommunityItem(item.kind, item.id);
    setInstalling(false);
    if (!r.ok || !r.result) {
      setActionError(r.error ?? 'install failed');
      return;
    }
    setInstallOutcome(r.result);
    void load(item.kind, item.id); // refresh so installState reflects the real post-install fact
  }

  // W7-A4 (community-11 / crosscut-27): unknown kind and unknown id are two
  // different honest answers, both through the ONE shared not-found treatment
  // with a way back to the community index.
  if (state === 'unknown-kind') {
    return <NotFound kind="community kind" id={kindParam} backHref="/community" backLabel="Community" detail="Community items are skills, hooks, MCP servers or tools — the kind in this URL is none of those." />;
  }
  if (state === 'not-found') {
    return <NotFound kind={`community ${kindParam}`} id={id} backHref="/community" backLabel="Community" detail="No item with this id is known to the community index." />;
  }

  return (
    <main
      data-page="community-detail"
      data-item-id={id}
      {...(state === 'ready' && item ? { 'data-item-kind': item.kind, 'data-install-state': item.installState } : {})}
      data-page-ready={state !== 'loading' ? 'true' : 'false'}
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}
    >
      <StudioNav />
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 28px 64px', width: '100%' }}>
        <Link href="/community" style={{ fontSize: 12, color: 'var(--dim)', textDecoration: 'none' }}>
          &larr; Community
        </Link>

        {state === 'loading' && <div style={{ color: 'var(--dim)', fontSize: 13.5, padding: '24px 0' }}>Loading…</div>}

        {state === 'error' && (
          <div
            data-component="fetch-error"
            style={{ marginTop: 16, color: '#f87171', fontSize: 13, padding: '14px 16px', border: '1px solid rgba(248,113,113,.35)', borderRadius: 'var(--radius-sm, 6px)', background: 'rgba(248,113,113,.06)' }}
          >
            Could not reach the forge bridge ({error}).
          </div>
        )}

        {state === 'ready' && item && (
          <CommunityDetailBody
            item={item}
            installing={installing}
            actionError={actionError}
            installOutcome={installOutcome}
            onInstall={() => void handleInstall()}
          />
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// CommunityDetailBody
// ---------------------------------------------------------------------------

function CommunityDetailBody({
  item,
  installing,
  actionError,
  installOutcome,
  onInstall,
}: {
  item: CommunityItemDetail;
  installing: boolean;
  actionError: string | null;
  installOutcome: CommunityInstallOutcome | null;
  onInstall: () => void;
}) {
  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: '0 0 8px' }}>
          {item.name}
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--dim)', margin: 0, maxWidth: 620, lineHeight: 1.6 }}>{item.desc}</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <span className="badge">{item.kind}</span>
          <span className="badge">{installStateLabel(item.installState)}</span>
        </div>
      </div>

      <HubSignalsSection item={item} />

      {hasFiles(item) && (
        <section>
          <SectionLabel>Package</SectionLabel>
          <FilePackage files={item.files} />
        </section>
      )}

      {hasScan(item) && <SecurityScanSection scan={item.scan} />}

      {isConnectionDetail(item) && item.capabilities !== undefined && <CapabilitiesSection item={item} />}

      <InstallSection item={item} installing={installing} installOutcome={installOutcome} onInstall={onInstall} />

      {actionError && (
        <p style={{ fontSize: 12, color: '#f87171', margin: 0 }} data-component="community-action-error">
          {actionError}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HubSignalsSection — D4/D5: never a fabricated hub name or signal figure;
// attributes present only for a fact the server actually sent.
// ---------------------------------------------------------------------------

function HubSignalsSection({ item }: { item: CommunityItemDetail }) {
  return (
    <section
      data-section="hub-signals"
      {...(item.hub ? { 'data-hub-id': item.hub.id } : {})}
      {...(item.signals ? { 'data-signal-source': item.signals.attributedTo } : {})}
      style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius, 8px)', padding: '16px 18px' }}
    >
      <SectionLabel>Hub &amp; signals</SectionLabel>
      <dl className="kv" style={{ fontSize: 12.5 }}>
        <dt>hub</dt>
        <dd>
          {item.hub ? (
            <a href={item.hub.url} target="_blank" rel="noreferrer">
              {hubLabel(item.hub)}
            </a>
          ) : (
            hubLabel(item.hub)
          )}
        </dd>
        <dt>signals</dt>
        <dd>{signalsLabel(item.signals)}</dd>
        <dt>origin</dt>
        <dd>{item.origin}</dd>
        <dt>upstream</dt>
        <dd>
          <a href={item.upstream} target="_blank" rel="noreferrer">
            {item.upstream}
          </a>
        </dd>
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------
// SecurityScanSection — hooks only. Mirrors /hooks/[id]'s SECURITY SCAN
// panel exactly: a declared behaviour is downgraded (dimmed) but never
// hidden or dropped from the count, because the declaration is written by
// the same untrusted party as the script.
// ---------------------------------------------------------------------------

const SEVERITY_STYLE: Record<string, React.CSSProperties> = {
  critical: { color: '#f87171', borderColor: 'rgba(248,113,113,.4)', background: 'rgba(248,113,113,.06)' },
  info: { color: 'var(--faint)', borderColor: 'var(--line-2)', background: 'rgba(255,255,255,.03)' },
};

function SecurityScanSection({ scan }: { scan: HookScanReport }) {
  const criticalCount = scan.findings.filter((f) => f.severity === 'critical').length;
  return (
    <section
      data-section="security-scan"
      data-scan-verdict={scan.verdict}
      data-finding-count={scan.findings.length}
      data-critical-count={criticalCount}
      style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius, 8px)', padding: '16px 18px' }}
    >
      <SectionLabel>Security scan</SectionLabel>
      <p style={{ fontSize: 11.5, color: 'var(--faint)', margin: '0 0 10px', fontStyle: 'italic' }}>
        A static scan of the hook&apos;s script, run PRE-install on the vendored bytes — verdict:{' '}
        <strong>{scan.verdict}</strong>. A finding declared in the hook&apos;s own permission manifest is
        downgraded, never hidden — it is written by the same untrusted party as the script.
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
                {f.category} — {f.severity}
                {f.declared ? ' (declared)' : ''}
              </div>
              <div>{f.message}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// CapabilitiesSection — mcp only in practice (a curated tool entry never
// declares any). Mirrors /connections/[id]'s CapabilitiesSection: labelled
// curated, never presented as a verified live capability list.
// ---------------------------------------------------------------------------

function CapabilitiesSection({ item }: { item: CommunityConnectionDetail }) {
  const capabilities = item.capabilities ?? [];
  return (
    <section data-section="capabilities" data-capabilities-source={item.capabilitiesSource} data-capability-count={capabilities.length}>
      <SectionLabel>Capabilities</SectionLabel>
      <p style={{ fontSize: 11.5, color: 'var(--faint)', margin: '0 0 10px', fontStyle: 'italic' }}>
        Declared at curation time from the upstream server&apos;s documented tool list — NOT a verified
        capability list of a running server.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {capabilities.map((cap) => (
          <span key={cap.name} className="badge" title={cap.summary} style={{ fontFamily: 'var(--font-mono, monospace)' }}>
            {cap.name}
          </span>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// InstallSection — the ONE mutating affordance on this page, and it never
// decides trust (D2): it routes to whichever pipeline owns this kind, then
// points the operator at that pipeline's own page — where its approval gate
// (if it has one) lives. A non-vendored skill/hook has no server-resolved
// install: this renders structural absence, not a disabled button.
// ---------------------------------------------------------------------------

function InstallSection({
  item,
  installing,
  installOutcome,
  onInstall,
}: {
  item: CommunityItemDetail;
  installing: boolean;
  installOutcome: CommunityInstallOutcome | null;
  onInstall: () => void;
}) {
  // W6-SW-3 (sweep C5#1): for a connection-kind item (mcp/tool), routing is
  // only real when forge actually installs it (install.method === 'npm') —
  // 'system-provided'/'external' are explicitly "forge does not install
  // this" per the text rendered just above (mirrors /connections/[id]'s
  // `installable` gate). Non-connection kinds (skill/hook) keep the
  // pre-existing vendored-on-disk check.
  const canRoute = isConnectionDetail(item)
    ? item.install.method !== 'system-provided' && item.install.method !== 'external'
    : item.vendored;
  const alreadyPresent = item.installState !== 'not-installed';
  const owningHref = owningHrefFor(item);
  const routedTo = routedToForKind(item.kind);

  return (
    <section
      data-section="install"
      {...(isConnectionDetail(item) ? { 'data-install-method': item.install.method } : {})}
      style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius, 8px)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <SectionLabel>Install</SectionLabel>

      {/* R3-04-F4's whole posture is that every installable entry pins an exact
          version — this is precisely where an operator must see that pin BEFORE
          clicking install. Mirrors /connections/[id]'s InstallSection vocabulary
          exactly (data-install-method / data-install-version), never a new one.
          system-provided/external have no version to pin — structurally absent,
          not an empty attribute. */}
      {isConnectionDetail(item) && (
        <div style={{ fontSize: 12.5, color: 'var(--dim)' }}>
          {item.install.method === 'system-provided' && (
            <span>System-provided — no version to pin.</span>
          )}
          {item.install.method === 'npm' && (
            <span>
              npm package <code>{item.install.package}</code> pinned to exact version{' '}
              <code data-install-version={item.install.version}>{item.install.version}</code>.
            </span>
          )}
          {item.install.method === 'external' && (
            <span>
              External — forge does not install this. Distributed at{' '}
              <a href={item.install.upstream} target="_blank" rel="noreferrer">
                {item.install.upstream}
              </a>
              .
            </span>
          )}
        </div>
      )}

      {!canRoute && isConnectionDetail(item) && (
        <p style={{ fontSize: 13, color: 'var(--faint)', fontStyle: 'italic', margin: 0 }}>
          Nothing to install from this page — see the install method above.
        </p>
      )}

      {!canRoute && !isConnectionDetail(item) && (
        <p style={{ fontSize: 13, color: 'var(--faint)', fontStyle: 'italic', margin: 0 }}>
          This {item.kind} is a curated catalog reference with no vendored package on disk yet — install cannot
          be driven from this page.
        </p>
      )}

      {canRoute && alreadyPresent && (
        <p style={{ fontSize: 13, color: 'var(--text)', margin: 0 }}>
          {installStateLabel(item.installState)} already — continue at{' '}
          <Link href={owningHref}>{owningHref}</Link>.
        </p>
      )}

      {canRoute && !alreadyPresent && (
        <div>
          <button
            type="button"
            className="btn btn-primary"
            data-action="install-community-item"
            data-install-routed-to={routedTo}
            onClick={onInstall}
            disabled={installing}
          >
            {installing ? 'Installing…' : 'Install'}
          </button>
        </div>
      )}

      {installOutcome && (
        <div
          data-component="install-outcome"
          style={{ fontSize: 12.5, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm, 6px)', background: 'var(--bg-2)' }}
        >
          {installOutcome.routedTo === 'skill-draft' || installOutcome.routedTo === 'hook-needs-approval' ? (
            <span>
              <strong>{installOutcome.alreadyInstalled ? 'Already installed.' : 'Installed as a draft.'}</strong>{' '}
              Its approval gate lives at <Link href={owningHref}>{owningHref}</Link>.
            </span>
          ) : installOutcome.suppressed ? (
            <span>
              <strong>Suppressed — no network call was made.</strong>
              <pre
                data-would-install-argv
                style={{ margin: '6px 0 0', fontFamily: 'var(--font-mono, monospace)', fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {installOutcome.wouldInstall.command} {installOutcome.wouldInstall.args.join(' ')}
              </pre>
            </span>
          ) : (
            <span>
              <strong>{installOutcome.installed ? 'Installed.' : 'Install did not complete.'}</strong> Probe state:{' '}
              {installOutcome.probe.state}.
            </span>
          )}
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
