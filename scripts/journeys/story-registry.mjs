/**
 * story-registry.mjs
 *
 * What this is: the wave-5 target story inventory — every scripted story
 * in the studio end-state mockup (`mockups/studio-endstate-v2/journeys-data.jsx`,
 * the `JOURNEYS` map) with its disposition against the real forge-ui journey
 * gallery (`scripts/journeys/`).
 *
 * Why it lives here and not in `docs/`: parity is derived by comparing
 * these refs against `scripts/journeys/index.mjs` journey and beat ids, so
 * a code home makes the dangling-ref check a plain import instead of a
 * markdown parser; the per-batch journey-sync port edits the registry and
 * the journey module in the same directory.
 *
 * Nothing here is a count. Status (`ported` / `pending` / `excluded`) and
 * all totals are DERIVED by `scripts/lib/story-parity.mjs` from the real
 * mockup file, the real journey registry, and these refs. Never add a
 * stored status or a stored count to this file.
 *
 * Port contract for future batches: `port = { journey, beats }` where
 * `journey` is a real id in `scripts/journeys/index.mjs` and `beats` has
 * exactly one entry per mockup beat — either a real beat id string (which
 * must also appear in `RUN_ORDER`) or `{ excluded: '<why>', decision: '<doc
 * reference>' }`. A beat is either ported or explicitly excluded; it is
 * never silently skipped.
 *
 * Optional `note` field: free prose recording WHY an entry is dispositioned
 * the way it is when that is not self-evident from the batch plan — e.g. a
 * story absent from README §4's closure column, or a surface already
 * verified aligned so the port carries no product work. It is carried into
 * the derived report for the reader and is never an input to status.
 *
 * Baseline honesty note: as of 2026-08-03 no story is `ported`. The nine
 * existing journeys in `scripts/journeys/` overlap conceptually with
 * several mockup stories, but none was authored as a beat-for-beat port,
 * so claiming `ported` would be attributing status from a loose semantic
 * match. `ported` is claimed only when a batch actually does the port, as
 * its journey-sync duty.
 */

export const WAVE5_BATCHES = ['A', 'B', 'C', 'D', 'E', 'F'];

const DECISION_2 =
  'docs/roadmaps/README.md §8 "Wave-5A cut decisions (2026-08-03)" ' +
  'decision 2 — plan-band parallelism PARKED as R2-D2';

const DECISION_R3_04_D2_R3_07_D8 =
  'docs/roadmaps/R3-library-componentry.md R3-04 "Honest limits, stated not ' +
  'hidden" (D2 — forge has two real connection kinds, tool and mcp, not ' +
  'three; a clis: catalog section is a separate, out-of-scope migration) + ' +
  'R3-07 D8 (_wave5/specs/R3-07.md — "the cli kind is not fabricated": a ' +
  'clis: catalog section would move ids out of catalog.tools, which ' +
  'composition.tools validates against and CatalogPalette renders from — a ' +
  'dispatch-affecting migration, not a browse-surface addition)';

