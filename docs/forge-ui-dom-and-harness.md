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
  counts. Each flow card (`LibraryCard.tsx` `FlowCard`) carries one badge per
  declared trigger — `[data-trigger-badge]` (value is the trigger's `on` kind)
  with a `title="<kind> → <target ref>"` tooltip (R2-04-F4).
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
  A clicked node opens `[data-component="node-mini-panel"][data-panel-node-id]`
  with its modifier toggles: `[data-modifier="gate"] [data-action="toggle-gate"]`
  and (R2-03-F3) `[data-modifier="fanout"][data-fanout-capable]
  [data-action="toggle-fanout"]` — the fanout toggle is **enabled only on a
  fanout-capable agent** (`capability.fanoutCapable`, the same wire fact
  `validateFlow`'s `fanout-capability` check lints), disabled + greyed
  otherwise, and binds the node `fanOut` to the agent's declared
  `fanout.drivingArtifact` rather than a hardcoded artifact.
  Triggers (R2-04-F4, `FlowHeader.tsx`, under Advanced): a kind selector
  `[data-field="trigger-kind"]` offers exactly the four SHIPPED kinds
  (`flow-complete | merged | cron | webhook` — a hand-kept client mirror of
  orchestrator/flow-trigger.ts's `SHIPPED_TRIGGER_KIND_IDS`, the SSOT;
  registry-reserved kinds are never offered) and a target-flow select
  `[data-field="trigger-target"]` shared by all four (every kind fires a
  flow; agent targets are schema-ready but not authorable, R4-09). `cron`
  additionally renders `[data-field="trigger-schedule"][data-schedule-invalid]`
  (client-side croner syntax check — UX only, `orchestrator/studio/validate.ts`'s
  `trigger-cron` check is authoritative on save) and
  `[data-field="trigger-concurrency"]` (`allow|forbid`). `webhook` additionally
  renders `[data-field="webhook-id"|"webhook-provider"|"webhook-secret-env"|"webhook-sources"]`
  plus per-event checkboxes `[data-field="webhook-events"][data-event-value="push"|"release"]`,
  and a read-only endpoint display `[data-hook-url="/api/hooks/<id>"]`. Adding
  a trigger (`[data-action="add-trigger"]`, disabled until the kind's
  required fields are complete) appends a chip
  `[data-trigger-chip][data-trigger-kind]` (chip value is the target flow's
  id; kind is the trigger's `on`).
- **`/artifact` — the unified gate/artifact viewer + the review/reflect
  redirect stubs.** `?run=<id>&type=plan|workitems|pr|demo|verdict|reflection&mode=gate|view`;
  root carries `[data-page="flows"][data-page-ready][data-run][data-artifact-type][data-mode][data-gate-state]`
  (that `data-page="flows"` value is the page's own literal, not a typo —
  every gate/artifact moment folded into this one route). `type=verdict&mode=gate`
  is the sole review gate: the adversarial-review findings panel (R4-08-F3,
  rendered in BOTH verdict modes when the artifact exists; absent ⇒ nothing) —
  `[data-section="review-findings"][data-findings-count]` with per-row
  `[data-finding][data-finding-severity="blocker|major|minor|info"][data-finding-category]`
  — then `[data-section="demo-comparison"]` /
  `[data-section="demo-evaluation"][data-ac-verdict]` (DemoComparison) plus
  the verdict form —
  `[data-component="verdict-form"][data-form-state][data-form-kind][data-initiative-id][data-ac-count]`
  (`data-form-state` is `editing | submitting | submitted`, `data-form-kind`
  is `approve | send-back`), submit button
  `[data-action="approve-and-merge"|"send-back"]`. View-mode verdict renders
  the stamp with `[data-verdict-decision="approve|send-back"]` (mapped from the
  on-disk VerdictRecord via `verdictRecordToDoc` — R4-08-F3 fixed the raw-shape
  passthrough that rendered every verdict "Approved"). `type=reflection&mode=view`
  is the sole reflection surface (interactive ReflectionGate above a
  read-only renderer). The **ReflectionGate** data-* contract:
  `[data-section="reflect-questions"]` wraps the live form, each question a
  `[data-question-index][data-question-mode="options|freeform"][data-question-resolved]`
  fieldset — options render `[data-option-label][data-option-selected]`, a
  freeform question a `[data-question-freeform]` textarea; below the list a
  `[data-field="freeform"]` notes box and a `[data-action="submit-reflection"]`
  button gated on all-answered; once submitted (or `answered`)
  `[data-section="reflect-done"]`. **R4-09-F3 automated mode:** when the reflector
  self-answered (every question inferred), the gate renders a read-only view —
  `[data-section="reflect-questions"][data-reflect-automated="true"]`, each
  fieldset `[data-question-inferred="true"]` (the interactive form stamps
  `"false"`) with a `[data-question-inferred-badge]` and the inferred
  `[data-question-answer]`, and NO submit button. The old `/review/[cycleId]` and `/reflect/[cycleId]`
  routes are now permanent client-side redirects into `/artifact` (M7-3,
  ADR-031) — `[data-page="review-redirect"|"reflect-redirect"][data-page-ready="true"]`
  — kept only so stale bookmarks keep working.
- **`/hooks`, `/hooks/[id]`, `/hooks/new`** (R3-03-F4) — the hooks pillar. A
  library "hook" is an **agent-lifecycle customisation** and a FILE PACKAGE
  (`studio/hooks/<id>/hook.yaml` + its scripts), generic and host-agnostic;
  a definition names the event and the script and never a binding. Root:
  `main[data-page="hook-library"][data-page-ready][data-hook-count][data-needs-review-count]`,
  per card
  `[data-card-type="hook"][data-hook-id][data-hook-event][data-hook-verdict][data-hook-trust][data-hook-carried-by-count]`.
  `data-hook-carried-by-count` is DERIVED from every real agent's
  `composition.hooks` and the derivation names its own scan, so an empty count
  reads "scanned N, found none" and never "unknown". There is deliberately **no
  Local/Community split and no install affordance** — unlike `/skills`, there is
  no community-hook source to back either, and fabricating the distinction would
  be inventing data; the install entry point is R3-07's.
  `[data-action="new-hook"]` links to
  `main[data-page="hook-builder"][data-page-ready][data-section="hook-new"]`
  (fields `[data-field="hook-name"|"hook-description"|"hook-on"|"hook-matcher"|"hook-script-body"|"hook-permissions-env"|"hook-permissions-read"|"hook-permissions-network"]`,
  `[data-action="create-hook"]`).
  `/hooks/[id]` is
  `main[data-page="hook-detail"][data-hook-id][data-page-ready][data-hook-event][data-hook-verdict][data-hook-trust][data-hook-runnable]`
  — the last four are ABSENT while loading, on a fetch error and for an unknown
  id; no verdict is ever fabricated. It reuses the shared
  `[data-component="file-package"]` renderer R3-01 built, and adds the
  **SECURITY SCAN** panel
  `[data-section="scan-report"][data-scan-verdict][data-finding-count][data-critical-count]`
  with per-finding
  `[data-finding-category][data-finding-severity][data-finding-declared]`.
  `data-finding-declared` matters: a behaviour the manifest DECLARES is
  downgraded but still rendered and still counted — never hidden — because the
  gate exists so a human can decide whether to run this code with their
  credentials, and the declaration is written by the same untrusted party as the
  script. `data-hook-verdict` and `data-hook-trust` are **two independent axes**:
  an overridden hook still reads `verdict="blocked"`, which is the honest record
  of an operator decision. `[data-action="approve-hook"]` is enabled only when
  the verdict is not blocked and trust is `needs-review`;
  `[data-action="override-hook-block"]` + `[data-field="override-reason"]` only
  when it IS blocked — approval can never launder a blocked verdict.
- **`/connections`, `/connections/[id]`** (R3-04-F2/F3) — the connections
  pillar: curated tools/MCP servers read from `studio/catalog.yaml`'s
  `tools:`/`mcps:` sections (D2: kind is structural — `tool`|`mcp` — never a
  third invented kind), with readiness EXECUTED per entry on every request,
  never declared (D3). There is deliberately **no create/edit/delete route
  anywhere** — curation is a PR to `catalog.yaml` (D1); the only mutating
  routes act on the environment (`install`/`probe`), never a definition.
  Root: `main[data-page="connection-library"][data-page-ready]
  [data-connection-count][data-available-count][data-not-installed-count]
  [data-misconfigured-count]`, a search field
  `[data-field="connection-search"]`, and a `[data-component="fetch-error"]`
  block when the bridge is unreachable (never rendered the same as a
  genuinely empty library). Per card `[data-card-type="connection"]
  [data-connection-id][data-connection-kind="tool"|"mcp"]
  [data-connection-state="available"|"not-installed"|"misconfigured"]`.
  `/connections/[id]` root: `main[data-page="connection-detail"]
  [data-connection-id][data-page-ready][data-connection-kind]
  [data-connection-state][data-connection-installable]
  [data-connection-install-method]` (the last four ABSENT while loading, on a
  fetch error, or for an unknown/uncomposable id — no state is ever
  fabricated). Install section: `[data-section="install"]
  [data-install-method][data-install-action="available"|"none"]`, with
  `[data-install-version]` for a pinned npm entry;
  `[data-action="install-connection"]` renders ONLY when `installable` is
  true — a `system-provided`/`external` entry has no install control at all,
  structural absence, not a disabled button (F2 AC). An install outcome
  renders `[data-component="install-outcome"]
  [data-install-outcome-status="installed"|"suppressed"|"failed"]`, a
  suppressed result additionally carrying `[data-would-install-argv]` (the
  real argv, never executed — every harness that drives this button runs
  under the dry-bridge/no-spawn suppression, D7: no journey ever performs a
  network install). Config schema: `[data-section="config-schema"]
  [data-config-count]`, per row `[data-config-env][data-config-required]
  [data-config-status="set"|"unset"|"unchecked"]` — NAMES only (D5); an
  optional var's presence is never probed, so it reads `unchecked` rather
  than a guessed set/unset. Capabilities (MCP only, when the catalog entry
  declares them): `[data-section="capabilities"]
  [data-capabilities-source="curated"][data-capability-count]` — labelled
  curated, never presented as a verified live capability list of a running
  server (D8: forge has no MCP client to launch and introspect one).  Probe
  evidence: `[data-section="probe-evidence"][data-probe-state]
  [data-probe-timed-out]` plus, when present, `[data-probe-exit-code]
  [data-probe-missing-config][data-probe-stdout][data-probe-stderr]` (real
  captured output, never a generic error string — F2 AC) and a re-check
  button `[data-action="probe-connection"]`. Used-by: `[data-section="used-by"]
  [data-used-by-count]`, per agent `[data-used-by-agent]` — DERIVED from real
  `composition.tools`/`composition.mcps`, never declared, so an empty list
  reads "scanned N, found none". Action errors surface as
  `[data-component="connection-action-error"]`.

- **`/community`, `/community/[kind]/[id]`** (R3-07-F1/F2/F3) — the ONE
  cross-kind community browser over skill/hook/mcp/tool, the surface `/skills`,
  `/hooks` and `/connections` all link into via `[data-action="browse-community"]`
  (a real `<a href="/community">` on each of the three). It owns **ZERO trust
  decisions** (D2) — no approve, no override, no re-pin affordance exists
  anywhere on this surface; install ROUTES to whichever pipeline owns the
  kind (R3-01-F4 skills, R3-03-F2 hooks, R3-04-F2 connections) and the trust
  decision (if the kind has one) happens only on that pipeline's own owning
  page. There is deliberately **no create/edit/approve route under
  `/community` anywhere** — curation of what's browsable stays forge-dev-owned
  (a PR to `studio/catalog.yaml` / a vendored package under
  `studio/community/`), mirroring `/connections`'s own D1 negative AC.
  Root: `main[data-page="community-browser"][data-page-ready][data-item-count]
  [data-kind-filter="all"|"skill"|"hook"|"mcp"|"tool"][data-hub-count]`, a
  search field `[data-field="community-search"]`, kind-filter buttons
  `[data-action="filter-kind"][data-kind]`, and
  `[data-component="fetch-error"]` when the bridge is unreachable (never
  rendered the same as a genuinely empty index — the same discipline
  `/connections` and `/skills` already hold). `[data-component="hub-strip"]`
  renders every real hub from `studio/community/hubs.yaml`, per hub
  `[data-hub-id][data-hub-kinds][data-hub-item-count]` — the count is DERIVED
  per request, never declared, so a real hub with nothing indexed from it yet
  renders a genuine `"0"` rather than being dropped from the strip (the
  honest-zero case). Per card: `[data-card-type="community-item"]
  [data-item-id][data-item-kind][data-item-hub][data-install-state]
  [data-has-signals="true"|"false"]` — `data-item-hub` is simply ABSENT for an
  unaffiliated item (the rendered label is the spec-literal "unaffiliated",
  never invented as an attribute value), and `data-has-signals="false"`
  renders "no signals published" rather than a fabricated zero.
  `/community/[kind]/[id]` root: `main[data-page="community-detail"]
  [data-item-id][data-page-ready]` plus, **present ONLY once the item
  resolves** (`[data-item-kind][data-install-state]` are ABSENT while
  loading, on a fetch error, and for an unknown kind/id — an unvalidated
  route param is never asserted as fact before the server confirms it):
  `[data-section="hub-signals"]` (`[data-hub-id]` present only for a matched
  hub, a signal-attribution attribute present only when the source record
  actually carries signals — D4/D5, no invented hub name or signal figure
  ever renders); `[data-component="file-package"]` for a skill/hook (the SAME
  shared renderer `/skills/[id]` and `/hooks/[id]` use);
  `[data-section="security-scan"][data-scan-verdict][data-finding-count]
  [data-critical-count]` for a hook — the REAL pre-install scan, run on the
  vendored bytes before any install exists, distinct from (but computed by
  the same scanner as) `/hooks/[id]`'s own `[data-section="scan-report"]`;
  `[data-section="capabilities"][data-capabilities-source="curated"]
  [data-capability-count]` for an mcp/tool that declares any, mirroring
  `/connections/[id]`'s own labelled-curated convention exactly. For an
  mcp/tool, `[data-section="install"]` ALSO carries
  `[data-install-method="system-provided"|"npm"|"external"]` (fixed
  2026-08-05, R3-07 journey-found defect: R3-04-F4's whole posture is that
  every installable entry pins an exact version, and this pre-install page's
  entire reason to exist is showing the operator what they're approving
  BEFORE they click install — the pin was previously never rendered here at
  all) — an `npm` entry additionally renders `[data-install-version]` with
  the exact pinned version, the SAME vocabulary `/connections/[id]`'s own
  InstallSection uses, never a second one; `system-provided`/`external` have
  no version to pin and render no `data-install-version` at all — structural
  absence, not an empty attribute. This is separate from, and precedes, the
  ONE mutating affordance: `[data-action="install-community-item"]
  [data-install-routed-to="skill-draft"|"hook-needs-approval"|"connection-install"]`
  — **structurally ABSENT, not disabled,** whenever the route cannot
  complete: a non-vendored skill/hook with no server-resolved install path
  renders no button at all, and an already-present item renders "\<state\>
  already — continue at \<owning page\>" instead of a second control. The
  install outcome renders `[data-component="install-outcome"]` — for
  skill/hook, the text states "Installed as a draft." (or "Already
  installed.") and links to the owning page where its approval gate (if any)
  lives; for a connection under this harness's no-spawn suppression, a
  `[data-would-install-argv]` element carries the real, never-executed argv
  (there is deliberately no separate `data-install-outcome-status` attribute
  on this surface — the suppressed/success/failed distinction is carried in
  the outcome text and the presence of `[data-would-install-argv]` itself,
  the same signal `[data-page="community-detail"]`'s own `data-install-state`
  independently confirms by staying `"not-installed"` after a suppressed
  attempt). Action errors surface as `[data-component="community-action-error"]`.

- **`/agents/[id]`** — the agent builder: `[data-page="agents"][data-page-ready][data-agent-id][data-dirty]`;
  the catalog palette renders `[data-id]` chips; Advanced is collapsed by
  default (`[data-section="advanced"][data-advanced-open]`) behind which sit
  the capability drop zones
  `[data-accepts="skill"|"tool"|"mcp"|"guard"|"hook"]` — `guard` and `hook` are
  two DISTINCT zones with distinct styling and must never merge; keeping those
  vocabularies apart is the whole reason R3-03 renamed `composition.hooks` to
  `composition.guards` before reintroducing `composition.hooks` for library
  lifecycle hooks — a
  `[data-sdk]` runtime pick, and a `[data-ready-count]` readiness panel (6
  checks — purpose/skill/guard/process/interactivity content-completeness plus
  a `runtime` check sourced from the server-computed F1 capability descriptor,
  never re-derived client-side — **plus a 7th, conditional `connections`
  check** (R3-04-F3): appended ONLY for an agent that binds at least one
  tool/MCP (an agent binding none has nothing to be ready about, and a 7th
  check that always passes would silently redefine the six-check contract
  every other agent surface relies on) once the independently-fetched
  connections library resolves. `[data-check="connections"]` reads NOT ready
  whenever any bound tool/MCP's REAL probe state isn't `available`, its
  `title` naming the component and state (e.g. `mcp "memory"
  (not-installed)`) rather than a generic "not ready";
  `[data-ready-count]` excludes it while unready. The
  descriptor's `interactive` fact also surfaces as its own informational
  (non-gating) chip,
  `[data-capability-interactive]`. A saved **non-interactive** agent gets a run
  surface (R2-01-F3 generic run host): `[data-section="agent-run"]
  [data-run-dispatchable="true"]` with a `[data-action="run-agent"]` button, a
  generic `[data-run-inputs]` textarea (one `key: value` per line → the run
  host's `inputs` map — e.g. the onboarding agent's `repo`/`northStar`), and
  `[data-run-id][data-run-status][data-run-cost]` (idle values `""` / `idle` /
  `0` before dispatch; after dispatch they reflect the polled `GET
  /api/agents/runs/:runId`, `running` → `done`/`failed`/`suppressed`). The SAME
  section also carries `[data-run-blocked="true"|"false"]` (R3-04-F3/D9.3):
  true whenever any bound tool/MCP is not real probe-`available`, in which
  case `[data-component="connection-run-block"]` renders the exact
  blocked-run message naming the component and its state and the Run button
  is disabled — the UI-layer mirror of the SAME block
  `orchestrator/run-agent.ts` enforces pre-spawn and the bridge run route
  enforces server-side (D9.1/D9.2), never the UI's own invention. An
  **interactive** agent instead renders `[data-section="agent-run"]
  [data-run-dispatchable="false"]` with no run button — it keeps its bespoke
  session page. `/agents/new` shows the curated starter picker first
  (`[data-section="starter-picker"]`, per-option `[data-starter-option]`).
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
  the `forge-architect` flow monitor. Every popped initiative card carries
  `[data-link="demo-builder"]` (R4-07-F3) — switches to the editor tab's Demo
  Timeline (+ inline builder panel), tying demo upkeep to initiative state.
  A brand-new project renders
  `ProjectOnboardForm` instead:
  `[data-section="project-onboard"]`, collapsible
  `[data-section="onboard-advanced"][data-advanced-open]`, and a preflight
  check against the forge project contract —
  `[data-section="onboard-preflight"]` / `[data-section="failing-clauses"]`.
  Alongside it, the R4-03 greenfield **create-from-template** form:
  `[data-section="project-create"][data-app-type-count]` with
  `[data-field="create-name"]` / `[data-field="create-north-star"]` /
  `[data-field="create-app-type"]` (a `<select>` of curated app types) and a
  `[data-action="create-project"]` button — scaffolds a contract-green project
  from a framework template and navigates to its page.
  An existing project's editor aside carries the R4-02-F1 second onboarding
  entry point: `[data-section="onboard-with-agent"]` with a
  `[data-action="run-onboarding-agent"]` button that dispatches the
  onboarding agent through the SAME runner as `/agents/[id]`'s RunPanel
  (`dispatchAgentRun('onboarding-agent', {project})`); `[data-onboard-run-id]`
  carries the dispatched runId.
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
- **Session-shell read contract (R2-10-F1/F2, 2026-08-05) — the API side.**
  The three session routes above converge on one shared shell. Its data comes
  from a single read route, `GET /api/studio/sessions/:kind/:sessionId?project=<p>`
  (`cli/bridge-studio-sessions.ts`), which returns
  `{ok, kind, sessionId, project, phase, stages, defaultStage, turns, artifact}`.
  Session kinds are declared as data in `studio/session-kinds.yaml` and validated
  by `forge studio lint` (`validateSessionKinds`, ADR-027's R2-10 amendment).
  `turns` are DERIVED from the runners' existing checkpoint files — each turn
  carries the `source` it came from (`idea.md`, `prompt.md`,
  `answers.json#round-N`, `questions.json`, `feedback.md`) — never invented. A
  checkpoint stage outside the kind's declared `stages` is a **409**, never a
  defaulted 200. The `data-*` vocabulary the consuming shell attaches to this
  payload — `data-session-kind`, `data-session-stage`, `data-session-phase`,
  `data-turn-index`, `data-turn-role`, `data-turn-stage`, `data-artifact-kind`
  — is named here as the contract; the surface that attaches it lands with the
  shell route itself.
- **Demo builder — inline on `/projects/[id]` (R1-03-F2, 2026-07-24):** the
  per-project demo-page builder (brief → generate → lock, element-by-element)
  is an inline panel on the project page, opened by
  `[data-action="launch-demo-builder"]` / a `?demo=<sid>` deep link:
  `[data-section="demo-builder-panel"][data-demo-session][data-demo-phase]`
  containing the preserved inner contract —
  `[data-section="session-briefing"|"demo-target-element"|"demo-status"|"demo-history"|"demo-viewer"|"demo-process"]`,
  `[data-component="demo-review"]`, `[data-demo-iframe]`,
  `[data-action="submit-brief"|"lock-demo"|"abandon-demo"|"iterate-element"|"view-element-output"|"close-demo-panel"]`
  plus a compact `[data-section="demo-status-strip"]`. The old detached
  `/demo/[sid]` route is a redirect stub
  (`[data-page="demo-builder-redirect"]` → `/projects/<id>?demo=<sid>`).
- **`/knowledge` + `/knowledge/new`** — the knowledge-graph browser
  (`[data-page="knowledge"][data-page-ready]`) and the new-KB form
  (`[data-page="knowledge-new"][data-page-ready="true"][data-section="kb-new"]`; the create form's
  binding picker carries `data-field="kb-binding-kind"` + `data-field="kb-binding-ref"` — R1-01).
- **`/recovery`** — retired as a standalone page (R4-11-T3): the
  stuck-initiative inspect/requeue/abandon affordances folded onto the
  per-project roadmap's `InitiativeCard` (see `/projects/[id]` above). The
  route is now a permanent client-side redirect stub into `/` (bookmarks
  keep working) — `[data-page="recovery-redirect"][data-page-ready="true"]`.
- **`/skills` + `/skills/new` + `/skills/[id]` — the skills library (R3-01-F3/F4).**
  The OOTB community-sourced skills (`studio/catalog.yaml`, with provenance +
  stars) still surface as draggable chips inside the agent builder's palette
  (`/agents/new`, `/agents/[id]`) — that union is unchanged — but `/skills` is
  now a real standalone library route, not just a palette. Root:
  `main[data-page="skill-library"][data-page-ready][data-community-join="pending"|"ready"|"unavailable"][data-skill-count][data-local-count][data-community-count]`
  over two sections (Local — hand-authored or already-installed skills on
  disk; Community — catalog entries with no on-disk package yet), whose
  counts always equal the rendered card count in each section.
  `data-community-join` is a SEPARATE readiness signal from `data-page-ready`
  (fixed 2026-08-05, R3-07 journey-found defect): the primary skill list is
  deliberately not raced by the community-index fetch that backs the hub/
  signals join (a slow or unreachable community index must never blank the
  primary list), so `data-page-ready` flips on the primary fetch alone while
  `data-community-join` independently tracks the join's own three real
  states — `pending` (join fetch still in flight — a card's `data-skill-hub`/
  `data-skill-has-signals` are not yet trustworthy), `ready` (join resolved —
  those two attributes now reflect real data), `unavailable` (the community
  fetch failed — every card still renders with no hub/signals, honestly, not
  a guessed value). Before this fix all three states rendered identically
  (the attributes simply absent), which automation waiting on
  `data-page-ready` alone could read as "no hub" when the join had not even
  resolved yet. Per card:
  `[data-card-type="skill"][data-skill-id][data-skill-source="local"|"community"][data-skill-trust="ready"|"draft"|"needs-review"][data-skill-installed="true"|"false"][data-skill-used-by-count]`
  — `data-skill-used-by-count` is DERIVED from every real agent's
  `composition.skills`, never a declared/catalog field (the `composedBy`
  catalog field this replaced was deleted — all 8 of its claims were false).
  `[data-action="new-skill"]` is the ONE place "New skill" lives (D8) —
  it links to the unchanged builder at `/skills/new`
  (`[data-page="skill-builder"][data-page-ready="true"][data-section="skill-new"]`,
  fields `[data-field="skill-name"|"skill-description"|"skill-body"]`,
  `[data-action="create-skill"]`).
  **R3-07 update (2026-08-05): the per-card manual install affordance was
  REMOVED.** `[data-action="install-skill"]`, `[data-install-skill-id]`, and
  the card-local `[data-install-state]` no longer exist — that box (a
  local-directory path typed by the operator) was driven by zero journey
  beats and zero ATs (verified by grep before deletion), and the cross-kind
  `[data-action="browse-community"]` link now beside the search field is the
  ONE real install entry point for every kind, routing installs through this
  same F4 pipeline unchanged (see the `/community` entry below). Two new
  attributes join a card whose `data-skill-source="community"`, carrying the
  join `/community`'s own index performs — fetched independently from `GET
  /api/studio/community` and matched on (kind, id), never on id alone (a
  local hand-authored skill sharing an id with a catalog entry must never
  inherit its hub/signals): `[data-skill-hub]` (the DERIVED hub id; an
  unmatched entry simply omits the attribute — `unaffiliated` is a rendered
  label, never a fabricated attribute value) and
  `[data-skill-has-signals="true"|"false"]` (real hub-attributed stars vs. an
  honest "no signals published" — never a guessed zero). Both are absent for
  a `data-skill-source="local"` card, including one that started life as a
  vendored community install: once installed, filesystem wins on existence
  (D5) — the card is local from that point on, not permanently badged
  "community".
  `/skills/[id]` is the real per-skill detail page —
  `main[data-page="skill-detail"][data-skill-id][data-page-ready]` — with
  `data-skill-trust`/`data-skill-source` present ONLY once a real value is
  known (deliberately ABSENT while loading, on a bridge-fetch error, and for
  an unknown id — no fabricated trust value is ever rendered). Three other
  non-`ready` page states: `[data-component="fetch-error"]` (bridge
  unreachable), a plain not-found message (neither on disk nor in the
  catalog), and `[data-component="not-installed"]` (a community catalog entry
  with no on-disk package yet — the bridge 404s for it by design, D2). The
  `ready` state renders `[data-component="file-package"][data-file-count][data-active-file]`
  (SKILL.md plus every supporting file, tabbed; shared with R2-10-F3 —
  `forge-ui/components/studio/FilePackage.tsx` is kind-agnostic) with per-tab
  `[data-file-tab][data-file-path]`; `[data-section="used-by"][data-used-by-count]`
  with per-agent `[data-used-by-agent]` (an empty list renders an explicit
  "Unbound" message, never a blank panel); `[data-section="provenance"][data-content-hash][data-upstream-source]`
  (`data-upstream-ref` only when the install supplied one — D6, never
  inferred) when the skill has a provenance block; for a `draft` install,
  `[data-section="approval-gate"]` holding the full SKILL.md body plus
  `[data-section="scan-report"][data-quarantined-count][data-executable-count]`
  (D5: facts only, no clean/pass/severity field) and
  `[data-action="approve-skill"]`; for `needs-review`,
  `[data-section="needs-review"]` stating the hash drift in plain language.
  Approval never restores `runtime`/`allowed-tools` (D4) — an installed
  community skill is a plain composable skill forever, quarantined
  permanently; making it a runnable agent is a separate, explicit act in the
  Agent Builder.
- **`/templates` + `/templates/[id]` — the templates library (R3-06).** One
  registry unifying three previously-siloed on-disk sources into a single
  browsable library: `studio/artifact-templates/*.md` (category `planning`,
  7 templates — `plan`, `work-items`, `wi-branches`, `pr`, `verdict`,
  `demo-fix-spec`, `review-findings`), `studio/demo-elements/*.md` (category
  `demo-output`, 6 templates — `screenshot`, `cli-capture`, `code-diff`,
  `api-verify`, `test-evidence`, `narrative`), and
  `studio/starters/projects/<id>/` (category `project-scaffold`, 3 scaffolds
  — `typescript-api`, `typescript-cli`, `typescript-web`); 16 entries total
  (`orchestrator/studio/template-library.ts`). `usedBy` is DERIVED, never a
  declared field: planning usage scans the real flow graph
  (`studio/flows/*/flow.yaml` edges); demo-output usage scans every project's
  `.forge/project.json` `demoProcess[].element`; project-scaffold usage is
  honestly empty — `appType` is validated against the starter list at
  project-create time but never persisted, so no on-disk source records
  which scaffold produced a project (a file-shape heuristic would be
  fabrication, not derivation). `/templates` root:
  `main[data-page="template-library"][data-page-ready][data-template-count][data-planning-count][data-demo-output-count][data-project-scaffold-count]`.
  Per card: `[data-card-type="template"][data-template-id][data-template-category="demo-output"|"planning"|"project-scaffold"]`,
  `[data-template-preview="html"|"video"|"shots"|"mock"|"doc"|"scaffold"]`
  (a CSS-approximation preview kind, class `tpl-preview-<kind>`; omitted only
  when the definition failed to parse), `[data-template-used-by-count]`. The
  search box is `[data-field="template-search"]` (case-insensitive match on
  name + description); a bridge-unreachable state renders
  `[data-component="fetch-error"]`, never conflated with a genuinely empty
  library. `/templates/[id]` root:
  `main[data-page="template-detail"][data-template-id][data-page-ready]`,
  plus `[data-template-category]` and `[data-endpoints-verified="true"|"false"]`
  once the fetch resolves — the latter present ONLY when the template
  declares a producer and/or consumer (planning-only; absent, not `false`,
  when nothing is declared). Non-ready states: `[data-component="fetch-error"]`
  (bridge unreachable) and `[data-component="not-found"]` (unknown id — the
  bridge 404s for it by design). The ready state renders
  `[data-section="definition"]` (format/provenance/definition-ref); for a
  malformed definition, `[data-section="parse-error"]` instead; planning-only,
  when a producer/consumer is declared, `[data-section="endpoints"]`
  (`data-endpoints-verified="true"` means the declaration was cross-checked
  against a real flow edge and agreed; `"false"` means either it contradicts
  the edge — a lint error — or the template carries zero flow edges so the
  claim is unverifiable, not wrong: `verdict`, `work-items`, and
  `demo-fix-spec` travel by orchestrator-band re-entry today, not a DAG edge,
  so they fall in the latter case); and `[data-section="used-by"][data-used-by-count]`
  with per-entry `[data-used-by-entry="<label>"]` (an empty result renders
  "scanned N, none found", never a bare zero). `[data-template-preview]`
  repeats on the detail page's own preview block. A `project-scaffold`
  template's package renders through the SAME `FilePackage` component
  `/skills/[id]` uses — `[data-component="file-package"][data-file-count][data-active-file]`,
  per-tab `[data-file-tab][data-file-path]` — the whole scaffold's file tree,
  tabbed, kind-agnostic reuse (shared with R2-10-F3).

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
is a thin runner over 12 user-story journeys in
[`scripts/journeys/`](./scripts/journeys/) — `skills`, `hooks`, `templates`,
`connections`, `stand-up-onboard`, `stand-up-create`, `knowledge`, `agents`,
`flows-author`, `flows-run`, `roadmap`, `demo-builder` (RUN_ORDER's own
sequence, `index.mjs`) — one file per journey (plus
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

**Story-beat parity** — the studio end-state mockup's 27 scripted stories
([`mockups/studio-endstate-v2/journeys-data.jsx`](./mockups/studio-endstate-v2/journeys-data.jsx))
are the target inventory the real journey gallery converges on.
[`scripts/journeys/story-registry.mjs`](./scripts/journeys/story-registry.mjs)
holds one disposition per story (owning wave-5 batch, ported journey +
per-beat map, or excluded with a decision reference). `npm run
parity:stories` ([`scripts/story-parity.mjs`](./scripts/story-parity.mjs))
derives the parity view from the mockup source plus the real
`scripts/journeys/` ids and exits non-zero on a dangling ref or a missing
disposition; porting a batch's stories is that batch's journey-sync duty.

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
