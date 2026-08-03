// ── Knowledge Bases: brains list + create kickoff + detail ────────────
// Explore tab: DYNAMIC force-directed graph — clusters form around INDEX
// hubs through edge tension, nodes are draggable and neighbours react.
// Click a node to read it in the combined reader.

function allBrains() {
  const SCN = window.SCN || {};
  const list = BRAINS.slice();
  if (SCN.newBrainProject) list.push(EXTRA.trafficgameBrain);
  if (SCN.newBrainCycle) list.splice(2, 0, EXTRA.reviewInsightsBrain);
  return list;
}

function KnowledgeView({ view, selectedId, go, toast }) {
  if (view === 'detail' && selectedId) {
    return <BrainDetail brainId={selectedId} go={go} toast={toast} />;
  }
  if (view === 'create') {
    return <KbCreateKickoff go={go} />;
  }
  return <BrainsList go={go} />;
}

function BrainsList({ go }) {
  const brains = allBrains();
  return (
    <div className="page">
      <PageHead
        eyebrow="knowledge bases" color="var(--c-kb)"
        title="Knowledge bases"
        lede="The three-scope brain model: forge engineering, cross-cycle patterns, and one brain per project. Every brain is a linked graph — lintable, ingestable, and browsable as a human-readable wiki."
        actions={
          <button className="btn btn-primary" data-j="create-brain-btn" onClick={() => go('knowledge', 'create')}>
            + Create a brain
          </button>
        }
      />
      <SectionTitle count={brains.length}>Brains</SectionTitle>
      <div className="card-grid">
        {brains.map(b => (
          <ObjCard key={b.id} jid={'brain-' + b.id} type="kb" name={b.name} desc={b.desc} status={b.status}
            badges={<React.Fragment><TypeBadge type="kb" /><ProvenanceBadge provenance={b.provenance} /></React.Fragment>}
            stats={[b.themes + ' themes', b.edges + ' edges', b.indexes + ' hubs', 'ingest ' + b.lastIngest]}
            onClick={() => go('knowledge', 'detail', b.id)} />
        ))}
      </div>
    </div>
  );
}

