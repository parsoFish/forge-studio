import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  FORGE_ROOT, PROJECT, projectRoot,
  IDEA, DATE, INIT, CYCLE_ID,
  SCRATCH_FLOW,
  READ, WORK, ACT, THINK, pace, QDIR,
  caption, runningTimer,
  archDir, writeStatus, archEvent, archReasoning, burst, paced, writeQuestions,
  EMULATED_ARCHITECT_COST_USD, EMULATED_ARCHITECT_DURATION_MS, writePlan,
  cycleEvent, unifierEvent, moveManifest, seedReviewWorktree, writeDemoJson, writeReflectionQuestions,
  openStudioMonitor,
} from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

// module-scope cross-beat state for this journey (was hoisted in main())
let sid;                                    // architect session id (flows-run-idea → flows-run-approve)
let REVIEW_URL, REFLECT_URL, REVIEW_WT;     // flows-run-cost-rollup → flows-run-reflect
let INIT2, STAMP2, CYCLE_ID2, CYCLE_LOG2, studioSeqBase, studioEvent; // flows-run-monitor-deep-dive → flows-run-gate-control
// createdSid's only READ site is runner-internal — main()'s finally-block
// architect-session cleanup (`cleanSeededSession(journeyCtx.seeded.createdSid)` +
// rmSync(_logs/_architect-<id>)), not any flows-run beat — so it's mirrored onto
// ctx.seeded at the assignment site (below) instead of kept as a module let.

