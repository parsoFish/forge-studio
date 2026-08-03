// ── Shared presentational components ──────────────────────────────────
// Props in, callbacks out. All state lives in App (app.jsx).

const TYPE_COLOR = {
  project: 'var(--c-project)', agent: 'var(--c-agent)', flow: 'var(--c-flow)',
  kb: 'var(--c-kb)', artifact: 'var(--c-artifact)',
};

function TopNav({ section, onNav }) {
  const items = [
    { id: 'home', label: 'Home' },
    { id: 'flows', label: 'Flows' },
    { id: 'agents', label: 'Agents' },
    { id: 'projects', label: 'Projects' },
    { id: 'library', label: 'Library' },
    { id: 'knowledge', label: 'Knowledge Bases' },
  ];
  return (
    <nav className="nav">
      <button className="brand" onClick={() => onNav('home')}>
        <span className="hex-mark"></span>
        FORGE&nbsp;STUDIO <span className="sub">/ modular agent flows</span>
      </button>
      <div className="nav-links">
        {items.map(it => (
          <button key={it.id} data-j={'nav-' + it.id} className={section === it.id ? 'active' : ''} onClick={() => onNav(it.id)}>
            {it.label}
          </button>
        ))}
      </div>
      <span className="mock-flag">end-state mock · v2</span>
    </nav>
  );
}

function SubNav({ color, label, items, active, onPick, right }) {
  return (
    <div className="subnav">
      <span className="subnav-label">
        <span className="dot" style={{ background: color }}></span>{label}
      </span>
      {items.map(it => (
        <button key={it.id} data-j={'sub-' + it.id} className={active === it.id ? 'active' : ''} onClick={() => onPick(it.id)}>
          {it.label}
        </button>
      ))}
      <span className="spacer"></span>
      {right || null}
    </div>
  );
}

function PageHead({ eyebrow, color, title, lede, actions }) {
  return (
    <header className="page-head">
      <div>
        <div className="eyebrow">
          {color ? <span className="dot" style={{ background: color }}></span> : null}
          {eyebrow}
        </div>
        <h1>{title}</h1>
        {lede ? <p className="lede">{lede}</p> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </header>
  );
}

function SectionTitle({ children, count, onSeeAll }) {
  return (
    <div className="section-title">
      <span>{children}</span>
      {count != null ? <span className="count">{count}</span> : null}
      {onSeeAll ? <button className="see-all" onClick={onSeeAll}>see all →</button> : null}
    </div>
  );
}

function ProvenanceBadge({ provenance }) {
  if (provenance === 'ootb') return <span className="badge badge-ootb">ootb</span>;
  if (provenance === 'vision') return <span className="badge badge-dim">planned</span>;
  return null; // operator-authored objects carry no badge — they're the default
}

function StatusPair({ status }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className="status-dot" data-status={status}></span>
      <span className="status-text" data-status={status}>{status}</span>
    </span>
  );
}

function TypeBadge({ type }) {
  return <span className={'badge badge-' + type}>{type}</span>;
}

function ObjCard({ type, name, desc, badges, stats, live, status, onClick, jid }) {
  return (
    <button className="obj-card" data-type={type} data-j={jid} onClick={onClick}>
      <div className="card-top">
        <span className="status-dot" data-status={status} style={{ marginTop: 5 }}></span>
        <span className="card-name">{name}</span>
        {badges}
      </div>
      <p className="card-desc">{desc}</p>
      <div className="card-meta">
        {(stats || []).map((s, i) => <span key={i} className="card-stat">{s}</span>)}
      </div>
      {live ? (
        <div className="live-strip">
          <span className="status-dot" data-status="active"></span>
          <span className="what">{live.what}</span>
          <span className="cost">{live.cost}</span>
        </div>
      ) : null}
    </button>
  );
}

function HexCell({ kind, label, status, glyph, onClick }) {
  return (
    <button className="hex-cell" data-kind={kind} onClick={onClick} title={label + ' — ' + status}>
      <span className="hex-frame" data-status={status}>
        <span className="hex-inner">
          <span className="glyph">{glyph}</span>
          <span className="mini">{status}</span>
        </span>
      </span>
      <span className="hex-label">{label}</span>
    </button>
  );
}

