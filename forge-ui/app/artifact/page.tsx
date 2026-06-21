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
 *   plan    → PlanRenderer + GateBar (gateId='plan', approve disabled until decisions resolved)
 *   demo    → GateBar  (gateId='verdict', decisions always resolved for demo)
 *   verdict → DemoComparison (evidence) + ReviewVerdictForm (the harness depends on its data-* intact)
 *   workitems / pr / reflection → view only (no gate bar)
 *
 * data-* contract (main):
 *   data-page="flows", data-page-ready, data-run, data-artifact-type,
 *   data-mode, data-gate-state
 *
 * Preserved from existing components:
 *   data-section="demo-comparison" data-section="demo-evaluation" data-ac-verdict (DemoComparison)
 *   data-component="verdict-form" data-form-state data-action="approve-and-merge"|"send-back" (ReviewVerdictForm)
 *
 * Fold-in (M4-4 → M7-3):
 *   type=verdict&mode=gate is the SOLE review gate surface — DemoComparison
 *   (evidence) + ReviewVerdictForm (the gate) + the post-approval open-reflect link.
 *   type=reflection is the SOLE reflection surface — the interactive ReflectionGate
 *   (questions + freeform + submit) above the read-only ReflectionRenderer.
 *   The legacy /review/[cycleId] + /reflect/[cycleId] routes now redirect here
 *   (M7-3, ADR-031); the harness drives these moments on /artifact directly.
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
import { ReflectionGate } from '@/components/studio/artifact/ReflectionGate';
import { DemoComparison } from '@/components/DemoComparison';
import { ReviewVerdictForm } from '@/components/ReviewVerdictForm';
import { DemoReviewSurface } from '@/components/DemoReviewSurface';
import { ArchitectPlanGate } from '@/components/studio/artifact/ArchitectPlanGate';

import { fetchRun, fetchStudioFlows, type Run } from '@/lib/studio-client';
import { useArchitectSessionPoll } from '@/lib/use-architect-session';
import { fetchDemoModel, fetchWorkItem, fetchReflection, fetchArchitectSessions, resolveBridgeUrl, type DemoModel, type ReflectionData, type ArchitectSessionSummary } from '@/lib/bridge-client';

// ---------------------------------------------------------------------------
// Types for artifact docs fetched from the bridge
// ---------------------------------------------------------------------------

type PrArtifactDoc = {
  /** Structured demo model (primary source — present when demo.json exists mid-cycle). */
  demoModel: DemoModel | null;
  /** PR description text (optional hero/header — may lag behind demo.json during a cycle). */
  prDoc: PrDoc | null;
};

type ArtifactDoc =
  | { type: 'plan';       doc: PlanDoc }
  | { type: 'workitems';  doc: WorkItemEntry[] }
  | { type: 'pr';         doc: PrArtifactDoc }
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

// Resolve the effective gate/view mode from the explicit ?mode= param and the
// run's artifactsReady state. Pure (no React state) so it can be called both in
// render and inside the load callback without capturing derived render values.
function resolveMode(
  modeParam: string | null,
  type: ArtifactKey,
  run: Run | null,
): 'gate' | 'view' {
  if (modeParam === 'gate' || modeParam === 'view') return modeParam;
  if (!run) return 'view';
  // verdict is never written to artifactsReady in gate mode by deriveArtifacts
  // (it writes 'view' only once the verdict file exists). Resolve gate from the
  // run status directly: a gated or active run with no verdict yet is the gate.
  if (type === 'verdict') {
    const verdictReady = run.artifactsReady['verdict' as keyof typeof run.artifactsReady];
    if (!verdictReady && (run.status === 'gated' || run.status === 'active')) return 'gate';
    return 'view';
  }
  const readyKey = type === 'workitems' ? 'work-items' : type;
  const ready = run.artifactsReady[readyKey as keyof typeof run.artifactsReady];
  return ready === 'gate' ? 'gate' : 'view';
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
      // PRIMARY: fetch demo.json (resolves mid-cycle since it's the gate's own
      // evidence and is mirrored to artifacts/). Fall back to pr-description.md
      // text when demo.json is absent (current behaviour, preserves the chip).
      const demoModel = await fetchDemoModel(runId);

      // SECONDARY (optional): pr-description.md as hero header text.
      let prDoc: PrDoc | null = null;
      try {
        const base = await resolveBridgeUrl();
        if (base) {
          const res = await fetch(`${base}/api/artifact/${encodeURIComponent(runId)}/pr-description.md`);
          if (res.ok) prDoc = parsePrDescription(await res.text());
        }
      } catch { /* best-effort */ }

      if (!demoModel && !prDoc) return { type: 'empty' };
      return { type: 'pr', doc: { demoModel, prDoc } };
    }

    if (type === 'plan') {
      // PRIMARY: structured plan.json
      const planJson = await fetchJsonArtifact<PlanDoc>(runId, 'plan.json');
      if (planJson) return { type: 'plan', doc: planJson };
      // SECONDARY: PLAN.md text fallback — the architect writes PLAN.md; only
      // PLAN.html is snapshotted into artifacts/ (run-model-derive.ts:439).
      // Fetch the raw markdown and surface it as a minimal PlanDoc so the
      // chip is selectable and the content is readable without the PLAN.html viewer.
      try {
        const base = await resolveBridgeUrl();
        if (base) {
          const res = await fetch(`${base}/api/artifact/${encodeURIComponent(runId)}/PLAN.md`);
          if (res.ok) {
            const text = await res.text();
            if (text.trim()) return { type: 'plan', doc: parsePlanMd(text) };
          }
        }
      } catch { /* best-effort */ }
      return { type: 'empty' };
    }

    if (type === 'verdict') {
      const verdictJson = await fetchJsonArtifact<VerdictDoc>(runId, 'verdict.json');
      if (verdictJson) return { type: 'verdict', doc: verdictJson };
      // In gate mode the verdict doesn't exist yet (it's being authored).
      // Return empty so gate-mode path shows the form unconditionally.
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
  // Only a LEVEL-1 heading (`# Title`) is the PR title; level-2+ SECTION headings
  // (`## Why`, `## What`) stay in the body so they render as sections, not get
  // swallowed as a bogus "Why" title. The unifier's pr-description.md is
  // section-structured (no top-level title), so the whole text is the body.
  const lines = text.split('\n');
  let title = '';
  let body = text;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^#\s+/.test(line)) {
      title = line.replace(/^#+\s*/, '');
      body = lines.slice(i + 1).join('\n').trim();
      break;
    }
    if (line && !line.startsWith('#')) break; // first real content — no title heading
  }
  return { title: title || undefined, body };
}

