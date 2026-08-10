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
  switching `/flows/<flowId>` changes which hexes appear. MONITOR also
  carries the **history ledger** (R6-05, `HistoryLedger.tsx`):
  `[data-section="history-ledger"][data-ledger-count]`, with an explicit
  `[data-component="history-ledger-empty"]` when a flow has no runs (never a
  fabricated placeholder row). Each row is a real anchor —
  `a[data-ledger-row="true"][data-run-id][data-run-status][data-run-when]
  [data-ledger-cost-usd][data-ledger-narrative][data-narrative-kinds]` — whose
  `href` is its `/flows/[id]/run/[runId]` detail page. Notes on the vocabulary,
  because each is load-bearing rather than stylistic:
  - `data-run-when` is the **raw ISO** `run.startedAt`; the visible column is a
    relative string computed from an explicitly-passed `nowMs`, never
    `Date.now()` or `toLocaleString()` — an ambient-locale or wall-clock
    dependence would make any journey assertion a flake.
  - `data-ledger-cost-usd` is bare `.toFixed(2)` (no `$`; the `$` appears only
    in display text) and is deliberately **not** `data-run-cost-usd`, which
    `MonitorSummary.tsx` already emits at `.toFixed(4)` — reusing that name
    would make one attribute mean two precisions.
  - `data-narrative-kinds` is the **authoritative machine surface**: the
    ordered, comma-joined segment kinds from a closed seven-member vocabulary
    (`work-items · gate-fails · review-findings · gate-waiting · failed ·
    merged · reflection-lost`). Automation asserts on THIS, never by parsing
    `data-ledger-narrative`, whose two note-bearing kinds embed run-sourced
    free text. Both come from one derivation call, so they cannot disagree
    about order. Segment order is the run's chronology, not `phaseMeta` key
    order (those keys are events-derived).
  - Both narrative attributes are **omitted entirely** when a run has nothing
    true to say — never rendered as `""`.
  BUILD renders
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
  Triggers (R2-04-F4, extended forge-zyc 2026-08-09, `FlowHeader.tsx`, under
  Advanced): a kind selector `[data-field="trigger-kind"]` offers all seven
  SHIPPED kinds (`flow-complete | agent-complete | merged | pr-merged |
  issue-raised | cron | webhook` — a client mirror of orchestrator/flow-trigger.ts's
  `SHIPPED_TRIGGER_KIND_IDS`, the SSOT, now guarded by a both-directions parity
  test so the mirror cannot silently drift; registry-reserved kinds `manual`/`feed`
  are never offered) and a target-flow select `[data-field="trigger-target"]`
  shared by all (every kind fires a flow; agent targets are schema-ready but not
  authorable, R4-09). `agent-complete` additionally renders an agent-slug input
  threaded into the declaration's `agent:` field (the server's `trigger-agent-complete`
  check requires it); the **webhook family** (`webhook | pr-merged | issue-raised`)
  renders the same webhook-config inputs (`[data-field="webhook-id"|"webhook-provider"|
  "webhook-events"|"webhook-secret-env"|"webhook-sources"]`) with per-kind-constrained
  provider/event option sets, so an authored pr-merged/issue-raised trigger carries a
  real `webhook.id` the hook receiver can route to (previously these were selectable
  but produced a bare, permanently-dead declaration). `cron`
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
  **R2-09 additions.** The agent picker carries `[data-agent-select]` with a
  per-option `[data-agent-option="<slug>"]` (`"new"` for the new-agent
  sentinel), so a journey can switch agents by structured state instead of by
  option text. Catalog chips are **click-to-add as well as draggable** — the
  same `.catalog-chip[data-id][data-kind]` element, keyboard-activatable, with
  the drag path untouched; an already-bound chip does not add twice, matching
  the drop zone's own semantics. `[data-section="instructions"]` wraps the
  SKILL.md prose field and carries
  `[data-instructions-draft="true"|"false"]` — true from the moment the
  `[data-action="generate-instructions"]` assist applies a draft until the next
  successful save or discard, and it **persists across further manual edits**
  because the content is still draft-derived. The draft is never auto-saved:
  the assist marks the form dirty and only the operator's Save writes it, and a
  failed request surfaces an error rather than leaving a stale or fabricated
  draft in place. `[data-section="materials"]` carries `[data-materials-count]`
  and one `[data-material="<kind>"][data-selected="true"|"false"]` toggle per
  vocabulary kind (`images | documents | audio | data-files` — the id stays
  kebab; "data files" is a display label only). **The materials declaration is
  not enforced here**: the UI declares, the R6-04-F2 kickoff upload seam
  enforces, and `agentAcceptsMaterial` is the fail-closed gate that seam must
  call. `[data-ready-count]` is unchanged at **6** — the mockup's "Named +
  described" and "Reachable" rows were deliberately NOT added, because neither
  can ever read false for a loaded agent and a readiness row that cannot fail is
  decoration.
- **`/agents/[id]` agent history ledger (R6-06, 2026-08-08).** The agent page's
  right-hand column gains a per-agent run-history ledger below `UsedInFlows`,
  rendered by the SAME shared `HistoryLedger.tsx` the flow monitor uses — so
  the row contract (`[data-section="history-ledger"][data-ledger-count]`, the
  `[data-component="history-ledger-empty"]` honest empty, and each row's
  `a[data-ledger-row="true"][data-run-id][data-run-status][data-run-when]
  [data-ledger-cost-usd][data-ledger-narrative][data-narrative-kinds]`) is
  documented once under `/flows/[id]` above and is **not restated here**; only
  what is genuinely different is below. Select it as
  `[data-page="agents"] [data-section="history-ledger"]`. Notes, each
  load-bearing rather than stylistic:
  - **`data-ledger-link-kind`** (`flow-node | standalone | session`) is emitted
    **only on agent-ledger rows** — flow-ledger rows never set it, because a
    flow ledger's rows are all one kind by construction. It exists because the
    feature's whole point is that a row links **where the run actually
    happened**: a flow node's run detail (`/flows/<flowId>/run/<runId>`), a
    standalone dispatch (`/agents/<slug>/run/<runId>`), or a session. Asserting
    on `href` string prefixes would be a drifty proxy for the thing being
    claimed, so the link kind is structured state in its own right.
  - **`data-ledger-cost-usd` is OMITTED, not zeroed, when a cost genuinely does
    not exist** (a session with no execution log yet). A fabricated `0.00`
    would be a false claim about the run; the attribute's absence is the honest
    signal. Callers must treat "absent" and `"0.00"` as different facts.
  - **`data-run-status` carries the target's OWN vocabulary, verbatim, and it
    differs per link kind** — flow-node rows use `RunPhaseStatus`
    (`pending|active|complete|retrying|failed`), standalone rows use
    `running|done|failed|suppressed|budget-exceeded`, and session rows carry
    that session's own `status.json` phase string. **There is deliberately no
    mapping onto one vocabulary**: there is no honest `RunPhaseStatus` for
    `suppressed` or for `interviewing`, and inventing one would be a false
    claim about the target. Session status is intentionally OPEN because a
    session's phase is closed per runner but open across the four-and-growing
    runners this surface aggregates; the closed vocabularies are enforced at
    runtime by `agent-ledger.ts`'s wire validator, not by the type.
  - **Three fetch outcomes render three distinguishable states**, because a
    failed fetch and an empty history are different operator facts:
    `[data-component="history-ledger-loading"]` before the first response,
    `[data-component="history-ledger-unresolved"]` when the fetch failed, and
    the ledger section itself (with the component's own
    `[data-component="history-ledger-empty"]`) when the agent genuinely has no
    runs. Automation must not treat "unresolved" as "no history".
  - A brand-new unsaved agent (`/agents/new`) renders **no section at all** —
    there is no slug yet, so there is no state to report.