// Unified monitor history table — flows and agents share this exact shape.
function Ledger({ rows, onRow }) {
  return (
    <table className="ledger">
      <thead>
        <tr><th style={{ width: 70 }}>when</th><th>work</th><th style={{ width: 90 }}>status</th><th style={{ width: 70, textAlign: 'right' }}>cost</th></tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={onRow ? 'row-click' : undefined} onClick={onRow ? () => onRow(r, i) : undefined}>
            <td className="t-mono">{r.when}</td>
            <td>
              <div className="t-main">{r.what}</div>
              <div className="t-sub">{r.sub}</div>
            </td>
            <td><StatusPair status={r.status} /></td>
            <td className="t-cost">{r.cost}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Panel({ title, children, pad, right }) {
  return (
    <section className="panel">
      {title ? <div className="panel-head"><span>{title}</span><span className="spacer"></span>{right || null}</div> : null}
      <div className="panel-body" style={pad === false ? { padding: 0 } : undefined}>{children}</div>
    </section>
  );
}

function Empty({ text, hint }) {
  return (
    <div className="empty">
      {text}
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

// ── Hex flow topology — mirrors the real FlowBuilderCanvas node look ──
// Accepts `columns` (array of node-arrays: a column with >1 nodes = a
// parallel branch) or legacy `nodes` (linear). A node after a multi-node
// column is a JOIN — it waits for all inputs.

const NODE_DOT = { agent: 'var(--c-agent)', gate: 'var(--amber)', queue: 'var(--faint)' };
const DAG_SLOT = 150; // vertical rhythm per parallel node (hex + labels + gap)

function HexNode({ n, isLive, isSel, joinAll, onSelect }) {
  return (
    <button className="hexnode" data-band={n.band || null} data-j={'node-' + n.id}
      onClick={onSelect ? () => onSelect(n.id) : undefined}>
      <span className="hexnode-frame" data-sel={isSel ? 'true' : 'false'} data-live={isLive ? 'true' : 'false'}>
        <span className="hexnode-inner">
          <span className="nd" style={{ background: NODE_DOT[n.kind] || 'var(--faint)' }}></span>
          <span className="hexnode-name">{n.name}</span>
          {n.kind === 'gate' ? (
            <span className="hexnode-badge" style={{ color: 'var(--amber)', background: 'rgba(251,191,36,.12)' }}>gate</span>
          ) : null}
          {n.fanout ? (
            <span className="hexnode-badge" style={{ color: 'var(--steel)', background: 'rgba(92,200,255,.1)' }}>fan-out ×{n.fanout}</span>
          ) : null}
        </span>
      </span>
      <span className="hexnode-ref">{n.sub || n.band || n.kind}</span>
      {n.out ? <span className="hexnode-out badge badge-artifact" style={{ fontSize: 9 }}>→ {n.out}</span> : null}
      {joinAll ? <span className="join-badge">⧉ waits for all</span> : null}
    </button>
  );
}

function DagConnector({ from, to, live, slot }) {
  const W = 54;
  const SLOT = slot || DAG_SLOT;
  const rows = Math.max(from, to);
  const H = rows * SLOT;
  const ys = k => Array.from({ length: k }, (_, i) => H / 2 + (i - (k - 1) / 2) * SLOT);
  const ysF = ys(from), ysT = ys(to);
  const paths = [];
  if (from === 1) ysT.forEach(y => paths.push([ysF[0], y]));
  else if (to === 1) ysF.forEach(y => paths.push([y, ysT[0]]));
  else ysF.forEach((y, i) => paths.push([y, ysT[Math.min(i, to - 1)]]));
  return (
    <svg className={'dag-conn' + (live ? ' live' : '')} width={W} height={H} style={{ height: H }}>
      {paths.map(([y1, y2], i) => (
        <path key={i} d={`M 0 ${y1} C ${W * 0.45} ${y1}, ${W * 0.55} ${y2}, ${W} ${y2}`} />
      ))}
      <polygon points={`${W - 7},${(ysT.reduce((a, b) => a + b, 0) / ysT.length) - 4} ${W},${ysT.reduce((a, b) => a + b, 0) / ysT.length} ${W - 7},${(ysT.reduce((a, b) => a + b, 0) / ysT.length) + 4}`}
        fill={live ? 'var(--ember)' : 'var(--line-2)'} stroke="none" strokeDasharray="none" />
    </svg>
  );
}

function FlowLane({ nodes, columns, liveNode, selected, onSelect }) {
  const cols = columns || (nodes || []).map(n => [n]);
  const flatBefore = idx => cols.slice(0, idx).flat().some(x => x.id === liveNode);
  return (
    <div className="dag">
      {cols.map((col, ci) => (
        <React.Fragment key={ci}>
          {ci > 0 ? (
            <DagConnector from={cols[ci - 1].length} to={col.length} live={!!liveNode && flatBefore(ci)} />
          ) : null}
          <div className="dag-col">
            {col.map(n => (
              <HexNode key={n.id} n={n}
                isLive={liveNode === n.id}
                isSel={selected === n.id}
                joinAll={ci > 0 && cols[ci - 1].length > 1 && col.length === 1}
                onSelect={onSelect} />
            ))}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

Object.assign(window, {
  TopNav, SubNav, PageHead, SectionTitle, ProvenanceBadge, StatusPair, TypeBadge,
  ObjCard, HexCell, Ledger, Panel, Empty, FlowLane, DagConnector, HexNode, TYPE_COLOR,
});
