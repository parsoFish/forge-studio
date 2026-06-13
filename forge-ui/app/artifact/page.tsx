'use client';

/**
 * Unified artifact viewer — /artifact?run=<id>&type=<kind>&mode=<gate|view>
 *
 * URL params:
 *   run  — runId (required)
 *   type — plan | workitems | pr | demo | verdict | reflection
 *   mode — gate | view (auto-inferred if absent)
 *
 * Gate-bar wiring:
 *   plan  → GateBar  (gateId='plan', approve disabled until decisions resolved)
 *   demo  → GateBar  (gateId='verdict', decisions always resolved for demo)
 *   verdict → ReviewVerdictForm (the harness depends on its data-* intact)
 *   workitems / pr / reflection → view only (no gate bar)
 *
 * data-* contract (main):
 *   data-page="flows", data-page-ready, data-run, data-artifact-type,
 *   data-mode, data-gate-state
 *
 * Preserved from existing components:
 *   data-section="demo-evaluation" data-ac-verdict (DemoComparison)
 *   data-component="verdict-form" data-form-state data-action="approve-and-merge"|"send-back" (ReviewVerdictForm)
 *   data-section="plan-gate" data-decisions-resolved (PlanGate — not used here;
 *     plan in this viewer uses PlanRenderer + GateBar to avoid duplicate
 *     architect-session plumbing; the fold-in task (M4-4) will wire the redirect)
 */

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

import { StudioNav } from '@/components/StudioNav';
import { ArtifactTrail, type ArtifactKey } from '@/components/studio/artifact/ArtifactTrail';
import { GateBar, type GateState } from '@/components/studio/artifact/GateBar';
import { PlanRenderer, type PlanDoc } from '@/components/studio/artifact/PlanRenderer';
import { WorkItemsRenderer, type WorkItemEntry } from '@/components/studio/artifact/WorkItemsRenderer';
import { PrRenderer, type PrDoc } from '@/components/studio/artifact/PrRenderer';
import { VerdictRenderer, type VerdictDoc } from '@/components/studio/artifact/VerdictRenderer';
import { ReflectionRenderer, type ReflectionDoc } from '@/components/studio/artifact/ReflectionRenderer';
import { DemoComparison } from '@/components/DemoComparison';
import { ReviewVerdictForm } from '@/components/ReviewVerdictForm';

import { fetchRun, type Run } from '@/lib/studio-client';
import { fetchDemoModel, fetchWorkItem, fetchReflection, type DemoModel, type ReflectionData } from '@/lib/bridge-client';
import { resolveBridgeUrl } from '@/lib/bridge-client';

// ---------------------------------------------------------------------------
// Types for artifact docs fetched from the bridge
// ---------------------------------------------------------------------------

type ArtifactDoc =
  | { type: 'plan';       doc: PlanDoc }
  | { type: 'workitems';  doc: WorkItemEntry[] }
  | { type: 'pr';         doc: PrDoc }
  | { type: 'demo';       doc: DemoModel }
  | { type: 'verdict';    doc: VerdictDoc }
  | { type: 'reflection'; doc: ReflectionDoc }
  | { type: 'empty' };

// ---------------------------------------------------------------------------
// Display metadata
// ---------------------------------------------------------------------------

const TYPE_META: Record<ArtifactKey, { title: string; filename: string }> = {
  plan:       { title: 'Architect Plan',  filename: 'PLAN.md' },
  workitems:  { title: 'Work Items',      filename: 'work-items/*.md' },
  pr:         { title: 'Pull Request',    filename: 'PR' },
  demo:       { title: 'Demo Evidence',   filename: 'demo-evidence/' },
  verdict:    { title: 'Verdict',         filename: 'verdict.json' },
  reflection: { title: 'Reflection',      filename: 'reflection.md' },
};

function isValidType(t: string): t is ArtifactKey {
  return ['plan', 'workitems', 'pr', 'demo', 'verdict', 'reflection'].includes(t);
}

// ---------------------------------------------------------------------------
// Fetch helpers for each artifact type
// ---------------------------------------------------------------------------

