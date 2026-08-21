'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  fetchStudioProjects, fetchStudioKbs, fetchStudioFlows, fetchStudioCatalog,
  saveProject, createProject, fetchPreflight,
  fetchProjectStarters, createGreenfieldProject, fetchStudioAgentsWithMeta,
  type Project, type DemoStep, type Kb, type Flow, type Catalog, type PreflightResult,
  type FailingClause,
} from '@/lib/studio-client';
import { resolveCeilingFieldValue } from '@/lib/run-panel-view';
import { resolveDevelopStartCeilingToSend } from '@/lib/roadmap-develop-start-ceiling';
import {
  fetchRoadmap, startDevelopment, planInitiative,
  fetchCycles, fetchCost,
  listDemoSessions,
  type ProjectRoadmap, type PlanInitiativeResult, type Cycle,
} from '@/lib/bridge-client';
import { groupCyclesByInitiative, type InitiativeGroup } from '@/lib/cycle-grouping';
import { deriveActionableNow } from '@/lib/roadmap-actionable';
import { resolveDemoEntryHref } from '@/lib/demo-entry-view';
import { showShowcaseEntry } from '@/lib/project-showcase';
import { topoLevels } from '@/lib/dep-layout';
import { StudioNav } from '@/components/StudioNav';
import { NotFound } from '@/components/NotFound';
import { PageLoadError } from '@/components/PageLoadError';
import { FetchErrorState, fetchErrorPropsFrom } from '@/components/FetchErrorState';
import { useBridgeRecoveryWhenFailed } from '@/lib/use-bridge-status';
import { PageHeader } from '@/components/StudioPage';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { useDocumentTitle } from '@/lib/document-title';
import { RoadmapCanvas } from '@/components/studio/RoadmapCanvas';
import { SaveStatus } from '@/components/SaveStatus';
import { useSaveState } from '@/lib/useSaveState';
import { NorthStar } from '@/components/studio/project-builder/NorthStar';
import { Instructions } from '@/components/studio/project-builder/Instructions';
import { DemoTimeline } from '@/components/studio/project-builder/DemoTimeline';
import { SkillsBind } from '@/components/studio/project-builder/SkillsBind';
import { ContractReadiness } from '@/components/studio/project-builder/ContractReadiness';
import { ContractResolutionPanel } from '@/components/studio/project-builder/ContractResolutionPanel';
import { OnboardWithAgent } from '@/components/studio/project-builder/OnboardWithAgent';
import { OpenSessionsPanel } from '@/components/studio/project-builder/OpenSessionsPanel';
import { ProjectContractPanel } from '@/components/studio/project-builder/ProjectContractPanel';
import { ProjectCycleLedger } from '@/components/studio/project-builder/ProjectCycleLedger';
import { KbBind } from '@/components/studio/project-builder/KbBind';
import { buildProjectSavePayload } from '@/lib/project-save-payload';
import { StartWorkActions } from '@/components/studio/StartWorkActions';
import { planCycleCostFetch } from '@/lib/cycle-cost-cache';
import { ProjectArchitectEntry } from '@/components/studio/ProjectArchitectEntry';
import { SchedulerCard } from '@/components/SchedulerCard';
import { MAIN_CONTENT_ID } from '@/lib/main-landmark';
import { disabledAttrs } from '@/lib/disabled-reason';

/**
 * W7-B6 (projects-27): per-cycle cost totals from `GET /api/cost/<cycleId>`
 * — enrichment, fetched per row (bounded by this project's cycle count). A
 * failed/404 read stays `null` → the ledger's honest em dash, never $0.00.
 * An absent/rotated event log yields an EMPTY summary (totalUsd 0) — that is
 * "no cost recorded", not "cost $0.00"; kept null too.
 */
// W7-B6 review F5: `prev` memoizes resolved costs for TERMINAL cycles (they
// cannot gain spend), so the refetch after every dispatch/save only hits the
// cost route for live cycles + first-sight/unresolved ones — never an
// unbounded N-request storm per refresh. Decision rule: lib/cycle-cost-cache.
async function fetchCycleCostMap(cycles: Cycle[], prev: Record<string, number | null>): Promise<Record<string, number | null>> {
  const { reused, toFetch } = planCycleCostFetch(cycles, prev);
  const entries = await Promise.all(
    toFetch.map(async (cycleId) => {
      const summary = await fetchCost(cycleId).catch(() => null);
      const total = summary !== null && summary.totalUsd > 0 ? summary.totalUsd : null;
      return [cycleId, total] as const;
    }),
  );
  return { ...reused, ...Object.fromEntries(entries) };
}

