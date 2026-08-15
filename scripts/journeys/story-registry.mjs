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

// T1 ruling 2026-08-06 (batch B), operator-RATIFIED 2026-08-08 (batch-D open).
// `create-agent` mockup steps 3-4 — conversational new-agent drafting — are a
// DELIBERATE divergence from the mockup, not an unbuilt gap: R2-09 rejected them
// with two named owners (R4-15, R4-17), both assessed and neither owns them, no
// wave-5 initiative builds them, and the shipped alternative is the curated
// StarterPicker. The "mockup gets updated" clause of §6 is now DISCHARGED — the
// mockup was corrected 2026-08-08: mockups/studio-endstate-v2/views-agents.jsx
// renders the StarterPicker panel (data-j=starter-issue-triage / starter-blank),
// and journeys-data.jsx create-agent steps 3-4 pick a starter instead of typing
// into a draft prompt. Mockup, roadmap and this registry now agree.
// Recorded permanently (a citation into the campaign dir would be a dangling
// citation — `_wave5/` is gitignored).
const DECISION_CREATE_AGENT_DRAFTING =
  'docs/roadmaps/README.md "Batch-B disposition — conversational agent ' +
  'drafting (2026-08-06, T1 ruling; operator-ratified 2026-08-08)" — EXCLUDED ' +
  'under §6 (roadmap wins over the mockup; mockup corrected 2026-08-08 to show ' +
  'the StarterPicker), because both named owners assessed and neither owns it ' +
  'and the shipped alternative is the StarterPicker';

// R6-04 (this initiative's own baseline, 2026-08-07) — cited by every
// run-agent exclusion below rather than a separate ADR, since these are
// as-built structural facts this initiative itself recorded, not a prior
// planning ruling.
const DECISION_R604_KICKOFF_BASELINE =
  'docs/roadmaps/R6-operator-experience.md R6-B5 "Agent kickoff panel + ' +
  'standalone run view" (R6-04, 2026-08-07)';

// T1 ruling 2026-08-09 (batch D, R1-06 WI-4) — cited by create-kb-project/
// create-kb-cycle/kb-maintain below. R1-06-F2's own text draws the exact
// line this journey-sync pass ports to: "/knowledge/new ... on create, hands
// off to the brain-creation session (R4-19) to seed structure" — the HAND-OFF
// (sessionId, real project/dot anchor, kb.yaml + band) is R1-06's own real,
// shipped surface; the SEEDING CONTENT (turns that draft themes, findings
// clusters, an accept step) is the brain-creation/maintenance AGENT R4-19
// builds. R4-ootb-suite.md's own R4-19 section confirms the as-built gap
// ("no cycle/band-scope creation, no maintenance agent — guided
// lint-resolution exists as a UI, not an agent session"). Every mockup step
// that depicts multi-turn session CONTENT (seeded findings, an accept
// affordance, a maintenance agent narrating its own fix) is excluded under
// this citation — never faked/scripted-as-real (T1 ruling Q5).
const DECISION_R4_19 =
  'docs/roadmaps/R1-contract-componentry.md R1-06-F2 "Agent-seeded creation ' +
  'hand-off" (" ... hands off to the brain-creation session (R4-19) to seed ' +
  'structure ... Descriptor-only creation remains valid") + R1-06-F3 ' +
  '("running the R4-19-F2 agent against real lint findings") + ' +
  'docs/roadmaps/R4-ootb-suite.md R4-19 "Brain creation & maintenance ' +
  'agents" ("As-built: ... no cycle/band-scope creation, no maintenance ' +
  'agent")';

// R4-19 F1 (journey-sync T3, 2026-08-10) — WI-2 (cli/bridge-studio-sessions.ts
// `invalidProjectReason`'s bounded `.kb-<slug>` carve-out) made a non-project
// KB's dot-anchored seeding session genuinely REACHABLE through the
// session-shell route (it used to 404 there), and WI-1
// (orchestrator/project-brain-builder-runner.ts `buildAnalyzePlan`) branches
// the analyze step's plan on `kb_binding.kind` so a flow+band binding reads
// real cycle-archive/review-band evidence instead of a project repo. This
// closes exactly the gap DECISION_R4_19 names for create-kb-cycle's SESSION
// TURNS (not create-kb-project's or kb-maintain's — those stay on
// DECISION_R4_19 unchanged: create-kb-project's gap is a project-scoped
// theme-authoring agent, and kb-maintain's F2 maintenance-agent narration
// gap is untouched by this initiative, a separate PR). What is now REAL:
// the session is reachable/drivable end to end (briefing → a real POST that
// flips phase → the deterministic commit step, `runCommitStep`, invoked
// directly since only the detached SDK-turn *spawn* stays suppressed under
// this harness's FORGE_ARCHITECT_NO_SPAWN=1) — a genuine brain write lands.
// What stays EMULATED, honestly narrated as such: the theme-AUTHORING
// judgment itself (the actual SDK turn), since no real agent runs under this
// harness — grounded in forge's own real, already-committed review findings
// (declared-data-fails-open, suppression-env-fakes-the-pass), never invented.
const DECISION_R4_19_WI1_WI2 =
  'orchestrator/project-brain-builder-runner.ts `buildAnalyzePlan` (R4-19 ' +
  'WI-1, "flow binding WITH a band ... has NO project repo to read — its ' +
  'evidence is the forge-owned cycle archives ... plus the review-band / ' +
  'adversarial-review findings logged inside them") + ' +
  'cli/bridge-studio-sessions.ts `invalidProjectReason` (R4-19 WI-2, ' +
  '"bounded carve-out: allow EXACTLY `.kb-<valid-slug>` ... traversal ' +
  'defense is unchanged") — together make create-kb-cycle\'s seeding ' +
  'session reachable and deterministically committable for real; only the ' +
  'SDK theme-authoring turn stays emulated (create-kb-project and ' +
  'kb-maintain\'s F2 gap are untouched by this initiative and stay on ' +
  'DECISION_R4_19)';

// The mockup's create-kb-project/create-kb-cycle stories script a multi-
// click WIZARD (create-brain-btn -> scope-X -> select target -> continue) as
// four separate user actions. The real, as-built /knowledge/new form (R1-06-
// F2: "the binding picker, as-built") is ONE page filled top-to-bottom and
// submitted with a SINGLE click — there is no separate "scope" click or
// "continue" click to independently drive. The single real submit (name +
// binding-kind + binding-ref [+ band] + desc, one create-kb click) is what
// knowledge-create-kb/knowledge-create-kb-band-scope actually exercise.
const DECISION_R1_06_SINGLE_FORM =
  'docs/roadmaps/R1-contract-componentry.md R1-06-F2 "Agent-seeded creation ' +
  'hand-off" ("/knowledge/new (binding picker, as-built) gains the band ' +
  'option and, on create, hands off ...") — the real form is one page, one ' +
  'submit, not the mockup\'s multi-step wizard';

// R6-08 (KB explore, wave 5, status: planned) owns BOTH gaps this decision
// covers: "draggable nodes with reactive neighbours, tension presets"
// (R6-08-F1, mockup round-5 — "As-built: KbGraph ... exist as separate
// panels ... largely not new machinery", i.e. drag is not yet real) and the
// tabbed "Ingest activity" panel (R6-08-F2 — "Ingest activity lists
// reflection-driven ingest events from the event log, read-only, with NO
// ingest affordance (explicit negative AC — decision 3)"). R1-06-F3 states
// the SAME operator decision 3 from the maintenance side ("no ingest
// affordance anywhere in creation or maintenance").
const DECISION_R6_08_GRAPH_INTERACTIONS =
  'docs/roadmaps/R6-operator-experience.md R6-08-F1 "Combined explore ' +
  'surface" (mockup round-5 draggable-node/tension-preset interactions; ' +
  '"As-built: ... largely not new machinery" — not yet built)';
const DECISION_NO_INGEST_AFFORDANCE =
  'docs/roadmaps/R6-operator-experience.md R6-08-F2 "Health + Ingest-' +
  'activity tabs" ("Ingest activity ... with NO ingest affordance ' +
  '(explicit negative AC — decision 3)") + ' +
  'docs/roadmaps/R1-contract-componentry.md R1-06-F3 "Explicit negative AC ' +
  '(decision 3): no ingest affordance anywhere in creation or maintenance" ' +
  '+ docs/roadmaps/README.md §4 wave-5 cut summary ("manual KB ingest -> ' +
  'rejected, reflection-only policy stands (decision 3, negative ACs on ' +
  'R6-08/R1-06)")';

// A mockup step whose real UI moment genuinely IS demonstrated, but by the
// SAME beat already cited elsewhere in this story's own port.beats — the
// registry's one-real-ref-per-story rule (scripts/lib/story-parity.mjs,
// validateEntry Rule 13: "reject a repeated real beat ref ... a repeated ref
// is a copy-paste typo that would otherwise silently manufacture a fake
// `ported` beat") forbids citing the same string beat id twice within one
// story. This is a schema-honesty technicality, never a claim the capability
// is unbuilt — the note field on each row below says exactly which cited
// beat/step already covers it.
const DECISION_ONE_REF_PER_STORY =
  'scripts/lib/story-parity.mjs validateEntry Rule 13 ("reject a repeated ' +
  'real beat ref") — the registry allows exactly one string BeatRef per ' +
  'real beat within a single story\'s port.beats';

// R4-14 (batch D, journey-sync T3) — cited by the excluded steps of
// run-agent-demo-runner below. R4-14's own scope line (R4-ootb-suite.md
// R4-14-F1: "Route + page rendering the project's most recent demo-artifact
// set ... Refresh is data-driven — a new merged cycle's artifacts appear
// without page changes; the *auto-refresh trigger* (demo-runner on
// PR-merged project hook) is R2-08-F3's row, consumed here") draws the exact
// line this port takes: R4-14 ships the SHOWCASE PAGE — the standing
// evidence surface a merged cycle's demo.json renders into — never the
// demo-runner AGENT itself (builder navigation, its own run view, or a
// hook-triggered execution transcript), which is a different surface owned
// elsewhere (R4-B13 already verified the agent aligned; R2-08 owns the
// project-hook trigger machinery). The mockup's own steps 3-4 script a
// specific fabricated example ("PR #61 just merged on betterado") — never
// scripted as real here, per the demo-seeds honesty rule (corpus-grounded
// fixtures only, journey-fixtures.mjs's own header comment).
const DECISION_R4_14_SHOWCASE_NOT_AGENT_RUN =
  'docs/roadmaps/R4-ootb-suite.md R4-14 "Demo showcase page" / R4-14-F1 ' +
  '"Showcase surface" ("Route + page rendering the project\'s most recent ' +
  'demo-artifact set ... Refresh is data-driven ... the *auto-refresh ' +
  'trigger* (demo-runner on PR-merged project hook) is R2-08-F3\'s row, ' +
  'consumed here") + R4-14\'s "Out of scope: demo generation (R4-07 demo ' +
  'agent, done) ... trigger machinery (R2-08)" — R4-14 ports the SHOWCASE ' +
  'surface only, not the demo-runner agent-builder/agent-run surface';

// Batch-D journey-sync (T3) — cited by create-flow's excluded step 1 below.
// R2-04-F4's own text draws the real library shape: flows are a SECTION of
// the single library home page (`/`), never a standalone route — the
// create-flow mockup's own step 1 ("goto '#/flows'") depicts a route that
// was never built. The real entry point (that section's own "+ New Flow"
// CTA, [data-action="new-flow"]) is what the story's ported beat actually
// drives.
const DECISION_FLOWS_LIBRARY_SECTION =
  'docs/roadmaps/R2-runnable-componentry.md R2-04-F4 "Trigger authoring ' +
  'surface" ("Flow builder exposes trigger declaration ... the library `/` ' +
  'flows section surfaces each flow\'s triggers") — flows are a section of ' +
  'the single library home page, not a standalone route';

// Batch-D journey-sync (T3) — cited by run-agent-reflector's excluded steps
// below. R4-B13's own reflector line draws the real boundary: the agent is
// "as-built (R4-09)" for its outside-the-cycle brain-write behavior, but no
// journey in this harness ever executes a real reflector SDK turn
// (FORGE_ARCHITECT_NO_SPAWN=1 suppresses every real agent spawn) — a live
// run's own narrative content (which cycle it read, how many lessons it
// distilled, whether they were "evidence-backed") is therefore genuinely
// unavailable to any beat, honestly excluded rather than fabricated. What IS
// real and ported: reflector's own DECLARED composition
// (skills/reflector/SKILL.md — `brainAccess: mandatory`,
// `composition.skills: [brain-query, brain-ingest]`) rendered on its real
// /agents/reflector page, plus a genuine `forge brain lint` run (the real
// 9-check suite CLAUDE.md documents) proving brain/ is actually lint-clean
// right now.
const DECISION_REFLECTOR_NO_LIVE_RUN =
  'docs/roadmaps/R4-ootb-suite.md R4-B13 "reflector (run-agent-reflector) — ' +
  'outside-the-cycle reflection into the brains, merged-trigger: as-built ' +
  '(R4-09)" + skills/reflector/SKILL.md (`brainAccess: mandatory`, ' +
  '`composition.skills: [brain-query, brain-ingest]`) — no journey in this ' +
  'harness spawns a real reflector SDK turn (FORGE_ARCHITECT_NO_SPAWN=1), so ' +
  'a specific run\'s own narrative (which cycle it read, lesson count, ' +
  '"evidence-backed" judgment) is honestly unavailable; the agent\'s real ' +
  'declared composition + a genuine `forge brain lint` run are ported instead';