async function fetchArtifactDoc(
  runId: string,
  type: ArtifactKey,
  run: Run | null,
): Promise<ArtifactDoc> {
  try {
    if (type === 'demo') {
      // cycleId ~ runId for the existing bridge routes
      const model = await fetchDemoModel(runId);
      if (!model) return { type: 'empty' };
      return { type: 'demo', doc: model };
    }

    if (type === 'workitems') {
      // Fetch the work-items snapshot list then fetch each spec
      const wiList = run?.workItems ?? [];
      if (wiList.length === 0) {
        // Try fetching known WI ids from the run's phase keys
        // Fall through to empty
        return { type: 'empty' };
      }
      const items = await Promise.all(
        wiList.map(async (wi) => {
          const detail = await fetchWorkItem(runId, wi.id);
          const entry: WorkItemEntry = {
            id: wi.id,
            title: detail?.body ? extractTitle(detail.body) : wi.id,
            status: wi.status,
            ac: detail?.acceptance_criteria?.map(
              (a) => `Given ${a.given}, when ${a.when}, then ${a.then}`,
            ),
          };
          return entry;
        }),
      );
      if (items.every((i) => i.title === i.id)) return { type: 'empty' };
      return { type: 'workitems', doc: items };
    }

    if (type === 'reflection') {
      const refl: ReflectionData | null = await fetchReflection(runId);
      if (!refl) return { type: 'empty' };
      // ReflectionData from bridge-client has questions/answered,
      // not the wentWell/friction/lessons shape. The reflection artifact
      // proper lives in the cycle log. Fetch it via the artifact route.
      const doc = await fetchJsonArtifact<ReflectionDoc>(runId, 'reflection.json');
      if (doc) return { type: 'reflection', doc };
      // Degrade gracefully: return empty shape
      return { type: 'reflection', doc: {} };
    }

    if (type === 'pr') {
      // Fetch pr-description.md as text
      const base = await resolveBridgeUrl();
      if (!base) return { type: 'empty' };
      const res = await fetch(`${base}/api/artifact/${encodeURIComponent(runId)}/pr-description.md`);
      if (!res.ok) return { type: 'empty' };
      const text = await res.text();
      const prDoc = parsePrDescription(text);
      return { type: 'pr', doc: prDoc };
    }

    if (type === 'plan') {
      // Try fetching plan.json first; fall back to PLAN.md existence check
      const planJson = await fetchJsonArtifact<PlanDoc>(runId, 'plan.json');
      if (planJson) return { type: 'plan', doc: planJson };
      // No structured plan JSON — return empty so the renderer shows fallback
      return { type: 'empty' };
    }

    if (type === 'verdict') {
      const verdictJson = await fetchJsonArtifact<VerdictDoc>(runId, 'verdict.json');
      if (verdictJson) return { type: 'verdict', doc: verdictJson };
      return { type: 'empty' };
    }
  } catch {
    // fall through to empty
  }
  return { type: 'empty' };
}

