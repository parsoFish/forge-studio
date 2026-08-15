import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  FORGE_ROOT, PROJECT, projectRoot,
  IDEA, DATE, INIT, CYCLE_ID, AUTO_CYCLE_ID,
  SCRATCH_FLOW,
  READ, WORK, ACT, THINK, pace, QDIR,
  caption, runningTimer,
  archDir, writeStatus, archEvent, archReasoning, burst, paced, writeQuestions,
  EMULATED_ARCHITECT_COST_USD, EMULATED_ARCHITECT_DURATION_MS, writePlan,
  DAG_SESSION_INITIATIVES, DAG_SESSION_UNRESOLVED_DEP, writeRoadmapDagSession, cleanRoadmapDagSession,
  cycleEvent, unifierEvent, demoAgentEvent, adversarialReviewEvent, writePrDescription, moveManifest, seedReviewWorktree, writeDemoJson, writeReviewFindings, writeReflectionQuestions,
  writeAutomatedReflection, writeReflectionArtifacts, writeReleaseArtifact,
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
              // R2-10 PR2: /architect/new pushes straight to the shared session
              // shell (/sessions/architect/<sid>) — it never touches the retired
              // /architect/<sid>/interview route at all (that path is now a
              // redirect stub for stale inbound links only, never hit by a real
              // click here).
              await page.waitForURL(/\/sessions\/architect\/[^/]+/, { timeout: 15000 });
              sid = decodeURIComponent(page.url().split('/sessions/architect/')[1].split('/')[0]);
              ctx.seeded.createdSid = sid; // read by the runner's finally-block cleanup
              console.log(`[e2e] architect session: ${sid}`);
              check(!!sid, '[data-action="start-architect"] navigates to /sessions/architect/<sid>');

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
              // R2-10 PR2: the retired per-kind data-page is gone — the shared
              // shell carries data-page="session" + data-session-kind="architect"
              // on <main>, with data-session-phase mirroring the real phase.
              await page.waitForSelector('main[data-page="session"][data-session-kind="architect"]', { timeout: 15000 });
              await page.waitForSelector('[data-component="architect-hex"]', { timeout: 15000 });
              const groundingPhase = await page.evaluate(
                () => document.querySelector('main[data-page="session"]')?.getAttribute('data-session-phase') ?? null);
              check(groundingPhase === 'interviewing',
                `R2-10: session shell reflects the real phase (data-session-phase, got "${groundingPhase}")`);
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
              // R2-10: every turn is DERIVED from a real checkpoint file and names
              // it. For the architect kind that is idea.md first (the operator's
              // own idea, written by POST /api/architect/start), then a pending
              // AGENT turn from questions.json while phase is exactly
              // 'awaiting-answers'. Assert BOTH — the ordering is the derivation
              // contract in orchestrator/studio/session-transcript.ts, and an
              // index-blind "some turn exists" check would not catch a
              // regression that reordered them.
              await page.waitForFunction(
                () => Array.from(document.querySelectorAll('[data-turn-source]'))
                  .some((el) => el.getAttribute('data-turn-source') === 'questions.json'),
                null, { timeout: 8000 },
              ).catch(() => {});
              const derivedTurns = await page.evaluate(() =>
                Array.from(document.querySelectorAll('[data-turn-index]')).map((el) => ({
                  index: el.getAttribute('data-turn-index'),
                  role: el.getAttribute('data-turn-role'),
                  source: el.getAttribute('data-turn-source'),
                })));
              const ideaTurn = derivedTurns.find((t) => t.index === '0');
              check(ideaTurn !== undefined && ideaTurn.role === 'operator' && ideaTurn.source === 'idea.md',
                `R2-10: turn 0 is the operator's own idea, derived from idea.md (got ${JSON.stringify(ideaTurn ?? null)})`);
              const questionsTurn = derivedTurns.find((t) => t.source === 'questions.json');
              check(questionsTurn !== undefined && questionsTurn.role === 'agent',
                `R2-10: the pending interview round is an AGENT turn derived from questions.json (got ${JSON.stringify(questionsTurn ?? null)}; all: ${JSON.stringify(derivedTurns.map((t) => t.source))})`);
              // R2-10: the artifact pane — architect's declared renderer is
              // roadmap-draft, with a non-empty label sourced from
              // studio/session-kinds.yaml over the wire (never a client lookup).
              check(await page.locator('[data-section="session-artifact"][data-artifact-kind="roadmap-draft"]').count() > 0,
                'R2-10: session artifact pane renders the roadmap-draft renderer for the architect kind');
              const archArtifactLabel = await page.evaluate(
                () => document.querySelector('[data-section="session-artifact"]')?.getAttribute('data-artifact-label') ?? '');
              check(archArtifactLabel.length > 0, `R2-10: artifact pane carries a non-empty data-artifact-label (got "${archArtifactLabel}")`);

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
                // interview, already at the answered-question stage. R2-10 PR2: target
                // the shared session shell directly (/sessions/architect/<sid>) — the
                // retired /architect/<sid>/interview route is a redirect stub only.
                await p.goto(watch.uiUrl + `/sessions/architect/${encodeURIComponent(sid)}`, { waitUntil: 'domcontentloaded' });
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
              // R4-04-F4: the explicit exploring stage sits between the
              // interview and the draft — edge cases + brain constraints are
              // enumerated with dispositions before any initiative is drafted.
              writeStatus(sid, { phase: 'exploring', round: 2, idea: IDEA });
              archEvent(sid, 'start', 'architect turn (phase=exploring) — enumerating edge cases + brain constraints');
              // R2-10 PR2: the per-kind data-architect-phase moved off <main> (it
              // still lives on the architect-hex sub-component); the shell's own
              // phase now lives at data-session-phase on <main data-page="session">.
              await page.waitForFunction(
                () => document.querySelector('main[data-page="session"]')?.getAttribute('data-session-phase') === 'exploring',
                null, { timeout: 8000 },
              ).catch(() => {});
              const explorePhase = await page.evaluate(
                () => document.querySelector('main[data-page="session"]')?.getAttribute('data-session-phase') ?? null);
              check(explorePhase === 'exploring', `R1: the exploring stage is visible in the interview UI (data-session-phase, got "${explorePhase}")`);
              await frame(page, 'r1-3a-exploring', 'R1 — planning: the architect explores edge cases before drafting (R4-04-F4)');
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
                // F5 (R4-11-T5): the StuckWarning's one-click re-run affordance —
                // asserted present, then driven, without disturbing the
                // resume-clears-staleness assertion right below (rerun never
                // mutates status.json; the dry-bridge/NO_SPAWN seam suppresses
                // the actual spawn under this harness).
                const rerunBtn = page.locator('[data-action="architect-rerun"]');
                const rerunPresent = (await rerunBtn.count()) > 0;
                check(rerunPresent, 'F5: [data-action="architect-rerun"] one-click re-run button present on StuckWarning');
                if (rerunPresent) {
                  await rerunBtn.click();
                  try {
                    await page.waitForSelector('[data-rerun-state="idle"], [data-rerun-state="error"]', { timeout: 5000 });
                    check(true, 'F5: architect-rerun click resolves the request state (dry-bridge/NO_SPAWN spawn suppressed)');
                  } catch {
                    check(false, 'F5: architect-rerun click resolves the request state (dry-bridge/NO_SPAWN spawn suppressed)');
                  }
                }
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
        id: 'flows-run-roadmap-dag',
        title: 'The roadmap draft is a DAG, not a list',
        narration: 'A roadmap is its dependency edges. The architect session\'s artifact pane renders the draft as a dependency DAG — levels, edges, and the one edge that points at an initiative outside this draft, surfaced rather than quietly dropped.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ── R1.6: R4-15 — the roadmap-draft artifact renders its edges ────────────
              console.log('\n[R1.6] R4-15 — roadmap draft as a dependency DAG');
              // A dedicated seeded session: the canonical sid's manifests are PROMOTED on
              // approve, so its draft deliberately stays one initiative. This one carries
              // three real manifests with real depends_on_initiatives edges (one pointing
              // outside the draft set) and is removed again below — it never reaches a gate.
              const dagSid = `${sid}-dag`;
              writeRoadmapDagSession(dagSid);
              try {
                await page.goto(watch.uiUrl + `/sessions/architect/${encodeURIComponent(dagSid)}`, { waitUntil: 'domcontentloaded' });
                await page.waitForSelector('main[data-page="session"][data-page-ready="true"]', { timeout: 20000 });
                await page.waitForSelector('[data-component="dependency-dag"]', { timeout: 15000 });
                await caption(page, 'The draft is a DAG — levels, edges, and the dependency that lives outside it.');

                // The WHOLE chain on real data: manifest on disk → parseManifest →
                // deriveRoadmapDraft → the bridge route's JSON → the client parse →
                // the view model → the DOM. A unit test that builds its own row
                // cannot observe a field any one of those hops drops.
                const dag = await page.evaluate(() => {
                  const root = document.querySelector('[data-component="dependency-dag"]');
                  if (!root) return null;
                  return {
                    nodeCount: root.getAttribute('data-dag-node-count'),
                    levelCount: root.getAttribute('data-dag-level-count'),
                    edgeCount: root.getAttribute('data-dag-edge-count'),
                    cycle: root.getAttribute('data-dag-cycle'),
                    unresolvedCount: root.getAttribute('data-dag-unresolved-count'),
                    nodes: Array.from(root.querySelectorAll('[data-dag-node]')).map((el) => ({
                      id: el.getAttribute('data-dag-node'),
                      level: el.getAttribute('data-dag-node-level'),
                      status: el.getAttribute('data-dag-node-status'),
                      dependsOn: el.getAttribute('data-dag-depends-on'),
                      unresolved: el.getAttribute('data-dag-unresolved'),
                      text: (el.textContent || '').trim(),
                    })),
                    rows: Array.from(document.querySelectorAll('[data-roadmap-row]')).map((el) => ({
                      id: el.getAttribute('data-roadmap-row'),
                      dependsOn: el.getAttribute('data-roadmap-depends-on'),
                    })),
                  };
                });
                check(dag !== null, 'R4-15: the roadmap-draft artifact renders the shared dependency-dag component');
                check(dag.nodeCount === String(DAG_SESSION_INITIATIVES.length),
                  `R4-15: every drafted manifest is a DAG node (expected ${DAG_SESSION_INITIATIVES.length}, got ${dag.nodeCount})`);
                check(dag.levelCount === '3',
                  `R4-15: the root→mid→leaf chain lays out as 3 dependency levels (got ${dag.levelCount})`);
                for (const expected of DAG_SESSION_INITIATIVES) {
                  const node = dag.nodes.find((n) => n.id === expected.id);
                  check(node !== undefined, `R4-15: DAG node present for ${expected.id} (got ${JSON.stringify(dag.nodes.map((n) => n.id))})`);
                  if (node) {
                    check(node.dependsOn === expected.deps.join(','),
                      `R4-15: ${expected.id} carries its manifest's depends_on_initiatives to the DOM verbatim (expected "${expected.deps.join(',')}", got "${node.dependsOn}")`);
                  }
                }
                // The declared-data test: the edge onto an initiative outside the draft
                // set must be VISIBLE, not merely stamped on an attribute nobody renders.
                const leaf = dag.nodes.find((n) => n.id === DAG_SESSION_INITIATIVES[2].id);
                check(leaf !== undefined && leaf.unresolved === DAG_SESSION_UNRESOLVED_DEP,
                  `R4-15: the out-of-draft dependency is classified unresolved (expected "${DAG_SESSION_UNRESOLVED_DEP}", got "${leaf ? leaf.unresolved : 'no leaf node'}")`);
                check(leaf !== undefined && leaf.text.includes(DAG_SESSION_UNRESOLVED_DEP),
                  'R4-15: the unresolved dependency is rendered as readable text on the node, not only as a data-* attribute');
                check(dag.unresolvedCount === '1',
                  `R4-15: exactly one unresolved edge is reported (got ${dag.unresolvedCount})`);
                check(dag.cycle === 'false',
                  `R4-15: an acyclic draft reports data-dag-cycle="false" — the guard reports honestly in both directions (got ${dag.cycle})`);
                // Table and DAG read the same de-duplicated value, so they cannot drift.
                check(dag.rows.length === DAG_SESSION_INITIATIVES.length,
                  `R4-15: the initiative table beside the DAG lists every drafted initiative (got ${dag.rows.length})`);
                for (const expected of DAG_SESSION_INITIATIVES) {
                  const row = dag.rows.find((r) => r.id === expected.id);
                  check(row !== undefined && row.dependsOn === expected.deps.join(','),
                    `R4-15: table row ${expected.id} shows the SAME dependency list as its DAG node (expected "${expected.deps.join(',')}", got "${row ? row.dependsOn : 'no row'}")`);
                }
                await frame(page, 'r1-6-roadmap-dag', 'R1 — R4-15: the roadmap draft renders as a dependency DAG with its out-of-draft edge surfaced', { key: true });
              } finally {
                cleanRoadmapDagSession(dagSid);
              }

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
              await page.waitForSelector('[data-page="artifact"][data-page-ready="true"]', { timeout: 20000 }).catch(() => {});
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
                `/sessions/architect/${encodeURIComponent(sid)}`,
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
              // Model B: /flows/forge-develop renders ONLY the develop slice
              // (dev→demo→adversarial-review→review, the dev node fanning out into
              // per-WI hexes). It does NOT show architect/pm/reflect.
              await countAtLeast(page, '[data-mon-node][data-hex-kind="phase"]', 2, 'monitor: forge-develop slice shows its phase hexes (demo/adversarial-review/review)');
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
              await frame(page, 'r3-3b-devloop-green', 'R3 — dev-loop hex greens (both WIs done); the demo node runs next on its own hex');

        },
      },
      {
        id: 'flows-run-demo-review',
        title: 'Demo + adversarial review on their own hexes',
        narration: 'With both work items green, R4-10\'s two successor agents run on their own hexes: the demo node composes the initiative demo from the develop output and authors both demo.json and the PR body (the unifier\'s relocated job), then the adversarial-review node critiques the diff across four lenses into a findings artifact the operator weighs at the verdict — the seam between many parallel WIs and one reviewable, critiqued change, made visible.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ── R3.4: Demo node + adversarial-review node on their OWN hexes (R4-10-F1) ──
              console.log('\n[R3.4] Demo + adversarial review on their own hexes');
              await caption(page, 'Two successor agents (R4-10): the demo node authors demo.json + the PR body; the adversarial-review node critiques the diff — each on its own hex.');
              // The demo node (skills/demo-agent, ADR-039 `demo-band`) authors the demo
              // bundle + the relocated `.forge/pr-description.md`, then the pipeline
              // renders + orchestrated-captures. Events mirror runDemoAgentPipeline
              // (phase:'orchestrator', skill:'demo-agent', metadata.agent_slug) — the
              // frozen generic-agent contract eventToNodeId resolves to the `demo` node.
              await paced([
                () => demoAgentEvent('start', 'demo-node.start'),
                () => demoAgentEvent('log', 'demo.input.derived', { metadata: { diff_stat: '4 files changed, 213 insertions(+), 6 deletions(-)', acceptance_criteria: 2, work_items: 2 } }),
              ], WORK);
              await frame(page, 'r3-4-demo-midpulse', 'R3 (mid-pulse) — demo hex active, composing demo.json + the PR body from the develop output');
              demoAgentEvent('log', 'demo.capture', { metadata: { capture_ok: true, nonce_match: true, committed: true } });
              await pace('fastForward');
              writeDemoJson(1);
              writePrDescription(); // R4-10-F1: the demo node authors the relocated PR body
              demoAgentEvent('log', 'demo.complete', { metadata: { ac_evaluations: 2 } });
              await sleep(THINK);
              demoAgentEvent('end', 'demo.end', { cost_usd: 0.7284102, duration_ms: 214300, metadata: { demo_status: 'complete' } });
              await sleep(WORK);
              // The adversarial-review node (skills/adversarial-review, ADR-039
              // `review-band`) critiques the diff into `review-findings.json` — claims
              // the operator weighs at the verdict, never an auto-block (ADR-021).
              await paced([
                () => adversarialReviewEvent('start', 'review-node.start'),
                () => adversarialReviewEvent('log', 'review.input.assembled', { metadata: { changed_files: 4, base_ref: 'main' } }),
              ], WORK);
              writeReviewFindings(1); // the critique lands beside the demo evidence
              adversarialReviewEvent('log', 'review.findings.authored', { metadata: { total: 1, blocker: 0, major: 0, minor: 1, info: 0 } });
              await sleep(THINK);
              adversarialReviewEvent('end', 'review.end', { cost_usd: 0.4700000, duration_ms: 143551 });
              await openStudioMonitor(page, watch);
              for (const nodeId of ['demo', 'adversarial-review']) {
                try {
                  await page.waitForFunction(
                    (id) => document.querySelector(`[data-mon-node][data-node-id="${id}"]`)?.getAttribute('data-status') === 'complete',
                    nodeId, { timeout: 10000 },
                  );
                  check(true, `monitor: ${nodeId} node lit its own status complete (its own hex, not folded into dev-loop)`);
                } catch {
                  const got = await page.evaluate((id) =>
                    document.querySelector(`[data-mon-node][data-node-id="${id}"]`)?.getAttribute('data-status') ?? '(absent)', nodeId);
                  check(false, `monitor: ${nodeId} node should reach complete (got "${got}")`);
                }
              }
              await frame(page, 'r3-4b-demo-review-green', 'R3 — demo + adversarial-review nodes green on their own hexes (demo authored, diff critiqued)');

        },
      },
      {
        id: 'flows-run-cost-rollup',
        title: 'Cost rollup',
        narration: 'The cycle badge sums exactly what dev-loop, demo, and adversarial-review already accrued ($1.75 + $0.73 + $0.47) — the rollup is arithmetic on real per-phase numbers the operator watched tick up, not a separate estimate.',
        drive: async (ctx) => {
              const { page, watch, frame, check, expectPhaseCost, browser, recordClip } = ctx;
              // ── R3.5: Cost rollup across the spine ────────────────────────────────────
              console.log('\n[R3.5] Cost rollup');
              cycleEvent('review-loop', 'start', 'review-loop start');
              cycleEvent('review-loop', 'log', 'reviewer.pr-opened');
              moveManifest('in-flight', 'ready-for-review');
              // dev-loop $1.75 (0.6676 + 1.0856), demo $0.73, adversarial-review $0.47 —
              // paired with the seeded per-node costs in flows-run-dependency-gate +
              // flows-run-demo-review (R4-10-F1 successor topology).
              await caption(page, 'Forge Develop, costed per phase — dev-loop $1.75, demo $0.73, review $0.47 — under its ceiling. (The Architect flow bills separately.)');
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
              // compiles a fix work-item onto the initiative's own queue in place
              // (ADR-040), not a 409.
              REVIEW_WT = seedReviewWorktree();

              // CHAPTER CLIP 3 — run-build-monitor: starts at the library — the real Flows nav
              // entry a user clicks — then lands on the SAME CYCLE_ID's forge-develop
              // monitor: a pure GET re-read of the already gated run's event log, so nothing
              // about the canonical cycle is mutated. The hex click just opens/observes the
              // phase drawer (read-only), mirroring the established expectHexOpensDrawer
              // visual without asserting inside the clip.
              await recordClip(browser, watch, 'run-build-monitor', '/library', async (p) => {
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
                await caption(p, 'Watch it build — the WI hexes fan out, the demo node authors on its own hex, cost accrues live.');
                await sleep(WORK);
                await p.locator('[data-mon-node][data-hex-kind="wi"]').first().scrollIntoViewIfNeeded().catch(() => {});
                await sleep(READ);
                const demoHex = p.locator('[data-mon-node][data-node-id="demo"]').first();
                if (await demoHex.count() > 0) {
                  await demoHex.scrollIntoViewIfNeeded().catch(() => {});
                  await demoHex.click().catch(() => {});
                  await p.waitForFunction(
                    () => document.querySelector('#phase-drawer')?.getAttribute('data-drawer-open') === 'true',
                    null, { timeout: 8000 },
                  ).catch(() => {});
                }
                await sleep(WORK);
              }, { readySel: '[data-page="library"]', caption: 'From the library, into the flow monitor — WI fan-out, demo own-node, cost pills accruing' });

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
              // R4-08-F3: the adversarial-review findings render above the evidence —
              // agent claims the operator weighs, never a gate by themselves.
              await page.locator('[data-section="review-findings"]').scrollIntoViewIfNeeded().catch(() => {});
              check(await page.locator('[data-section="review-findings"]').count() > 0, 'adversarial-review findings panel renders on the verdict gate');
              check(
                await page.locator('[data-section="review-findings"] [data-finding-severity="major"]').count() > 0,
                'round-1 critique carries a major contract-fit finding (the same gap the send-back targets)',
              );
              await frame(page, 'r4-0c-findings', 'R4-08 — the adversarial critique beside the demo evidence: one major finding on the idempotency AC');

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
              // A 200 (the form reaches "submitted") means applyReviewVerdict compiled a
              // fix work-item onto the initiative's own queue — ADR-040, same cycle,
              // no requeue, develop agent is the fix executor.
              await page.waitForSelector('[data-component="verdict-form"][data-form-state="submitted"]', { timeout: 10000 }).catch(() => {});
              const sbState = await page.locator('[data-component="verdict-form"]').getAttribute('data-form-state');
              const sbErr = await page.locator('[data-component="verdict-form"]').getAttribute('data-submit-error');
              check(sbState === 'submitted', `send-back submitted (ADR-040 fix-WI compile) — state=${sbState}${sbErr ? ` err=${sbErr}` : ''}`);
              // Durable evidence, not just DOM (S3 lesson — assert the real output
              // paths): the fix WI landed on the SAME cycle's dev queue (append-only
              // after the seeded WI-1/WI-2), origin-marked…
              const fixWiPath = join(REVIEW_WT, '.forge', 'work-items', 'WI-3.md');
              check(
                existsSync(fixWiPath) && readFileSync(fixWiPath, 'utf8').includes('origin: review-fix'),
                'send-back compiled WI-3 (origin: review-fix) onto the SAME cycle worktree dev queue (ADR-040, no new cycle)',
              );
              // …the manifest carries the develop re-entry stamp + the round counter…
              const sbManifest = readFileSync(join(QDIR('ready-for-review'), `${INIT}.md`), 'utf8');
              check(/^resume_from: develop$/m.test(sbManifest), 'manifest stamped resume_from: develop (the fix-loop drain re-enters the dev node)');
              check(/^review_rounds: 1$/m.test(sbManifest), 'manifest review_rounds incremented to 1 (the config-capped round counter)');
              // …and the durable verdict artifact records the send-back + its round
              // in the SAME cycle's _logs dir (one cycle identity).
              const sbVerdict = JSON.parse(readFileSync(join(FORGE_ROOT, '_logs', CYCLE_ID, 'artifacts', 'verdict.json'), 'utf8'));
              check(sbVerdict.kind === 'send-back' && sbVerdict.round === 1, `verdict.json records kind=send-back round=1 (got ${sbVerdict.kind}/${sbVerdict.round})`);
              await sleep(ACT);

        },
      },
      {
        id: 'flows-run-sendback-cap',
        title: 'Cap exhaustion parks loudly (ADR-040)',
        narration: 'The send-back loop is bounded: with the round cap already spent, one more send-back is rejected 409 and the initiative parks needs-operator — a greppable worktree marker, not a silent drop or an infinite loop.',
        drive: async (ctx) => {
              const { check } = ctx;
              // ── R4.1b: cap exhaustion → reject-and-park (ADR-040 (b)) ─────────────────
              console.log('\n[R4.1b] Send-back cap exhaustion parks loudly');
              const manifestPath = join(QDIR('ready-for-review'), `${INIT}.md`);
              const before = readFileSync(manifestPath, 'utf8');
              // Spend the round cap (default review.maxSendBackRounds = 6): stamp the
              // counter at the ceiling, then attempt one more send-back via the same
              // bridge API the form submits to.
              writeFileSync(manifestPath, before.replace(/^review_rounds: 1$/m, 'review_rounds: 6'));
              try {
                const res = await fetch('http://127.0.0.1:4123/api/verdict', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
                  body: JSON.stringify({
                    initiativeId: INIT,
                    kind: 'send-back',
                    rationale: 'one concern past the cap',
                    acceptanceCriteria: [{ given: 'the cap is spent', when: 'another send-back arrives', then: 'it is rejected and the initiative parks' }],
                  }),
                });
                const body = await res.json().catch(() => ({}));
                check(res.status === 409, `cap-exhausted send-back is rejected 409 (got ${res.status})`);
                check(body.parked === 'needs-operator', `409 body says parked: needs-operator (got ${body.parked})`);
                const marker = join(REVIEW_WT, '.forge', 'REVIEW-CAP-EXHAUSTED.md');
                check(existsSync(marker), 'REVIEW-CAP-EXHAUSTED.md park marker written into the worktree (the loud, greppable surface)');
                check(
                  !existsSync(join(REVIEW_WT, '.forge', 'work-items', 'WI-4.md')),
                  'no fix WI was compiled past the cap (reject-then-park, never accept-then-drop)',
                );
                // Restore: round back to 1 + marker cleared so the demo continues the
                // normal loop (the marker would otherwise park the fix-loop drain).
                rmSync(marker, { force: true });
              } finally {
                writeFileSync(manifestPath, before);
              }
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
              // ADR-040: the fix-loop drain re-dispatches the DEVELOP agent; the
              // compiled WI-3 (origin: review-fix) is what builds this round — the
              // send-back beat's real bridge call already emitted its
              // pm.work-item-emitted, so the hex exists before these events animate it.
              cycleEvent('developer-loop', 'start', 'dev-loop rerun (resume_from: develop) — building the review fix WI');
              for (let i = 0; i < 6; i++) {
                cycleEvent('developer-loop', 'tool_use', 'tool.Edit', { metadata: { work_item_id: 'WI-3', tool: 'Edit' } });
                await pace('fastForward');
              }
              cycleEvent('developer-loop', 'log', 'gate.pass', { metadata: { work_item_id: 'WI-3' } });
              cycleEvent('developer-loop', 'end', 'WI-3 complete', { metadata: { work_item_id: 'WI-3' } });
              // R4-10-F1: the re-entry re-runs dev → demo → adversarial-review; the
              // demo node re-authors demo.json + the PR body (no unifier re-arm).
              demoAgentEvent('log', 'demo.complete — re-rendered demo.json (--write is byte-identical on every run)');
              await pace('fastForward');
              writeDemoJson(2);
              writeReviewFindings(2); // round 2: an explicit clean pass — findings: []
              demoAgentEvent('end', 'demo.end (round 2) — demo re-rendered', { cost_usd: 0.06, metadata: { demo_status: 'complete' } });
              adversarialReviewEvent('end', 'review.end (round 2) — clean re-critique', { cost_usd: 0.05 });
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
              // R4-08-F3: the round-2 critique is an explicit clean pass — the panel
              // still renders (findings: [] is a statement, not an absence).
              check(
                (await page.locator('[data-section="review-findings"][data-findings-count="0"]').count()) > 0,
                're-review: adversarial critique reads clean pass (data-findings-count="0")',
              );

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
              // slice shows the dev fan-out (≥2 WI hexes) + demo + adversarial-review + review.
              await countAtLeast(page, '[data-mon-node][data-hex-kind="phase"]', 2, 'completed develop slice shows its phase hexes (demo/adversarial-review/review)');
              await countAtLeast(page, '[data-mon-node][data-hex-kind="wi"]', 2, 'completed develop slice shows the dev fan-out (≥2 WI hexes)');
              await expectPhaseCost(page, 'completed develop slice shows accrued per-phase cost');
              // R4-08-F3: the view-mode verdict now renders the REAL decision (the
              // verdictRecordToDoc mapper — before it, every verdict stamped
              // "Approved" regardless of kind) plus the findings panel.
              await page.goto(`${watch.uiUrl}/artifact?run=${encodeURIComponent(CYCLE_ID)}&type=verdict&mode=view`, { waitUntil: 'domcontentloaded' });
              await page.waitForSelector('[data-page-ready="true"]', { timeout: 15000 }).catch(() => {});
              check(
                await page.locator('[data-verdict-decision="approve"]').count() > 0,
                'view-mode verdict stamps the REAL decision (data-verdict-decision="approve")',
              );
              check(
                await page.locator('[data-section="review-findings"]').count() > 0,
                'view-mode verdict keeps the adversarial findings visible beside the stamp',
              );
              await frame(page, 'r4-4d-verdict-view', 'R4-08 — the durable verdict record: real decision stamp + the critique that informed it');
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
              await frame(page, 'r4-4d-architect-flow', 'The Forge Architect flow on its own monitor — architect + PM hexes only, no dev/demo/review');
              await openStudioMonitor(page, watch); // back to the develop slice
              for (const nodeId of ['demo', 'adversarial-review']) {
                try {
                  await page.waitForFunction(
                    (id) => document.querySelector(`[data-mon-node][data-node-id="${id}"]`)?.getAttribute('data-status') === 'complete',
                    nodeId, { timeout: 8000 },
                  );
                  check(true, `${nodeId} node complete on its own monitor slot (not folded into dev-loop)`);
                } catch {
                  const got = await page.evaluate((id) =>
                    document.querySelector(`[data-mon-node][data-node-id="${id}"]`)?.getAttribute('data-status') ?? '(absent)', nodeId);
                  check(false, `${nodeId} node should reach complete (got "${got}")`);
                }
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

              // ── R6-05: flow monitor ledger — the JUST-ARCHIVED run's own row ──────────
              // The spec's own AC (docs/roadmaps/R6-operator-experience.md:383-384):
              // "journey beat asserts a row's narrative matches its run's event log."
              // CYCLE_ID is now genuinely archived (queue: done/, status: complete,
              // reflected) — exactly the shape the ledger renders. Every expectation
              // below is MEASURED, not invented: replaying this beat's own exact event
              // sequence through the REAL, unmodified orchestrator/run-model.ts
              // aggregateRun() (a throwaway fixture, cleaned up immediately after)
              // returned status:'complete', costUsd:3.98680145 (.toFixed(2)="3.99"),
              // workItems WI-1/WI-2/WI-3 all 'complete' (dev 3/3 — D10's work-items
              // segment), phaseMeta.dev.retries:0 (no gate.fail message anywhere in
              // this cycle's dev-loop stream — no gate-fails segment, D9), and exactly
              // one review.findings.authored event on the adversarial-review node
              // (metadata {total:1,blocker:0,major:0,minor:1,info:0} — non-zero, so
              // R6-05 Task 1's findings field, once populated, is non-empty and the
              // review-findings segment renders). No gateNote/failNote/reflectionLost
              // was ever produced for this run. So this row's narrative kinds are
              // exactly {work-items, review-findings, merged} — no gate-fails,
              // gate-waiting, failed, or reflection-lost. Asserted as a SET below (not
              // a fixed sequence): no existing unit test (history-ledger.test.ts /
              // flow-ledger.test.ts) pins an order between review-findings and
              // work-items/merged, so this beat measures membership, the one thing
              // actually pinned, rather than inventing an unverified order.
              await openStudioMonitor(page, watch); // back to /flows/forge-develop, CYCLE_ID's own flow
              await page.waitForFunction(
                () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              await page.waitForSelector('[data-section="history-ledger"]', { timeout: 15000 }).catch(() => {});
              check(
                await page.locator('[data-section="history-ledger"]').count() > 0,
                'R6-05: the flow monitor renders [data-section="history-ledger"]',
              );
              const ledgerRow = await page.evaluate((id) => {
                const el = document.querySelector(`[data-ledger-row="true"][data-run-id="${id}"]`);
                if (!el) return null;
                return {
                  href: el.getAttribute('href'),
                  status: el.getAttribute('data-run-status'),
                  costUsd: el.getAttribute('data-ledger-cost-usd'),
                  kinds: el.getAttribute('data-narrative-kinds'),
                };
              }, CYCLE_ID);
              check(ledgerRow !== null, `R6-05: the just-archived run (${CYCLE_ID}) has its own ledger row`);
              if (ledgerRow) {
                check(
                  ledgerRow.href === `/flows/forge-develop/run/${CYCLE_ID}`,
                  `R6-05: ledger row links to /flows/forge-develop/run/<id> (got "${ledgerRow.href}")`,
                );
                check(
                  ledgerRow.status === 'complete',
                  `R6-05: ledger row's data-run-status reads the run's own status (got "${ledgerRow.status}")`,
                );
                check(
                  ledgerRow.costUsd === '3.99',
                  `R6-05: ledger row's data-ledger-cost-usd matches the run's authoritative costUsd (measured 3.98680145 → "3.99", got "${ledgerRow.costUsd}")`,
                );
                const kinds = (ledgerRow.kinds ?? '').split(',').filter(Boolean);
                const expectedKinds = ['work-items', 'review-findings', 'merged'];
                const kindsMatch = kinds.length === expectedKinds.length && expectedKinds.every((k) => kinds.includes(k));
                check(
                  kindsMatch,
                  `R6-05: ledger row's data-narrative-kinds is exactly {work-items, review-findings, merged} — measured from this cycle's real events (got "${ledgerRow.kinds}")`,
                );
              }
              await caption(page, 'The history ledger — every archived run of this flow, its narrative machine-readable, not just a human string.');
              await frame(page, 'r6-05-history-ledger', 'R6-05 — the flow monitor\'s history ledger: the just-archived run\'s own row, its narrative kinds pinned as structured data', { key: true });

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
        id: 'flows-run-reflect-automated',
        title: 'Reflect (automated mode — R4-09-F3)',
        narration: 'With no operator in the loop, the reflector runs in automated mode: it infers each answer from the cycle logs, demo, and diff and marks it inferred. The reflection screen renders those answers read-only with provenance badges — the operator sees exactly what forge concluded on their behalf, and there is nothing to submit.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              console.log('\n[R5b] Reflect — automated mode');
              // Seed a distinct cycle's reflection where every question is
              // reflector-inferred (inferred:true) with a machine-authored
              // user-feedback.md — the automated-mode shape.
              writeAutomatedReflection();
              const url = `${watch.uiUrl}/artifact?run=${encodeURIComponent(AUTO_CYCLE_ID)}&type=reflection&mode=view`;
              await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
              await page.waitForSelector('[data-page-ready="true"]', { timeout: 20000 }).catch(() => {});
              await page.waitForSelector('[data-section="reflect-questions"][data-reflect-automated="true"]', { timeout: 15000 }).catch(() => {});
              await sleep(READ);
              check(
                await page.locator('[data-reflect-automated="true"]').count() > 0,
                'automated reflection renders the read-only inferred view (data-reflect-automated)',
              );
              const inferredCount = await page.locator('[data-question-inferred="true"]').count();
              check(inferredCount >= 3, `every question rendered inferred read-only (${inferredCount} data-question-inferred fieldsets)`);
              check(
                await page.locator('[data-question-answer]').count() >= 3,
                'the inferred answer is shown per question (data-question-answer)',
              );
              check(
                await page.locator('[data-question-inferred-badge]').count() >= 3,
                'an "inferred" provenance badge renders per question',
              );
              check(
                await page.locator('[data-action="submit-reflection"]').count() === 0,
                'no submit button — automated mode is read-only (nothing for the operator to answer)',
              );
              await frame(page, 'r5-2-automated-reflection', 'R5 — automated reflection: inferred answers rendered read-only with provenance badges', { key: true });
        },
      },
      {
        id: 'flows-run-monitor-deep-dive',
        title: 'Flow monitor deep-dive — /flows/forge-develop (Model B develop slice)',
        narration: 'On a freshly gated run, clicking the demo hex opens its own drawer of phase log — every phase and WI hex from a live cycle stays this inspectable, not just while it\'s running.',
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
                // span architect→pm→dev→demo→adversarial-review→review (gated — no reflect yet),
                // so its flowLineage is [forge-architect, forge-develop] and the S1 monitor
                // deep-dive renders the develop slice (WI fan-out + demo + adversarial-review +
                // review) under Model B.
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
              // R4-10-F1 successor nodes: the demo node authors the bundle + PR body,
              // then the adversarial-review node critiques. Both emit the frozen
              // generic-agent shape (phase:'orchestrator' + agent_slug) so eventToNodeId
              // resolves them to the demo / adversarial-review flow nodes.
              studioEvent('orchestrator', 'start', 'demo-node.start', { skill: 'demo-agent', metadata: { agent_slug: 'demo-agent' } });
              studioEvent('orchestrator', 'log', 'demo.complete', { skill: 'demo-agent', metadata: { agent_slug: 'demo-agent', ac_evaluations: 2 } });
              studioEvent('orchestrator', 'end', 'demo.end', { skill: 'demo-agent', metadata: { agent_slug: 'demo-agent', demo_status: 'complete' }, cost_usd: 0.11 });
              studioEvent('orchestrator', 'start', 'review-node.start', { skill: 'adversarial-review', metadata: { agent_slug: 'adversarial-review' } });
              studioEvent('orchestrator', 'log', 'review.findings.authored', { skill: 'adversarial-review', metadata: { agent_slug: 'adversarial-review', total: 1, minor: 1 } });
              studioEvent('orchestrator', 'end', 'review.end', { skill: 'adversarial-review', metadata: { agent_slug: 'adversarial-review' }, cost_usd: 0.06 });
              studioEvent('review-loop', 'start', 'review-loop start');
              studioEvent('review-loop', 'log', 'reviewer.pr-opened');
              const artifacts2 = join(CYCLE_LOG2, 'artifacts');
              mkdirSync(artifacts2, { recursive: true });
              writeFileSync(join(artifacts2, 'demo.json'), JSON.stringify({
                title: 'Studio demo — gated run', project: PROJECT, initiativeId: INIT2,
              }, null, 2));
              // F4: the single DEMO.md (DEMO.html is retired — the review page renders markdown).
              writeFileSync(join(artifacts2, 'DEMO.md'), '# Studio demo — gated run\n\n> A gated run for the flow-engine controls.\n');
              // R4-10-F1: the demo node authors the relocated PR body.
              writeFileSync(join(artifacts2, 'pr-description.md'), '## Why\n\nStale TOCs ship silently.\n\n## What\n\nA `--check` mode that exits non-zero on a stale embedded TOC.\n\n## How\n\nReuse the injector to compare, exit 1 on drift.\n');

              // ── S1.0: Flow monitor deep-dive (Model B develop slice + lineage) ────────
              // S9/DEC-3 + Model B: each flow's monitor shows ONLY its own hexes; the ONE
              // threaded run surfaces under all three spine flows via its flowLineage. Deep-dive
              // the develop slice (the dev node fans out into per-WI hexes → demo →
              // adversarial-review → review), then prove the SAME run also renders its architect
              // slice under forge-architect.
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
              await caption(page, 'The Forge Develop monitor — its own slice of the threaded run: the dev-loop fans out into per-WI hexes, then demo + adversarial-review + review. Pan + zoom the hex graph.');
              await sleep(ACT);
              await countAtLeast(page, '[data-run-id]', 1, 'monitor: run rail shows ≥1 [data-run-id]');
              await countAtLeast(page, '[data-mon-node]', 4, 'monitor: develop slice renders ≥4 [data-mon-node] hexes (WI fan-out + demo + adversarial-review + review)');
              await countAtLeast(page, '[data-mon-node][data-hex-kind="wi"]', 2, 'monitor: the dev node fans out into ≥2 per-WI hexes (run-driven)');
              await countAtLeast(page, '[data-mon-node][data-node-id="demo"]', 1, 'monitor: develop slice shows the demo phase hex');
              await sleep(READ);
              await frame(page, 's1-0-monitor', 'S1 — Forge Develop slice: WI fan-out + demo + adversarial-review + review');
              const demoHex = page.locator('[data-node-id="demo"]').first();
              let drawerOpened = false;
              if ((await demoHex.count()) > 0) {
                await demoHex.click();
                try {
                  await page.waitForFunction(
                    () => document.querySelector('#phase-drawer')?.getAttribute('data-drawer-open') === 'true',
                    null, { timeout: 8000 },
                  );
                  drawerOpened = true;
                  check(true, 'monitor: clicking demo hex opens drawer (data-drawer-open="true")');
                } catch {
                  const state = await page.evaluate(() =>
                    document.querySelector('#phase-drawer')?.getAttribute('data-drawer-open') ?? '(absent)');
                  check(false, `monitor: demo hex opens drawer (got data-drawer-open="${state}")`);
                }
              } else {
                check(false, 'monitor: [data-node-id="demo"] hex present to click');
              }
              if (drawerOpened) {
                await sleep(ACT);
                // The demo node emits a phase log (its own agent events); Gate
                // sub-checks are the merge-boundary gate's surface (R4-10-F2), not
                // the demo node's — so the drawer shows Phase log here, no gate checks.
                const hasPhaseLog = await page.evaluate(() =>
                  document.querySelector('#phase-drawer')?.textContent?.includes('Phase log') ?? false);
                check(hasPhaseLog, 'monitor: drawer shows Phase log section');
                await frame(page, 's1-0b-monitor-drawer', 'S1 — phase drawer open: the demo node\'s phase log visible');
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
        id: 'flows-run-detail-reachable',
        title: 'Flow run-detail — reachable from the monitor run rail (R6-01 WI-2 F4)',
        narration: 'The same gated run\'s own standalone detail page — every node on the flow with its own real cost and status, not just the ones a live monitor happens to be showing — reached from the SAME run-rail row every earlier beat in this run has already been clicking.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              // ── R6-01 WI-2 (F4): flow run-detail — reachable + the destination's own contract ──
              console.log('\n[R6-01 WI-2] Flow run-detail — reachable from the monitor run rail');
              // Re-use the SAME gated run (CYCLE_ID2) monitor-deep-dive seeded, BEFORE
              // drawer-live-tail's own SAME-render mutation flips the review node to
              // 'failed' — this beat runs between the two, so every fact asserted below
              // is against the fixture's UNMUTATED state.
              //
              // MEASURED, NOT INVENTED (task report): a real listRuns() pass driven
              // over a byte-for-byte copy of this exact studioEvent() sequence, against
              // the REAL studio/flows/forge-develop/flow.yaml on disk (not a synthetic
              // stand-in), reports:
              //   run.status="gated", run.gate="review"
              //   dev=complete/$0.48  demo=complete/$0.11
              //   adversarial-review=complete/$0.06  review=active/$0.00
              // (the run-level costUsd=1.02 is their sum + architect 0.22 + pm 0.15 —
              // never itself attributed to a node, the standing defect class flow-run-
              // timeline.test.ts pins at the derivation layer).
              await openStudioMonitor(page, watch, 'forge-develop', CYCLE_ID2);
              const runRow = page.locator(`[data-run-id="${CYCLE_ID2}"]`).first();
              check((await runRow.count()) > 0, `monitor: run rail row [data-run-id="${CYCLE_ID2}"] present (the reachability starting point)`);

              // GROUNDED PROBE, NOT AN INVENTED SELECTOR: `git grep` across
              // forge-ui/components + forge-ui/app for any href/onClick reaching a
              // standalone .../run/[runId] page finds NOTHING — not even for the
              // ALREADY-SHIPPED analogous surface, app/agents/[id]/run/[runId]/page.tsx
              // (R6-04): that page's own journey beat (agents.mjs) reaches it via
              // page.goto ONLY, never a click. So there is no precedent anywhere in this
              // codebase for "click a rail row, land on a standalone run page" to copy a
              // selector from. Rather than invent one, this PROBES for a link inside the
              // real row and reports the result honestly either way, then proves the
              // load-bearing half of F4 — the destination page's own contract — via
              // direct navigation, matching the codebase's own established pattern for
              // this exact class of page.
              const detailLink = runRow.locator(`a[href*="/run/${CYCLE_ID2}"]`).first();
              const hasDetailLink = (await detailLink.count()) > 0;
              check(
                hasDetailLink,
                `monitor: run row carries a click-through link to its own run-detail page (a[href*="/run/<id>"]) — if this reads false, the detail page is reachable ONLY by direct URL today, the same still-open gap already measured on the analogous /agents/[id]/run/[runId] surface (R6-04); this beat falls back to direct navigation either way so the destination contract below still gets proven`,
              );
              if (hasDetailLink) {
                await detailLink.click();
                try {
                  await page.waitForFunction(
                    (needle) => location.pathname.includes(needle),
                    `/flows/forge-develop/run/${CYCLE_ID2}`,
                    { timeout: 10000 },
                  );
                  check(true, 'monitor: clicking the run row\'s detail link navigates to /flows/forge-develop/run/<id>');
                } catch {
                  check(false, `monitor: clicking the run row's detail link navigates to /flows/forge-develop/run/<id> (got ${page.url()})`);
                }
              } else {
                await page.goto(watch.uiUrl + `/flows/forge-develop/run/${CYCLE_ID2}`, { waitUntil: 'domcontentloaded' });
              }

              // From here on, whichever way we arrived — the destination page's OWN
              // contract, pinned by forge-ui/lib/flow-run-detail-render.test.ts's
              // RESERVED data-* vocabulary (R6-01 WI-2 round 1): [data-page="flow-run"]
              // [data-run-id][data-run-found][data-run-status][data-flow-id] on <main>,
              // [data-section="run-timeline"] containing [data-timeline-row="true"]
              // [data-node-id][data-status][data-phase-cost-usd] rows.
              try {
                await page.waitForSelector('main[data-page="flow-run"][data-run-found="true"]', { timeout: 20000 });
                check(true, 'run-detail: [data-page="flow-run"][data-run-found="true"] renders for a real, gated run');
              } catch {
                check(false, 'run-detail: [data-page="flow-run"][data-run-found="true"] renders for a real, gated run — route/page not implemented yet');
                return; // nothing further is measurable without the page
              }
              await caption(page, 'Every node on the flow — not just the ones that happen to be running — with its own real cost and status.');
              await frame(page, 'r6-01wi2-run-detail', 'R6-01 WI-2 — the flow run-detail page: every node, its own real cost and status, reached from the monitor run rail', { key: true });

              const attrs = await page.evaluate(() => {
                const main = document.querySelector('main[data-page="flow-run"]');
                return main
                  ? {
                      runId: main.getAttribute('data-run-id'),
                      flowId: main.getAttribute('data-flow-id'),
                      runStatus: main.getAttribute('data-run-status'),
                    }
                  : null;
              });
              check(attrs !== null && attrs.runId === CYCLE_ID2, `run-detail: data-run-id matches the run navigated to (got ${JSON.stringify(attrs)})`);
              check(attrs !== null && attrs.flowId === 'forge-develop', `run-detail: data-flow-id="forge-develop" (got ${JSON.stringify(attrs)})`);
              // MEASURED (task report probe): the real derived run.status is "gated" —
              // matches flows-run-gate-control's own sibling assertion on the SAME
              // CYCLE_ID2 fixture, so the two beats cannot silently drift apart.
              check(attrs !== null && attrs.runStatus === 'gated', `run-detail: data-run-status="gated" — the real derived status, not a live-looking default (got ${JSON.stringify(attrs)})`);

              check(await page.locator('[data-section="run-timeline"]').count() > 0, 'run-detail: [data-section="run-timeline"] renders');
              const rows = await page.evaluate(() =>
                Array.from(document.querySelectorAll('[data-timeline-row="true"]')).map((el) => ({
                  nodeId: el.getAttribute('data-node-id'),
                  status: el.getAttribute('data-status'),
                  cost: el.getAttribute('data-phase-cost-usd'),
                })));
              check(
                rows.map((r) => r.nodeId).join(',') === 'dev,demo,adversarial-review,review',
                `run-detail: timeline rows follow the flow definition's own node order, dev→demo→adversarial-review→review (got "${rows.map((r) => r.nodeId).join(',')}")`,
              );
              // MEASURED per-node facts (same probe) — each node's OWN authoritative
              // cost, never the run's $1.02 total borrowed onto one row.
              const expectRow = (nodeId, status, cost) => {
                const row = rows.find((r) => r.nodeId === nodeId);
                check(
                  row !== undefined && row.status === status && row.cost === cost,
                  `run-detail: node "${nodeId}" reports status="${status}" cost="${cost}" (got ${JSON.stringify(row ?? null)})`,
                );
              };
              expectRow('dev', 'complete', '0.48');
              expectRow('demo', 'complete', '0.11');
              expectRow('adversarial-review', 'complete', '0.06');
              expectRow('review', 'active', '0.00');

              // ── R6-01 WI-3 (F5): node click-through — that node's OWN log lines,
              // through the SHARED RunLog renderer (deriveLogLine, think|tool|out) ──
              // MEASURED, NOT INVENTED: the 'dev' row's own 6 raw seeded events
              // (developer-loop start/log(gate.pass WI-1)/end(WI-1)/log(gate.pass
              // WI-2)/end(WI-2)/end(ralph.end $0.48)) all fall outside
              // deriveLogLine's TOOL_TYPES/THINK_TYPES sets, so every derived line
              // is kind="out" — this beat proves reachability + real content, not
              // the tool/think classification split (already exhaustively pinned
              // at the unit level, forge-ui/lib/flow-node-log.test.ts +
              // flow-run-node-log-render.test.ts). `end` ignores `message`
              // entirely (deriveLogLine's own textFor), so only the LAST end event
              // (cost-bearing) renders the "$0.4800" text — the two earlier
              // WI-scoped end events render as plain "end · developer-loop".
              const devRow = page.locator('[data-timeline-row="true"][data-node-id="dev"]').first();
              check((await devRow.count()) > 0, 'run-detail: [data-timeline-row="true"][data-node-id="dev"] present to click');
              if ((await devRow.count()) > 0) {
                await devRow.click();
                try {
                  await page.waitForSelector('[data-timeline-row="true"][data-node-id="dev"][data-node-expanded="true"]', { timeout: 10000 });
                  check(true, 'run-detail: clicking the dev row expands it (data-node-expanded="true")');
                } catch {
                  check(false, 'run-detail: clicking the dev row expands it (data-node-expanded="true") — click-through not implemented yet');
                }
                const expandedNow = (await page.locator('[data-timeline-row="true"][data-node-id="dev"][data-node-expanded="true"]').count()) > 0;
                if (expandedNow) {
                  await sleep(ACT);
                  await frame(page, 'r6-01wi3-node-log', 'R6-01 WI-3 — a run-detail node expanded: that node\'s own log lines, through the shared RunLog renderer', { key: true });

                  const detail = page.locator('[data-section="node-detail"][data-detail-for-node="dev"]').first();
                  check((await detail.count()) > 0, 'run-detail: [data-section="node-detail"][data-detail-for-node="dev"] renders once expanded');

                  // The SAME renderer R6-04's standalone run view already ships —
                  // reused, not forked (this initiative's own D2/substrate note).
                  const runLog = detail.locator('[data-component="run-log"]').first();
                  check((await runLog.count()) > 0, 'run-detail: the expanded node composes the SHARED RunLog ([data-component="run-log"])');
                  const logLineCount = await detail.locator('[data-log-line="true"]').count();
                  check(logLineCount >= 6, `run-detail: dev's own 6 seeded events all render as log lines (got ${logLineCount})`);
                  const outKindCount = await detail.locator('[data-log-line="true"][data-log-kind="out"]').count();
                  check(outKindCount === logLineCount, `run-detail: every dev log line classifies as kind="out" via the shared deriveLogLine (got ${outKindCount}/${logLineCount})`);
                  const detailText = await detail.evaluate((el) => el.textContent ?? '');
                  check(detailText.includes('gate.pass'), 'run-detail: dev\'s own real log content ("gate.pass") is visible, not a summary');
                  check(detailText.includes('$0.4800'), 'run-detail: the cost-bearing terminal event\'s real cost renders ("$0.4800")');

                  // Typed outputs (F5's other half): honestly empty — measured
                  // (D6⇒D7, this initiative's own ledger ruling): no per-node
                  // artifact data source exists (artifactsReady is run-level, keyed
                  // by artifact TYPE, never attributable to a node). A non-empty
                  // node-outputs section here would be exactly the
                  // never-populating-surface / declared-data-fails-open defect
                  // this campaign keeps finding and refusing.
                  const outputsSection = detail.locator('[data-section="node-outputs"]').first();
                  check((await outputsSection.count()) > 0, 'run-detail: [data-section="node-outputs"] renders on the expanded node');
                  if ((await outputsSection.count()) > 0) {
                    const outputsCount = await outputsSection.getAttribute('data-outputs-count');
                    check(outputsCount === '0', `run-detail: dev's typed-outputs count is honestly "0" — no per-node artifact source exists (got "${outputsCount}")`);
                    check((await detail.locator('[data-component="node-outputs-empty"]').count()) > 0, 'run-detail: the honest-empty outputs state renders ([data-component="node-outputs-empty"])');
                  }

                  // Collapse-on-reclick — an F5 AC implied by "click-through", not
                  // just "click-open": re-clicking the SAME row must not leave two
                  // node-detail panels stacked, nor strand the row permanently open.
                  await devRow.click();
                  try {
                    await page.waitForSelector('[data-timeline-row="true"][data-node-id="dev"][data-node-expanded="false"]', { timeout: 8000 });
                    check(true, 'run-detail: re-clicking the dev row collapses it back (data-node-expanded="false")');
                  } catch {
                    check(false, 'run-detail: re-clicking the dev row collapses it back (data-node-expanded="false")');
                  }
                }
              }

        },
      },
      {
        id: 'flows-run-drawer-live-tail',
        title: 'Flow monitor — the phase-log drawer stays live for non-progress events (R6-01 WI-1)',
        narration: 'A node whose events so far are only "start"/"log" lines — never a tool_use/file_change/test_run/iteration, the only four event types that move lastProgressAt (orchestrator/run-model-derive.ts PROGRESS_EVENT_TYPES) — still gets its open drawer refreshed the moment it emits a brand-new line, over the SAME WebSocket the page already holds. No new emission path: the line is appended to the running run\'s own events.jsonl, exactly as a real agent would, and the existing 200ms poll-tail + broadcast (cli/ui-bridge.ts) carries it to the page.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              console.log('\n[R6-01] Flow monitor — phase-log drawer live-refresh on a non-progress event');
              // Re-use the SAME gated run (CYCLE_ID2) the monitor-deep-dive beat seeded
              // above. review-loop (-> flow node "review", CANONICAL_PHASE_OVERRIDES,
              // orchestrator/run-model.ts:171) received only a 'start' event and a
              // 'log' event ('reviewer.pr-opened') — NEITHER is in PROGRESS_EVENT_TYPES —
              // so this node's lastProgressAt has never been set at all.
              await openStudioMonitor(page, watch, 'forge-develop', CYCLE_ID2);
              const reviewHex = page.locator('[data-node-id="review"]').first();
              let drawerOpened = false;
              if ((await reviewHex.count()) > 0) {
                await reviewHex.click();
                try {
                  await page.waitForFunction(
                    () => document.querySelector('#phase-drawer')?.getAttribute('data-drawer-open') === 'true',
                    null, { timeout: 8000 },
                  );
                  drawerOpened = true;
                  check(true, 'drawer-live: clicking the review hex opens the drawer (data-drawer-open="true")');
                } catch {
                  check(false, 'drawer-live: review hex opens drawer');
                }
              } else {
                check(false, 'drawer-live: [data-node-id="review"] hex present to click');
              }
              if (!drawerOpened) return;
              await sleep(ACT);
              // Baseline (unaffected by the WI-1 fix): the already-seeded
              // 'reviewer.pr-opened' line is visible on first open via the existing
              // identity-keyed fetch (DrawerBody Effect 1) — establishes the drawer
              // itself is wired to real data before testing the LIVE half below.
              const baselineText = await page.evaluate(() => document.querySelector('#phase-drawer')?.textContent ?? '');
              check(baselineText.includes('reviewer.pr-opened'),
                'drawer-live: initial open shows the already-seeded review-loop log line (baseline)');
              // The live gap this beat pins: append ONE MORE 'log' line to review-loop
              // while the drawer stays open, WITHOUT closing/reopening it or changing
              // any of Effect 1's dependencies (cycleId/nodeId/stderrOnly/wiId all
              // unchanged) and WITHOUT the event moving lastProgressAt (Effect 2's own
              // trigger). A drawer that is genuinely live must surface this new line
              // anyway, sourced from the page's existing WebSocket tail — no new
              // emission path, no manual refetch.
              const marker = `review.LIVE-TAIL-${Date.now()}`;
              studioEvent('review-loop', 'log', marker);
              try {
                await page.waitForFunction(
                  (needle) => (document.querySelector('#phase-drawer')?.textContent ?? '').includes(needle),
                  marker, { timeout: 6000 },
                );
                check(true, `drawer-live: a NEW review-loop log line posted while the drawer stayed open appears without closing/reopening it — the F1 AC (marker "${marker}")`);
              } catch {
                const stillThere = await page.evaluate(() => document.querySelector('#phase-drawer')?.textContent ?? '');
                check(stillThere.includes(marker),
                  `drawer-live: a NEW review-loop log line posted while the drawer stayed open must appear without closing/reopening it (marker "${marker}" not found — the drawer never re-fetched because this event type never moves lastProgressAt)`);
              }
              await frame(page, 'r6-01-drawer-live-tail', 'R6-01 — the phase-log drawer refreshes on a brand-new line even though it is a non-progress event type');

              // ── R6-01 WI-1 amendment: the SAME-RENDER race ─────────────────────────
              // `refreshActiveRun` (app/flows/[id]/page.tsx) refetches the WHOLE Run on
              // every WebSocket event for this cycle. A node's FINAL event can therefore
              // advance lastEventAt AND flip that node's own status to a terminal value
              // (complete/failed, deriveNodeStatuses) in the SAME React render. The
              // pre-amendment guard read `isTerminal` AFTER the transition had already
              // landed and skipped the fetch outright — so the drawer kept the
              // second-to-last snapshot, silently dropping the one line that says how
              // (or why) the node ended. For a failed node that dropped line is
              // precisely the reason it failed — the standing "operator iterates blind
              // because the output exists but is not surfaced" complaint this whole
              // feature answers. Drive that exact transition with the drawer still open:
              // one more review-loop event that is BOTH the node's terminal event AND
              // carries a distinguishable message.
              //
              // event_type:'end' + metadata.status:'failed' hits endMetaIndicatesFailure
              // (orchestrator/run-model-derive.ts) — this flips ONLY the review NODE's
              // own status (deriveNodeStatuses is per-node). run.status stays
              // queue-state-derived ('gated', from the manifest's ready-for-review
              // directory) — untouched, so the sibling flows-run-gate-control beat's
              // data-run-status="gated" check (same CYCLE_ID2 fixture) is unaffected;
              // likewise run.gate (findGateNodeId: "whichever node the LAST event
              // attributes to") stays "review" either way, since review-loop's events
              // are already the newest in this log.
              const beforeStatus = await page.evaluate(() =>
                document.querySelector('[data-node-id="review"]')?.getAttribute('data-status') ?? null);
              const finalMarker = `review.VERDICT-FAILED-${Date.now()}`;
              studioEvent('review-loop', 'end', finalMarker, { metadata: { status: 'failed' } });

              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-node-id="review"]')?.getAttribute('data-status') === 'failed',
                  null, { timeout: 8000 },
                );
                check(true, `drawer-live: the review hex's own data-status transitions to "failed" in this same step (was "${beforeStatus}") — confirms the SAME-render race is genuinely exercised, not merely asserted`);
              } catch {
                const got = await page.evaluate(() =>
                  document.querySelector('[data-node-id="review"]')?.getAttribute('data-status') ?? '(absent)');
                check(false, `drawer-live: the review hex must transition to data-status="failed" for this case to exercise the SAME-render race (was "${beforeStatus}", got "${got}")`);
              }

              try {
                await page.waitForFunction(
                  (needle) => (document.querySelector('#phase-drawer')?.textContent ?? '').includes(needle),
                  finalMarker, { timeout: 6000 },
                );
                check(true, `drawer-live: the node's OWN terminal (failed) line appears in the still-open drawer without closing/reopening it, even though that SAME event flipped the node to terminal status (marker "${finalMarker}")`);
              } catch {
                const stillThere = await page.evaluate(() => document.querySelector('#phase-drawer')?.textContent ?? '');
                check(stillThere.includes(finalMarker),
                  `drawer-live: the node's OWN terminal (failed) line must appear in the still-open drawer without closing/reopening it (marker "${finalMarker}" not found — the terminal-transition render skipped the fetch because isTerminal was already true by the time the effect body ran)`);
              }
              await frame(page, 'r6-01b-drawer-live-terminal', 'R6-01 — the drawer surfaces a node\'s own terminal (failed) line even though that SAME event flips the node to terminal status in the same render');
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
