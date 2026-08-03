// ── Mock data for the end-state prototype ─────────────────────────────
// Corpus-grounded: names, topologies, counts and history rows mirror the
// real forge cycle corpus (betterado / gitpulse / mdtoc, forge-develop
// dev→demo→adversarial-review→verdict, brain theme counts) rather than
// invented placeholders. Clearly-future objects are marked provenance:'vision'.

const OOTB = 'ootb';
const OPERATOR = 'operator';
const VISION = 'vision'; // exists only in the end-state, not yet in the product

// ---------- flows ----------
const FLOWS = [
  {
    id: 'forge-develop',
    name: 'forge-develop',
    provenance: OOTB,
    status: 'active',
    desc: 'The out-of-the-box development flow: initiative in, merged PR out. Developer fan-out, demo evidence, adversarial review, operator verdict gate.',
    nodes: [
      { id: 'intake',   kind: 'queue',  name: 'Initiative intake', sub: 'roadmap → work items', band: null },
      { id: 'dev',      kind: 'agent',  name: 'Developer',         sub: 'ralph loop · fanout ×4', band: 'develop' },
      { id: 'demo',     kind: 'agent',  name: 'Demo Runner',       sub: 'visual evidence per WI', band: 'develop' },
      { id: 'review',   kind: 'agent',  name: 'Adversarial Review', sub: 'refute-first findings', band: 'review' },
      { id: 'verdict',  kind: 'gate',   name: 'Verdict',           sub: 'operator approve / send back', band: 'review' },
    ],
    live: { what: 'betterado · INIT-12 framework-migrate task_groups', node: 'review', cost: '$3.84' },
    stats: { runs: 41, merged: 37, gated: 1 },
  },
  {
    id: 'onboard-project',
    name: 'onboard-project',
    provenance: OOTB,
    status: 'idle',
    desc: 'Bring an existing repo up to the forge↔project contract: interview, contract artifacts, validation, first roadmap hand-off.',
    nodes: [
      { id: 'interview', kind: 'agent', name: 'Onboarding Agent', sub: 'interactive interview', band: 'onboard' },
      { id: 'contract',  kind: 'agent', name: 'Contract author',  sub: 'AGENTS.md · demo skill · gates', band: 'onboard' },
      { id: 'validate',  kind: 'gate',  name: 'Contract check',   sub: 'preflight green', band: 'onboard' },
    ],
    live: null,
    stats: { runs: 6, merged: 6, gated: 0 },
  },
  {
    id: 'brain-tune',
    name: 'brain-tune',
    provenance: VISION,
    status: 'idle',
    desc: 'Reflection loop run outside the cycle: ingest completed work, consolidate themes, keep links + indexes healthy.',
    nodes: [
      { id: 'reflect', kind: 'agent', name: 'Reflector', sub: 'cycle → themes', band: 'reflect' },
      { id: 'ingest',  kind: 'agent', name: 'Brain ingest', sub: 'link + index pass', band: 'reflect' },
      { id: 'lint',    kind: 'gate',  name: 'Brain lint', sub: '9 structural checks', band: 'reflect' },
    ],
    live: null,
    stats: { runs: 58, merged: 58, gated: 0 },
  },
];

// ---------- agents (the 8 OOTB agents from the end-state map) ----------
const AGENTS = [
  {
    id: 'architect-planning', name: 'Architect / Planning', provenance: OOTB, status: 'idle',
    desc: 'Interactive exploratory session with the operator: visual aids, interview, project context + roadmap in; a generated or updated project roadmap out. Combines today’s Architect and PM.',
    skills: ['brain-query', 'roadmap-author', 'interview', 'demo-templates'],
    tools: ['Read', 'Write', 'AskUserQuestion'], mcps: [], hooks: [],
    runtime: 'claude-agent-sdk · frontier', brain: 'cycles + project',
    standalone: true, inFlows: [],
  },
  {
    id: 'developer', name: 'Developer', provenance: OOTB, status: 'active',
    desc: 'Develops initiatives from the Architect’s roadmap. Ralph-loop principles, write-first continuity, fan-out across work items in parallel worktrees.',
    skills: ['tdd-workflow', 'live-gate-feedback'],
    tools: ['Read', 'Write', 'Edit', 'Bash'], mcps: [], hooks: ['pre-pr-security-review'],
    runtime: 'claude-agent-sdk · worker · fanout', brain: 'project (advisory)',
    standalone: false, inFlows: ['forge-develop'],
    live: { what: 'betterado INIT-12 · WI-3/4 task_group filters', cost: '$1.92' },
  },
  {
    id: 'adversarial-review', name: 'Adversarial Review', provenance: OOTB, status: 'active',
    desc: 'Adversarially reviews developer work: refute-first verification of every claim, findings ranked by severity, feeds the verdict gate.',
    skills: ['refute-first-review'],
    tools: ['Read', 'Grep', 'Bash'], mcps: [], hooks: [],
    runtime: 'claude-agent-sdk · frontier', brain: 'none (by policy)',
    standalone: false, inFlows: ['forge-develop'],
    live: { what: 'betterado INIT-12 · verifying demo evidence', cost: '$0.68' },
  },
  {
    id: 'demo-runner', name: 'Demo Runner', provenance: OOTB, status: 'idle',
    desc: 'Hooks into a project’s demo skill and produces the visual evidence artifacts for each change — screenshots, API GETs, clips.',
    skills: ['project-demo'],
    tools: ['Bash', 'Read'], mcps: ['playwright'], hooks: [],
    runtime: 'claude-agent-sdk · worker', brain: 'none',
    standalone: true, inFlows: ['forge-develop'],
  },
  {
    id: 'demo-builder', name: 'Demo Builder', provenance: OOTB, status: 'idle',
    desc: 'Interactively guides the operator through creating a demo capability for any project type — video, screenshots, HTML summaries, mockups — iterating on prompts back and forth.',
    skills: ['demo-templates', 'webapp-testing', 'video-capture'],
    tools: ['Read', 'Write', 'Bash', 'AskUserQuestion'], mcps: ['playwright'], hooks: [],
    runtime: 'claude-agent-sdk · frontier · interactive', brain: 'project',
    standalone: true, inFlows: [],
  },
  {
    id: 'project-onboarding', name: 'Project Onboarding', provenance: OOTB, status: 'idle',
    desc: 'Onboards an existing repo to forge: interactively creates the artifacts that fulfil the forge↔project contract from the project’s own context.',
    skills: ['forge-onboard-project'],
    tools: ['Read', 'Write', 'Bash', 'AskUserQuestion'], mcps: [], hooks: [],
    runtime: 'claude-agent-sdk · frontier · interactive', brain: 'cycles',
    standalone: true, inFlows: ['onboard-project'],
  },
  {
    id: 'brain-creation', name: 'Brain Creation', provenance: OOTB, status: 'idle',
    desc: 'Creates a new knowledge base from context — in the scope of a project or an agent flow. Seeds structure, indexes and lint conformance from day one.',
    skills: ['brain-authoring'],
    tools: ['Read', 'Write', 'Bash'], mcps: [], hooks: [],
    runtime: 'claude-agent-sdk · worker', brain: 'creates them',
    standalone: true, inFlows: [],
  },
  {
    id: 'reflector', name: 'Reflector', provenance: OOTB, status: 'idle',
    desc: 'Reflects on completed forge cycles and writes durable themes back to the project and cycle brains. Runs outside the cycle, forge-focused.',
    skills: ['brain-query', 'brain-ingest'],
    tools: ['Read', 'Write'], mcps: [], hooks: ['post-merge-brain-ingest'],
    runtime: 'claude-agent-sdk · worker', brain: 'all three scopes',
    standalone: true, inFlows: ['brain-tune'],
  },
];

// ---------- projects ----------
const PROJECTS = [
  {
    id: 'betterado', name: 'betterado', provenance: OPERATOR, status: 'active', type: 'API · live ADO',
    desc: 'Azure DevOps automation layer. Live-tier verify ground; 24-initiative framework-migration roadmap in flight.',
    stats: { cycles: 41, merged: 37, roadmap: '18/24 initiatives' }, brain: 'betterado',
    live: { what: 'INIT-12 · adversarial review', cost: '$3.84' },
  },
  {
    id: 'gitpulse', name: 'gitpulse', provenance: OPERATOR, status: 'healthy', type: 'CLI · API',
    desc: 'Independent verify-cycle reference ground. Routine creds-free harness target for real-capability regression.',
    stats: { cycles: 7, merged: 7, roadmap: 'verify tier' }, brain: 'gitpulse',
  },
  {
    id: 'trafficgame', name: 'trafficGame', provenance: OPERATOR, status: 'idle', type: 'UI · game',
    desc: 'Browser traffic-flow game. Occasional cycle target; speed-limit-by-checkpoint idea parked on its roadmap.',
    stats: { cycles: 3, merged: 3, roadmap: 'parked' }, brain: 'trafficgame',
  },
  {
    id: 'mdtoc', name: 'mdtoc', provenance: OOTB, status: 'healthy', type: 'library · CLI',
    desc: 'OOTB demo project (lives in the forge repo): markdown table-of-contents tool. Synthetic test bed — never the verify ground.',
    stats: { cycles: 5, merged: 5, roadmap: 'demo seed' }, brain: 'mdtoc',
  },
  {
    id: 'demo-rest-api', name: 'demo-rest-api', provenance: VISION, status: 'idle', type: 'API',
    desc: 'OOTB demo project: a small REST API used to demonstrate onboarding, develop and demo flows on an API-shaped codebase.',
    stats: { cycles: 0, merged: 0, roadmap: 'demo seed' }, brain: null,
  },
  {
    id: 'demo-web-ui', name: 'demo-web-ui', provenance: VISION, status: 'idle', type: 'UI',
    desc: 'OOTB demo project: a small web UI to demonstrate visual-evidence demos and UI-journey gates out of the box.',
    stats: { cycles: 0, merged: 0, roadmap: 'demo seed' }, brain: null,
  },
];

