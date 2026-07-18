'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  fetchStudioProjects, fetchStudioKbs, fetchStudioFlows, fetchStudioCatalog,
  saveProject, createProject, fetchPreflight,
  type Project, type DemoStep, type Kb, type Flow, type Catalog, type PreflightResult,
  type FailingClause,
} from '@/lib/studio-client';
import {
  fetchRoadmap, startDevelopment, planInitiative,
  type ProjectRoadmap, type RoadmapInitiative, type RoadmapWorkItem, type PlanInitiativeResult,
} from '@/lib/bridge-client';
import { topoLevels } from '@/lib/dep-layout';
import { StudioNav } from '@/components/StudioNav';
import { SerpentineTimeline, STATUS_COLOURS } from '@/components/studio/SerpentineTimeline';
import { SaveStatus } from '@/components/SaveStatus';
import { useSaveState } from '@/lib/useSaveState';
import { NorthStar } from '@/components/studio/project-builder/NorthStar';
import { Instructions } from '@/components/studio/project-builder/Instructions';
import { DemoTimeline } from '@/components/studio/project-builder/DemoTimeline';
import { SkillsBind } from '@/components/studio/project-builder/SkillsBind';
import { ContractReadiness } from '@/components/studio/project-builder/ContractReadiness';
import { ContractResolutionPanel } from '@/components/studio/project-builder/ContractResolutionPanel';
import { KbBind } from '@/components/studio/project-builder/KbBind';
import { UsedByFlows } from '@/components/studio/project-builder/UsedByFlows';

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
  const [roadmap, setRoadmap] = useState<ProjectRoadmap | null>(null);

  const [northStar, setNorthStar] = useState('');
  const [instructions, setInstructions] = useState('');
  const [instructionsSource, setInstructionsSource] = useState<'AGENTS.md' | 'CLAUDE.md' | 'project.json' | undefined>(undefined);
  const [skills, setSkills] = useState<string[]>([]);
  const [kb, setKb] = useState<string | null>(null);
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
      }
    } finally {
      if (!signal.cancelled) setReady(true);
    }
  }, [id]);

  const loadPreflight = useCallback(async (signal: { cancelled: boolean }) => {
    const result = await fetchPreflight(id);
    if (!signal.cancelled) setPreflight(result);
  }, [id]);

  const loadRoadmap = useCallback(async (signal: { cancelled: boolean }) => {
    const result = await fetchRoadmap(id);
    if (!signal.cancelled) setRoadmap(result);
  }, [id]);

  // plan-everything-before-kickoff: RoadmapView refetches after kickoff so
  // status/ready/blockedBy (and the eligible count) reflect queue reality.
  const refreshRoadmap = useCallback(async () => {
    await loadRoadmap({ cancelled: false });
  }, [loadRoadmap]);

  useEffect(() => {
    const signal = { cancelled: false };
    void loadData(signal);
    void loadPreflight(signal);
    void loadRoadmap(signal);
    return () => { signal.cancelled = true; };
  }, [loadData, loadPreflight, loadRoadmap]);

  // Unified save feedback (X1). The hook owns saving/saved/error state.
  const { saving, error: saveError, save: handleSave, ...saveFb } = useSaveState(async () => {
    if (!project) return { ok: false, error: 'project not loaded' };
    const result = await saveProject(id, {
      name: name.trim(),
      northStar: northStar.trim(),
      instructions: instructions.trim(),
      demoProcess: demoSteps,
      skills,
      kb,
    });
    if (result.ok) {
      setDirty(false);
      void loadPreflight({ cancelled: false });
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

  function handleProjectSelect(newId: string) {
    router.push(`/projects/${encodeURIComponent(newId)}`);
  }

  const skillItems = (catalog.skills ?? []) as Array<{ id: string; name: string; desc?: string }>;

  // New-project onboarding: a minimal required-only form (UX spec §6).
  if (isNew) return <ProjectOnboardForm />;

  return (
    <main
      data-page="projects"
      data-project-id={id}
      data-dirty={dirty ? 'true' : 'false'}
      data-page-ready={ready ? 'true' : 'false'}
      data-demo-design-state={demoDesignNeeded ? 'needed' : 'idle'}
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}
    >
      <StudioNav />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '18px 28px 14px',
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
            padding: '6px 32px 6px 11px', cursor: 'pointer', outline: 'none',
          }}
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
              color: 'var(--text)', background: 'transparent', border: 'none', outline: 'none',
              borderBottom: '2px solid transparent', padding: '2px 4px', minWidth: 160,
            }}
            placeholder="Project name"
          />
        </div>

        <SaveStatus saving={saving} error={saveError} {...saveFb} />
        <button
          className="btn btn-primary"
          data-action="save-project"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
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

      {tab === 'editor' && (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, padding: '24px 28px 64px', display: 'flex', flexDirection: 'column', gap: 24, overflowY: 'auto' }}>
            <NorthStar value={northStar} onChange={(v) => { setNorthStar(v); markDirty(); }} />
            <Instructions project={id} value={instructions} source={instructionsSource} onChange={(v) => { setInstructions(v); markDirty(); }} />
            <DemoTimeline project={id} steps={demoSteps} hasLockedDemo={project?.hasLockedDemo ?? false} onChange={(s) => { setDemoSteps(s); markDirty(); }} />
            <SkillsBind skills={skills} onChange={(s) => { setSkills(s); markDirty(); }} catalog={skillItems} />
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

            <KbBind kb={kb} kbs={kbs} projectId={id} onChange={(v) => { setKb(v); markDirty(); }} />

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
                onChanged={() => void loadPreflight({ cancelled: false })}
              />
            )}

            <UsedByFlows flows={flows} projectId={id} />
          </aside>
        </div>
      )}

      {tab === 'roadmap' && (
        <RoadmapView projectId={id} roadmap={roadmap} onRefresh={refreshRoadmap} />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
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
  const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 13, padding: '8px 11px', outline: 'none', boxSizing: 'border-box' };

  return (
    <main
      data-page="projects"
      data-project-id="new"
      data-page-ready="true"
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}
    >
      <StudioNav />
      <div data-section="project-onboard" style={{ maxWidth: 640, margin: '0 auto', padding: '40px 28px 64px', width: '100%' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>
          Onboard a project
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--dim)', lineHeight: 1.6, margin: '0 0 24px' }}>
          Register a code project so a flow can build it. You only need a name, the command that
          proves a change is good (the quality gate), and a one-line north star. Everything else has
          a sensible default. The repo path must point at an <strong>existing git repository</strong>
          {' '}(clone or symlink it under <code>projects/</code> first); onboarding scaffolds the
          contract files and <code>git init</code>s the dir if it is not already a repo.
        </p>

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
                  Must be an existing git repo (clone/symlink it under projects/ first). Defaults to projects/&lt;id&gt;.
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
                <a className="btn" data-action="open-onboarded-project" href={`/projects/${encodeURIComponent(pendingId)}`}
                  style={{ marginTop: 12, display: 'inline-block', textDecoration: 'none' }}>
                  Open the project editor anyway →
                </a>
              )}
            </div>
          )}

          {!failing && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="btn btn-primary" data-action="onboard-project" onClick={() => void onSubmit()}
                disabled={!canSubmit || saving} style={{ opacity: canSubmit && !saving ? 1 : 0.5 }}>
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
type DevelopCardState = { status: 'idle' | 'starting' | 'started' | 'error'; error: string | null };
const IDLE_DEVELOP: DevelopCardState = { status: 'idle', error: null };

/** Map a batch item result onto the per-card develop state. */
function developStateFromResult(
  item: { ok: boolean; status?: string; detail?: string } | undefined,
  requestError: string | undefined,
): DevelopCardState {
  return item?.ok
    ? { status: 'started', error: null }
    : { status: 'error', error: item?.detail ?? item?.status ?? requestError ?? 'failed to start development' };
}

// R4-11-F2: per-card Plan-trigger state, same shape/lift pattern as
// DevelopCardState above. `planned` (whether `workItems` exists) is server
// truth from the roadmap fetch, not tracked here — this only tracks the
// transient client-side request lifecycle of clicking "Plan".
type PlanCardState = { status: 'idle' | 'planning' | 'started' | 'error'; error: string | null };
const IDLE_PLAN: PlanCardState = { status: 'idle', error: null };

/** Map a single plan-dispatch result onto the per-card plan state. */
function planStateFromResult(result: PlanInitiativeResult): PlanCardState {
  return result.status === 'enqueued'
    ? { status: 'started', error: null }
    : { status: 'error', error: result.detail ?? result.status };
}

/**
 * Combine server truth (`planned` — has `workItems`) with the transient
 * client action state into the one rendered `data-plan-state`. Server truth
 * always wins once it lands: a refetch that surfaces `workItems` flips the
 * card to `planned` even if the client never itself observed the enqueue.
 */
function planStateAttr(unplanned: boolean, plan: PlanCardState): 'planned' | 'planning' | 'error' | 'unplanned' {
  // Only a WI-less *pending* card is "unplanned" (the sole state that renders
  // the Plan trigger + lock). Any non-pending card — even one whose WI
  // snapshot can't be found right now — went through decomposition, so it is
  // reported "planned", never mislabelled "unplanned" (DOM-as-metrics must
  // mirror the actual UI state per the CLAUDE.md convention).
  if (!unplanned) return 'planned';
  if (plan.status === 'error') return 'error';
  if (plan.status === 'planning' || plan.status === 'started') return 'planning';
  return 'unplanned';
}

function RoadmapView({
  projectId,
  roadmap,
  onRefresh,
}: {
  projectId: string;
  roadmap: ProjectRoadmap | null;
  onRefresh: () => Promise<void>;
}) {
  // Node selected in the serpentine timeline → highlight + scroll to its card.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [developByInitiative, setDevelopByInitiative] = useState<Record<string, DevelopCardState>>({});
  const [planByInitiative, setPlanByInitiative] = useState<Record<string, PlanCardState>>({});
  const [batchStarting, setBatchStarting] = useState(false);

  const initiatives = useMemo(() => roadmap?.initiatives ?? [], [roadmap]);

  // Toggle the selected dot; clicking the open one again (or × / Escape) closes.
  const handleSelect = useCallback(
    (initiativeId: string): void =>
      setSelectedId((prev) => (prev === initiativeId ? null : initiativeId)),
    [],
  );

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
    const r = await startDevelopment([initiativeId]);
    const item = r.results?.find((x) => x.initiativeId === initiativeId);
    setDevelopByInitiative((prev) => ({ ...prev, [initiativeId]: developStateFromResult(item, r.error) }));
    // Refetch so status/ready/blockedBy reflect the queue's new reality.
    await onRefresh();
  }, [onRefresh]);

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
        style={{ padding: '32px 28px', color: 'var(--faint)', fontSize: 13 }}
      >
        No roadmap data yet — run an architect session to generate initiatives.
      </div>
    );
  }

  if (initiatives.length === 0) {
    return (
      <div
        data-section="project-roadmap"
        data-project-id={projectId}
        data-dep-count="0"
        style={{ padding: '32px 28px', color: 'var(--faint)', fontSize: 13 }}
      >
        No initiatives found for this project.
      </div>
    );
  }

  // Dependency depth is still surfaced (data-dep-count) for tooling, but the
  // roadmap is now laid out over TIME by the serpentine timeline (which orders
  // its own nodes chronologically). The detail card pops off the selected dot.
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
      {/* The roadmap-over-time: a serpentine arrow, oldest → newest. Clicking a
          dot pops that initiative's detail card up off the dot. */}
      <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '12px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>
            Progression over time
            <span style={{ marginLeft: 10, fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: 'var(--faint)', fontSize: 10.5 }}>
              click a dot for detail
            </span>
          </div>
          <button
            data-action="kickoff-eligible"
            data-eligible-count={eligible.length}
            disabled={eligible.length === 0 || batchStarting}
            onClick={() => void startEligible()}
            style={{
              fontSize: 11, fontWeight: 600, color: '#fff',
              background: eligible.length === 0 ? 'var(--faint)' : '#238636',
              border: '1px solid var(--line)', borderRadius: 6, padding: '4px 12px',
              cursor: eligible.length === 0 || batchStarting ? 'default' : 'pointer',
              opacity: batchStarting ? 0.6 : 1,
            }}
          >
            {batchStarting ? 'starting…' : `Start eligible (${eligible.length}) →`}
          </button>
        </div>
        <SerpentineTimeline
          initiatives={initiatives}
          selectedId={selectedId}
          onSelect={handleSelect}
          onClose={() => setSelectedId(null)}
          renderCard={(init) => (
            <InitiativeCard
              initiative={init}
              selected
              develop={developByInitiative[init.initiativeId] ?? IDLE_DEVELOP}
              onStart={startOne}
              plan={planByInitiative[init.initiativeId] ?? IDLE_PLAN}
              onPlan={planOne}
            />
          )}
        />
      </div>

    </div>
  );
}