// Batch-D journey-sync (T3, R4-20) — cited by run-flow-brain-tune's note
// below. R4-20-F1's own decision block (docs/roadmaps/R4-ootb-suite.md,
// dated 2026-08-10, T1 ruling) resolves KEEP-AS-IS, not evolve: the
// brain-tune loop already runs orchestrator-owned on every merge (the
// reflector post-run pipeline — orchestrator/phases/reflector.ts's S6A
// brain-lint trigger + REF-4 ingest — dispatched via forge-develop's
// `{on: merged, target: {kind: agent, ref: reflector}}` standing trigger),
// and evolving into a visible flow with its own lint GATE node would need a
// NEW row in orchestrator/flow-runner.ts's closed GATE_KIND dispatch table
// (currently only {plan, verdict}) — an ADR-042 orchestrator-surface
// increase, ask-first/PARK. R4-09-F1 already retired the single-node
// forge-reflect flow wrapper as the shipped shape (studio/flows/
// forge-reflect/flow.yaml is authorable-only, kickoff: trigger-only) — a
// visible `#/flows/monitor/brain-tune` route and a discrete lint GATE node
// never existed and will not exist under this ruling. The mockup
// (mockups/studio-endstate-v2/journeys-data.jsx's run-flow-brain-tune
// entry) is corrected in this same pass to depict the real surface instead
// of deferring that correction to a port-time exclusion.
const DECISION_R4_20_KEEP_AS_IS =
  'docs/roadmaps/R4-ootb-suite.md R4-20 "Decision (2026-08-10, T1 ' +
  'keep-as-is)" ("R4-20-F1 resolves KEEP-AS-IS, not evolve ... the ' +
  'brain-tune loop already runs orchestrator-owned on EVERY merge ... ' +
  'evolve would need a NEW row in orchestrator/flow-runner.ts\'s closed ' +
  'GATE_KIND dispatch table ... an ADR-042 orchestrator-surface increase, ' +
  'ask-first/PARK") + orchestrator/phases/reflector.ts (S6A brain-lint ' +
  'trigger ~:452-464, REF-4 ingest ~:475-476) + studio/flows/forge-develop/' +
  'flow.yaml (`{on: merged, target: {kind: agent, ref: reflector}}`) — a ' +
  'visible `#/flows/monitor/brain-tune` route and a discrete lint GATE ' +
  'node never existed and will not exist under this ruling';

// Batch-D journey-sync (T3, forge-tuy) — cited by run-flow's steps 1-10
// below. story-parity.mjs's own validateEntry Rule 8/10 ("port.journey must
// exist" / "string BeatRef must be a real beat of that journey") binds a
// registry entry's port.beats to exactly ONE real journey — run-flow's
// mockup opens on a project's roadmap tab (R4-13) and its inline kickoff
// trigger, both real, shipped surfaces that live in scripts/journeys/
// roadmap.mjs's own roadmap-tab / roadmap-start-development beats, a
// DIFFERENT journey from this entry's chosen journey: 'flows-run' (most of
// the story's real content lands there — see the note below). They are
// cited here by name in prose — real, already ported under roadmap.mjs's
// own RUN_ORDER slot — never fabricated or silently dropped. What
// roadmap-start-development's real trigger actually is, checked against
// forge-shc (PR #106, 2026-08-09, docs/forge-ui-dom-and-harness.md's "an
// optional per-kickoff cost-ceiling input" paragraph): a single
// [data-action="start-development"] click, INLINE on the roadmap DAG node
// card the operator is already looking at — no separate flow-monitor
// pre-visit, no separate project/initiative <select> (the node IS the
// binding, mirroring R6-04-F2's own agent-kickoff precedent — "the real
// kickoff panel is already inline") — and, as of forge-shc, an OPTIONAL
// per-kickoff cost-ceiling input on the SAME roadmap header. The
// materials-upload half of R6-04-F2's flow-kickoff AC ("Flow kickoff gains
// the same ceiling + materials treatment") remains genuinely unbuilt: no
// materials-attach control exists on roadmap-start-development's real path
// today (only the AGENT-kickoff path, R6-04 WI-1/2/3, has one) — an honest
// capability gap, not merely a cross-journey citation limit.
const DECISION_RUN_FLOW_KICKOFF_CROSS_JOURNEY =
  'scripts/lib/story-parity.mjs validateEntry Rule 8/10 (single-journey-' +
  'per-entry port.beats) + scripts/journeys/roadmap.mjs roadmap-tab / ' +
  'roadmap-start-development (R4-13) + docs/forge-ui-dom-and-harness.md\'s ' +
  'forge-shc per-kickoff cost-ceiling paragraph (PR #106, 2026-08-09) + ' +
  'docs/roadmaps/R6-operator-experience.md R6-04-F2 ("Flow kickoff gains ' +
  'the same ceiling + materials treatment") — the real flow-kickoff trigger ' +
  'is roadmap.mjs\'s own inline DAG-node action, a different journey from ' +
  'this entry\'s "flows-run"; its cost-ceiling half is now built (forge-' +
  'shc), its materials-upload half remains unbuilt';

// Batch-D journey-sync (T3, forge-tuy) — cited by run-flow's step-20
// exclusion below. flows-run-detail-reachable (cited at step 17) click-
// through-expands only the 'dev' timeline row — the adversarial-review
// row's own click-through was never exercised by any existing beat, and its
// real seeded content (flows-run-demo-review's adversarialReviewEvent()
// calls) carries generic findings-count metadata (total/blocker/major/
// minor/info), never a claim-by-claim "refute-first" transcript — that
// per-claim reasoning is a real SDK turn's own internal content this
// harness never spawns (FORGE_ARCHITECT_NO_SPAWN=1). The dedicated
// run-agent-adversarial-review story (this same batch-D pass, agents.mjs's
// new agents-run-adversarial-review-findings beat) is where that agent's
// real findings vocabulary is actually ported — reproducing a second,
// weaker proof of the same fact here under the mockup's fictional
// "ISO-week/memoization" framing would be redundant AND dishonest about
// what this fixture's own log lines say.
const DECISION_RUN_FLOW_ADVERSARIAL_LOG_GAP =
  'scripts/journeys/flows-run.mjs flows-run-detail-reachable (only the ' +
  '\'dev\' row is click-tested) + flows-run-demo-review\'s real ' +
  'adversarialReviewEvent() metadata (generic findings counts, no claim-by-' +
  'claim transcript) + the dedicated run-agent-adversarial-review story ' +
  '(agents.mjs agents-run-adversarial-review-findings, same batch-D pass) ' +
  'which actually ports this agent\'s real findings vocabulary';

// Batch-D journey-sync (T3, forge-11w) — cited by run-agent-developer's
// steps 3/6 below. A live click-through dispatch of developer-ralph under
// this harness's no-spawn seam (FORGE_ARCHITECT_NO_SPAWN=1) would only ever
// reproduce the SAME shallow, content-free skeleton agents-kickoff-dispatch
// / agents-kickoff-run-view (a DIFFERENT story's beats, R6-04) already prove
// for issue-triage — never the rich TDD-red-to-green narrative these steps
// depict, which exists only inside a real, unspawned SDK turn. Re-driving
// the identical Run-click wire mechanism a second time here would add cost
// without new evidence, so this port seeds the run directly instead
// (agents-run-developer-fixture) — the genuinely uncovered arc (a rich
// standalone run's log/cost/ceiling render honestly) rather than the
// already-proven arc (the click POSTs the right body).
const DECISION_RUN_AGENT_DEV_NO_LIVE_DISPATCH =
  'scripts/journeys/agents.mjs agents-kickoff-dispatch / agents-kickoff-' +
  'run-view (the real wire-level Run-click proof, a different story\'s ' +
  'beats) + orchestrator/run-agent.ts\'s FORGE_ARCHITECT_NO_SPAWN suppression ' +
  '— a live dispatch under this harness never reaches the rich dev-loop ' +
  'content these steps depict, so agents-run-developer-fixture seeds it ' +
  'directly instead';

// Batch-D journey-sync (T3, forge-11w) — cited by run-agent-developer's
// step 4. docs/roadmaps/R2-runnable-componentry.md R2-B11's own text: "no
// roster agent declares `materials:` yet" — developer-ralph's real shipped
// SKILL.md carries no `materials:` key at all, so no materials-attach
// section exists on its real kickoff path today.
const DECISION_RUN_AGENT_DEV_MATERIALS_GAP =
  'docs/roadmaps/R2-runnable-componentry.md R2-B11 ("no roster agent ' +
  'declares `materials:` yet") — developer-ralph\'s real shipped SKILL.md ' +
  'declares no materials: kinds, so no materials-attach control exists on ' +
  'its real kickoff path';

// Batch-D journey-sync (T3, forge-11w) — cited by run-agent-developer's
// step 9. forge-ui/lib/run-view-client.ts's own header: "there is no wired
// data source for a generic dispatched agent's artifact outputs yet ...
// `outputs` is honestly always `[]` here rather than fabricated" —
// confirmed live by agents-run-developer-fixture's own data-outputs-count
// assertion.
const DECISION_RUN_AGENT_TYPED_OUTPUTS_GAP =
  'forge-ui/lib/run-view-client.ts (header: "there is no wired data source ' +
  'for a generic dispatched agent\'s artifact outputs yet ... honestly ' +
  'always `[]`") — confirmed live by agents-run-developer-fixture\'s own ' +
  'data-outputs-count="0" assertion';

// Batch-D journey-sync (T3, forge-928) — cited by run-agent-adversarial-
// review's step 2. forge-pet's own commit (d27bc873, "fix: pet — attach
// trigger-provenance section to the standalone agent run view") attaches
// [data-section="run-trigger"] STRUCTURALLY (RunView.tsx renders it when
// the wire body carries a `trigger` field) but its own message says
// "Client-side only per T1 ruling — no server field wired (no producer
// exists yet; becomes live when one lands)" — GET /api/agents/runs/:runId
// (cli/ui-bridge.ts) never emits a `trigger` field for ANY run today, so
// the section is genuinely absent on every real (or seeded) standalone run,
// never merely narrated as populated.
const DECISION_RUN_TRIGGER_NO_SERVER_PRODUCER =
  'commit d27bc873 "fix: pet — attach trigger-provenance section to the ' +
  'standalone agent run view" ("Client-side only per T1 ruling — no server ' +
  'field wired") + cli/ui-bridge.ts\'s GET /api/agents/runs/:runId (never ' +
  'emits a `trigger` field for any run) — [data-section="run-trigger"] is ' +
  'genuinely absent on every real or seeded standalone run today';

// Batch-D journey-sync (T3, forge-928) — cited by run-agent-adversarial-
// review's step 4. "Year-boundary fixture against the ISO-week claim.
// Cold/warm timing against memoization" is fictional specific business
// content tied to a scenario no roster agent's real, shipped work touches
// — adversarial-review's real subject in this harness is mdtoc's
// `--write` TOC-injection story (the same grounding flows-run.mjs's own
// review-findings fixture uses), never an ISO-week/memoization codebase.
const DECISION_RUN_AGENT_ADV_FICTIONAL_SCENARIO =
  'skills/adversarial-review/SKILL.md (the real agent\'s actual mission) + ' +
  'scripts/lib/journey-fixtures.mjs writeReviewFindings (the real, ' +
  'mdtoc-grounded review-findings shape this harness uses) — the mockup\'s ' +
  '"ISO-week claim" / "memoization" scenario is fictional content tied to ' +
  'a codebase no roster agent\'s real work touches';

// Batch-E journey-sync (T3, R4-18) — cited by run-flow-onboard's step 3
// exclusion below. orchestrator/studio/types.ts's own FLOW_KICKOFF_KINDS
// enumeration has exactly three members ('idea', 'initiative-select',
// 'trigger-only') — no project-target-picker kind. onboard-project
// deliberately declares no `kickoff:` block at all (studio/flows/
// onboard-project/flow.yaml's own comment: "the generic Start-Run affordance
// handles it"), so FlowKickoff.tsx falls through to GenericKickoff
// (~:110-119) — a bare button, no field of any kind. The real onboarding
// entry point stays the PROJECT page's own "Run onboarding agent" action
// (R4-02/R4-17, ported at stand-up-onboard's su-onboard-project beat), never
// a flow-kickoff project selector.
const DECISION_R4_18_NO_PROJECT_KICKOFF_KIND =
  'orchestrator/studio/types.ts:256 (`FLOW_KICKOFF_KINDS = ' +
  "['idea', 'initiative-select', 'trigger-only']` — no project-select kind) " +
  '+ forge-ui/components/studio/FlowKickoff.tsx GenericKickoff (~:110-119, ' +
  'the undeclared-kickoff fallback: a bare button, no project field) + ' +
  'studio/flows/onboard-project/flow.yaml\'s own comment ("Deliberately NO ' +
  'kickoff: block — the generic Start-Run affordance handles it") — there is ' +
  'no 4th kickoff kind and no project-target field anywhere on the real ' +
  'kickoff surface';

// Batch-E journey-sync (T3, R4-18) — cited by run-flow-onboard's step 4
// exclusion below. Measured, not assumed: handleStartRun
// (forge-ui/app/flows/[id]/page.tsx) calls `startRun(flow?.project ?? id)`;
// onboard-project declares `project: null`, so the real click would POST
// `{initiativeId:'onboard-project'}` to `/api/runs`
// (forge-ui/lib/bridge-client.ts). cli/bridge-studio-runs.ts's own
// INIT_ID_RE (`/^INIT-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*$/`,
// ~:749) rejects that id outright (400) — and even a conforming id must
// already sit in `_queue/{ready-for-review,failed}/` (the route only RESUMES
// an already-planned initiative by moving its manifest to `pending/`, ~:774-
// 843; it never mints a fresh one). No real product path ever queues an
// onboard-project-shaped manifest, so this click is a genuine dead end today
// — the real load-bearing proof (a run actually reaching the gate) is driven
// directly through the flow-runner instead, at flows-onboard-gate in this
// same port.
const DECISION_R4_18_GENERIC_KICKOFF_NO_DISPATCH =
  'forge-ui/app/flows/[id]/page.tsx handleStartRun (`startRun(flow?.project ' +
  '?? id)`) + forge-ui/lib/bridge-client.ts startRun (`POST /api/runs ' +
  '{initiativeId}`) + cli/bridge-studio-runs.ts INIT_ID_RE (~:749, ' +
  '`/^INIT-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*$/`) and its ' +
  'POST /api/runs handler (~:774-843, 400 on a non-matching id; even a ' +
  'matching id must already sit in _queue/ready-for-review or _queue/failed ' +
  '— the route only RESUMES an already-planned initiative, never mints a ' +
  'fresh one) — onboard-project declares project:null, so a real click 400s; ' +
  'flows-onboard-gate drives the real proof directly through the ' +
  'flow-runner instead';

