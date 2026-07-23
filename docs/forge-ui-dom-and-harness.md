# Forge-UI DOM contract & harness reference

> Moved out of `CLAUDE.md` (2026-07-19) to keep the always-injected project
> instructions lean — the per-route `data-*` inventory grew with every UI PR and
> is reference material most agents (and every non-UI subagent) never need.
> `CLAUDE.md` carries a short pointer here; sync this doc + the affected journey
> on any UI change via the `journey-sync` skill.

## forge-ui DOM-as-metrics convention

Every load-bearing UI state in `forge-ui/` is mirrored to `data-*`
attributes so any automation (playwright today, LLM-driven UI tests
tomorrow) can drive the page by reading structured DOM state rather
than scraping rendered text. Pattern from
[anthropics/cwc-workshops `how-we-claude-code`](https://github.com/anthropics/cwc-workshops/tree/main/how-we-claude-code).

Studio has no standalone `/dashboard` any more (retired M7, ADR-031) —
every route below owns its own `data-page="<name>"` root (+
`data-page-ready` once its first fetch settles), so this is a per-route
inventory rather than one shared page-level contract:

- **Library `/`** — the landing/browse surface: `[data-page="library"][data-page-ready]`,
  one `data-section` per pillar (`orientation`, `projects`, `agents`,
  `flows`, `kbs`). Right after the hero's Operator Pulse panel sits the
  cross-project **attention strip** (R4-11-F4, present once ≥1 project is
  registered) — `[data-section="attention-strip"]` wrapping one
  `[data-attention-item][data-attention-project]` link per project (a real
  `<a href="/projects/<id>">`, every item links through to its project's
  roadmap) carrying `data-attention-planned`, `data-attention-in-flight`,
  `data-attention-gated`, `data-attention-merged`, `data-attention-flagged`
  counts.
- **`/flows/[id]` — monitor + build.** `[data-page="flow-monitor"][data-flow-id][data-page-ready][data-run-count][data-can-start][data-active-tab]`
  (`data-active-tab` is `monitor | build`). MONITOR renders the run's hex
  topology (`FlowTopology.tsx`): each node is
  `[data-mon-node][data-node-id][data-status][data-hex-kind]`
  (`data-hex-kind` is `phase | wi`); phase hexes carry `data-phase-cost-usd`,
  WI hexes additionally carry `data-wi-cost-usd`; a fanned-out dev node's
  own aggregate carries `data-fanout-phase` rather than
  `data-hex-kind="phase"`. A single **flowLineage** run threads across
  chained flow definitions (`forge-architect` → `forge-develop` →
  `forge-reflect`) — each renders only its own slice of nodes, so
  switching `/flows/<flowId>` changes which hexes appear. BUILD renders
  the flow-as-data canvas: `[data-component="flow-header"][data-goal-set]`
  + `[data-component="flow-builder-canvas"][data-node-count][data-edge-count]`,
  per-node `[data-flow-node][data-node-id][data-agent-ref]`, and
  `[data-action="save-flow"|"clear-canvas"|"auto-layout"]`. The palette's
  agent chips (`AgentPalette.tsx`) carry
  `[data-palette-chip][data-chip-ref][data-chip-placeable]` — an interactive
  agent (per the F1 capability descriptor) renders greyed-out and
  `data-chip-placeable="false"`, disabling its own dragstart. A raw drop
  naming an interactive agent is rejected too (belt-and-suspenders, in
  `FlowBuilderCanvas.onDrop`), rendering
  `[data-component="canvas-drop-reject"][data-drop-reject-message]`.
- **`/artifact` — the unified gate/artifact viewer + the review/reflect
  redirect stubs.** `?run=<id>&type=plan|workitems|pr|demo|verdict|reflection&mode=gate|view`;
  root carries `[data-page="flows"][data-page-ready][data-run][data-artifact-type][data-mode][data-gate-state]`
  (that `data-page="flows"` value is the page's own literal, not a typo —
  every gate/artifact moment folded into this one route). `type=verdict&mode=gate`
  is the sole review gate: `[data-section="demo-comparison"]` /
  `[data-section="demo-evaluation"][data-ac-verdict]` (DemoComparison) plus
  the verdict form —
  `[data-component="verdict-form"][data-form-state][data-form-kind][data-initiative-id][data-ac-count]`
  (`data-form-state` is `editing | submitting | submitted`, `data-form-kind`
  is `approve | send-back`), submit button
  `[data-action="approve-and-merge"|"send-back"]`. `type=reflection&mode=view`
  is the sole reflection surface (interactive ReflectionGate above a
  read-only renderer). The old `/review/[cycleId]` and `/reflect/[cycleId]`
  routes are now permanent client-side redirects into `/artifact` (M7-3,
  ADR-031) — `[data-page="review-redirect"|"reflect-redirect"][data-page-ready="true"]`
  — kept only so stale bookmarks keep working.
- **`/agents/[id]`** — the agent builder: `[data-page="agents"][data-page-ready][data-agent-id][data-dirty]`;
  the catalog palette renders `[data-id]` chips; Advanced is collapsed by
  default (`[data-section="advanced"][data-advanced-open]`) behind which sit
  the capability drop zones `[data-accepts="skill"|"tool"|"mcp"|"hook"]`, a
  `[data-sdk]` runtime pick, and a `[data-ready-count]` readiness panel (6
  checks — purpose/skill/hook/process/interactivity content-completeness plus
  a `runtime` check sourced from the server-computed F1 capability descriptor,
  never re-derived client-side). The descriptor's `interactive` fact also
  surfaces as its own informational (non-gating) chip,
  `[data-capability-interactive]`. `/agents/new` shows the curated starter
  picker first (`[data-section="starter-picker"]`, per-option
  `[data-starter-option]`).
- **`/projects` + `/projects/[id]` — editor + roadmap.** Bare `/projects`
  just redirects to the first registered project
  (`[data-page="projects-index"]` while empty/loading). The project page is
  `[data-page="projects"][data-project-id][data-dirty][data-page-ready][data-demo-design-state]`
  with an Editor/Roadmap tab bar (`[data-tab="editor"|"roadmap"][data-tab-active]`).
  Roadmap renders `SerpentineTimeline.tsx`:
  `[data-roadmap-timeline][data-node-count]` with per-initiative
  `[data-roadmap-node][data-initiative-id][data-initiative-status]` and a
  pop-off detail card `[data-roadmap-popover][data-popover-initiative-id]`.
  Each pending initiative card also carries `[data-plan-state="unplanned"
  |"planning"|"planned"|"error"]` (`unplanned` = the R4-05
  `enqueuePlanRun`-derived `workItems === undefined` proxy — no decomposition
  has run yet): unplanned renders the `[data-action="plan-initiative"]`
  button plus a blocked-until-planned lock badge
  (`[data-section="initiative-blocked-until-planned"]`) that hides
  `[data-action="start-development"]` until the card flips to `planned`;
  dispatching a plan run surfaces `[data-action="open-plan-run"]` linking to
  the `forge-architect` flow monitor. A brand-new project renders
  `ProjectOnboardForm` instead:
  `[data-section="project-onboard"]`, collapsible
  `[data-section="onboard-advanced"][data-advanced-open]`, and a preflight
  check against the forge project contract —
  `[data-section="onboard-preflight"]` / `[data-section="failing-clauses"]`.
  A recoverable initiative (`in-flight | ready-for-review | failed` —
  deliberately excluding `merged`, a transient pass-through, and terminal
  `pending`/`done`) gets recovery affordances right on its `InitiativeCard`
  inside the popover (R4-11-T3, folded off the retired standalone
  `/recovery` page — see below): `[data-recovery-item][data-recovery-initiative]
  [data-recovery-status][data-recovery-attempt-count]` (+
  `[data-recovery-prior-attempts]` when a prior attempt exists) with
  `[data-action="recovery-inspect"|"recovery-requeue"|"recovery-abandon"]`
  buttons; inspecting expands
  `[data-section="recovery-detail"][data-recovery-detail-initiative]`
  (+ `[data-recovery-commits]` when the worktree has commits, and a
  `[data-recovery-note]` result line after requeue/abandon). The recovery
  API itself (`cli/bridge-recovery.ts`) is unchanged — only the UI moved.
- **`/architect/new` + `/architect/[sid]/interview`.** `/architect/new` is
  the native "start a run" entry that replaced the retired `/dashboard`
  launcher — `[data-page="architect-new"][data-page-ready]` wrapping the
  same idea box, `[data-section="new-idea"][data-new-idea-ready]`. The
  interview is a dedicated Studio-chrome screen —
  `[data-page="architect-interview"][data-page-ready][data-session-id][data-architect-phase]`
  — with the focused architect hex (`[data-architect-phase][data-architect-active]`,
  `[data-tool-burst]` chips) plus
  `[data-section="architect-interview"][data-architect-round][data-questions-answered]`,
  per-question `[data-question-index][data-question-resolved]`, per-option
  `[data-option-label][data-option-selected]`. A stalled session's
  StuckWarning (P1, `[data-architect-stale="true"][data-architect-stale-ms]`)
  carries a one-click re-run affordance (F5, R4-11-T5) —
  `[data-action="architect-rerun"][data-rerun-state="idle"|"rerunning"|"error"]`
  — that POSTs `/api/architect/rerun` to re-spawn the existing session's turn
  as-is (no answers/round mutation); the existing 3s session poll picks the
  resumed session back up. The bare
  `/architect/[sessionId]` route (no `/interview`) is now a permanent
  server-side redirect into `/architect/<sid>/interview` (M7-4, ADR-031) —
  the old standalone screen + its `design-decisions`/`escalation-id` PLAN
  gate are gone; the PLAN gate is just
  `/artifact?run=_architect-<sid>&type=plan&mode=gate` like any other gate.
- **`/instructions/[sid]`** — the AI-assisted AGENTS.md/instructions
  interview, sharing the same Studio-chrome shell and (deliberately) the
  same round/question/option attribute names as the architect interview:
  `[data-page="instructions-interview"][data-page-ready][data-session-id][data-instructions-phase]`,
  `[data-section="instructions-status"]`,
  `[data-section="instructions-interview"][data-architect-round][data-questions-answered]`.
  Its verdict form is
  `[data-component="instructions-verdict"][data-form-state][data-form-kind]`
  with `[data-action="approve-instructions"|"revise-instructions"|"reject-instructions"]`.
- **`/project-brain/[sid]`** — the onboarding Brain-3 builder:
  `[data-page="project-brain"][data-session-id][data-project-brain-phase]`
  stepping through
  `[data-section="brain-briefing"|"brain-analyzing"|"brain-review"|"brain-committing"|"brain-committed"|"brain-abandoned"]`
  (`brain-review` carries `data-theme-count`).
- **`/demo/[sid]`** — the per-project demo-page builder (brief → generate →
  lock, element-by-element): shares the Studio-chrome shell —
  `[data-page="demo-builder"][data-page-ready][data-session-id][data-demo-phase]`
  — with
  `[data-section="demo-target-element"|"demo-status"|"demo-history"|"demo-viewer"|"demo-process"]`.
- **`/knowledge` + `/knowledge/new`** — the knowledge-graph browser
  (`[data-page="knowledge"][data-page-ready]`) and the new-KB form
  (`[data-page="knowledge-new"][data-page-ready="true"][data-section="kb-new"]`; the create form's
  binding picker carries `data-field="kb-binding-kind"` + `data-field="kb-binding-ref"` — R1-01).
- **`/recovery`** — retired as a standalone page (R4-11-T3): the
  stuck-initiative inspect/requeue/abandon affordances folded onto the
  per-project roadmap's `InitiativeCard` (see `/projects/[id]` above). The
  route is now a permanent client-side redirect stub into `/` (bookmarks
  keep working) — `[data-page="recovery-redirect"][data-page-ready="true"]`.
- **`/skills`** — no standalone catalog route; the OOTB
  community-sourced skill library (`studio/catalog.yaml`, with provenance +
  stars) surfaces inside the agent builder's palette (`/agents/new`,
  `/agents/[id]`), editing an existing skill happens through that same
  `/agents/[id]` builder, and authoring a brand-new one is `/skills/new` —
  `[data-page="skill-builder"][data-page-ready="true"][data-section="skill-new"]`.