// ── force-directed graph (hand-rolled, ~springs + repulsion) ──────────
function seededRand(seed) {
  let s = seed % 233280;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function buildForceGraph(brain) {
  const p = GRAPHS[brain.id] || { hubs: Math.max(1, brain.indexes), themes: Math.min(30, brain.themes), raw: 6, cap: null };
  const rnd = seededRand(brain.id.split('').reduce((a, c) => a + c.charCodeAt(0), 7));
  const W = 960, H = 470, cx = W / 2, cy = H / 2;
  const nodes = [], edges = [];
  for (let i = 0; i < p.hubs; i++) {
    const ang = (i / p.hubs) * Math.PI * 2;
    nodes.push({ id: 'hub' + i, type: 'hub', cluster: i, x: cx + Math.cos(ang) * 120, y: cy + Math.sin(ang) * 90, vx: 0, vy: 0 });
  }
  const themes = [];
  for (let i = 0; i < p.themes; i++) {
    const cl = i % p.hubs;
    const hub = nodes[cl];
    const n = { id: 'th' + i, type: 'theme', cluster: cl, x: hub.x + (rnd() - 0.5) * 160, y: hub.y + (rnd() - 0.5) * 130, vx: 0, vy: 0 };
    nodes.push(n); themes.push(n);
    edges.push({ a: hub, b: n, hub: true, rest: 70 });
    // intra-cluster relations — this is what makes clusters read as clusters
    const peers = themes.filter(t => t.cluster === cl && t !== n);
    if (peers.length && rnd() > 0.35) edges.push({ a: n, b: peers[Math.floor(rnd() * peers.length)], hub: false, rest: 60 });
    // occasional cross-cluster bridge
    if (i > 3 && rnd() > 0.88) edges.push({ a: n, b: themes[Math.floor(rnd() * i)], hub: false, rest: 130 });
  }
  for (let i = 0; i < p.raw; i++) {
    const t = themes[Math.floor(rnd() * themes.length)];
    const n = { id: 'raw' + i, type: 'raw', cluster: t.cluster, x: t.x + (rnd() - 0.5) * 50, y: t.y + (rnd() - 0.5) * 50, vx: 0, vy: 0 };
    nodes.push(n);
    edges.push({ a: t, b: n, hub: false, rest: 34 });
  }
  return { nodes, edges, cap: p.cap, W, H, cx, cy };
}

function KbGraphForce({ brain, onOpenTheme }) {
  const [preset, setPreset] = React.useState('balanced');
  const [sel, setSel] = React.useState(null);
  const [, tick] = React.useState(0);
  const gRef = React.useRef(null);
  const svgRef = React.useRef(null);
  const alphaRef = React.useRef(1);
  const dragRef = React.useRef(null); // { node, moved }
  const spread = preset === 'compact' ? 0.72 : preset === 'spread' ? 1.35 : 1;
  const tree = KB_TREE[brain.id] || KB_TREE['develop-cycle'];

  if (!gRef.current || gRef.current.brainId !== brain.id) {
    gRef.current = { ...buildForceGraph(brain), brainId: brain.id };
    alphaRef.current = 1;
  }

  React.useEffect(() => { alphaRef.current = Math.max(alphaRef.current, 0.7); }, [preset]);

  React.useEffect(() => {
    let raf;
    const step = () => {
      const g = gRef.current;
      const alpha = alphaRef.current;
      if (alpha > 0.015) {
        const { nodes, edges, cx, cy } = g;
        // pairwise repulsion (hubs repel harder — separates the clusters)
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            let dx = a.x - b.x, dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) { d2 = 1; dx = 1; }
            if (d2 > 90000) continue;
            const k = (a.type === 'hub' && b.type === 'hub' ? 5200 : 620) / d2;
            const d = Math.sqrt(d2);
            const fx = (dx / d) * k, fy = (dy / d) * k;
            a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
          }
        }
        // springs along edges (tension folds the graph out)
        for (const e of edges) {
          const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
          const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const f = (d - e.rest * spread) * 0.045;
          const fx = (dx / d) * f, fy = (dy / d) * f;
          e.a.vx += fx; e.a.vy += fy; e.b.vx -= fx; e.b.vy -= fy;
        }
        // gentle centering + integrate
        const drag = dragRef.current;
        for (const n of nodes) {
          n.vx += (cx - n.x) * 0.0035; n.vy += (cy - n.y) * 0.0035;
          if (drag && drag.node === n) { n.vx = 0; n.vy = 0; continue; }
          n.vx *= 0.82; n.vy *= 0.82;
          n.x += n.vx * alpha; n.y += n.vy * alpha;
        }
        alphaRef.current = drag ? Math.max(alpha, 0.35) : alpha * 0.985;
        tick(t => t + 1);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [brain.id, spread]);

  const toGraphXY = e => {
    const svg = svgRef.current;
    const r = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * gRef.current.W,
      y: ((e.clientY - r.top) / r.height) * gRef.current.H,
    };
  };
  const startDrag = (node, e) => {
    dragRef.current = { node, moved: 0 };
    alphaRef.current = Math.max(alphaRef.current, 0.6);
    const onMove = ev => {
      const p = toGraphXY(ev);
      const d = dragRef.current;
      if (!d) return;
      d.moved += Math.abs(p.x - d.node.x) + Math.abs(p.y - d.node.y);
      d.node.x = p.x; d.node.y = p.y;
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (d && d.moved < 6) { // click, not drag → open it
        setSel(d.node.id);
        if (d.node.type === 'hub') onOpenTheme(tree[0]);
        else if (d.node.type === 'theme') {
          const i = parseInt(d.node.id.slice(2), 10) || 0;
          onOpenTheme(tree[(i % (tree.length - 1)) + 1] || tree[0]);
        }
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    e.preventDefault();
  };

  const g = gRef.current;
  return (
    <div className="kb-graph-wrap">
      <svg className="kb-graph-svg" ref={svgRef} viewBox={'0 0 ' + g.W + ' ' + g.H} role="img"
        aria-label={'Knowledge graph of ' + brain.name}>
        <defs>
          <filter id="glow-green" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {g.edges.map((e, i) => (
          <line key={i} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y}
            stroke={e.hub ? 'rgba(74,222,128,0.28)' : 'var(--line-2)'} strokeWidth={e.hub ? 1.4 : 1} strokeLinecap="round" />
        ))}
        {g.nodes.filter(n => n.type === 'raw').map(n => (
          <circle key={n.id} cx={n.x} cy={n.y} r="3.5" fill="var(--faint)" opacity="0.45"
            style={{ cursor: 'grab' }} onPointerDown={e => startDrag(n, e)} />
        ))}
        {g.nodes.filter(n => n.type === 'theme').map((n, i) => (
          <g key={n.id} data-j={'gnode-' + i} style={{ cursor: 'grab' }} onPointerDown={e => startDrag(n, e)}>
            {sel === n.id ? <circle cx={n.x} cy={n.y} r="12" fill="none" stroke="var(--ember)" strokeWidth="2" /> : null}
            <circle cx={n.x} cy={n.y} r="8" fill="rgba(92,200,255,0.12)" stroke="var(--steel)" strokeWidth="1.5" />
          </g>
        ))}
        {g.nodes.filter(n => n.type === 'hub').map(n => {
          const hx = [];
          for (let k = 0; k < 6; k++) {
            const a = Math.PI / 3 * k - Math.PI / 2;
            hx.push((n.x + 14 * Math.cos(a)).toFixed(1) + ',' + (n.y + 14 * Math.sin(a)).toFixed(1));
          }
          return (
            <g key={n.id} style={{ cursor: 'grab' }} onPointerDown={e => startDrag(n, e)}>
              {sel === n.id ? <circle cx={n.x} cy={n.y} r="20" fill="none" stroke="var(--ember)" strokeWidth="2" /> : null}
              <polygon points={hx.join(' ')} fill="rgba(74,222,128,0.15)" stroke="var(--c-kb)" strokeWidth="2" filter="url(#glow-green)" />
              <text x={n.x} y={n.y + 3.5} textAnchor="middle" fontSize="8" fill="var(--c-kb)" fontWeight="700"
                fontFamily="var(--font-display)" letterSpacing="0.08em" style={{ pointerEvents: 'none' }}>IDX</text>
            </g>
          );
        })}
      </svg>
      <div className="kb-graph-toolbar">
        <span className="lbl">tension</span>
        {['compact', 'balanced', 'spread'].map(pr => (
          <button key={pr} className={preset === pr ? 'active' : ''} onClick={() => setPreset(pr)}>{pr}</button>
        ))}
      </div>
      <div className="kb-graph-legend">
        <span className="row" style={{ gap: 7 }}>
          <svg width="16" height="17"><polygon points="4,1.5 12,1.5 15.4,8.5 12,15.5 4,15.5 0.6,8.5" fill="none" stroke="var(--c-kb)" strokeWidth="1.5" /></svg>
          <span><strong style={{ color: 'var(--c-kb)' }}>INDEX</strong> — cluster anchors</span>
        </span>
        <span className="row" style={{ gap: 7 }}>
          <svg width="14" height="14"><circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--steel)" strokeWidth="1.5" /></svg>
          <span><strong style={{ color: 'var(--steel)' }}>THEMES</strong> — cluster by relation</span>
        </span>
        <span className="row" style={{ gap: 7 }}>
          <svg width="10" height="10"><circle cx="5" cy="5" r="3.5" fill="var(--faint)" opacity=".5" /></svg>
          <span><strong style={{ color: 'var(--faint)' }}>RAW</strong> — evidence satellites</span>
        </span>
        <span className="spacer"></span>
        <span className="stat">drag a node — neighbours follow</span>
        {g.cap ? <span className="stat">{g.cap}</span> : null}
        <span className="stat">nodes <strong>{brain.themes + brain.indexes}</strong></span>
        <span className="stat">edges <strong>{brain.edges}</strong></span>
      </div>
    </div>
  );
}

