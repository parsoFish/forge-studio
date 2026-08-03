// ── Kickoff + run surfaces ────────────────────────────────────────────
// Kickoffs bind a run to a target under explicit limits, and accept
// INPUT MATERIALS (mock upload) when the agent/flow allows them.
// AgentRun: live log → typed output, each candidate expandable to its
// full initiative-spec shape.

function MaterialsZone({ files, onAdd }) {
  return (
    <div>
      <span className="field-label">Input materials — attach anything that aids the run</span>
      <div className="mat-zone" data-j="mat-zone" onClick={onAdd} title="Attach files (mocked)">
        {files.map(f => (
          <span key={f} className="mat-chip"><span className="glyph">▤</span>{f}</span>
        ))}
        <span className="faint" style={{ fontSize: 11.5, padding: '2px 4px' }}>+ attach images, docs, data…</span>
      </div>
      <p className="faint" style={{ fontSize: 11, margin: '6px 0 0' }}>
        Allowed kinds come from the agent/flow spec (“allowed input materials” in the builder).
      </p>
    </div>
  );
}

function FlowKickoff({ flowId, go }) {
  const flow = FLOWS.find(f => f.id === flowId) || FLOWS[0];
  const [proj, setProj] = React.useState('gitpulse');
  const roadmap = ROADMAPS[proj] || [];
  const [init, setInit] = React.useState('INIT-3');
  const [files, setFiles] = React.useState([]);
  const addFile = () => setFiles(f => f.length === 0 ? ['perf-trace.json'] : f.length === 1 ? [...f, 'design-sketch.png'] : f);
  return (
    <div className="page">
      <PageHead
        eyebrow={'flows / kickoff'} color="var(--c-flow)"
        title={'Kick off — ' + flow.name}
        lede="A run binds the flow to a project and one initiative from its roadmap, under explicit limits. Everything else is unattended."
        actions={<button className="btn btn-sm" onClick={() => go('flows', 'monitor', flow.id)}>← Monitor</button>}
      />
      <div className="two-col">
        <Panel title="Target">
          <span className="field-label">Project</span>
          <select className="input" data-j="kick-project" value={proj} onChange={e => setProj(e.target.value)}>
            {[...((window.SCN || {}).onboardDone ? [EXTRA.blogProject] : []), ...PROJECTS.filter(p => p.provenance !== 'vision')].map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="field-label" style={{ marginTop: 14 }}>Initiative (from the project roadmap)</span>
          <select className="input" data-j="kick-initiative" value={init} onChange={e => setInit(e.target.value)}>
            {(roadmap.length ? roadmap : [{ id: 'INIT-3', name: 'Release-cadence report' }]).map(r => (
              <option key={r.id} value={r.id}>{r.id} · {r.name}</option>
            ))}
          </select>
          <div style={{ marginTop: 14 }}>
            <MaterialsZone files={files} onAdd={addFile} />
          </div>
        </Panel>
        <Panel title="Limits">
          <span className="field-label">Cost ceiling — editable per kickoff</span>
          <input className="input" data-j="cost-ceiling" defaultValue="$8.00" style={{ maxWidth: 140, fontFamily: 'var(--font-mono)' }} />
          <span className="field-label" style={{ marginTop: 14 }}>Fan-out cap</span>
          <input className="input" defaultValue="4 parallel worktrees" />
          <span className="field-label" style={{ marginTop: 14 }}>Gates</span>
          <ul className="readiness-list">
            <li className="readiness-item ok"><span className="ri-dot"></span>Operator verdict before merge</li>
            <li className="readiness-item ok"><span className="ri-dot"></span>Project tests green post-merge</li>
          </ul>
          <div className="row" style={{ marginTop: 16 }}>
            <span className="spacer"></span>
            <button className="btn btn-primary" data-j="start-run"
              onClick={() => { window.setSCN({ flowRun: 0, flowRunFlow: flow.id }); go('flows', 'monitor', flow.id); }}>
              Start run
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function AgentKickoff({ agentId, go }) {
  const agent = AGENTS.find(a => a.id === agentId) || EXTRA.newAgentCard;
  const runDef = AGENT_RUNS[agentId] || AGENT_RUNS['issue-triage'];
  const [proj, setProj] = React.useState(runDef.project || 'gitpulse');
  const [files, setFiles] = React.useState([]);
  const mats = runDef.materials || [];
  const addFile = () => setFiles(f => f.length < mats.length ? mats.slice(0, f.length + 1) : (f.length === 0 ? ['notes.md'] : f));
  return (
    <div className="page">
      <PageHead
        eyebrow="agents / kickoff" color="var(--c-agent)"
        title={'Run — ' + agent.name}
        lede="Standalone agents run against a project with explicit inputs. Same harness as inside a flow — just no pipeline around it."
        actions={<button className="btn btn-sm" onClick={() => go('agents', 'builder', agent.id)}>← Builder</button>}
      />
      <div className="row" style={{ gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <span className="faint" style={{ fontSize: 11.5 }}>triggers for this agent:</span>
        {(TRIGGERS[agentId] || [{ type: 'manual', label: 'manual' }]).map((t, i) => (
          <span key={i} className="trig-chip" data-t={t.type}>
            {t.type === 'manual' ? '▶' : t.type === 'hook' ? '⚡' : '↻'} {t.label}{t.scope ? <span className="scope"> · {t.scope}</span> : null}
          </span>
        ))}
      </div>
      <div className="two-col">
        <Panel title="Target">
          <span className="field-label">Project</span>
          <select className="input" data-j="kick-project" value={proj} onChange={e => setProj(e.target.value)}>
            {PROJECTS.filter(p => p.provenance !== 'vision').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="field-label" style={{ marginTop: 14 }}>Input context</span>
          <textarea className="input" rows={2} defaultValue="Open issues on the project repo (via github MCP)" />
          <div style={{ marginTop: 14 }}>
            <MaterialsZone files={files} onAdd={addFile} />
          </div>
        </Panel>
        <Panel title="Limits + output">
          <span className="field-label">Cost ceiling — editable per kickoff</span>
          <input className="input" data-j="cost-ceiling" defaultValue="$1.00" style={{ maxWidth: 140, fontFamily: 'var(--font-mono)' }} />
          <dl className="kv" style={{ marginTop: 14 }}>
            <dt>allowed materials</dt><dd>{(agent.materials || []).join(' · ') || '—'} (from the agent spec)</dd>
            <dt>output</dt><dd>typed by the agent’s out template</dd>
            <dt>writes</dt><dd className="faint">read-only until output approved</dd>
          </dl>
          <div className="row" style={{ marginTop: 16 }}>
            <span className="spacer"></span>
            <button className="btn btn-primary" data-j="start-run"
              onClick={() => { window.setSCN({ agentRun: 0 }); go('agents', 'run', agent.id); }}>
              Start run
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function AgentRun({ agentId, go, toast }) {
  const SCN = window.SCN || {};
  const agent = AGENTS.find(a => a.id === agentId) || EXTRA.newAgentCard;
  const runDef = AGENT_RUNS[agentId] || AGENT_RUNS['issue-triage'];
  const stage = SCN.agentRun != null ? SCN.agentRun : runDef.log.length - 1;
  const doneRun = stage >= runDef.log.length - 1;
  const [openCand, setOpenCand] = React.useState(null);
  const isCandidates = agentId === 'issue-triage' || !AGENT_RUNS[agentId];
  return (
    <div className="page">
      <PageHead
        eyebrow="agents / run" color="var(--c-agent)"
        title={agent.name + ' — ' + runDef.project}
        lede="Live run: the session log streams on the left; the typed output forms on the right."
        actions={
          <React.Fragment>
            <StatusPair status={doneRun ? 'complete' : 'active'} />
            <button className="btn btn-sm" onClick={() => go('agents', 'monitor', agent.id)}>Monitor →</button>
          </React.Fragment>
        }
      />
      <div className="row" style={{ gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        <span className="trig-chip" data-t={runDef.trigger && runDef.trigger.startsWith('auto') ? 'on-complete' : runDef.trigger && runDef.trigger.startsWith('project') ? 'hook' : 'manual'} data-j="run-trigger">
          {runDef.trigger || 'manual'}
        </span>
        {(runDef.materials || []).length ? <span className="faint" style={{ fontSize: 11.5 }}>· materials in:</span> : null}
        {(runDef.materials || []).map(m => <span key={m} className="mat-chip"><span className="glyph">▤</span>{m}</span>)}
      </div>
      <div className="two-col">
        <Panel title="Session log" pad={false}>
          <div style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 2.1, color: 'var(--dim)' }}>
            {runDef.log.slice(0, stage + 1).map((l, i) => (
              <div key={i} className="row" style={{ gap: 10 }}>
                <span className="status-dot" data-status={i === stage && !doneRun ? 'active' : 'complete'} style={{ width: 6, height: 6 }}></span>
                <span>{l}</span>
              </div>
            ))}
          </div>
        </Panel>
        <div>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="field-label" style={{ margin: 0 }}>{runDef.outputTitle || 'Output — initiative candidates'}</span>
            <span className="spacer"></span>
            <span className="badge badge-artifact">×{doneRun ? runDef.output.length : 0}</span>
          </div>
          {doneRun ? (
            <React.Fragment>
              <Panel pad={false}>
                {runDef.output.map(o => (
                  <React.Fragment key={o.id}>
                    <button className="monitor-row" data-j={'cand-' + o.id}
                      onClick={() => isCandidates ? setOpenCand(openCand === o.id ? null : o.id) : toast('Artifact viewer is mocked — ' + o.name)}>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--c-artifact)' }}>{o.id}</span>
                      <span style={{ flex: 1 }}>
                        <span className="m-name">{o.name}</span>
                        <span className="m-sub">from {o.from} · {o.sig}</span>
                      </span>
                      {isCandidates ? <span className="faint mono" style={{ fontSize: 11 }}>{openCand === o.id ? '▾' : '▸'}</span> : null}
                    </button>
                    {isCandidates && openCand === o.id ? (
                      <div style={{ borderBottom: '1px solid var(--line)' }}>
                        <div className="preview-block" style={{ border: 'none', borderRadius: 0 }}>
                          <pre style={{ color: 'var(--text)' }}>{CAND_DETAIL.spec}</pre>
                        </div>
                      </div>
                    ) : null}
                  </React.Fragment>
                ))}
              </Panel>
              {isCandidates ? (
                <div className="row" style={{ marginTop: 12 }}>
                  <span className="spacer"></span>
                  <button className="btn btn-sm" onClick={() => toast('Discarded (mock)')}>Discard</button>
                  <button className="btn btn-primary btn-sm" data-j="file-output"
                    onClick={() => toast('Filed to the gitpulse roadmap (mock) — the Architect reviews them next session')}>
                    File to roadmap
                  </button>
                </div>
              ) : null}
            </React.Fragment>
          ) : (
            <Empty text="Output forms when the run completes." />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- KB creation kickoff (project OR cycle scope) ----------
function KbCreateKickoff({ go }) {
  const [scope, setScope] = React.useState(null);
  const [proj, setProj] = React.useState('trafficgame');
  const [flow, setFlow] = React.useState('forge-develop · review band');
  return (
    <div className="page">
      <PageHead
        eyebrow="knowledge / create" color="var(--c-kb)"
        title="Create a knowledge base"
        lede="A brain binds to a scope: one project's accumulated knowledge, or a cycle band's cross-project patterns. The Brain Creation agent seeds it from that scope's history."
        actions={<button className="btn btn-sm" onClick={() => go('knowledge', 'list')}>← All brains</button>}
      />
      <div className="two-col">
        <button className="obj-card" data-type="kb" data-j="scope-project"
          style={scope === 'project' ? { borderColor: 'var(--c-kb)', boxShadow: '0 0 0 1px rgba(74,222,128,.3)' } : undefined}
          onClick={() => setScope('project')}>
          <div className="card-top"><span className="card-name">For a project</span><TypeBadge type="kb" /></div>
          <p className="card-desc" style={{ WebkitLineClamp: 3 }}>
            Brain 3 scope: per-project patterns, seeded from cycle history, PR threads and operator notes. Read by planners; advisory for dev agents.
          </p>
        </button>
        <button className="obj-card" data-type="kb" data-j="scope-cycle"
          style={scope === 'cycle' ? { borderColor: 'var(--c-kb)', boxShadow: '0 0 0 1px rgba(74,222,128,.3)' } : undefined}
          onClick={() => setScope('cycle')}>
          <div className="card-top"><span className="card-name">For a cycle · flow band</span><TypeBadge type="kb" /></div>
          <p className="card-desc" style={{ WebkitLineClamp: 3 }}>
            Brain 2 scope: cross-project patterns bound to a flow band (e.g. the review band) — seeded from every run of that band, on every project.
          </p>
        </button>
      </div>

      {scope ? (
        <Panel title={scope === 'project' ? 'Which project?' : 'Which flow · band?'} pad={false}>
          <div className="row" style={{ padding: 14, gap: 10, flexWrap: 'wrap' }}>
            {scope === 'project' ? (
              <select className="input" data-j="kb-target" style={{ maxWidth: 320 }} value={proj} onChange={e => setProj(e.target.value)}>
                {PROJECTS.filter(p => p.provenance !== 'vision' && !BRAINS.some(b => b.id === p.id)).map(p => (
                  <option key={p.id} value={p.id}>{p.name}{p.brain ? '' : ' — no brain yet'}</option>
                ))}
              </select>
            ) : (
              <select className="input" data-j="kb-target" style={{ maxWidth: 320 }} value={flow} onChange={e => setFlow(e.target.value)}>
                <option>forge-develop · review band</option>
                <option>forge-develop · develop band</option>
                <option>onboard-project · onboard band</option>
              </select>
            )}
            <span className="spacer"></span>
            <button className="btn btn-primary" data-j="kb-continue"
              onClick={() => go('agents', 'session', scope === 'project' ? 'brain-creation' : 'brain-creation-cycle')}>
              Continue to creation session
            </button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

Object.assign(window, { FlowKickoff, AgentKickoff, AgentRun, KbCreateKickoff });