- **`/agents/[id]` kickoff panel expansion (R6-04, 2026-08-07).** The
  existing `[data-section="agent-run"]` panel (above) is expanded IN PLACE —
  all nine pre-existing `data-*` attributes on it stay byte-identical. A real
  project `<select data-run-project>` replaces the old free-text input, its
  `<option>` values sourced from the real `GET /api/studio/projects` (never a
  hardcoded list). `[data-component="cost-ceiling"]` wraps
  `[data-ceiling-enforceable="true"|"false"]`, which itself wraps the
  `<input data-run-cost-ceiling>` — **disabled** whenever `false` — plus,
  only when disabled, `[data-component="ceiling-explanation"]` naming WHY
  (the agent's `loopStrategy` cannot enforce one). `costCeilingEnforceable`
  is a server-computed fact (`orchestrator/studio/derive.ts`
  `agentCapabilityDescriptor().costCeilingEnforceable`, true iff
  `runtime.loopStrategy === 'one-shot'`) threaded through as-is, never
  re-derived client-side — **the cost ceiling is enforced ONLY for
  `loopStrategy: 'one-shot'` agents (the SDK's own `maxBudgetUsd` path, not
  something forge enforces in-process) and REFUSED (400, before a runId is
  ever minted) for every other agent**, 4 of the 19 real dispatchable roster
  agents today. A materials-attach section,
  `[data-section="materials-attach"][data-materials-declared="<comma-joined
  kinds>"]`, wraps a real `<input type="file" multiple data-run-materials-input>`
  — offering exactly the agent's own declared `materials:` kinds, never the
  full vocabulary; an out-of-contract or oversized attachment is refused
  client-side (a convenience mirror of the server's own authoritative check,
  `forge-ui/lib/run-panel-view.ts`) with an inline `<p>` naming both the
  file's real kind and the agent's declared kinds (no dedicated `data-*` on
  that message itself — select it via
  `[data-section="materials-attach"] p`). Clicking
  `[data-action="run-agent"]` now POSTs `costCeilingUsd` (only when
  enforceable) and `materials: [{filename, contentBase64}]` (WI-1/WI-2)
  alongside the pre-existing `project`/`inputs` fields; materials are staged
  under `_logs/<runId>/materials/` and recorded on the run's own event log
  as **references only** (`{path, kind}` — filename + server-derived kind,
  never bytes, never logged or rendered).
- **`/agents/[id]/run/[runId]` — the standalone run view (R6-04 WI-4,
  2026-08-07).** A thin client shell (`app/agents/[id]/run/[runId]/page.tsx`)
  fetches `GET /api/agents/runs/:runId` and renders the pure, props-driven
  `RunView` component. While the fetch is in flight the shell renders
  `[data-page="agent-run"][data-run-id][data-page-ready="false"]` only; once
  resolved, `RunView`'s own root takes over and carries
  `[data-page="agent-run"][data-run-id][data-run-state][data-run-cost]
  [data-run-found="true"|"false"]` — **note this loaded state carries no
  `data-page-ready="true"` companion at all** (a genuine, as-built departure
  from every other route's `data-page-ready` convention; a journey/automation
  waiting on this route must key off `[data-run-found]`'s mere presence, not
  a `data-page-ready` flip). `found:false` (no `_logs/<runId>` directory
  exists — never dispatched, the R6-04 D22 404 case) renders ONLY
  `[data-component="run-not-found"]`, suppressing every other section even if
  the caller supplied non-empty data. `found:true` renders (forge-pet, 2026-08-09)
  a reserved `[data-section="run-trigger"]` provenance section
  (`data-trigger-kind`/`data-trigger-source`/`data-trigger-scope`, `scope ?? ''`)
  when the run carries a `trigger`, mirroring the flow run-detail vocabulary —
  **omitted entirely otherwise, and honestly absent on every real run today**:
  the client resolver passes a `trigger` through only when the server body carries
  one (never fabricated), and no standalone-dispatch path writes trigger origin into
  a run yet (the R4-09 agent-target dispatch still throws in production), so this
  attaches the vocabulary ahead of a producer exactly like `data-outputs-count`'s
  honest `0`. Then the four data sections:
  `[data-section="run-log"]` wrapping the shared `RunLog` component
  (`components/studio/RunLog.tsx`, also reusable for a future per-node flow
  log) — `[data-component="run-log"]` with one
  `[data-log-line="true"][data-log-kind="think"|"tool"|"out"]` per event
  (mapped from the real 11-member `EventType` union by
  `forge-ui/lib/run-log-line.ts`; `[data-component="run-log-empty"]` when
  none have landed yet); `[data-section="run-materials"][data-materials-count]`
  — `[data-component="run-materials-empty"]` when none, else one
  `<li data-material-ref="<path>" data-material-kind="<kind>">` per material,
  **path + kind only, structurally never contents** (the component
  destructures only those two fields — anything else on the object is
  unreachable here, and the underlying API response never carries a
  `contentBase64` field either); `[data-component="ceiling-provenance"]
  [data-ceiling-set="true"|"false"]` — `data-ceiling-usd` + a formatted `$X.XX`
  when set, `[data-component="ceiling-not-recorded"]` when not; and
  `[data-section="run-outputs"][data-outputs-count]` (typed outputs as
  collapsed-by-default `<details data-output-id>` cards) — **honestly always
  `0`/empty today**, since there is no wired data source yet for a generic
  dispatched agent's artifact outputs (`forge-ui/lib/run-view-client.ts`'s
  own header). The ceiling recorded on `data-ceiling-set` reflects the
  terminal `end` event's `metadata.kickoff_ceiling_usd`
  (`orchestrator/run-agent.ts`) — written only when the underlying SDK call
  actually completes; a suppressed spawn (dry-bridge / no-spawn harness seam)
  never reaches that point, so `data-ceiling-set` correctly reads `false`
  even for a dispatch that carried a ceiling on the wire.