// ---------- knowledge bases ----------
const BRAINS = [
  {
    id: 'forge-dev', name: 'forge-dev', scope: 'Brain 1 · forge engineering', provenance: OOTB, status: 'healthy',
    desc: 'How forge itself is engineered: conventions, decisions, antipatterns. Currently deliberately light — stands in lieu of heavy in-repo documentation.',
    themes: 38, edges: 84, indexes: 4, lastIngest: '2d ago', lint: { pass: 9, warn: 0, fail: 0 },
    note: 'Light by design; grows via reflector passes on forge work.',
  },
  {
    id: 'develop-cycle', name: 'develop-cycle', scope: 'Brain 2 · cross-cycle patterns', provenance: OOTB, status: 'attention',
    desc: 'Generic learnings across projects for the develop flow, so every new project starts with the fleet’s accumulated experience.',
    themes: 61, edges: 122, indexes: 6, lastIngest: '6h ago', lint: { pass: 8, warn: 1, fail: 0 },
    note: 'Warning: theme distribution skews toward betterado (limited test range) — broaden grounds.',
  },
  {
    id: 'betterado', name: 'projects/betterado', scope: 'Brain 3 · project', provenance: OPERATOR, status: 'healthy',
    desc: 'Per-project brain for betterado: ADO domain patterns, framework-migration lessons, permission-model gotchas.',
    themes: 132, edges: 340, indexes: 12, lastIngest: '6h ago', lint: { pass: 9, warn: 0, fail: 0 },
    note: 'Fully linked corpus: 132 themes, 12 topical hub pages.',
  },
  {
    id: 'gitpulse', name: 'projects/gitpulse', scope: 'Brain 3 · project', provenance: OPERATOR, status: 'healthy',
    desc: 'Per-project brain for gitpulse, the verify-cycle reference ground.',
    themes: 14, edges: 22, indexes: 2, lastIngest: '9d ago', lint: { pass: 9, warn: 0, fail: 0 },
    note: null,
  },
  {
    id: 'mdtoc', name: 'projects/mdtoc', scope: 'Brain 3 · project', provenance: OOTB, status: 'healthy',
    desc: 'Per-project brain for the mdtoc OOTB demo project.',
    themes: 9, edges: 12, indexes: 1, lastIngest: '21d ago', lint: { pass: 9, warn: 0, fail: 0 },
    note: null,
  },
];

// sample browsable theme tree + doc for the KB "consume" surface
const KB_TREE = {
  betterado: [
    { path: 'themes/index-permissions.md', label: 'ᐅ index · permissions', hub: true },
    { path: 'themes/2026-07-01-framework-native-apis.md', label: 'framework-native APIs' },
    { path: 'themes/2026-06-19-sdkv2-plugin-migration.md', label: 'sdkv2 → plugin migration' },
    { path: 'themes/2026-06-12-third-party-fork-pattern.md', label: 'third_party fork pattern' },
    { path: 'themes/2026-06-05-release-component-shape.md', label: 'release component shape' },
  ],
  'develop-cycle': [
    { path: 'themes/index-review.md', label: 'ᐅ index · review patterns', hub: true },
    { path: 'themes/declared-data-fails-open.md', label: 'declared data fails open' },
    { path: 'themes/guard-symmetry.md', label: 'guard symmetry sweeps' },
    { path: 'themes/demo-evidence-first.md', label: 'demo evidence first' },
  ],
};

const KB_DOC = {
  title: 'declared data fails open',
  tags: ['review', 'invariant', 'wave-4'],
  body: [
    'A parsed and surfaced field or status that is enforced nowhere. The recurring top finding across wave-4 reviews: caps, cron-concurrency, project-KB lint — each declared a constraint, displayed it, and never enforced it.',
    'Enforce end-to-end: the point of declaration must be wired to the point of dispatch, and a defense-in-depth lint must mirror the dispatch it backstops.',
  ],
  related: ['guard-symmetry', 'per-target-status-must-be-real'],
};

// ---------- library ----------
const SKILLS_LOCAL = [
  { id: 'brain-query', name: 'brain-query', desc: 'Scoped queries over the three-brain model', used: 'architect · reflector', provenance: OOTB },
  { id: 'forge-onboard-project', name: 'forge-onboard-project', desc: 'Contract-level onboarding for any project shape', used: 'onboarding agent', provenance: OOTB },
  { id: 'journey-sync', name: 'journey-sync', desc: 'Keep UI journeys in sync with forge-ui changes', used: 'developer', provenance: OOTB },
  { id: 'demo-templates', name: 'demo-templates', desc: 'Video / screenshot / HTML-summary demo scaffolds', used: 'demo builder · architect', provenance: OOTB },
  { id: 'tdd-workflow', name: 'tdd-workflow', desc: 'Write-tests-first with coverage gates', used: 'developer', provenance: OPERATOR },
  { id: 'security-review', name: 'security-review', desc: 'Pre-commit review of auth / input / API surfaces', used: 'developer hook', provenance: OPERATOR },
];
const SKILLS_COMMUNITY = [
  { id: 'frontend-design', name: 'frontend-design', desc: 'Distinctive visual direction for new UI', source: 'anthropics/skills' },
  { id: 'webapp-testing', name: 'webapp-testing', desc: 'Playwright-driven UI verification', source: 'anthropics/skills' },
  { id: 'baoyu-design', name: 'baoyu-design', desc: 'Self-contained HTML mockups + prototypes', source: 'skills.sh' },
];
// Hooks are customisations riding AGENT lifecycle events (PreToolUse,
// PostToolUse, SessionStart, SessionEnd, Notification…). A hook DEFINITION
// is generic — event + guard, host-agnostic. Binding is explicit and
// happens only from the Agent Builder; "carried by" derives from agent specs.
const HOOKS_LOCAL = [
  { id: 'pre-pr-security-review', name: 'pre-pr-security-review', desc: 'Run security-review before any PR-creating command on auth-touching diffs', on: 'PreToolUse · Bash(gh pr create)', provenance: OOTB },
  { id: 'post-merge-brain-ingest', name: 'post-merge-brain-ingest', desc: 'Queue a reflector pass when a session ends with a merged PR', on: 'SessionEnd', provenance: OOTB },
  { id: 'cycle-complete-notify', name: 'cycle-complete-notify', desc: 'Operator notification when a verdict gate opens', on: 'Notification', provenance: OPERATOR },
];
const HOOKS_COMMUNITY = [
  { id: 'conventional-commits', name: 'conventional-commits', desc: 'Reject non-conventional commit messages', source: 'claude-code-templates', on: 'PreToolUse · Bash(git commit)' },
  { id: 'no-secrets', name: 'no-secrets', desc: 'Block commits containing credential patterns', source: 'claude-code-templates', on: 'PreToolUse · Bash(git commit)' },
];
const CONNECTIONS = {
  mcps: [
    { id: 'tokensave', name: 'tokensave', desc: 'Code-graph queries over managed repos', status: 'healthy' },
    { id: 'github', name: 'github', desc: 'PRs, issues, checks via MCP', status: 'healthy' },
    { id: 'playwright', name: 'playwright', desc: 'Browser automation for demo evidence', status: 'healthy' },
  ],
  clis: [
    { id: 'gh', name: 'gh', desc: 'GitHub CLI — the merge path', status: 'healthy' },
    { id: 'az', name: 'az boards', desc: 'Azure DevOps CLI for betterado', status: 'healthy' },
    { id: 'ffmpeg', name: 'ffmpeg', desc: 'Demo clip rendering', status: 'healthy' },
  ],
  tools: [
    { id: 'worktrees', name: 'git worktrees', desc: 'Parallel work-unit isolation', status: 'healthy' },
    { id: 'jsonl-log', name: 'JSONL event log', desc: 'Structured events from every skill invocation', status: 'healthy' },
  ],
};

// ---------- monitor ledgers ----------
// One vocabulary for flow + agent history: when · what · outcome · cost.
const FLOW_HISTORY = {
  'forge-develop': [
    { when: 'now',      what: 'betterado · INIT-12 framework-migrate task_groups', sub: 'dev 4/4 → demo ✓ → adversarial review running', status: 'active', cost: '$3.84' },
    { when: '2d ago',   what: 'betterado · INIT-11 permissions surface', sub: 'dev 3/3 → demo ✓ → review 2 findings fixed → verdict approved → PR #61 merged', status: 'complete', cost: '$5.12' },
    { when: '4d ago',   what: 'gitpulse · verify-cycle (frozen SHA)', sub: 'dev 4/4 → demo ✓ → review clean → verdict approved → merged, tests green post-merge', status: 'complete', cost: '$4.20' },
    { when: '6d ago',   what: 'betterado · INIT-10 release def surface', sub: 'review found demo gap → demo-fix loop ×1 → verdict approved → merged', status: 'complete', cost: '$6.03' },
    { when: '9d ago',   what: 'mdtoc · demo-seed refresh', sub: 'dev 2/2 → demo ✓ → review clean → auto-close (no gate for demo seeds)', status: 'complete', cost: '$1.10' },
    { when: '12d ago',  what: 'betterado · INIT-09 recycle-bin leak', sub: 'verdict: sent back — findings unresolved → resumed → merged next run', status: 'gated', cost: '$7.44' },
  ],
  'onboard-project': [
    { when: '3w ago', what: 'gitpulse onboarding', sub: 'interview → contract artifacts → preflight green → first roadmap handed off', status: 'complete', cost: '$2.31' },
    { when: '6w ago', what: 'betterado onboarding', sub: 'contract-level invariants mapped onto ADO shape', status: 'complete', cost: '$2.85' },
  ],
  'brain-tune': [
    { when: '6h ago', what: 'develop-cycle ingest · INIT-11 reflections', sub: '3 new themes, 8 edges, index hub updated · lint 8/9 (skew warning)', status: 'attention', cost: '$0.41' },
    { when: '2d ago', what: 'betterado ingest · INIT-11', sub: '2 themes consolidated, links kept, 9/9 lint', status: 'complete', cost: '$0.38' },
  ],
};