The shared status vocabularies:

- **Pipeline/WI 5-state** — `pending | active | complete | retrying |
  failed`. Was `forge-ui/lib/wi-status.ts` (now **deleted**); the type is
  inlined in [`forge-ui/lib/status-colors.ts`](./forge-ui/lib/status-colors.ts)
  (`WiStatus`) alongside [`forge-ui/lib/phases.ts`](./forge-ui/lib/phases.ts)
  (`PhaseStatus`) — same 5 values, one shared palette
  (`STATUS_COLOR` + `WI_STATUS_GLOW`) so a colour change happens in exactly
  one place. Yellow = retrying (transient error, still recovering); red =
  terminal failure only — sibling units stay in their own state
  independently.
- **Run lifecycle** (`RunStatus`, [`forge-ui/lib/studio-client.ts`](./forge-ui/lib/studio-client.ts)) —
  `planned | active | gated | complete | failed`.
- **Roadmap initiative status** (`SerpentineTimeline.tsx`) — `pending |
  in-flight | ready-for-review | merged | done | failed` (R4-11-F1: `merged`
  = PR confirmed merged, reflect pending — a transient `_queue/merged/`
  pass-through promoted to `done` in the same finalize sweep).
- **`HexKind`** ([`forge-ui/lib/monitor-layout.ts`](./forge-ui/lib/monitor-layout.ts)) —
  `phase | wi`, the phase-vs-WI distinction every monitor hex carries.

