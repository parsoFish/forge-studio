/**
 * e2e-journey — the Forge Studio user-story walkthrough + DOM-as-metrics regression harness.
 *
 *   node scripts/e2e-journey.mjs   (npm run ui:journey)
 *
 * WHAT THIS IS. Forge Studio is one product for one operator running a portfolio,
 * who never leaves the UI. This harness walks the canonical Studio USER STORIES —
 * the things that operator actually does — organised around the three platform
 * verbs: AUTHOR a flow, RUN it, SWAP its engine. It is BOTH the watchable demo
 * (records a video + frame gallery + index.html) AND the UI regression harness
 * (every beat asserts a real data-* invariant; a non-zero exit flags a regression
 * while the video always finishes). It is a sibling to two other harnesses:
 *   · scripts/e2e-deadpaths.mjs (`npm run ui:deadpaths`) — the read-only route/
 *     dead-path crawler (renders + no dead CTAs + nav resolves, twice).
 *   · scripts/verify-cycle.mjs (`npm run verify:cycle`) — the REAL-capability gate
 *     (a real cycle end-to-end; the honest proof, real-money, operator-gated).
 *
 * THE STORIES (route + differentiator each proves). The forge cycle is three
 * chained flows now — forge-architect → forge-develop → forge-reflect — flow
 * definitions interpreted by the node-executor registry (ADR-028); one threaded
 * run surfaces on all three flow monitors via its flowLineage (Model B).
 *
 *   ACT 1 — AUTHOR  (everything in Studio is data you can edit)
 *     A1  Triage the portfolio — the library (/): flows/agents/projects/KBs as
 *         cards + the operator pulse. The one surface (ADR-031).
 *     A2  Author a cycle flow from scratch AS DATA — author a flow in the builder
 *         (my-first-flow) AND prove forge-develop-scratch is structurally identical
 *         to the production seed (`forge studio lint` + parity). "Forge is just one
 *         flow" (ADR-028): the hardcoded cycle is subsumed by data.
 *     A3  Build an agent by composing skills — author plan/dev/review agents from
 *         the curated starter library (→ skills/<slug>/SKILL.md), then edit an
 *         existing agent's composition/runtime/budgets (/agents/project-manager).
 *     A4  Onboard / tune a project — onboard a new project in the UI (writes
 *         .forge/project.json) AND edit the mdtoc project's north star + demo
 *         timeline + contract readiness (/projects/<id>). (FORGE_E2E_PROJECT overrides.)
 *
 *   ACT 2 — RUN  (the cycle as the proof case, on a real mdtoc roadmap feature)
 *     R1  Idea → architect interview (/architect/new → /architect/<sid>/interview):
 *         live costed activity panel, clarifying questions, free-text answers, a
 *         stall cameo — the four architect observability surfaces (P1 stall / P2
 *         free-text / P3 activity / P4 cost).
 *     R2  Human gate #1 — approve the PLAN (/artifact …type=plan&mode=gate):
 *         send-back → revise → approve. No auto-approve path (ADR-020).
 *     R3  Watch the autonomous build (/flows/forge-develop): PM decomposes ACs →
 *         dev-loop TDD (red → grind → gate.pass, dependency-ordered) fans off the
 *         dev hex → the unifier on its OWN hex authors the demo (captured CLI
 *         read-back evidence).
 *     R4  Human gate #2 — review → send-back → re-review → approve+merge
 *         (/artifact …type=verdict): a per-AC evaluated demo (AC-2 PARTIAL) → the
 *         operator anchors a blocking comment → the dev-loop reruns in place
 *         (ADR-026) → PARTIAL→MET → approve IS the merge.
 *     R5  Human gate #3 — reflect + tune the brain (/artifact …type=reflection):
 *         the reflector folds the operator's feedback into the brain.
 *     (R6  Per-project roadmap + start-development trigger — the serpentine
 *         timeline and the initiative-select kickoff onto forge-develop.)
 *
 *   ACT 3 — SWAP  (the seams — the platform is modular, not hardcoded)
 *     S1  Flow-engine controls — start-run CTA, cost-ceiling meter, gate parking,
 *         the monitor deep-dive with the phase drawer (gate sub-checks + phase log).
 *     S2  Runtime-adapter seam (ADR-029) — the registry-driven SDK/model picker:
 *         claude live; gemini/aider/codex disabled until their adapter provisions;
 *         the range strategy routes to the cheapest-capable tier first.
 *     S3  KB-backend seam (ADR-027 §4) — the brain as a browsable force-graph over
 *         FilesystemKbBackend (the `backend:` descriptor is the swap point), plus
 *         pin-guidance that surfaces as a node until the next ingest pass.
 *     S4  Recover a stuck initiative (/recovery) — the CLI recovery verbs retired
 *         into the UI (DEC-6).
 *
 * NO LIVE LLM. The architect turns + the autonomous cycle are EMULATED by seeding
 * the same files/events the real phases write (FORGE_ARCHITECT_NO_SPAWN=1), grounded
 * on a real mdtoc roadmap feature (the `--write` in-place TOC injection mode) so the
 * artifacts read true. The gate surfaces, hexes, per-phase cost, WI materialisation
 * and every data-* invariant are REAL; the honest end-to-end proof is verify-cycle.
 *
 * REGRESSION GUARDS (soft-asserted; non-zero exit at end): ≥2 develop-slice phase
 * hexes, ≥2 WI hexes, phase + WI drawer opens, per-phase cost rollup, unifier
 * own-node complete, per-AC demo-evaluation, partial-count==0 on re-review,
 * reflection hex complete, the four architect surfaces (P1–P4), and the
 * author-from-scratch parity + `forge studio lint` proof.
 *
 * Output: demos/e2e/{video/journey.webm, frames/*.png, index.html}. Cleans up all
 * seeded state (architect session, cycle logs, queue manifests, the authored
 * scratch flow, any _guidance/*.md) in the finally block.
 *
 * JOURNEYS-AS-DATA. The beats below are grouped into 10 journeys via
 * `defineJourney()` (scripts/lib/journey-runtime.mjs) and driven through a flat
 * `RUN_ORDER` that still preserves today's exact global sequence (journeys
 * interleave in file order; a later pass will make each journey's beats
 * contiguous once its seed/cleanup steps are formalised). `node
 * scripts/e2e-journey.mjs --list` prints the journey/beat shape and exits
 * without booting Studio.
 */