// Each row links to where it ACTUALLY ran: a flow run, a standalone agent
// run, or an interactive session — agent history is not flow-only.
const AGENT_HISTORY = {
  developer: [
    { when: 'now',     what: 'betterado INIT-12 · WI-3/4 task_group filters', sub: 'in forge-develop · iter 2 · tests 14/16 green', status: 'active', cost: '$1.92', link: ['flows', 'run', 'forge-develop:0'] },
    { when: '1d ago',  what: 'gitpulse · WI-2 standalone', sub: 'STANDALONE run · tests 11/11 · branch pushed', status: 'complete', cost: '$0.58', link: ['agents', 'run', 'developer'] },
    { when: '2d ago',  what: 'betterado INIT-11 · 3 work items', sub: 'in forge-develop · fanout ×3 · all green first pass', status: 'complete', cost: '$2.66', link: ['flows', 'run', 'forge-develop:1'] },
    { when: '4d ago',  what: 'gitpulse verify · 4 work items', sub: 'in forge-develop · dev-loop 4/4', status: 'complete', cost: '$2.10', link: ['flows', 'run', 'forge-develop:2'] },
  ],
  'adversarial-review': [
    { when: 'now',    what: 'betterado INIT-12 · demo evidence verification', sub: 'in forge-develop · refuting claim 2/5', status: 'active', cost: '$0.68', link: ['flows', 'run', 'forge-develop:0'] },
    { when: '2d ago', what: 'betterado INIT-11', sub: 'in forge-develop · 2 findings → both fixed in-cycle', status: 'complete', cost: '$0.92', link: ['flows', 'run', 'forge-develop:1'] },
    { when: '6d ago', what: 'betterado INIT-10', sub: 'in forge-develop · demo gap → demo-fix loop', status: 'complete', cost: '$0.85', link: ['flows', 'run', 'forge-develop:3'] },
  ],
  'architect-planning': [
    { when: '5d ago', what: 'betterado roadmap refresh', sub: 'STANDALONE session · 24-initiative DAG updated, 2 initiatives split', status: 'complete', cost: '$3.15', link: ['agents', 'session', 'architect-planning'] },
    { when: '3w ago', what: 'gitpulse initial roadmap', sub: 'STANDALONE session · interview + visual aid → 6-initiative roadmap', status: 'complete', cost: '$2.40', link: ['agents', 'session', 'architect-planning'] },
  ],
  'demo-runner': [
    { when: '6h ago', what: 'betterado · PR #61 merged → refresh', sub: 'STANDALONE run (project hook) · showcase updated', status: 'complete', cost: '$0.31', link: ['agents', 'run', 'demo-runner'] },
    { when: '4d ago', what: 'gitpulse demo artifacts', sub: 'in forge-develop · CLI transcript + API captures', status: 'complete', cost: '$0.22', link: ['flows', 'run', 'forge-develop:2'] },
  ],
  'demo-builder': [
    { when: '3w ago', what: 'gitpulse demo skill authoring', sub: 'STANDALONE session · 3 generations → CLI-transcript shape chosen', status: 'complete', cost: '$1.05', link: ['agents', 'session', 'demo-builder'] },
  ],
  'project-onboarding': [
    { when: '3w ago', what: 'gitpulse onboarding', sub: 'STANDALONE session · contract artifacts · preflight green', status: 'complete', cost: '$2.31', link: ['agents', 'session', 'project-onboarding'] },
  ],
  'brain-creation': [
    { when: '3w ago', what: 'projects/gitpulse brain seeded', sub: 'STANDALONE session · structure + index · lint-clean', status: 'complete', cost: '$0.55', link: ['agents', 'session', 'brain-creation'] },
  ],
  reflector: [
    { when: '6h ago', what: 'develop-cycle ingest · INIT-11', sub: 'STANDALONE run (auto after flow) · skew warning raised', status: 'attention', cost: '$0.41', link: ['agents', 'run', 'reflector'] },
    { when: '2d ago', what: 'betterado ingest · INIT-11', sub: 'STANDALONE run (auto after flow) · 9/9 lint', status: 'complete', cost: '$0.38', link: ['agents', 'run', 'reflector'] },
  ],
};

// ---------- home attention items ----------
const ATTENTION = [
  { id: 'a1', kind: 'gate', text: 'forge-develop · betterado INIT-12 approaching verdict gate', sub: 'adversarial review in progress — verdict expected within the hour', status: 'active', target: { section: 'flows', view: 'monitor', id: 'forge-develop' } },
  { id: 'a2', kind: 'kb', text: 'develop-cycle brain: theme distribution skews toward betterado', sub: 'lint 8/9 — broaden verify grounds to rebalance', status: 'attention', target: { section: 'knowledge', view: 'detail', id: 'develop-cycle' } },
];

// ---------- catalog (builder palettes) ----------
const CATALOG = {
  skills: SKILLS_LOCAL.map(s => ({ id: s.id, name: s.name, kind: 'skill' })),
  tools: [
    { id: 'read', name: 'Read', kind: 'tool' }, { id: 'write', name: 'Write', kind: 'tool' },
    { id: 'edit', name: 'Edit', kind: 'tool' }, { id: 'bash', name: 'Bash', kind: 'tool' },
    { id: 'askuser', name: 'AskUserQuestion', kind: 'tool' },
  ],
  mcps: CONNECTIONS.mcps.map(m => ({ id: m.id, name: m.name, kind: 'mcp' })),
  hooks: HOOKS_LOCAL.map(h => ({ id: h.id, name: h.name, kind: 'hook' })),
  templates: [
    { id: 'roadmap-tpl', name: 'roadmap template', kind: 'template' },
    { id: 'demo-html-tpl', name: 'demo HTML summary', kind: 'template' },
    { id: 'initiative-tpl', name: 'initiative spec', kind: 'template' },
  ],
};

// ---------- templates (library pillar: in/out artifacts for agents) ----------
const TEMPLATES = [
  { id: 'demo-html-summary', name: 'demo HTML summary', cat: 'demo output', provenance: OOTB, preview: 'html',
    desc: 'Self-contained HTML page per change: what shipped, evidence inline (screenshots, API GETs), grep-able.',
    usedBy: ['demo-runner', 'demo-builder', 'architect-planning'], format: '.html · one file per WI' },
  { id: 'video-demo', name: 'video demo', cat: 'demo output', provenance: OOTB, preview: 'video',
    desc: 'Short screen-capture clip per journey beat, rendered via ffmpeg; the moving-picture proof for UI projects.',
    usedBy: ['demo-runner', 'demo-builder'], format: '.mp4 · ≤60s per beat' },
  { id: 'screenshot-set', name: 'screenshot set', cat: 'demo output', provenance: OOTB, preview: 'shots',
    desc: 'Before/after captures of the actual resource — portal pages, UI states, terminal transcripts.',
    usedBy: ['demo-runner', 'demo-builder'], format: '.png · labeled pairs' },
  { id: 'interactive-mockup', name: 'interactive mockup', cat: 'demo output', provenance: OOTB, preview: 'mock',
    desc: 'Clickable HTML prototype for proposals and visual aids — what the Architect shows in a planning session.',
    usedBy: ['architect-planning', 'demo-builder'], format: '.html · hash-routed' },
  { id: 'roadmap-tpl', name: 'roadmap', cat: 'planning', provenance: OOTB, preview: 'doc',
    desc: 'Project roadmap: initiative DAG with statuses, gates and dependency edges. The Architect session’s outcome.',
    usedBy: ['architect-planning'], format: '.md · greppable DAG' },
  { id: 'initiative-tpl', name: 'initiative spec', cat: 'planning', provenance: OOTB, preview: 'doc',
    desc: 'One initiative: intent, work items, acceptance signals, brain context the planner encoded.',
    usedBy: ['architect-planning', 'developer'], format: '.md · per initiative' },
  { id: 'scaffold-rest-api', name: 'project scaffold · REST API', cat: 'project type', provenance: VISION, preview: 'scaffold',
    desc: 'New-project scaffold conforming to the forge contract: API shape, tests, demo skill, gates pre-wired.',
    usedBy: ['project-onboarding'], format: 'repo template' },
  { id: 'scaffold-web-ui', name: 'project scaffold · web UI', cat: 'project type', provenance: VISION, preview: 'scaffold',
    desc: 'UI-shaped scaffold: journey harness, screenshot demo capability, e2e gate out of the box.',
    usedBy: ['project-onboarding'], format: 'repo template' },
  { id: 'scaffold-cli-lib', name: 'project scaffold · CLI / library', cat: 'project type', provenance: VISION, preview: 'scaffold',
    desc: 'Library/CLI scaffold: transcript-style demos, coverage gates, publish workflow.',
    usedBy: ['project-onboarding'], format: 'repo template' },
];

// ---------- KB graph parameters (rendered mock of the real KbGraph) ----------
const GRAPHS = {
  'forge-dev':     { hubs: 4,  themes: 34, raw: 10, cap: null },
  'develop-cycle': { hubs: 6,  themes: 42, raw: 14, cap: null },
  betterado:       { hubs: 12, themes: 48, raw: 16, cap: '48 of 132 themes shown' },
  gitpulse:        { hubs: 2,  themes: 12, raw: 6,  cap: null },
  mdtoc:           { hubs: 1,  themes: 8,  raw: 4,  cap: null },
};

const LINT_CHECKS = [
  { name: 'frontmatter complete', ok: true }, { name: 'keywords present', ok: true },
  { name: 'related_themes linked', ok: true }, { name: 'index hubs list every theme', ok: true },
  { name: 'no orphan nodes', ok: true }, { name: 'category → brain rule', ok: true },
  { name: 'wiki-links resolve', ok: true }, { name: 'raw evidence archived', ok: true },
  { name: 'theme distribution balance', ok: false },
];

// ---------- project roadmaps + demo artifacts ----------
const ROADMAPS = {
  betterado: [
    { id: 'INIT-09', name: 'Recycle-bin leak fix', status: 'complete', dep: null },
    { id: 'INIT-10', name: 'Release definition surface', status: 'complete', dep: null },
    { id: 'INIT-11', name: 'Permissions surface', status: 'complete', dep: 'INIT-10' },
    { id: 'INIT-12', name: 'Framework-migrate task_groups', status: 'active', dep: 'INIT-11' },
    { id: 'INIT-13', name: 'Framework-migrate variable_groups', status: 'pending', dep: 'INIT-12' },
    { id: 'INIT-14', name: 'New-API: service hooks', status: 'pending', dep: 'INIT-12' },
    { id: 'INIT-24', name: 'Cutover + legacy retirement', status: 'pending', dep: 'INIT-23' },
  ],
  gitpulse: [
    { id: 'INIT-1', name: 'Commit-activity summary', status: 'complete', dep: null },
    { id: 'INIT-2', name: 'Contributor heatmap', status: 'complete', dep: 'INIT-1' },
    { id: 'INIT-3', name: 'Release-cadence report', status: 'pending', dep: 'INIT-2' },
  ],
};

