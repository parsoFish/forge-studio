'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  fetchStudioProjects, fetchStudioKbs, fetchStudioFlows, fetchStudioCatalog,
  saveProject, fetchPreflight,
  type Project, type DemoStep, type Kb, type Flow, type Catalog, type PreflightResult,
} from '@/lib/studio-client';
import { StudioNav } from '@/components/StudioNav';
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

  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [catalog, setCatalog] = useState<Catalog>({});
  const [demoSteps, setDemoSteps] = useState<DemoStep[]>([]);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
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

  const handleSaveRef = useRef<() => Promise<void>>(handleSave);
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

  function markDirty() { setDirty(true); setSaveError(null); }

  async function handleSave() {
    if (saving || !project) return;
    setSaving(true);
    setSaveError(null);
    try {
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
      } else {
        setSaveError(result.error ?? 'save failed');
      }
    } finally {
      setSaving(false);
    }
  }

  function handleProjectSelect(newId: string) {
    router.push(`/projects/${encodeURIComponent(newId)}`);
  }

  const usedByFlows = flows.filter((f) => f.project === id);
  const skillItems = (catalog.skills ?? []) as Array<{ id: string; name: string; desc?: string }>;

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

        {saveError && <span style={{ fontSize: 12, color: 'var(--red)' }}>{saveError}</span>}
        <button
          className="btn btn-primary"
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

          <KbBind kb={kb} kbs={kbs} onChange={(v) => { setKb(v); markDirty(); }} />

          <ContractReadiness
            northStar={northStar}
            instructions={instructions}
            demoSteps={demoSteps}
            skills={skills}
            kb={kb}
            preflight={preflight}
          />

          <UsedByFlows flows={usedByFlows} />
        </aside>
      </div>
    </main>
  );
}
