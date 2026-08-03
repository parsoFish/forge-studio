// ── Home — the operator dashboard ─────────────────────────────────────
// Diagram: nav + active status of agents/flows + overviews of every pillar.

function HomeView({ go, toast }) {
  const activeFlows = FLOWS.filter(f => f.status === 'active');
  const activeAgents = AGENTS.filter(a => a.status === 'active');

  return (
    <div className="page">
      <PageHead
        eyebrow="forge studio"
        title="Everything running, at a glance"
        lede="One surface for the whole fleet: live flows and agents, the portfolio, the libraries behind them, and the brains they learn into."
        actions={
          <React.Fragment>
            <button className="btn" onClick={() => go('projects', 'list')}>Onboard a project</button>
            <button className="btn btn-primary" onClick={() => go('flows', 'monitor', 'forge-develop')}>
              <span className="status-dot" data-status="active"></span> Watch live run
            </button>
          </React.Fragment>
        }
      />

      {/* attention strip */}
      {ATTENTION.length > 0 ? (
        <Panel title="Needs attention" pad={false}>
          {ATTENTION.map(a => (
            <button
              key={a.id}
              className="monitor-row"
              onClick={() => go(a.target.section, a.target.view, a.target.id)}
              style={{ borderBottom: '1px solid var(--line)' }}
            >
              <span className="status-dot" data-status={a.status}></span>
              <span style={{ flex: 1 }}>
                <span className="m-name">{a.text}</span>
                <span className="m-sub">{a.sub}</span>
              </span>
              <span className="faint mono" style={{ fontSize: 11 }}>open →</span>
            </button>
          ))}
        </Panel>
      ) : null}

      {/* live constellation — the signature moment */}
      <SectionTitle count={activeFlows.length + activeAgents.length + ' live'}>Active status — flows &amp; agents</SectionTitle>
      <Panel pad={false}>
        <div className="constellation">
          {FLOWS.map(f => (
            <HexCell key={f.id} kind="flow" glyph="⬡" label={f.name} status={f.status}
              onClick={() => go('flows', 'monitor', f.id)} />
          ))}
          {AGENTS.map(a => (
            <HexCell key={a.id} kind="agent" glyph="⬢" label={a.name} status={a.status}
              onClick={() => go('agents', 'monitor', a.id)} />
          ))}
        </div>
      </Panel>

      {/* flows overview */}
      <SectionTitle count={FLOWS.length} onSeeAll={() => go('flows', 'home')}>Flows</SectionTitle>
      <div className="card-grid">
        {FLOWS.map(f => (
          <ObjCard key={f.id} type="flow" name={f.name} desc={f.desc} status={f.status}
            badges={<React.Fragment><TypeBadge type="flow" /><ProvenanceBadge provenance={f.provenance} /></React.Fragment>}
            stats={[f.stats.runs + ' runs', f.stats.merged + ' merged']}
            live={f.live}
            onClick={() => go('flows', 'monitor', f.id)} />
        ))}
      </div>

      {/* agents overview */}
      <SectionTitle count={AGENTS.length} onSeeAll={() => go('agents', 'home')}>Agents</SectionTitle>
      <div className="card-grid">
        {AGENTS.slice(0, 4).map(a => (
          <ObjCard key={a.id} type="agent" name={a.name} desc={a.desc} status={a.status}
            badges={<React.Fragment><TypeBadge type="agent" /><ProvenanceBadge provenance={a.provenance} /></React.Fragment>}
            stats={[a.runtime.split(' · ')[1] || a.runtime, a.inFlows.length ? 'in ' + a.inFlows.join(', ') : 'standalone']}
            live={a.live}
            onClick={() => go('agents', 'monitor', a.id)} />
        ))}
      </div>

      {/* projects overview */}
      <SectionTitle count={PROJECTS.length} onSeeAll={() => go('projects', 'list')}>Projects</SectionTitle>
      <div className="card-grid">
        {PROJECTS.slice(0, 4).map(p => (
          <ObjCard key={p.id} type="project" name={p.name} desc={p.desc} status={p.status}
            badges={<React.Fragment><TypeBadge type="project" /><ProvenanceBadge provenance={p.provenance} /></React.Fragment>}
            stats={[p.type, p.stats.cycles + ' cycles', p.stats.roadmap]}
            live={p.live}
            onClick={() => go('projects', 'detail', p.id)} />
        ))}
      </div>

      <div className="two-col" style={{ marginTop: 30 }}>
        {/* library overview */}
        <div>
          <SectionTitle onSeeAll={() => go('library', 'home')}>Library</SectionTitle>
          <Panel pad={false}>
            {[
              { label: 'Skills', count: SKILLS_LOCAL.length + ' local · ' + SKILLS_COMMUNITY.length + ' community', view: 'skills', dot: 'dot-skill' },
              { label: 'Hooks', count: HOOKS_LOCAL.length + ' local · ' + HOOKS_COMMUNITY.length + ' community', view: 'hooks', dot: 'dot-hook' },
              { label: 'External connections', count: CONNECTIONS.mcps.length + ' MCPs · ' + CONNECTIONS.clis.length + ' CLIs · ' + CONNECTIONS.tools.length + ' tools', view: 'connections', dot: 'dot-tool' },
            ].map(r => (
              <button key={r.view} className="monitor-row" onClick={() => go('library', r.view)}>
                <span className={'catalog-chip ' + r.dot} style={{ width: 10, height: 10, padding: 0, borderRadius: '50%', border: 'none' }}></span>
                <span className="m-name">{r.label}</span>
                <span className="mono faint" style={{ fontSize: 11 }}>{r.count}</span>
              </button>
            ))}
          </Panel>
        </div>

        {/* knowledge overview */}
        <div>
          <SectionTitle onSeeAll={() => go('knowledge', 'list')}>Knowledge bases</SectionTitle>
          <Panel pad={false}>
            {BRAINS.slice(0, 4).map(b => (
              <button key={b.id} className="monitor-row" onClick={() => go('knowledge', 'detail', b.id)}>
                <span className="status-dot" data-status={b.status}></span>
                <span style={{ flex: 1 }}>
                  <span className="m-name">{b.name}</span>
                  <span className="m-sub">{b.scope}</span>
                </span>
                <span className="mono faint" style={{ fontSize: 11 }}>{b.themes} themes</span>
              </button>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { HomeView });
