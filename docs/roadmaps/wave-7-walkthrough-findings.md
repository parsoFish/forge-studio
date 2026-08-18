# Wave 7 — operator UI walkthrough: verified issue register

> Produced 2026-08-18/19 by the wave-7 walkthrough: a baseline crawl of 160 Studio routes, then ten
> operator-style explorer agents (one per UI cluster; every control clicked, real sessions/agent runs/one
> KB drain spent) each followed by an adversarial verifier. **336 findings** (S1 78 · S2 157 · S3 101);
> 276 S1/S2 verdicts, all CONFIRMED bar 1 downgrade / 1 upgrade / 1 duplicate. Every finding below is
> assigned to exactly one wave-7 initiative (see `README.md` §4 Wave 7). Detail per id (repro, expected/actual,
> evidence, root cause with `file:line`, proposed fix) lives in the campaign's findings JSONL; the durable
> record here is id · severity · route · title, grouped by initiative.

Severity: **S1** blocks an operator path / data loss / silently wrong · **S2** works but confusing, missing an
expected capability, or an error surfaced badly · **S3** polish. `n<k>` = relates to operator note k:
n1 approve plan does nothing; n2 home strips indistinguishable; n3 no session cancel / bad-state sessions; n4 betterado plan stuck; loops don't tie together; n5 community too light; refresh agent inert; targeted search; n6 drain-to-green opaque; health tab busy/overlapping; n7 two flow buttons on KB screen; recent-runs widget; n8 library artifacts not creatable/editable; n9 remove KB card from Library; n10 remove reflection flow.

**Totals:** 337 findings — S1 79 · S2 156 · S3 102.

## Initiative → findings

| Initiative | S1 | S2 | S3 | Operator notes touched |
|---|---|---|---|---|
| **W7-A0** UI-walkthrough harness promoted into the repo (crawl + explorer brief + workflow) as a standing gate | 0 | 0 | 0 | — |
| **W7-A1** Honest bridge reads | 6 | 3 | 2 | n2, n3 |
| **W7-A2** Session lifecycle | 15 | 15 | 5 | n3, n4, n5, n6 |
| **W7-A3** Loop closure | 15 | 14 | 7 | n1, n3, n4 |
| **W7-A4** Identity + not-found hygiene | 7 | 16 | 10 | n1, n2, n4, n5, n6, n8 |
| **W7-B1** Home + /sessions IA | 2 | 9 | 9 | n2, n3, n5 |
| **W7-B2** Knowledge + drain-to-green | 6 | 17 | 5 | n3, n6, n7 |
| **W7-B3** Community | 6 | 11 | 7 | n5, n8, n9 |
| **W7-B4** Library authoring | 9 | 21 | 16 | n4, n5, n6, n8, n9 |
| **W7-B5** Agents + runs | 8 | 11 | 8 | n3, n4, n6, n7 |
| **W7-B6** Projects | 3 | 13 | 11 | n3, n4, n6 |
| **W7-B7** Artifact + verdict pages | 1 | 12 | 6 | n1 |
| **W7-C1** Flows pillar consolidation | 0 | 4 | 6 | n4, n7, n10 |
| **W7-C2** Interview + verdict richness | 1 | 5 | 2 | n1, n3 |
| **W7-C3** Cross-cutting polish + a11y | 0 | 5 | 8 | — |

### W7-A0 — UI-walkthrough harness promoted into the repo (crawl + explorer brief + workflow) as a standing gate

_No walkthrough findings — this initiative promotes the instrument that produced them._

### W7-A1 — Honest bridge reads: fail-closed studioGet, bridge-down banner, reconnect recovery, surfaced 4xx detail

- **S1** `crosscut-01` `n2` — Bridge unreachable is rendered as "you have nothing" on all six pillar pages — fail-open empty state, no error, no retry _( `/ (and /projects, /flows, /agents, /knowledge, /sessions)` )_
- **S1** `crosscut-12` — A bridge 409 carrying an actionable config-migration message is swallowed; the whole contract-buildout checklist silently disappears from the project page _( `/projects/gitpulse` )_
- **S1** `crosscut-22` `n2` — When the bridge comes back, no page recovers — the pinned tab stays empty forever until the operator manually reloads _( `all pillar routes` )_
- **S1** `home-sessions-29` `n3` — A failed sessions fetch renders the confident empty state "No sessions in flight — Nothing is waiting on you right now" with data-page-ready=true _( `/sessions` )_
- **S1** `home-sessions-30` `n2` — Home renders a first-run "Nothing registered yet — Onboard your first project" fleet-is-empty screen when every bridge read fails _( `/` )_
- **S1** `home-sessions-V01` — studioGet — the single shared fetch primitive behind ~26 Studio client functions — silently converts EVERY bridge failure (4xx/5xx/network/malformed JSON) into the caller's empty fallback, so "bridge is down" is indistinguishable from "genuinely empty" on every route in Studio, not just Home/sessions _( `/ , /sessions (and every other Studio route reading bridg…` )_
- **S2** `crosscut-26` — The two bridge clients disagree: bridge-client has a one-shot port correction, studio-client has none — so a --bridge-port override strands most of Studio's data _( `all routes (studio-client data)` )_
- **S2** `home-sessions-13` — No connection / reconnect indicator on Home or /sessions — the WS state is explicitly discarded, so a dead bridge looks like a quiet fleet _( `/ · /sessions` )_
- **S2** `projects-03` — Contract Buildout panel renders an empty checklist on ANY contract-stages failure — a broken project is indistinguishable from a fetch error _( `/projects/<id>` )_
- **S3** `crosscut-09` — Session page shows a raw JS error string as its entire body when the bridge call fails _( `/sessions/<kind>/<id>` )_
- **S3** `library-13` — Malformed-id error is garbled, names the wrong object type, and the UI reports a reached bridge as unreachable _( `/hooks/<bad-id> · /connections/<bad-id> · /skills/<bad-id>` )_

### W7-A2 — Session lifecycle: cancel/abandon for every kind, crash + stall detection surfaced, truthful needs-you, duplicate-session guard, write-root fence proven

Pre-existing beads folded in: forge-w08 (Write unconfined), forge-eip (allowed-tools not a fence), forge-2ee (authoring tail dead).

