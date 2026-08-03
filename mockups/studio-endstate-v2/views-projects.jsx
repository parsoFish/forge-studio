// ── Projects: list + create + full detail (roadmap · demos · cycles) ──

function allProjects() {
  const SCN = window.SCN || {};
  const list = PROJECTS.slice();
  if (SCN.onboardDone) list.unshift(EXTRA.blogProject);
  if (SCN.newProject) list.unshift(EXTRA.pulseboardProject);
  return list;
}

function ProjectsView({ go }) {
  const projects = allProjects();
  const managed = projects.filter(p => p.provenance === 'operator');
  const demos = projects.filter(p => p.provenance !== 'operator');

  return (
    <div className="page">
      <PageHead
        eyebrow="projects" color="var(--c-project)"
        title="Projects"
        lede="The portfolio forge manages — plus the demo projects shipped out of the box as its synthetic test bed. Onboarding and creation are both agent-led sessions."
        actions={
          <React.Fragment>
            <button className="btn" data-j="onboard-btn" onClick={() => go('agents', 'session', 'project-onboarding')}>Onboard existing project</button>
            <button className="btn btn-primary" data-j="create-project-btn" onClick={() => go('projects', 'create')}>+ Create new project</button>
          </React.Fragment>
        }
      />

      <SectionTitle count={managed.length}>Managed projects</SectionTitle>
      <div className="card-grid">
        {managed.map(p => (
          <ObjCard key={p.id} jid={'project-' + p.id} type="project" name={p.name} desc={p.desc} status={p.status}
            badges={<React.Fragment><TypeBadge type="project" /><ProvenanceBadge provenance={p.provenance} /></React.Fragment>}
            stats={[p.type, p.stats.cycles + ' cycles', p.stats.roadmap]}
            live={p.live}
            onClick={() => go('projects', 'detail', p.id)} />
        ))}
      </div>

      <SectionTitle count={demos.length}>Demo projects — shipped with forge</SectionTitle>
      <p className="muted" style={{ fontSize: 12.5, margin: '0 0 12px', maxWidth: '78ch' }}>
        Several project shapes (APIs, UIs, libraries) that demonstrate forge’s capabilities out of the box and act
        as its synthetic test bed — run any flow against them without touching a real repo. New projects start from
        the matching <a href="#" onClick={e => { e.preventDefault(); go('library', 'templates'); }}>project-type scaffold</a>.
      </p>
      <div className="card-grid">
        {demos.map(p => (
          <ObjCard key={p.id} type="project" name={p.name} desc={p.desc} status={p.status}
            badges={<React.Fragment><TypeBadge type="project" /><ProvenanceBadge provenance={p.provenance} /></React.Fragment>}
            stats={[p.type, p.stats.cycles + ' cycles']}
            onClick={() => go('projects', 'detail', p.id)} />
        ))}
      </div>
    </div>
  );
}

// ---------- create-new-project (scaffold picker → creation session) ----------
function ProjectCreate({ go }) {
  const [picked, setPicked] = React.useState(null);
  const [name, setName] = React.useState('');
  const scaffolds = TEMPLATES.filter(t => t.cat === 'project type');
  return (
    <div className="page">
      <PageHead
        eyebrow="projects / create" color="var(--c-project)"
        title="Create a new project"
        lede="Pick a project-type scaffold — each ships already conforming to the forge contract (demo capability, gates, journey harness where relevant). The creation agent takes it from there."
        actions={<button className="btn btn-sm" onClick={() => go('projects', 'list')}>← Projects</button>}
      />
      <SectionTitle count={scaffolds.length}>1 · Choose a scaffold</SectionTitle>
      <div className="three-col">
        {scaffolds.map(t => (
          <button key={t.id} data-j={'scaffold-' + t.id}
            className="obj-card" data-type="project"
            style={picked === t.id ? { borderColor: 'var(--c-project)', boxShadow: '0 0 0 1px rgba(92,200,255,.25)' } : undefined}
            onClick={() => setPicked(t.id)}>
            <span className="tpl-thumb" data-kind="scaffold"></span>
            <div className="card-top" style={{ marginBottom: 6 }}>
              <span className="card-name">{t.name.replace('project scaffold · ', '')}</span>
              <ProvenanceBadge provenance={t.provenance} />
            </div>
            <p className="card-desc">{t.desc}</p>
          </button>
        ))}
      </div>
      <SectionTitle>2 · Name it</SectionTitle>
      <div className="row" style={{ maxWidth: 560 }}>
        <input className="input" data-j="project-name" placeholder="Project name…" value={name} onChange={e => setName(e.target.value)} />
        <button className="btn btn-primary" data-j="start-creation" style={{ whiteSpace: 'nowrap' }}
          onClick={() => go('agents', 'session', 'create-project')}>
          Start creation session
        </button>
      </div>
      <p className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
        The session applies the scaffold, confirms intent, and hands you a contract-green project with a starter roadmap.
      </p>
    </div>
  );
}

