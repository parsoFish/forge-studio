'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { StudioNav } from '@/components/StudioNav';
import { NotFound } from '@/components/NotFound';
import { FetchErrorState } from '@/components/FetchErrorState';
import {
  fetchConnectionDetail,
  probeConnection,
  installConnection,
  type ConnectionWire,
  type InstallPreview,
} from '@/lib/connection-client';
import {
  connectionBadges,
  configVarStatus,
  describeInstallOutcome,
  type ConnectionBadge,
  type InstallOutcomeView,
} from '@/lib/connection-library-view';
import { MAIN_CONTENT_ID } from '@/lib/main-landmark';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { useDocumentTitle } from '@/lib/document-title';
import { disabledAttrs } from '@/lib/disabled-reason';

// ---------------------------------------------------------------------------
// Connection detail — /connections/[id] (R3-04-F2/F3). Four distinct
// outcomes, never conflated (house rule: no silent fallback):
//   - 'ready'     — the connection exists and composed as a valid definition.
//   - 'not-found' — no such id (unknown OR a catalog entry that failed to
//                   compose as a connection — the bridge 404s for both).
//   - 'error'     — the bridge itself could not be reached / errored.
//
// NO create/edit/delete affordance exists anywhere on this page (D1) — the
// only mutating actions are "probe" (re-check reality) and "install" (act on
// the environment for a curated, already-pinned id), neither of which
// touches a definition.
// ---------------------------------------------------------------------------

type PageState = 'loading' | 'ready' | 'not-found' | 'error';

const BADGE_STYLE: Record<ConnectionBadge, React.CSSProperties> = {
  'not-installed': { color: 'var(--dim)', borderColor: 'var(--line-2)', background: 'rgba(255,255,255,.04)' },
  misconfigured: { color: '#fbbf24', borderColor: 'rgba(251,191,36,.4)', background: 'rgba(251,191,36,.08)' },
  curated: { color: 'var(--dim)', borderColor: 'var(--line-2)', background: 'rgba(255,255,255,.04)' },
};

