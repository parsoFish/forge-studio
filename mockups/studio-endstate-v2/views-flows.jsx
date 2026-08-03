// ── Flows section: Home / Builder / Monitor / Run detail ──────────────
// Builder v6: the topology is COLUMNS of hex nodes — a column with >1
// nodes is a parallel branch; the next single node is a join that waits
// for all inputs. Hand-offs are typed: an agent added after another takes
// the previous node's output artifact as its input. Band rule: plan +
// develop bands may hold any number of lines; review + reflect are a
// single line — branches must merge back before them.

function allFlows() {
  const SCN = window.SCN || {};
  const list = FLOWS.slice();
  if (SCN.flowSaved) list.push(EXTRA.newFlowCard);
  return list;
}

function FlowsHome({ go }) {
  const flows = allFlows();
  const active = flows.filter(f => f.status === 'active');
  return (
    <div className="page">
      <PageHead
        eyebrow="flows" color="var(--c-flow)"
        title="Agent flows"
        lede="Composable pipelines of agents, gates and hooks. forge-develop ships out of the box; every flow is editable in the builder and observable in the monitor."
        actions={<button className="btn btn-primary" data-j="new-flow-btn" onClick={() => go('flows', 'builder', 'new')}>+ New flow</button>}
      />

      <SectionTitle count={active.length + ' running'}>Active status</SectionTitle>
      {active.length ? (
        <Panel pad={false}>
          {active.map(f => (
            <button key={f.id} className="monitor-row" onClick={() => go('flows', 'monitor', f.id)}>
              <span className="status-dot" data-status="active"></span>
              <span style={{ flex: 1 }}>
                <span className="m-name">{f.name}</span>
                <span className="m-sub">{f.live ? f.live.what : ''}</span>
              </span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--ember)' }}>{f.live ? f.live.cost : ''}</span>
            </button>
          ))}
        </Panel>
      ) : <Empty text="No flows running right now." hint="Kick one off from a project roadmap, or watch the queue pick up the next initiative." />}

      <SectionTitle count={flows.length}>Existing flows</SectionTitle>
      <div className="card-grid">
        {flows.map(f => (
          <ObjCard key={f.id} jid={'flow-' + f.id} type="flow" name={f.name} desc={f.desc} status={f.status}
            badges={<React.Fragment><TypeBadge type="flow" /><ProvenanceBadge provenance={f.provenance} /></React.Fragment>}
            stats={[f.stats.runs + ' runs', f.stats.merged + ' merged', f.nodes.length + ' nodes']}
            live={f.live}
            onClick={() => go('flows', 'builder', f.id)} />
        ))}
      </div>
    </div>
  );
}

// ---------- builder (columns of hex nodes, branch + join) ----------
const AGENT_NODE_DEFAULTS = {
  developer: { sub: 'ralph loop', band: 'develop', out: 'demo evidence' },
  'demo-runner': { sub: 'visual evidence per WI', band: 'develop', out: 'demo HTML summary' },
  'adversarial-review': { sub: 'refute-first findings', band: 'review', out: 'findings' },
  reflector: { sub: 'themes → brains', band: 'reflect', out: null },
  'architect-planning': { sub: 'roadmap session', band: 'plan', out: 'roadmap' },
  'demo-builder': { sub: 'demo capability authoring', band: 'develop', out: 'demo skill' },
  'project-onboarding': { sub: 'contract authoring', band: 'onboard', out: 'contract artifacts' },
  'brain-creation': { sub: 'brain seeding', band: 'reflect', out: null },
  'demo-design': { sub: 'demo scripts per initiative', band: 'plan', out: 'demo scripts' },
  research: { sub: 'sourced implementation brief', band: 'plan', out: 'sourced brief' },
};
const GATE_DEFAULTS = {
  verdict: { name: 'Verdict', sub: 'operator approve / send back' },
  contract: { name: 'Contract check', sub: 'preflight green' },
  lint: { name: 'Brain lint', sub: '9 structural checks' },
};
const SINGLE_LINE_BANDS = ['review', 'reflect'];