- **S1** `community-02` `n3` — An InteractiveRunnerError crash is never surfaced to the UI — the session just sits at its old phase with needsYou=true and no error text anywhere _( `/sessions/community-refresh/<id>` )_
- **S1** `community-06` `n3` — Deep-linking /sessions/community-refresh/<id> without ?project= renders 'Session not found' for a session that exists _( `/sessions/community-refresh/<id>` )_
- **S1** `community-07` `n5` — A running community-refresh session shows literally nothing: no live log, no tool activity, no elapsed time, no cost, no cancel — just 'No turns recorded yet' and an empty artifact pane _( `/sessions/community-refresh/<id>` )_
- **S1** `home-sessions-04` `n3` — There is NO cancel / abandon / archive / dismiss control for a session anywhere in Studio — not on the index row, not on Home, not on the detail page _( `/sessions · /` )_
- **S1** `home-sessions-05` `n3` — A session whose agent turn CRASHED still renders as a healthy in-flight "needs you" row — the crash is invisible everywhere in the UI _( `/sessions` )_
- **S1** `home-sessions-08` `n3` — The needs-you signal is inverted for architect and project-brain: a STALLED architect session shows "needs you = false" while an agent that is merely mid-turn shows "needs you = true" _( `/sessions` )_
- **S1** `home-sessions-09` `n3` — Rows marked "needs you" land on a detail page that literally says "No operator action available for this session kind right now" _( `/sessions` )_
- **S1** `home-sessions-10` `n5` — The community-refresh session detail page is completely inert: no turns, no activity drawer, no affordance, no error — yet it is the top "needs you" row _( `/sessions` )_
- **S1** `knowledge-16` `n3` — Both kb-cleanup sessions are permanently stuck: the agent turn CRASHED, the error is only in stderr.log, and the UI shows a calm 'No operator action available' _( `/sessions/kb-cleanup/<id>` )_
- **S1** `knowledge-17` `n3` — A drafting kb-cleanup session declares two affordances and BOTH 501 — there is no reachable action of any kind, including Approve (409, not 400) _( `/sessions/kb-cleanup/<id>` )_
- **S1** `sessions-kinds-10` `n3` — No session can be cancelled or abandoned from its own page — dead sessions accumulate in "needs you" forever _( `/sessions/<kind>/<sid> (all kinds)` )_
- **S1** `sessions-kinds-11` `n3` — The generic panel has no stall detection: a session whose agent died days ago still reads as working ("No operator action available right now") _( `/sessions/{kb-cleanup,demo,instructions,authoring,communi…` )_
- **S1** `sessions-kinds-15` `n3` — The "needs you" signal is wrong in BOTH directions — agent-working sessions are flagged, operator-blocked sessions are not _( `/sessions` )_
- **S1** `sessions-kinds-33` `n3` — A crashed session runner is invisible in Studio — stderr.log is written but nothing on the page reads it, and only architect even names the path _( `/sessions/<kind>/<sid>` )_
- **S1** `sessions-kinds-V01` `n5` — The write-root containment fence does not actually block Write calls outside the session's writable root — permissionMode:'acceptEdits' is set in the SAME options object as canUseTool _( `/sessions/community-refresh/2026-08-18T12-54-32-abdfd26b?…` )_
- **S2** `community-15` `n3` — A community-refresh session that is actively running is reported as needsYou=true, inflating the home page's 'needs you' count with sessions that offer no operator action _( `/sessions/community-refresh/<id>` )_
- **S2** `community-20` `n3` — 'Resume →' is the only affordance offered for a crashed community-refresh session, and it resumes nothing _( `/sessions/community-refresh/<id>` )_
- **S2** `flows-28` `n3` — A failed run offers only Resume — no cancel, no requeue-from-start, no way to abandon it _( `/flows/forge-develop` )_
- **S2** `home-sessions-11` `n3` — Every demo session detail page fires a console 404: GET /api/events/_demo-<sessionId> -> 404, with no UI acknowledgement _( `/sessions` )_
- **S2** `home-sessions-21` `n3` — Exactly ONE abandon control exists in the whole session surface (project-brain, awaiting-review only); the demo abandon client is exported but has zero callers _( `/sessions` )_
- **S2** `home-sessions-22` `n3` — Duplicate sessions for the same target accumulate with nothing preventing or flagging them — two identical kb-cleanup sessions for the "cycles" KB, five demo sessions for three projects _( `/sessions` )_
- **S2** `home-sessions-28` `n3` — Sending an answer gives no confirmation: no toast, no "sent" state — the only feedback is that the operator affordance is replaced by "No operator action available for this session kind right now" _( `/sessions` )_
- **S2** `knowledge-18` `n3` — A kb-cleanup session URL without ?project= renders 'Session not found' — the session id alone is not a working address _( `/sessions/kb-cleanup/<id>` )_
- **S2** `knowledge-25` `n3` — 'No turns recorded yet for stage "brain"' is shown even after the turn ran, drafted the plan, and the session reached applied _( `/sessions/kb-cleanup/<id>` )_
- **S2** `sessions-kinds-16` `n3` — The sessions index is view-only: no cancel, no filter, no age warning, and no way to reach terminal sessions it tells you exist _( `/sessions` )_
- **S2** `sessions-kinds-20` — Session deep links break without an exact ?project= — a live session reports "Session not found" _( `/sessions/{kb-cleanup,authoring,community-refresh,onboard…` )_
- **S2** `sessions-kinds-27` `n3` — Every terminal state renders the same neutral sentence — "No operator action available for this session kind right now." — so locked, rejected, committed, abandoned and applied are indistinguishable _( `/sessions/<kind>/<sid> (terminal phases)` )_
- **S2** `sessions-kinds-28` `n3` — Nothing stops an operator opening unlimited duplicate sessions of the same kind on the same project, and the kickoff page never mentions the ones already open _( `/sessions/<kind>/new` )_
- **S2** `sessions-kinds-35` `n6` — Sessions have no back link at all until they are terminal, and KB/community sessions only ever get a link to the INDEX, never to the KB or registry they belong to _( `/sessions/{kb-cleanup,community-refresh}/<sid>` )_
- **S2** `sessions-kinds-36` `n4` — A committed authoring session never links to the skill/hook it produced — the navigation happens once, at approve time, and is lost on reload _( `/sessions/authoring/2026-08-18T13-39-34-c46a3ecf?project=…` )_
- **S3** `home-sessions-23` `n3` — Orphan session directories are invisible to Studio and never cleaned up _( `/sessions` )_
- **S3** `knowledge-27` `n3` — Approve DOES work (200) on an awaiting-approval kb-cleanup — the reported 400 is a 409 raised because the only two real sessions never leave 'drafting' _( `/sessions/kb-cleanup/<id>` )_
- **S3** `sessions-kinds-24` `n3` — Every freshly-started session fires GET /api/events/_<kind>-<sid> → 404 (a console error on the first screen), and long-dead sessions 404 forever _( `/sessions/<kind>/<sid> (t0)` )_
- **S3** `sessions-kinds-31` — The model chip reads "model: default" for every session started before the tier picker existed — it never names the model actually used _( `/sessions/<kind>/<sid>` )_
- **S3** `sessions-kinds-37` — The session page runs two independent 3s polls that disagree — the list-derived phase and the shell-derived phase can show different values at once _( `/sessions/architect/<sid>` )_

### W7-A3 — Loop closure: scheduler control in Studio, plan gate fixed (one Approve, architect run id, post-approve state), session→initiative→run→artifact linkage, run pages ready + navigable

