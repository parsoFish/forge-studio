'use client';

import { useEffect, useState } from 'react';
import { fetchPhaseLog } from '@/lib/studio-client';
import type { Run, Flow, PhaseLogLine } from '@/lib/studio-client';

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
          transition: 'right 0.22s cubic-bezier(0.22,1,0.36,1)',
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
          {meta?.model && (
            <DrawerKV label="model" value={meta.model} />
          )}
          <DrawerKV
            label="cost"
            value={meta ? `$${meta.costUsd.toFixed(2)}` : '—'}
          />
          <DrawerKV
            label="retries"
            value={meta ? String(meta.retries) : '0'}
          />
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
  const [logLines, setLogLines] = useState<PhaseLogLine[]>([]);
  const [stderrOnly, setStderrOnly] = useState(false);
  const [logLoading, setLogLoading] = useState(false);

  // Effect 1 — identity: clear + fetch on identity change (new node / filter toggle)
  useEffect(() => {
    const signal = { cancelled: false };
    setLogLoading(true);
    setLogLines([]);
    void (async () => {
      try {
        const lines = await fetchPhaseLog(cycleId, nodeId, stderrOnly, isWi ? wiId : undefined);
        if (!signal.cancelled) setLogLines(lines);
      } finally {
        if (!signal.cancelled) setLogLoading(false);
      }
    })();
    return () => { signal.cancelled = true; };
  }, [cycleId, nodeId, stderrOnly, isWi, wiId]);

  const lastProgressAt = meta?.lastProgressAt;

  // Effect 2 — live refresh: re-fetch IN PLACE (no flicker) while the phase is
  // still running, keyed on lastProgressAt so we refetch on each tool-progress
  // tick. Terminal phases (complete/failed) keep their final snapshot.
  const isTerminal = status === 'complete' || status === 'failed';
  useEffect(() => {
    if (!lastProgressAt || isTerminal) return;
    const signal = { cancelled: false };
    void (async () => {
      try {
        const lines = await fetchPhaseLog(cycleId, nodeId, stderrOnly, isWi ? wiId : undefined);
        // Replace lines in place — do NOT setLogLines([]) first to avoid flicker.
        if (!signal.cancelled) setLogLines(lines);
      } catch { /* best-effort */ }
    })();
    return () => { signal.cancelled = true; };
  }, [lastProgressAt, cycleId, nodeId, stderrOnly, isWi, wiId, isTerminal]);
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

      {/* ---- GATE SUB-CHECKS ---- */}
      {meta?.gateChecks && meta.gateChecks.length > 0 && (
        <DrawerSection title="Gate sub-checks">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
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

      {/* ---- PHASE LOG ---- */}
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
          {logLines.length === 0 && !logLoading ? (
            <div
              style={{
                padding: '16px 0',
                color: 'var(--faint)',
                fontStyle: 'italic',
                fontSize: 12,
              }}
            >
              no log lines for this phase
            </div>
          ) : (
            logLines.slice(0, 200).map((line, i) => (
              <LogRow key={i} line={line} />
            ))
          )}
        </div>
      </DrawerSection>
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
  const href = isGate
    ? `/artifact?run=${encodeURIComponent(cycleId)}&type=verdict&mode=gate`
    : `/artifact?run=${encodeURIComponent(cycleId)}&type=${pageType}&mode=view`;

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
      <a
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
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{
        ...sharedStyle,
        color: 'var(--c-artifact)',
        border: '1px solid rgba(251,191,36,0.4)',
        background: 'rgba(251,191,36,0.07)',
      }}
    >
      {type}
    </a>
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
