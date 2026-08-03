# Studio end-state prototype v2

Interactive mock of the target Forge Studio surface, built 2026-08-03 from the
operator's end-state page/flow diagram (`Untitled Diagram-Page-3.drawio`).
Review artifact for deriving the next UX-consistency backlog — not implementation.

## Run it

```bash
python3 -m http.server 4311 --directory mockups
# → http://localhost:4311/studio-endstate-v2/index.html
```

Multi-file React/Babel prototype (CDN React 18 + Babel standalone) — must be
served over HTTP; `file://` will not load the `.jsx` components.

## Design provenance

- Tokens, component vocabulary and the hexagon signature are lifted from
  `forge-ui/app/globals.css` (dark steel + ember; object-type colours:
  project=steel, agent=ember, flow=violet, kb=green, artifact=amber) — the
  "evolved current look" direction.
- IA is the diagram, 1:1 — six-pillar nav (Home / Flows / Agents / Projects /
  Library / Knowledge Bases), section sub-navs, builder+monitor pairs, the
  eight OOTB agents, OOTB brains/demo projects.
- Mock data is corpus-grounded (betterado / gitpulse / mdtoc, forge-develop
  dev→demo→adversarial-review→verdict, real brain theme counts). Objects that
  exist only in the end state carry `provenance: 'vision'` and render a
  `planned` badge.

## Deliberate evolutions to review

1. Home dashboard with hex-constellation live status (new surface).
2. One page-shell pattern everywhere (eyebrow / title / actions / sub-nav).
3. Flow monitor ≡ agent monitor (shared list + ledger vocabulary).
4. OOTB provenance badges on every shipped object.
5. KB detail: **Graph tab (default)** mirroring the live KbGraph language
   (green hex INDEX hubs, steel theme circles, faint raw dots, density
   presets, legend + counts) + operations toolbar + Health (named lint
   checks) / Browse / Ingest-activity tabs.
6. Google-Fonts load is mock-only; product would self-host (backlog item).

## Round-2 depth (adversarial-review pass, 2026-08-03)

- **Templates** as a 4th library pillar: demo outputs (HTML summary, video
  demo, screenshot set, interactive mockup), planning artifacts, and
  project-type scaffolds — each with a CSS-rendered preview thumbnail and a
  detail page (used-by agents, version history, definition).
- **Detail surfaces everywhere**: skills / hooks / connections / templates
  (`#/library/<kind>/<id>`), full project detail (`#/projects/detail/<id>`
  — roadmap table, demo-artifact gallery, cycle ledger, contract), and run
  detail (`#/flows/run/forge-develop:0` — node timeline w/ hex knots,
  review findings, evidence).
- **Agent sessions** (`#/agents/session/<id>`): the shared interactive
  surface for Architect/Planning (roadmap draft + visual aid), Demo Builder
  (generation gallery 1→3), Project Onboarding (contract progress) and
  Brain Creation (seeded structure). Chat left, living artifact right.
- Monitor ledger rows click through to run detail; agent monitor rows map
  to their flow's runs.

## Round-3: combined KB explore + journey videos (2026-08-03)

- **KB Explore** — graph and reader are ONE surface now (operator request):
  graph left, theme list + article right; clicking a node opens it in the
  reader. Tabs: Explore / Health / Ingest activity.
- **Journey engine** — `?journey=<id>` drives a scripted tour through the
  live mock: fake cursor, captions, and a scenario store (`window.SCN`)
  that actually mutates state (contracts flip green, new cards appear,
  lint heals). Scripts in `journeys-data.jsx`; player in
  `journey-player.jsx`; `data-j` attributes are the selector contract.
- **13 north-star journeys** captured headless (Playwright recordVideo →
  mp4) into `journeys/`: onboard-project, create-project, create-agent,
  edit-agent, create-flow, edit-flow, build-hook, build-skill,
  install-connections, create-kb-project, create-kb-cycle, kb-maintain,
  install-skills-hooks.