- **S1** `artifact-plan-01` `n1` — Plan-gate bottom-bar Approve/Send-back can NEVER work for an architect session — the bridge 400s "invalid run id" on the `_architect-` prefix _( `/artifact?run=_architect-<sid>&type=plan&mode=gate` )_
- **S1** `artifact-plan-02` `n1` — GateBar swallows every Approve failure — the error element is only rendered inside the send-back drawer _( `/artifact?...&mode=gate (GateBar)` )_
- **S1** `artifact-plan-03` `n1` — A committed architect plan renders BOTH "Approved — the autonomous loop is building it now" and a live "THIS RUN IS BLOCKED ON YOU / Approve" bar _( `/artifact?run=_architect-<sid>&type=plan&mode=gate` )_
- **S1** `artifact-plan-04` `n1` — The plan itself is never shown on the plan artifact page for an architect session — every artifact fetch 404s because the `_architect-` runId is passed straight to /api/artifact/<cycle>/… _( `/artifact?run=_architect-<sid>&type=plan` )_
- **S1** `artifact-plan-09` `n1` — TWO Approve buttons on the plan gate — the in-body one works (200), the bottom-banner one is dead (400). Confirmed on a FRESH wave-7 architect session, so this is NOT "the session predates wave 6" _( `/artifact?run=_architect-<sid>&type=plan&mode=gate` )_
- **S1** `artifact-plan-10` `n1` — A SUCCESSFUL plan approval immediately reverts the page to a live "THIS RUN IS BLOCKED ON YOU / Approve" bar with no plan and no confirmation _( `/artifact?run=_architect-<sid>&type=plan&mode=gate` )_
- **S1** `artifact-plan-33` `n1` — Sending a plan back from /artifact strands the operator: the architect re-opens the interview, but the plan gate shows an empty page whose only control is the broken Approve — the questions are on a different screen it never links to _( `/artifact?run=_architect-<sid>&type=plan&mode=gate` )_
- **S1** `crosscut-23` `n4` — Run detail pages are dead ends: zero buttons and no links except the six nav pillars — no way back to the flow, the artifacts, or the project _( `/flows/<id>/run/<runId>, /agents/<id>/run/<runId>` )_
- **S1** `flows-01` `n4` — No scheduler control anywhere in Studio — a queued initiative can never be started from the UI _( `/flows/forge-architect` )_
- **S1** `flows-02` `n4` — Generic "Start Run" on a flow monitor posts the flow id as an initiativeId — always 400s, silently _( `/flows/onboard-project` )_
- **S1** `flows-03` `n4` — A flow monitor loses its only launch control as soon as the flow has one run _( `/flows/forge-develop` )_
- **S1** `flows-23` `n4` — The full architect→develop loop has no runnable next step anywhere: every start control is an enqueue and the queue consumer is off _( `/flows/forge-architect/run/INIT-2026-08-14-betterado-gap-…` )_
- **S1** `projects-16` `n4` — Roadmap "Plan →" / "Start development" only enqueue — with the scheduler stopped nothing runs, and Studio never shows or starts the scheduler anywhere _( `/projects/<id> (Roadmap tab)` )_
- **S1** `sessions-kinds-08` `n4` — A committed architect session claims "the autonomous loop is building it now" and links to the flow DEFINITION — there is no link to the initiative, the queue, or its run, and the claim is false when the scheduler is stopped _( `/sessions/architect/<sid> (phase=committed)` )_
- **S1** `sessions-kinds-12` `n4` — CONFIRMED on a brand-new session: the committed banner asserts "the autonomous loop is building it now" while the scheduler is stopped and nothing is running _( `/sessions/architect/2026-08-18T13-27-13-8ee491f5` )_
- **S2** `agents-11` — The agent-run page never sets data-page-ready="true" — the DOM-as-metrics contract breaks once the page loads _( `/agents/<slug>/run/<runId>` )_
- **S2** `agents-12` — The run page has no breadcrumb or link back to the agent, and the agent slug in the URL is never validated or displayed _( `/agents/<slug>/run/<runId>` )_
- **S2** `artifact-plan-05` `n1` — ?mode=gate is honoured for any run in any state — a run that completed weeks ago renders a live "THIS RUN IS BLOCKED ON YOU" gate whose Approve 404s _( `/artifact?run=<cycleId>&type=plan&mode=gate` )_
- **S2** `artifact-plan-21` — A non-existent architect session renders a fully armed plan gate _( `/artifact?run=_architect-<unknown>&type=plan&mode=gate` )_
- **S2** `artifact-plan-22` `n1` — Once an architect session commits, its PLAN is unreachable from anywhere in the UI — the session page drops the plan link and the project page has none _( `/sessions/architect/<sid> + /projects/<id>` )_
- **S2** `artifact-plan-23` `n4` — The approved plan produces an initiative the operator cannot start: the session page shows it as "pending" with no control, while claiming "the autonomous loop is building it now" _( `/sessions/architect/<sid> (committed)` )_
- **S2** `artifact-plan-27` `n1` — Architect sessions in drafting / rejected phases render an entirely empty artifact body — and in gate mode a REJECTED plan still says "THIS RUN IS BLOCKED ON YOU … approve the plan to continue" _( `/artifact?run=_architect-<sid>&type=plan` )_
- **S2** `crosscut-05` — Run detail pages never set data-page-ready — the DOM-as-metrics contract is broken for two whole route families _( `/flows/*/run/*, /agents/*/run/*` )_
- **S2** `flows-06` — Flow run-detail never sets data-page-ready once loaded (breaks the Studio DOM contract every other route honours) _( `/flows/<id>/run/<runId>` )_
- **S2** `flows-07` — Every flow run-detail page fires a guaranteed-404 fetch for review-findings.json (console error on every visit) _( `/flows/<id>/run/<runId>` )_
- **S2** `flows-29` — ELAPSED on a finished run counts from its start to NOW — a 37-day-old run reads "908h 20m" _( `/flows/forge-develop` )_
- **S2** `home-sessions-17` — Every flow row in Home's Recent-activity ledger lands on a /flows/\*/run/\* page that never sets data-page-ready and 404s on review-findings.json (23/23 rows) _( `/` )_
- **S2** `sessions-kinds-13` `n3` — The architect activity log disappears the moment the plan is ready — the reasoning trail is unavailable exactly when the operator has to judge the plan _( `/sessions/architect/<sid> (phase=awaiting-verdict / commi…` )_
- **S2** `sessions-kinds-14` `n1` — The plan gate (the architect session's only forward affordance) shows two independent, differently-wired sets of Approve/Send-back controls _( `/artifact?run=_architect-<sid>&type=plan&mode=gate` )_
- **S3** `agents-37` — The run page is a terminus — no "run again", no link to the agent, no link to the project or flow it ran for _( `/agents/<slug>/run/<runId>` )_
- **S3** `artifact-plan-28` `n1` — The plan artifact page has no link back to the architect session it belongs to; the breadcrumb calls it "flow" and "back to monitor" dumps you on the home page _( `/artifact?run=_architect-<sid>&type=plan` )_
- **S3** `flows-15` — Opening a phase drawer on a queued run fires a 404 phase-log fetch (console error per hex click) _( `/flows/forge-architect` )_
- **S3** `flows-30` — LIVE EVENTS says "Waiting for events…" forever on a run that finished weeks ago _( `/flows/forge-develop` )_
- **S3** `flows-31` — Run-rail group collapse is forgotten on every reload, and the COMPLETE group defaults open with 59 rows _( `/flows/forge-develop` )_
- **S3** `projects-17` — Start-development success copy still names the retired unifier phase _( `/projects/<id> (Roadmap tab)` )_
- **S3** `projects-32` `n4` — "view run →" after Plan/Start development drops the cycleId the enqueue just returned and links to the flow index instead of the run _( `/projects/<id> (Roadmap tab)` )_

### W7-A4 — Identity + not-found hygiene: KB/project id case, reserved "new" id, one honest NotFound for unknown ids, initiative title source, retired flow ids

Pre-existing beads folded in: forge-9bd (SLUG_RE camelCase).

- **S1** `crosscut-02` — Unknown agent id silently redirects into the blank NEW-agent builder instead of a not-found page _( `/agents/<anything-unknown>` )_
- **S1** `crosscut-03` `n6` — Unknown ?id= on Knowledge silently shows a DIFFERENT KB (the first in the roster) with the wrong id still in the URL _( `/knowledge?id=<unknown>` )_
- **S1** `crosscut-11` `n6` — The trafficGame KB is listed by the bridge but every per-KB endpoint rejects its id (400 "invalid kb id") — the UI shows it as simply empty, with all its action buttons live _( `/knowledge?id=trafficGame` )_
- **S1** `flows-05` `n4` — Run detail for an unknown/retired flow id renders as VALID with an empty timeline — a 7-phase completed run shows nothing _( `/flows/unknown/run/2026-06-20T05-12-11_INIT-2026-06-19-fr…` )_
- **S1** `home-sessions-16` `n2` — Home attention row for the trafficGame KB lands on a page whose every KB request 400s ("invalid kb id") — the KB with the most lint errors is unreachable from Home _( `/` )_
- **S1** `knowledge-03` `n6` — A KB whose id has an uppercase letter (trafficGame) is listed and selectable but every detail route 400s — the KB with the most lint errors in the install is completely unreachable _( `/knowledge?id=trafficGame` )_
- **S1** `projects-02` — Project id is lowercased at discovery but every :id→path route re-joins the raw id, so a mixed-case project dir (projects/trafficGame) 404s on contract-stages, onboarding/active and onboarding start _( `/projects/trafficgame` )_
- **S2** `agents-05` — Run rows are labelled "Summary" / "Goal" / "Problem" / "Context" / "Overview" instead of the initiative name _( `/agents` )_
- **S2** `agents-10` — An unknown agent slug silently redirects to the blank /agents/new builder with no message _( `/agents/<unknown>` )_
- **S2** `artifact-plan-06` — /artifact?cycle=<id> is silently ignored — the page reads only ?run= and renders a convincing "Artifact not yet produced" for a run that exists _( `/artifact?cycle=<cycleId>` )_
- **S2** `artifact-plan-07` — Bare /artifact renders a fully-furnished artifact page for a run that does not exist, with no way to pick one _( `/artifact` )_
- **S2** `artifact-plan-08` — An unknown run id renders as if it were a valid, merely-unfinished run — 5 uncaught 404s in the console, no "run not found" state _( `/artifact?run=<unknown-id>` )_
- **S2** `community-11` `n5` — An unknown community id renders a valid-looking page (data-page=community-detail, page-ready=true) with a bare italic sentence and no way back except the browser _( `/community/<kind>/<id>` )_
- **S2** `crosscut-04` — Run pages for retired flow ids ("unknown", "release-refine") render a real-looking run page with an empty timeline _( `/flows/<unknown>/run/<id>` )_
- **S2** `crosscut-07` — A mistyped URL drops the operator on the bare Next.js 404 — no Studio nav, no branding, no way back _( `/knowledge/nope, /community/new, /totally-not-a-route` )_
- **S2** `crosscut-08` `n1` — Artifact page invents a plausible story for a run that does not exist, and silently coerces an unknown ?type= to PLAN _( `/artifact?cycle=<unknown>, /artifact?run=<unknown>&type=<…` )_
- **S2** `flows-04` `n4` — History ledger links to flow ids that do not exist (/flows/unknown/..., /flows/release-refine/...) _( `/flows/forge-architect` )_
- **S2** `flows-08` `n4` — Every run is labelled by the first markdown heading of its manifest — the rails read "Summary", "Goal", "Context", "Overview" _( `/flows/forge-architect` )_
- **S2** `flows-26` `n4` — The same initiative is named three different things on three screens _( `/flows/forge-architect` )_
- **S2** `knowledge-04` `n6` — An unknown ?id= silently shows a DIFFERENT KB with the wrong URL still in the address bar _( `/knowledge?id=<unknown>` )_
- **S2** `library-03` `n8` — Community skills are first-class cards in /skills but their detail route is a hard 404 dead-end _( `/skills/agent-browser` )_
- **S2** `projects-10` `n4` — Roadmap cards are titled with scraped section headings — 52 betterado initiatives read "Background", "Constraints", "Acceptance criteria" _( `/projects/<id> (Roadmap tab)` )_
- **S2** `projects-34` — trafficgame's KB exists as "trafficGame" but the project can never auto-bind it — the roster lowercases project ids while KB ids keep their case _( `/projects/trafficgame` )_
- **S3** `crosscut-10` `n5` — Not-installed community skills are linked from /skills but their detail page 404s the bridge and the "view it in the community browser" instruction is plain text, not a link _( `/skills/<community-only-id>` )_
- **S3** `crosscut-20` `n8` — "new" is a magic id on the dynamic routes, so the create/detail split leaks in both directions _( `/flows/nope, /projects/new, /templates/new, /connections/new` )_
- **S3** `crosscut-27` — Seven different not-found treatments for the same "unknown id" situation _( `/flows/nope, /agents/nope, /projects/nope, /skills/nope, …` )_
- **S3** `flows-16` — Unknown-flow monitor still shows the flow selector, which displays a DIFFERENT flow's name _( `/flows/no-such-flow` )_
- **S3** `home-sessions-18` — Home's "Onboard a project" CTA fires GET /api/studio/projects/new/preflight -> 404 "unknown project" because /projects/new is served by the [id] project route _( `/` )_
- **S3** `knowledge-30` `n6` — An unknown ?node=/?theme= deep link 404s twice and then silently shows the first KB with nothing selected _( `/knowledge?node=<unknown>` )_
- **S3** `projects-04` — The onboarding form fires per-project fetches for the pseudo-id "new" — GET /api/studio/projects/new/preflight 404s on every visit _( `/projects/new` )_
- **S3** `projects-23` — Showcase renders a normal "No showcase yet" page for a project that does not exist _( `/projects/<unknown>/showcase` )_
- **S3** `projects-30` — The literal id "new" is a reserved route with no server-side guard — a project slugged "new" would be permanently shadowed by the onboarding form _( `/projects/new` )_
- **S3** `sessions-kinds-18` — Unknown session kind renders as a normal session page, and an unknown id without ?project= reports "loading" in the DOM while showing "Session not found" _( `/sessions/not-a-kind/whatever, /sessions/<kind>/<unknown-id>` )_

### W7-B1 — Home + /sessions IA: named strips (sessions vs KBs needing attention), distinct visuals, truthful live counts, index refresh/filter/kickoff entry, honest needs-you signal

- **S1** `home-sessions-14` `n2` — "Active status" constellation reports "0 live" and paints all 28 hexes idle while 13 sessions are in flight and agents are actively running _( `/` )_
- **S1** `sessions-kinds-07` — On the demo session page the demo itself cannot be opened and "Finalize this generation" is permanently disabled ("Not available from this view") _( `/sessions/demo/<sid>` )_
- **S2** `crosscut-13` `n3` — The only in-app links to the session kickoff pages exist ONLY in the /sessions zero-state — with any session in flight there is no way to start a new one _( `/sessions` )_
- **S2** `home-sessions-01` `n2` — Attention strip has no heading at all — the operator cannot tell it is "knowledge bases needing attention" (it sits nameless under "Active sessions") _( `/` )_
- **S2** `home-sessions-02` `n2` — Session cards and KB-attention rows are visually identical (same panel, same amber border, same amber dot) so the two strips read as one list _( `/` )_
- **S2** `home-sessions-03` `n2` — The "needs you" dot lies in the DOM contract: it is hardcoded data-status="retrying" on Home cards AND on every /sessions row _( `/ · /sessions` )_
- **S2** `home-sessions-07` `n3` — /sessions has no filter, no sort, no search and no grouping — 13 rows today, capped at 200, all undifferentiated _( `/sessions` )_
- **S2** `home-sessions-12` `n3` — /sessions never refreshes: one fetch on mount, no WebSocket subscription, no poll — a session that finishes or a new one that starts is invisible until a manual reload _( `/sessions` )_
- **S2** `home-sessions-15` `n2` — The primary "Watch live run" CTA silently degrades to /flows — the same destination as the nav link — while still reading as though something is live _( `/` )_
- **S2** `home-sessions-31` `n2` — With no in-flight sessions Home hides the whole sessions strip, taking the only Home link to /sessions with it — the index survives solely on the Agents page _( `/` )_
- **S2** `home-sessions-33` `n2` — Home's Recent-activity ledger emits session PHASE strings in data-run-status, mixing eight vocabularies in one attribute _( `/` )_
- **S3** `community-21` `n3` — The sessions index labels the kind 'Community-Refresh' (mechanical title-case of the id) instead of the declared title 'Community refresh session' _( `/sessions` )_
- **S3** `community-24` `n3` — The 'needs you' indicator on a session row reuses data-status="retrying" — a status vocabulary token that means something else _( `/sessions` )_
- **S3** `home-sessions-19` `n5` — The /sessions empty state offers 6 kickoff kinds but omits community-refresh, which is a registered kickoff kind with a working /sessions/community-refresh/new page _( `/sessions` )_
- **S3** `home-sessions-20` `n3` — /sessions shows raw registry ids as the Kind label ("Kb-Cleanup", "Community-Refresh", "Project-Brain") instead of each descriptor's authored title _( `/sessions` )_
- **S3** `home-sessions-24` `n3` — The needs-you signal is an 8px colour-only dot whose meaning is available exclusively via a native title tooltip — no text, no aria-label, and the row itself is not clickable _( `/sessions` )_
- **S3** `home-sessions-25` `n2` — Recent activity is hard-capped at 30 rows with no pagination, no filter and no link to a full history _( `/` )_
- **S3** `home-sessions-26` — Both routes scroll horizontally below ~740px viewport width _( `/ · /sessions` )_
- **S3** `home-sessions-32` `n2` — The Home strip shows at most 4 cards but its header claims "11 need you" — the numbers never reconcile on screen _( `/` )_
- **S3** `sessions-kinds-05` — Kickoff context card leads with implementation jargon (agent slug, SKILL.md path, on-disk session directory) and has no cancel/back control _( `/sessions/*/new` )_

### W7-B2 — Knowledge + drain-to-green: live drain observability (per-finding status, activity, elapsed, cancel), structural-only auto-fix with draft-gated prose, one gated action menu, the two flow buttons fixed, recent-runs widget, kb-cleanup unstuck, New-KB flow honest

Pre-existing beads folded in: forge-vxg, forge-bz8, forge-6tx, forge-sqn, forge-9hq, forge-9kr.

- **S1** `knowledge-01` `n6` — Drain-to-green activity drawer says "Waiting for activity…" for the entire run (and forever after) — the drain job emits only start/end, and ALL real agent activity is logged under a different cycle id _( `/knowledge?id=<kb>&tab=health` )_
- **S1** `knowledge-02` `n6` — Drain status.json is only written at the END of each round, so the panel is frozen at 'round 0' for the whole of round 1 (many minutes of real agent turns) _( `/knowledge?id=<kb>&tab=health` )_
- **S1** `knowledge-10` `n6` — REAL RUN: 'Drain to green' reports GREEN on a project KB while the health panel 6cm below still says 3 lint flags — the drain and the health readout use two different lint scopings _( `/knowledge?id=gitpulse&tab=health` )_
- **S1** `knowledge-11` `n6` — REAL RUN: 44 seconds of a screen that says literally nothing, then a frozen snapshot for another 38s — measured on a live drain _( `/knowledge?id=forge-dev&tab=health` )_
- **S1** `knowledge-V01` `n6` — New-KB create only checks brain/<id>/ for a collision, never the second root brain/projects/<id>/ — naming a new project-bound KB after an already-onboarded project silently shadows its REAL central ADR-035 brain _( `/knowledge/new` )_
- **S1** `orch-01` `n6` — Drain-to-green (brain-fix agent) lossy-rewrites theme prose to clear lint flags: brain-read-policy.md lost 26 lines (R1-01/R1-06 amendment text, Sources section, 2026-07-17 path-correction history) with no diff shown, no approval gate, no undo _( `/knowledge?id=forge-dev&tab=health` )_
- **S2** `knowledge-05` `n6` — Five KB-mutating buttons on one screen are gated only against themselves — Refresh index / Consolidate / Cleanup plan / Delete / Drain to green can all be fired simultaneously _( `/knowledge?id=<kb>&tab=health` )_
- **S2** `knowledge-06` `n6` — 'Refresh index' on a per-KB screen regenerates the GLOBAL brain/INDEX.md, not this KB's index _( `/knowledge?id=<kb>&tab=health` )_
- **S2** `knowledge-08` `n6` — Drain finding rows show only the message, so two findings in different files render as identical duplicate lines _( `/knowledge?id=<kb>&tab=health` )_
- **S2** `knowledge-09` `n6` — Two full-width invisible link targets (LINT block and CHECKS block) both scroll to the same #kb-drain-panel — they look like static readouts, not controls _( `/knowledge?id=<kb>&tab=health` )_
- **S2** `knowledge-12` `n6` — A finished drain shows only the LAST round's findings — everything the earlier rounds did is discarded from the UI _( `/knowledge?id=<kb>&tab=health` )_
- **S2** `knowledge-13` `n6` — The activity drawer's one and only event fetch races the drain's log-dir creation and 404s, with no retry _( `/knowledge?id=<kb>&tab=health` )_
- **S2** `knowledge-14` `n6` — There is no way to cancel or abandon a running drain, and no elapsed-time or ETA anywhere _( `/knowledge?id=<kb>&tab=health` )_
- **S2** `knowledge-15` `n6` — The drain poll gives up after 3 minutes and shows 'timed-out' even though the run is still going — a realistic 5-round drain always hits this _( `/knowledge?id=<kb>&tab=health` )_
- **S2** `knowledge-19` `n7` — 'Cleanup plan' and 'Consolidate' are the two new flow-ish buttons on the KB screen and neither closes its loop: one leads to a dead session, the other gives a 6-second pill and vanishes _( `/knowledge?id=<kb>&tab=health` )_
- **S2** `knowledge-20` `n7` — No 'recent runs' widget on the KB screen — every drain / consolidate / cleanup / fix run this KB has ever had is invisible once its transient pill clears _( `/knowledge?id=<kb>&tab=health` )_
- **S2** `knowledge-21` `n6` — The Ingest Activity tab — one of only three tabs on the KB screen — is empty for EVERY KB and structurally cannot be anything else in this install _( `/knowledge?tab=ingest-activity` )_
- **S2** `knowledge-22` `n6` — The New-KB form marks Description optional but the create route rejects an empty one with a 400 _( `/knowledge/new` )_
- **S2** `knowledge-23` `n6` — Creating a KB silently spawns a project-brain SEEDING session the operator is never told about, and dumps them on a different KB _( `/knowledge/new` )_
- **S2** `knowledge-24` `n6` — Deleting a KB from the UI removes brain/<id>/ only and orphans its seeding + cleanup sessions _( `/knowledge?id=<kb>` )_
- **S2** `knowledge-28` `n6` — KB HEALTH contradicts itself: '79 orphan nodes (degree 0)' with an amber dot, six lines above 'checkOrphans pass' _( `/knowledge?id=cycles&tab=health` )_
- **S2** `knowledge-29` `n6` — 'Pin guidance' promises the note 'will be consumed on the next ingest pass', but no ingest has ever run in this install and nothing on the KB screen ever shows the note again _( `/knowledge?id=<kb>&tab=health` )_
- **S2** `knowledge-32` `n6` — Three separate controls all end in the same brain-fix agent turns over the same findings, with nothing explaining the difference _( `/knowledge?id=<kb>&tab=health` )_
- **S3** `crosscut-15` — Every agent detail page and the KB health tab fire a guaranteed-404 GET /api/events/ (empty id) and open a WebSocket for nothing _( `/agents/*, /knowledge?tab=health` )_
- **S3** `knowledge-07` `n6` — Every KB Health page load fires GET /api/events/ (empty cycle id) -> 404, one console error per load _( `/knowledge?id=<kb>&tab=health` )_
- **S3** `knowledge-26` `n3` — Neither model-tier radio is pre-selected on the kb-cleanup kickoff, and the session then reports 'model: default' _( `/sessions/kb-cleanup/<id>` )_
- **S3** `knowledge-31` `n6` — 'Pin guidance' is the only control on the KB screen with no data-action attribute _( `/knowledge?id=<kb>&tab=health` )_
- **S3** `knowledge-33` `n7` — Two entry points to a kb-cleanup session disagree: the KB header button skips the model-tier choice the /sessions/kb-cleanup/new form insists on _( `/knowledge?id=<kb>&tab=health` )_

### W7-B3 — Community: refresh agent that works (write root, turn budget, verdict panel, session link, freshness), targeted "find me skills for X" search, registry CRUD in Studio, honest install paths, community↔library consistency

- **S1** `community-01` `n5` — community-refresh agent wrote its draft into the repo (studio/community/staging/), the runner then crashed, and the session is stuck in 'gathering' forever _( `/sessions/community-refresh/<id>` )_
- **S1** `community-13` `n5` — A real sonnet community-refresh run ended after exactly 16 tool calls (= runAgentTurn's maxTurns default) with no draft written, then died with the same 'produced no files' error _( `/sessions/community-refresh/new` )_
- **S1** `community-14` `n5` — community-refresh is missing from GENERIC_PANEL_KINDS, so the approve/reject verdict on a registry draft has no UI at all — the whole W6-CR-3 loop is unreachable even on the happy path _( `/sessions/community-refresh/<id>` )_
- **S1** `home-sessions-06` `n5` — Root cause of the two wedged sessions: the community-refresh agent wrote its staging package OUTSIDE the session dir and the declared write-root fence did not stop it _( `/sessions` )_
- **S1** `sessions-kinds-06` `n5` — community-refresh sessions render NO interaction panel at all — its approve/reject verdict is unreachable, so a refresh draft can never be committed from the UI _( `/sessions/community-refresh/2026-08-18T12-54-32-abdfd26b?…` )_
- **S1** `sessions-kinds-32` `n5` — ROOT CAUSE of "the refresh-registry agent does nothing": the agent writes its draft to studio/community/staging/ instead of the session's staging dir, the runner throws, and the session hangs at `gathering` forever with zero UI signal _( `/sessions/community-refresh/2026-08-18T12-54-32-abdfd26b?…` )_
- **S2** `community-03` `n5` — Every one of the 20 community items reads 'seed — never verified' because nothing has ever committed a refresh; the freshness badge, the Updated sort and the whole W6-CR-2 freshness feature are inert _( `/community` )_
- **S2** `community-08` `n5` — No way to ask for a targeted search — the community-refresh kickoff has no prompt field, so 'find me skills for X' is unreachable from the UI _( `/sessions/community-refresh/new` )_
- **S2** `community-09` `n5` — 9 of the 10 community skills cannot be installed at all — browse leads to a dead end with no next step _( `/community` )_
- **S2** `community-16` `n5` — /community has no link to any refresh session — the operator can start one but can never find it again from the community surface _( `/community` )_
- **S2** `community-18` `n5` — An mcp/tool community item never links to its own /connections/<id> page — even the three tools that are already INSTALLED _( `/community/<kind>/<id>` )_
- **S2** `community-19` `n5` — The MCP Install button fires a real, unconfirmed `npm install` child process (120s, network) straight from a browse page — no confirmation, no progress, no log _( `/community/mcp/<id>` )_
- **S2** `community-23` `n5` — The registry is a 9-row hand-curated file with no add/edit/remove path in Studio — the only writer is an agent whose commit path has never once executed _( `/community` )_
- **S2** `community-25` `n5` — The skill library reports the 9 uninstallable community skills as trust:'ready' and paletteVisible:true — the exact opposite of what /community says about the same objects _( `/community` )_
- **S2** `library-11` `n5` — /hooks does not union community hooks the way /skills unions community skills — the vendored community hook is invisible there _( `/hooks` )_
- **S2** `library-21` `n8` — A skill authored locally by the creation agent is badged COMMUNITY on the skills index _( `/skills` )_
- **S2** `library-31` `n5` — A skill that exists in the local library is reported "not installed" by the community browser, and installing it is a silent no-op that never clears the badge _( `/skills ↔ /community/skill/handoff` )_
- **S3** `community-04` `n5` — 'Sort: Updated' sorts by fetchedAt (when forge last checked) not by upstreamUpdatedAt (when the item changed), and upstreamUpdatedAt is parsed over the wire but never rendered anywhere _( `/community` )_
- **S3** `community-05` `n5` — Community search matches only name+desc — it misses id, category, provenance and hub, so obvious queries return nothing _( `/community` )_
- **S3** `community-10` `n5` — Every non-vendored item renders an empty 'PACKAGE — No files in this package. Nothing to display.' section for a package that structurally cannot exist _( `/community/skill/<id>` )_
- **S3** `community-12` `n5` — Kickoff shows no default model tier (neither radio checked) yet Start is enabled, and the session directory reads as a literal placeholder _( `/sessions/community-refresh/new` )_
- **S3** `community-17` `n5` — The hub strip lists 4 hubs with 0 items that nothing will ever populate, and gives no hint that a hub is a static declaration rather than something forge browses _( `/community` )_
- **S3** `community-22` `n5` — The kickoff page renders an 'Opened from initiative …' context card for any ?initiative= value, including one that does not exist _( `/sessions/community-refresh/new` )_
- **S3** `library-27` `n9` — The Library Skills shelf can never show a community skill, though its count includes them _( `/library` )_

### W7-B4 — Library authoring: edit/rename/delete for skills + hooks, create/edit/duplicate/delete for templates, connection config edit, remove the KB card, one authoring entry, agent builder edit/delete/collision/phase, flow builder starter/validation/delete/no-kickoff-loss

- **S1** `agents-18` `n8` — An agent created in the Studio agent builder can NEVER run — the builder writes no `phase` and dispatch refuses the spec _( `/agents/new` )_
- **S1** `agents-22` `n5` — Every interactive agent's page says "no reachable session entry point yet" even though /sessions/<kind>/new exists and works _( `/agents/community-refresh` )_
- **S1** `agents-28` `n8` — Creating a "new" agent whose name normalises to an existing slug SILENTLY OVERWRITES that agent — no warning, no 409, no undo _( `/agents/new` )_
- **S1** `flows-09` — The starter canvas a new flow is seeded with cannot be saved — it references three agents that do not exist _( `/flows/new` )_
- **S1** `flows-10` — Flow save failures show only the words "validation failed" — the server's per-node findings are thrown away by the client _( `/flows/new` )_
- **S1** `flows-12` — Saving an OOTB flow from the BUILD tab silently deletes its kickoff declaration (and every comment in the seed file) _( `/flows/forge-develop (BUILD tab)` )_
- **S1** `library-05` `n8` — A skill created in Studio can never be edited, renamed or deleted from Studio _( `/skills/<id>` )_
- **S1** `library-08` `n8` — Hooks are create-only too — no edit, no delete, and no way to revoke an approval or an override _( `/hooks/<id>` )_
- **S1** `library-17` `n8` — Templates have no create, edit, duplicate or delete path anywhere in Studio — the shelf is read-only by construction _( `/templates · /templates/<id>` )_
- **S2** `agents-08` — "Generate draft" silently replaces the agent's whole authored instructions with an 849-char boilerplate — no confirm, no diff, no undo _( `/agents/<slug>` )_
- **S2** `agents-09` `n8` — No way to delete or duplicate an agent anywhere in Studio _( `/agents/<slug>` )_
- **S2** `agents-14` — "At least one skill" makes 5 of the 12 shipped OOTB agents permanently read not-ready, including agents that run in production flows _( `/agents/<slug>` )_
- **S2** `agents-15` — "DEFINITION PREVIEW / YAML" is neither the definition nor valid YAML — it shows display names instead of ids and omits half the frontmatter _( `/agents/<slug>` )_
- **S2** `agents-24` — Server-computed capability facts stay stale after Save — the cost-ceiling field keeps saying "can't enforce" until a full page reload _( `/agents/<slug>` )_
- **S2** `agents-25` — Studio offers a primary "Run agent" button for declaration-only agents that are not meant to run — and it charges for it _( `/agents/contract-check` )_
- **S2** `flows-11` `n4` — An authored flow can never be deleted (or run) from Studio — the authoring loop does not close _( `/flows/w7-throwaway-flow` )_
- **S2** `flows-13` — Naming a new flow after an existing one silently overwrites that flow — no duplicate check, no confirmation _( `/flows/new` )_
- **S2** `flows-24` — Artifact chips in the builder palette cannot be dropped on anything — the instruction under them is false _( `/flows/new` )_
- **S2** `library-01` `n8` — Library shelves are read-only for Connections and Templates — no create/edit path anywhere in Studio _( `/library` )_
- **S2** `library-04` `n8` — Skill cards carry data-skill-installed in the DOM but render no visible installed/not-installed marker _( `/skills` )_
- **S2** `library-07` `n8` — Studio writes authored skills straight into the live forge working tree with no commit — they show up as untracked churn _( `/skills/new` )_
- **S2** `library-09` `n8` — An approved hook renders with no badge and no approval record — approved and unapproved look the same once the button vanishes _( `/hooks` )_
- **S2** `library-10` `n8` — Both OOTB hooks ship permanently inert — needs-review and bound to zero agents — with nothing on the page saying so _( `/hooks` )_
- **S2** `library-14` `n8` — "Install" on an MCP connection runs a real networked npm install into the forge tree with no preview and no confirmation _( `/connections/<id>` )_
- **S2** `library-15` `n6` — "Re-check" (probe) gives no feedback when the result is unchanged — no timestamp, no toast, nothing moves _( `/connections/<id>` )_
- **S2** `library-18` `n8` — Template detail is the only library detail page whose "used by" and producer/consumer entries are dead text instead of links _( `/templates/<id>` )_
- **S2** `library-22` `n8` — Approving an authored package with a non-slug id returns 500 and dumps a raw InteractiveRunnerError into the UI _( `/sessions/authoring/<id>` )_
- **S2** `library-23` `n8` — Two different entry points into the same authoring session, with different capabilities and no cross-link _( `/skills/new · /hooks/new · /sessions/authoring/new` )_
- **S2** `library-24` `n8` — The creation agent promises "iterate on operator feedback" but the authoring session has no revise turn — approve or abandon only _( `/sessions/authoring/<id>` )_
- **S2** `projects-06` `n8` — A project-local skill can be unbound but never re-bound — the skills library lists only forge-wide skills, and its search does not match skill ids _( `/projects/gitpulse` )_
- **S3** `agents-16` — Clicking a palette component while "Advanced" is collapsed binds it invisibly — the chip lands in a hidden section _( `/agents/<slug>` )_
- **S3** `agents-34` — The starter picker is a one-way door and pre-fills a generic name ("Dev") that would become the agent slug _( `/agents/new` )_
- **S3** `agents-42` — "coming soon" SDK cards look and behave like live options — clicking them only produces a toast with no route to enable them _( `/agents/<slug>` )_
- **S3** `flows-22` — "+ add" trigger button is permanently disabled until an unrelated dropdown is set, with no reason shown _( `/flows/new` )_
- **S3** `flows-27` — Unsaved canvas edits are discarded silently when leaving the BUILD tab _( `/flows/new` )_
- **S3** `library-02` `n9` — Knowledge-bases cross-link card still on /library (operator asked for its removal) _( `/library` )_
- **S3** `library-06` `n8` — Skill name accepts arbitrary characters and is stored verbatim while the id is silently sanitised _( `/skills/new` )_
- **S3** `library-12` `n8` — Hook script field implies any shebang works, but the runtime always spawns bash _( `/hooks/new` )_
- **S3** `library-16` `n6` — Re-check can double-fire: two concurrent probe requests from a fast double click _( `/connections/<id>` )_
- **S3** `library-19` `n8` — The PREVIEW section previews nothing — it renders a decorative aria-hidden glyph, not the template _( `/templates/<id>` )_
- **S3** `library-20` `n8` — 8 of 17 templates render "No description." — every planning template and every project scaffold _( `/templates` )_
- **S3** `library-25` `n8` — An authored skill is listed under the drafted `name`, never the library id the operator typed — you cannot find it by the id you chose _( `/skills/<id>` )_
- **S3** `library-28` `n8` — The Skills lede explains only two of the three provenance paths — an agent-authored skill also starts as a draft _( `/skills` )_
- **S3** `library-29` `n8` — File-package tabs are labelled with the basename only, hiding the directory that gives the file its meaning _( `/templates/<id> · /skills/<id> · /hooks/<id>` )_
- **S3** `library-30` `n8` — Create skill stays enabled for a name that cannot produce a valid id — the operator learns only from a server round-trip _( `/skills/new` )_
- **S3** `library-33` `n8` — A hook can be authored, scanned and approved but there is no way to test-fire it or see that it ever ran _( `/hooks/<id>` )_

### W7-B5 — Agents + runs: live run page (poll/tail/thinking), error text + cost ceiling gate for every agent, outputs wired or removed, run-panel double-fire, history ledger usable, recent-runs shows the agent + real cost, onboarding run panel honest

Pre-existing beads folded in: forge-75j (typed outputs no source), forge-irn, forge-7wc, forge-8nw.

- **S1** `agents-03` `n7` — "Recent agent runs" shows an arbitrary node's cost/status/link for a run — $0.00 for a run that actually cost $4.79 _( `/agents` )_
- **S1** `agents-06` — The standalone run page "Outputs" section is hard-wired to empty — it can never show anything _( `/agents/<slug>/run/<runId>` )_
- **S1** `agents-07` `n6` — The dedicated run page never refreshes — a live run's log is frozen at page load with no poll and no refresh control _( `/agents/<slug>/run/<runId>` )_
- **S1** `agents-19` `n3` — A failed agent run surfaces only the word "failed" — the error message is never rendered anywhere in Studio _( `/agents/<slug>` )_
- **S1** `agents-20` `n6` — The live "thinking" drawer on an agent run never shows anything — the bridge never tails a standalone agent run log _( `/agents/<slug>` )_
- **S1** `agents-21` — Six of twelve agents (incl. developer-ralph) dispatch with NO cost ceiling and the Run button gives no warning _( `/agents/<slug>` )_
- **S1** `agents-30` `n3` — A running agent cannot be cancelled from anywhere in Studio _( `/agents/<slug>` )_
- **S1** `projects-29` `n3` — Onboarding-agent poll gives up ("timed-out") ~50s BEFORE a normal successful run finishes, then reports "running" again after a reload — and no run can be cancelled _( `/projects/<id> (Onboarding agent)` )_
- **S2** `agents-01` — Every agent detail page fires GET /api/events/ (empty cycle id) → 404 + red console error on load _( `/agents/<slug>` )_
- **S2** `agents-04` `n7` — "Recent agent runs" rows never say WHICH agent ran — the one fact the section exists to show _( `/agents` )_
- **S2** `agents-13` — The READINESS checklist shows pass/fail only as a CSS class + coloured dot — no text, no aria, no data attribute _( `/agents/<slug>` )_
- **S2** `agents-23` `n6` — A completed agent run leaves no record of what the agent actually did — only start and end lines _( `/agents/<slug>/run/<runId>` )_
- **S2** `agents-26` — After dispatching, the Run panel shows the runId as plain text with no link to the run page — and forgets the run entirely on reload _( `/agents/<slug>` )_
- **S2** `agents-29` — "Run agent" is re-enabled the instant the dispatch POST returns — double-clicking starts two concurrent runs and the panel forgets the first _( `/agents/<slug>` )_
- **S2** `agents-31` — "Cost ceiling: No cost ceiling was recorded for this run" is shown for every non-completed run even when a ceiling was submitted and enforced _( `/agents/<slug>/run/<runId>` )_
- **S2** `agents-32` `n7` — The HISTORY ledger crams every run (up to 77) into a 220px scroller with no filter, no paging and a mixed status vocabulary _( `/agents/<slug>` )_
- **S2** `agents-39` `n7` — The "recent agent runs" widget downloads 1.33 MB across 13 requests to render 20 rows _( `/agents` )_
- **S2** `projects-36` `n4` — A COMPLETED onboarding run leaves no trace on the project page — the panel resets to idle with no history, cost, or link to what it changed _( `/projects/<id> (Onboarding agent)` )_
- **S2** `sessions-kinds-34` — The multi-stage session (onboarding) publishes data-session-selector-visible="true" but no stage selector is ever rendered — 4 of its 5 stages are unreachable _( `/sessions/onboarding/2026-08-18T13-50-40-85c41b64?project…` )_
- **S3** `agents-02` — Empty-slug history request GET /api/agents//history fires on every agent page and the bridge answers 200 _( `/agents/<slug>` )_
- **S3** `agents-17` — Segmented runtime controls disagree on how they expose active state (data-active vs a CSS class) _( `/agents/<slug>` )_
- **S3** `agents-33` — A seeded test fixture run appears in the real agent history ledger _( `/agents/architect` )_
- **S3** `agents-36` — The connection-block message names an unavailable connection but gives no link to fix it _( `/agents/<slug>` )_
- **S3** `agents-38` — The agents roster has no search, filter or grouping, and every card claims provenance "unknown" _( `/agents` )_
- **S3** `agents-40` `n7` — The "Recent agent runs" section exposes no count/empty/limit state and no link to a full history _( `/agents` )_
- **S3** `agents-41` — Advanced-panel option cards are bare <div tabIndex=0> with no role and no selected state exposed _( `/agents/<slug>` )_
- **S3** `projects-31` — The onboarding agent is dispatched with no operator brief — its prompt.md is literally "(no inputs provided)" _( `/projects/<id> (Onboarding agent)` )_

### W7-B6 — Projects: greenfield create data-loss + git init, gitpulse config migration surfaced/applied, contract errors surfaced, architect kickoff tier+ceiling+validated project, showcase + cycle ledger + roadmap loop links, session factory shows open sessions

- **S1** `projects-01` — gitpulse (the canonical verify-cycle ground) 409s on contract-stages — its .forge/project.json still uses the pre-R1-03 flat gate keys _( `/projects/gitpulse` )_
- **S1** `projects-11` — Onboarding never git-inits a project created under projects/ — the new project silently inherits FORGE's own git repo _( `/projects/new` )_
- **S1** `projects-35` — DATA LOSS: the greenfield "Create project" form silently DELETES an existing project (and its brain) when the name collides — returns 200 and opens the wiped project _( `/projects/new (Or create a new project)` )_
- **S2** `crosscut-21` `n4` — Architect entry accepts an unknown project and enables "Start architect" — and its project picker offers project NAMES while every link carries project IDS _( `/architect/new?project=<id>` )_
- **S2** `projects-05` — Unsaved project-editor edits are discarded silently by any navigation — nav link, project switcher, or tab close _( `/projects/<id>` )_
- **S2** `projects-08` `n4` — Projects index shows no health, activity or progress — a contract-broken project is indistinguishable from a healthy one, and there is no filter/sort/search _( `/projects` )_
- **S2** `projects-12` — The quality-gate command is accepted and reported green without ever being validated — an unrunnable gate passes preflight C1 _( `/projects/new` )_
- **S2** `projects-14` — The architect kickoff — the most expensive agent — is the only kickoff with no model-tier picker and no cost ceiling _( `/architect/new` )_
- **S2** `projects-15` `n4` — The architect kickoff accepts ANY project string — a typo creates a phantom project directory (and spawns a real agent turn against it) _( `/architect/new` )_
- **S2** `projects-18` `n4` — The only path to an initiative's actions is clicking its node on a 52-node canvas — nothing lists "what needs me now" _( `/projects/<id> (Roadmap tab)` )_
- **S2** `projects-19` `n3` — The project page is a session factory: every agent button mints a NEW session, the page never shows or resumes the ones already open, and none can be cancelled _( `/projects/<id>` )_
- **S2** `projects-21` `n4` — Showcase is a dead end: zero controls, no link to the cycle/run/PR, no cycle picker, and the empty state offers no way to capture a demo _( `/projects/<id>/showcase` )_
- **S2** `projects-25` `n6` — "Run onboarding agent" stays enabled while its own run is in flight — two concurrent onboarding agents can be dispatched at the same project _( `/projects/<id>` )_
- **S2** `projects-28` `n4` — "Demo machinery needed" banner fires after EVERY save and its only remedy is a terminal command _( `/projects/<id>` )_
- **S2** `sessions-kinds-02` — Kickoff "Project" field is unvalidated free text — a typo silently creates a phantom project directory _( `/sessions/{instructions,demo,authoring,project-brain}/new` )_
- **S2** `sessions-kinds-03` — Architect — the most expensive session kind — is the ONLY kickoff with no model-tier picker _( `/architect/new` )_
- **S3** `crosscut-25` — Disabled primary CTAs explain themselves on three create surfaces and stay silent on the other three _( `/architect/new, /sessions/*/new, /projects/new (greenfiel…` )_
- **S3** `projects-07` — Skill-chip remove control is a bare <span> — not focusable, no role, no aria-label _( `/projects/<id>` )_
- **S3** `projects-09` — "Start a greenfield project" CTA only exists in the empty state, so an operator with projects never learns the greenfield path exists _( `/projects` )_
- **S3** `projects-13` — Onboarding form contradicts itself about symlinked repos: the lede says "clone or symlink it under projects/ first", the repo-path help says a symlink is rejected _( `/projects/new` )_
- **S3** `projects-20` `n4` — "Run a flow" select is inert — the chosen flow is passed as ?flow= and nothing ever reads it _( `/projects/<id> (Run a flow)` )_
- **S3** `projects-22` — Showcase stats strip shows "TESTS 0" whenever the demo model carries no testEvidence block — reads as "zero tests" _( `/projects/<id>/showcase` )_
- **S3** `projects-24` `n6` — Contract-gap resolution: while one clause runs every other clause's buttons are disabled with no reason, and a cleared clause just vanishes with no record of what the agent wrote _( `/projects/<id> (Resolve contract gaps)` )_
- **S3** `projects-26` — A successful save does not refresh the page's own roster — the project switcher keeps showing the old name until a reload _( `/projects/<id>` )_
- **S3** `projects-27` — Cycle Ledger renders "—" for every row's date and cost — GET /api/cycles carries neither, though the cycleId itself embeds the timestamp _( `/projects/<id> (Cycle Ledger)` )_
- **S3** `projects-33` — A FAILED initiative card still shows a green "✓ HH:MM" badge _( `/projects/<id> (Roadmap tab)` )_
- **S3** `sessions-kinds-04` — Architect kickoff card is off-palette and unlabelled: hardcoded GitHub hexes, green button, duplicated title, placeholder-only fields _( `/architect/new` )_

### W7-B7 — Artifact + verdict pages: verdict trail/blank states, gate arming only on gate-able runs, demo gate fixed, PR link, review comments edit/delete, plan AC parse + plan.json path decision, DEMO.md on evidence page, reflection honesty

Pre-existing beads folded in: forge-2w4.

- **S1** `artifact-plan-18` `n1` — The DEMO gate bar is dead on every real run — it posts the cycleId where the bridge expects an INIT- initiative id, gets 400, and shows nothing _( `/artifact?run=<cycleId>&type=demo (auto-gate)` )_
- **S2** `artifact-plan-11` — The verdict.json trail chip reads "Not yet produced" on EVERY run — including merged ones whose verdict the same page renders as "✓ Approved by operator" _( `/artifact?run=<cycleId>&type=verdict (trail)` )_
- **S2** `artifact-plan-12` — Verdict in view mode with no verdict.json renders a completely blank page — no empty state, no explanation _( `/artifact?run=<cycleId>&type=verdict&mode=view` )_
- **S2** `artifact-plan-13` — A cycle that never reflected is presented as a clean reflection: "WENT WELL None logged · FRICTION None logged · LESSONS None logged · INCONSISTENCIES ✓ None — closes clean" _( `/artifact?run=<failed-cycle>&type=reflection` )_
- **S2** `artifact-plan-14` — A live "approve and merge" button is armed on runs that are already complete-and-merged and on runs that FAILED _( `/artifact?run=<cycleId>&type=verdict&mode=gate` )_
- **S2** `artifact-plan-15` — Review comments cannot be edited or deleted, and a non-blocking comment can never be cleared _( `/artifact?run=<cycleId>&type=verdict&mode=gate` )_
- **S2** `artifact-plan-17` — The PR artifact page has no link to the actual pull request and no control of any kind _( `/artifact?run=<cycleId>&type=pr` )_
- **S2** `artifact-plan-19` `n1` — plan.json is never produced by anything — the structured PlanRenderer and the whole "resolve design decisions before approving" gate are dead paths, and every plan page burns two 404s _( `/artifact?run=<any>&type=plan` )_
- **S2** `artifact-plan-29` `n1` — Every PLAN the operator is asked to approve renders "ACCEPTANCE CRITERIA — No GWT blocks parsed" — the plan's primary review evidence is missing on 100% of plans _( `/artifact?run=<any>&type=plan (PLAN.html body)` )_
- **S2** `artifact-plan-31` — The review gate is a 14,000px wall with 36 identical "+ comment" buttons and the only verdict control at the very bottom — and unlike the plan/demo gates it is NOT sticky _( `/artifact?run=<cycleId>&type=verdict&mode=gate` )_
- **S2** `artifact-plan-32` — The human-readable DEMO.md narrative is only rendered inside the review GATE — the demo-evidence artifact page never shows it _( `/artifact?run=<cycleId>&type=demo (view)` )_
- **S2** `artifact-plan-V01` `n1` — Fixing artifact-plan-18's initiativeId bug alone would NOT fix the DEMO gate bar — GateBar's demo-gate body is also missing the `rationale` (Approve) and `acceptanceCriteria` (Send-back) fields applyReviewVerdict requires _( `/artifact?run=<cycleId>&type=demo&mode=gate (GateBar)` )_
- **S2** `flows-14` — The per-work-item drawer reports the whole dev phase cost as each work item's cost _( `/flows/forge-develop` )_
- **S3** `artifact-plan-16` — review-findings.json 404s on every existing cycle and the adversarial-review panel silently renders nothing _( `/artifact?run=<cycleId>&type=verdict` )_
- **S3** `artifact-plan-20` — "You can still approve or send back below" is shown on artifact types that have no gate bar at all _( `/artifact?run=<id>&type=workitems|pr|reflection&mode=gate` )_
- **S3** `artifact-plan-24` — The reflection Submit button is disabled with no reason shown until all questions are answered _( `/artifact?run=<cycleId>&type=reflection` )_
- **S3** `artifact-plan-25` — The no-demo verdict fallback form posts the raw run.initiativeId without the cycle-id recovery its sibling surface applies _( `/artifact?run=<cycleId>&type=verdict&mode=gate (no demo.j…` )_
- **S3** `artifact-plan-26` — The artifact viewer has no way to open the underlying file, copy it, or jump to the cycle log _( `/artifact (all types)` )_
- **S3** `artifact-plan-30` `n1` — The rendered PLAN tells the operator to approve on a screen that no longer exists _( `/artifact?run=<any>&type=plan (PLAN.html body)` )_

### W7-C1 — Flows pillar consolidation: retire the Reflect flow (reflector as an agent run + post-merge trigger), onboard-project flow vs onboarding session dedupe, per-flow history scoping, flows index recent-runs/attention

- **S2** `flows-17` `n10` — The Reflect flow monitor is a read-only mirror of Develop history with no Run control — the flow itself is vestigial _( `/flows/forge-reflect` )_
- **S2** `flows-19` `n7` — The flows index has no recent-runs view, no queued/attention signal and no filter — unlike the agents index _( `/flows` )_
- **S2** `flows-20` `n4` — Two onboarding entry points, one of them dead: the onboard-project FLOW versus the onboarding SESSION _( `/flows/onboard-project` )_
- **S2** `flows-21` `n4` — Every flow monitor shows the same 60-run history — the architect and reflect monitors are indistinguishable from develop _( `/flows/forge-architect` )_
- **S3** `agents-27` `n10` — release-finalizer and project-scoped-review are shipped agents that belong to no flow and have no other entry point _( `/agents/<slug>` )_
- **S3** `crosscut-14` — Orphan route /sessions/onboarding/new renders "Session kind 'onboarding' has no kickoff entry" and is linked from nowhere _( `/sessions/onboarding/new` )_
- **S3** `flows-18` — Flow card trigger badge renders as "MERGED", which reads as a run status _( `/flows` )_
- **S3** `flows-25` — data-can-start="true" on every existing flow, including flows that cannot be started _( `/flows/onboard-project` )_
- **S3** `flows-32` `n7` — The flows pillar is blind to everything that is not a queue manifest — KB/agent work never appears _( `/flows` )_
- **S3** `sessions-kinds-01` `n4` — Onboarding is a first-class session kind but its kickoff page is a dead end ("no kickoff entry") _( `/sessions/onboarding/new` )_

### W7-C2 — Interview + verdict richness: per-question forms, revise verdict on every draft kind, rationale capture, AGENTS.md diff, authoring revise turn

Pre-existing beads folded in: forge-lzv (per-question form), forge-4ei (revise verdict).

- **S1** `sessions-kinds-19` `n3` — Answering an interview turn OVERWRITES the questions in the durable record — the transcript afterwards shows the agent asking "Operator response" _( `/sessions/instructions/<sid>` )_
- **S2** `sessions-kinds-09` `n1` — Instructions verdict offers only Approve/Reject — the "revise" round-trip the runner supports is unreachable, so a nearly-right AGENTS.md must be committed or thrown away _( `/sessions/instructions/2026-08-14T15-15-59-0596d6f6?proje…` )_
- **S2** `sessions-kinds-17` — Structured interview questions are flattened into one unlabelled "Answer" box, and the answer is posted back under the literal question text "Operator response" _( `/sessions/instructions/<sid> (awaiting-answers)` )_
- **S2** `sessions-kinds-21` — "Abandon" destroys a completed brain draft on a single click with no confirmation, and is styled more prominently than the commit it sits next to _( `/sessions/project-brain/<sid> (awaiting-review)` )_
- **S2** `sessions-kinds-23` — An authoring draft can only be approved — no reject, no revise, and Approve is disabled with no visible reason until an id is typed _( `/sessions/authoring/<sid> (awaiting-review)` )_
- **S2** `sessions-kinds-29` — Verdicts capture no rationale — rejecting a draft records nothing about why, so the next run repeats the mistake _( `/sessions/<kind>/<sid> (verdict phases)` )_
- **S3** `sessions-kinds-22` — The project-brain session shows the same seven draft files twice — as accordions on the left and as tabs in the artifact pane on the right _( `/sessions/project-brain/<sid>` )_
- **S3** `sessions-kinds-30` — The AGENTS.md verdict screen never says where the file will be written, and offers no diff against the existing instructions _( `/sessions/instructions/<sid> (awaiting-verdict)` )_

### W7-C3 — Cross-cutting polish + a11y: per-route titles, breadcrumbs, focus/contrast/landmarks, disabled-CTA reasons, --accent token, event phase labels, narrow-viewport overflow, duplicate poll fan-out

Pre-existing beads folded in: forge-opj (forge-ui tests untypechecked), forge-cv9, forge-i9w, forge-0u4.

- **S2** `crosscut-06` — Every page in Studio has the same browser tab title, "forge" _( `every route` )_
- **S2** `crosscut-16` — The closed phase drawer is parked off-canvas at right:-540 but stays in the tab order and the accessibility tree with placeholder content _( `/flows/<id> (PhaseDrawer)` )_
- **S2** `crosscut-17` — Native form controls have no visible keyboard focus indicator — the focus-visible rule covers only .btn/.chip/.tab/a, and .input kills the outline outright _( `all form-bearing routes` )_
- **S2** `crosscut-24` — The --faint text token fails WCAG AA contrast (2.78–3.37:1) and carries most of the metadata layer at 9.5–11px _( `all routes` )_
- **S2** `sessions-kinds-V02` — Primary buttons across 4 Studio surfaces reference an undefined CSS custom property (--accent) and silently render with a transparent background _( `/sessions/project-brain/<sid>, /projects/[id], /flows/[id]` )_
- **S3** `agents-35` — No <h1> and no per-page <title> on any agents route; the run page has no <main> landmark and several form controls have no label _( `/agents (all)` )_
- **S3** `crosscut-18` — No skip-to-content link, the top nav has no aria-label, and 19 of 42 sampled routes have no <h1> at all _( `all routes` )_
- **S3** `crosscut-19` — Breadcrumbs exist on only a handful of routes; the deepest pages (project, flow monitor, agent builder, run, KB) have neither a breadcrumb nor a back link _( `/projects/[id], /flows/[id], /agents/[id], /knowledge, ru…` )_
- **S3** `home-sessions-27` — Submitting a session answer fires four identical GET /api/demo-builder/sessions requests in the same tick _( `/sessions` )_
- **S3** `library-26` — Every library search box and several builder inputs are unlabelled (placeholder-only) _( `/skills · /hooks · /connections · /templates · /skills/ne…` )_
- **S3** `library-32` — The Studio nav forces ~737px of horizontal scroll on a narrow viewport — every library route overflows _( `all library routes (global shell)` )_
- **S3** `sessions-kinds-25` — Instructions/demo session events are written to the event log with phase:"architect" _( `/sessions/instructions/<sid>` )_
- **S3** `sessions-kinds-26` — demo-builder session events are logged with phase:"unifier" (a phase that was retired in wave 4) _( `/sessions/demo/<sid>` )_