const DEMO_ARTIFACTS = {
  betterado: [
    { kind: 'html', name: 'INIT-11 · permissions surface', sub: 'HTML summary · live ADO GETs inline' },
    { kind: 'shots', name: 'INIT-11 · portal before/after', sub: '6 labeled pairs' },
    { kind: 'html', name: 'INIT-10 · release defs', sub: 'HTML summary · def id 2 standing demo' },
  ],
  gitpulse: [
    { kind: 'html', name: 'verify-cycle · summary', sub: 'CLI transcript + API captures' },
  ],
  mdtoc: [
    { kind: 'html', name: 'demo-seed · TOC render', sub: 'before/after markdown' },
  ],
};

// ---------- run detail (per forge-develop history row) ----------
const RUN_DETAILS = {
  'forge-develop:0': {
    title: 'betterado · INIT-12 framework-migrate task_groups', status: 'active', cost: '$3.84',
    nodes: [
      { node: 'Initiative intake', status: 'complete', cost: '$0.02', note: '4 work items decomposed from INIT-12 spec', artifacts: ['initiative spec'] },
      { node: 'Developer ×4', status: 'complete', cost: '$1.92', note: 'WI-1..4 green · worktrees merged to cycle branch', artifacts: ['4 branches', 'test runs 16/16'] },
      { node: 'Demo Runner', status: 'complete', cost: '$0.31', note: 'live ADO GET per WI + portal captures', artifacts: ['demo HTML summary', 'screenshot set'] },
      { node: 'Adversarial Review', status: 'active', cost: '$0.68', note: 'refuting claim 2/5 — verifying demo matches live state', artifacts: ['findings (draft)'] },
      { node: 'Verdict', status: 'pending', cost: '—', note: 'gate opens when review lands', artifacts: [] },
    ],
    findings: [
      { sev: 'major', text: 'WI-2 migrates task_group refs but leaves a legacy fallback path — violates no-fallback rule', state: 'open' },
      { sev: 'minor', text: 'demo GET for WI-4 captures default project, not the migrated one', state: 'open' },
    ],
  },
  'forge-develop:1': {
    title: 'betterado · INIT-11 permissions surface', status: 'complete', cost: '$5.12',
    nodes: [
      { node: 'Initiative intake', status: 'complete', cost: '$0.02', note: '3 work items', artifacts: ['initiative spec'] },
      { node: 'Developer ×3', status: 'complete', cost: '$2.66', note: 'all green first pass', artifacts: ['3 branches'] },
      { node: 'Demo Runner', status: 'complete', cost: '$0.28', note: 'ADO GETs + 6 screenshot pairs', artifacts: ['demo HTML summary', 'screenshot set'] },
      { node: 'Adversarial Review', status: 'complete', cost: '$0.92', note: '2 findings (1 major: cap-marker invariant) — both fixed in-cycle', artifacts: ['findings'] },
      { node: 'Verdict', status: 'complete', cost: '—', note: 'approved by operator · PR #61 merged', artifacts: ['merged PR'] },
    ],
    findings: [
      { sev: 'major', text: 'cross-writer cap-marker invariant violated by parallel WI writes', state: 'fixed' },
      { sev: 'minor', text: 'stale doc claim in README permissions table', state: 'fixed' },
    ],
  },
};

// ---------- interactive agent sessions ----------
const SESSIONS = {
  'architect-planning': {
    title: 'Planning session — betterado', artifactLabel: 'Roadmap draft',
    turns: [
      { who: 'agent', text: 'I’ve read the current roadmap (18/24 merged) and the project brain. What’s the next slice of value you want to explore?' },
      { who: 'operator', text: 'The remaining new-API initiatives feel underspecified — especially service hooks.' },
      { who: 'agent', text: 'Agreed — INIT-14 has no acceptance signals yet. I’ve drafted a split: hooks CRUD first (framework-native), then event routing. The mockup on the right shows the consumer surface; shall I fold the split into the roadmap?' },
      { who: 'operator', text: 'Yes — and add a live-ADO verification beat to each.' },
      { who: 'agent', text: 'Done. Roadmap updated: INIT-14a/14b with live verification beats, dependency edges kept. Review the diff below, then I’ll commit it to the project.' },
    ],
    artifact: 'roadmap',
  },
  'demo-builder': {
    title: 'Demo capability session — trafficGame', artifactLabel: 'Generation 3 of 3',
    turns: [
      { who: 'agent', text: 'trafficGame is UI-shaped with a canvas game loop. I propose a video-demo capability: short clips of each journey beat. Generation 1 is on the right.' },
      { who: 'operator', text: 'Clips are right, but I want a scoreboard overlay so changes are visible at a glance.' },
      { who: 'agent', text: 'Generation 2 adds a stats overlay per clip. I can also emit a per-cycle HTML summary stitching the clips with the diff — generation 3 shows both. Which direction should I finalize as the project’s demo skill?' },
      { who: 'operator', text: 'Generation 3. Ship it.' },
      { who: 'agent', text: 'Demo skill written to the project: video clips + HTML summary per cycle. The demo-runner will use it from the next run.' },
    ],
    artifact: 'demo-gallery',
  },
  'project-onboarding': {
    title: 'Onboarding session — blog', artifactLabel: 'Contract build-out',
    turns: [
      { who: 'agent', text: 'I’ve scanned the repo: static-site blog, Node build, tests via vitest, no demo capability, no AGENTS.md. I’ll interview you briefly, then author every contract artifact. First: what does “working” look like — what would you show someone?', stage: 'contract' },
      { who: 'operator', text: 'A post rendering correctly in the built site, with no broken links.' },
      { who: 'agent', text: 'That north star goes verbatim into the instructions. Generated AGENTS.md on the right — north star, conventions I inferred from the repo (content in /posts, build via npm run build), and the gates.', stage: 'instructions' },
      { who: 'operator', text: 'Add that drafts under _drafts/ must never publish.' },
      { who: 'agent', text: 'Folded in as a hard rule. Secrets next: I found a deploy token reference in your CI — declaring HASHNODE_TOKEN as a named secret; value stays in your local secrets.env, agents only ever see the name.', stage: 'secrets' },
      { who: 'operator', text: 'Correct, that’s the only one.' },
      { who: 'agent', text: 'Demo capability: for a static site, build-preview screenshots per changed post plus a link-check transcript. Drafted as the project demo skill — sample on the right.', stage: 'demo' },
      { who: 'operator', text: 'That works. What’s left?' },
      { who: 'agent', text: 'One item needs you: a fixture post for the demo baseline. Provide it and the contract goes green — then I hand the project to the Architect for its first roadmap. Everything you saw here lands on the project page.', stage: 'contract' },
    ],
    artifact: 'contract-full',
  },
  'brain-creation': {
    title: 'Brain creation session — trafficGame', artifactLabel: 'Seeded structure',
    turns: [
      { who: 'agent', text: 'Creating projects/trafficgame from project context: I found 3 cycles of history and 14 durable decisions in PR threads. Proposed seed: 8 themes, 1 index hub, links to develop-cycle patterns.' },
      { who: 'operator', text: 'Include the speed-limit-by-checkpoint idea from the roadmap notes.' },
      { who: 'agent', text: 'Added as a theme with a “parked idea” tag, linked from the index. Lint 9/9. The brain is live and the reflector will grow it from the next cycle.' },
    ],
    artifact: 'brain-seed',
  },
};

