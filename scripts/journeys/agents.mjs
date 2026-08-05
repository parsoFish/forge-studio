import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  cleanStarterAgents, STARTER_AGENT_SLUGS, FORGE_ROOT, waitForFile, caption, ACT, THINK, READ, SK_NEW_SLUG,
} from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';

// ── A-scratch: compose a brand-new agent entirely from scratch ─────────────
const SCRATCH_AGENT_SLUG = 'journey-scratch-agent';
const SCRATCH_AGENT_NAME = 'Journey Scratch Agent';
const SCRATCH_AGENT_SKILL_PATH = join(FORGE_ROOT, 'skills', SCRATCH_AGENT_SLUG, 'SKILL.md');
function cleanScratchAgent() {
  try { rmSync(join(FORGE_ROOT, 'skills', SCRATCH_AGENT_SLUG), { recursive: true, force: true }); } catch { /* */ }
}

// The skill dragged into the from-scratch agent's skill zone: `api-contract-review`
// (SK_NEW_SLUG), the plain SKILL.md (no `runtime` block) that this walkthrough's
// earlier skills-create beat (SK-3) authored via `/skills/new`. Before R3-01-F2,
// CatalogPalette's chips were sourced EXCLUSIVELY from studio/catalog.yaml's
// static `communitySkills` list, so a freshly-authored skill could never appear
// as a draggable chip and this beat substituted a curated OOTB skill (`handoff`)
// instead, narrating the limitation. `GET /api/studio/catalog` now unions in a
// live filesystem scan of plain skills (orchestrator/studio/registry.ts
// listPlainSkills), so the real skill authored by skills-create is itself a
// palette chip with no bridge restart — demoing the full "create a skill →
// compose it into an agent" throughline for real, not a substitute.
const DND_SKILL_ID = SK_NEW_SLUG; // 'api-contract-review'

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

// ── module-local stash/restore for the REAL developer-ralph agent (R2-09) ──
// The edit-agent arc (agents-edit-* beats below) edits the ONE shipped agent
// that carries BOTH a 7-line `#` YAML comment block (lines 17-24) AND a
// `fanout:` block — the only fixture that can prove the byte-faithful save
// path (skill-md-fidelity.ts D5/D6) and the fanout-survives-a-full-reserialize
// claim against the SAME real file. Mirrors stashPmSkill/restorePmSkill
// above, but the restore is ALSO exported so scripts/e2e-journey.mjs's own
// top-level finally can call it as a crash-safe backstop — mirroring
// community.mjs's cleanCommunityArtifacts precedent (see index.mjs's own
// header comment: a sweep that lives several beats after the mutation needs
// its own backstop, not just the closing beat's happy path). The edit-agent
// arc spans FIVE separate beats that touch the file (catalog-click-add
// through byte-faithful), not one drive() call like agents-builder, so a
// throw in any one of them must not leave developer-ralph's real shipped
// bytes mutated — RUN_ORDER has no per-beat try/catch (scripts/e2e-journey.mjs
// runs `for (const [jid,bid] of RUN_ORDER) await beat.drive(ctx)` inside ONE
// outer try/finally), so an uncaught throw in any beat aborts straight to
// that top-level finally.
const DR_SKILL_PATH = join(FORGE_ROOT, 'skills', 'developer-ralph', 'SKILL.md');
let drSkillStash = null;
function stashDrSkill() {
  if (drSkillStash === null) drSkillStash = readFileSync(DR_SKILL_PATH, 'utf8');
  return drSkillStash;
}
export function restoreDeveloperRalphSkill() {
  if (drSkillStash === null) return;
  try { writeFileSync(DR_SKILL_PATH, drSkillStash); } catch { /* best-effort */ }
}

/** Ensure the builder's collapsed Advanced section is open — checks state
 *  before clicking so it never accidentally re-collapses an already-open
 *  section (a navigation/reload always starts it collapsed again). */
async function ensureAdvancedOpen(page) {
  const isOpen = await page.evaluate(() =>
    document.querySelector('[data-section="advanced"]')?.getAttribute('data-advanced-open') === 'true');
  if (isOpen) return;
  await page.locator('[data-action="toggle-advanced"]').first().click().catch(() => {});
  await page.waitForFunction(
    () => document.querySelector('[data-section="advanced"]')?.getAttribute('data-advanced-open') === 'true',
    null, { timeout: 5000 },
  ).catch(() => {});
}

/** Split SKILL.md text into { frontmatter, body } at the closing `---`
 *  delimiter line. Used only to compare the frontmatter region independently
 *  of the (deliberately edited) body in agents-edit-byte-faithful — since
 *  both texts being compared share an identical byte prefix up to at least
 *  this point (the byte-preserving fast path never touches anything before
 *  the appended body), the exact split offset doesn't need to match
 *  gray-matter's own `bodyStart` precisely; it only needs to fall inside
 *  that shared, untouched prefix, which the closing `---` delimiter always
 *  does. */