import { spawn, execSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, readdirSync, renameSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { chromium } from 'playwright-core';
import { createAssertions, sleep } from './lib/journey-assertions.mjs';
import { assertNoLiveDaemon } from './lib/journey-daemon-guard.mjs';
import { defineJourney, createBeatTracker, renderGallery, writeResultsFile, writeGalleryFile } from './lib/journey-runtime.mjs';
import {
  FORGE_ROOT, PROJECT, projectRoot, cleanProjectDir, cleanSeededSession,
  OUT, FRAMES, VIDEO, CLIPS,
  IDEA, DATE, INIT, STAMP, CYCLE_ID, CYCLE_LOG,
  SCRATCH_FLOW, SCRATCH_FLOW_DIR, SEED_FLOW_PATH, writeScratchFlow, cleanScratchFlow,
  STARTER_AGENT_SLUGS, cleanStarterAgents,
  waitForFile,
  J3_FLOW, J3_FLOW_DIR, cleanFirstFlow,
  J4_PROJECT, cleanFirstProject,
  J5_INIT, J5_CYCLE_ID, cleanFirstFlowRun, j5Event,
  readSavedFlow, readSavedFlowNodes, waitForFlowVersion, parseFlowStructure,
  READ, WORK, ACT, THINK, pace, QDIR,
  caption, runningTimer,
  archDir, writeStatus, archEvent, archReasoning, burst, paced, writeQuestions,
  EMULATED_ARCHITECT_COST_USD, EMULATED_ARCHITECT_DURATION_MS, writePlan,
  cycleEvent, unifierEvent, moveManifest, seedReviewWorktree, writeDemoJson, writeReflectionQuestions,
  writeInstrStatus, instrEvent, instrBurst, writeInstrQuestions, writeInstrDraft, cleanInstructionsSession,
  writePbStatus, seedStagedBrain, cleanSeededBrain,
  OOTB_SKILL_IDS, SK_EDIT_SLUG, SK_NEW_NAME, SK_NEW_SLUG, cleanSkillArtifacts, seedOotbSkill,
  ONB_EXISTING_SLUG, cleanOnboardedProject,
  openStudioMonitor,
} from './lib/journey-fixtures.mjs';

// ── BOOT + FRAMES ─────────────────────────────────────────────────────────────

async function startWatch() {
  // M7-7: spawn the canonical `forge studio` launcher and detect readiness via
  // its deterministic 'forge-studio-ready {json}' stdout line (no log scraping).
  // F1: `--force-takeover` so the harness always binds its OWN fresh bridge — a
  // leftover bridge from a crashed prior run must be replaced, not attached to
  // (the attach path is read-only and never emits the ready signal).
  return new Promise((res, rej) => {
    const proc = spawn(process.execPath,
      ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', '--no-open', '--force-takeover'],
      { cwd: FORGE_ROOT, env: { ...process.env, FORGE_ARCHITECT_NO_SPAWN: '1' },
        stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let buf = '';
    let settled = false;
    const onData = (chunk) => {
      if (settled) return;
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const m = line.match(/^forge-studio-ready (.+)$/);
        if (!m) continue;
        try {
          const { bridgeUrl, uiUrl } = JSON.parse(m[1]);
          if (bridgeUrl && uiUrl) { settled = true; res({ proc, uiUrl, bridgeUrl }); return; }
        } catch { /* not the signal line */ }
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', rej);
    setTimeout(() => { if (!settled) rej(new Error('forge studio not ready in 90s')); }, 90000);
  });
}

const captions = [];
// clipMeta parallels captions[] — the short looping .webm "GIF" clips of the
// building/generating interactions, embedded autoplay-loop in the gallery.
const clipMeta = [];
let seq = 0;
async function frame(page, name, altCaption) {
  seq += 1;
  const file = `${String(seq).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(FRAMES, file), fullPage: true });
  captions.push({ file, caption: altCaption });
  tracker.recordCapture({ kind: 'frame', file, caption: altCaption });
  console.log(`  [${String(seq).padStart(2, '0')}] ${altCaption}`);
}

/**
 * Record ONE short looping clip around a single interaction, in its own ephemeral
 * recording context (recordVideo is per-context; a fresh context's .webm ≈ that one
 * interaction). A fresh context has NO nav/DOM state, so it re-navigates to `route`
 * and re-waits for readiness — which composes with the seed model (seed the files
 * first, then the clip re-reads the same server state). Non-fatal: any error is
 * swallowed so the journey (and its main video) always finishes.
 */
async function recordClip(browser, watch, name, route, interact, opts = {}) {
  const { size = { width: 1000, height: 620 }, readySel = '[data-page-ready="true"]', caption: cap = name } = opts;
  const tmp = join(CLIPS, '_tmp', name);
  let clipCtx = null;
  let clipPage = null;
  try {
    mkdirSync(tmp, { recursive: true });
    clipCtx = await browser.newContext({ viewport: size, recordVideo: { dir: tmp, size } });
    clipPage = await clipCtx.newPage();
    await clipPage.goto(watch.uiUrl + route, { waitUntil: 'domcontentloaded' });
    await clipPage.waitForSelector(readySel, { timeout: 15000 }).catch(() => {});
    await interact(clipPage);
  } catch (e) {
    console.error(`  [clip ${name}] skipped: ${(e?.message ?? e)}`.slice(0, 200));
  } finally {
    try { if (clipCtx) await clipCtx.close(); } catch { /* */ } // finalises the .webm
  }
  try {
    const src = clipPage ? await clipPage.video()?.path() : null;
    if (src && existsSync(src)) {
      const dest = join(CLIPS, `${name}.webm`);
      renameSync(src, dest);
      clipMeta.push({ file: `clips/${name}.webm`, caption: cap });
      tracker.recordCapture({ kind: 'clip', file: `clips/${name}.webm`, caption: cap, sizeBytes: statSync(dest).size });
      console.log(`  [clip] ${name} — ${cap}`);
    }
  } catch (e) {
    console.error(`  [clip ${name}] collect failed: ${(e?.message ?? e)}`.slice(0, 160));
  }
}

// ── ASSERTIONS (shared regression layer) ──────────────────────────────────────
const tracker = createBeatTracker();
const { failures, check, countAtLeast, expectPhaseCost, expectHexOpensDrawer } =
  createAssertions({ frame, dwellMs: READ, actMs: ACT, onCheck: tracker.onCheck });

// ── THE JOURNEY ────────────────────────────────────────────────────────────────

async function main() {
  // journeys-as-data: beats are declared (as drive() closures) below, BEFORE the
  // daemon guard runs, so `--list` can print the journey/beat shape without
  // booting anything. Every local a later beat's drive() needs is declared here
  // (still `undefined`) so the closures can safely close over it; each is still
  // ASSIGNED at its original call site inside the beat that first produces it —
  // hoisting only moved the declaration, never the side-effecting assignment.
  let watch, browser, page;
  let createdSid = null;
  let instrSid = null;   // instructions-creator session (Part 1)
  let pbSid = null;      // project-brain-builder session (Part 1)
  let sid;                                    // architect session id (flows-run-idea → flows-run-approve)
  let REVIEW_URL, REFLECT_URL, REVIEW_WT;     // flows-run-cost-rollup → flows-run-reflect
  let ROADMAP_SEEDED_WI, roadmapSeeded;       // roadmap-tab → roadmap-start-development
  let INIT_DEV, DEV_CYCLE_ID;                 // roadmap-tab → roadmap-start-development
  let INIT2, STAMP2, CYCLE_ID2, CYCLE_LOG2, studioSeqBase, studioEvent; // flows-run-monitor-deep-dive → flows-run-gate-control
  let GUIDANCE_TEXT, kbPageReady;             // knowledge-graph → knowledge-pin-guidance

  // Reserved for future cross-beat data flow; drive() bodies don't need it yet.
  const journeyCtx = {};

  // NOTE: journeys are grouped by user story, but the RUN_ORDER below still
  // interleaves them in TODAY's exact execution order (seed/cleanup ordering
  // isn't yet journey-scoped) — a later task will make each journey's beats run
  // contiguous once seeding + cleanup are formalised per-journey.
  const journeys = {
  standUpCreate: defineJourney({
    id: 'stand-up-create',
    title: 'Stand up a project (create new)',
    story: 'Create a new project from Studio\'s library: title card and library orientation, AI-assisted AGENTS.md + project-brain generation, and the project builder.',
    beats: [
      {
        id: 'su-create-title',
        title: 'Title card — Studio library',
        narration: 'Title card — Studio library',
        drive: async (ctx) => {
              // ════════════════════════════════════════════════════════════════════════
              // ACT 1 — AUTHOR. Everything in Studio is data you can edit.
              // ════════════════════════════════════════════════════════════════════════

              // ── A1.0: Title card on the library ───────────────────────────────────────
              console.log('\n[A1.0] Title card — Studio library');
              await page.goto(watch.uiUrl + '/', { waitUntil: 'domcontentloaded' });
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 30000 },
                );
                check(true, 'library: [data-page="library"][data-page-ready="true"]');
              } catch {
                const pr = await page.evaluate(() =>
                  document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') ?? '(no data-page=library)');
                check(false, `library: data-page-ready (got "${pr}")`);
              }
              await caption(page, 'Forge Studio — author a flow, run it, swap its engine.');
              await page.evaluate(() => {
                let card = document.getElementById('demo-title-card');
                if (!card) {
                  card = document.createElement('div');
                  card.id = 'demo-title-card';
                  Object.assign(card.style, {
                    position: 'fixed', inset: '0', background: '#0d1117',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    zIndex: '99997', pointerEvents: 'none',
                  });
                  card.innerHTML = `
                    <div style="font:700 32px ui-sans-serif,system-ui;color:#e6edf3;letter-spacing:-.5px;margin-bottom:16px">
                      Forge Studio
                    </div>
                    <div style="font:500 20px ui-sans-serif,system-ui;color:#58a6ff">
                      — author a flow · run it · swap its engine —
                    </div>
                    <div style="margin-top:40px;font:13px ui-monospace,monospace;color:#6e7681">
                      the forge cycle is just one flow definition
                    </div>`;
                  document.body.appendChild(card);
                }
              });
              await frame(page, 'a1-0-title', 'Title — "Forge Studio: author a flow, run it, swap its engine"');
              await pace('dwell');
              await page.evaluate(() => { const el = document.getElementById('demo-title-card'); if (el) el.style.display = 'none'; });

        },
      },
      {
        id: 'su-create-library',
        title: 'Library — everything is data',
        narration: 'Library — everything is data',
        drive: async (ctx) => {
              // ── A1.1: Library — flows / agents / projects / KBs as data ───────────────
              console.log('\n[A1.1] Library — everything is data');
              await caption(page, 'Flows, agents, projects, and knowledge — one screen, all editable definitions.');
              await sleep(ACT);
              await countAtLeast(page, '[data-section="flows"]', 1, 'library: [data-section="flows"] present');
              await countAtLeast(page, '[data-section="agents"]', 1, 'library: [data-section="agents"] present');
              await countAtLeast(page, '[data-section="projects"]', 1, 'library: [data-section="projects"] present');
              await countAtLeast(page, '[data-section="kbs"]', 1, 'library: [data-section="kbs"] present');
              const pulsePresent = await page.evaluate(() => document.querySelector('[data-pulse-flows]') !== null);
              check(pulsePresent, 'library: operator pulse panel ([data-pulse-flows]) present');
              await countAtLeast(page, '[data-section="flows"] [data-card-type="flow"]', 1, 'library: ≥1 flow card in flows section');
              await countAtLeast(page, '[data-section="agents"] [data-card-type="agent"]', 1, 'library: ≥1 agent card in agents section');
              await countAtLeast(page, '[data-section="projects"] [data-card-type="project"]', 1, 'library: ≥1 project card in projects section');
              await countAtLeast(page, '[data-section="kbs"] [data-card-type="kb"]', 1, 'library: ≥1 kb card in kbs section');
              const sectionCounts = await page.evaluate(() => {
                const sections = ['flows', 'agents', 'projects', 'kbs'];
                return Object.fromEntries(sections.map((s) => [
                  s, parseInt(document.querySelector(`[data-section="${s}"]`)?.getAttribute('data-count') ?? '0', 10),
                ]));
              });
              check(sectionCounts.flows >= 1, `library: flows section data-count ≥1 (got ${sectionCounts.flows})`);
              check(sectionCounts.agents >= 1, `library: agents section data-count ≥1 (got ${sectionCounts.agents})`);
              check(sectionCounts.projects >= 1, `library: projects section data-count ≥1 (got ${sectionCounts.projects})`);
              check(sectionCounts.kbs >= 1, `library: kbs section data-count ≥1 (got ${sectionCounts.kbs})`);
              // The from-scratch flow we authored before boot should appear as a flow card.
              const scratchCardPresent = await page.evaluate((id) =>
                document.querySelector(`[data-card-type="flow"][data-card-id="${id}"]`) !== null ||
                [...document.querySelectorAll('[data-card-type="flow"]')].some((el) => (el.getAttribute('href') ?? '').includes(id)) ||
                (document.querySelector('[data-section="flows"]')?.textContent ?? '').includes(id),
                SCRATCH_FLOW);
              check(scratchCardPresent, `library: the authored "${SCRATCH_FLOW}" flow appears as a card (registered as data)`);

        },
      },
      {
        id: 'su-create-orientation',
        title: 'First-run orientation + discoverable creation',
        narration: 'First-run orientation + discoverable creation',
        drive: async (ctx) => {
              // ── J1: first-run orientation + discoverable creation ─────────────────────
              // Creation must be discoverable from the library (not URL-only): the
              // "+ New Agent" CTA is a real, enabled link to the builder.
              const newAgentCta = await page.evaluate(() => {
                const el = document.querySelector('[data-action="new-agent"]');
                if (!el) return { present: false };
                return {
                  present: true,
                  disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
                  href: el.getAttribute('href') ?? '',
                  tag: el.tagName.toLowerCase(),
                };
              });
              check(newAgentCta.present, 'J1: library "+ New Agent" creation CTA ([data-action="new-agent"]) is present');
              check(newAgentCta.present && !newAgentCta.disabled, 'J1: "+ New Agent" CTA is enabled (creation is discoverable, not a dead greyed button)');
              check(newAgentCta.href?.includes('/agents/new'), `J1: "+ New Agent" routes to the agent builder (got "${newAgentCta.href}")`);
              // No false welcome: with a populated library the orientation panel is absent
              // and data-first-run reflects it.
              const firstRunAttr = await page.evaluate(() =>
                document.querySelector('[data-page="library"]')?.getAttribute('data-first-run'));
              check(firstRunAttr === 'false', `J1: populated library reports data-first-run="false" (got "${firstRunAttr}")`);
              const orientationAbsent = await page.evaluate(() => document.querySelector('[data-section="orientation"]') === null);
              check(orientationAbsent, 'J1: orientation panel correctly hidden when the library is populated (shown only on a fresh install)');

              await sleep(READ);
              await frame(page, 'a1-1-library', 'A1 — Studio library: flows/agents/projects/KBs as data + operator pulse');

        },
      },
      {
        id: 'su-create-instructions',
        title: 'instructions-creator — generate AGENTS.md (AI-assisted)',
        narration: 'instructions-creator — generate AGENTS.md (AI-assisted)',
        drive: async (ctx) => {
              // ════════════════════════════════════════════════════════════════════════
              // PART 1 — STAND UP (AI-assisted generation). The project's AGENTS.md and its
              // seed brain, generated WITH AI ASSISTANCE, plus aligning an existing repo to
              // the contract. No live LLM: seed the session files the runner would write
              // (same FORGE_ARCHITECT_NO_SPAWN seam as the architect) + drive the real UI.
              // ════════════════════════════════════════════════════════════════════════

              // ── AI-1: instructions-creator generates AGENTS.md ────────────────────────
              console.log('\n[AI-1] instructions-creator — generate AGENTS.md (AI-assisted)');
              await page.goto(watch.uiUrl + `/projects/${PROJECT}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 }).catch(() => {});
              console.log(`  [AI-1] launcher present: ${await page.locator('[data-action="launch-instructions"]').count() > 0}`);
              // Seed a briefing session on disk + drive the dedicated screen (architect pattern).
              instrSid = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-instr';
              writeInstrStatus(instrSid, { phase: 'briefing', round: 1 });
              await page.goto(watch.uiUrl + `/instructions/${encodeURIComponent(instrSid)}`, { waitUntil: 'domcontentloaded' });
              const instrReady = await page.waitForSelector('main[data-page="instructions-interview"]', { timeout: 20000 }).then(() => true).catch(() => false);
              check(instrReady, 'AI-1: instructions screen renders ([data-page="instructions-interview"])');
              await caption(page, 'Forge generates AGENTS.md with you — interview → draft → approve. AI-assisted, and gated.');
              // interviewing — activity bursts + clarifying questions
              writeInstrStatus(instrSid, { phase: 'interviewing', round: 1 });
              instrEvent(instrSid, 'start', 'instructions turn (phase=interviewing, round=1)');
              await instrBurst(instrSid, ['Glob', 'Read', 'Grep', 'Bash']);
              writeInstrQuestions(instrSid);
              writeInstrStatus(instrSid, { phase: 'awaiting-answers', round: 1 });
              await page.waitForSelector('[data-section="instructions-interview"]', { timeout: 15000 }).catch(() => {});
              check(await page.locator('[data-section="instructions-interview"]').count() > 0, 'AI-1: interview returns clarifying questions');
              await countAtLeast(page, '[data-question-index]', 2, 'AI-1: ≥2 instructions questions');
              await frame(page, 'instr-0-interview', 'Part 1 — instructions-creator interviews before writing AGENTS.md (AI-assisted)');
              // answer → draft → verdict
              await page.locator('[data-question-index="0"] input[type="radio"]').first().check().catch(() => {});
              await page.locator('[data-question-index="1"] input[type="radio"]').first().check().catch(() => {});
              await page.locator('[data-action="submit-answers"]').click().catch(() => {});
              await sleep(ACT);
              writeInstrStatus(instrSid, { phase: 'drafting', round: 2 });
              instrEvent(instrSid, 'start', 'instructions turn (phase=drafting) — rolling in answers');
              await instrBurst(instrSid, ['Read', 'Write']);
              writeInstrDraft(instrSid);
              writeInstrStatus(instrSid, { phase: 'awaiting-verdict', round: 2 });
              await page.waitForSelector('[data-component="instructions-verdict"]', { timeout: 15000 }).catch(() => {});
              check(await page.locator('[data-component="instructions-verdict"]').count() > 0, 'AI-1: drafted AGENTS.md awaits the operator verdict');
              await frame(page, 'instr-1-draft', 'Part 1 — the generated AGENTS.md draft, awaiting approval');
              // Clip: the generated draft awaiting verdict (the AI-assisted output).
              await recordClip(browser, watch, 'instr-generate', `/instructions/${encodeURIComponent(instrSid)}`, async (p) => {
                await p.waitForSelector('main[data-page="instructions-interview"]', { timeout: 12000 });
                await sleep(2800);
              }, { readySel: 'main[data-page="instructions-interview"]', caption: 'instructions-creator: AGENTS.md generated with AI assistance' });
              // approve → committed
              await page.locator('[data-component="instructions-verdict"] [data-action="approve-instructions"]').click().catch(() => {});
              await page.waitForSelector('[data-component="instructions-verdict"][data-form-state="submitted"]', { timeout: 10000 }).catch(() => {});
              writeInstrStatus(instrSid, { phase: 'committed', round: 2 });
              instrEvent(instrSid, 'log', 'instructions-committed (AGENTS.md written)');
              await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
              await page.waitForSelector('main[data-page="instructions-interview"]', { timeout: 10000 }).catch(() => {});
              await page.waitForSelector('[data-action="back-to-project"]', { timeout: 8000 }).catch(() => {});
              check(await page.locator('[data-action="back-to-project"]').count() > 0, 'AI-1: AGENTS.md committed — back-to-project offered');
              await frame(page, 'instr-2-committed', 'Part 1 — AGENTS.md generated + approved (AI-assisted)');

        },
      },
      {
        id: 'su-create-project-brain',
        title: 'project-brain-builder — seed the project brain (AI-assisted)',
        narration: 'project-brain-builder — seed the project brain (AI-assisted)',
        drive: async (ctx) => {
              // ── AI-2: project-brain-builder seeds the project brain ───────────────────
              console.log('\n[AI-2] project-brain-builder — seed the project brain (AI-assisted)');
              pbSid = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-pbrain';
              writePbStatus(pbSid, 'briefing', '');
              await page.goto(watch.uiUrl + `/project-brain/${encodeURIComponent(pbSid)}?project=${encodeURIComponent(PROJECT)}`, { waitUntil: 'domcontentloaded' });
              const pbReady = await page.waitForSelector('main[data-page="project-brain"]', { timeout: 20000 }).then(() => true).catch(() => false);
              check(pbReady, 'AI-2: project-brain screen renders ([data-page="project-brain"])');
              await caption(page, 'Forge reads the project and drafts its seed brain — the themes a planner reads before designing.');
              // briefing → analyzing → (seed themes) → awaiting-review
              writePbStatus(pbSid, 'analyzing', 'emphasise conventions + module layout');
              await frame(page, 'pbrain-0-analyzing', 'Part 1 — project-brain-builder analyses the project (AI-assisted)');
              seedStagedBrain(pbSid);
              await page.waitForSelector('main[data-project-brain-phase="awaiting-review"]', { timeout: 10000 }).catch(() => {});
              check(await page.locator('[data-section="brain-review"]').count() > 0, 'AI-2: staged themes presented for review');
              await countAtLeast(page, '[data-theme-name]', 3, 'AI-2: ≥3 seed themes drafted');
              await frame(page, 'pbrain-1-review', 'Part 1 — the generated seed brain: themes to review + approve');
              // Clip: the generated seed-brain themes under review.
              await recordClip(browser, watch, 'pbrain-generate', `/project-brain/${encodeURIComponent(pbSid)}?project=${encodeURIComponent(PROJECT)}`, async (p) => {
                await p.waitForSelector('main[data-page="project-brain"]', { timeout: 12000 });
                await sleep(2800);
              }, { readySel: 'main[data-page="project-brain"]', caption: 'project-brain-builder: the seed brain generated with AI assistance' });
              // approve → committing → committed (flip-only; nothing written under brain/)
              await page.locator('[data-action="approve-brain"]').click().catch(() => {});
              await page.waitForSelector('main[data-project-brain-phase="committing"]', { timeout: 8000 }).catch(() => {});
              writePbStatus(pbSid, 'committed', '');
              await page.waitForSelector('[data-section="brain-committed"]', { timeout: 8000 }).catch(() => {});
              check(await page.locator('[data-action="bind-and-return"]').count() > 0, 'AI-2: seed brain committed — bind-and-return offered');
              await frame(page, 'pbrain-2-committed', 'Part 1 — project brain seeded (grows with the project)');

        },
      },
      {
        id: 'su-create-project-builder',
        title: `Project builder — /projects/${PROJECT}`,
        narration: `Project builder — /projects/${PROJECT}`,
        drive: async (ctx) => {
              // ── A4: Project builder — the managed project as data ─────────────────────
              console.log(`\n[A4] Project builder — /projects/${PROJECT}`);
              await page.goto(watch.uiUrl + `/projects/${PROJECT}`, { waitUntil: 'domcontentloaded' });
              let projectPageReady = false;
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 25000 },
                );
                projectPageReady = true;
                check(true, 'project-builder: [data-page="projects"][data-page-ready="true"]');
              } catch {
                const pr = await page.evaluate(() =>
                  document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') ?? '(no data-page=projects)');
                check(false, `project-builder: data-page-ready (got "${pr}")`);
              }
              await caption(page, 'The mdtoc project — north star, the creds-free demo timeline (capture → verify → present), skills, KB, contract readiness.');
              await sleep(ACT);
              if (projectPageReady) {
                const projectId = await page.evaluate(() =>
                  document.querySelector('[data-project-id]')?.getAttribute('data-project-id') ?? '');
                check(projectId === PROJECT, `project-builder: data-project-id="${PROJECT}" (got "${projectId}")`);
                check(
                  await page.evaluate(() => document.querySelector('[data-component="north-star"]') !== null ||
                    document.querySelectorAll('textarea').length > 0 ||
                    document.querySelector('[placeholder*="north star" i]') !== null ||
                    document.querySelector('[placeholder*="goal" i]') !== null ||
                    document.querySelector('[placeholder*="outcome" i]') !== null),
                  'project-builder: north star field present',
                );
                const stepCount = await page.evaluate(() => {
                  const el = document.querySelector('[data-step-count]');
                  return el ? el.getAttribute('data-step-count') : null;
                });
                check(stepCount !== null, `project-builder: [data-step-count] attribute present (got ${stepCount})`);
                const contractReadyCount = await page.evaluate(() => {
                  const el = document.querySelector('[data-ready-count]');
                  return el ? el.getAttribute('data-ready-count') : null;
                });
                check(contractReadyCount !== null, `project-builder: [data-ready-count] attribute present (got ${contractReadyCount})`);
                const flowReady = await page.evaluate(() => {
                  const el = document.querySelector('[data-flow-ready]');
                  return el ? el.getAttribute('data-flow-ready') : null;
                });
                check(flowReady !== null, `project-builder: [data-flow-ready] attribute present (got "${flowReady}")`);
                // Stage A/B backfill — the agentic instruction + demo launchers are present.
                check(
                  await page.evaluate(() => document.querySelector('[data-action="launch-instructions"]') !== null),
                  'project-builder: instructions agent launcher present (Stage A)',
                );
                check(
                  await page.evaluate(() => document.querySelector('[data-action="launch-demo-builder"]') !== null),
                  'project-builder: demo agent launcher present (Stage B)',
                );
                // Stage D — contract resolution is wired: the panel renders when clauses
                // fail, and is correctly absent when the project is fully contract-ready.
                const resolutionWired = await page.evaluate(() => {
                  const panel = document.querySelector('[data-section="contract-resolution"]');
                  const ready = document.querySelector('[data-flow-ready]')?.getAttribute('data-flow-ready');
                  return panel !== null || ready === 'true';
                });
                check(resolutionWired, 'project-builder: contract-resolution panel wired (present on gaps, absent when ready)');
                await frame(page, 'a4-0-project-builder', 'A4 — project builder: north star, demo timeline, skills, contract readiness');
                // Add a demo step → data-step-count increments + dirty flips; discard.
                const presetBtn = page.locator('button').filter({ hasText: /^\+ Add step$/ }).first();
                if ((await presetBtn.count()) > 0) {
                  const before = parseInt(stepCount ?? '0', 10);
                  await presetBtn.click();
                  await sleep(THINK);
                  const after = await page.evaluate(() => {
                    const el = document.querySelector('[data-step-count]');
                    return el ? parseInt(el.getAttribute('data-step-count') ?? '0', 10) : 0;
                  });
                  check(after > before, `project-builder: data-step-count incremented after preset click (${before}→${after})`);
                  const dirtyAfter = await page.evaluate(() => document.querySelector('[data-dirty]')?.getAttribute('data-dirty') ?? '');
                  check(dirtyAfter === 'true', `project-builder: data-dirty="true" after adding demo step (got "${dirtyAfter}")`);
                  await frame(page, 'a4-1-project-dirty', `A4 — data-step-count incremented (${before}→${after}), data-dirty="true" (no save)`);
                } else {
                  check(false, 'project-builder: preset/add-step button present (soft — builder loaded)');
                }
              } else {
                check(false, 'project-builder: page did not become ready — project-builder checks skipped');
              }

        },
      },
    ],
  }),
  agents: defineJourney({
    id: 'agents',
    title: 'Compose an agent',
    story: 'Build the three starter agents from the curated library, then edit an existing agent\'s composition in the agent builder.',
    beats: [
      {
        id: 'agents-starters',
        title: 'Author plan/dev/review agents from the starter library',
        narration: 'Author plan/dev/review agents from the starter library',
        drive: async (ctx) => {
              // ── J2: BUILD THE THREE AGENTS FROM THE CURATED STARTER LIBRARY ───────────
              // A brand-new user creates plan/dev/review agents from starters — required
              // fields only, advanced config collapsed (UX spec §2). Proves the agents
              // land on disk as SKILL.md + pass the platform's own lint gate.
              console.log('\n[J2] Author plan/dev/review agents from the starter library');
              cleanStarterAgents(); // clear any prior-run residue first
              await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              const pickerPresent = await page.evaluate(() => document.querySelector('[data-section="starter-picker"]') !== null);
              check(pickerPresent, 'J2: new-agent shows the curated starter picker ([data-section="starter-picker"])');
              const advHiddenOnPicker = await page.evaluate(() => document.querySelector('[data-section="advanced"]') === null);
              check(advHiddenOnPicker, 'J2: advanced config is not dumped on the picker (progressive disclosure)');
              const starterOptionCount = await page.evaluate(() => document.querySelectorAll('[data-starter-option]').length);
              check(starterOptionCount >= 4, `J2: picker offers ≥3 starters + blank (got ${starterOptionCount} options)`);
              await frame(page, 'j2-0-starter-picker', 'J2 — new agent: pick a curated starter (plan/dev/review) or blank');

              for (const role of STARTER_AGENT_SLUGS) {
                await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
                await page.waitForSelector(`[data-starter-option="${role}"]`, { timeout: 15000 });
                await page.locator(`[data-starter-option="${role}"]`).click();
                await page.waitForSelector('[data-action="save-agent"]', { timeout: 10000 });
                if (role === STARTER_AGENT_SLUGS[0]) {
                  const advClosed = await page.evaluate(() =>
                    document.querySelector('[data-section="advanced"]')?.getAttribute('data-advanced-open'));
                  check(advClosed === 'false', `J2: advanced config collapsed by default after picking a starter (got "${advClosed}")`);
                  const requiredVisible = await page.evaluate(() =>
                    document.querySelector('#purpose-input') !== null && document.querySelector('#process-input') !== null);
                  check(requiredVisible, 'J2: required fields (purpose, process) visible without opening Advanced');
                  const dirtyAfterPick = await page.evaluate(() =>
                    document.querySelector('[data-page="agents"] [data-dirty]')?.getAttribute('data-dirty')
                    ?? document.querySelector('#col-center')?.getAttribute('data-dirty'));
                  check(dirtyAfterPick === 'true', `J2: picking a starter pre-fills + marks the form dirty (got "${dirtyAfterPick}")`);
                  await frame(page, 'j2-1-builder-prefilled', 'J2 — starter pre-fills required fields; advanced collapsed');
                }
                await page.locator('[data-action="save-agent"]').click();
                const skillPath = join(FORGE_ROOT, 'skills', role, 'SKILL.md');
                const landed = await waitForFile(skillPath, 12000);
                check(landed, `J2: saving the "${role}" starter writes skills/${role}/SKILL.md`);
              }

              // The three authored agents are now LIVE studio objects — they must pass lint.
              let j2LintOk = false;
              try {
                execFileSync(process.execPath,
                  ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', 'lint'],
                  { cwd: FORGE_ROOT, stdio: 'pipe' });
                j2LintOk = true;
              } catch (e) {
                console.error(`  [studio lint J2] non-zero: ${(e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')}`.slice(0, 600));
              }
              check(j2LintOk, 'J2: `forge studio lint` validates the three authored agents (exit 0)');
              await frame(page, 'j2-2-agents-authored', 'J2 — plan/dev/review agents authored from starters, lint-green');

        },
      },
      {
        id: 'agents-builder',
        title: 'Agent builder — /agents/project-manager',
        narration: 'Agent builder — /agents/project-manager',
        drive: async (ctx) => {
              // ── A3: Agent builder — an agent is data ──────────────────────────────────
              console.log('\n[A3] Agent builder — /agents/project-manager');
              await page.goto(watch.uiUrl + '/agents/project-manager', { waitUntil: 'domcontentloaded' });
              let agentPageReady = false;
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 25000 },
                );
                agentPageReady = true;
                check(true, 'agent-builder: [data-page="agents"][data-page-ready="true"]');
              } catch {
                const pr = await page.evaluate(() =>
                  document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') ?? '(no data-page=agents)');
                check(false, `agent-builder: data-page-ready (got "${pr}")`);
              }
              await caption(page, 'An agent is data too — skills, tools, runtime SDK, budgets, brain access. Edit it without leaving the UI.');
              await sleep(ACT);
              if (agentPageReady) {
                await countAtLeast(page, '[data-id]', 1, 'agent-builder: catalog palette renders ≥1 chip');
                // Open the collapsed Advanced section (J2 progressive disclosure) so the
                // capabilities zones + runtime render for both the checks and the frame.
                await page.locator('[data-action="toggle-advanced"]').first().click().catch(() => {});
                await page.waitForFunction(
                  () => document.querySelector('[data-section="advanced"]')?.getAttribute('data-advanced-open') === 'true',
                  null, { timeout: 5000 },
                ).catch(() => {});
                for (const kind of ['skill', 'tool', 'mcp', 'hook']) {
                  check(
                    await page.evaluate((k) => document.querySelector(`[data-accepts="${k}"]`) !== null, kind),
                    `agent-builder: drop zone [data-accepts="${kind}"] present`,
                  );
                }
                const agentId = await page.evaluate(() =>
                  document.querySelector('[data-page="agents"]')?.getAttribute('data-agent-id') ??
                  document.querySelector('[data-agent-id]')?.getAttribute('data-agent-id') ?? '');
                check(agentId.length > 0, `agent-builder: data-agent-id non-empty (got "${agentId}")`);
                const readyCount = await page.evaluate(() => {
                  const el = document.querySelector('[data-ready-count]');
                  return el ? el.getAttribute('data-ready-count') : null;
                });
                check(readyCount !== null, `agent-builder: [data-ready-count] attribute present (got ${readyCount})`);
                if (readyCount !== null) {
                  check(parseInt(readyCount, 10) >= 4, `agent-builder: readiness ≥4 checks pass for project-manager (got ${readyCount})`);
                }
                const sdk = await page.evaluate(() => document.querySelector('[data-sdk]')?.getAttribute('data-sdk') ?? '');
                check(sdk.length > 0, `agent-builder: [data-sdk] attribute present (got "${sdk}")`);
                await frame(page, 'a3-0-agent-builder', 'A3 — agent builder: catalog, drop zones, runtime, readiness panel');
                // Dirty-flag: edit the purpose field; assert data-dirty flips; discard.
                const purposeInput = page.locator('#purpose-input');
                if ((await purposeInput.count()) > 0) {
                  const originalPurpose = await purposeInput.inputValue();
                  await purposeInput.click();
                  await purposeInput.pressSequentially(' (e2e test edit)', { delay: 18 });
                  await sleep(THINK);
                  const dirtyVal = await page.evaluate(() => document.querySelector('[data-dirty]')?.getAttribute('data-dirty') ?? '');
                  check(dirtyVal === 'true', `agent-builder: data-dirty="true" after editing purpose field (got "${dirtyVal}")`);
                  const discardBtn = page.locator('#btn-discard');
                  if ((await discardBtn.count()) > 0) { await discardBtn.click(); await sleep(THINK); }
                  else { await purposeInput.fill(originalPurpose); }
                  await frame(page, 'a3-1-agent-dirty', 'A3 — data-dirty flips on edit (discarded, no save — seed SKILL.md immutable)');
                } else {
                  check(false, 'agent-builder: #purpose-input present to test dirty flag');
                }
              } else {
                check(false, 'agent-builder: page did not become ready — agent-builder checks skipped');
              }

        },
      },
    ],
  }),
  flowsAuthor: defineJourney({
    id: 'flows-author',
    title: 'Author a flow',
    story: 'Author a cycle flow as data: string agents into a new flow, give it seeded work, and prove a from-scratch flow is structurally identical to the production seed.',
    beats: [
      {
        id: 'flows-author-new-flow',
        title: 'String plan/dev/review into a flow (new-flow builder)',
        narration: 'String plan/dev/review into a flow (new-flow builder)',
        drive: async (ctx) => {
              // ── J3: STRING THE THREE AGENTS INTO A FLOW (new-flow builder) ────────────
              // From the library "+ New Flow" → canvas seeded from the basic starter
              // (plan → dev → review + verdict gate). Name it, save (slug derived), and
              // prove: lint-green, runnable, and node positions PERSIST across reload.
              console.log('\n[J3] String plan/dev/review into a flow (new-flow builder)');
              cleanFirstFlow();
              // discoverable creation: the library "+ New Flow" CTA is a real enabled link
              await page.goto(watch.uiUrl + '/', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              const newFlowCta = await page.evaluate(() => {
                const el = document.querySelector('[data-action="new-flow"]');
                return el ? { href: el.getAttribute('href'), disabled: el.hasAttribute('disabled') } : null;
              });
              check(newFlowCta !== null && !newFlowCta.disabled && (newFlowCta.href ?? '').includes('/flows/new'),
                'J3: library "+ New Flow" CTA is enabled and routes to the flow builder');

              await page.goto(watch.uiUrl + '/flows/new', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-active-tab') === 'build',
                null, { timeout: 15000 },
              ).catch(() => {});
              // Seeded from the basic starter: ≥3 nodes on the canvas.
              await page.waitForFunction(
                () => parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10) >= 3,
                null, { timeout: 15000 },
              ).catch(() => {});
              const seededNodeCount = await page.evaluate(() =>
                parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10));
              check(seededNodeCount >= 3, `J3: new-flow canvas seeded from the basic starter (≥3 nodes, got ${seededNodeCount})`);
              const flowAdvCollapsed = await page.evaluate(() => {
                const d = document.querySelector('[data-section="flow-advanced"]');
                return d ? !(d).open : false;
              });
              check(flowAdvCollapsed, 'J3: project/KB/triggers collapsed under Advanced by default (progressive disclosure)');
              await frame(page, 'j3-0-new-flow-seeded', 'J3 — new flow seeded from the basic starter (plan → dev → review)');

              // Name the flow + save (slug derived from name → /flows/my-first-flow).
              await page.locator('[data-field="flow-name"]').fill('My First Flow');
              await page.locator('[data-action="save-flow"]').click();
              const flowYamlPath = join(J3_FLOW_DIR, 'flow.yaml');
              const flowLanded = await waitForFile(flowYamlPath, 12000);
              check(flowLanded, `J3: saving the new flow writes studio/flows/${J3_FLOW}/flow.yaml`);

              // Persistence: every node carries a numeric x/y (the J3 schema addition).
              const nodesV1 = readSavedFlowNodes(J3_FLOW);
              const allHaveXY = nodesV1.length >= 3 && nodesV1.every((n) => typeof n.x === 'number' && typeof n.y === 'number');
              check(allHaveXY, `J3: saved flow persists node positions (every node has numeric x/y; ${nodesV1.length} nodes)`);
              const gatePresent = nodesV1.some((n) => typeof n.gate === 'string');
              check(gatePresent, 'J3: authored flow keeps the human verdict gate (zero-gate flows are rejected)');

              // lint validates the authored flow; it is runnable.
              let j3LintOk = false;
              try {
                execFileSync(process.execPath,
                  ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', 'lint'],
                  { cwd: FORGE_ROOT, stdio: 'pipe' });
                j3LintOk = true;
              } catch (e) {
                console.error(`  [studio lint J3] non-zero: ${(e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')}`.slice(0, 600));
              }
              check(j3LintOk, 'J3: `forge studio lint` validates the authored flow (exit 0)');

              // Saving a new flow auto-redirects to its real route — wait for that
              // navigation rather than racing it with our own goto.
              await page.waitForURL(new RegExp(`/flows/${J3_FLOW}`), { timeout: 15000 }).catch(() => {});
              await page.waitForFunction(
                () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              const j3CanStart = await page.evaluate(() =>
                document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-can-start'));
              check(j3CanStart === 'true', `J3: authored flow is runnable (data-can-start="true", got "${j3CanStart}")`);

              // Position round-trip: drag a node, save, reload, save again — the dragged
              // position must survive (proves x/y are honoured on load, not recomputed).
              await page.locator('[data-page="flow-monitor"] .tab', { hasText: 'BUILD' }).first().click().catch(() => {});
              await page.waitForFunction(
                () => parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10) >= 3,
                null, { timeout: 15000 },
              ).catch(() => {});
              const dragId = nodesV1[0]?.id ?? 'plan';
              const x0 = nodesV1.find((n) => n.id === dragId)?.x ?? 0;
              const vBeforeDrag = readSavedFlow(J3_FLOW).version;
              let dragged = false;
              try {
                const nodeEl = page.locator(`.react-flow__node:has([data-node-id="${dragId}"])`).first();
                const box = await nodeEl.boundingBox();
                if (box) {
                  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                  await page.mouse.down();
                  await page.mouse.move(box.x + box.width / 2 + 230, box.y + box.height / 2 + 150, { steps: 12 });
                  await page.mouse.up();
                  dragged = true;
                }
              } catch { /* drag unavailable */ }
              await sleep(THINK);
              await page.locator('[data-action="save-flow"]').click();
              // Wait for the async save to land (version bumps) — not a fixed sleep.
              await waitForFlowVersion(J3_FLOW, vBeforeDrag + 1, 15000);
              const xDrag = readSavedFlow(J3_FLOW).nodes.find((n) => n.id === dragId)?.x ?? x0;
              check(dragged && Math.abs(xDrag - x0) > 40, `J3: dragging node "${dragId}" moved + saved its position (x ${x0}→${xDrag})`);
              await frame(page, 'j3-1-flow-arranged', 'J3 — authored flow, node hand-arranged on the canvas');

              // Reload + save again (no move): the dragged position survives the reload
              // (proves persisted x/y are honoured on load, not recomputed by autolayout).
              const vBeforeReload = readSavedFlow(J3_FLOW).version;
              await page.goto(watch.uiUrl + `/flows/${J3_FLOW}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              // Stage C — a no-runs flow monitor shows the per-flow kickoff surface (FlowKickoff).
              const j3KickoffKind = await page.evaluate(() => {
                const el = document.querySelector('[data-section="flow-kickoff"]');
                return el ? el.getAttribute('data-kickoff-kind') : null;
              });
              check(j3KickoffKind !== null, `J3: no-runs flow shows the kickoff surface ([data-kickoff-kind]="${j3KickoffKind}")`);
              await page.locator('[data-page="flow-monitor"] .tab', { hasText: 'BUILD' }).first().click().catch(() => {});
              await page.waitForFunction(
                () => parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10) >= 3,
                null, { timeout: 15000 },
              ).catch(() => {});
              await page.locator('[data-action="save-flow"]').click();
              await waitForFlowVersion(J3_FLOW, vBeforeReload + 1, 15000);
              const xReload = readSavedFlow(J3_FLOW).nodes.find((n) => n.id === dragId)?.x ?? -9999;
              check(Math.abs(xReload - xDrag) < 30, `J3: node position PERSISTS across reload (x ${xDrag} → ${xReload})`);
              await frame(page, 'j3-2-flow-persisted', 'J3 — node positions persist across reload (authored flow is durable)');

        },
      },
      {
        id: 'flows-author-seeded-run',
        title: 'Give the authored flow work (seeded run on my-first-flow)',
        narration: 'Give the authored flow work (seeded run on my-first-flow)',
        drive: async (ctx) => {
              // ── J5: GIVE THE AUTHORED FLOW WORK (seeded run) ──────────────────────────
              // The user's authored flow (my-first-flow) is given work against the
              // onboarded project. Seeded (no real agents), this proves the monitor
              // surfaces a USER-AUTHORED flow's run — its plan→dev→review hexes progress
              // and the run parks at the verdict gate. (The full mdtoc idea→reflect
              // path is proven separately by the RUN act below.)
              console.log('\n[J5] Give the authored flow work (seeded run on my-first-flow)');
              cleanFirstFlowRun();
              // Seed a gated run: manifest (flow_id binds it to the authored flow) + events.
              mkdirSync(QDIR('ready-for-review'), { recursive: true });
              writeFileSync(join(QDIR('ready-for-review'), `${J5_INIT}.md`), [
                '---',
                `initiative_id: ${J5_INIT}`,
                `project: ${J4_PROJECT}`,
                `project_repo_path: ${join(FORGE_ROOT, 'projects', J4_PROJECT)}`,
                `created_at: '${new Date().toISOString()}'`,
                'iteration_budget: 3',
                'cost_budget_usd: 5',
                'phase: ready-for-review',
                'origin: human-directed',
                `cycle_id: ${J5_CYCLE_ID}`,
                `flow_id: ${J3_FLOW}`,
                '---',
                '',
                '# Give the authored flow work',
                '',
                'A seeded run proving the authored plan → dev → review flow renders in the monitor.',
                '',
              ].join('\n'));
              j5Event('orchestrator', 'start', 'cycle.start', { origin: 'human-directed' });
              j5Event('plan', 'start', 'plan.start');
              j5Event('plan', 'end', 'plan.end', {}, { cost_usd: 0.12, duration_ms: 24000 });
              j5Event('dev', 'start', 'dev.start');
              j5Event('dev', 'log', 'gate.pass', {});
              j5Event('dev', 'end', 'dev.end', {}, { cost_usd: 0.28, duration_ms: 41000 });
              j5Event('review', 'start', 'review.start');

              await page.goto(watch.uiUrl + `/flows/${J3_FLOW}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              // The run is discovered + associated with the authored flow (flow_id).
              const j5RunCount = await page.evaluate(() =>
                parseInt(document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-run-count') ?? '0', 10));
              check(j5RunCount >= 1, `J5: the authored flow shows the seeded run (run-count ${j5RunCount})`);
              // The monitor renders the authored flow's own nodes (plan/dev/review).
              for (const nodeId of ['plan', 'dev', 'review']) {
                await page.waitForSelector(`[data-mon-node][data-node-id="${nodeId}"]`, { timeout: 10000 }).catch(() => {});
                const present = await page.evaluate((n) => document.querySelector(`[data-mon-node][data-node-id="${n}"]`) !== null, nodeId);
                check(present, `J5: monitor renders the "${nodeId}" hex of the authored flow`);
              }
              // Phase statuses progressed (plan + dev complete) and the run parked at the gate.
              const planStatus = await page.evaluate(() =>
                document.querySelector('[data-mon-node][data-node-id="plan"]')?.getAttribute('data-status'));
              check(planStatus === 'complete', `J5: plan phase shows complete (got "${planStatus}")`);
              const reviewStatus = await page.evaluate(() =>
                document.querySelector('[data-mon-node][data-node-id="review"]')?.getAttribute('data-status'));
              check(reviewStatus === 'gated' || reviewStatus === 'active', `J5: review phase awaits the human verdict (got "${reviewStatus}")`);
              await expectPhaseCost(page, 'J5: the authored run shows accrued per-phase cost');
              await frame(page, 'j5-0-authored-run', 'J5 — the authored flow, given work, runs plan → dev → review to the verdict gate');
              // Clean the seeded run now so it does not bleed into the mdtoc RUN act.
              cleanFirstFlowRun();

        },
      },
      {
        id: 'flows-author-scratch-parity',
        title: 'Build the forge-develop flow from scratch (flow-as-data)',
        narration: 'Build the forge-develop flow from scratch (flow-as-data)',
        drive: async (ctx) => {
              // ── A2: BUILD THE FORGE DEVELOP FLOW FROM SCRATCH ─────────────────────────
              // The headline new beat. We authored forge-develop-scratch as a flow definition
              // (3 nodes, 2 edges, 1 gate). Prove: (1) `forge studio lint` validates it,
              // (2) it is structurally identical to the production seed (subsumption), (3)
              // the flow builder renders it live, (4) the engine can run it (data-can-start).
              console.log('\n[A2] Build the forge-develop flow from scratch (flow-as-data)');

              // (1) `forge studio lint` validates the authored flow — the platform's own gate.
              let lintOk = false;
              try {
                execFileSync(process.execPath,
                  ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', 'lint'],
                  { cwd: FORGE_ROOT, stdio: 'pipe' });
                lintOk = true;
              } catch (e) {
                console.error(`  [studio lint] non-zero: ${(e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')}`.slice(0, 600));
              }
              check(lintOk, 'author-from-scratch: `forge studio lint` validates the authored forge-develop-scratch flow (exit 0)');

              // (2) Structural parity with the production seed (forge-develop) — the subsumption proof.
              const seedStruct = parseFlowStructure(readFileSync(SEED_FLOW_PATH, 'utf8'));
              const scratchStruct = parseFlowStructure(readFileSync(join(SCRATCH_FLOW_DIR, 'flow.yaml'), 'utf8'));
              check(JSON.stringify(scratchStruct.nodeIds) === JSON.stringify(seedStruct.nodeIds),
                `author-from-scratch: node set matches the seed (${scratchStruct.nodeIds.join(',')})`);
              check(scratchStruct.gates.review === 'verdict',
                'author-from-scratch: the review gate lands on verdict (matches the forge-develop seed)');
              check(scratchStruct.edgeCount === seedStruct.edgeCount,
                `author-from-scratch: edge count matches the seed (${scratchStruct.edgeCount})`);

              // (3) The flow builder renders the authored flow live.
              await page.goto(watch.uiUrl + `/flows/${SCRATCH_FLOW}`, { waitUntil: 'domcontentloaded' });
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 20000 },
                );
                check(true, 'author-from-scratch: flow-monitor ready for the authored flow');
              } catch {
                const pr = await page.evaluate(() =>
                  document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') ?? '(absent)');
                check(false, `author-from-scratch: flow-monitor ready (got "${pr}")`);
              }
              await caption(page, 'The forge-develop build flow, rebuilt from scratch — dev → unifier → review, one verdict gate. The platform validates it and it is identical to the production seed.');
              await sleep(ACT);
              // (4) The engine can run it — start-run is enabled (no runs yet on this flow).
              const canStart = await page.evaluate(() =>
                document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-can-start') ?? '(absent)');
              check(canStart === 'true', `author-from-scratch: engine can run the authored flow (data-can-start="true", got "${canStart}")`);
              await frame(page, 'a2-0-scratch-monitor', 'A2 — authored forge-develop-scratch: lint green, parity with seed, runnable by the engine');

              // Open the BUILD tab to show the authored topology on the canvas.
              const buildTabBtn = page.locator('button.tab').filter({ hasText: 'BUILD' }).first();
              if ((await buildTabBtn.count()) > 0) {
                await buildTabBtn.click();
                try {
                  await page.waitForFunction(
                    () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-active-tab') === 'build',
                    null, { timeout: 8000 },
                  );
                  check(true, 'author-from-scratch: BUILD tab click flips data-active-tab="build"');
                } catch {
                  const tabVal = await page.evaluate(() =>
                    document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-active-tab') ?? '(absent)');
                  check(false, `author-from-scratch: data-active-tab="build" (got "${tabVal}")`);
                }
              } else {
                check(false, 'author-from-scratch: BUILD tab button present');
              }
              // ReactFlow hydrates after the tab switch — poll for the node count rather
              // than a fixed sleep (the canvas can render a tick late under load).
              await page.waitForFunction(
                () => parseInt(document.querySelector('[data-node-count]')?.getAttribute('data-node-count') ?? '0', 10) >= 3,
                null, { timeout: 15000 },
              ).catch(() => {});
              const nodeCount = await page.evaluate(() => {
                const el = document.querySelector('[data-node-count]');
                return el ? parseInt(el.getAttribute('data-node-count') ?? '0', 10) : -1;
              });
              check(nodeCount >= 3, `author-from-scratch: BUILD canvas renders ≥3 nodes for the authored forge-develop-scratch flow (got ${nodeCount})`);
              await countAtLeast(page, '[data-flow-node]', 1, 'author-from-scratch: ≥1 [data-flow-node] rendered in BUILD canvas');
              const palettePresent = await page.evaluate(() => document.querySelector('[data-component="agent-palette"]') !== null);
              check(palettePresent, 'author-from-scratch: [data-component="agent-palette"] present (drag more agents in)');
              await countAtLeast(page, '[data-palette-chip]', 1, 'author-from-scratch: palette has ≥1 [data-palette-chip]');
              // Agent chips load async (the Agents section shows "Loading…" first while the
              // fixed Artifact chips render instantly) — wait for the agent chips before
              // asserting, else we race the fetch.
              await countAtLeast(page, '[data-palette-chip="agent"]', 3, 'author-from-scratch: palette agent chips loaded');
              // The new OOTB agent library (L1-A) is draggable from the palette (#10) — the
              // author can compose the freshly-seeded agents into a flow from scratch.
              const ootbChips = await page.evaluate(() => {
                const want = ['developer-ralph', 'project-manager', 'project-scoped-review'];
                const present = new Set(
                  Array.from(document.querySelectorAll('[data-palette-chip="agent"]')).map((el) =>
                    el.getAttribute('data-chip-ref'),
                  ),
                );
                return want.filter((w) => present.has(w));
              });
              check(
                ootbChips.length === 3,
                `author-from-scratch: library agents appear in the palette (${ootbChips.join(',') || 'none'})`,
              );
              const goalSetPresent = await page.evaluate(() => document.querySelector('[data-goal-set]') !== null);
              check(goalSetPresent, 'author-from-scratch: [data-goal-set] present in FlowHeader');
              await sleep(READ);
              await frame(page, 'a2-1-scratch-build', `A2 — BUILD canvas: the authored cycle (${nodeCount} nodes) on the ReactFlow canvas, palette + goal field`);
              // Clip: the flow builder — the iconic "build the pipeline as data" surface.
              await recordClip(browser, watch, 'flow-build', `/flows/${SCRATCH_FLOW}`, async (p) => {
                const buildTab = p.locator('button.tab').filter({ hasText: 'BUILD' }).first();
                if (await buildTab.count() > 0) await buildTab.click().catch(() => {});
                await p.waitForSelector('[data-flow-node]', { timeout: 12000 }).catch(() => {});
                await sleep(2600);
              }, { readySel: '[data-page="flow-monitor"]', caption: 'the flow builder — compose the cycle as data (nodes · palette · gates)' });

        },
      },
    ],
  }),
  standUpOnboard: defineJourney({
    id: 'stand-up-onboard',
    title: 'Stand up a project (onboard existing)',
    story: 'Onboard an existing project in the UI and resolve it to the forge project contract.',
    beats: [
      {
        id: 'su-onboard-project',
        title: 'Onboard a project from the UI',
        narration: 'Onboard a project from the UI',
        drive: async (ctx) => {
              // ── J4: ONBOARD A PROJECT (in the UI) ─────────────────────────────────────
              // The library "+ New Project" CTA opens a minimal onboarding form (name +
              // quality gate + north star); submitting registers the project + scaffolds
              // .forge/project.json. Proves: registry + config on disk, readiness renders,
              // the project appears in the library, lint stays green.
              console.log('\n[J4] Onboard a project from the UI');
              cleanFirstProject();
              await page.goto(watch.uiUrl + '/', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              // Baseline project count BEFORE onboarding — the discoverable-on-disk projects
              // vary by checkout (this de-betterado'd worktree ships only the mdtoc reference
              // project + scratch dirs), so the assertion is RELATIVE: onboarding must add
              // exactly one project. Stronger than an absolute floor, and checkout-agnostic.
              const projCountBefore = await page.evaluate(() =>
                parseInt(document.querySelector('[data-section="projects"]')?.getAttribute('data-count') ?? '0', 10));
              const newProjCta = await page.evaluate(() => {
                const el = document.querySelector('[data-action="new-project"]');
                return el ? { href: el.getAttribute('href'), disabled: el.hasAttribute('disabled') } : null;
              });
              check(newProjCta !== null && !newProjCta.disabled && (newProjCta.href ?? '').includes('/projects/new'),
                'J4: library "+ New Project" CTA is enabled and routes to onboarding');

              await page.goto(watch.uiUrl + '/projects/new', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-section="project-onboard"]') !== null,
                null, { timeout: 15000 },
              ).catch(() => {});
              const onboardForm = await page.evaluate(() => document.querySelector('[data-section="project-onboard"]') !== null);
              check(onboardForm, 'J4: new-project shows the onboarding form ([data-section="project-onboard"])');
              const onbAdvCollapsed = await page.evaluate(() => {
                const d = document.querySelector('[data-section="onboard-advanced"]');
                return d ? !d.open : false;
              });
              check(onbAdvCollapsed, 'J4: advanced contract clauses collapsed by default (only required fields shown)');
              await frame(page, 'j4-0-onboard-form', 'J4 — onboard a project: required fields only (quality gate, north star)');

              // Fill the minimal required fields + onboard. (quality-gate defaults to npm test)
              await page.locator('[data-field="project-name"]').fill('Journey Demo Project');
              await page.locator('[data-field="north-star"]').fill('A scratch project onboarded by the e2e journey to prove UI onboarding.');
              await page.locator('[data-action="onboard-project"]').click();

              const projectJsonPath = join(FORGE_ROOT, 'projects', J4_PROJECT, '.forge', 'project.json');
              const projLanded = await waitForFile(projectJsonPath, 12000);
              check(projLanded, `J4: onboarding writes projects/${J4_PROJECT}/.forge/project.json`);

              // The hard contract fields are on disk.
              let projCfg = {};
              try { projCfg = JSON.parse(readFileSync(projectJsonPath, 'utf8')); } catch { /* */ }
              check(Array.isArray(projCfg.quality_gate_cmd) && projCfg.quality_gate_cmd.length > 0,
                'J4: project.json carries the C1 quality_gate_cmd');
              check(projCfg.demo && typeof projCfg.demo.shape === 'string',
                'J4: project.json carries the DEMO block (demo.shape)');
              check(typeof projCfg.northStar === 'string' && projCfg.northStar.length > 0,
                'J4: project.json carries the north star');
              // The project is auto-discovered from disk: its dir carries the
              // `.forge/project.json` contract file (B1 — no registry file).
              check(existsSync(projectJsonPath),
                'J4: the project is auto-discovered from disk (.forge/project.json present)');

              // Onboarding redirects to the editor — readiness renders + reflects the
              // onboarded fields. Navigate explicitly (don't rely solely on the redirect
              // race) and wait for the editor's [data-ready-count] to materialise before
              // reading it, so a slow first-compile doesn't read it as absent (-1).
              await page.waitForURL(new RegExp(`/projects/${J4_PROJECT}`), { timeout: 15000 }).catch(() => {});
              if (!/\/projects\/[^/]*journey-demo-project/.test(page.url())) {
                await page.goto(watch.uiUrl + `/projects/${J4_PROJECT}`, { waitUntil: 'domcontentloaded' });
              }
              await page.waitForFunction(
                () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 },
              ).catch(() => {});
              await page.waitForSelector('[data-ready-count]', { timeout: 15000 }).catch(() => {});
              const readyCount = await page.evaluate(() => {
                const el = document.querySelector('[data-ready-count]');
                return el ? parseInt(el.getAttribute('data-ready-count') ?? '0', 10) : -1;
              });
              check(readyCount >= 3, `J4: onboarded project passes ≥3 contract-readiness checks (got ${readyCount})`);
              await frame(page, 'j4-1-project-readiness', 'J4 — onboarded project: contract readiness reflects the hard fields');

              // The project now appears in the library.
              await page.goto(watch.uiUrl + '/', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              const projCount = await page.evaluate(() =>
                parseInt(document.querySelector('[data-section="projects"]')?.getAttribute('data-count') ?? '0', 10));
              const onboardedListed = await page.evaluate((id) =>
                document.querySelector(`[data-section="projects"] [data-card-type="project"][data-card-id="${id}"]`) !== null, J4_PROJECT);
              check(projCount === projCountBefore + 1 && onboardedListed,
                `J4: onboarding adds exactly one project to the library (${projCountBefore}→${projCount}, ${J4_PROJECT} listed=${onboardedListed})`);

              // lint stays green with the new project registered.
              let j4LintOk = false;
              try {
                execFileSync(process.execPath,
                  ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', 'lint'],
                  { cwd: FORGE_ROOT, stdio: 'pipe' });
                j4LintOk = true;
              } catch (e) {
                console.error(`  [studio lint J4] non-zero: ${(e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')}`.slice(0, 600));
              }
              check(j4LintOk, 'J4: `forge studio lint` stays green with the onboarded project (exit 0)');

        },
      },
      {
        id: 'su-onboard-preflight',
        title: 'onboard existing → deterministically resolve a failing clause',
        narration: 'onboard existing → deterministically resolve a failing clause',
        drive: async (ctx) => {
              // ── SU: onboard existing → align to the contract (preflight resolution) ────
              console.log('\n[SU] onboard existing → deterministically resolve a failing clause');
              await page.goto(watch.uiUrl + '/projects/new', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 }).catch(() => {});
              await page.waitForSelector('[data-section="project-onboard"]', { timeout: 15000 }).catch(() => {});
              await caption(page, 'Onboard an existing repo — forge aligns it to the contract, resolving clauses deterministically.');
              // name + north-star only (quality-gate keeps its default 'npm test'). Fill AFTER
              // page-ready + re-fill if the button hasn't enabled (guards a hydration race where
              // the input event lands before React wires onChange). Guarded so a disabled form
              // never throws + aborts the journey.
              const fillOnboard = async () => {
                await page.locator('[data-field="project-name"]').fill('Journey Onboard Existing').catch(() => {});
                await page.locator('[data-field="north-star"]').fill('An existing repo aligned to the forge contract by the journey.').catch(() => {});
              };
              const onboardEnabled = (ms) => page.waitForFunction(() => {
                const b = document.querySelector('[data-action="onboard-project"]');
                return b !== null && !b.hasAttribute('disabled');
              }, null, { timeout: ms }).then(() => true).catch(() => false);
              await fillOnboard();
              let onbEnabled = await onboardEnabled(6000);
              if (!onbEnabled) { await fillOnboard(); onbEnabled = await onboardEnabled(6000); }
              check(onbEnabled, 'SU: onboard-project enables once the required fields are filled');
              // The onboard may redirect (ready) or stay on the form (a hard clause still
              // fails) — either way the project is created on disk. Use the known slug +
              // navigate explicitly (like J4), rather than depending on the redirect.
              const onbSlug = ONB_EXISTING_SLUG;
              const onbJson = join(FORGE_ROOT, 'projects', onbSlug, '.forge', 'project.json');
              if (onbEnabled) {
                await page.locator('[data-action="onboard-project"]').click().catch(() => {});
                await waitForFile(onbJson, 12000);
              }
              const onbCreated = existsSync(onbJson);
              check(onbEnabled && onbCreated, `SU: onboarding created project "${onbSlug}"`);
              if (onbCreated) {
                // Seed disk state so the AUTO-tier ARTIFACTS clause fails (deterministic, no LLM).
                const onbDir = join(FORGE_ROOT, 'projects', onbSlug);
                try {
                  writeFileSync(join(onbDir, 'package.json'), JSON.stringify({ name: onbSlug, private: true, scripts: { test: 'node --test' } }, null, 2));
                  writeFileSync(join(onbDir, '.gitignore'), ['node_modules/', '.forge/work-items/', 'AGENT.md', 'PROMPT.md', 'fix_plan.md'].join('\n') + '\n');
                } catch { /* */ }
                await page.goto(watch.uiUrl + `/projects/${onbSlug}`, { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(
                  () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 20000 }).catch(() => {});
                const resolutionPanel = await page.waitForSelector('[data-section="contract-resolution"]', { timeout: 15000 }).then(() => true).catch(() => false);
                check(resolutionPanel, 'SU: contract-resolution panel renders when a clause fails');
                await frame(page, 'onb-0-failing', 'Part 1 — onboard existing: a contract clause fails preflight (auto-fixable)');
                await page.locator('[data-action="apply-preflight-auto"]').first().click().catch(() => {});
                await sleep(WORK);
                await page.waitForFunction(
                  () => document.querySelector('[data-resolution-clause][data-clause-id="ARTIFACTS"]') === null,
                  null, { timeout: 12000 }).catch(() => {});
                const artifactsCleared = await page.locator('[data-resolution-clause][data-clause-id="ARTIFACTS"]').count() === 0;
                check(artifactsCleared, 'SU: auto-fix resolved the failing clause (existing repo aligned to the contract)');
                await frame(page, 'onb-1-resolved', 'Part 1 — clause auto-resolved: the existing repo is now contract-ready');
              }

        },
      },
    ],
  }),
  skills: defineJourney({
    id: 'skills',
    title: 'Compose a skill',
    story: 'Browse the OOTB community-sourced skill library, edit a skill, and author a brand-new one.',
    beats: [
      {
        id: 'skills-ootb-library',
        title: 'OOTB skill library (community-sourced)',
        narration: 'OOTB skill library (community-sourced)',
        drive: async (ctx) => {
              // ════════════════════════════════════════════════════════════════════════
              // PART 2 (skills pillar) — the OOTB skill library (sourced from curated
              // community repos), editing a skill, and authoring a new one from scratch.
              // ════════════════════════════════════════════════════════════════════════

              // ── SK-1: the OOTB skill library (community-sourced) ──────────────────────
              console.log('\n[SK-1] OOTB skill library (community-sourced)');
              let community = [];
              try { community = (yaml.load(readFileSync(join(FORGE_ROOT, 'studio', 'catalog.yaml'), 'utf8'))?.['community-skills']) ?? []; } catch { /* */ }
              check(community.length >= 5, `SK-1: catalog ships an OOTB skill library (${community.length} community-skills)`);
              const handoffSkill = community.find((s) => s.id === 'handoff');
              check(/github\.com|firecrawl|http/.test(handoffSkill?.source ?? ''), `SK-1: an OOTB skill cites an online source (${handoffSkill?.source ?? 'none'})`);
              check(!!handoffSkill?.provenance && !!handoffSkill?.stars, `SK-1: OOTB skill carries provenance + stars (${handoffSkill?.provenance ?? '?'}, ${handoffSkill?.stars ?? '?'})`);
              await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(() => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 15000 }).catch(() => {});
              await caption(page, 'Every OOTB skill is a curated community skill (superpowers, TDD, security-review) — drag it into an agent.');
              check(await page.locator('[data-component="catalog-palette"]').count() > 0, 'SK-1: agent-builder renders the Component Library');
              for (const id of OOTB_SKILL_IDS) {
                const present = await page.locator(`[data-component="catalog-palette"] [data-kind="skill"][data-id="${id}"]`).count() > 0;
                check(present, `SK-1: OOTB skill "${id}" is draggable in the library`);
              }
              await frame(page, 'sk-0-library', 'Part 2 (skills) — the OOTB skill library, sourced from community repos');

        },
      },
      {
        id: 'skills-edit',
        title: 'Edit a skill',
        narration: 'Edit a skill',
        drive: async (ctx) => {
              // ── SK-2: edit a skill (via the agent-skill editor) ───────────────────────
              console.log('\n[SK-2] Edit a skill');
              cleanSkillArtifacts();
              seedOotbSkill();
              await page.goto(watch.uiUrl + `/agents/${SK_EDIT_SLUG}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(() => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true', null, { timeout: 15000 }).catch(() => {});
              check(await page.evaluate((s) => document.querySelector('[data-page="agents"]')?.getAttribute('data-agent-id') === s, SK_EDIT_SLUG), `SK-2: editor loaded the skill ([data-agent-id="${SK_EDIT_SLUG}"])`);
              await caption(page, 'Open any skill and edit it in place — the instructions are rewritten to its SKILL.md.');
              await page.locator('#process-input').fill('EDITED body — journey rewrote the skill instructions.').catch(() => {});
              await frame(page, 'sk-1-edit', 'Part 2 (skills) — editing a skill in the builder');
              await page.locator('[data-action="save-agent"]').click().catch(() => {});
              let skEdited = false;
              { const p = join(FORGE_ROOT, 'skills', SK_EDIT_SLUG, 'SKILL.md'); const dl = Date.now() + 8000;
                while (Date.now() < dl) { try { if (readFileSync(p, 'utf8').includes('EDITED body')) { skEdited = true; break; } } catch { /* */ } await sleep(120); } }
              check(skEdited, `SK-2: saving rewrites skills/${SK_EDIT_SLUG}/SKILL.md`);

        },
      },
      {
        id: 'skills-create',
        title: 'Author a new skill',
        narration: 'Author a new skill',
        drive: async (ctx) => {
              // ── SK-3: author a NEW skill ──────────────────────────────────────────────
              console.log('\n[SK-3] Author a new skill');
              try { rmSync(join(FORGE_ROOT, 'skills', SK_NEW_SLUG), { recursive: true, force: true }); } catch { /* */ }
              await page.goto(watch.uiUrl + '/skills/new', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="skill-builder"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 }).catch(() => {});
              const skNewReady = await page.locator('main[data-page="skill-builder"]').count() > 0;
              check(skNewReady, 'SK-3: skill builder renders ([data-page="skill-builder"])');
              check(await page.locator('[data-section="skill-new"]').count() > 0, 'SK-3: [data-section="skill-new"] present');
              await caption(page, 'Author a brand-new skill: name, one-line description, instructions — added to the library.');
              // data-page-ready is static "true" here, so settle for hydration then type with
              // real keystrokes (pressSequentially fires onChange per char; plain .fill() can
              // land before React wires the input). Re-fill if create hasn't enabled.
              await sleep(1500);
              const fillSkill = async () => {
                const nameEl = page.locator('[data-field="skill-name"]');
                await nameEl.click().catch(() => {});
                await nameEl.fill('').catch(() => {});
                await nameEl.pressSequentially(SK_NEW_NAME, { delay: 18 }).catch(() => {});
                const descEl = page.locator('[data-field="skill-description"]');
                await descEl.click().catch(() => {});
                await descEl.fill('').catch(() => {});
                await descEl.pressSequentially('Review an API surface for contract-breaking changes before merge.', { delay: 8 }).catch(() => {});
                await page.locator('[data-field="skill-body"]').fill('1. Diff the public surface.\n2. Flag removed/renamed exports.\n3. Require a migration note.').catch(() => {});
              };
              const createEnabled = (ms) => page.waitForFunction(() => {
                const b = document.querySelector('[data-action="create-skill"]');
                return b !== null && !b.hasAttribute('disabled');
              }, null, { timeout: ms }).then(() => true).catch(() => false);
              await fillSkill();
              let skEnabled = await createEnabled(6000);
              if (!skEnabled) { await fillSkill(); skEnabled = await createEnabled(6000); }
              check(skEnabled, 'SK-3: create-skill enables once name + description are filled');
              await frame(page, 'sk-2-create', 'Part 2 (skills) — authoring a brand-new skill');
              await recordClip(browser, watch, 'sk-create', '/skills/new', async (p) => {
                await p.waitForSelector('[data-section="skill-new"]', { timeout: 12000 });
                await p.locator('[data-field="skill-name"]').fill('API contract review').catch(() => {});
                await p.locator('[data-field="skill-description"]').fill('Flag contract-breaking API changes before merge.').catch(() => {});
                await sleep(1800);
              }, { readySel: 'main[data-page="skill-builder"]', caption: 'authoring a new skill from scratch' });
              await page.locator('[data-action="create-skill"]').click().catch(() => {});
              const skLanded = await waitForFile(join(FORGE_ROOT, 'skills', SK_NEW_SLUG, 'SKILL.md'), 12000);
              check(skLanded, `SK-3: creating writes skills/${SK_NEW_SLUG}/SKILL.md`);
              await frame(page, 'sk-3-created', 'Part 2 (skills) — new skill authored → SKILL.md on disk → ready to compose');

        },
      },
    ],
  }),
  flowsRun: defineJourney({
    id: 'flows-run',
    title: 'Run a gated cycle',
    story: 'Run a gated cycle end-to-end on a real mdtoc roadmap feature: idea → architect interview → PLAN gate → autonomous build → review gate → merge → reflect, plus the flow-engine monitor controls.',
    beats: [
      {
        id: 'flows-run-idea',
        title: 'Operator drops the mdtoc idea',
        narration: 'Operator drops the mdtoc idea',
        drive: async (ctx) => {
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
              createdSid = sid;
              console.log(`[e2e] architect session: ${sid}`);
              check(!!sid, '[data-action="start-architect"] navigates to /architect/<sid>/interview');

        },
      },
      {
        id: 'flows-run-grounding',
        title: 'Architect grounds itself — P3 activity panel',
        narration: 'Architect grounds itself — P3 activity panel',
        drive: async (ctx) => {
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
  }),
  roadmap: defineJourney({
    id: 'roadmap',
    title: 'Project roadmap',
    story: 'Browse the per-project roadmap and trigger a queued initiative onto the develop flow.',
    beats: [
      {
        id: 'roadmap-tab',
        title: 'Per-project Roadmap tab',
        narration: 'Per-project Roadmap tab',
        drive: async (ctx) => {
              // ── R6: Per-project Roadmap tab (S6 DEC-3) ───────────────────────────────
              // The manifest is now in done/; seed a minimal work-items-snapshot so the
              // roadmap endpoint returns initiatives + WIs, then verify the tab renders them.
              console.log('\n[R6] Per-project Roadmap tab');
              const wiSnapshotDir = join(CYCLE_LOG, 'work-items-snapshot');
              ROADMAP_SEEDED_WI = join(wiSnapshotDir, 'WI-1.md');
              roadmapSeeded = false;
              try {
                mkdirSync(wiSnapshotDir, { recursive: true });
                writeFileSync(ROADMAP_SEEDED_WI, [
                  '---',
                  `work_item_id: WI-1`,
                  `initiative_id: ${INIT}`,
                  'status: complete',
                  'depends_on: []',
                  'acceptance_criteria: []',
                  'files_in_scope: []',
                  'estimated_iterations: 1',
                  '---',
                  '',
                  '## Add --write mode',
                  '',
                  'Implement in-place TOC injection with idempotency.',
                ].join('\n'));
                roadmapSeeded = true;
              } catch {
                check(false, 'roadmap: seeded WI snapshot for roadmap assertion');
              }
              // S7 / DEC-3: seed a SECOND, decomposed-but-not-yet-developing initiative
              // (pending) so the roadmap shows the "start development" trigger. A real
              // develop run (dev→unifier→review) is the scheduler's job — exercised by the
              // operator-gated verify:cycle; here we prove the trigger flips the manifest
              // onto the forge-develop flow.
              INIT_DEV = `INIT-${DATE}-e2e-develop-trigger`;
              DEV_CYCLE_ID = `${STAMP}_${INIT_DEV}`;
              mkdirSync(QDIR('pending'), { recursive: true });
              writeFileSync(join(QDIR('pending'), `${INIT_DEV}.md`), [
                '---', `initiative_id: ${INIT_DEV}`, `project: ${PROJECT}`, `project_repo_path: ${projectRoot}`,
                `created_at: '${new Date().toISOString()}'`, 'iteration_budget: 4', 'cost_budget_usd: 6', 'phase: pending',
                'origin: architect', `cycle_id: ${DEV_CYCLE_ID}`,
                '---', '', '# mdtoc — `--check` mode (CI drift guard)', '',
                'Given a doc whose embedded TOC has drifted, when `mdtoc --check` runs, then it exits non-zero so CI can fail.',
              ].join('\n'));

              await page.goto(watch.uiUrl + `/projects/${PROJECT}`, { waitUntil: 'domcontentloaded' });
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 20000 },
                );
              } catch { /* soft: continue to check tab */ }
              // Click the Roadmap tab.
              const roadmapTab = page.locator('button[data-tab="roadmap"]');
              if (await roadmapTab.count() > 0) {
                await roadmapTab.click();
                await sleep(1500); // allow bridge fetch to settle
                await caption(page, 'Per-project Roadmap — a serpentine timeline of the project’s progression over time; click a dot to pop its detail card.');
                await frame(page, 'r6-0-roadmap-tab', 'R6 — per-project Roadmap tab: the serpentine timeline of initiatives over time');
                const roadmapSection = await page.evaluate(() =>
                  document.querySelector('[data-section="project-roadmap"]') !== null);
                check(roadmapSection, 'roadmap: [data-section="project-roadmap"] rendered');
                const initCount = await page.evaluate(() =>
                  document.querySelectorAll('[data-roadmap-node]').length);
                check(initCount >= 1, `roadmap: ≥1 [data-roadmap-node] on the timeline (got ${initCount})`);
                if (roadmapSeeded) {
                  // The detail card pops OFF the dot now — click the seeded initiative's
                  // node, then assert its card (with WIs) appears in the popover.
                  await page.locator(`[data-roadmap-node][data-initiative-id="${INIT}"]`).first().click().catch(() => {});
                  await sleep(500);
                  const wiCount = await page.evaluate(() =>
                    document.querySelectorAll('[data-roadmap-popover] [data-work-item-id]').length);
                  check(wiCount >= 1, `roadmap: clicking a dot pops its card with ≥1 [data-work-item-id] (got ${wiCount})`);
                  await frame(page, 'r6-0b-popover', 'R6 — clicking an initiative dot pops its detail card up off the timeline');
                  await page.keyboard.press('Escape'); // dismiss before selecting the next node
                  await sleep(300);
                }
              } else {
                check(false, 'roadmap: Roadmap tab button [data-tab="roadmap"] present on project page');
              }

        },
      },
      {
        id: 'roadmap-start-development',
        title: 'Start development trigger (DEC-3)',
        narration: 'Start development trigger (DEC-3)',
        drive: async (ctx) => {
              // ── R6.1: Start development — the trigger flips the manifest onto forge-develop ──
              console.log('\n[R6.1] Start development trigger (DEC-3)');
              // The card pops off the dot — click the pending initiative's node to reveal it.
              await page.locator(`[data-roadmap-node][data-initiative-id="${INIT_DEV}"]`).first().click().catch(() => {});
              await sleep(500);
              // The card div is uniquely identified by data-develop-state (the button also
              // carries data-initiative-id, so select the div explicitly to avoid a match clash).
              const devCard = page.locator(`[data-initiative-id="${INIT_DEV}"][data-develop-state]`);
              const startBtn = devCard.locator('[data-action="start-development"]');
              if (await startBtn.count() > 0) {
                check(
                  await devCard.getAttribute('data-initiative-status') === 'pending',
                  'roadmap: the decomposed initiative is pending (develop-able)',
                );
                await devCard.scrollIntoViewIfNeeded().catch(() => {});
                await caption(page, 'A decomposed initiative offers "Start development" — it runs the Forge Develop flow.');
                await frame(page, 'r6-1-start-development', 'R6 — the "start development" trigger on a pending initiative');
                await startBtn.click();
                await page.waitForSelector(`[data-initiative-id="${INIT_DEV}"][data-develop-state="started"]`, { timeout: 12000 }).catch(() => {});
                const devState = await devCard.getAttribute('data-develop-state');
                check(devState === 'started', `start-development enqueues the develop run (data-develop-state=${devState})`);
                await frame(page, 'r6-1b-development-started', 'R6 — development started: the unifier will open a PR for review');
                // The manifest is now claimable on the forge-develop flow, threading its cycle_id.
                const devManifest = readFileSync(join(QDIR('pending'), `${INIT_DEV}.md`), 'utf8');
                check(/^flow_id:\s*forge-develop\s*$/m.test(devManifest), 'start-development repoints the manifest at the forge-develop flow');
                check(devManifest.includes(DEV_CYCLE_ID), 'the develop run threads the architect-minted cycle_id (DEC-2)');
              } else {
                check(false, `roadmap: [data-action="start-development"] present on the pending initiative ${INIT_DEV}`);
              }

              // Clean up the seeded WI snapshot (the manifest in done/ is cleaned in the finally block).
              if (roadmapSeeded) {
                try { rmSync(ROADMAP_SEEDED_WI, { force: true }); } catch { /* */ }
              }
              try { rmSync(join(QDIR('pending'), `${INIT_DEV}.md`), { force: true }); } catch { /* */ }

        },
      },
    ],
  }),
  swapRuntime: defineJourney({
    id: 'swap-runtime',
    title: 'Swap the runtime adapter',
    story: 'Swap the runtime-adapter seam — the registry-driven SDK/model picker.',
    beats: [
      {
        id: 'swap-runtime-sdk-picker',
        title: 'Runtime-adapter seam — /agents/project-manager',
        narration: 'Runtime-adapter seam — /agents/project-manager',
        drive: async (ctx) => {
              // ── S2: Runtime-adapter seam (ADR-029) — registry-driven SDK picker + range
              console.log('\n[S2] Runtime-adapter seam — /agents/project-manager');
              await page.goto(watch.uiUrl + '/agents/project-manager', { waitUntil: 'domcontentloaded' });
              let rangePageReady = false;
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 25000 },
                );
                rangePageReady = true;
                check(true, 'adapter-seam: [data-page="agents"][data-page-ready="true"]');
              } catch {
                const pr = await page.evaluate(() =>
                  document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') ?? '(no data-page=agents)');
                check(false, `adapter-seam: agent builder page-ready (got "${pr}")`);
              }
              await caption(page, 'The runtime is a seam — the SDK picker is registry-driven. claude is live; gemini/aider/codex are disabled until their adapter ships (ADR-029).');
              await sleep(ACT);
              if (rangePageReady) {
                // The RuntimePicker now lives under the collapsed "Advanced" section (J2
                // progressive disclosure). Open it to drive the runtime-adapter seam.
                await page.locator('[data-action="toggle-advanced"]').first().click().catch(() => {});
                await page.waitForFunction(
                  () => document.querySelector('[data-section="advanced"]')?.getAttribute('data-advanced-open') === 'true',
                  null, { timeout: 5000 },
                ).catch(() => {});
                const claudeCardAvailable = await page.evaluate(() => {
                  const card = document.querySelector('[data-sdk-id="claude"]');
                  return card !== null && !card.classList.contains('disabled');
                });
                check(claudeCardAvailable, 'adapter-seam: [data-sdk-id="claude"] selectable (adapter registered)');
                const codexDisabled = await page.evaluate(() => {
                  const card = document.querySelector('[data-sdk-id="codex"]');
                  return card !== null && card.classList.contains('disabled');
                });
                check(codexDisabled, 'adapter-seam: [data-sdk-id="codex"] disabled (adapter not registered)');
                const geminiDisabled = await page.evaluate(() => {
                  const card = document.querySelector('[data-sdk-id="gemini"]');
                  return card !== null && card.classList.contains('disabled');
                });
                check(geminiDisabled, 'adapter-seam: [data-sdk-id="gemini"] disabled (adapter not registered)');
                await frame(page, 's2-0-sdk-picker', 'S2 — adapter seam: claude selectable; codex/gemini disabled (registry-driven)');

                const rangeBtn = page.locator('[data-component="runtime-picker"] [data-strategy="range"]');
                let rangeTogglePresent = false;
                if ((await rangeBtn.count()) > 0) {
                  rangeTogglePresent = true;
                  await rangeBtn.click();
                  await sleep(THINK);
                  try {
                    await page.waitForFunction(
                      () => document.querySelector('[data-component="runtime-picker"]')?.getAttribute('data-strategy') === 'range',
                      null, { timeout: 5000 },
                    );
                    check(true, 'adapter-seam: range segment flips [data-component="runtime-picker"][data-strategy="range"]');
                  } catch {
                    const strat = await page.evaluate(() =>
                      document.querySelector('[data-component="runtime-picker"]')?.getAttribute('data-strategy') ?? '(absent)');
                    check(false, `adapter-seam: data-strategy flipped to range (got "${strat}")`);
                  }
                } else {
                  check(false, 'adapter-seam: [data-strategy="range"] toggle present in RuntimePicker');
                }
                if (rangeTogglePresent) {
                  const captionEl = await page.evaluate(() => {
                    const el = document.querySelector('#strategy-caption');
                    return el ? el.textContent?.trim() : null;
                  });
                  check(captionEl !== null && captionEl.length > 5, `adapter-seam: range strategy caption rendered ("${captionEl ?? '(absent)'}")`);
                  const modelChips = page.locator('[data-component="runtime-picker"] [data-model-id]');
                  const chipCount = await modelChips.count();
                  check(chipCount >= 1, `adapter-seam: ≥1 [data-model-id] chip rendered in range mode (got ${chipCount})`);
                  let selectedCount = 0;
                  if (chipCount >= 1) {
                    await modelChips.first().click(); await sleep(THINK); selectedCount = 1;
                    if (chipCount >= 2) { await modelChips.nth(1).click(); await sleep(THINK); selectedCount = 2; }
                    try {
                      await page.waitForFunction(
                        ({ n }) => {
                          const el = document.querySelector('[data-component="runtime-picker"]');
                          return el !== null && parseInt(el.getAttribute('data-model-count') ?? '0', 10) >= n;
                        },
                        { n: selectedCount }, { timeout: 5000 },
                      );
                      const count = await page.evaluate(() =>
                        parseInt(document.querySelector('[data-component="runtime-picker"]')?.getAttribute('data-model-count') ?? '0', 10));
                      check(count >= selectedCount, `adapter-seam: data-model-count ≥${selectedCount} after selecting ${selectedCount} chip(s) (got ${count})`);
                    } catch {
                      const gotCount = await page.evaluate(() =>
                        document.querySelector('[data-component="runtime-picker"]')?.getAttribute('data-model-count') ?? '(absent)');
                      check(false, `adapter-seam: data-model-count ≥${selectedCount} in range mode (got "${gotCount}")`);
                    }
                  }
                  await frame(page, 's2-1-range-chips', `S2 — range mode: ${selectedCount} Claude tier chip(s) selected; routes to the cheapest capable tier first`);
                }
                const yamlPreviewText = await page.evaluate(() => {
                  const preview = document.querySelector('[data-component="yaml-preview"]');
                  if (preview) return preview.textContent ?? '';
                  const pres = [...document.querySelectorAll('pre')];
                  return pres.find((el) => el.textContent?.includes('strategy'))?.textContent ?? '';
                });
                check(yamlPreviewText.includes('strategy: range'),
                  `adapter-seam: YAML preview contains "strategy: range" (got: "${yamlPreviewText.slice(0, 100).replace(/\n/g, '\\n')}")`);
                await frame(page, 's2-2-yaml-range', 'S2 — YAML preview shows strategy: range (authored in UI; no Save — seed SKILL.md immutable)');
              } else {
                check(false, 'adapter-seam: agent builder page did not become ready — adapter-seam checks skipped');
              }

        },
      },
    ],
  }),
  knowledge: defineJourney({
    id: 'knowledge',
    title: 'Knowledge graph',
    story: 'Browse the knowledge graph, pin human guidance, and run KB maintenance (lint/index/OOTB brains).',
    beats: [
      {
        id: 'knowledge-graph',
        title: 'KB-backend seam — /knowledge?id=cycles (real brain)',
        narration: 'KB-backend seam — /knowledge?id=cycles (real brain)',
        drive: async (ctx) => {
              // ── S3: KB-backend seam (ADR-027 §4) — knowledge graph + pin guidance ─────
              GUIDANCE_TEXT = '[e2e-journey] --write theme: idempotency is the sharp edge — a second --write must be byte-identical or a trailing newline drifts into a diff.';
              console.log('\n[S3.0] KB-backend seam — /knowledge?id=cycles (real brain)');
              await page.goto(`${watch.uiUrl}/knowledge?id=cycles`, { waitUntil: 'domcontentloaded' });
              kbPageReady = false;
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 30000 },
                );
                kbPageReady = true;
                check(true, 'kb-seam: [data-page="knowledge"][data-page-ready="true"]');
              } catch {
                const pr = await page.evaluate(() =>
                  document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') ?? '(no data-page=knowledge)');
                check(false, `kb-seam: knowledge page-ready (got "${pr}")`);
              }
              await caption(page, 'The brain is a seam too — FilesystemKbBackend today, with the kb.yaml `backend:` field as the swap point. Browse the real force-graph.');
              await sleep(WORK);
              if (kbPageReady) {
                const kbId = await page.evaluate(() => document.querySelector('#kb-svg')?.getAttribute('data-kb-id') ?? '');
                check(kbId === 'cycles', `kb-seam: #kb-svg data-kb-id="cycles" (got "${kbId}")`);
                let nodeCountKb = 0;
                try {
                  await page.waitForFunction(() => {
                    const el = document.querySelector('#kb-svg');
                    return el !== null && parseInt(el.getAttribute('data-node-count') ?? '0', 10) >= 10;
                  }, null, { timeout: 15000 });
                } catch { /* report below */ }
                nodeCountKb = await page.evaluate(() => parseInt(document.querySelector('#kb-svg')?.getAttribute('data-node-count') ?? '0', 10));
                check(nodeCountKb >= 10, `kb-seam: #kb-svg data-node-count ≥10 (got ${nodeCountKb})`);
                const edgeCountKb = await page.evaluate(() => parseInt(document.querySelector('#kb-svg')?.getAttribute('data-edge-count') ?? '0', 10));
                check(edgeCountKb > 0, `kb-seam: #kb-svg data-edge-count > 0 (got ${edgeCountKb})`);
                await countAtLeast(page, '[data-node-id]', 5, 'kb-seam: ≥5 [data-node-id] nodes rendered in graph');
                const hasTheme = await page.evaluate(() => document.querySelector('[data-layer="theme"]') !== null);
                check(hasTheme, 'kb-seam: [data-layer="theme"] node(s) present');
                const hasIndex = await page.evaluate(() => document.querySelector('[data-layer="index"]') !== null);
                check(hasIndex, 'kb-seam: [data-layer="index"] node(s) present');
                const healthPresent = await page.evaluate(() =>
                  document.querySelector('[data-section="kb-health"]') !== null ||
                  [...document.querySelectorAll('div')].some((el) => el.textContent?.includes('KB HEALTH') || el.textContent?.includes('LAYER BALANCE')));
                check(healthPresent, 'kb-seam: KB HEALTH panel rendered');
                const selectorPresent = await page.evaluate(() =>
                  document.querySelector('select') !== null || document.querySelector('[data-component="kb-selector"]') !== null);
                check(selectorPresent, 'kb-seam: KB selector present');
              }
              await frame(page, 's3-0-kb-graph', `S3 — /knowledge?id=cycles: force-graph rendered (${
                await page.evaluate(() => document.querySelector('#kb-svg')?.getAttribute('data-node-count') ?? '?')
              } nodes, real cycles brain)`);

              if (kbPageReady) {
                const themeNode = page.locator('[data-layer="theme"]').first();
                if ((await themeNode.count()) > 0) {
                  // Click the node's hit-circle: its centre is collision-free, whereas the
                  // <g> bbox centre is pushed by the label into empty/overlapped space.
                  await themeNode.locator('[data-hit]').click({ force: true, timeout: 5000 }).catch(() => {});
                  try {
                    await page.waitForFunction(
                      () => (document.querySelector('#kb-svg')?.getAttribute('data-selected-node') ?? '') !== '',
                      null, { timeout: 8000 },
                    );
                    const selectedNode = await page.evaluate(() => document.querySelector('#kb-svg')?.getAttribute('data-selected-node') ?? '');
                    check(selectedNode !== '', `kb-seam: clicking a theme node sets data-selected-node (got "${selectedNode}")`);
                  } catch {
                    const sel = await page.evaluate(() => document.querySelector('#kb-svg')?.getAttribute('data-selected-node') ?? '(absent)');
                    check(false, `kb-seam: clicking theme node sets data-selected-node (got "${sel}")`);
                  }
                } else {
                  check(false, 'kb-seam: [data-layer="theme"] node present to click');
                }
              }
              await sleep(ACT);
              await frame(page, 's3-0b-kb-node-article', 'S3 — theme node clicked: NODE ARTICLE panel visible');

        },
      },
      {
        id: 'knowledge-pin-guidance',
        title: 'KB-backend seam — pin-guidance',
        narration: 'KB-backend seam — pin-guidance',
        drive: async (ctx) => {
              // ── S3.1: Pin-guidance → guidance node appears (writes _guidance/<ts>.md) ──
              console.log('\n[S3.1] KB-backend seam — pin-guidance');
              await caption(page, 'Human guidance — pin a note to the brain; it surfaces as a guidance node until the next ingest pass.');
              await sleep(ACT);
              if (kbPageReady) {
                const guidanceTextarea = page.locator('#guidance-text');
                if ((await guidanceTextarea.count()) > 0) {
                  await guidanceTextarea.scrollIntoViewIfNeeded().catch(() => {});
                  await guidanceTextarea.click();
                  await guidanceTextarea.pressSequentially(GUIDANCE_TEXT, { delay: 14 });
                  await sleep(THINK);
                  await frame(page, 's3-1-guidance-typed', 'S3 — guidance text typed into the HUMAN GUIDANCE panel');
                  const pinBtn = page.locator('#pin-guidance-btn');
                  if ((await pinBtn.count()) > 0) {
                    await pinBtn.click();
                    await sleep(ACT);
                    let guidancePinned = false;
                    try {
                      await page.waitForFunction(() => document.querySelector('[data-guidance-pinned="true"]') !== null, null, { timeout: 10000 });
                      guidancePinned = true;
                      check(true, 'kb-seam: data-guidance-pinned="true" — guidance POST succeeded');
                    } catch {
                      const successMsg = await page.evaluate(() =>
                        [...document.querySelectorAll('div')].some((el) => el.textContent?.includes('Guidance pinned') ?? false));
                      if (successMsg) { guidancePinned = true; check(true, 'kb-seam: "Guidance pinned" success message rendered'); }
                      else {
                        const pinVal = await page.evaluate(() =>
                          document.querySelector('[data-guidance-pinned]')?.getAttribute('data-guidance-pinned') ?? '(absent)');
                        check(false, `kb-seam: data-guidance-pinned="true" (got "${pinVal}")`);
                      }
                    }
                    if (guidancePinned) {
                      await sleep(WORK);
                      const hasGuidanceNode = await page.evaluate(() => document.querySelector('[data-layer="guidance"]') !== null);
                      check(hasGuidanceNode, 'kb-seam: [data-layer="guidance"] node appeared after pin (graph re-fetched)');
                    }
                  } else {
                    check(false, 'kb-seam: #pin-guidance-btn present to click');
                  }
                } else {
                  check(false, 'kb-seam: #guidance-text textarea present');
                }
              } else {
                check(false, 'kb-seam: pin-guidance skipped (page did not reach ready)');
              }
              await frame(page, 's3-1b-guidance-pinned', 'S3 — guidance pinned: data-guidance-pinned="true", guidance node in graph');
              await sleep(READ);

        },
      },
      {
        id: 'knowledge-lint-index',
        title: 'KB maintenance — lint / index / OOTB brains',
        narration: 'KB maintenance — lint / index / OOTB brains',
        drive: async (ctx) => {
              // ── S3.2: KB maintenance — LINT + INDEX + OOTB brains (real, read-only) ───
              console.log('\n[S3.2] KB maintenance — lint / index / OOTB brains');
              await page.goto(`${watch.uiUrl}/knowledge?id=cycles`, { waitUntil: 'domcontentloaded' });
              const kbMaintReady = await page.waitForFunction(
                () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 30000 }).then(() => true).catch(() => false);
              await caption(page, 'Knowledge is editable — deterministic LINT + INDEX maintenance, plus the human-guidance + ingest loop.');
              if (kbMaintReady) {
                await page.locator('[data-component="kb-maintenance"] [data-action="kb-lint"]').click().catch(() => {});
                await page.waitForFunction(
                  () => (document.querySelector('[data-component="kb-maintenance-result"]')?.textContent ?? '').startsWith('lint:'),
                  null, { timeout: 15000 }).catch(() => {});
                const lintText = await page.evaluate(() => document.querySelector('[data-component="kb-maintenance-result"]')?.textContent ?? '');
                check(/^lint:/.test(lintText), `S3.2: kb-lint result badge (got "${lintText}")`);
                await frame(page, 'kb-0-lint', `Part 2 (knowledge) — kb-lint: ${lintText || 'result'}`);
                await page.locator('[data-component="kb-maintenance"] [data-action="kb-index"]').click().catch(() => {});
                await page.waitForFunction(
                  () => (document.querySelector('[data-component="kb-maintenance-result"]')?.textContent ?? '') === 'index refreshed ✓',
                  null, { timeout: 15000 }).catch(() => {});
                check(true, 'S3.2: kb-index maintenance triggered');
                const scanBtn = page.locator('[data-section="lint-resolution"] [data-action="lint-scan"]');
                if (await scanBtn.count() > 0) {
                  await scanBtn.click().catch(() => {});
                  await page.waitForFunction(
                    () => document.querySelector('[data-section="lint-resolution"]')?.getAttribute('data-lint-scanned') === 'true',
                    null, { timeout: 15000 }).catch(() => {});
                  check(await page.locator('[data-section="lint-resolution"][data-lint-scanned="true"]').count() > 0,
                    'S3.2: lint-resolution scan ran (data-lint-scanned="true")');
                }
                await frame(page, 'kb-1-maintenance', 'Part 2 (knowledge) — lint/index maintenance + the resolution surface');
                const ootb = await page.evaluate(() => ({
                  cycles: document.querySelector('#kb-select option[value="cycles"]')?.textContent ?? '',
                  forgeDev: document.querySelector('#kb-select option[value="forge-dev"]')?.textContent ?? '',
                }));
                check(ootb.cycles.length > 0 && ootb.forgeDev.length > 0,
                  `S3.2: cycles + forge-dev brains ship OOTB (${ootb.cycles} / ${ootb.forgeDev})`);
              }

        },
      },
    ],
  }),
  recovery: defineJourney({
    id: 'recovery',
    title: 'Recover a stuck initiative',
    story: 'Recover a stuck initiative from the dedicated operator surface.',
    beats: [
      {
        id: 'recovery-surface',
        title: 'Recovery surface — the operator surface for stuck cycles (DEC-6)',
        narration: 'Recovery surface — the operator surface for stuck cycles (DEC-6)',
        drive: async (ctx) => {
              // ── S4: Recovery surface (DEC-6 — the CLI recovery verbs moved to the UI) ──
              console.log('\n[S4] Recovery surface — the operator surface for stuck cycles (DEC-6)');
              await caption(page, 'forge review/requeue/abandon left the CLI (DEC-6) — recovery is a UI screen over the bridge routes.');
              await page.goto(watch.uiUrl + '/recovery', { waitUntil: 'domcontentloaded' });
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="recovery"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 20000 },
                );
                check(true, 'recovery: [data-page="recovery"][data-page-ready="true"] renders (DEC-6 operator surface)');
              } catch {
                const pr = await page.evaluate(() => document.querySelector('[data-page="recovery"]')?.getAttribute('data-page-ready') ?? '(absent)');
                check(false, `recovery: data-page-ready (got "${pr}")`);
              }
              // The list OR the empty-state renders (both are valid — depends on queue state).
              const recoverySurface = await page.evaluate(() =>
                document.querySelector('[data-section="recovery-list"]') !== null ||
                document.querySelector('[data-section="recovery-empty"]') !== null);
              check(recoverySurface, 'recovery: the recoverable-list or empty-state section renders');
              await sleep(ACT);
              await frame(page, 's4-recovery', 'S4 — Recovery: inspect/requeue/abandon a stuck cycle, all in the UI (CLI retired)');

        },
      },
    ],
  }),
  };

  // RUN_ORDER + results speak journey IDs (kebab-case), not the map's local keys.
  const journeyById = Object.fromEntries(Object.values(journeys).map((j) => [j.id, j]));
  const journeyIds = Object.values(journeys).map((j) => j.id);

  for (const j of Object.values(journeys)) tracker.journeyMeta(j);

  const RUN_ORDER = [
    ['stand-up-create', 'su-create-title'],
    ['stand-up-create', 'su-create-library'],
    ['stand-up-create', 'su-create-orientation'],
    ['agents', 'agents-starters'],
    ['flows-author', 'flows-author-new-flow'],
    ['stand-up-onboard', 'su-onboard-project'],
    ['stand-up-create', 'su-create-instructions'],
    ['stand-up-create', 'su-create-project-brain'],
    ['stand-up-onboard', 'su-onboard-preflight'],
    ['flows-author', 'flows-author-seeded-run'],
    ['flows-author', 'flows-author-scratch-parity'],
    ['agents', 'agents-builder'],
    ['stand-up-create', 'su-create-project-builder'],
    ['skills', 'skills-ootb-library'],
    ['skills', 'skills-edit'],
    ['skills', 'skills-create'],
    ['flows-run', 'flows-run-idea'],
    ['flows-run', 'flows-run-grounding'],
    ['flows-run', 'flows-run-questions'],
    ['flows-run', 'flows-run-freetext'],
    ['flows-run', 'flows-run-stall'],
    ['flows-run', 'flows-run-draft-cost'],
    ['flows-run', 'flows-run-plan-gate'],
    ['flows-run', 'flows-run-send-back'],
    ['flows-run', 'flows-run-approve'],
    ['flows-run', 'flows-run-pm-decompose'],
    ['flows-run', 'flows-run-tdd-red'],
    ['flows-run', 'flows-run-grind'],
    ['flows-run', 'flows-run-dependency-gate'],
    ['flows-run', 'flows-run-unifier'],
    ['flows-run', 'flows-run-cost-rollup'],
    ['flows-run', 'flows-run-review-comment'],
    ['flows-run', 'flows-run-review-send-back'],
    ['flows-run', 'flows-run-rerun'],
    ['flows-run', 'flows-run-re-review'],
    ['flows-run', 'flows-run-approve-merge'],
    ['flows-run', 'flows-run-reflect'],
    ['roadmap', 'roadmap-tab'],
    ['roadmap', 'roadmap-start-development'],
    ['flows-run', 'flows-run-monitor-deep-dive'],
    ['flows-run', 'flows-run-start-run-cta'],
    ['flows-run', 'flows-run-gate-control'],
    ['swap-runtime', 'swap-runtime-sdk-picker'],
    ['knowledge', 'knowledge-graph'],
    ['knowledge', 'knowledge-pin-guidance'],
    ['knowledge', 'knowledge-lint-index'],
    ['recovery', 'recovery-surface'],
  ];

  // Fail fast on drift between RUN_ORDER and the journey definitions: every
  // pair must resolve, and every declared beat must be scheduled exactly once.
  const scheduled = new Set();
  for (const [jid, bid] of RUN_ORDER) {
    const j = journeyById[jid];
    if (!j) throw new Error(`[e2e] RUN_ORDER references unknown journey '${jid}'`);
    if (!j.beats.some((b) => b.id === bid)) throw new Error(`[e2e] RUN_ORDER references unknown beat '${jid}/${bid}'`);
    if (scheduled.has(`${jid}/${bid}`)) throw new Error(`[e2e] RUN_ORDER schedules '${jid}/${bid}' twice`);
    scheduled.add(`${jid}/${bid}`);
  }
  for (const j of Object.values(journeys)) {
    for (const b of j.beats) {
      if (!scheduled.has(`${j.id}/${b.id}`)) throw new Error(`[e2e] beat '${j.id}/${b.id}' is defined but never scheduled in RUN_ORDER`);
    }
  }

  if (process.argv.includes('--list')) {
    console.log(`[e2e] ${Object.keys(journeys).length} journeys, ${RUN_ORDER.length} beats:`);
    for (const j of Object.values(journeys)) {
      console.log(`  ${j.id} — ${j.title} (${j.beats.length} beat${j.beats.length === 1 ? '' : 's'})`);
    }
    return;
  }

  // Pre-seed isolation guard (known-gaps #10) — refuse before touching anything
  // if a live daemon or a stray manifest could turn the emulated seed into a
  // REAL cycle.
  await assertNoLiveDaemon(FORGE_ROOT);

  // Neutralise the bridge's release-finalize path for the whole run (incident
  // 2026-07-16): the REAL approve-and-merge click calls the bridge's in-process
  // runReleaseFinalize — a real SDK agent turn — which is NOT covered by
  // FORGE_ARCHITECT_NO_SPAWN. Its first gate is hasReleaseProcess(project.json),
  // so stripping `releaseProcess` for the run makes it return 'skipped' before
  // any SDK call or git op. Restored verbatim in the finally block.
  const projectJsonPath = join(projectRoot, '.forge', 'project.json');
  const projectJsonOriginal = readFileSync(projectJsonPath, 'utf8');
  {
    const cfg = JSON.parse(projectJsonOriginal);
    delete cfg.releaseProcess;
    writeFileSync(projectJsonPath, JSON.stringify(cfg, null, 2));
  }

  cleanProjectDir();
  mkdirSync(join(projectRoot, '_architect'), { recursive: true });
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  mkdirSync(VIDEO, { recursive: true });
  mkdirSync(CLIPS, { recursive: true });

  // Author the from-scratch flow BEFORE booting the bridge so the UI + lint can
  // load it. (Cleaned up in finally.) This is the data the ACT-1 build beat shows.
  cleanScratchFlow();
  cleanStarterAgents();
  cleanFirstFlow();
  cleanFirstProject();
  cleanFirstFlowRun();
  writeScratchFlow();

  console.log('[e2e] booting forge studio (cold compile ~20-40s)…');
  watch = await startWatch();
  console.log(`[e2e] ready: ${watch.uiUrl}`);
  try { execSync(`curl -s -m 60 ${watch.uiUrl}/ -o /dev/null`); } catch { /* warm */ }

  browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1380, height: 1600 },
    recordVideo: { dir: VIDEO, size: { width: 1380, height: 1600 } },
  });
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));

  try {
    for (const [journeyId, beatId] of RUN_ORDER) {
      const beat = journeyById[journeyId].beats.find((b) => b.id === beatId);
      console.log(`\n[journey/beat] ${journeyId}/${beatId} — ${beat.title}`);
      tracker.begin(journeyId, beatId);
      await beat.drive(journeyCtx);
      tracker.end();
    }

        // ── End card ──────────────────────────────────────────────────────────────
        console.log('\n[end] End card');
        await page.evaluate(() => {
          let card = document.getElementById('demo-end-card');
          if (!card) {
            card = document.createElement('div');
            card.id = 'demo-end-card';
            Object.assign(card.style, {
              position: 'fixed', inset: '0', background: '#0d1117',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              zIndex: '99997', pointerEvents: 'none',
            });
            card.innerHTML = `
              <div style="font:700 22px ui-sans-serif,system-ui;color:#58a6ff;margin-bottom:20px">
                Forge Studio — the platform, not just the pipeline.
              </div>
              <div style="font:500 18px ui-sans-serif,system-ui;color:#e6edf3;margin-bottom:10px">
                Author a flow. Run it. Swap its engine.
              </div>
              <div style="margin-top:32px;font:12px ui-monospace,monospace;color:#6e7681">
                The forge cycle is three chained flows now. Everything is data you can edit.
              </div>`;
            document.body.appendChild(card);
          }
        });
        await caption(page, 'Forge Studio — author a flow, run it, swap its engine. The forge cycle is three chained flows now, not one.');
        await frame(page, 'end-card', 'End card — "Author a flow. Run it. Swap its engine."');
        await sleep(READ);

        console.log('\n[e2e] journey complete.');
  } finally {
        await ctx.close();
        await browser.close();
        try { process.kill(-watch.proc.pid, 'SIGKILL'); } catch { /* */ }
        cleanProjectDir();
        cleanSeededSession(createdSid);
        cleanInstructionsSession(instrSid);          // Part 1 — AI-1
        cleanSeededBrain(pbSid);                      // Part 1 — AI-2
        cleanOnboardedProject(ONB_EXISTING_SLUG);    // Part 1 — SU onboard-existing
        cleanSkillArtifacts();                        // Part 2 — skills pillar
        cleanScratchFlow();
        cleanStarterAgents();
        cleanFirstFlow();
        cleanFirstProject();
        cleanFirstFlowRun();
        rmSync(CYCLE_LOG, { recursive: true, force: true });
        // S7: the seeded review worktree + the develop-trigger initiative (INIT_DEV).
        try { rmSync(join(FORGE_ROOT, '_worktrees', INIT), { recursive: true, force: true }); } catch { /* */ }
        for (const q of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
          try { rmSync(join(QDIR(q), `${INIT}.md`), { force: true }); } catch { /* */ }
          try { rmSync(join(QDIR(q), `${INIT}.verdict-response.md`), { force: true }); } catch { /* */ }
          try { rmSync(join(QDIR(q), `${INIT}-e2e-develop-trigger.md`), { force: true }); } catch { /* */ }
          try { rmSync(join(QDIR(q), `INIT-${DATE}-e2e-develop-trigger.md`), { force: true }); } catch { /* */ }
        }
        // ACT 3 studio cleanup — the S1 gated synthetic run (INIT2).
        try {
          const studioLogDirs = existsSync(join(FORGE_ROOT, '_logs'))
            ? readdirSync(join(FORGE_ROOT, '_logs')).filter((d) => d.includes('e2e-studio-demo'))
            : [];
          for (const d of studioLogDirs) rmSync(join(FORGE_ROOT, '_logs', d), { recursive: true, force: true });
          for (const q of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
            const entries = existsSync(QDIR(q))
              ? readdirSync(QDIR(q)).filter((f) => f.includes('e2e-studio-demo'))
              : [];
            for (const f of entries) rmSync(join(QDIR(q), f), { force: true });
          }
        } catch { /* studio cleanup best-effort */ }
        if (createdSid) {
          try { rmSync(join(FORGE_ROOT, '_logs', `_architect-${createdSid}`), { recursive: true, force: true }); } catch { /* */ }
        }
        // KB-seam cleanup — remove any _guidance/*.md files written by the pin-guidance beat.
        try {
          const guidanceDir = join(FORGE_ROOT, 'brain', 'cycles', '_guidance');
          if (existsSync(guidanceDir)) {
            for (const f of readdirSync(guidanceDir)) rmSync(join(guidanceDir, f), { force: true });
            try { rmSync(guidanceDir, { recursive: true, force: true }); } catch { /* */ }
          }
        } catch { /* KB-seam cleanup best-effort */ }
        // Restore the releaseProcess block stripped at run start (finalize
        // neutralisation) — verbatim original text, before the git restore below.
        try { writeFileSync(projectJsonPath, projectJsonOriginal); } catch (err) {
          console.warn(`[e2e] project.json restore failed: ${err.message}`);
        }
        // known-gaps #10 residue — if the release-finalize path ever runs anyway,
        // it dirties/stages the managed project subtree (tracked IN the forge repo,
        // no nested .git). Restore so green runs leave the tree clean; best-effort,
        // same convention as the cleanups above.
        try {
          execFileSync('git', ['-C', FORGE_ROOT, 'restore', '--staged', '--', `projects/${PROJECT}`]);
          execFileSync('git', ['-C', FORGE_ROOT, 'checkout', '--', `projects/${PROJECT}`]);
        } catch (err) { console.warn(`[e2e] managed-project restore best-effort failed: ${err.message}`); }
  }

    const vids = readdirSync(VIDEO).filter((f) => f.endsWith('.webm'));
    let videoName = vids[0] ?? '';
    if (videoName) {
      renameSync(join(VIDEO, videoName), join(VIDEO, 'journey.webm'));
      videoName = 'video/journey.webm';
    }
    // Drop the per-clip temp recording dirs (the renamed clips/*.webm are output + stay).
    try { rmSync(join(CLIPS, '_tmp'), { recursive: true, force: true }); } catch { /* */ }
  const results = tracker.toResults({
    project: PROJECT,
    mode: 'full',
    requestedJourneys: journeyIds,
    executedJourneys: journeyIds,
  });
  writeResultsFile(join(OUT, 'results.json'), results);
  writeGalleryFile(join(OUT, 'index.html'), renderGallery(results, {
    videoName,
    title: 'Forge Studio — the operator walkthrough',
    subtitle: 'Clone forge → stand up a project → compose the four pillars (flows · skills · agents · knowledge) → run a gated cycle. Grounded on a real mdtoc roadmap feature (in-place TOC injection). Recorded ' + new Date().toISOString() + '.',
  }));
  console.log(`[e2e] OK — ${OUT}/index.html (${captions.length} frames + video)`);

  if (failures.length) {
    console.error(`\n[e2e] ${failures.length} DOM-as-metrics assertion(s) FAILED:`);
    for (const f of failures) console.error(`   ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log('[e2e] all DOM-as-metrics assertions passed ✓');
  }
}

main().catch((err) => { console.error(err); cleanProjectDir(); cleanScratchFlow(); cleanStarterAgents(); cleanFirstFlow(); cleanFirstProject(); cleanFirstFlowRun(); process.exit(1); });