async function fetchJsonArtifact<T>(runId: string, filename: string): Promise<T | null> {
  try {
    const base = await resolveBridgeUrl();
    if (!base) return null;
    const res = await fetch(`${base}/api/artifact/${encodeURIComponent(runId)}/${encodeURIComponent(filename)}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function extractTitle(body: string): string {
  // First line of the body or first heading
  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.replace(/^#+\s*/, '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function parsePrDescription(text: string): PrDoc {
  // Extract key fields from a GitHub PR description markdown
  // Heuristic: look for title on first heading, body is the rest
  const lines = text.split('\n');
  let title = '';
  let body = text;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!title && line.startsWith('#')) {
      title = line.replace(/^#+\s*/, '');
      body = lines.slice(i + 1).join('\n').trim();
      break;
    }
  }
  return { title: title || undefined, body };
}

// ---------------------------------------------------------------------------
// View-mode approval stamp strip
// ---------------------------------------------------------------------------

function ViewStampStrip({ verdictDoc }: { verdictDoc: VerdictDoc | null }) {
  if (!verdictDoc) return null;
  const isApprove = verdictDoc.decision !== 'send-back';
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 16px',
      marginBottom: 20,
      background: isApprove ? 'rgba(74,222,128,.06)' : 'rgba(248,113,113,.06)',
      border: `1px solid ${isApprove ? 'rgba(74,222,128,.2)' : 'rgba(248,113,113,.2)'}`,
      borderRadius: 'var(--radius-sm)',
      fontSize: 13,
      color: isApprove ? 'var(--green)' : 'var(--red)',
    }}>
      <span style={{ fontSize: 16 }}>{isApprove ? '✓' : '↩'}</span>
      <span>{isApprove ? 'Approved' : 'Returned'}</span>
      {verdictDoc.by && (
        <span style={{ color: 'var(--dim)' }}>
          by {verdictDoc.by}{verdictDoc.at ? ` · ${verdictDoc.at}` : ''}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

const PHASE_FOR_TYPE: Record<ArtifactKey, string> = {
  plan:       'Architect',
  workitems:  'Project Manager',
  pr:         'Unifier',
  demo:       'Reviewer',
  verdict:    'Reviewer',
  reflection: 'Reflector',
};

function EmptyState({ type, flowId }: { type: ArtifactKey; flowId?: string }) {
  const phase = PHASE_FOR_TYPE[type];
  const backHref = flowId ? `/flows/${encodeURIComponent(flowId)}` : '/';
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 320,
      gap: 16,
      textAlign: 'center',
      padding: 40,
    }}>
      <div style={{
        width: 72,
        height: 80,
        clipPath: 'var(--hex-clip)',
        background: 'var(--panel-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 28,
      }}>
        ◇
      </div>
      <h2 style={{ fontSize: 18, color: 'var(--text)' }}>Artifact not yet produced</h2>
      <p style={{ fontSize: 13.5, color: 'var(--dim)', maxWidth: 440, lineHeight: 1.6, margin: 0 }}>
        This <strong>{type}</strong> artifact has not been produced yet — the{' '}
        <strong>{phase}</strong> phase will emit it when this run reaches that stage.
      </p>
      <Link
        href={backHref}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 16px',
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 13,
          color: 'var(--dim)',
          textDecoration: 'none',
        }}
      >
        ← Back to monitor
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page — inner (uses useSearchParams, must be inside Suspense)
// ---------------------------------------------------------------------------

function ArtifactPageInner() {
  const params = useSearchParams();
  const runId    = params.get('run') ?? '';
  const typeRaw  = params.get('type') ?? 'plan';
  const modeParam = params.get('mode');

  const type: ArtifactKey = isValidType(typeRaw) ? typeRaw : 'plan';

  const [run,        setRun]        = useState<Run | null>(null);
  const [artifact,   setArtifact]   = useState<ArtifactDoc | null>(null);
  const [verdictDoc, setVerdictDoc] = useState<VerdictDoc | null>(null);
  const [ready,      setReady]      = useState(false);
  const [gateState,  setGateState]  = useState<GateState>('idle');
  // For plan gate-mode: track whether all decisions are resolved
  const [decisionsResolved, setDecisionsResolved] = useState(false);

  const meta = TYPE_META[type];

  // Derive mode: auto-infer when not specified
  const mode = (modeParam === 'gate' || modeParam === 'view')
    ? modeParam
    : (() => {
        if (!run) return 'view';
        const ready = run.artifactsReady[type === 'workitems' ? 'work-items' : type as keyof typeof run.artifactsReady];
        if (ready === 'gate') return 'gate';
        return 'view';
      })();

  const isGateMode = mode === 'gate';

  // Gate bar: plan + demo; verdict uses ReviewVerdictForm
  const showGateBar = isGateMode && (type === 'plan' || type === 'demo');
  const gateId = type === 'plan' ? 'plan' : 'verdict';

  // Gate bar hint text
  const gateLabel = 'This run is blocked on you';
  const gateHint = type === 'plan'
    ? 'Resolve all design decisions, then approve the plan to continue.'
    : 'Review the demo evidence above, then approve or send back.';

  // Load run + artifact
  const load = useCallback(async (signal: { cancelled: boolean }) => {
    if (!runId) { setReady(true); return; }
    try {
      const [fetchedRun] = await Promise.all([fetchRun(runId)]);
      if (signal.cancelled) return;
      setRun(fetchedRun);

      const artifactDoc = await fetchArtifactDoc(runId, type, fetchedRun);
      if (signal.cancelled) return;
      setArtifact(artifactDoc);

      // Also fetch verdict doc for view-mode stamp (when type != verdict)
      if (type !== 'verdict' && mode !== 'gate') {
        const vd = await fetchJsonArtifact<VerdictDoc>(runId, 'verdict.json');
        if (!signal.cancelled) setVerdictDoc(vd);
      }
    } catch {
      // keep defaults — reach page-ready on error
    } finally {
      if (!signal.cancelled) setReady(true);
    }
  }, [runId, type, mode]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const signal = { cancelled: false };
    setReady(false);
    setArtifact(null);
    void load(signal);
    return () => { signal.cancelled = true; };
  }, [load]);

  // For plan gate-mode, decisions start as unresolved only if doc has
  // unresolved decisions. demo gate-mode is always resolved.
  useEffect(() => {
    if (type === 'demo') {
      setDecisionsResolved(true);
    } else if (type === 'plan' && artifact?.type === 'plan') {
      const decisions = artifact.doc.decisions ?? [];
      const hasUnresolved = decisions.some((d) => !d.chosen);
      setDecisionsResolved(!hasUnresolved);
    } else {
      setDecisionsResolved(true);
    }
  }, [type, artifact]);

  // Back-to-monitor link
  const flowId = run?.flowId;
  const monitorHref = flowId
    ? `/flows/${encodeURIComponent(flowId)}`
    : '/';

  // Status pill
  const statusPill = run?.status ?? null;
  const pillColor = {
    gated:    { color: 'var(--amber)', border: 'rgba(251,191,36,.4)', bg: 'rgba(251,191,36,.08)' },
    active:   { color: 'var(--ember)', border: 'rgba(255,158,74,.4)', bg: 'rgba(255,158,74,.08)' },
    complete: { color: 'var(--green)', border: 'rgba(74,222,128,.4)', bg: 'rgba(74,222,128,.08)' },
    failed:   { color: 'var(--red)',   border: 'rgba(248,113,113,.4)', bg: 'rgba(248,113,113,.08)' },
    planned:  { color: 'var(--faint)', border: 'var(--line-2)', bg: 'var(--panel-2)' },
  }[statusPill ?? 'planned'] ?? { color: 'var(--faint)', border: 'var(--line-2)', bg: 'var(--panel-2)' };

  // artifactsReady — normalise 'work-items' key to 'workitems' for the trail
  const artifactsReadyForTrail: Partial<Record<ArtifactKey, 'view' | 'gate'>> = {};
  if (run?.artifactsReady) {
    const ar = run.artifactsReady as Record<string, 'view' | 'gate'>;
    for (const [k, v] of Object.entries(ar)) {
      const key = k === 'work-items' ? 'workitems' : k;
      if (isValidType(key)) artifactsReadyForTrail[key as ArtifactKey] = v;
    }
  }

  return (
    <div
      data-page="flows"
      data-page-ready={ready ? 'true' : 'false'}
      data-run={runId}
      data-artifact-type={type}
      data-mode={mode}
      data-gate-state={gateState}
      style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: showGateBar ? 120 : 40 }}
    >
      <StudioNav />

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 28px' }}>
        {/* Breadcrumb */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12.5,
          color: 'var(--faint)',
          padding: '18px 0 0',
          fontFamily: 'var(--font-mono)',
        }}>
          <Link href="/" style={{ color: 'var(--dim)', textDecoration: 'none' }}>Forge Studio</Link>
          <span style={{ color: 'var(--line-2)' }}>/</span>
          {flowId ? (
            <Link href={monitorHref} style={{ color: 'var(--dim)', textDecoration: 'none' }}>
              {run?.flowId ?? 'flow'}
            </Link>
          ) : (
            <span style={{ color: 'var(--dim)' }}>flow</span>
          )}
          <span style={{ color: 'var(--line-2)' }}>/</span>
          <span>{runId || '—'}</span>
          <span style={{ color: 'var(--line-2)' }}>/</span>
          <span style={{ color: 'var(--c-artifact)' }}>{type.toUpperCase()}</span>
          <a
            href={monitorHref}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--faint)',
              textDecoration: 'none',
              marginLeft: 'auto',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--line)',
            }}
          >
            ← back to monitor
          </a>
        </div>

        {/* Artifact header */}
        <div style={{ padding: '24px 0 20px', borderBottom: '1px solid var(--line)', marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 10 }}>
            <div>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 26,
                fontWeight: 700,
                lineHeight: 1.2,
                color: 'var(--text)',
                letterSpacing: '-0.01em',
              }}>
                {meta.title}
              </div>
            </div>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--c-artifact)',
              background: 'rgba(251,191,36,.1)',
              border: '1px solid rgba(251,191,36,.3)',
              borderRadius: 4,
              padding: '3px 8px',
              marginTop: 5,
              whiteSpace: 'nowrap',
            }}>
              {meta.filename}
            </span>
          </div>

          {/* Run context */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12.5, color: 'var(--dim)', flexWrap: 'wrap' }}>
            {run?.initiative && <span>{run.initiative}</span>}
            {run && run.costUsd > 0 && (
              <span style={{ color: 'var(--amber)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                ${run.costUsd.toFixed(2)}
              </span>
            )}
            {statusPill && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '2px 9px',
                borderRadius: 999,
                fontSize: 11.5,
                fontFamily: 'var(--font-display)',
                fontWeight: 600,
                border: '1px solid',
                color: pillColor.color,
                borderColor: pillColor.border,
                background: pillColor.bg,
              }}>
                {statusPill}
              </span>
            )}
          </div>

          {/* Artifact trail */}
          <ArtifactTrail
            runId={runId}
            currentType={type}
            artifactsReady={artifactsReadyForTrail}
          />
        </div>

        {/* Content */}
        <div>
          {!ready ? (
            <div style={{ fontSize: 13, color: 'var(--faint)', padding: '40px 0' }}>Loading…</div>
          ) : !artifact || artifact.type === 'empty' ? (
            <EmptyState type={type} flowId={flowId} />
          ) : (
            <>
              {/* View-mode approval stamp (skip for verdict — it IS the verdict) */}
              {!isGateMode && type !== 'verdict' && verdictDoc && (
                <ViewStampStrip verdictDoc={verdictDoc} />
              )}

              {/* Type-specific renderer */}
              {artifact.type === 'plan' && (
                <PlanRenderer
                  doc={artifact.doc}
                  gateMode={isGateMode}
                  onDecisionsResolved={(resolved) => {
                    setDecisionsResolved(resolved);
                  }}
                />
              )}

              {artifact.type === 'workitems' && (
                <WorkItemsRenderer items={artifact.doc} />
              )}

              {artifact.type === 'pr' && (
                <PrRenderer doc={artifact.doc} />
              )}

              {artifact.type === 'demo' && (
                <div data-section="demo-evaluation">
                  <DemoComparison model={artifact.doc} cycleId={runId} />
                </div>
              )}

              {artifact.type === 'verdict' && isGateMode && (
                /* Gate mode: use ReviewVerdictForm — harness asserts its data-* */
                <ReviewVerdictForm
                  initiativeId={run?.initiativeId ?? runId}
                  onSubmitted={(kind) => {
                    setGateState(kind === 'approve' ? 'approved' : 'sent-back');
                  }}
                />
              )}

              {artifact.type === 'verdict' && !isGateMode && (
                <VerdictRenderer doc={artifact.doc} />
              )}

              {artifact.type === 'reflection' && (
                <ReflectionRenderer doc={artifact.doc} />
              )}
            </>
          )}
        </div>
      </div>

      {/* Gate bar — plan + demo only (verdict uses ReviewVerdictForm above) */}
      {showGateBar && ready && artifact && artifact.type !== 'empty' && (
        <GateBar
          runId={runId}
          gateId={gateId}
          decisionsResolved={decisionsResolved}
          label={gateLabel}
          hint={gateHint}
          onStateChange={(s) => setGateState(s)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported page — wraps the inner component in Suspense (required by Next.js
// 14 when useSearchParams() is used anywhere in the render tree).
// ---------------------------------------------------------------------------

export default function ArtifactPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', fontSize: 13 }}>
          Loading artifact…
        </div>
      }
    >
      <ArtifactPageInner />
    </Suspense>
  );
}