// ---------- extra sessions (creation agents + maintenance) ----------
SESSIONS['create-project'] = {
  agentName: 'Project Creation', title: 'Create project — pulseboard', artifactLabel: 'Contract build-out',
  turns: [
    { who: 'agent', text: 'Starting from the web-UI scaffold. What is pulseboard for, and what does “working” look like when you’d show it to someone?', stage: 'contract' },
    { who: 'operator', text: 'A dashboard visualising my home-lab metrics. Working = the board renders live numbers from my collector.' },
    { who: 'agent', text: 'That’s the north star, verbatim, into the instructions. Here’s the generated AGENTS.md — north star up top, then conventions, gates, and the demo contract every agent working this repo will follow.', stage: 'instructions' },
    { who: 'operator', text: 'Add: never commit straight to main, and keep charts dependency-free.' },
    { who: 'agent', text: 'Folded in. Next, secrets: the scaffold declares what it needs without storing values — you fill secrets.env locally, agents get names only.', stage: 'secrets' },
    { who: 'operator', text: 'METRICS_API_TOKEN is the only real one for now.' },
    { who: 'agent', text: 'Marked required, rest optional. Demo capability: the web-UI scaffold ships the journey harness — screenshots per beat plus an HTML summary per cycle. Here’s the seeded demo shape.', stage: 'demo' },
    { who: 'operator', text: 'Good. Can we get a starter roadmap too?' },
    { who: 'agent', text: 'Handing to the Architect templates: a 4-initiative starter DAG — layout shell → metric cards → collector adapter → alerts — each with acceptance signals and a live-render demo beat.', stage: 'roadmap' },
    { who: 'operator', text: 'Ship it all.' },
    { who: 'agent', text: 'Committed. pulseboard is live under Projects: instructions, secrets contract, demo capability, gates and roadmap — every contract component green, all visible on the project page.', stage: 'contract' },
  ],
  artifact: 'contract-full',
};
SESSIONS['build-hook'] = {
  agentName: 'Creation Agent', title: 'Build a hook — stack-base-guard', artifactLabel: 'Hook definition',
  turns: [
    { who: 'agent', text: 'Hooks are agent-lifecycle customisations — PreToolUse, PostToolUse, SessionStart, SessionEnd. A definition is generic: it names the event and the guard, and any agent can carry it later. What should this one do?' },
    { who: 'operator', text: 'Stop anything from deleting a branch that’s the base of an open stack.' },
    { who: 'agent', text: 'That’s a PreToolUse guard on Bash, matching `git branch -d/-D` and `gh pr merge --delete-branch`. It checks the branch against open stacked PRs and blocks, citing the merge-order lesson from the develop-cycle brain. Definition on the right — deliberately host-agnostic.' },
    { who: 'operator', text: 'Looks right. Where does it attach?' },
    { who: 'agent', text: 'Nowhere, from here — binding is explicit and lives in the Agent Builder: drag it into any agent’s hooks zone and it fires inside that agent’s sessions from then on. Replayed generically against history: it would have fired once, in a developer session (the INIT-09 deletion).' },
    { who: 'operator', text: 'File it.' },
    { who: 'agent', text: 'Filed to the local hook library, unbound. Bind it wherever it earns its keep.' },
  ],
  artifact: 'hook-def',
};
SESSIONS['build-skill'] = {
  agentName: 'Creation Agent', title: 'Build a skill — release-notes', artifactLabel: 'Skill package',
  turns: [
    { who: 'agent', text: 'Skills are invocable capabilities. Like hooks, a definition is generic — binding to an agent or a project happens later, explicitly, from their pages. What should this one do?' },
    { who: 'operator', text: 'Draft release notes from the merged cycle diffs.' },
    { who: 'agent', text: 'Drafted as a package: SKILL.md is the intent, plus a diff-collector script and an output template it references. The full file set is on the right — tested against INIT-11’s diff.' },
    { who: 'operator', text: 'Show me the collector.' },
    { who: 'agent', text: 'scripts/collect-diffs.sh — walks the cycle’s merged PRs, emits one grouped diff per initiative. The output template keeps the operator voice. File it?' },
    { who: 'operator', text: 'File it.' },
    { who: 'agent', text: 'Filed to the local skill library, unbound. Any agent can carry it from the Agent Builder — the reflector is the natural fit when you’re ready.' },
  ],
  artifact: 'skill-def',
};
SESSIONS['kb-cleanup'] = {
  agentName: 'Brain Maintenance', title: 'Cleanup session — develop-cycle', artifactLabel: 'Cleanup plan',
  turns: [
    { who: 'agent', text: 'The skew warning is real: 41 of 61 themes cite only betterado evidence. I found 3 near-duplicate theme pairs and 6 dangling edges from the last consolidation. Plan on the right.' },
    { who: 'operator', text: 'Merge the duplicates, keep the gitpulse-grounded variants as primaries.' },
    { who: 'agent', text: 'Merged 3 pairs (gitpulse-grounded primaries kept), relinked 6 edges, tagged 12 themes “needs multi-project evidence” so the next verify cycles rebalance them. Re-running lint…' },
    { who: 'agent', text: 'Lint 9/9 green. The distribution check passes with the tagged-theme allowance; it will re-fail if two more single-project themes land — by design.' },
  ],
  artifact: 'cleanup',
};
SESSIONS['brain-creation-cycle'] = {
  agentName: 'Brain Creation', title: 'Brain creation session — review-insights (cycle scope)', artifactLabel: 'Seeded structure',
  turns: [
    { who: 'agent', text: 'Cycle-scoped brain: this one binds to the review band of forge-develop, not to a project. Seed source: 41 runs of adversarial-review findings across all projects.' },
    { who: 'operator', text: 'Seed it from the recurring finding categories.' },
    { who: 'agent', text: 'Seeded 6 themes from finding clusters (declared-data-fails-open leads with 9 occurrences), 1 index hub, links into develop-cycle. Reviewers may read it next run; lint 9/9 from day one.' },
  ],
  artifact: 'brain-seed',
};

// ---------- community catalog (browse + install) ----------
// Every entry carries its SOURCE HUB plus that hub's own signals.
const COMMUNITY_HUBS = [
  { id: 'mcp-registry', name: 'MCP Registry', kinds: 'MCPs', url: 'registry.modelcontextprotocol.io' },
  { id: 'smithery', name: 'smithery.ai', kinds: 'MCPs', url: 'smithery.ai' },
  { id: 'skills-sh', name: 'skills.sh', kinds: 'skills', url: 'skills.sh' },
  { id: 'anthropics-skills', name: 'anthropics/skills', kinds: 'skills', url: 'github.com/anthropics/skills' },
  { id: 'superpowers', name: 'superpowers', kinds: 'skills', url: 'github.com/obra/superpowers' },
  { id: 'cc-templates', name: 'claude-code-templates', kinds: 'hooks · CLIs', url: 'github.com/davila7/claude-code-templates' },
];
const COMMUNITY = [
  { id: 'sentry-mcp', kind: 'mcp', name: 'sentry', hub: 'MCP Registry', stars: '2.1k', dl: '18k/wk', usage: 'popular w/ review agents', desc: 'Error telemetry — feed prod exceptions to reviewers' },
  { id: 'postgres-mcp', kind: 'mcp', name: 'postgres', hub: 'smithery.ai', stars: '4.8k', dl: '41k/wk', usage: 'top-10 on hub', desc: 'Query managed databases from agents' },
  { id: 'context7-mcp', kind: 'mcp', name: 'context7', hub: 'MCP Registry', stars: '9.2k', dl: '92k/wk', usage: 'top-3 on hub', desc: 'Up-to-date library docs at generation time' },
  { id: 'stripe-cli', kind: 'cli', name: 'stripe', hub: 'claude-code-templates', stars: '4.4k', dl: '9k/wk', usage: 'API projects', desc: 'Payments CLI for API-shaped projects' },
  { id: 'terraform-cli', kind: 'cli', name: 'terraform', hub: 'claude-code-templates', stars: '3.1k', dl: '12k/wk', usage: 'infra projects', desc: 'Infra provisioning for infra-typed projects' },
  { id: 'k6-tool', kind: 'tool', name: 'k6', hub: 'claude-code-templates', stars: '1.9k', dl: '4k/wk', usage: 'gate for API projects', desc: 'Load-test gate for API projects' },
  { id: 'frontend-design-skill', kind: 'skill', name: 'frontend-design', hub: 'anthropics/skills', stars: '165k', dl: '30k/wk', usage: 'canonical', desc: 'Distinctive visual direction for new UI' },
  { id: 'baoyu-design-skill', kind: 'skill', name: 'baoyu-design', hub: 'skills.sh', stars: '3.0k', dl: '6k/wk', usage: 'rising', desc: 'Self-contained HTML mockups + prototypes' },
  { id: 'systematic-debugging-skill', kind: 'skill', name: 'systematic-debugging', hub: 'superpowers', stars: '265k', dl: '48k/wk', usage: 'canonical', desc: 'Root-cause discipline for dev-loop agents' },
  { id: 'no-secrets-hook', kind: 'hook', name: 'no-secrets', hub: 'claude-code-templates', stars: '12k', dl: '15k/wk', usage: 'PreToolUse · git commit', desc: 'Block commits containing credential patterns' },
  { id: 'conventional-commits-hook', kind: 'hook', name: 'conventional-commits', hub: 'claude-code-templates', stars: '8k', dl: '11k/wk', usage: 'PreToolUse · git commit', desc: 'Reject non-conventional commit messages' },
  { id: 'auto-changelog-hook', kind: 'hook', name: 'auto-changelog', hub: 'claude-code-templates', stars: '5k', dl: '3k/wk', usage: 'SessionEnd', desc: 'Append merged-PR summaries to CHANGELOG' },
];

// ---------- journey draft objects ----------
const DRAFT_AGENT = {
  name: 'issue-triage',
  desc: 'Watches incoming issues, clusters them, and files initiative candidates onto the project roadmap for the Architect to review.',
  skills: ['brain-query', 'interview'], tools: ['Read', 'Bash'], mcps: ['github'], hooks: ['issue-opened (new)'],
  templates: ['initiative spec'],
};
const DRAFT_FLOW = {
  id: 'deps-refresh', name: 'deps-refresh',
  desc: 'Weekly dependency refresh: bump, test, demo the diff, gate on operator verdict.',
  nodes: [
    { id: 'dev', kind: 'agent', name: 'Developer', sub: 'bump + test in worktree', band: 'develop' },
    { id: 'demo', kind: 'agent', name: 'Demo Runner', sub: 'diff evidence per bump', band: 'develop' },
    { id: 'verdict', kind: 'gate', name: 'Verdict', sub: 'operator approve / send back', band: 'review' },
  ],
};

// ---------- demo showcase (mock rendered demo artifact) ----------
const SHOWCASE = {
  betterado: {
    cycle: 'INIT-11 · permissions surface', project: 'betterado',
    stats: ['dev 3/3 green', 'tests 16/16', 'review: 2 findings fixed', 'PR #61 merged'],
    api: 'GET https://dev.azure.com/parso/_apis/securitynamespaces\n→ 200 · 4 namespaces · migrated ACLs verified',
    evidence: [
      { kind: 'shots', name: 'portal — permissions grid', sub: 'before / after' },
      { kind: 'shots', name: 'portal — inheritance chain', sub: 'before / after' },
      { kind: 'video', name: 'grant → verify walkthrough', sub: '38s clip' },
    ],
  },
  blog: {
    cycle: 'onboarding · first demo', project: 'blog',
    stats: ['contract green', 'demo skill authored', 'gates wired'],
    api: '$ blog build --preview\n→ 24 pages rendered · 0 broken links',
    evidence: [
      { kind: 'shots', name: 'rendered post — before / after', sub: 'style pass' },
      { kind: 'html', name: 'build summary', sub: 'one page per publish' },
    ],
  },
  pulseboard: {
    cycle: 'scaffold · demo seed', project: 'pulseboard',
    stats: ['scaffold contract green', 'journey harness live', 'e2e gate wired'],
    api: '$ npm run ui:journey\n→ 6/6 beats green · screenshots captured',
    evidence: [
      { kind: 'shots', name: 'dashboard shell', sub: 'scaffold baseline' },
      { kind: 'video', name: 'journey walkthrough', sub: '22s clip' },
    ],
  },
};