export default function ProjectBuilderPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  // A new project is onboarded via a focused minimal form, not the editor.
  const isNew = id === 'new';

  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [catalog, setCatalog] = useState<Catalog>({});
  const [demoSteps, setDemoSteps] = useState<DemoStep[]>([]);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [dirty, setDirty] = useState(false);
  const [ready, setReady] = useState(false);
  // F5: set after a demoProcess save — surfaces data-demo-design-state="needed"
  // so the operator knows to run `forge run skill demo-design --project <id>`.
  const [demoDesignNeeded, setDemoDesignNeeded] = useState(false);
  // S6: Editor|Roadmap tab + the read-only roadmap read model.
  const [tab, setTab] = useState<'editor' | 'roadmap'>('editor');
  // W7-A3: `/projects/<id>#roadmap` (the architect committed panel's "Open the
  // roadmap →") lands on the Roadmap tab. Read on mount only — SSR renders the
  // editor tab and the hash is a client-only fact.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#roadmap') setTab('roadmap');
  }, []);
  const [roadmap, setRoadmap] = useState<ProjectRoadmap | null>(null);
  // R4-11-T3: cycle groups (one per initiative, attemptCount + priorCycleIds)
  // back the roadmap's recovery affordances — a different data source than
  // `roadmap` itself (fetchRoadmap()'s RoadmapInitiative[] has no attemptCount).
  const [cycleGroups, setCycleGroups] = useState<InitiativeGroup[]>([]);
  // R4-12-F2: raw, project-scoped cycles (NOT grouped) — the permanent cycle
  // ledger's completed-cycle dig-in feeds these RAW `Cycle[]` through
  // `deriveProjectCycleLedgerRows` inside <ProjectCycleLedger>. Populated from
  // the same `fetchCycles()` call that backs `cycleGroups`.
  const [projectCycles, setProjectCycles] = useState<Cycle[]>([]);
  // W7-B6 (projects-27): per-cycle cost totals (GET /api/cost/<cycleId>) for
  // the ledger's cost column — null/absent renders the honest em dash.
  const [costByCycleId, setCostByCycleId] = useState<Record<string, number | null>>({});
  // Review F5: the cross-refresh memo of resolved TERMINAL cycle costs (see
  // fetchCycleCostMap above). A ref on purpose — state here would churn
  // loadCycleGroups's identity (it is an effect dependency) on every update.
  const costCacheRef = useRef<Record<string, number | null>>({});

  // W7-FIX-A1 (A1-02): a FAILED roster read is an ERROR state (PageLoadError
  // with Retry) — never the shared NotFound ("No project <id>" for a project
  // that may well exist). `loadKey` re-runs every load on Retry + bridge
  // recovery. `panelError` is the softer sibling for the preflight/roadmap
  // reads: the project itself loaded, one side panel's read did not — shown
  // inline (never an unhandled rejection, never a silently-absent panel).
  const [loadError, setLoadError] = useState<{ error: string; status?: number } | null>(null);
  // One slot PER panel read (preflight / roadmap / cycles) — two failing
  // panels both stay visible; a panel's own success clears only its own slot.
  const [panelErrors, setPanelErrors] = useState<Record<string, { what: string; error: string; status?: number }>>({});
  const setPanelError = useCallback((key: string, next: { what: string; error: string; status?: number } | null) => {
    setPanelErrors((prev) => {
      if (next === null) {
        if (!(key in prev)) return prev;
        const { [key]: _dropped, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: next };
    });
  }, []);
  const panelErrorList = Object.values(panelErrors);
  const [loadKey, setLoadKey] = useState(0);
  const reload = useCallback(() => setLoadKey((k) => k + 1), []);
  // The side panels (preflight / roadmap / cycles) re-run on their OWN key:
  // a panel Retry, or recovery while only a panel failed, never re-runs
  // `loadData` (which would overwrite the operator's unsaved builder edits).
  const [panelKey, setPanelKey] = useState(0);
  const retryPanels = useCallback(() => setPanelKey((k) => k + 1), []);
  // Recovery refills ONLY a failed page/panel — never re-loads over the
  // operator's unsaved builder edits (W7-FIX-A1 review): a failed PAGE load
  // re-runs everything; failed panels alone re-run only the panels.
  useBridgeRecoveryWhenFailed(
    loadError !== null || panelErrorList.length > 0,
    loadError !== null ? reload : retryPanels,
  );

  const [northStar, setNorthStar] = useState('');
  const [instructions, setInstructions] = useState('');
  const [instructionsSource, setInstructionsSource] = useState<'AGENTS.md' | 'CLAUDE.md' | 'project.json' | undefined>(undefined);
  const [skills, setSkills] = useState<string[]>([]);
  const [kb, setKb] = useState<string | null>(null);
  // W7-FIX-A4 (W7A4-03): `kb` above is hydrated from the roster, which serves
  // the DERIVED project↔KB binding (kb.yaml binding.ref — never stored) when
  // project.json has none. Only an operator change via KbBind flips this, and
  // only then does Save carry `kb` — see lib/project-save-payload.ts.
  const [kbTouched, setKbTouched] = useState(false);
  const [name, setName] = useState('');

  const loadData = useCallback(async (signal: { cancelled: boolean }) => {
    try {
      const [ps, ks, fs, cat] = await Promise.all([
        fetchStudioProjects(), fetchStudioKbs(), fetchStudioFlows(), fetchStudioCatalog(),
      ]);
      if (signal.cancelled) return;
      setProjects(ps);
      setKbs(ks);
      setFlows(fs);
      setCatalog(cat);
      const p = ps.find((x) => x.id === id) ?? null;
      if (p) {
        setProject(p);
        setName(p.name ?? '');
        setNorthStar(p.northStar ?? '');
        setInstructions(p.instructions ?? '');
        setInstructionsSource(p.instructionsSource);
        if (Array.isArray(p.demoProcess)) {
          setDemoSteps(p.demoProcess);
        } else {
          setDemoSteps([]);
        }
        setSkills(p.skills ?? []);
        setKb(p.kb ?? null);
        setKbTouched(false);
      }
      setLoadError(null);
    } catch (err) {
      // W7-FIX-A1 (A1-02): the roster/kbs/flows/catalog read threw — an
      // ERROR state; `project` stays whatever it was, so NotFound (gated on
      // `!loadError` below) cannot fire off this failure.
      if (signal.cancelled) return;
      setLoadError(fetchErrorPropsFrom(err));
    } finally {
      if (!signal.cancelled) setReady(true);
    }
  }, [id]);

  const loadPreflight = useCallback(async (signal: { cancelled: boolean }) => {
    try {
      const result = await fetchPreflight(id);
      if (signal.cancelled) return;
      setPreflight(result);
      setPanelError('preflight', null);
    } catch (err) {
      if (signal.cancelled) return;
      setPanelError('preflight', { what: 'the preflight verdict', ...fetchErrorPropsFrom(err) });
    }
  }, [id, setPanelError]);

  const loadRoadmap = useCallback(async (signal: { cancelled: boolean }) => {
    try {
      const result = await fetchRoadmap(id);
      if (signal.cancelled) return;
      setRoadmap(result);
      setPanelError('roadmap', null);
    } catch (err) {
      if (signal.cancelled) return;
      setPanelError('roadmap', { what: 'the roadmap', ...fetchErrorPropsFrom(err) });
    }
  }, [id, setPanelError]);

  // R4-11-T3: recovery affordances need this project's initiatives grouped
  // by attemptCount. W7-FIX-A1 (review): a thrown `fetchCycles()` is a
  // panel-scoped ERROR (shown inline, Retry) — never silently an empty cycle
  // history + un-annotated cards for a project with merged cycles.
  const loadCycleGroups = useCallback(async (signal: { cancelled: boolean }) => {
    try {
      const snap = await fetchCycles();
      const all = [...(snap?.live ?? []), ...(snap?.recent ?? [])];
      const groups = groupCyclesByInitiative(all);
      // R4-12-F2: same fetch also feeds the cycle ledger — scoped to THIS
      // project (drop cycles with no/other `project`), left RAW so the ledger's
      // shared `deriveProjectCycleLedgerRows` transform runs on the render path.
      const mine = all.filter((c) => c.project === id);
      // projects-27 + review F5: ref reuses terminal-cycle totals (see above).
      const costs = await fetchCycleCostMap(mine, costCacheRef.current);
      if (signal.cancelled) return;
      costCacheRef.current = costs;
      setCycleGroups(groups);
      setProjectCycles(mine);
      setCostByCycleId(costs);
      setPanelError('cycles', null);
    } catch (err) {
      if (signal.cancelled) return;
      // Never keep a PREVIOUS project's cycles under this project's error
      // (the route param can change on the same page instance).
      setCycleGroups([]);
      setProjectCycles([]);
      setPanelError('cycles', { what: 'the cycle history', ...fetchErrorPropsFrom(err) });
    }
  }, [id, setPanelError]);

  // plan-everything-before-kickoff: RoadmapView refetches after kickoff so
  // status/ready/blockedBy (and the eligible count) reflect queue reality.
  // R4-11-T3: also refreshes cycleGroups so a requeue/abandon's new status +
  // attempt count show up on the next render.
  const refreshRoadmap = useCallback(async () => {
    const signal = { cancelled: false };
    await Promise.all([loadRoadmap(signal), loadCycleGroups(signal)]);
  }, [loadRoadmap, loadCycleGroups]);

  useEffect(() => {
    // W7-A4 (projects-04 / home-sessions-18): `new` is the onboarding form,
    // not a project — no per-project fetch may fire for it (the preflight /
    // roadmap / cycles routes 404'd on every visit to /projects/new).
    if (isNew) return;
    const signal = { cancelled: false };
    void loadData(signal);
    return () => { signal.cancelled = true; };
    // loadKey: the page-load Retry / recovery-while-failed re-run the project read (W7-FIX-A1)
  }, [isNew, loadData, loadKey]);

  // W7-D1 — the SAME rule as `isNew`, one case wider. W7-A4 stopped
  // per-project reads firing for `/projects/new`, but not for an id the roster
  // does not have: the page renders its whole subtree while `ready` is still
  // false, so `/projects/claude-harness` (linked from a retired flow's run
  // ledger) fired preflight + contract-stages + onboarding/active and 404'd
  // all three before settling on the honest NotFound. The walkthrough gate
  // only saw it once the crawler learned to page the history ledgers and
  // reached that route at all. `projectKnown` is a stable boolean, not the
  // `project` object — the panels must not re-read every time a save changes
  // its identity.
  const projectKnown = project !== null;
  useEffect(() => {
    if (isNew || !projectKnown) return;
    const signal = { cancelled: false };
    setPanelErrors({});
    void loadPreflight(signal);
    void loadRoadmap(signal);
    void loadCycleGroups(signal);
    return () => { signal.cancelled = true; };
    // loadKey (page Retry) AND panelKey (panel Retry / panels-only recovery) re-run the panel reads
  }, [isNew, projectKnown, loadPreflight, loadRoadmap, loadCycleGroups, loadKey, panelKey]);

  // W6-B10 (R1-03-F2 reversed): the demo builder is a dedicated session
  // screen (`/sessions/demo/<sid>`, the ONE session screen every kind
  // shares) — this page no longer owns an inline panel or an active-session
  // id; a demo session starting here just navigates there.
  const handleDemoSessionStarted = useCallback((sid: string): void => {
    router.push(`/sessions/demo/${encodeURIComponent(sid)}?project=${encodeURIComponent(id)}`);
  }, [id, router]);

  // The roadmap's "demo builder →" entrypoint (InitiativeDetail's
  // [data-link="demo-builder"], W6-B10 — used to be a fake `setTab('editor')`
  // that no longer lands anywhere real now the demo builder left the editor
  // tab). Routes honestly: resume the project's in-flight demo session if
  // one exists, else the kickoff screen prefilled with this project —
  // `resolveDemoEntryHref` (lib/demo-entry-view.ts) is the single source of
  // that decision, shared with nothing else today but unit-tested on its own.
  const handleOpenDemo = useCallback(async (initiativeId: string): Promise<void> => {
    const sessions = await listDemoSessions().catch(() => []);
    router.push(resolveDemoEntryHref(sessions, id, initiativeId));
  }, [id, router]);

  // Unified save feedback (X1). The hook owns saving/saved/error state.
  const { saving, error: saveError, save: handleSave, ...saveFb } = useSaveState(async () => {
    if (!project) return { ok: false, error: 'project not loaded' };
    const result = await saveProject(id, buildProjectSavePayload({
      name,
      northStar,
      instructions,
      demoProcess: demoSteps,
      skills,
      kb,
      kbTouched,
    }));
    if (result.ok) {
      setDirty(false);
      setKbTouched(false);
      void loadPreflight({ cancelled: false });
      // W7-B6 (projects-26): a successful save refreshes the page's OWN
      // roster too — the header project switcher kept showing the old name
      // until a manual reload (loadData leaves the operator's just-saved
      // fields untouched: dirty is false, and it re-hydrates from the roster
      // that now carries exactly what was saved).
      void loadData({ cancelled: false });
      // F5: surface demo-design trigger when demoProcess was in the save.
      if (result.demoDesignNeeded) setDemoDesignNeeded(true);
    }
    return result;
  });

  const handleSaveRef = useRef(handleSave);
  useEffect(() => { handleSaveRef.current = handleSave; });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void handleSaveRef.current();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  function markDirty() { setDirty(true); }

  // W7-B6 (projects-05): unsaved edits are no longer discarded silently.
  // beforeunload covers tab close / reload / full navigations; the project
  // switcher below confirms in-app. (Next's client-side <Link> navigations
  // in the top nav bypass beforeunload — the honest residual, noted in the
  // PR; the two loss paths the walkthrough reproduced are covered.)
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function handleProjectSelect(newId: string) {
    if (dirty && !window.confirm('You have unsaved changes — switch project and discard them?')) return;
    router.push(`/projects/${encodeURIComponent(newId)}`);
  }

  const skillItems = (catalog.skills ?? []) as Array<{ id: string; name: string; desc?: string }>;

  // R4-14: gate the "open showcase →" affordance on this project actually
  // having a merged|done cycle (honest gating — never offer a link the
  // showcase page itself would then render empty for). `showShowcaseEntry`
  // stays honest with the SAME deriver (`deriveShowcaseCycleId`) the
  // showcase page's own load path calls.
  const showcaseEntryVisible = showShowcaseEntry(projectCycles, id);

  // W7-C3 (crosscut-06): per-route tab title. Called BEFORE every early
  // return — a hook after one is both a React hook-order violation and, on
  // `/projects/new` (which returns just below), the reason that route kept
  // shipping the bare product name as its tab title (W7-C3 review, A-H4).
  useDocumentTitle(isNew ? 'Onboard a project' : (name || id), 'Projects');

  // New-project surface: onboard an existing repo (R4-B8) OR create a greenfield
  // one from a framework template (R4-03).
  if (isNew) {
    return (
      <>
        <ProjectOnboardForm />
        <CreateFromTemplate />
      </>
    );
  }

  // W6-SW-3 (sweep C2#3): loadData leaves `project` null when the URL `id`
  // isn't in fetchStudioProjects() (a stale/bad :id route param) — without
  // this branch the return below rendered the full editable editor with a
  // blank name/northStar/etc, no honest "not found" state. W7-A4
  // (crosscut-27): that state is the ONE shared NotFound.
  // W7-FIX-A1 (A1-02): the read FAILED — the project may well exist. The
  // shared page-level error with Retry, never NotFound.
  if (ready && loadError) {
    return (
      <PageLoadError
        page="projects"
        rootAttrs={{ 'data-project-id': id }}
        what={`project "${id}"`}
        error={loadError.error}
        status={loadError.status}
        onRetry={reload}
        backHref="/projects"
        backLabel="Projects"
      />
    );
  }
  if (ready && !loadError && !project) {
    return <NotFound kind="project" id={id} backHref="/projects" backLabel="Projects" />;
  }

  return (
    <main
      id={MAIN_CONTENT_ID}
      data-page="projects"
      data-project-id={id}
      data-dirty={dirty ? 'true' : 'false'}
      data-page-ready={ready ? 'true' : 'false'}
      data-demo-design-state={demoDesignNeeded ? 'needed' : 'idle'}
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}
    >
      <StudioNav />
      {/* W7-C3 (crosscut-18/19): one h1 (the visible identity is the name
          input, so it is sr-only) + the shared breadcrumb trail. */}
      <h1 className="sr-only">{name || id} — project</h1>
      <div style={{ padding: '12px 28px 0' }}>
        <Breadcrumbs items={[{ label: 'Projects', href: '/projects' }, { label: name || id }]} />
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '4px 28px 14px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--bg-2)',
      }}>
        <select
          value={id}
          onChange={(e) => handleProjectSelect(e.target.value)}
          style={{
            background: 'var(--panel)', border: '1px solid var(--line-2)',
            borderRadius: 'var(--radius-sm)', color: 'var(--text)',
 fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500,
            padding: '6px 32px 6px 11px', cursor: 'pointer' }}
          aria-label="Select project"
        >
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <div style={{
 width: 22, height: 24, clipPath: 'var(--hex-clip)',
            background: 'linear-gradient(135deg, var(--c-project) 0%, #3a8fd4 100%)',
            boxShadow: '0 0 12px rgba(92,200,255,.4)', flexShrink: 0,
          }} />
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); markDirty(); }}
            style={{
 fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700,
              color: 'var(--text)', background: 'transparent', border: 'none', borderBottom: '2px solid transparent', padding: '2px 4px', minWidth: 160,
            }}
            placeholder="Project name"
          />
        </div>

        <SaveStatus saving={saving} error={saveError} {...saveFb} />
        <button
          className="btn btn-primary"
          data-action="save-project"
          onClick={() => void handleSave()}
          {...disabledAttrs(saving ? 'Saving…' : !dirty ? 'No unsaved changes' : null)}
        >
          {saving ? 'Saving…' : 'Save project'}
        </button>
      </div>

      {/* Editor | Roadmap tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2,
        padding: '0 28px',
            borderBottom: '1px solid var(--line)',
        background: 'var(--bg-2)',
      }}>
        {(['editor', 'roadmap'] as const).map((t) => (
          <button
            key={t}
            data-tab={t}
            data-tab-active={tab === t ? 'true' : 'false'}
            onClick={() => setTab(t)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
 fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600,
              color: tab === t ? 'var(--text)' : 'var(--faint)',
              padding: '10px 14px 8px',
            borderBottom: tab === t ? '2px solid var(--c-project)' : '2px solid transparent',
              textTransform: 'capitalize',
            }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* W7-B6 (operator note 11 / orch-02): the PRIMARY action group, above
          the fold on BOTH tabs — Plan · Start development · Run a flow ·
          Architect. Real controls (queue writes / flow-run POST), never an
          inert select. */}
      <StartWorkActions
        projectId={id}
        roadmap={roadmap}
        flows={flows}
        onChanged={refreshRoadmap}
      />

      {/* W7-FIX-A1 (A1-02): a side-panel read (preflight / roadmap) failed while
          the project itself loaded — shown inline, never silently absent. */}
      {panelErrorList.length > 0 ? (
        <div data-section="project-panel-error" data-panel-error-count={panelErrorList.length} style={{ padding: '10px 28px 0' }}>
          {panelErrorList.map((pe) => (
            <FetchErrorState key={pe.what} what={pe.what} error={pe.error} status={pe.status} onRetry={retryPanels} compact />
          ))}
        </div>
      ) : null}

      {tab === 'editor' && (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, padding: '24px 28px 64px', display: 'flex', flexDirection: 'column', gap: 24, overflowY: 'auto' }}>
            <NorthStar value={northStar} onChange={(v) => { setNorthStar(v); markDirty(); }} />
            <Instructions project={id} value={instructions} source={instructionsSource} onChange={(v) => { setInstructions(v); markDirty(); }} />
            <DemoTimeline
              project={id}
              steps={demoSteps}
              hasLockedDemo={project?.hasLockedDemo ?? false}
              onChange={(s) => { setDemoSteps(s); markDirty(); }}
              onSessionStarted={handleDemoSessionStarted}
            />
            <SkillsBind skills={skills} onChange={(s) => { setSkills(s); markDirty(); }} catalog={skillItems} />

            {/* R4-12-F2: permanent cycle ledger — the completed-cycle dig-in.
                Feeds this project's RAW cycles through <ProjectCycleLedger>'s
                shared deriveProjectCycleLedgerRows → HistoryLedger. */}
            <section data-section="project-cycle-ledger" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)' }}>
                  Cycle Ledger
                </div>
                {/* R4-14: gated entry to the demo showcase — visible ONLY once
                    this project has a merged|done cycle (showShowcaseEntry),
                    so the link is never offered for a project the showcase
                    page would itself render empty for. */}
                {showcaseEntryVisible && (
                  <Link
                    href={`/projects/${encodeURIComponent(id)}/showcase`}
                    data-action="open-showcase"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: 'var(--c-project)',
                      background: 'var(--panel)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '4px 10px',
                      textDecoration: 'none',
                    }}
                  >
                    Open showcase →
                  </Link>
                )}
              </div>
              <ProjectCycleLedger cycles={projectCycles} nowMs={Date.now()} costByCycleId={costByCycleId} />
            </section>
          </div>

          <aside style={{
 width: 340, flexShrink: 0, borderLeft: '1px solid var(--line)',
            padding: '18px 18px 64px', display: 'flex', flexDirection: 'column',
            gap: 16, overflowY: 'auto', background: 'var(--bg-2)',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 8 }}>Card Preview</div>
              <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: 14, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, var(--c-project) 0%, transparent 100%)' }} />
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, marginBottom: 6, color: 'var(--text)' }}>{name || '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.5, marginBottom: 10, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>{northStar || '—'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <span className="badge badge-project">{skills.length} skill{skills.length !== 1 ? 's' : ''}</span>
                  {kb && kbs.find((k) => k.id === kb) && <span className="badge badge-kb">{kbs.find((k) => k.id === kb)?.name}</span>}
                </div>
              </div>
            </div>

            {demoDesignNeeded && (
              <div
                data-section="demo-design-prompt"
                style={{ background: 'var(--bg-2)', border: '1px solid var(--yellow)', borderRadius: 'var(--radius)', padding: '10px 12px' }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--yellow)', marginBottom: 4 }}>Demo machinery needed</div>
                <div style={{ fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.5 }}>
                  demoProcess saved. Run the demo-design skill to generate per-project demo machinery:
                </div>
                <code style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginTop: 6, wordBreak: 'break-all' }}>
                  forge run skill demo-design --project {id}
                </code>
              </div>
            )}

            <KbBind kb={kb} kbs={kbs} projectId={id} onChange={(v) => { setKb(v); setKbTouched(true); markDirty(); }} />

            <ContractReadiness
              northStar={northStar}
              instructions={instructions}
              demoSteps={demoSteps}
              skills={skills}
              kb={kb}
              preflight={preflight}
            />

            {preflight && (
              <ContractResolutionPanel
                projectId={id}
                clauses={preflight.clauses}
                // The REAL binding (KbBind's own `kb` state, just above) —
                // never re-derived from the project id (a project's KB is
                // operator-rebindable to any KB, or unbound entirely).
                boundKbId={kb}
                onChanged={() => void loadPreflight({ cancelled: false })}
              />
            )}

            {/* R4-12-F1: permanent contract-buildout panel (async server
                component; ContractPanelMount resolves it client-side since this
                page is 'use client'). Distinct concern from the preflight
                VERDICT above (ContractReadiness / ContractResolutionPanel). */}
            {/* W7-D1: both of these fetch per-project on mount
                (contract-stages / onboarding-active), so neither may mount for
                an id the roster has not confirmed — see `projectKnown`. */}
            {projectKnown && (
              <ContractPanelMount
                projectId={id}
                northStar={northStar}
                instructions={instructions}
                instructionsSource={instructionsSource}
              />
            )}

            {projectKnown && <OnboardWithAgent projectId={id} />}

            {/* W7-B6 (projects-19): this project's open sessions with resume
                links — the page no longer only mints new ones. */}
            <OpenSessionsPanel projectId={id} />
            {/* W7-B6 (orch-02 / projects-20): the bottom "Run a flow" select
                (UsedByFlows) is REMOVED — kick-off now lives in the
                above-the-fold Start-work action group under the tab bar. */}
          </aside>
        </div>
      )}

      {tab === 'roadmap' && (
        <RoadmapView
          projectId={id}
          roadmap={roadmap}
          cycleGroups={cycleGroups}
          onRefresh={refreshRoadmap}
          onOpenDemo={handleOpenDemo}
        />
      )}
    </main>
  );
}

