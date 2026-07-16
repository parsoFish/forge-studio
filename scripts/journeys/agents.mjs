import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  cleanStarterAgents, STARTER_AGENT_SLUGS, FORGE_ROOT, waitForFile, caption, ACT, THINK, OOTB_SKILL_IDS,
} from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

// ── A-scratch: compose a brand-new agent entirely from scratch ─────────────
const SCRATCH_AGENT_SLUG = 'journey-scratch-agent';
const SCRATCH_AGENT_NAME = 'Journey Scratch Agent';
const SCRATCH_AGENT_SKILL_PATH = join(FORGE_ROOT, 'skills', SCRATCH_AGENT_SLUG, 'SKILL.md');
function cleanScratchAgent() {
  try { rmSync(join(FORGE_ROOT, 'skills', SCRATCH_AGENT_SLUG), { recursive: true, force: true }); } catch { /* */ }
}

// The skill dragged into the from-scratch agent's skill zone. NOT
// `api-contract-review` (the skill skills-create authors earlier in this
// walkthrough) — CatalogPalette's chips are sourced EXCLUSIVELY from
// studio/catalog.yaml's static `community-skills` list, never a live scan of
// skills/. `POST /api/studio/skills` (the /skills/new path skills-create
// drives) writes only skills/<slug>/SKILL.md to disk — it never registers
// the new skill into catalog.yaml (ADR-027 §5: no serializer, by design). So
// a freshly-authored skill can NEVER appear as a draggable catalog chip; an
// honest UI limit, not something to fake around. `handoff` is the strongest
// substitute: a REAL catalog.yaml community-skills entry (genuinely
// draggable) that ALSO has a real skills/handoff/SKILL.md on disk.
const DND_SKILL_ID = OOTB_SKILL_IDS[0]; // 'handoff'

// ── module-local stash/restore for the REAL project-manager skill ──────────
// agents-builder's edit now SAVES (proving an OOTB agent stays genuinely
// editable, not just re-composable from a fresh starter) — so the real
// shipped bytes must be stashed first and restored after. Mirrors
// stashRealSkill/restoreRealSkill in journey-fixtures.mjs, kept LOCAL here:
// project-manager is this journey's own concern, self-contained per the
// per-journey ordering comment in index.mjs.
const PM_SKILL_PATH = join(FORGE_ROOT, 'skills', 'project-manager', 'SKILL.md');
let pmSkillStash = null;
function stashPmSkill() {
  if (pmSkillStash === null) pmSkillStash = readFileSync(PM_SKILL_PATH, 'utf8');
  return pmSkillStash;
}
function restorePmSkill() {
  if (pmSkillStash === null) return;
  try { writeFileSync(PM_SKILL_PATH, pmSkillStash); } catch { /* best-effort */ }
}

// ── HTML5 DataTransfer DnD helper (agent-builder catalog → skill drop zone) ─
// Mirrors CatalogPalette.handleDragStart (sets text/plain=item.id +
// application/x-forge-kind=kind) → DropZone's onDrop (reads text/plain,
// falling back to the x-forge-kind header for ids like "handoff" that carry
// no sk-/skill- prefix).
async function dragSkillChipIntoZone(page, skillId) {
  const chip = page.locator(`.catalog-chip[data-id="${skillId}"][data-kind="skill"]`);
  const zone = page.locator('[data-accepts="skill"]');
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await chip.dispatchEvent('dragstart', { dataTransfer });
  await zone.dispatchEvent('dragover', { dataTransfer });
  await zone.dispatchEvent('drop', { dataTransfer });
  await chip.dispatchEvent('dragend', { dataTransfer });
}