// objects journeys can add to lists at runtime (via the scenario store)
const EXTRA = {
  blogProject: {
    id: 'blog', name: 'blog', provenance: OPERATOR, status: 'healthy', type: 'content · static site',
    desc: 'Personal blog — onboarded by the Project Onboarding agent: transcript demo skill, gates wired, first roadmap drafted.',
    stats: { cycles: 0, merged: 0, roadmap: 'first roadmap drafted' }, brain: null,
  },
  pulseboardProject: {
    id: 'pulseboard', name: 'pulseboard', provenance: OPERATOR, status: 'healthy', type: 'UI',
    desc: 'Home-lab metrics dashboard — created from the web-UI scaffold; contract green out of the box.',
    stats: { cycles: 0, merged: 0, roadmap: '4-initiative starter' }, brain: null,
  },
  trafficgameBrain: {
    id: 'trafficgame', name: 'projects/trafficgame', scope: 'Brain 3 · project', provenance: OPERATOR, status: 'healthy',
    desc: 'Seeded by the Brain Creation agent from 3 cycles of history and PR-thread decisions.',
    themes: 8, edges: 12, indexes: 1, lastIngest: 'just now', lint: { pass: 9, warn: 0, fail: 0 }, note: null,
  },
  reviewInsightsBrain: {
    id: 'review-insights', name: 'review-insights', scope: 'Brain 2 · cycle band', provenance: OPERATOR, status: 'healthy',
    desc: 'Cycle-scoped brain bound to the review band: recurring finding clusters across all projects.',
    themes: 6, edges: 9, indexes: 1, lastIngest: 'just now', lint: { pass: 9, warn: 0, fail: 0 }, note: null,
  },
  builtSkill: { id: 'release-notes', name: 'release-notes', desc: 'Draft release notes from merged cycle diffs', used: 'unbound — add from Agent Builder', provenance: OPERATOR },
  builtHook: { id: 'stack-base-guard', name: 'stack-base-guard', desc: 'Block deletion of any branch that bases an open stack', on: 'PreToolUse · Bash(git branch -D)', provenance: OPERATOR },
  newFlowCard: {
    id: 'deps-refresh', name: 'deps-refresh', provenance: OPERATOR, status: 'idle',
    desc: 'Weekly dependency refresh: bump, test, demo the diff, gate on operator verdict.',
    nodes: DRAFT_FLOW.nodes, live: null, stats: { runs: 0, merged: 0, gated: 0 },
  },
  newAgentCard: {
    id: 'issue-triage', name: 'issue-triage', provenance: OPERATOR, status: 'idle',
    desc: DRAFT_AGENT.desc,
    skills: DRAFT_AGENT.skills, tools: DRAFT_AGENT.tools, mcps: DRAFT_AGENT.mcps, hooks: [],
    runtime: 'claude-agent-sdk · worker', brain: 'project (advisory)', standalone: true, inFlows: [],
  },
};

// ---------- new example agents (round-6: parallel-branch showcase) ----------
AGENTS.push(
  {
    id: 'demo-design', name: 'Demo Design', provenance: VISION, status: 'idle',
    desc: 'Runs at initiative intake, in parallel with Research: authors the demo scripts that will showcase the new functionality, so the Developer builds against a known demo shape.',
    skills: ['demo-templates'], tools: ['Read', 'Write'], mcps: [], hooks: [],
    runtime: 'claude-agent-sdk · worker', brain: 'project (advisory)',
    standalone: true, inFlows: [],
  },
  {
    id: 'research', name: 'Research', provenance: VISION, status: 'idle',
    desc: 'Runs at initiative intake, in parallel with Demo Design: searches the web for similar work and prior art, and sources useful implementation detail for the initiative.',
    skills: ['web-research'], tools: ['Read', 'Write', 'WebSearch', 'WebFetch'], mcps: [], hooks: [],
    runtime: 'claude-agent-sdk · worker', brain: 'none',
    standalone: true, inFlows: [],
  },
);

// ---------- agent instructions — EVERY agent carries them ----------
const AGENT_INSTRUCTIONS = {
  'architect-planning': 'You run interactive planning sessions with the operator. Query the cycles + project brains first — mandatory. Take ideas via interview and visual aids; produce or update the project roadmap as a dependency-ordered initiative DAG with acceptance signals and demo beats per initiative. Never invent scope the operator did not confirm.',
  developer: 'You develop ONE initiative from the roadmap. Ralph-loop principles: write tests first, keep the loop tight, never leave the worktree red. Read the work items and their specs-gate — they are your single source of intent. Never read the forge brain; the planner already encoded it. Produce demo evidence per work item. Never commit straight to main; never delete a stack-base branch.',
  'adversarial-review': 'You review the developer’s work adversarially. For every claim, attempt to REFUTE it against the demo evidence and live state — never confirm from prose alone. Rank findings by severity; a finding without a reproduction path is a note, not a finding. You do not fix; you report to the verdict gate.',
  'demo-runner': 'You produce the visual evidence for each change using the project’s demo skill. Show the ACTUAL resource — live API responses, portal screenshots, rendered pages — never a table of test names. One artifact set per work item, from the demo templates, greppable on disk.',
  'demo-builder': 'You interactively author a project’s demo CAPABILITY with the operator: choose the demo shape for the project type, generate options, iterate on operator feedback, and write the chosen demo skill into the project. You author the capability; the demo-runner exercises it.',
  'project-onboarding': 'You bring an existing repo up to the forge↔project contract in one interactive session: scan the repo, interview the operator for the north star, then author every contract artifact — AGENTS.md, secrets contract (names only), demo skill, gates. Nothing lands without operator acceptance.',
  'brain-creation': 'You create a new knowledge base for a given scope (project or cycle band). Seed structure from that scope’s real history — cycles, PR threads, findings — never from speculation. Emit themes, one index hub, and links out; the result must pass all 9 lint checks on creation.',
  reflector: 'You run outside the cycle on completed work. Read all three brain scopes. Consolidate durable lessons into themes, keep links and indexes healthy, and never record speculation — only evidence from merged work.',
  'issue-triage': 'You watch incoming issues for the bound project. Cluster related issues, discard noise, and file initiative candidates onto the project roadmap with acceptance signals. Never modify code. Escalate anything security-shaped to the operator immediately. Output one initiative-spec per cluster using the bound template.',
  'demo-design': 'You run at initiative intake, in parallel with Research. Read the initiative spec and author the demo scripts that will showcase the new functionality — beat by beat, using the demo templates — so the Developer builds toward a known demo shape. Your output is an input to the Developer node.',
  research: 'You run at initiative intake, in parallel with Demo Design. Search for similar work, prior art and implementation references for the initiative; distil into a sourced brief (links + why each matters). Never paste code wholesale — cite and summarise. Your output is an input to the Developer node.',
};

// allowed input materials — set per agent, surfaced on kickoff screens
const AGENT_MATERIALS = {
  'architect-planning': ['images', 'documents'],
  developer: ['documents', 'data files'],
  'adversarial-review': ['documents'],
  'demo-runner': ['images'],
  'demo-builder': ['images', 'documents', 'audio'],
  'project-onboarding': ['documents'],
  'brain-creation': ['documents'],
  reflector: ['documents'],
  'demo-design': ['images', 'documents'],
  research: ['documents'],
  'issue-triage': ['images', 'documents'],
};
AGENTS.forEach(a => { a.materials = AGENT_MATERIALS[a.id] || []; });

// ---------- triggers — how runs start (configurable per agent/flow, per project) ----------
const TRIGGERS = {
  'forge-develop': [
    { type: 'manual', label: 'Manual kickoff — operator picks project + initiative' },
    { type: 'hook', label: 'issue labeled “initiative” → queue intake', scope: 'per-project: betterado' },
  ],
  'onboard-project': [{ type: 'manual', label: 'Manual — from Projects › Onboard' }],
  'brain-tune': [{ type: 'on-complete', label: 'auto — when a forge-develop run completes' }],
  developer: [{ type: 'on-complete', label: 'auto — inside forge-develop after intake' }, { type: 'manual', label: 'standalone on one work item' }],
  'adversarial-review': [{ type: 'on-complete', label: 'auto — when the Developer node completes' }],
  'demo-runner': [{ type: 'hook', label: 'PR merged → refresh demo artifacts', scope: 'per-project: betterado, gitpulse' }, { type: 'on-complete', label: 'auto — inside forge-develop' }],
  reflector: [{ type: 'on-complete', label: 'auto — when a forge-develop run completes' }],
  'issue-triage': [{ type: 'hook', label: 'issue raised → triage sweep', scope: 'per-project: gitpulse' }, { type: 'manual', label: 'manual sweep with inputs' }],
  'demo-design': [{ type: 'on-complete', label: 'auto — at initiative intake (parallel with Research)' }],
  research: [{ type: 'on-complete', label: 'auto — at initiative intake (parallel with Demo Design)' }, { type: 'manual', label: 'manual with attached materials' }],
  'architect-planning': [{ type: 'manual', label: 'session from a project page' }],
  'demo-builder': [{ type: 'manual', label: 'session from a project page' }],
  'project-onboarding': [{ type: 'manual', label: 'session from Projects › Onboard' }],
  'brain-creation': [{ type: 'manual', label: 'session from Knowledge › Create' }],
};

// ---------- contract-full artifact content (per stage) ----------
const CONTRACT_STAGES = {
  instructions: {
    blog: 'north_star: |\n  A post renders correctly in the built site,\n  with no broken links.\nconventions:\n  - content lives in /posts, build = npm run build\n  - drafts under _drafts/ MUST never publish\ngates: [vitest, link-check]\ndemo: build-preview screenshots + link-check transcript',
    pulseboard: 'north_star: |\n  The board renders LIVE numbers from the\n  operator’s collector.\nconventions:\n  - never commit straight to main\n  - charts stay dependency-free\ngates: [vitest, ui:journey]\ndemo: journey screenshots + HTML summary per cycle',
  },
  secrets: {
    blog: [{ name: 'HASHNODE_TOKEN', req: true, note: 'deploy — found in CI' }],
    pulseboard: [{ name: 'METRICS_API_TOKEN', req: true, note: 'collector read scope' }, { name: 'ALERT_WEBHOOK', req: false, note: 'optional, for the alerts initiative' }],
  },
  roadmap: [
    { id: 'INIT-1', name: 'Layout shell', sig: 'journey beat: board renders' },
    { id: 'INIT-2', name: 'Metric cards', sig: 'cards show fixture data' },
    { id: 'INIT-3', name: 'Collector adapter', sig: 'LIVE numbers on board' },
    { id: 'INIT-4', name: 'Alerts', sig: 'threshold fires webhook' },
  ],
};