- **`/flows/[id]/run/[runId]` — the flow run-detail page (R6-01-F4/F5,
  2026-08-07).** The dig-in for ONE flow run, live or archived, reached from a
  `RunRail` row's `[data-action="open-run-detail"]` anchor on the flow monitor.
  A thin client shell (`app/flows/[id]/run/[runId]/page.tsx`) resolves the run
  and hands props to the pure `FlowRunDetail` component. **Everything on this
  page is DERIVED from the event log; nothing is stored** (ADR-008) — reading
  a run writes no file.

  The route has **THREE** resolved states, not two, and each renders a
  `main[data-page="flow-run"]` landmark (the element type is load-bearing —
  journey selectors key on `main`, and the render tests assert attributes
  only, so they cannot see it):
  - in flight — `[data-page="flow-run"][data-run-id][data-page-ready="false"]`;
  - **`[data-run-resolution="unresolved"]`** — the bridge was unreachable, or
    answered 5xx / a non-404 4xx / a malformed 2xx. Renders NEITHER the
    timeline NOR the not-found body. This state exists because collapsing it
    into "not found" would render a transient network error as an
    authoritative claim about the run ("this run never existed"). `found` is
    decided by HTTP **status**, before the body is ever inspected;
  - resolved — `[data-page="flow-run"][data-run-id][data-flow-id]
    [data-run-found="true"|"false"][data-run-status]`. `found:false` (the
    server's honest 404 for a runId that never existed) renders only
    `[data-component="run-not-found"]`.

  A found run renders: `[data-section="run-trigger"]` with the reserved
  provenance vocabulary above (omitted entirely when the run has no trigger);
  `[data-section="run-timeline"]` with **one
  `[data-timeline-row="true"][data-node-id][data-status][data-phase-cost-usd]
  [data-node-expanded]` row per FLOW-DEFINITION node** — every node, in
  `flow.yaml` order, including gate-only nodes and nodes that never ran (a
  timeline derived from the events present would silently vanish them);
  `[data-node-note]` **only** when that node has a derived note; and
  `[data-section="review-findings"]` through the shared `ReviewFindingsPanel`
  (its own existing contract, not a fork).

  Three honesty constraints are contractual here, each pinned by a test:
  - `data-phase-cost-usd` is **exactly** `run.phaseMeta[node].costUsd`,
    `.toFixed(2)` (matching `FlowTopology`'s phase hexes). It is never
    re-summed from events — a phase with an iteration loop restates its
    dollars on rollup `end` events, and this codebase has twice shipped a
    2–3× inflation that way — and the run-level total never appears on a row.
    Note the architect phase logs `cost_usd: 0` on every completion event, so
    a per-node architect cost undercounts **by construction**.
  - `[data-node-note]` is **derived**, never free-typed: `delivered ·
    iterations · retries · wedged`, fixed order, absent facts omitted rather
    than rendered as zeroes.
  - **no per-finding `state` is rendered.** The design mockup shows an
    `open|fixed` column; `ReviewFinding` has no such field and no producer
    exists, so rendering one would assert a fact the system cannot know.

  **F5 — per-node logs.** Clicking a row toggles
  `[data-node-expanded="true"]` and renders
  `[data-section="node-detail"][data-detail-for-node="<nodeId>"]` (a distinct
  attribute — never a second `data-node-id`, which would break row lookups)
  containing the **shared** `RunLog`: `[data-component="run-log"]` with one
  `[data-log-line="true"][data-log-kind="think"|"tool"|"out"]` per event,
  mapped by `forge-ui/lib/run-log-line.ts` — the SAME component and mapper
  `/agents/[id]/run/[runId]` uses. One component, two surfaces.

  That reuse required a wire change: the classified phase-log endpoint
  computes the **drawer's** own 6-kind vocabulary server-side and drops the
  raw `event_type`, which `deriveLogLine` needs. So
  `GET /api/runs/<id>/phases/<node>/log` gained an additive **`raw=1`** mode
  (mirroring its own `stderr=1` convention) returning that node's unclassified
  event records. **`PhaseDrawer` never passes `raw=1`** and its
  `{at,kind,text,detail}` contract is unchanged — guarded by a regression test.
  `[data-section="node-outputs"][data-outputs-count]` is **honestly always
  `0`** with `[data-component="node-outputs-empty"]`: no per-node artifact
  source exists (`artifactsReady` is run-level and keyed by artifact TYPE),
  and attributing it to a node would be run-level data worn as per-node fact.
- **`/projects` + `/projects/[id]` — editor + roadmap.** Bare `/projects`
  just redirects to the first registered project
  (`[data-page="projects-index"]` while empty/loading). The project page is
  `[data-page="projects"][data-project-id][data-dirty][data-page-ready][data-demo-design-state]`
  with an Editor/Roadmap tab bar (`[data-tab="editor"|"roadmap"][data-tab-active]`).
  Roadmap renders `RoadmapDag.tsx` (R4-13, replacing the retired
  `SerpentineTimeline` time-ordered spine): a real dependency **DAG** —
  `[data-roadmap-dag][data-initiative-count][data-roadmap-edge-count]` — with
  initiatives bucketed left→right into dependency-depth columns
  (`[data-dag-column]`; layout `lib/roadmap-dag-layout.ts`'s `byDepth`, node
  tone `lib/roadmap-status-color.ts`). An `[data-dag-edges]` SVG overlay draws
  **one edge per (prerequisite → dependent) pair whose both ends are in the
  roadmap**:
  `[data-dep-edge][data-dep-from="<prerequisite>"][data-dep-to="<dependent>"]`
  — the edge-correctness the serpentine arcs carried ZERO `data-*` for. (Note:
  NO attribute begins with `data-dep-edge-`; the edge count lives on
  `[data-roadmap-edge-count]` — a `\bdata-dep-edge\b` matcher must remember a
  hyphen is a word boundary.) Per initiative,
  `[data-roadmap-node][data-initiative-id][data-initiative-status]` (+
  `[data-develop-state][data-plan-state][data-initiative-ready][data-blocked-by]`),
  whose header `[data-action="toggle-node-detail"]` toggles a
  **default-EXPANDED** `[data-node-detail]` — so every affordance below is
  present on first paint (no click-to-pop; a blind node-center click is
  unnecessary AND must be avoided, since it can land on a trigger). The card
  lists the initiative's real work items (`[data-work-item-id]`) and a per-node
  run dig-in `[data-section="initiative-runs"]` with one
  `[data-run-link][data-run-cycle-id][data-run-active="true"|"false"]`
  (href `/flows/forge-develop/run/<cycleId>`) for the active cycle plus every
  prior attempt. Each pending initiative also carries `[data-plan-state="unplanned"
  |"planning"|"planned"|"error"]` (`unplanned` = the R4-05
  `enqueuePlanRun`-derived `workItems === undefined` proxy — no decomposition
  has run yet): unplanned renders the `[data-action="plan-initiative"]`
  button plus a blocked-until-planned lock badge
  (`[data-section="initiative-blocked-until-planned"]`) that hides
  `[data-action="start-development"]` until the card flips to `planned`;
  dispatching a plan run surfaces `[data-action="open-plan-run"]` linking to
  the `forge-architect` flow monitor. The roadmap header carries an optional
  per-kickoff cost-ceiling input (forge-shc, 2026-08-09) — `POST /api/develop/start`
  accepts `costCeilingUsd` **only** for a single-initiative Start and stamps it onto
  that initiative's manifest `cost_ceiling_usd`; the field is **opt-in gated**
  (untouched → no `costCeilingUsd` is sent → the manifest's own budget-derived
  ceiling stands, never silently overwritten by the run-level default), and a stamp
  that fails to land is surfaced in the per-item result rather than reported as a
  clean enqueue. Every node's card carries
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
  `[data-action="run-onboarding-agent"]` button. **Repointed R4-17
  (2026-08-06):** the button now dispatches through the staged onboarding
  session route, `POST /api/studio/onboarding/start` (`{project, inputs?}` →
  `{ok, sessionId, runId, project}`, `forge-ui/lib/studio-client.ts`'s
  `startOnboardingSession`) rather than the generic
  `POST /api/agents/onboarding-agent/run` — D6 (R4-17) keeps the underlying
  spawn byte-identical, so `[data-onboard-run-id]` /
  `[data-onboard-run-status]` / `[data-action="run-onboarding-agent"]` are
  UNCHANGED (an existing journey beat asserts them). Additive:
  `[data-onboard-session-id]` carries the new staged session's id, and once a
  run is dispatched a `[data-action="view-onboarding-session"]` link opens
  the shared session shell at `/sessions/onboarding/<sessionId>?project=<id>`
  — the SAME stage-aware `contract-buildout` artifact pane described below,
  reused verbatim for onboarding (D1: one session-kind descriptor,
  `onboarding`, for both onboarding AND creation).
  A recoverable initiative (`in-flight | ready-for-review | failed` —
  deliberately excluding `merged`, a transient pass-through, and terminal
  `pending`/`done`) gets recovery affordances right on its RoadmapDag node's
  (default-expanded) detail card (R4-11-T3, folded off the retired standalone
  `/recovery` page — see below): `[data-recovery-item][data-recovery-initiative]
  [data-recovery-status][data-recovery-attempt-count]` (+
  `[data-recovery-prior-attempts]` when a prior attempt exists) with
  `[data-action="recovery-inspect"|"recovery-requeue"|"recovery-abandon"]`
  buttons. The `[data-section="recovery-detail"][data-recovery-detail-initiative]`
  region renders **structurally** (R4-13: it is in the DOM on first paint,
  empty until Inspect populates it with branch / worktree / PR-draft detail, so
  the re-home can't drop a click-gated affordance)
  (+ `[data-recovery-commits]` when the worktree has commits, and a
  `[data-recovery-note]` result line after requeue/abandon). The recovery
  API itself (`cli/bridge-recovery.ts`) is unchanged — only the UI moved.
  The editor aside also carries two PERMANENT read-only surfaces (R4-12), on
  the project at rest — distinct from the preflight VERDICT surfaces
  (`ContractReadiness` / `[data-section="contract-resolution"]`).
  **`[data-section="contract-panel"]` (R4-12-F1)** —
  `ProjectContractPanel.tsx`, an async server component mounted client-side by
  the page's `ContractPanelMount`; it issues its OWN
  `GET /api/studio/projects/:id/contract-stages` (`fetchContractStages`,
  `cli/contract-stages.ts`'s `deriveContractStages`) and renders the SAME
  five-stage buildout the onboarding session's `contract-buildout` artifact
  shows, REUSING that checklist vocabulary verbatim:
  `[data-section="contract-checklist"][data-checklist-row-count]` with one
  `[data-checklist-row="contract"|"instructions"|"secrets"|"demo"|"roadmap"]`
  `[data-checklist-status="present"|"absent"]` per stage (all five ALWAYS
  rendered, in declared order — an absent artifact is a row, never a dropped
  row), each carrying its inline `[data-detail-line]` facts (the `secrets`
  stage's detail is env-var **NAMES ONLY**, driven by
  `testProcess.acceptance.requiresEnv` — never a value, never a fabricated
  mask; a creds-free project like `mdtoc` shows `secrets` `absent` with no
  detail line). Plus `[data-contract-northstar]`
  (+ `[data-contract-northstar-state="present"|"missing"]`) and
  `[data-contract-conventions-source]` (the value is the `instructionsSource`,
  or empty). The panel root ALWAYS renders — a partial/degraded project
  degrades to `absent` rows and `missing` north-star without crashing or
  blanking. **`[data-section="project-cycle-ledger"]` (R4-12-F2)** — wraps the
  SHARED `[data-section="history-ledger"]` (`HistoryLedger.tsx`, the THIRD
  caller after the flow + agent monitors), fed this project's own RAW
  `Cycle[]` (`fetchCycles()`, scoped to `c.project === id`) through
  `deriveProjectCycleLedgerRows` (`forge-ui/lib/project-cycle-ledger.ts`) — no
  status filter, every cycle is a row. Each row is a real
  `a[data-ledger-row="true"][data-run-id][data-run-status][data-run-when]`
  whose `href` carries the FULL `cycleId` AS-IS to
  `/flows/forge-develop/run/<cycleId>` (the shared flow run-detail surface —
  a completed `cycleId` resolves there as a `runId`); `data-ledger-cost-usd`
  is omitted (a `Cycle` carries no cost). An empty ledger honestly renders
  `[data-component="history-ledger-empty"]`, never a fabricated row.
- **`/projects/[id]/showcase` — the demo showcase (R4-14, 2026-08-10).** A
  per-project **standing** demo page — "show someone the project" — distinct
  from the per-run `/artifact?type=demo` evidence view above: it always
  renders the project's newest `merged`/`done` cycle's demo, not one the
  operator has to pick. Entry is gated on the project page itself:
  `/projects/[id]`'s cycle-ledger header carries
  `[data-action="open-showcase"]`, rendered only when
  `showShowcaseEntry` (`forge-ui/lib/project-showcase.ts`) resolves a real
  eligible cycle for the project — the link is never offered for a project
  the showcase page would itself render empty for. Page shell:
  `main[data-page="project-showcase"][data-page-ready][data-project-id]`.
  Load pipeline (`forge-ui/lib/showcase-load.ts`'s `loadShowcase`):
  `fetchCycles()` → `deriveShowcaseCycleId` (newest cycle with
  `status === 'merged' | 'done'` for this project, ranked by
  `endedAt ?? startedAt ?? <cycleId>`'s own leading timestamp) →
  `fetchDemoModel(cycleId)`. Two render branches, both derived from the SAME
  fetch (no separate showcase-only schema):
  `[data-section="showcase-stats"]` — a small stats strip
  (`deriveShowcaseStats`, `forge-ui/lib/project-showcase.ts`) of real counts
  read off the fetched `DemoModel` (test-evidence count, AC met/partial/missed,
  branch/commit/PR-link tiles when the model carries them) — above
  `[data-section="showcase-evidence"]`, which wraps the reused
  `<DemoComparison>` **unchanged** from `/artifact?type=demo` (same
  `[data-section="demo-comparison"]` / `[data-section="demo-evaluation"]
  [data-ac-eval-count][data-ac-verdict]` contract documented above — one
  renderer, two surfaces). **Honest empty:**
  `[data-section="showcase-empty"]` renders instead whenever there is nothing
  real to show — either no eligible cycle at all, OR a terminal cycle exists
  but its `demo.json` never landed (`loadShowcase`'s `{kind:'loaded',
  model:null}` path) — both collapse to the SAME empty state, never a
  fabricated or partially-blank gallery. Because entry is gated, this page's
  own empty branch is reachable only by a direct/stale URL, never the normal
  click-through — the `demo-showcase` journey's own `demo-showcase-empty` beat
  drives it that way deliberately (`scripts/journeys/demo-showcase.mjs`).
  Refresh is data-driven, not cached: the page re-derives on every load, so a
  newer merged cycle's evidence appears with zero code changes
  (`demo-showcase-refresh` beat — ported from the mockup's
  `run-agent-demo-runner` story's own closing claim, "the showcase never goes
  stale — merges refresh it automatically"; see `scripts/journeys/story-registry.mjs`).
- **`/sessions/[kind]/[sid]` — the ONE interactive-session surface
  (R2-10-F1, 2026-08-05).** Every interactive agent renders here: chat
  transcript left, living artifact right. The three bespoke session pages it
  replaced (`/architect/[sid]/interview`, `/instructions/[sid]`,
  `/project-brain/[sid]`) are **deleted as implementations and survive as
  permanent server-side redirects** into this route — `/project-brain`'s
  redirect forwards its `?project=` query, and `/architect/[sid]` now
  redirects straight here rather than chaining through `/interview`.
  Page shell:
  `main[data-page="session"][data-page-ready][data-session-kind][data-session-id][data-session-phase][data-session-stage]`,
  with `[data-session-turn-count]` reflecting the turns actually RENDERED
  (i.e. the selected stage's), never a total that disagrees with the DOM.
  Per turn:
  `[data-turn-index][data-turn-role="agent"|"operator"][data-turn-stage][data-turn-source]`
  — `data-turn-source` names the checkpoint file the turn was DERIVED from
  (`idea.md`, `prompt.md`, `answers.json#round-N`, `questions.json`,
  `feedback.md`), because no chat transcript exists on disk and none is
  invented. Artifact pane:
  `[data-section="session-artifact"][data-artifact-kind][data-artifact-label]`
  (the label comes from `studio/session-kinds.yaml` over the wire, never a
  client-side table). Fail-closed state:
  `[data-session-error][data-session-error-kind]` — a checkpoint stage outside
  the kind's declared `stages` surfaces the server's message naming the
  offending value and the allowed set, never a defaulted render. **D10
  (R4-17, 2026-08-06):** `SessionArtifactPane`'s branch selection DELEGATES to
  the `sessionArtifactView` dispatcher (`forge-ui/lib/session-artifact-view.ts`)
  instead of a bespoke ternary — the prior ternary's final `else`
  unconditionally rendered the generation gallery, so an artifact kind the
  pane didn't explicitly branch on silently misrendered as a gallery instead
  of failing loudly. An unhandled/unknown kind now renders
  `[data-section="session-artifact-unhandled"][data-artifact-unhandled-kind]`
  — an explicit, visible failure state naming the offending kind, never any
  specific renderer.
  **Every per-kind operator affordance keeps its original `data-*` name** so
  the harness drives it unchanged: the architect hex
  (`[data-component="architect-hex"][data-architect-phase][data-architect-active]`,
  `[data-tool-burst]` chips), `[data-section="architect-interview"|"architect-activity"|"architect-status"]`
  with `[data-architect-round][data-questions-answered]`, per-question
  `[data-question-index][data-question-resolved]`, per-option
  `[data-option-label][data-option-selected]`; the stale warning
  `[data-architect-stale="true"][data-architect-stale-ms]` and its re-run
  `[data-action="architect-rerun"][data-rerun-state="idle"|"rerunning"|"error"]`
  (POSTs `/api/architect/rerun`, no answers/round mutation);
  `[data-action="open-plan"]` into
  `/artifact?run=_architect-<sid>&type=plan&mode=gate` (the PLAN gate is still
  just another gate — M7-4, ADR-031) and `[data-action="watch-it-build"]`;
  the instructions side's `[data-section="instructions-interview"|"instructions-status"]`,
  `[data-instructions-stale][data-instructions-stale-ms]`,
  `[data-component="instructions-verdict"][data-form-state][data-form-kind]`
  with `[data-action="approve-instructions"|"revise-instructions"|"reject-instructions"]`
  and `[data-action="back-to-project"]`; the project-brain side's
  `[data-section="brain-briefing"|"brain-analyzing"|"brain-review"|"brain-committing"|"brain-committed"|"brain-abandoned"]`
  (`brain-review` carries `data-theme-count`, each theme `data-theme-name`),
  `[data-component="brain-brief-input"]`, and
  `[data-action="start-brain-analysis"|"approve-brain"|"abandon-brain"|"bind-and-return"]`.
  The two question forms are now ONE component parameterised on its submit fn
  and section name — both `data-section` values are unchanged.
  **`/architect/new` stays** as the native "start a run" entry that replaced
  the retired `/dashboard` launcher —
  `[data-page="architect-new"][data-page-ready]` wrapping
  `[data-section="new-idea"][data-new-idea-ready]` — and now pushes into
  `/sessions/architect/<sid>`.
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
- **Roadmap-draft artifact = a dependency DAG (R4-15-F1, 2026-08-06).** The
  architect session's `roadmap-draft` artifact carries the initiative
  **dependency edges** it previously parsed and dropped: each row on the wire
  gains `dependsOn` (the manifest's `depends_on_initiatives`, verbatim —
  unsorted, undeduplicated; resolving an edge against the draft set is the
  view's job, not the deriver's). The artifact pane renders the DAG **plus**
  the initiative table, which is exactly the layout R4-13-F1 specifies for the
  project roadmap tab — hence one **shared** renderer, not a bespoke one:
  `forge-ui/lib/dependency-dag.ts` (the pure, generic view model, levels
  delegated to the existing `topoLevels`) + `forge-ui/components/studio/DependencyDag.tsx`
  (the component, one data prop), the same lib-module-plus-component shape as
  R3-01's `FilePackage`. Contract:
  `[data-component="dependency-dag"][data-dag-node-count][data-dag-level-count][data-dag-edge-count][data-dag-cycle="true"|"false"][data-dag-unresolved-count]`,
  per column `[data-dag-level]`, per node
  `[data-dag-node][data-dag-node-level][data-dag-node-status][data-dag-node-cycle="true"|"false"][data-dag-depends-on][data-dag-unresolved]`,
  and on the table beside it `[data-roadmap-row][data-roadmap-depends-on]`.
  **Both surfaces read the same de-duplicated value (`DependencyDagNode.deps`)
  from the ONE shared view — computed once by `roadmapDraftView`, passed down
  to `DependencyDag` and read directly for the table — so they structurally
  cannot drift.** A dependency naming an initiative outside the draft set (an
  already-merged one, typically) and a detected cycle are each rendered as
  **readable text**, not only stamped on an attribute — an attribute nobody
  renders is the declared-data-fails-open shape this campaign keeps closing
  (adversarial-review round, 2026-08-06: a cycle member now also carries
  `data-dag-node-cycle="true"` plus a visible border/label treatment on the
  node itself, not only the root banner).
- **Project-page entry into a planning session (R4-15-F1, 2026-08-06).** The
  project page's roadmap section carries
  `[data-component="project-architect-entry"][data-architect-entry-open="true"|"false"][data-project-id]`,
  present in both the empty-roadmap branch (previously a dead-end sentence) and
  the populated branch's header row. `[data-action="plan-with-architect"]`
  reveals the ONE shipped start-a-session surface — `NewIdeaBox`, with every
  attribute of its own unchanged — seeded with this project;
  `[data-action="cancel-plan-with-architect"]` collapses it again. When an
  in-flight architect session exists for the project,
  `[data-action="resume-architect-session"][data-session-id]` links straight to
  `/sessions/architect/<sid>`;
  `[data-architect-resume-probe="pending"|"settled"]` reports whether the
  lookup for one has finished, so "still loading" is not read as "none".
  **There is deliberately no `failed` value** — `bridgeGet`
  (`forge-ui/lib/bridge-client.ts`) resolves every transport error, non-2xx
  and parse failure to its fallback and never rejects, so this component
  genuinely cannot distinguish a broken bridge from an empty result. Claiming
  a `failed` state it can never enter would be a DOM contract the code does
  not honour; the swallow is filed instead.
- **Demo builder — inline on `/projects/[id]` (R1-03-F2, 2026-07-24):** the
  per-project demo-page builder (brief → generate → lock, element-by-element)
  is an inline panel on the project page, opened by
  `[data-action="launch-demo-builder"]` / a `?demo=<sid>` deep link:
  `[data-section="demo-builder-panel"][data-demo-session][data-demo-phase]`
  containing the preserved inner contract —
  `[data-section="session-briefing"|"demo-target-element"|"demo-status"|"demo-history"|"demo-viewer"|"demo-process"]`,
  `[data-component="demo-review"]`, `[data-demo-iframe]`,
  `[data-field="demo-feedback"]` (the review textarea — named so the harness
  can drive a real feedback round trip, R4-16),
  `[data-action="submit-brief"|"lock-demo"|"abandon-demo"|"iterate-element"|"view-element-output"|"close-demo-panel"]`
  plus a compact `[data-section="demo-status-strip"]`. The old detached
  `/demo/[sid]` route is a redirect stub
  (`[data-page="demo-builder-redirect"]` → `/projects/<id>?demo=<sid>`).
- **Generation gallery — the demo-builder's session artifact (R4-16-F1,
  2026-08-06).** Each completed generate turn is SNAPSHOTTED into the session
  dir (`projects/<p>/_demo/<sid>/generations/<n>/` = `DEMO.html` + `SKILL.md` +
  `meta.json`), so the generations accumulate instead of overwriting each
  other, and a new **live** artifact kind `generation-gallery`
  (`studio/session-kinds.yaml`'s fourth descriptor, `id: demo` — the id IS the
  `_<kind>` session-dir segment the read route derives) renders them through
  the R2-10 shell's own renderer stack. **Entry stays the project page**
  (R1-03-F2 is not reversed): the inline `DemoBuilderPanel` mounts the REAL
  `SessionArtifactPane`, fed by the same
  `GET /api/studio/sessions/demo/<sid>?project=<p>` route the
  `/sessions/[kind]/[sessionId]` deep link uses — one derivation, one renderer,
  two mounts. Contract:
  `[data-section="generation-gallery"][data-generation-count][data-selected-generation]`,
  per selector button
  `[data-action="select-generation"][data-generation-number][data-generation-selected="true"|"false"]`,
  per item
  `[data-generation-item][data-item-path][data-item-kind="html"|"markdown"|"file"][data-item-bytes]`,
  the feedback that drove the selected generation
  `[data-section="generation-feedback"][data-has-feedback="true"|"false"]`,
  the per-item viewer `[data-action="view-generation-item"]` (serving from
  `GET /api/demo-builder/generation/<project>/<sid>/<n>/<filename>`), the
  chooser `[data-action="finalize-generation"][data-generation-number]`, and an
  honest `[data-generation-empty="true"]` naming what was scanned rather than a
  bare pane. `data-generation-number` is the snapshot's OWN recorded iteration,
  never an array position, so a corrupt snapshot leaves a visible gap instead
  of silently renumbering its successors. **The selection is poll-stable**: the
  panel refetches on ONE 3s interval (never a second cycle — two independent
  polls is the race this campaign already diagnosed once), and the view is
  re-derived with the operator's chosen generation NUMBER preserved across the
  new payload, because a selection that dies every 3 seconds cannot be acted
  on. `[data-action="lock-demo"]` keeps its meaning (lock the sample currently
  in the repo); `finalize-generation` restores the CHOSEN snapshot's sample AND
  its generator skill into the project repo before the same lock runs, so
  `demo.lock.json`'s `demo_html`/`demo_skill` pair always comes from one
  generation.
- **Contract build-out — the onboarding/creation session's artifact (R4-17,
  2026-08-06).** The `onboarding` session-kind descriptor (`studio/
  session-kinds.yaml`, D1: ONE descriptor reused for both the `/projects/[id]`
  onboarding entry point AND the R4-03 create-from-template flow) declares
  `stages: [contract, instructions, secrets, demo, roadmap]`,
  `defaultStage: contract`, and a new **live** artifact kind
  `contract-buildout` — a five-row PRESENCE report (`cli/contract-stages.ts`'s
  `deriveContractStages`; D11: presence only, "present"/"absent", never a
  clause verdict — `forge preflight`'s exit code stays the only authoritative
  contract-green signal). Stage-aware, mirroring
  `mockups/studio-endstate-v2/views-session.jsx:77-158`: the `contract` stage
  renders the CHECKLIST of all five rows (reuses the SAME
  `.readiness-list`/`.readiness-item`/`.ri-dot` classes
  `ReadinessPanel.tsx` already ships); every other stage renders THAT stage's
  own row detail. Contract:
  `[data-component="contract-buildout"][data-buildout-mode="checklist"|"detail"][data-buildout-active-stage][data-buildout-row-count]`;
  checklist mode: `[data-section="contract-checklist"][data-checklist-row-count]`
  with per-row `[data-checklist-row][data-checklist-status="present"|"absent"]`;
  detail mode: `[data-stage-detail-state="row"|"no-row"][data-stage-detail-stage][data-stage-detail-status]`
  with a `[data-section="stage-detail-list"]` of `[data-detail-line]` entries.
  **D3 (security, load-bearing):** the `secrets` stage's detail lines are
  NAMES ONLY — the wire payload never carries a value, and the component
  renders each name plainly with no fabricated placeholder value (no
  "••••••", no invented "redacted" string) that could read as though a real
  value were partially shown. The pane threads the session shell's
  `selectedStage` straight to the dispatcher as `activeStage`
  (`SessionArtifactPane`'s new optional prop) — every OTHER live kind treats
  it as a no-op (stage-UNAWARE by nature).
- **`/knowledge` + `/knowledge/new`** — the knowledge-graph browser and the
  band-scoped, agent-seeded create + maintain surface (R1-01's binding
  contract, extended by R1-06 WI-2/WI-3, R4-19 WI-1/WI-2 and R6-08 WI-1/WI-2/
  WI-3; journeys:
  `knowledge-graph`, `knowledge-pin-guidance`, `knowledge-create-kb`,
  `knowledge-ingest`, `knowledge-lint-index`, `knowledge-create-kb-band-scope`,
  `knowledge-create-kb-band-scope-seed`, `knowledge-create-kb-band-scope-commit`,
  `knowledge-kb-maintain-session`, `knowledge-explore-tabs`).
  - **Tabs (R6-08 WI-3, RULING 5 — URL-synced via `?tab=`):**
    `[data-tab="explore"|"health"|"ingest-activity"][data-tab-active="true"|"false"]`,
    one button per tab; clicking pushes `?tab=<id>` into the URL, deep-linkable
    like `?id=`/`?node=`/`?theme=`. **Explore** (default — `?tab=` absent) is
    the pre-existing graph + reader body, re-anchored under this branch
    unchanged; **Health** hosts `LintResolutionPanel` + `GuidancePanel` +
    `KbHealth` (moved under this branch, F1 — no longer rendered
    unconditionally); **Ingest Activity** is the new read-only
    `IngestActivityPanel` (see below). Journey: `knowledge-explore-tabs`.
  - **Graph browser (Explore tab):** `[data-page="knowledge"][data-page-ready]`, force-graph
    root `#kb-svg[data-kb-id][data-node-count][data-edge-count][data-selected-node]`,
    per-node `[data-node-id][data-layer="theme"|"index"|"guidance"]` with a
    `[data-hit]` inner hit-circle (click target — the outer `<g>`'s bbox
    centre is pushed off-centre by the label). Node click opens the article
    pane (`[data-node-article-body]`); the KB selector is `#kb-select`, one
    `<option value="<kbId>">` per KB `loadKbDescriptors` finds walking
    `brain/*` AND `brain/projects/*` (ADR 035 central per-project brains, e.g.
    `mdtoc`, `gitpulse`, alongside the OOTB `cycles`/`forge-dev`). The right
    rail also lists every theme-layer node as text (R6-08 WI-3 F1) —
    `[data-component="theme-list"]` with per-row
    `[data-theme-node=<id>][data-theme-active="true"|"false"]` buttons calling
    the SAME `onSelectNode` the graph's node-click already uses — a non-graph
    way to reach a theme. **`?theme=<slug>` deep-link (RULING 1):** a thin
    alias onto the existing `?node=` selection machinery, restricted to
    theme-layer nodes only (never an index/raw/guidance node) — `?node=` still
    takes priority when both are given.
  - **New-KB form (`/knowledge/new`):**
    `[data-page="knowledge-new"][data-page-ready="true"][data-section="kb-new"]`.
    Fields: `[data-field="kb-name"]`, `[data-field="kb-binding-kind"]`
    (`flow` | `project`), `[data-field="kb-binding-ref"]` (options populated
    from `GET /api/studio/flows` or `GET /api/studio/projects` depending on
    kind), `[data-field="kb-desc"]`. **`[data-field="kb-binding-band"]`
    (R1-06 WI-2 group A)** renders ONLY when `kind === 'flow'` — `null`
    (field absent) for `project`/`unique`, since a band scope is meaningless
    there. Its options are the bound flow's REAL derived bands
    (`deriveKbBandOptions`, `forge-ui/lib/studio-client.ts`, pure/DOM-free —
    the flow roster's `bands: string[]` the `GET /api/studio/flows` payload
    now carries, itself `listFlowBandIds` reading each node agent's own
    `guards:` through `orchestrator/agent-bands.ts`'s `resolveBandGuard` —
    never a hardcoded list, and `[]` for an unbound ref or a bandless flow,
    not a fabricated default). Submit is `[data-action="create-kb"]`
    (disabled until name + binding are filled); on success the server
    validates `binding.band` against that SAME real vocabulary
    (`POST /api/studio/kbs`, `cli/bridge-studio-kbs.ts`) and writes it into
    `kb.yaml`'s `binding.band` — never silently dropped between the picker
    and the descriptor.
  - **Create hand-off → a real seeding session (R1-06-F2).** A successful
    `POST /api/studio/kbs` response is `{ ok: true, id, sessionId }` — the
    SAME `{ok, sessionId}` shape `POST /api/project-brain/start` already
    established — and the route ALSO writes a `project-brain` session
    `status.json` (`phase: 'briefing'`, carrying the created KB's own
    `kb_id`/`kb_binding` so a band-scoped KB seeds against its real scope,
    not a re-derived guess). The form itself does not surface the
    `sessionId` or navigate to it (`router.push('/knowledge')` on success) —
    an operator/automation that wants to view the hand-off reads the POST
    response directly. Where the session lands depends on the binding kind:
    - `binding.kind === 'project'` — the session nests under that REAL,
      discovered project's own dir:
      `projects/<ref>/_project-brain/<sessionId>/status.json`. It is
      genuinely viewable at
      `/sessions/project-brain/<sessionId>?project=<ref>` (the shared
      session-shell route above, `kind: 'project-brain'`) — `?project=` is
      required and `SLUG_RE`-validated, and a real project id passes.
    - any other binding kind (`flow`, `unique`) has no natural project home,
      so the session is nested under a **dot-prefixed anchor**:
      `projects/.kb-<kbId>/_project-brain/<sessionId>/status.json`
      (`KB_SEEDING_ANCHOR_PREFIX = '.kb-'`, `cli/bridge-studio-kbs.ts`). Both
      `discoverProjects` and the KB descriptor walk (`subDirs`) already skip
      dot-prefixed dirs — a real project/KB id is slug-validated with no
      leading dot — so this keeps the session on disk and runner-reachable
      while never surfacing as a phantom project on the library. **Since
      R4-19 WI-2** it is also **reachable through the session-shell route**:
      `invalidProjectReason` (`cli/bridge-studio-sessions.ts`) carries a
      bounded carve-out — `project=.kb-<id>` passes when the post-prefix
      remainder matches the SAME `SLUG_RE` every other project id is checked
      against, so `/`, `..`, NUL, and an empty slug still reject (general
      leading-dot traversal defense is unchanged; this is never a broad
      leading-`.` allow). Before WI-2 a leading `.` failed that check
      outright — a 400, not a 404 — genuinely on disk but with no page to
      view it from; that gap is closed.
    - **What is real vs. not (R1-06 + R4-19 WI-1/WI-2 vs. R4-19-F2):** the
      HAND-OFF itself (sessionId, correct anchor, `kb_id`/`kb_binding` on the
      status file) is R1-06's own shipped surface. **Now also real:** the
      session is reachable and drivable end to end — briefing (a real
      `POST /api/project-brain/brief` flips `phase → analyzing` on disk),
      and the commit step (`runCommitStep`,
      `orchestrator/project-brain-builder-runner.ts`) is fully deterministic
      — no SDK call — so it can be invoked directly once `phase ===
      'committing'`, landing a genuine write into `brain/<kbId>/`. WI-1
      additionally branches the analyze step's own plan
      (`buildAnalyzePlan`) on `kb_binding.kind`: a `flow` binding *with* a
      `band` (the create-kb-cycle shape) has no project repo to read, so its
      `cwd` is the forge-owned cycle archives (`cyclesRawDir`) and its
      prompt asks the agent to synthesize durable patterns from each
      archived cycle's logged review-band / adversarial-review findings —
      every other binding shape stays on the byte-identical, pre-WI-1
      project-repo read. **What still has no agent behind it:** the
      SDK theme-authoring turn itself never runs under
      `FORGE_ARCHITECT_NO_SPAWN=1` (this harness's env, same as every other
      agentic surface) — the journey harness (`knowledge-create-kb-band-
      scope-seed`) honestly narrates a scripted stand-in there, grounded in
      forge's own real, already-committed review findings, never presented
      as a real agent run. Docs/roadmap pointer:
      `docs/roadmaps/R1-contract-componentry.md` R1-06-F2,
      `docs/roadmaps/R4-ootb-suite.md` R4-19. `kb-maintain`'s SEPARATE
      multi-turn "maintenance agent" narration gap (R4-19-F2) is untouched by
      this — Consolidate's real shipped shape stays a direct dispatch-and-
      poll, not a chat session.
  - **KB maintenance panel:**
    `[data-component="kb-maintenance"]`, with `[data-consolidate-state]` on
    that same root once a consolidate run reaches a terminal (`'cleared'` |
    `'not-cleared'` | `'failed'` | `'running'` — absent before the first
    run, reset to `''` the moment a new one starts). Actions:
    `[data-action="kb-lint"]` (deterministic `forge brain lint`, scoped to
    the KB's own dir), `[data-action="kb-index"]` (index refresh),
    **`[data-action="kb-maintain-session"]` (R1-06 WI-3 — dispatches
    `op=consolidate`)**, `[data-action="kb-delete"]` (guarded: `cycles` and
    `forge-dev` are server-refused, 403). Consolidate is genuinely
    asynchronous — `forge-ui/lib/kb-consolidate.ts`'s `runConsolidateToTerminal`
    dispatches, reads the returned `runId`, and polls
    `getAgentFixStatus` (bounded, 40 × 250ms) to a real terminal before the
    button's own `[data-component="kb-maintenance-result"]` label and
    `[data-consolidate-state]` update — never a static "session started"
    message. The terminal state is computed CI-safely: findings scoped to
    the KB (`resolveKbBrainDir`-identity-matched, both `brain/<id>` and the
    central `brain/projects/<id>`) whose `resolution === 'agent'` are first
    run through `applyDeterministicConsolidateFixes` — the ONE fully
    deterministic shape, `checkProjectBrainIndexes`'s "not listed in project
    category index" finding (only ever raised for a `brain/projects/<id>`
    brain), resolved in-process via the same `ensureLinkedAt` idempotent
    append `op=fix-auto` already uses, zero spawn — before any real agent
    turn is attempted, and a real agent turn is only attempted at all when
    NEITHER `FORGE_ARCHITECT_NO_SPAWN=1` nor the dry-bridge seam is active
    (mirrors `spawnAgentTurn`'s own guard). A KB re-lint after the run
    computes the real `cleared`/`total` count the terminal event carries.
  - **KB health panel (Health tab):** `[data-component="kb-health"][data-lint-errors][data-lint-warnings]`
    (numeric strings — `lintErrors`/`lintFlags`, findings scoped to this
    KB's own dir by the same identity-matched `resolveKbBrainDir` walk
    consolidate uses, so a sibling KB's findings never leak in and a
    `brain/projects/<id>` KB's findings are no longer invisible the way the
    pre-WI-3 hardcoded `brain/<id>` prefix made them, MAJOR 1). Layer
    balance / connectivity / staleness render unconditionally; the "Lint"
    sub-section renders only when `lintFlags > 0 || lintErrors > 0`. The
    "Suggested action" copy (staleness-driven) reads "Run a consolidate
    pass, check lint, or leave a guidance note" — **it no longer says
    "manual ingest"** (R1-06 WI-3, operator decision 3): ingest stays
    reflection-only, and no route or action anywhere on this page (or
    `/knowledge/new`) triggers one.
    - **Per-check itemization (R6-08 WI-1, honesty invariant "4on"):**
      `checks: KbHealthCheck[]` renders one row per named check —
      `[data-check=<name>][data-check-status="pass"|"warn"|"fail"|"unknown"|"n/a"][data-check-count]`
      (`errorCount+flagCount`) — for the 10 checks in `CHECK_NAMES`
      (`cli/brain-lint.ts`, in order): `checkFrontmatter`, `checkIndexSync`,
      `checkSourceLinks`, `checkStaleness`, `checkOrphans`,
      `checkProjectBrainIndexes`, `checkLengthSoftCap`, `checkContradictions`,
      `checkCategoryScope`, `checkReflectorLoss`. **`status:'pass'` means the
      check genuinely ran over THIS KB's own content and found nothing** —
      never a silent pass for a check that never looked (the
      declared-data-fails-open bug class 4on fixed). A check is real
      (`pass`/`warn`/`fail`) only when either (a) `CHECK_SCOPE[name]` covers
      this KB's exact dir (`forge-themes` ⇒ `brain/cycles`/`brain/forge-dev`
      only; `project-indexes` ⇒ a direct `brain/projects/<id>` child) or
      (b) it's one of `LINT_THEME_FILE_CHECKS` (`checkFrontmatter`/
      `checkSourceLinks`/`checkIndexSync`) and this KB's own theme files are
      scanned directly (`lintThemeFiles`, covers ANY kb kind — including
      project/band KBs the shared full-scope scan never walks). Everything
      else reports the honest `'n/a'` — `checkReflectorLoss` (a `global`
      `_queue/done` advisory) is `'n/a'` for every KB, always, since it is
      never scoped to any one KB. `status:'unknown'` fires only when the
      whole lint run threw, paired with a top-level `healthError` string
      (RULING 3) — never a silent 0/0 clean. Journey: `knowledge-explore-tabs`
      asserts both a real check (`checkFrontmatter` on the `cycles` KB) and
      the always-`n/a` `checkReflectorLoss`, side by side, in the same panel.
  - **Ingest Activity panel (R6-08 WI-2) + no ingest affordance (decision 3,
    cross-referenced R1-06-F3 + R6-08-F2):** the Ingest Activity tab hosts a
    real, **read-only** `IngestActivityPanel` —
    `[data-component="ingest-activity"][data-ingest-event-count]`, one row per
    real `reflect.kb-ingest` event (`orchestrator/kb-health.ts`'s post-reflect
    `runPostReflectionKbHealth`) found in this KB's own
    `_logs/<cycleId>/events.jsonl` history
    (`GET /api/studio/kbs/:id/ingest-activity`, `cli/bridge-studio-kbs.ts` — a
    plain filesystem scan over `listCycles`, never a synthetic in-memory
    list): `[data-ingest-kb=<kb>]`, `[data-ingest-fresh-themes=<n>]`,
    `[data-ingest-impl="builtin"|"cmd"]`. **The invariant survives
    unchanged:** the panel is GET-only — it has no button and no
    `data-action` anywhere in its markup, so nothing on this page (or
    `/knowledge/new`) can trigger an ingest; ingest itself stays a
    reflection-only pass (the reflector phase), never a KB-page-triggerable
    operation. `scripts/check-kb-ingest-affordance.test.ts` is the standing
    ratchet — it fails the build the moment any UI `data-action` or bridge
    route dispatch arm names `ingest`. Journey: `knowledge-explore-tabs`
    asserts both the rendered seeded event AND the negative affordance count
    (`button`/`[data-action]` inside the panel) is zero.
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
  8 templates — `contract`, `plan`, `work-items`, `wi-branches`, `pr`, `verdict`,
  `demo-fix-spec`, `review-findings`), `studio/demo-elements/*.md` (category
  `demo-output`, 6 templates — `screenshot`, `cli-capture`, `code-diff`,
  `api-verify`, `test-evidence`, `narrative`), and
  `studio/starters/projects/<id>/` (category `project-scaffold`, 3 scaffolds
  — `typescript-api`, `typescript-cli`, `typescript-web`); 17 entries total
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
- **Trigger provenance — named by R2-08-F4, now PARTLY ATTACHED (amended
  R6-01, 2026-08-07).** `GET /api/runs` / `GET /api/runs/<id>` surface an
  optional `run.trigger: {kind, source, scope}` — derived, never stored; a run
  with no derivable provenance carries no `trigger` key at all. A read-only
  `GET /api/triggers` lists every declared `FlowTrigger` across the whole flow
  roster as `{on, target, projects, sourceFlowId}`, `projects: null`
  (unscoped) kept distinct from `projects: []` (scoped to nothing) on the
  wire. Per ADR-027's R2-08 amendment ("the `data-*` vocabulary is named by
  R2-08-F4 and attached by the consuming surfaces"):
  - a **run's own trigger** renders `[data-trigger-kind][data-trigger-source]
    [data-trigger-scope]` (`data-trigger-scope=""` when `scope` is `null` —
    an unscoped trigger is a real, distinct state, never omitted and never
    stringified as `"null"`). **ATTACHED by R6-01-F4** on the flow run-detail
    page, inside `[data-section="run-trigger"]`; a run with no `trigger` key
    renders no trigger section at all.
  - a **standing-trigger row** (the `/api/triggers` listing) renders
    `[data-standing-trigger][data-trigger-kind][data-trigger-target]
    [data-trigger-scope-count]`. **ATTACHED by R6-01's rider** (R6-04's
    parked WI-6) on the agent kickoff panel.

  ⚑ **This paragraph previously read "no attribute below is attached to any
  DOM element by this initiative"** — true when R2-08-F4 wrote it, and stale
  the moment the first consuming surface landed. Corrected here rather than
  left to rot, because a `data-*` contract doc that misreports which half of
  itself is live is worse than no doc: automation trusts it. **R6-05/R6-06
  ledgers are the remaining unattached consumers** — this bullet is the place
  to amend when they land.

  ⚑ **R6-05 amendment (2026-08-08): the flow history ledger landed WITHOUT
  attaching this vocabulary, deliberately.** Trigger provenance is not among
  R6-05-F1's acceptance criteria, and the ledger row links to the run-detail
  page, which already renders `[data-trigger-kind][data-trigger-source]
  [data-trigger-scope]` (R6-01-F4) — so the provenance is one click away, not
  lost. The reason for deferring rather than adding it here: `LedgerRow` is a
  **shared** type that R6-06's agent ledger reuses, so adding `trigger` to it
  when R6-06 lands attaches the vocabulary to BOTH ledger surfaces in one
  change, instead of one now and one later with two chances to diverge.
  **R6-06 is therefore the remaining unattached consumer, and it inherits this
  bullet.** Recorded as a deliberate deferral with its reason rather than left
  as a silently unmet intention.

  ✅ **R6-06 amendment (2026-08-08): DISCHARGED — the vocabulary is now attached
  to BOTH ledgers in one change, exactly as the deferral promised.** `LedgerRow`
  gained an OPTIONAL `trigger`, set verbatim from `run.trigger` by
  `flow-ledger.ts` and from the run/entry by `agent-ledger.ts`; `HistoryLedger`
  emits `[data-trigger-kind][data-trigger-source][data-trigger-scope]` **only
  when `row.trigger !== undefined`**, so a run without a trigger renders no
  trigger attributes at all rather than empty ones — an absent trigger and an
  unscoped trigger are different facts and must not read alike. A trigger that
  IS present but unscoped emits `data-trigger-scope=""` (`scope ?? ''`), which
  is the honest rendering of "triggered, no scope", not a missing attribute.
  The conditional shape is also what keeps every pre-R6-06 flow-ledger row
  **byte-identical**, which is pinned by its own regression test — adding a
  shared field must not perturb the surface that already shipped.

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
- **Roadmap initiative status** (`RoadmapDag.tsx`) — `pending |
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
is a thin runner over 13 user-story journeys in
[`scripts/journeys/`](./scripts/journeys/) — `skills`, `hooks`, `templates`,
`connections`, `stand-up-onboard`, `stand-up-create`, `knowledge`, `agents`,
`flows-author`, `flows-run`, `roadmap`, `demo-builder`, `community`
(RUN_ORDER's own sequence, `index.mjs`) — one file per journey (plus
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
