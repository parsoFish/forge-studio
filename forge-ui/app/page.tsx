'use client';

import { useEffect, useState } from 'react';
import { subscribe } from '@/lib/bridge-client';
import {
  fetchRuns,
  fetchStudioAgents,
  fetchStudioFlows,
  fetchStudioKbs,
  fetchStudioProjects,
  type Agent,
  type Flow,
  type Kb,
  type Project,
  type Run,
} from '@/lib/studio-client';
import { StudioNav } from '@/components/StudioNav';
import {
  AgentCard,
  FlowCard,
  KbCard,
  ProjectCard,
} from '@/components/studio/LibraryCard';

// ---------------------------------------------------------------------------
// Library page — the Forge Studio entry screen.
// Mirrors mockups/agent-flow-builder/index.html structure + visual language.
// ---------------------------------------------------------------------------

export default function LibraryPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [ready, setReady] = useState(false);

  // ---- data loading ----
  async function loadAll(signal: { cancelled: boolean }): Promise<void> {
    try {
      const [a, f, p, k, r] = await Promise.all([
        fetchStudioAgents(),
        fetchStudioFlows(),
        fetchStudioProjects(),
        fetchStudioKbs(),
        fetchRuns(),
      ]);
      if (signal.cancelled) return;
      setAgents(a);
      setFlows(f);
      setProjects(p);
      setKbs(k);
      setRuns(r);
    } finally {
      if (!signal.cancelled) setReady(true);
    }
  }

  async function refreshRuns(signal: { cancelled: boolean }): Promise<void> {
    const r = await fetchRuns();
    if (signal.cancelled) return;
    setRuns(r);
  }

  useEffect(() => {
    // intentional mount-only — loadAll/refreshRuns are stable fetch helpers
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const signal = { cancelled: false };

    void loadAll(signal);

    // Subscribe to bridge WS to re-fetch runs on cycle-list-changed.
    const sub = subscribe({
      onState: () => { /* page does not show connection state */ },
      onMessage: (msg) => {
        if (signal.cancelled) return;
        if (msg.type === 'cycle-list-changed') {
          void refreshRuns(signal);
        }
      },
    });

    return () => {
      signal.cancelled = true;
      sub.close();
    };
  }, []);

  // ---- pulse counts ----
  const gatedCount = runs.filter((r) => r.status === 'gated').length;
  const activeCount = runs.filter((r) => r.status === 'active').length;

  // First-run: a brand-new install has no agents, flows, or projects yet.
  // Show an orientation panel with a single primary action instead of four
  // empty card grids (UX spec §1 — empty states orient; one primary CTA).
  const isFirstRun =
    ready && agents.length === 0 && flows.length === 0 && projects.length === 0;

  return (
    <main
      data-page="library"
      data-page-ready={ready ? 'true' : 'false'}
      data-first-run={isFirstRun ? 'true' : 'false'}
      style={{ minHeight: '100vh', background: 'var(--bg)' }}
    >
      <StudioNav />

      <div className="page-wrap" style={{ maxWidth: 1280, margin: '0 auto', padding: '0 28px 64px' }}>

        {/* ===== HERO ===== */}
        <section className="hero" aria-label="Introduction" style={{ padding: '52px 0 44px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.01em', color: 'var(--text)', maxWidth: 640, margin: 0 }}>
            Compose agents into flows.<br />
            Point flows at projects.<br />
            <span style={{ fontStyle: 'normal', background: 'linear-gradient(90deg, var(--ember) 0%, var(--ember-hot) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Let knowledge compound.
            </span>
          </h1>
          <p style={{ fontSize: 15, color: 'var(--dim)', maxWidth: 560, lineHeight: 1.6, margin: 0 }}>
            Forge Studio is a modular agent-flow builder for the operator who runs
            work unattended. Define <em>what gets built</em> (Projects), <em>who does it</em> (Agents),{' '}
            <em>how they chain</em> (Flows), and <em>what they remember</em> (Knowledge).
            Forge is just one flow in this system.
          </p>

          {/* Operator pulse mini-panel */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 32, marginTop: 32 }}>
            {/* Operator pulse panel */}
            <div
              aria-label="Live system status"
              style={{
                marginLeft: 'auto',
                background: 'var(--panel)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius)',
                padding: '14px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                minWidth: 180,
                flexShrink: 0,
              }}
              data-pulse-gated={gatedCount}
              data-pulse-active={activeCount}
              data-pulse-flows={flows.length}
              data-pulse-agents={agents.length}
            >
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 2 }}>
                Operator Pulse
              </div>
              <PulseRow
                dotClass="ember"
                label="Need you"
                value={ready ? gatedCount : '—'}
              />
              <PulseRow
                dotClass="active"
                label="Active runs"
                value={ready ? activeCount : '—'}
              />
              <PulseRow
                dotClass="dim"
                label="Flows"
                value={ready ? flows.length : '—'}
              />
              <PulseRow
                dotClass="dim"
                label="Agents"
                value={ready ? agents.length : '—'}
              />
            </div>
          </div>
        </section>

        {/* ===== FIRST-RUN ORIENTATION ===== */}
        {isFirstRun && (
          <section
            data-section="orientation"
            aria-label="Getting started"
            style={{
              marginBottom: 40,
              padding: '28px 30px',
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius)',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
              Welcome to Forge Studio
            </h2>
            <p style={{ fontSize: 14, color: 'var(--dim)', maxWidth: 600, lineHeight: 1.6, margin: 0 }}>
              Nothing here yet. Build the most basic flow in four steps: create a <strong>plan</strong>,
              a <strong>dev</strong>, and a <strong>review</strong> agent, string them into a flow,
              onboard a project, then give the flow work. Start by creating your first agent from a
              ready-made starter.
            </p>
            <ol
              data-orientation-steps
              style={{ margin: 0, paddingLeft: 18, color: 'var(--faint)', fontSize: 12.5, lineHeight: 1.9 }}
            >
              <li>Create three agents (plan, dev, review)</li>
              <li>String them into a flow</li>
              <li>Onboard a project</li>
              <li>Give the flow work to complete</li>
            </ol>
            <div>
              <a
                href="/agents/new"
                className="btn btn-primary"
                data-action="start-here"
                data-orientation-cta
                style={{ textDecoration: 'none', display: 'inline-block' }}
              >
                Create your first agent →
              </a>
            </div>
          </section>
        )}

        {/* ===== PROJECTS ===== */}
        <section
          className="lib-section"
          data-section="projects"
          data-count={projects.length}
          id="sec-projects"
          style={{ marginBottom: 40 }}
        >
          <div className="lib-section-head" style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 14 }}>
            <span className="badge badge-project">Project</span>
            <span className="lib-count" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 4, padding: '1px 7px' }}>
              {projects.length}
            </span>
            <span style={{ flex: 1 }} />
            <button
              className="btn"
              disabled
              title="M2"
              style={{ cursor: 'not-allowed', opacity: 0.45 }}
            >
              + New Project
            </button>
          </div>
          <div className="card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(288px, 1fr))', gap: 14 }}>
            {projects.map((p, i) => (
              <ProjectCard key={p.id} project={p} kbs={kbs} index={i} />
            ))}
          </div>
        </section>

        <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '44px 0 40px' }} />

        {/* ===== AGENTS ===== */}
        <section
          className="lib-section"
          data-section="agents"
          data-count={agents.length}
          id="sec-agents"
          style={{ marginBottom: 40 }}
        >
          <div className="lib-section-head" style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 14 }}>
            <span className="badge badge-agent">Agent</span>
            <span className="lib-count" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 4, padding: '1px 7px' }}>
              {agents.length}
            </span>
            <span style={{ flex: 1 }} />
            <a
              className="btn"
              href="/agents/new"
              data-action="new-agent"
              style={{ textDecoration: 'none' }}
            >
              + New Agent
            </a>
          </div>
          <div className="card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(288px, 1fr))', gap: 14 }}>
            {agents.map((a, i) => (
              <AgentCard key={a.id} agent={a} index={i} />
            ))}
          </div>
        </section>

        <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '44px 0 40px' }} />

        {/* ===== FLOWS ===== */}
        <section
          className="lib-section"
          data-section="flows"
          data-count={flows.length}
          id="sec-flows"
          style={{ marginBottom: 40 }}
        >
          <div className="lib-section-head" style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 14 }}>
            <span className="badge badge-flow">Flow</span>
            <span className="lib-count" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 4, padding: '1px 7px' }}>
              {flows.length}
            </span>
            <span style={{ flex: 1 }} />
            <button
              className="btn"
              disabled
              title="M2"
              style={{ cursor: 'not-allowed', opacity: 0.45 }}
            >
              + New Flow
            </button>
          </div>
          <div className="card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(288px, 1fr))', gap: 14 }}>
            {flows.map((f, i) => (
              <FlowCard key={f.id} flow={f} runs={runs} projects={projects} index={i} />
            ))}
          </div>
        </section>

        <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '44px 0 40px' }} />

        {/* ===== KNOWLEDGE BASES ===== */}
        <section
          className="lib-section"
          data-section="kbs"
          data-count={kbs.length}
          id="sec-kbs"
          style={{ marginBottom: 40 }}
        >
          <div className="lib-section-head" style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 14 }}>
            <span className="badge badge-kb">Knowledge</span>
            <span className="lib-count" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 4, padding: '1px 7px' }}>
              {kbs.length}
            </span>
            <span style={{ flex: 1 }} />
            <button
              className="btn"
              disabled
              title="M5"
              style={{ cursor: 'not-allowed', opacity: 0.45 }}
            >
              + New KB
            </button>
          </div>
          <div className="card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(288px, 1fr))', gap: 14 }}>
            {kbs.map((k, i) => (
              <KbCard key={k.id} kb={k} index={i} />
            ))}
          </div>
        </section>

      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Operator pulse row
// ---------------------------------------------------------------------------

function PulseRow({ dotClass, label, value }: { dotClass: 'ember' | 'active' | 'dim'; label: string; value: number | string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span
        className={`op-pulse-dot ${dotClass}`}
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          flexShrink: 0,
          ...(dotClass === 'ember' ? { background: 'var(--ember)', boxShadow: '0 0 6px rgba(255,158,74,0.6)', animation: 'pulse 1.6s ease-in-out infinite' } :
             dotClass === 'active' ? { background: 'var(--green)', boxShadow: '0 0 6px rgba(74,222,128,0.5)', animation: 'pulse 1.8s ease-in-out infinite' } :
             { background: 'var(--faint)' }),
        }}
      />
      <span style={{ fontSize: 11.5, color: 'var(--dim)', flex: 1 }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
        {value}
      </span>
    </div>
  );
}
