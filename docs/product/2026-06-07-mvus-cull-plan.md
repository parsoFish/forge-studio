# MVUS slimming — aggressive cull + refinement plan (2026-06-07)

Grounded in [minimum-viable-user-story.md](./minimum-viable-user-story.md). Executed on branch
`slim/mvus-cull-2026-06-07`. Every cull below was **adversarially verified `safeToCull`** (26-agent
workflow: re-ground vs MVUS → aggressive synthesis → per-cull skeptic with grep evidence). A real cycle
runs **only at the very end**, never during slimming.

Baseline (pre-cull): 30,189 prod LOC · **32,888 test LOC** · 99 prod files · **144 test files** · build green.

## What the MVUS promotes to load-bearing (do NOT cull)

- **Artifact:** architect skill/runner, **rich PLAN.html** + `OptionVisual` mockups, council, accept/feedback/**replan** loop, PlanGate/NewIdeaBox/ArchitectQuestionForm.
- **Autonomous:** cycle/scheduler/queue/worktree/manifest/work-item, PM + dev-loop + closure + baseline-gate, ralph runtime.
- **Review (ADR-026 send-back, now built):** unifier + demo skill, demo-model/html/**capture/runtime** (incl. **checkpoint video**), `unifier-items` + `drain-unifier-items` + `finalize-merged`, DemoComparison, ReviewVerdictForm, `/review` screen, `/api/verdict`+`/api/artifact`.
- **Reflect:** reflector skill/phase/invocation, `forge-reflect-rerun`, `/reflect` screen, brain markdown corpus (cycles + forge-dev themes), `brain-index` + `brain-lint` + INDEX/LINT.
- **Cross-cutting:** ui-bridge + forge-watch + bridge-client, dashboard/AgentGraphCanvas (live hex)/HexDetailDrawer/ActivityPanel/FileHeatmap/CostPanel, `tool-event-emit`, metrics, `/api/cost`, all derivation libs, `dep-levels`↔`dep-layout` boundary pair (kept BOTH).
- **Escape hatches/gates:** forge CLI (serve/status/requeue/review --approve recovery), preflight, contract, ADRs, phase docs, `e2e-journey.mjs`, `verify-cycle.mjs`.

## Culls — all verified `safeToCull`, by execution wave

**Wave 1 — safe independent culls (zero interdependency)**
1. `send-back-cap-exhausted` dead type cluster — pre-ADR-026 fossil never emitted (cap enforced via `UnifierItemsCapError`/`cap-exceeded` DrainStatus). 31 refs across cycle-context, scheduler, scheduler-dispatch, forge-metrics, cli, unifier-items + 2 test sites (simplify, don't delete).
2. `cli/logging-pretty.ts` (+test) — zero prod importers; raw JSONL ships to the browser. Drop `pino-pretty` dep if no other importer.
3. Dead UI routes `app/plan/[cycleId]` + `app/demo/[cycleId]` + `components/ArtifactPage.tsx` — unreachable; superseded by PlanGate iframe + DemoComparison.
4. `fetchManifest` client + `/api/manifest` route — no caller; project name already on the Cycle object.
5. `brain-scrub-test-contamination` one-shot + test + `brain:scrub` script + SKILL prose — benchmark residue cleaner; source gone.
6. `brain/.obsidian/` — human editor state; user never leaves the forge UI; already gitignored.
7. `_logs/_archived/` trafficGame spec residue — gitignored historical artefacts.

**Wave 2 — scoped trims + prose/residue consolidation**
8. `initiative-id.ts` `mintHandle`/`mintName` (+helpers, MintResult) ~125 LOC — never called in prod; keep `resolveInitiativeId`/`loadAliases`.
9. `demo-html.ts` top-level `beforeVideo`/`afterVideo` + unreachable full-run video row — keep checkpoint-level video (MVUS CLI-video path).
10. InteractiveSurface executing kinds (`hcl-replan`/`api-replay`/`ui-preview`/`cli-run`/`snippet-run`) — render only as disabled "coming soon"; keep `portal-link`+`live-query`; collapse the `isExecuting` branch.
11. `council-transcript.md` audit sidecar — no consumer; PLAN.html already renders the council accordion.
12. Prose residue: `loops/_adapters/` (README + ADR-002), demo-script/bench-candidate dangling comments.
13. `dep-levels`↔`dep-layout` — **drift-guard test, NOT a merge** (boundary forbids import).

**Wave 3 — interdependent supersession culls**
14. `file-verdict.ts` (+test) + `forge review` default print-verdict-prompt branch — pre-ADR-023 operator-leaves-UI transport; route all verdicts through `/api/verdict`; keep `--approve`/`--abandon` recovery (inline the legacy path literals).
15. `cost_tick` append-path (`cli/cost-tick.ts`+test, `EventType` member, cycle.ts tee wiring) — no consumer reads it; `/api/cost` aggregates `cost_usd` directly.

**Wave 4 — knowledge-layer + archive culls (low code risk)**
16. graphify power-tool stack — `brain-graphify-all.sh`, committed `brain/forge-dev/graphify-out/` (~8MB), `skills/brain-graph`, brain-query graph coupling (→ markdown-only), cli/brain-index prose, post-commit/checkout graphify hook, CLAUDE.md graphify section. MVUS names no structural graph; brain is read as markdown + **tuned** via reflect.
17. `docs/_archive/` (~12MB) — superseded; `forge-user-stories` → MVUS; CONTRACTS.md confirmed archived (live wiring in work-item.ts). Fix 9 dead doc links.
18. `docs/architecture/refocus-architecture/` (16 files) — pre-simplification design docs contradicting ADR-024; repoint ARCHITECTURE.md + overview.md to phases/decisions/contract.
19. `brain/_raw/archived-themes/` — operator-approved R-C archival; superseded successors exist.

**Wave 5 — e2e journey** (`scripts/e2e-journey.mjs`): rewrite to the final slimmed surface and **demonstrate every MVUS function** — explicit feedback+**replan** verdict, cross-project pane, the **ADR-026 send-back loop** (send-back → drain re-claim under same `cycleId` → loop-back re-render → approve → merge → closure, asserting hex/cost/lineage survival), the reflect **tuning loop** closing in-UI, and cross-cutting interaction-needed + drill-down checks. Remove references to culled surfaces. Re-run `npm run ui:journey` as the in-round regression gate.

## Test cull/trim plan

Delete with their source: `file-verdict.test.ts`, `cost-tick.test.ts`, `logging-pretty.test.ts`, `brain-scrub-test-contamination.test.ts`.
Simplify in place: `scheduler.test.ts`, `closure.test.ts`, `demo-model.test.ts`, `demo-html.test.ts`, `initiative-id.test.ts`, `architect-plan.test.ts`, `ui-bridge*.test.ts`.
Flagged (managed-project, operator call): `projects/claude-harness/tests/baseline.test.ts` placeholder.

## Gaps — MVUS-required capabilities not yet built (future forge initiatives, NOT this round)

These are where productionisation work goes — fittingly, candidates for forge to build itself:

1. **Architect web/online research** (allowedTools has no WebSearch/WebFetch).
2. **Similar-project investigation / comparison** grounding.
3. **Proactive per-initiative mockups** in PLAN.html (today only incidental on a design escalation).
4. **Conversational free-text interview** (today radio-option + "Other").
5. **`feedback.md` threaded into the re-interview turn** on replan (today only the redraft reads it).
6. **Human-watchable CLI/behaviour VIDEO** capture (no asciinema/cast/playwright-video wired).
7. **Foregrounded assessed-intent + per-AC evaluated-output** verdict rows in the demo.
8. **`concernKind` (code-fix vs packaging) selector** in ReviewVerdictForm (backend ready).
9. **Immediate drain trigger** on verdict submit (today waits ≤5-min sweep tick).
10. **UWI-hex visibility** on `/review` during a drain.
11. **Per-phase-agent token live view + "task a phase was given" prompt drill-down.**
12. **cap-exceeded operator notification** in the UI.
13. **User-preference brain scope** distinct from forge-machinery brain (decide or build).
14. **Push-based "reflection questions ready"** signal (replace per-card polling).

Plus the earlier productisation blockers: guided `.forge/project.json` onboarding wizard, initiative-sizing
guidance in the architect UI, empty-brain graceful handling for the PM brain-gate, and legible
non-expert failure/remediation messaging.
