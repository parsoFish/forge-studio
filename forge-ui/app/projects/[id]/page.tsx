'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  fetchStudioProjects, fetchStudioKbs, fetchStudioFlows, fetchStudioCatalog,
  saveProject, createProject, fetchPreflight,
  type Project, type DemoStep, type Kb, type Flow, type Catalog, type PreflightResult,
  type FailingClause,
} from '@/lib/studio-client';
import { StudioNav } from '@/components/StudioNav';
import { SaveStatus } from '@/components/SaveStatus';
import { useSaveState } from '@/lib/useSaveState';
import { NorthStar } from '@/components/studio/project-builder/NorthStar';
import { Instructions } from '@/components/studio/project-builder/Instructions';
import { DemoTimeline } from '@/components/studio/project-builder/DemoTimeline';
import { SkillsBind } from '@/components/studio/project-builder/SkillsBind';
import { ContractReadiness } from '@/components/studio/project-builder/ContractReadiness';
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

  const [northStar, setNorthStar] = useState('');
  const [instructions, setInstructions] = useState('');
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

  useEffect(() => {
    const signal = { cancelled: false };
    void loadData(signal);
    void loadPreflight(signal);
    return () => { signal.cancelled = true; };
  }, [loadData, loadPreflight]);

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

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, padding: '24px 28px 64px', display: 'flex', flexDirection: 'column', gap: 24, overflowY: 'auto' }}>
          <NorthStar value={northStar} onChange={(v) => { setNorthStar(v); markDirty(); }} />
          <Instructions value={instructions} onChange={(v) => { setInstructions(v); markDirty(); }} />
          <DemoTimeline steps={demoSteps} onChange={(s) => { setDemoSteps(s); markDirty(); }} />
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

          <KbBind kb={kb} kbs={kbs} projectName={name} summary={northStar} onChange={(v) => { setKb(v); markDirty(); }} />

          <ContractReadiness
            northStar={northStar}
            instructions={instructions}
            demoSteps={demoSteps}
            skills={skills}
            kb={kb}
            preflight={preflight}
          />

          <UsedByFlows flows={flows} projectId={id} />
        </aside>
      </div>
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
  const [demoShape, setDemoShape] = useState('harness');
  const [demoCommand, setDemoCommand] = useState('');
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
      demoShape,
      demoCommand: demoCommand.trim() || undefined,
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
              Advanced — repo path, demo &amp; instructions
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
                <label style={labelStyle} htmlFor="onb-demo-shape">Demo shape</label>
                <select id="onb-demo-shape" data-field="demo-shape" style={inputStyle} value={demoShape}
                  onChange={(e) => setDemoShape(e.target.value)}>
                  {['harness', 'cli-diff', 'artifact', 'browser', 'live-external', 'none'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle} htmlFor="onb-demo-cmd">Demo command</label>
                <input id="onb-demo-cmd" data-field="demo-command" style={inputStyle} value={demoCommand}
                  placeholder="defaults to the quality-gate command" onChange={(e) => setDemoCommand(e.target.value)} />
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