// Minimal PLAN.md → PlanDoc converter: pulls the title from the first heading
// and treats top-level bullet lines as scope items. Used when only PLAN.md is
// present (no plan.json) so the plan chip is selectable and the text is visible.
function parsePlanMd(text: string): PlanDoc {
  const lines = text.split('\n');
  let title: string | undefined;
  let goal: string | undefined;
  const scope: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!title && trimmed.startsWith('#')) {
      title = trimmed.replace(/^#+\s*/, '');
      continue;
    }
    // First non-heading paragraph as the goal text
    if (!goal && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-') && !trimmed.startsWith('*')) {
      goal = trimmed;
      continue;
    }
    // Top-level bullets as scope items
    if ((trimmed.startsWith('- ') || trimmed.startsWith('* ')) && scope.length < 20) {
      scope.push(trimmed.slice(2).trim());
    }
  }

  return { title, goal: goal ?? title, scope: scope.length > 0 ? scope : undefined };
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

function EmptyState({ type, backHref }: { type: ArtifactKey; backHref: string }) {
  const phase = PHASE_FOR_TYPE[type];
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
  // Live flow ids — used to avoid linking "back to monitor" at a retired flow
  // (release-refine / forge-cycle-with-review would 404). null = not loaded yet.
  const [liveFlowIds, setLiveFlowIds] = useState<Set<string> | null>(null);
  const [artifact,   setArtifact]   = useState<ArtifactDoc | null>(null);
  const [verdictDoc, setVerdictDoc] = useState<VerdictDoc | null>(null);
  // For verdict gate-mode: the demo evidence shown above the verdict form
  const [demoModel,  setDemoModel]  = useState<DemoModel | null>(null);
  // For plan gate-mode via an architect session (runId = '_architect-<sessionId>')
  const [archSession, setArchSession] = useState<ArchitectSessionSummary | null>(null);
  // For reflection: the live Stage-2 questions (user-questions.json) the operator answers.
  const [reflectionData, setReflectionData] = useState<ReflectionData | null>(null);
  const [ready,      setReady]      = useState(false);
  const [gateState,  setGateState]  = useState<GateState>('idle');
  // For plan gate-mode: track whether all decisions are resolved
  const [decisionsResolved, setDecisionsResolved] = useState(false);

  const meta = TYPE_META[type];

  // Derive mode: auto-infer when not specified (pure helper, shared with load)
  const mode = resolveMode(modeParam, type, run);

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
      const [fetchedRun, flows] = await Promise.all([fetchRun(runId), fetchStudioFlows()]);
      if (signal.cancelled) return;
      setRun(fetchedRun);
      setLiveFlowIds(new Set(flows.map((f) => f.id)));

      // Resolve the effective mode from the explicit param + the freshly
      // fetched run (NOT the derived `mode` render value, which is stale on the
      // initial cold-navigate render where `run` is still null).
      const effectiveMode = resolveMode(modeParam, type, fetchedRun);

      const artifactDoc = await fetchArtifactDoc(runId, type, fetchedRun);
      if (signal.cancelled) return;
      setArtifact(artifactDoc);

      // For verdict gate-mode: also fetch the demo evidence to show above the form.
      // (DemoComparison handles missing demo gracefully.)
      if (type === 'verdict' && effectiveMode === 'gate') {
        const dm = await fetchDemoModel(runId);
        if (!signal.cancelled) setDemoModel(dm);
      }

      // For plan via an architect session: runId is '_architect-<sessionId>'.
      // Fetch the session so we can render the PlanGate iframe as a fallback
      // when no structured plan.json exists.
      if (type === 'plan' && runId.startsWith('_architect-')) {
        const sessionId = runId.slice('_architect-'.length);
        const sessions = await fetchArchitectSessions().catch(() => [] as ArchitectSessionSummary[]);
        const match = sessions.find((s) => s.sessionId === sessionId) ?? null;
        if (!signal.cancelled) setArchSession(match);
      }

      // For reflection: fetch the live Stage-2 questions (user-questions.json)
      // so the operator can answer them in-place. The read-only reflection.json
      // artifact is fetched separately above for the renderer.
      if (type === 'reflection') {
        const refl = await fetchReflection(runId).catch(() => null);
        if (!signal.cancelled) setReflectionData(refl);
      }

      // Also fetch verdict doc for view-mode stamp (when type != verdict)
      if (type !== 'verdict' && effectiveMode !== 'gate') {
        const vd = await fetchJsonArtifact<VerdictDoc>(runId, 'verdict.json');
        if (!signal.cancelled) setVerdictDoc(vd);
      }
    } catch {
      // keep defaults — reach page-ready on error
    } finally {
      if (!signal.cancelled) setReady(true);
    }
  }, [runId, type, modeParam]);

  useEffect(() => {
    const signal = { cancelled: false };
    setReady(false);
    setArtifact(null);
    void load(signal);
    return () => { signal.cancelled = true; };
  }, [load]);

  // Architect PLAN gate: poll the session so the gate reflects phase
  // transitions live (send-back → drafting unmounts the gate; the revised plan
  // → awaiting-verdict remounts it). Drives the harness's beat-8 detach→reattach
  // lifecycle without a page reload, and resets the gate's submitted state.
  useArchitectSessionPoll(runId, type === 'plan', setArchSession);

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

  // Back-to-monitor link. Only deep-link to /flows/<id> when that flow STILL
  // EXISTS — retired flows (release-refine, forge-cycle-with-review) would 404.
  // Until the live flow set has loaded (null), trust flowId; once loaded,
  // degrade a retired flow to the dashboard cascade '/', which aggregates the
  // cycle regardless of flow.
  const flowId = run?.flowId;
  const flowIsLive = !!flowId && (liveFlowIds === null || liveFlowIds.has(flowId));
  const monitorHref = flowIsLive ? `/flows/${encodeURIComponent(flowId)}` : '/';

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
          ) : (
            <>
              {/* View-mode approval stamp (skip for verdict — it IS the verdict) */}
              {!isGateMode && type !== 'verdict' && verdictDoc && (
                <ViewStampStrip verdictDoc={verdictDoc} />
              )}

              {/* Verdict gate-mode: demo evidence above the form (M4-4 fold-in).
                  Render even when artifact is empty (verdict.json doesn't exist
                  yet — we're authoring it). */}
              {type === 'verdict' && isGateMode && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {demoModel ? (
                    <>
                      {/* Structured evidence (harness: data-section="demo-comparison"/"demo-evaluation"). */}
                      <DemoComparison model={demoModel} cycleId={runId} />
                      {/* DEC-5: the comment-on-page visual review IS the verdict — markdown
                          narrative + per-region slider/JSON-diff + anchored comments derive
                          approve/send-back. Replaces the textarea form; still emits the
                          verdict-form data-* contract. */}
                      <DemoReviewSurface
                        model={demoModel}
                        cycleId={runId}
                        initiativeId={run?.initiativeId ?? runId}
                        onSubmitted={(kind) => {
                          setGateState(kind === 'approve' ? 'approved' : 'sent-back');
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <div style={{
                        border: '1px solid var(--line)',
                        borderRadius: 8,
                        padding: '14px 18px',
                        background: 'var(--panel)',
                        fontSize: 13,
                        color: 'var(--dim)',
                      }}>
                        No structured demo (<code>demo.json</code>) filed for this run yet — use the form below.
                      </div>
                      {/* No-demo fallback: the plain verdict form (same data-* contract). */}
                      <ReviewVerdictForm
                        initiativeId={run?.initiativeId ?? runId}
                        onSubmitted={(kind) => {
                          setGateState(kind === 'approve' ? 'approved' : 'sent-back');
                        }}
                      />
                    </>
                  )}

                  {/* Approval payoff — surface the final human moment (reflect).
                      Re-homed from the retired /review screen; points at the
                      unified reflection artifact. Harness asserts data-action="open-reflect". */}
                  {gateState === 'approved' && (
                    <div style={{
                      border: '1px solid rgba(74,222,128,.4)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '14px 18px',
                      background: 'rgba(74,222,128,.07)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}>
                      <span style={{ fontSize: 13, color: 'var(--green)' }}>
                        Approved — merged. One last step: reflect on the cycle.
                      </span>
                      <Link
                        href={`/artifact?run=${encodeURIComponent(runId)}&type=reflection&mode=view`}
                        data-action="open-reflect"
                        style={{
                          flex: '0 0 auto',
                          fontSize: 13,
                          fontWeight: 600,
                          color: '#fff',
                          background: '#8957e5',
                          border: '1px solid var(--line)',
                          borderRadius: 6,
                          padding: '6px 14px',
                          textDecoration: 'none',
                        }}
                      >
                        Reflect on this cycle →
                      </Link>
                    </div>
                  )}
                </div>
              )}

              {/* All other types: show empty state when artifact is absent.
                  In gate mode, show a compact placeholder instead of the full empty
                  state so the gate bar (rendered unconditionally below) remains
                  reachable. In view mode, show the full empty state.
                  Exception: plan type with an archSession falls through to PlanGate. */}
              {type !== 'verdict' && type !== 'reflection' && (!artifact || artifact.type === 'empty') && !(type === 'plan' && archSession) && (
                isGateMode ? (
                  <div style={{
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    padding: '14px 18px',
                    background: 'var(--panel)',
                    fontSize: 13,
                    color: 'var(--dim)',
                    marginBottom: 16,
                  }}>
                    Artifact evidence not available — the {PHASE_FOR_TYPE[type]} phase has not
                    produced the <strong>{type}</strong> artifact yet. You can still approve or
                    send back below.
                  </div>
                ) : (
                  <EmptyState type={type} backHref={monitorHref} />
                )
              )}

              {/* Type-specific renderers for non-verdict types */}
              {artifact && artifact.type === 'plan' && (
                <PlanRenderer
                  doc={artifact.doc}
                  gateMode={isGateMode}
                  onDecisionsResolved={(resolved) => {
                    setDecisionsResolved(resolved);
                  }}
                />
              )}

              {/* Plan gate fallback: render the native architect PLAN gate when
                  running via an architect session (runId='_architect-<id>') and no
                  structured plan.json. Preserves data-section="plan-gate" +
                  data-decisions-resolved + the beat-9 watch-it-build payoff. */}
              {type === 'plan' && (!artifact || artifact.type === 'empty') && archSession && (
                <ArchitectPlanGate
                  session={archSession}
                  onGateState={(s) => setGateState(s)}
                />
              )}

              {artifact && artifact.type === 'workitems' && (
                <WorkItemsRenderer items={artifact.doc} />
              )}

              {artifact && artifact.type === 'pr' && (
                <div>
                  {/* PR description as hero header (when present) */}
                  {artifact.doc.prDoc && (
                    <div style={{
                      marginBottom: 24,
                      padding: '16px 20px',
                      background: 'var(--panel)',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                    }}>
                      <PrRenderer doc={artifact.doc.prDoc} />
                    </div>
                  )}
                  {/* S9 refinement: the demo evidence is NOT duplicated here — the PR
                      artifact (above) already carries the same content, and the canonical
                      demo evidence lives on the demo-evidence artifact (type=demo) + the
                      review gate (type=verdict&mode=gate). */}
                </div>
              )}

              {artifact && artifact.type === 'demo' && (
                <div data-section="demo-evaluation">
                  <DemoComparison model={artifact.doc} cycleId={runId} />
                </div>
              )}

              {artifact && artifact.type === 'verdict' && !isGateMode && (
                <VerdictRenderer doc={artifact.doc} />
              )}

              {/* Reflection: the interactive question gate (the third human
                  moment) sits above the read-only reflection summary. The gate
                  carries data-section="reflect-questions" / "reflect-done" +
                  data-field="freeform" + data-action="submit-reflection". */}
              {type === 'reflection' && (
                <div style={{ marginBottom: 24 }}>
                  <ReflectionGate cycleId={runId} data={reflectionData} />
                </div>
              )}

              {artifact && artifact.type === 'reflection' && (
                <ReflectionRenderer doc={artifact.doc} />
              )}
            </>
          )}
        </div>
      </div>

      {/* Gate bar — plan + demo only (verdict uses ReviewVerdictForm above).
          Renders unconditionally in gate mode so the operator can always
          approve/send-back even when the artifact body is absent (e.g. demo.json
          missing at a demo gate). */}
      {showGateBar && ready && (
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