export default function ConnectionDetailPage() {
  const params = useParams();
  const id = (params?.id as string) ?? '';

  const [state, setState] = useState<PageState>('loading');
  const [connection, setConnection] = useState<ConnectionWire | null>(null);
  const [error, setError] = useState<string | null>(null);
  // W7-A1 (library-13): the HTTP status when the bridge ANSWERED (a 400
  // "invalid connection id" is a refusal, not an outage) — undefined when it
  // was never reached. Drives FetchErrorState's framing.
  const [errorStatus, setErrorStatus] = useState<number | undefined>(undefined);
  const [probing, setProbing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [installOutcome, setInstallOutcome] = useState<InstallOutcomeView | null>(null);
  // forge-6gv.8.2 — the confirm gate's preview (package/version/registry/
  // argv/lifecycle-scripts), fetched by an UNCONFIRMED call and shown before
  // a real install can run. Non-null means "armed" — mirrors /community's
  // own two-step confirm (`confirmingInstall`), sourced from the real server
  // preview rather than a client-guessed placeholder.
  const [installPreview, setInstallPreview] = useState<InstallPreview | null>(null);

  const load = useCallback(async (connId: string) => {
    setState('loading');
    setActionError(null);
    const r = await fetchConnectionDetail(connId);
    if (r.ok && r.connection) {
      setConnection(r.connection);
      setState('ready');
      return;
    }
    setConnection(null);
    if (r.status === 404) {
      setState('not-found');
      return;
    }
    setError(r.error ?? 'could not load this connection');
    setErrorStatus(r.status);
    setState('error');
  }, []);

  useEffect(() => {
    if (id) void load(id);
  }, [id, load]);

  async function handleProbe() {
    if (!connection) return;
    setProbing(true);
    setActionError(null);
    const r = await probeConnection(connection.id);
    setProbing(false);
    if (!r.ok || !r.probe) {
      setActionError(r.error ?? 'probe failed');
      return;
    }
    setConnection({ ...connection, probe: r.probe });
  }

  // forge-6gv.8.2 — the two-step confirm gate, mirroring /community's own:
  // `confirm:false` (the default) fetches the real server PREVIEW and stops
  // there (ZERO network/executor side effects on the bridge) — only
  // `confirm:true` runs the actual install.
  async function handleInstall(confirm: boolean) {
    if (!connection) return;
    setInstalling(true);
    setActionError(null);
    if (confirm) setInstallOutcome(null);
    else setInstallPreview(null);
    const r = await installConnection(connection.id, { confirm });
    setInstalling(false);
    if (!r.ok || !r.result) {
      setActionError(r.error ?? 'install failed');
      return;
    }
    const result = r.result;
    if ('preview' in result) {
      setInstallPreview(result.preview);
      return;
    }
    setInstallPreview(null);
    const view = describeInstallOutcome(
      result.suppressed
        ? { ok: result.ok, suppressed: true, wouldInstall: result.wouldInstall }
        : { ok: result.ok, suppressed: false, installed: result.installed },
    );
    setInstallOutcome(view);
    // A real (non-suppressed) install already re-probes server-side (D-4) —
    // reflect that fresh probe immediately rather than waiting for a manual
    // re-check, and NEVER for a suppressed result (nothing ran, so there is
    // no fresher probe to adopt).
    if (!result.suppressed) {
      setConnection({ ...connection, probe: result.probe });
    }
  }

  const badges = connection ? connectionBadges(connection) : [];

  // W7-C3 review (A-H4): per-route tab title, before the early returns.
  useDocumentTitle(connection?.name ?? id, 'Connections');

  // W7-A4 (crosscut-27): unknown id → the ONE shared not-found treatment.
  if (state === 'not-found') {
    return <NotFound kind="connection" id={id} backHref="/connections" backLabel="Connections" detail="Either no connection has this id, or its catalog entry failed to compose (missing install/probe/provenance/config metadata)." />;
  }

  return (
    <main
      id={MAIN_CONTENT_ID}
      data-page="connection-detail"
      data-connection-id={id}
      data-page-ready={state !== 'loading' ? 'true' : 'false'}
      {...(connection
        ? {
            'data-connection-kind': connection.kind,
            'data-connection-state': connection.probe.state,
            'data-connection-installable': connection.installable ? 'true' : 'false',
            'data-connection-install-method': connection.install.method,
          }
        : {})}
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}
    >
      <StudioNav />
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 28px 64px', width: '100%' }}>
        <Breadcrumbs items={[{ label: 'Library', href: '/library' }, { label: 'Connections', href: '/connections' }, { label: connection?.name ?? id }]} />

        {state === 'loading' && <div style={{ color: 'var(--dim)', fontSize: 13.5, padding: '24px 0' }}>Loading…</div>}

        {state === 'error' && (
          <div style={{ marginTop: 16 }}>
            <FetchErrorState what="this connection" error={error ?? 'could not load this connection'} status={errorStatus} onRetry={() => { if (id) void load(id); }} />
          </div>
        )}

        {state === 'ready' && connection && (
          <ConnectionDetailBody
            connection={connection}
            badges={badges}
            probing={probing}
            installing={installing}
            actionError={actionError}
            installOutcome={installOutcome}
            installPreview={installPreview}
            onProbe={() => void handleProbe()}
            onInstall={(confirm) => void handleInstall(confirm)}
            onCancelPreview={() => setInstallPreview(null)}
          />
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// ConnectionDetailBody
// ---------------------------------------------------------------------------

function ConnectionDetailBody({
  connection,
  badges,
  probing,
  installing,
  actionError,
  installOutcome,
  installPreview,
  onProbe,
  onInstall,
  onCancelPreview,
}: {
  connection: ConnectionWire;
  badges: ConnectionBadge[];
  probing: boolean;
  installing: boolean;
  actionError: string | null;
  installOutcome: InstallOutcomeView | null;
  installPreview: InstallPreview | null;
  onProbe: () => void;
  onInstall: (confirm: boolean) => void;
  onCancelPreview: () => void;
}) {
  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: '0 0 8px' }}>
          {connection.name}
        </h1>
        {connection.desc && (
          <p style={{ fontSize: 13.5, color: 'var(--dim)', margin: 0, maxWidth: 620, lineHeight: 1.6 }}>{connection.desc}</p>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <span className="badge">{connection.kind === 'mcp' ? 'MCP' : 'Tool'}</span>
          {badges.map((b) => (
            <span key={b} className="badge" style={BADGE_STYLE[b]}>
              {b}
            </span>
          ))}
        </div>
      </div>

      <InstallSection
        connection={connection}
        installing={installing}
        installOutcome={installOutcome}
        installPreview={installPreview}
        onInstall={onInstall}
        onCancelPreview={onCancelPreview}
      />

      <ConfigSection connection={connection} />

      {connection.capabilities !== undefined && <CapabilitiesSection connection={connection} />}

      <ProbeEvidenceSection connection={connection} probing={probing} onProbe={onProbe} />

      <UsedBySection connection={connection} />

      {actionError && (
        <p style={{ fontSize: 12, color: '#f87171', margin: 0 }} data-component="connection-action-error">
          {actionError}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InstallSection — provenance + install method + exact version pin. A
// system-provided or external entry has NO install action at all (F2 AC) —
// structural, not a styling choice: the button is simply not rendered.
// ---------------------------------------------------------------------------

function InstallSection({
  connection,
  installing,
  installOutcome,
  installPreview,
  onInstall,
  onCancelPreview,
}: {
  connection: ConnectionWire;
  installing: boolean;
  installOutcome: InstallOutcomeView | null;
  installPreview: InstallPreview | null;
  onInstall: (confirm: boolean) => void;
  onCancelPreview: () => void;
}) {
  const provenanceIsUrl = connection.provenance.startsWith('http');

  return (
    <section
      data-section="install"
      data-install-method={connection.install.method}
      data-install-action={connection.installable ? 'available' : 'none'}
      style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius, 8px)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <SectionLabel>Install &amp; provenance</SectionLabel>

      <div style={{ fontSize: 13, color: 'var(--text)' }}>
        {connection.install.method === 'system-provided' && (
          <span>System-provided — forge assumes it is already available in the operator&apos;s environment. No install action.</span>
        )}
        {connection.install.method === 'npm' && (
          <span>
            npm package <code>{connection.install.package}</code> pinned to exact version{' '}
            <code data-install-version={connection.install.version}>{connection.install.version}</code>.
          </span>
        )}
        {connection.install.method === 'external' && (
          <span>
            External — forge does not install this. Distributed at{' '}
            <a href={connection.install.upstream} target="_blank" rel="noreferrer">
              {connection.install.upstream}
            </a>
            .
          </span>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--faint)' }}>
        Provenance:{' '}
        {provenanceIsUrl ? (
          <a href={connection.provenance} target="_blank" rel="noreferrer">
            {connection.provenance}
          </a>
        ) : (
          connection.provenance
        )}
      </div>

      {connection.installable && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* forge-6gv.8.2 — the confirm gate's PREVIEW, fetched by the first
              click and rendered before a second click can run anything: an
              operator must be able to SEE what will be fetched and run
              before agreeing to it (a confirm button with nothing to read
              above it is not a review step). Mirrors /community's own
              install-confirm-notice, but sourced from the real server
              preview rather than reconstructed client-side. */}
          {installPreview && (
            <div
              data-component="install-preview"
              style={{ fontSize: 12.5, color: 'var(--ember)', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm, 6px)', background: 'var(--bg-2)' }}
            >
              <p style={{ margin: '0 0 6px' }}>
                This runs a real <code>npm install</code> child process on the bridge host, fetching{' '}
                <code>{installPreview.package}@{installPreview.version}</code> from{' '}
                <code data-install-preview-registry={installPreview.registry}>{installPreview.registry}</code>. Lifecycle scripts{' '}
                <strong data-will-run-lifecycle-scripts={installPreview.willRunLifecycleScripts ? 'true' : 'false'}>
                  {installPreview.willRunLifecycleScripts ? 'WILL run' : 'will NOT run'}
                </strong>
                . Confirm to proceed.
              </p>
              <pre
                data-install-preview-argv
                style={{ margin: 0, fontFamily: 'var(--font-mono, monospace)', fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {installPreview.command} {installPreview.args.join(' ')}
              </pre>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              data-action="install-connection"
              data-confirming={installPreview ? 'true' : 'false'}
              onClick={() => onInstall(installPreview !== null)}
              {...disabledAttrs(installing ? 'Installing…' : null)}
            >
              {installing ? 'Installing…' : installPreview ? 'Yes, run npm install' : 'Install…'}
            </button>
            {installPreview && !installing && (
              <button type="button" data-action="install-connection-abort" className="btn" onClick={onCancelPreview}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {installOutcome && (
        <div
          data-component="install-outcome"
          data-install-outcome-status={installOutcome.status}
          style={{ fontSize: 12.5, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm, 6px)', background: 'var(--bg-2)' }}
        >
          <strong>{installOutcome.label}</strong>
          {installOutcome.wouldInstall && (
            <pre
              data-would-install-argv
              style={{ margin: '6px 0 0', fontFamily: 'var(--font-mono, monospace)', fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              {installOutcome.wouldInstall.command} {installOutcome.wouldInstall.args.join(' ')}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// ConfigSection — config schema by env-var NAME only (D5). A set/unset
// indicator, never a value; an OPTIONAL var's presence is never probed, so
// it reads 'unchecked' rather than a guess (see configVarStatus's header).
// ---------------------------------------------------------------------------

function ConfigSection({ connection }: { connection: ConnectionWire }) {
  // `missingConfig` absent means the probe never populated it (only a
  // 'misconfigured'/some 'command-presence' result ever does) — the
  // established server contract is that absence there means "nothing
  // required was found missing", so `[]` here reflects that contract rather
  // than fabricating a value for a malformed field.
  const missingConfig = connection.probe.missingConfig ?? [];

  return (
    <section data-section="config-schema" data-config-count={connection.config.length}>
      <SectionLabel>Config</SectionLabel>
      {connection.config.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--faint)', fontStyle: 'italic', margin: 0 }}>No config variables.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {connection.config.map((c) => {
            const status = configVarStatus(c, missingConfig);
            return (
              <div
                key={c.env}
                data-config-env={c.env}
                data-config-required={c.required ? 'true' : 'false'}
                data-config-status={status}
                style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-sm, 6px)', padding: '8px 12px', fontSize: 12.5 }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
                  <code>{c.env}</code>
                  <span className="badge">{c.required ? 'required' : 'optional'}</span>
                  <span
                    className="badge"
                    style={
                      status === 'unset'
                        ? BADGE_STYLE.misconfigured
                        : status === 'set'
                          ? { color: '#4ade80', borderColor: 'rgba(74,222,128,.4)', background: 'rgba(74,222,128,.08)' }
                          : BADGE_STYLE['not-installed']
                    }
                  >
                    {status === 'unchecked' ? 'not verified' : status}
                  </span>
                </div>
                <div style={{ color: 'var(--dim)', marginTop: 3 }}>{c.purpose}</div>
              </div>
            );
          })}
        </div>
      )}
      <p style={{ fontSize: 11, color: 'var(--faint)', fontStyle: 'italic', margin: '8px 0 0' }}>
        Names only — no value ever appears here, in the API response, or in the probe evidence below.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CapabilitiesSection — D8: curated at catalog time, NEVER presented as
// verified capabilities of a running server.
// ---------------------------------------------------------------------------

function CapabilitiesSection({ connection }: { connection: ConnectionWire }) {
  const capabilities = connection.capabilities ?? [];
  return (
    <section data-section="capabilities" data-capabilities-source={connection.capabilitiesSource} data-capability-count={capabilities.length}>
      <SectionLabel>Capabilities</SectionLabel>
      <p style={{ fontSize: 11.5, color: 'var(--faint)', margin: '0 0 10px', fontStyle: 'italic' }}>
        Declared at curation time from the upstream server&apos;s documented tool list — this is NOT a verified
        capability list of a running server (forge has no MCP client to launch and introspect one).
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
// ProbeEvidenceSection — the REAL evidence. A `misconfigured` entry shows the
// failing probe output, never a generic error string (F2 AC).
// ---------------------------------------------------------------------------

function ProbeEvidenceSection({
  connection,
  probing,
  onProbe,
}: {
  connection: ConnectionWire;
  probing: boolean;
  onProbe: () => void;
}) {
  const { probe } = connection;
  return (
    <section
      data-section="probe-evidence"
      data-probe-state={probe.state}
      data-probe-timed-out={probe.timedOut ? 'true' : 'false'}
      style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius, 8px)', padding: '16px 18px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <SectionLabel>Probe evidence</SectionLabel>
        <button type="button" className="btn" data-action="probe-connection" onClick={onProbe} disabled={probing}>
          {probing ? 'Probing…' : 'Re-check'}
        </button>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--faint)', margin: '0 0 10px', fontStyle: 'italic' }}>
        State: <strong>{probe.state}</strong>. The probe child runs with a stripped, credential-free environment
        — it verifies presence and configured-NAME presence, never that a credential actually works.
      </p>

      <div style={{ fontSize: 12, color: 'var(--dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {probe.exitCode !== undefined && (
          <div data-probe-exit-code={probe.exitCode ?? 'null'}>exit code: {probe.exitCode ?? 'null'}</div>
        )}
        {probe.installedVersion !== undefined && <div>installed version: {probe.installedVersion}</div>}
        {probe.pinnedVersion !== undefined && <div>pinned version: {probe.pinnedVersion}</div>}
        {probe.timedOut && <div>timed out</div>}
        {probe.missingConfig !== undefined && probe.missingConfig.length > 0 && (
          <div data-probe-missing-config={probe.missingConfig.join(',')}>
            missing required config: {probe.missingConfig.join(', ')}
          </div>
        )}
      </div>

      {(probe.stdout || probe.stderr) && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {probe.stdout && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--faint)' }}>stdout</div>
              <pre
                data-probe-stdout
                style={{ margin: 0, padding: '8px 10px', background: 'var(--bg-2)', borderRadius: 4, fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto' }}
              >
                {probe.stdout}
              </pre>
            </div>
          )}
          {probe.stderr && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--faint)' }}>stderr</div>
              <pre
                data-probe-stderr
                style={{ margin: 0, padding: '8px 10px', background: 'var(--bg-2)', borderRadius: 4, fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto' }}
              >
                {probe.stderr}
              </pre>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// UsedBySection — DERIVED, never declared (D-house-rule). An empty usedBy
// always reads "scanned N, found none", never "unknown, rendered empty".
// ---------------------------------------------------------------------------

function UsedBySection({ connection }: { connection: ConnectionWire }) {
  return (
    <section data-section="used-by" data-used-by-count={connection.usedBy.length}>
      <SectionLabel>Used by</SectionLabel>
      {connection.usedBy.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--faint)', fontStyle: 'italic', margin: 0 }}>
          Scanned {connection.usedByDerivation.scanned} agent{connection.usedByDerivation.scanned === 1 ? '' : 's'}{' '}
          ({connection.usedByDerivation.source}) — found none.
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {connection.usedBy.map((slug) => (
            <Link key={slug} href={`/agents/${encodeURIComponent(slug)}`} data-used-by-agent={slug} className="badge badge-agent" style={{ textDecoration: 'none' }}>
              {slug}
            </Link>
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