// OnboardWithAgent (R4-02-F1, repointed R4-17) moved to
// components/studio/project-builder/OnboardWithAgent.tsx (W6-B14) — a
// page-route file can only export the reserved Next.js route symbols, so a
// component this task needs a standalone render-pin test for has to live
// outside this file (mirrors RunPanel.tsx's own D12 extraction).

// ---------------------------------------------------------------------------
// ContractPanelMount (R4-12-F1) — the client-side seam that mounts the ASYNC
// server component <ProjectContractPanel> inside this 'use client' page. React
// 18 can't render an async component directly in a client tree (and has no
// `use()` for its returned promise), so this resolves the panel's element in an
// effect and renders it. The panel still owns its OWN fetch
// (fetchContractStages) exactly as its render-test contract pins — this seam
// only threads the props + awaits the returned markup.
// ---------------------------------------------------------------------------

function ContractPanelMount(props: {
  projectId: string;
  northStar?: string | null;
  instructions?: string | null;
  instructionsSource?: string | null;
}) {
  const { projectId, northStar, instructions, instructionsSource } = props;
  const [el, setEl] = useState<JSX.Element | null>(null);
  useEffect(() => {
    let cancelled = false;
    void ProjectContractPanel({ projectId, northStar, instructions, instructionsSource })
      .then((resolved) => { if (!cancelled) setEl(resolved); })
      .catch(() => { if (!cancelled) setEl(null); });
    return () => { cancelled = true; };
  }, [projectId, northStar, instructions, instructionsSource]);
  return el;
}