function FlowBuilder({ flowId, go, toast }) {
  const isNew = flowId === 'new';
  const baseFlow = isNew ? null : allFlows().find(f => f.id === flowId) || FLOWS[0];

  const [name, setName] = React.useState(isNew ? '' : baseFlow.name);
  const [cols, setCols] = React.useState(() => isNew ? [] : baseFlow.nodes.map(n => [{ ...n }]));
  const [dirty, setDirty] = React.useState(false);
  const [selectedNode, setSelectedNode] = React.useState(() => {
    const flat = (isNew ? [] : baseFlow.nodes);
    return flat[1] ? flat[1].id : (flat[0] ? flat[0].id : null);
  });
  // Branch mode: adds build a PARALLEL column right after the armed column.
  // Sticky while armed — press the branch button again to disarm.
  const [branchAt, setBranchAt] = React.useState(null);
  const branchColRef = React.useRef(null); // index of the column the branch is building
  const canvasRef = React.useRef(null);

  const flatNodes = cols.flat();
  React.useEffect(() => {
    const c = canvasRef.current;
    if (c) c.scrollTo({ left: c.scrollWidth, behavior: 'smooth' });
  }, [flatNodes.length]);

  const node = flatNodes.find(n => n.id === selectedNode) || null;
  const nodeColIdx = cols.findIndex(col => col.some(n => n.id === selectedNode));
  const prevCol = nodeColIdx > 0 ? cols[nodeColIdx - 1] : null;
  const nodeInputs = prevCol ? prevCol.map(p => p.out).filter(Boolean) : [];
  const nodeAgent = node ? AGENTS.find(a => a.name.toLowerCase().startsWith(node.name.toLowerCase().split(' ')[0])) : null;

  const placeNode = newNode => {
    setDirty(true);
    setSelectedNode(newNode.id);
    if (branchAt != null) {
      if (SINGLE_LINE_BANDS.includes(newNode.band)) {
        toast('Review and reflect bands take a SINGLE line — branch in plan/develop and merge back before them');
        return;
      }
      setCols(cs => {
        const insertIdx = branchAt + 1;
        if (branchColRef.current === insertIdx && cs[insertIdx]) {
          return cs.map((c, i) => i === insertIdx ? [...c, newNode] : c);
        }
        branchColRef.current = insertIdx;
        const next = cs.slice();
        next.splice(insertIdx, 0, [newNode]);
        return next;
      });
    } else {
      // typed hand-off: the new node takes the previous column's output(s) as input
      const last = cols[cols.length - 1];
      const ins = last ? last.map(p => p.out).filter(Boolean) : [];
      if (last && !ins.length && newNode.kind === 'agent') {
        toast('Tip: set a hand-off artifact on the previous node — agents chain by taking the prior output as input');
      }
      newNode.inputs = ins;
      setCols(cs => [...cs, [newNode]]);
    }
  };

  const addAgentNode = agentId => {
    const a = AGENTS.find(x => x.id === agentId);
    if (!a) return;
    const d = AGENT_NODE_DEFAULTS[agentId] || { sub: '', band: null, out: null };
    placeNode({ id: agentId + '-' + (flatNodes.length + 1), kind: 'agent', name: a.name, sub: d.sub, band: d.band, out: d.out, agentId });
  };
  const addGateNode = gateId => {
    const g = GATE_DEFAULTS[gateId] || { name: gateId, sub: '' };
    placeNode({ id: gateId + '-' + (flatNodes.length + 1), kind: 'gate', name: g.name, sub: g.sub, band: 'review' });
  };
  const updateNode = patch => {
    setCols(cs => cs.map(col => col.map(n => n.id === selectedNode ? { ...n, ...patch } : n)));
    setDirty(true);
  };
  const removeNode = () => {
    setCols(cs => cs.map(col => col.filter(n => n.id !== selectedNode)).filter(col => col.length));
    setSelectedNode(null); setDirty(true);
  };

  const saveFlow = () => {
    setDirty(false);
    if (isNew) {
      window.setSCN({ flowSaved: true });
      toast((name || 'deps-refresh') + ' saved to studio/flows/ (mock)');
    } else {
      toast(baseFlow.name + ' updated — topology change applies from the next run (mock)');
    }
  };

  const paletteGroups = [
    { label: 'Agents', items: AGENTS.map(a => ({ id: a.id, name: a.name, kind: 'agent' })), dotStyle: { background: 'var(--c-agent)' } },
    { label: 'Gates', items: Object.keys(GATE_DEFAULTS).map(g => ({ id: g, name: GATE_DEFAULTS[g].name.toLowerCase(), kind: 'gate' })), dotStyle: { background: 'var(--amber)' } },
    { label: 'Hooks', items: CATALOG.hooks, dotStyle: { background: 'var(--red)' } },
    { label: 'Templates', items: CATALOG.templates, dotStyle: { background: 'var(--c-artifact)' } },
  ];

  return (
    <div className="workbench">
      {/* palette */}
      <aside className="col-left">
        <div className="col-left-head">
          <h3>Palette</h3>
          <div className="search-wrap">
            <span className="search-glyph">⌕</span>
            <input className="input" placeholder="Search components…" readOnly onClick={() => toast('Palette search is mocked in this prototype')} />
          </div>
        </div>
        <div className="catalog-scroll">
          {branchAt != null ? (
            <div style={{ margin: '8px 12px', padding: '8px 10px', border: '1px dashed var(--violet)', borderRadius: 'var(--radius-sm)', fontSize: 11.5, color: 'var(--violet)' }}>
              ⑂ Branch armed — added agents build a PARALLEL column after the selected node. Press the branch button again to disarm.
            </div>
          ) : null}
          {paletteGroups.map(group => (
            <div key={group.label}>
              <button className="catalog-group-header"><span>{group.label}</span><span className="chevron">▾</span></button>
              <div className="catalog-group-body">
                {group.items.map(it => (
                  <span key={it.id} data-j={'fcat-' + it.id} className="catalog-chip"
                    title={it.kind === 'agent' || it.kind === 'gate' ? 'Drag onto the canvas, or click to append' : 'Flow-level component'}
                    draggable={it.kind === 'agent' || it.kind === 'gate'}
                    onDragStart={e => e.dataTransfer.setData('text/plain', JSON.stringify(it))}
                    onClick={() => { if (it.kind === 'agent') addAgentNode(it.id); else if (it.kind === 'gate') addGateNode(it.id); }}>
                    <span className="dot" style={group.dotStyle}></span>{it.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* canvas */}
      <div className="col-center">
        <div className="def-header">
          <span className="hex-glyph" data-type="flow"></span>
          <div style={{ flex: 1 }}>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <select className="input" data-j="flow-select" style={{ width: 'auto', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12.5 }}
                value={isNew ? 'new' : baseFlow.id}
                onChange={e => go('flows', 'builder', e.target.value)}>
                <option value="new">＋ new flow</option>
                {allFlows().map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              {isNew ? (
                <input className="input" data-j="flow-name" placeholder="Name this flow…"
                  style={{ flex: 1, minWidth: 140, fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, background: 'transparent', border: 'none', borderBottom: '1.5px solid var(--line-2)', borderRadius: 0, padding: '2px 4px' }}
                  value={name} onChange={e => { setName(e.target.value); setDirty(true); }} />
              ) : (
                <span className="def-name">{baseFlow.name}</span>
              )}
              {!isNew ? <ProvenanceBadge provenance={baseFlow.provenance} /> : null}
              {dirty ? <span className="badge badge-dim" style={{ color: 'var(--amber)', borderColor: 'rgba(251,191,36,.35)' }}>unsaved</span> : null}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
              {isNew ? 'A new flow — drag agents and gates from the palette to shape the topology.' : baseFlow.desc}
            </div>
          </div>
          {!isNew ? <button className="btn btn-sm" data-j="kickoff-btn" onClick={() => go('flows', 'kickoff', baseFlow.id)}>Kick off run →</button> : null}
          {!isNew ? <button className="btn btn-sm" onClick={() => go('flows', 'monitor', baseFlow.id)}>Monitor →</button> : null}
          <button className="btn btn-primary btn-sm" data-j="save-flow" onClick={saveFlow}>Save</button>
        </div>
        <div className="def-body">
          <div>
            <span className="field-label">Topology — parallel lines allowed in plan/develop; review/reflect take one line</span>
            <div className="canvas-wrap" ref={canvasRef}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                try {
                  const d = JSON.parse(e.dataTransfer.getData('text/plain'));
                  if (d.kind === 'agent') addAgentNode(d.id);
                  else if (d.kind === 'gate') addGateNode(d.id);
                } catch { /* not a palette chip */ }
              }}>
              {flatNodes.length ? (
                <FlowLane columns={cols} liveNode={!isNew && baseFlow.live ? baseFlow.live.node : null}
                  selected={selectedNode} onSelect={setSelectedNode} />
              ) : (
                <div className="empty" style={{ border: 'none', padding: '34px 20px' }}>
                  An empty canvas. Drag an agent from the palette — or click one — to place the first node.
                </div>
              )}
            </div>
            <p className="faint" style={{ fontSize: 11.5, marginTop: 8 }}>
              Nodes chain by hand-off: each agent takes the previous output artifact as input. A join node waits for
              every parallel input before it starts.
            </p>
          </div>

          <div className="two-col">
            <div>
              <span className="field-label">Triggers — how runs of this flow start</span>
              <div className="drop-zone" data-j="triggers-panel">
                {(TRIGGERS[isNew ? 'forge-develop' : baseFlow.id] || [{ type: 'manual', label: 'Manual kickoff' }]).map((t, i) => (
                  <span key={i} className="trig-chip" data-t={t.type}>
                    {t.type === 'manual' ? '▶' : t.type === 'hook' ? '⚡' : '↻'} {t.label}
                    {t.scope ? <span className="scope"> · {t.scope}</span> : null}
                  </span>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={() => toast('Add trigger (mock): manual · on another agent/flow completing · on a project hook (PR closed, issue raised…) — scoped per project')}>+ add</button>
              </div>
            </div>
            <div>
              <span className="field-label">Flow input / output artifacts</span>
              <div className="drop-zone">
                <span className="zone-chip" data-kind="template"><span className="dot dot-template"></span>initiative spec (in)</span>
                <span className="zone-chip" data-kind="template"><span className="dot dot-template"></span>merged PR (out)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* inspector */}
      <aside className="col-right">
        <div className="panel-head"><span>Node inspector</span></div>
        {!node ? <div className="faint" style={{ padding: 16, fontSize: 12.5, fontStyle: 'italic' }}>Place or select a node to inspect it.</div> : (
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div className="row" style={{ gap: 8 }}>
                <span className="fn-hex" data-kind={node.kind}></span>
                <h3 style={{ fontSize: 15 }}>{node.name}</h3>
                <span className="badge badge-dim">{node.kind}</span>
              </div>
              <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 0' }}>{node.sub}</p>
            </div>

            <div>
              <span className="field-label">Inputs (from the previous column)</span>
              {nodeInputs.length ? (
                <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
                  {nodeInputs.map(i => <span key={i} className="badge badge-artifact" style={{ fontSize: 9.5 }}>⬅ {i}</span>)}
                  {prevCol && prevCol.length > 1 ? <span className="join-badge">⧉ waits for all</span> : null}
                </div>
              ) : <span className="faint" style={{ fontSize: 11.5, fontStyle: 'italic' }}>{nodeColIdx <= 0 ? 'flow entry — takes the flow input artifact' : 'previous node has no hand-off set'}</span>}
            </div>

            {node.kind === 'agent' ? (
              <div>
                <span className="field-label">Fan-out</span>
                <div className="row">
                  <button className="btn btn-sm" data-j="fanout-btn"
                    onClick={() => updateNode({ fanout: node.fanout ? null : 4 })}>
                    {node.fanout ? '⑃ fanout ×' + node.fanout + ' — disable' : '⑃ Enable fanout'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <span className="field-label">Gate behaviour</span>
                <p className="faint" style={{ fontSize: 12, margin: 0 }}>
                  User gate: the flow pauses here until the operator approves or sends back.
                </p>
              </div>
            )}

            <div>
              <span className="field-label">Branch</span>
              <button className="btn btn-sm" data-j="branch-btn"
                style={branchAt === nodeColIdx ? { borderColor: 'var(--violet)', color: 'var(--violet)' } : undefined}
                onClick={() => {
                  if (branchAt === nodeColIdx) { setBranchAt(null); branchColRef.current = null; toast('Branch disarmed'); }
                  else { setBranchAt(nodeColIdx); branchColRef.current = null; toast('Branch armed — added agents run in parallel, right after ' + node.name); }
                }}>
                {branchAt === nodeColIdx ? '⑂ Branch armed — disarm' : '⑂ Branch after this node'}
              </button>
              <p className="faint" style={{ fontSize: 11, margin: '6px 0 0' }}>
                Plan + develop bands can hold any number of lines; review + reflect must be a single line.
              </p>
            </div>

            <div>
              <span className="field-label">Hand-off artifact (out)</span>
              <select className="input" data-j="artifact-select" value={node.out || ''}
                onChange={e => updateNode({ out: e.target.value || null })}>
                <option value="">— none —</option>
                {TEMPLATES.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            </div>

            <div>
              <span className="field-label">Band</span>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {['plan', 'develop', 'review', 'reflect', 'onboard'].map(b => (
                  <button key={b} data-j={'band-' + b} className={'btn btn-sm' + (node.band === b ? '' : ' btn-ghost')}
                    onClick={() => updateNode({ band: b })}>{b}</button>
                ))}
              </div>
            </div>

            {nodeAgent ? (
              <button className="btn btn-sm" onClick={() => go('agents', 'builder', nodeAgent.id)}>Open in agent builder →</button>
            ) : null}
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={removeNode}>Remove node</button>
          </div>
        )}
      </aside>
    </div>
  );
}

// ---------- run detail (with per-node agent logs) ----------
function RunDetail({ runKey, go, toast }) {
  const detail = RUN_DETAILS[runKey];
  const flowId = (runKey || '').split(':')[0];
  const [logNode, setLogNode] = React.useState(null);
  if (!detail) {
    return (
      <div className="page">
        <Empty text="Run detail is mocked for the most recent runs only." hint="Older runs would resolve from the JSONL event log." />
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button className="btn btn-sm" onClick={() => go('flows', 'monitor', flowId)}>← Back to monitor</button>
        </div>
      </div>
    );
  }
  const activeLog = logNode && NODE_LOGS[logNode];
  return (
    <div className="page">
      <PageHead
        eyebrow={'flow run / ' + flowId} color="var(--c-flow)"
        title={detail.title}
        lede="Node-by-node breakdown of this run. Click any node to open its full agent session log — thought process, tool use, artifacts."
        actions={
          <React.Fragment>
            <StatusPair status={detail.status} />
            <span className="card-stat" style={{ color: 'var(--ember)' }}>{detail.cost}</span>
            <button className="btn btn-sm" onClick={() => go('flows', 'monitor', flowId)}>← Monitor</button>
          </React.Fragment>
        }
      />
      <div className="two-col">
        <Panel title="Node timeline — click a node for its agent log">
          <div className="run-steps">
            {detail.nodes.map((n, i) => (
              <button key={i} className="run-step" data-j={'run-node-' + i}
                style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit', ...(logNode === n.node ? { background: 'var(--panel-2)', borderRadius: 'var(--radius-sm)' } : {}) }}
                onClick={() => setLogNode(logNode === n.node ? null : n.node)}>
                <span className="rail"></span>
                <span className="knot" data-status={n.status}></span>
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="rs-name">{n.node}</span>
                    <StatusPair status={n.status} />
                  </div>
                  <div className="rs-note">{n.note}</div>
                  {n.artifacts.length ? (
                    <div className="rs-artifacts">
                      {n.artifacts.map((a, k) => <span key={k} className="card-stat">{a}</span>)}
                    </div>
                  ) : null}
                </div>
                <span className="rs-cost">{n.cost}</span>
              </button>
            ))}
          </div>
        </Panel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {logNode ? (
            <Panel title={'Agent session log — ' + logNode} pad={false}>
              {activeLog ? (
                <div className="nlog">
                  {activeLog.map((l, i) => (
                    <div key={i} className="row">
                      <span className="tag" data-t={l.t}>{l.t}</span>
                      <span className="txt" data-t={l.t}>{l.text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="nlog faint" style={{ fontStyle: 'italic' }}>
                  Full log resolves from the JSONL event stream for this node.
                </div>
              )}
              <div className="row" style={{ padding: '8px 14px', borderTop: '1px solid var(--line)' }}>
                <span className="faint" style={{ fontSize: 11 }}>Every line is a structured event — greppable in _logs/.</span>
              </div>
            </Panel>
          ) : null}
          <Panel title="Review findings" pad={false}>
            {detail.findings.length ? (
              <div style={{ padding: '4px 14px' }}>
                {detail.findings.map((f, i) => (
                  <div key={i} className="finding">
                    <span className="badge sev" data-sev={f.sev}>{f.sev}</span>
                    <span style={{ flex: 1, color: 'var(--dim)' }}>{f.text}</span>
                    <span className="status-text" data-status={f.state === 'fixed' ? 'complete' : 'attention'}>{f.state}</span>
                  </div>
                ))}
              </div>
            ) : <Empty text="No findings — clean review." />}
          </Panel>
          <Panel title="Evidence">
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <button className="obj-card" data-type="artifact" style={{ padding: 10, width: 150 }}
                onClick={() => toast('Opens the demo HTML summary (mock)')}>
                <span className="tpl-thumb" data-kind="html" style={{ height: 64, marginBottom: 6 }}></span>
                <span style={{ fontSize: 11.5 }}>demo HTML summary</span>
              </button>
              <button className="obj-card" data-type="artifact" style={{ padding: 10, width: 150 }}
                onClick={() => toast('Opens the screenshot set (mock)')}>
                <span className="tpl-thumb" data-kind="shots" style={{ height: 64, marginBottom: 6 }}></span>
                <span style={{ fontSize: 11.5 }}>screenshot set</span>
              </button>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ---------- monitor (generalized live-run progression per flow) ----------
function FlowMonitor({ flowId, go }) {
  const SCN = window.SCN || {};
  const [sel, setSel] = React.useState(flowId || 'forge-develop');
  const flows = allFlows();
  const flow = flows.find(f => f.id === sel) || flows[0];
  const history = FLOW_HISTORY[flow.id] || [];

  const run = FLOW_RUNS[flow.id];
  const running = run && SCN.flowRun != null && (SCN.flowRunFlow || 'forge-develop') === flow.id;
  const approved = running && (SCN.flowRun === 'approved' || SCN.flowRun === 'done');
  const stageIdx = approved ? run.stages.length - 1 : (running ? Math.min(SCN.flowRun, run.stages.length - 1) : null);
  const liveNode = running && !approved ? run.stages[stageIdx].node : (flow.live ? flow.live.node : null);
  const liveCost = running ? '$' + run.stages.slice(0, stageIdx + 1).reduce((a, s) => a + (parseFloat((s.cost || '').replace('$', '')) || 0), 0).toFixed(2) : null;
  const gateOpen = running && !approved && run.stages[stageIdx].node === 'verdict';

  return (
    <div className="monitor">
      <aside className="monitor-list">
        <div className="monitor-list-head">
          <span>Flows</span><span className="spacer"></span>
          <span className="mono faint" style={{ fontSize: 10 }}>{flows.filter(f => f.status === 'active').length} live</span>
        </div>
        {flows.map(f => (
          <button key={f.id} className={'monitor-row' + (f.id === sel ? ' selected' : '')} onClick={() => setSel(f.id)}>
            <span className="status-dot" data-status={f.status}></span>
            <span style={{ flex: 1 }}>
              <span className="m-name">{f.name}</span>
              <span className="m-sub">{f.stats.runs} runs · {f.stats.merged} merged</span>
            </span>
          </button>
        ))}
      </aside>
      <div className="monitor-main">
        <PageHead
          eyebrow="flow monitor" color="var(--c-flow)"
          title={flow.name}
          lede={flow.desc}
          actions={
            <React.Fragment>
              <ProvenanceBadge provenance={flow.provenance} />
              <button className="btn btn-sm" data-j="kickoff-btn" onClick={() => go('flows', 'kickoff', flow.id)}>Kick off run</button>
              <button className="btn btn-sm" onClick={() => go('flows', 'builder', flow.id)}>Edit in builder →</button>
            </React.Fragment>
          }
        />
        <Panel title="Live topology" pad={false}>
          <div className="canvas-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <FlowLane nodes={flow.nodes} liveNode={approved ? null : liveNode} />
          </div>
          {running ? (
            <React.Fragment>
              <div className="row" style={{ margin: '0 14px 8px', gap: 8 }}>
                <span className="faint" style={{ fontSize: 11 }}>triggered by:</span>
                <span className="trig-chip" data-t={run.trigger.startsWith('auto') ? 'on-complete' : run.trigger.startsWith('project') ? 'hook' : 'manual'}>{run.trigger}</span>
              </div>
              <div className="live-strip" style={{ margin: '0 14px 14px' }}>
                <span className="status-dot" data-status={approved ? 'complete' : 'active'}></span>
                <span className="what">{flow.id === 'forge-develop' ? LIVE_RUN.project + ' · ' + LIVE_RUN.initiative : run.trigger}{approved ? ' — complete' : ''}</span>
                <span className="cost">{liveCost}</span>
              </div>
            </React.Fragment>
          ) : flow.live ? (
            <div className="live-strip" style={{ margin: '0 14px 14px' }}>
              <span className="status-dot" data-status="active"></span>
              <span className="what">{flow.live.what}</span>
              <span className="cost">{flow.live.cost}</span>
            </div>
          ) : null}
        </Panel>

        {running ? (
          <React.Fragment>
            <div style={{ height: 18 }}></div>
            <Panel title="Run log" pad={false}>
              <div style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 2, color: 'var(--dim)' }}>
                {run.stages.slice(0, stageIdx + 1).map((s, i) => (
                  <div key={i} className="row" style={{ gap: 10 }}>
                    <span className="status-dot" data-status={i === stageIdx && !approved ? 'active' : 'complete'} style={{ width: 6, height: 6 }}></span>
                    <span style={{ flex: 1 }}>{s.log}</span>
                    <span style={{ color: 'var(--ember)', fontSize: 11 }}>{s.cost}</span>
                  </div>
                ))}
                {approved ? (
                  <div className="row" style={{ gap: 10 }}>
                    <span className="status-dot" data-status="complete" style={{ width: 6, height: 6 }}></span>
                    <span style={{ flex: 1, color: 'var(--green)' }}>
                      {flow.id === 'forge-develop' ? 'Verdict: approved — PR merged, tests green post-merge' : 'Run complete — outputs landed'}
                    </span>
                  </div>
                ) : null}
              </div>
            </Panel>
          </React.Fragment>
        ) : null}

        {gateOpen ? (
          <React.Fragment>
            <div style={{ height: 18 }}></div>
            <Panel title="Verdict gate — operator decision" pad={false}>
              <div className="row" style={{ padding: 14, gap: 10, flexWrap: 'wrap' }}>
                <span className="muted" style={{ fontSize: 13, flex: 1, minWidth: 260 }}>
                  Review clean (0 findings), demo evidence attached. Approve to merge, or send back with notes.
                </span>
                <button className="btn btn-sm" onClick={() => window.setSCN({ flowRun: 3 })}>Send back</button>
                <button className="btn btn-primary btn-sm" data-j="approve-btn" onClick={() => window.setSCN({ flowRun: 'approved' })}>
                  Approve &amp; merge
                </button>
              </div>
            </Panel>
          </React.Fragment>
        ) : null}

        {approved && flow.id === 'forge-develop' ? (
          <div className="row" style={{ marginTop: 18 }}>
            <button className="btn btn-sm" data-j="open-run-btn" onClick={() => go('flows', 'run', 'forge-develop:live')}>
              Open run detail →
            </button>
          </div>
        ) : null}

        <div style={{ height: 18 }}></div>
        <Panel title="Run history — click a run for the node-by-node breakdown" pad={false}>
          {history.length ? (
            <Ledger rows={history} onRow={(r, i) => go('flows', 'run', flow.id + ':' + i)} />
          ) : <Empty text="No runs yet." />}
        </Panel>
      </div>
    </div>
  );
}

Object.assign(window, { FlowsHome, FlowBuilder, FlowMonitor, RunDetail });
