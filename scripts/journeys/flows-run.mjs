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
  writeReflectionArtifacts, writeReleaseArtifact,
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
    story: 'As an operator, I run a gated cycle end-to-end on a real mdtoc feature — idea to architect interview to PLAN gate to an autonomous build to a review gate to merge to reflection — monitoring flow progress and clearing every gate myself from the flow UI.',
    beats: [
      {
        id: 'flows-run-idea',
        title: 'Operator drops the mdtoc idea',
        narration: 'The operator types one real mdtoc feature idea into a single field and hits go — no form, no ceremony — and forge opens a fresh architect interview session to run with it.',
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
        narration: 'Before asking a single question, the architect reads the CLI source and the brain — every tool call and reasoning line streams live into the activity panel, so the operator watches it ground itself in the real codebase rather than guess.',
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
        narration: 'The architect comes back with exactly two clarifying questions — schema default and acceptance fixture — asking only what it genuinely cannot resolve on its own.',
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
        narration: 'The operator answers Q1 with a radio option but overrides Q2 entirely in free text; the question resolves on the typed answer and every radio stays unselected — proving the operator is never boxed into the offered choices.',
        drive: async (ctx) => {
              const { page, frame, check, browser, watch, recordClip } = ctx;
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
                await frame(page, 'r1-3-freetext', 'R1 — P2: operator types a free-text answer on Q2 (overriding the option list)', { key: true });
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

              // CHAPTER CLIP 1 — run-idea-interview: starts at the REAL entry point — the
              // new-idea box on /architect/new — dwells on the idea field + project selector,
              // types the idea text (client-side-only NewIdeaBox state; the start-architect
              // button is never clicked, so no second session is ever created), then
              // transitions to the canonical sid's interview at its still-unanswered
              // awaiting-answers stage (no server mutation has happened yet — the shared
              // page's picks are tab-local React state until submit-answers POSTs). The clip
              // picks Q1 and free-texts Q2 itself, then ends on the answered state WITHOUT
              // submitting — submission is what would mutate the canonical sid, so the clip
              // stops one step short of it.
              await recordClip(browser, watch, 'run-idea-interview', '/architect/new', async (p) => {
                await p.waitForFunction(
                  () => document.querySelector('main[data-page="architect-new"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 15000 },
                ).catch(() => {});
                await caption(p, 'Where it starts — the new-idea box: a project, and what you want built.');
                await p.locator('[data-section="new-idea"] [data-field="project"]').scrollIntoViewIfNeeded().catch(() => {});
                await p.locator('[data-section="new-idea"] [data-field="project"]').hover().catch(() => {});
                await sleep(THINK);
                const ideaField = p.locator('[data-section="new-idea"] [data-field="idea"]');
                await ideaField.scrollIntoViewIfNeeded().catch(() => {});
                await ideaField.click().catch(() => {});
                await ideaField.pressSequentially(
                  'Add a standalone subtest for the gate-task path, reusing SharedReleaseFixture.',
                  { delay: 20 },
                ).catch(() => {});
                await sleep(READ);
                // No click on [data-action="start-architect"] — that would spawn a real
                // second session. Instead: transition straight to the canonical sid's
                // interview, already at the answered-question stage.
                await p.goto(watch.uiUrl + `/architect/${encodeURIComponent(sid)}/interview`, { waitUntil: 'domcontentloaded' });
                await p.waitForSelector('[data-section="architect-interview"]', { timeout: 15000 });
                await caption(p, "Two questions, your call — pick an option, or just say it in your own words.");
                await p.locator('[data-question-index="1"]').scrollIntoViewIfNeeded().catch(() => {});
                await sleep(READ);
                await p.locator('[data-question-index="0"] input[type="radio"]').first().check().catch(() => {});
                await sleep(THINK);
                const clipFreetext = p.locator('[data-question-freetext="1"]');
                if (await clipFreetext.count() > 0) {
                  await clipFreetext.scrollIntoViewIfNeeded().catch(() => {});
                  await clipFreetext.click();
                  await clipFreetext.pressSequentially(
                    'Reuse SharedReleaseFixture, but add a standalone subtest for the gate-task path.',
                    { delay: 20 },
                  );
                  await sleep(THINK);
                  await p.waitForFunction(
                    () => document.querySelector('[data-question-index="1"]')?.getAttribute('data-question-resolved') === 'true',
                    null, { timeout: 5000 },
                  ).catch(() => {});
                } else {
                  await p.locator('[data-question-index="1"] input[type="radio"]').first().check().catch(() => {});
                }
                await sleep(READ);
              }, { readySel: '[data-page="architect-new"]', caption: "From the new-idea box to the architect's clarifying questions — answered, one option and one in your own words" });

              await page.locator('[data-action="submit-answers"]').click();
              await sleep(ACT);
              writeStatus(sid, { phase: 'drafting', round: 2, idea: IDEA });
              archEvent(sid, 'start', 'architect turn (phase=drafting) — rolling in answers');
              await page.waitForSelector('[data-section="architect-interview"]', { state: 'detached', timeout: 8000 }).catch(() => {});
              await burst(sid, ['Read', 'Edit']);
              await frame(page, 'r1-3b-drafting', 'R1 — planning: architect drafts with the answers folded in', { key: true });

        },
      },
      {
        id: 'flows-run-stall',
        title: 'Stall cameo — P1 StuckWarning',
        narration: 'A staged stale heartbeat makes the architect look stuck for two minutes and the StuckWarning lights up; once the session resumes the warning clears on its own — the operator always sees when forge has gone quiet, and when it hasn\'t.',
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
        narration: 'The architect emits its plan and the hex greens at $0.00 — that\'s not a bug: real cycles meter the architect turn out-of-cycle, its duration tracked but its dollar cost billed elsewhere, and the demo owns that honestly rather than hiding it.',
        drive: async (ctx) => {
              const { page, frame } = ctx;
              // ── R1.5: Architect drafts — P4 real cost greens the hex ──────────────────
              console.log('\n[R1.5] Architect drafts — P4 real cost');
              // Grounded (S5, fix item 1): real cycles meter the architect turn at
              // $0 — it runs out-of-cycle (docs/known-gaps.md item 2), not a harness gap.
              await caption(page, '$0.00 — the architect runs out-of-cycle; its duration alone is metered (4 min).');
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
              await frame(page, 'r1-5-architect-cost', 'R1 — P4: architect hex greens ($0.00 — real cycles meter it out-of-cycle)');

        },
      },
      {
        id: 'flows-run-plan-gate',
        title: 'Rich PLAN.html (gate)',
        narration: 'The plan gate presents the architect\'s output as rendered Given/When/Then acceptance-criteria cards, not raw markdown — the same PLAN.html the PM will read verbatim once approved.',
        drive: async (ctx) => {
              const { page, watch, frame, check, browser, recordClip } = ctx;
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
              await frame(page, 'r2-0-plan-html', 'R2 — rich PLAN.html with Given/When/Then AC cards', { key: true });

              // CHAPTER CLIP 2 — run-plan-gate: starts where the operator actually meets the
              // gate — the architect interview page's "Open the plan" action (rendered once
              // the session reaches awaiting-verdict) — clicked for real (a client-side Next
              // Link navigation, not a mutation), landing on the SAME sid's plan gate WHILE
              // the session is still 'awaiting-verdict' — the artifact page live-polls the
              // architect session, so this MUST run before send-back moves the phase to
              // 'drafting'. Pure dwell + hover on send-back/approve — no clicks on those — so
              // the canonical sid never advances a gate the main beats own for real.
              await recordClip(browser, watch, 'run-plan-gate',
                `/architect/${encodeURIComponent(sid)}/interview`,
                async (p) => {
                  await p.waitForSelector('[data-action="open-plan"]', { timeout: 15000 });
                  await caption(p, 'The interview settles, and the plan opens up — click through into the gate.');
                  await p.locator('[data-action="open-plan"]').scrollIntoViewIfNeeded().catch(() => {});
                  await p.locator('[data-action="open-plan"]').hover().catch(() => {});
                  await sleep(THINK);
                  await p.locator('[data-action="open-plan"]').click().catch(() => {});
                  await p.waitForSelector('[data-section="plan-gate"]', { timeout: 15000 });
                  await caption(p, 'Given/When/Then, rendered — not raw markdown. Dwell on it before you decide.');
                  await p.locator('[data-plan-iframe]').scrollIntoViewIfNeeded().catch(() => {});
                  await sleep(WORK);
                  await sleep(READ);
                  const rationaleField = p.locator(
                    '[data-component="plan-gate"] [data-field="rationale"], [data-section="plan-gate"] [data-field="rationale"]'
                  ).first();
                  if (await rationaleField.count() > 0) {
                    await rationaleField.scrollIntoViewIfNeeded().catch(() => {});
                    await rationaleField.hover().catch(() => {});
                  }
                  await sleep(THINK);
                  const approveBtn = p.locator('[data-action="approve-plan"]');
                  if (await approveBtn.count() > 0) {
                    await approveBtn.scrollIntoViewIfNeeded().catch(() => {});
                    await approveBtn.hover().catch(() => {});
                  }
                  await sleep(WORK);
                },
                { readySel: '[data-action="open-plan"]', caption: 'From "Open the plan" to the gate itself — dwell on the plan, send-back in reach, holding on approve' },
              );

        },
      },
      {
        id: 'flows-run-send-back',
        title: 'Send-back + revised plan',
        narration: 'The operator sends the plan back with one concrete piece of feedback (cover the no-markers case); the architect reruns and re-presents a revised plan carrying a "(revised)" badge — human gate #1, working as a real gate.',
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
        narration: 'Approving the plan hands off to the second flow, Forge Develop; clicking "Watch it build" lands on its monitor, which shows only the develop slice\'s own hexes — while the same threaded run\'s architect slice, checked separately, sits complete on its own flow at that honest $0.00.',
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
              // P4: the architect ran in the architect FLOW — assert it reaches complete
              // on the forge-architect slice (the threaded run surfaces there via
              // flowLineage). Grounded (S5, fix item 1): real cycles meter the architect
              // turn at $0 (out-of-cycle accounting — docs/known-gaps.md item 2), so the
              // assertion is on status, not on cost > 0.
              await openStudioMonitor(page, watch, 'forge-architect');
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-mon-node][data-node-id="architect"]')?.getAttribute('data-status') === 'complete',
                  null, { timeout: 12000 },
                );
                check(true, 'P4: architect hex (on /flows/forge-architect) reaches complete (cost is $0 — metered out-of-cycle)');
              } catch {
                const statusVal = await page.evaluate(() =>
                  document.querySelector('[data-mon-node][data-node-id="architect"]')?.getAttribute('data-status') ?? '(absent)');
                check(false, `P4: architect hex reaches complete (got status="${statusVal}")`);
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
        narration: 'The project-manager phase turns the plan\'s acceptance criteria into two dependency-ordered work items straight from Given/When/Then, not vague tasks; clicking either the phase hex or a WI hex opens its own drawer of detail.',
        drive: async (ctx) => {
              const { page, watch, frame, countAtLeast, expectHexOpensDrawer } = ctx;
              // ── R3.0: PM decomposes ACs into work items ───────────────────────────────
              console.log('\n[R3.0] PM decomposes ACs into work items');
              await caption(page, 'Dependency-ordered work items — from G/W/T, not tasks. (Pure inject.ts, then the --write wiring + acceptance read-back.)');
              // Grounded (S5, fix item 6): real PM log lines are 'pm.context-injected'
              // (not 'pm.brain-query') + a richer 'pm.work-item-emitted' metadata shape
              // (source: gitpulse events.jsonl). Cost $0.31 was already in the real
              // $0.31-$1.23 range.
              await paced([
                () => cycleEvent('project-manager', 'start', 'pm phase start'),
                () => cycleEvent('project-manager', 'tool_use', 'pm.context-injected', {
                  metadata: { brain_files: ['brain/projects/mdtoc/themes/structure.md'], manifest_inlined: true, tree_listing: true },
                }),
                () => cycleEvent('project-manager', 'log', 'pm.work-item-emitted', {
                  metadata: {
                    work_item_id: 'WI-1', depends_on: [], files_in_scope: 1, ac_count: 1,
                    task: 'GIVEN a doc with <!-- toc --> / <!-- /toc --> markers WHEN mdtoc --write runs THEN the generated TOC is inserted between them',
                  },
                }),
                () => cycleEvent('project-manager', 'log', 'pm.work-item-emitted', {
                  metadata: {
                    work_item_id: 'WI-2', depends_on: ['WI-1'], files_in_scope: 2, ac_count: 1,
                    task: 'GIVEN the embedded TOC is already current WHEN mdtoc --write runs again THEN the file is unchanged',
                  },
                }),
              ], WORK);
              await frame(page, 'r3-0-pm-midpulse', 'R3 (mid-pulse) — PM hex active as it emits work items');
              cycleEvent('project-manager', 'log', 'pm.spec-lint', { metadata: { status: 'clean' } });
              await pace('fastForward');
              cycleEvent('project-manager', 'log', 'pm.graph-emitted', { metadata: { node_count: 2, edge_count: 1 } });
              await pace('fastForward');
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
        narration: 'The dev-loop\'s first move on WI-1 is a failing test — gate.expected-fail fires before any implementation exists — TDD is the loop\'s actual discipline, not a claim in a prompt.',
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
        narration: 'The dev-loop keeps grinding on WI-1 (fast-forwarded here): tool calls accumulate and the token/cost bar climbs live — the operator can watch the actual work happen, not a spinner.',
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
              // Grounded (S5, fix item 7): 'usage_delta' IS a real message (47x in the
              // gitpulse unifier phase); enriched with the real cache-token fields.
              cycleEvent('developer-loop', 'log', 'usage_delta', {
                metadata: { work_item_id: 'WI-1', input_tokens: 1800, output_tokens: 600, cache_read_tokens: 12400, cache_creation_tokens: 2100 },
              });
              await sleep(WORK);
              cycleEvent('developer-loop', 'log', 'usage_delta', {
                metadata: { work_item_id: 'WI-1', input_tokens: 2100, output_tokens: 900, cache_read_tokens: 15800, cache_creation_tokens: 1400 },
              });
              await sleep(WORK);
              await frame(page, 'r3-2-grind', 'R3 (fast-forward) — dev-loop implementing WI-1; token/cost bar growing');

        },
      },
      {
        id: 'flows-run-dependency-gate',
        title: 'Gate.pass + WI-1 green → WI-2 starts',
        narration: 'WI-1\'s gate passes and only then does WI-2 — which declared WI-1 as a dependency — begin: the scheduler enforces the ordering the plan declared, visibly, rather than racing both work items at once.',
        drive: async (ctx) => {
              const { page, frame } = ctx;
              // ── R3.3: Dependency gate + gate.pass ─────────────────────────────────────
              console.log('\n[R3.3] Gate.pass + WI-1 green → WI-2 starts');
              await runningTimer(page, false);
              await caption(page, 'Red four minutes ago — now green. WI-2 (the --write wiring + acceptance read-back) only started once WI-1 was done.');
              cycleEvent('developer-loop', 'log', 'gate.pass', { metadata: { work_item_id: 'WI-1' } });
              await sleep(THINK);
              // Grounded (S5, fix item 7): iteration cost/tokens are the real CUMULATIVE
              // per-WI totals (source: gitpulse events.jsonl WI costs 0.6676/1.0856/1.2087,
              // tokens_out ~15-17k) — not a flat per-iteration delta.
              cycleEvent('developer-loop', 'iteration', 'WI-1 iteration', {
                iteration: 1, tokens_in: 989, tokens_out: 16679, cost_usd: 0.6676270500000001, duration_ms: 332582,
                metadata: { work_item_id: 'WI-1' },
              });
              await sleep(THINK);
              cycleEvent('developer-loop', 'end', 'WI-1 complete', { metadata: { work_item_id: 'WI-1' } });
              await sleep(WORK);
              await frame(page, 'r3-3-wi1-green', 'R3 — gate.pass; WI-1 green; WI-2 (depends on WI-1) only now starts');
              cycleEvent('developer-loop', 'tool_use', 'tool.Edit', { metadata: { work_item_id: 'WI-2', tool: 'Edit' } });
              await sleep(THINK);
              cycleEvent('developer-loop', 'log', 'usage_delta', {
                metadata: { work_item_id: 'WI-2', input_tokens: 1200, output_tokens: 400, cache_read_tokens: 9600, cache_creation_tokens: 800 },
              });
              await sleep(WORK);
              // Grounded (S5, fix item 7): the real WI-2 iteration was missing cost/tokens
              // in the seeded event entirely — now carries the real cumulative totals.
              cycleEvent('developer-loop', 'iteration', 'WI-2 iteration', {
                iteration: 1, tokens_in: 34, tokens_out: 14305, cost_usd: 1.0856373499999998, duration_ms: 253165,
                metadata: { work_item_id: 'WI-2' },
              });
              cycleEvent('developer-loop', 'end', 'WI-2 complete', { metadata: { work_item_id: 'WI-2' } });
              // ralph.end sums the two WIs' real costs/durations above (0.6676 + 1.0856 ≈ 1.7533).
              cycleEvent('developer-loop', 'end', 'ralph.end', { cost_usd: 1.7532643999999998, duration_ms: 585747 });
              await sleep(WORK);
              await frame(page, 'r3-3b-devloop-green', 'R3 — dev-loop hex greens (both WIs done); unifier runs next on its own hex');

        },
      },
      {
        id: 'flows-run-unifier',
        title: 'Unifier on its own hex',
        narration: 'With both work items green, the unifier phase\'s own hex activates and merges them into one branch, runs the gate, and authors the demo — the seam between many parallel WIs and one reviewable change, made visible.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ── R3.4: Unifier on its OWN hex ──────────────────────────────────────────
              console.log('\n[R3.4] Unifier on its own hex');
              await caption(page, 'A separate phase reviews the branch and authors the demo — with captured CLI read-back evidence.');
              // Grounded (S5, fix items 3/8/14): a representative dozen+ real unifier
              // events (not the ~5 invented ones, and not the full 130-event corpus
              // breakdown either) — real message names + skill developer-unifier, real
              // cost/duration (source: gitpulse events.jsonl unifier phase: 56 log/51
              // tool_use/23 heartbeat/3 file_change, cost 1.1984, dur 357551ms). Filler
              // events use fastForward pacing so the video doesn't lengthen materially.
              await paced([
                () => unifierEvent('start', 'unifier-phase.start', { metadata: { resumed: false } }),
                () => unifierEvent('tool_use', 'tool.TodoWrite', { metadata: { tool: 'TodoWrite' } }),
              ], WORK);
              await frame(page, 'r3-4-unifier-midpulse', 'R3 (mid-pulse) — unifier hex active, running the gate + acceptance on the merged branch');
              unifierEvent('tool_use', 'tool.Bash', { metadata: { tool: 'Bash: npm test && npm run acceptance' } });
              await pace('fastForward');
              unifierEvent('log', 'usage_delta', {
                metadata: { input_tokens: 3200, output_tokens: 1100, cache_read_tokens: 18200, cache_creation_tokens: 900 },
              });
              await pace('fastForward');
              unifierEvent('agent_heartbeat', 'agent.heartbeat');
              await pace('fastForward');
              for (const [checkId, detail] of [
                ['initiative_gate', 'PLAN.md present, ACs match manifest'],
                ['pr_self_contained', 'no cross-WI dependency leakage'],
                ['demo_fanin_honesty', 'demo metadata matches the post-fan-in branch (diffStat re-derived + refreshed)'],
                ['branches_in_sync', 'branch up-to-date with main'],
                ['complete_delivery', 'both WIs delivered, no orphan work'],
              ]) {
                unifierEvent('log', 'unifier.gate.sub-check', { metadata: { check_id: checkId, pass: true, detail } });
                await pace('fastForward');
              }
              unifierEvent('log', 'unifier.demo-capture', { metadata: { kind: 'screenshot', label: 'README TOC region — before vs after --write' } });
              await pace('fastForward');
              unifierEvent('log', 'unifier.demo-metadata-refreshed', { metadata: { branch: `forge/${INIT}` } });
              await sleep(THINK);
              unifierEvent('tool_use', 'tool.Bash', { metadata: { tool: 'Bash: forge demo render' } });
              await sleep(THINK);
              writeDemoJson(1);
              unifierEvent('log', 'unifier.branch-pushed', { metadata: { branch: `forge/${INIT}` } });
              await sleep(THINK);
              unifierEvent('end', 'unifier.end', { cost_usd: 1.1984102000000005, duration_ms: 357551 });
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
        narration: 'The cycle badge sums exactly what dev-loop and unifier already accrued ($1.75 + $1.20) — the rollup is arithmetic on real per-phase numbers the operator watched tick up, not a separate estimate.',
        drive: async (ctx) => {
              const { page, watch, frame, check, expectPhaseCost, browser, recordClip } = ctx;
              // ── R3.5: Cost rollup across the spine ────────────────────────────────────
              console.log('\n[R3.5] Cost rollup');
              cycleEvent('review-loop', 'start', 'review-loop start');
              cycleEvent('review-loop', 'log', 'reviewer.pr-opened');
              moveManifest('in-flight', 'ready-for-review');
              // Grounded (S5, fix items 7/8): dev-loop $1.75 (0.6676 + 1.0856), unifier $1.20 —
              // paired with the grounded costs in flows-run-dependency-gate + flows-run-unifier.
              await caption(page, 'Forge Develop, costed per phase — dev-loop $1.75, unifier $1.20 — under its ceiling. (The Architect flow bills separately.)');
              await openStudioMonitor(page, watch);
              await sleep(READ);
              await frame(page, 'r3-5-cost-rollup', 'R3 — cost rollup across the spine (Studio monitor)', { key: true });
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

              // CHAPTER CLIP 3 — run-build-monitor: starts at the library — the real Flows nav
              // entry a user clicks — then lands on the SAME CYCLE_ID's forge-develop
              // monitor: a pure GET re-read of the already gated run's event log, so nothing
              // about the canonical cycle is mutated. The hex click just opens/observes the
              // phase drawer (read-only), mirroring the established expectHexOpensDrawer
              // visual without asserting inside the clip.
              await recordClip(browser, watch, 'run-build-monitor', '/', async (p) => {
                await p.waitForFunction(
                  () => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 15000 },
                ).catch(() => {});
                await caption(p, 'From the library — the Flows nav is where a run in progress is watched.');
                await p.locator('[data-nav="flows"]').scrollIntoViewIfNeeded().catch(() => {});
                await sleep(THINK);
                await p.locator('[data-nav="flows"]').click().catch(() => {});
                await p.waitForFunction(
                  () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 15000 },
                ).catch(() => {});
                const runCard = p.locator(`[data-run-id="${CYCLE_ID}"]`).first();
                if (await runCard.count() > 0) { await runCard.click().catch(() => {}); await sleep(ACT); }
                await caption(p, 'Watch it build — the WI hexes fan out, the unifier reviews on its own node, cost accrues live.');
                await sleep(WORK);
                await p.locator('[data-mon-node][data-hex-kind="wi"]').first().scrollIntoViewIfNeeded().catch(() => {});
                await sleep(READ);
                const unifierHex = p.locator('[data-mon-node][data-node-id="unifier"]').first();
                if (await unifierHex.count() > 0) {
                  await unifierHex.scrollIntoViewIfNeeded().catch(() => {});
                  await unifierHex.click().catch(() => {});
                  await p.waitForFunction(
                    () => document.querySelector('#phase-drawer')?.getAttribute('data-drawer-open') === 'true',
                    null, { timeout: 8000 },
                  ).catch(() => {});
                }
                await sleep(WORK);
              }, { readySel: '[data-page="library"]', caption: 'From the library, into the flow monitor — WI fan-out, unifier own-node, cost pills accruing' });

        },
      },
      {
        id: 'flows-run-review-comment',
        title: 'Review — comment-on-page visual demo (PARTIAL)',
        narration: 'The review page renders the actual DEMO.md with a before/after slider and per-region comment anchors; AC-2 reads PARTIAL — a real gap surfaces before the operator ever has to decide anything.',
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
        narration: 'The operator anchors a blocking comment directly on AC-2 instead of filling out a form; the page derives a send-back verdict from that comment alone, and it survives a reload — progressing the gate through the flow UI, on the artifact itself.',
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
        narration: 'The anchored comment routes straight back to the dev-loop, which reruns on exactly that criterion and re-renders the demo — the send-back was real routing, not a dead-end button.',
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
        narration: 'AC-2 now reads MET; resolving the original blocking comment flips the page\'s derived verdict from send-back back to approve — the loop closed on the operator\'s own criterion, not a generic re-run.',
        drive: async (ctx) => {
              const { page, frame, check, countAtLeast, browser, watch, recordClip } = ctx;
              // ── R4.3: Re-review — PARTIAL→MET (payoff) ────────────────────────────────
              console.log('\n[R4.3] Re-review — PARTIAL→MET');
              await sleep(ACT);
              await page.goto(REVIEW_URL, { waitUntil: 'domcontentloaded' });
              await page.waitForSelector('[data-page-ready="true"]', { timeout: 30000 }).catch(() => {});
              await page.waitForSelector('[data-section="demo-comparison"]', { timeout: 15000 });
              await caption(page, 'Partial → corrected → met. The loop closed on your criterion.');
              await page.locator('[data-section="demo-evaluation"]').scrollIntoViewIfNeeded().catch(() => {});
              await sleep(READ);
              await frame(page, 'r4-3-rereview-met', 'R4 — re-review: AC-2 now MET (PARTIAL→MET payoff)', { key: true });
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

              // CHAPTER CLIP 4 — run-verdict-gate: starts on the SAME CYCLE_ID's forge-develop
              // monitor, at the "Open gate →" affordance the run rail shows once a run is
              // gated — clicked for real (a client-side Link, not a mutation) — landing on the
              // verdict surface at exactly this checkpoint: comment resolved, every AC met,
              // verdict already derived to 'approve' — a pure GET re-read, no mutation. It
              // ends holding on (hovering, never clicking) approve-and-merge; the next beat
              // owns the real click that actually merges.
              await recordClip(browser, watch, 'run-verdict-gate', '/flows/forge-develop',
                async (p) => {
                  await p.waitForFunction(
                    () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
                    null, { timeout: 15000 },
                  ).catch(() => {});
                  await caption(p, 'Gated, and waiting on you — "Open gate" is the way in.');
                  const openGateLink = p.locator(`[data-run-id="${CYCLE_ID}"][data-run-status="gated"] a`).first();
                  if (await openGateLink.count() > 0) {
                    await openGateLink.scrollIntoViewIfNeeded().catch(() => {});
                    await sleep(THINK);
                    await openGateLink.click().catch(() => {});
                  } else {
                    await p.goto(watch.uiUrl + `/artifact?run=${encodeURIComponent(CYCLE_ID)}&type=verdict&mode=gate`, { waitUntil: 'domcontentloaded' });
                  }
                  await p.waitForSelector('[data-page-ready="true"]', { timeout: 20000 }).catch(() => {});
                  await p.waitForSelector('[data-section="demo-comparison"]', { timeout: 15000 }).catch(() => {});
                  await caption(p, 'Partial, corrected, met — every acceptance criterion accountable, the comment resolved on record.');
                  await p.locator('[data-section="demo-evaluation"]').scrollIntoViewIfNeeded().catch(() => {});
                  await sleep(WORK);
                  await sleep(READ);
                  const ac2Clip = p.locator('[data-demo-region="ac-2"]');
                  if (await ac2Clip.count() > 0) {
                    await ac2Clip.scrollIntoViewIfNeeded().catch(() => {});
                    await sleep(THINK);
                  }
                  await p.locator('[data-component="verdict-form"]').scrollIntoViewIfNeeded().catch(() => {});
                  const approveMergeBtn = p.locator('[data-component="verdict-form"] [data-action="approve-and-merge"]');
                  if (await approveMergeBtn.count() > 0) await approveMergeBtn.hover().catch(() => {});
                  await sleep(WORK);
                },
                { readySel: '[data-page="flow-monitor"]', caption: 'From "Open gate" on the monitor into the verdict surface — demo comparison, resolved comment, holding on approve-and-merge' },
              );

        },
      },
      {
        id: 'flows-run-approve-merge',
        title: 'Approve & merge → completed spine',
        narration: 'The operator approves and the PR merges for real; the run rail deliberately holds at "active" rather than "complete" while reflection is still in flight — a merged cycle genuinely isn\'t done until its lesson lands, and the monitor tells the truth about that.',
        drive: async (ctx) => {
              const { page, watch, frame, check, countAtLeast, expectPhaseCost } = ctx;
              // ── R4.4: Approve & merge → completed spine ───────────────────────────────
              console.log('\n[R4.4] Approve & merge → completed spine');
              await caption(page, 'Comment resolved → the page derives "approve". Every acceptance criterion accountable at the Forge Develop gate.');
              await sleep(ACT);
              await frame(page, 'r4-4-approve', 'R4 — operator approves (human decision #2 complete)');
              await page.locator('[data-component="verdict-form"] [data-action="approve-and-merge"]').click();
              await page.waitForSelector('[data-component="verdict-form"][data-form-state="submitted"]', { timeout: 10000 }).catch(() => {});
              // Grounded (S5, fix items 4/10): real closure is TWO-PASS — pr-open
              // (awaiting operator) then, after release-finalize runs, merged +
              // post-merge-ci — matching orchestrator/phases/closure.ts +
              // release-finalize.ts message names exactly. The bridge's OWN
              // release-finalize path is neutralised for the whole ui:journey run
              // (e2e-journey.mjs strips project.json's releaseProcess for the run), so
              // this is pure seeded fixture data — no collision with a real backend write.
              await paced([
                () => cycleEvent('review-loop', 'end', 'review-loop end — operator approved', { cost_usd: 0.21, skill: 'review-verdict' }),
                () => cycleEvent('closure', 'start', 'closure.start', { metadata: { reviewer_outcome: 'pr-open' } }),
                () => cycleEvent('closure', 'log', 'closure.pr-open-awaiting-operator', { metadata: { outcome: 'pr-open', merged: false } }),
                () => cycleEvent('closure', 'end', 'closure.end', { metadata: { outcome: 'pr-open', merged: false } }),
              ], WORK);
              cycleEvent('release-finalize', 'start', 'release-finalize.start', { metadata: { project: PROJECT } });
              await pace('fastForward');
              const releaseJsonPath = writeReleaseArtifact('0.2.0');
              cycleEvent('release-finalize', 'end', 'release.finalized', {
                cost_usd: 0.2851268500000001, duration_ms: 53990, output_refs: [releaseJsonPath],
                metadata: { project: PROJECT, version: '0.2.0', branch: `forge/${INIT}`, changelog_path: 'CHANGELOG.md' },
              });
              await pace('fastForward');
              await paced([
                () => cycleEvent('closure', 'start', 'closure.start', { metadata: { reviewer_outcome: 'pr-open' } }),
                () => cycleEvent('closure', 'log', 'closure.manifest-moved-to-done', { metadata: { confirmed_merge: true } }),
                () => cycleEvent('closure', 'log', 'cycle.post-merge-ci', { metadata: { status: 'green', needs_operator: false } }),
                () => cycleEvent('closure', 'end', 'closure.end', { metadata: { outcome: 'merged', merged: true } }),
                () => cycleEvent('reflection', 'start', 'reflection.start'),
                () => cycleEvent('reflection', 'tool_use', 'reflection.brain-query', { metadata: { tool: 'brain-query' } }),
              ], WORK);
              // NOTE: the terminal reflection.end event now lives SOLELY in the
              // flows-run-reflect beat below — no more duplicate 'reflection.end' emitted
              // here before the reflect screen has actually run.
              moveManifest('ready-for-review', 'done');
              writeReflectionQuestions();
              writeReflectionArtifacts();
              await page.waitForSelector('[data-action="open-reflect"]', { timeout: 15000 }).catch(() => {});
              await sleep(ACT);
              await frame(page, 'r4-4b-reflect-link', 'R4 — merged; "Reflect on this cycle →" surfaces the final human moment');
              await openStudioMonitor(page, watch);
              await page.locator(`[data-run-id="${CYCLE_ID}"]`).first().click().catch(() => {});
              // Grounded truth: at merge time the run is NOT complete yet — reflection is
              // still in flight (reflection.start emitted, no end), and the run model
              // truthfully reconciles done/-with-unfinished-reflect back to 'active'.
              // The rail flips to 'complete' only after the reflect beat (asserted there).
              await page.waitForSelector(`[data-run-id="${CYCLE_ID}"][data-run-status="active"]`, { timeout: 15000 }).catch(() => {});
              await sleep(READ);
              await frame(page, 'r4-4c-spine-complete', 'R4 — merged; the spine holds at "active" while reflection finishes out-of-band');
              {
                const got = await page.evaluate((id) =>
                  document.querySelector(`[data-run-id="${id}"]`)?.getAttribute('data-run-status') ?? '(absent)', CYCLE_ID);
                check(got === 'active', `monitor: merged run stays "active" while reflection is in flight (got "${got}")`);
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
        narration: 'The operator answers the reflection questions — WI sizing, repeated actions, a free-text lesson — and only once that submits does the reflector write a brain theme and the run rail finally flips to complete.',
        drive: async (ctx) => {
              const { page, watch, frame, check, browser, recordClip } = ctx;
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
              // R5-01-FIX2: reflect-answer is dry-bridge stub-actions (200 + skipped
              // agent-turn marker), not refuse (409) — this must actually assert the
              // feedback-captured DOM state rather than swallow a timeout, or a
              // regression back to 409 goes unnoticed (the beat used to silently pass
              // straight through a refusal).
              check(
                await page.locator('[data-section="reflect-done"]').count() > 0,
                'reflect-answer: feedback captured (dry-bridge stub-actions returns 200, not a 409 refusal)',
              );
              await paced([
                () => cycleEvent('reflection', 'tool_use', 'reflection.write', { metadata: { tool: 'Write brain theme' } }),
                () => cycleEvent('reflection', 'end', 'reflection.end', { cost_usd: 0.12 }),
              ], WORK);
              await sleep(ACT);
              await frame(page, 'r5-0b-reflected', 'R5 — feedback captured; reflector folds it into the brain', { key: true });
              // Model B: the reflect node lives on the forge-reflect flow; the threaded run
              // surfaces there via flowLineage (it ran a reflection phase).
              await openStudioMonitor(page, watch, 'forge-reflect');
              await page.locator(`[data-run-id="${CYCLE_ID}"]`).first().click().catch(() => {});
              await sleep(ACT);
              await caption(page, 'And on the Forge Reflect flow — the reflect step that fired automatically on merge.');
              await frame(page, 'r5-1-reflect-flow', 'The Forge Reflect flow on its own monitor — the single reflect hex, fired automatically on merge', { key: true });
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
              // With reflection.end now emitted, the run model's reconciler lets the
              // done/-based 'complete' stand — the payoff the approve-merge beat deferred.
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

              // CHAPTER CLIP 5 — run-reflect-complete: starts on the forge-reflect monitor,
              // selects the SAME CYCLE_ID's run card, then clicks the "Review reflection"
              // affordance the monitor surfaces once the persistent, server-derived
              // artifactsReady.reflection flag is set — a real client-side navigation, not a
              // mutation. Submission already happened for real on the shared page earlier in
              // this beat (user-feedback.md is now on disk), so landing on the reflection view
              // is a pure GET that reads the ALREADY-answered state straight back — no second
              // submit, no duplicated cycle/reflection events. It then re-drives the
              // forge-reflect monitor (also a pure GET re-read) to hold on the reflect hex
              // green + the run rail already reading complete.
              await recordClip(browser, watch, 'run-reflect-complete', '/flows/forge-reflect',
                async (p) => {
                  await p.waitForFunction(
                    () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
                    null, { timeout: 15000 },
                  ).catch(() => {});
                  const entryRunCard = p.locator(`[data-run-id="${CYCLE_ID}"]`).first();
                  if (await entryRunCard.count() > 0) { await entryRunCard.click().catch(() => {}); await sleep(ACT); }
                  await caption(p, "Forge improves — you're the teacher, and the review link is right there on the completed run.");
                  const reviewReflectionLink = p.locator('[data-banner="reflection-ready"] [data-action="review-reflection"]').first();
                  if (await reviewReflectionLink.count() > 0) {
                    await reviewReflectionLink.scrollIntoViewIfNeeded().catch(() => {});
                    await sleep(THINK);
                    await reviewReflectionLink.click().catch(() => {});
                  } else {
                    await p.goto(watch.uiUrl + `/artifact?run=${encodeURIComponent(CYCLE_ID)}&type=reflection&mode=view`, { waitUntil: 'domcontentloaded' });
                  }
                  await p.waitForSelector('[data-page-ready="true"]', { timeout: 20000 }).catch(() => {});
                  await p.waitForSelector('[data-section="reflect-done"]', { timeout: 10000 }).catch(() => {});
                  await sleep(WORK);
                  await sleep(READ);
                  await p.goto(watch.uiUrl + '/flows/forge-reflect', { waitUntil: 'domcontentloaded' });
                  await p.waitForFunction(
                    () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
                    null, { timeout: 15000 },
                  ).catch(() => {});
                  const reflectRunCard = p.locator(`[data-run-id="${CYCLE_ID}"]`).first();
                  if (await reflectRunCard.count() > 0) { await reflectRunCard.click().catch(() => {}); await sleep(ACT); }
                  await caption(p, 'The reflect hex greens on its own flow — and the run rail finally reads complete.');
                  await sleep(WORK);
                  await sleep(READ);
                },
                { readySel: '[data-page="flow-monitor"]', caption: 'From the completed run’s review link to the reflection itself — the lesson banked, the run rail reading complete' },
              );

        },
      },
      {
        id: 'flows-run-monitor-deep-dive',
        title: 'Flow monitor deep-dive — /flows/forge-develop (Model B develop slice)',
        narration: 'On a freshly gated run, clicking the unifier hex opens its own drawer of gate sub-checks and phase log — every phase and WI hex from a live cycle stays this inspectable, not just while it\'s running.',
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
                // Grounded (S5, fix item 2): distinct-but-realistic from the primary
                // cycle's grounded 10/4 (real range 6-24 / $4-$80).
                'iteration_budget: 6', 'cost_budget_usd: 8', 'phase: ready-for-review', 'origin: architect',
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
              // Grounded (S5, fix item 14): 'demo_runs_clean' renamed to the real
              // check_id 'demo_fanin_honesty' — the other 4 check_ids were already real
              // (source: gitpulse/betterado unifier.gate.sub-check events).
              for (const [checkId, pass, detail] of [
                ['initiative_gate',    true,  'PLAN.md present'],
                ['demo_fanin_honesty', true,  'demo metadata matches the post-fan-in branch (diffStat re-derived + refreshed)'],
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
        narration: `On the from-scratch ${SCRATCH_FLOW} flow — never yet run — the Start Run button is live and enabled, proving the engine can launch any authored flow directly from the UI, not only the seeded production ones.`,
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
        narration: 'A second run parks itself at its gate and links straight through to the verdict screen, its accrued cost metered against the flow\'s own ceiling — the operator progresses this gate from the monitor, not a separate tool.',
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