// ---------------------------------------------------------------------------
// CreateFromTemplate (R4-03) — the greenfield creation interview: name, north
// star, and a curated app-type template → scaffolds a contract-green project
// ready for the first architect run (POST /api/studio/projects/create).
// ---------------------------------------------------------------------------

function CreateFromTemplate() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [northStar, setNorthStar] = useState('');
  const [appType, setAppType] = useState('');
  const [appTypes, setAppTypes] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchProjectStarters().then((types) => {
      setAppTypes(types);
      if (types[0]) setAppType(types[0]);
    });
  }, []);

  const canSubmit = name.trim().length > 0 && northStar.trim().length > 0 && appType.length > 0;

  const onCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const r = await createGreenfieldProject({ name: name.trim(), appType, northStar: northStar.trim() });
      if (r.ok && r.id) router.push(`/projects/${encodeURIComponent(r.id)}`);
      else setError(r.error ?? 'create failed');
    } finally {
      setCreating(false);
    }
  };

  const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--dim)', margin: '10px 0 4px' } as const;
  const inputStyle = { width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 'var(--radius)', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--fg)' } as const;

  return (
    <div data-section="project-create" data-app-type-count={appTypes.length} style={{ maxWidth: 640, margin: '0 auto 64px', padding: '0 28px', width: '100%' }}>
      <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '20px 22px' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Or create a new project</h2>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
          Scaffold a greenfield repo from a framework template — contract-green and ready for the first architect run.
        </p>
        <label style={labelStyle} htmlFor="create-name">Project name</label>
        <input id="create-name" data-field="create-name" style={inputStyle} value={name} placeholder="My new tool" onChange={(e) => setName(e.target.value)} />
        <label style={labelStyle} htmlFor="create-northstar">North star</label>
        <input id="create-northstar" data-field="create-north-star" style={inputStyle} value={northStar} placeholder="One sentence: what it's for" onChange={(e) => setNorthStar(e.target.value)} />
        <label style={labelStyle} htmlFor="create-apptype">App type</label>
        <select id="create-apptype" data-field="create-app-type" style={inputStyle} value={appType} onChange={(e) => setAppType(e.target.value)}>
          {appTypes.length === 0 && <option value="">(no templates found)</option>}
          {appTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className="btn btn-primary"
            data-action="create-project"
            disabled={!canSubmit || creating}
            {...(!canSubmit ? { 'data-disabled-reason': 'Name, north star, and app type are required.', title: 'Name, north star, and app type are required.' } : {})}
            onClick={() => void onCreate()}
          >
            {creating ? 'Creating…' : 'Create project'}
          </button>
          {/* W7-B6 (crosscut-25): the disabled CTA explains itself, like the
              onboard form beside it already did. */}
          {!canSubmit && <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>Name, north star, and app type are required.</span>}
        </div>
        {error && <p className="save-hint save-hint-dirty" style={{ marginTop: 8 }}>{error}</p>}
      </div>
    </div>
  );
}