When changing component state, **add or update the corresponding
`data-*` attribute** alongside any visual change — and **sync the affected
UI journey in the same PR** (beats/checks + narration/clips): invoke the
`journey-sync` skill for the maintenance contract. The journeys are both the
demo and the UI regression gate; a UI change without its journey update either
breaks the gate or silently rots the demo.

The harness surface is **journeys-as-data**:
[`scripts/e2e-journey.mjs`](./scripts/e2e-journey.mjs) (`npm run ui:journey`)
is a thin runner over 9 user-story journeys in
[`scripts/journeys/`](./scripts/journeys/) — `stand-up-create`, `agents`,
`flows-author`, `stand-up-onboard`, `skills`, `flows-run`, `roadmap`,
`knowledge`, `demo-builder` — one file per journey (plus
`index.mjs`, the registry/run-order module — not itself a journey), each
mapping to a capability-diagram user story rather than a step of one
linear cycle. The standalone `swap-runtime` journey was retired
2026-07-17 — its checks folded into `agents`' `agents-scratch-build` beat,
which now drives the SDK/model picker as part of composing a brand-new
agent from scratch. Each journey is
`defineJourney({ id, title, story, beats })`
([`scripts/lib/journey-runtime.mjs`](./scripts/lib/journey-runtime.mjs));
a **beat** is a scripted story moment (`{ id, title, narration, drive(ctx) }`)
that is simultaneously a demo scene (captured as a clip/frame) AND a named
test case (auto-tagged into `demos/e2e/results.json` so every `check()`
traces back to the beat that raised it). Shared machinery:
[`scripts/lib/journey-assertions.mjs`](./scripts/lib/journey-assertions.mjs)
(the soft `check()` + the `data-*` DOM-as-metrics helpers) and
[`scripts/lib/journey-fixtures.mjs`](./scripts/lib/journey-fixtures.mjs)
(seeds + grounding — values are corpus-grounded, with code comments citing
real archived cycle artifacts under `_queue/done/` — e.g.
`INIT-2026-07-11-cli-sort-flag.md` — as provenance for things like the
architect's real cost/budget shape, not hand-waved numbers). The runner
supports `--list` (enumerate journeys/beats without running), a daemon
guard ([`scripts/lib/journey-daemon-guard.mjs`](./scripts/lib/journey-daemon-guard.mjs))
that refuses to run against a real live `forge serve`, and
finalize-neutralisation (strips `releaseProcess` from the grounding
project's config for the run's duration, so the emulated approve+merge
beat can't trigger a real release finalize). Output: a journey-sectioned
gallery (`demos/e2e/index.html`, one section per journey with its story +
a green/red check-count badge) plus 8 looping long-tail clips
(`demos/e2e/clips/*.webm`) and the tracked `demos/e2e/results.json` — the
video always finishes; a non-zero exit flags any DOM-as-metrics
regression. Cleans up all seeded state (architect/instructions/demo
sessions, cycle logs, queue manifests, the scratch flow it authored, any
`_guidance/*.md`) afterwards.

Plus [`scripts/e2e-deadpaths.mjs`](./scripts/e2e-deadpaths.mjs)
(`npm run ui:deadpaths`), the dead-route/no-op sweep, sharing the same
assertion module.

**Real-capability harness** — [`scripts/verify-cycle.mjs`](./scripts/verify-cycle.mjs)
(`npm run verify:cycle`) runs a **real** cycle end-to-end against a managed
project (auto-approve + closure + reflection capture). This is the standing
regression harness for forge's actual capabilities (ADR 022): it asserts
real-cycle *outcomes* (reached merge, dev-loop N/N, the project's own quality
gate green post-merge, cost under ceiling), as a manual gate. Two grounds:
**gitpulse** (`--project gitpulse` — the creds-free, independent reference
project; see `docs/verify-cycle-ideas/README.md` for the corpus of idea
files) and the **betterado terraform provider**
(`--project terraform-provider-betterado` — the live-ADO tier, higher
ceiling, plus a 5th gate asserting the demo carries **live REST
evidence**, not a test-name table). Tiered (frozen-SHA routine /
greenfield release).
