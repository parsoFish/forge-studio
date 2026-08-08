// ── Agents section: Home / Builder / Monitor ──────────────────────────
// Builder: zones are REAL state — drag from the catalog (HTML5 DnD) or
// click a chip to add; × removes. Binding of hooks/skills to an agent
// happens HERE and only here. Agent selector dropdown, instructions
// generation, allowed input materials, and a Run entry for standalone.

function allAgents() {
  const SCN = window.SCN || {};
  const list = AGENTS.slice();
  if (SCN.newAgentSaved) list.push(EXTRA.newAgentCard);
  return list;
}

function AgentsHome({ go }) {
  const agents = allAgents();
  const active = agents.filter(a => a.status === 'active');
  return (
    <div className="page">
      <PageHead
        eyebrow="agents" color="var(--c-agent)"
        title="Agents"
        lede="Every agent forge runs — the eight shipped out of the box and yours. Each one is editable in the builder, runnable standalone or inside flows, and observable in the monitor."
        actions={<button className="btn btn-primary" data-j="new-agent-btn" onClick={() => go('agents', 'builder', 'new')}>+ New agent</button>}
      />

      <SectionTitle count={active.length + ' running'}>Active status</SectionTitle>
      {active.length ? (
        <Panel pad={false}>
          {active.map(a => (
            <button key={a.id} className="monitor-row" onClick={() => go('agents', 'monitor', a.id)}>
              <span className="status-dot" data-status="active"></span>
              <span style={{ flex: 1 }}>
                <span className="m-name">{a.name}</span>
                <span className="m-sub">{a.live ? a.live.what : ''}</span>
              </span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--ember)' }}>{a.live ? a.live.cost : ''}</span>
            </button>
          ))}
        </Panel>
      ) : <Empty text="No agents running right now." />}

      <SectionTitle count={agents.length}>Existing agents</SectionTitle>
      <div className="card-grid">
        {agents.map(a => (
          <ObjCard key={a.id} jid={'agent-' + a.id} type="agent" name={a.name} desc={a.desc} status={a.status}
            badges={<React.Fragment><TypeBadge type="agent" /><ProvenanceBadge provenance={a.provenance} /></React.Fragment>}
            stats={[
              a.standalone ? 'standalone' : 'flow-bound',
              a.inFlows.length ? 'in ' + a.inFlows.join(', ') : 'no flows',
            ]}
            live={a.live}
            onClick={() => go('agents', 'builder', a.id)} />
        ))}
      </div>
    </div>
  );
}

// ---------- builder (3-col workbench, stateful) ----------
const ZONE_DEFS = [
  { key: 'skills', label: 'Skills', kind: 'skill' },
  { key: 'tools', label: 'Tools', kind: 'tool' },
  { key: 'mcps', label: 'MCPs', kind: 'mcp' },
  { key: 'hooks', label: 'Hooks / lifecycle customisations', kind: 'hook' },
  { key: 'templates', label: 'Templates (in / out artifacts)', kind: 'template' },
];
const CATALOG_ZONE = { skill: 'skills', tool: 'tools', mcp: 'mcps', hook: 'hooks', template: 'templates' };

function seedZones(agent) {
  if (!agent) return { skills: [], tools: [], mcps: [], hooks: [], templates: [] };
  return {
    skills: agent.skills.slice(), tools: agent.tools.slice(), mcps: agent.mcps.slice(),
    hooks: agent.hooks.slice(),
    templates: agent.id === 'architect-planning' ? ['roadmap template', 'initiative spec'] : [],
  };
}

