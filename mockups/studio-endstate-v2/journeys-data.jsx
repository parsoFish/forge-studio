// ── The 15 north-star journeys, as data ───────────────────────────────
// Step: { cap, goto?, click?, hover?, type?:[sel,text], select?:[sel,val],
//         drag?:[sel,dx,dy], patch?, ms? }

const JOURNEYS = {

  'onboard-project': {
    title: 'Onboard an existing project',
    steps: [
      { cap: 'Start on Home — the whole fleet at a glance.', goto: '#/home', ms: 2600 },
      { cap: 'Projects: the managed portfolio plus the OOTB demo test bed.', click: '[data-j=nav-projects]', ms: 2600 },
      { cap: 'Onboarding is an agent-led session, not a form.', click: '[data-j=onboard-btn]', patch: { sessionTurns: 1 }, ms: 3200 },
      { cap: 'The agent has scanned the repo — the interview starts from what “working” means to you.', patch: { sessionTurns: 2 }, ms: 3000 },
      { cap: 'Your answer becomes the north star — verbatim — in the generated AGENTS.md.', patch: { sessionTurns: 3, artifactStage: 'instructions', stagesSeen: ['instructions'] }, ms: 3600 },
      { cap: 'You push back, it folds in. Instructions are a conversation, not a template.', patch: { sessionTurns: 4 }, ms: 2800 },
      { cap: 'Secrets declared by NAME — values never leave your local secrets.env.', patch: { sessionTurns: 5, artifactStage: 'secrets', stagesSeen: ['instructions', 'secrets'] }, ms: 3400 },
      { cap: 'Demo capability, shaped to the project: build-preview screenshots + link-check transcript.', patch: { sessionTurns: 7, artifactStage: 'demo', stagesSeen: ['instructions', 'secrets', 'demo'] }, ms: 3400 },
      { cap: 'One operator input left — provide it and every contract component goes green.', patch: { sessionTurns: 9, artifactStage: 'contract', contractDone: true, stagesSeen: ['instructions', 'secrets', 'demo', 'roadmap'] }, ms: 3200 },
      { cap: 'Accept & commit — the artifacts land in the repo.', click: '[data-j=accept-btn]', ms: 2400 },
      { cap: 'blog is now a managed project, contract green.', patch: { onboardDone: true }, click: '[data-j=nav-projects]', ms: 2800 },
      { cap: 'Its full surface — and everything from the session is HERE:', click: '[data-j=project-blog]', ms: 2800 },
      { cap: 'North star verbatim, conventions, gates, secret names — on the project page for good.', hover: '[data-j=contract-panel]', ms: 3600 },
      { cap: 'The roadmap has its own tab — room to grow to a full page.', click: '[data-j=ptab-roadmap]', ms: 2800 },
      { cap: 'The starter roadmap, visualised as a dependency DAG.', hover: '[data-j=roadmap-dag]', ms: 3400 },
      { cap: 'And its first demo artifact — evidence, not claims.', click: '[data-j=showcase-btn]', ms: 3400 },
      { cap: 'Repo to contract-green with a demo, in one session.', ms: 2800 },
    ],
  },

  'create-project': {
    title: 'Create a new project',
    steps: [
      { cap: 'Creation is scaffold-first: project types ship already conforming to the contract.', goto: '#/projects', ms: 2800 },
      { cap: 'Create new project.', click: '[data-j=create-project-btn]', ms: 2600 },
      { cap: 'Pick the web-UI scaffold — journey harness and e2e gate included.', click: '[data-j=scaffold-scaffold-web-ui]', ms: 2800 },
      { cap: 'Name it.', type: ['[data-j=project-name]', 'pulseboard'], ms: 2200 },
      { cap: 'The creation agent takes it from there — starting with your north star.', click: '[data-j=start-creation]', patch: { sessionTurns: 2 }, ms: 3200 },
      { cap: 'North star + conventions → generated AGENTS.md. Every agent on this repo reads it first.', patch: { sessionTurns: 3, artifactStage: 'instructions', stagesSeen: ['instructions'] }, ms: 3600 },
      { cap: 'Your rules fold in: never commit to main, charts dependency-free.', patch: { sessionTurns: 4 }, ms: 2800 },
      { cap: 'Secrets contract: names declared, values stay in your local secrets.env.', patch: { sessionTurns: 5, artifactStage: 'secrets', stagesSeen: ['instructions', 'secrets'] }, ms: 3400 },
      { cap: 'Demo capability comes with the scaffold: journey screenshots + HTML summary per cycle.', patch: { sessionTurns: 7, artifactStage: 'demo', stagesSeen: ['instructions', 'secrets', 'demo'] }, ms: 3400 },
      { cap: 'And a starter roadmap through the Architect templates — 4 initiatives with acceptance signals.', patch: { sessionTurns: 9, artifactStage: 'roadmap', stagesSeen: ['instructions', 'secrets', 'demo', 'roadmap'] }, ms: 3600 },
      { cap: 'Every contract component green.', patch: { sessionTurns: 11, artifactStage: 'contract', contractDone: true }, ms: 3000 },
      { cap: 'Accept & commit.', click: '[data-j=accept-btn]', ms: 2400 },
      { cap: 'pulseboard joins the portfolio.', patch: { newProject: true }, click: '[data-j=nav-projects]', ms: 2800 },
      { cap: 'Its project page carries all of it:', click: '[data-j=project-pulseboard]', ms: 2800 },
      { cap: 'North star, conventions, gates, secret names — generated in the session, living here.', hover: '[data-j=contract-panel]', ms: 3600 },
      { cap: 'The roadmap tab — its own full page as the DAG grows.', click: '[data-j=ptab-roadmap]', ms: 2800 },
      { cap: 'The 4-initiative starter DAG — the Architect grows it from here.', hover: '[data-j=roadmap-dag]', ms: 3400 },
      { cap: 'Even the scaffold ships demo evidence — the journey-harness baseline.', click: '[data-j=showcase-btn]', ms: 3400 },
      { cap: 'A new project, demo-ready, before writing a line of code.', ms: 2800 },
    ],
  },

  'create-agent': {
    title: 'Create a new agent',
    steps: [
      { cap: 'Agents home — the OOTB eight, plus yours.', goto: '#/agents', ms: 2600 },
      { cap: 'New agent.', click: '[data-j=new-agent-btn]', ms: 2600 },
      { cap: 'A new agent starts from a curated starter — Studio ships no agent-authoring agent.', hover: '[data-j=starter-issue-triage]', ms: 2600 },
      { cap: 'Pick one (or blank); its zones land ready to refine directly.', click: '[data-j=starter-issue-triage]', ms: 3200 },
      { cap: 'Instructions come drafted too — the agent’s single source of intent.', hover: '[data-j=agent-instructions]', ms: 3400 },
      { cap: 'Refine the zones directly — click or drag any catalog chip in.', click: '[data-j=cat-security-review]', ms: 2800 },
      { cap: 'It lands in the matching zone; the spec preview updates live.', hover: '[data-j=zone-skills]', ms: 2800 },
      { cap: 'Allowed input materials: what runs of this agent may attach.', hover: '[data-j=materials-config]', ms: 3000 },
      { cap: 'Save — the spec round-trips to studio/agents/.', click: '[data-j=save-agent]', ms: 2600 },
      { cap: 'issue-triage joins the fleet.', click: '[data-j=sub-home]', ms: 2600 },
      { cap: 'Standalone-runnable now — the run-agent journey shows exactly what its output looks like.', hover: '[data-j=agent-issue-triage]', ms: 3400 },
    ],
  },

  'edit-agent': {
    title: 'Edit an agent',
    steps: [
      { cap: 'The builder edits any agent — pick one from the selector.', goto: '#/agents/builder/new', ms: 2800 },
      { cap: 'The Developer: ralph loop, fanout ×4.', select: ['[data-j=agent-select]', 'developer'], ms: 3000 },
      { cap: 'Drag security-review in from the catalog — or just click it…', click: '[data-j=cat-security-review]', ms: 2800 },
      { cap: '…it lands in Skills, and the spec marks itself unsaved.', hover: '[data-j=zone-skills]', ms: 2800 },
      { cap: 'Regenerate the instructions from the updated spec.', click: '[data-j=gen-instructions]', ms: 3200 },
      { cap: 'Save. The next dev-loop run carries the new skill and instructions.', click: '[data-j=save-agent]', ms: 2800 },
      { cap: 'Edit is the same surface as create — zones and instructions ARE the spec.', ms: 2800 },
    ],
  },

  'create-flow': {
    title: 'Create a new agent flow',
    steps: [
      { cap: 'Flows home — forge-develop ships out of the box.', goto: '#/flows', ms: 2600 },
      { cap: 'A new flow starts as an empty canvas.', click: '[data-j=new-flow-btn]', ms: 2600 },
      { cap: 'Name it.', type: ['[data-j=flow-name]', 'deps-refresh'], ms: 2200 },
      { cap: 'Click — or drag — the Developer onto the canvas.', click: '[data-j=fcat-developer]', ms: 2800 },
      { cap: 'Enable fan-out: parallel worktrees, one per work item.', click: '[data-j=fanout-btn]', ms: 3000 },
      { cap: 'Demo Runner follows — evidence for every change.', click: '[data-j=fcat-demo-runner]', ms: 2800 },
      { cap: 'Type the hand-off: what this node passes to the next, as a library template.', select: ['[data-j=artifact-select]', 'demo HTML summary'], ms: 3200 },
      { cap: 'Close with a user gate — the flow pauses for the operator.', click: '[data-j=fcat-verdict]', ms: 3000 },
      { cap: 'Hex agents, fan-out, hand-off artifact and gate — all on the lane.', hover: '.hexnode-frame[data-sel="true"]', ms: 3200 },
      { cap: 'Save as deps-refresh.', click: '[data-j=save-flow]', ms: 2400 },
      { cap: 'It joins the shelf beside forge-develop — same builder, same monitor.', click: '[data-j=sub-home]', ms: 3200 },
    ],
  },

  'edit-flow': {
    title: 'Edit an agent flow — parallel branches',
    steps: [
      { cap: 'forge-develop — the OOTB development flow, a single line of hexes today.', goto: '#/flows', ms: 2800 },
      { cap: 'Open it in the builder.', click: '[data-j=flow-forge-develop]', ms: 2800 },
      { cap: 'Select the intake node — we’ll fork the path right after it.', click: '[data-j=node-intake]', ms: 2800 },
      { cap: 'Arm a branch: what’s added next runs IN PARALLEL, before the Developer.', click: '[data-j=branch-btn]', ms: 3000 },
      { cap: 'Demo Design — authors the demo scripts that will showcase the initiative.', click: '[data-j=fcat-demo-design]', ms: 3000 },
      { cap: 'Research — sources prior art and implementation detail. Same column: parallel.', click: '[data-j=fcat-research]', ms: 3200 },
      { cap: 'The Developer is now a JOIN — it waits for BOTH inputs before it starts.', click: '[data-j=node-dev]', ms: 3400 },
      { cap: 'Its inputs are typed: demo scripts + sourced brief, from the parallel column.', hover: '[data-j=artifact-select]', ms: 3400 },
      { cap: 'Band rule: plan/develop can hold any number of lines — review and reflect take ONE. Branches merge back before them.', ms: 3800 },
      { cap: 'Save — the topology change applies from the next run.', click: '[data-j=save-flow]', ms: 2600 },
      { cap: 'OOTB flows are a starting point, not a cage.', ms: 2600 },
    ],
  },

  'run-flow': {
    title: 'Run a flow — kickoff to merged PR',
    steps: [
      { cap: 'Runs start from the work: a project’s roadmap tab.', goto: '#/projects/detail/gitpulse', ms: 2600 },
      { cap: 'The full-page dependency DAG — completed initiatives are diggable.', click: '[data-j=ptab-roadmap]', ms: 3000 },
      { cap: 'Every pill with a run opens its breakdown.', hover: '[data-j=roadmap-dag]', ms: 2800 },
      { cap: 'Open a COMPLETED one: its full run breakdown is one click away.', click: '[data-j=rm-INIT-2]', ms: 3600 },
      { cap: 'Now the next initiative. To the flow monitor —', goto: '#/flows/monitor/forge-develop', ms: 2800 },
      { cap: 'Runs start from an explicit kickoff, not a hidden trigger.', click: '[data-j=kickoff-btn]', ms: 2800 },
      { cap: 'Bind the run to a project…', select: ['[data-j=kick-project]', 'gitpulse'], ms: 2600 },
      { cap: '…and ONE initiative from its roadmap — the unit of unattended work.', select: ['[data-j=kick-initiative]', 'INIT-3'], ms: 2800 },
      { cap: 'Attach input materials — a perf trace, a design sketch — anything that aids the run.', click: '[data-j=mat-zone]', ms: 2800 },
      { cap: 'Cost ceiling, fan-out cap, gates — limits are explicit. Start.', click: '[data-j=start-run]', ms: 3000 },
      { cap: 'Intake decomposes the initiative into work items.', ms: 2800 },
      { cap: 'Developer fan-out ×3 — the live node and run log advance together.', patch: { flowRun: 1 }, ms: 3200 },
      { cap: 'Demo Runner captures evidence per work item.', patch: { flowRun: 2 }, ms: 3000 },
      { cap: 'Adversarial review verifies every claim against the evidence.', patch: { flowRun: 3 }, ms: 3000 },
      { cap: 'The verdict gate opens — the flow pauses for the operator.', patch: { flowRun: 4 }, ms: 3200 },
      { cap: 'Approve & merge.', click: '[data-j=approve-btn]', ms: 3000 },
      { cap: 'The full node-by-node breakdown, with costs and artifacts.', click: '[data-j=open-run-btn]', ms: 3200 },
      { cap: 'Click any node for its FULL agent log…', click: '[data-j=run-node-1]', ms: 3000 },
      { cap: '…thought process, tool use, artifacts — every line a structured event.', hover: '.nlog', ms: 3800 },
      { cap: 'The reviewer’s log too: refute-first, claim by claim.', click: '[data-j=run-node-3]', ms: 3600 },
      { cap: 'Initiative in, merged PR out — evidence all the way down.', ms: 2800 },
    ],
  },

  'run-agent': {
    title: 'Run an agent standalone',
    steps: [
      { cap: 'Any standalone agent can run outside a flow — same harness, no pipeline.', goto: '#/agents', patch: { newAgentSaved: true }, ms: 3000 },
      { cap: 'issue-triage — created earlier in the create-agent journey.', click: '[data-j=agent-issue-triage]', ms: 2800 },
      { cap: 'Run it.', click: '[data-j=run-agent-btn]', ms: 2600 },
      { cap: 'A run binds to a project, with explicit inputs and limits.', select: ['[data-j=kick-project]', 'gitpulse'], ms: 2800 },
      { cap: 'Attach input materials — notes, screenshots — the agent’s spec says what’s allowed.', click: '[data-j=mat-zone]', ms: 2600 },
      { cap: 'A user report screenshot joins the run context.', click: '[data-j=mat-zone]', ms: 2600 },
      { cap: 'Read-only until its candidates are approved. Start.', click: '[data-j=start-run]', ms: 2800 },
      { cap: 'The session log streams — issues read via the github MCP, notes cross-referenced.', patch: { agentRun: 1 }, ms: 2800 },
      { cap: 'Clustered: 3 groups, 4 discarded as noise.', patch: { agentRun: 2 }, ms: 2600 },
      { cap: 'It checks the project brain before proposing anything.', patch: { agentRun: 3 }, ms: 2600 },
      { cap: 'Output: 3 initiative candidates, each from the initiative-spec template.', patch: { agentRun: 5 }, ms: 3200 },
      { cap: 'Open one — this is the actual artifact shape:', click: '[data-j=cand-CAND-1]', ms: 3000 },
      { cap: 'Intent, work items, acceptance signals, brain context, demo beat — ready for the Architect.', hover: '[data-j=cand-CAND-1]', ms: 4000 },
      { cap: 'File them to the roadmap.', click: '[data-j=file-output]', ms: 3000 },
      { cap: 'Description → draft → run → typed output. That’s an agent’s whole life.', ms: 2800 },
    ],
  },

  'build-hook': {
    title: 'Build a hook',
    steps: [
      { cap: 'The library — every builder draws from this shelf.', goto: '#/library', ms: 2400 },
      { cap: 'Hooks are AGENT-LIFECYCLE customisations: PreToolUse, SessionStart, SessionEnd. None runs on its own.', click: '[data-j=sub-hooks]', ms: 3600 },
      { cap: 'Every hook shows its event — and who carries it, derived from agent specs.', hover: '[data-j=lib-pre-pr-security-review]', ms: 3200 },
      { cap: 'Build one — an authoring session.', click: '[data-j=build-hook-btn]', patch: { sessionTurns: 1 }, ms: 3000 },
      { cap: 'Describe the automation…', patch: { sessionTurns: 2 }, ms: 2600 },
      { cap: '…it becomes a PreToolUse guard on Bash branch-deletes. The definition is HOST-AGNOSTIC.', patch: { sessionTurns: 3 }, ms: 3600 },
      { cap: 'Where does it attach? Nowhere, from here — binding lives in the Agent Builder only.', patch: { sessionTurns: 5 }, ms: 3400 },
      { cap: 'A hook is a PACKAGE: hook.yaml plus the guard script it runs.', click: '[data-j=hfile-tab-1]', patch: { sessionTurns: 7 }, ms: 3600 },
      { cap: 'And the replay evidence rides along.', click: '[data-j=hfile-tab-2]', ms: 3000 },
      { cap: 'Accept.', click: '[data-j=accept-btn]', ms: 2400 },
      { cap: 'On the shelf: event shown, “unbound — add from Agent Builder”.', patch: { builtHook: true }, goto: '#/library/hooks', ms: 3200 },
      { cap: 'So bind it — from the Developer’s builder, where binding lives:', goto: '#/agents/builder/developer', ms: 2800 },
      { cap: 'The new hook is in the catalog. Click it in.', click: '[data-j=cat-stack-base-guard]', ms: 3000 },
      { cap: 'Now it rides the Developer’s lifecycle — and only because you put it there.', hover: '[data-j=zone-hooks]', ms: 3400 },
      { cap: 'Save the binding.', click: '[data-j=save-agent]', ms: 2600 },
    ],
  },

  'build-skill': {
    title: 'Build a skill',
    steps: [
      { cap: 'Skills: capabilities agents load on demand — generic until an agent carries them.', goto: '#/library/skills', ms: 3200 },
      { cap: 'Build a skill — an authoring session with the creation agent.', click: '[data-j=build-skill-btn]', patch: { sessionTurns: 1 }, ms: 3000 },
      { cap: 'What should it do?', patch: { sessionTurns: 2 }, ms: 2600 },
      { cap: 'It drafts a PACKAGE: SKILL.md + the scripts and templates it references.', patch: { sessionTurns: 3 }, ms: 3400 },
      { cap: 'The collector script, in full:', click: '[data-j=file-tab-1]', patch: { sessionTurns: 5 }, ms: 3600 },
      { cap: 'And the output template that keeps the operator voice.', click: '[data-j=file-tab-2]', ms: 3000 },
      { cap: 'File it — unbound, like every fresh definition.', patch: { sessionTurns: 7 }, ms: 2800 },
      { cap: 'Accept.', click: '[data-j=accept-btn]', ms: 2400 },
      { cap: 'On the shelf, marked unbound.', patch: { builtSkill: true }, goto: '#/library/skills', ms: 3000 },
      { cap: 'Bind it where it belongs — the Reflector’s builder:', goto: '#/agents/builder/reflector', ms: 2800 },
      { cap: 'release-notes is in the catalog now. Click it into Skills.', click: '[data-j=cat-release-notes]', ms: 3000 },
      { cap: 'Bound — it runs when the reflector next closes a cycle.', hover: '[data-j=zone-skills]', ms: 3200 },
      { cap: 'Save the binding.', click: '[data-j=save-agent]', ms: 2600 },
    ],
  },

  'install-connections': {
    title: 'Browse & install MCPs, CLIs and tools',
    steps: [
      { cap: 'External connections: everything agents reach beyond the repo.', goto: '#/library/connections', ms: 2800 },
      { cap: 'Adding one means browsing the community hubs.', click: '[data-j=add-connection-btn]', ms: 2800 },
      { cap: 'Sources are explicit: MCP Registry, smithery.ai, claude-code-templates — per hub, per kind.', hover: '[data-j=hub-strip]', ms: 3600 },
      { cap: 'Filter to MCP servers.', click: '[data-j=commkind-mcp]', ms: 2400 },
      { cap: 'Each row carries the hub’s own signals — and every component has a DETAIL page.', click: '[data-j=crow-sentry-mcp]', ms: 3000 },
      { cap: 'Kind-appropriate depth: the capabilities it exposes to agents, transport, backing repo — not the whole server repo.', ms: 3800 },
      { cap: 'Install from here.', click: '[data-j=citem-install]', ms: 3000 },
      { cap: 'Back to the browser.', goto: '#/library/community', ms: 2400 },
      { cap: 'Now the CLIs.', click: '[data-j=commkind-cli]', ms: 2400 },
      { cap: 'stripe, for the API-shaped projects.', click: '[data-j=install-stripe-cli]', ms: 3000 },
      { cap: 'Both land in the local shelves, health-checked, provenance kept.', click: '[data-j=sub-connections]', ms: 3200 },
      { cap: 'Agents reference them by name in their specs — nothing else to wire.', ms: 2800 },
    ],
  },

  'create-kb-project': {
    title: 'Create a knowledge base — project scope',
    steps: [
      { cap: 'The three-scope brain model: forge, cycles, and one brain per project.', goto: '#/knowledge', ms: 3000 },
      { cap: 'Create a brain — every creation starts at the same kickoff.', click: '[data-j=create-brain-btn]', ms: 2800 },
      { cap: 'A brain binds to a scope. This one: a project.', click: '[data-j=scope-project]', ms: 3000 },
      { cap: 'trafficGame — an onboarded project with no brain yet.', select: ['[data-j=kb-target]', 'trafficgame'], ms: 2800 },
      { cap: 'Continue into the creation session.', click: '[data-j=kb-continue]', patch: { sessionTurns: 1 }, ms: 3200 },
      { cap: 'Seeded from the project’s own history: cycles, PR threads, operator notes.', patch: { sessionTurns: 2 }, ms: 3000 },
      { cap: '8 themes, an index hub, links into develop-cycle — lint-clean from day one.', patch: { sessionTurns: 3 }, ms: 3400 },
      { cap: 'Accept.', click: '[data-j=accept-btn]', ms: 2400 },
      { cap: 'projects/trafficgame joins the shelf.', patch: { newBrainProject: true }, click: '[data-j=nav-knowledge]', ms: 2800 },
      { cap: 'A living graph from the first minute — clusters, reader, the lot.', click: '[data-j=brain-trafficgame]', ms: 3600 },
    ],
  },

  'create-kb-cycle': {
    title: 'Create a knowledge base — cycle scope',
    steps: [
      { cap: 'Same starting point: the brains shelf.', goto: '#/knowledge', ms: 2800 },
      { cap: 'Create a brain — same kickoff as the project-scoped one.', click: '[data-j=create-brain-btn]', ms: 2800 },
      { cap: 'But this scope is a CYCLE band — cross-project patterns, bound to a flow.', click: '[data-j=scope-cycle]', ms: 3200 },
      { cap: 'The review band of forge-develop: every adversarial-review run, on every project.', select: ['[data-j=kb-target]', 'forge-develop · review band'], ms: 3000 },
      { cap: 'Continue into the creation session.', click: '[data-j=kb-continue]', patch: { sessionTurns: 1 }, ms: 3200 },
      { cap: 'Seeded from 41 runs of review findings — clusters become themes.', patch: { sessionTurns: 2 }, ms: 3000 },
      { cap: 'declared-data-fails-open leads with 9 occurrences. Reviewers may read it next run.', patch: { sessionTurns: 3 }, ms: 3400 },
      { cap: 'Accept.', click: '[data-j=accept-btn]', ms: 2400 },
      { cap: 'A Brain-2-scoped base, bound to the review band.', patch: { newBrainCycle: true }, click: '[data-j=nav-knowledge]', ms: 2800 },
      { cap: 'Same graph, same reader — different scope.', click: '[data-j=brain-review-insights]', ms: 3400 },
    ],
  },

  'kb-maintain': {
    title: 'Navigate, update & clean up a knowledge base',
    steps: [
      { cap: 'Keeping a brain healthy is part of the loop.', goto: '#/knowledge', ms: 2600 },
      { cap: 'develop-cycle carries a skew warning.', click: '[data-j=brain-develop-cycle]', ms: 3000 },
      { cap: 'The graph is ALIVE: clusters form around the index hubs through edge tension.', ms: 3400 },
      { cap: 'Drag a node — its neighbours follow, and the graph re-settles.', drag: ['[data-j=gnode-3]', 110, -60], ms: 3600 },
      { cap: 'Click a node to read it — graph and reader are one surface.', click: '[data-j=gnode-4]', ms: 3200 },
      { cap: 'Ingest activity: every reflector pass on record — the warning came from the 6h-ago ingest.', click: '[data-j=kbtab-activity]', ms: 3400 },
      { cap: 'Health: 8/9 — the distribution check is failing.', click: '[data-j=kbtab-health]', ms: 3000 },
      { cap: 'Run lint confirms it.', click: '[data-j=op-lint]', ms: 2800 },
      { cap: 'Correct issue hands it to the maintenance agent.', click: '[data-j=op-correct]', patch: { sessionTurns: 1 }, ms: 3200 },
      { cap: 'It found the duplicates and dangling edges itself — you choose the primaries.', patch: { sessionTurns: 2 }, ms: 3000 },
      { cap: 'Merged, relinked, tagged for multi-project evidence.', patch: { sessionTurns: 3 }, ms: 3000 },
      { cap: 'Lint re-run: 9/9 green.', patch: { sessionTurns: 4, kbFixed: true }, ms: 3000 },
      { cap: 'Accept the cleanup.', click: '[data-j=accept-btn]', ms: 2400 },
      { cap: 'Back on the shelf…', click: '[data-j=nav-knowledge]', ms: 2400 },
      { cap: '…develop-cycle is healthy again, with the cleanup on record.', click: '[data-j=brain-develop-cycle]', ms: 3400 },
    ],
  },

  'install-skills-hooks': {
    title: 'Browse skill & hook libraries for install',
    steps: [
      { cap: 'Skills and hooks ride on the existing communities.', goto: '#/library/skills', ms: 2800 },
      { cap: 'Community cards already show their hub + signals on the shelf.', hover: '[data-j=lib-frontend-design]', ms: 3000 },
      { cap: 'Browse the full catalogue.', click: '[data-j=browse-community-btn]', ms: 2800 },
      { cap: 'Sources: skills.sh, anthropics/skills, superpowers, claude-code-templates.', hover: '[data-j=hub-strip]', ms: 3400 },
      { cap: 'Filter to skills.', click: '[data-j=commkind-skill]', ms: 2400 },
      { cap: 'systematic-debugging — open its detail page before installing.', click: '[data-j=crow-systematic-debugging-skill]', ms: 3000 },
      { cap: 'SKILL.md preview, hub signals, backing repo — enough to judge it.', ms: 3400 },
      { cap: 'Install.', click: '[data-j=citem-install]', ms: 2800 },
      { cap: 'And the hooks — the known attack surface gets a SECURITY SCAN on its page.', goto: '#/library/citem/no-secrets-hook', ms: 3800 },
      { cap: 'Guard script scanned: no egress, commands allowlisted, no secret reads.', click: '[data-j=citem-install]', ms: 3400 },
      { cap: 'Back to the local shelf —', goto: '#/library/skills', ms: 2400 },
      { cap: 'Installed with provenance kept.', click: '[data-j=sub-skills]', ms: 2800 },
      { cap: 'Ready to click into any agent from the builder catalog.', hover: '[data-j=lib-systematic-debugging-skill]', ms: 3200 },
    ],
  },
  // ── run fan-out: one journey per OOTB agent + flow, varied triggers ──

  'run-agent-developer': {
    title: 'Run the Developer — standalone on one work item',
    steps: [
      { cap: 'The Developer normally runs inside forge-develop — but any agent can run standalone.', goto: '#/agents/builder/developer', ms: 3000 },
      { cap: 'Its triggers: auto inside the flow, or manual on a single work item.', hover: '[data-j=agent-triggers]', ms: 3200 },
      { cap: 'Run it.', click: '[data-j=run-agent-btn]', ms: 2600 },
      { cap: 'Bound to gitpulse, with the work-item spec attached as input material.', click: '[data-j=mat-zone]', ms: 2800 },
      { cap: 'The cost ceiling is per-kickoff — tighten it for a single work item.', type: ['[data-j=cost-ceiling]', '$0.60'], ms: 3000 },
      { cap: 'Start.', click: '[data-j=start-run]', ms: 2600 },
      { cap: 'Tests written FIRST — three failing, as expected.', patch: { agentRun: 2 }, ms: 3000 },
      { cap: 'The loop tightens: edit, run, green. The security-review hook rides along.', patch: { agentRun: 4 }, ms: 3200 },
      { cap: 'Output: a pushed branch + the demo note the Demo Runner will pick up.', patch: { agentRun: 5 }, ms: 3400 },
      { cap: 'Ralph-loop discipline, with or without the flow around it.', ms: 2800 },
    ],
  },

  'run-agent-adversarial-review': {
    title: 'Run Adversarial Review — auto-triggered on completion',
    steps: [
      { cap: 'Adversarial Review never starts by hand — it fires when the Developer node completes.', goto: '#/agents/run/adversarial-review', patch: { agentRun: 0 }, ms: 3400 },
      { cap: 'The trigger is on the run header: auto, on Developer completion.', hover: '[data-j=run-trigger]', ms: 3000 },
      { cap: 'Five claims extracted from the dev output — each gets a refutation attempt.', patch: { agentRun: 2 }, ms: 3200 },
      { cap: 'Year-boundary fixture against the ISO-week claim. Cold/warm timing against memoization.', patch: { agentRun: 3 }, ms: 3200 },
      { cap: 'All five survive. Zero findings — that’s a verdict-gate green light.', patch: { agentRun: 5 }, ms: 3400 },
      { cap: 'Refute-first: claims earn their way into the verdict.', ms: 2800 },
    ],
  },

  'run-agent-demo-runner': {
    title: 'Run the Demo Runner — project-hook trigger',
    steps: [
      { cap: 'The Demo Runner can ride a PROJECT hook: PR merged → refresh the demo artifacts.', goto: '#/agents/builder/demo-runner', ms: 3200 },
      { cap: 'Hook triggers are scoped per project — betterado and gitpulse here, not fleet-wide.', hover: '[data-j=agent-triggers]', ms: 3400 },
      { cap: 'PR #61 just merged on betterado — the hook fired.', goto: '#/agents/run/demo-runner', patch: { agentRun: 1 }, ms: 3200 },
      { cap: 'Live ADO GETs, portal captures — the project’s own demo skill drives it.', patch: { agentRun: 3 }, ms: 3200 },
      { cap: 'Output: refreshed demo HTML summary + screenshot set.', patch: { agentRun: 5 }, ms: 3200 },
      { cap: 'The showcase never goes stale — merges refresh it automatically.', ms: 2800 },
    ],
  },

  'run-agent-reflector': {
    title: 'Run the Reflector — auto after a flow completes',
    steps: [
      { cap: 'The Reflector runs OUTSIDE the cycle — auto-triggered when a forge-develop run completes.', goto: '#/agents/run/reflector', patch: { agentRun: 0 }, ms: 3400 },
      { cap: 'INIT-3 merged an hour ago; the reflector reads the whole run.', patch: { agentRun: 1 }, ms: 3000 },
      { cap: 'It queries all three brain scopes before writing anything.', patch: { agentRun: 2 }, ms: 3000 },
      { cap: 'Two durable lessons — evidence-backed, never speculation.', patch: { agentRun: 3 }, ms: 3000 },
      { cap: 'Themes linked, index updated, lint 9/9.', patch: { agentRun: 5 }, ms: 3200 },
      { cap: 'Every merged cycle makes the next one smarter.', ms: 2800 },
    ],
  },

  'run-agent-demo-design': {
    title: 'Run Demo Design — parallel at intake',
    steps: [
      { cap: 'Demo Design fires at initiative intake — in PARALLEL with Research.', goto: '#/agents/run/demo-design', patch: { agentRun: 0 }, ms: 3400 },
      { cap: 'It reads the initiative spec and chooses the demo shape.', patch: { agentRun: 2 }, ms: 3000 },
      { cap: 'Three demo beats authored from the templates — before a line of code exists.', patch: { agentRun: 3 }, ms: 3200 },
      { cap: 'Output: demo scripts, handed INTO the Developer node as a typed input.', patch: { agentRun: 4 }, ms: 3400 },
      { cap: 'The Developer builds toward a known demo shape — evidence by design.', ms: 3000 },
    ],
  },

  'run-agent-research': {
    title: 'Run Research — manual, with materials',
    steps: [
      { cap: 'Research: sources prior art and implementation detail for an initiative.', goto: '#/agents/builder/research', ms: 3000 },
      { cap: 'Manual trigger this time — with the operator’s notes attached.', click: '[data-j=run-agent-btn]', ms: 2800 },
      { cap: 'Competitor notes in as material.', click: '[data-j=mat-zone]', ms: 2600 },
      { cap: 'Start.', click: '[data-j=start-run]', ms: 2600 },
      { cap: 'Six sources read, two discarded as low-signal.', patch: { agentRun: 2 }, ms: 3000 },
      { cap: 'Output: a sourced brief — cited, distilled, Developer-ready.', patch: { agentRun: 4 }, ms: 3400 },
      { cap: 'Runs in parallel with Demo Design; the Developer waits for both.', ms: 3000 },
    ],
  },

  'run-agent-architect': {
    title: 'Run Architect/Planning — an interactive session',
    steps: [
      { cap: 'For interactive agents, Run IS a session — the Architect works with you, not for you.', goto: '#/agents/builder/architect-planning', ms: 3200 },
      { cap: 'Trigger: manual, from a project page.', hover: '[data-j=agent-triggers]', ms: 2800 },
      { cap: 'Run → straight into the session.', click: '[data-j=run-agent-btn]', patch: { sessionTurns: 1 }, ms: 3000 },
      { cap: 'It read the brains and the roadmap before asking anything.', patch: { sessionTurns: 3 }, ms: 3200 },
      { cap: 'Underspecified initiative → a drafted split, with a visual aid attached.', patch: { sessionTurns: 5 }, ms: 3400 },
      { cap: 'The roadmap updates live on the right — accept commits it to the project.', click: '[data-j=accept-btn]', ms: 3200 },
      { cap: 'Outcome: an updated roadmap DAG, ready for forge-develop.', ms: 2800 },
    ],
  },

  'run-agent-demo-builder': {
    title: 'Run the Demo Builder — session to demo capability',
    steps: [
      { cap: 'The Demo Builder authors a project’s demo CAPABILITY — interactively.', goto: '#/agents/builder/demo-builder', ms: 3000 },
      { cap: 'Run → session.', click: '[data-j=run-agent-btn]', patch: { sessionTurns: 1 }, ms: 3000 },
      { cap: 'It proposes a demo shape for the project type; generations iterate on your feedback.', patch: { sessionTurns: 3 }, ms: 3400 },
      { cap: 'Generation 3: clips + HTML summary. Ship it.', patch: { sessionTurns: 5 }, ms: 3200 },
      { cap: 'Accept — the demo skill lands in the project; the Demo Runner uses it from the next run.', click: '[data-j=accept-btn]', ms: 3400 },
      { cap: 'Author once, evidence forever.', ms: 2600 },
    ],
  },

  'run-agent-onboarding': {
    title: 'Run Project Onboarding — session to contract',
    steps: [
      { cap: 'Onboarding is a session: repo in, contract out.', goto: '#/agents/builder/project-onboarding', ms: 3000 },
      { cap: 'Run → session. It has already scanned the repo.', click: '[data-j=run-agent-btn]', patch: { sessionTurns: 1 }, ms: 3200 },
      { cap: 'North star from the operator, verbatim, into AGENTS.md.', patch: { sessionTurns: 3, artifactStage: 'instructions', stagesSeen: ['instructions'] }, ms: 3400 },
      { cap: 'Secrets by name; demo capability shaped to the project.', patch: { sessionTurns: 7, artifactStage: 'demo', stagesSeen: ['instructions', 'secrets', 'demo'] }, ms: 3400 },
      { cap: 'Contract green.', patch: { sessionTurns: 9, artifactStage: 'contract', contractDone: true }, ms: 3000 },
      { cap: 'Accept — a managed project is born.', click: '[data-j=accept-btn]', ms: 2800 },
    ],
  },

  'run-agent-brain-creation': {
    title: 'Run Brain Creation — session to seeded brain',
    steps: [
      { cap: 'Brain Creation seeds a knowledge base from a scope’s real history.', goto: '#/agents/builder/brain-creation', ms: 3000 },
      { cap: 'Run → session (scope chosen at the Knowledge kickoff).', click: '[data-j=run-agent-btn]', patch: { sessionTurns: 1 }, ms: 3200 },
      { cap: '3 cycles of history + 14 PR-thread decisions become the seed.', patch: { sessionTurns: 2 }, ms: 3000 },
      { cap: '8 themes, one index hub, links out — lint 9/9 on creation.', patch: { sessionTurns: 3 }, ms: 3200 },
      { cap: 'Accept — the reflector grows it from the next cycle.', click: '[data-j=accept-btn]', ms: 3000 },
    ],
  },

  'run-flow-onboard': {
    title: 'Run the onboard-project flow',
    steps: [
      { cap: 'The onboarding FLOW: interview → contract author → contract check.', goto: '#/flows/monitor/onboard-project', patch: { onboardDone: true }, ms: 3200 },
      { cap: 'Manual trigger, from Projects › Onboard.', click: '[data-j=kickoff-btn]', ms: 2800 },
      { cap: 'Target the repo; materials welcome.', select: ['[data-j=kick-project]', 'blog'], ms: 2600 },
      { cap: 'Start.', click: '[data-j=start-run]', ms: 2800 },
      { cap: 'Interview: the north star lands first.', ms: 3000 },
      { cap: 'Contract author: AGENTS.md, secrets, demo skill, gates.', patch: { flowRun: 1 }, ms: 3200 },
      { cap: 'Contract check gate: preflight green — no operator gate needed here.', patch: { flowRun: 2 }, ms: 3200 },
      { cap: 'Complete — the project lands managed, contract-green.', patch: { flowRun: 'done' }, ms: 3200 },
    ],
  },

  // R4-20 keep-as-is correction (2026-08-10, T1 ruling — docs/roadmaps/
  // R4-ootb-suite.md R4-20 "Brain-tune OOTB flow"): brain-tune stays a LOOP,
  // not a separate visible flow with its own lint-GATE node — that loop
  // already runs orchestrator-owned (reflector -> ingest -> brain-lint) on
  // every forge-develop merge, dispatched via the reflector agent's own real
  // standing trigger (forge-develop's `{on: merged, target: {kind: agent,
  // ref: reflector}}`). This entry no longer walks a `#/flows/monitor/
  // brain-tune` route or a discrete lint GATE node — neither exists, nor
  // will under keep-as-is — it walks the reflector agent's own builder page
  // instead, where the standing trigger + skills + brain-lint outcome are
  // the real, observable surface (the SAME `#/agents/builder/reflector`
  // route the `build-skill` story already navigates to, above).
  'run-flow-brain-tune': {
    title: 'Brain-tune — the reflector\'s own standing-trigger loop, not a separate flow',
    steps: [
      { cap: 'Brain-tune never starts by hand, and it is not a separate flow: it is the reflector agent\'s own standing trigger, firing when a forge-develop run completes.', goto: '#/agents/builder/reflector', ms: 3600 },
      { cap: 'The trigger lives on the agent itself: auto, on merge — from the INIT-3 completion.', hover: '[data-j=agent-triggers]', ms: 3000 },
      { cap: 'Reflector: two durable lessons from the cycle.', ms: 3000 },
      { cap: 'Ingest: themes, edges, index — written straight into the brain by the SAME run, no separate node.', ms: 3000 },
      { cap: 'Brain lint: 9/9 green — run inline by the reflector, not a gated flow step. Complete.', ms: 3200 },
      { cap: 'Learning is a loop, not a flow — and it already runs itself.', ms: 2800 },
    ],
  },
};

Object.assign(window, { JOURNEYS });
