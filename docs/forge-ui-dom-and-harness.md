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

- **Global nav — `StudioNav` (`[data-component="studio-nav"]`,
  `components/StudioNav.tsx`, W6-IA-5).** The six-pillar top nav rendered on
  every page. Data contract (`NAV_ITEMS`) and active-pillar rules
  (`isNavItemActive`, a pure function exported for direct table-driven
  testing — `components/StudioNav.test.ts`) are both plain data, not scraped
  from markup:

  | id | label | href |
  | --- | --- | --- |
  | `home` | Home | `/` |
  | `projects` | Projects | `/projects` |
  | `flows` | Flows | `/flows` |
  | `agents` | Agents | `/agents` |
  | `library` | Library | `/library` |
  | `knowledge` | Knowledge | `/knowledge` |

  Each link carries `data-nav="<id>"` and lights an `active` class per a
  data-driven prefix table (replacing R6-03-F3's original per-id
  special-cases): `home` matches the exact root `/` only; `projects`,
  `flows`, `agents`, `knowledge` match their own href as a prefix (`p` or
  `p/*` — boundary-checked, so `/agentsomething` does NOT light `agents`);
  `library` matches `/library` **plus** the five-shelf "library island" —
  `/skills`, `/hooks`, `/connections`, `/templates`, `/community` (those
  routes are library sub-kinds, not separate pillars). Session-shell routes
  (`/sessions/*`, `/architect/*`, `/project-brain/*`, `/instructions/*`,
  `/demo/*`) and `/artifact` deliberately light no pillar — they're reached
  from within a page, not the nav. Before W6-IA-5, Flows/Agents deep-linked
  straight into a specific build/monitor surface (`/flows/forge-develop`,
  `/agents/new`); now every pillar points at its own kind's real browse
  index (built by IA-1/2/3), and a specific flow/agent is reached via a card
  on that index — see the `/flows`, `/agents`, `/projects` entries below.
  Journey coverage: `scripts/journeys/flows-onboard.mjs`'s `FOB.nav`
  assertions (pillar count + Home/Library hrefs) and
  `scripts/journeys/flows-run.mjs`'s `run-build-monitor` clip (a real
  `[data-nav="flows"]` click lands on the flows index, then a real flow-card
  click reaches the monitor — not a direct nav deep-link); `scripts/e2e-
  deadpaths.mjs` additionally crawls every `[data-nav]` href on every route
  and asserts it resolves to a known, live page.
- **Home `/`** — the operator's ONE dashboard (R6-07; consolidated by
  W6-IA-4). Data plumbing — the same six existing reads
  (`fetchStudioAgents`/`Flows`/`Projects`/`Kbs` + `fetchRuns` +
  `fetchProjectAttention`) plus the bridge WS `subscribe()` hookup — is
  EXTRACTED into ONE shared hook, `lib/use-studio-home-data.ts`'s
  `useStudioHomeData()` (W6-IA-4 sweep finding C1#5: Home and the OLD Library
  landing page used to byte-duplicate this exact loadAll/refreshRuns/
  subscribe() shape; the rebuilt Library page below no longer needs any of
  these six reads at all, so the duplication was retired at the source, not
  merely deduped). Home is the hook's only caller; `lib/home-view.ts` stays
  the pure derivation layer (`buildConstellation`/`buildHomeAttention`) —
  no new endpoint, no bespoke poll loop
  (`scripts/home-no-new-polling.test.ts` now asserts these invariants against
  the hook file rather than comparing `app/page.tsx`'s source to
  `app/library/page.tsx`'s). Root:
  `main[data-page="home"][data-page-ready][data-live-count][data-attention-
  count][data-hex-count]`. Header actions: `[data-action="onboard-project-
  cta"]` (`href="/projects/new"`, always) and `[data-action="watch-live-run"]`
  — W6-IA-4 sweep finding C1#2: this USED to hardcode `href="/flows/forge-
  develop"` unconditionally; `home-view.ts`'s `deriveWatchLiveRunHref(runs)`
  now derives it from an ACTUAL live run (`active` beats `gated`; no
  active/gated run at all falls back to `/flows`, never a fabricated specific
  flow). Three sections:
  - `section[data-section="attention-strip"]` — present ONLY when
    `[...buildHomeAttention(attention), ...buildKbAttention(kbs)]` returns ≥1
    row (a real condition, never rendered on the mere existence of a project
    or KB). Every row carries `data-attention-kind="gate"|"kb"` (forge-2am) so
    the two sources are told apart in the DOM. **Gate rows**
    (`buildHomeAttention`) are a real
    `a[data-attention-item][data-attention-kind="gate"][data-attention-project][data-attention-status]`
    whose `href` is `/projects/<id>` (the owning project's own page) and whose
    `data-attention-status` is `gated|flagged` — the row also carries the same
    five raw `data-attention-<planned|in-flight|gated|merged|flagged>` counts,
    read straight off the same `fetchProjectAttention()` row. The row's VISUAL
    `.status-dot` maps that real status through `home-view.ts`'s
    `GATE_ATTENTION_STATUS_FRAME`/`gateAttentionStatusDot()` (W6-IA-4 sweep
    finding C1#3 — was a hardcoded `data-status="retrying"` for EVERY gate
    row, regardless of `item.status`): `gated -> retrying` (awaiting review —
    the routine, recoverable-in-progress case), `flagged -> failed` (review
    actually flagged something — a real defect, not a routine wait), mirroring
    `KB_ATTENTION_STATUS_FRAME`'s own established errors→failed/warn→retrying
    pattern; the `data-attention-status` ATTRIBUTE always carries the real,
    unmapped value — the frame is consulted ONLY for the dot's own
    `data-status`. **KB rows** (`buildKbAttention`, forge-2am) are
    `a[data-attention-item][data-attention-kind="kb"][data-attention-kb][data-attention-status]`
    with `href="/knowledge?id=<id>"` (the row's React `key` is `kb-<id>`-shaped
    but a `key` is React-internal bookkeeping, never rendered to the DOM — the
    row carries no `id` attribute at all; find it via `data-attention-kb`
    instead); `data-attention-status`
    is `fail|warn|unknown` (never `gated|flagged`, the gate-row vocabulary) —
    `unknown` means the KB's own lint run threw (`lint.error` present), an
    HONEST "the server cannot attest" signal, never a default. The row also
    carries the KB's own lint summary verbatim:
    `data-attention-lint-errors`, `data-attention-lint-flags`,
    `data-attention-checks-run`, `data-attention-checks-total` — the last two
    surface the n/a-invariant (only SOME of forge's brain-lint checks actually
    inspect a given KB, e.g. a project-brain KB is only ever scanned by
    `checkProjectBrainIndexes`'s `project-indexes` scope — see
    `cli/brain-lint.ts`'s `CHECK_SCOPE`) so `checksRun < checksTotal` reaching
    the operator honestly says "N of M checks actually ran", never implying a
    full clean sweep. A KB with `lint === null` (no data yet) or an all-zero
    clean lint renders NO row at all — absence is honest, a fabricated "clean"
    row is not.
  - `section[data-section="constellation"][data-hex-count]` — one
    `a.home-hex[data-hex-kind][data-hex-id][data-hex-status]` per flow/agent/
    project/KB (`data-hex-kind` is `flow|agent|project|kb`), href routing to
    the owning surface (`/flows/<id>`, `/agents/<id>`, `/projects/<id>`,
    `/knowledge?id=<id>`). Status (`active|gated|idle`) is ALWAYS derived —
    never a `.status` field the wire types don't carry (`home-view.ts`'s own
    declared-data-fails-open discipline); a KB has no live-status source at
    all and is always `idle`. Empty state:
    `[data-component="constellation-empty"]` — W6-IA-4 sweep finding C1#4: NOW
    carries a real `[data-action="constellation-empty-cta"]`
    (`href="/projects/new"`) alongside the "Nothing registered yet." text —
    was terminal, dead-end text with no way forward.
  - `section[data-section="activity"]` wraps a shared `HistoryLedger`
    (`components/studio/HistoryLedger.tsx`, below) — W6-IA-4: now the MERGED
    everything-ledger, interleaving the flow-run rows (`deriveFlowLedgerRows`,
    unchanged) with recent standalone/flow-node agent runs
    (`lib/agents-index.ts`'s `fetchRecentAgentRuns`, fetched independently
    once the roster is ready — mirrors `app/agents/page.tsx`'s own two-effect
    precedent) via `home-view.ts`'s `buildHomeLedgerRows` (which reuses
    `mergeRecentAgentRuns` UNCHANGED — a generic flatten/sort/dedupe-by-id/
    bound merge, not agent-specific despite its name; a run id shared by BOTH
    a flow row and an agent row dedupes to the FLOW row, so one run is
    attributed once, as a flow). Rendered via `HistoryLedger`'s new
    `showKindChip` prop (additive, `false`/omitted everywhere else — every
    OTHER existing caller renders BYTE-IDENTICALLY): each row carries
    `data-ledger-kind="flow"|"agent"`, derived via `ledgerRowKind(row)`
    (`lib/history-ledger.ts`) off the row's OWN existing `linkKind` field —
    `undefined` (every flow-ledger.ts row) -> `flow`; any agent-sourced
    `linkKind` (`flow-node`/`standalone`/`session`) -> `agent` — plus a
    visible `[data-ledger-kind-badge]` chip.
  - `section[data-section="active-sessions"][data-active-session-count]
    [data-needs-you-count]` (W6-B11, the IA-4 marked slot) — the aggregate
    in-flight-sessions strip, rendered ONLY when at least one session is
    in flight (the same "never on mere existence" rule the attention strip
    above follows). Data: `lib/use-studio-home-data.ts`'s SEVENTH read,
    `fetchStudioSessions()` (`?active=1` default — operator-locked,
    in-flight sessions ONLY, never terminal history), folded into the same
    `loadAll` `Promise.all` and refetched on the SAME debounced
    `cycle-list-changed` WS handler as `runs` (one shared debounce, not a
    second timer — see the hook's own header). Derivation:
    `home-view.ts`'s `buildHomeSessionsStrip(sessions)` — a pure `.slice`
    to `HOME_SESSIONS_STRIP_LIMIT` (4) cards, trusting the bridge's own
    needs-you-first-then-newest sort (never re-sorted client-side);
    `needsYouCount`/`totalCount` are counted over the FULL set, not just the
    4-card slice, so the header stays honest once needs-you sessions exceed
    the card budget. Header: an "N need you" pill (present only when
    `needsYouCount>0`) plus `a[data-action="view-all-sessions"]
    href="/sessions"` reading "all sessions (N) →". Each card:
    `a[data-session-card][data-session-kind][data-session-phase]
    [data-needs-you]`, linking to the session's own `href` (the SAME
    `/sessions/<kind>/<sessionId>?project=<p>` shell URL the wire row
    carries); a needs-you card additionally renders a `.status-dot
    [data-status="retrying"]` visual indicator (styling only — the DOM
    contract attribute is `data-needs-you`, never the dot's own frame value).
  Journey coverage: `scripts/journeys/home.mjs`'s `home-landing` beat (seeds
  a real instructions session via the harness's existing
  `writeInstrStatus`/`cleanInstructionsSession` helpers, `HOME_SESSION_SID`)
  + `scripts/journeys/sessions-index.mjs` (the strip's own overflow-link
  entry point into `/sessions`, below).
- **Sessions `/sessions`** (W6-B11) — the aggregate in-flight sessions index.
  Deliberately NOT a `StudioNav` pillar (operator decision — the six-pillar
  nav stays closed); reached from Home's active-sessions strip header (above)
  and from a secondary-nav link on the Agents index
  (`a[data-nav="sessions-secondary"]`, `components/studio/AgentsIndexView.tsx`,
  next to the "+ New agent" CTA). Data: `GET /api/studio/sessions?active=1`
  (`cli/ui-bridge.ts`'s `handleStudioSessionsIndex` — flattens every
  registered session kind, `studio/session-kinds.yaml`, across every
  project; the four legacy kinds — architect/instructions/demo/project-brain
  — reuse their OWN existing `list*Sessions` readers verbatim, no second
  scanner; every other kind — onboarding/authoring/kb-cleanup — falls
  through to a generic per-segment-guarded directory scan. Rows carry
  `{kind, sessionId, project, phase, terminal, needsYou, modelTier,
  updatedAt, href}`, sorted needs-you-first-then-newest and capped to the
  newest 200 (`SESSION_INDEX_MAX_ROWS`) by `sortAndCapSessionIndexRows`).
  Root: `main[data-page="sessions-index"][data-page-ready]
  [data-session-count]`. Non-empty state: `section[data-section=
  "sessions-table"][data-session-count]` wrapping a table — one
  `tr[data-session-kind][data-session-phase][data-needs-you]` per session,
  columns kind/project/phase(+needs-you dot)/model tier/updated/
  `a[data-action="resume-session"]` ("Resume →", the row's own `href`).
  Rows render in the SAME order the bridge returned them — this page never
  re-sorts. Empty state (only once `ready` AND genuinely zero rows — never a
  false flash before the first fetch resolves):
  `section[data-section="sessions-empty"]`, "No sessions in flight" plus one
  kickoff CTA per `a[data-action="kickoff-<kind>"]` for the 5 generic
  kickoff kinds (`/sessions/<kind>/new` — instructions/demo/project-brain/
  kb-cleanup/authoring) plus architect's bespoke native entry
  (`/architect/new` — ADR-043 amendment §4, architect never gets a generic
  kickoff row). Split: `components/studio/SessionsIndex.tsx`'s
  `SessionsIndexBody` is the pure, props-driven presentational component
  (render-tested via `lib/sessions-index-render.test.ts`, the same
  `renderToStaticMarkup` + `next/navigation` mock pattern as
  `ProjectsIndexBody`); `app/sessions/page.tsx` is the thin fetch-owning
  wrapper. Journey coverage: `scripts/journeys/sessions-index.mjs` (entry
  point: Home's strip overflow link, per the entry-point rule — never opens
  mid-flow on `/sessions` itself).
- **Library `/library`** — SHELVES ONLY (W6-IA-4 rebuild, 2026-08-15): the
  reusable building blocks every agent and flow composes from, NOT a
  dashboard. `[data-page="library"][data-page-ready]`. The OLD landing page
  (hero, Operator Pulse mini-panel, first-run orientation, cross-project
  attention strip, and four data shelves — projects/agents/flows/knowledge
  bases) is GONE; every one of those object kinds now has its OWN real index
  route (`/projects` W6-IA-1, `/flows` W6-IA-2, `/agents` W6-IA-3, `/knowledge`)
  and Home (above) owns the one dashboard + attention strip. Library is a
  pure, props-driven presentational component,
  `components/studio/LibraryHub.tsx`'s `LibraryHub` (render-tested via
  `lib/library-hub-render.test.ts`, the SAME `renderToStaticMarkup` +
  `next/navigation` mock pattern as `ProjectsIndexBody`/`AgentsIndexView`);
  `app/library/page.tsx` is the thin fetch-owning wrapper, running the five
  shelves' fetches as FIVE INDEPENDENT effects (each reusing the EXACT SAME
  fetcher its own full library page already calls — `fetchSkillLibrary`/
  `fetchHookLibrary`/`fetchConnections`/`fetchTemplateLibrary`/
  `fetchCommunityIndex` — so one dead bridge route never blanks the other
  four; `data-page-ready` gates on all five having settled, success or
  error). Five shelves, in the operator-locked order **Skills / Hooks /
  Connections / Templates / Community**, each `section[data-section="<name>"]
  [data-count]` with a header carrying the real count, a "browse all →" link
  (`[data-action="browse-<name>"]`, routing to that kind's own full library
  page), and — where the kind supports authoring — a create CTA reusing that
  page's OWN `data-action` name (`[data-action="new-skill"]` → `/skills/new`,
  `[data-action="new-hook"]` → `/hooks/new`). Connections and Templates carry
  NO create CTA (curation happens by PR to `studio/catalog.yaml` for
  Connections; Templates has no `/templates/new` route — registry-scanned,
  not authored here); Community carries `[data-action="browse-community"]`
  only, never a create CTA (installs route through the owning pipeline's own
  page). Each shelf shows up to `LIBRARY_SHELF_CARD_LIMIT` (6) cards — a
  PREVIEW, not a second copy of the full list page — reusing each source
  page's own pure badge-derivation function (`skillBadges`/`hookBadges`/
  `connectionBadges`/`templateBadges`) rather than re-deriving anything; a
  card's `data-card-type` (`skill`/`hook`/`connection`/`template`/
  `community-item`) and its detail-route `href` match that kind's own full
  library page exactly. A final `section[data-section="kb-crosslink"]` carries
  one small `[data-action="kb-crosslink"]` card (`href="/knowledge"`) — Library
  no longer creates or lists knowledge bases at all (KBs moved to the
  Knowledge pillar, sweep finding C4#1 below); `KbCard`
  (`LibraryCard.tsx`) itself is now unused in the live product (its own
  render-test coverage, `lib/library-card-render.test.ts`, is unaffected —
  the component itself is unchanged, just no longer wired into any page).
  `StudioNav` (`[data-component="studio-nav"]`) is UNCHANGED by this rebuild
  — see the Global nav entry above (W6-IA-5) for the current six-pillar
  set/order/hrefs and active-state rules.
  Journey coverage: `scripts/journeys/stand-up-create.mjs`'s
  `su-create-library` beat (the five shelves + the KB cross-link); every
  OTHER journey beat that used to enter creation through a Library shelf now
  enters through that kind's own real index (`/projects`, `/flows`,
  `/agents`) or, for KBs, the Knowledge page's own persistent `+ New KB` /
  its `#kb-select` discovery affordance — see each route's own journey-
  coverage note below.
