// ── Library depth: templates shelf + rich detail for EVERY component ──
// Each kind gets an operator-consumable detail page: what it is, its
// files (skills/hooks are packages), source hub + backing repo links,
// kind-appropriate depth (MCPs: capabilities, not the whole repo),
// used-by, versions — and for hooks, a security scan (known attack
// surface). Community items get the same page pre-install.

function TemplatesShelf({ go }) {
  const cats = ['demo output', 'planning', 'project type'];
  return (
    <div className="page">
      <PageHead
        eyebrow="library / templates" color="var(--c-artifact)"
        title="Templates"
        lede="Input and output artifacts as library objects: demo formats, planning documents, and whole project scaffolds. Agents consume them in the builder the same way they consume skills."
        actions={<button className="btn btn-primary" onClick={() => go('agents', 'session', 'demo-builder')}>+ Author a template</button>}
      />
      {cats.map(cat => {
        const items = TEMPLATES.filter(t => t.cat === cat);
        return (
          <React.Fragment key={cat}>
            <SectionTitle count={items.length}>{cat === 'demo output' ? 'Demo outputs — how change gets shown' : cat === 'planning' ? 'Planning artifacts' : 'Project types — scaffolds for new projects'}</SectionTitle>
            <div className="card-grid">
              {items.map(t => (
                <button key={t.id} className="obj-card" data-type="artifact" onClick={() => go('library', 'templates', t.id)}>
                  <span className="tpl-thumb" data-kind={t.preview}></span>
                  <div className="card-top" style={{ marginBottom: 6 }}>
                    <span className="card-name">{t.name}</span>
                    <ProvenanceBadge provenance={t.provenance} />
                  </div>
                  <p className="card-desc">{t.desc}</p>
                  <div className="card-meta">
                    <span className="card-stat">{t.format}</span>
                    <span className="card-stat">{t.usedBy.length} agents</span>
                  </div>
                </button>
              ))}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// shared file-package viewer (skills + hooks)
function FilePackage({ files, jprefix }) {
  const [sel, setSel] = React.useState(0);
  return (
    <Panel title="Package files" pad={false}>
      <div className="file-tabs">
        {files.map((f, i) => (
          <button key={f.path} data-j={(jprefix || 'file-tab-') + i} className={'file-tab' + (i === sel ? ' active' : '')} onClick={() => setSel(i)}>
            {f.path}
          </button>
        ))}
      </div>
      <div className="preview-block" style={{ border: 'none', borderRadius: 0 }}>
        <pre style={{ color: 'var(--text)' }}>{files[sel].body}</pre>
      </div>
    </Panel>
  );
}

function SourceLinks({ id, hubName }) {
  const src = LIB_SOURCE[id];
  return (
    <Panel title="Source">
      <dl className="kv">
        {hubName ? <React.Fragment><dt>community hub</dt><dd><a href="#" onClick={e => e.preventDefault()}>{hubName}</a></dd></React.Fragment> : <React.Fragment><dt>origin</dt><dd>local — authored in forge</dd></React.Fragment>}
        {src && src.gh ? <React.Fragment><dt>backing repo</dt><dd><a href="#" onClick={e => e.preventDefault()}>{src.gh}</a></dd></React.Fragment> : null}
        <dt>license check</dt><dd className="scan-verdict">✓ permissive</dd>
      </dl>
    </Panel>
  );
}

function UsedByPanel({ ids, go, kindKey }) {
  const usedBy = AGENTS.filter(a => (a[kindKey] || []).some(x => ids.includes(x)));
  return (
    <Panel title="Used by">
      {usedBy.length ? (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {usedBy.map(a => (
            <button key={a.id} className="btn btn-sm" onClick={() => go('agents', 'builder', a.id)}>⬢ {a.name}</button>
          ))}
        </div>
      ) : <span className="faint" style={{ fontSize: 12.5, fontStyle: 'italic' }}>Unbound — add it from an agent's builder.</span>}
    </Panel>
  );
}

function VersionsPanel() {
  return (
    <Panel title="Version history" pad={false}>
      <Ledger rows={[
        { when: '6d ago', what: 'v3 — current', sub: 'revised after the INIT-10 demo-gap finding', status: 'complete', cost: '' },
        { when: '4w ago', what: 'v2', sub: 'operator edit — tightened output contract', status: 'complete', cost: '' },
        { when: '8w ago', what: 'v1', sub: 'initial authoring', status: 'complete', cost: '' },
      ]} />
    </Panel>
  );
}

function HookScanPanel() {
  const s = SECURITY_SCANS.hook;
  return (
    <Panel title="Security scan — hooks run inside agent sessions" pad={false}>
      <div className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
        <span className="scan-verdict">✓ {s.verdict}</span>
        <span className="spacer"></span>
        <span className="mono faint" style={{ fontSize: 10.5 }}>last scanned {s.last}</span>
      </div>
      <ul className="readiness-list" style={{ padding: '10px 14px' }}>
        {s.checks.map((c, i) => <li key={i} className="readiness-item ok"><span className="ri-dot"></span>{c}</li>)}
      </ul>
      <p className="faint" style={{ fontSize: 11, padding: '0 14px 12px', margin: 0 }}>
        Hooks are the known attack surface — every install and edit re-scans the guard script.
      </p>
    </Panel>
  );
}

// generic detail surface shared by all library kinds
function LibraryObjectDetail({ kind, objId, go, toast }) {
  let obj, eyebrow, color, facts = [], files = null, hubName = null, scan = false, usedKey = null, preview = null;

  if (kind === 'skills') {
    obj = SKILLS_LOCAL.find(s => s.id === objId) || SKILLS_COMMUNITY.find(s => s.id === objId)
      || ((window.SCN || {}).builtSkill && objId === 'release-notes' ? EXTRA.builtSkill : null);
    eyebrow = 'library / skills'; color = 'var(--violet)'; usedKey = 'skills';
    if (obj) {
      hubName = (COMMUNITY.find(c => c.name === obj.name) || {}).hub || null;
      facts = [['kind', 'skill — invocable capability'], ['binding', 'agent or project, explicit, from their pages']];
      files = SKILL_FILES[obj.id] || [{ path: 'SKILL.md', body: '---\nname: ' + obj.id + '\ndescription: ' + obj.desc + '\n---\n\n# ' + obj.name + '\n\nInvoke when… (single source of intent\nfor this capability).' }];
    }
  } else if (kind === 'hooks') {
    obj = HOOKS_LOCAL.find(h => h.id === objId) || HOOKS_COMMUNITY.find(h => h.id === objId)
      || ((window.SCN || {}).builtHook && objId === 'stack-base-guard' ? EXTRA.builtHook : null);
    eyebrow = 'library / hooks'; color = 'var(--red)'; usedKey = 'hooks'; scan = true;
    if (obj) {
      hubName = (COMMUNITY.find(c => c.name === obj.name) || {}).hub || null;
      facts = [['kind', 'hook — lifecycle customisation'], ['event', obj.on || 'lifecycle event'], ['binding', 'agents only, from the Agent Builder']];
      files = HOOK_FILES[obj.id] || [{ path: 'hook.yaml', body: 'hook: ' + obj.id + '\nevent: ' + (obj.on || 'event') + '\nrun: |\n  # guarded action — exits non-zero to block\nhost: generic' }];
    }
  } else if (kind === 'connections') {
    obj = CONNECTIONS.mcps.find(c => c.id === objId) || CONNECTIONS.clis.find(c => c.id === objId) || CONNECTIONS.tools.find(c => c.id === objId);
    eyebrow = 'library / external connections'; color = 'var(--steel)'; usedKey = 'mcps';
    if (obj) {
      const src = LIB_SOURCE[obj.id] || {};
      const isMcp = CONNECTIONS.mcps.some(c => c.id === objId);
      facts = [
        ['kind', isMcp ? 'MCP server' : 'CLI / tool'],
        ['health', obj.status],
        isMcp && src.transport ? ['transport', src.transport] : null,
        ['auth', 'operator-scoped'],
      ].filter(Boolean);
      preview = isMcp && src.capabilities
        ? { title: 'Capabilities exposed to agents', body: src.capabilities.map(c => '· ' + c).join('\n') + '\n\n(kind-appropriate detail — the full server\nrepo lives at the backing link, not here)' }
        : src.commands
          ? { title: 'Common commands', body: src.commands.map(c => '$ ' + c).join('\n') }
          : { title: 'Definition', body: (isMcp ? 'mcp: ' : 'tool: ') + obj.id + '\nhealthcheck: passing\npermissions: allowlisted per agent' };
    }
  } else if (kind === 'templates') {
    obj = TEMPLATES.find(t => t.id === objId);
    eyebrow = 'library / templates'; color = 'var(--c-artifact)';
    if (obj) {
      facts = [['category', obj.cat], ['format', obj.format], ['direction', obj.cat === 'planning' ? 'in + out' : 'output']];
      preview = { title: 'Slots', body: 'template: ' + obj.id + '\nslots:\n  - title\n  - evidence[]\n  - diff-link\nrender: self-contained' };
    }
  }

  if (!obj) {
    return <div className="page"><Empty text="Object not found." /></div>;
  }

  return (
    <div className="page">
      <PageHead
        eyebrow={eyebrow} color={color}
        title={obj.name}
        lede={obj.desc}
        actions={
          <React.Fragment>
            {obj.provenance ? <ProvenanceBadge provenance={obj.provenance} /> :
              hubName ? <span className="badge badge-community">community</span> : null}
            <button className="btn btn-sm" onClick={() => go('library', kind)}>← All {kind}</button>
            <button className="btn btn-primary btn-sm" onClick={() => toast('Edit session is mocked — library objects are authored and revised by their builder agents')}>Edit</button>
          </React.Fragment>
        }
      />

      <div className="two-col">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {kind === 'templates' && obj.preview ? (
            <Panel title="Preview">
              <span className="tpl-thumb" data-kind={obj.preview} style={{ display: 'block', height: 180 }}></span>
            </Panel>
          ) : null}
          <Panel title="Facts">
            <dl className="kv">
              {facts.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
            </dl>
          </Panel>
          <SourceLinks id={objId} hubName={hubName} />
          {usedKey ? <UsedByPanel ids={[obj.id, obj.name]} go={go} kindKey={usedKey} /> :
            obj.usedBy ? (
              <Panel title="Used by">
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {AGENTS.filter(a => obj.usedBy.includes(a.id)).map(a => (
                    <button key={a.id} className="btn btn-sm" onClick={() => go('agents', 'builder', a.id)}>⬢ {a.name}</button>
                  ))}
                </div>
              </Panel>
            ) : null}
          {scan ? <HookScanPanel /> : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {files ? <FilePackage files={files} /> : null}
          {preview ? (
            <Panel title={preview.title}>
              <div className="preview-block"><pre style={{ color: 'var(--text)' }}>{preview.body}</pre></div>
            </Panel>
          ) : null}
          <VersionsPanel />
        </div>
      </div>
    </div>
  );
}

// community item detail — same consumable page, pre-install
function CommunityItemDetail({ itemId, go, toast }) {
  const c = COMMUNITY.find(x => x.id === itemId);
  if (!c) return <div className="page"><Empty text="Community item not found." /></div>;
  const src = LIB_SOURCE[c.id] || {};
  const SCN = window.SCN || {};
  const state = SCN['inst_' + c.id];
  const install = () => {
    window.setSCN({ ['inst_' + c.id]: 'installing' });
    setTimeout(() => window.setSCN({ ['inst_' + c.id]: 'installed' }), 900);
  };
  return (
    <div className="page">
      <PageHead
        eyebrow={'community / ' + c.kind} color="var(--violet)"
        title={c.name}
        lede={c.desc}
        actions={
          <React.Fragment>
            <span className="badge badge-community">community</span>
            <button className="btn btn-sm" onClick={() => go('library', 'community')}>← Browser</button>
            <button className="btn btn-primary btn-sm install-btn" data-j="citem-install" data-state={state || 'none'}
              onClick={() => { if (!state) install(); }}>
              {state === 'installed' ? '✓ Installed' : state === 'installing' ? 'Installing…' : 'Install'}
            </button>
          </React.Fragment>
        }
      />
      <div className="two-col">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Panel title="Hub signals">
            <dl className="kv">
              <dt>hub</dt><dd><a href="#" onClick={e => e.preventDefault()}>{c.hub}</a></dd>
              <dt>stars</dt><dd>★ {c.stars}</dd>
              <dt>installs</dt><dd>⬇ {c.dl}</dd>
              <dt>usage</dt><dd>{c.usage}</dd>
              {src.gh ? <React.Fragment><dt>backing repo</dt><dd><a href="#" onClick={e => e.preventDefault()}>{src.gh}</a></dd></React.Fragment> : null}
            </dl>
          </Panel>
          {c.kind === 'hook' ? <HookScanPanel /> : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {c.kind === 'mcp' && src.capabilities ? (
            <Panel title="Capabilities exposed to agents">
              <div className="preview-block"><pre style={{ color: 'var(--text)' }}>{src.capabilities.map(x => '· ' + x).join('\n') + '\n\ntransport: ' + (src.transport || '—') + '\n\n(kind-appropriate detail — the full server\nrepo lives at the backing link, not here)'}</pre></div>
            </Panel>
          ) : c.kind === 'cli' && src.commands ? (
            <Panel title="Common commands">
              <div className="preview-block"><pre style={{ color: 'var(--text)' }}>{src.commands.map(x => '$ ' + x).join('\n')}</pre></div>
            </Panel>
          ) : c.kind === 'skill' ? (
            <Panel title="SKILL.md (from the hub)">
              <div className="preview-block"><pre style={{ color: 'var(--text)' }}>{'---\nname: ' + c.name + '\ndescription: ' + c.desc + '\n---\n(full package pulled on install; files\nbecome browsable like any local skill)'}</pre></div>
            </Panel>
          ) : c.kind === 'hook' ? (
            <Panel title="hook.yaml (from the hub)">
              <div className="preview-block"><pre style={{ color: 'var(--text)' }}>{'hook: ' + c.name + '\nevent: ' + (c.usage || 'lifecycle event') + '\nhost: generic — bind from Agent Builder'}</pre></div>
            </Panel>
          ) : null}
          <Panel title="On install">
            <ul className="readiness-list">
              {['Copied into the local library, provenance kept', 'Version pinned — updates are diffed before applying', c.kind === 'hook' ? 'Security scan runs before first bind' : 'Available in every builder catalog'].map((l, i) => (
                <li key={i} className="readiness-item ok"><span className="ri-dot"></span>{l}</li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { TemplatesShelf, LibraryObjectDetail, CommunityItemDetail, FilePackage, HookScanPanel });
