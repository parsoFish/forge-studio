'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Run, Flow, PhaseLogLine } from '@/lib/studio-client';
import { drawerHeaderMeta } from '@/lib/phase-drawer-meta';
import { usePhaseLog } from '@/lib/use-phase-log';
import { derivePhaseLogPanelState } from '@/lib/phase-log-panel-view';
import { useCycleEvents } from '@/lib/use-cycle-events';
import { deriveBrainReadSummary } from '@/lib/brain-read-view';

// ---------------------------------------------------------------------------
// PhaseDrawer — right slide-in panel showing per-phase detail.
//
// Sections (each rendered only when data present):
//   Liveness · Progress (iter pips) · Delivered · Gate sub-checks
//   Artifacts · Phase log (with stderr toggle)
//   Disabled Resume/Start buttons (M3 placeholder)
// ---------------------------------------------------------------------------

// Map a run-model artifact key → the /artifact page's `type` param. The only
// shape difference is the work-items hyphenation. (M2: chips route to the
// in-UI artifact viewer, never the raw file route which 404s for the operator.)
const ARTIFACT_PAGE_TYPE: Record<string, string> = {
  plan: 'plan',
  'work-items': 'workitems',
  pr: 'pr',
  demo: 'demo',
  verdict: 'verdict',
  reflection: 'reflection',
};

interface PhaseDrawerProps {
  nodeId: string | null;
  run: Run | null;
  flow: Flow;
  onClose: () => void;
  /**
   * Which kind of hex was clicked. 'wi' = a fanOut-expanded work-item hex
   * (drawer renders in WI-scoped mode); 'phase' (default) = a phase hex.
   */
  hexKind?: 'phase' | 'wi';
  /** The work-item id when hexKind='wi' (the clicked WI hex's identity). */
  wiId?: string;
}

