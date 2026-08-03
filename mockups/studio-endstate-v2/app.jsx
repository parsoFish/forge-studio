// ── App shell: hash router + scenario store + journey player mount ────
// Route shape: #/<section>/<view>/<id>  e.g. #/flows/monitor/forge-develop
// Journeys: load with ?journey=<id> (query survives hash navigation) —
// the player drives the app with a scripted cursor + captions and mutates
// the scenario store (window.SCN) so state visibly progresses.

function parseHash() {
  const parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  return { section: parts[0] || 'home', view: parts[1] || null, id: parts[2] || null };
}

function App() {
  const [route, setRoute] = React.useState(parseHash());
  const [toasts, setToasts] = React.useState([]);
  const [scn, setScn] = React.useState({});
  window.SCN = scn;
  window.setSCN = patch => setScn(s => ({ ...s, ...patch }));

  React.useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (section, view, id) => {
    location.hash = '/' + [section, view, id].filter(Boolean).join('/');
    window.scrollTo(0, 0);
  };

  const toast = msg => {
    const id = msg.length + '-' + (window.__tid = (window.__tid || 0) + 1);
    setToasts(t => [...t, { id, msg }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3400);
  };

  const { section } = route;
  const view = route.view;
  const id = route.id;

  let subnav = null;
  if (section === 'flows') {
    subnav = (
      <SubNav color="var(--c-flow)" label="Flows"
        items={[{ id: 'home', label: 'Flows Home' }, { id: 'builder', label: 'Flow Builder' }, { id: 'monitor', label: 'Flow Monitor' }]}
        active={view || 'home'} onPick={v => go('flows', v === 'home' ? null : v)} />
    );
  } else if (section === 'agents') {
    subnav = (
      <SubNav color="var(--c-agent)" label="Agents"
        items={[{ id: 'home', label: 'Agent Home' }, { id: 'builder', label: 'Agent Builder' }, { id: 'monitor', label: 'Agent Monitor' }]}
        active={view || 'home'} onPick={v => go('agents', v === 'home' ? null : v)} />
    );
  } else if (section === 'library') {
    subnav = (
      <SubNav color="var(--violet)" label="Library"
        items={[{ id: 'home', label: 'Library Home' }, { id: 'skills', label: 'Skills' }, { id: 'hooks', label: 'Hooks' }, { id: 'connections', label: 'External connections' }, { id: 'templates', label: 'Templates' }, { id: 'community', label: 'Community' }]}
        active={view || 'home'} onPick={v => go('library', v === 'home' ? null : v)} />
    );
  }

  let body = null;
  if (section === 'home') body = <HomeView go={go} toast={toast} />;
  else if (section === 'flows') {
    if (view === 'builder') body = <FlowBuilder key={id || 'none'} flowId={id} go={go} toast={toast} />;
    else if (view === 'monitor') body = <FlowMonitor key={id || 'none'} flowId={id} go={go} />;
    else if (view === 'run') body = <RunDetail key={id} runKey={id} go={go} toast={toast} />;
    else if (view === 'kickoff') body = <FlowKickoff key={id} flowId={id} go={go} />;
    else body = <FlowsHome go={go} />;
  } else if (section === 'agents') {
    if (view === 'builder') body = <AgentBuilder key={id || 'new'} agentId={id} go={go} toast={toast} />;
    else if (view === 'monitor') body = <AgentMonitor key={id || 'none'} agentId={id} go={go} />;
    else if (view === 'session') body = <AgentSession key={id} agentId={id} go={go} toast={toast} />;
    else if (view === 'kickoff') body = <AgentKickoff key={id} agentId={id} go={go} />;
    else if (view === 'run') body = <AgentRun key={id} agentId={id} go={go} toast={toast} />;
    else body = <AgentsHome go={go} />;
  } else if (section === 'projects') {
    if (view === 'detail' && id) body = <ProjectDetail key={id} projectId={id} go={go} toast={toast} />;
    else if (view === 'create') body = <ProjectCreate go={go} />;
    else if (view === 'showcase' && id) body = <DemoShowcase key={id} projectId={id} go={go} toast={toast} />;
    else body = <ProjectsView go={go} />;
  } else if (section === 'library') {
    if (view === 'citem' && id) {
      body = <CommunityItemDetail key={id} itemId={id} go={go} toast={toast} />;
    }
    else if ((view === 'skills' || view === 'hooks' || view === 'connections' || view === 'templates') && id) {
      body = <LibraryObjectDetail key={view + id} kind={view} objId={id} go={go} toast={toast} />;
    }
    else if (view === 'skills' || view === 'hooks') body = <LibraryShelf key={view} kind={view} go={go} toast={toast} />;
    else if (view === 'connections') body = <ConnectionsView go={go} toast={toast} />;
    else if (view === 'templates') body = <TemplatesShelf go={go} />;
    else if (view === 'community') body = <CommunityBrowser go={go} toast={toast} />;
    else body = <LibraryHome go={go} />;
  } else if (section === 'knowledge') {
    body = <KnowledgeView key={(view || 'list') + (id || '')} view={view || 'list'} selectedId={id} go={go} toast={toast} />;
  }

  const journeyId = new URLSearchParams(location.search).get('journey');

  return (
    <React.Fragment>
      <TopNav section={section} onNav={s => go(s)} />
      {subnav}
      {body}
      <div className="toast-host">
        {toasts.map(t => <div key={t.id} className="toast">{t.msg}</div>)}
      </div>
      {journeyId ? <JourneyPlayer journeyId={journeyId} go={go} /> : null}
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
