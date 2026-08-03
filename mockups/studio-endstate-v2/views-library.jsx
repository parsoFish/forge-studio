// ── Library: Home / Skills / Hooks / External connections / Templates ─
// Every card navigates to a real detail surface (views-library-detail.jsx).

function LibraryHome({ go }) {
  const pillars = [
    {
      view: 'skills', label: 'Skills', type: 'skill', dot: 'dot-skill',
      desc: 'Reusable capabilities agents load on demand. Shipped with forge, built by you — or pulled from the community.',
      counts: SKILLS_LOCAL.length + ' local · ' + SKILLS_COMMUNITY.length + ' community',
    },
    {
      view: 'hooks', label: 'Hooks', type: 'hook', dot: 'dot-hook',
      desc: 'Event-bound automations: pre-PR gates, post-merge ingest triggers, operator notifications.',
      counts: HOOKS_LOCAL.length + ' local · ' + HOOKS_COMMUNITY.length + ' community',
    },
    {
      view: 'connections', label: 'External connections', type: 'tool', dot: 'dot-tool',
      desc: 'Tools, MCPs and CLIs — everything agents reach beyond the repo.',
      counts: CONNECTIONS.mcps.length + ' MCPs · ' + CONNECTIONS.clis.length + ' CLIs · ' + CONNECTIONS.tools.length + ' tools',
    },
    {
      view: 'templates', label: 'Templates', type: 'artifact', dot: 'dot-template',
      desc: 'In/out artifacts as objects: demo formats (HTML, video, screenshots), planning docs, project scaffolds.',
      counts: TEMPLATES.length + ' templates · 3 categories',
    },
  ];
  return (
    <div className="page">
      <PageHead
        eyebrow="library" color="var(--violet)"
        title="Library"
        lede="The component shelf every builder draws from. Skills, hooks, external connections and templates are first-class objects: versioned, attributable, and pluggable into any agent or flow."
      />
      <div className="card-grid">
        {pillars.map(p => (
          <button key={p.view} className="obj-card" data-type={p.type} onClick={() => go('library', p.view)}>
            <div className="card-top">
              <span className={'catalog-chip ' + p.dot} style={{ width: 10, height: 10, padding: 0, borderRadius: '50%', border: 'none', marginTop: 5 }}></span>
              <span className="card-name">{p.label}</span>
            </div>
            <p className="card-desc" style={{ WebkitLineClamp: 3 }}>{p.desc}</p>
            <div className="card-meta"><span className="card-stat">{p.counts}</span></div>
          </button>
        ))}
      </div>

      <div className="two-col" style={{ marginTop: 30 }}>
        <div>
          <SectionTitle>Recently updated</SectionTitle>
          <Panel pad={false}>
            <Ledger rows={[
              { when: '6d ago', what: 'demo HTML summary → v3', sub: 'revised after the INIT-10 demo-gap finding', status: 'complete', cost: '' },
              { when: '2w ago', what: 'pre-pr-security-review hook', sub: 'scope widened to auth-touching diffs', status: 'complete', cost: '' },
              { when: '3w ago', what: 'forge-onboard-project skill', sub: 'contract invariants updated for monorepos', status: 'complete', cost: '' },
            ]} />
          </Panel>
        </div>
        <div>
          <SectionTitle>From the community</SectionTitle>
          <Panel pad={false}>
            {[
              { name: 'frontend-design', sub: 'anthropics/skills · skill', view: 'skills', id: 'frontend-design' },
              { name: 'no-secrets', sub: 'community · hook', view: 'hooks', id: 'no-secrets' },
              { name: 'playwright', sub: 'MCP · demo evidence capture', view: 'connections', id: 'playwright' },
            ].map(r => (
              <button key={r.name} className="monitor-row" onClick={() => go('library', r.view, r.id)}>
                <span className="badge badge-community">community</span>
                <span style={{ flex: 1 }}>
                  <span className="m-name mono" style={{ fontSize: 12.5 }}>{r.name}</span>
                  <span className="m-sub">{r.sub}</span>
                </span>
                <span className="faint mono" style={{ fontSize: 11 }}>open →</span>
              </button>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function LibraryShelf({ kind, go, toast }) {
  // kind: 'skills' | 'hooks'
  const SCN = window.SCN || {};
  const isSkills = kind === 'skills';
  const local = (isSkills ? SKILLS_LOCAL : HOOKS_LOCAL).slice();
  if (isSkills && SCN.builtSkill) local.push(EXTRA.builtSkill);
  if (!isSkills && SCN.builtHook) local.push(EXTRA.builtHook);
  COMMUNITY.filter(c => SCN['inst_' + c.id] === 'installed' && c.kind === (isSkills ? 'skill' : 'hook')).forEach(c => {
    if (!local.some(l => l.name === c.name)) local.push({ id: c.id, name: c.name, desc: c.desc, used: 'newly installed', on: 'installed', provenance: 'operator', community: true });
  });
  const community = isSkills ? SKILLS_COMMUNITY : HOOKS_COMMUNITY;
  const noun = isSkills ? 'skill' : 'hook';
  const [q, setQ] = React.useState('');
  const filt = list => list.filter(x => !q || (x.name + ' ' + x.desc).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page">
      <PageHead
        eyebrow={'library / ' + kind} color={isSkills ? 'var(--violet)' : 'var(--red)'}
        title={isSkills ? 'Skills' : 'Hooks'}
        lede={isSkills
          ? 'Capabilities agents invoke on demand. Local = shipped with forge or built by you; community = backed by existing skill collections.'
          : 'Event-bound automations attached to agents, flows or projects. Local = shipped or operator-built; community = curated collections.'}
        actions={
          <React.Fragment>
            <button className="btn" data-j="browse-community-btn" onClick={() => go('library', 'community')}>Browse community</button>
            <button className="btn btn-primary" data-j={'build-' + noun + '-btn'} onClick={() => go('agents', 'session', 'build-' + noun)}>
              + Build a {noun}
            </button>
          </React.Fragment>
        }
      />

      <div className="search-wrap" style={{ maxWidth: 360 }}>
        <span className="search-glyph">⌕</span>
        <input className="input" placeholder={'Filter ' + kind + '…'} value={q} onChange={e => setQ(e.target.value)} />
      </div>

      <SectionTitle count={filt(local).length}>Local — shipped with forge or built here</SectionTitle>
      <div className="card-grid">
        {filt(local).map(s => {
          // binding is derived from agent specs — never set on the definition
          const carriers = AGENTS.filter(a => (isSkills ? a.skills : a.hooks).includes(s.id)).map(a => a.name);
          return (
            <ObjCard key={s.id} jid={'lib-' + s.id} type={isSkills ? 'skill' : 'hook'} name={s.name} desc={s.desc} status="healthy"
              badges={s.community ? <span className="badge badge-community">installed</span> : <ProvenanceBadge provenance={s.provenance} />}
              stats={[
                isSkills ? (carriers.length ? 'carried by: ' + carriers.join(', ') : 'unbound — add from Agent Builder') : s.on,
                isSkills ? null : (carriers.length ? 'carried by: ' + carriers.join(', ') : 'unbound — add from Agent Builder'),
              ].filter(Boolean)}
              onClick={() => go('library', kind, s.id)} />
          );
        })}
      </div>

      <SectionTitle count={filt(community).length}>Community — backed by existing collections</SectionTitle>
      <div className="card-grid">
        {filt(community).map(s => {
          const meta = COMMUNITY.find(c => c.name === s.name);
          return (
            <ObjCard key={s.id} jid={'lib-' + s.id} type={isSkills ? 'skill' : 'hook'} name={s.name} desc={s.desc} status="idle"
              badges={<span className="badge badge-community">community</span>}
              stats={meta ? ['hub: ' + meta.hub, '★ ' + meta.stars + ' · ⬇ ' + meta.dl] : ['source: ' + s.source]}
              onClick={() => go('library', kind, s.id)} />
          );
        })}
      </div>
    </div>
  );
}

function ConnectionsView({ go, toast }) {
  const SCN = window.SCN || {};
  const inst = kind => COMMUNITY
    .filter(c => c.kind === kind && SCN['inst_' + c.id] === 'installed')
    .map(c => ({ id: c.id, name: c.name, desc: c.desc + ' (newly installed)', status: 'healthy' }));
  const groups = [
    { label: 'MCP servers — community MCP library', items: [...CONNECTIONS.mcps, ...inst('mcp')], dot: 'dot-mcp' },
    { label: 'CLIs — major external connections', items: [...CONNECTIONS.clis, ...inst('cli')], dot: 'dot-tool' },
    { label: 'Tools — everything else that fits', items: [...CONNECTIONS.tools, ...inst('tool')], dot: 'dot-tool' },
  ];
  return (
    <div className="page">
      <PageHead
        eyebrow="library / external connections" color="var(--steel)"
        title="External connections"
        lede="Tools, MCPs and CLIs available to agents. Health-checked, permission-scoped, and referenced from agent specs by name."
        actions={<button className="btn btn-primary" data-j="add-connection-btn" onClick={() => go('library', 'community')}>+ Add connection</button>}
      />
      {groups.map(g => (
        <React.Fragment key={g.label}>
          <SectionTitle count={g.items.length}>{g.label}</SectionTitle>
          <Panel pad={false}>
            {g.items.map(c => (
              <button key={c.id} className="monitor-row" onClick={() => go('library', 'connections', c.id)}>
                <span className="status-dot" data-status={c.status}></span>
                <span style={{ flex: 1 }}>
                  <span className="m-name mono" style={{ fontSize: 12.5 }}>{c.name}</span>
                  <span className="m-sub">{c.desc}</span>
                </span>
                <span className="status-text" data-status={c.status}>{c.status}</span>
              </button>
            ))}
          </Panel>
        </React.Fragment>
      ))}
    </div>
  );
}

Object.assign(window, { LibraryHome, LibraryShelf, ConnectionsView });