export const journey = defineJourney({
    id: 'agents',
    title: 'Compose an agent',
    story: 'As an operator, I compose the three OOTB plan/dev/review agents from forge\'s curated starter library, build a brand-new agent entirely from scratch (blank slate, a dropped skill, a picked runtime), then reopen an existing agent to prove its composition — skills, tools, runtime, budgets — is editable, not fixed once built.',
    beats: [
      {
        id: 'agents-starters',
        title: 'Author plan/dev/review agents from the starter library',
        narration: 'The operator picks each of the three curated starters in turn — required fields pre-filled, advanced config collapsed — and saves each straight to a SKILL.md that then passes forge\'s own `studio lint` gate: the agents pillar\'s OOTB library, tuned through forge\'s own development, made concrete.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
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
        id: 'agents-scratch-build',
        title: 'Compose a brand-new agent from scratch (blank + skill drop + runtime picker)',
        narration: 'Starting from the picker\'s genuine "blank" option — not a curated starter — the operator names the agent, writes its purpose and process from nothing, drags a real catalog skill into the skill zone by HTML5 drag-and-drop, then drives the runtime-adapter seam: claude selectable, codex/gemini visibly disabled, a range strategy picking multiple Claude tiers. Saving actually persists this one — SKILL.md lands with the picked range strategy baked in, and `studio lint` validates it.',
        drive: async (ctx) => {
              const { page, watch, browser, frame, recordClip, check } = ctx;
              // ── A-scratch: COMPOSE A BRAND-NEW AGENT FROM SCRATCH ─────────────────────
              console.log('\n[A-scratch] Compose a brand-new agent from scratch');
              cleanScratchAgent();

              await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              const blankPresent = await page.evaluate(() => document.querySelector('[data-starter-option="blank"]') !== null);
              check(blankPresent, 'A-scratch: the starter picker offers a genuine "blank" option ([data-starter-option="blank"])');
              await page.locator('[data-starter-option="blank"]').click();
              await page.waitForSelector('#purpose-input', { timeout: 10000 });

              // Compose from nothing: name, purpose, process.
              await page.locator('input.agent-name-input').fill(SCRATCH_AGENT_NAME);
              await page.locator('#purpose-input').fill(
                'Review a proposed API contract change for breaking-change risk before it merges.');
              await page.locator('#process-input').fill(
                'Read the diff against the last published contract. Flag any removed field, renamed ' +
                'endpoint, or narrowed type as a breaking change. Write findings as PR review comments; ' +
                'never silently approve a breaking change.');
              await sleep(THINK);
              await frame(page, 'a-scratch-0-composed', 'A-scratch — a brand-new agent, composed from blank: name, purpose, process');

              // Skill drop — open Advanced (progressive disclosure) to reach the zones.
              await page.locator('[data-action="toggle-advanced"]').first().click().catch(() => {});
              await page.waitForFunction(
                () => document.querySelector('[data-section="advanced"]')?.getAttribute('data-advanced-open') === 'true',
                null, { timeout: 5000 },
              ).catch(() => {});
              const chipPresent = await page.evaluate((id) =>
                document.querySelector(`.catalog-chip[data-id="${id}"][data-kind="skill"]`) !== null, DND_SKILL_ID);
              check(chipPresent, `A-scratch: "${DND_SKILL_ID}" is a real, draggable catalog chip (studio/catalog.yaml community-skills)`);
              await dragSkillChipIntoZone(page, DND_SKILL_ID);
              const zoneCount = await page.evaluate(() =>
                document.querySelector('[data-accepts="skill"]')?.getAttribute('data-count') ?? '0');
              check(zoneCount === '1', `A-scratch: dragging "${DND_SKILL_ID}" into the skill drop zone lands it (data-count="${zoneCount}")`);
              await frame(page, 'a-scratch-1-skill-dropped', `A-scratch — "${DND_SKILL_ID}" dragged from the catalog into the skill zone (HTML5 DnD)`);

              // ── Runtime-adapter seam (ported from the retired standalone runtime-adapter journey) ──
              const claudeCardAvailable = await page.evaluate(() => {
                const card = document.querySelector('[data-sdk-id="claude"]');
                return card !== null && !card.classList.contains('disabled');
              });
              check(claudeCardAvailable, 'A-scratch: [data-sdk-id="claude"] selectable (adapter registered)');
              const codexDisabled = await page.evaluate(() => {
                const card = document.querySelector('[data-sdk-id="codex"]');
                return card !== null && card.classList.contains('disabled');
              });
              check(codexDisabled, 'A-scratch: [data-sdk-id="codex"] disabled (adapter not registered)');
              const geminiDisabled = await page.evaluate(() => {
                const card = document.querySelector('[data-sdk-id="gemini"]');
                return card !== null && card.classList.contains('disabled');
              });
              check(geminiDisabled, 'A-scratch: [data-sdk-id="gemini"] disabled (adapter not registered)');
              await frame(page, 'a-scratch-2-sdk-picker', 'A-scratch — adapter seam: claude selectable; codex/gemini disabled (registry-driven)');

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
                  check(true, 'A-scratch: range segment flips [data-component="runtime-picker"][data-strategy="range"]');
                } catch {
                  const strat = await page.evaluate(() =>
                    document.querySelector('[data-component="runtime-picker"]')?.getAttribute('data-strategy') ?? '(absent)');
                  check(false, `A-scratch: data-strategy flipped to range (got "${strat}")`);
                }
              } else {
                check(false, 'A-scratch: [data-strategy="range"] toggle present in RuntimePicker');
              }
              let selectedCount = 0;
              if (rangeTogglePresent) {
                const captionEl = await page.evaluate(() => {
                  const el = document.querySelector('#strategy-caption');
                  return el ? el.textContent?.trim() : null;
                });
                check(captionEl !== null && captionEl.length > 5, `A-scratch: range strategy caption rendered ("${captionEl ?? '(absent)'}")`);
                const modelChips = page.locator('[data-component="runtime-picker"] [data-model-id]');
                const chipCount = await modelChips.count();
                check(chipCount >= 1, `A-scratch: ≥1 [data-model-id] chip rendered in range mode (got ${chipCount})`);
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
                    check(count >= selectedCount, `A-scratch: data-model-count ≥${selectedCount} after selecting ${selectedCount} chip(s) (got ${count})`);
                  } catch {
                    const gotCount = await page.evaluate(() =>
                      document.querySelector('[data-component="runtime-picker"]')?.getAttribute('data-model-count') ?? '(absent)');
                    check(false, `A-scratch: data-model-count ≥${selectedCount} in range mode (got "${gotCount}")`);
                  }
                }
                await frame(page, 'a-scratch-3-range-chips', `A-scratch — range mode: ${selectedCount} Claude tier chip(s) selected; routes to the cheapest capable tier first`);
              }
              const yamlPreviewText = await page.evaluate(() => {
                const preview = document.querySelector('[data-component="yaml-preview"]');
                if (preview) return preview.textContent ?? '';
                const pres = [...document.querySelectorAll('pre')];
                return pres.find((el) => el.textContent?.includes('strategy'))?.textContent ?? '';
              });
              check(yamlPreviewText.includes('strategy: range'),
                `A-scratch: YAML preview contains "strategy: range" (got: "${yamlPreviewText.slice(0, 100).replace(/\n/g, '\\n')}")`);
              await frame(page, 'a-scratch-4-yaml-range', 'A-scratch — YAML preview shows strategy: range live, before save');

              // Save — this from-scratch agent actually PERSISTS: SKILL.md lands with
              // the range strategy baked in, and `forge studio lint` validates it.
              await page.locator('[data-action="save-agent"]').click();
              const landed = await waitForFile(SCRATCH_AGENT_SKILL_PATH, 12000);
              check(landed, `A-scratch: saving writes skills/${SCRATCH_AGENT_SLUG}/SKILL.md`);
              const savedText = landed ? readFileSync(SCRATCH_AGENT_SKILL_PATH, 'utf8') : '';
              check(savedText.includes('strategy: range'), 'A-scratch: the saved SKILL.md persists the range strategy chosen in the picker');

              let scratchLintOk = false;
              try {
                execFileSync(process.execPath,
                  ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', 'lint'],
                  { cwd: FORGE_ROOT, stdio: 'pipe' });
                scratchLintOk = true;
              } catch (e) {
                console.error(`  [studio lint A-scratch] non-zero: ${(e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')}`.slice(0, 600));
              }
              check(scratchLintOk, 'A-scratch: `forge studio lint` validates the from-scratch agent (exit 0)');
              await frame(page, 'a-scratch-5-saved', 'A-scratch — from-scratch agent saved: SKILL.md on disk, lint-green');

              // Clip: the whole from-scratch arc — blank → compose → drop a skill →
              // pick a range runtime. Does not save (fresh ephemeral context; avoids a
              // second write to the same slug) — the "money clip" for building an
              // agent as data, from nothing.
              await recordClip(browser, watch, 'agent-scratch-build', '/agents/new', async (p) => {
                // Bounded waits: every missed selector here records dead animated
                // frames (this clip once ballooned to 4.8M on timeout accumulation).
                await p.waitForSelector('[data-starter-option="blank"]', { timeout: 6000 }).catch(() => {});
                await p.locator('[data-starter-option="blank"]').click().catch(() => {});
                await p.waitForSelector('#purpose-input', { timeout: 5000 }).catch(() => {});
                await p.locator('input.agent-name-input').fill(`${SCRATCH_AGENT_NAME} (clip)`).catch(() => {});
                await p.locator('#purpose-input').fill(
                  'Review a proposed API contract change for breaking-change risk before it merges.').catch(() => {});
                await sleep(600);
                await p.locator('[data-action="toggle-advanced"]').first().click().catch(() => {});
                await p.waitForFunction(
                  () => document.querySelector('[data-section="advanced"]')?.getAttribute('data-advanced-open') === 'true',
                  null, { timeout: 3000 },
                ).catch(() => {});
                const dt = await p.evaluateHandle(() => new DataTransfer());
                const chip = p.locator(`.catalog-chip[data-id="${DND_SKILL_ID}"][data-kind="skill"]`);
                const zone = p.locator('[data-accepts="skill"]');
                await chip.dispatchEvent('dragstart', { dataTransfer: dt }).catch(() => {});
                await zone.dispatchEvent('dragover', { dataTransfer: dt }).catch(() => {});
                await zone.dispatchEvent('drop', { dataTransfer: dt }).catch(() => {});
                await sleep(THINK);
                const rangeToggle = p.locator('[data-component="runtime-picker"] [data-strategy="range"]');
                if (await rangeToggle.count() > 0) { await rangeToggle.click().catch(() => {}); await sleep(THINK); }
                const modelChips = p.locator('[data-component="runtime-picker"] [data-model-id]');
                if (await modelChips.count() > 0) { await modelChips.first().click().catch(() => {}); await sleep(500); }
              }, { readySel: '[data-page="agents"]', caption: 'Composing an agent from scratch — blank, a dropped skill, a picked runtime', holdTailMs: 1200, size: { width: 960, height: 600 }, freezeAnimations: true });

              // Cleanup: this beat's own skill dir only (self-contained, mirrors
              // skills-edit / skills-agentic-author cleaning their own artifacts).
              // Never touches api-contract-review — that throughline artifact is
              // swept centrally by the runner's cleanSkillArtifacts().
              cleanScratchAgent();

        },
      },
      {
        id: 'agents-builder',
        title: 'Agent builder — /agents/project-manager',
        narration: 'Reopening the shipped project-manager agent, the operator expands Advanced to see its skill/tool/MCP/hook drop zones and runtime SDK, edits its purpose field, and SAVES — proof an OOTB agent stays genuinely editable after the fact, not just re-composable from a fresh starter. (The real shipped bytes are stashed first and restored after, so the walkthrough never leaves project-manager\'s production SKILL.md mutated.)',
        drive: async (ctx) => {
              const { page, watch, browser, frame, recordClip, check, countAtLeast } = ctx;
              // ── A3: Agent builder — an agent is data ──────────────────────────────────
              console.log('\n[A3] Agent builder — /agents/project-manager');
              stashPmSkill();
              try {
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
                  // Dirty-flag → SAVE (not discard): edit the purpose field, save, and
                  // prove the edit round-trips onto the REAL SKILL.md on disk.
                  // #process-input, not #purpose-input: process-field edits provably
                  // round-trip to disk (the skills-edit beat relies on it); the purpose
                  // field's edit never survived serialization on save.
                  const purposeInput = page.locator('#process-input');
                  if ((await purposeInput.count()) > 0) {
                    await purposeInput.click();
                    await purposeInput.pressSequentially(' (e2e test edit)', { delay: 18 });
                    await sleep(THINK);
                    const dirtyVal = await page.evaluate(() => document.querySelector('[data-dirty]')?.getAttribute('data-dirty') ?? '');
                    check(dirtyVal === 'true', `agent-builder: data-dirty="true" after editing purpose field (got "${dirtyVal}")`);
                    await page.locator('[data-action="save-agent"]').click();
                    await page.waitForFunction(
                      () => document.querySelector('[data-dirty]')?.getAttribute('data-dirty') === 'false',
                      null, { timeout: 10000 },
                    ).catch(() => {});
                    const dirtyAfterSave = await page.evaluate(() => document.querySelector('[data-dirty]')?.getAttribute('data-dirty') ?? '');
                    check(dirtyAfterSave === 'false', `agent-builder: data-dirty="false" after saving the edit (got "${dirtyAfterSave}")`);
                    // The dirty flag flips before the fs write settles — poll the file.
                    let savedOnDisk = false;
                    for (let t = 0; t < 20 && !savedOnDisk; t += 1) {
                      savedOnDisk = readFileSync(PM_SKILL_PATH, 'utf8').includes('(e2e test edit)');
                      if (!savedOnDisk) await sleep(250);
                    }
                    check(savedOnDisk, 'agent-builder: the edited purpose lands in the real skills/project-manager/SKILL.md on disk');
                    await frame(page, 'a3-1-agent-saved', 'A3 — data-dirty flips on edit; SAVE persists it to the real SKILL.md (restored after)');
                  } else {
                    check(false, 'agent-builder: #purpose-input present to test the edit→save round-trip');
                  }
                } else {
                  check(false, 'agent-builder: page did not become ready — agent-builder checks skipped');
                }
                // Clip: composing an agent — open Advanced, edit the purpose field
                // (dirty), and SAVE. Fresh context, own navigation.
                await recordClip(browser, watch, 'agent-build', '/agents/project-manager', async (p) => {
                  await p.waitForSelector('[data-action="toggle-advanced"]', { timeout: 12000 }).catch(() => {});
                  await p.locator('[data-action="toggle-advanced"]').first().click().catch(() => {});
                  await p.waitForFunction(
                    () => document.querySelector('[data-section="advanced"]')?.getAttribute('data-advanced-open') === 'true',
                    null, { timeout: 5000 },
                  ).catch(() => {});
                  const clipPurposeInput = p.locator('#purpose-input');
                  if (await clipPurposeInput.count() > 0) {
                    await clipPurposeInput.click().catch(() => {});
                    // fill() = one repaint (keystroke typing recorded ~140K of extra frames)
                    const current = await clipPurposeInput.inputValue().catch(() => '');
                    await clipPurposeInput.fill(`${current} (clip)`).catch(() => {});
                    await sleep(THINK);
                    await p.locator('[data-action="save-agent"]').click().catch(() => {});
                    await p.waitForFunction(
                      () => document.querySelector('[data-dirty]')?.getAttribute('data-dirty') === 'false',
                      null, { timeout: 8000 },
                    ).catch(() => {});
                    await sleep(800);
                  }
                }, { readySel: '[data-page="agents"]', caption: 'Composing an agent from the starter library — edit and SAVE', holdTailMs: 1500 });
              } finally {
                // Crash-safe + clip-safe: the clip above also writes to this SAME real
                // file (its own ephemeral context, same on-disk path) — restore covers both.
                restorePmSkill();
              }

        },
      },
    ],
  });