function BrainDetail({ brainId, go, toast }) {
  const SCN = window.SCN || {};
  let brain = allBrains().find(b => b.id === brainId) || BRAINS[0];
  if (brain.id === 'develop-cycle' && SCN.kbFixed) {
    brain = { ...brain, status: 'healthy', lint: { pass: 9, warn: 0, fail: 0 }, note: 'Cleanup 2026-08-03: 3 duplicate pairs merged, 12 themes tagged for multi-project evidence.' };
  }
  const [tab, setTab] = React.useState('explore');
  const tree = KB_TREE[brain.id] || KB_TREE['develop-cycle'];
  const [doc, setDoc] = React.useState(tree[1] ? tree[1].path : tree[0].path);

  const linkPct = Math.min(100, Math.round((brain.edges / Math.max(1, brain.themes * 2)) * 100));
  const lintPct = Math.round((brain.lint.pass / 9) * 100);
  const checks = LINT_CHECKS.map((c, i) => i === LINT_CHECKS.length - 1 ? { ...c, ok: brain.lint.warn === 0 } : c);

  return (
    <div className="page">
      <PageHead
        eyebrow={'knowledge / ' + brain.scope} color="var(--c-kb)"
        title={brain.name}
        lede={brain.desc}
        actions={
          <React.Fragment>
            <ProvenanceBadge provenance={brain.provenance} />
            <button className="btn btn-sm" onClick={() => go('knowledge', 'list')}>← All brains</button>
          </React.Fragment>
        }
      />

      <Panel pad={false}>
        <div className="row" style={{ padding: '10px 14px', gap: 8, flexWrap: 'wrap' }}>
          {[
            { label: 'Run lint', j: 'op-lint', act: () => toast('Lint (mock): ' + brain.lint.pass + '/9 checks' + (brain.lint.warn ? ' — distribution warning raised' : ' green')) },
            { label: 'Refresh index', j: 'op-index', act: () => toast('Refresh index (mock) — INDEX.md regenerated from the filesystem') },
            { label: 'Kick off ingestion', j: 'op-ingest', act: () => toast('Ingestion queued (mock) — a reflector pass will consolidate recent work') },
            { label: 'Add note', j: 'op-note', act: () => toast('Add note (mock) — operator note lands in the next ingest pass') },
            { label: 'Correct issue', j: 'op-correct', act: () => go('agents', 'session', 'kb-cleanup') },
          ].map(op => (
            <button key={op.label} className="btn btn-sm" data-j={op.j} onClick={op.act}>{op.label}</button>
          ))}
          <span className="spacer"></span>
          <StatusPair status={brain.status} />
        </div>
      </Panel>

      <div className="tabs" style={{ margin: '20px 0 0', display: 'flex', gap: 2, borderBottom: '1px solid var(--line)' }}>
        {[
          { id: 'explore', label: 'Explore' },
          { id: 'health', label: 'Health' },
          { id: 'activity', label: 'Ingest activity' },
        ].map(t => (
          <button key={t.id} data-j={'kbtab-' + t.id}
            className="btn btn-ghost btn-sm"
            style={tab === t.id ? { color: 'var(--ember)', borderBottom: '2px solid var(--ember)', borderRadius: 0 } : { borderRadius: 0 }}
            onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'explore' ? (
        <div className="kb-explore">
          <Panel pad={false}>
            <KbGraphForce brain={brain} onOpenTheme={t => setDoc(t.path)} />
          </Panel>
          <Panel title="Reader" pad={false}>
            <div className="kb-tree kb-reader-list" style={{ padding: '8px' }}>
              {tree.map(t => (
                <button key={t.path} className={doc === t.path ? 'selected' : ''}
                  style={t.hub ? { color: 'var(--c-kb)' } : undefined}
                  onClick={() => setDoc(t.path)}>
                  {t.label}
                </button>
              ))}
            </div>
            <article className="kb-doc" style={{ padding: '14px 16px' }}>
              <h3>{KB_DOC.title}</h3>
              <div style={{ marginBottom: 10 }}>
                {KB_DOC.tags.map(t => <span key={t} className="tag">{t}</span>)}
              </div>
              {KB_DOC.body.map((p, i) => <p key={i}>{p}</p>)}
              <h4>Related</h4>
              <p>
                {KB_DOC.related.map((r, i) => (
                  <React.Fragment key={r}>
                    {i > 0 ? ' · ' : ''}
                    <a className="wikilink" href="#" onClick={e => { e.preventDefault(); toast('Wikilink navigation is mocked'); }}>[[{r}]]</a>
                  </React.Fragment>
                ))}
              </p>
            </article>
          </Panel>
        </div>
      ) : null}

      {tab === 'health' ? (
        <div className="two-col" style={{ marginTop: 16 }}>
          <Panel title="Structure">
            <div className="health-meter">
              <div className="health-row">
                <span style={{ width: 110 }}>lint checks</span>
                <div className="bar"><span style={{ width: lintPct + '%', background: brain.lint.warn ? 'var(--amber)' : 'var(--green)' }}></span></div>
                <span className="pct">{brain.lint.pass}/9</span>
              </div>
              <div className="health-row">
                <span style={{ width: 110 }}>link density</span>
                <div className="bar"><span style={{ width: linkPct + '%', background: 'var(--c-kb)' }}></span></div>
                <span className="pct">{linkPct}%</span>
              </div>
              <div className="health-row">
                <span style={{ width: 110 }}>index hubs</span>
                <div className="bar"><span style={{ width: Math.min(100, brain.indexes * 8) + '%', background: 'var(--steel)' }}></span></div>
                <span className="pct">{brain.indexes}</span>
              </div>
            </div>
            <dl className="kv" style={{ marginTop: 16 }}>
              <dt>themes</dt><dd>{brain.themes}</dd>
              <dt>edges</dt><dd>{brain.edges}</dd>
              <dt>last ingest</dt><dd>{brain.lastIngest}</dd>
            </dl>
          </Panel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Panel title="Lint checks">
              <ul className="readiness-list">
                {checks.map((c, i) => (
                  <li key={i} className={'readiness-item' + (c.ok ? ' ok' : '')}>
                    <span className="ri-dot" style={c.ok ? undefined : { background: 'var(--amber)', boxShadow: '0 0 6px rgba(251,191,36,.4)' }}></span>
                    {c.name}
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Signals">
              {brain.note ? (
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <span className="status-dot" data-status={brain.status} style={{ marginTop: 5 }}></span>
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>{brain.note}</p>
                </div>
              ) : <Empty text="No open signals." hint="Lint warnings and skew notices land here." />}
            </Panel>
          </div>
        </div>
      ) : null}

      {tab === 'activity' ? (
        <div style={{ marginTop: 16 }}>
          <Panel title="Ingest history" pad={false}>
            <Ledger rows={FLOW_HISTORY['brain-tune']} />
          </Panel>
        </div>
      ) : null}
    </div>
  );
}

Object.assign(window, { KnowledgeView });
