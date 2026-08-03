// ── Agent session — the shared interactive-session surface ────────────
// Chat transcript left (turns reveal progressively via SCN.sessionTurns),
// the living artifact right (staged via SCN.artifactStage for the
// contract-full build-outs).

function SessionArtifact({ kind, gen, setGen, go }) {
  const SCN = window.SCN || {};

  if (kind === 'roadmap') {
    return (
      <Panel title="Roadmap draft — betterado" pad={false}>
        <table className="ledger">
          <thead><tr><th>initiative</th><th>status</th><th>depends on</th></tr></thead>
          <tbody>
            {ROADMAPS.betterado.map(r => (
              <tr key={r.id}>
                <td><span className="t-main mono" style={{ fontSize: 12 }}>{r.id}</span><div className="t-sub">{r.name}</div></td>
                <td><span className="rm-status" data-s={r.status}>{r.status}</span></td>
                <td className="t-mono">{r.dep || '—'}</td>
              </tr>
            ))}
            <tr>
              <td><span className="t-main mono" style={{ fontSize: 12, color: 'var(--green)' }}>INIT-14a ✚</span><div className="t-sub">Service hooks CRUD (framework-native) + live-ADO beat</div></td>
              <td><span className="rm-status" data-s="pending">draft</span></td>
              <td className="t-mono">INIT-12</td>
            </tr>
            <tr>
              <td><span className="t-main mono" style={{ fontSize: 12, color: 'var(--green)' }}>INIT-14b ✚</span><div className="t-sub">Service hooks event routing + live-ADO beat</div></td>
              <td><span className="rm-status" data-s="pending">draft</span></td>
              <td className="t-mono">INIT-14a</td>
            </tr>
          </tbody>
        </table>
        <div className="row" style={{ padding: '10px 14px', borderTop: '1px solid var(--line)' }}>
          <span className="faint" style={{ fontSize: 11.5 }}>Visual aid attached: interactive mockup of the hooks consumer surface</span>
          <span className="spacer"></span>
          <span className="tpl-thumb" data-kind="mock" style={{ width: 84, height: 48, margin: 0 }}></span>
        </div>
      </Panel>
    );
  }

  if (kind === 'demo-gallery') {
    const gens = [
      { label: 'Gen 1 — raw clips', items: [{ k: 'video', n: 'journey beat 1', s: 'game loop, 22s' }, { k: 'video', n: 'journey beat 2', s: 'collision fix, 18s' }] },
      { label: 'Gen 2 — stats overlay', items: [{ k: 'video', n: 'beat 1 + overlay', s: 'score/fps strip' }, { k: 'video', n: 'beat 2 + overlay', s: 'score/fps strip' }] },
      { label: 'Gen 3 — clips + HTML summary', items: [{ k: 'video', n: 'beat clips ×2', s: 'overlay kept' }, { k: 'html', n: 'cycle summary page', s: 'clips + diff, one file' }] },
    ];
    const g = gens[gen];
    return (
      <Panel title={'Demo generations — trafficGame'} pad={false}>
        <div className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', gap: 4 }}>
          {gens.map((x, i) => (
            <button key={i} className={'btn btn-sm' + (i === gen ? ' btn-primary' : '')} onClick={() => setGen(i)}>Gen {i + 1}</button>
          ))}
          <span className="spacer"></span>
          <span className="faint" style={{ fontSize: 11 }}>{g.label}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 14 }}>
          {g.items.map((it, i) => (
            <div key={i}>
              <span className="tpl-thumb" data-kind={it.k} style={{ display: 'block', height: 110 }}></span>
              <div style={{ fontSize: 12.5, fontFamily: 'var(--font-display)', fontWeight: 600 }}>{it.n}</div>
              <div className="faint" style={{ fontSize: 11 }}>{it.s}</div>
            </div>
          ))}
        </div>
        <div className="row" style={{ padding: '0 14px 12px' }}>
          <span className="faint" style={{ fontSize: 11.5 }}>Built from templates:</span>
          <button className="btn btn-ghost btn-sm" onClick={() => go('library', 'templates', 'video-demo')}>video demo</button>
          <button className="btn btn-ghost btn-sm" onClick={() => go('library', 'templates', 'demo-html-summary')}>demo HTML summary</button>
        </div>
      </Panel>
    );
  }

  if (kind === 'contract-full') {
    const proj = (window.__sessionProject === 'blog') ? 'blog' : 'pulseboard';
    const stage = SCN.artifactStage || 'contract';
    if (stage === 'instructions') {
      return (
        <Panel title={'AGENTS.md — generated instructions (' + proj + ')'}>
          <div className="preview-block"><pre style={{ color: 'var(--text)' }}>{CONTRACT_STAGES.instructions[proj]}</pre></div>
          <p className="faint" style={{ fontSize: 11.5, margin: '8px 0 0' }}>
            The north star is the operator's own words — every agent working this repo reads this first.
          </p>
        </Panel>
      );
    }
    if (stage === 'secrets') {
      return (
        <Panel title="Secrets contract — names only, values stay local">
          {CONTRACT_STAGES.secrets[proj].map(s => (
            <div key={s.name} className="row" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
              <span className="mono" style={{ fontSize: 12.5, color: 'var(--steel)' }}>{s.name}</span>
              <span className="mono faint" style={{ fontSize: 11 }}>= ••••••••</span>
              <span className="spacer"></span>
              <span className={'badge ' + (s.req ? 'badge-agent' : 'badge-dim')}>{s.req ? 'required' : 'optional'}</span>
            </div>
          ))}
          <p className="faint" style={{ fontSize: 11.5, margin: '10px 0 0' }}>
            Declared in the contract, filled in the operator's local secrets.env — agents see names, never values.
          </p>
        </Panel>
      );
    }
    if (stage === 'demo') {
      return (
        <Panel title="Demo capability — seeded for this project shape">
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <span className="tpl-thumb" data-kind="shots" style={{ width: 150, height: 84, margin: 0 }}></span>
            <span className="tpl-thumb" data-kind="html" style={{ width: 150, height: 84, margin: 0 }}></span>
          </div>
          <ul className="readiness-list" style={{ marginTop: 12 }}>
            {['Evidence capture wired for this project shape', 'HTML summary per cycle', 'Demo-runner hooks into it automatically'].map((l, i) => (
              <li key={i} className="readiness-item ok"><span className="ri-dot"></span>{l}</li>
            ))}
          </ul>
        </Panel>
      );
    }
    if (stage === 'roadmap') {
      return (
        <Panel title="Starter roadmap — Architect hand-off" pad={false}>
          <table className="ledger">
            <thead><tr><th>initiative</th><th>acceptance signal</th></tr></thead>
            <tbody>
              {CONTRACT_STAGES.roadmap.map(r => (
                <tr key={r.id}>
                  <td><span className="t-main mono" style={{ fontSize: 12 }}>{r.id}</span><div className="t-sub">{r.name}</div></td>
                  <td className="t-sub" style={{ fontSize: 12 }}>{r.sig}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      );
    }
    const done = SCN.contractDone;
    return (
      <Panel title="Contract components">
        <ul className="readiness-list">
          {[
            { ok: true, label: 'Repo shape identified · gates discovered' },
            { ok: (SCN.stagesSeen || []).includes('instructions') || done, label: 'Instructions (AGENTS.md + north star)' },
            { ok: (SCN.stagesSeen || []).includes('secrets') || done, label: 'Secrets contract (names declared)' },
            { ok: (SCN.stagesSeen || []).includes('demo') || done, label: 'Demo capability' },
            { ok: (SCN.stagesSeen || []).includes('roadmap') || done, label: 'Roadmap staged for the Architect' },
            { ok: !!done, label: done ? 'Operator inputs provided — contract green' : 'Operator inputs — pending' },
          ].map((r, i) => (
            <li key={i} className={'readiness-item' + (r.ok ? ' ok' : '')}>
              <span className="ri-dot" style={r.ok ? undefined : { background: 'var(--amber)' }}></span>{r.label}
            </li>
          ))}
        </ul>
      </Panel>
    );
  }

  if (kind === 'hook-def') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FilePackage files={HOOK_FILES['stack-base-guard']} jprefix="hfile-tab-" />
        <Panel>
          <ul className="readiness-list">
            {[
              'A package: hook.yaml + the guard script it runs + replay evidence',
              'Host-agnostic: binds to any agent’s lifecycle, from its builder only',
              'Generic replay: would have fired once (a developer session, INIT-09)',
            ].map((l, i) => (
              <li key={i} className="readiness-item ok"><span className="ri-dot"></span>{l}</li>
            ))}
          </ul>
        </Panel>
      </div>
    );
  }

  if (kind === 'skill-def') {
    return <SkillPackageArtifact />;
  }

  if (kind === 'cleanup') {
    const fixed = SCN.kbFixed;
    return (
      <Panel title="Cleanup plan — develop-cycle">
        <ul className="readiness-list">
          {[
            { ok: true, label: 'Merge 3 near-duplicate theme pairs (gitpulse primaries)' },
            { ok: true, label: 'Relink 6 dangling edges' },
            { ok: true, label: 'Tag 12 themes “needs multi-project evidence”' },
            { ok: !!fixed, label: fixed ? 'Lint re-run: 9/9 green' : 'Re-run lint after merge' },
          ].map((r, i) => (
            <li key={i} className={'readiness-item' + (r.ok ? ' ok' : '')}>
              <span className="ri-dot" style={r.ok ? undefined : { background: 'var(--amber)' }}></span>{r.label}
            </li>
          ))}
        </ul>
        <p className="faint" style={{ fontSize: 11.5, margin: '10px 0 0' }}>
          Every mutation is a reviewed commit to the brain — the reflector's link+index pass runs after.
        </p>
      </Panel>
    );
  }

  // brain-seed
  return (
    <Panel title="Seeded structure">
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <span className="tpl-thumb" data-kind="brain" style={{ width: 130, height: 90, margin: 0 }}></span>
        <dl className="kv">
          <dt>themes</dt><dd>seeded from scope history</dd>
          <dt>index hubs</dt><dd>1</dd>
          <dt>links out</dt><dd>into develop-cycle patterns</dd>
          <dt>lint</dt><dd>9/9 green from day one</dd>
        </dl>
      </div>
    </Panel>
  );
}