- New surfaces backing them: community browser (`#/library/community`,
  install-state per object), project-create scaffold picker, demo
  showcase (`#/projects/showcase/<id>`), creation/maintenance sessions
  (build-hook, build-skill, kb-cleanup, create-project,
  brain-creation-cycle), draft states in both builders.

Re-capture videos: `node <scratch>/capture-journeys.mjs` with the mockups
dir served on :4311 (any static server; script path may be recreated from
README history — it just loops `?journey=<id>` and waits for
`body[data-journey-done]`).

## Round-4 + Round-5 (review passes 2026-08-03)

- Hooks + skills are GENERIC definitions (lifecycle event + guard / package);
  binding to an agent happens only in the Agent Builder — journeys do the
  real bind there. "Carried by" derives from agent specs.
- Builders fully stateful: click/drag-add, selector dropdowns, instructions
  generation, allowed-input-materials config; flow inspector: fan-out,
  typed hand-off artifacts, bands, gates; canvas auto-scrolls to new nodes;
  flow nodes carry the hex identity.
- Kickoffs (flow/agent/KB-scope) + input-materials upload; live-run monitor
  with verdict gate; run detail nodes click-through to full agent logs
  (think/tool/out); run-agent output candidates expand to full
  initiative-spec shape.
- Sessions progressive (turn-by-turn) with staged artifacts: AGENTS.md
  north-star, secrets (names only), demo, roadmap — and the project page
  now SHOWS the north star/conventions/gates/secrets permanently.
- Skill packages: SKILL.md + scripts + templates, tabbed in the session.
- KB Explore graph is force-directed: clusters via hub anchors + edge
  tension, draggable nodes with reactive neighbours, tension presets.
- Community browser: source-hub strip + per-row hub signals.
- 15 journeys re-captured. NOTE: keep a tar backup outside the repo —
  a concurrent forge session once wiped this untracked directory
  (recovered from Claude Code file-history + scratchpad videos).

## Round-6 (review pass 3, 2026-08-03)

- Flow topology is HEX nodes (mirrors the real FlowBuilderCanvas: 96×88
  frame, dot + name + gate/fan-out badges, mono ref label) rendered as a
  COLUMN DAG: parallel branches (⑂ branch after a node), typed hand-offs
  (next agent takes the previous output as input), join nodes that wait
  for all inputs, band rule enforced (plan/develop = any lines,
  review/reflect = one line).
- Project pages: roadmap as a dependency DAG + every initiative with a
  run digs straight into its node-by-node breakdown (completed included).
- Run consolidation: one Run button everywhere — sessions for interactive
  agents, kickoff for workers. Triggers are first-class + per-project:
  manual / on-completion / project hooks (PR merged, issue raised) —
  shown in builders, kickoffs and on live runs.
- Every agent fully specified: instructions + allowed input materials;
  two new example agents (Demo Design, Research) for the parallel-intake
  pattern.
- Library detail pages per kind (community items too, pre-install):
  packages (SKILL.md + scripts / hook.yaml + guard script), hub + backing
  repo links, MCP capability lists (kind-appropriate, not the repo),
  used-by, versions, and a SECURITY SCAN for hooks.
- Journey fan-out: 27 videos — the original 15 (upgraded) + a run journey
  per OOTB agent and flow, covering all three trigger types.

## Round-7 closeout (2026-08-03)

- Agent monitor history rows link where each run ACTUALLY happened: flow
  run, standalone agent run, or interactive session (STANDALONE marked).
- Project roadmap moved to its own full-page tab (Overview | Roadmap):
  big DAG + initiative table; overview keeps the compact table.
- Cost ceiling editable on both kickoff screens (per-kickoff limit).
- `as-built-inventory.md` — the 2026-08-03 as-built surface recon this
  mockup diffs against. `BACKLOG-CUT-PROMPT.md` — the ready-to-run prompt
  for the backlog-cutting session.