export const journey = defineJourney({
    id: 'flows-run',
    title: 'Run a gated cycle',
    story: 'Run a gated cycle end-to-end on a real mdtoc roadmap feature: idea → architect interview → PLAN gate → autonomous build → review gate → merge → reflect, plus the flow-engine monitor controls.',
    beats: [
      {
        id: 'flows-run-idea',
        title: 'Operator drops the mdtoc idea',
        narration: 'Operator drops the mdtoc idea',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ════════════════════════════════════════════════════════════════════════
              // ACT 2 — RUN. The cycle as the proof case, on a real mdtoc roadmap feature.
              // ════════════════════════════════════════════════════════════════════════

              // ── R1.0: Operator drops the idea ─────────────────────────────────────────
              console.log('\n[R1.0] Operator drops the mdtoc idea');
              await page.goto(watch.uiUrl + '/architect/new', { waitUntil: 'domcontentloaded' });
              await page.waitForSelector('main[data-page="architect-new"][data-page-ready="true"]', { timeout: 30000 });
              await page.waitForSelector('[data-section="new-idea"]', { timeout: 10000 });
              await caption(page, "One idea. One field. Type it like you'd tell a colleague.");
              await sleep(ACT);
              await page.locator('[data-section="new-idea"] [data-field="project"]').fill(PROJECT);
              await page.locator('[data-section="new-idea"] [data-field="idea"]').click();
              await page.locator('[data-section="new-idea"] [data-field="idea"]').pressSequentially(IDEA, { delay: 18 });
              await sleep(THINK);
              await frame(page, 'r1-0-idea-typed', 'R1 — operator types a real mdtoc feature idea');
              check(await page.locator('[data-section="new-idea"]').count() > 0, '[data-section="new-idea"] present on /architect/new');
              await page.locator('[data-action="start-architect"]').hover();
              await sleep(ACT);
              await page.locator('[data-action="start-architect"]').click();
              await page.waitForURL(/\/architect\/[^/]+\/interview/, { timeout: 15000 });
              sid = decodeURIComponent(page.url().split('/architect/')[1].split('/')[0]);
              ctx.seeded.createdSid = sid; // read by the runner's finally-block cleanup
              console.log(`[e2e] architect session: ${sid}`);
              check(!!sid, '[data-action="start-architect"] navigates to /architect/<sid>/interview');

        },
      },
      {
        id: 'flows-run-grounding',
        title: 'Architect grounds itself — P3 activity panel',
        narration: 'Architect grounds itself — P3 activity panel',
        drive: async (ctx) => {
              const { page, frame, check } = ctx;
              // ── R1.1: Architect grounds itself — P3 activity panel ────────────────────
              console.log('\n[R1.1] Architect grounds itself — P3 activity panel');
              writeStatus(sid, { phase: 'interviewing', round: 1, idea: IDEA });
              archEvent(sid, 'start', 'architect turn (phase=interviewing, round=1)');
              await page.waitForSelector('main[data-page="architect-interview"]', { timeout: 15000 });
              await page.waitForSelector('[data-component="architect-hex"]', { timeout: 15000 });
              await caption(page, 'Forge reads the CLI source and the brain before it asks anything — every tool call, every line of reasoning.');
              await sleep(ACT);
              const groundingTools = ['Read', 'Grep', 'Glob', 'Read', 'Bash', 'Read'];
              for (let i = 0; i < groundingTools.length; i++) {
                archEvent(sid, 'tool_use', `tool.${groundingTools[i]}`, { tool: groundingTools[i] });
                await sleep(THINK);
                if (i === 3) {
                  await frame(page, 'r1-1-activity-midstream', 'R1 (mid-stream) — P3 activity panel filling while the architect reads the CLI source');
                }
              }
              archReasoning(sid, '--write needs a pure src/inject.ts (doc string + toc string → new doc string) that slices the <!-- toc --> / <!-- /toc --> region, then a thin CLI wire that reads the file, injects, and writes it back.');
              await sleep(THINK);
              archReasoning(sid, 'idempotency is the sharp edge — a second --write must be byte-identical. A unit test asserting diff === "" on a re-run plus the acceptance read-back against the built CLI will prove insert + idempotency.');
              await sleep(THINK);
              try {
                await page.waitForSelector('[data-section="architect-activity"]', { timeout: 8000 });
                check(true, 'P3: [data-section="architect-activity"] rendered');
              } catch { check(false, 'P3: [data-section="architect-activity"] rendered'); }
              try {
                await page.waitForFunction(
                  () => parseInt(document.querySelector('[data-section="architect-activity"]')?.getAttribute('data-activity-count') ?? '0', 10) >= 1,
                  null, { timeout: 8000 },
                );
                const count = await page.evaluate(() =>
                  parseInt(document.querySelector('[data-section="architect-activity"]')?.getAttribute('data-activity-count') ?? '0', 10));
                check(count >= 1, `P3: activity panel data-activity-count ≥1 (got ${count})`);
              } catch { check(false, 'P3: activity panel data-activity-count ≥1 (timeout)'); }
              const hasReasoningRow = await page.evaluate(() => {
                const panel = document.querySelector('[data-section="architect-activity"]');
                if (!panel) return false;
                return panel.textContent?.includes('reason') || panel.querySelectorAll('[data-activity-kind]').length > 0;
              });
              check(hasReasoningRow, 'P3: at least one reasoning row rendered in the activity panel');
              await frame(page, 'r1-1-activity-settled', 'R1 (settled) — P3 activity panel: tool calls + reasoning rows persisted');

        },
      },
      {
        id: 'flows-run-questions',
        title: 'Architect returns questions',
        narration: 'Architect returns questions',
        drive: async (ctx) => {
              const { page, frame, check, countAtLeast } = ctx;
              // ── R1.2: Architect returns clarifying questions ──────────────────────────
              console.log('\n[R1.2] Architect returns questions');
              writeQuestions(sid);
              writeStatus(sid, { phase: 'awaiting-answers', round: 1, idea: IDEA });
              archEvent(sid, 'log', 'interview round 1 — 2 question(s) for the operator');
              await page.waitForSelector('[data-section="architect-interview"]', { timeout: 15000 });
              await caption(page, 'Forge asks only what it cannot resolve itself — schema default, acceptance-test fixture.');
              await page.locator('[data-question-index="1"]').scrollIntoViewIfNeeded().catch(() => {});
              await sleep(READ);
              await frame(page, 'r1-2-questions', 'R1 — architect returns 2 clarifying questions (schema design + acc fixture)');
              check(await page.locator('[data-section="architect-interview"]').count() > 0,
                '[data-section="architect-interview"] rendered with questions');
              await countAtLeast(page, '[data-question-index]', 2, 'architect returned ≥2 questions');

        },
      },
      {
        id: 'flows-run-freetext',
        title: 'Operator answers — P2 free-text override on Q2',
        narration: 'Operator answers — P2 free-text override on Q2',
        drive: async (ctx) => {
              const { page, frame, check } = ctx;
              // ── R1.3: Operator answers — free-text override (P2) ──────────────────────
              console.log('\n[R1.3] Operator answers — P2 free-text override on Q2');
              await caption(page, "Answer with an option — or in your own words. You're in control.");
              await page.locator('[data-question-index="0"] input[type="radio"]').first().check();
              await sleep(THINK);
              const freetextLocator = page.locator('[data-question-freetext="1"]');
              const freetextPresent = await freetextLocator.count() > 0;
              if (freetextPresent) {
                await freetextLocator.scrollIntoViewIfNeeded().catch(() => {});
                await freetextLocator.click();
                await freetextLocator.pressSequentially(
                  'Reuse SharedReleaseFixture, but add a standalone subtest for the gate-task path so the gate-task fields are covered without a second queue.',
                  { delay: 18 },
                );
                await sleep(THINK);
                await frame(page, 'r1-3-freetext', 'R1 — P2: operator types a free-text answer on Q2 (overriding the option list)');
                try {
                  await page.waitForFunction(
                    () => document.querySelector('[data-question-index="1"]')?.getAttribute('data-question-resolved') === 'true',
                    null, { timeout: 5000 },
                  );
                  check(true, 'P2: Q2 [data-question-resolved="true"] after free-text entry');
                } catch {
                  const resolved = await page.evaluate(() =>
                    document.querySelector('[data-question-index="1"]')?.getAttribute('data-question-resolved') ?? '(absent)');
                  check(false, `P2: Q2 [data-question-resolved="true"] after free-text entry (got "${resolved}")`);
                }
                const anyRadioSelected = await page.evaluate(() => {
                  const q2 = document.querySelector('[data-question-index="1"]');
                  if (!q2) return false;
                  return [...q2.querySelectorAll('[data-option-selected]')].some((el) => el.getAttribute('data-option-selected') === 'true');
                });
                check(!anyRadioSelected, 'P2: all Q2 radio options unselected — free-text overrides the radio');
              } else {
                check(false, 'P2: [data-question-freetext="1"] present (surface not found — soft fail)');
                await page.locator('[data-question-index="1"] input[type="radio"]').first().check().catch(() => {});
                await sleep(THINK);
                await frame(page, 'r1-3-answer-fallback', 'R1 — answered via radio (P2 freetext surface not found)');
              }
              await page.locator('[data-action="submit-answers"]').click();
              await sleep(ACT);
              writeStatus(sid, { phase: 'drafting', round: 2, idea: IDEA });
              archEvent(sid, 'start', 'architect turn (phase=drafting) — rolling in answers');
              await page.waitForSelector('[data-section="architect-interview"]', { state: 'detached', timeout: 8000 }).catch(() => {});
              await burst(sid, ['Read', 'Edit']);
              await frame(page, 'r1-3b-drafting', 'R1 — planning: architect drafts with the answers folded in');

        },
      },
      {
        id: 'flows-run-stall',
        title: 'Stall cameo — P1 StuckWarning',
        narration: 'Stall cameo — P1 StuckWarning',
        drive: async (ctx) => {
              const { page, frame, check } = ctx;
              // ── R1.4: Stall cameo — P1 StuckWarning ───────────────────────────────────
              console.log('\n[R1.4] Stall cameo — P1 StuckWarning');
              await caption(page, 'And if it ever stalls or crashes — you see it, with exactly where to look.');
              const staleTime = new Date(Date.now() - 200_000).toISOString();
              writeFileSync(join(archDir(sid), 'status.json'), JSON.stringify({
                session_id: sid, project: PROJECT, project_repo_path: projectRoot,
                phase: 'drafting', round: 2, idea: IDEA, updated_at: staleTime,
              }, null, 2));
              const hbPath = join(FORGE_ROOT, '_logs', `_architect-${sid}`, '.heartbeat');
              if (existsSync(hbPath)) { try { rmSync(hbPath); } catch { /* */ } }
              let staleRendered = false;
              try {
                await page.waitForSelector('[data-architect-stale="true"]', { timeout: 10000 });
                staleRendered = true;
                check(true, 'P1: [data-architect-stale="true"] rendered when session staleMs > 120s');
              } catch {
                check(false, 'P1: [data-architect-stale="true"] rendered when session staleMs > 120s (timeout — bridge may cache)');
              }
              if (staleRendered) {
                await frame(page, 'r1-4-stale-warning', 'R1 — P1: StuckWarning renders when the architect goes quiet for >2 min');
              }
              writeStatus(sid, { phase: 'drafting', round: 2, idea: IDEA });
              archEvent(sid, 'log', 'architect resumed');
              try {
                await page.waitForFunction(() => !document.querySelector('[data-architect-stale="true"]'), null, { timeout: 8000 });
                check(true, 'P1: [data-architect-stale] clears after session refresh');
              } catch {
                check(false, 'P1: [data-architect-stale] clears after session refresh (still stale after 8s)');
              }

        },
      },
      {
        id: 'flows-run-draft-cost',
        title: 'Architect drafts — P4 real cost',
        narration: 'Architect drafts — P4 real cost',
        drive: async (ctx) => {
              const { page, frame } = ctx;
              // ── R1.5: Architect drafts — P4 real cost greens the hex ──────────────────
              console.log('\n[R1.5] Architect drafts — P4 real cost');
              await caption(page, '$0.46, 95 seconds — metered from the first phase.');
              archEvent(sid, 'tool_use', 'tool.Write', { tool: 'Write' });
              await sleep(THINK);
              archEvent(sid, 'tool_use', 'tool.Edit', { tool: 'Edit' });
              await sleep(THINK);
              writePlan(sid, 1);
              archEvent(sid, 'log', 'plan-emitted (1 initiative(s), 0 escalation(s))');
              cycleEvent('architect', 'start', 'architect.start', { metadata: { origin: 'architect' } });
              {
                const manifestText = readFileSync(join(archDir(sid), 'manifests', `${INIT}.md`), 'utf8');
                const costMatch = /^architect_cost_usd:\s*([\d.]+)/m.exec(manifestText);
                const durMatch = /^architect_duration_ms:\s*(\d+)/m.exec(manifestText);
                const archCost = costMatch ? parseFloat(costMatch[1]) : EMULATED_ARCHITECT_COST_USD;
                const archDur = durMatch ? parseInt(durMatch[1], 10) : EMULATED_ARCHITECT_DURATION_MS;
                cycleEvent('architect', 'end', 'architect.end', { cost_usd: archCost, duration_ms: archDur });
              }
              await frame(page, 'r1-5-architect-cost', 'R1 — P4: architect hex greens with real cost pill ($0.46, 95s)');

        },
      },
      {
        id: 'flows-run-plan-gate',
        title: 'Rich PLAN.html (gate)',
        narration: 'Rich PLAN.html (gate)',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ── R2.0: Rich PLAN.html presented ────────────────────────────────────────
              console.log('\n[R2.0] Rich PLAN.html (gate)');
              await page.goto(
                watch.uiUrl + `/artifact?run=_architect-${encodeURIComponent(sid)}&type=plan&mode=gate`,
                { waitUntil: 'domcontentloaded' },
              );
              await page.waitForSelector('[data-page="flows"][data-page-ready="true"]', { timeout: 20000 }).catch(() => {});
              await page.waitForSelector('[data-section="plan-gate"]', { timeout: 15000 });
              await caption(page, 'The plan is Given/When/Then — the PM uses it verbatim.');
              check(await page.locator('[data-plan-iframe]').count() > 0, 'plan gate renders the rich PLAN.html iframe');
              await page.locator('[data-plan-iframe]').scrollIntoViewIfNeeded().catch(() => {});
              await sleep(READ);
              await frame(page, 'r2-0-plan-html', 'R2 — rich PLAN.html with Given/When/Then AC cards');

        },
      },
      {
        id: 'flows-run-send-back',
        title: 'Send-back + revised plan',
        narration: 'Send-back + revised plan',
        drive: async (ctx) => {
              const { page, frame } = ctx;
              // ── R2.1: Send-back + revised plan ────────────────────────────────────────
              console.log('\n[R2.1] Send-back + revised plan');
              await caption(page, 'You decide when the plan is right.');
              const rationale = 'Also cover the no-markers case (exit non-zero with a clear message) so --write never silently does nothing before merging.';
              const rationaleLocator = page.locator(
                '[data-component="plan-gate"] [data-field="rationale"], [data-section="plan-gate"] [data-field="rationale"]'
              ).first();
              if (await rationaleLocator.count() > 0) {
                await rationaleLocator.click();
                await rationaleLocator.pressSequentially(rationale, { delay: 18 });
              } else {
                rationaleLocator.fill(rationale).catch(() => {});
              }
              await sleep(THINK);
              await frame(page, 'r2-1-send-back', 'R2 — operator sends the plan back with feedback');
              await page.locator('[data-action="revise-plan"]').click();
              await sleep(ACT);
              writeStatus(sid, { phase: 'drafting', round: 3, idea: IDEA });
              archEvent(sid, 'start', 'architect turn (phase=drafting) — rerun with operator feedback');
              await page.waitForSelector('[data-section="plan-gate"]', { state: 'detached', timeout: 8000 }).catch(() => {});
              await burst(sid, ['Read', 'Read']);
              writePlan(sid, 2);
              archEvent(sid, 'log', 'plan-emitted (revised — gate-task path covered)');
              await page.waitForSelector('[data-section="plan-gate"][data-decisions-resolved="true"]', { timeout: 15000 });
              await sleep(READ);
              await frame(page, 'r2-1b-revised-plan', 'R2 — revised plan re-presented with (revised) badge');

        },
      },
      {
        id: 'flows-run-approve',
        title: 'Approve → watch it build',
        narration: 'Approve → watch it build',
        drive: async (ctx) => {
              const { page, watch, frame, check, countAtLeast } = ctx;
              // ── R2.2: Approve → watch it build ────────────────────────────────────────
              console.log('\n[R2.2] Approve → watch it build');
              await caption(page, "Plan approved — the second flow, Forge Develop, picks it up from here.");
              await sleep(ACT);
              await frame(page, 'r2-2-approve', 'R2 — operator approves the plan (human decision #1 complete)');
              await page.locator('[data-action="approve-plan"]').click();
              await sleep(ACT);
              mkdirSync(QDIR('pending'), { recursive: true });
              execSync(`cp ${join(archDir(sid), 'manifests', `${INIT}.md`)} ${join(QDIR('pending'), `${INIT}.md`)}`);
              writeStatus(sid, { phase: 'committed', round: 3, idea: IDEA });
              cycleEvent('orchestrator', 'start', 'cycle.start', { metadata: { origin: 'architect' } });
              moveManifest('pending', 'in-flight');
              // 30s (not 15s): the button renders only after the seeded 'committed' status
              // + in-flight run propagate through the UI's ~3s poll; first-navigation
              // next-dev compile jitter can push this past 15s (observed flake).
              await page.waitForSelector('[data-action="watch-it-build"]', { timeout: 30000 });
              await sleep(ACT);
              await page.locator('[data-action="watch-it-build"]').click();
              await page.waitForFunction(
                () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 },
              ).catch(() => {});
              await sleep(ACT);
              await frame(page, 'r2-2b-monitor-landing', 'R2 — "Watch it build →" lands on the Studio flow monitor');
              await openStudioMonitor(page, watch); // forge-develop — the build slice (Model B)
              await frame(page, 'r2-2c-monitor-live', 'R2 — Forge Develop monitor shows the build slice live (run rail + topology)');
              // Model B: /flows/forge-develop renders ONLY the develop slice (dev→unifier→review,
              // the dev node fanning out into per-WI hexes). It does NOT show architect/pm/reflect.
              await countAtLeast(page, '[data-mon-node][data-hex-kind="phase"]', 2, 'monitor: forge-develop slice shows its phase hexes (unifier/review)');
              // P4: the architect ran in the architect FLOW — assert its real cost on the
              // forge-architect slice (the threaded run surfaces there via flowLineage).
              await openStudioMonitor(page, watch, 'forge-architect');
              try {
                await page.waitForFunction(
                  () => (parseFloat(document.querySelector('[data-mon-node][data-node-id="architect"]')
                    ?.getAttribute('data-phase-cost-usd') ?? '0') || 0) > 0,
                  null, { timeout: 12000 },
                );
                check(true, 'P4: architect hex (on /flows/forge-architect) carries real cost (data-phase-cost-usd > 0)');
              } catch {
                const costVal = await page.evaluate(() =>
                  document.querySelector('[data-mon-node][data-node-id="architect"]')?.getAttribute('data-phase-cost-usd') ?? '(absent)');
                check(false, `P4: architect hex carries real cost (got "${costVal}")`);
              }
              check(
                await page.evaluate(() => document.querySelector('[data-mon-node][data-node-id="pm"]') !== null),
                'monitor: forge-architect slice shows the pm hex (architect+pm, not the develop nodes)',
              );
              await openStudioMonitor(page, watch); // back to forge-develop for the build beat

        },
      },
      {
        id: 'flows-run-pm-decompose',
        title: 'PM decomposes ACs into work items',
        narration: 'PM decomposes ACs into work items',
        drive: async (ctx) => {
              const { page, watch, frame, countAtLeast, expectHexOpensDrawer } = ctx;
              // ── R3.0: PM decomposes ACs into work items ───────────────────────────────
              console.log('\n[R3.0] PM decomposes ACs into work items');
              await caption(page, 'Dependency-ordered work items — from G/W/T, not tasks. (Pure inject.ts, then the --write wiring + acceptance read-back.)');
              await paced([
                () => cycleEvent('project-manager', 'start', 'pm phase start'),
                () => cycleEvent('project-manager', 'tool_use', 'pm.brain-query', { metadata: { tool: 'brain-query' } }),
                () => cycleEvent('project-manager', 'log', 'pm.work-item-emitted', { metadata: { work_item_id: 'WI-1' } }),
                () => cycleEvent('project-manager', 'log', 'pm.work-item-emitted', { metadata: { work_item_id: 'WI-2' } }),
              ], WORK);
              await frame(page, 'r3-0-pm-midpulse', 'R3 (mid-pulse) — PM hex active as it emits work items');
              cycleEvent('project-manager', 'end', 'pm.end', { cost_usd: 0.31, duration_ms: 28000, metadata: { work_item_count: 2 } });
              await sleep(WORK);
              await frame(page, 'r3-0b-pm-settled', 'R3 — PM decomposed ACs into 2 dependency-ordered work items');
              await openStudioMonitor(page, watch);
              await countAtLeast(page, '[data-mon-node][data-hex-kind="wi"]', 2, 'monitor: PM materialised ≥2 WI hexes');
              await expectHexOpensDrawer(page, '[data-mon-node][data-hex-kind="phase"]', 'phase', 'monitor phase drawer');
              await expectHexOpensDrawer(page, '[data-mon-node][data-hex-kind="wi"]', 'wi', 'monitor WI drawer');

        },
      },
      {
        id: 'flows-run-tdd-red',
        title: 'Dev-loop TDD red — gate.expected-fail',
        narration: 'Dev-loop TDD red — gate.expected-fail',
        drive: async (ctx) => {
              const { page, frame } = ctx;
              // ── R3.1: Dev-loop TDD red — gate.expected-fail ───────────────────────────
              console.log('\n[R3.1] Dev-loop TDD red — gate.expected-fail');
              await caption(page, 'The gate fails before a line is written — npm test red on the new inject suite.');
              await paced([
                () => cycleEvent('developer-loop', 'start', 'dev-loop start'),
                () => cycleEvent('developer-loop', 'log', 'gate.expected-fail', {
                  metadata: { work_item_id: 'WI-1', stderr: 'FAIL injectToc_ReplacesMarkerRegion: Cannot find module ../dist/inject.js (src/inject.ts not implemented)' },
                }),
              ], WORK);
              await sleep(THINK);
              await frame(page, 'r3-1-gate-fail', 'R3 — TDD red: gate.expected-fail — the inject test fails before src/inject.ts exists');

        },
      },
      {
        id: 'flows-run-grind',
        title: 'Dev-loop GRIND (fast-forward)',
        narration: 'Dev-loop GRIND (fast-forward)',
        drive: async (ctx) => {
              const { page, frame } = ctx;
              // ── R3.2: Dev-loop GRIND — fast-forwarded ─────────────────────────────────
              console.log('\n[R3.2] Dev-loop GRIND (fast-forward)');
              await caption(page, 'Autonomous — writing the pure src/inject.ts marker-slice. (4m compressed.)');
              await runningTimer(page, true, 0);
              const implTools = ['Edit', 'Edit', 'Bash', 'Edit', 'Bash', 'Edit', 'Bash', 'Read', 'Edit', 'Bash'];
              for (const t of implTools) {
                cycleEvent('developer-loop', 'tool_use', `tool.${t}`, { metadata: { work_item_id: 'WI-1', tool: t } });
                await pace('fastForward');
              }
              cycleEvent('developer-loop', 'log', 'usage_delta', { metadata: { work_item_id: 'WI-1', input_tokens: 1800, output_tokens: 600 } });
              await sleep(WORK);
              cycleEvent('developer-loop', 'log', 'usage_delta', { metadata: { work_item_id: 'WI-1', input_tokens: 2100, output_tokens: 900 } });
              await sleep(WORK);
              await frame(page, 'r3-2-grind', 'R3 (fast-forward) — dev-loop implementing WI-1; token/cost bar growing');

        },
      },
      {
        id: 'flows-run-dependency-gate',
        title: 'Gate.pass + WI-1 green → WI-2 starts',
        narration: 'Gate.pass + WI-1 green → WI-2 starts',
        drive: async (ctx) => {
              const { page, frame } = ctx;
              // ── R3.3: Dependency gate + gate.pass ─────────────────────────────────────
              console.log('\n[R3.3] Gate.pass + WI-1 green → WI-2 starts');
              await runningTimer(page, false);
              await caption(page, 'Red four minutes ago — now green. WI-2 (the --write wiring + acceptance read-back) only started once WI-1 was done.');
              cycleEvent('developer-loop', 'log', 'gate.pass', { metadata: { work_item_id: 'WI-1' } });
              await sleep(THINK);
              cycleEvent('developer-loop', 'iteration', 'WI-1 iteration', {
                iteration: 1, tokens_in: 4200, tokens_out: 1600, cost_usd: 0.21, metadata: { work_item_id: 'WI-1' },
              });
              await sleep(THINK);
              cycleEvent('developer-loop', 'end', 'WI-1 complete', { metadata: { work_item_id: 'WI-1' } });
              await sleep(WORK);
              await frame(page, 'r3-3-wi1-green', 'R3 — gate.pass; WI-1 green; WI-2 (depends on WI-1) only now starts');
              cycleEvent('developer-loop', 'tool_use', 'tool.Edit', { metadata: { work_item_id: 'WI-2', tool: 'Edit' } });
              await sleep(THINK);
              cycleEvent('developer-loop', 'log', 'usage_delta', { metadata: { work_item_id: 'WI-2', input_tokens: 1200, output_tokens: 400 } });
              await sleep(WORK);
              cycleEvent('developer-loop', 'iteration', 'WI-2 iteration', { iteration: 1, metadata: { work_item_id: 'WI-2' } });
              cycleEvent('developer-loop', 'end', 'WI-2 complete', { metadata: { work_item_id: 'WI-2' } });
              cycleEvent('developer-loop', 'end', 'ralph.end', { cost_usd: 0.92, duration_ms: 140000 });
              await sleep(WORK);
              await frame(page, 'r3-3b-devloop-green', 'R3 — dev-loop hex greens (both WIs done); unifier runs next on its own hex');

        },
      },
      {
        id: 'flows-run-unifier',
        title: 'Unifier on its own hex',
        narration: 'Unifier on its own hex',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ── R3.4: Unifier on its OWN hex ──────────────────────────────────────────
              console.log('\n[R3.4] Unifier on its own hex');
              await caption(page, 'A separate phase reviews the branch and authors the demo — with captured CLI read-back evidence.');
              await paced([
                () => unifierEvent('start', 'unifier.start — reviewing the merged work-item output'),
                () => unifierEvent('tool_use', 'tool.Bash', { metadata: { tool: 'Bash: npm test && npm run acceptance' } }),
              ], WORK);
              await frame(page, 'r3-4-unifier-midpulse', 'R3 (mid-pulse) — unifier hex active, running the gate + acceptance on the merged branch');
              unifierEvent('log', 'unifier.gate — initiative gate green; cleaning output');
              await sleep(WORK);
              unifierEvent('log', 'unifier.demo-skill — authoring demo.json (captured CLI read-back evidence)');
              await sleep(THINK);
              unifierEvent('tool_use', 'tool.Bash', { metadata: { tool: 'Bash: forge demo render' } });
              await sleep(THINK);
              writeDemoJson(1);
              unifierEvent('end', 'unifier.end — demo authored, branch clean', { cost_usd: 0.18, duration_ms: 46000 });
              await openStudioMonitor(page, watch);
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-mon-node][data-node-id="unifier"]')?.getAttribute('data-status') === 'complete',
                  null, { timeout: 10000 },
                );
                check(true, 'monitor: unifier node lit its own status complete (not folded into dev-loop)');
              } catch {
                const got = await page.evaluate(() =>
                  document.querySelector('[data-mon-node][data-node-id="unifier"]')?.getAttribute('data-status') ?? '(absent)');
                check(false, `monitor: unifier node should reach complete (got "${got}")`);
              }
              await frame(page, 'r3-4b-unifier-green', 'R3 — unifier (own node) greens after authoring the demo');

        },
      },
      {
        id: 'flows-run-cost-rollup',
        title: 'Cost rollup',
        narration: 'Cost rollup',
        drive: async (ctx) => {
              const { page, watch, frame, check, expectPhaseCost } = ctx;
              // ── R3.5: Cost rollup across the spine ────────────────────────────────────
              console.log('\n[R3.5] Cost rollup');
              cycleEvent('review-loop', 'start', 'review-loop start');
              cycleEvent('review-loop', 'log', 'reviewer.pr-opened');
              moveManifest('in-flight', 'ready-for-review');
              await caption(page, 'Forge Develop, costed per phase — dev-loop $0.92, unifier $0.18 — under its ceiling. (The Architect flow bills separately.)');
              await openStudioMonitor(page, watch);
              await sleep(READ);
              await frame(page, 'r3-5-cost-rollup', 'R3 — cost rollup across the spine (Studio monitor)');
              await expectPhaseCost(page, 'monitor: cost rollup — a phase hex shows cost > 0');
              try {
                await page.waitForFunction(
                  (id) => document.querySelector(`[data-run-id="${id}"]`)?.getAttribute('data-run-status') === 'gated',
                  CYCLE_ID, { timeout: 12000 },
                );
                check(true, 'monitor: run rail shows the cycle as gated (ready-for-review)');
              } catch {
                const got = await page.evaluate((id) =>
                  document.querySelector(`[data-run-id="${id}"]`)?.getAttribute('data-run-status') ?? '(absent)', CYCLE_ID);
                check(false, `monitor: run rail shows the cycle gated (got "${got}")`);
              }

              REVIEW_URL = `${watch.uiUrl}/artifact?run=${encodeURIComponent(CYCLE_ID)}&type=verdict&mode=gate`;
              REFLECT_URL = `${watch.uiUrl}/artifact?run=${encodeURIComponent(CYCLE_ID)}&type=reflection&mode=view`;

              // S7: seed a live worktree so the comment-derived send-back genuinely
              // appends a UWI in place (ADR-026), not a 409.
              REVIEW_WT = seedReviewWorktree();

        },
      },
      {
        id: 'flows-run-review-comment',
        title: 'Review — comment-on-page visual demo (PARTIAL)',
        narration: 'Review — comment-on-page visual demo (PARTIAL)',
        drive: async (ctx) => {
              const { page, frame, check, countAtLeast } = ctx;
              // ── R4.0: Review — the comment-on-page visual demo (DEC-5) ─────────────────
              console.log('\n[R4.0] Review — comment-on-page visual demo (PARTIAL)');
              await sleep(ACT);
              await page.goto(REVIEW_URL, { waitUntil: 'domcontentloaded' });
              await page.waitForSelector('[data-page-ready="true"]', { timeout: 30000 });
              await page.waitForSelector('[data-section="demo-comparison"]', { timeout: 15000 });
              await page.waitForSelector('[data-component="demo-review-surface"]', { timeout: 15000 });
              await caption(page, 'The interactive review page: the rendered DEMO.md, a before/after slider, and per-region comments that ARE the verdict.');
              await page.locator('[data-section="demo-evaluation"]').scrollIntoViewIfNeeded().catch(() => {});
              await sleep(READ);
              await frame(page, 'r4-0-review-partial', 'R4 — review demo: AC-1 MET (CLI read-back), AC-2 PARTIAL (newline drift on re-write)');
              await countAtLeast(page, '[data-section="demo-evaluation"] [data-ac-verdict]', 2, 'review demo foregrounds per-AC evaluated output');
              check(
                await page.locator('[data-section="demo-evaluation"] [data-ac-verdict="partial"]').count() > 0,
                'an AC reads PARTIAL on round 1 — the gap the operator sends back on',
              );
              // DEC-5 surfaces: rendered DEMO.md iframe, per-region anchors, the before/after slider.
              check(await page.locator('[data-demo-markdown]').count() > 0, 'review page renders DEMO.md in a sandboxed iframe');
              await countAtLeast(page, '[data-demo-region]', 2, 'review page anchors per-demo-region comment targets');
              await page.locator('[data-evidence="before-after-slider"]').first().scrollIntoViewIfNeeded().catch(() => {});
              await sleep(THINK);
              await frame(page, 'r4-0b-slider', 'R4 — before/after image-comparison slider for the TOC region');
              check(await page.locator('[data-evidence="before-after-slider"]').count() > 0, 'review page shows a before/after img-comparison-slider');

        },
      },
      {
        id: 'flows-run-review-send-back',
        title: 'Send-back — operator anchors a blocking comment to AC-2',
        narration: 'Send-back — operator anchors a blocking comment to AC-2',
        drive: async (ctx) => {
              const { page, frame, check } = ctx;
              // ── R4.1: Send-back via an anchored blocking comment (DEC-5) ───────────────
              console.log('\n[R4.1] Send-back — operator anchors a blocking comment to AC-2');
              await caption(page, 'The operator comments directly on AC-2 — a blocking comment IS a send-back.');
              const ac2 = page.locator('[data-demo-region="ac-2"]');
              await ac2.scrollIntoViewIfNeeded().catch(() => {});
              await ac2.locator('[data-action="comment-region"]').click();
              await sleep(THINK);
              const commentBody = ac2.locator('[data-field="comment-body"]');
              await commentBody.click();
              await commentBody.pressSequentially(
                'A second --write on an already-current doc must be byte-identical (no trailing-newline drift) before this merges.',
                { delay: 16 },
              );
              await sleep(THINK);
              await frame(page, 'r4-1-comment', 'R4 — a blocking comment anchored to AC-2 (the send-back, on the page)');
              await ac2.locator('[data-action="add-comment"]').click();
              await page.waitForSelector('[data-demo-region="ac-2"] [data-comment-id]', { timeout: 8000 });
              check(await ac2.locator('[data-comment-id]').count() > 0, 'the anchored comment renders under its region');
              // The verdict is DERIVED — a blocking comment flips the bar to send-back.
              await page.waitForFunction(
                () => document.querySelector('[data-component="verdict-form"]')?.getAttribute('data-form-kind') === 'send-back',
                null, { timeout: 8000 },
              ).catch(() => {});
              check(
                await page.locator('[data-component="verdict-form"][data-form-kind="send-back"]').count() > 0,
                'the blocking comment derives a send-back verdict',
              );

              // Persistence: a reload must still show the anchored comment (sidecar-backed).
              await page.goto(REVIEW_URL, { waitUntil: 'domcontentloaded' });
              await page.waitForSelector('[data-page-ready="true"]', { timeout: 30000 });
              await page.waitForSelector('[data-demo-region="ac-2"] [data-comment-id]', { timeout: 12000 });
              check(
                await page.locator('[data-demo-region="ac-2"] [data-comment-id]').count() > 0,
                'the anchored comment PERSISTS across a reload (review-comments sidecar)',
              );
              await frame(page, 'r4-1b-send-back', 'R4 — the comment persists; the derived verdict is "send back"');
              await page.locator('[data-component="verdict-form"] [data-action="send-back"]').click();
              // A 200 (the form reaches "submitted") means applyReviewVerdict appended the
              // UWI in place — ADR-026, same cycle, no requeue.
              await page.waitForSelector('[data-component="verdict-form"][data-form-state="submitted"]', { timeout: 10000 }).catch(() => {});
              const sbState = await page.locator('[data-component="verdict-form"]').getAttribute('data-form-state');
              const sbErr = await page.locator('[data-component="verdict-form"]').getAttribute('data-submit-error');
              check(sbState === 'submitted', `send-back submitted (ADR-026 in-place append) — state=${sbState}${sbErr ? ` err=${sbErr}` : ''}`);
              // Belt-and-braces: the UWI landed in the SAME cycle's worktree (no sibling).
              check(
                existsSync(join(REVIEW_WT, '.forge', 'unifier-items')) &&
                  readdirSync(join(REVIEW_WT, '.forge', 'unifier-items')).some((f) => f.startsWith('UWI-')),
                'send-back appended a UWI into the SAME cycle worktree (ADR-026 in place, no new cycle)',
              );
              await sleep(ACT);

        },
      },
      {
        id: 'flows-run-rerun',
        title: 'Dev-loop reruns on feedback (fast-forward)',
        narration: 'Dev-loop reruns on feedback (fast-forward)',
        drive: async (ctx) => {
              const { page, frame } = ctx;
              // ── R4.2: Dev-loop reruns on feedback (fast-forward) ──────────────────────
              console.log('\n[R4.2] Dev-loop reruns on feedback (fast-forward)');
              await caption(page, 'The dev-loop re-ran on the new criterion.');
              moveManifest('ready-for-review', 'in-flight');
              await runningTimer(page, true, 0);
              cycleEvent('developer-loop', 'start', 'dev-loop rerun — addressing review feedback');
              for (let i = 0; i < 6; i++) {
                cycleEvent('developer-loop', 'tool_use', 'tool.Edit', { metadata: { work_item_id: 'WI-2', tool: 'Edit' } });
                await pace('fastForward');
              }
              unifierEvent('log', 'unifier.demo-skill — re-rendering demo.json (--write is byte-identical on every run)');
              await pace('fastForward');
              writeDemoJson(2);
              unifierEvent('end', 'unifier.end (round 2) — demo re-rendered', { cost_usd: 0.06 });
              cycleEvent('developer-loop', 'end', 'ralph.end (round 2)');
              moveManifest('in-flight', 'ready-for-review');
              await runningTimer(page, false);
              await sleep(WORK);
              await frame(page, 'r4-2-rerun', 'R4 (fast-forward) — dev-loop reran on the new criterion; back to "Review →"');

        },
      },
      {
        id: 'flows-run-re-review',
        title: 'Re-review — PARTIAL→MET',
        narration: 'Re-review — PARTIAL→MET',
        drive: async (ctx) => {
              const { page, frame, check, countAtLeast } = ctx;
              // ── R4.3: Re-review — PARTIAL→MET (payoff) ────────────────────────────────
              console.log('\n[R4.3] Re-review — PARTIAL→MET');
              await sleep(ACT);
              await page.goto(REVIEW_URL, { waitUntil: 'domcontentloaded' });
              await page.waitForSelector('[data-page-ready="true"]', { timeout: 30000 }).catch(() => {});
              await page.waitForSelector('[data-section="demo-comparison"]', { timeout: 15000 });
              await caption(page, 'Partial → corrected → met. The loop closed on your criterion.');
              await page.locator('[data-section="demo-evaluation"]').scrollIntoViewIfNeeded().catch(() => {});
              await sleep(READ);
              await frame(page, 'r4-3-rereview-met', 'R4 — re-review: AC-2 now MET (PARTIAL→MET payoff)');
              const partialCount = await page.locator('[data-section="demo-evaluation"] [data-ac-verdict="partial"]').count();
              check(partialCount === 0, `re-review: partial AC count == 0 after dev-loop rerun (got ${partialCount})`);
              await countAtLeast(page, '[data-section="demo-evaluation"] [data-ac-verdict="met"]', 2, 're-review: all ACs show verdict "met"');

              // The blocking comment from R4.1 persists across the round — resolving it is
              // what flips the DERIVED verdict from send-back back to approve.
              const ac2b = page.locator('[data-demo-region="ac-2"]');
              await ac2b.scrollIntoViewIfNeeded().catch(() => {});
              await ac2b.locator('[data-action="resolve-comment"]').first().click().catch(() => {});
              await page.waitForFunction(
                () => document.querySelector('[data-component="verdict-form"]')?.getAttribute('data-form-kind') === 'approve',
                null, { timeout: 8000 },
              ).catch(() => {});
              check(
                await page.locator('[data-component="verdict-form"][data-form-kind="approve"]').count() > 0,
                'resolving the blocking comment flips the derived verdict to approve',
              );

        },
      },
      {
        id: 'flows-run-approve-merge',
        title: 'Approve & merge → completed spine',
        narration: 'Approve & merge → completed spine',
        drive: async (ctx) => {
              const { page, watch, frame, check, countAtLeast, expectPhaseCost } = ctx;
              // ── R4.4: Approve & merge → completed spine ───────────────────────────────
              console.log('\n[R4.4] Approve & merge → completed spine');
              await caption(page, 'Comment resolved → the page derives "approve". Every acceptance criterion accountable at the Forge Develop gate.');
              await sleep(ACT);
              await frame(page, 'r4-4-approve', 'R4 — operator approves (human decision #2 complete)');
              await page.locator('[data-component="verdict-form"] [data-action="approve-and-merge"]').click();
              await page.waitForSelector('[data-component="verdict-form"][data-form-state="submitted"]', { timeout: 10000 }).catch(() => {});
              await paced([
                () => cycleEvent('review-loop', 'end', 'review-loop end — operator approved', { cost_usd: 0.21 }),
                () => cycleEvent('closure', 'start', 'closure.start'),
                () => cycleEvent('closure', 'log', 'closure.pr-merged'),
                () => cycleEvent('closure', 'end', 'closure.end'),
                () => cycleEvent('reflection', 'start', 'reflection.start'),
                () => cycleEvent('reflection', 'tool_use', 'reflection.brain-query', { metadata: { tool: 'brain-query' } }),
                () => cycleEvent('reflection', 'end', 'reflection.end'),
              ], WORK);
              moveManifest('ready-for-review', 'done');
              writeReflectionQuestions();
              await page.waitForSelector('[data-action="open-reflect"]', { timeout: 15000 }).catch(() => {});
              await sleep(ACT);
              await frame(page, 'r4-4b-reflect-link', 'R4 — merged; "Reflect on this cycle →" surfaces the final human moment');
              await openStudioMonitor(page, watch);
              await page.locator(`[data-run-id="${CYCLE_ID}"]`).first().click().catch(() => {});
              await page.waitForSelector(`[data-run-id="${CYCLE_ID}"][data-run-status="complete"]`, { timeout: 15000 }).catch(() => {});
              await sleep(READ);
              await frame(page, 'r4-4c-spine-complete', 'R4 — completed spine: every phase green with its cost pill');
              try {
                await page.waitForFunction(
                  (id) => document.querySelector(`[data-run-id="${id}"]`)?.getAttribute('data-run-status') === 'complete',
                  CYCLE_ID, { timeout: 12000 },
                );
                check(true, 'monitor: run rail shows the cycle complete (merged + reflected)');
              } catch {
                const got = await page.evaluate((id) =>
                  document.querySelector(`[data-run-id="${id}"]`)?.getAttribute('data-run-status') ?? '(absent)', CYCLE_ID);
                check(false, `monitor: run rail shows the cycle complete (got "${got}")`);
              }
              // Model B: the completed spine is split across the 3 flow monitors. This develop
              // slice shows the dev fan-out (≥2 WI hexes) + unifier + review.
              await countAtLeast(page, '[data-mon-node][data-hex-kind="phase"]', 2, 'completed develop slice shows its phase hexes (unifier+review)');
              await countAtLeast(page, '[data-mon-node][data-hex-kind="wi"]', 2, 'completed develop slice shows the dev fan-out (≥2 WI hexes)');
              await expectPhaseCost(page, 'completed develop slice shows accrued per-phase cost');
              // The SAME threaded run renders its architect slice under forge-architect
              // (flowLineage) — Model B proof. (The reflect slice is verified at R5, once the
              // reflection phase has actually run.)
              await openStudioMonitor(page, watch, 'forge-architect');
              check(
                await page.evaluate(() =>
                  document.querySelector('[data-mon-node][data-node-id="architect"]') !== null &&
                  document.querySelector('[data-mon-node][data-node-id="pm"]') !== null &&
                  document.querySelector('[data-mon-node][data-node-id="dev"]') === null),
                'Model B: /flows/forge-architect renders the architect slice (architect+pm, not dev) of the threaded run',
              );
              await caption(page, 'The same run, seen on the Forge Architect flow — its own monitor, architect + PM only.');
              await frame(page, 'r4-4d-architect-flow', 'The Forge Architect flow on its own monitor — architect + PM hexes only, no dev or unifier');
              await openStudioMonitor(page, watch); // back to the develop slice
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-mon-node][data-node-id="unifier"]')?.getAttribute('data-status') === 'complete',
                  null, { timeout: 8000 },
                );
                check(true, 'unifier node complete on its own monitor slot (not folded into dev-loop)');
              } catch {
                const got = await page.evaluate(() =>
                  document.querySelector('[data-mon-node][data-node-id="unifier"]')?.getAttribute('data-status') ?? '(absent)');
                check(false, `unifier node should reach complete (got "${got}")`);
              }

        },
      },
      {
        id: 'flows-run-reflect',
        title: 'Reflect',
        narration: 'Reflect',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ── R5: Reflect — operator tunes the brain ────────────────────────────────
              console.log('\n[R5] Reflect');
              await caption(page, "Forge improves. You're the teacher — tune the brain.");
              await page.goto(REFLECT_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
              await page.waitForSelector('[data-page-ready="true"]', { timeout: 20000 }).catch(() => {});
              await page.waitForSelector('[data-section="reflect-questions"]', { timeout: 15000 }).catch(() => {});
              await sleep(READ);
              await frame(page, 'r5-0-reflect-page', 'R5 — reflection screen: WI-sizing + repeated-actions/roadblocks + general-notes (the S8 deeper retro)');
              // Answer every question (S8 deeper retro: WI-sizing + repeated-actions/roadblocks
              // option questions, plus a per-question general-notes freeform) so allAnswered
              // is satisfied and the submit enables.
              const optionFieldsets = page.locator('[data-question-mode="options"]');
              const nOpt = await optionFieldsets.count();
              for (let i = 0; i < nOpt; i++) {
                await optionFieldsets.nth(i).locator('input[type="radio"]').first().check().catch(() => {});
              }
              const freeformQs = page.locator('[data-question-mode="freeform"] [data-question-freeform]');
              const nFf = await freeformQs.count();
              for (let i = 0; i < nFf; i++) {
                await freeformQs.nth(i).fill('A marker-aware fixture helper would have saved the repeated acceptance read-backs.').catch(() => {});
              }
              await sleep(THINK);
              // The bottom "anything else" freeform (separate from the questions) — extra colour.
              const freeformLocator = page.locator('[data-field="freeform"]');
              if (await freeformLocator.count() > 0) {
                await freeformLocator.click();
                await freeformLocator.pressSequentially(
                  'Dependency ordering held. The send-back (a second --write must be byte-identical) was exactly the right call — it caught a real trailing-newline drift.',
                  { delay: 18 },
                );
              }
              await sleep(ACT);
              await page.locator('[data-action="submit-reflection"]').click().catch(() => {});
              await page.waitForSelector('[data-section="reflect-done"]', { timeout: 10000 }).catch(() => {});
              await paced([
                () => cycleEvent('reflection', 'tool_use', 'reflection.write', { metadata: { tool: 'Write brain theme' } }),
                () => cycleEvent('reflection', 'end', 'reflection.end', { cost_usd: 0.12 }),
              ], WORK);
              await sleep(ACT);
              await frame(page, 'r5-0b-reflected', 'R5 — feedback captured; reflector folds it into the brain');
              // Model B: the reflect node lives on the forge-reflect flow; the threaded run
              // surfaces there via flowLineage (it ran a reflection phase).
              await openStudioMonitor(page, watch, 'forge-reflect');
              await page.locator(`[data-run-id="${CYCLE_ID}"]`).first().click().catch(() => {});
              await sleep(ACT);
              await caption(page, 'And on the Forge Reflect flow — the reflect step that fired automatically on merge.');
              await frame(page, 'r5-1-reflect-flow', 'The Forge Reflect flow on its own monitor — the single reflect hex, fired automatically on merge');
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-mon-node][data-node-id="reflect"]')?.getAttribute('data-status') === 'complete',
                  null, { timeout: 12000 },
                );
                check(true, 'reflection node greened after tuning feedback (/flows/forge-reflect slice)');
              } catch {
                const reflStatus = await page.evaluate(() =>
                  document.querySelector('[data-mon-node][data-node-id="reflect"]')?.getAttribute('data-status') ?? '(absent)');
                check(false, `reflection node greened after tuning feedback (got "${reflStatus}")`);
              }

        },
      },
      {
        id: 'flows-run-monitor-deep-dive',
        title: 'Flow monitor deep-dive — /flows/forge-develop (Model B develop slice)',
        narration: 'Flow monitor deep-dive — /flows/forge-develop (Model B develop slice)',
        drive: async (ctx) => {
              const { page, watch, frame, check, countAtLeast } = ctx;
              // ════════════════════════════════════════════════════════════════════════
              // ACT 3 — SWAP. The seams — the platform is modular, not hardcoded.
              // ════════════════════════════════════════════════════════════════════════

              // Seed a synthetic gated run (INIT2) so the flow-engine control beats (S1) have
              // a gated run to deep-dive, park at its gate, and meter cost against the ceiling.
              INIT2 = `INIT-${DATE}-e2e-studio-demo`;
              STAMP2 = new Date(Date.now() + 1000).toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
              CYCLE_ID2 = `${STAMP2}_${INIT2}`;
              CYCLE_LOG2 = join(FORGE_ROOT, '_logs', CYCLE_ID2);
              studioSeqBase = 0;
              studioEvent = function studioEvent(phase, eventType, message, opts = {}) {
                const { metadata = {}, skill = phase, ...extras } = opts;
                mkdirSync(CYCLE_LOG2, { recursive: true });
                studioSeqBase += 1;
                appendFileSync(join(CYCLE_LOG2, 'events.jsonl'), JSON.stringify({
                  event_id: `EV_stu_${studioSeqBase}`, cycle_id: CYCLE_ID2, initiative_id: INIT2,
                  started_at: new Date().toISOString(), phase, skill,
                  event_type: eventType, input_refs: [], output_refs: [], message, metadata, ...extras,
                }) + '\n');
              }
              mkdirSync(QDIR('ready-for-review'), { recursive: true });
              writeFileSync(join(QDIR('ready-for-review'), `${INIT2}.md`), [
                '---', `initiative_id: ${INIT2}`, `project: ${PROJECT}`, `project_repo_path: ${projectRoot}`,
                `created_at: '${new Date().toISOString()}'`, `cycle_id: ${CYCLE_ID2}`,
                // S9/DEC-3: the gated demo run names forge-develop (the build flow). Its events
                // span architect→pm→dev→unifier→review (gated — no reflect yet), so its
                // flowLineage is [forge-architect, forge-develop] and the S1 monitor deep-dive
                // renders the develop slice (WI fan-out + unifier + review) under Model B.
                'flow_id: forge-develop',
                'iteration_budget: 4', 'cost_budget_usd: 6', 'phase: ready-for-review', 'origin: architect',
                '---', '', '# Studio demo — gated run for the flow-engine controls', '',
                'Add a --check mode to mdtoc that exits non-zero when the embedded TOC is stale.',
              ].join('\n'));
              studioEvent('orchestrator', 'start', 'cycle.start', { metadata: { origin: 'architect' } });
              studioEvent('architect', 'start', 'architect.start');
              studioEvent('architect', 'end', 'architect.end', { cost_usd: 0.22 });
              studioEvent('project-manager', 'start', 'pm phase start');
              studioEvent('project-manager', 'log', 'pm.work-item-emitted', { metadata: { work_item_id: 'WI-1' } });
              studioEvent('project-manager', 'log', 'pm.work-item-emitted', { metadata: { work_item_id: 'WI-2' } });
              studioEvent('project-manager', 'end', 'pm.end', { cost_usd: 0.15 });
              studioEvent('developer-loop', 'start', 'dev-loop start');
              studioEvent('developer-loop', 'log', 'gate.pass', { metadata: { work_item_id: 'WI-1' } });
              studioEvent('developer-loop', 'end', 'WI-1 complete', { metadata: { work_item_id: 'WI-1' } });
              studioEvent('developer-loop', 'log', 'gate.pass', { metadata: { work_item_id: 'WI-2' } });
              studioEvent('developer-loop', 'end', 'WI-2 complete', { metadata: { work_item_id: 'WI-2' } });
              studioEvent('developer-loop', 'end', 'ralph.end', { cost_usd: 0.48 });
              studioEvent('unifier', 'start', 'unifier.start', { skill: 'developer-unifier' });
              for (const [checkId, pass, detail] of [
                ['initiative_gate',    true,  'PLAN.md present'],
                ['demo_runs_clean',    true,  'demo.json valid'],
                ['pr_self_contained',  true,  'no cross-WI deps'],
                ['branches_in_sync',   true,  'branch up-to-date'],
                ['complete_delivery',  true,  'all WIs delivered'],
              ]) {
                studioEvent('unifier', 'log', 'unifier.gate.sub-check',
                  { skill: 'developer-unifier', metadata: { check_id: checkId, pass, detail } });
              }
              studioEvent('unifier', 'end', 'unifier.end', { skill: 'developer-unifier', cost_usd: 0.11 });
              studioEvent('review-loop', 'start', 'review-loop start');
              studioEvent('review-loop', 'log', 'reviewer.pr-opened');
              const artifacts2 = join(CYCLE_LOG2, 'artifacts');
              mkdirSync(artifacts2, { recursive: true });
              writeFileSync(join(artifacts2, 'demo.json'), JSON.stringify({
                title: 'Studio demo — gated run', project: PROJECT, initiativeId: INIT2,
              }, null, 2));
              // F4: the single DEMO.md (DEMO.html is retired — the review page renders markdown).
              writeFileSync(join(artifacts2, 'DEMO.md'), '# Studio demo — gated run\n\n> A gated run for the flow-engine controls.\n');

              // ── S1.0: Flow monitor deep-dive (Model B develop slice + lineage) ────────
              // S9/DEC-3 + Model B: each flow's monitor shows ONLY its own hexes; the ONE
              // threaded run surfaces under all three spine flows via its flowLineage. Deep-dive
              // the develop slice (the dev node fans out into per-WI hexes → unifier → review),
              // then prove the SAME run also renders its architect slice under forge-architect.
              console.log('\n[S1.0] Flow monitor deep-dive — /flows/forge-develop (Model B develop slice)');
              await openStudioMonitor(page, watch, 'forge-develop', CYCLE_ID2);
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 20000 },
                );
                check(true, 'monitor: [data-page="flow-monitor"][data-page-ready="true"]');
              } catch {
                const pr = await page.evaluate(() =>
                  document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') ?? '(no data-page=flow-monitor)');
                check(false, `monitor: data-page-ready (got "${pr}")`);
              }
              await caption(page, 'The Forge Develop monitor — its own slice of the threaded run: the dev-loop fans out into per-WI hexes, then unifier + review. Pan + zoom the hex graph.');
              await sleep(ACT);
              await countAtLeast(page, '[data-run-id]', 1, 'monitor: run rail shows ≥1 [data-run-id]');
              await countAtLeast(page, '[data-mon-node]', 4, 'monitor: develop slice renders ≥4 [data-mon-node] hexes (WI fan-out + unifier + review)');
              await countAtLeast(page, '[data-mon-node][data-hex-kind="wi"]', 2, 'monitor: the dev node fans out into ≥2 per-WI hexes (run-driven)');
              await countAtLeast(page, '[data-mon-node][data-node-id="unifier"]', 1, 'monitor: develop slice shows the unifier phase hex');
              await sleep(READ);
              await frame(page, 's1-0-monitor', 'S1 — Forge Develop slice: WI fan-out + unifier + review');
              const unifierHex = page.locator('[data-node-id="unifier"]').first();
              let drawerOpened = false;
              if ((await unifierHex.count()) > 0) {
                await unifierHex.click();
                try {
                  await page.waitForFunction(
                    () => document.querySelector('#phase-drawer')?.getAttribute('data-drawer-open') === 'true',
                    null, { timeout: 8000 },
                  );
                  drawerOpened = true;
                  check(true, 'monitor: clicking unifier hex opens drawer (data-drawer-open="true")');
                } catch {
                  const state = await page.evaluate(() =>
                    document.querySelector('#phase-drawer')?.getAttribute('data-drawer-open') ?? '(absent)');
                  check(false, `monitor: unifier hex opens drawer (got data-drawer-open="${state}")`);
                }
              } else {
                check(false, 'monitor: [data-node-id="unifier"] hex present to click');
              }
              if (drawerOpened) {
                await sleep(ACT);
                const hasGateSection = await page.evaluate(() =>
                  document.querySelector('#phase-drawer')?.textContent?.includes('Gate sub-checks') ?? false);
                check(hasGateSection, 'monitor: drawer shows Gate sub-checks section');
                const hasPhaseLog = await page.evaluate(() =>
                  document.querySelector('#phase-drawer')?.textContent?.includes('Phase log') ?? false);
                check(hasPhaseLog, 'monitor: drawer shows Phase log section');
                await frame(page, 's1-0b-monitor-drawer', 'S1 — phase drawer open: gate sub-checks + phase log visible');
                const stderrCheck = page.locator('#phase-drawer input[type="checkbox"]').first();
                if ((await stderrCheck.count()) > 0) {
                  await stderrCheck.check();
                  await sleep(THINK);
                  const drawerStillOpen = await page.evaluate(() =>
                    document.querySelector('#phase-drawer')?.getAttribute('data-drawer-open') === 'true');
                  check(drawerStillOpen, 'monitor: drawer still renders after toggling stderr checkbox');
                  await stderrCheck.uncheck();
                } else {
                  check(false, 'monitor: stderr checkbox present in drawer');
                }
              }
              const tailCount = await page.evaluate(() => {
                const el = document.querySelector('[data-tail-count]');
                return el ? el.getAttribute('data-tail-count') : null;
              });
              check(tailCount !== null, `monitor: [data-tail-count] attribute present (got ${tailCount})`);

        },
      },
      {
        id: 'flows-run-start-run-cta',
        title: `Engine — start-run CTA (${SCRATCH_FLOW}, no runs)`,
        narration: `Engine — start-run CTA (${SCRATCH_FLOW}, no runs)`,
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ── S1.1: Engine control — start-run CTA (a genuinely run-less flow) ───────
              // Model B: every spine flow now shows the threaded run via flowLineage, so the
              // run-less flow for the start-run CTA is the author-from-scratch SCRATCH_FLOW
              // (forge-develop-scratch) — a parity copy that was never run, and which the
              // lineage logic correctly excludes (its nodes are a subset of forge-develop's).
              console.log(`\n[S1.1] Engine — start-run CTA (${SCRATCH_FLOW}, no runs)`);
              await page.goto(watch.uiUrl + `/flows/${SCRATCH_FLOW}`, { waitUntil: 'domcontentloaded' });
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 20000 },
                );
                check(true, `engine: flow-monitor ready for ${SCRATCH_FLOW}`);
              } catch {
                const pr = await page.evaluate(() =>
                  document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') ?? '(absent)');
                check(false, `engine: flow-monitor ready for ${SCRATCH_FLOW} (got "${pr}")`);
              }
              await caption(page, 'The engine runs any flow — Start Run launches a planned flow directly from the UI.');
              await sleep(ACT);
              const canStartKi = await page.evaluate(() =>
                document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-can-start') ?? '(absent)');
              check(canStartKi === 'true', `engine: data-can-start="true" on flow-monitor (got "${canStartKi}")`);
              const startBtnEnabled = await page.evaluate(() => {
                const btn = document.querySelector('[data-action="start-run"]');
                return btn !== null && !btn.hasAttribute('disabled');
              });
              check(startBtnEnabled, 'engine: [data-action="start-run"] present and enabled (no real run started)');
              await frame(page, 's1-1-start-run', 'S1 — engine: Start Run CTA enabled on a flow with no runs');

        },
      },
      {
        id: 'flows-run-gate-control',
        title: 'Engine — gate control + cost on the gated run',
        narration: 'Engine — gate control + cost on the gated run',
        drive: async (ctx) => {
              const { page, watch, frame, check, expectPhaseCost } = ctx;
              // ── S1.2: Engine control — gate + cost-ceiling on the gated run ───────────
              console.log('\n[S1.2] Engine — gate control + cost on the gated run');
              await openStudioMonitor(page, watch, 'forge-develop', CYCLE_ID2);
              await caption(page, 'A gated run parks for you — "Open gate →" links straight to the verdict. Cost is metered against the flow ceiling.');
              await sleep(ACT);
              try {
                await page.waitForFunction(
                  (id) => document.querySelector(`[data-run-id="${id}"]`)?.getAttribute('data-run-status') === 'gated',
                  CYCLE_ID2, { timeout: 12000 },
                );
                check(true, 'engine: the seeded run shows status gated on the run rail');
              } catch {
                const got = await page.evaluate((id) =>
                  document.querySelector(`[data-run-id="${id}"]`)?.getAttribute('data-run-status') ?? '(absent)', CYCLE_ID2);
                check(false, `engine: seeded run gated (got "${got}")`);
              }
              await expectPhaseCost(page, 'engine: gated run shows accrued per-phase cost (metered vs ceiling)');

              // F2: monitor-artifacts pill row — at least one [data-artifact-pill] chip
              // (demo.json is seeded for CYCLE_ID2, so the demo chip must be present).
              const monArtifactCount = await page.evaluate(() =>
                document.querySelectorAll('[data-section="monitor-artifacts"] [data-artifact-pill]').length);
              check(monArtifactCount >= 1, `monitor: [data-section="monitor-artifacts"] has ≥1 chip (got ${monArtifactCount})`);
              await frame(page, 's1-2-gate-control', 'S1 — engine: gated run parked, cost metered against the flow ceiling');

        },
      },
    ],
});