function AgentBuilder({ agentId, go, toast }) {
  const SCN = window.SCN || {};
  const isNew = agentId === 'new' || !agentId;
  const drafted = isNew && (SCN.newAgentStage || 0) >= 1;
  const agent = isNew ? null : allAgents().find(a => a.id === agentId) || AGENTS[0];

  const [name, setName] = React.useState(agent ? agent.name : '');
  const [prompt, setPrompt] = React.useState('');
  const [zones, setZones] = React.useState(() => seedZones(agent));
  const [instructions, setInstructions] = React.useState(agent ? (AGENT_INSTRUCTIONS[agent.id] || '') : '');
  const [materials, setMaterials] = React.useState(agent ? (agent.materials || []).slice() : []);
  const [dirty, setDirty] = React.useState(false);

  // creation-agent draft fills the zones + instructions
  React.useEffect(() => {
    if (isNew && drafted) {
      setZones({ skills: DRAFT_AGENT.skills.slice(), tools: DRAFT_AGENT.tools.slice(), mcps: DRAFT_AGENT.mcps.slice(), hooks: DRAFT_AGENT.hooks.slice(), templates: DRAFT_AGENT.templates.slice() });
      setInstructions(AGENT_INSTRUCTIONS['issue-triage']);
      setMaterials(['images', 'documents']);
      setName(n => n || DRAFT_AGENT.name);
    }
  }, [drafted]);

  const addItem = (kind, itemName) => {
    const zk = CATALOG_ZONE[kind];
    if (!zk) return;
    setZones(z => z[zk].includes(itemName) ? z : { ...z, [zk]: [...z[zk], itemName] });
    setDirty(true);
  };
  const removeItem = (zk, itemName) => {
    setZones(z => ({ ...z, [zk]: z[zk].filter(x => x !== itemName) }));
    setDirty(true);
  };

  const save = () => {
    setDirty(false);
    if (isNew && drafted) {
      window.setSCN({ newAgentSaved: true });
      toast('issue-triage saved to studio/agents/issue-triage.yaml (mock)');
    } else {
      toast('Saved (mock) — ' + (agent ? agent.name : 'agent') + ' spec updated in studio/agents/');
    }
  };

  // dynamic catalog: built objects join their groups (binding surface = here)
  const catalogSkills = [...CATALOG.skills, ...(SCN.builtSkill ? [{ id: 'release-notes', name: 'release-notes', kind: 'skill' }] : [])];
  const catalogHooks = [...CATALOG.hooks, ...(SCN.builtHook ? [{ id: 'stack-base-guard', name: 'stack-base-guard', kind: 'hook' }] : [])];

  const readiness = [
    { ok: (isNew ? (drafted || name.length > 0) : true), label: 'Named + described' },
    { ok: zones.skills.length > 0, label: 'At least one skill bound' },
    { ok: !!agent || drafted, label: 'Runtime + model tier chosen' },
    { ok: (agent && (agent.inFlows.length > 0 || agent.standalone)) || !!SCN.newAgentSaved, label: 'Reachable: in a flow or standalone' },
    { ok: instructions.length > 0, label: 'Instructions authored' },
  ];

  return (
    <div className="workbench">
      {/* catalog */}
      <aside className="col-left">
        <div className="col-left-head">
          <h3>Library catalog</h3>
          <div className="search-wrap">
            <span className="search-glyph">⌕</span>
            <input className="input" placeholder="Search library…" readOnly onClick={() => toast('Catalog search is mocked in this prototype')} />
          </div>
        </div>
        <div className="catalog-scroll">
          {[
            { label: 'Skills', items: catalogSkills, cls: 'dot-skill' },
            { label: 'Tools', items: CATALOG.tools, cls: 'dot-tool' },
            { label: 'MCPs', items: CATALOG.mcps, cls: 'dot-mcp' },
            { label: 'Hooks', items: catalogHooks, cls: 'dot-hook' },
            { label: 'Templates', items: CATALOG.templates, cls: 'dot-template' },
          ].map(group => (
            <div key={group.label}>
              <button className="catalog-group-header"><span>{group.label}</span><span className="chevron">▾</span></button>
              <div className="catalog-group-body">
                {group.items.map(it => (
                  <span key={it.id} data-j={'cat-' + it.id} className="catalog-chip"
                    title="Drag into a zone, or click to add — this is where binding happens"
                    draggable
                    onDragStart={e => e.dataTransfer.setData('text/plain', JSON.stringify({ kind: it.kind, name: it.name }))}
                    onClick={() => addItem(it.kind, it.name)}>
                    <span className={'dot ' + group.cls}></span>{it.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* definition */}
      <div className="col-center">
        <div className="def-header">
          <span className="hex-glyph"></span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <select className="input" data-j="agent-select" style={{ width: 'auto', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12.5 }}
                value={isNew ? 'new' : agent.id}
                onChange={e => go('agents', 'builder', e.target.value)}>
                <option value="new">＋ new agent</option>
                {allAgents().map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <input
                className="input" data-j="agent-name"
                style={{ flex: 1, minWidth: 160, fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700, background: 'transparent', border: 'none', borderBottom: '1.5px solid var(--line-2)', borderRadius: 0, padding: '2px 4px' }}
                value={name} placeholder="Name this agent…"
                onChange={e => { setName(e.target.value); setDirty(true); }}
              />
              {agent ? <ProvenanceBadge provenance={agent.provenance} /> : null}
              {agent ? <StatusPair status={agent.status} /> : null}
              {dirty ? <span className="badge badge-dim" style={{ color: 'var(--amber)', borderColor: 'rgba(251,191,36,.35)' }}>unsaved</span> : null}
            </div>
            {agent ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{agent.desc}</div>
              : drafted ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{DRAFT_AGENT.desc}</div> : null}
          </div>
          {agent || (SCN.newAgentSaved && isNew) ? (
            <button className="btn btn-primary btn-sm" data-j="run-agent-btn"
              onClick={() => {
                const id = agent ? agent.id : 'issue-triage';
                if (SESSIONS[id]) go('agents', 'session', id); else go('agents', 'kickoff', id);
              }}>
              Run →
            </button>
          ) : null}
          {agent ? <button className="btn btn-sm" onClick={() => go('agents', 'monitor', agent.id)}>Monitor →</button> : null}
          <button className="btn btn-primary btn-sm" data-j="save-agent" onClick={save}>Save</button>
        </div>

        <div className="def-body">
          {isNew ? (
            <Panel title="Start from a starter — pick a curated agent, or start blank">
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                A new agent begins from a curated starter or a blank spec, then you refine the zones directly.
                Studio ships no agent-authoring agent — the curated StarterPicker is the entry point.
              </p>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn btn-primary" data-j="starter-issue-triage" style={{ whiteSpace: 'nowrap' }}
                  onClick={() => { window.setSCN({ newAgentStage: 1 }); toast('Started from the issue-triage starter — refine the zones below'); }}>
                  Issue triage starter
                </button>
                <button className="btn" data-j="starter-blank" style={{ whiteSpace: 'nowrap' }}
                  onClick={() => { window.setSCN({ newAgentStage: 1 }); toast('Blank agent — sensible defaults; refine the zones below'); }}>
                  Blank agent
                </button>
              </div>
            </Panel>
          ) : null}

          <div className="zones-grid">
            {ZONE_DEFS.map(z => (
              <div key={z.key} data-j={'zone-' + z.key} style={z.key === 'templates' ? { gridColumn: '1 / -1' } : undefined}>
                <span className="field-label">{z.label}</span>
                <div className="drop-zone"
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    try {
                      const d = JSON.parse(e.dataTransfer.getData('text/plain'));
                      if (CATALOG_ZONE[d.kind] === z.key) addItem(d.kind, d.name);
                      else toast('That component belongs in the ' + CATALOG_ZONE[d.kind] + ' zone');
                    } catch { /* not a catalog chip */ }
                  }}>
                  {zones[z.key].length ? zones[z.key].map(it => (
                    <span key={it} className="zone-chip" data-kind={z.kind}>
                      <span className={'dot dot-' + z.kind}></span>{it}
                      <span className="x" onClick={() => removeItem(z.key, it)}>×</span>
                    </span>
                  )) : <span className="placeholder">Drag {z.label.toLowerCase()} from the catalog — or click a chip</span>}
                </div>
              </div>
            ))}
          </div>

          <div>
            <div className="row" style={{ marginBottom: 6 }}>
              <span className="field-label" style={{ margin: 0 }}>Instructions — the agent's single source of intent</span>
              <span className="spacer"></span>
              <button className="btn btn-ghost btn-sm" data-j="gen-instructions"
                onClick={() => {
                  const canonical = AGENT_INSTRUCTIONS[agent ? agent.id : 'issue-triage'] || AGENT_INSTRUCTIONS['issue-triage'];
                  setInstructions(canonical); setDirty(true);
                  toast('Instructions drafted from the description + bound components (mock)');
                }}>
                ✦ Generate from spec
              </button>
            </div>
            <textarea className="input" data-j="agent-instructions" rows={5}
              value={instructions} placeholder="What this agent must and must not do…"
              onChange={e => { setInstructions(e.target.value); setDirty(true); }}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6 }} />
          </div>

          <div>
            <span className="field-label">Allowed input materials — what a run may attach</span>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} data-j="materials-config">
              {['images', 'documents', 'data files', 'audio'].map(m => (
                <button key={m} className={'btn btn-sm' + (materials.includes(m) ? '' : ' btn-ghost')}
                  data-j={'mat-' + m.replace(' ', '-')}
                  onClick={() => { setMaterials(ms => ms.includes(m) ? ms.filter(x => x !== m) : [...ms, m]); setDirty(true); }}>
                  {materials.includes(m) ? '✓ ' : ''}{m}
                </button>
              ))}
              <span className="faint" style={{ fontSize: 11.5, alignSelf: 'center' }}>
                surfaced as an upload zone on this agent's kickoff screen
              </span>
            </div>
          </div>

          <div>
            <span className="field-label">Triggers — how runs of this agent start (scopable per project)</span>
            <div className="drop-zone" data-j="agent-triggers">
              {(TRIGGERS[agent ? agent.id : 'issue-triage'] || [{ type: 'manual', label: 'Manual kickoff' }]).map((t, i) => (
                <span key={i} className="trig-chip" data-t={t.type}>
                  {t.type === 'manual' ? '▶' : t.type === 'hook' ? '⚡' : '↻'} {t.label}
                  {t.scope ? <span className="scope"> · {t.scope}</span> : null}
                </span>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={() => toast('Add trigger (mock): manual · on another agent/flow completing · on a project hook (PR closed, issue raised…) — scoped per project, not fleet-wide')}>+ add</button>
            </div>
          </div>

          <div>
            <span className="field-label">Runtime</span>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="card-stat">{agent ? agent.runtime : 'claude-agent-sdk · worker'}</span>
              <span className="card-stat">brain: {agent ? agent.brain : 'project (advisory)'}</span>
              <span className="card-stat">{agent ? (agent.standalone ? 'standalone-runnable' : 'flow-bound') : 'standalone-runnable'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* readiness + spec preview */}
      <aside className="col-right">
        <div className="panel-head"><span>Readiness</span></div>
        <div style={{ padding: '12px 16px' }}>
          <ul className="readiness-list">
            {readiness.map((r, i) => (
              <li key={i} className={'readiness-item' + (r.ok ? ' ok' : '')}>
                <span className="ri-dot"></span>{r.label}
              </li>
            ))}
          </ul>
        </div>
        <div className="panel-head"><span>Used in flows</span></div>
        <div style={{ padding: '12px 16px' }}>
          {agent && agent.inFlows.length ? agent.inFlows.map(fid => (
            <button key={fid} className="btn btn-sm" style={{ marginRight: 6 }} onClick={() => go('flows', 'builder', fid)}>⬡ {fid}</button>
          )) : <span className="faint" style={{ fontSize: 12, fontStyle: 'italic' }}>Not referenced by any flow</span>}
        </div>
        <div className="panel-head"><span>Spec preview</span></div>
        <div style={{ padding: '12px 16px' }}>
          <div className="preview-block">
            <pre>
<span className="yaml-sect">agent</span>: <span className="yaml-val">{agent ? agent.id : (name || 'new-agent')}</span>{'\n'}
<span className="yaml-key">  skills</span>: <span className="yaml-list">[{zones.skills.join(', ')}]</span>{'\n'}
<span className="yaml-key">  tools</span>: <span className="yaml-list">[{zones.tools.join(', ')}]</span>{'\n'}
<span className="yaml-key">  hooks</span>: <span className="yaml-list">[{zones.hooks.join(', ')}]</span>{'\n'}
<span className="yaml-key">  materials</span>: <span className="yaml-list">[{materials.join(', ')}]</span>{'\n'}
<span className="yaml-key">  instructions</span>: <span className="yaml-val">{instructions ? instructions.slice(0, 60) + '…' : '—'}</span>{'\n'}
<span className="yaml-key">  runtime</span>: <span className="yaml-val">{agent ? agent.runtime : 'claude-agent-sdk · worker'}</span>
            </pre>
          </div>
        </div>
      </aside>
    </div>
  );
}

// ---------- monitor ----------
function AgentMonitor({ agentId, go }) {
  const [sel, setSel] = React.useState(agentId || 'developer');
  const agents = allAgents();
  const agent = agents.find(a => a.id === sel) || agents[0];
  const history = AGENT_HISTORY[agent.id] || [];

  return (
    <div className="monitor">
      <aside className="monitor-list">
        <div className="monitor-list-head">
          <span>Agents</span><span className="spacer"></span>
          <span className="mono faint" style={{ fontSize: 10 }}>{agents.filter(a => a.status === 'active').length} live</span>
        </div>
        {agents.map(a => (
          <button key={a.id} className={'monitor-row' + (a.id === sel ? ' selected' : '')} onClick={() => setSel(a.id)}>
            <span className="status-dot" data-status={a.status}></span>
            <span style={{ flex: 1 }}>
              <span className="m-name">{a.name}</span>
              <span className="m-sub">{a.inFlows.length ? 'in ' + a.inFlows.join(', ') : 'standalone'}</span>
            </span>
          </button>
        ))}
      </aside>
      <div className="monitor-main">
        <PageHead
          eyebrow="agent monitor" color="var(--c-agent)"
          title={agent.name}
          lede={agent.desc}
          actions={
            <React.Fragment>
              <ProvenanceBadge provenance={agent.provenance} />
              <button className="btn btn-primary btn-sm" data-j="run-agent-btn"
                onClick={() => SESSIONS[agent.id] ? go('agents', 'session', agent.id) : go('agents', 'kickoff', agent.id)}>
                Run →
              </button>
              <button className="btn btn-sm" onClick={() => go('agents', 'builder', agent.id)}>Edit in builder →</button>
            </React.Fragment>
          }
        />
        {agent.live ? (
          <Panel title="Live" pad={false}>
            <div className="live-strip" style={{ margin: 14 }}>
              <span className="status-dot" data-status="active"></span>
              <span className="what">{agent.live.what}</span>
              <span className="cost">{agent.live.cost}</span>
            </div>
          </Panel>
        ) : null}
        <div style={{ height: 18 }}></div>
        <Panel title="Work history — flow runs, standalone runs and sessions, each one click away" pad={false}>
          {history.length ? (
            <Ledger rows={history} onRow={r => r.link ? go(r.link[0], r.link[1], r.link[2])
              : go('flows', 'run', (agent.inFlows[0] || 'forge-develop') + ':0')} />
          ) : <Empty text="No recorded work yet." hint="History appears when this agent runs standalone or inside a flow." />}
        </Panel>
      </div>
    </div>
  );
}

Object.assign(window, { AgentsHome, AgentBuilder, AgentMonitor });