// SKILL.md + supplementary files, tabbed (build-skill artifact)
function SkillPackageArtifact() {
  const files = SKILL_FILES['release-notes'];
  const [sel, setSel] = React.useState(0);
  return (
    <Panel title="Skill package — release-notes/" pad={false}>
      <div className="file-tabs">
        {files.map((f, i) => (
          <button key={f.path} data-j={'file-tab-' + i} className={'file-tab' + (i === sel ? ' active' : '')} onClick={() => setSel(i)}>
            {f.path}
          </button>
        ))}
      </div>
      <div className="preview-block" style={{ border: 'none', borderRadius: 0 }}>
        <pre style={{ color: 'var(--text)' }}>{files[sel].body}</pre>
      </div>
      <div className="row" style={{ padding: '10px 14px', borderTop: '1px solid var(--line)' }}>
        <span className="faint" style={{ fontSize: 11.5 }}>
          One package on disk: intent (SKILL.md) + the scripts and templates it references. Unbound until an agent carries it.
        </span>
      </div>
    </Panel>
  );
}

function AgentSession({ agentId, go, toast }) {
  const session = SESSIONS[agentId];
  const agent = AGENTS.find(a => a.id === agentId)
    || (agentId === 'brain-creation-cycle' ? AGENTS.find(a => a.id === 'brain-creation') : null)
    || { id: agentId, name: (session && session.agentName) || 'Agent', provenance: 'ootb' };
  const [gen, setGen] = React.useState(2);

  if (!session) {
    return (
      <div className="page">
        <Empty text={agent.name + ' is not an interactive agent.'} hint="Sessions exist for the interactive agents: Architect/Planning, Demo Builder, Project Onboarding, Brain Creation and the creation/maintenance agents." />
      </div>
    );
  }

  // progressive back-and-forth: journeys reveal turns one at a time
  const SCN = window.SCN || {};
  const shownCount = SCN.sessionTurns != null ? Math.min(SCN.sessionTurns, session.turns.length) : session.turns.length;
  const visibleTurns = session.turns.slice(0, shownCount);
  window.__sessionProject = agentId === 'project-onboarding' ? 'blog' : 'pulseboard';

  return (
    <div className="page">
      <PageHead
        eyebrow="agent session" color="var(--c-agent)"
        title={session.title}
        lede={'A live back-and-forth with the ' + agent.name + ' agent. The artifact it is producing evolves on the right as the conversation moves.'}
        actions={
          <React.Fragment>
            <StatusPair status="active" />
            {AGENTS.some(a => a.id === agent.id)
              ? <button className="btn btn-sm" onClick={() => go('agents', 'builder', agent.id)}>Agent spec →</button>
              : null}
            <button className="btn btn-primary btn-sm" data-j="accept-btn"
              onClick={() => toast('Accepted (mock) — the artifact lands in its home and the session closes out')}>
              Accept &amp; commit
            </button>
          </React.Fragment>
        }
      />
      <div className="session">
        <Panel title="Session" pad={false}>
          <div className="chat">
            {visibleTurns.map((t, i) => (
              <div key={i} className={'msg ' + t.who}>
                <span className="who">{t.who === 'agent' ? agent.name : 'operator'}</span>
                {t.text}
              </div>
            ))}
            {shownCount < session.turns.length ? (
              <div className="msg agent" style={{ opacity: .55, fontStyle: 'italic' }}>
                <span className="who">{agent.name}</span>typing…
              </div>
            ) : null}
          </div>
          <div className="chat-input">
            <input className="input" placeholder="Reply… (session is mocked)" readOnly onClick={() => toast('The conversation is mocked in this prototype')} />
            <button className="btn" onClick={() => toast('The conversation is mocked in this prototype')}>Send</button>
          </div>
        </Panel>
        <div style={{ position: 'sticky', top: 'calc(var(--nav-h) + var(--subnav-h) + 16px)' }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="field-label" style={{ margin: 0 }}>{session.artifactLabel}</span>
            <span className="spacer"></span>
            <span className="badge badge-artifact">artifact</span>
          </div>
          <SessionArtifact kind={session.artifact} gen={gen} setGen={setGen} go={go} />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AgentSession });