// Batch-E journey-sync (T3, R4-18) — cited by run-flow-onboard's step 5
// exclusion below.
const DECISION_R4_18_NO_INTERVIEW =
  'skills/onboarding-agent/SKILL.md frontmatter ("interactivity: ' +
  'Operator-triggered against one project, then fully autonomous — asks no ' +
  'questions and never blocks mid-run") — the onboard-project flow\'s ' +
  '`onboard` node dispatches this exact agent (studio/flows/onboard-project/' +
  'flow.yaml `{id: onboard, agent: onboarding-agent}`); there is no ' +
  'interview turn anywhere on this flow\'s real path, mockup framing ' +
  'notwithstanding';

// Batch-E journey-sync (T3, R4-18) — cited by run-flow-onboard's step 6
// exclusion below. Single-journey-per-entry (story-parity.mjs validateEntry
// Rule 8/10) means the real contract build-out content — already ported —
// lives on a DIFFERENT journey (stand-up-onboard), cited here by name in
// prose, mirroring DECISION_RUN_FLOW_KICKOFF_CROSS_JOURNEY's own pattern.
const DECISION_R4_18_CONTRACT_AUTHOR_CROSS_JOURNEY =
  'docs/roadmaps/R4-ootb-suite.md R4-18 ("Out of scope: onboarding content ' +
  '(R4-02/R4-17)") + scripts/journeys/stand-up-onboard.mjs su-onboard-session ' +
  '(the contract build-out — contract, instructions, secrets, demo, roadmap, ' +
  'stage by stage — already real and ported there, a DIFFERENT journey from ' +
  'this entry\'s "flows-onboard") + skills/contract-check/SKILL.md ("this ' +
  'flow does NOT wrap R4-17\'s independently-dispatched onboarding session ' +
  '... a SEPARATE, flow-shaped way to run a fresh onboarding pass") — the ' +
  'contract-authoring CONTENT this mockup step depicts is R4-02/R4-17\'s own ' +
  'real surface, cross-journey, never rebuilt inside onboard-project\'s flow ' +
  'path';

// Batch-E journey-sync (T3, R4-18) — cited by run-flow-onboard's step 8
// exclusion below. flows-onboard-gate already drives R4-18-F1's own
// load-bearing AC ("a real onboarding run reaches the gate with real
// preflight output") via the honest RED path a freshly onboarded repo
// genuinely starts in — see orchestrator/onboard-flow-gate.test.ts AT-4 (the
// same fixture shape this port's beat reuses). The mirror-image GREEN
// completion is reachable only through that same test file's AT-4 companion,
// whose fixture basename MUST be "mdtoc" specifically to reuse the real,
// already-committed brain/projects/mdtoc/profile.md — a test-infrastructure
// coupling, not a demo-worthy scenario. Re-running the identical real gate a
// second time, via that fixture hack, just to stage the opposite verdict
// would add cost without new evidence about the real product — the same
// one-real-proof-per-capability reasoning DECISION_ONE_REF_PER_STORY states,
// applied across the RED/GREEN outcome pair rather than within one beat.
const DECISION_R4_18_GATE_RED_NOT_GREEN =
  'orchestrator/onboard-flow-gate.test.ts AT-4 (RED, the fixture shape ' +
  'flows-onboard-gate reuses for real) + its own AT-4 companion (GREEN, ' +
  'whose fixture basename MUST be "mdtoc" to reuse the real, ' +
  'already-committed brain/projects/mdtoc/profile.md — a test-infrastructure ' +
  'coupling) — flows-onboard-gate already drives R4-18-F1\'s own load-bearing ' +
  'AC ("a real onboarding run reaches the gate with real preflight output") ' +
  'via the honest RED path; re-running the identical real gate a second time ' +
  'for the mirror-image GREEN outcome would add cost without new evidence';

// R4-21 phase 2 (T3, journey-sync port) — cited by build-skill's step-6
// exclusion below. The live-capture fixture this port seeds
// (scripts/journeys/fixtures/r4-21-live-capture/skill/SKILL.md, provenance +
// sha256 in scripts/lib/journey-fixtures.mjs) is a REAL, captured
// creation-agent turn's output for a skill of this shape — and that real
// turn drafted exactly ONE file (SKILL.md at the package root; no
// scripts/templates directory). The mockup's own steps 5-6 script a
// TWO-file package ("the collector script" / "the output template") — this
// is a genuine capture-shape fact, not a fixture choice this port could have
// made differently without hand-inventing bytes the real turn never
// produced (forbidden by the T3 brief's own binding provenance rule).
const DECISION_BUILD_SKILL_SINGLE_FILE_PACKAGE =
  'scripts/journeys/fixtures/r4-21-live-capture/skill/SKILL.md (the real, ' +
  'captured creation-agent turn this port seeds — a single-file package, no ' +
  'scripts/ or templates/ directory) + scripts/lib/journey-fixtures.mjs\'s ' +
  'own provenance comment (sha256 f8c53c4fd15c31b88554d9f62933d506e360f92' +
  'bd566990bb762ff4e288305c5) — the mockup\'s two-tab framing does not match ' +
  'what this real turn actually drafted, and inventing a second file would ' +
  'violate the T3 brief\'s own binding rule against hand-invented agent output';

// R4-21 phase 2 (T3, journey-sync port) — cited by build-skill's steps
// 10-13. Binding a freshly authored (plain, non-agentic) skill into an
// agent's Skills zone via the catalog is NOT new work this port owns — R2-09
// already shipped and journey-proved the exact mechanism (click-to-add a
// catalog skill chip into an agent's composition + save), just on a
// DIFFERENT journey ('agents', not 'skills') and a different agent
// (developer-ralph, not the mockup's reflector) — single-journey-per-entry
// (story-parity.mjs Rule 8/10) means that real proof cannot be cited as a
// string BeatRef inside this story's own port.beats, mirroring
// DECISION_RUN_FLOW_KICKOFF_CROSS_JOURNEY's own cross-journey pattern
// exactly.
const DECISION_BUILD_SKILL_BINDING_CROSS_JOURNEY =
  'scripts/lib/story-parity.mjs validateEntry Rule 8/10 (single-journey-' +
  'per-entry port.beats) + scripts/journeys/agents.mjs agents-edit-catalog-' +
  'click-add (R2-09 C2 — click-to-add a catalog skill chip into an agent\'s ' +
  'composition, proven idempotent) + agents-edit-save (the compound save ' +
  'landing composition.skills on the real SKILL.md) — the identical drag/' +
  'click-into-zone-then-save mechanism the mockup depicts for the ' +
  'Reflector + release-notes is already real and journey-proved, just on a ' +
  'different journey/agent pairing';