function ProjectDetail({ projectId, go, toast }) {
  const projects = allProjects();
  const project = projects.find(p => p.id === projectId) || projects[0];
  const roadmap = ROADMAPS[project.id] || [];
  const demos = DEMO_ARTIFACTS[project.id] || [];
  const cycles = (FLOW_HISTORY['forge-develop'] || []).filter(r => r.what.toLowerCase().startsWith(project.id === 'trafficgame' ? 'trafficgame' : project.id));
  const [ptab, setPtab] = React.useState('overview'); // roadmap gets its own full-page tab

  return (
    <div className="page">
      <PageHead
        eyebrow="projects" color="var(--c-project)"
        title={project.name}
        lede={project.desc}
        actions={
          <React.Fragment>
            <ProvenanceBadge provenance={project.provenance} />
            <button className="btn btn-sm" onClick={() => go('projects', 'list')}>← All projects</button>
            <button className="btn btn-sm" onClick={() => go('agents', 'session', 'architect-planning')}>Plan with Architect</button>
            <button className="btn btn-primary btn-sm" onClick={() => go('agents', 'session', 'demo-builder')}>Demo capability</button>
          </React.Fragment>
        }
      />

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 22 }}>
        <span className="card-stat">{project.type}</span>
        <span className="card-stat">{project.stats.cycles} cycles · {project.stats.merged} merged</span>
        <span className="card-stat">roadmap: {project.stats.roadmap}</span>
        {project.brain
          ? <button className="btn btn-ghost btn-sm" onClick={() => go('knowledge', 'detail', project.brain)}>⬡ brain: projects/{project.brain}</button>
          : <button className="btn btn-ghost btn-sm" onClick={() => go('agents', 'session', 'brain-creation')}>⬡ no brain yet — seed one</button>}
        <span className="spacer"></span>
        <StatusPair status={project.status} />
      </div>

      {project.live ? (
        <div className="live-strip" style={{ marginBottom: 22 }}>
          <span className="status-dot" data-status="active"></span>
          <span className="what">{project.live.what}</span>
          <span className="cost">{project.live.cost}</span>
          <button className="btn btn-sm" onClick={() => go('flows', 'run', 'forge-develop:0')}>Open run →</button>
        </div>
      ) : null}

      {/* Overview | Roadmap — the roadmap earns a full page as it grows */}
      <div className="tabs" style={{ margin: '0 0 16px', display: 'flex', gap: 2, borderBottom: '1px solid var(--line)' }}>
        {[{ id: 'overview', label: 'Overview' }, { id: 'roadmap', label: 'Roadmap' }].map(t => (
          <button key={t.id} data-j={'ptab-' + t.id}
            className="btn btn-ghost btn-sm"
            style={ptab === t.id ? { color: 'var(--ember)', borderBottom: '2px solid var(--ember)', borderRadius: 0 } : { borderRadius: 0 }}
            onClick={() => setPtab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {ptab === 'roadmap' ? (
        <React.Fragment>
          <Panel title="Roadmap — dependency DAG (click any initiative to open its run)" pad={false}
            right={<button className="see-all" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--steel)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}
              onClick={() => go('agents', 'session', 'architect-planning')}>refresh in session →</button>}>
            {roadmap.length ? (
              <div style={{ minHeight: 260, display: 'flex', alignItems: 'center' }}>
                <RoadmapDag roadmap={roadmap} go={go} />
              </div>
            ) : <Empty text="No roadmap yet." hint="Run an Architect/Planning session to generate one from an idea." />}
          </Panel>
          <div style={{ height: 16 }}></div>
          <Panel title="Initiatives — the Architect session's outcome" pad={false}>
            {roadmap.length ? (
              <table className="ledger">
                <thead><tr><th>initiative</th><th>status</th><th>depends on</th></tr></thead>
                <tbody>
                  {roadmap.map(r => (
                    <tr key={r.id} className={r.run ? 'row-click' : undefined}
                      onClick={r.run ? () => go('flows', 'run', r.run) : undefined}>
                      <td><span className="t-main mono" style={{ fontSize: 12 }}>{r.id}</span><div className="t-sub">{r.name}</div></td>
                      <td><span className="rm-status" data-s={r.status}>{r.status}</span></td>
                      <td className="t-mono">{r.dep || '—'}{r.run ? <span className="faint"> · run →</span> : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty text="No initiatives yet." />}
          </Panel>
        </React.Fragment>
      ) : null}

      <div className="two-col" style={ptab === 'roadmap' ? { display: 'none' } : undefined}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Panel title="Roadmap — the Architect session's outcome" pad={false}
            right={<button className="see-all" style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => go('agents', 'session', 'architect-planning')}>refresh in session →</button>}>
            {roadmap.length ? (
              <table className="ledger">
                <thead><tr><th>initiative</th><th>status</th><th>depends on</th></tr></thead>
                <tbody>
                  {roadmap.map(r => (
                    <tr key={r.id} className={r.run ? 'row-click' : undefined}
                      onClick={r.run ? () => go('flows', 'run', r.run) : undefined}>
                      <td><span className="t-main mono" style={{ fontSize: 12 }}>{r.id}</span><div className="t-sub">{r.name}</div></td>
                      <td><span className="rm-status" data-s={r.status}>{r.status}</span></td>
                      <td className="t-mono">{r.dep || '—'}{r.run ? <span className="faint"> · run →</span> : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty text="No roadmap yet." hint="Run an Architect/Planning session to generate one from an idea." />}
          </Panel>

          <Panel title="Instructions & contract — what every agent on this repo reads first" pad={false}>
            {PROJECT_CONTRACTS[project.id] ? (
              <div data-j="contract-panel">
                <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
                  <span className="field-label">North star — the operator's words, verbatim</span>
                  <p style={{ margin: 0, fontSize: 14, fontFamily: 'var(--font-display)', color: 'var(--text)', lineHeight: 1.5 }}>
                    “{PROJECT_CONTRACTS[project.id].northStar}”
                  </p>
                </div>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
                  <span className="field-label">Conventions (AGENTS.md)</span>
                  <ul className="readiness-list">
                    {PROJECT_CONTRACTS[project.id].conventions.map((c, i) => (
                      <li key={i} className="readiness-item ok"><span className="ri-dot"></span>{c}</li>
                    ))}
                  </ul>
                </div>
                <div className="row" style={{ padding: '12px 16px', gap: 8, flexWrap: 'wrap' }}>
                  <span className="card-stat">gates: {PROJECT_CONTRACTS[project.id].gates}</span>
                  {PROJECT_CONTRACTS[project.id].secrets.length
                    ? <span className="card-stat">secrets: {PROJECT_CONTRACTS[project.id].secrets.join(' · ')} <span className="faint">(names only)</span></span>
                    : <span className="card-stat faint">secrets: none declared</span>}
                </div>
              </div>
            ) : (
              <ul className="readiness-list" style={{ padding: 14 }}>
                {['AGENTS.md instructions present', 'Demo skill authored', 'Test + lint gates wired', 'Roadmap current'].map((c, i) => (
                  <li key={i} className={'readiness-item' + (project.stats.cycles > 0 ? ' ok' : '')}>
                    <span className="ri-dot"></span>{c}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Panel title="Demo artifacts — visual evidence per cycle" pad={false}
            right={SHOWCASE[project.id] ? (
              <button className="see-all" data-j="showcase-btn" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--steel)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}
                onClick={() => go('projects', 'showcase', project.id)}>
                open showcase →
              </button>
            ) : null}>
            {demos.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 14 }}>
                {demos.map((d, i) => (
                  <button key={i} className="obj-card" data-type="artifact" style={{ padding: 12 }}
                    onClick={() => toast('Opens the actual artifact (mock) — ' + d.name)}>
                    <span className="tpl-thumb" data-kind={d.kind} style={{ height: 74, marginBottom: 8 }}></span>
                    <span style={{ fontSize: 12.5, fontFamily: 'var(--font-display)', fontWeight: 600 }}>{d.name}</span>
                    <span className="faint" style={{ fontSize: 11 }}>{d.sub}</span>
                  </button>
                ))}
              </div>
            ) : <Empty text="No demo artifacts yet." hint="Author the demo capability with the Demo Builder, then every cycle produces evidence here." />}
          </Panel>

          <Panel title="Cycle history" pad={false}>
            {cycles.length ? <Ledger rows={cycles} /> : <Empty text="No cycles yet for this project." />}
          </Panel>
        </div>
      </div>
    </div>
  );
}

// dependency-DAG visualisation of a roadmap: columns by dep depth,
// initiative pills colored by status, completed runs diggable.
function RoadmapDag({ roadmap, go }) {
  const depth = r => { let d = 0, cur = r; while (cur && cur.dep) { cur = roadmap.find(x => x.id === cur.dep); d++; if (d > 12) break; } return d; };
  const byDepth = [];
  roadmap.forEach(r => { const d = depth(r); (byDepth[d] = byDepth[d] || []).push(r); });
  const colsArr = byDepth.filter(Boolean);
  return (
    <div className="rmdag" data-j="roadmap-dag">
      {colsArr.map((col, ci) => (
        <React.Fragment key={ci}>
          {ci > 0 ? <DagConnector from={colsArr[ci - 1].length} to={col.length} live={false} slot={62} /> : null}
          <div className="dag-col">
            {col.map(r => (
              <button key={r.id} className="rmnode" data-s={r.status} data-j={'rm-' + r.id}
                onClick={() => r.run ? go('flows', 'run', r.run) : null}
                title={r.run ? 'open run' : 'no run yet'}>
                <span className="rm-id">{r.id} · <span className="rm-status" data-s={r.status} style={{ border: 'none', padding: 0 }}>{r.status}</span></span>
                <span className="rm-name">{r.name}</span>
              </button>
            ))}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

Object.assign(window, { ProjectsView, ProjectDetail, ProjectCreate, RoadmapDag });