// ProjectOnboardForm — minimal "register a project" form (UX spec §6).
// Required: name, quality-gate command, north star. Everything else (repo path,
// demo shape/command, instructions) has a working default behind Advanced.
// ---------------------------------------------------------------------------

function ProjectOnboardForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [qualityGate, setQualityGate] = useState('npm test');
  const [northStar, setNorthStar] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [instructions, setInstructions] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // B3: after onboarding, the server scaffolds C4 artifacts and preflights.
  // If any hard clause still fails we keep the operator on the form, list the
  // failing clauses, and point at the forge-onboard-project skill rather than
  // navigating to an editor for a not-yet-buildable project.
  const [failing, setFailing] = useState<FailingClause[] | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const slug = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const canSubmit = name.trim().length > 0 && qualityGate.trim().length > 0 && northStar.trim().length > 0;

  async function onSubmit() {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);
    setFailing(null);
    const result = await createProject({
      name: name.trim(),
      qualityGateCmd: qualityGate.trim(),
      northStar: northStar.trim(),
      repoPath: repoPath.trim() || undefined,
      instructions: instructions.trim() || undefined,
    });
    if (!result.ok || !result.id) {
      setError(result.error ?? 'onboarding failed');
      setSaving(false);
      return;
    }
    // Onboarded. If preflight is green, go straight to the editor; otherwise
    // surface the still-failing hard clauses + let the operator proceed once
    // they understand the project is not yet contract-complete.
    if (result.ready !== false) {
      router.push(`/projects/${encodeURIComponent(result.id)}`);
      return;
    }
    setFailing(result.failingClauses ?? []);
    setPendingId(result.id);
    setSaving(false);
  }

  const labelStyle: React.CSSProperties = { fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--dim)', display: 'block', marginBottom: 5 };
  const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 13, padding: '8px 11px', boxSizing: 'border-box' };

  return (
    <main
      id={MAIN_CONTENT_ID}
      data-page="projects"
      data-project-id="new"
      data-page-ready="true"
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}
    >
      <StudioNav />
      <div data-section="project-onboard" style={{ maxWidth: 640, margin: '0 auto', padding: '40px 28px 64px', width: '100%' }}>
        <PageHeader
          title="Onboard a project"
          lede={
            <>
              Register a code project so a flow can build it. You only need a name, the command that
              proves a change is good (the quality gate), and a one-line north star. Everything else has
              a sensible default. The repo path must point at an <strong>existing directory</strong>
              {' '}(clone it under <code>projects/</code> first — a symlink is rejected); onboarding
              scaffolds the contract files and <code>git init</code>s the dir if it is not already
              its own repo.
            </>
          }
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={labelStyle} htmlFor="onb-name">Project name</label>
            <input id="onb-name" data-field="project-name" style={inputStyle} value={name} placeholder="My project"
              onChange={(e) => setName(e.target.value)} />
            {slug && <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>id: {slug}</div>}
          </div>

          <div>
            <label style={labelStyle} htmlFor="onb-gate">Quality-gate command</label>
            <input id="onb-gate" data-field="quality-gate" style={inputStyle} value={qualityGate}
              placeholder="npm test" onChange={(e) => setQualityGate(e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>One command, green at HEAD, that proves a change is good.</div>
          </div>

          <div>
            <label style={labelStyle} htmlFor="onb-northstar">North star</label>
            <input id="onb-northstar" data-field="north-star" style={inputStyle} value={northStar}
              placeholder="What this project is for, in one line (≤ 140 chars)" maxLength={140}
              onChange={(e) => setNorthStar(e.target.value)} />
          </div>

          <details data-section="onboard-advanced" data-advanced-open={advancedOpen ? 'true' : 'false'} open={advancedOpen}
            onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
            style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
            <summary data-action="toggle-onboard-advanced" style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13, color: 'var(--dim)' }}>
              Advanced — repo path &amp; instructions
            </summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
              <div>
                <label style={labelStyle} htmlFor="onb-repo">Repo path</label>
                <input id="onb-repo" data-field="repo-path" style={inputStyle} value={repoPath}
                  placeholder={`projects/${slug || '<id>'}`} onChange={(e) => setRepoPath(e.target.value)} />
                <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>
                  Must be a real directory under projects/ — clone it there first. A symlink is rejected
                  (project discovery skips symlinked entries, so a symlinked project would never appear here).
                  Defaults to projects/&lt;id&gt;.
                </div>
              </div>
              <div>
                <label style={labelStyle} htmlFor="onb-instr">Instructions</label>
                <textarea id="onb-instr" data-field="instructions" rows={3} style={inputStyle} value={instructions}
                  placeholder="Anything a developer agent must know (defaults to a reference to AGENTS.md)"
                  onChange={(e) => setInstructions(e.target.value)} />
              </div>
            </div>
          </details>

          {error && <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{error}</div>}

          {failing && (
            <div
              data-section="onboard-preflight"
              data-failing-count={failing.length}
              data-pending-id={pendingId ?? ''}
              style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '14px 16px', background: 'var(--bg-2)' }}
            >
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
                Onboarded — but not yet contract-complete
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--dim)', lineHeight: 1.6, margin: '0 0 10px' }}>
                The project was registered and the C4 artifacts were scaffolded, but {failing.length} hard
                preflight {failing.length === 1 ? 'clause' : 'clauses'} still {failing.length === 1 ? 'fails' : 'fail'}.
                Forge will not build it until these are green. Finish onboarding with the{' '}
                <code>forge-onboard-project</code> skill (or fix them by hand), then run{' '}
                <code>forge preflight {pendingId}</code>.
              </p>
              <ul data-section="failing-clauses" style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--faint)', lineHeight: 1.7 }}>
                {failing.map((c) => (
                  <li key={c.id} data-clause-id={c.id}>
                    <strong style={{ color: 'var(--dim)' }}>{c.id}</strong> — {c.title}: {c.detail}
                  </li>
                ))}
              </ul>
              {pendingId && (
                <Link className="btn" data-action="open-onboarded-project" href={`/projects/${encodeURIComponent(pendingId)}`}
                  style={{ marginTop: 12, display: 'inline-block', textDecoration: 'none' }}>
                  Open the project editor anyway →
                </Link>
              )}
            </div>
          )}

          {!failing && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="btn btn-primary" data-action="onboard-project" onClick={() => void onSubmit()}
                {...disabledAttrs(saving ? 'Onboarding…' : !canSubmit ? 'Fill in the required fields first' : null)} style={{ opacity: canSubmit && !saving ? 1 : 0.5 }}>
                {saving ? 'Onboarding…' : 'Onboard project →'}
              </button>
              {!canSubmit && <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>Name, quality gate, and north star are required.</span>}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// RoadmapView — read-only per-project roadmap (S6 DEC-3)
// ---------------------------------------------------------------------------

// plan-everything-before-kickoff: per-card develop state, lifted to RoadmapView
// so the batch "start eligible" button and individual card buttons share one
// source of truth (both funnel through the same startDevelopment() call).
type DevelopCardState = { status: 'idle' | 'starting' | 'started' | 'error'; error: string | null; flowId?: string };

/** Map a batch item result onto the per-card develop state. W7-A3
 *  (projects-32): keep the enqueue's flowId so the card links the run. */
function developStateFromResult(
  item: { ok: boolean; status?: string; detail?: string; flowId?: string } | undefined,
  requestError: string | undefined,
): DevelopCardState {
  return item?.ok
    ? { status: 'started', error: null, flowId: item.flowId }
    : { status: 'error', error: item?.detail ?? item?.status ?? requestError ?? 'failed to start development' };
}

// R4-11-F2: per-card Plan-trigger state, same shape/lift pattern as
// DevelopCardState above. `planned` (whether `workItems` exists) is server
// truth from the roadmap fetch, not tracked here — this only tracks the
// transient client-side request lifecycle of clicking "Plan".
type PlanCardState = { status: 'idle' | 'planning' | 'started' | 'error'; error: string | null; flowId?: string };

/** Map a single plan-dispatch result onto the per-card plan state (W7-A3:
 *  flowId kept so the card links the run, projects-32). */
function planStateFromResult(result: PlanInitiativeResult): PlanCardState {
  return result.status === 'enqueued'
    ? { status: 'started', error: null, flowId: result.flowId }
    : { status: 'error', error: result.detail ?? result.status };
}

/**
 * shc review finding 1 (BLOCKER, silent-default-as-operator-intent) fix: the
 * develop-start ceiling field's SEND decision. `fieldValue`
 * (`resolveCeilingFieldValue`) is what the input DISPLAYS — it seeds from
 * the run-level `defaultCeilingUsd` (`resolveDefaultKickoffCeilingUsd`,
 * orchestrator/config.ts) the instant the tab mounts, long before any
 * operator interaction. Displaying a default is fine; SENDING it on every
 * "Start development" click is not — a manifest with its own
 * `cost_budget_usd`-derived ceiling (`readManifestCostCeiling`'s
 * budget+`DERIVED_CEILING_MARGIN_USD` fallback) would get silently
 * overwritten by the generic per-run default just because the operator
 * opened the tab and clicked Start, never having looked at the field.
 *
 * Gated on `ceilingTouched` FIRST — a real operator opt-in boolean, checked
 * before the value is even inspected — then the usual finite/positive shape
 * check, exactly mirroring RunPanel's `costCeilingEnforceable`-gated
 * `resolveCostCeilingForDispatch` (./run-panel-view.ts). When untouched,
 * returns `undefined` so `POST /api/develop/start` omits `costCeilingUsd`
 * entirely and the manifest's own derived fallback
 * (`resolveCostCeilingOverride`, orchestrator/cycle.ts) stands. Exported so
 * `lib/roadmap-develop-start-ceiling.test.ts` pins the real, shipped gate.
 */
function RoadmapView({
  projectId,
  roadmap,
  cycleGroups,
  onRefresh,
  onOpenDemo,
}: {
  projectId: string;
  roadmap: ProjectRoadmap | null;
  cycleGroups: InitiativeGroup[];
  onRefresh: () => Promise<void>;
  /** R4-07-F3 / W6-B10: roadmap → demo-builder tie-in — resumes the
   *  project's in-flight demo session or opens the kickoff screen, honest
   *  per initiative rather than a fixed target. */
  onOpenDemo?: (initiativeId: string) => void | Promise<void>;
}) {
  const [developByInitiative, setDevelopByInitiative] = useState<Record<string, DevelopCardState>>({});
  const [planByInitiative, setPlanByInitiative] = useState<Record<string, PlanCardState>>({});
  const [batchStarting, setBatchStarting] = useState(false);

  // forge-shc WI-1: the operator per-run cost-ceiling lever for a
  // single-initiative "Start development". `defaultCeilingUsd` arrives
  // ASYNCHRONOUSLY (fetched below) — `manualCeilingUsd` stays `undefined`
  // until the operator types something, so the resolved field value tracks
  // the fetched default until then (same race the agent-run kickoff field
  // already fixed — see `resolveCeilingFieldValue`'s doc comment). T1
  // ruling: this lever is single-id ONLY — the batch "Start eligible"
  // button never sends it (a scalar ceiling can't map onto N manifests).
  const [defaultCeilingUsd, setDefaultCeilingUsd] = useState(0);
  const [manualCeilingUsd, setManualCeilingUsd] = useState<number | undefined>(undefined);
  // shc review finding 1: an EXPLICIT operator opt-in, set true the instant
  // the operator edits the field — and NEVER reset, including on blank —
  // mirrors RunPanel's `costCeilingEnforceable` gate
  // (resolveCostCeilingForDispatch, lib/run-panel-view.ts). Deliberately NOT
  // derived from `manualCeilingUsd !== undefined`: blanking the input sets
  // `manualCeilingUsd` back to `undefined`, which would silently re-arm
  // "untouched" and defeat the opt-in the moment the operator clears the
  // field.
  const [ceilingTouched, setCeilingTouched] = useState(false);
  const ceilingFieldValue = resolveCeilingFieldValue(defaultCeilingUsd, manualCeilingUsd);

  useEffect(() => {
    let cancelled = false;
    fetchStudioAgentsWithMeta()
      .then(({ defaultCostCeilingUsd }) => {
        if (!cancelled) setDefaultCeilingUsd(defaultCostCeilingUsd);
      })
      .catch(() => { /* best-effort — the field just stays at its 0 fallback */ });
    return () => { cancelled = true; };
  }, []);

  const initiatives = useMemo(() => roadmap?.initiatives ?? [], [roadmap]);

  // W7-B6 (projects-18): the "what needs me now" list rendered beside the
  // canvas — same source data, one pure deriver (lib/roadmap-actionable.ts).
  const actionable = useMemo(() => deriveActionableNow(initiatives, cycleGroups), [initiatives, cycleGroups]);

  // plan-everything-before-kickoff: the whole roadmap can be decomposed up
  // front (the flow_id-aware gate), so any number of initiatives may already
  // be pending AND ready at once. "Start eligible" kicks all of them off in a
  // single batched POST rather than one click per card. Ids already starting/
  // started this session are excluded so the button can't re-fire them before
  // the refetched roadmap catches up. R4-11-F2: the batch button honours the
  // same blocked-until-planned lock as the single-card button — a WI-less
  // initiative is never eligible, even if the dep gate says `ready`.
  const eligible = useMemo(
    () =>
      initiatives.filter((i) => {
        const dev = developByInitiative[i.initiativeId]?.status ?? 'idle';
        return i.status === 'pending' && i.ready && i.workItems !== undefined && dev !== 'starting' && dev !== 'started';
      }),
    [initiatives, developByInitiative],
  );

  const startOne = useCallback(async (initiativeId: string): Promise<void> => {
    setDevelopByInitiative((prev) => ({ ...prev, [initiativeId]: { status: 'starting', error: null } }));
    // shc review finding 1: a single-id start carries the operator's ceiling
    // override ONLY when the operator has explicitly touched the field
    // (`ceilingTouched`) — an untouched field must send NOTHING, so the
    // manifest's own derived `cost_budget_usd`+margin fallback
    // (resolveCostCeilingOverride, orchestrator/cycle.ts) stands. Never a
    // fabricated fallback value; an empty/non-finite/non-positive TOUCHED
    // field also degrades to "no override" — the same "nothing sent rather
    // than a round-tripped 400" convention the agent-run kickoff field uses.
    const ceilingToSend = resolveDevelopStartCeilingToSend(ceilingFieldValue, ceilingTouched);
    const r = await startDevelopment([initiativeId], ceilingToSend);
    const item = r.results?.find((x) => x.initiativeId === initiativeId);
    setDevelopByInitiative((prev) => ({ ...prev, [initiativeId]: developStateFromResult(item, r.error) }));
    // Refetch so status/ready/blockedBy reflect the queue's new reality.
    await onRefresh();
  }, [onRefresh, ceilingFieldValue, ceilingTouched]);

  // R4-11-F2: the per-card "Plan" trigger — dispatches the standalone
  // forge-architect (decompose) flow for a WI-less initiative. Refetches
  // afterwards so `workItems` (and therefore the lock) picks up the new state
  // once the scheduler actually decomposes it.
  const planOne = useCallback(async (initiativeId: string): Promise<void> => {
    setPlanByInitiative((prev) => ({ ...prev, [initiativeId]: { status: 'planning', error: null } }));
    const result = await planInitiative(initiativeId);
    setPlanByInitiative((prev) => ({ ...prev, [initiativeId]: planStateFromResult(result) }));
    await onRefresh();
  }, [onRefresh]);

  const startEligible = useCallback(async (): Promise<void> => {
    const ids = eligible.map((i) => i.initiativeId);
    if (ids.length === 0) return;
    setBatchStarting(true);
    setDevelopByInitiative((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = { status: 'starting', error: null };
      return next;
    });
    const r = await startDevelopment(ids);
    setDevelopByInitiative((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        next[id] = developStateFromResult(r.results?.find((x) => x.initiativeId === id), r.error);
      }
      return next;
    });
    setBatchStarting(false);
    // Refetch (success or partial) so eligibility + statuses reflect reality.
    await onRefresh();
  }, [eligible, onRefresh]);

  if (!roadmap) {
    return (
      <div
        data-section="project-roadmap"
        data-project-id={projectId}
        style={{ padding: '32px 28px', color: 'var(--faint)', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}
      >
        No roadmap data yet — plan with the architect to generate initiatives.
        <ProjectArchitectEntry projectId={projectId} />
      </div>
    );
  }

  if (initiatives.length === 0) {
    return (
      <div
        data-section="project-roadmap"
        data-project-id={projectId}
        data-dep-count="0"
        style={{ padding: '32px 28px', color: 'var(--faint)', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}
      >
        No initiatives found for this project.
        {/* W6-SW-3 (sweep C2#2): the sibling !roadmap branch above already
            renders this CTA — a roadmap that resolved with zero initiatives
            is just as much a dead end without it. */}
        <ProjectArchitectEntry projectId={projectId} />
      </div>
    );
  }

  // Dependency depth is surfaced on the section (data-dep-count) for tooling
  // and feeds <RoadmapCanvas>'s pending-band secondary sort (W6-RV-2) — the
  // canvas's PRIMARY axis is real completion time, not dependency depth.
  const initLevels = topoLevels(
    initiatives,
    (i) => i.initiativeId,
    (i) => i.dependsOnInitiatives,
  );

  return (
    <div
      data-section="project-roadmap"
      data-project-id={projectId}
      data-dep-count={String(initLevels.maxLevel)}
      style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 96px', display: 'flex', flexDirection: 'column', gap: 28 }}
    >
      {/* W7-A3 (projects-16 / flows-23): every Plan / Start development
          control below is a queue write — the scheduler daemon does the
          running. Its real state + Start/Pause/Stop sit right above them. */}
      <SchedulerCard variant="strip" queuedCount={initiatives.filter((i) => i.status === 'pending').length} />

      {/* W7-B6 (projects-18): "what needs me now" — the actionable buckets as
          a LIST beside the canvas, with the same actions the per-node drawer
          offers. The canvas stays the map; this is the queue. */}
      {actionable.length > 0 && (
        <div
          data-section="roadmap-actionable"
          data-actionable-count={actionable.length}
          style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '12px 16px' }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 8 }}>
            Actionable now
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {actionable.map((row) => {
              const dev = developByInitiative[row.initiativeId]?.status ?? 'idle';
              const plan = planByInitiative[row.initiativeId]?.status ?? 'idle';
              return (
                <li
                  key={row.initiativeId}
                  data-actionable-row={row.kind}
                  data-initiative-id={row.initiativeId}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, flexWrap: 'wrap' }}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--dim)' }}>{row.initiativeId}</span>
                  <span style={{ color: 'var(--faint)', flex: 1, minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</span>
                  {row.kind === 'plan' && (
                    <button
                      className="btn btn-sm"
                      data-action="actionable-plan"
                      disabled={plan === 'planning' || plan === 'started'}
                      onClick={() => void planOne(row.initiativeId)}
                    >
                      {plan === 'planning' ? 'Planning…' : plan === 'started' ? 'Plan enqueued' : 'Plan →'}
                    </button>
                  )}
                  {row.kind === 'start' && (
                    <button
                      className="btn btn-sm btn-primary"
                      data-action="actionable-start"
                      {...disabledAttrs(dev === 'starting' ? 'Starting…' : dev === 'started' ? 'Already started — open the run to follow it' : null)}
                      onClick={() => void startOne(row.initiativeId)}
                    >
                      {dev === 'starting' ? 'Starting…' : dev === 'started' ? 'Started' : 'Start development →'}
                    </button>
                  )}
                  {row.kind === 'failed' && (
                    <>
                      <span style={{ color: 'var(--red, #f87171)', fontWeight: 600 }}>failed</span>
                      {row.runHref ? (
                        <Link data-action="actionable-view-run" href={row.runHref} style={{ color: 'var(--dim)', fontSize: 12 }}>
                          view run →
                        </Link>
                      ) : (
                        <span style={{ color: 'var(--faint)', fontSize: 11.5 }}>no recorded cycle</span>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* W6-RV-2: the roadmap is a completion-time canvas — done initiatives
          placed on a real day-by-day time axis in completion order, pending
          work banded right of the now-line by dependency-feasibility (no
          invented dates). One edge per prerequisite → dependent pair. */}
      <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '12px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>
            Roadmap
            <span style={{ marginLeft: 10, fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: 'var(--faint)', fontSize: 10.5 }}>
              real completion time · pending work projected right of the now-line
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ProjectArchitectEntry projectId={projectId} />
            {/* forge-shc WI-1: per-initiative cost-ceiling override — applies
                ONLY to a single card's "Start development" click (startOne).
                "Start eligible" is a batch trigger and deliberately never
                reads this field (T1 ruling: a scalar ceiling can't map onto
                N manifests unambiguously). */}
            <label
              title="Cost ceiling (USD) for the next single-initiative 'Start development' click. Does not apply to 'Start eligible' (batch)."
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--faint)' }}
            >
              ceiling ($)
              <input
                type="number"
                data-field="develop-cost-ceiling-usd"
                min={0}
                step="0.01"
                value={ceilingFieldValue}
                onChange={(e) => {
                  const raw = e.target.value;
                  // shc review finding 1: ANY edit — including blanking the
                  // field back to `''` — is the operator's opt-in; touched
                  // is never reset, so a since-cleared field can't silently
                  // re-arm "send the seeded default".
                  setCeilingTouched(true);
                  setManualCeilingUsd(raw === '' ? undefined : Number(raw));
                }}
                style={{
 width: 62, fontSize: 11, padding: '3px 6px', borderRadius: 6,
                  border: '1px solid var(--line)', background: 'var(--panel)', color: 'inherit',
                }}
              />
            </label>
            <button
              data-action="kickoff-eligible"
              data-eligible-count={eligible.length}
              disabled={eligible.length === 0 || batchStarting}
              onClick={() => void startEligible()}
              style={{
                // W7-C3 review (A-M8): --faint is a TEXT token; painting it as
                // a background under #fff was 3.24:1 (and got WORSE, from
                // 5.74:1, when the AA fix lightened --faint). The disabled
                // state is the standard recessive pairing instead — --faint
                // text on --panel-2, the 4.92:1 the token test already pins.
                fontSize: 11, fontWeight: 600,
                color: eligible.length === 0 ? 'var(--faint)' : '#fff',
                background: eligible.length === 0 ? 'var(--panel-2)' : '#238636',
                border: '1px solid var(--line)', borderRadius: 6, padding: '4px 12px',
            cursor: eligible.length === 0 || batchStarting ? 'default' : 'pointer',
                opacity: batchStarting ? 0.6 : 1,
              }}
            >
              {batchStarting ? 'starting…' : `Start eligible (${eligible.length}) →`}
            </button>
          </div>
        </div>
        <RoadmapCanvas
          roadmap={roadmap}
          cycleGroups={cycleGroups}
          developByInitiative={developByInitiative}
          planByInitiative={planByInitiative}
          onStart={startOne}
          onPlan={planOne}
          onRecoveryDone={onRefresh}
          onOpenDemo={onOpenDemo}
        />
      </div>

    </div>
  );
}

