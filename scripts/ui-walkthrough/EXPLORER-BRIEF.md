# UI walkthrough — explorer brief (shared by every cluster agent)

> Reusable brief (first used in wave 7, 2026-08-18). `<OUT>` = the output/campaign dir the orchestrator names
> in your prompt (wave 7 used `_wave7/`; default `_walkthrough/`). The **operator notes** section is
> per-run input — the orchestrator replaces it with the current operator's notes (or removes it).

You are acting as a **human operator of Forge Studio** hunting for the kinds of issues the operator
(David) reported below. Your job: explore EVERY reachable path in your cluster, click EVERY control,
submit EVERY form, and record every defect, confusion, dead control, silent action, or missing
capability as a structured finding. You may spend real tokens running sessions/flows/agents through
the UI where that is the only way to validate a path (the operator authorised this).

## Ground rules (hard)
- Studio is ALREADY RUNNING: UI http://localhost:4124, bridge http://localhost:4123. Do NOT start/stop/
  restart it. NEVER run `npm run ui:journey`, `ui:deadpaths`, `forge studio --force-takeover`, or
  anything that binds ports 4123/4124 or git-resets the tree.
- Do NOT edit any file under the repo except `<OUT>/**` (the campaign/output dir you are given) (findings, scripts, screenshots). Read source
  freely (forge-ui/, cli/ui-bridge.ts, cli/, orchestrator/, studio/, skills/) to explain root causes.
- Drive the UI with node + playwright-core: `import {...} from './scripts/ui-walkthrough/lib.mjs'` (run scripts
  from repo root `/home/parso/forge`, e.g. `node <OUT>/explore/<cluster>/probe1.mjs`). Read that file
  first (60 lines). Baseline crawl of all routes is in `<OUT>/explore/crawl.json` +
  `crawl-summary.txt` + screenshots in `<OUT>/explore/shots/` — use it to seed your route list, then
  go deeper (BFS every link/button/tab/expander/menu; try each control in each visible state).
- Sessions you kick off: prefer the cheapest model tier the picker offers; give short realistic
  inputs; ONE session per kind is enough to validate the path unless a defect needs a second repro.
  Do NOT approve/merge anything that pushes to a remote git repo (verdict approve on a real develop
  run, project-brain approve that commits, scheduler start). Read-only + draft/propose actions are ok.
  Never click `Force takeover`, `Delete`/`Remove` on real projects/KBs, or anything with the words
  merge/push/publish. If a destructive-looking control exists, RECORD it (with what it claims to do)
  instead of clicking it.
- Concurrency: other explorers run against the same Studio at the same time. Don't start long KB
  drains/consolidates unless your cluster brief says so. Don't assume the sessions list is stable.
- Screenshots: `<OUT>/explore/<cluster>/shots/`. Findings: `<OUT>/findings/<cluster>.jsonl` via
  `note()` (schema below). Write findings AS YOU GO (write-ahead), not at the end.

## Operator's own notes (PER-RUN INPUT — replace with the current operator's notes; wave-7 set kept as the
## exemplar kinds of issue: find MORE like these, verify each in your cluster, record root cause with file:line)
1. No working UI way to approve a plan: plan artifact page shows an Approve button at the bottom AND in
   the bottom banner; neither does anything (maybe because the architect session predates wave 6).
2. Home: no clear distinction that the top strip = active SESSIONS and the items under = KNOWLEDGE BASES
   needing attention. Needs to be visually/verbally clear.
3. Sessions index shows all active sessions — but there is NO way to cancel a session; several are in a
   bad state and need cleanup. Investigate those bad-state sessions to understand agent function/defects.
4. A betterado plan (architect session committed 2026-08-14, initiative INIT-2026-08-14-betterado-gap-
   registry sits in _queue/pending; scheduler running=false) is stuck; operator cannot kick it off from
   the UI. Components feel too segmented and don't tie back together into a loop.
5. Community area far too light; refresh-registry agent appears to do nothing; no option to request a
   targeted search for specific kinds of skills from community sources (desired feature).
6. KB drain-to-green works poorly / unclear what is happening; KB health tab is incredibly busy — many
   overlapping buttons, unclear what happens if several are clicked together; drain logs nothing while
   running (no confidence anything is happening).
7. Two new flow buttons on the KB screen must be fixed; a "recent flow runs" widget like the agents
   page has is desired underneath.
8. Library artifacts (templates etc.) must be creatable + editable in Studio; they aren't.
9. The Knowledge-bases card must be removed from the Library page.
10. The reflection flow should be removed entirely (can be run as an agent run instead).

## What counts as a finding (record all of these)
- Control that does nothing / silently fails / no feedback (no toast, no state change, no request).
- Request that 4xx/5xx's; console error; page never sets data-page-ready; stale/incorrect data.
- Dead link, wrong route, unknown-id page rendered as if valid, breadcrumb/nav inconsistency.
- Ambiguous copy or layout (a human could not tell what a section/button is or what it did).
- Missing capability an operator would obviously expect on that screen (cancel, edit, create, retry,
  delete, filter, link to related object, log of what a running job is doing).
- Duplicated/overlapping controls; controls that should be gated but aren't (can double-fire, run two
  conflicting jobs); disabled controls with no reason shown.
- Loops that don't close: an object produced on one screen with no path to the next step
  (plan → initiative → develop run → verdict → merge → reflect; community item → install → use; etc).
- Anything that would confuse a first-time operator; anything the operator's notes above resemble.

## Finding schema (JSONL via `note(file, {...})`)
```
{ id: '<cluster>-NN', cluster, route, severity: 'S1'|'S2'|'S3',
  class: 'dead-control'|'silent-action'|'error'|'dead-link'|'stale-data'|'ambiguous-ux'|'missing-capability'
       |'overlap'|'ungated'|'loop-gap'|'copy'|'perf'|'a11y'|'other',
  title, repro: 'steps', expected, actual,
  evidence: ['<OUT>/explore/<cluster>/shots/x.png', '[bridge] GET /api/... -> 404'],
  suspectedRoot: 'one sentence', source: ['forge-ui/app/x/page.tsx:123'],
  relatesToOperatorNote: 0|1..10, proposedFix: 'one sentence', effort: 'S'|'M'|'L' }
```
Severity: S1 = blocks an operator path / data loss / silently wrong; S2 = works but confusing, missing
expected capability, error surfaced badly; S3 = polish/copy/nit.

## Return value (your final message = data, not prose)
JSON: `{ cluster, routesExplored: [..], controlsTried: N, sessionsStarted: [{kind,sessionId}], findingsFile,
findingsCount: {S1,S2,S3}, topFindings: [{id,severity,title}], unexplored: ['path + why'], notes }`.
Do not stop until every path in your cluster is exhausted or blocked (record blocks in `unexplored`).