export const STORY_REGISTRY = [
  {
    story: 'onboard-project',
    batch: 'B',
    port: null,
    excluded: null,
  },
  {
    story: 'create-project',
    batch: 'B',
    port: null,
    excluded: null,
    note:
      'R3-06 (templates library) built the on-disk substrate this story\'s ' +
      "scaffold-picker beat (click 'scaffold-scaffold-web-ui') will eventually " +
      'draw from — a real project-scaffold category in the template registry ' +
      '(/templates, /templates/[id]) covering the 3 real starters ' +
      '(typescript-api, typescript-cli, typescript-web) — but NOT the beat ' +
      'itself: the ' +
      "create-project wizard (create-project-btn → scaffold picker → name → " +
      'start-creation) is unbuilt. R3-06\'s journey is browse→detail only, ' +
      "explicitly out of scope for this story's beats per its own spec. Port " +
      'stays null; owned by R4-03/batch B.',
  },
  {
    story: 'create-agent',
    batch: 'B',
    port: null,
    excluded: null,
    note:
      'R2-09 (this initiative) attempted this flip alongside edit-agent (its D11) ' +
      'and deliberately did NOT take it. The product surfaces are real — 9 of the ' +
      "11 mockup steps describe things that genuinely work today: the /agents " +
      'library and /agents/new (step 1-2), the instructions field and its ' +
      'generation assist (step 5, R2-09-F2), click-to-add on a catalog chip ' +
      '(step 6, R2-09 C2), the matching zone plus the live YAML preview (step 7), ' +
      'the allowed-input-materials declaration (step 8, R2-09-F1), saving a ' +
      'from-scratch agent to a real SKILL.md (step 9), it appearing on the agents ' +
      'home (step 10), and it being standalone-runnable (step 11, ' +
      '[data-run-dispatchable], R2-01-F3). What blocks the flip is BEAT ' +
      'GRANULARITY, not reality: rule 9 wants one BeatRef per mockup step and ' +
      'rule 13 forbids citing the same beat twice, but the `agents` journey walks ' +
      'that whole arc inside COMPOSITE beats — agents-scratch-build alone covers ' +
      'steps 2, 6, 7, 9 and 10 in a single beat — so only 4 distinct non-edit-arc ' +
      'beats exist (agents-starters, agents-scratch-build, agents-builder, ' +
      'agents-materials-declare) where 9 are needed. Citing edit-arc beats to make ' +
      'up the count, or marking covered-but-coarse steps as {excluded}, would both ' +
      'misrepresent the state — exclusion means deliberately not built, which is ' +
      'false here. Splitting agents-scratch-build into per-step beats is the ' +
      'remaining work and is journey surgery on a beat that currently passes. ' +
      'Steps 3-4 (type into draft-prompt, click "Draft it") are the ' +
      'conversational new-agent drafting R2-09 rejected with an owner (D10 reject ' +
      "#4): the creation AGENT SESSION is R4-15/R4-17 on R2-10's shell, and the " +
      'shipped alternative is the curated StarterPicker (agents-starters). They ' +
      'are therefore NOT recorded as permanent {excluded, decision} refs here — ' +
      'R4-15/R4-17 may make them genuinely real, and pre-excluding them would ' +
      'freeze a decision those initiatives own. Natural owner of this flip: the ' +
      'same batch-B initiative that lands the creation session. ' +
      'R4-15 ASSESSED that inheritance (2026-08-06) and does NOT own it: it ' +
      're-surfaces the ARCHITECT session, whose entry is an idea box, not an ' +
      'agent-drafting chat — nothing in R4-15 makes steps 3-4 real. The two ' +
      'drafting steps stay unexcluded and pass to R4-17 (create-project / the ' +
      'creation agent), which is the batch-B initiative that actually lands a ' +
      'creation session.',
  },
  {
    story: 'edit-agent',
    batch: 'B',
    port: {
      journey: 'agents',
      beats: [
        'agents-edit-selector-open',
        'agents-edit-selector-navigate',
        'agents-edit-catalog-click-add',
        'agents-edit-dirty',
        'agents-edit-regenerate-instructions',
        'agents-edit-save',
        'agents-edit-byte-faithful',
      ],
    },
    excluded: null,
    note:
      'R2-09 (this initiative) shipped the agent-select switcher, click-to-add ' +
      'catalog chips, the instructions-draft assist (never auto-saved), and the ' +
      "byte-faithful save path — the `agents` journey's 7 new agents-edit-* " +
      'beats port all 7 mockup steps to real, executed beats (mockup 1-indexed, ' +
      'journeys-data.jsx:72-83) against a REAL shipped agent (developer-ralph, ' +
      'the only OOTB agent carrying both a hand-written 7-line YAML comment ' +
      'block and a fanout: block — the one fixture that can prove both the ' +
      'byte-faithful claim and the fanout-survives-a-full-reserialize claim at ' +
      'once; its real bytes are stashed before this arc and restored after, ' +
      'crash-safe at the top-level finally). Step 1 (goto the builder, pick ' +
      'from the selector) is agents-edit-selector-open — real [data-agent-' +
      'select]/[data-agent-option]. Step 2 (select the Developer) is agents-' +
      'edit-selector-navigate — switches through the SAME real selector and ' +
      'asserts the route + data-agent-id actually changed (round-tripped ' +
      'through a second real agent and back to developer-ralph, so the arc ' +
      'continues on the intended fixture). Step 3 ("drag — or just click it") ' +
      'is agents-edit-catalog-click-add — click-to-add is real (R2-09 C2), ' +
      'proven idempotent by clicking the same, now-bound chip a second time ' +
      'and asserting the count does not move (the drag path itself is already ' +
      'covered by agents-scratch-build, not re-proven here). Step 4 (lands in ' +
      'Skills, marks itself unsaved) is agents-edit-dirty — [data-dirty=' +
      '"true"]. Step 5 (regenerate instructions) is agents-edit-regenerate-' +
      'instructions — the real Generate-draft assist, with the D9 "never ' +
      'auto-saved" guarantee independently verified (the real file on disk is ' +
      'read back byte-unchanged at that exact moment, mid-edit). Step 6 (Save) ' +
      'is agents-edit-save — the compound save (skill + drafted instructions) ' +
      'lands on the real SKILL.md, and the fanout: block is asserted present, ' +
      'not dropped, even though this particular save takes the full-reserialize ' +
      'path (composition changed). Step 7 is caption-only in the mockup ("Edit ' +
      'is the same surface as create — zones and instructions ARE the spec") — ' +
      'mapped onto agents-edit-byte-faithful, the real product statement of ' +
      'that same claim: a body-only save (no composition change) keeps the ' +
      'ENTIRE frontmatter — the 7-line comment, the fanout: block, key order — ' +
      'byte-for-byte outside the edited region (skill-md-fidelity.ts D5/D6). ' +
      'Net: 7 of 7 mockup steps are genuinely backed by a real, executed beat id.',
  },
  {
    story: 'create-flow',
    batch: 'C',
    port: null,
    excluded: null,
    note:
      "Only mockup story absent from every batch's functional-closure " +
      'column in README §4. Its surface (flow builder, hex canvas, ' +
      'ArtifactPicker edges) is verified aligned by R4-B13, so the port ' +
      'is a pure journey-sync duty with no product work; assigned to C ' +
      'as the only batch owning flows-pillar modules.',
  },
  {
    story: 'edit-flow',
    batch: null,
    port: null,
    excluded: {
      reason:
        'Whole story is plan-band parallel branching: fork after intake, ' +
        'Demo Design + Research in parallel, Developer as a JOIN. The ' +
        'cut parked plan-band parallelism; forge-develop stays linear.',
      decision: DECISION_2,
    },
  },
  {
    story: 'run-flow',
    batch: 'C',
    port: null,
    excluded: null,
    note:
      "Flow topology verified aligned by R4-B13; the mockup's extra " +
      '"Initiative intake" node is presentation of the existing queue ' +
      "claim, not a new flow node. Batch C's port covers the " +
      'kickoff/run-detail/monitor surfaces the story walks.',
  },
  {
    story: 'run-agent',
    batch: 'C',
    port: null,
    excluded: null,
  },
  {
    story: 'build-hook',
    batch: 'A',
    port: null,
    excluded: null,
    note:
      'R3-03-F4 (this initiative) shipped the hooks pillar (/hooks, ' +
      '/hooks/[id], /hooks/new, Agent-Builder binding) and the new `hooks` ' +
      'journey makes beats 1-3 and 11-15 real (mockup 1-indexed): beat 1 ' +
      '(goto \'#/library\') and beat 2 (\'sub-hooks\' sub-nav click) land on ' +
      'the real /hooks library (hooks-library beat); beat 3 (hover ' +
      'lib-pre-pr-security-review to see its event + who carries it) is the ' +
      'SAME real library card plus the real /hooks/pre-pr-security-review ' +
      'detail page (hooks-library + hooks-detail beats) — both OOTB seeds, ' +
      'carried-by DERIVED from real agent composition.hooks. Beats 4-10 ' +
      '(click build-hook-btn through the accept click) are an AGENTIC ' +
      "AUTHORING SESSION — journeys-data.jsx routes build-hook-btn to " +
      "go('agents','session','build-hook'), i.e. the R2-10 interactive " +
      'session shell (batch B), which does not exist; the real product ' +
      'authors a hook through the /hooks/new FORM instead (hooks-create ' +
      'beat), typed by the operator, not generated by an agentic turn — not ' +
      'ported here, and NOT the same interaction shape, so no beat ref ' +
      'stands in for it. Beat 11 ("on the shelf: event shown, unbound") is ' +
      'real — the hooks-create beat\'s freshly authored hook lands on its ' +
      'own detail page with data-carried-by-count="0" and the literal ' +
      '"Unbound — bind it from an agent\'s builder" text. Beats 12-15 (open ' +
      'the Developer\'s builder, click the new hook into the catalog, hover ' +
      'the hooks zone, save) are real — the hooks-bind beat drags the ' +
      'hooks-create beat\'s hook into developer-ralph\'s [data-accepts="hook"] ' +
      'zone (proven distinct from [data-accepts="guard"]) and saves; ' +
      'carried-by flips 0→1 on the hook\'s own detail page afterward. The ' +
      'security-scan discipline the mockup never scripts at all (blocked ' +
      'verdict, refused approval, a distinct recorded override) is the ' +
      'hooks-security beat — real, valuable, and simply absent from this ' +
      'mockup story. Net: 8 of 15 mockup beats are genuinely backed by a ' +
      'real beat id; 7 (the session shell) are not, so port stays null — ' +
      'claiming ported would misrepresent the 7 unbacked beats as real.',
  },
  {
    story: 'build-skill',
    batch: 'A',
    port: null,
    excluded: null,
    note:
      'R3-01-F3/F4 (this initiative) made mockup beat 1 real — ' +
      "goto '#/library/skills' now lands on the real /skills library " +
      '(local + community sections, derived used-by, install/approve). ' +
      'Beats 2-8 (click build-skill-btn through the accept click) are an ' +
      "AGENTIC AUTHORING SESSION — mockups/studio-endstate-v2/views-library.jsx:108 " +
      "routes build-skill-btn to go('agents','session','build-skill'), i.e. " +
      'the R2-10 interactive session shell (batch B), which does not exist; ' +
      'the real product authors a plain skill through the /skills/new form ' +
      'instead, not an agentic session. Beat 9 ("on the shelf, marked ' +
      'unbound") is that same session\'s own confirmation state, so it also ' +
      'awaits R2-10 — not ported here. Beats 10-13 (open the Reflector\'s ' +
      'builder, click release-notes into the catalog, save the binding) ' +
      'exercise ordinary agent-builder skill composition, which already ' +
      'shipped before this wave (R3-01-F1/F2\'s unified palette) — real, but ' +
      'not new work this initiative owns or ported as a beat.',
  },
  {
    story: 'install-connections',
    batch: 'A',
    port: {
      journey: 'community',
      beats: [
        'community-connections-entry',
        'community-connections-browse-entry',
        'community-hub-strip',
        'community-filter-mcp',
        'community-mcp-detail-open',
        'community-mcp-detail-capabilities',
        'community-mcp-install-suppressed',
        'community-return-to-browser',
        { excluded: 'commkind-cli filters to a "cli" kind that does not exist — forge has two real connection kinds (tool, mcp), not three', decision: DECISION_R3_04_D2_R3_07_D8 },
        { excluded: 'install-stripe-cli installs from a fabricated "cli" kind — the same non-existent third kind the prior beat filters to', decision: DECISION_R3_04_D2_R3_07_D8 },
        'community-connections-local-shelf',
        'community-connections-used-by',
      ],
    },
    excluded: null,
    note:
      'R3-07 (this initiative) shipped the cross-kind community browser and ' +
      'the new `community` journey ports 10 of the mockup\'s 12 steps to real, ' +
      'executed beats (mockup 1-indexed, journeys-data.jsx). Steps 1-2 are ' +
      "the real /connections shelf plus its own real browse-community entry " +
      'point (community-connections-entry: goto \'#/library/connections\'; ' +
      'community-connections-browse-entry: add-connection-btn substitutes ' +
      'honestly for the real [data-action="browse-community"] link on that ' +
      'page — the mockup\'s own id does not exist verbatim, the real product ' +
      'affordance it describes does). Step 3 (hover hub-strip) reuses the ' +
      'SAME community-hub-strip beat install-skills-hooks also cites — one ' +
      'real product moment, walked by both mockup stories. Steps 4-8 are the ' +
      'MCP arc this initiative built for real: filter to mcp ' +
      '(community-filter-mcp, which also demonstrates the tool filter in ' +
      'passing); the mockup\'s crow-sentry-mcp is substituted honestly for ' +
      'memory — connections.mjs\'s own proven fixture, real, curated, and ' +
      'npm-installable, unlike the fictional sentry-mcp id (detail open + ' +
      'capabilities: community-mcp-detail-open, community-mcp-detail-' +
      'capabilities). Step 7 (citem-install on the MCP) IS ported to ' +
      'community-mcp-install-suppressed — the real suppressed-install beat. ' +
      'What that beat PROVES: the install action routes to R3-04\'s real ' +
      'pipeline (data-install-routed-to="connection-install"), the byte-' +
      'exact argv is shown (independently reconstructed from the catalog ' +
      "pin, never re-read from the product's own claim), and the " +
      "connection's state is unchanged — confirmed on the community page " +
      "itself, then independently on disk, then again on the connection's " +
      'OWN owning /connections/<id> page two beats later. What it does NOT ' +
      'prove: no network install is ever performed in this gate — this ' +
      "harness's FORGE_ARCHITECT_NO_SPAWN suppression means an install " +
      "genuinely landing (R3-04 D7) is never exercised by this journey, by " +
      'design. Step 8 ("back to the browser") is community-return-to-' +
      'browser. Steps 9-10 (commkind-cli, install-stripe-cli) are ' +
      '{excluded, decision}: forge has two real connection kinds (tool, ' +
      'mcp), not the mockup\'s three (MCPs · CLIs · tools) — a clis: catalog ' +
      'section would move ids out of catalog.tools, which composition.tools ' +
      'validates against and CatalogPalette renders from, a dispatch-' +
      'affecting migration, not a browse-surface addition (R3-04 D2, R3-07 ' +
      'D8). Steps 11-12 close the arc for real: "both land in the local ' +
      'shelves, health-checked, provenance kept" maps honestly onto ' +
      'community-connections-local-shelf — since nothing was ever actually ' +
      'installed (the suppression above), this beat proves the LOCAL shelf ' +
      'genuinely still reads not-installed, health-checked against a REAL ' +
      "re-probe, not that an install landed; \"agents reference them by " +
      'name — nothing else to wire" maps onto community-connections-used-by ' +
      "(the derived used-by section on memory's own owning page, unaffected " +
      "by the browser). Net: 10 of 12 mockup steps are genuinely backed by " +
      'a real beat id; the other 2 are explicit, decision-cited exclusions, ' +
      'never silently skipped.',
  },
  {
    story: 'create-kb-project',
    batch: 'D',
    port: null,
    excluded: null,
  },
  {
    story: 'create-kb-cycle',
    batch: 'D',
    port: null,
    excluded: null,
  },
  {
    story: 'kb-maintain',
    batch: 'D',
    port: null,
    excluded: null,
  },
  {
    story: 'install-skills-hooks',
    batch: 'A',
    port: {
      journey: 'community',
      beats: [
        'community-skills-entry',
        'community-skills-card-signals',
        'community-browse-entry',
        'community-hub-strip',
        'community-filter-skill',
        'community-skill-detail-open',
        'community-skill-detail-signals',
        'community-skill-install',
        'community-hook-detail',
        'community-hook-install',
        'community-skills-shelf-return',
        'community-skills-detail-provenance',
        'community-skills-approve-palette',
      ],
    },
    excluded: null,
    note:
      'R3-07 (this initiative) shipped the cross-kind community browser and ' +
      'the new `community` journey ports all 13 mockup beats to real, ' +
      "executed beats (mockup 1-indexed). Beats 1-2 are the /skills shelf's " +
      "own real entry point (community-skills-entry: goto '#/library/skills' " +
      '→ /skills; community-skills-card-signals: a CATALOG-sourced card\'s ' +
      'real derived hub + hub-attributed signals, not the mockup\'s hover-only ' +
      'gesture). Beats 3-8 are the real /community browser this initiative ' +
      'built: browse-community-btn → the real [data-action="browse-community"] ' +
      'entry point (community-browse-entry); the hub strip with real ' +
      'per-hub counts (community-hub-strip); filter to skill ' +
      '(community-filter-skill); the mockup\'s systematic-debugging is ' +
      'substituted honestly for dependency-diff-review, forge\'s own vendored ' +
      'skill package — only a vendored item has a real install path (D5), ' +
      'and systematic-debugging (catalog-only, no vendored bytes) has none ' +
      '— detail open + SKILL.md preview (community-skill-detail-open, ' +
      'community-skill-detail-signals, which also cross-checks that ' +
      'systematic-debugging itself carries real hub signals, the honest ' +
      'contrast the vendored skill\'s signals:null makes visible); Install ' +
      '(community-skill-install: routes to R3-01-F4\'s real draft pipeline, ' +
      'not palette-visible). Beats 9-10 are the vendored hook\'s real arc: ' +
      "the mockup's '#/library/citem/no-secrets-hook' substitutes honestly " +
      'for block-protected-branch-push (forge\'s own vendored hook — ' +
      '"no-secrets-hook" is not a real id) — the pre-install SECURITY SCAN ' +
      '(community-hook-detail, verdict clean on the real vendored script) ' +
      'and Install (community-hook-install: routes to R3-03-F2\'s real ' +
      'pipeline, materialised but proven NOT runnable — no approval-ledger ' +
      'entry exists, independently confirmed against studio/hook-approvals.yaml ' +
      'on disk, cross-checked on the OWNING /hooks/<id> page, never the ' +
      'browser\'s own claim). Beats 11-13 close the arc for real: back on ' +
      '/skills (community-skills-shelf-return: filesystem wins on existence ' +
      '— the card reads data-skill-source="local", not a permanent ' +
      '"community" badge); "installed with provenance kept" ' +
      '(community-skills-detail-provenance: the real provenance renders on ' +
      "R3-01's own /skills/<id> surface, not duplicated on the browser); " +
      '"ready to click into any agent from the builder catalog" ' +
      '(community-skills-approve-palette) is real ONLY after the operator ' +
      'approves at /skills/<id> — the beat performs that approval there, ' +
      'which is the honest completion of the arc and keeps the trust ' +
      'decision outside this surface, exactly as D2 requires.',
  },
  {
    story: 'run-agent-developer',
    batch: 'C',
    port: null,
    excluded: null,
    note:
      'Agent itself verified aligned by R4-B13 (ralph loop, per-WI ' +
      "fanout, write-first continuity); batch C's port covers the " +
      'run/kickoff/monitor surfaces the story walks.',
  },
  {
    story: 'run-agent-adversarial-review',
    batch: 'C',
    port: null,
    excluded: null,
    note:
      'Agent itself verified aligned by R4-B13 (refute-first findings ' +
      "feeding the verdict gate); batch C's port covers the " +
      'run/kickoff/monitor surfaces the story walks.',
  },
  {
    story: 'run-agent-demo-runner',
    batch: 'C',
    port: null,
    excluded: null,
    note:
      'Agent itself verified aligned by R4-B13 (project-demo-skill ' +
      'execution with actual-resource evidence; the showcase-page delta ' +
      'is R4-14 and the project-hook trigger delta is R2-08); batch C\'s ' +
      'port covers the run/kickoff/monitor surfaces the story walks.',
  },
  {
    story: 'run-agent-reflector',
    batch: 'C',
    port: null,
    excluded: null,
    note:
      'Agent itself verified aligned by R4-B13 (outside-the-cycle ' +
      'reflection into the brains on the merged trigger; the brain-tune ' +
      "flow packaging delta is R4-20); batch C's port covers the " +
      'run/kickoff/monitor surfaces the story walks.',
  },
  {
    story: 'run-agent-demo-design',
    batch: null,
    port: null,
    excluded: {
      reason:
        'The demo-design parallel-intake agent is parked and stays ' +
        'vision-badged; no real agent to run.',
      decision: DECISION_2,
    },
  },
  {
    story: 'run-agent-research',
    batch: null,
    port: null,
    excluded: {
      reason:
        'The research parallel-intake agent is parked and stays ' +
        'vision-badged; no real agent to run.',
      decision: DECISION_2,
    },
  },
  {
    story: 'run-agent-architect',
    batch: 'B',
    port: null,
    excluded: null,
    note:
      'R4-15 (the initiative that owns this story) assessed the flip against the ' +
      'real DOM and deliberately did NOT take it. Step-by-step, 5 of the 7 mockup ' +
      'steps are real and already driven by beats: step 3 "Run -> straight into ' +
      'the session" (flows-run-idea lands on /sessions/architect/<sid>; R4-15 also ' +
      'added the project-page entry the mockup\'s trigger caption points at), ' +
      'step 4 "it read the brains and the roadmap before asking anything" ' +
      '(flows-run-grounding, the architect activity panel), step 6 "the roadmap ' +
      'updates live on the right" (flows-run-roadmap-dag, R4-15-F1, on a real ' +
      'session with real manifests) and its "accept commits it" half ' +
      '(flows-run-approve), step 7 "an updated roadmap DAG, ready for ' +
      'forge-develop" (flows-run-roadmap-dag + flows-run-approve). What blocks ' +
      'the flip is STRUCTURAL, not coverage. (1) port.journey is single-valued ' +
      '(scripts/lib/story-parity.mjs), and step 1 ("for interactive agents, Run ' +
      'IS a session") is real ONLY on the agent detail page — RunPanel\'s ' +
      'interactive branch, [data-run-dispatchable="false"], "run it from its own ' +
      'session page" — which belongs to the `agents` journey, while every other ' +
      'step needs `flows-run`\'s real architect session. No single journey can ' +
      'hold all 7. (2) Step 2 hovers an agent TRIGGERS panel that does not exist ' +
      'anywhere in the product: grep for data-section="agent-triggers" returns ' +
      'nothing, and trigger machinery is R2-08, explicitly out of R4-15\'s scope. ' +
      'Recording that step as {excluded} would be honest only once R2-08 has ' +
      'ruled it deliberately-not-built, which is R2-08\'s call and not R4-15\'s ' +
      'to pre-empt. Padding the count with edit-arc or unrelated beats would ' +
      'misrepresent the state. Natural owner of the flip: R2-08 (the triggers ' +
      'surface), after which the remaining obstacle is a journey-boundary ' +
      'question, not a product gap.',
  },
  {
    story: 'run-agent-demo-builder',
    batch: 'B',
    port: null,
    excluded: null,
  },
  {
    story: 'run-agent-onboarding',
    batch: 'B',
    port: null,
    excluded: null,
  },
  {
    story: 'run-agent-brain-creation',
    batch: 'D',
    port: null,
    excluded: null,
  },
  {
    story: 'run-flow-onboard',
    batch: 'D',
    port: null,
    excluded: null,
  },
  {
    story: 'run-flow-brain-tune',
    batch: 'D',
    port: null,
    excluded: null,
  },
];