function splitFrontmatter(text) {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text);
  if (!m) return { frontmatter: '', body: text };
  return { frontmatter: m[0], body: text.slice(m[0].length) };
}

// The scratch agent agents-materials-declare creates and destroys itself
// (self-contained, mirrors agents-scratch-build/hooks-security's own
// create-and-destroy-its-own-throwaway-fixture precedent) — a fresh blank
// agent rather than reusing developer-ralph, so the materials round-trip
// never adds a third concurrent mutation onto the byte-fidelity fixture.
const MATERIALS_AGENT_SLUG = 'journey-materials-agent';
const MATERIALS_AGENT_NAME = 'Journey Materials Agent';
const MATERIALS_AGENT_SKILL_PATH = join(FORGE_ROOT, 'skills', MATERIALS_AGENT_SLUG, 'SKILL.md');
function cleanMaterialsAgent() {
  try { rmSync(join(FORGE_ROOT, 'skills', MATERIALS_AGENT_SLUG), { recursive: true, force: true }); } catch { /* */ }
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
                document.querySelector(`[data-component="catalog-palette"] .catalog-chip[data-id="${id}"][data-kind="skill"]`) !== null,
                DND_SKILL_ID);
              check(chipPresent, `A-scratch: "${DND_SKILL_ID}" (skills-create's own skill) is a real, draggable catalog chip — live filesystem discovery (R3-01-F2)`);
              await dragSkillChipIntoZone(page, DND_SKILL_ID);
              const zoneCount = await page.evaluate(() =>
                document.querySelector('[data-accepts="skill"]')?.getAttribute('data-count') ?? '0');
              check(zoneCount === '1', `A-scratch: dragging "${DND_SKILL_ID}" into the skill drop zone lands it (data-count="${zoneCount}")`);
              await frame(page, 'a-scratch-1-skill-dropped', `A-scratch — "${DND_SKILL_ID}" (the skill created earlier in this walkthrough) dragged from the catalog into the skill zone (HTML5 DnD)`);

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
                await caption(p, 'Curated starters, or blank — composing an agent from nothing.');
                await sleep(THINK);
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
                await caption(p, `Dragging a real catalog skill ("${DND_SKILL_ID}") into the skill zone.`);
                await sleep(THINK);
                const dt = await p.evaluateHandle(() => new DataTransfer());
                const chip = p.locator(`.catalog-chip[data-id="${DND_SKILL_ID}"][data-kind="skill"]`);
                const zone = p.locator('[data-accepts="skill"]');
                await chip.dispatchEvent('dragstart', { dataTransfer: dt }).catch(() => {});
                await zone.dispatchEvent('dragover', { dataTransfer: dt }).catch(() => {});
                await zone.dispatchEvent('drop', { dataTransfer: dt }).catch(() => {});
                await sleep(THINK);
                const rangeToggle = p.locator('[data-component="runtime-picker"] [data-strategy="range"]');
                if (await rangeToggle.count() > 0) {
                  await rangeToggle.click().catch(() => {});
                  await sleep(THINK);
                  await caption(p, 'The range strategy: pick multiple Claude tiers — it routes to the cheapest capable one first.');
                  await sleep(READ);
                }
                const modelChips = p.locator('[data-component="runtime-picker"] [data-model-id]');
                if (await modelChips.count() > 0) {
                  await modelChips.first().click().catch(() => {});
                  await sleep(500);
                }
              }, { readySel: '[data-page="agents"]', caption: 'Composing an agent from scratch — blank, a dropped skill, a picked runtime', holdTailMs: 1200, freezeAnimations: true });

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
        narration: 'Reopening the shipped project-manager agent, the operator expands Advanced to see its skill/tool/MCP/guard/hook drop zones and runtime SDK, edits its purpose field, and SAVES — proof an OOTB agent stays genuinely editable after the fact, not just re-composable from a fresh starter. Since R4-01 the plan agent is a MIGRATED artifact: its flow dispatch is declared data (the wi-contract GUARD — renamed from "hook" by the R3-03 amendment to ADR-027, so the word "hook" is free for user-authorable agent-lifecycle customisations — a one-shot loop strategy, budget caps in frontmatter — ADR-039), and the save round-trip provably preserves all of it, so editing in the builder can never silently break dispatch. The readiness panel\'s 6 checks (including runtime) are sourced from the server-computed capability descriptor, not a client guess, and an informational chip shows whether the agent is interactive or unattended straight from that same descriptor. Because it is unattended, the agent also carries a generic run surface (R2-01-F3): it dispatches standalone straight from the agent page — no flow required — the runnable primitive reaching the UI. The same surface makes the develop flow\'s two successor agents runnable in isolation (R4-10-F3): demo-agent and adversarial-review dispatch standalone through their FLOW pipeline (not a bare spawn), yielding the identical artifacts — the ship-both principle, valuable alone as well as in a flow. (The real shipped bytes are stashed first and restored after, so the walkthrough never leaves project-manager\'s production SKILL.md mutated.)',
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
                  for (const kind of ['skill', 'tool', 'mcp', 'guard', 'hook']) {
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
                    // R2-02-F4: 6 checks total (purpose/skill/guard/process/interactivity
                    // content-completeness + a `runtime` check now sourced from the
                    // server-computed F1 capability descriptor, not a client heuristic).
                    // project-manager's shipped SKILL.md fills every field and carries a
                    // `runtime.sdk: claude`, so its descriptor's runtimeSdks is non-empty
                    // — all 6 pass.
                    check(parseInt(readyCount, 10) === 6, `agent-builder: all 6 readiness checks pass for project-manager (got ${readyCount})`);
                  }
                  const sdk = await page.evaluate(() => document.querySelector('[data-sdk]')?.getAttribute('data-sdk') ?? '');
                  check(sdk.length > 0, `agent-builder: [data-sdk] attribute present (got "${sdk}")`);
                  // R2-02-F4: the informational interactive chip visibly reflects the
                  // F1 capability descriptor (never a pass/fail readiness gate) —
                  // project-manager is `surface: unattended`, so it reads "false".
                  const capabilityInteractive = await page.evaluate(() =>
                    document.querySelector('[data-capability-interactive]')?.getAttribute('data-capability-interactive') ?? null);
                  check(
                    capabilityInteractive === 'false',
                    `agent-builder: [data-capability-interactive] reflects the descriptor's interactive fact — project-manager is unattended (got "${capabilityInteractive}")`,
                  );
                  await frame(page, 'a3-0-agent-builder', 'A3 — agent builder: catalog, drop zones, runtime, readiness panel');
                  // R2-01-F3: a saved non-interactive agent gets the generic run
                  // surface (interactive agents keep their bespoke session page).
                  // project-manager is unattended + already on disk, so it's
                  // dispatchable straight from the agent page.
                  const runDispatchable = await page.evaluate(() =>
                    document.querySelector('[data-section="agent-run"]')?.getAttribute('data-run-dispatchable') ?? null);
                  check(runDispatchable === 'true',
                    `agent-builder (R2-01-F3): the saved unattended agent shows a dispatchable run surface (got "${runDispatchable}")`);
                  // R4-02-F1: the generic key:value inputs surface (the onboarding
                  // agent's repo/northStar ride through it). Assert it's present +
                  // type a line so the inputs surface is inside the regression gate.
                  const inputsPresent = await page.evaluate(() =>
                    document.querySelector('[data-section="agent-run"] [data-run-inputs]') !== null);
                  check(inputsPresent, 'agent-builder (R4-02-F1): the run surface exposes a generic [data-run-inputs] field');
                  await page.locator('[data-section="agent-run"] [data-run-inputs]').fill('note: journey-e2e').catch(() => {});
                  // Drive the dispatch entry point. Under the demo's no-spawn seam the
                  // bridge returns a runId + skip marker — the agent turn itself is
                  // stubbed — which is exactly enough to prove the agent page reaches
                  // the generic runner (R4-02-F1's "both entry points reach the same
                  // runner"). The real agent run only happens off the no-spawn seam.
                  await page.locator('[data-action="run-agent"]').click().catch(() => {});
                  let genRunId = '';
                  try {
                    await page.waitForFunction(
                      () => (document.querySelector('[data-section="agent-run"]')?.getAttribute('data-run-id') ?? '').length > 0,
                      null, { timeout: 8000 },
                    );
                    genRunId = await page.evaluate(() =>
                      document.querySelector('[data-section="agent-run"]')?.getAttribute('data-run-id') ?? '');
                  } catch { /* dispatch did not surface a runId in time */ }
                  check(genRunId.length > 0,
                    `agent-builder (R2-01-F3): clicking Run dispatches through the generic host — a runId is returned (got "${genRunId}")`);
                  await frame(page, 'a3-0b-agent-run', 'A3 — a saved unattended agent runs standalone from the agent page (R2-01-F3 generic run host; turn stubbed under the demo no-spawn seam)');
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
                    // R4-01-F3 round-trip proof: project-manager is a MIGRATED agent
                    // (ADR-039 declared dispatch — no executor row). The builder save
                    // must preserve the declared dispatch data verbatim, else a UI
                    // edit would silently break flow dispatch.
                    if (savedOnDisk) {
                      const savedPm = readFileSync(PM_SKILL_PATH, 'utf8');
                      check(savedPm.includes('wi-contract'),
                        'agent-builder (R4-01-F3): the save preserves the declared wi-contract dispatch guard');
                      check(savedPm.includes('loopStrategy: one-shot'),
                        'agent-builder (R4-01-F3): the save preserves runtime.loopStrategy: one-shot');
                      check(savedPm.includes('maxTurns: 70') && savedPm.includes('maxBudgetUsdShare: 0.2'),
                        'agent-builder (R4-01-F3): the save preserves the declared budget caps (maxTurns/maxBudgetUsdShare)');
                      check(!savedPm.includes('executor:'),
                        'agent-builder (R4-01-F3): no retired executor row reappears on save');
                    }
                    await frame(page, 'a3-1-agent-saved', 'A3 — data-dirty flips on edit; SAVE persists it to the real SKILL.md (restored after)');
                  } else {
                    check(false, 'agent-builder: #purpose-input present to test the edit→save round-trip');
                  }
                } else {
                  check(false, 'agent-builder: page did not become ready — agent-builder checks skipped');
                }
                // R4-10-F3 isolation parity: the two BANDED develop-flow node agents
                // (demo-agent / adversarial-review) are ALSO standalone-runnable — the
                // ship-both principle. Their run surface routes to the FLOW pipeline
                // (band-agent-run.ts, `--input initiative=<id>`), not the bare spawn, so a
                // standalone run yields the identical artifacts a flow run does.
                await caption(page, 'The develop flow\'s successor agents ship both ways — demo-agent + adversarial-review run standalone from their own pages, the same pipeline, in isolation.');
                for (const bandSlug of ['demo-agent', 'adversarial-review']) {
                  await page.goto(watch.uiUrl + `/agents/${bandSlug}`, { waitUntil: 'domcontentloaded' });
                  await page.waitForFunction(
                    () => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true',
                    null, { timeout: 20000 },
                  ).catch(() => {});
                  const dispatchable = await page.evaluate(() =>
                    document.querySelector('[data-section="agent-run"]')?.getAttribute('data-run-dispatchable') ?? null);
                  check(dispatchable === 'true',
                    `agents (R4-10-F3): ${bandSlug} is standalone-runnable from its agent page (data-run-dispatchable="${dispatchable}")`);
                  const bandInputs = await page.evaluate(() =>
                    document.querySelector('[data-section="agent-run"] [data-run-inputs]') !== null);
                  check(bandInputs,
                    `agents (R4-10-F3): ${bandSlug} run surface exposes [data-run-inputs] (initiative:<id> rides through to the pipeline)`);
                }
                await sleep(READ);
                // Clip: composing an agent — open Advanced, edit the purpose field
                // (dirty), and SAVE. Fresh context, own navigation.
                await recordClip(browser, watch, 'agent-build', '/', async (p) => {
                  // Entry point: the library's agents section — a real click into
                  // /agents/project-manager, not a direct goto.
                  await p.waitForFunction(
                    () => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true',
                    null, { timeout: 8000 },
                  ).catch(() => {});
                  const agentsSection = p.locator('[data-section="agents"]');
                  await agentsSection.scrollIntoViewIfNeeded().catch(() => {});
                  await caption(p, 'The OOTB agent library — plan, dev, review, project-manager: curated, already shipped.');
                  await sleep(THINK);
                  const pmCard = p.locator('[data-card-type="agent"][data-card-id="project-manager"]');
                  await pmCard.click().catch(() => {});
                  await p.waitForSelector('[data-action="toggle-advanced"]', { timeout: 12000 }).catch(() => {});
                  await caption(p, 'Reopening project-manager — an agent is data, editable after the fact.');
                  await sleep(THINK);
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
                    await caption(p, 'SAVE persists the edit to the real SKILL.md.');
                    await p.locator('[data-action="save-agent"]').click().catch(() => {});
                    await p.waitForFunction(
                      () => document.querySelector('[data-dirty]')?.getAttribute('data-dirty') === 'false',
                      null, { timeout: 8000 },
                    ).catch(() => {});
                    await sleep(800);
                  }
                }, { readySel: '[data-page="library"]', caption: 'From the library agent card to a saved edit — project-manager, reopened and tuned', holdTailMs: 1500 });
              } finally {
                // Crash-safe + clip-safe: the clip above also writes to this SAME real
                // file (its own ephemeral context, same on-disk path) — restore covers both.
                restorePmSkill();
              }

        },
      },
      {
        id: 'agents-edit-selector-open',
        title: 'Edit-agent arc — open the builder on a real agent, via the selector',
        narration: 'The edit-agent arc walks a REAL shipped agent — developer-ralph, the only OOTB agent carrying both a hand-written 7-line YAML comment block and a fanout: capability — through catalog click-add, instructions regeneration, save, and the byte-faithful proof. The builder\'s agent selector ([data-agent-select], per-option [data-agent-option]) offers the whole fleet by structured state, not just by URL. developer-ralph\'s real shipped bytes are stashed here, before any edit, and restored at the arc\'s close — crash-safe, at the top-level finally, regardless of which beat throws.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              console.log('\n[R2-09] Edit-agent arc — open the builder on developer-ralph');
              stashDrSkill();
              await page.goto(watch.uiUrl + '/agents/developer-ralph', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 },
              ).catch(() => {});
              const agentId = await page.evaluate(() =>
                document.querySelector('[data-page="agents"]')?.getAttribute('data-agent-id') ?? '');
              check(agentId === 'developer-ralph',
                `agents-edit: opened the builder on the real developer-ralph agent (data-agent-id="${agentId}")`);
              const selectPresent = await page.evaluate(() => document.querySelector('[data-agent-select]') !== null);
              check(selectPresent, 'agents-edit: [data-agent-select] present — the builder\'s agent switcher');
              const optionCount = await page.evaluate(() => document.querySelectorAll('[data-agent-option]').length);
              check(optionCount >= 5,
                `agents-edit: the selector offers [data-agent-option] for multiple real agents (got ${optionCount})`);
              await frame(page, 'ae-0-selector-open',
                'Edit-agent — the builder opens on a real shipped agent (developer-ralph); the selector offers the whole fleet');
        },
      },
      {
        id: 'agents-edit-selector-navigate',
        title: 'Edit-agent arc — switch agents through the selector',
        narration: 'Switching agents through [data-agent-select] itself — not a direct URL edit — drives the same route + state change the operator sees clicking through the fleet, proving the selector (not just the route) is what moves the builder. Navigates forward to a second real agent and back to developer-ralph, so the arc continues on its own fixture.',
        drive: async (ctx) => {
              const { page, frame, check } = ctx;
              console.log('\n[R2-09] Edit-agent arc — switch agents through the selector');
              await page.locator('[data-agent-select]').selectOption('architect');
              await page.waitForFunction(
                () => document.querySelector('[data-page="agents"]')?.getAttribute('data-agent-id') === 'architect',
                null, { timeout: 10000 },
              ).catch(() => {});
              const urlAfterForward = page.url();
              const agentIdAfterForward = await page.evaluate(() =>
                document.querySelector('[data-page="agents"]')?.getAttribute('data-agent-id') ?? '');
              check(urlAfterForward.includes('/agents/architect'),
                `agents-edit: the selector navigated the route to /agents/architect (got "${urlAfterForward}")`);
              check(agentIdAfterForward === 'architect',
                `agents-edit: [data-agent-id] flipped to the newly-selected agent (got "${agentIdAfterForward}")`);
              await frame(page, 'ae-1-selector-switched',
                'Edit-agent — switching agents through the selector actually changes the route and the loaded agent');

              // Switch back to developer-ralph — the arc's own fixture — through the
              // SAME selector, so beats 3-7 continue against it.
              await page.locator('[data-agent-select]').selectOption('developer-ralph');
              await page.waitForFunction(
                () => document.querySelector('[data-page="agents"]')?.getAttribute('data-agent-id') === 'developer-ralph',
                null, { timeout: 10000 },
              ).catch(() => {});
              const urlBack = page.url();
              const agentIdBack = await page.evaluate(() =>
                document.querySelector('[data-page="agents"]')?.getAttribute('data-agent-id') ?? '');
              check(urlBack.includes('/agents/developer-ralph') && agentIdBack === 'developer-ralph',
                `agents-edit: the selector switches back to developer-ralph (route "${urlBack}", data-agent-id "${agentIdBack}")`);
        },
      },
      {
        id: 'agents-edit-catalog-click-add',
        title: 'Edit-agent arc — click a catalog skill chip to add it (idempotent)',
        narration: 'Catalog chips are click-to-add as well as draggable (R2-09 C2) — the SAME .catalog-chip[data-id][data-kind] element, keyboard-activatable; the drag path itself is already covered by agents-scratch-build. Clicking "brain-query" lands it in the skill zone; clicking the SAME, now-bound chip again is a no-op — an already-bound chip cannot double-bind, matching the drop zone\'s own drag guard.',
        drive: async (ctx) => {
              const { page, frame, check } = ctx;
              console.log('\n[R2-09] Edit-agent arc — click-to-add a catalog skill chip (idempotent)');
              await ensureAdvancedOpen(page);
              const chip = page.locator('.catalog-chip[data-id="brain-query"][data-kind="skill"]');
              const chipPresent = (await chip.count()) > 0;
              check(chipPresent,
                'agents-edit: "brain-query" is a real catalog chip (.catalog-chip[data-id="brain-query"][data-kind="skill"])');
              if (chipPresent) {
                await chip.click();
                await page.waitForFunction(
                  () => document.querySelector('[data-accepts="skill"]')?.getAttribute('data-count') === '1',
                  null, { timeout: 5000 },
                ).catch(() => {});
                const countAfterFirst = await page.evaluate(() =>
                  document.querySelector('[data-accepts="skill"]')?.getAttribute('data-count') ?? '(absent)');
                check(countAfterFirst === '1',
                  `agents-edit: clicking the catalog chip adds it to [data-accepts="skill"] (data-count="${countAfterFirst}")`);
                await frame(page, 'ae-2-catalog-click-add',
                  'Edit-agent — click-to-add: "brain-query" lands in the skill zone from a click, not a drag');

                // Idempotence: clicking the SAME (now-used) chip again must not double-bind.
                await chip.click().catch(() => {});
                await sleep(THINK);
                const countAfterSecond = await page.evaluate(() =>
                  document.querySelector('[data-accepts="skill"]')?.getAttribute('data-count') ?? '(absent)');
                check(countAfterSecond === '1',
                  `agents-edit: clicking the already-bound chip again does not double-bind (data-count still "${countAfterSecond}")`);
              }
        },
      },
      {
        id: 'agents-edit-dirty',
        title: 'Edit-agent arc — the add marks the form dirty',
        narration: 'Binding a catalog chip is a live, in-memory edit — nothing hits disk until Save, the same "never auto-saved" discipline the instructions-draft assist honours next.',
        drive: async (ctx) => {
              const { page, check } = ctx;
              console.log('\n[R2-09] Edit-agent arc — dirty after the catalog add');
              const dirty = await page.evaluate(() => document.querySelector('[data-dirty]')?.getAttribute('data-dirty') ?? '');
              check(dirty === 'true', `agents-edit: [data-dirty="true"] after the catalog click-add (got "${dirty}")`);
        },
      },
      {
        id: 'agents-edit-regenerate-instructions',
        title: 'Edit-agent arc — regenerate instructions from the updated spec (never auto-saved)',
        narration: 'The Generate draft assist (R2-09 C3/D8) composes a deterministic charter from the CURRENT, possibly-unsaved builder state and fills the textarea — marking the form dirty and flagging [data-instructions-draft="true"] — but writes nothing to disk (D9). The single most important assertion in this arc: developer-ralph\'s real SKILL.md is still byte-identical to its stashed original at this exact moment, mid-edit, unsaved.',
        drive: async (ctx) => {
              const { page, frame, check } = ctx;
              console.log('\n[R2-09] Edit-agent arc — regenerate instructions (draft, unsaved)');
              const beforeText = await page.locator('#process-input').inputValue().catch(() => '');
              await page.locator('[data-action="generate-instructions"]').click();
              await page.waitForFunction(
                () => document.querySelector('[data-section="instructions"]')?.getAttribute('data-instructions-draft') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              const isDraft = await page.evaluate(() =>
                document.querySelector('[data-section="instructions"]')?.getAttribute('data-instructions-draft') ?? '');
              check(isDraft === 'true', `agents-edit: [data-instructions-draft="true"] after Generate draft (got "${isDraft}")`);
              const afterText = await page.locator('#process-input').inputValue().catch(() => '');
              check(afterText.length > 0, 'agents-edit: the generated draft is non-empty');
              check(afterText !== beforeText, 'agents-edit: the generated draft CHANGED the textarea content');
              await frame(page, 'ae-3-instructions-draft',
                'Edit-agent — Generate draft fills the textarea and flags data-instructions-draft="true"');

              // D9: the single most important assertion in this arc — the draft is
              // NEVER auto-saved. developer-ralph's real SKILL.md must still be
              // byte-identical to its stashed original at this exact moment.
              const onDiskNow = readFileSync(DR_SKILL_PATH, 'utf8');
              check(onDiskNow === drSkillStash,
                'agents-edit: the real skills/developer-ralph/SKILL.md is still byte-unchanged on disk — the draft was never auto-saved');
        },
      },
      {
        id: 'agents-edit-save',
        title: 'Edit-agent arc — Save persists the bound skill + the drafted instructions',
        narration: 'Save writes the compound edit (the newly bound skill AND the drafted instructions) to the real skills/developer-ralph/SKILL.md. Since composition.skills genuinely changed, this save takes skill-md-fidelity.ts\'s full re-serialize path, not the byte-preserving fast path — the fanout: block is asserted PRESENT (not dropped), but this is not yet the byte-faithful proof itself; that is the next, closing beat, which isolates a body-only edit against a clean baseline.',
        drive: async (ctx) => {
              const { page, frame, check } = ctx;
              console.log('\n[R2-09] Edit-agent arc — Save');
              await page.locator('[data-action="save-agent"]').click();
              await page.waitForFunction(
                () => document.querySelector('[data-dirty]')?.getAttribute('data-dirty') === 'false',
                null, { timeout: 10000 },
              ).catch(() => {});
              const dirtyAfterSave = await page.evaluate(() => document.querySelector('[data-dirty]')?.getAttribute('data-dirty') ?? '');
              check(dirtyAfterSave === 'false', `agents-edit: [data-dirty="false"] after Save (got "${dirtyAfterSave}")`);
              const draftAfterSave = await page.evaluate(() =>
                document.querySelector('[data-section="instructions"]')?.getAttribute('data-instructions-draft') ?? '');
              check(draftAfterSave === 'false',
                `agents-edit: [data-instructions-draft="false"] after a successful save clears the unconfirmed-draft flag (got "${draftAfterSave}")`);

              let savedOnDisk = false;
              let savedText = '';
              for (let t = 0; t < 30 && !savedOnDisk; t += 1) {
                savedText = readFileSync(DR_SKILL_PATH, 'utf8');
                savedOnDisk = savedText.includes('brain-query');
                if (!savedOnDisk) await sleep(250);
              }
              check(savedOnDisk, 'agents-edit: the newly bound "brain-query" skill is now in the real skills/developer-ralph/SKILL.md on disk');
              check(savedText.includes('drivingArtifact: work-items') && savedText.includes('isolation: worktree'),
                'agents-edit: the fanout: block survives the compound save (not dropped by the composition change)');
              await frame(page, 'ae-4-saved', 'Edit-agent — Save persists the bound skill + the drafted instructions to the real SKILL.md');
        },
      },
      {
        id: 'agents-edit-byte-faithful',
        title: 'Edit-agent arc — the byte-faithful save (headline fix, demonstrated live)',
        narration: 'The headline fix (skill-md-fidelity.ts D5/D6): when a save changes ONLY the instructions body — no composition change — the ENTIRE frontmatter block is kept byte-for-byte: the 7-line YAML comment, the fanout: block, and key order all survive untouched. Proven by restoring developer-ralph to its pristine, stashed bytes, reloading the builder fresh, editing ONLY the instructions field, and comparing the saved file\'s frontmatter region byte-for-byte against the pristine original.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              console.log('\n[R2-09] Edit-agent arc — the byte-faithful save (headline)');

              // Isolate the claim: restore the PRISTINE bytes (undoing the prior
              // compound save) and reload the builder fresh, so the ONLY change
              // this beat makes is to the instructions body — no composition
              // change rides along, the one precondition the fast path requires
              // (registry.test.ts: "developer-ralph: changing ONLY body keeps
              // the frontmatter block byte-identical").
              restoreDeveloperRalphSkill();
              await page.goto(watch.uiUrl + '/agents/developer-ralph', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 20000 },
              ).catch(() => {});
              // Advanced starts collapsed again after a fresh navigation — open it
              // to read + confirm the restored, pristine composition.
              await ensureAdvancedOpen(page);
              const skillCountAfterRestore = await page.evaluate(() =>
                document.querySelector('[data-accepts="skill"]')?.getAttribute('data-count') ?? '(absent)');
              check(skillCountAfterRestore === '0',
                `agents-edit: the restored, reloaded agent is back to its pristine composition (data-count="${skillCountAfterRestore}")`);

              const marker = ' (byte-faithful e2e edit)';
              const processInput = page.locator('#process-input');
              const beforeInstructions = await processInput.inputValue().catch(() => '');
              await processInput.fill(beforeInstructions + marker);
              await sleep(THINK);
              const dirtyAfterEdit = await page.evaluate(() => document.querySelector('[data-dirty]')?.getAttribute('data-dirty') ?? '');
              check(dirtyAfterEdit === 'true', `agents-edit: a body-only edit marks the form dirty (got "${dirtyAfterEdit}")`);

              await page.locator('[data-action="save-agent"]').click();
              await page.waitForFunction(
                () => document.querySelector('[data-dirty]')?.getAttribute('data-dirty') === 'false',
                null, { timeout: 10000 },
              ).catch(() => {});

              let savedOnDisk = false;
              let postText = '';
              for (let t = 0; t < 30 && !savedOnDisk; t += 1) {
                postText = readFileSync(DR_SKILL_PATH, 'utf8');
                savedOnDisk = postText.includes(marker.trim());
                if (!savedOnDisk) await sleep(250);
              }
              check(savedOnDisk, 'agents-edit: the body-only edit lands in the real skills/developer-ralph/SKILL.md on disk');

              const pristine = splitFrontmatter(drSkillStash);
              const saved = splitFrontmatter(postText);
              check(saved.frontmatter.length > 0 && saved.frontmatter === pristine.frontmatter,
                'agents-edit (headline): the saved file\'s frontmatter is byte-for-byte identical to the pristine original outside the edited region');
              check(pristine.frontmatter.includes('# R2-03-F2 — declares the existing per-work-item fan-out'),
                'agents-edit (headline): the pristine frontmatter carries the real 7-line YAML comment block (the fixture\'s whole reason for being)');
              check(saved.frontmatter.includes('# R2-03-F2 — declares the existing per-work-item fan-out'),
                'agents-edit (headline): the 7-line YAML comment block survives the byte-faithful save verbatim');
              check(saved.frontmatter.includes('fanout:') && saved.frontmatter.includes('drivingArtifact: work-items'),
                'agents-edit (headline): the fanout: block survives the byte-faithful save verbatim');
              check(saved.body !== pristine.body && saved.body.includes(marker.trim()),
                'agents-edit (headline): only the body (instructions) actually changed');

              await frame(page, 'ae-5-byte-faithful',
                'Edit-agent — the headline fix: a body-only save keeps the frontmatter (comments, fanout, key order) byte-for-byte');

              // Restore the real shipped bytes — this beat is the arc's own
              // closing restore point (mirrors agents-builder's own
              // finally-style restore); e2e-journey.mjs's own top-level finally
              // calls restoreDeveloperRalphSkill() again as a crash-safe
              // backstop regardless of how this beat exits.
              restoreDeveloperRalphSkill();
        },
      },
      {
        id: 'agents-materials-declare',
        title: 'Materials — declare allowed input materials',
        narration: 'The materials picker (R2-09 C4) is a closed, ordered vocabulary — images | documents | audio | data-files. Declaring is enforcement-free here (R6-04-F2\'s kickoff upload seam is where a declared kind actually gates an upload); this beat proves the declaration itself round-trips: toggled in the builder, saved to materials: on disk, and read back correctly on reload — on its own throwaway scratch agent, not developer-ralph.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              console.log('\n[R2-09] Materials — declare allowed input materials');
              cleanMaterialsAgent();
              await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              await page.locator('[data-starter-option="blank"]').click();
              await page.waitForSelector('#purpose-input', { timeout: 10000 });
              await page.locator('input.agent-name-input').fill(MATERIALS_AGENT_NAME);
              await page.locator('#purpose-input').fill('Exercise the materials-declaration round-trip for the e2e journey.');
              await page.locator('#process-input').fill('Read whatever the operator attaches at kickoff; nothing else to do for this fixture.');
              await sleep(THINK);

              const materialsCountBefore = await page.evaluate(() =>
                document.querySelector('[data-section="materials"]')?.getAttribute('data-materials-count') ?? '(absent)');
              check(materialsCountBefore === '0',
                `agents-materials: a fresh blank agent declares no materials yet (data-materials-count="${materialsCountBefore}")`);

              for (const kind of ['documents', 'audio']) {
                await page.locator(`[data-material="${kind}"]`).click();
              }
              await sleep(ACT);
              const countAfterToggle = await page.evaluate(() =>
                document.querySelector('[data-section="materials"]')?.getAttribute('data-materials-count') ?? '(absent)');
              check(countAfterToggle === '2',
                `agents-materials: toggling documents + audio updates [data-materials-count] (got "${countAfterToggle}")`);
              const documentsSelected = await page.evaluate(() =>
                document.querySelector('[data-material="documents"]')?.getAttribute('data-selected') ?? '');
              const audioSelected = await page.evaluate(() =>
                document.querySelector('[data-material="audio"]')?.getAttribute('data-selected') ?? '');
              const imagesSelected = await page.evaluate(() =>
                document.querySelector('[data-material="images"]')?.getAttribute('data-selected') ?? '');
              check(documentsSelected === 'true' && audioSelected === 'true',
                `agents-materials: [data-material="documents"|"audio"][data-selected="true"] after toggling (got documents="${documentsSelected}", audio="${audioSelected}")`);
              check(imagesSelected === 'false',
                `agents-materials: an untouched kind stays [data-selected="false"] (got "${imagesSelected}")`);
              await frame(page, 'ae-6-materials-toggled',
                'Edit-agent — materials: documents + audio toggled on, images/data-files untouched');

              await page.locator('[data-action="save-agent"]').click();
              const landed = await waitForFile(MATERIALS_AGENT_SKILL_PATH, 12000);
              check(landed, `agents-materials: saving writes skills/${MATERIALS_AGENT_SLUG}/SKILL.md`);
              const savedText = landed ? readFileSync(MATERIALS_AGENT_SKILL_PATH, 'utf8') : '';
              check(savedText.includes('materials:') && savedText.includes('- documents') && savedText.includes('- audio'),
                'agents-materials: the saved SKILL.md carries materials: with the chosen kinds');
              check(!savedText.includes('- images') && !savedText.includes('- data-files'),
                'agents-materials: the saved materials: block does not carry an untouched kind');

              // Reload — prove the toggles round-trip from disk, not just in-memory state.
              await page.goto(watch.uiUrl + `/agents/${MATERIALS_AGENT_SLUG}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              const documentsAfterReload = await page.evaluate(() =>
                document.querySelector('[data-material="documents"]')?.getAttribute('data-selected') ?? '');
              const audioAfterReload = await page.evaluate(() =>
                document.querySelector('[data-material="audio"]')?.getAttribute('data-selected') ?? '');
              check(documentsAfterReload === 'true' && audioAfterReload === 'true',
                `agents-materials: [data-selected] reflects the saved materials on reload (documents="${documentsAfterReload}", audio="${audioAfterReload}")`);
              await frame(page, 'ae-7-materials-reloaded',
                'Edit-agent — a fresh reload reads the declared materials back from the real SKILL.md');

              cleanMaterialsAgent();
        },
      },
    ],
  });