function InitiativeCard({
  initiative,
  selected = false,
  develop,
  onStart,
  plan,
  onPlan,
}: {
  initiative: RoadmapInitiative;
  selected?: boolean;
  develop: DevelopCardState;
  onStart: (initiativeId: string) => void | Promise<void>;
  plan: PlanCardState;
  onPlan: (initiativeId: string) => void | Promise<void>;
}) {
  const { initiativeId, title, status, dependsOnInitiatives, workItems, ready, blockedBy } = initiative;
  const colour = STATUS_COLOURS[status] ?? 'var(--faint)';
  const router = useRouter();

  // R4-11-F2: "planned" is the same fact the roadmap-builder computes
  // server-side (`workItems !== undefined` — a WI snapshot exists,
  // independent of queue status). A pending, WI-less initiative is
  // "unplanned" and shows the Plan trigger + the blocked-until-planned lock.
  const planned = workItems !== undefined;
  const unplanned = status === 'pending' && !planned;

  // S7 / DEC-3: "start development" runs the forge-develop flow on a decomposed,
  // not-yet-developing initiative (pending = architect hand-off). It repoints the
  // manifest at forge-develop + threads the cycle_id, then the scheduler claims it.
  // plan-everything-before-kickoff: gated on `ready` too — a pending initiative
  // can still be blocked by an unmet build-flow dependency (item 1's gate).
  // R4-11-F2: also gated on `planned` — a WI-less initiative can't be
  // developed until the standalone Plan trigger (or the architect) decomposes it.
  const canStartDevelopment = status === 'pending' && ready && planned;
  const blocked = status === 'pending' && !ready;

  // WI topo levels (for sub-graph ordering).
  const wiLevels = workItems && workItems.length > 0
    ? topoLevels(workItems, (w) => w.id, (w) => w.dependsOn)
    : null;

  return (
    <div
      data-initiative-id={initiativeId}
      data-initiative-status={status}
      data-develop-state={develop.status}
      data-plan-state={planStateAttr(unplanned, plan)}
      data-initiative-ready={String(ready)}
      data-blocked-by={blockedBy.join(',')}
      style={{
        background: 'var(--panel)',
        border: `1px solid ${selected ? colour : 'var(--line)'}`,
        borderTop: `3px solid ${colour}`,
        borderRadius: 'var(--radius)',
        padding: '14px 16px',
        minWidth: 260, maxWidth: 380,
        display: 'flex', flexDirection: 'column', gap: 10,
        position: 'relative',
        boxShadow: selected ? `0 0 0 2px ${colour}55` : 'none',
        transition: 'box-shadow 0.15s, border-color 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.35 }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 3 }}>{initiativeId}</div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase',
          color: colour, background: `${colour}18`, borderRadius: 4, padding: '2px 6px', flexShrink: 0,
        }}>{status}</span>
      </div>

      {dependsOnInitiatives.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--dim)' }}>
          Depends on: {dependsOnInitiatives.join(', ')}
        </div>
      )}

      {/* plan-everything-before-kickoff: pending-but-blocked — the whole
          roadmap can decompose up front, but this initiative's build-flow
          dep(s) haven't merged yet, so kickoff is withheld. */}
      {blocked && (
        <div data-section="initiative-blocked" style={{ fontSize: 11, color: 'var(--amber, #d29922)' }}>
          Blocked by: {blockedBy.join(', ')}
        </div>
      )}

      {/* R4-11-F2: blocked-until-planned lock — a WI-less initiative can't
          start development until it's decomposed (the standalone Plan
          trigger below, or an architect run). */}
      {unplanned && (
        <div data-section="initiative-blocked-until-planned" style={{ fontSize: 11, color: 'var(--amber, #d29922)' }}>
          Not yet planned — decompose it before starting development.
        </div>
      )}

      {wiLevels && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>Work Items</div>
          {Array.from({ length: wiLevels.maxLevel + 1 }, (_, lvl) => {
            const levelWis = wiLevels.byLevel.get(lvl) ?? [];
            return levelWis.map((wi) => (
              <WorkItemBadge key={wi.id} wi={wi} />
            ));
          })}
        </div>
      )}

      {/* R4-11-F2: Plan trigger — only on a WI-less pending initiative. Runs
          the forge-architect (decompose) flow so a real PM pass produces
          work items, which then flips this card to "planned". */}
      {unplanned && plan.status !== 'started' && (
        <button
          data-action="plan-initiative"
          data-initiative-id={initiativeId}
          disabled={plan.status === 'planning'}
          onClick={() => void onPlan(initiativeId)}
          style={{
            marginTop: 4, alignSelf: 'flex-start',
            color: '#fff', background: plan.status === 'error' ? '#9e6a03' : '#1f6feb',
            border: '1px solid var(--line)', borderRadius: 6, padding: '6px 14px',
            fontSize: 12, fontWeight: 600, cursor: plan.status === 'planning' ? 'default' : 'pointer',
            opacity: plan.status === 'planning' ? 0.6 : 1,
          }}
        >
          {plan.status === 'planning' ? 'planning…' : plan.status === 'error' ? 'retry — plan' : 'Plan →'}
        </button>
      )}
      {unplanned && plan.status === 'error' && plan.error && (
        <div style={{ fontSize: 11, color: 'var(--red, #f85149)' }}>{plan.error}</div>
      )}
      {unplanned && plan.status === 'started' && (
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--green, #3fb950)', fontWeight: 600 }}>Planning started — the initiative will be decomposed into work items.</span>
          <button
            data-action="open-plan-run"
            onClick={() => router.push('/flows/forge-architect')}
            style={{ fontSize: 11, color: '#fff', background: '#1f6feb', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
          >
            view run →
          </button>
        </div>
      )}

      {/* S7: start-development trigger — only on a decomposed, not-yet-developing
          initiative. Runs the forge-develop flow (dev → unifier → review). */}
      {canStartDevelopment && develop.status !== 'started' && (
        <button
          data-action="start-development"
          data-initiative-id={initiativeId}
          disabled={develop.status === 'starting'}
          onClick={() => void onStart(initiativeId)}
          style={{
            marginTop: 4, alignSelf: 'flex-start',
            color: '#fff', background: develop.status === 'error' ? '#9e6a03' : '#238636',
            border: '1px solid var(--line)', borderRadius: 6, padding: '6px 14px',
            fontSize: 12, fontWeight: 600, cursor: develop.status === 'starting' ? 'default' : 'pointer',
            opacity: develop.status === 'starting' ? 0.6 : 1,
          }}
        >
          {develop.status === 'starting' ? 'starting…' : develop.status === 'error' ? 'retry — start development' : 'Start development →'}
        </button>
      )}
      {develop.status === 'error' && develop.error && (
        <div style={{ fontSize: 11, color: 'var(--red, #f85149)' }}>{develop.error}</div>
      )}
      {develop.status === 'started' && (
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--green, #3fb950)', fontWeight: 600 }}>Development started — the unifier will open a PR for review.</span>
          <button
            data-action="open-develop-run"
            onClick={() => router.push('/flows/forge-develop')}
            style={{ fontSize: 11, color: '#fff', background: '#1f6feb', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
          >
            view run →
          </button>
        </div>
      )}
    </div>
  );
}

function WorkItemBadge({ wi }: { wi: RoadmapWorkItem }) {
  return (
    <div
      data-work-item-id={wi.id}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 12, color: 'var(--text)',
        background: 'var(--bg)', borderRadius: 'var(--radius-sm)',
        padding: '5px 9px',
        border: '1px solid var(--line)',
      }}
    >
      <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10, color: 'var(--c-dev, #4ca3f5)', fontWeight: 700 }}>{wi.id}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wi.title}</span>
    </div>
  );
}
