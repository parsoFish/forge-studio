// ── Demo showcase — the rendered demo artifact for a project ──────────
// What the demo-runner's HTML-summary template produces: change, evidence
// inline, all greppable. Journeys end here to show the payoff.

function DemoShowcase({ projectId, go, toast }) {
  const sc = SHOWCASE[projectId] || SHOWCASE.betterado;
  return (
    <div className="page">
      <div className="showcase">
        <div className="row" style={{ marginBottom: 14 }}>
          <button className="btn btn-sm" onClick={() => go('projects', 'detail', projectId)}>← {sc.project}</button>
          <span className="spacer"></span>
          <span className="badge badge-artifact">demo artifact</span>
          <span className="card-stat">demo HTML summary · rendered</span>
        </div>
        <div className="showcase-doc" data-j="showcase-doc">
          <div className="showcase-head">
            <div className="eyebrow" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 6 }}>
              {sc.project} · demo evidence
            </div>
            <h1 style={{ fontSize: 22 }}>{sc.cycle}</h1>
            <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              {sc.stats.map((s, i) => <span key={i} className="card-stat" style={{ color: 'var(--green)' }}>{s}</span>)}
            </div>
          </div>
          <div className="showcase-body">
            <div>
              <span className="field-label">Live verification</span>
              <div className="preview-block"><pre style={{ color: 'var(--text)' }}>{sc.api}</pre></div>
            </div>
            <div>
              <span className="field-label">Visual evidence</span>
              <div className="showcase-evidence">
                {sc.evidence.map((e, i) => (
                  <button key={i} className="obj-card" data-type="artifact" style={{ padding: 12 }}
                    onClick={() => toast('Full-size evidence viewer is mocked')}>
                    <span className="tpl-thumb" data-kind={e.kind} style={{ height: 96, marginBottom: 8 }}></span>
                    <span style={{ fontSize: 12.5, fontFamily: 'var(--font-display)', fontWeight: 600 }}>{e.name}</span>
                    <span className="faint" style={{ fontSize: 11 }}>{e.sub}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="faint" style={{ fontSize: 11.5, margin: 0 }}>
              Produced by the Demo Runner from this project's demo skill, using the
              {' '}<a href="#" onClick={e => { e.preventDefault(); go('library', 'templates', 'demo-html-summary'); }}>demo HTML summary</a> template.
              Every element is greppable — this page is also the review artifact the adversarial reviewer verifies against live state.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DemoShowcase });