- **`/flows` — the flows index (W6-IA-2).** The flows pillar's own browse
  surface, added alongside the pre-existing `/flows/[id]` and `/flows/new`
  routes below — until this landed there was no way to browse every flow
  except via `/library`'s flows section (RETIRED by W6-IA-4 — see the Library
  entry above; `/flows` is now the ONLY browse surface for flows). Root:
  `main[data-page="flows-index"][data-page-ready][data-flow-count]`. The body
  is a separate presentational component, `FlowsIndexBody`
  (`components/studio/FlowsIndexBody.tsx`, render-tested directly since the
  page itself fetches via `useEffect` — the same known SSR-render gap as
  every other dynamic Studio page). "What counts as empty" uses this page's
  own `hasUserFlow` first-run key (originally mirrored from the OLD Library
  landing page's now-retired equivalent, W6-IA-4; review-round fix — a naive
  `flows.length === 0` check is dead code on any real install, which ships
  ~5 OOTB seed flows), giving **three** states: **true-empty**
  (`flows.length === 0`, an artificial state kept honest rather than assumed
  unreachable) renders `[data-component="flows-zero-state"]`; **first-run**
  (OOTB flows exist but none carry `origin: "studio"`) renders
  `[data-component="flows-first-run"]` **above** the still-visible grid, not
  instead of it; **steady-state** (a user-authored flow exists) renders the
  grid alone. Both "build your first flow" CTAs (true-empty + first-run)
  carry `[data-action="new-flow-first"]` (`href="/flows/new"`) — deliberately
  DISTINCT from the page header's own always-visible
  `[data-action="new-flow"]` CTA (same target — this "-first"/base-action
  naming split is now the established convention every index page's own
  zero-state CTA follows, e.g. Knowledge's `new-kb-empty-cta` alongside its
  own always-present `new-kb`), so automation can tell the one-time
  onboarding nudge apart from the persistent create affordance instead of
  matching two identically-tagged actions. One or more flows renders
  `[data-component="flows-grid"]`, one **REAL, reused** `FlowCard` per flow
  (the SAME card `/library`'s old flows shelf used to render, before W6-IA-4
  retired that shelf — same `data-card-type="flow"` contract, byte-identical
  rendering, including its live
  `data-flow-status`/`data-flow-gated-count`/`data-flow-failed-count`).
  The page subscribes to the bridge's `cycle-list-changed` event and
  re-fetches runs on it (the same `loadAll`/`refreshRuns` split
  `lib/use-studio-home-data.ts` now uses for Home, W6-IA-4) so those
  run-derived badges stay live rather than freezing at the
  page's initial load. `StudioNav`'s Flows nav item now points straight here
  (W6-IA-5 — was a direct deep-link to `/flows/forge-develop`); a specific
  flow's own monitor is reached via a card on this index, not the nav.
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
  - **`showKindChip` (W6-IA-4, additive, byte-identical-when-absent).** An
    OPTIONAL `HistoryLedgerProps` boolean, default `false`/omitted — every
    EXISTING caller (this flow monitor, `/agents`'s recent-runs section,
    `/agents/[id]`'s own ledger) renders byte-identically to before. Only
    Home's (`/`) merged everything-ledger opts in: each row then also
    carries `data-ledger-kind="flow"|"agent"` (`ledgerRowKind(row)`,
    `lib/history-ledger.ts` — derived off the row's own `linkKind`:
    `undefined` -> `flow`, any agent-sourced value -> `agent`) plus a
    visible `[data-ledger-kind-badge]` chip.
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
  root carries `[data-page="artifact"][data-page-ready][data-run][data-artifact-type][data-mode][data-gate-state]`
  (W6-IA-6: fixed from a stale `data-page="flows"` literal — a page-identity
  mismatch, not a deliberate shared-surface value; every gate/artifact moment
  is still folded into this one route). `type=verdict&mode=gate`
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
  routes are now permanent WIRE redirects into `/artifact` (M7-3, ADR-031;
  converted from client-side shim pages to `next.config.mjs` `redirects()`
  entries at W6-IA-8 — `?run=<id>&type=verdict&mode=gate` /
  `?run=<id>&type=reflection&mode=view` respectively) — no page renders at the
  old path at all now, the 308 lands directly on this route; kept only so
  stale bookmarks keep working.
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
  `[data-action="create-hook"]`). **R4-21 T3 addition (BLOCKER-2 fix):**
  `/hooks/new` also renders the `AuthoringLauncher` (`components/AuthoringLauncher.tsx`)
  as an alternative to the manual form — "describe it to the creation agent
  instead of filling in every field by hand". Section
  `[data-section="authoring-launcher"][data-authoring-launcher-ready="true"|"false"]`,
  fields `[data-field="authoring-launcher-project"|"authoring-launcher-prompt"]`,
  action `[data-action="start-authoring"]`, error `[data-authoring-launcher-error]`
  when present. On start it POSTs `POST /api/studio/authoring/start`
  (`startAuthoring`, `lib/bridge-client.ts`) and navigates to
  `/sessions/authoring/<sessionId>?project=<p>` — see that route below. The
  SAME launcher renders on `/skills/new` (below) — one component, two
  mount points.
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
  [data-kind-filter="all"|"skill"|"hook"|"mcp"|"tool"][data-hub-count]
  [data-sort-key="name"|"stars"|"updated"|"source"][data-sort-dir="asc"|"desc"]`,
  a search field `[data-field="community-search"]`, kind-filter buttons
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

  **Refresh entry (W6-CR-3, 2026-08-15).** `[data-action="refresh-community-registry"]`
  (a real `<a href="/sessions/community-refresh/new">`, rendered via
  `StudioPage`'s `actions` header slot — never a bespoke button) is the
  ONLY thing on this browser that can ever change what it shows: the
  registry is a declared list forge does not crawl on its own (D10 —
  `studio/community/hubs.yaml`'s own header), so an operator explicitly asks
  the community-refresh agent for a verified pass. The link lands on the
  SAME generic `/sessions/[kind]/new` kickoff surface B6 built for every
  other interactive kind (see below), just with `selector:"none"` — no
  project/KB to pick, since the registry is forge's own single file. The
  agent's draft (a `staging/registry.yaml` diff + `staging/evidence.md`)
  stops for an explicit operator `approve`/`reject` verdict before anything
  here ever changes; a `reject`ed draft never touches this browser's data at
  all. Registry rows this browser has never been refreshed for keep
  rendering the honest "seed — never verified" freshness state below —
  refreshing is additive, never retroactive.

  **Sorting (W6-CR-2), operator-locked — SIMPLE SORTS ONLY**: `name`,
  `stars`, `updated`, `source`; there is deliberately no search/facets/tags
  sort. A native `select[data-community-sort]` picks the key, and
  `[data-action="toggle-sort-direction"][data-sort-direction="asc"|"desc"]`
  flips direction — both mirrored onto the root's own `data-sort-key`/
  `data-sort-dir` (the same "state lives on the root too" convention
  `data-kind-filter` already holds). Default is `name`/`asc`, deterministic
  (`forge-ui/lib/community-view.ts`'s `sortCommunityItems`, pure, returns a
  NEW array). `stars` sorts on `signals.starsNumeric`; `updated` sorts on
  `fetchedAt` — the SAME fact the freshness badge below renders, deliberately
  never `upstreamUpdatedAt` (a different claim: upstream's own change date,
  not forge's own last-verified date) — a null value in EITHER sorts LAST
  regardless of direction, never a fabricated zero/epoch. `source` groups by
  the item's hub label, then breaks ties by name.

  Each card additionally carries `[data-fetched-at]` — the item's real ISO
  `fetchedAt`, structurally ABSENT (never an empty string) when null — and a
  `[data-component="freshness-badge"][data-freshness="seed"|"stale"|"fresh"]`
  span (`forge-ui/lib/community-view.ts`'s `freshnessBadge`): `fetchedAt:
  null` renders the spec-literal "seed — never verified" (every item sourced
  from `studio/community/registry.yaml` today reads this way — the
  community-refresh agent's `commitRegistryDraft` finalizer stamps a real
  `fetchedAt` only on a row it actually verified this pass, W6-CR-3; an item
  no operator has ever run a refresh against keeps this honest seed state
  indefinitely, never a fabricated verification date); a `fetchedAt` older than 30 days
  reads "stale"; anything fresher renders a relative time ("3h ago", "2d
  ago"). **A raw date is NEVER rendered for a null `fetchedAt`** — this is
  the freshness-honesty contract the badge exists to enforce.
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

- **`/agents` — the agents index (T2 lane W6-IA-3, 2026-08-15).** New route;
  did not exist before. `StudioNav`'s "Agents" nav item now points straight
  here (W6-IA-5 — was a direct deep-link to `/agents/new`); the
  agent-builder is reached via this index's own `new-agent` CTA. Root:
  `main[data-page="agents-index"][data-page-ready][data-agent-count]`. Two
  independently-ready sections (two different fetches, never one shared
  "loading" flag — a page-level `ready` gates the roster, a separate
  `recentRunsReady` gates the runs section, so neither section's honest
  loading/empty state ever depends on the other's fetch latency):
  - `section[data-section="agent-roster"][data-count]` — the full roster as
    REAL `AgentCard`s (`components/studio/LibraryCard.tsx`, reused
    UNCHANGED — the SAME card `/library`'s old agents shelf used to render,
    before W6-IA-4 retired that shelf in favour of this real index),
    linking to `/agents/<id>`, plus a `a[data-action="new-agent"]` CTA to
    `/agents/new`. `[data-component="agent-roster-loading"]` before the
    roster fetch resolves, `[data-component="agent-roster-empty"]` once
    resolved with zero agents — honest-empty, never a fabricated card.
  - `section[data-section="recent-agent-runs"]` — a cross-agent "recent
    runs" ledger, rendered by the SAME shared `HistoryLedger.tsx` the flow
    monitor and `/agents/[id]`'s own per-agent ledger use (reused
    UNCHANGED, D2 — so the row contract documented once under `/flows/[id]`
    and restated for `/agents/[id]` below is **not restated a third time
    here**). `[data-component="recent-agent-runs-loading"]` before this
    fetch resolves. **There is no aggregate "all agents" bridge route** —
    `lib/agents-index.ts`'s `fetchRecentAgentRuns` fans the existing
    per-agent `GET /api/agents/:slug/history` out across the whole roster
    in bounded-concurrency batches of `AGENT_HISTORY_FAN_OUT_BATCH_SIZE` (6,
    plain chunking, no new dependency — a roster of dozens of agents must
    not fire one simultaneous bridge request per agent), merges the "found"
    rows, **dedupes by `row.id`**, and re-sorts the WHOLE merged set
    newest-first (`sortLedgerRowsNewestFirst`, reused unchanged) before
    bounding to `RECENT_AGENT_RUNS_LIMIT` (20). The dedupe step is
    **required, not cosmetic**: `HistoryLedger.tsx` keys each rendered row
    on `row.id` (`key={row.id}`) — an implicit contract every consumer of
    that shared component must uphold. A single flow run with two nodes
    owned by two different agents resolves to two rows sharing the SAME
    `row.id` (different `row.href`/node) once both agents' histories are
    merged here; without the dedupe step in `mergeRecentAgentRuns` (BEFORE
    the merged rows ever reach `HistoryLedger`), that is a duplicate React
    key, not merely a double-listing. KNOWN LIMITATION (documented in that
    module's header, not closed here): which specific node's `href`
    survives for a deduped id is whichever agent's fetch happened to
    flatten first — arbitrary from the caller's perspective. A server-side
    aggregate route could dedupe by (run, node) with real knowledge of the
    flow topology instead of this incidental ordering; this client-side
    join cannot. Journey coverage:
    `scripts/journeys/agents.mjs`'s `agents-index-roster` beat (roster +
    CTA + ledger-mount + roster-card-navigates-to-builder only — the ledger
    row contract itself is pinned elsewhere, this beat only proves the
    route reuses it).
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
    decided by HTTP **status**, before the body is ever inspected. Carries
    `[data-action="retry-run-load"]` (W6-SW-3 sweep C3#5) — re-invokes the same
    load instead of requiring a manual browser reload;
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
- **`/projects` — the real projects index (W6-IA-1, 2026-08-15).** Was a
  23-line shim that fetched the roster only to redirect straight to the FIRST
  registered project (an operator-initiated onboard from Home landed on an
  arbitrary already-onboarded project's editor) and rendered dead-end "No
  projects registered." text with no CTA once empty. Now a real index:
  `[data-page="projects-index"][data-page-ready][data-project-count]` with a
  persistent header `[data-action="onboard-project-cta"]` CTA (→
  `/projects/new`) and a card grid — `[data-section="projects-grid"]
  [data-count]` — reusing the SAME `ProjectCard` (`components/studio/
  LibraryCard.tsx`) `/library`'s old projects shelf used to render, before
  W6-IA-4 retired that shelf in favour of this real index, each linking to
  its own `/projects/<id>`. Zero-state
  (`[data-section="projects-empty"]`, honestly gated on `ready &&
  projects.length === 0` — never flashed mid-fetch) offers BOTH an onboard
  CTA and a greenfield-create CTA (`[data-action="create-project-cta"]`),
  both routing to `/projects/new` (the one form hosts both paths); never
  terminal text. The presentational piece
  (`components/studio/ProjectsIndex.tsx`'s `ProjectsIndexBody`) is
  pure/props-driven — no fetch, no `useEffect` — so it is unit-render-tested
  directly (`lib/projects-index-render.test.ts`, the no-jsdom
  `renderToStaticMarkup` pattern `lib/library-card-render.test.ts`
  established); `app/projects/page.tsx` is only the fetch-and-`useState`
  shell (mirrors Library's own `loadAll` shape). Home's (`/`) own "Onboard a
  project" header CTA now targets `/projects/new` directly rather than this
  index (previously `/projects`, which the redirect made a random-project
  trap) and was renamed `[data-action="onboard-project-cta"]` — distinct
  from `ProjectOnboardForm`'s own submit button on `/projects/new`, which
  keeps `[data-action="onboard-project"]` (the two ids never collided on the
  same page, but shared one name for two different operations — link-navigate
  vs. form-submit — which this index's own CTAs also now follow). Journey
  coverage: `scripts/journeys/home.mjs`'s `home-landing` beat asserts the
  Home CTA's own href; its `home-projects-index` beat (the very next beat,
  while `home-landing`'s two seeded scratch projects are still live) is the
  one that actually NAVIGATES to `/projects` and asserts the index's own
  contract — `data-page="projects-index"`, `data-page-ready`, both seeded
  projects' own cards present, `data-project-count`/the grid's `data-count`
  matching a REAL `GET /api/studio/projects` read (never a re-derived client
  guess), and the persistent onboard CTA surviving onto the index page
  itself. An upstream link's href is not the same claim as the destination's
  own DOM contract — this beat exists to cover the latter, not duplicate the
  former.
- **`/projects/[id]` — editor + roadmap.** The project page is
  `[data-page="projects"][data-project-id][data-dirty][data-page-ready][data-demo-design-state]`
  with an Editor/Roadmap tab bar (`[data-tab="editor"|"roadmap"][data-tab-active]`).
  A stale/bad `:id` (not `new`, not in `fetchStudioProjects()`) renders a
  dedicated not-found body instead of a blank editor:
  `[data-page="projects"][data-project-not-found="true"]` with a link back to
  `/projects` (W6-SW-3 sweep C2#3).
  Roadmap renders `RoadmapCanvas.tsx` (**W6-RV-2**, replacing `RoadmapDag.tsx`
  — R4-13's dependency-depth **column** layout, itself the replacement for
  the retired `SerpentineTimeline` time-ordered spine): a **completion-time
  canvas** —
  `[data-roadmap-canvas][data-initiative-count][data-roadmap-edge-count]
  [data-canvas-scale]` — the operator-locked "B-prime" design
  (`mockups/roadmap-uplift/b-prime.html`). Layout math is pure and unit-tested
  (`lib/roadmap-time-layout.ts`'s `computeRoadmapTimeLayout` +
  `bucketByCompletionDay`/`layoutBlock`/`computeGapWidth`/`assignPendingBand`),
  producing REAL `{x,y,w,h}` positions for every card up front — unlike the
  retired DAG, the canvas needs no post-mount `ResizeObserver` measurement
  pass, so its edges render correctly even in a no-jsdom `renderToStaticMarkup`
  test. **The X axis is real completion time**: an initiative with a derivable
  `completedAt` (`RoadmapInitiative.completedAt`, ISO — see the server-side
  contract below) sits in a `[data-day-column][data-day="<YYYY-MM-DD">]
  [data-day-count]` bucket, day-columns left→right in completion order; a
  dense day wraps column-major into sub-columns of ≤6 rows (`MAX_ROWS`);
  inter-day gaps are capped-proportional
  (`GAP_BASE`+`GAP_PER_DAY`×(days-1), capped at `GAP_MAX`), with a
  `[data-gap-chip][data-gap-days]` "··· n days" marker once a gap reaches
  `GAP_CHIP_THRESHOLD_DAYS` (3). Pending work (no `completedAt` — including a
  card whose completion is honestly undiscoverable, never a fabricated date)
  sits inside the hatched `[data-projected-zone]` right of an amber
  `[data-now-line]`, banded by dependency-feasibility, NOT dates:
  `[data-band="in-flight"|"ready"|"after-prerequisites"|"unplanned"]
  [data-band-count]`, in that fixed left→right order
  (`assignPendingBand`/`PENDING_BAND_ORDER`). An `[data-dag-edges]` SVG
  overlay draws **one edge per (prerequisite → dependent) pair whose both
  ends are in the roadmap**:
  `[data-dep-edge][data-dep-from="<prerequisite>"][data-dep-to="<dependent>"]
  [data-hot="true"|"false"]` — faint at rest, bolded (`data-hot="true"`) when
  either end is the selected card — the edge-correctness the serpentine arcs
  carried ZERO `data-*` for. (Note: NO attribute begins with
  `data-dep-edge-`; the edge count lives on `[data-roadmap-edge-count]` — a
  `\bdata-dep-edge\b` matcher must remember a hyphen is a word boundary.) Per
  initiative,
  `[data-roadmap-node][data-initiative-id][data-initiative-status]` (+
  `[data-develop-state][data-plan-state][data-initiative-ready][data-blocked-by]
  [data-initiative-collapsed="true"][data-completed-at]` — the last only when
  derivable). **Every card is now PERMANENTLY collapsed** — canvas geometry
  never reflows on selection (operator ruling, mock decision point P5), so
  `data-initiative-collapsed` never flips to `"false"` and there is no more
  per-node inline-expand toggle (`[data-action="toggle-node-detail"]` is
  gone). The uniform ~280×72 card (title, 1-line ellipsis; `initiativeId`,
  monospace; the status chip; a `✓ HH:MM` real-merge-time chip when
  `completedAt` is present) carries the SAME two RV-1 micro-badges, now
  rendered UNCONDITIONALLY (nothing left to collapse them behind):
  `[data-micro-badge="deps-count"][data-badge-value]` and
  `[data-micro-badge="wi-progress"][data-badge-value="<done>/<total>"]
  [data-badge-failed="<n>"]` — same arithmetic contract as RV-1 (`'complete'`
  counts toward done, `'failed'` counts in the total but never toward done,
  `workItems === undefined` reads `"0/0"`, never fabricated; a failed count
  > 0 additionally renders `[data-badge-failed-marker]`). Clicking a card
  selects it (border highlight + its dependency edges bolded, neighbors
  outlined, everything else dimmed) and opens the **right push drawer** —
  `[data-roadmap-drawer][data-drawer-open="true"|"false"]`, and while open
  `[data-drawer-initiative="<id>"]` wraps `InitiativeDetail.tsx` rendered
  `expanded={true}` (byte-identical data-*/DOM to RV-1's inline detail card —
  nothing lost on the re-home) — `[data-action="drawer-close"]` closes it. The
  drawer's "Depends on" line renders each id as a clickable
  `[data-dep-jump="<id>"]` chip (an additive, backward-compatible
  `InitiativeDetail` change — an `onDepJump` prop, omitted elsewhere) that
  selects + pans the canvas to the target card. Because there is no more
  per-card inline expand, RV-1's bulk `[data-action="roadmap-collapse-all"]`
  / `[data-action="roadmap-expand-all"]` toolbar is RETIRED (nothing left to
  toggle); its bulk-view-reset SPIRIT carries onto the canvas toolbar instead:
  `[data-action="roadmap-zoom-in"|"roadmap-zoom-out"|"roadmap-zoom-fit"
  |"roadmap-jump-now"]`, with `[data-roadmap-canvas]`'s own
  `data-canvas-scale` (2-decimal string, e.g. `"1.00"`) as the "did this
  button actually change real view state" pin (mirroring
  `data-initiative-collapsed`'s old role). Pan (drag) / zoom (wheel,
  zoom-to-cursor) is a hand-rolled CSS `translate()+scale()` transform, NOT
  reactflow (already a forge-ui dep for `FlowBuilderCanvas`) — every
  coordinate here comes from the pure layout module, not a DOM measurement,
  so reactflow's actual value-add doesn't apply, and this repo's no-jsdom
  render-test convention has no precedent of a reactflow tree surviving it
  (see `RoadmapCanvas.tsx`'s header comment for the full reasoning). A small
  `[data-minimap]` renders a proportional overview (click-to-jump); a
  screen-anchored `[data-roadmap-axis]` strip shows month/day labels + the
  now-line's chip, horizontally synced to pan/zoom, vertically fixed. Inside
  the open drawer, the card's real work items (`[data-work-item-id]`) and a
  per-node run dig-in `[data-section="initiative-runs"]` with one
  `[data-run-link][data-run-cycle-id][data-run-active="true"|"false"]`
  (href `/flows/forge-develop/run/<cycleId>`) for the active cycle plus every
  prior attempt. Each pending initiative also carries `[data-plan-state="unplanned"
  |"planning"|"planned"|"error"]` (`unplanned` = the R4-05
  `enqueuePlanRun`-derived `workItems === undefined` proxy — no decomposition
  has run yet; this attribute lives on the CARD itself, so it's queryable
  without opening the drawer): the drawer renders the
  `[data-action="plan-initiative"]` button plus a blocked-until-planned lock
  badge (`[data-section="initiative-blocked-until-planned"]`) that hides
  `[data-action="start-development"]` until the card flips to `planned`;
  dispatching a plan run surfaces `[data-action="open-plan-run"]` linking to
  the `forge-architect` flow monitor. The roadmap toolbar carries an optional
  per-kickoff cost-ceiling input (forge-shc, 2026-08-09) — `POST /api/develop/start`
  accepts `costCeilingUsd` **only** for a single-initiative Start and stamps it onto
  that initiative's manifest `cost_ceiling_usd`; the field is **opt-in gated**
  (untouched → no `costCeilingUsd` is sent → the manifest's own budget-derived
  ceiling stands, never silently overwritten by the run-level default), and a stamp
  that fails to land is surfaced in the per-item result rather than reported as a
  clean enqueue. Every drawer carries
  `[data-link="demo-builder"]` (R4-07-F3; entrypoint fixed W6-B10) — routes
  honestly (`lib/demo-entry-view.ts`'s `resolveDemoEntryHref`) to the
  project's in-flight demo session (`/sessions/demo/<sid>`) or the kickoff
  screen, tying demo upkeep to initiative state without a fake tab switch.
  Server-side, `RoadmapInitiative.completedAt` (`cli/bridge-studio.ts`'s
  `buildProjectRoadmap`) is threaded from `Run.completedAt`
  (`orchestrator/run-model.ts`) — the `started_at` of a cycle's
  `{phase:'orchestrator', skill:'cycle', event_type:'end'}` event (falling
  back to the cycle log's last non-`'reflection'` event for a
  crash-then-requeue tail with no such event — the exclusion keeps a
  standalone reflector rerun, e.g. the 2026-07-10 boot-reconcile flood, from
  smearing a stale cycle's date onto its rerun date) — via the SAME memoized
  per-manifest derivation `GET /api/runs` already uses
  (`cli/run-list-cache.ts`'s `cachedListRuns`), so the roadmap's completedAt
  column costs nothing beyond what that route already pays: no second
  events.jsonl parser.
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
  `pending`/`done`) gets recovery affordances inside its **drawer**
  (**W6-RV-2**: moved off the card's own detail region along with the rest of
  `InitiativeDetail`; R4-11-T3 originally folded these off the retired
  standalone `/recovery` page): `[data-recovery-item][data-recovery-initiative]
  [data-recovery-status][data-recovery-attempt-count]` (+
  `[data-recovery-prior-attempts]` when a prior attempt exists) with
  `[data-action="recovery-inspect"|"recovery-requeue"|"recovery-abandon"]`
  buttons. The `[data-section="recovery-detail"][data-recovery-detail-initiative]`
  region renders **structurally** inside the drawer once opened (empty until
  Inspect populates it with branch / worktree / PR-draft detail, so the
  re-home can't drop a click-gated affordance)
  (+ `[data-recovery-commits]` when the worktree has commits, and a
  `[data-recovery-note]` result line after requeue/abandon). The recovery
  API itself (`cli/bridge-recovery.ts`) is unchanged — only the UI moved.
  The editor aside also carries two PERMANENT read-only surfaces (R4-12), on
  the project at rest — distinct from the preflight VERDICT surfaces
  (`ContractReadiness` / `[data-section="contract-resolution"]`).
  **`[data-section="contract-resolution"]` agent-tier buttons**
  (`[data-action="resolve-clause-agent"][data-resolve-clause-id]
  [data-resolve-blocked="true"|"false"]`, one per agent-tier clause —
  `ContractResolutionPanel.tsx`) navigate to the matching builder or KB tab;
  they never dispatch an agent turn themselves, so their label is
  route-honest per clause (`instructions`/`demo-builder`/`brain-fix` →
  "Open in instructions builder…"/"Open in demo builder…"/"Open in
  Knowledge…", `contract-resolution-view.ts`'s `agentResolveLabel`). The
  `brain-fix` route (the BRAIN clause) navigates to
  `/knowledge?id=<boundKbId>&tab=health`, where `boundKbId` is the project's
  REAL bound KB id — the `kb` state `KbBind.tsx` owns, threaded into the
  panel as its `boundKbId` prop, NEVER derived from the project id (a
  project's KB binding is operator-rebindable to any KB, or unbound
  entirely — `cli/bridge-studio-writes.ts` deliberately leaves it `null`
  when no KB seed landed on create). When `boundKbId` is `null` the
  brain-fix button renders `data-resolve-blocked="true"` and disabled, with
  an honest `[data-component="brain-fix-unbound-hint"]` row explaining why,
  instead of navigating to a guessed KB (`/knowledge`'s own `?id=`
  resolution silently falls back to the first KB in the list on an unknown
  id — a wrong destination with no indication anything went wrong). The
  USER-tier `[data-action="apply-clause-decision"]` button genuinely
  dispatches + polls a preflight-fix agent (~90s bounded) and is labelled
  "Apply with agent" accordingly.
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
  replaced (`/architect/[sid]`, `/architect/[sid]/interview`,
  `/instructions/[sid]`, `/project-brain/[sid]`) are **deleted as
  implementations, with no page file at all left at the old paths** — they
  survive only as permanent WIRE redirects declared in `forge-ui/next.config.mjs`
  `redirects()` (converted from client/server-component shim pages to
  config-level redirects at W6-IA-8, since each destination is knowable from
  the URL alone) into this route — `/project-brain`'s redirect entry forwards
  its `?project=` query automatically (Next passes through any query param the
  destination doesn't consume), and both `/architect/[sid]` and
  `/architect/[sid]/interview` redirect straight here directly, never chaining
  through each other. Page shell:
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
  the harness drives it unchanged, **with one exception (W6-B7, below):**
  the architect hex
  (`[data-component="architect-hex"][data-architect-phase][data-architect-active]`,
  `[data-tool-burst]` chips), `[data-section="architect-interview"|"architect-status"]`
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
  `[data-action="start-brain-analysis"|"approve-brain"|"abandon-brain"|"return-to-project"]`
  (W6-SW-3 sweep C6#1: renamed from `bind-and-return` — the click only ever
  navigates back to the project; the per-project brain is bound at
  onboarding, not by this step);
  and — **R4-21 phase 2, retired W6-B8** — the authoring kind. Its bespoke
  `SessionAuthoringPanel` (a status block detecting the drafted shape by file
  PRESENCE + a Save form) is DELETED — `authoring` now renders the generic
  `SessionInteractivePanel` (see its own entry below for the full contract,
  including the `[data-field="session-package-id"]` field that carries the
  Save form's one surviving input forward). The launcher that starts this
  session lives on `/skills/new` and `/hooks/new` (see those pages' entries,
  above) — `AuthoringLauncher`, POSTing `POST /api/studio/authoring/start`,
  which spawns `forge agent run authoring <sid> --project <p>` (the generic
  dispatch fork, `cli/agent-run.ts`'s `cmdAgentRun`) rather than the generic
  one-shot dispatch host.
  The two question forms are now ONE component parameterised on its submit fn
  and section name — both `data-section` values are unchanged.
  **`/architect/new` stays** as the native "start a run" entry that replaced
  the retired `/dashboard` launcher —
  `[data-page="architect-new"][data-page-ready]` wrapping
  `[data-section="new-idea"][data-new-idea-ready]` — and now pushes into
  `/sessions/architect/<sid>`.
  **R4-19-F2, retired W6-B8** — the kb-cleanup kind. Its bespoke
  `SessionCleanupPanel` (a status block + one explicit approve act, gated on
  phase AND a resolvable `kbId`) is DELETED — `kb-cleanup` now renders the
  generic `SessionInteractivePanel` too (see its own entry below). The
  `cleanup-plan` artifact pane (`CleanupPlanBody`, unchanged by this
  retirement — see "Cleanup plan" below) already carried every bit of the
  plan's own content (status banner, per-action state, raw text); the panel
  only ever owned the approve control and the phase-gated status line, both
  now generic. The launcher that starts this session lives on `/knowledge`
  (see the KB maintenance panel entry, below) —
  `[data-action="start-kb-cleanup"]`, POSTing
  `POST /api/studio/kbs/:id/cleanup/start`.
  **`demo`, `onboarding`, `kb-cleanup`, and `authoring`** render the generic
  `SessionInteractivePanel` in this same ladder slot — see its own entry
  below for the full contract.
- **`ActivityLog` — the shared live thinking/working drawer (W6-B7,
  2026-08-15).** `components/studio/ActivityLog.tsx`, generalized off the
  retired `ArchitectActivityLog.tsx` inline panel (deleted once every
  consumer below adopted this — no dual paths). Operator round-3 decision:
  a **full-width collapsible BOTTOM DRAWER** (`position: fixed`, spans the
  page), not the `mockups/session-surface-v1/session-live.html` mock's
  bottom-left inline placement — the mock's row-content design (thinking
  italic + ~200-char clamp with per-block expand, tool rows always full,
  the literal `[thinking redacted]` marker, phase chip + cost ticker in the
  header) carries over verbatim; only the placement changed. Root:
  `[data-component="activity-drawer"][data-drawer-open="true"|"false"]
  [data-activity-count=<N>]`. Header: `[data-component="activity-phase-chip"]
  [data-phase-active]` (optional — a caller with no phase concept omits it),
  `[data-action="toggle-activity-drawer"]` (flips open/collapsed),
  `[data-action="expand-all-thinking"]` (expands/collapses every clampable
  row at once — mirrors the mock's own any-collapsed → expand-all-else-
  collapse-all toggle). Collapsed state renders
  `[data-component="activity-last-line"]` — the phase chip + a one-line
  summary of the newest row + the cost ticker, the mock's "slim bar" — INSTEAD
  of the row list (never both). Each row: `[data-activity-kind="tool"
  |"tool-coalesced"|"thinking"|"thinking-redacted"|"reasoning"|"capped"]`
  (`data-activity-kind` is the ONE name carried over unchanged from the
  retired panel — the value vocabulary widened, the attribute didn't). A
  clampable row (`thinking`/`reasoning` over ~200 chars) carries a per-block
  `[data-action="expand-activity-row"][data-activity-expanded]`. Row
  derivation is a PURE function, `lib/activity-log-view.ts`'s
  `toActivityRows` (unit-tested independent of any DOM) — reads the W6-B1
  event shapes directly: `tool_use` rows from `metadata.{tool,input_summary}`
  (never `metadata.input`, which the retired panel read and which the real
  wire shape never actually populated — a latent no-op this rewrite fixes
  in passing), the sampler's `metadata.coalesced` summary row from
  `metadata.{coalesced_count,sampled_out_count}`, and `log`+
  `metadata.kind:"thinking"|"reasoning"` rows, splitting the literal
  `[thinking redacted]` marker and a `metadata.capped` per-sink cap-marker
  row into their own kinds rather than rendering them as ordinary
  clamped text. The cost ticker (`$0.18 · 41.3k tok · 3m 12s`) is rendered
  ONLY from caller-supplied `costUsd`/`tokensTotal`/`elapsedMs` props —
  never fabricated when absent (today only `RunPanel` has a real `costUsd`
  source; the architect/instructions session-summary types carry no cost
  field yet, a disclosed gap, not papered over). Adopted by
  `SessionArchitectPanel`, `SessionInstructionsPanel` (during their working
  phases, subscribed via the SAME `useCycleEvents(cycleId)` seam they already
  held), `SessionInteractivePanel` (W6-B10 — generic over `kind`, shown
  whenever every derived affordance is a not-yet-wired one; see the demo
  builder entry above), and `RunPanel`
  (`components/studio/agent-builder/RunPanel.tsx`) — for a standalone
  dispatched agent run, whose `runId` (minted `_agent-<slug>-<stamp>`,
  `cli/ui-bridge.ts`'s `POST /api/agents/:slug/run`) IS the run's cycle id
  (`createLogger(runId, ...)` writes straight to `_logs/<runId>/
  events.jsonl`, the exact path `GET /api/events/<cycleId>` reads), so
  `RunPanel` opens its own `useCycleEvents(runId)` socket with no extra id
  derivation.
- **Session-shell read contract (R2-10-F1/F2, 2026-08-05; W6-B3/B6/B8
  additions, 2026-08-15) — the API side.**
  The session routes above converge on one shared shell. Its data comes
  from a single read route, `GET /api/studio/sessions/:kind/:sessionId?project=<p>`
  (`cli/bridge-studio-sessions.ts`), which returns
  `{ok, kind, title, sessionId, project, phase, stages, defaultStage, turns,
  artifact, affordances, modelTier, terminal, [kbId]}`. Session kinds are
  declared as data in `studio/session-kinds.yaml` and validated by
  `forge studio lint` (`validateSessionKinds`, ADR-027's R2-10 amendment).
  `turns` are DERIVED from the runners' existing checkpoint files — each turn
  carries the `source` it came from (`idea.md`, `prompt.md`,
  `answers.json#round-N`, `questions.json`, `feedback.md`) — never invented.
  A checkpoint stage outside the kind's declared `stages` is a **409**, never
  a defaulted 200. `affordances` (W6-B3, ADR-043 §1) is
  `deriveSessionAffordances(descriptor, phase)` — computed server-side from
  whichever phase table the descriptor carries (`turnSpec` for a real
  dispatchable kind, `panel` for a legacy kind's read-only twin), ALWAYS
  present (`[]` for architect, which carries neither table), never re-derived
  client-side. `modelTier` (W6-B5's write side + W6-B6's read side) is the
  session's own kickoff-selected tier, read live off `status.json.modelTier`
  — `null` when none was ever recorded, the key always present either way.
  `terminal` (W6-B8) is `isTerminalPhase(descriptor, phase)` — the SAME
  derivation the route already used internally to gate its event-tail
  (`ensureSessionTail`), threaded onto the wire so `SessionInteractivePanel`
  can gate its ActivityLog drawer without a second, hand-kept terminal-phase
  table client-side; ALWAYS present, boolean, computed from whichever table
  the descriptor carries (`turnSpec` or `panel`, mirroring `affordances`'
  own derivation exactly) before falling back to
  `LEGACY_SESSION_TERMINAL_PHASES` for the two kinds (architect,
  project-brain) with neither. The `data-*` vocabulary the consuming shell
  attaches to this payload — `data-session-kind`, `data-session-stage`,
  `data-session-phase`, `data-turn-index`, `data-turn-role`,
  `data-turn-stage`, `data-artifact-kind` — is named here as the contract;
  the surface that attaches it lands with the shell route itself.
- **The generic session-affordance WRITE endpoint (W6-B4; W6-B9 adds the
  generic `meta.requires` check) — the API side.**
  `POST /api/studio/sessions/:kind/:sessionId/:affordance`
  (`cli/bridge-studio-affordances.ts`) — `:affordance` is always one of the
  READ route's own `affordances[].id` values, re-validated against the
  session's CURRENT on-disk phase on every call (so a stale/forged affordance
  id 409s exactly as a phase-inappropriate one does). Body shape depends on
  the MATCHED affordance's `kind`: `{answers: [{question, answer}]}` for
  `question-form`, `{verdict: 'approve'|'reject', ...}` for `verdict`
  (`demo`'s approve additionally accepts an optional integer `generation`).
  `kb-cleanup` and `authoring` accept `verdict: 'approve'` ONLY — a `reject`
  422s (neither kind's `awaiting-*` gate declares a rejection path). A
  `verdict` body is ALSO checked GENERICALLY against `affordance.meta.requires`
  (W6-B9, reviewer finding on W6-B8 — `studio/session-kinds.yaml`'s authored
  `requires:` list on the source phase row; authoring's `awaiting-review` row
  declares `requires: [id]`): each named field must be present as a
  non-empty string, or the FIRST missing one 400s naming it — ONE check for
  every session kind, never a hand-kept per-kind field list (this replaced
  authoring's OWN hardcoded `{kind,id}` check — `kind` itself is no longer
  read from the body at all; `handleAuthoringVerdict` derives it server-side
  from the real staged files). Every affordance kind this route has no write
  handler for at all — `staged-review` / `next-turn`, which describe what an
  `agent` step already did rather than something to trigger — 501s with
  `UnhandledAffordanceBody` (`{ok:false, kind, error}`, mirroring
  `SessionArtifactPane`'s `UnhandledArtifactBody`), never a silent 200.
  Delegates to the SAME underlying write+spawn helpers every bespoke
  per-kind route already uses (`spawnAgentTurn`,
  `enqueueConsolidate`/`runBrainConsolidateNow`, `runFinalize`) — this route
  validates the body shape and hands off, it never reimplements a
  finalizer.
- **`SessionInteractivePanel` — the generic interaction panel (W6-B6,
  2026-08-15; W6-B8 extends it).** `components/studio/session/SessionInteractivePanel.tsx`.
  Renders EXCLUSIVELY from the read route's own `affordances[]` — never
  re-derives an affordance from `phase`. Wired into the session shell for
  **`demo`, `onboarding`, `kb-cleanup`, and `authoring`** — architect/
  instructions keep their own bespoke panels (`SessionArchitectPanel` /
  `SessionInstructionsPanel`, documented above; instructions is a future
  migration); architect never migrates (ADR-043 amendment §4 — permanently
  bespoke). `SessionCleanupPanel`/`SessionAuthoringPanel` (W6-B8) are DELETED
  — no dual paths.
  Root: `[data-component="session-interactive-panel"][data-affordance-count=<N>]`.
  An empty `affordances[]` (onboarding, at every one of its three phases)
  renders `[data-section="session-no-affordances"]` — an honest "no operator
  action available" message, **never a silent `null`** (the W6-B6 gap: the
  page's ladder previously rendered `null` for both `demo` and `onboarding`).
  A visible provenance strip, `[data-section="session-provenance"]`,
  reads *"derived from phase "* followed by the session's own current phase,
  verbatim (mock
  `session-surface-v1/session-live.html` №7), alongside a READ-ONLY model
  chip, `[data-component="session-model-chip"][data-model-tier=<tier>|""]`,
  showing the session's own `modelTier` or `"default"`. Per affordance,
  rendered inside `[data-section="session-affordance"][data-affordance-kind=…]`:
  `question-form` → a free-text answer field (`[data-field="session-answer"]`)
  and `[data-action="submit-answers"]` (no per-question granularity on the
  wire — the operator reads the real question text in the transcript pane to
  the left and replies here; unreachable in practice today, since none of
  the four wired kinds ever derives a `question-form` row — kept generically
  correct for when `instructions` migrates its panel later); `verdict` →
  `[data-action="verdict-approve"]` + `[data-action="verdict-reject"]`
  (approve-only for `kb-cleanup`/`authoring` — B4's own table declares no
  rejection path for either, so the reject button is never offered where it
  is known in advance to 422), plus TWO artifact-driven additions, both
  keyed off `artifact.kind` (never `kind`): for `demo` (a real
  `generation-gallery` with at least one generation), a generation picker
  (`[data-field="session-generation-pick"]`); for `authoring` (a real
  `file-package`, W6-B8), a package-id field
  (`[data-field="session-package-id"]`, labelled "Skill id (directory name)"
  or "Hook id (directory name)" per the draft's shape — detected purely by
  file PRESENCE, `SKILL.md` ⇒ skill, `hook.yaml` ⇒ hook, neither ⇒ still
  drafting, an ADVISORY-only client check, never a duplicate of a
  server-enforced rule). **W6-B9 (reviewer finding on W6-B8):** which extra
  POST body fields a verdict needs beyond `verdict` itself is now WIRE DATA
  — `affordance.meta.requires` (`orchestrator/studio/session-kinds.ts`'s
  `deriveSessionAffordances`, sourced from the row's authored `requires:`
  list, `studio/session-kinds.yaml` — authoring's `awaiting-review` row
  declares `requires: [id]`; omitted when a row needs nothing extra). Approve
  stays disabled until every named field is filled (from the panel's own
  `providedFields` map — today just `{id: packageId}`) AND the file-package
  shape has resolved — honestly, never a button known in advance to 400.
  This REPLACES the batch's original hardcoded "file-package needs an id"
  client assumption: the write route (`cli/bridge-studio-affordances.ts`)
  validates the SAME `meta.requires` list generically, in the shared
  verdict-dispatch code (before any per-kind handler runs) — a missing/empty
  named field 400s naming it, e.g. `body.id is required for verdict
  "approve" on session kind "authoring" at phase "awaiting-review"`. `kind`
  itself is NEVER sent in the approve body any more — `handleAuthoringVerdict`
  derives it server-side from the REAL staged files (`staging/SKILL.md` /
  `staging/hook.yaml`, via `guardedReadFile`), never a client-supplied guess
  that could disagree with what actually lands; a request claiming the wrong
  kind is silently corrected, never trusted. On a successful package-shaped
  approve the panel's `onPackageFinalized` callback fires with the server's
  own `{kind, id}` echo, and the PAGE (not the panel — `useRouter()` throws
  under the `renderToStaticMarkup` harness this file's DOM regression suite
  uses) navigates to `/skills/<id>` or `/hooks/<id>`, mirroring the retired
  `SessionAuthoringPanel`'s own `onFinalized` behaviour. `staged-review`/`next-turn` render DISABLED,
  labelled "not yet wired" (B4 returns 501 for both). Every endpoint error —
  409 wrong-phase (naming the offending affordance id + the
  currently-available set), 422, 501 `UnhandledAffordanceBody` — surfaces
  verbatim via `[data-affordance-error]`, never swallowed.
  `postSessionAffordance` (`forge-ui/lib/session-client.ts`) is the client
  POST helper; `[data-page="session"]`'s `refreshSummary` gained a real
  `demo` branch (`listDemoSessions()` — the SAME per-kind list endpoint the
  now-retired `DemoBuilderPanel` used, and the reason W6-B10 could later
  graduate `/demo/[sid]` from a data-dependent client shim to a plain wire
  redirect: this page now makes the SAME lookup the shim used to make
  first) —
  previously `demo` fell into the generic "unrecognised kind" else-branch
  alongside every kind with no per-kind summary fetch at all, so a
  session-shell deep link carrying no `?project=` query param (this batch's
  own kickoff `Start` button included) left `project` stuck at `null`
  forever, permanently tripping the page's `noProjectKnown` fail-closed gate
  into "Session not found" (the demo "Session not found" bug); `kb-cleanup`/
  `authoring` have no per-kind summary branch either, so their `project`
  resolves from `?project=` alone, same as before their W6-B8 migration.
  **The shared `ActivityLog` bottom drawer (W6-B7) now renders here too
  (W6-B8),** gated on `!terminal` (the read contract's own `terminal` field,
  above) — a session-level fact, never derived from `affordances.length`
  (onboarding's `running` phase legitimately has zero affordances while
  genuinely working — exactly the case this gate must show the drawer for).
  `events` is the SAME `useCycleEvents(cycleId)` feed the page already
  computes for the StageHex burst chips on the bespoke panels, now also
  handed to this one.
- **`/sessions/[kind]/new` — the ONE kickoff screen for every session kind
  (W6-B6, 2026-08-15; W6-CR-3, 2026-08-15 adds the `selector:"none"` case).**
  `app/sessions/[kind]/new/page.tsx`. Kind context
  card (agent slug + `SKILL.md` path, produced artifact label, session
  directory shape) + a project select (`[data-field="kickoff-project"]`,
  datalist-backed, mirroring `NewIdeaBox`/`AuthoringLauncher`'s own
  convention), or, for `kb-cleanup` only, a KB select
  (`[data-field="kickoff-kb"]`, sourced from `fetchStudioKbs()`), or, for
  `community-refresh` only, **no selector section renders at all**
  (`[data-section="kickoff-selector"]` is absent from the DOM, not merely
  empty — the community registry is forge's own single, forge-wide file,
  not a per-project/per-KB artifact) — plus a
  free-text prompt field for the ONE kind whose `/start` body requires one
  (`authoring` — `[data-field="kickoff-prompt"]`; every other kickoff kind
  takes its brief on a LATER turn, via its own bespoke panel's briefing
  step, not at kickoff) + a model-tier picker,
  `[data-section="kickoff-model-tier"][data-model-tier-picker="range"|"fixed"]`,
  rendered from `agentCapabilityDescriptor.allowedTiers`
  (`Agent.allowedTiers`, `forge-ui/lib/studio-client.ts` — parsed
  independently of the pinned 3-key `capability` shape, mirroring
  `costCeilingEnforceable`'s own precedent) — a radio group
  (`[data-field="kickoff-model-tier-option"]`) for a `strategy:range` skill,
  a read-only chip (`[data-field="kickoff-model-fixed-chip"]`) naming
  `runtime.model` for `strategy:fixed`; widening a skill's range is a
  `SKILL.md` edit, never a UI decision. `[data-action="start-session"]`
  POSTs the kind's existing `/start` route (now every one of the six client
  wrappers — `startInstructions`/`startDemoBuilder`/`startProjectBrain`/
  `startAuthoring`/`startKbCleanup`/`startCommunityRefresh` — threads an
  optional `modelTier` onto the wire, validated server-side against the
  SKILL-declared envelope, W6-B5's seam) and `router.push`es onto
  `/sessions/<kind>/<sid>?project=<p>` on success (`project` for
  `community-refresh` is the server-resolved fixed anchor
  `.community-registry`, echoed back on the `/start` response — the
  kickoff page never invents or requires one). Kickoff kinds:
  `instructions`, `demo`, `kb-cleanup`, `authoring`, `project-brain`,
  `community-refresh`. `architect` is explicitly OUT —
  `kind === 'architect'` renders a small link-out card to `/architect/new`
  rather than duplicating `NewIdeaBox` (ADR-043 amendment §4: architect
  stays bespoke, kickoff included).
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
- **Demo builder — the dedicated session screen (W6-B10, 2026-08-15, R1-03-F2
  REVERSED):** the per-project demo-page builder is now `/sessions/demo/<sid>`
  — the ONE session screen every interactive kind shares (W6-B6) — not an
  inline panel. `DemoBuilderPanel.tsx` and `DemoReview.tsx` are DELETED, along
  with the project page's `?demo=` deep-link handling and `activeDemoSid`
  state; the retired inline contract
  (`[data-section="demo-builder-panel"]`, `[data-component="demo-review"]`,
  `[data-field="demo-feedback"]`, `[data-action="submit-brief"|"apply-feedback"|
  "abandon-demo"|"iterate-element"|"view-element-output"|"close-demo-panel"]`,
  `[data-section="demo-history"|"demo-viewer"|"demo-process"]`) is GONE, not
  relocated — the dedicated screen renders through the SAME generic surfaces
  every other `GENERIC_PANEL_KINDS` member does:
  `SessionInteractivePanel` (`[data-component="session-interactive-panel"]`,
  `[data-affordance-kind="question-form"|"verdict"]`,
  `[data-action="submit-answers"|"verdict-approve"|"verdict-reject"]`,
  `[data-field="session-generation-pick"]`) LEFT, `SessionArtifactPane`'s
  generation-gallery RIGHT — see below. Three entrypoints route here, all via
  `router.push`: `DemoTimeline`'s `[data-action="launch-demo-builder"]`
  (project page), `ContractResolutionPanel`'s DEMO-clause
  `[data-action="resolve-clause-agent"]` (mirrors its own `instructions`
  branch exactly), and the roadmap's `[data-link="demo-builder"]`
  (`InitiativeDetail`, via `RoadmapCanvas`'s `onOpenDemo`) — which now routes
  HONESTLY (`lib/demo-entry-view.ts`'s `resolveDemoEntryHref`: resume the
  project's in-flight session, else `/sessions/demo/new?project=<p>&
  initiative=<id>`) rather than the old fake `setTab('editor')`. Kickoff
  (`/sessions/demo/new`) gained an optional `?project=`/`?initiative=` prefill
  (`[data-section="kickoff-initiative-context"]` shows the latter as context
  only — sessions are project-scoped, never initiative-scoped). `/demo/
  [sessionId]` graduates from the data-dependent client shim W6-IA-8
  deliberately left behind to a pure `next.config.mjs` wire redirect →
  `/sessions/demo/:sessionId` — the destination now resolves its own project
  via the SAME `listDemoSessions()` lookup the shim used to make first (see
  `refreshSummary`'s `demo` branch below), so `?project=` is an optimization,
  not a requirement, and the move is knowable from the URL alone like its six
  siblings. The gap this surfaced: `studio/session-kinds.yaml`'s `demo` panel
  table had NO row for `briefing` — every session is minted straight into it
  (`POST /api/demo-builder/start`) — so a session opened here could never get
  the agent started; it gained `{phase: briefing, step: noop, awaits:
  questions}`, rendering as the generic question-form box, and
  `cli/bridge-studio-affordances.ts` gained `handleDemoBrief`, mirroring
  `POST /api/demo-builder/brief`. `ActivityLog` (the shared bottom drawer,
  `[data-component="activity-drawer"]`) is now wired generically into
  `SessionInteractivePanel` — shown whenever every derived affordance is a
  disabled not-yet-wired one (a working phase with nothing actionable),
  covering demo's `generating`/`locking` phases the same way the retired
  panel did, without a `kind === 'demo'` compare. **Disclosed regression, not
  fixed here** (needs a real affordance-model extension — `VERDICT_VALUES` is
  a closed `['approve','reject']` set with no "revise in place" semantics):
  the old panel's free-text "apply feedback & regenerate" loop, per-element
  iterate-with-its-own-prompt, and "view a previous locked demo" history have
  no equivalent on the generic panel today.
- **Generation gallery — the demo-builder's session artifact (R4-16-F1,
  2026-08-06; entry point updated W6-B10).** Each completed generate turn is
  SNAPSHOTTED into the session dir
  (`projects/<p>/_demo/<sid>/generations/<n>/` = `DEMO.html` + `SKILL.md` +
  `meta.json`), so the generations accumulate instead of overwriting each
  other, and a new **live** artifact kind `generation-gallery`
  (`studio/session-kinds.yaml`'s fourth descriptor, `id: demo` — the id IS the
  `_<kind>` session-dir segment the read route derives) renders them through
  the R2-10 shell's own renderer stack. **Entry is the dedicated session
  screen** (W6-B10 — R1-03-F2's original "entry stays the project page" is
  itself reversed): `/sessions/demo/<sid>` renders the REAL
  `SessionArtifactPane`, fed by
  `GET /api/studio/sessions/demo/<sid>?project=<p>` — the same read route,
  one mount now instead of two. `finalize-generation` (the gallery's own
  per-item button) renders honestly DISABLED here (`onFinalizeGeneration` is
  not wired on this page — `title="Not available from this view"`); the
  session-shell's own way to finalize a chosen generation is the generic
  verdict-approve's `[data-field="session-generation-pick"]` picker (posts
  `{verdict:'approve', generation:<n>}` through the SAME affordance route
  `handleDemoVerdict` already answers), not a second, redundant call path.
  Contract:
  `[data-section="generation-gallery"][data-generation-count][data-selected-generation]`,
  per selector button
  `[data-action="select-generation"][data-generation-number][data-generation-selected="true"|"false"]`,
  per item
  `[data-generation-item][data-item-path][data-item-kind="html"|"markdown"|"file"][data-item-bytes]`,
  the feedback that drove the selected generation
  `[data-section="generation-feedback"][data-has-feedback="true"|"false"]`,
  the per-item viewer `[data-action="view-generation-item"]` (serving from
  `GET /api/demo-builder/generation/<project>/<sid>/<n>/<filename>`), the
  (on this page, honestly disabled) chooser
  `[data-action="finalize-generation"][data-generation-number]`, and an
  honest `[data-generation-empty="true"]` naming what was scanned rather than a
  bare pane. `data-generation-number` is the snapshot's OWN recorded iteration,
  never an array position, so a corrupt snapshot leaves a visible gap instead
  of silently renumbering its successors. **The selection is poll-stable**: the
  panel refetches on ONE 3s interval (never a second cycle — two independent
  polls is the race this campaign already diagnosed once), and the view is
  re-derived with the operator's chosen generation NUMBER preserved across the
  new payload, because a selection that dies every 3 seconds cannot be acted
  on. The real way to lock a CHOSEN generation on this page is
  `verdict-approve`'s generation picker — server-side (`handleDemoVerdict`)
  it restores that snapshot's sample AND its generator skill into the project
  repo before the same lock runs, so `demo.lock.json`'s
  `demo_html`/`demo_skill` pair always comes from one generation.
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
- **Cleanup plan — the kb-cleanup session's artifact (R4-19-F2).** The
  `kb-cleanup` session-kind descriptor (`studio/session-kinds.yaml`, `agent:
  brain-maintenance`, `stages: [brain]`) declares a **live-from-birth**
  artifact kind `cleanup-plan` (`orchestrator/studio/session-kinds.ts`'s
  `id: 'cleanup-plan', status: 'live'` — never reserved, unlike
  generation-gallery/contract-buildout/file-package's reserved→live
  histories above). A brain-maintenance agent drafts `plan/cleanup-plan.md`
  (`skills/brain-maintenance/SKILL.md`'s mandated
  `- [<kind>] <target> — <proposal>` line format) against one KB's agent-tier
  brain-lint findings, then stops for operator approval; a separate route
  (`POST /api/studio/kbs/:id/cleanup/apply`) drains the approved plan. Each
  parsed action's `state` — `open` | `cleared` | `unknown` — is DERIVED fresh
  on every read by joining the plan against a LIVE brain-lint scan
  (`session-transcript.ts`'s `deriveCleanupPlan`), never stored. **The three
  states are load-bearing**: a real run once reported every action `cleared`
  while nothing had been repaired, because absence of a finding was wrongly
  treated as proof of repair — `unknown` is the fail-safe default whenever
  coverage cannot be established, so the UI can never again imply a repair
  landed when it wasn't verified. Contract:
  `[data-component="cleanup-plan"][data-cleanup-plan-state="no-plan"|"unparsed-plan"|"has-actions"]`
  (mirrors `markdown-draft`'s own three-state idiom — "not drafted yet" vs
  "drafted but the parser found no action lines" vs "at least one row"; a
  drafted-but-unparseable plan still renders its raw text, never an
  empty/"nothing here" pane) and
  `[data-cleanup-plan-settled="true"|"false"]` (true iff every action is
  `cleared` AND at least one action exists — **never**
  `openFindingCount === 0`: a plan with a lone `unknown` row and zero `open`
  rows is unverified, not settled, per `cleanupPlanView`'s own AT-127 pin).
  Per action row: `[data-cleanup-action-state="open"|"cleared"|"unknown"]`,
  rendered with a distinct colour (red/green/amber), a distinct left-border
  stripe, and a spelled-out label — never colour alone — so the three states
  read as visually distinct, not merely attribute-distinct.
  `openFindingCount` is the server's number, surfaced verbatim, never
  recounted client-side (mirrors `brain-structure`'s `themeCount`).
- **`/knowledge` + `/knowledge/new`** — the knowledge-graph browser and the
  band-scoped, agent-seeded create + maintain surface (R1-01's binding
  contract, extended by R1-06 WI-2/WI-3, R4-19 WI-1/WI-2 and R6-08 WI-1/WI-2/
  WI-3; journeys:
  `knowledge-graph`, `knowledge-pin-guidance`, `knowledge-create-kb`,
  `knowledge-ingest`, `knowledge-lint-index`, `knowledge-create-kb-band-scope`,
  `knowledge-create-kb-band-scope-seed`, `knowledge-create-kb-band-scope-commit`,
  `knowledge-kb-maintain-session`, `knowledge-kb-cleanup-launch`,
  `knowledge-kb-cleanup-approve`, `knowledge-explore-tabs`).
  - **Persistent "+ New KB" CTA + empty state (W6-IA-4, sweep findings C4#1/
    C4#2).** This is where the OLD Library landing page's own New-KB
    affordance moved to (Library no longer creates or lists knowledge bases
    — see the `/library` entry above): the header bar carries an
    ALWAYS-present `a[data-action="new-kb"]` (`href="/knowledge/new"`),
    independent of roster size. A genuinely empty KB roster used to hang
    `data-page-ready` false FOREVER — the "resolve active KB id" effect only
    ever chose a `currentId` from a non-empty list, and the "load KB detail"
    effect (the ONLY other place `ready` was set) starts `if (!currentId)
    return;`, so it never even ran. A new, independent `kbListReady` state
    (set once the first `fetchStudioKbs()` settles, success or failure) now
    lets a settled-and-empty roster set `ready` too. The Explore tab then
    renders `components/studio/knowledge/KnowledgeEmptyState.tsx`'s
    `[data-component="knowledge-empty"]` — a "No knowledge bases yet"
    message plus its OWN distinct `[data-action="new-kb-empty-cta"]`
    (`href="/knowledge/new"`, DISTINCT from the header's `new-kb` so neither
    selector is ambiguous when both render at once) — instead of the
    generic "No KB data available." text a real-but-quiet KB graph also
    used to share. Render-tested directly (a pure leaf component, no fetch,
    no `next/navigation` hooks): `lib/knowledge-empty-state-render.test.ts`;
    the page's own wiring is pinned by source-text assertions in
    `lib/knowledge-page-empty-state-wiring.test.ts` (mirrors
    `lib/knowledge-page-kb-maintenance.test.ts`'s established
    brace-matching/source-text technique — `useSearchParams` +
    effect-gated `currentId` never resolve under `renderToStaticMarkup`).
  - **KB selector zero-state (W6-IA-4 sweep finding C4#2).**
    `KbSelector.tsx`'s `#kb-select` used to render a genuinely empty
    `<select>` (zero `<option>`s) whenever the roster was empty — nothing to
    see, and the OS-native "no options" affordance is not a discoverable
    creation path. Now: `data-kb-select-empty="true"|"false"` on the
    `<select>` itself, and when empty, a disabled placeholder
    (`[data-kb-select-placeholder="true"]`, "No knowledge bases yet") PLUS a
    real, selectable `[data-action="new-kb-select-option"]` `<option>`
    ("+ New knowledge base") that navigates to `/knowledge/new` via a
    sentinel value (`__new__`, never collides with a real KB id).
    Render-tested: `components/studio/knowledge/KbSelector.test.ts`.
  - **Tabs (R6-08 WI-3, RULING 5 — URL-synced via `?tab=`):**
    `[data-tab="explore"|"health"|"ingest-activity"][data-tab-active="true"|"false"]`,
    one button per tab; clicking pushes `?tab=<id>` into the URL, deep-linkable
    like `?id=`/`?node=`/`?theme=`. **Explore** (default — `?tab=` absent) is
    the pre-existing graph + reader body, re-anchored under this branch
    unchanged; **Health** hosts `KbDrainPanel` + `GuidancePanel` +
    `KbHealth` (moved under this branch, F1 — no longer rendered
    unconditionally; W6-B13 replaced `LintResolutionPanel` with
    `KbDrainPanel` in this slot — see "KB drain-to-green panel" below);
    **Ingest Activity** is the new read-only `IngestActivityPanel` (see
    below). Journey: `knowledge-explore-tabs`.
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
      multi-turn "maintenance agent" narration has since shipped for real, as
      its own session kind — `kb-cleanup` (see "KB maintenance panel" below
      and "Cleanup plan" above) — never folded into Consolidate itself, which
      stays a direct dispatch-and-poll, not a chat session.
  - **KB maintenance panel:**
    `[data-component="kb-maintenance"]`, with `[data-consolidate-state]` on
    that same root once a consolidate run reaches a terminal (`'cleared'` |
    `'not-cleared'` | `'failed'` | `'running'` — absent before the first
    run, reset to `''` the moment a new one starts). Actions:
    `[data-action="kb-index"]` (index refresh — **`kb-lint` was REMOVED here
    W6-B13**: it duplicated the Health tab's `KbDrainPanel`, whose live
    status IS the scan result now, since every drain round re-lints the KB —
    sweep finding C4#7),
    **`[data-action="kb-maintain-session"]` (R1-06 WI-3 — dispatches
    `op=consolidate`)**, **`[data-action="start-kb-cleanup"]` (R4-19-F2 — the
    kb-cleanup LAUNCHER, closing the reachability gap
    `brain/cycles/themes/new-session-kind-needs-ui-wiring.md` documents)**,
    `[data-action="kb-delete"]` (guarded: `cycles` and
    `forge-dev` are server-refused, 403). `start-kb-cleanup` calls
    `startKbCleanup(kbId)` (`POST /api/studio/kbs/:id/cleanup/start`) and, on
    success, navigates to `/sessions/kb-cleanup/<sessionId>?project=<p>`
    using the **`project` the route itself returns**, never one re-derived
    from `kbId` — a non-project-bound KB anchors its session under a
    server-minted `.kb-<id>` scratch project
    (`KB_SEEDING_ANCHOR_PREFIX`, `cli/ui-bridge.ts`), so building the URL
    from `kbId` instead would 404 for every such KB. A failure surfaces
    verbatim in the SAME `[data-component="kb-maintenance-result"]` span the
    other three ops already use, never swallowed. Consolidate is genuinely
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
  - **KB drain-to-green panel (Health tab, W6-B13).** `KbDrainPanel.tsx`
    replaces `LintResolutionPanel.tsx` (deleted) — ONE button drives every
    auto- and agent-tier lint finding to a fixed point, entirely server-side
    (`cli/bridge-studio-kb-drain.ts`'s `runKbDrain`, W6-B12): the component
    is a pure OBSERVER of `_logs/_kb-drain-<runId>/status.json`, never the
    owner of the run. Root: `#kb-drain-panel[data-component="kb-drain-panel"]
    [data-drain-state][data-drain-round][data-drain-run-id]`.
    `data-drain-state` is one of the server's own `KbDrainState` values
    (`'running'|'green'|'needs-you'|'no-progress'|'round-cap'|'cost-ceiling'
    |'failed'`) plus three UI-only values: `'idle'` (no run has ever been
    dispatched for this kb), `'attaching'` (the mount-time reattach GET is
    still in flight), and `'timed-out'` (this browser's bounded poll gave up
    watching — the run itself keeps going server-side; see below). Actions:
    `[data-action="drain-to-green"]` (`POST .../drain`, 409-safe — see
    below) and `[data-action="recheck-drain"]` (only rendered in
    `'timed-out'`; restarts the poll for the SAME `runId` without a fresh
    dispatch).
    - **Reattach-on-mount, not assume-fresh.** On every mount (including a
      tab round-trip away from and back to Health — `KbDrainPanel` is
      rendered only under `tab === 'health'`, so switching tabs unmounts/
      remounts it), the panel calls `GET /api/studio/kbs/:id/drain`
      (active-or-latest) BEFORE assuming there is no run — this is what
      makes nav-away genuinely lose nothing: the SAME `data-drain-run-id`
      and `data-drain-state` reappear. Journey:
      `knowledge-lint-index` drives exactly this (drain → nav to Explore →
      back to Health → assert the SAME run id/state).
    - **The poll.** `lib/agent-dispatch.ts`'s `pollKbDrain` (built on the
      SAME generic `pollUntilTerminal` core `pollAgentRun` now also uses) —
      bounded, immediate-then-interval, with an EXPLICIT `'timed-out'`
      status once the poll ceiling is hit while still `'running'` — never a
      silent freeze. A drain run is driven by `enqueueConsolidate`
      server-side, not by this poll, so `'timed-out'` here means only "this
      browser stopped watching," never "the run stopped" — the re-check
      button restarts watching the SAME run, no new dispatch.
    - **Dispatch, and the 409 race.** `dispatchKbDrain` (`studio-client.ts`)
      posts `{}`; a 409 ("already active") is recovered by immediately
      calling `fetchActiveOrLatestKbDrain` rather than trusting anything off
      the 409 response body (the shared `studioPost` helper drops the body
      on any non-2xx across this whole module) — so a double-click race
      attaches to the REAL active run instead of surfacing a dead-end error.
    - **Progress + terminal rendering.** `[data-drain-section="progress"]`
      lists this round's auto+agent-tier `perFinding` rows —
      `[data-drain-finding][data-drain-finding-tier="auto"|"agent"|"user"]
      [data-drain-finding-outcome="cleared"|"not-cleared"|"needs-you"]`.
      Every terminal state gets honest, state-specific copy
      (`lib/kb-drain-view.ts`'s `drainStateCopy` — pure, unit-tested):
      `'green'` shows `[data-component="drain-green"]`; `'no-progress'` /
      `'round-cap'` / `'cost-ceiling'` name what to do next (re-run, or
      address manually); `'failed'` points at the `ActivityLog` drawer below
      it (mounted whenever a `runId` is known, subscribed to the run's own
      `_kb-drain-<runId>` cycle id) rather than inventing an error string
      the persisted status doesn't carry.
    - **`'needs-you'` — the ONE surviving piece of the old
      `LintResolutionPanel`.** When (and only when) the server reports
      `'needs-you'`, `[data-drain-section="needs-you"]
      [data-user-index][data-user-total]` walks the operator through each
      remaining USER-tier finding — the one decision the drain loop never
      makes on its own. `[data-component="user-resolution-input"]`
      (textarea) + `[data-action="submit-user-resolution"]` dispatch a
      single agent-fix turn (`dispatchAgentFix`, unchanged route) polled by
      the NEW `pollAgentFix` (same `pollUntilTerminal` core — fixes sweep
      finding C9#2: the old panel's own `pollFix` silently stayed
      `'running'` forever past its 45×2s budget with zero feedback;
      `pollAgentFix` reaches an explicit `'timed-out'` instead). Clearing a
      finding re-dispatches a fresh drain run rather than guessing
      client-side what's left. `[data-action="skip-user-resolution"]`
      advances the walkthrough; stepping past the last finding renders
      `[data-component="user-tier-exhausted"]` — an explicit "reviewed all
      N, none resolved yet" completion (fixes sweep finding C9#3: the old
      panel clamped its index to the last item forever, so Skip past the
      end produced no visible change on every subsequent click).
    - **`KbHealth.tsx`'s lint counts link here (sweep C9, "no orphan health
      numbers").** The Lint sub-section and the per-check itemization block
      are both wrapped in `<a href="#kb-drain-panel"
      data-action="goto-drain-panel">` — these counts are the ones
      `KbDrainPanel` actually acts on, so they route straight to it rather
      than sitting as dead numbers. (Layer balance / connectivity /
      staleness stay plain — drain does not act on those.)
    - **Container/view split (review round).** `KbDrainPanel.tsx`'s
      "interesting" states (running/green/needs-you/no-progress/round-cap/
      cost-ceiling/failed/timed-out) only ever exist via an async fetch/poll
      result, which `renderToStaticMarkup` never runs — a render test
      against the hooks-owning component could only ever observe its
      permanently-stuck initial `'attaching'` state. `KbDrainPanel` (the
      exported default, hooks/effects/fetch/poll wiring) renders the
      exported, hooks-free `KbDrainPanelView` — every prop
      (`displayState`/`round`/`runId`/`counts`/`perFinding`/`dispatching`/
      `attaching`/the user-tier walkthrough fields) is driven straight from
      container state, so `KbDrainPanelView` alone is fully render-testable
      via `react-dom/server`'s `renderToStaticMarkup`, the same way
      `KbHealth.tsx` (already a plain props-in component) is tested.
      Render-tested: `lib/kb-drain-panel-render.test.ts` (mirrors
      `run-panel-render.test.ts`'s technique) — pins every
      `data-drain-state` vocabulary value, `data-drain-round`,
      `data-drain-run-id`, the per-finding `data-drain-finding-tier`/
      `-outcome` rows, the needs-you `data-user-index`/`-total` block +
      the C9#3 exhausted-completion state, the `timed-out` re-check
      affordance, and the full drain-to-green button disabled matrix
      (dispatching/running/attaching → disabled; every terminal state →
      enabled). The container's own wiring (`.tsx` only — no jsdom in this
      repo, see `RunPanel.tsx`'s own header) is verified by `tsc`/
      `next build` plus pure-logic unit coverage: `lib/kb-drain-view.test.ts`
      (state copy, tier splitting, the C9#3 walkthrough-completion logic),
      `lib/agent-dispatch.test.ts` (`pollKbDrain`/`pollAgentFix`, including
      the "unmount mid-poll" cleanup-fn pin the user-tier poll's own ref
      relies on — review round MEDIUM fix: `submitUserAnswer` now stores
      `pollAgentFix`'s returned stop fn in a ref and cancels it from the
      SAME unmount-cleanup effect the runId poll already uses), and
      `lib/studio-client.test.ts` (`dispatchKbDrain`/`fetchKbDrainRun`/
      `fetchActiveOrLatestKbDrain` wire contracts). Journey:
      `knowledge-lint-index` (renamed in spirit from the old lint/index
      beat — the file's own `id` is unchanged for RUN_ORDER stability).
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
      (`errorCount+flagCount`) — for the 12 checks in `CHECK_NAMES`
      (`cli/brain-lint.ts`, in order): `checkFrontmatter`, `checkIndexSync`,
      `checkSourceLinks`, `checkStaleness`, `checkOrphans`,
      `checkProjectBrainIndexes`, `checkLengthSoftCap`, `checkContradictions`,
      `checkCategoryScope`, `checkReflectorLoss`, `checkDanglingEdges`,
      `checkDuplicateThemes` (the last two added by R4-19-F2). **`status:'pass'` means the
      check genuinely ran over THIS KB's own content and found nothing** —
      never a silent pass for a check that never looked (the
      declared-data-fails-open bug class 4on fixed). A check is real
      (`pass`/`warn`/`fail`) only when either (a) `CHECK_SCOPE[name]` covers
      this KB's exact dir (`forge-themes` ⇒ `brain/cycles`/`brain/forge-dev`
      only; `project-indexes` ⇒ a direct `brain/projects/<id>` child) or
      (b) it's one of `LINT_THEME_FILE_CHECKS` (`checkFrontmatter`/
      `checkSourceLinks`/`checkIndexSync`/`checkDanglingEdges`/
      `checkDuplicateThemes`) and this KB's own theme files are
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
  per-project roadmap's card drawer (**W6-RV-2**; see `/projects/[id]`
  above). The route is now a permanent WIRE redirect (`forge-ui/next.config.mjs`
  `redirects()`, converted from a client-side shim page at W6-IA-8) straight
  into `/library` — the future home of the cross-project stuck-initiative
  attention strip (R4-11-F4) — so bookmarks keep working with no page ever
  rendering at the old path.
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
  `[data-action="create-skill"]`). **R4-21 T3 addition (BLOCKER-2 fix):**
  `/skills/new` also renders the SAME `AuthoringLauncher` `/hooks/new` does
  (see that page's entry, above, for its full `data-*` contract) —
  `[data-section="authoring-launcher"]` alongside the manual form, POSTing to
  `POST /api/studio/authoring/start` and navigating to
  `/sessions/authoring/<sessionId>?project=<p>`. **R4-21 phase 2, T3 (journey-
  sync port):** the whole authoring arc — launcher → real session →
  file-package pane → finalize → the landed skill's own detail page → approve
  → the REAL agent-builder palette — is now driven end to end by the
  `skills-agentic-build` beat (`scripts/journeys/skills.mjs`), the hook side
  by `hooks-agentic-build` (`scripts/journeys/hooks.mjs`); the drafted bytes
  both seed are a committed, sha256-verified copy of a real captured
  creation-agent turn (`scripts/journeys/fixtures/r4-21-live-capture/`,
  provenance in `scripts/lib/journey-fixtures.mjs`) — see `build-skill` /
  `build-hook` in `scripts/journeys/story-registry.mjs` for the full
  mockup-beat mapping.
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
- **Roadmap initiative status** (`RoadmapCanvas.tsx`) — `pending |
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
is a thin runner over 15 user-story journeys in
[`scripts/journeys/`](./scripts/journeys/) — `skills`, `hooks`, `templates`,
`connections`, `stand-up-onboard`, `stand-up-create`, `knowledge`, `agents`,
`flows-author`, `flows-run`, `flows-onboard`, `roadmap`, `demo-showcase`,
`demo-builder`, `community`
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
