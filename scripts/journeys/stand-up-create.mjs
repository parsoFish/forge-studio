import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  PROJECT, SCRATCH_FLOW, ACT, READ, THINK, caption,
  writeInstrStatus, instrEvent, instrBurst, writeInstrQuestions, writeInstrDraft,
  writePbStatus, seedStagedBrain,
} from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

// module-scope cross-beat state for this journey (was hoisted in main()). Both
// are also READ by the runner's finally-block cleanup (cleanInstructionsSession /
// cleanSeededBrain), so each is mirrored onto ctx.seeded at its assignment site.
let instrSid = null;   // instructions-creator session (Part 1)
let pbSid = null;      // project-brain-builder session (Part 1)

export const journey = defineJourney({
    id: 'stand-up-create',
    title: 'Stand up a project (create new)',
    story: 'As an operator, I create a brand-new project from Studio\'s library — the create-new path of the capability diagram. AI-assisted instructions- and project-brain-builders seed its AGENTS.md and its seeded-to-grow knowledge base, while the project builder lets me tune north star, demo timeline, and contract readiness.',
    beats: [
      {
        id: 'su-create-library',
        title: 'Library — everything is data',
        narration: 'The library renders flows, agents, projects, and knowledge bases side by side as data cards, plus an operator-pulse panel — including the very flow the operator will author from scratch later in this walkthrough.',
        drive: async (ctx) => {
              const { page, watch, check, countAtLeast } = ctx;
              // ════════════════════════════════════════════════════════════════════════
              // ACT 1 — AUTHOR. Everything in Studio is data you can edit.
              // ════════════════════════════════════════════════════════════════════════

              // ── A1.0: the library reports ready before anything else loads ────────────
              console.log('\n[A1.0] Library ready');
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
        narration: 'With the library already populated, the first-run welcome panel correctly stays hidden, and the "+ New Agent" CTA proves creating something new is one click away, not a URL only a developer would know.',
        drive: async (ctx) => {
              const { page, frame, check } = ctx;
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
        narration: 'The operator launches the instructions-creator agent, answers its two clarifying questions, and approves the AGENTS.md it drafts — a new project gets its onboarding contract written for it, with a human still signing off.',
        drive: async (ctx) => {
              const { page, watch, browser, frame, recordClip, check, countAtLeast } = ctx;
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
              ctx.seeded.instrSid = instrSid; // read by the runner's finally-block cleanup
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
        narration: 'The project-brain-builder analyses the new project and stages three seed themes for review; approving commits nothing but a pointer — the project\'s own knowledge base starts here and grows as cycles run.',
        drive: async (ctx) => {
              const { page, watch, browser, frame, recordClip, check, countAtLeast } = ctx;
              // ── AI-2: project-brain-builder seeds the project brain ───────────────────
              console.log('\n[AI-2] project-brain-builder — seed the project brain (AI-assisted)');
              pbSid = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-pbrain';
              ctx.seeded.pbSid = pbSid; // read by the runner's finally-block cleanup
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
        narration: `In the project builder for ${PROJECT}, the operator tunes north star, demo timeline, and contract readiness at a glance; adding a demo step live-flips the dirty flag, proving nothing here is a static page.`,
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
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
  });