// project detail: the contract components rendered on the project page
const PROJECT_CONTRACTS = {
  blog: { northStar: 'A post renders correctly in the built site, with no broken links.', conventions: ['content in /posts · build = npm run build', 'drafts under _drafts/ never publish'], gates: 'vitest · link-check', secrets: ['HASHNODE_TOKEN'] },
  pulseboard: { northStar: 'The board renders LIVE numbers from the operator’s collector.', conventions: ['never commit straight to main', 'charts stay dependency-free'], gates: 'vitest · ui:journey', secrets: ['METRICS_API_TOKEN', 'ALERT_WEBHOOK?'] },
  betterado: { northStar: 'Every ADO surface manageable through the framework — verified against the live organisation.', conventions: ['framework-native APIs only — no legacy fallbacks', 'third_party fork pattern for upstream gaps'], gates: 'acc-suite 20/20 · live-ADO beats', secrets: ['ADO_PAT', 'ADO_ORG_URL'] },
  gitpulse: { northStar: 'Run the CLI against any repo and get a correct activity report.', conventions: ['transcript demos against fixture repos'], gates: 'vitest · fixture transcripts', secrets: [] },
};

// ---------- skill package (build-skill artifact: SKILL.md + files) ----------
const SKILL_FILES = {
  'release-notes': [
    { path: 'SKILL.md', kind: 'md', body: '---\nname: release-notes\ndescription: Draft operator-voice release notes\n  from a cycle’s merged diffs + demo evidence\n---\n# Release notes\nRun scripts/collect-diffs.sh, group by\ninitiative, cite demo evidence inline,\nrender through templates/notes-template.md.' },
    { path: 'scripts/collect-diffs.sh', kind: 'sh', body: '#!/usr/bin/env bash\n# one grouped diff per initiative\ngh pr list --state merged --json number,title \\\n  | jq -r \'group_by(.initiative)[]\' \\\n  | while read -r grp; do gh pr diff "$grp"; done' },
    { path: 'templates/notes-template.md', kind: 'md', body: '## {{initiative}}\n{{operator_voice_summary}}\nEvidence: {{demo_links}}' },
  ],
};

// ---------- live flow run (run-flow journey) ----------
const LIVE_RUN = {
  flow: 'forge-develop', project: 'gitpulse', initiative: 'INIT-3 · Release-cadence report',
  ceiling: '$8.00', fanout: 4,
  stages: [
    { node: 'intake', log: 'Initiative intake: 3 work items decomposed from INIT-3 spec', cost: '$0.02' },
    { node: 'dev', log: 'Developer fanout ×3: worktrees wt-i3-{1..3} · tests 11/11 green', cost: '$1.74' },
    { node: 'demo', log: 'Demo Runner: CLI transcript + API captures per WI', cost: '$0.26' },
    { node: 'review', log: 'Adversarial Review: 5 claims verified, 0 findings', cost: '$0.61' },
    { node: 'verdict', log: 'Verdict gate OPEN — operator decision required', cost: '—' },
  ],
};
RUN_DETAILS['forge-develop:live'] = {
  title: 'gitpulse · INIT-3 release-cadence report', status: 'complete', cost: '$2.63',
  nodes: [
    { node: 'Initiative intake', status: 'complete', cost: '$0.02', note: '3 work items from INIT-3 spec', artifacts: ['initiative spec'] },
    { node: 'Developer ×3', status: 'complete', cost: '$1.74', note: 'all green · tests 11/11', artifacts: ['3 branches'] },
    { node: 'Demo Runner', status: 'complete', cost: '$0.26', note: 'CLI transcript + API captures', artifacts: ['demo HTML summary'] },
    { node: 'Adversarial Review', status: 'complete', cost: '$0.61', note: '5 claims verified, 0 findings', artifacts: ['findings: none'] },
    { node: 'Verdict', status: 'complete', cost: '—', note: 'approved by operator · PR merged', artifacts: ['merged PR'] },
  ],
  findings: [],
};

// ---------- per-node agent logs (run detail drill-down) ----------
const NODE_LOGS = {
  'Developer ×3': [
    { t: 'think', text: 'WI-2 needs the cadence bucketing before WI-3 can chart it — sequencing worktree 2 first.' },
    { t: 'tool', text: 'Bash · git worktree add wt-i3-2 && npm test — 3 failing (expected, tests written first)' },
    { t: 'tool', text: 'Edit · src/cadence.ts — bucket releases by ISO week, memoize per repo' },
    { t: 'tool', text: 'Bash · npm test — 11/11 green' },
    { t: 'out', text: 'artifact: branch wt-i3-2 pushed · demo note for Demo Runner queued' },
    { t: 'think', text: 'Guard check: no stack-base branches touched; pre-pr-security-review hook passed clean.' },
  ],
  'Demo Runner': [
    { t: 'tool', text: 'Bash · gitpulse report --repo fixtures/kubernetes — transcript captured' },
    { t: 'tool', text: 'Bash · curl api/cadence?repo=k8s — 200, weekly buckets present' },
    { t: 'out', text: 'artifact: demo HTML summary (transcript + API capture inline)' },
  ],
  'Adversarial Review': [
    { t: 'think', text: 'Claim 2/5: “cadence buckets are ISO-week aligned.” Refute: check a year-boundary release.' },
    { t: 'tool', text: 'Bash · gitpulse report --repo fixtures/year-boundary — bucket 2025-W01 correct' },
    { t: 'think', text: 'Claim survives. 5/5 verified against evidence, zero refutations stick.' },
    { t: 'out', text: 'findings: none · verdict gate may open' },
  ],
};

// ---------- standalone agent run (run-agent journey) ----------
const AGENT_RUN = {
  agent: 'issue-triage', project: 'gitpulse',
  materials: ['triage-notes.md', 'user-report-screenshot.png'],
  log: [
    'SessionStart · issue-triage on gitpulse (standalone) · 2 input materials attached',
    'Read 14 open issues via github MCP · cross-referenced triage-notes.md',
    'Clustered: 3 groups · 4 issues discarded as noise/duplicates',
    'brain-query: no prior theme conflicts with proposed groupings',
    'Drafted 3 initiative candidates from the initiative-spec template',
    'SessionEnd · output filed for operator review · $0.34',
  ],
  output: [
    { id: 'CAND-1', name: 'Rate-limit handling on GitHub API calls', from: '5 issues', sig: 'no 403s across a 500-repo sweep' },
    { id: 'CAND-2', name: 'Windows path handling in report writer', from: '3 issues', sig: 'suite green on windows-latest CI' },
    { id: 'CAND-3', name: 'Config file support (.gitpulserc)', from: '2 issues', sig: 'documented keys honoured end-to-end' },
  ],
};
// full shape of one generated initiative artifact (run-agent detail beat)
const CAND_DETAIL = {
  id: 'CAND-1', name: 'Rate-limit handling on GitHub API calls',
  spec: 'initiative: rate-limit-handling\nintent: |\n  Sweeps over many repos hit secondary rate\n  limits; runs abort mid-report. (5 issues,\n  incl. user-report-screenshot.png)\nwork_items:\n  - WI-1: token-bucket client wrapper + tests\n  - WI-2: resume-from-checkpoint on 403\n  - WI-3: backoff telemetry in report footer\nacceptance:\n  - no 403s across a 500-repo sweep (fixture)\n  - resumed sweep matches uninterrupted output\nbrain_context:\n  - [[api-clients-retry-discipline]]\ndemo_beat: transcript of 500-repo sweep, footer shows backoff stats',
};

// ---------- per-flow run stages (run-flow journey fan-out) ----------
const FLOW_RUNS = {
  'forge-develop': { trigger: 'manual kickoff — gitpulse · INIT-3', stages: LIVE_RUN.stages },
  'onboard-project': {
    trigger: 'manual — Projects › Onboard (repo: blog)',
    stages: [
      { node: 'interview', log: 'Onboarding interview: north star captured from operator', cost: '$0.31' },
      { node: 'contract', log: 'Contract author: AGENTS.md · secrets contract · demo skill · gates', cost: '$1.62' },
      { node: 'validate', log: 'Contract check: preflight green — all invariants hold', cost: '$0.08' },
    ],
  },
  'brain-tune': {
    trigger: 'auto — forge-develop run completed (gitpulse · INIT-3)',
    stages: [
      { node: 'reflect', log: 'Reflector: 2 durable lessons from INIT-3 (cadence bucketing, fixture discipline)', cost: '$0.38' },
      { node: 'ingest', log: 'Brain ingest: 2 themes, 5 edges, index hub updated in projects/gitpulse', cost: '$0.12' },
      { node: 'lint', log: 'Brain lint: 9/9 green', cost: '$0.02' },
    ],
  },
};

