// ── Community browser: browse + install MCPs, CLIs, tools, skills, hooks ─
// One surface over the external collections (MCP registry, CLI library,
// skills.sh, hook collections). Install pulls a copy into the local
// library with provenance kept.

function CommunityBrowser({ filterKind, go, toast }) {
  const [kind, setKind] = React.useState(filterKind || 'all');
  const [q, setQ] = React.useState('');
  const SCN = window.SCN || {};

  const kinds = [
    { id: 'all', label: 'All' }, { id: 'mcp', label: 'MCPs' }, { id: 'cli', label: 'CLIs' },
    { id: 'tool', label: 'Tools' }, { id: 'skill', label: 'Skills' }, { id: 'hook', label: 'Hooks' },
  ];
  const rows = COMMUNITY.filter(c =>
    (kind === 'all' || c.kind === kind) &&
    (!q || (c.name + ' ' + c.desc).toLowerCase().includes(q.toLowerCase()))
  );
  const badgeClass = { mcp: 'badge-project', cli: 'badge-project', tool: 'badge-project', skill: 'badge-flow', hook: 'badge-dim' };

  const install = c => {
    window.setSCN({ ['inst_' + c.id]: 'installing' });
    setTimeout(() => {
      window.setSCN({ ['inst_' + c.id]: 'installed' });
    }, 900);
  };

  return (
    <div className="page">
      <PageHead
        eyebrow="library / community" color="var(--violet)"
        title="Community browser"
        lede="One browser over the existing hubs. Installing pulls a copy into your local library with source provenance, version and hub signals kept."
        actions={<button className="btn btn-sm" onClick={() => go('library')}>← Library</button>}
      />

      {/* source hubs strip — where everything comes from */}
      <div data-j="hub-strip">
        <Panel title="Source hubs" pad={false}>
          <div className="row" style={{ padding: '10px 14px', gap: 8, flexWrap: 'wrap' }}>
            {COMMUNITY_HUBS.map(h => (
              <span key={h.id} className="card-stat" title={h.url}>
                <span style={{ color: 'var(--text)' }}>{h.name}</span>
                <span className="faint"> · {h.kinds}</span>
              </span>
            ))}
          </div>
        </Panel>
      </div>
      <div style={{ height: 16 }}></div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="search-wrap" style={{ width: 300 }}>
          <span className="search-glyph">⌕</span>
          <input className="input" data-j="comm-search" placeholder="Search collections…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {kinds.map(k => (
          <button key={k.id} data-j={'commkind-' + k.id}
            className={'btn btn-sm' + (kind === k.id ? '' : ' btn-ghost')}
            onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>

      <Panel pad={false}>
        {rows.map(c => {
          const state = SCN['inst_' + c.id];
          return (
            <div key={c.id} className="comm-row" data-j={'crow-' + c.id}
              style={{ cursor: 'pointer' }}
              onClick={() => go('library', 'citem', c.id)}>
              <span className={'badge comm-kind ' + (badgeClass[c.kind] || 'badge-dim')}>{c.kind}</span>
              <span style={{ flex: 1 }}>
                <span className="c-name">{c.name}</span>
                <div className="c-desc">{c.desc} <span className="faint">· details →</span></div>
              </span>
              <span style={{ textAlign: 'right' }}>
                <span className="c-src" style={{ color: 'var(--violet)' }}>{c.hub}</span>
                <div className="c-src">★ {c.stars} · ⬇ {c.dl} · {c.usage}</div>
              </span>
              <button
                className="btn btn-sm install-btn" data-j={'install-' + c.id}
                data-state={state || 'none'}
                onClick={e => { e.stopPropagation(); if (!state) install(c); }}>
                {state === 'installed' ? '✓ Installed' : state === 'installing' ? 'Installing…' : 'Install'}
              </button>
            </div>
          );
        })}
        {!rows.length ? <Empty text="Nothing matches." /> : null}
      </Panel>
      <p className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
        Installed objects appear in the matching local shelf with a community badge; updates are pull-based and diffed before applying.
      </p>
    </div>
  );
}

Object.assign(window, { CommunityBrowser });