export function PhaseDrawer({ nodeId, run, flow, onClose, hexKind = 'phase', wiId }: PhaseDrawerProps) {
  const isOpen = nodeId !== null && run !== null;
  const isWi = hexKind === 'wi';

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const node = nodeId ? flow.nodes.find((n) => n.id === nodeId) : null;
  // WI-scoped mode (#11): the drawer surfaces the WI's own task + dependencies
  // and a per-WI log stream (filtered by work_item_id), so each fanOut dev agent
  // reads independently instead of sharing the pooled dev-loop log.
  const wiItem = isWi && wiId && run ? run.workItems?.find((w) => w.id === wiId) ?? null : null;
  const agentLabel = isWi ? (wiId ?? 'work item') : (node?.agent ?? nodeId ?? '—');
  const meta: import('@/lib/studio-client').RunPhaseMeta | null =
    nodeId && run ? (run.phaseMeta[nodeId] ?? null) : null;
  const status: string = isWi
    ? (wiItem?.status ?? 'pending')
    : nodeId && run ? (run.phases[nodeId] ?? 'pending') : 'pending';
  const cycleId = run?.id ?? '';

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 199,
            background: 'transparent',
          }}
        />
      )}
      {/* Drawer panel */}
      <div
        id="phase-drawer"
        data-drawer-open={isOpen ? 'true' : 'false'}
        data-drawer-run={run?.id ?? ''}
        data-drawer-node={nodeId ?? ''}
        data-hex-kind={hexKind}
        data-wi-id={isWi ? (wiId ?? '') : ''}
        // W7-C3 (crosscut-16): closed, the drawer was parked off-canvas by a
        // bare `right: -540` — still in the tab order (its ✕ was tab stop
        // #141, focus vanished off-screen) and read to screen readers as an
        // empty phase panel on every flow monitor. `visibility: hidden` (a
        // discrete transition — it flips AFTER the slide-out completes)
        // removes it from both; `aria-hidden` + the `inert` attribute (React
        // 18 renders the empty-string form) are the explicit a11y statement.
        aria-hidden={!isOpen}
        {...(isOpen ? {} : ({ inert: '' } as Record<string, string>))}
        style={{
          position: 'fixed',
          top: 0,
          right: isOpen ? 0 : -540,
          width: 520,
          height: '100vh',
          background: 'var(--panel)',
          borderLeft: '1px solid var(--line-2)',
          boxShadow: '-8px 0 40px rgba(0,0,0,0.55)',
          zIndex: 200,
          display: 'flex',
          flexDirection: 'column',
          visibility: isOpen ? 'visible' : 'hidden',
          transition: 'right 0.22s cubic-bezier(0.22,1,0.36,1), visibility 0.22s',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '14px 18px 10px',
            background: 'var(--panel-2)',
            borderBottom: '1px solid var(--line)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--text)',
              }}
            >
              {agentLabel}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--faint)',
              }}
            >
              {isWi ? `${nodeId ?? '—'} · work item` : (nodeId ?? '—')}
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close (Esc)"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--faint)',
              fontSize: 18,
              cursor: 'pointer',
              padding: '2px 6px',
              flexShrink: 0,
              transition: 'color 0.12s',
            }}
          >
            ✕
          </button>
        </div>

        {/* Meta row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            padding: '8px 18px',
            background: 'var(--panel-2)',
            borderBottom: '1px solid var(--line)',
            flexShrink: 0,
          }}
        >
          <StatusBadge status={status} />
          {/* W7-B7 (flows-14): a WI drawer shows the WI's OWN cost (the same
              value its hex carries as data-wi-cost-usd) and omits the
              phase-level model/retries rather than attributing the pooled
              dev-phase figures to one work item. */}
          {(() => {
            const header = drawerHeaderMeta({
              isWi,
              wiCostUsd: wiItem?.costUsd,
              phaseMeta: meta ? { costUsd: meta.costUsd, retries: meta.retries, model: meta.model } : null,
            });
            return (
              <>
                {header.model !== null && <DrawerKV label="model" value={header.model} />}
                <DrawerKV label="cost" value={header.cost} />
                {header.retries !== null && <DrawerKV label="retries" value={header.retries} />}
              </>
            );
          })()}
        </div>

        {/* Body — scrollable */}
        {isOpen && nodeId && run && (
          <DrawerBody
            nodeId={nodeId}
            run={run}
            flow={flow}
            node={node ?? null}
            meta={meta}
            status={status}
            cycleId={cycleId}
            isWi={isWi}
            wiId={wiId}
            wiItem={wiItem}
          />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// DrawerBody — all sections; rendered only when drawer is open
// ---------------------------------------------------------------------------

function DrawerBody({
  nodeId,
  run,
  flow,
  node,
  meta,
  status,
  cycleId,
  isWi,
  wiId,
  wiItem,
}: {
  nodeId: string;
  run: Run;
  flow: Flow;
  node: { agent?: string; gate?: string } | null;
  meta: NonNullable<Run['phaseMeta'][string]> | null;
  status: string;
  cycleId: string;
  isWi: boolean;
  wiId?: string;
  wiItem: NonNullable<Run['workItems']>[number] | null;
}) {
  // W7-A3 (flows-15): a node that never started has no log — don't fire a
  // guaranteed-404 fetch (console error per hex click on a queued run). Keyed
  // on the pending BOOLEAN, not the raw status, so a later active→complete
  // flip does not re-run the identity effect (Effect 2 owns live refresh).
  const pendingNode = status === 'pending';

  // forge-8vfn.5.16 (M7-C U2) — the planner's brain READ, on its own
  // surface: distinct from the plain-text "brain reads: N" line below (a
  // raw tool-use COUNT with no KB attribution, rendered for the dev node)
  // and from the Knowledge page's Ingest Activity tab (the reflector's
  // WRITE side). `useCycleEvents` guards an empty cycleId itself (the
  // effect stays inert until a real id arrives).
  const cycleEvents = useCycleEvents(cycleId);
  const brainReadSummary = deriveBrainReadSummary(cycleEvents);

  // forge-7wc: the log panel's own fetch lifecycle (identity fetch + live
  // refresh, including the fix for Effect 1's swallowed rejections) lives in
  // `usePhaseLog` — see that hook's header for the full defect writeup.
  const { logLines, logLoading, logError, stderrOnly, setStderrOnly } = usePhaseLog({
    run, nodeId, cycleId, isWi, wiId, pendingNode,
  });

  const lastProgressAt = meta?.lastProgressAt;
  const livenessColor = useLivenessColor(lastProgressAt, status);
  const livenessText = useLivenessText(lastProgressAt, status);

  // Artifact chips
  const artifactsReady = run.artifactsReady;
  const artifactEntries = Object.entries(artifactsReady) as Array<[string, 'view' | 'gate']>;

  // The inbound artifact this node was handed (the edge feeding it) — its input.
  const inboundArtifact = flow.edges.find((e) => e.to === nodeId)?.artifact;

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      }}
    >
      {/* ---- INPUT / TASK (#11 — the node's bound input + its job) ---- */}
      <DrawerSection title={isWi ? 'Work item' : 'Input'}>
        <div
          data-section="hex-input"
          style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}
        >
          {isWi ? (
            <>
              <KvRow label="id" value={wiId ?? '—'} />
              {wiItem?.task && (
                <div data-hex-task style={{ color: 'var(--dim)', lineHeight: 1.55 }}>
                  {wiItem.task}
                </div>
              )}
              {wiItem?.dependsOn && wiItem.dependsOn.length > 0 && (
                <KvRow label="depends on" value={wiItem.dependsOn.join(', ')} />
              )}
            </>
          ) : (
            <>
              {node?.agent && <KvRow label="agent" value={node.agent} />}
              {inboundArtifact && <KvRow label="input artifact" value={inboundArtifact} />}
              {node?.gate && <KvRow label="gate" value={node.gate} />}
            </>
          )}
        </div>
      </DrawerSection>

      {/* ---- LIVENESS ---- */}
      {meta?.lastProgressAt != null && (
        <DrawerSection title="Liveness">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                flexShrink: 0,
                background:
                  livenessColor === 'green'
                    ? 'var(--green)'
                    : livenessColor === 'amber'
                    ? 'var(--amber)'
                    : 'var(--red)',
                boxShadow:
                  livenessColor === 'green'
                    ? '0 0 5px rgba(74,222,128,0.6)'
                    : livenessColor === 'amber'
                    ? '0 0 5px rgba(251,191,36,0.5)'
                    : '0 0 5px rgba(248,113,113,0.5)',
              }}
            />
            <span style={{ color: 'var(--dim)' }}>
              last tool progress: <strong>{livenessText}</strong>
            </span>
          </div>
          {meta?.wedged && (
            <div
              style={{
                marginTop: 8,
                padding: '8px 12px',
                background: 'rgba(248,113,113,0.08)',
                border: '1px solid rgba(248,113,113,0.35)',
                borderRadius: 6,
                fontSize: 11.5,
                color: 'var(--red)',
                lineHeight: 1.5,
              }}
            >
              No tool progress for an extended period — heartbeats still firing.
              This is the failure mode that once ate 33 hours.
            </div>
          )}
        </DrawerSection>
      )}

      {/* ---- PROGRESS (iter pips) ---- */}
      {meta?.iter != null && meta?.iterBudget != null && (
        <DrawerSection title="Progress">
          <div style={{ fontSize: 12.5, color: 'var(--dim)', marginBottom: 6 }}>
            iteration {meta.iter} of {meta.iterBudget}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {Array.from({ length: meta.iterBudget }, (_, i) => {
              const isDone   = i < (meta?.iter ?? 0) - 1;
              const isActive = i === (meta?.iter ?? 0) - 1;
              return (
                <div
                  key={i}
                  style={{
                    width: 12,
                    height: 6,
                    borderRadius: 3,
                    background: isDone
                      ? 'var(--ember)'
                      : isActive
                      ? 'var(--green)'
                      : 'var(--line-2)',
                  }}
                />
              );
            })}
          </div>
          {meta.brainReads != null && (
            <div
              style={{
                marginTop: 6,
                fontSize: 11.5,
                color: 'var(--faint)',
              }}
            >
              brain reads: {meta.brainReads} — intent comes encoded in the work
              item (correct behaviour, not a bug)
            </div>
          )}
        </DrawerSection>
      )}

      {/* ---- BRAIN READS (forge-8vfn.5.16, M7-C U2) ---- the planner's own
           read, naming the KB and how much, not a bare count. Scoped to the
           project-manager node ('pm' — studio/flows/forge-architect/flow.yaml)
           since that is the phase real brain.read events carry today. */}
      {!isWi && nodeId === 'pm' && brainReadSummary.length > 0 && (
        <DrawerSection title="Brain reads">
          {brainReadSummary.map((row) => (
            <div
              key={row.kbId}
              data-brain-read-kb={row.kbId}
              data-brain-read-count={row.count}
              style={{ fontSize: 12.5, color: 'var(--dim)', marginBottom: 4 }}
            >
              {row.kbId}: {row.count} theme{row.count === 1 ? '' : 's'} read
            </div>
          ))}
        </DrawerSection>
      )}

      {/* ---- DELIVERED ---- M5: a WI hex shows its OWN delta, not the aggregate */}
      {(() => {
        const delivered = isWi ? wiItem?.delivered : meta?.delivered;
        if (!delivered) return null;
        return (
        <DrawerSection title="Delivered">
          <div
            style={{
              display: 'flex',
              gap: 16,
              alignItems: 'center',
              padding: '10px 14px',
              background: 'rgba(74,222,128,0.07)',
              border: '1px solid rgba(74,222,128,0.25)',
              borderRadius: 7,
              marginTop: 4,
            }}
          >
            <DeliveredStat value={delivered.files} label="files" />
            <div style={{ width: 1, height: 28, background: 'rgba(74,222,128,0.2)' }} />
            <DeliveredStat value={`+${delivered.insertions}`} label="lines" />
            <div style={{ width: 1, height: 28, background: 'rgba(74,222,128,0.2)' }} />
            <DeliveredStat value={delivered.commits} label="commits" />
          </div>
        </DrawerSection>
        );
      })()}

      {/* ---- ARTIFACTS ---- */}
      {artifactEntries.length > 0 && (
        <DrawerSection title="Artifacts">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {artifactEntries.map(([type, mode]) => (
              <ArtifactChip
                key={type}
                type={type}
                mode={mode}
                cycleId={cycleId}
              />
            ))}
          </div>
        </DrawerSection>
      )}

      {/* Resume / Start live on the monitor itself (data-action="start-run" /
          "resume-run") — no duplicate placeholder controls in the drawer. */}

      {/* ---- PHASE LOG ---- (precedes gate sub-checks so it is always reachable
          without scrolling past a potentially long gate-check list) */}
      <DrawerSection title="Phase log" flex>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11.5,
            color: 'var(--dim)',
            marginBottom: 6,
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={stderrOnly}
              onChange={(e) => setStderrOnly(e.target.checked)}
            />
            stderr only
          </label>
          {logLoading && (
            <span style={{ fontSize: 10, color: 'var(--faint)' }}>loading…</span>
          )}
        </div>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            fontFamily: 'var(--font-mono)',
            fontSize: 11.5,
            lineHeight: 1.65,
          }}
        >
          {(() => {
            // forge-7wc: error is a state DISTINCT from empty (never merged
            // into it — see phase-log-panel-view.ts's header for why).
            const panelState = derivePhaseLogPanelState({ loading: logLoading, error: logError, lineCount: logLines.length });
            if (panelState.kind === 'loading') return null; // the "loading…" indicator above already says so
            if (panelState.kind === 'error') {
              return (
                <div data-component="phase-log-error" style={{ padding: '16px 0', color: 'var(--red)', fontSize: 12 }}>
                  {panelState.message}
                </div>
              );
            }
            if (panelState.kind === 'empty') {
              return (
                <div style={{ padding: '16px 0', color: 'var(--faint)', fontStyle: 'italic', fontSize: 12 }}>
                  no log lines for this phase
                </div>
              );
            }
            return logLines.slice(0, 200).map((line, i) => <LogRow key={i} line={line} />);
          })()}
        </div>
      </DrawerSection>

      {/* ---- GATE SUB-CHECKS ---- (capped to avoid pushing the log off-screen) */}
      {meta?.gateChecks && meta.gateChecks.length > 0 && (
        <DrawerSection title="Gate sub-checks">
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              maxHeight: 220,
              overflowY: 'auto',
            }}
          >
            {meta.gateChecks.map((check) => (
              <div
                key={check.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  padding: '5px 10px',
                  borderRadius: 5,
                  background: 'var(--panel-2)',
                  borderLeft: `2px solid ${check.pass ? 'var(--green)' : 'var(--red)'}`,
                  color: check.pass ? 'inherit' : 'var(--red)',
                }}
              >
                <span style={{ fontSize: 13, flexShrink: 0 }}>
                  {check.pass ? '✓' : '✗'}
                </span>
                <span>{check.id.replace(/_/g, ' ')}</span>
                {check.detail && (
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--faint)',
                      marginLeft: 'auto',
                    }}
                  >
                    {check.detail}
                  </span>
                )}
              </div>
            ))}
          </div>
        </DrawerSection>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DrawerSection({
  title,
  children,
  flex,
}: {
  title: string;
  children: React.ReactNode;
  flex?: boolean;
}) {
  return (
    <div
      style={{
        padding: '12px 18px',
        borderBottom: '1px solid var(--line)',
        flexShrink: flex ? 0 : undefined,
        flex: flex ? 1 : undefined,
        display: flex ? 'flex' : undefined,
        flexDirection: flex ? 'column' : undefined,
        minHeight: flex ? 0 : undefined,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--faint)',
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function DrawerKV({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--faint)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--text)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'complete' ? 'badge-kb' :
    status === 'active' || status === 'gated' ? 'badge-agent' :
    'badge-dim';
  return (
    <span className={`badge ${cls}`} style={{ fontSize: 11 }}>
      {status}
    </span>
  );
}

function DeliveredStat({ value, label }: { value: string | number; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 16,
          fontWeight: 700,
          color: 'var(--green)',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          fontFamily: 'var(--font-display)',
          color: 'var(--faint)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
      </div>
    </div>
  );
}

function ArtifactChip({
  type,
  mode,
  cycleId,
}: {
  type: string;
  mode: 'view' | 'gate';
  cycleId: string;
}) {
  const isGate = mode === 'gate';
  const pageType = ARTIFACT_PAGE_TYPE[type] ?? type;

  // Both gate + view chips open the in-UI artifact viewer (a gate chip lands on
  // the verdict gate; a view chip renders the artifact). Never the raw file route.
  // 7.6.62 — the gate branch hardcoded `type=verdict` and threw away the
  // `pageType` it was handed, sending a plan-gated run to a verdict it has not.
  const href = `/artifact?run=${encodeURIComponent(cycleId)}&type=${pageType}&mode=${isGate ? 'gate' : 'view'}`;

  const sharedStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '4px 11px',
    borderRadius: 5,
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    textDecoration: 'none',
  };

  if (!href) {
    // not-ready or no link
    return (
      <span
        style={{
          ...sharedStyle,
          border: '1px solid var(--line-2)',
          color: 'var(--dim)',
          cursor: 'default',
          opacity: 0.6,
        }}
      >
        {type}
      </span>
    );
  }

  if (isGate) {
    return (
      <Link
        href={href}
        style={{
          ...sharedStyle,
          color: 'var(--ember)',
          borderColor: 'rgba(255,158,74,0.5)',
          background: 'rgba(255,158,74,0.1)',
          border: '1px solid rgba(255,158,74,0.5)',
          animation: 'ember-pulse-chip 1.6s ease-in-out infinite',
        }}
      >
        ⚑ {type} — needs you
      </Link>
    );
  }

  // Same destination shape as the gate chip above (/artifact?run=…&type=…) —
  // same-tab client-side routing, not a new-tab hard navigation (W6-IA-6).
  return (
    <Link
      href={href}
      style={{
        ...sharedStyle,
        color: 'var(--c-artifact)',
        border: '1px solid rgba(251,191,36,0.4)',
        background: 'rgba(251,191,36,0.07)',
      }}
    >
      {type}
    </Link>
  );
}

function LogRow({ line }: { line: PhaseLogLine }) {
  const colorMap: Record<string, string> = {
    info:      'var(--dim)',
    tool:      'var(--steel)',
    cost:      'var(--amber)',
    stderr:    'var(--red)',
    retry:     'var(--amber)',
    reasoning: 'var(--dim)',
  };

  const ts = new Date(line.at).toTimeString().slice(0, 8);
  const isReasoning = line.kind === 'reasoning';
  // M3: rows with detail (reasoning text, tool inputs, raw metadata) expand so
  // the operator can dig into what the agent actually did.
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(line.detail && line.detail.trim());

  return (
    <div data-log-kind={line.kind} {...(hasDetail ? { 'data-has-detail': 'true' } : {})}>
    <div
      style={{ display: 'flex', gap: 10, minHeight: '1.65em', cursor: hasDetail ? 'pointer' : 'default' }}
      onClick={hasDetail ? () => setOpen((o) => !o) : undefined}
      data-action={hasDetail ? 'toggle-log-detail' : undefined}
    >
      <span style={{ color: 'var(--faint)', flexShrink: 0, minWidth: 60 }}>
        {hasDetail ? (open ? '▾ ' : '▸ ') : ''}{ts}
      </span>
      <span
        style={{
          flex: 1,
          color: colorMap[line.kind] ?? 'var(--dim)',
          ...(isReasoning ? { fontStyle: 'italic' } : {}),
          ...(line.kind === 'stderr'
            ? { background: 'rgba(248,113,113,0.07)', padding: '0 4px', borderRadius: 3 }
            : {}),
        }}
      >
        {isReasoning && (
          <span
            style={{
              display: 'inline-block',
              marginRight: 6,
              padding: '0 5px',
              borderRadius: 3,
              background: 'rgba(129,140,248,0.15)',
              border: '1px solid rgba(129,140,248,0.4)',
              fontSize: 9.5,
              letterSpacing: '0.06em',
              verticalAlign: 'middle',
              fontStyle: 'normal',
            }}
          >
            THINKING
          </span>
        )}
        {line.text}
        {line.kind === 'retry' && (
          <span
            style={{
              display: 'inline-block',
              marginLeft: 6,
              padding: '0 5px',
              borderRadius: 3,
              background: 'rgba(251,191,36,0.15)',
              border: '1px solid rgba(251,191,36,0.4)',
              fontSize: 9.5,
              letterSpacing: '0.06em',
              verticalAlign: 'middle',
            }}
          >
            TRANSIENT
          </span>
        )}
      </span>
    </div>
    {hasDetail && open && (
      <pre
        data-log-detail=""
        style={{
          margin: '2px 0 6px 70px', padding: '8px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 5,
          fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--dim)', maxHeight: 320, overflow: 'auto',
        }}
      >
        {line.detail}
      </pre>
    )}
    </div>
  );
}

function KvRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <span style={{ color: 'var(--faint)', minWidth: 92, flexShrink: 0 }} data-kv-label={label}>
        {label}
      </span>
      <span style={{ color: 'var(--dim)', wordBreak: 'break-word' }} data-kv-value="">
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Liveness helpers
// ---------------------------------------------------------------------------

function useLivenessColor(
  lastProgressAt: string | undefined,
  status: string,
): 'green' | 'amber' | 'red' {
  if (!lastProgressAt || status === 'complete' || status === 'pending') return 'green';
  const ageMs = Date.now() - new Date(lastProgressAt).getTime();
  const ageMin = ageMs / 60_000;
  if (ageMin < 5) return 'green';
  if (ageMin < 30) return 'amber';
  return 'red';
}

function useLivenessText(
  lastProgressAt: string | undefined,
  status: string,
): string {
  if (!lastProgressAt) return 'unknown';
  if (status === 'complete') return 'complete';
  const ageMs = Date.now() - new Date(lastProgressAt).getTime();
  const ageMin = Math.floor(ageMs / 60_000);
  if (ageMin === 0) return 'live';
  if (ageMin >= 60) {
    const h = Math.floor(ageMin / 60);
    const m = ageMin % 60;
    return `${h}h ${m}m ago`;
  }
  return `${ageMin}m ago`;
}