export const STORY_REGISTRY = [
  {
    story: 'onboard-project',
    batch: 'B',
    port: null,
    excluded: null,
    note:
      'R4-17 (the batch-B initiative that owns this story) ASSESSED the flip ' +
      'per beat and does NOT claim it. What R4-17 made real: beat 3 ' +
      '("onboarding is an agent-led session, not a form") — the dispatch now ' +
      'opens a real staged session on the R2-10 shell, driven by the new ' +
      'stand-up-onboard/su-onboard-session beat; and the artifact-pane half of ' +
      'beats 5/7/8/9 — the contract build-out renders five real stage rows ' +
      '(contract, instructions, secrets, demo, roadmap) derived from the ' +
      "project's own artifacts, with secrets by NAME only. What is NOT real, " +
      'and is the reason the flip is refused: beats 4-9 each advance a ' +
      'multi-turn INTERVIEW with operator push-back ("your answer becomes the ' +
      'north star", "you push back, it folds in"), and the shipped ' +
      'onboarding-agent "asks no questions and never blocks mid-run" ' +
      '(skills/onboarding-agent/SKILL.md:9). Its session transcript is ' +
      'honestly ONE operator turn from a real prompt.md — R4-17 D8 refused to ' +
      'synthesise agent questions from form labels, which would have been ' +
      'fabricated coverage. Beat 10 ("Accept & commit") has no affordance: the ' +
      'session shell is read-only. Beats 13-15 (contract-panel, roadmap tab, ' +
      'roadmap DAG on the project page) are R4-12-F1/R4-13, batch D — R4-17 ' +
      'ships their data contract (GET /api/studio/projects/<id>/contract-stages) ' +
      'but not their rendering. R4-12-F1 (batch D) NOW ships the contract-panel ' +
      'rendering — the permanent five-stage panel on the project page, asserted ' +
      'green by stand-up-onboard/su-onboard-preflight AT-F1-8; the roadmap tab/DAG ' +
      '(R4-13) remain. Beat 16 (showcase) is R4-14, ' +
      'unbuilt. Not recorded as {excluded}: an interactive onboarding interview ' +
      'is not a decision to never build, and pre-excluding it would freeze a ' +
      'call R4-18 or a later initiative may legitimately take.',
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
      'stays null; owned by R4-03/batch B. ' +
      'R4-17 ASSESSED this story (2026-08-06) and does not flip it. R4-17 made ' +
      'the STAGES real and shared: creation reuses the same `onboarding` ' +
      'session-kind descriptor and the same contract build-out artifact rather ' +
      'than minting a second one (D1 — the mockup itself gives ' +
      'project-onboarding and create-project the SAME artifact and the SAME ' +
      '"Contract build-out" label, and no creation agent exists for a second ' +
      "descriptor's `agent:` field to resolve to). Beats 5-11 are still a " +
      'multi-turn creation-agent CONVERSATION ("the creation agent takes it ' +
      'from there"), and no such agent exists: grep for a runtime: block in ' +
      'skills/*/SKILL.md yields 16 agents, none of which authors a project. ' +
      'Beats 15-18 (contract panel, roadmap tab, DAG, showcase) are ' +
      'R4-12/R4-13/R4-14, batch D — R4-17 ships the data contract those ' +
      'landing beats render. R4-12 (batch D) NOW ships the contract-panel + ' +
      'cycle-ledger rendering (asserted green by stand-up-create/su-create-project-builder ' +
      'AT-F1-7 + AT-F2-4); the roadmap tab/DAG (R4-13) and showcase (R4-14) remain.',
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
      'shipped alternative is the curated StarterPicker (agents-starters). At the ' +
      'time R2-09 wrote this they were deliberately left UNEXCLUDED, because ' +
      'R4-15/R4-17 might still make them real and pre-excluding would have frozen ' +
      'a decision those initiatives owned — that reasoning was correct then and is ' +
      'SUPERSEDED now that both have assessed (see the T1 ruling below). Natural ' +
      'owner of this flip: the same batch-B initiative that lands the creation ' +
      'session. ' +
      'R4-15 ASSESSED that inheritance (2026-08-06) and does NOT own it: it ' +
      're-surfaces the ARCHITECT session, whose entry is an idea box, not an ' +
      'agent-drafting chat — nothing in R4-15 makes steps 3-4 real. The two ' +
      'drafting steps stay unexcluded and pass to R4-17 (create-project / the ' +
      'creation agent), which is the batch-B initiative that actually lands a ' +
      'creation session. ' +
      "R4-17 ASSESSED that inheritance (2026-08-06, batch B's last initiative) " +
      'and does NOT own it either. R4-17 lands a staged session for PROJECT ' +
      'onboarding and creation; steps 3-4 are a conversational drafting session ' +
      'for an AGENT SPEC, which needs an agent that authors agents — grep for a ' +
      'runtime: block in skills/*/SKILL.md yields 16 agents and none of them ' +
      'does. So after both named owners have assessed, NO wave-5 initiative ' +
      'builds conversational agent drafting, and the shipped alternative remains ' +
      'the curated StarterPicker. **T1 RULED steps 3-4 EXCLUDED (2026-08-06)** — ' +
      'a deliberate divergence from the mockup under README §6 (roadmap wins, ' +
      'mockup gets updated), not an unbuilt gap; the full reasoning lives in the ' +
      'permanent decision record cited at the end of this note. It is cited ' +
      'rather than encoded ' +
      'as a BeatRef because this registry can express exclusion only for a WHOLE ' +
      'story (which also forces batch:null, and would misrepresent this story\'s ' +
      '9 genuinely-real steps as deliberately not built) or for a single beat ' +
      'inside a COMPLETE port.beats array — which cannot be written until the ' +
      'beat-granularity surgery lands. It becomes a {excluded, decision} ref the ' +
      'moment that port object exists. The story stays `pending` for an honest ' +
      'reason: the remaining blocker is splitting the composite ' +
      'agents-scratch-build beat, which IS planned-but-not-yet-built work. ' +
      'Decision reference: ' + DECISION_CREATE_AGENT_DRAFTING + '.',
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
    port: {
      journey: 'flows-author',
      beats: [
        { excluded: 'goto \'#/flows\' — no dedicated /flows route exists; flows are a section of the single library `/` home page, never a standalone route', decision: DECISION_FLOWS_LIBRARY_SECTION },
        'flows-author-scratch-build',
        { excluded: 'already demonstrated by the SAME beat cited at step 2 (flows-author-scratch-build) — its own drive fills the real [data-field="flow-name"] input (a real, non-literal name, "Forge Develop Scratch", not the mockup\'s "deps-refresh")', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'already demonstrated by the SAME beat cited at step 2 — it drops developer-ralph onto the canvas via real HTML5 drag-and-drop; the mockup\'s "click — or drag" framing is only half real — AgentPalette\'s DraggableChip (forge-ui/components/studio/flow-builder/AgentPalette.tsx) has no onClick handler at all, drag is the ONLY real placement path', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'already demonstrated by the SAME beat cited at step 2 — its fanout-capability GATE check proves the real fan-out feature: developer-ralph is fanout-capable with an enabled toggle, demo-agent is not (disabled), both driven by the R2-03-F3 capability descriptor', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'already demonstrated by the SAME beat cited at step 2 — it drops demo-agent onto the canvas via the same real HTML5 drag-and-drop path', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'already demonstrated by the SAME beat cited at step 2 — it wires the developer→demo-agent edge by real ReactFlow handle-drag and labels it via the real ArtifactPicker; the mockup\'s literal "demo HTML summary" label has no backing real template (forge-ui/lib/flow-artifact-catalog.ts\'s own header comment: a `demo` artifact id existed and was deleted, R2-05-F1, "no on-disk template") — the real, closest hand-off genuinely picked is "wi-branches"', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'already demonstrated by the SAME beat cited at step 2 — it toggles the real human-verdict gate on the terminal node; there is no separate "verdict" node kind to drop from the palette (a gate is a MODIFIER on an agent node, not its own agent kind) — an honest, already-narrated UI limit', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'already demonstrated by the SAME beat cited at step 2 — its own frame captures show the SAME composite state the mockup depicts as one hover: hex agents, fan-out, hand-off artifacts, and a gate all on the SAME lane', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'already demonstrated by the SAME beat cited at step 2 — it saves via the real [data-action="save-flow"] click (a real, non-literal name, not the mockup\'s "deps-refresh")', decision: DECISION_ONE_REF_PER_STORY },
        'flows-author-shelf-return',
      ],
    },
    excluded: null,
    note:
      "Only mockup story absent from every batch's functional-closure " +
      'column in README §4. Its surface (flow builder, hex canvas, ' +
      'ArtifactPicker edges) is verified aligned by R4-B13, so the port ' +
      'is a pure journey-sync duty with no product work; assigned to C ' +
      'as the only batch owning flows-pillar modules. MEASURED at ' +
      'batch-C exit (2026-08-08): NOT ported — 0 of 11 beats, and the ' +
      'only zero whose producer is already complete on main. Batch-D ' +
      'journey-sync (T3, forge-9ir) pays off that debt: step 1 (goto ' +
      "'#/flows') is excluded (DECISION_FLOWS_LIBRARY_SECTION — no " +
      "dedicated route, flows live in the library `/` page's own " +
      '"flows" section); step 2 (an "empty canvas") is flows-author-' +
      "scratch-build — the closer real match of the journey's two " +
      'entry beats, since it genuinely clears the canvas to data-node-' +
      "count=\"0\" (new-flow's own starter-seeded arrival keeps 3 pre-" +
      "wired nodes, further from the mockup's literal claim). Steps " +
      '3-10 (name, drop-the-Developer, enable-fanout, drop-Demo-Runner, ' +
      'wire-the-hand-off, gate, the composite hover, and save) are ALL ' +
      "genuinely driven by that SAME single beat's own drive — the " +
      "registry's one-real-ref-per-story rule forbids citing the same " +
      'beat id twice, so each is an excluded BeatRef pointing back at ' +
      "step 2's citation, naming the specific real action (step 5's " +
      'enable-fanout maps to the beat\'s fanout-capability GATE check — ' +
      'developer-ralph fanout-capable + enabled toggle vs demo-agent ' +
      'disabled — not an enable-click, which was tried this pass but ' +
      'reverted: reopening the node mini-panel mid-build broke the ' +
      'subsequent save). ONE genuinely NEW beat was added this pass: ' +
      'step 11 ("it joins the shelf") is the new flows-author-shelf-' +
      'return beat — a real return to the library home page asserting ' +
      'the just-authored flow renders as an ordinary [data-card-' +
      'type="flow"] card in the SAME flows section as forge-develop, ' +
      'linking to the same real /flows/<slug> route. Two honest content ' +
      "gaps, both narrated rather than faked: the mockup's specific " +
      'artifact label "demo HTML summary" has no backing real template ' +
      "(flow-artifact-catalog.ts's own header comment records a " +
      '`demo` id existed and was deleted, R2-05-F1, for having none) — ' +
      'the real pick exercised is "wi-branches" instead; and there is ' +
      'no separate "verdict" node kind to drop from the palette (gate ' +
      'is a modifier on the terminal agent node, not its own kind) — ' +
      'both pre-existing, already-documented UI limits, not new debt. ' +
      'Net: 2 of 11 mockup steps carry the literal string BeatRef ' +
      '(flows-author-scratch-build, flows-author-shelf-return); the ' +
      'other 9 are explicit ONE_REF_PER_STORY exclusions pointing at ' +
      'real, executed actions within those same two beats — never ' +
      'silently skipped. Filed as bd forge-9ir.',
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
    batch: 'D',
    port: {
      journey: 'flows-run',
      beats: [
        { excluded: "goto '#/projects/detail/gitpulse' (\"Runs start from the work: a project's roadmap tab.\") — mdtoc, not gitpulse (CLAUDE.md: gitpulse is a separate, independent repo this harness never checks out); the real project-detail + roadmap-tab surface (R4-13) lives on roadmap.mjs's own roadmap-tab beat, a different journey from this entry's 'flows-run'", decision: DECISION_RUN_FLOW_KICKOFF_CROSS_JOURNEY },
        { excluded: 'click [data-j=ptab-roadmap] ("The full-page dependency DAG — completed initiatives are diggable.") — real, and already ported: roadmap-tab\'s own [data-roadmap-canvas] (W6-RV-2; formerly [data-roadmap-dag]) + per-initiative [data-roadmap-node] cards, cross-journey', decision: DECISION_RUN_FLOW_KICKOFF_CROSS_JOURNEY },
        { excluded: 'hover [data-j=roadmap-dag] ("Every pill with a run opens its breakdown.") — the real DAG node\'s detail card is default-EXPANDED (R4-13), not a hover-to-reveal pill; its per-initiative [data-section="initiative-runs"] run links are roadmap-tab\'s own real surface, cross-journey', decision: DECISION_RUN_FLOW_KICKOFF_CROSS_JOURNEY },
        { excluded: 'click [data-j=rm-INIT-2] ("Open a COMPLETED one: its full run breakdown is one click away.") — real: roadmap-tab\'s own [data-section="initiative-runs"] [data-run-link] per completed attempt, cross-journey', decision: DECISION_RUN_FLOW_KICKOFF_CROSS_JOURNEY },
        { excluded: "goto '#/flows/monitor/forge-develop' (\"Now the next initiative. To the flow monitor —\") — not a real precondition: the real kickoff (roadmap-start-development) is reached directly from the SAME roadmap page, never via a flow-monitor pre-visit", decision: DECISION_RUN_FLOW_KICKOFF_CROSS_JOURNEY },
        { excluded: 'click [data-j=kickoff-btn] ("Runs start from an explicit kickoff, not a hidden trigger.") — real and genuinely explicit: [data-action="start-development"] on the roadmap DAG node, roadmap.mjs\'s own roadmap-start-development beat, cross-journey', decision: DECISION_RUN_FLOW_KICKOFF_CROSS_JOURNEY },
        { excluded: 'select [data-j=kick-project]=gitpulse ("Bind the run to a project…") — no separate selector exists: the DAG node IS the project binding (it\'s already on that project\'s roadmap page) — inline, not a kickoff-screen field', decision: DECISION_RUN_FLOW_KICKOFF_CROSS_JOURNEY },
        { excluded: 'select [data-j=kick-initiative]=INIT-3 ("…and ONE initiative from its roadmap — the unit of unattended work.") — no separate selector exists: the clicked DAG node IS the initiative binding', decision: DECISION_RUN_FLOW_KICKOFF_CROSS_JOURNEY },
        { excluded: 'click [data-j=mat-zone] ("Attach input materials — a perf trace, a design sketch — anything that aids the run.") — a genuine, honest gap: R6-04-F2\'s flow-kickoff materials-upload AC is unbuilt; only the agent-kickoff path (R6-04) has a materials-attach control', decision: DECISION_RUN_FLOW_KICKOFF_CROSS_JOURNEY },
        { excluded: 'click [data-j=start-run] ("Cost ceiling, fan-out cap, gates — limits are explicit. Start.") — real: the SAME [data-action="start-development"] click, now carrying an optional per-kickoff cost ceiling (forge-shc, PR #106) — cross-journey; "fan-out cap" beyond the cost ceiling is not a separately configurable field', decision: DECISION_RUN_FLOW_KICKOFF_CROSS_JOURNEY },
        'flows-run-pm-decompose',
        'flows-run-grind',
        'flows-run-demo-review',
        { excluded: 'patch flowRun:3 ("Adversarial review verifies every claim against the evidence.") — already demonstrated by the SAME beat cited at step 13 (flows-run-demo-review), which seeds BOTH the demo AND adversarial-review nodes and asserts both reach data-status="complete" on their own hexes', decision: DECISION_ONE_REF_PER_STORY },
        'flows-run-cost-rollup',
        'flows-run-approve-merge',
        'flows-run-detail-reachable',
        { excluded: 'click [data-j=run-node-1] ("Click any node for its FULL agent log…") — already demonstrated by the SAME beat cited at step 17 (flows-run-detail-reachable), which clicks the dev timeline row open to its own full RunLog', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'hover .nlog ("…thought process, tool use, artifacts — every line a structured event.") — already demonstrated by the SAME beat cited at step 17, which asserts the real think/tool/out log-kind classification on the expanded dev row', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'click [data-j=run-node-3] ("The reviewer\'s log too: refute-first, claim by claim.") — the real flow-run detail page\'s node click-through is proven only for the \'dev\' row; the adversarial-review node\'s own real seeded content is generic findings-count metadata, not a claim-by-claim refute-first transcript — that lives, honestly, on the dedicated run-agent-adversarial-review story instead', decision: DECISION_RUN_FLOW_ADVERSARIAL_LOG_GAP },
        { excluded: 'closing narrative line summarising the initiative-in / merged-PR-out arc — not a distinct UI action', decision: DECISION_ONE_REF_PER_STORY },
      ],
    },
    excluded: null,
    note:
      "Flow topology verified aligned by R4-B13; the mockup's extra " +
      '"Initiative intake" node is presentation of the existing queue ' +
      'claim, not a new flow node. R4-12/R4-13 (batch D, both merged — #102, ' +
      '#104) ship the story\'s opening steps (project detail contract panel + ' +
      'permanent cycle view; the roadmap tab\'s dependency DAG) and forge-shc ' +
      '(PR #106, batch D) resolves R6-04-F2\'s cost-ceiling half of the ' +
      'flow-kickoff AC — but ALL of that real surface lives in roadmap.mjs, a ' +
      'DIFFERENT journey from this entry\'s single \'flows-run\' citation ' +
      '(story-parity.mjs Rule 8/10 permits only one journey per entry), so ' +
      'steps 1-10 are honestly excluded rather than fabricated as ' +
      "flows-run beats — see DECISION_RUN_FLOW_KICKOFF_CROSS_JOURNEY. " +
      "This initiative (T3, journey-sync) ports the story's REMAINING real " +
      'arc (steps 11-21, the run\'s own progression from PM decompose through ' +
      'the verdict gate, approve+merge, and the standalone run-detail page\'s ' +
      'per-node log) predominantly onto the EXISTING scripts/journeys/' +
      'flows-run.mjs beats (29 beats, 143 checks) — no new flows-run beats ' +
      'were needed. Net: 6 of 21 mockup steps carry the literal string ' +
      'BeatRef (flows-run-pm-decompose, flows-run-grind, flows-run-demo-' +
      'review, flows-run-cost-rollup, flows-run-approve-merge, flows-run-' +
      'detail-reachable); the other 15 are explicit, decision-cited ' +
      'exclusions — 10 cross-journey (steps 1-10), 3 ONE_REF_PER_STORY ' +
      '(steps 14, 18, 19 — already demonstrated by a beat cited elsewhere in ' +
      'this same port), 1 a genuine content gap (step 20, the adversarial-' +
      'review node\'s own log carries no refute-first transcript — honestly ' +
      'covered by the dedicated run-agent-adversarial-review story instead), ' +
      'and 1 closing narrative (step 21). Filed as bd forge-tuy.',
  },
  {
    story: 'run-agent',
    batch: 'C',
    port: {
      journey: 'agents',
      beats: [
        { excluded: 'no dedicated /agents library route exists — forge-ui\'s agents shelf is embedded on the home page (/, [data-section="agents"]), not a standalone route; the real substitute entry point (a library card click) is what step 2 actually drives, ported separately below', decision: DECISION_R604_KICKOFF_BASELINE },
        'agents-kickoff-entry',
        { excluded: 'the real kickoff panel is already inline on the agent page (RunPanel.tsx) — there is no separate "open the kickoff form" click to back this step; Run dispatches directly, ported as step 7 below', decision: DECISION_R604_KICKOFF_BASELINE },
        'agents-kickoff-set-project',
        'agents-kickoff-attach-material',
        { excluded: 'the real materials-attach control is one <input type="file" multiple> — a single action attaches every file; there is no second, separate "add another material" click to back this step', decision: DECISION_R604_KICKOFF_BASELINE },
        'agents-kickoff-dispatch',
        'agents-kickoff-run-view',
        { excluded: 'the mockup\'s issue-triage agent (clustering issues, checking the project brain, producing initiative candidates) is fictional business content no agent in forge\'s shipped roster performs — this initiative ships the generic dispatch+view primitive only, not agent-specific business logic', decision: DECISION_R604_KICKOFF_BASELINE },
        { excluded: 'same as the prior step — fictional issue-triage business content, not a UI-shape gap', decision: DECISION_R604_KICKOFF_BASELINE },
        { excluded: 'the run view\'s typed-outputs section is honestly always empty — no data source exists yet for a generic dispatched agent\'s artifact outputs (R6-B5); "3 initiative candidates" is fictional issue-triage content this generic primitive does not fabricate', decision: DECISION_R604_KICKOFF_BASELINE },
        { excluded: 'fictional issue-triage business content (opening a candidate artifact) — no such typed output exists to open', decision: DECISION_R604_KICKOFF_BASELINE },
        { excluded: 'fictional issue-triage business content (hovering a candidate\'s detail) — no such typed output exists', decision: DECISION_R604_KICKOFF_BASELINE },
        { excluded: 'fictional issue-triage business content ("file to the roadmap") — no such action exists on the generic run view', decision: DECISION_R604_KICKOFF_BASELINE },
        { excluded: 'closing narrative line summarising the fictional issue-triage arc, not a distinct UI action', decision: DECISION_R604_KICKOFF_BASELINE },
      ],
    },
    excluded: null,
    note:
      'R6-04 (this initiative) shipped the kickoff panel + standalone run ' +
      'view and the new agents-kickoff-* beats port 5 of the mockup\'s 15 ' +
      'steps to real, executed beats. Step 2 (click the agent card) is ' +
      'agents-kickoff-entry — a real home-page card click, substituted ' +
      'honestly for the mockup\'s dedicated (non-existent) library route ' +
      '(step 1, excluded). Step 4 ("A run binds to a project, with explicit ' +
      'inputs and limits") is agents-kickoff-set-project — a real project ' +
      '<select> (GET /api/studio/projects) binds mdtoc, forge\'s one real ' +
      'project committed inside its own repo (the mockup\'s "gitpulse" is a ' +
      'genuinely separate, independent repo this harness never checks out) ' +
      'plus the real, now-enabled cost-ceiling input. Step 5 (attach a ' +
      'material) is agents-kickoff-attach-material — a real declared-kind ' +
      'file (mdtoc\'s own test/fixtures/release-notes.md) attached through ' +
      'the real upload control; step 6 (a second material) is excluded — ' +
      'the real control is one multi-file input, not two sequential clicks. ' +
      'Step 7 (Start) is agents-kickoff-dispatch — the actual click ' +
      'intercepted at the wire (no jsdom in this repo, so this is the ONLY ' +
      'proof the request carries project/ceiling/material), independently ' +
      'cross-checked against the staged file on disk; step 3 (a separate ' +
      '"Run it" open-the-panel click) is excluded — the real panel is ' +
      'already inline, no open step exists. Step 8 (the session log ' +
      'streams) is agents-kickoff-run-view — the real standalone run view ' +
      'renders the log, cost, and the material as a path+kind reference ' +
      '(never its content, checked in both the DOM and the raw API ' +
      'response); reached by navigating to a distinct route rather than ' +
      'staying inline, the one structural divergence from the mockup\'s ' +
      'single-screen framing. Steps 9-15 are all excluded for the same ' +
      'reason: the mockup\'s issue-triage agent and its typed candidate ' +
      'artifacts are fictional business content — no agent in the shipped ' +
      'roster performs issue-triage clustering, and the run view\'s typed- ' +
      'outputs section is honestly empty pending a real data source ' +
      '(R6-B5). Net: 5 of 15 mockup steps are genuinely backed by a real ' +
      'beat id; the other 10 are explicit, decision-cited exclusions, never ' +
      'silently skipped.',
  },
  {
    story: 'build-hook',
    batch: 'A',
    port: {
      journey: 'hooks',
      beats: [
        'hooks-library',
        { excluded: '\'sub-hooks\' sub-nav click — already demonstrated by the SAME beat cited at step 1 (hooks-library), which lands directly on the real /hooks library; the mockup\'s two-step library-home-then-sub-nav framing collapses to one real destination', decision: DECISION_ONE_REF_PER_STORY },
        'hooks-detail',
        'hooks-agentic-build',
        { excluded: '\'Describe the automation…\' — already demonstrated by the SAME beat cited at step 4 (hooks-agentic-build), which fills the real [data-field="authoring-launcher-prompt"] and drives the real POST /api/studio/authoring/start', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: '\'…it becomes a PreToolUse guard … HOST-AGNOSTIC\' — already demonstrated by the SAME beat cited at step 4, whose seeded draft is a real PreToolUse hook.yaml with no binding field of any kind (a generic, host-agnostic definition — FORBIDDEN_HOOK_BINDING_KEYS is enforced server-side on the LANDED hook.yaml at finalize)', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: '\'Where does it attach? Nowhere, from here\' — already demonstrated by the SAME beat cited at step 4, whose closing assertion is exactly this: the finalized hook lands with data-carried-by-count="0" and the literal "Unbound — bind it from an agent\'s builder" text', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'hfile-tab-1 click (\'A hook is a PACKAGE: hook.yaml plus the guard script it runs.\') — already demonstrated by the SAME beat cited at step 4, which clicks the first of the two real [data-file-tab] elements', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'hfile-tab-2 click (\'And the replay evidence rides along.\') — already demonstrated by the SAME beat cited at step 4, which clicks the second real [data-file-tab] and asserts the two paths are distinct', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'accept-btn click — already demonstrated by the SAME beat cited at step 4, whose real [data-action="finalize-authoring"] click runs the actual finalize route end to end', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: '\'On the shelf: event shown, "unbound — add from Agent Builder"\' — already demonstrated by the SAME beat cited at step 4, whose closing frame is the landed hook\'s own detail page, unbound, with a clean security scan', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'goto #/agents/builder/developer — already demonstrated by the SAME beat cited at step 13 (hooks-bind), which opens developer-ralph\'s real builder', decision: DECISION_ONE_REF_PER_STORY },
        'hooks-bind',
        { excluded: 'hover zone-hooks — already demonstrated by the SAME beat cited at step 13, which asserts the dedicated [data-accepts="hook"] zone is distinct from [data-accepts="guard"] before dropping into it', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'save-agent click — already demonstrated by the SAME beat cited at step 13, whose real [data-action="save-agent"] click persists composition.hooks on the real developer-ralph/SKILL.md and flips carried-by 0→1', decision: DECISION_ONE_REF_PER_STORY },
      ],
    },
    excluded: null,
    note:
      'R4-21 phase 2 (T3, journey-sync port, 2026-08-10/11) — this is the ' +
      'blocker the original note named precisely: "the remaining work is one ' +
      'OOTB authoring agent plus its runner." That agent (creation-agent) and ' +
      'its runner now exist for real: `POST /api/studio/authoring/start` opens ' +
      'a genuine session at /sessions/authoring/<sid> (SessionAuthoringPanel, ' +
      'the `file-package` artifact row flipped LIVE), and ' +
      '`POST /api/studio/authoring/finalize` runs the REAL copyStagingToLibrary ' +
      'commit turn end to end, installing the landed package exactly like the ' +
      'manual /hooks/new form does. Since the drafting SDK turn itself still ' +
      'cannot run under this harness\'s FORGE_ARCHITECT_NO_SPAWN=1 seam, the new ' +
      'hooks-agentic-build beat seeds staging/ with the VERBATIM bytes of a ' +
      'real, live, unsuppressed creation-agent turn the orchestrator captured ' +
      'for this port (scripts/journeys/fixtures/r4-21-live-capture/hook/, ' +
      'sha256-verified provenance in scripts/lib/journey-fixtures.mjs) — never ' +
      'hand-invented — then drives every step after that for real: the file-' +
      'package pane rendering both drafted files, the real finalize click ' +
      '(hook metadata parsed from the DRAFTED hook.yaml server-side, never a ' +
      'parallel form), and the landed hook\'s own detail page reading unbound, ' +
      'with a clean security scan, exactly like a manually authored one. ' +
      'Binding it into an agent afterward reuses the ALREADY-real hooks-bind ' +
      'beat in this same journey (a different, pre-existing hook fixture, ' +
      'proving the identical drag-into-[data-accepts="hook"]-then-save ' +
      'mechanism) — no new work needed there. Net: 15 of 15 mockup beats are ' +
      'now accounted for — 4 real, distinct beat refs (hooks-library, hooks-' +
      'detail, hooks-agentic-build, hooks-bind) plus 11 honest ' +
      'DECISION_ONE_REF_PER_STORY dup-exclusions for steps the SAME cited beat ' +
      'already demonstrates. The `file-package` SESSION_ARTIFACT_KINDS row is ' +
      'no longer reserved (flipped live, R4-21) and this port is the first ' +
      'beat-level proof it actually renders drafted content, not a stub.',
  },
  {
    story: 'build-skill',
    batch: 'A',
    port: {
      journey: 'skills',
      beats: [
        'skills-library',
        'skills-agentic-build',
        { excluded: '\'What should it do?\' — already demonstrated by the SAME beat cited at step 2 (skills-agentic-build), which fills the real [data-field="authoring-launcher-prompt"] and drives the real POST /api/studio/authoring/start', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: '\'It drafts a PACKAGE: SKILL.md + the scripts and templates it references.\' — already demonstrated by the SAME beat cited at step 2, whose real file-package artifact pane renders the drafted SKILL.md', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'file-tab-1 click (\'The collector script, in full\') — already demonstrated by the SAME beat cited at step 2, which asserts the real file-package pane renders the drafted content', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'file-tab-2 click (\'And the output template that keeps the operator voice.\') — the real, captured creation-agent turn this port seeds drafted exactly ONE file (SKILL.md, no scripts/templates directory) — there is no second tab to click, a genuine capture-shape fact, not a fixture choice', decision: DECISION_BUILD_SKILL_SINGLE_FILE_PACKAGE },
        { excluded: '\'File it — unbound, like every fresh definition.\' — not a distinct UI action; already demonstrated by the SAME beat cited at step 2, whose finalize click lands the package as an unapproved draft', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'accept-btn click — already demonstrated by the SAME beat cited at step 2, whose real [data-action="finalize-authoring"] click runs the actual finalize route end to end', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: '\'On the shelf, marked unbound.\' — already demonstrated by the SAME beat cited at step 2, whose closing assertions go further than the mockup depicts here: the landed draft, a real approve click, and palette-visibility checked against the REAL agent-builder catalog', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'goto #/agents/builder/reflector — ordinary agent-builder skill composition (drag/click a catalog skill chip into Skills + save), already real and journey-proved on a different journey/agent pairing', decision: DECISION_BUILD_SKILL_BINDING_CROSS_JOURNEY },
        { excluded: 'click release-notes into the catalog — same cross-journey mechanism as the prior step', decision: DECISION_BUILD_SKILL_BINDING_CROSS_JOURNEY },
        { excluded: 'hover zone-skills — same cross-journey mechanism', decision: DECISION_BUILD_SKILL_BINDING_CROSS_JOURNEY },
        { excluded: 'save-agent click — same cross-journey mechanism', decision: DECISION_BUILD_SKILL_BINDING_CROSS_JOURNEY },
      ],
    },
    excluded: null,
    note:
      'R4-21 phase 2 (T3, journey-sync port, 2026-08-10/11) — the blocker the ' +
      'original note named precisely ("a Creation Agent that drafts a SKILL ' +
      'PACKAGE and no such agent exists") is closed: creation-agent and its ' +
      'runner are real. `POST /api/studio/authoring/start` opens a genuine ' +
      'session at /sessions/authoring/<sid>, and `POST /api/studio/authoring/' +
      'finalize` runs the REAL copyStagingToLibrary commit turn, installing a ' +
      'DRAFT skill exactly like the /skills/new form does (never auto-' +
      'approved — D6). The drafting SDK turn itself still cannot run under ' +
      'this harness\'s FORGE_ARCHITECT_NO_SPAWN=1 seam, so the new skills-' +
      'agentic-build beat seeds staging/SKILL.md with the VERBATIM bytes of a ' +
      'real, live, unsuppressed creation-agent turn the orchestrator captured ' +
      'for this port (scripts/journeys/fixtures/r4-21-live-capture/skill/, ' +
      'sha256-verified provenance in scripts/lib/journey-fixtures.mjs) — never ' +
      'hand-invented — then drives every step after that for real: the file-' +
      'package pane, the finalize click, the landed draft on its own detail ' +
      'page, a real approve click, and a palette-visibility check against the ' +
      'REAL agent-builder catalog (not merely a page re-render — the exact bar ' +
      'the T3 brief set). Net: 13 of 13 mockup beats are now accounted for — 2 ' +
      'real, distinct beat refs (skills-library, skills-agentic-build) plus 6 ' +
      'DECISION_ONE_REF_PER_STORY dup-exclusions for steps the same cited beat ' +
      'already demonstrates, 1 genuine capture-shape gap (the real turn drafted ' +
      'one file, not two), and 4 cross-journey exclusions for ordinary skill-' +
      'composition binding that R2-09 already shipped and journey-proved ' +
      'elsewhere. The `file-package` SESSION_ARTIFACT_KINDS row is no longer ' +
      'reserved (flipped live, R4-21) and this port is the first beat-level ' +
      'proof it actually renders drafted content end to end, not a stub.',
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
    port: {
      journey: 'knowledge',
      beats: [
        'knowledge-graph',
        { excluded: 'create-brain-btn — the real /knowledge/new form has no separate "create a brain" click reachable from /knowledge itself; the real kickoff is the library\'s own [data-action="new-kb"] CTA, ported at knowledge-create-kb\'s own entry', decision: DECISION_R1_06_SINGLE_FORM },
        { excluded: 'scope-project — the real form has one [data-field="kb-binding-kind"] select, not a separate "scope" click; filled as part of the single submission knowledge-create-kb drives', decision: DECISION_R1_06_SINGLE_FORM },
        { excluded: 'select kb-target=trafficgame — the real form\'s [data-field="kb-binding-ref"] select is filled with mdtoc (forge\'s own creds-free reference project — trafficgame is not discovered in this checkout), as part of the same single submission', decision: DECISION_R1_06_SINGLE_FORM },
        'knowledge-create-kb',
        { excluded: 'sessionTurns:2 ("seeded from the project\'s own history: cycles, PR threads, operator notes") — no creation agent drafts real content yet; only the hand-off (real sessionId, real project anchor) is built', decision: DECISION_R4_19 },
        { excluded: 'sessionTurns:3 ("8 themes, an index hub, links into develop-cycle — lint-clean from day one") — same gap, R4-19-F1 owns the seeding turns', decision: DECISION_R4_19 },
        { excluded: 'accept-btn — the real session-shell has no accept affordance for a project-brain session sitting at phase:"briefing"; there is nothing yet to accept', decision: DECISION_R4_19 },
        { excluded: 'nav-knowledge ("projects/trafficgame joins the shelf") — already demonstrated: knowledge-create-kb (cited above) confirms the new KB appears in #kb-select immediately on create, no accept needed', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'brain-trafficgame ("a living graph from the first minute") — already demonstrated: knowledge-create-kb\'s own closing frame is the new scratch KB\'s (near-empty) graph rendering', decision: DECISION_ONE_REF_PER_STORY },
      ],
    },
    excluded: null,
    note:
      'R1-06 WI-4 (journey-sync) ports 2 of 10 mockup steps to real beats and ' +
      'excludes 8, all with a decision citation, per T1 ruling 2026-08-09. ' +
      'Step 1 maps onto the existing knowledge-graph beat (the real /knowledge ' +
      'page — the mockup\'s "three-scope brain model" framing substituted ' +
      'honestly by the real KB-backend seam + #kb-select, which genuinely ' +
      'lists KBs across binding kinds). Step 5 ("continue into the creation ' +
      'session") maps onto knowledge-create-kb, which R1-06 WI-2 extended with ' +
      'a REAL assertion the mockup does not have an analog for: capturing the ' +
      'POST /api/studio/kbs response\'s sessionId and navigating to ' +
      '/sessions/project-brain/<sid>?project=mdtoc to confirm it genuinely ' +
      'reaches data-page-ready="true" — the T1-ruled distinguishing fact for ' +
      'this story ("its seeding session IS viewable, real project anchor"). ' +
      'Steps 2-4 and 9-10 are excluded only because the real product collapses ' +
      'the mockup\'s multi-click wizard into ONE form + ONE beat citation (the ' +
      'underlying capability IS real, just not independently citable per the ' +
      'registry\'s one-ref-per-story rule — see each row\'s own reason). Steps ' +
      '6-8 are the genuine gap: the multi-turn seeding CONTENT (drafted themes, ' +
      'an accept step) has no agent behind it yet — R4-19, never faked here.',
  },
  {
    story: 'create-kb-cycle',
    batch: 'D',
    port: {
      journey: 'knowledge',
      beats: [
        'knowledge-graph',
        { excluded: 'create-brain-btn — same single-kickoff gap as create-kb-project: the real CTA is the library\'s [data-action="new-kb"], ported at knowledge-create-kb-band-scope\'s own entry', decision: DECISION_R1_06_SINGLE_FORM },
        { excluded: 'scope-cycle — the real form has one [data-field="kb-binding-kind"] select (flow, not a fourth "cycle" kind — R1-06-F1 chose a band QUALIFIER on the existing flow binding); filled as part of the single submission', decision: DECISION_R1_06_SINGLE_FORM },
        'knowledge-create-kb-band-scope',
        'knowledge-create-kb-band-scope-seed',
        { excluded: 'sessionTurns:2 ("seeded from 41 runs of review findings — clusters become themes") — already demonstrated: knowledge-create-kb-band-scope-seed\'s own emulated theme authoring is grounded in forge\'s real review-band findings (declared-data-fails-open, suppression-env-fakes-the-pass) — the real evidence shape is archived cycles/review-band findings (R4-19 WI-1), never "41 runs" or PR threads, which the mockup\'s specific number was never scripted as real here', decision: DECISION_ONE_REF_PER_STORY },
        'knowledge-create-kb-band-scope-commit',
        { excluded: 'accept-btn — already demonstrated: knowledge-create-kb-band-scope-commit\'s own approve-brain click + return-to-project assertion (W6-SW-3 sweep C6#1 rename of bind-and-return), cited at the prior step', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'nav-knowledge ("a Brain-2-scoped base, bound to the review band") — already demonstrated: knowledge-create-kb-band-scope confirms kb.yaml\'s binding carries "band: review-band" the moment create is submitted', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'brain-review-insights ("same graph, same reader — different scope") — already demonstrated: knowledge-create-kb-band-scope-commit\'s own closing frame is the committed band-scoped KB\'s real graph (index hub + linked themes)', decision: DECISION_ONE_REF_PER_STORY },
      ],
    },
    excluded: null,
    note:
      'R4-19 F1 (journey-sync T3, 2026-08-10) flips this story from 2/10 real ' +
      'to 4/10 real (6 excluded, all decision-cited) — WI-1/WI-2 close the ' +
      'exact gap the prior R1-06 WI-4 pass (2026-08-09) left open. Step 1 ' +
      'reuses knowledge-graph. Step 4 ("the review band of forge-develop") ' +
      'is unchanged from the prior pass: knowledge-create-kb-band-scope\'s ' +
      'real [data-field="kb-binding-band"] select. Steps 5 ("continue into ' +
      'the creation session") and 6 ("seeded from 41 runs...") now map onto ' +
      'the NEW knowledge-create-kb-band-scope-seed beat: R4-19 WI-2 made the ' +
      'dot-anchored session genuinely reachable (proven by loading it, not ' +
      'merely asserted) and drives a REAL briefing POST that flips phase to ' +
      'analyzing; the analyze step\'s own theme-authoring judgment stays an ' +
      'honestly-narrated emulation (the real R4-19 agent never runs under ' +
      'this harness\'s FORGE_ARCHITECT_NO_SPAWN=1), grounded in forge\'s own ' +
      'already-committed review-band findings rather than invented content. ' +
      'Step 7 ("declared-data-fails-open leads with 9 occurrences") maps onto ' +
      'the NEW knowledge-create-kb-band-scope-commit beat: approving is a ' +
      'real POST (phase -> committing), and the commit itself — R1-06\'s ' +
      'deterministic runCommitStep, which makes no SDK call — is invoked ' +
      'directly in-process (bypassing only the detached spawn this harness ' +
      'suppresses), landing a genuine brain write: themes physically commit ' +
      'into brain/journey-scratch-kb-review-band/, the KB\'s own graph shows ' +
      'a real INDEX hub with real links to them, and forge brain lint stays ' +
      '9/9 clean with the new KB present. Step 8 (accept) and steps 9-10 ' +
      '(nav-knowledge/brain-review-insights) are the registry\'s one-ref-per-' +
      'story rule at work, not gaps — each is already demonstrated by a beat ' +
      'cited above. See DECISION_R4_19_WI1_WI2 for the full as-built/emulated ' +
      'boundary; kb-maintain\'s F2 maintenance-agent narration gap is a ' +
      'SEPARATE PR and stays on DECISION_R4_19 unchanged.',
  },
  {
    story: 'kb-maintain',
    batch: 'D',
    port: {
      journey: 'knowledge',
      beats: [
        'knowledge-graph',
        { excluded: 'brain-develop-cycle ("develop-cycle carries a skew warning") — already demonstrated: knowledge-kb-maintain-session (cited below) opens its own seeded, flagged scratch KB from its library card', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: '"the graph is ALIVE: clusters form..." — the real animated, force-directed graph is already asserted by knowledge-graph (data-node-count/data-edge-count/layered nodes), cited at step 1', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'drag gnode-3 ("its neighbours follow, and the graph re-settles") — draggable nodes + tension presets are R6-08-F1\'s own mockup-round-5 scope, not yet built ("largely not new machinery" pending R6-08)', decision: DECISION_R6_08_GRAPH_INTERACTIONS },
        { excluded: 'click gnode-4 to read it — node-click-opens-article is already demonstrated by knowledge-graph\'s own theme-node-click assertion, cited at step 1', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'kbtab-activity ("Ingest activity: every reflector pass on record") — forge has no Ingest-activity panel; ingest is reflection-only by explicit operator decision, no UI route or action triggers it', decision: DECISION_NO_INGEST_AFFORDANCE },
        { excluded: 'kbtab-health ("Health: 8/9 — the distribution check is failing") — there is no tabbed Health view to click into; KB HEALTH (real data-lint-warnings/data-lint-errors) renders inline on the KB page, read by knowledge-kb-maintain-session before it clicks Consolidate', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'op-lint ("run lint confirms it") — already demonstrated by the SAME real lint math knowledge-lint-index exercises (kb-lint result badge) and by knowledge-kb-maintain-session\'s own pre-Consolidate KB HEALTH read', decision: DECISION_ONE_REF_PER_STORY },
        'knowledge-kb-maintain-session',
        { excluded: 'sessionTurns:1/2 ("it found the duplicates and dangling edges itself — you choose the primaries") — Consolidate\'s real shipped shape (R1-06-F3) is a direct dispatch-and-poll against real lint findings, not a chat session narrating its own discoveries; that narration has no agent behind it (R4-19-F2, unbuilt)', decision: DECISION_R4_19 },
        { excluded: 'sessionTurns:3 ("merged, relinked, tagged for multi-project evidence") — same gap: multi-project tagging/relinking judgment calls are the maintenance AGENT\'s job (R4-19-F2), not the deterministic in-process fix path this beat actually drives', decision: DECISION_R4_19 },
        { excluded: 'sessionTurns:4 + kbFixed ("lint re-run: 9/9 green") — the real beat proves a genuine reduction (data-lint-warnings drops), never a fabricated 9/9; going all the way to 0 depends on the agent-tier residual R4-19-F2 would clear', decision: DECISION_R4_19 },
        { excluded: 'accept-btn — the real Consolidate op is applied directly (no staged proposal to accept); nothing sits pending review the way a session\'s output would', decision: DECISION_R4_19 },
        { excluded: 'nav-knowledge ("back on the shelf") — already demonstrated: knowledge-kb-maintain-session enters from the library\'s own KB card in the first place', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'brain-develop-cycle again ("develop-cycle is healthy again, with the cleanup on record") — already demonstrated: knowledge-kb-maintain-session re-reads KB HEALTH on the SAME open page and confirms data-lint-warnings genuinely dropped, without leaving and re-entering', decision: DECISION_ONE_REF_PER_STORY },
      ],
    },
    excluded: null,
    note:
      'R1-06 WI-4 (journey-sync) ports 2 of 15 mockup steps and excludes 13, ' +
      'per T1 ruling 2026-08-09 (Q5 + Q6). Step 1 reuses knowledge-graph (the ' +
      'real animated force-graph + node-click-to-article — genuinely covers ' +
      'steps 3 and 5 too, cited once per the registry\'s uniqueness rule). ' +
      'Step 9 ("Correct issue hands it to the maintenance agent" — the ' +
      'mockup\'s own op-correct click) maps onto the NEW knowledge-kb-' +
      'maintain-session beat: a scratch, per-project-shaped brain ' +
      '(brain/projects/journey-scratch-kb-maintain/) seeded with exactly one ' +
      'REAL, deterministically-fixable lint finding (a theme genuinely absent ' +
      'from its own category index — the "not listed in project category ' +
      'index" shape cli/bridge-studio-kbs.ts\'s applyDeterministicConsolidate' +
      'Fixes claims), so [data-action="kb-maintain-session"] drives the real ' +
      'op=consolidate pipeline to a genuine [data-consolidate-state]="cleared" ' +
      'terminal (the deterministic in-process fix that clears the seeded ' +
      'checkProjectBrainIndexes finding 1->0 is proven by cli/bridge-studio-kbs.ts\'s ' +
      'dry-bridge consolidate unit pin) — no agent spawn needed (CI-safe), never a ' +
      'static "session started" message. The beat also renders [data-component="kb-health"] ' +
      'and reads data-lint-warnings for the demo caption, but does NOT gate on the ' +
      'count DELTA: the count-through-the-page kbDetail.health path is timing-fragile ' +
      '(observed 0-before/1-after, distinct from the already-correct buildKbHealth scoping) ' +
      'and is tracked as its own filed defect (two-reopen stop, 2026-08-09) — the acceptance ' +
      'is the real "cleared" terminal above, not the flaky UI count math. Two step classes ' +
      'are excluded: "Ingest activity" has no real surface anywhere in the product ' +
      '(decision 3 — ingest stays reflection-only), and the mockup\'s multi-turn "maintenance ' +
      'agent" narrating its own findings (duplicates, relinking, multi-project ' +
      'tagging, a 9/9 accept) is R4-19-F2, unbuilt — the real Consolidate ' +
      'button is a direct dispatch-and-poll, not a chat session, never faked here.',
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
    batch: 'D',
    port: {
      journey: 'agents',
      beats: [
        'agents-run-developer-entry',
        { excluded: 'hover [data-j=agent-triggers] ("Its triggers: auto inside the flow, or manual on a single work item.") — already demonstrated by the SAME beat cited at step 1 (agents-run-developer-entry), which asserts the real "Used in Flows" chip (forge-develop\'s dev node)', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'click [data-j=run-agent-btn] ("Run it.") — the real Run-click wire mechanism is already proven for real by a different story\'s beats (agents-kickoff-dispatch); re-driving it here would only ever reproduce the same shallow suppressed skeleton, never the rich TDD content these steps depict — this port seeds the run directly instead', decision: DECISION_RUN_AGENT_DEV_NO_LIVE_DISPATCH },
        { excluded: 'click [data-j=mat-zone] ("Bound to gitpulse, with the work-item spec attached as input material.") — developer-ralph\'s real shipped SKILL.md declares no materials: kinds (no roster agent does yet); also mdtoc, not gitpulse (CLAUDE.md — gitpulse is a separate repo this harness never checks out)', decision: DECISION_RUN_AGENT_DEV_MATERIALS_GAP },
        { excluded: 'already demonstrated by the SAME beat cited at step 7 (agents-run-developer-fixture), which asserts the real seeded $0.60 ceiling-provenance (data-ceiling-set="true" data-ceiling-usd="0.6")', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'click [data-j=start-run] ("Start.") — same no-live-dispatch substitution as step 3', decision: DECISION_RUN_AGENT_DEV_NO_LIVE_DISPATCH },
        'agents-run-developer-fixture',
        { excluded: 'already demonstrated by the SAME beat cited at step 7 (the real gate.pass / tool_use "loop tightens" content); the "security-review hook rides along" half of this step is checked and refuted for real at step 1\'s beat (agents-run-developer-entry) — developer-ralph carries GUARDS, not a bound hook, by default', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'patch agentRun:5 ("Output: a pushed branch + the demo note the Demo Runner will pick up.") — typed outputs stay honestly 0 on the standalone run view; no wired data source exists for a generic dispatched agent\'s artifacts yet', decision: DECISION_RUN_AGENT_TYPED_OUTPUTS_GAP },
        { excluded: 'closing narrative line summarising the ralph-loop-with-or-without-a-flow arc — not a distinct UI action', decision: DECISION_ONE_REF_PER_STORY },
      ],
    },
    excluded: null,
    note:
      'Agent itself verified aligned by R4-B13 (ralph loop, per-WI ' +
      'fanout, write-first continuity). The mockup\'s route ' +
      '(#/agents/builder/developer) names a fictional slug — the real ' +
      'roster agent is developer-ralph (studio/flows/forge-develop/' +
      "flow.yaml's own {id: dev, agent: developer-ralph}), reached at its " +
      "real /agents/developer-ralph page. This initiative (T3, journey-" +
      "sync) ports the story with TWO new beats, agents-run-developer-" +
      'entry (the real generic run surface + Used-in-Flows + a LIVE check ' +
      'that developer-ralph carries no bound security-review hook by ' +
      'default, only guards — ADR-039\'s vocabulary split) and agents-run-' +
      'developer-fixture (a hand-seeded _logs/<runId> fixture, corpus-' +
      'grounded on the SAME real gitpulse-sourced WI-1 numbers flows-' +
      'run.mjs already seeds for the mdtoc --write cycle, since no real ' +
      "standalone _agent-* run exists anywhere on this machine — same " +
      'corpus-provenance discipline as this file\'s pre-existing ' +
      'R6_06_STANDALONE_RUN_ID fixture). Net: 2 of 10 mockup steps carry ' +
      'the literal string BeatRef (steps 1, 7); the other 8 are explicit, ' +
      'decision-cited exclusions — 4 ONE_REF_PER_STORY (steps 2, 5, 8, 10, ' +
      'already demonstrated by a beat cited elsewhere in this port), 2 a ' +
      'genuine no-live-dispatch substitution (steps 3, 6 — a real click ' +
      'through this harness\'s no-spawn seam would only reproduce the ' +
      'already-proven shallow skeleton, never this rich content), 1 a real ' +
      'materials-declaration gap (step 4), and 1 a real typed-outputs gap ' +
      '(step 9). Filed as bd forge-11w.',
  },
  {
    story: 'run-agent-adversarial-review',
    batch: 'D',
    port: {
      journey: 'agents',
      beats: [
        'agents-run-adversarial-review-entry',
        { excluded: 'hover [data-j=run-trigger] ("The trigger is on the run header: auto, on Developer completion.") — [data-section="run-trigger"] attaches structurally now (forge-pet, PR #106) but ONLY when the server body carries a `trigger` field, and no standalone-dispatch path writes one yet (client-side plumbing only, per that PR\'s own commit message) — genuinely absent on this real run, proven by the SAME beat cited at step 1', decision: DECISION_RUN_TRIGGER_NO_SERVER_PRODUCER },
        'agents-run-adversarial-review-findings',
        { excluded: 'patch agentRun:3 ("Year-boundary fixture against the ISO-week claim. Cold/warm timing against memoization.") — fictional specific business content tied to a scenario no roster agent\'s real, shipped work touches; adversarial-review\'s real subject in this harness is mdtoc\'s --write TOC-injection story', decision: DECISION_RUN_AGENT_ADV_FICTIONAL_SCENARIO },
        { excluded: 'already demonstrated by the SAME beat cited at step 3 (agents-run-adversarial-review-findings), which asserts the real zero-findings outcome (total 0, every severity bucket 0)', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'closing narrative line summarising the refute-first arc — not a distinct UI action', decision: DECISION_ONE_REF_PER_STORY },
      ],
    },
    excluded: null,
    note:
      'Agent itself verified aligned by R4-B13 (refute-first findings ' +
      'feeding the verdict gate). The blocker this story was filed against ' +
      '(the standalone run view attaching no trigger provenance) is ' +
      'RESOLVED by debt-T forge-pet (PR #106) — but checked against the ' +
      'real code, not assumed: forge-pet attached the RENDERING capability ' +
      '([data-section="run-trigger"] structurally exists) client-side only ' +
      '(T1 ruling, that commit\'s own message) — no server-side path writes ' +
      "a standalone run's trigger field yet, so the section is genuinely " +
      'absent on every real (or seeded) run today, not populated as the ' +
      "mockup depicts. This initiative (T3, journey-sync) ports the story " +
      'with TWO new beats, agents-run-adversarial-review-entry (real ' +
      'navigation to a hand-seeded standalone run + a live proof the ' +
      'trigger section is honestly absent) and agents-run-adversarial-' +
      'review-findings (the real review.input.assembled / review.findings.' +
      'authored message vocabulary flows-run.mjs\'s own adversarialReviewEvent' +
      '()/writeReviewFindings() already use, seeded to a genuine zero-' +
      'findings clean-pass outcome — since no real _agent-* run exists on ' +
      'this machine, same corpus-provenance discipline as this file\'s pre-' +
      'existing R6_06_STANDALONE_RUN_ID fixture). Net: 2 of 6 mockup steps ' +
      'carry the literal string BeatRef (steps 1, 3); the other 4 are ' +
      'explicit, decision-cited exclusions — the trigger-provenance gap ' +
      '(step 2, the resolved-but-still-honestly-absent fact above), a ' +
      'fictional-scenario exclusion (step 4, ISO-week/memoization content no ' +
      'roster agent\'s real work touches), and 2 ONE_REF_PER_STORY (steps 5, ' +
      '6). Cheapest of the four agent ports, mirroring run-agent-reflector\'s ' +
      'own 2-of-6 precedent. Filed as bd forge-928.',
  },
  {
    story: 'run-agent-demo-runner',
    batch: 'D',
    port: {
      journey: 'demo-showcase',
      beats: [
        { excluded: 'goto #/agents/builder/demo-runner ("The Demo Runner can ride a PROJECT hook...") — the agent-builder page is a different surface from the showcase; R4-14 ships the showcase PAGE, not agent-builder navigation', decision: DECISION_R4_14_SHOWCASE_NOT_AGENT_RUN },
        { excluded: 'hover [data-j=agent-triggers] ("Hook triggers are scoped per project...") — the agent-builder triggers panel is out of scope for R4-14; project-hook trigger SCOPING is R2-08 territory', decision: DECISION_R4_14_SHOWCASE_NOT_AGENT_RUN },
        { excluded: 'goto #/agents/run/demo-runner, patch agentRun:1 ("PR #61 just merged on betterado — the hook fired.") — a specific fabricated PR/project pairing, never scripted as real; the agent-run view is also a different surface from the showcase page', decision: DECISION_R4_14_SHOWCASE_NOT_AGENT_RUN },
        { excluded: 'patch agentRun:3 ("Live ADO GETs, portal captures...") — an agent-run execution transcript (R4-B13\'s territory, already verified aligned), not anything the showcase page itself renders', decision: DECISION_R4_14_SHOWCASE_NOT_AGENT_RUN },
        { excluded: 'patch agentRun:5 ("Output: refreshed demo HTML summary + screenshot set.") — same agent-run-view surface as the prior two steps, not the showcase page', decision: DECISION_R4_14_SHOWCASE_NOT_AGENT_RUN },
        'demo-showcase-refresh',
      ],
    },
    excluded: null,
    note:
      'Agent itself verified aligned by R4-B13 (project-demo-skill ' +
      'execution with actual-resource evidence; the project-hook trigger ' +
      'delta is R2-08). R4-14 (batch D, journey-sync T3) ships the ' +
      'showcase-page half of this story\'s closing claim: ' +
      'demo-showcase-refresh seeds a SECOND, newer merged cycle for the ' +
      'same project and reloads the showcase — the evidence gallery flips ' +
      'to the new cycle\'s real demo.json with zero code changes, exactly ' +
      'step 6\'s "the showcase never goes stale — merges refresh it ' +
      'automatically". Steps 1-5 (agent-builder navigation, the ' +
      'hook-trigger scoping hover, and the agentRun-patched agent-run-view ' +
      'progression — including the fabricated "PR #61 ... betterado" ' +
      'example) are a DIFFERENT surface this initiative does not ship — ' +
      'excluded, not silently skipped. Filed as a batch-D WI (bd forge-gu8).',
  },
  {
    story: 'run-agent-reflector',
    batch: 'C',
    port: {
      journey: 'agents',
      beats: [
        'agents-kickoff-standing-triggers',
        { excluded: '"the reflector reads the whole run" is live-run behavior a specific executed turn performs — no static UI surface represents it, and no journey here spawns a real reflector SDK turn to read it back from', decision: DECISION_REFLECTOR_NO_LIVE_RUN },
        'agents-run-reflector-detail',
        { excluded: '"two durable lessons — evidence-backed" is a specific run\'s OWN output content (a count + a qualitative judgment) — genuinely unavailable without a real reflector SDK turn, honestly excluded rather than fabricated', decision: DECISION_REFLECTOR_NO_LIVE_RUN },
        { excluded: 'already demonstrated by the SAME beat cited at step 3 (agents-run-reflector-detail) — that beat asserts the real brain-ingest skill chip (the declared capability to write themes) AND runs the real `forge brain lint` (the genuine 9-check suite), proving "themes linked, index updated, lint 9/9" with an actual tool run, not narrated content', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'closing narrative line summarising the auto-triggered, self-improving loop — not a distinct UI action beyond the real standing trigger already cited at step 1', decision: DECISION_REFLECTOR_NO_LIVE_RUN },
      ],
    },
    excluded: null,
    note:
      'Agent itself verified aligned by R4-B13 (outside-the-cycle ' +
      'reflection into the brains on the merged trigger; the brain-tune ' +
      "flow packaging delta is R4-20). MEASURED at batch-C exit (2026-08-08): " +
      'batch C did NOT port this story — 0 of 6 beats. Batch-D journey-sync ' +
      '(T3, forge-1ge) pays off that debt: step 1 ("auto-triggered when a ' +
      'forge-develop run completes") is the pre-existing agents-kickoff-' +
      'standing-triggers (R6-01 WI-4) — the mockup\'s own route ' +
      '(`#/agents/run/reflector`) does not exist (a standalone run view ' +
      'needs a concrete run id, `/agents/<id>/run/<runId>`), so the real ' +
      'substitute is the SAME /agents/reflector page, which already reads ' +
      'the real `{on: merged, target: {kind: agent, ref: reflector}}` ' +
      'standing trigger. Step 3 ("queries all three brain scopes before ' +
      'writing anything") is the new agents-run-reflector-detail beat — no ' +
      'UI surface renders a live per-scope query trace (that is runtime SDK ' +
      'behavior), so the real, honest substitute is the SAME page\'s ' +
      'DECLARED composition: the Knowledge Access card reads "Mandatory" ' +
      '(skills/reflector/SKILL.md `brainAccess: mandatory`) and the Skills ' +
      'zone carries the real brain-query/brain-ingest chips. Step 5 ' +
      '("themes linked, index updated, lint 9/9") is ONE_REF_PER_STORY back ' +
      'onto that SAME beat, which also runs a genuine `forge brain lint` — ' +
      'brain/ actually passes its real 9-check suite right now, proven live ' +
      'rather than claimed. Steps 2, 4, and 6 (reading the merged run, the ' +
      'specific "two durable lessons" judgment, and the closing narrative) ' +
      'are excluded under DECISION_REFLECTOR_NO_LIVE_RUN: a real, ' +
      'individual reflector SDK turn\'s own narrative content is not ' +
      'something any UI surface renders, and this harness spawns no real ' +
      'agent turns (FORGE_ARCHITECT_NO_SPAWN=1) — honestly excluded rather ' +
      'than emulated as if real. Net: 2 of 6 mockup steps carry the ' +
      'literal string BeatRef (agents-kickoff-standing-triggers, the ' +
      'pre-existing R6-01 WI-4 beat; agents-run-reflector-detail, new this ' +
      'pass); the other 4 are explicit, decision-cited exclusions. Cheapest ' +
      'of the four agent ports; covers the on-complete-chain framing ' +
      '(merged half) plus the agent\'s real declared brain-access ' +
      'composition. Filed as a batch-D WI (bd forge-1ge).',
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
    note:
      'R4-16 (the initiative that owns this story) assessed the flip against the ' +
      'real DOM and deliberately did NOT take it. Steps 3-5 — the middle of the ' +
      'story and the part R4-16 owns — are now REAL and beat-driven on the ' +
      'demo-builder journey: step 3 "generations iterate on your feedback" ' +
      'was REAL on the old inline panel (demo-builder-generations beat) but ' +
      'W6-B10 moved the demo builder onto the generic session surface, whose ' +
      'verdict vocabulary is approve/reject only — the feedback→regenerate ' +
      'loop is currently ABSENT and tracked as bead forge-4ei (revise verdict); ' +
      'step 4 "Generation N. Ship it." ' +
      '(the numbered selector, with the selection proven to survive a poll ' +
      'tick), step 5 "the demo skill lands in the project" ' +
      '(demo-builder-lock: [data-action="finalize-generation"] POSTs the chosen ' +
      'generation and the real bridge persists selectedGeneration, which the ' +
      'lock step enforces by restoring that generation\'s sample AND generator ' +
      'skill). What blocks the flip is STRUCTURAL, and it is not R4-16\'s to ' +
      'resolve. Steps 1-2 enter from an agent-builder detail page for ' +
      'demo-builder (mockup: #/agents/builder/demo-builder, then Run -> ' +
      'session). No such page exists, deliberately: skills/demo-builder/SKILL.md ' +
      'carries `library: false`, so isStudioAgent (orchestrator/studio/' +
      'registry.ts:117 — `runtime` in d && d.library !== false) excludes it from ' +
      'the composable Studio roster exactly as it excludes brain-fix and the ' +
      'other operator-dispatched setup helpers. Making those two steps real ' +
      'means deciding that demo-builder joins the roster — a roster decision ' +
      'with its own consequences (it becomes flow-composable), not a rendering ' +
      'gap R4-16 can close. Additionally port.journey is single-valued ' +
      '(scripts/lib/story-parity.mjs), so even once such a page existed, steps ' +
      '1-2 would live on the `agents` journey while 3-5 need `demo-builder` — ' +
      'the same single-journey obstacle recorded on run-agent-architect. ' +
      'Padding the count with unrelated beats would misrepresent the state. ' +
      'One further honesty note: mockup step 4 says "clips + HTML summary"; ' +
      'forge\'s demo-builder authors an HTML demo (DEMO.html + fragments) and ' +
      'has no clip capture, so that half of the caption describes the mockup, ' +
      'not the product.',
  },
  {
    story: 'run-agent-onboarding',
    batch: 'B',
    port: null,
    excluded: null,
    note:
      'R4-17 ASSESSED this story (2026-08-06) and does not flip it. Beat 2 ' +
      '("Run → session") is now REAL in substance — the onboarding dispatch ' +
      'opens a staged session on the R2-10 shell (POST /api/studio/onboarding/' +
      'start, beat stand-up-onboard/su-onboard-session) — but from the PROJECT ' +
      "page's [data-action=\"run-onboarding-agent\"], not from the agent " +
      "builder's generic RunPanel the mockup's beat 1 navigates to; wiring the " +
      'RunPanel to open a session for one agent would special-case the generic ' +
      'dispatch host, which R2-01-F3 exists to keep generic. Beats 3-5 each ' +
      'advance a multi-turn interview and switch the artifact stage from the ' +
      'transcript; the shipped agent asks no questions ' +
      '(skills/onboarding-agent/SKILL.md:9) so the transcript is honestly one ' +
      'turn, and no stage-switcher control exists on the session page yet — ' +
      'the artifact-RENDERING logic is unit-tested end to end ' +
      '(sessionArtifactView → contractBuildoutView, both in forge-ui/lib/' +
      'session-artifact-view.ts, covered by lib/session-artifact-view.test.ts), ' +
      'so the artifact is stage-aware the moment a switcher lands — but the ' +
      'COMPONENT that calls it, SessionArtifactPane.tsx, has no test file at ' +
      'all, and forge-ui/vitest.config.ts only includes lib/**/*.test.ts, so a ' +
      'component test would not even run today (pin 4, round-2 review, item ' +
      '4 correction, 2026-08-06). The SessionArtifactPane → sessionArtifactView ' +
      'delegation WAS traced by hand against all four pre-existing live ' +
      'artifact kinds with no behaviour change found — reviewed, not tested. ' +
      'Beat 6 ("Accept") has no affordance: the session shell is read-only. Not ' +
      'recorded as {excluded} — none of these is a decision to never build.',
  },
  {
    story: 'run-agent-brain-creation',
    batch: 'D',
    port: {
      journey: 'knowledge',
      beats: [
        { excluded: 'goto #/agents/builder/brain-creation — the real seeding agent has no agent-builder library entry (it is not `library: true` studio-agent-shaped); its kickoff is the /knowledge/new create hand-off, ported at knowledge-create-kb-band-scope\'s own entry', decision: DECISION_R1_06_SINGLE_FORM },
        'knowledge-create-kb-band-scope-seed',
        { excluded: 'sessionTurns:2 ("3 cycles of history + 14 PR-thread decisions become the seed") — already demonstrated: knowledge-create-kb-band-scope-seed\'s own emulated theme authoring, cited at the prior step; the real evidence shape (R4-19 WI-1) is archived cycles + logged review-band/adversarial-review findings, never "PR-thread decisions" — the mockup\'s specific framing was never scripted as real here', decision: DECISION_ONE_REF_PER_STORY },
        'knowledge-create-kb-band-scope-commit',
        { excluded: 'accept-btn ("the reflector grows it from the next cycle") — already demonstrated: knowledge-create-kb-band-scope-commit\'s own approve-brain click + real commit + return-to-project assertion (W6-SW-3 sweep C6#1 rename of bind-and-return), cited at the prior step', decision: DECISION_ONE_REF_PER_STORY },
      ],
    },
    excluded: null,
    note:
      'R4-19 F1 (journey-sync T3, 2026-08-10) flips this story from pending ' +
      '(port: null) to ported — 2 of 5 mockup steps map onto REAL beats, 3 ' +
      'excluded (all decision-cited, none an unbuilt gap). This story is the ' +
      'generic "run a brain-creation session" arc; forge has no separate ' +
      'agent-builder-launched run for it (step 1\'s #/agents/builder/brain-' +
      'creation has no real analog — the kickoff IS the /knowledge/new create ' +
      'hand-off, already the entry point knowledge-create-kb-band-scope ' +
      'drives), so the ported beats are the SAME two this batch built for ' +
      'create-kb-cycle: knowledge-create-kb-band-scope-seed (R4-19 WI-2\'s ' +
      'real session reachability + a real briefing POST + honestly-emulated ' +
      'theme authoring grounded in forge\'s own review-band findings) and ' +
      'knowledge-create-kb-band-scope-commit (a real approve POST + R1-06\'s ' +
      'deterministic runCommitStep invoked directly, landing a genuine ' +
      'brain write). See DECISION_R4_19_WI1_WI2 for the as-built/emulated ' +
      'boundary.',
  },
  {
    story: 'run-flow-onboard',
    batch: 'D',
    port: {
      journey: 'flows-onboard',
      beats: [
        'flows-onboard-monitor',
        'flows-onboard-kickoff',
        { excluded: "select [data-j=kick-project] (\"Target the repo; materials welcome.\") — no project-target field exists anywhere on the real kickoff surface: FLOW_KICKOFF_KINDS declares only idea/initiative-select/trigger-only, onboard-project deliberately declares no kickoff: block (the generic fallback, a bare Start-Run button), and the real onboarding entry point is the PROJECT page's own \"Run onboarding agent\" action (R4-02/R4-17), never a flow-kickoff project picker", decision: DECISION_R4_18_NO_PROJECT_KICKOFF_KIND },
        { excluded: "click [data-j=start-run] (\"Start.\") — the real [data-action=\"start-run\"] click POSTs initiativeId:'onboard-project' to /api/runs, which 400s (INIT_ID_RE requires an INIT-YYYY-MM-DD-slug id) and, even with a matching id, only RESUMES an already-queued initiative — no product path ever queues one for onboard-project; the real load-bearing proof (a run actually reaching the gate) is driven directly through the flow-runner instead, at flows-onboard-gate", decision: DECISION_R4_18_GENERIC_KICKOFF_NO_DISPATCH },
        { excluded: '"Interview: the north star lands first." — the onboard node dispatches onboarding-agent, whose own declared interactivity is fully autonomous once triggered: it asks no questions and never blocks mid-run (skills/onboarding-agent/SKILL.md) — there is no interview turn on this flow\'s real path', decision: DECISION_R4_18_NO_INTERVIEW },
        { excluded: '"Contract author: AGENTS.md, secrets, demo skill, gates." — real, and already ported: stand-up-onboard.mjs\'s su-onboard-session beat drives the SAME real contract build-out (contract, instructions, secrets, demo, roadmap, stage by stage), cross-journey; R4-18 itself scopes onboarding content out (R4-02/R4-17)', decision: DECISION_R4_18_CONTRACT_AUTHOR_CROSS_JOURNEY },
        'flows-onboard-gate',
        { excluded: '"Complete — the project lands managed, contract-green." — flows-onboard-gate already drives R4-18-F1\'s own load-bearing AC (a real run reaching the gate with real preflight output) via the honest RED path a freshly onboarded repo genuinely starts in; the mirror-image GREEN completion is reachable only through the acceptance test\'s own mdtoc-basename fixture hack (onboard-flow-gate.test.ts AT-4 companion), a test-infrastructure artifact not worth re-running the real gate a second time to stage', decision: DECISION_R4_18_GATE_RED_NOT_GREEN },
      ],
    },
    excluded: null,
    note:
      'R4-18 (journey-sync T3, 2026-08-11) flips this story from pending to ' +
      'ported. New journey scripts/journeys/flows-onboard.mjs (3 beats): ' +
      'flows-onboard-monitor + flows-onboard-kickoff read-only-browse the ' +
      'real onboard-project flow (peer of forge-develop on the library ' +
      'shelf, its own two-node topology, the generic Start-Run fallback with ' +
      'no project picker); flows-onboard-gate is the load-bearing beat — it ' +
      'drives the REAL orchestrator/flow-runner.ts runFlow() over the REAL ' +
      'onboard-project flow.yaml against a genuinely preflight-RED scratch ' +
      'fixture (mirroring orchestrator/onboard-flow-gate.test.ts\'s own AT-4 ' +
      'harness — the onboard node\'s agent spawn suppressed via the same ' +
      'dry-bridge every other journey beat relies on, but contract-check\'s ' +
      'gate NOT stubbed: it calls the real runPreflight and the monitor ' +
      'renders a genuine on-disk event log, never a hand-authored one). 3 of ' +
      '8 mockup steps ported, 5 excluded (all decision-cited, none an ' +
      'unbuilt product gap — see each decision above).',
  },
  {
    story: 'run-flow-brain-tune',
    batch: 'D',
    port: {
      journey: 'agents',
      beats: [
        'agents-kickoff-standing-triggers',
        { excluded: '"the trigger lives on the agent itself" restates the same real standing trigger already cited at step 1 — no distinct UI action beyond it', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: '"two durable lessons from the cycle" is a specific run\'s OWN output content (a count) — genuinely unavailable without a real reflector SDK turn, and this harness spawns none (FORGE_ARCHITECT_NO_SPAWN=1), honestly excluded rather than fabricated', decision: DECISION_REFLECTOR_NO_LIVE_RUN },
        { excluded: 'the corrected caption itself makes the R4-20 point ("written straight into the brain by the SAME run, no separate node") — ingest never ran, nor will run, as a discrete visible flow node under keep-as-is; the SAME real Skills-zone brain-ingest chip cited at the beat below is the honest substitute for the capability, not a per-run "themes, edges, index" count', decision: DECISION_R4_20_KEEP_AS_IS },
        'agents-run-reflector-detail',
        { excluded: 'closing narrative line summarising the auto-triggered, self-tuning loop — not a distinct UI action beyond the real standing trigger already cited at step 1', decision: DECISION_REFLECTOR_NO_LIVE_RUN },
      ],
    },
    excluded: null,
    note:
      'R4-20-F1 (journey-sync T3, 2026-08-10, T1 ruling — see ' +
      'DECISION_R4_20_KEEP_AS_IS) resolves KEEP-AS-IS: the mockup\'s ' +
      'ORIGINAL run-flow-brain-tune steps depicted a visible `#/flows/' +
      'monitor/brain-tune` flow route (step 1) with a discrete lint GATE ' +
      'node (step 5) — neither exists, nor will exist under keep-as-is, so ' +
      'this pass corrects the mockup itself (same PR) rather than ' +
      'deferring the correction to a port-time exclusion: step 1 now goes ' +
      'to `#/agents/builder/reflector` (the reflector agent\'s own real ' +
      'page, the SAME route the pre-existing build-skill story already ' +
      'drives) and step 5\'s cap now explicitly reads "not a gated flow ' +
      'step". That correction is what makes this story portable at all — ' +
      'its real content and run-agent-reflector\'s (R4-B13, batch C/D, ' +
      '#110) are now literally the SAME page. Step 1 (auto-trigger) reuses ' +
      'the pre-existing agents-kickoff-standing-triggers beat (R6-01 WI-4), ' +
      'exactly as run-agent-reflector\'s own port does — the SAME real ' +
      '`{on: merged, target: {kind: agent, ref: reflector}}` standing ' +
      'trigger declared on forge-develop. Step 5 (the corrected "lint gate ' +
      '... not a gated flow step") reuses agents-run-reflector-detail from ' +
      'that same prior port — it runs a genuine `forge brain lint`, proving ' +
      'brain/ actually passes its real 9-check suite right now, the honest ' +
      'substitute for both the fictional gate node and the fictional ' +
      'per-run "9/9" claim. No new beat was warranted: the two reused beats ' +
      'already cover everything real this story depicts (the standing ' +
      'trigger, the agent\'s declared brain-access composition, and a live ' +
      'lint proof) — nothing here needed a third real beat. Steps 2, 3, 4 ' +
      'and 6 (the trigger restated, a specific lesson count, specific ' +
      'ingest content, and the closing narrative) are excluded: step 2 ' +
      'under DECISION_ONE_REF_PER_STORY (a repeat of step 1\'s beat); steps ' +
      '3 and 6 under DECISION_REFLECTOR_NO_LIVE_RUN (live per-cycle SDK-turn ' +
      'content no static UI surface renders, mirroring run-agent-' +
      'reflector\'s own precedent); step 4 under DECISION_R4_20_KEEP_AS_IS ' +
      '(no discrete ingest flow-node exists or will exist under keep-as-is, ' +
      'the more specific reason its own corrected caption text names). Net: ' +
      '2 of 6 mockup steps carry a literal string BeatRef, both reused from ' +
      'run-agent-reflector\'s own port; the other 4 are explicit, ' +
      'decision-cited exclusions.',
  },
];
