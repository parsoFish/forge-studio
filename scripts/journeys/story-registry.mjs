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
    port: null,
    excluded: null,
    note:
      "Only mockup story absent from every batch's functional-closure " +
      'column in README §4. Its surface (flow builder, hex canvas, ' +
      'ArtifactPicker edges) is verified aligned by R4-B13, so the port ' +
      'is a pure journey-sync duty with no product work; assigned to C ' +
      'as the only batch owning flows-pillar modules. MEASURED at ' +
      'batch-C exit (2026-08-08): NOT ported — 0 of 11 beats, and the ' +
      'only zero whose producer is already complete on main. It was ' +
      'never a pack exit criterion, so it is recorded as batch C\u2019s ' +
      'unpaid journey-sync debt rather than reassigned; flows-author ' +
      'has 3 beats against 11 mockup steps. Filed as bd forge-9ir.',
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
      "claim, not a new flow node. MEASURED at batch-C exit (2026-08-08): " +
      'batch C did NOT port this story — 0 of 21 beats. The run surfaces it ' +
      'walks shipped (R6-04/R6-01/R6-05), but the flow-kickoff half of ' +
      'R6-04-F2 is neither built nor excluded, and the story also opens on ' +
      'R4-12/R4-13 (batch D). Port filed as a batch-D WI (bd forge-tuy).',
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
      'claiming ported would misrepresent the 7 unbacked beats as real. ' +
      'R4-17 ASSESSED the inherited beats (2026-08-06, batch B\'s last ' +
      'initiative) and does NOT own them, with the blocker now named precisely ' +
      'rather than left as "the session shell": the shell EXISTS since R2-10, ' +
      'and R4-17 proved a new session kind plugs into it with no route code ' +
      '(the `onboarding` descriptor). What is missing is the PRODUCER — beats ' +
      '4-10 are an authoring session with a "Creation Agent" that drafts a ' +
      'hook PACKAGE, and no such agent exists: grep for a runtime: block in ' +
      'skills/*/SKILL.md yields 16 agents, none of which authors a hook. That ' +
      'is also why the `file-package` artifact row is still RESERVED in ' +
      'SESSION_ARTIFACT_KINDS: shipping a renderer with no producer would be ' +
      'exactly the stub the reserved-row convention exists to forbid. The ' +
      'remaining work is one OOTB authoring agent plus its runner, which is an ' +
      'initiative, not a rider on this one.',
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
      'not new work this initiative owns or ported as a beat. ' +
      'R4-17 ASSESSED the inherited beats (2026-08-06) and does NOT own them, ' +
      'for the same reason recorded on build-hook: R2-10 shipped the session ' +
      'shell and R4-17 proved a new kind plugs into it with no route code, but ' +
      'beats 2-8 need a "Creation Agent" that drafts a SKILL PACKAGE and no ' +
      'such agent exists in skills/ (16 runtime-bearing agents, none authoring ' +
      'a skill). `file-package` therefore stays a RESERVED artifact row — a ' +
      'renderer with no producer is the stub that convention forbids. The ' +
      'shipped alternative remains the /skills/new form.',
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
        { excluded: 'sessionTurns:1 ("continue into the creation session") — for a NON-project binding the hand-off session is dot-anchored (projects/.kb-<id>/), proven unreachable on disk by knowledge-create-kb-band-scope itself, not merely a missing "continue" click', decision: DECISION_R4_19 },
        { excluded: 'sessionTurns:2 ("seeded from 41 runs of review findings — clusters become themes") — no cycle/band-scope creation agent exists yet (R4-ootb-suite.md R4-19: "no cycle/band-scope creation")', decision: DECISION_R4_19 },
        { excluded: 'sessionTurns:3 ("declared-data-fails-open leads with 9 occurrences") — same gap, fabricated finding-cluster content, never scripted-as-real here', decision: DECISION_R4_19 },
        { excluded: 'accept-btn — no session content to accept; the dot-anchored session has no reachable session-shell page at all', decision: DECISION_R4_19 },
        { excluded: 'nav-knowledge ("a Brain-2-scoped base, bound to the review band") — already demonstrated: knowledge-create-kb-band-scope confirms kb.yaml\'s binding carries "band: review-band" the moment create is submitted', decision: DECISION_ONE_REF_PER_STORY },
        { excluded: 'brain-review-insights ("same graph, same reader — different scope") — already demonstrated: knowledge-create-kb-band-scope\'s own closing frame is the new band-scoped KB\'s graph rendering', decision: DECISION_ONE_REF_PER_STORY },
      ],
    },
    excluded: null,
    note:
      'R1-06 WI-4 (journey-sync) ports 2 of 10 mockup steps and excludes 8, ' +
      'per T1 ruling 2026-08-09 (Q5). Step 1 reuses knowledge-graph (same ' +
      'substitution as create-kb-project — one real /knowledge page, ' +
      'independent of which story cites it). Step 4 ("the review band of ' +
      'forge-develop") maps onto the NEW knowledge-create-kb-band-scope beat, ' +
      'built for this initiative: it drives the real [data-field="kb-binding-' +
      'band"] select — populated from forge-develop\'s REAL derived bands ' +
      '(orchestrator/agent-bands.ts\'s resolveBandGuard reading adversarial-' +
      'review\'s own SKILL.md guard, never a hardcoded list) — selects ' +
      '"review-band", and verifies the written kb.yaml carries it. T1\'s own ' +
      'distinguishing ruling for this story ("its seeding session is dot-' +
      'anchored + R4-19-deferred") is asserted POSITIVELY, not just cited: the ' +
      'beat confirms on disk that a non-project binding\'s hand-off session ' +
      'lands under the dot-prefixed projects/.kb-<id>/ anchor bridge-studio-' +
      'kbs.ts writes — real, but genuinely unreachable through the session-' +
      'shell route (its ?project= is SLUG_RE-validated, which a leading "." ' +
      'fails), which is why every session-turn step here is excluded rather ' +
      'than substituted with the ingest-fold trick create-kb-project could ' +
      'have reached for.',
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
    batch: 'C',
    port: null,
    excluded: null,
    note:
      'Agent itself verified aligned by R4-B13 (ralph loop, per-WI ' +
      "fanout, write-first continuity). MEASURED at batch-C exit (2026-08-08): " +
      'batch C did NOT port this story — 0 of 10 beats. No product work is ' +
      'needed; it is a journey-sync duty on a seeded _logs/<runId> fixture. ' +
      'Filed as a batch-D WI (bd forge-11w).',
  },
  {
    story: 'run-agent-adversarial-review',
    batch: 'C',
    port: null,
    excluded: null,
    note:
      'Agent itself verified aligned by R4-B13 (refute-first findings ' +
      "feeding the verdict gate). MEASURED at batch-C exit (2026-08-08): " +
      'batch C did NOT port this story — 0 of 6 beats. Blocked on the ' +
      'standalone run view attaching no trigger provenance. Filed as a ' +
      'batch-D WI (bd forge-928).',
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
      'MEASURED at batch-C exit (2026-08-08): batch C did NOT port this ' +
      'story — 0 of 6 beats. It is also trigger framing 2 of 3 ' +
      '(project-hook), blocked on the SHIPPED_TRIGGER_KINDS UI mirror ' +
      'omitting pr-merged. Filed as a batch-D WI (bd forge-gu8).',
  },
  {
    story: 'run-agent-reflector',
    batch: 'C',
    port: null,
    excluded: null,
    note:
      'Agent itself verified aligned by R4-B13 (outside-the-cycle ' +
      'reflection into the brains on the merged trigger; the brain-tune ' +
      "flow packaging delta is R4-20). MEASURED at batch-C exit (2026-08-08): " +
      'batch C did NOT port this story — 0 of 6 beats. Cheapest of the four ' +
      'agent ports; covers the on-complete-chain framing (merged half). ' +
      'Filed as a batch-D WI (bd forge-1ge).',
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
      '(demo-builder-generations: the operator types into the real review ' +
      'surface, the real bridge route writes feedback.md, and the gallery ' +
      'renders generation 2 beside generation 1 showing the operator\'s own ' +
      'words as the feedback that drove it), step 4 "Generation N. Ship it." ' +
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