// ---------- per-agent standalone runs (run-agent journey fan-out) ----------
// Worker agents get log→output runs; interactive agents run AS sessions.
const AGENT_RUNS = {
  'issue-triage': AGENT_RUN,
  developer: {
    agent: 'developer', project: 'gitpulse', trigger: 'manual — standalone on one work item',
    materials: ['wi-2-spec.md'],
    log: [
      'SessionStart · developer on gitpulse (standalone, WI-2 only)',
      'Read work item + specs-gate — single source of intent',
      'Tests written first: 3 failing as expected',
      'Edit src/cadence.ts — ISO-week bucketing, memoized',
      'Tests 11/11 green · pre-pr-security-review hook: clean',
      'SessionEnd · branch pushed, demo note queued · $0.58',
    ],
    outputTitle: 'Output — branch + evidence note',
    output: [
      { id: 'BR-1', name: 'wt-i3-2 pushed', from: 'WI-2', sig: 'tests 11/11 · hook clean' },
      { id: 'NOTE', name: 'demo note for Demo Runner', from: 'WI-2', sig: 'cadence endpoint + fixture' },
    ],
  },
  'adversarial-review': {
    agent: 'adversarial-review', project: 'gitpulse', trigger: 'auto — Developer node completed',
    materials: [],
    log: [
      'SessionStart · adversarial-review (triggered by developer completion)',
      'Claims extracted from dev output: 5',
      'Refuting claim 2/5: ISO-week alignment — year-boundary fixture run',
      'Refuting claim 4/5: memoization — cold/warm timing compared',
      'All 5 claims survive against evidence · 0 findings',
      'SessionEnd · verdict gate may open · $0.61',
    ],
    outputTitle: 'Output — findings report',
    output: [
      { id: 'RPT', name: 'findings: none', from: '5 claims', sig: 'all refutation attempts failed' },
    ],
  },
  'demo-runner': {
    agent: 'demo-runner', project: 'betterado', trigger: 'project hook — PR merged (betterado)',
    materials: [],
    log: [
      'SessionStart · demo-runner (triggered: PR #61 merged on betterado)',
      'Project demo skill loaded: live-ADO GET + portal captures',
      'GET securitynamespaces — 200, migrated ACLs verified',
      'Portal screenshots: permissions grid before/after',
      'demo HTML summary rendered from template',
      'SessionEnd · showcase updated · $0.31',
    ],
    outputTitle: 'Output — demo artifacts',
    output: [
      { id: 'HTML', name: 'demo HTML summary', from: 'PR #61', sig: 'live GETs inline' },
      { id: 'SHOTS', name: 'screenshot set ×6', from: 'portal', sig: 'labeled before/after' },
    ],
  },
  reflector: {
    agent: 'reflector', project: 'gitpulse', trigger: 'auto — forge-develop run completed',
    materials: [],
    log: [
      'SessionStart · reflector (triggered: INIT-3 merged)',
      'Read cycle artifacts: run detail, findings, demo evidence',
      'brain-query all three scopes — no conflicting themes',
      'Drafted 2 themes: cadence-bucketing pattern · fixture discipline',
      'Links + index hub updated · lint 9/9',
      'SessionEnd · brains updated · $0.38',
    ],
    outputTitle: 'Output — brain themes',
    output: [
      { id: 'TH-1', name: 'cadence-bucketing pattern', from: 'INIT-3', sig: 'linked into develop-cycle' },
      { id: 'TH-2', name: 'fixture discipline', from: 'INIT-3', sig: 'projects/gitpulse' },
    ],
  },
  'demo-design': {
    agent: 'demo-design', project: 'gitpulse', trigger: 'auto — initiative intake (parallel with Research)',
    materials: ['initiative-spec.md'],
    log: [
      'SessionStart · demo-design (triggered at INIT-3 intake)',
      'Read initiative spec: release-cadence report',
      'Demo shape chosen: CLI transcript + cadence chart capture',
      'Authored 3 demo beats from the templates',
      'SessionEnd · demo scripts handed to Developer node · $0.19',
    ],
    outputTitle: 'Output — demo scripts (Developer input)',
    output: [
      { id: 'BEAT-1', name: 'sweep transcript beat', from: 'spec', sig: '500-repo fixture' },
      { id: 'BEAT-2', name: 'cadence chart capture', from: 'spec', sig: 'ISO-week buckets visible' },
    ],
  },
  research: {
    agent: 'research', project: 'gitpulse', trigger: 'manual — with attached materials',
    materials: ['competitor-notes.md'],
    log: [
      'SessionStart · research on gitpulse · 1 material attached',
      'WebSearch: release cadence analysis tools, git activity heuristics',
      'Read 6 sources · 2 discarded as low-signal',
      'Distilled: bucketing approaches, rate-limit patterns, chart conventions',
      'SessionEnd · sourced brief handed to Developer node · $0.22',
    ],
    outputTitle: 'Output — sourced brief (Developer input)',
    output: [
      { id: 'SRC-1', name: 'ISO-week vs rolling buckets — tradeoffs', from: '3 sources', sig: 'cited' },
      { id: 'SRC-2', name: 'GitHub API rate patterns', from: '2 sources', sig: 'cited' },
    ],
  },
};

// ---------- hook package (hooks are file packages too) ----------
const HOOK_FILES = {
  'stack-base-guard': [
    { path: 'hook.yaml', body: 'hook: stack-base-guard\nevent: PreToolUse · Bash\nmatcher: git branch -d|-D · gh pr merge --delete-branch\nrun: scripts/check-stack-base.sh\nhost: generic — bind from Agent Builder\non_block: cite [[merge-order]] lesson' },
    { path: 'scripts/check-stack-base.sh', body: '#!/usr/bin/env bash\n# exit non-zero → the tool call is BLOCKED\nbranch="$1"\ngh pr list --state open --json baseRefName \\\n  --jq \'.[].baseRefName\' | grep -qx "$branch" \\\n  && { echo "BLOCK: $branch bases an open stack"; exit 1; }\nexit 0' },
    { path: 'replay.txt', body: 'generic replay vs 41 recorded sessions:\nwould have fired 1× — developer session,\nINIT-09 stack-base deletion (cost a re-run)' },
  ],
};
SKILL_FILES['release-notes'].push({ path: 'sample-output.md', kind: 'md', body: '## INIT-11 · permissions surface\nMigrated ACL handling to framework-native\ncalls; verified against the live org.\nEvidence: demo/INIT-11/summary.html' });

// hook security scan (known attack surface → first-class detail)
const SECURITY_SCANS = {
  hook: { last: '2d ago', verdict: 'clean', checks: ['no network egress in guard script', 'commands allowlisted (gh, grep)', 'no env/secret reads', 'no writes outside repo'] },
};

// community/library source links + kind-appropriate detail
const LIB_SOURCE = {
  'sentry-mcp': { gh: 'github.com/getsentry/sentry-mcp', transport: 'stdio · npx', capabilities: ['list_issues', 'get_event', 'resolve_issue'] },
  'postgres-mcp': { gh: 'github.com/modelcontextprotocol/servers', transport: 'stdio', capabilities: ['query', 'schema', 'explain'] },
  'context7-mcp': { gh: 'github.com/upstash/context7', transport: 'http', capabilities: ['resolve-library-id', 'get-library-docs'] },
  tokensave: { gh: 'github.com/local/tokensave', transport: 'stdio', capabilities: ['context', 'search', 'callers', 'impact'] },
  github: { gh: 'github.com/github/github-mcp-server', transport: 'http', capabilities: ['prs', 'issues', 'checks'] },
  playwright: { gh: 'github.com/microsoft/playwright-mcp', transport: 'stdio', capabilities: ['navigate', 'screenshot', 'console'] },
  'frontend-design-skill': { gh: 'github.com/anthropics/skills' },
  'baoyu-design-skill': { gh: 'github.com/JimLiu/baoyu-design' },
  'systematic-debugging-skill': { gh: 'github.com/obra/superpowers' },
  'no-secrets-hook': { gh: 'github.com/davila7/claude-code-templates' },
  'conventional-commits-hook': { gh: 'github.com/davila7/claude-code-templates' },
  'auto-changelog-hook': { gh: 'github.com/davila7/claude-code-templates' },
  'stripe-cli': { gh: 'github.com/stripe/stripe-cli', commands: ['stripe listen', 'stripe trigger', 'stripe logs tail'] },
  'terraform-cli': { gh: 'github.com/hashicorp/terraform', commands: ['plan', 'apply', 'state'] },
  'k6-tool': { gh: 'github.com/grafana/k6', commands: ['k6 run', 'k6 cloud'] },
};

// starter roadmaps for the journey-created projects (shown as DAGs on their pages)
ROADMAPS.blog = [
  { id: 'INIT-1', name: 'Broken-link sweep + fix', status: 'pending', dep: null, run: null },
  { id: 'INIT-2', name: 'Draft-workflow guardrails', status: 'pending', dep: 'INIT-1', run: null },
  { id: 'INIT-3', name: 'Publish pipeline hardening', status: 'pending', dep: 'INIT-1', run: null },
];
ROADMAPS.pulseboard = CONTRACT_STAGES.roadmap.map((r, i) => ({ id: r.id, name: r.name, status: 'pending', dep: i ? CONTRACT_STAGES.roadmap[i - 1].id : null, run: null }));

// gitpulse verify run (completed-initiative dig-in target)
RUN_DETAILS['forge-develop:2'] = {
  title: 'gitpulse · verify-cycle (frozen SHA)', status: 'complete', cost: '$4.20',
  nodes: [
    { node: 'Initiative intake', status: 'complete', cost: '$0.02', note: '4 work items from the verify spec', artifacts: ['initiative spec'] },
    { node: 'Developer ×4', status: 'complete', cost: '$2.44', note: 'dev-loop 4/4 green', artifacts: ['4 branches'] },
    { node: 'Demo Runner', status: 'complete', cost: '$0.24', note: 'CLI transcript + API captures', artifacts: ['demo HTML summary'] },
    { node: 'Adversarial Review', status: 'complete', cost: '$0.70', note: 'review clean', artifacts: ['findings: none'] },
    { node: 'Verdict', status: 'complete', cost: '—', note: 'approved · merged, tests green post-merge', artifacts: ['merged PR'] },
  ],
  findings: [],
};

// roadmap rows → their runs (completed initiatives are diggable)
ROADMAPS.betterado.forEach(r => {
  r.run = { 'INIT-09': 'forge-develop:5', 'INIT-10': 'forge-develop:3', 'INIT-11': 'forge-develop:1', 'INIT-12': 'forge-develop:0' }[r.id] || null;
});
ROADMAPS.gitpulse.forEach(r => {
  r.run = { 'INIT-1': 'forge-develop:2', 'INIT-2': 'forge-develop:2', 'INIT-3': 'forge-develop:live' }[r.id] || null;
});

Object.assign(window, {
  COMMUNITY, COMMUNITY_HUBS, DRAFT_AGENT, DRAFT_FLOW, SHOWCASE, EXTRA,
  AGENT_INSTRUCTIONS, AGENT_MATERIALS, CONTRACT_STAGES, PROJECT_CONTRACTS, SKILL_FILES,
  LIVE_RUN, AGENT_RUN, CAND_DETAIL, NODE_LOGS,
  TRIGGERS, FLOW_RUNS, AGENT_RUNS, HOOK_FILES, SECURITY_SCANS, LIB_SOURCE,
  FLOWS, AGENTS, PROJECTS, BRAINS, KB_TREE, KB_DOC,
  SKILLS_LOCAL, SKILLS_COMMUNITY, HOOKS_LOCAL, HOOKS_COMMUNITY, CONNECTIONS,
  FLOW_HISTORY, AGENT_HISTORY, ATTENTION, CATALOG,
  TEMPLATES, GRAPHS, LINT_CHECKS, ROADMAPS, DEMO_ARTIFACTS, RUN_DETAILS, SESSIONS,
  PROVENANCE: { OOTB, OPERATOR, VISION },
});
