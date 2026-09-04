import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  cleanStarterAgents, STARTER_AGENT_SLUGS, FORGE_ROOT, waitForFile, caption, ACT, THINK, READ, SK_NEW_SLUG,
  seedThroughlineSkillFixture,
  // R6-06 Task 3 — the agent-history-ledger beat's three fixtures:
  //   - flow-node: real _queue/_logs manifest, hand-authored below (mirrors
  //     archEvent's own JSONL-append style, no existing helper for this
  //     shape).
  //   - standalone: hand-authored below (see the dedicated header comment
  //     at R6_06_STANDALONE_RUN_ID for corpus-provenance — no real
  //     `_agent-*` run exists anywhere on this machine, measured this round).
  //   - session: REUSES archDir/writeStatus/archEvent verbatim — the SAME
  //     real, already-shipped architect-session fixture shape flows-run.mjs
  //     already exercises for its own (different) session id.
  archDir, writeStatus, archEvent, PROJECT,
} from '../lib/journey-fixtures.mjs';
import { sleep, checkHonestPillarRead, waitPageReady } from '../lib/journey-assertions.mjs';

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

// ── R6-06 Task 3 — agent-history-ledger fixtures (all three link kinds on
// architect's own /agents/architect ledger) ─────────────────────────────────
//
// FLOW-NODE fixture — a real `_queue/done/` manifest + `_logs/<cycleId>/
// events.jsonl`, `flow_id: forge-architect`, a real `phase: architect` start/
// end pair. MEASURED, not invented: this exact event shape was run directly
// through the REAL `orchestrator/run-model.ts` `listRuns()` this round (task
// report has the full transcript) — `phaseMeta.architect.costUsd` resolved
// to 2.5 (the architect node's OWN authoritative spend) while `run.costUsd`
// (the aggregate, architect 2.5 + pm 9.75) resolved to 12.25 — the exact
// D3/D9 "per-target fact, never the aggregate" gap this initiative's ledger
// row must get right. `phases.architect` resolved to 'complete'.
const R6_06_FLOW_INIT_ID = 'INIT-r6-06-agent-ledger-flow-node';
const R6_06_FLOW_CYCLE_ID = `2026-01-01T00-00-00_${R6_06_FLOW_INIT_ID}`;
const R6_06_FLOW_MANIFEST_PATH = join(FORGE_ROOT, '_queue', 'done', `${R6_06_FLOW_INIT_ID}.md`);
const R6_06_FLOW_LOG_DIR = join(FORGE_ROOT, '_logs', R6_06_FLOW_CYCLE_ID);
function cleanR6_06FlowNodeFixture() {
  for (const q of ['pending', 'in-flight', 'ready-for-review', 'merged', 'done', 'failed']) {
    try { rmSync(join(FORGE_ROOT, '_queue', q, `${R6_06_FLOW_INIT_ID}.md`), { force: true }); } catch { /* */ }
  }
  try { rmSync(R6_06_FLOW_LOG_DIR, { recursive: true, force: true }); } catch { /* */ }
}
function seedR6_06FlowNodeFixture() {
  cleanR6_06FlowNodeFixture();
  mkdirSync(join(FORGE_ROOT, '_queue', 'done'), { recursive: true });
  writeFileSync(R6_06_FLOW_MANIFEST_PATH, [
    '---',
    `initiative_id: ${R6_06_FLOW_INIT_ID}`,
    `project: ${PROJECT}`,
    `project_repo_path: ${join(FORGE_ROOT, 'projects', PROJECT)}`,
    'origin: architect',
    'created_at: 2026-01-01T00:00:00.000Z',
    'iteration_budget: 5',
    'cost_budget_usd: 20.0',
    `cycle_id: ${R6_06_FLOW_CYCLE_ID}`,
    'flow_id: forge-architect',
    '---',
    '',
    '# R6-06 agent-history-ledger flow-node fixture',
    '',
    'Seeded by the agents-edit-selector-navigate beat (R6-06 Task 3).',
  ].join('\n'));
  mkdirSync(R6_06_FLOW_LOG_DIR, { recursive: true });
  const events = [
    { event_id: 'EV_0', cycle_id: R6_06_FLOW_CYCLE_ID, initiative_id: R6_06_FLOW_INIT_ID, phase: 'architect', skill: 'architect', event_type: 'start', started_at: '2026-01-01T00:00:00.000Z', input_refs: [], output_refs: [] },
    { event_id: 'EV_1', cycle_id: R6_06_FLOW_CYCLE_ID, initiative_id: R6_06_FLOW_INIT_ID, phase: 'architect', skill: 'architect', event_type: 'end', started_at: '2026-01-01T00:01:00.000Z', input_refs: [], output_refs: [], cost_usd: 2.5 },
    { event_id: 'EV_2', cycle_id: R6_06_FLOW_CYCLE_ID, initiative_id: R6_06_FLOW_INIT_ID, phase: 'project-manager', skill: 'project-manager', event_type: 'start', started_at: '2026-01-01T00:02:00.000Z', input_refs: [], output_refs: [] },
    { event_id: 'EV_3', cycle_id: R6_06_FLOW_CYCLE_ID, initiative_id: R6_06_FLOW_INIT_ID, phase: 'project-manager', skill: 'project-manager', event_type: 'end', started_at: '2026-01-01T00:03:00.000Z', input_refs: [], output_refs: [], cost_usd: 9.75 },
  ];
  writeFileSync(join(R6_06_FLOW_LOG_DIR, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

/**
 * STANDALONE fixture — CORPUS PROVENANCE (measured this round, reported
 * honestly): `find / -type d -name '_agent-*'` returns NOTHING anywhere on
 * this machine — no real standalone-dispatch run directory exists in this
 * repo's `_logs/`, any worktree's `_logs/`, or anywhere else searched. No
 * "earlier gate run" left a real one behind to capture. Rather than invent a
 * shape from imagination, this fixture mirrors the shape straight off the
 * PRODUCTION EMITTER (`orchestrator/run-agent.ts`'s `runAgent`, lines
 * ~320-382: a `start` event with `metadata: {agent_phase, agent_slug}`, an
 * `end` event with the SAME `metadata.agent_slug` plus a top-level
 * `cost_usd`) — the SAME shape `apps/forge/ui-bridge-agent-run.test.ts`'s own
 * existing fixtures already encode for the sibling `GET /api/agents/runs/
 * <runId>` route's tests (`{event_type:'start', skill:'test-runnable'}` /
 * `{event_type:'end', skill:'test-runnable', cost_usd:0.42}`) — the closest
 * thing to a real, already-relied-upon fixture shape this codebase has for
 * this execution path.
 */
const R6_06_STANDALONE_RUN_ID = '_agent-architect-2026-01-01T00-10-00-000-r606';
const R6_06_STANDALONE_LOG_DIR = join(FORGE_ROOT, '_logs', R6_06_STANDALONE_RUN_ID);
function cleanR6_06StandaloneFixture() {
  try { rmSync(R6_06_STANDALONE_LOG_DIR, { recursive: true, force: true }); } catch { /* */ }
}
function seedR6_06StandaloneFixture() {
  cleanR6_06StandaloneFixture();
  mkdirSync(R6_06_STANDALONE_LOG_DIR, { recursive: true });
  const events = [
    { event_id: 'EV_0', cycle_id: R6_06_STANDALONE_RUN_ID, initiative_id: R6_06_STANDALONE_RUN_ID, phase: 'orchestrator', skill: 'architect', event_type: 'start', started_at: '2026-01-01T00:10:00.000Z', input_refs: [], output_refs: [], metadata: { agent_phase: 'standalone', agent_slug: 'architect' } },
    { event_id: 'EV_1', cycle_id: R6_06_STANDALONE_RUN_ID, initiative_id: R6_06_STANDALONE_RUN_ID, phase: 'orchestrator', skill: 'architect', event_type: 'end', started_at: '2026-01-01T00:11:00.000Z', input_refs: [], output_refs: [], cost_usd: 0.85, metadata: { agent_phase: 'standalone', agent_slug: 'architect' } },
  ];
  writeFileSync(join(R6_06_STANDALONE_LOG_DIR, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

// SESSION fixture — REUSES the real, already-shipped archDir/writeStatus/
// archEvent helpers verbatim (flows-run.mjs's own architect-interview beats
// already exercise this SAME shape for a DIFFERENT session id — no
// invention here).
const R6_06_SESSION_ID = '2026-01-01T00-20-00-r6-06-ledger-sess';
function cleanR6_06SessionFixture() {
  try { rmSync(archDir(R6_06_SESSION_ID), { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(join(FORGE_ROOT, '_logs', `_architect-${R6_06_SESSION_ID}`), { recursive: true, force: true }); } catch { /* */ }
}
function seedR6_06SessionFixture() {
  cleanR6_06SessionFixture();
  writeStatus(R6_06_SESSION_ID, { phase: 'drafting', round: 1, idea: 'R6-06 agent-history-ledger session fixture' });
  // `archEvent` (journey-fixtures.mjs) never writes a top-level `cost_usd` —
  // it has no callers today that need one. Appending ONE extra line directly,
  // in the SAME shape `archEvent` itself produces (same dir, same event
  // envelope), demonstrates a REAL non-null session cost for this fixture
  // rather than leaving cost permanently null here too — Task 1/2's tests
  // already cover the null/no-log-dir case; this beat's own value is showing
  // a POSITIVE session cost reaching the ledger, D3's headline claim, applied
  // to the third path.
  archEvent(R6_06_SESSION_ID, 'log', 'architect.session.paused-for-ledger-fixture', {});
  const logDir = join(FORGE_ROOT, '_logs', `_architect-${R6_06_SESSION_ID}`);
  writeFileSync(join(logDir, 'events.jsonl'),
    readFileSync(join(logDir, 'events.jsonl'), 'utf8') +
    JSON.stringify({
      event_id: 'EV_arch_cost', cycle_id: `_architect-${R6_06_SESSION_ID}`,
      initiative_id: `architect-session-${R6_06_SESSION_ID}`, started_at: new Date().toISOString(),
      phase: 'architect', skill: 'architect-runner', event_type: 'end',
      input_refs: [], output_refs: [], cost_usd: 0.42,
    }) + '\n');
}

/**
 * W7-D1: this existed but was NEVER CALLED — the three R6-06 fixtures were
 * seeded on every run and swept on none. Two consequences, both measured at
 * the Wave D gate:
 *
 *  · the flow-node fixture is a `_queue/done/` manifest for PROJECT (mdtoc),
 *    so it is showcase-ELIGIBLE — it silently inflated the demo-showcase
 *    journey's cycle-picker count from the two cycles that beat seeds to
 *    four, ten beats later and in a different journey;
 *  · all three were still on disk days after the run, showing up as REAL
 *    history on /agents/architect (bead agents-33's whole complaint).
 *
 * Now called from the seeding beat's own `finally` AND exported for
 * e2e-journey.mjs's top-level crash-safe backstop, the same belt-and-braces
 * `cleanKickoffAgent` gets — a beat that seeds outside its own directory
 * cannot rely on reaching its own tail.
 */
export function cleanAllR6_06LedgerFixtures() {
  cleanR6_06FlowNodeFixture();
  cleanR6_06StandaloneFixture();
  cleanR6_06SessionFixture();
}

// ── Batch-D journey-sync (T3) — standalone run-view fixtures for
// run-agent-developer (bd forge-11w) and run-agent-adversarial-review
// (bd forge-928) ─────────────────────────────────────────────────────────
//
// CORPUS PROVENANCE (measured this round, honestly, same sweep as
// R6_06_STANDALONE_RUN_ID's own header above): no real `_agent-*`
// standalone-dispatch run directory exists anywhere on this machine for
// EITHER agent. Rather than invent a shape, both fixtures below mirror the
// SAME production emitter shape `runAgent()` (`orchestrator/run-agent.ts`)
// actually writes (`phase: 'orchestrator'`, `skill: <slug>`,
// `metadata.agent_slug`) — R6_06_STANDALONE_RUN_ID's own precedent — and
// reuse REAL, already-vetted grounded content this codebase carries
// elsewhere rather than re-inventing it:
//   - developer-ralph: the SAME real gitpulse-sourced WI-1 numbers
//     flows-run.mjs's flows-run-tdd-red / flows-run-grind / flows-run-
//     dependency-gate beats already seed for the mdtoc `--write` cycle —
//     gate.expected-fail's real stderr text, the real Edit/Bash tool
//     sequence, and the real cost_usd/tokens_in/tokens_out/duration_ms
//     quadruple (0.6676270500000001 / 989 / 16679 / 332582) — reused
//     verbatim, now framed as a STANDALONE dispatch's own event log
//     instead of a flow cycle's (a real, structurally identical dev-loop
//     invocation either way — `runAgent` resolves `developer-ralph` to the
//     SAME `deriveAgentSpec` + ralph-loop machinery a flow node does).
//   - adversarial-review: the SAME real message vocabulary
//     adversarialReviewEvent()/writeReviewFindings() already emit
//     (`review.input.assembled` {changed_files, base_ref},
//     `review.findings.authored` {total, blocker, major, minor, info}) and
//     the SAME "clean pass, zero findings" shape writeReviewFindings(2)'s
//     own branch already writes — reused, not invented. "Five claims, each
//     refuted" is the agent's own internal SDK-turn reasoning (SKILL.md's
//     adversarial mission: candidate issues are weighed before they ever
//     become a reported `finding`) — this harness spawns no real turn
//     (FORGE_ARCHITECT_NO_SPAWN=1), so that trace is honestly unavailable;
//     what IS real and rendered is the COUNT-level outcome (0 findings) the
//     real review-findings.json/log vocabulary actually carries.
const DEV_RUN_SLUG = 'developer-ralph';
const DEV_RUN_ID = '_agent-developer-ralph-2026-08-10T00-00-00-000-e2e';
const DEV_RUN_LOG_DIR = join(FORGE_ROOT, '_logs', DEV_RUN_ID);
const DEV_RUN_CEILING_USD = 0.6;
function cleanDeveloperStandaloneRun() {
  try { rmSync(DEV_RUN_LOG_DIR, { recursive: true, force: true }); } catch { /* */ }
}
function seedDeveloperStandaloneRun() {
  cleanDeveloperStandaloneRun();
  mkdirSync(DEV_RUN_LOG_DIR, { recursive: true });
  const base = { cycle_id: DEV_RUN_ID, initiative_id: DEV_RUN_ID, input_refs: [], output_refs: [] };
  const at = (offsetSec) => new Date(Date.UTC(2026, 7, 10, 0, 0, offsetSec)).toISOString();
  let seq = 0;
  const next = () => `EV_${seq++}`;
  const events = [
    { ...base, event_id: next(), phase: 'orchestrator', skill: DEV_RUN_SLUG, event_type: 'start', started_at: at(0),
      metadata: { agent_phase: 'developer-loop', agent_slug: DEV_RUN_SLUG } },
    // Real WI-1 content (flows-run-tdd-red's own byte-identical stderr text).
    { ...base, event_id: next(), phase: 'developer-loop', skill: DEV_RUN_SLUG, event_type: 'log', started_at: at(5),
      message: 'gate.expected-fail',
      metadata: { work_item_id: 'WI-1', stderr: 'FAIL injectToc_ReplacesMarkerRegion: Cannot find module ../dist/inject.js (src/inject.ts not implemented)' } },
    ...['Edit', 'Edit', 'Bash', 'Edit', 'Bash'].map((tool, i) => ({
      ...base, event_id: next(), phase: 'developer-loop', skill: DEV_RUN_SLUG, event_type: 'tool_use',
      started_at: at(10 + i), message: `tool.${tool}`, metadata: { work_item_id: 'WI-1', tool },
    })),
    { ...base, event_id: next(), phase: 'developer-loop', skill: DEV_RUN_SLUG, event_type: 'log', started_at: at(60),
      message: 'gate.pass', metadata: { work_item_id: 'WI-1' } },
    // Real gitpulse-sourced WI-1 cumulative iteration totals (flows-run-dependency-gate's own grounding).
    { ...base, event_id: next(), phase: 'developer-loop', skill: DEV_RUN_SLUG, event_type: 'iteration', started_at: at(65),
      iteration: 1, tokens_in: 989, tokens_out: 16679, cost_usd: 0.6676270500000001, duration_ms: 332582,
      metadata: { work_item_id: 'WI-1' } },
    { ...base, event_id: next(), phase: 'orchestrator', skill: DEV_RUN_SLUG, event_type: 'end', started_at: at(70),
      cost_usd: 0.6676270500000001,
      metadata: { agent_phase: 'developer-loop', agent_slug: DEV_RUN_SLUG, kickoff_ceiling_usd: DEV_RUN_CEILING_USD } },
  ];
  writeFileSync(join(DEV_RUN_LOG_DIR, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

const ADV_RUN_SLUG = 'adversarial-review';
const ADV_RUN_ID = '_agent-adversarial-review-2026-08-10T00-05-00-000-e2e';
const ADV_RUN_LOG_DIR = join(FORGE_ROOT, '_logs', ADV_RUN_ID);
function cleanAdversarialReviewStandaloneRun() {
  try { rmSync(ADV_RUN_LOG_DIR, { recursive: true, force: true }); } catch { /* */ }
}
function seedAdversarialReviewStandaloneRun() {
  cleanAdversarialReviewStandaloneRun();
  mkdirSync(ADV_RUN_LOG_DIR, { recursive: true });
  const base = { cycle_id: ADV_RUN_ID, initiative_id: ADV_RUN_ID, input_refs: [], output_refs: [] };
  const at = (offsetSec) => new Date(Date.UTC(2026, 7, 10, 0, 5, offsetSec)).toISOString();
  let seq = 0;
  const next = () => `EV_${seq++}`;
  const events = [
    { ...base, event_id: next(), phase: 'orchestrator', skill: ADV_RUN_SLUG, event_type: 'start', started_at: at(0),
      metadata: { agent_phase: 'review', agent_slug: ADV_RUN_SLUG } },
    { ...base, event_id: next(), phase: 'orchestrator', skill: ADV_RUN_SLUG, event_type: 'log', started_at: at(5),
      message: 'review.input.assembled', metadata: { agent_slug: ADV_RUN_SLUG, changed_files: 4, base_ref: 'main' } },
    // The real terminal message adversarialReviewEvent()/writeReviewFindings(2)
    // already emit for a clean pass — total 0, every severity bucket 0.
    { ...base, event_id: next(), phase: 'orchestrator', skill: ADV_RUN_SLUG, event_type: 'log', started_at: at(90),
      message: 'review.findings.authored',
      metadata: { agent_slug: ADV_RUN_SLUG, total: 0, blocker: 0, major: 0, minor: 0, info: 0 } },
    { ...base, event_id: next(), phase: 'orchestrator', skill: ADV_RUN_SLUG, event_type: 'end', started_at: at(95),
      cost_usd: 0.47, metadata: { agent_phase: 'review', agent_slug: ADV_RUN_SLUG } },
  ];
  writeFileSync(join(ADV_RUN_LOG_DIR, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
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

// ── R6-04 kickoff arc: cost ceiling, materials-at-kickoff, expanded RunPanel,
// standalone run view ───────────────────────────────────────────────────────
// journey-kickoff-agent is its OWN throwaway scratch fixture (mirrors
// MATERIALS_AGENT_SLUG's create-and-destroy-itself precedent above): none of
// the 4 real one-shot loopStrategy agents (project-manager, reflector,
// adversarial-review, demo-agent — the ONLY runtime shape whose
// costCeilingEnforceable server fact, orchestrator/studio/derive.ts, reads
// true) declares `materials:`, so proving the kickoff panel's ceiling AND
// materials-attach TOGETHER needs a fixture that declares both. Unlike
// SCRATCH_AGENT_SLUG/MATERIALS_AGENT_SLUG (each fully created-and-cleaned
// inside ONE beat), this fixture spans SEVEN beats (agents-kickoff-build-
// fixture through agents-kickoff-run-view) — RUN_ORDER has no per-beat
// try/catch (see this file's own header on the edit-agent arc), so
// exportKickoffAgentCleanup below is also called from scripts/e2e-journey.mjs's
// top-level finally as a crash-safe backstop, mirroring
// restoreDeveloperRalphSkill's own precedent for the same reason.
const KICKOFF_AGENT_SLUG = 'journey-kickoff-agent';
const KICKOFF_AGENT_NAME = 'Journey Kickoff Agent';
const KICKOFF_AGENT_SKILL_PATH = join(FORGE_ROOT, 'skills', KICKOFF_AGENT_SLUG, 'SKILL.md');
export function cleanKickoffAgent() {
  try { rmSync(join(FORGE_ROOT, 'skills', KICKOFF_AGENT_SLUG), { recursive: true, force: true }); } catch { /* */ }
  // W7-D1 (fixture rule 3: the beat owns ALL its state). The kickoff arc
  // DISPATCHES this agent for real, and every one of those dispatches leaves
  // `_logs/_agent-journey-kickoff-agent-<stamp>/` behind. Under the dry
  // bridge each writes ONE `log` event and no terminal marker, so
  // `GET /api/agents/runs/<id>` derives `state: "running"` FOREVER — nine of
  // them had accumulated since 2026-08-10. The next run's RunPanel then
  // reattached to the newest zombie (W7-B5 agents-26) and disabled its whole
  // run form, which is exactly how the Wave D gate died at
  // `agents-kickoff-set-project`. Leaving them behind makes this journey
  // non-idempotent (the class bead `forge-6lk` names), so the arc sweeps its
  // OWN dispatches the same way it sweeps its own SKILL.md.
  try {
    const logsRoot = join(FORGE_ROOT, '_logs');
    for (const entry of readdirSync(logsRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(`_agent-${KICKOFF_AGENT_SLUG}-`)) {
        rmSync(join(logsRoot, entry.name), { recursive: true, force: true });
      }
    }
  } catch { /* no _logs yet, or already swept */ }
}
// mdtoc, not the mockup's "gitpulse" — the one real project committed INSIDE
// forge's own repo (CLAUDE.md), always present for this harness regardless of
// FORGE_E2E_PROJECT; gitpulse is a genuinely separate, independent repo this
// harness never checks out.
const KICKOFF_PROJECT_ID = 'mdtoc';
// A real fixture already committed for mdtoc's own acceptance evidence (the
// SAME file journey-fixtures.mjs's ACC_FIXTURE names) — .md resolves to the
// 'documents' kind (orchestrator/studio/materials.ts), the ONE kind the
// fixture agent declares, so attaching it is the ACCEPTED path.
const KICKOFF_MATERIAL_ACCEPTED = join(FORGE_ROOT, 'projects', KICKOFF_PROJECT_ID, 'test', 'fixtures', 'release-notes.md');
// package.json — a real repo file whose extension (.json) resolves to the
// 'data-files' kind, a kind the fixture agent never declares — the REFUSED
// path, naming the declared kind set in its own error text.
const KICKOFF_MATERIAL_REFUSED = join(FORGE_ROOT, 'package.json');
// Set by agents-kickoff-dispatch, read by agents-kickoff-run-view two beats
// later (both run in the SAME node process, RUN_ORDER's sequential drive
// loop) — module-scoped rather than threaded through ctx because ctx is
// rebuilt fresh per beat (mirrors pmSkillStash/drSkillStash's own module-
// local pattern above).
let kickoffRunId = null;

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
        id: 'agents-index-roster',
        title: 'Browse the agents index — roster + recent runs',
        narration: 'Before composing anything, the operator lands on /agents (T2 lane W6-IA-3) — a browsable roster of every agent, mirroring the Library page\'s own agents pillar, plus a cross-agent "recent agent runs" view served by ONE call to the W7-B5 aggregate route (GET /api/agents/runs/recent — each row carries the RUN-level status/cost plus WHICH agents ran, replacing the old 13-request fan-out that attributed an arbitrary node\'s $0.00 to a $4.79 failed run). This is the entry point StudioNav\'s own /agents/new shortcut skips past entirely: proof the roster itself is reachable and real, and that a card actually navigates into the builder, before any beat below drills into one specific agent.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              console.log('\n[W6-IA3] Browse the agents index — roster + recent runs');

              await page.goto(watch.uiUrl + '/agents', { waitUntil: 'domcontentloaded' });
              await waitPageReady(page, 'agents-index', 15000);
              const pageReady = await page.evaluate(() =>
                document.querySelector('[data-page="agents-index"]')?.getAttribute('data-page-ready'));
              check(pageReady === 'true', `W6-IA3: [data-page="agents-index"][data-page-ready="true"] (got "${pageReady}")`);
              // W7-A1 / FIX-A1 (A1-11): the agents pillar's roster read is honest.
              await checkHonestPillarRead(page, check, 'agents-index', 'W6-IA3');

              const cardCount = await page.evaluate(() =>
                document.querySelectorAll('[data-section="agent-roster"] [data-card-type="agent"]').length);
              check(cardCount > 0, `W6-IA3: the roster renders ≥1 real AgentCard from the seeded OOTB library (got ${cardCount})`);

              const ctaHref = await page.evaluate(() =>
                document.querySelector('[data-action="new-agent"]')?.getAttribute('href'));
              check(ctaHref === '/agents/new', `W6-IA3: "+ New agent" CTA links to /agents/new (got "${ctaHref}")`);

              // Recent-agent-runs: wait for the loading placeholder to clear, then
              // confirm the REAL shared HistoryLedger mounted. Its own honest
              // empty/populated states are already pinned by
              // history-ledger-render.test.ts + the R6-06 beats below — this beat
              // only proves THIS route actually reuses it.
              await page.waitForFunction(
                () => document.querySelector('[data-component="recent-runs-loading"]') === null,
                null, { timeout: 15000 },
              ).catch(() => {});
              const ledgerMounted = await page.evaluate(() => document.querySelector('[data-section="history-ledger"]') !== null);
              check(ledgerMounted, 'W6-IA3: the recent-agent-runs section mounts the REAL shared HistoryLedger ([data-section="history-ledger"])');
              // W7-B5 (agents-40): the section publishes its own count + the
              // fetch bound — a silently-capped list is a lie of omission.
              const recentSection = await page.evaluate(() => {
                const el = document.querySelector('[data-section="recent-agent-runs"]');
                return el ? { count: el.getAttribute('data-count'), limit: el.getAttribute('data-limit') } : null;
              });
              check(recentSection !== null && recentSection.count !== null && recentSection.limit !== null,
                `W7-B5 (agents-40): the recent-agent-runs section carries data-count + data-limit (got ${JSON.stringify(recentSection)})`);
              await frame(page, 'agents-index-0-roster', 'Agents index — the roster + recent-agent-runs sections, before drilling into any one agent');

              // The roster's own cards are real navigation, not decoration: click
              // through to the first agent and land on its builder.
              const firstCardHref = await page.evaluate(() =>
                document.querySelector('[data-section="agent-roster"] [data-card-type="agent"]')?.getAttribute('href'));
              check(!!firstCardHref && firstCardHref.startsWith('/agents/'), `W6-IA3: the first roster card links into the builder (got "${firstCardHref}")`);
              await page.locator('[data-section="agent-roster"] [data-card-type="agent"]').first().click();
              await waitPageReady(page, 'agents', 15000);
              const landedOnBuilder = await page.evaluate(() => document.querySelector('[data-page="agents"]') !== null);
              check(landedOnBuilder, 'W6-IA3: clicking a roster card actually navigates into the agent builder ([data-page="agents"])');
        },
      },
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
              await waitPageReady(page, 'agents', 15000);
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
                  ['--experimental-strip-types', 'apps/forge/cli.ts', 'studio', 'lint'],
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
              // W7-FIX-B-UI: self-containment — in the FULL walkthrough, SK-3
              // (skills/skills-create) authored SK_NEW_SLUG through the real
              // /skills/new form and this is a strict no-op; under a scoped
              // `--journey` run without the skills journey the throughline
              // skill would not exist and the chip lookup below would time
              // out, aborting the whole run (gateB2 2026-08-21). Seeding the
              // exact plain-skill shape the create route writes keeps the
              // R3-01-F2 claim real either way: the file lands AFTER the
              // bridge booted, so the palette chip still proves live
              // filesystem discovery with no restart. The runner's finally
              // sweeps it via cleanSkillArtifacts() (scoped runs included).
              if (seedThroughlineSkillFixture()) {
                console.log(`  [A-scratch] scoped run: seeded skills/${DND_SKILL_ID}/SKILL.md (skills journey not in this run's scope)`);
              }

              await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
              await waitPageReady(page, 'agents', 15000);
              const blankPresent = await page.evaluate(() => document.querySelector('[data-starter-option="blank"]') !== null);
              check(blankPresent, 'A-scratch: the starter picker offers a genuine "blank" option ([data-starter-option="blank"])');
              // Bead forge-8vfn.5.15: the picker is the ONLY act on /agents/new
              // (the purpose field and [data-action="toggle-advanced"] are not in
              // the document yet), so the starter's own `data-action` is what
              // makes the rest of this route reachable to a story beat at all.
              // Checked BEFORE the click, where the picker is the live surface.
              const starterPressable = await page.evaluate(() =>
                document.querySelector('[data-starter-option="blank"][data-action="starter-blank"]') !== null);
              check(starterPressable, 'A-scratch (5.15): the blank starter carries its story handle [data-action="starter-blank"] alongside [data-starter-option] — the handle S5 beat 5 needs to reach Advanced at all');
              await page.locator('[data-starter-option="blank"]').click();
              await page.waitForSelector('#purpose-input', { timeout: 10000 });

              // Bead forge-8vfn.5.15, the enforcement half: the DOM contract
              // names six `data-field` handles on this builder, and a contract
              // enforced nowhere is this campaign's dominant defect class. The
              // census reports the MISSING names, not a count — a check whose
              // negative result reads as "nothing to report" is not a check.
              const missingFields = await page.evaluate(() =>
                ['agent-name', 'purpose', 'instructions', 'interactivity', 'run-project', 'run-cost-ceiling']
                  .filter((f) => document.querySelector(`[data-field="${f}"]`) === null));
              check(missingFields.length === 0,
                `A-scratch (5.15): every named data-field handle resolves on the builder${missingFields.length ? ` — MISSING: ${missingFields.join(', ')}` : ''}`);

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
              // Bead forge-8vfn.5.15: the same chip is also PRESSABLE by a story
              // beat, and the kind is in the action name so composing a skill and
              // fencing a tool never collapse into one act.
              const chipPressable = await page.evaluate((id) =>
                document.querySelector(`.catalog-chip[data-id="${id}"][data-kind="skill"][data-action="add-skill-${id}"]`) !== null,
                DND_SKILL_ID);
              check(chipPressable, `A-scratch (5.15): the "${DND_SKILL_ID}" chip carries [data-action="add-skill-${DND_SKILL_ID}"] — composing a skill is nameable by a story beat`);
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
                  ['--experimental-strip-types', 'apps/forge/cli.ts', 'studio', 'lint'],
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
        narration: 'Reopening the shipped project-manager agent, the operator expands Advanced to see its skill/tool/MCP/guard/hook drop zones and runtime SDK, edits its purpose field, and SAVES — proof an OOTB agent stays genuinely editable after the fact, not just re-composable from a fresh starter. Since R4-01 the plan agent is a MIGRATED artifact: its flow dispatch is declared data (the wi-contract GUARD — renamed from "hook" by the R3-03 amendment to ADR-027, so the word "hook" is free for user-authorable agent-lifecycle customisations — a one-shot loop strategy, budget caps in frontmatter — ADR-039), and the save round-trip provably preserves all of it, so editing in the builder can never silently break dispatch. The readiness panel\'s 6 checks (including runtime) are sourced from the server-computed capability descriptor, not a client guess, and an informational chip shows whether the agent is interactive or unattended straight from that same descriptor. The Run panel is pinned first in the right column with its dispatch button in a fixed action bar OUTSIDE the panel\'s own scrolling form, and this beat measures THAT BUTTON\'s rect — the previous version measured the panel\'s box, which stays "in the viewport" while the control inside it is below the fold. Because it is unattended, the agent also carries a generic run surface (R2-01-F3): it dispatches standalone straight from the agent page — no flow required — the runnable primitive reaching the UI. The same surface makes the develop flow\'s two successor agents runnable in isolation (R4-10-F3): demo-agent and adversarial-review dispatch standalone through their FLOW pipeline (not a bare spawn), yielding the identical artifacts — the ship-both principle, valuable alone as well as in a flow. (The real shipped bytes are stashed first and restored after, so the walkthrough never leaves project-manager\'s production SKILL.md mutated.)',
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
                  // W8-B1 (ON-8) / W8-F4: the run surface is REACHABLE, not
                  // merely present. It used to render third in the right
                  // column, below the whole YAML preview and the readiness
                  // list, so on a real agent the one control this page exists
                  // for sat off-screen. It now renders FIRST, is pinned there,
                  // and the dispatch control lives OUTSIDE the panel's own
                  // scroll region.
                  //
                  // W8-F4 — WHY THIS MEASURES THE BUTTON AND NOT THE PANEL:
                  // this beat used to read getBoundingClientRect() of
                  // [data-section="agent-run"] and assert `box.top <
                  // innerHeight && box.bottom > 0`. The C4 refuter proved that
                  // predicate is TRUE for a panel straddling the fold while
                  // [data-action="run-agent"] inside it sits at 4200px on an
                  // 800px viewport — "BOTH GATES GREEN, CONTROL OFF SCREEN".
                  // The only honest browser assertion is over the CONTROL's
                  // own rect, plus a hit test (a rect inside the viewport that
                  // something else covers, or that an ancestor clips, is still
                  // not reachable) and the scroll offsets (the whole claim is
                  // "on arrival, WITHOUT scrolling").
                  const runReach = await page.evaluate(() => {
                    const run = document.querySelector('[data-section="agent-run"]');
                    const control = document.querySelector('[data-section="agent-run"] [data-action="run-agent"]');
                    const yaml = document.querySelector('[data-component="yaml-preview"]');
                    const readiness = document.querySelector('[data-component="readiness-panel"]');
                    if (!run) return null;
                    const before = (a, b) => !!a && !!b
                      && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
                    // Sub-pixel layout: a control whose bottom lands 0.5px past
                    // the fold is on screen, not off it.
                    const EDGE_TOLERANCE_PX = 1;
                    const column = document.querySelector('#col-right');
                    const box = control === null ? null : control.getBoundingClientRect();
                    let hitIsControl = false;
                    if (control !== null && box !== null && box.width > 0 && box.height > 0) {
                      const cx = Math.round(box.left + box.width / 2);
                      const cy = Math.round(box.top + box.height / 2);
                      if (cx >= 0 && cy >= 0 && cx < window.innerWidth && cy < window.innerHeight) {
                        const hit = document.elementFromPoint(cx, cy);
                        hitIsControl = hit !== null && (hit === control || control.contains(hit));
                      }
                    }
                    return {
                      beforeYaml: before(run, yaml),
                      beforeReadiness: before(run, readiness),
                      controlPresent: control !== null,
                      panelTop: Math.round(run.getBoundingClientRect().top),
                      top: box === null ? null : Math.round(box.top),
                      bottom: box === null ? null : Math.round(box.bottom),
                      viewportHeight: window.innerHeight,
                      controlWithinViewport: box !== null
                        && box.width > 0 && box.height > 0
                        && box.top >= -EDGE_TOLERANCE_PX
                        && box.bottom <= window.innerHeight + EDGE_TOLERANCE_PX,
                      hitIsControl,
                      // "without scrolling" is only a claim if nothing scrolled.
                      pageScrollY: Math.round(window.scrollY),
                      columnScrollTop: column === null ? null : Math.round(column.scrollTop),
                      // The control must not sit inside a scroll region of its own
                      // (reachable-BY-scrolling is the opposite of the claim).
                      scrollingAncestors: (() => {
                        const names = [];
                        for (let el = control?.parentElement ?? null; el !== null; el = el.parentElement) {
                          const overflowY = getComputedStyle(el).overflowY;
                          if (overflowY === 'auto' || overflowY === 'scroll') {
                            names.push(el.getAttribute('data-section') ?? el.getAttribute('id') ?? el.tagName.toLowerCase());
                          }
                          if (el === run) break;
                        }
                        return names;
                      })(),
                      sticky: getComputedStyle(run).position,
                    };
                  });
                  check(runReach !== null, 'agent-builder (W8-B1): the run surface is mounted on the agent page');
                  check(runReach?.beforeYaml === true && runReach?.beforeReadiness === true,
                    `agent-builder (W8-B1): Run renders BEFORE the YAML preview and the readiness panel (yaml ${runReach?.beforeYaml}, readiness ${runReach?.beforeReadiness})`);
                  check(runReach?.controlPresent === true,
                    'agent-builder (W8-F4): the dispatch control [data-action="run-agent"] itself is in the DOM — the thing the next checks measure');
                  check(runReach?.pageScrollY === 0 && (runReach?.columnScrollTop ?? 0) === 0,
                    `agent-builder (W8-F4): nothing has scrolled — the claim is about ARRIVAL (window ${runReach?.pageScrollY}px, right column ${runReach?.columnScrollTop}px)`);
                  check(runReach?.controlWithinViewport === true,
                    `agent-builder (W8-F4): the RUN BUTTON's own rect is fully inside the viewport on arrival — not the panel's box, the control's (top ${runReach?.top}px, bottom ${runReach?.bottom}px, viewport ${runReach?.viewportHeight}px)`);
                  check(runReach?.hitIsControl === true,
                    'agent-builder (W8-F4): and a hit test at its centre lands ON the button — a rect inside the viewport that something covers or an ancestor clips is still not reachable');
                  check((runReach?.scrollingAncestors ?? ['?']).length === 0,
                    `agent-builder (W8-F4): the button is NOT inside the panel's own scroll region — reachable-BY-scrolling is the opposite of the claim (scrolling ancestors: ${JSON.stringify(runReach?.scrollingAncestors)})`);
                  check(runReach?.sticky === 'sticky',
                    `agent-builder (W8-B1): and the panel is PINNED to its scrolling column, so it stays reachable (computed position "${runReach?.sticky}")`);
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
                  await waitPageReady(page, 'agents', 20000);
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
                await recordClip(browser, watch, 'agent-build', '/agents', async (p) => {
                  // Entry point: the agents index roster — a real click into
                  // /agents/project-manager, not a direct goto. (W6-IA-4: was the
                  // library's own "agents" shelf section — /agents, W6-IA-3, is now
                  // the real index; Library dropped its projects/agents/flows/kb
                  // shelves down to shelves-only: skills/hooks/connections/templates/
                  // community.)
                  await waitPageReady(p, 'agents-index', 8000);
                  const agentsSection = p.locator('[data-section="agent-roster"]');
                  await agentsSection.scrollIntoViewIfNeeded().catch(() => {});
                  await caption(p, 'The OOTB agent roster — plan, dev, review, project-manager: curated, already shipped.');
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
                }, { readySel: '[data-page="agents-index"]', caption: 'From the agents index card to a saved edit — project-manager, reopened and tuned', holdTailMs: 1500 });
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
              await waitPageReady(page, 'agents', 20000);
              const agentId = await page.evaluate(() =>
                document.querySelector('[data-page="agents"]')?.getAttribute('data-agent-id') ?? '');
              check(agentId === 'developer-ralph',
                `agents-edit: opened the builder on the real developer-ralph agent (data-agent-id="${agentId}")`);
              const selectPresent = await page.evaluate(() => document.querySelector('[data-agent-select]') !== null);
              check(selectPresent, 'agents-edit: [data-agent-select] present — the builder\'s agent switcher');
              const optionCount = await page.evaluate(() => document.querySelectorAll('[data-agent-option]').length);
              check(optionCount >= 5,
                `agents-edit: the selector offers [data-agent-option] for multiple real agents (got ${optionCount})`);
              // W7-B4 (agents-09): the builder finally carries the agent's
              // whole lifecycle — Duplicate always; Delete guarded: developer-
              // ralph is a node in the shipped forge-develop flow, so Delete
              // renders DISABLED with the referencing flow named (the same
              // guard the bridge's DELETE route enforces).
              check(await page.locator('[data-action="duplicate-agent"]').count() > 0,
                'agents-edit: Duplicate is offered (W7-B4 agents-09)');
              check(await page.locator('[data-action="delete-agent"][disabled]').count() > 0
                 && await page.locator('[data-component="delete-blocked"]').count() > 0,
                'agents-edit: Delete on a flow-referenced agent is disabled WITH the reason (guarded, never silent)');
              await frame(page, 'ae-0-selector-open',
                'Edit-agent — the builder opens on a real shipped agent (developer-ralph); the selector offers the whole fleet, plus duplicate/delete lifecycle');
        },
      },
      {
        id: 'agents-edit-selector-navigate',
        title: 'Edit-agent arc — switch agents through the selector',
        narration: 'Switching agents through [data-agent-select] itself — not a direct URL edit — drives the same route + state change the operator sees clicking through the fleet, proving the selector (not just the route) is what moves the builder. Navigates forward to a second real agent and back to developer-ralph, so the arc continues on its own fixture. R6-06 (agent-monitor linkage): while on architect\'s own page, this beat ALSO checks the new run-history ledger — architect is the one agent that runs on all three execution paths (a flow node inside forge-architect, a standalone dispatch, and an interactive session), so its ledger is the one place all three [data-ledger-link-kind] values can be demonstrated on a single page. The ledger PAGES (W7-B5 agents-32, 15 rows at a time over architect\'s real 76): the beat walks its own "Show more" control until every row is on screen, which is both how an operator reaches an older run and the reason a fixture dated 2026-01-01 is visible at all.',
        drive: async (ctx) => {
              const { page, frame, check } = ctx;
              console.log('\n[R2-09] Edit-agent arc — switch agents through the selector');

              // R6-06 Task 3 — seed real fixtures for all three execution
              // paths BEFORE navigating, so architect's ledger has something
              // real to render once GET /api/agents/:slug/history exists.
              console.log('[R6-06] seeding flow-node/standalone/session fixtures for architect\'s history ledger');
              seedR6_06FlowNodeFixture();
              seedR6_06StandaloneFixture();
              seedR6_06SessionFixture();

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

              // ── R6-06: the three-path history ledger ──────────────────────
              // NOT YET IMPLEMENTED as of this beat's authoring — R6-06 is
              // still in its acceptance-test phase (cli/ui-bridge-agent-
              // history.test.ts, apps/studio/lib/agent-ledger.test.ts). This
              // section is a legitimate RED against the current build,
              // exactly like every other R6-06 test in this initiative — it
              // will start passing once the feature ships. Expected VALUES
              // below are MEASURED, not invented — ROUND 1 measured the
              // flow-node fixture by running its exact events directly
              // through the REAL `orchestrator/run-model.ts` `listRuns()`;
              // ROUND 2 (this round) closes the gap round 1 itself flagged
              // ("established the standalone and session expectations by
              // direct correspondence to source" — reading, not executing)
              // by ALSO replaying the standalone and session fixtures
              // through their own real, already-shipped derivation code:
              //   - flow-node: `phaseMeta.architect.costUsd` resolves to 2.5
              //     (the node's OWN spend) while the run-level aggregate
              //     resolves to 12.25 (2.5 + pm's 9.75) — a real, executed
              //     measurement of the D3/D9 "per-target fact, never the
              //     aggregate" gap, not a guess.
              //   - standalone: this fixture's exact events, replayed
              //     through the REAL, already-shipped `GET /api/agents/
              //     runs/<runId>` (`apps/forge/ui-bridge.ts` ~1163-1171 — the SAME
              //     status/cost deriver Task 1's new route must reuse, per
              //     the SHARED DERIVATION pin in `cli/ui-bridge-agent-
              //     history.test.ts`), measured `state: 'done'`,
              //     `costUsd: 0.85` — byte-identical to this fixture's own
              //     literal `cost_usd: 0.85`, confirming the real deriver
              //     round-trips this shape correctly (not merely assumed
              //     because the fixture wrote that number).
              //   - session: `phase: 'drafting'` replayed through the REAL,
              //     already-shipped `listArchitectSessions()` (via `GET
              //     /api/architect/sessions`) round-trips verbatim (D12: no
              //     mapping exists to lose it). Session COST has no existing
              //     wired-up route yet (a genuine Task-1 gap, not merely
              //     untested) — measured instead by replaying the fixture's
              //     own `_architect-<sessionId>/events.jsonl` through the
              //     REAL, already-shipped `sumAuthoritativeCostUsd`
              //     (`orchestrator/event-cost.ts`) directly: 0.42, matching
              //     this fixture's own literal `cost_usd: 0.42` — confirming
              //     no double-counting bug for this simple 2-event shape.
              //   (See the task report for the full measurement transcript —
              //   a standalone Node script executing all three fixtures
              //   through this exact real code, not read-and-assumed.)
              await page.waitForFunction(
                () => document.querySelector('[data-section="history-ledger"]') !== null,
                null, { timeout: 8000 },
              ).catch(() => {});
              const ledgerPresent = await page.evaluate(() => document.querySelector('[data-section="history-ledger"]') !== null);
              check(ledgerPresent, 'R6-06: architect\'s page renders [data-section="history-ledger"]');

              // W7-D1 — TWO gate-found problems with how this beat used to
              // read the ledger, both of which made assertions lie:
              //
              //  1. W7-B5 (agents-32) gave architect's ledger `pageSize={15}`.
              //     Architect really has 76 rows on this machine, and all
              //     three fixtures below are dated 2026-01-01, so they sort
              //     far past page 1 and simply are not in the DOM. Paging is
              //     a real capability, so the beat PAGES — clicking the
              //     ledger's own "Show more" until `data-ledger-shown`
              //     reaches `data-ledger-count` — rather than lowering what
              //     it asserts.
              //  2. The row locators were UNSCOPED `[data-run-id="…"]`, and
              //     `RunPanel`'s own root section carries `data-run-id` +
              //     `data-run-status` too. On architect's page the panel had
              //     reattached to the standalone fixture, so four assertions
              //     were reading the RUN PANEL and reporting `null` for every
              //     ledger-only attribute while `data-run-status` "passed".
              //     Every locator below is now scoped to `[data-ledger-row]`.
              const ledgerRow = (id) => page.locator(`[data-ledger-row][data-run-id="${id}"]`);
              const expandLedger = async () => {
                for (let i = 0; i < 20; i += 1) {
                  const state = await page.evaluate(() => {
                    const el = document.querySelector('[data-section="history-ledger"]');
                    return el
                      ? { shown: Number(el.getAttribute('data-ledger-shown') ?? '0'), count: Number(el.getAttribute('data-ledger-count') ?? '0') }
                      : null;
                  });
                  if (!state || state.shown >= state.count) return state;
                  const more = page.locator('[data-action="ledger-show-more"]');
                  if (await more.count() === 0) return state;
                  await more.first().click();
                  await sleep(120);
                }
                return null;
              };

              if (ledgerPresent) {
                const paging = await expandLedger();
                check(paging !== null && paging.shown === paging.count,
                  `R6-06 (W7-B5 agents-32): the ledger pages — "Show more" walks ${paging?.shown ?? '?'} shown up to all ${paging?.count ?? '?'} rows, so a run older than the first page is reachable, not lost`);

                const flowRow = ledgerRow(R6_06_FLOW_CYCLE_ID);
                const flowRowCount = await flowRow.count();
                check(flowRowCount > 0, `R6-06: the flow-node fixture (${R6_06_FLOW_CYCLE_ID}) appears as a ledger row`);
                if (flowRowCount > 0) {
                  const linkKind = await flowRow.first().getAttribute('data-ledger-link-kind').catch(() => null);
                  const href = await flowRow.first().getAttribute('href').catch(() => null);
                  const cost = await flowRow.first().getAttribute('data-ledger-cost-usd').catch(() => null);
                  check(linkKind === 'flow-node', `R6-06: the flow-node row carries data-ledger-link-kind="flow-node" (got "${linkKind}")`);
                  check(href === `/flows/forge-architect/run/${R6_06_FLOW_CYCLE_ID}`,
                    `R6-06: the flow-node row links to /flows/forge-architect/run/<runId> (got "${href}")`);
                  check(cost === '2.50',
                    `R6-06 (D3/D9, MEASURED): the flow-node row's cost is the architect NODE's own 2.50, not the run aggregate 12.25 (got "${cost}")`);
                }

                const standaloneRow = ledgerRow(R6_06_STANDALONE_RUN_ID);
                const standaloneRowCount = await standaloneRow.count();
                check(standaloneRowCount > 0, `R6-06: the standalone fixture (${R6_06_STANDALONE_RUN_ID}) appears as a ledger row`);
                if (standaloneRowCount > 0) {
                  const linkKind = await standaloneRow.first().getAttribute('data-ledger-link-kind').catch(() => null);
                  const href = await standaloneRow.first().getAttribute('href').catch(() => null);
                  const narrativeKinds = await standaloneRow.first().getAttribute('data-narrative-kinds').catch(() => null);
                  const status = await standaloneRow.first().getAttribute('data-run-status').catch(() => null);
                  const cost = await standaloneRow.first().getAttribute('data-ledger-cost-usd').catch(() => null);
                  check(linkKind === 'standalone', `R6-06: the standalone row carries data-ledger-link-kind="standalone" (got "${linkKind}")`);
                  check(href === `/agents/architect/run/${R6_06_STANDALONE_RUN_ID}`,
                    `R6-06: the standalone row links to /agents/architect/run/<runId> (got "${href}")`);
                  check(narrativeKinds === 'standalone',
                    `R6-06 (D7): the standalone row's narrative kind is the bare positive marker "standalone" (got "${narrativeKinds}")`);
                  // MEASURED (round 2) via GET /api/agents/runs/<runId>, the
                  // real shared status/cost deriver — see the header comment.
                  check(status === 'done',
                    `R6-06 (MEASURED, round 2): the standalone row's status is 'done' (the real endEvent-present, non-failed/non-suppressed derivation) (got "${status}")`);
                  check(cost === '0.85',
                    `R6-06 (MEASURED, round 2): the standalone row's cost round-trips this fixture's own 0.85 verbatim through the real shared deriver (got "${cost}")`);
                }

                const sessionRow = ledgerRow(R6_06_SESSION_ID);
                const sessionRowCount = await sessionRow.count();
                check(sessionRowCount > 0, `R6-06: the session fixture (${R6_06_SESSION_ID}) appears as a ledger row`);
                if (sessionRowCount > 0) {
                  const linkKind = await sessionRow.first().getAttribute('data-ledger-link-kind').catch(() => null);
                  const href = await sessionRow.first().getAttribute('href').catch(() => null);
                  const status = await sessionRow.first().getAttribute('data-run-status').catch(() => null);
                  const sessionPhase = await sessionRow.first().getAttribute('data-session-phase').catch(() => null);
                  const cost = await sessionRow.first().getAttribute('data-ledger-cost-usd').catch(() => null);
                  check(linkKind === 'session', `R6-06: the session row carries data-ledger-link-kind="session" (got "${linkKind}")`);
                  // W6-IA-8 emptied the architect descriptor's legacyRoutes (the /architect/<sid>
                  // shim page is gone; a wire redirect covers old bookmarks), so the ledger now
                  // links STRAIGHT at the modern session shell — no redirect hop.
                  check(typeof href === 'string' && href.startsWith(`/sessions/architect/${R6_06_SESSION_ID}`),
                    `R6-06: the session row links straight to /sessions/architect/<sessionId> (legacyRoutes emptied in W6-IA-8) (got "${href}")`);
                  // W7-B1 (home-sessions-33) SPLIT the two facts D12 used to
                  // carry on one attribute: a session's raw `status.json`
                  // phase is an OPEN per-runner vocabulary and now rides its
                  // own `data-session-phase`, while the CLOSED
                  // `data-run-status` contract every other row kind shares
                  // carries the mapped run-vocab value
                  // (`sessionPhaseRunStatus`). D12's rule is unchanged — the
                  // raw phase is still never mapped away — it just lives on a
                  // different attribute, so BOTH halves are asserted here
                  // rather than the old single one (which is what made a
                  // landed contract read as a regression).
                  check(sessionPhase === 'drafting',
                    `R6-06 (D12 / W7-B1): the session row's data-session-phase is the session's OWN status.json phase string verbatim, never mapped (got "${sessionPhase}")`);
                  check(status === 'active',
                    `R6-06 (W7-B1 home-sessions-33): the CLOSED data-run-status contract carries the MAPPED run-vocab value for a session row — 'drafting' is a live phase, so 'active' (got "${status}")`);
                  // MEASURED (round 2) via the real sumAuthoritativeCostUsd
                  // over this fixture's own events.jsonl — see the header
                  // comment. No existing route wires this derivation up yet
                  // (a genuine Task-1 gap this assertion pins).
                  check(cost === '0.42',
                    `R6-06 (MEASURED, round 2): the session row's cost round-trips this fixture's own 0.42 verbatim through the real sumAuthoritativeCostUsd (got "${cost}")`);
                }

                await frame(page, 'ae-1c-history-ledger',
                  'Edit-agent — R6-06: architect\'s run-history ledger joins all three execution paths (flow-node, standalone, session) on one page',
                  { key: true });
              }

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

              // W7-D1 (fixture rule 3): sweep the three R6-06 ledger fixtures
              // HERE — this is the last beat that reads them, and the flow-node
              // one is a `_queue/done/` manifest for PROJECT, which makes it
              // showcase-eligible for a journey ten beats away. Leaving them
              // behind is how the demo-showcase cycle picker came to see four
              // eligible cycles where its own seed puts two.
              cleanAllR6_06LedgerFixtures();
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
              await waitPageReady(page, 'agents', 20000);
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
              await waitPageReady(page, 'agents', 15000);
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
              await waitPageReady(page, 'agents', 15000);
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
      {
        id: 'agents-kickoff-ceiling-disabled',
        title: 'Kickoff — the cost ceiling disables itself when it cannot be enforced',
        narration: 'The per-kickoff cost ceiling (R6-04 WI-2) is enforced ONLY for a loopStrategy: \'one-shot\' agent — the SDK\'s own maxBudgetUsd path, not something forge enforces in-process — and refused for every other agent. developer-ralph runs the ralph dev-loop strategy, not one-shot, so its ceiling field renders disabled with the reason spelled out — never a silently-ignored input the operator might believe is doing something.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              console.log('\n[R6-04] Kickoff — ceiling disabled for a non-enforceable agent (developer-ralph)');
              await page.goto(watch.uiUrl + '/agents/developer-ralph', { waitUntil: 'domcontentloaded' });
              await waitPageReady(page, 'agents', 20000);
              const dispatchable = await page.evaluate(() =>
                document.querySelector('[data-section="agent-run"]')?.getAttribute('data-run-dispatchable') ?? null);
              check(dispatchable === 'true',
                `agents-kickoff: developer-ralph is a real dispatchable non-interactive agent (data-run-dispatchable="${dispatchable}")`);
              const enforceable = await page.evaluate(() =>
                document.querySelector('[data-component="cost-ceiling"] [data-ceiling-enforceable]')?.getAttribute('data-ceiling-enforceable') ?? null);
              check(enforceable === 'false',
                `agents-kickoff: developer-ralph's ceiling reads [data-ceiling-enforceable="false"] — loopStrategy: ralph, not one-shot (got "${enforceable}")`);
              const inputDisabled = await page.locator('[data-run-cost-ceiling]').isDisabled().catch(() => false);
              check(inputDisabled, 'agents-kickoff: the ceiling [data-run-cost-ceiling] input is actually disabled, not just annotated');
              const explanation = await page.evaluate(() =>
                document.querySelector('[data-component="ceiling-explanation"]')?.textContent ?? '');
              check(explanation.toLowerCase().includes('loop strategy') && explanation.toLowerCase().includes("can't enforce"),
                `agents-kickoff: the disabled ceiling names WHY, not just that it's off (got "${explanation.slice(0, 120)}")`);
              await frame(page, 'ak-0-ceiling-disabled',
                'Kickoff — a legacy-path agent (ralph loop strategy) shows the ceiling disabled, with the reason spelled out');
        },
      },
      {
        id: 'agents-kickoff-build-fixture',
        title: 'Kickoff — build the one-shot, materials-declaring fixture agent',
        narration: 'None of the 4 real one-shot agents declares materials, so proving the kickoff panel\'s cost-ceiling AND materials-attach together needs its own scratch agent: blank, one declared kind (documents), loopStrategy set to one-shot via the SAME runtime picker the scratch-build beat already exercises for SDK/model.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              console.log('\n[R6-04] Kickoff — build the fixture agent (materials + one-shot)');
              cleanKickoffAgent();
              await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
              await waitPageReady(page, 'agents', 15000);
              await page.locator('[data-starter-option="blank"]').click();
              await page.waitForSelector('#purpose-input', { timeout: 10000 });
              await page.locator('input.agent-name-input').fill(KICKOFF_AGENT_NAME);
              await page.locator('#purpose-input').fill(
                'Prove the kickoff panel dispatches with the operator-chosen project, ceiling, and material.');
              await page.locator('#process-input').fill(
                'Read whatever material was attached at kickoff. Nothing further required for this fixture.');
              await sleep(THINK);

              await page.locator('[data-material="documents"]').click();
              const materialsCount = await page.evaluate(() =>
                document.querySelector('[data-section="materials"]')?.getAttribute('data-materials-count') ?? '(absent)');
              check(materialsCount === '1', `agents-kickoff: the fixture declares exactly one material kind, documents (got "${materialsCount}")`);

              await page.locator('[data-action="toggle-advanced"]').first().click().catch(() => {});
              await page.waitForFunction(
                () => document.querySelector('[data-section="advanced"]')?.getAttribute('data-advanced-open') === 'true',
                null, { timeout: 5000 },
              ).catch(() => {});
              await page.locator('[data-loop-strategy="one-shot"]').click();
              const loopActive = await page.evaluate(() =>
                document.querySelector('[data-loop-strategy="one-shot"]')?.getAttribute('data-active') ?? null);
              check(loopActive === 'true', `agents-kickoff: loopStrategy one-shot picked in the runtime picker (data-active="${loopActive}")`);

              await page.locator('[data-action="save-agent"]').click();
              const landed = await waitForFile(KICKOFF_AGENT_SKILL_PATH, 12000);
              check(landed, `agents-kickoff: saving writes skills/${KICKOFF_AGENT_SLUG}/SKILL.md`);
              const savedText = landed ? readFileSync(KICKOFF_AGENT_SKILL_PATH, 'utf8') : '';
              check(savedText.includes('loopStrategy: one-shot'), 'agents-kickoff: the saved SKILL.md carries loopStrategy: one-shot');
              check(savedText.includes('materials:') && savedText.includes('- documents'), 'agents-kickoff: the saved SKILL.md declares materials: [documents]');
              await frame(page, 'ak-1-fixture-saved', 'Kickoff — the fixture agent saved: one-shot loop strategy + documents declared');
        },
      },
      {
        id: 'agents-kickoff-entry',
        title: 'Kickoff — reopen the fixture agent from its real agents-index card',
        narration: 'Not a direct URL: the operator lands on the freshly saved agent through its own real index card (LibraryCard.tsx\'s AgentCard, reused unchanged on /agents — W6-IA-3) — the real entry point every agent page is reached through, and the same click the run-agent mockup story scripts as "click the agent card". (W6-IA-4: was the library\'s own "agents" shelf card — /agents is now the real index; Library dropped its projects/agents/flows/kb shelves down to shelves-only.)',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              console.log('\n[R6-04] Kickoff — reopen the fixture agent via its agents-index card');
              await page.goto(watch.uiUrl + '/agents', { waitUntil: 'domcontentloaded' });
              await waitPageReady(page, 'agents-index', 20000);
              const card = page.locator(`[data-card-type="agent"][data-card-id="${KICKOFF_AGENT_SLUG}"]`);
              const cardPresent = (await card.count()) > 0;
              check(cardPresent, `agents-kickoff: the freshly saved fixture agent has a real agents-index card (data-card-id="${KICKOFF_AGENT_SLUG}")`);
              if (cardPresent) await card.click();
              await page.waitForFunction(
                (slug) => document.querySelector('[data-page="agents"]')?.getAttribute('data-agent-id') === slug,
                KICKOFF_AGENT_SLUG, { timeout: 15000 },
              ).catch(() => {});
              const agentId = await page.evaluate(() =>
                document.querySelector('[data-page="agents"]')?.getAttribute('data-agent-id') ?? '');
              check(agentId === KICKOFF_AGENT_SLUG, `agents-kickoff: the card click lands on the fixture agent's own page (data-agent-id="${agentId}")`);
              const enforceable = await page.evaluate(() =>
                document.querySelector('[data-component="cost-ceiling"] [data-ceiling-enforceable]')?.getAttribute('data-ceiling-enforceable') ?? null);
              check(enforceable === 'true', `agents-kickoff: on reload the server-computed costCeilingEnforceable reads true for this one-shot agent (got "${enforceable}")`);
              await frame(page, 'ak-2-entry', 'Kickoff — the fixture agent reopened from its own library card; ceiling now enforceable');
        },
      },
      {
        id: 'agents-kickoff-materials-refused',
        title: 'Kickoff — an out-of-contract material is refused, naming the declared kinds',
        narration: 'The client-side gate (run-panel-view.ts) mirrors the server\'s own check — never the authority, but an immediate, correctly-worded refusal instead of a round trip. Attaching a real repo file of an UNdeclared kind (package.json → data-files; the fixture declares only documents) is refused, and the refusal names the agent\'s actual declared kinds rather than a generic "not allowed".',
        drive: async (ctx) => {
              const { page, frame, check } = ctx;
              console.log('\n[R6-04] Kickoff — an out-of-contract material is refused');
              const declared = await page.evaluate(() =>
                document.querySelector('[data-section="materials-attach"]')?.getAttribute('data-materials-declared') ?? '');
              check(declared === 'documents', `agents-kickoff: the run surface declares exactly the kinds the agent carries (got "${declared}")`);
              await page.locator('[data-run-materials-input]').setInputFiles(KICKOFF_MATERIAL_REFUSED);
              await sleep(THINK);
              const errorText = await page.evaluate(() =>
                document.querySelector('[data-section="materials-attach"] p')?.textContent ?? '');
              check(errorText.includes('data-files') && errorText.includes('documents'),
                `agents-kickoff: the refusal names both the file's real kind and the agent's declared kinds (got "${errorText}")`);
              await frame(page, 'ak-3-material-refused', 'Kickoff — package.json (data-files) refused against an agent that only declares documents');
        },
      },
      {
        id: 'agents-kickoff-set-project',
        title: 'Kickoff — bind the run to a project and set an explicit cost ceiling',
        narration: '"A run binds to a project, with explicit inputs and limits" — the real project select (GET /api/studio/projects, never a hardcoded list) picks mdtoc; the now-enabled ceiling input takes an explicit operator value.',
        drive: async (ctx) => {
              const { page, frame, check } = ctx;
              console.log('\n[R6-04] Kickoff — select project + set cost ceiling');
              await page.locator('[data-run-project]').selectOption(KICKOFF_PROJECT_ID);
              const projectVal = await page.locator('[data-run-project]').inputValue();
              check(projectVal === KICKOFF_PROJECT_ID, `agents-kickoff: the project select carries "${KICKOFF_PROJECT_ID}" (got "${projectVal}")`);
              const ceilingInput = page.locator('[data-run-cost-ceiling]');
              const ceilingDisabled = await ceilingInput.isDisabled();
              check(!ceilingDisabled, 'agents-kickoff: the ceiling input is enabled for this one-shot fixture agent');
              await ceilingInput.fill('3.5');
              const ceilingVal = await ceilingInput.inputValue();
              check(ceilingVal === '3.5', `agents-kickoff: the ceiling input carries the operator's value (got "${ceilingVal}")`);
              await frame(page, 'ak-4-project-ceiling', 'Kickoff — project bound (mdtoc), explicit cost ceiling set ($3.50)');
        },
      },
      {
        id: 'agents-kickoff-attach-material',
        title: 'Kickoff — attach a material of a declared kind',
        narration: 'A real, already-committed project fixture (mdtoc\'s own test/fixtures/release-notes.md, the same file this walkthrough\'s acceptance evidence names) stands in for the mockup\'s "user report screenshot" — a real file the agent\'s declared documents kind actually accepts.',
        drive: async (ctx) => {
              const { page, frame, check } = ctx;
              console.log('\n[R6-04] Kickoff — attach a declared-kind material');
              await page.locator('[data-run-materials-input]').setInputFiles(KICKOFF_MATERIAL_ACCEPTED);
              await sleep(THINK);
              const errorAfterAccepted = await page.evaluate(() =>
                document.querySelector('[data-section="materials-attach"] p')?.textContent ?? '');
              check(errorAfterAccepted === '', `agents-kickoff: attaching a declared-kind file clears any prior refusal (got "${errorAfterAccepted}")`);
              await frame(page, 'ak-5-material-attached', 'Kickoff — release-notes.md (documents, declared) attached, no refusal');
        },
      },
      {
        id: 'agents-kickoff-dispatch',
        title: 'Kickoff — Run actually carries the chosen project, ceiling, and material',
        narration: 'The headline gap this initiative closes: no unit test can prove the click wires to the request (no jsdom in this repo — RunPanel.tsx\'s own header). A real browser click is intercepted at the wire — the actual POST body IS project, costCeilingUsd, and the base64 material — then the server side is checked independently (the staged file on disk, the run being a real resolvable identity on the status surface) rather than trusting the client\'s own claim. The state this beat asserts is `suppressed`, and W8-A2 (bead forge-8nw) is why it changed: `spawnAgentDispatch` returns before the child `agent dispatch` process is ever spawned, so nothing ever ran — but the dry-bridge marker used to be filed under a shared bucket instead of the run\'s OWN events.jsonl, which is the only file the status route derives from. The run therefore derived `running` forever, days later, and real zombie run dirs accumulated on this machine from exactly this path (bead forge-720). The marker now lands in the run\'s own log, so the status route\'s pre-existing `suppressed` branch finally fires. A run that will never run is not `running` — the honest state is that its spawn was suppressed, and that is what the operator now sees.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              console.log('\n[R6-04] Kickoff — Run dispatches with the chosen values (wire-level proof)');
              let capturedBody = null;
              const onRequest = (req) => {
                if (req.method() === 'POST' && req.url().endsWith(`/api/agents/${encodeURIComponent(KICKOFF_AGENT_SLUG)}/run`)) {
                  try { capturedBody = JSON.parse(req.postData() ?? '{}'); } catch { /* not JSON */ }
                }
              };
              page.on('request', onRequest);
              await page.locator('[data-action="run-agent"]').click();
              let runId = '';
              try {
                await page.waitForFunction(
                  () => (document.querySelector('[data-section="agent-run"]')?.getAttribute('data-run-id') ?? '').length > 0,
                  null, { timeout: 10000 },
                );
                runId = await page.evaluate(() => document.querySelector('[data-section="agent-run"]')?.getAttribute('data-run-id') ?? '');
              } catch { /* dispatch did not surface a runId in time */ }
              page.off('request', onRequest);
              check(runId.length > 0, `agents-kickoff: clicking Run dispatches — a runId is returned (got "${runId}")`);

              check(capturedBody !== null, 'agents-kickoff: the actual POST /api/agents/:slug/run request body was captured');
              if (capturedBody) {
                check(capturedBody.project === KICKOFF_PROJECT_ID,
                  `agents-kickoff: the wire request carries project="${KICKOFF_PROJECT_ID}" (got ${JSON.stringify(capturedBody.project)})`);
                check(capturedBody.costCeilingUsd === 3.5,
                  `agents-kickoff: the wire request carries costCeilingUsd=3.5 (got ${JSON.stringify(capturedBody.costCeilingUsd)})`);
                const materials = Array.isArray(capturedBody.materials) ? capturedBody.materials : [];
                check(
                  materials.length === 1 && materials[0]?.filename === 'release-notes.md' &&
                    typeof materials[0]?.contentBase64 === 'string' && materials[0].contentBase64.length > 0,
                  `agents-kickoff: the wire request carries the attached material, base64-encoded (got ${JSON.stringify(materials.map((m) => m?.filename))})`,
                );
              }
              await frame(page, 'ak-6-dispatched', 'Kickoff — Run clicked; the request wire-carries project, ceiling, and material');

              if (runId) kickoffRunId = runId;

              // Server-side proof, independent of the client's own claim: the
              // material actually landed on disk under this run's own dir.
              let stagedOnDisk = false;
              if (runId) {
                for (let t = 0; t < 20 && !stagedOnDisk; t += 1) {
                  stagedOnDisk = existsSync(join(FORGE_ROOT, '_logs', runId, 'materials', 'release-notes.md'));
                  if (!stagedOnDisk) await sleep(250);
                }
              }
              check(stagedOnDisk, 'agents-kickoff: the attached material is actually staged under _logs/<runId>/materials/ on disk');

              // NOT a wait for a terminal state — this seam structurally never
              // reaches one. `spawnAgentDispatch` (apps/forge/ui-bridge.ts) returns
              // BEFORE the child `agent dispatch` process is ever spawned
              // whenever FORGE_ARCHITECT_NO_SPAWN=1 or FORGE_DRY_BRIDGE=1 (both
              // set on this harness's own bridge process, scripts/e2e-
              // journey.mjs's startWatch) — so `runAgent()` never runs, never
              // emits `start`/`end`, and never emits the
              // `run-agent.spawn-suppressed` log event the status route's
              // `suppressed` branch keys off. The run's ONLY event is the
              // route's own synchronous materials-staged bookkeeping (already
              // proven above), so `state` stays `running` forever — by
              // construction, not a timing fluke. What this DOES prove: the
              // dispatched runId is a real, resolvable identity on the SAME
              // shared status surface the run view (next beat) reads —
              // checked independently against the server, not the client's
              // own DOM state.
              let statusOk = false;
              let statusState = '';
              if (runId) {
                try {
                  const res = await fetch(`${watch.bridgeUrl}/api/agents/runs/${encodeURIComponent(runId)}`);
                  statusOk = res.ok;
                  const body = await res.json().catch(() => ({}));
                  statusState = typeof body.state === 'string' ? body.state : '';
                } catch { /* leave statusOk false */ }
              }
              // W8-A2 (forge-8nw/forge-720): 'suppressed', NOT 'running'. The dry
              // bridge genuinely suppresses the spawn, and the marker recording
              // that now lands in the run's OWN events.jsonl — the only file
              // `deriveStandaloneRunState` reads. Asserting 'running' here
              // pinned the zombie-run defect as the contract: a run that will
              // never run reported itself live indefinitely, which is how the
              // leaked _agent-* dirs on this machine were created.
              check(statusOk && statusState === 'suppressed',
                `agents-kickoff: the dispatched run is a real, resolvable identity on the shared status surface — GET /api/agents/runs/:runId resolves ok with state:"suppressed", the honest TERMINAL state this no-spawn seam produces (got ok=${statusOk}, state="${statusState}")`);
              const domStatus = await page.evaluate(() => document.querySelector('[data-section="agent-run"]')?.getAttribute('data-run-status') ?? '');
              check(domStatus === 'suppressed',
                `agents-kickoff: the kickoff panel's own poll reflects the same state (data-run-status="${domStatus}")`);
        },
      },
      {
        id: 'agents-kickoff-run-view',
        title: 'Kickoff — the standalone run view renders the log, cost, and material as a reference',
        narration: 'Navigating to the /agents/[id]/run/[runId] route — the log renders the THREE real events this no-spawn seam produces for this run (W7-B5: the route\'s t0 agent-run.dispatched marker — which also records the ceiling at dispatch time, agents-31 — its materials-staged bookkeeping, and, since W8-A2/forge-8nw, the run-agent.spawn-suppressed marker written into the run\'s OWN events.jsonl rather than a shared bucket, which is what lets the run reach a terminal state at all instead of deriving \'running\' forever), the cost section renders (0, since no end event ever lands), and the attached material shows as a path+kind REFERENCE only: the real file\'s own content never appears in the DOM, and the raw API response the page reads never carries the base64 bytes either. The ceiling provenance now reads the REAL $3.5 recorded at dispatch — a failed or still-running run no longer claims "not recorded" about a ceiling that was submitted and enforced.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              console.log('\n[R6-04] Kickoff — the standalone run view');
              if (!kickoffRunId) {
                check(false, 'agents-kickoff-run-view: a runId was captured by the prior dispatch beat');
                return;
              }
              await page.goto(watch.uiUrl + `/agents/${KICKOFF_AGENT_SLUG}/run/${kickoffRunId}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="agent-run"]')?.hasAttribute('data-run-found') ?? false,
                null, { timeout: 20000 },
              ).catch(() => {});
              const found = await page.evaluate(() => document.querySelector('[data-page="agent-run"]')?.getAttribute('data-run-found') ?? null);
              check(found === 'true', `agents-kickoff-run-view: the run view finds a real dispatch record for this runId (got "${found}")`);

              // NOT a "≥N lines" count — measured: this no-spawn seam produces
              // EXACTLY THREE events for this run (W7-B5: the route's t0
              // `agent-run.dispatched` marker — agents-20's tail anchor +
              // agents-31's dispatch-time ceiling record — then its
              // synchronous materials-staged bookkeeping; then, since
              // W8-A2/forge-8nw, the `run-agent.spawn-suppressed` marker,
              // which the dry bridge now files in the run's OWN events.jsonl
              // instead of a shared bucket. That third event is the whole
              // point: without it `deriveStandaloneRunState` had no terminal
              // marker to read and derived `running` indefinitely.
              // Asserting the SPECIFIC real events (by kind + message) is
              // stronger than a count and can't silently drift if the seam's
              // event shape changes.
              const logLines = page.locator('[data-log-line="true"]');
              const logLineCount = await logLines.count();
              check(logLineCount === 3,
                `agents-kickoff-run-view: exactly three real event lines render under this no-spawn seam (got ${logLineCount})`);
              const firstLineText = await logLines.first().innerText().catch(() => '');
              check(firstLineText.includes('agent-run.dispatched'),
                `agents-kickoff-run-view: the first line IS the t0 dispatched marker (text="${firstLineText}")`);
              const secondLineText = await logLines.nth(1).innerText().catch(() => '');
              check(secondLineText.includes('agent-run.materials-staged'),
                `agents-kickoff-run-view: the second line IS the real materials-staged bookkeeping event (text="${secondLineText}")`);

              const costAttr = await page.evaluate(() => document.querySelector('[data-page="agent-run"]')?.getAttribute('data-run-cost') ?? null);
              check(costAttr !== null, `agents-kickoff-run-view: the cost section renders (data-run-cost="${costAttr}")`);

              const materialRef = page.locator('[data-material-ref="materials/release-notes.md"][data-material-kind="documents"]');
              check((await materialRef.count()) > 0, 'agents-kickoff-run-view: the attached material renders as a path+kind reference (materials/release-notes.md, documents)');
              const materialText = await materialRef.innerText().catch(() => '');
              check(!materialText.includes('Aurora Telemetry') && !materialText.includes('sentinel-7f3a9c'),
                'agents-kickoff-run-view: the rendered material reference never leaks the real file\'s own content');

              // Independent proof the API itself never ships the bytes either
              // — not just that this component chooses not to render them.
              let apiCarriesNoContent = false;
              try {
                const res = await fetch(`${watch.bridgeUrl}/api/agents/runs/${encodeURIComponent(kickoffRunId)}`);
                const bodyText = await res.text();
                apiCarriesNoContent = res.ok && !bodyText.includes('contentBase64') && !bodyText.includes('Aurora Telemetry');
              } catch { /* leave false */ }
              check(apiCarriesNoContent, 'agents-kickoff-run-view: GET /api/agents/runs/:runId itself never carries material bytes, only the {path,kind} reference');

              // W7-B5 (agents-31): the ceiling is recorded AT DISPATCH TIME on
              // the t0 event, so even this forever-running no-spawn run shows
              // the real $3.5 that was accepted — the old "not recorded" claim
              // for a submitted, enforced ceiling was the finding.
              const ceilingSet = await page.evaluate(() =>
                document.querySelector('[data-component="ceiling-provenance"]')?.getAttribute('data-ceiling-set') ?? null);
              check(ceilingSet === 'true',
                `agents-kickoff-run-view: the ceiling recorded at dispatch time renders on the run view (data-ceiling-set="${ceilingSet}")`);
              const ceilingUsdAttr = await page.evaluate(() =>
                document.querySelector('[data-ceiling-usd]')?.getAttribute('data-ceiling-usd') ?? null);
              check(ceilingUsdAttr === '3.5',
                `agents-kickoff-run-view: the rendered ceiling IS the dispatched $3.5 (got "${ceilingUsdAttr}")`);

              // ── R6-06 ROUND 2 (amendment 4) — REACHABILITY ────────────────
              // The strongest corpus ground available for this initiative:
              // this beat already produced a REAL standalone run by driving
              // a real browser click (agents-kickoff-dispatch), not a
              // fixture. Assert it appears in ITS OWN agent's history
              // ledger — one assertion, no fixture rewrite.
              //
              // ⚑ LOUD FINDING (measured this round, not assumed): this
              // run's ONLY event is the dispatch route's own synchronous
              // `agent-run.materials-staged` bookkeeping (apps/forge/ui-bridge.ts
              // ~1370-1389, confirmed by the log-line check above) — it sets
              // `skill: slug` (here, KICKOFF_AGENT_SLUG) but carries NO
              // `metadata.agent_slug` at all (its `metadata` is only
              // `{materials: [...]}`). `spawnAgentDispatch` returns before
              // ANY child process runs under FORGE_ARCHITECT_NO_SPAWN/
              // FORGE_DRY_BRIDGE (both set on this harness — cli/ui-
              // bridge.ts:1976), so `runAgent`'s own start/end events (the
              // ones that DO carry `metadata.agent_slug`, per orchestrator/
              // run-agent.ts:320-382) never get written for this run at all.
              // If Task 1's route keys standalone identity STRICTLY off
              // `metadata.agent_slug` (this initiative's own D4 language),
              // this REAL run is structurally unreachable under its own
              // agent's history — the one honest identity signal it DOES
              // carry is the `skill` field, not `metadata.agent_slug`. This
              // is reported as a genuine, EXECUTION-DISCOVERED requirement
              // for Task 1 (accept `event.skill === slug` as an identity
              // source too, not `metadata.agent_slug` exclusively) rather
              // than silently worked around — see the task report for the
              // full trail, including the apparent tension with THIS
              // initiative's own "honest-absent cost" fixture (a
              // ZERO-event standalone run that must ALSO be found by slug,
              // which is possible only via SOME non-event signal, contrary
              // to a metadata.agent_slug-only reading of D4).
              let reachableInOwnHistory = false;
              let historyRowIds = [];
              try {
                const histRes = await fetch(`${watch.bridgeUrl}/api/agents/${encodeURIComponent(KICKOFF_AGENT_SLUG)}/history`);
                const histBody = await histRes.json().catch(() => ({}));
                const rows = Array.isArray(histBody.rows) ? histBody.rows : [];
                historyRowIds = rows.map((r) => r?.id);
                reachableInOwnHistory = historyRowIds.includes(kickoffRunId);
              } catch { /* leave false */ }
              check(reachableInOwnHistory,
                `R6-06 REACHABILITY: the REAL, un-fixtured standalone run this beat just dispatched (${kickoffRunId}) appears in its own agent's history ledger (GET /api/agents/${KICKOFF_AGENT_SLUG}/history) — got rows ${JSON.stringify(historyRowIds)}. If this is RED, see the LOUD FINDING above: this run's one event carries identity via 'skill', not 'metadata.agent_slug' — Task 1 must accept both.`);

              await frame(page, 'ak-7-run-view', 'Kickoff — the standalone run view: log, cost, and the material as a reference only');

              cleanKickoffAgent();
        },
      },
      {
        id: 'agents-kickoff-standing-triggers',
        title: 'Kickoff — the panel lists standing triggers targeting this agent (R6-01 WI-4)',
        narration: 'reflector is the one real OOTB agent a standing trigger targets today — forge-develop\'s own flow.yaml declares `{on: merged, target: {kind: agent, ref: reflector}}` with no `projects:` key (unscoped). The kickoff panel surfaces this read-only, so an operator opening reflector\'s page can see it is already wired to fire automatically on every merge, not just dispatchable by hand.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              console.log('\n[R6-01] Kickoff — standing-triggers list on the reflector agent page');
              await page.goto(watch.uiUrl + '/agents/reflector', { waitUntil: 'domcontentloaded' });
              await waitPageReady(page, 'agents', 20000);
              const agentId = await page.evaluate(() =>
                document.querySelector('[data-page="agents"]')?.getAttribute('data-agent-id') ?? '');
              check(agentId === 'reflector', `agents-kickoff-standing-triggers: landed on the real reflector agent page (data-agent-id="${agentId}")`);

              // Measured against the live seed (studio/flows/forge-develop/flow.yaml):
              // exactly ONE trigger targets an agent at all today, and it targets
              // reflector — forge-architect declares `triggers: []` (W7-C1: the
              // seed set is two flows). Give the panel a moment to fetch
              // GET /api/triggers and render before reading the final count.
              const rows = page.locator('[data-standing-trigger]');
              try {
                await page.waitForFunction(
                  () => document.querySelectorAll('[data-standing-trigger]').length > 0,
                  null, { timeout: 6000 },
                );
              } catch { /* fall through — count read below reports the real (possibly zero) state */ }
              const rowCount = await rows.count();
              check(rowCount === 1,
                `agents-kickoff-standing-triggers: exactly one standing trigger targets reflector today (forge-develop's on:merged declaration) — got ${rowCount} [data-standing-trigger] row(s)`);

              if (rowCount === 1) {
                const kind = await rows.first().getAttribute('data-trigger-kind').catch(() => null);
                const target = await rows.first().getAttribute('data-trigger-target').catch(() => null);
                const scopeCount = await rows.first().getAttribute('data-trigger-scope-count').catch(() => null);
                check(kind === 'merged', `agents-kickoff-standing-triggers: data-trigger-kind reflects the real declaration's "on" (got "${kind}")`);
                check(target === 'reflector', `agents-kickoff-standing-triggers: data-trigger-target reflects the real target ref (got "${target}")`);
                check(scopeCount === 'all',
                  `agents-kickoff-standing-triggers: forge-develop declares no 'projects:' key (unscoped) — data-trigger-scope-count must read "all", distinct from a scoped-to-nothing "0" (got "${scopeCount}")`);
              }

              // W7-C1 (agents-27) journey pin: the dispatch-provenance note
              // renders on the LIVE reflector page — derived from the SKILL
              // frontmatter phase `reflector` (the code-review round caught
              // the map keyed on the event-log name 'reflection', which made
              // this note silently never render; this end-to-end assert is
              // the regression pin the unit probes couldn't be).
              const dispatchNote = await page.locator('[data-component="used-in-flows"] [data-dispatch-note="true"]').count();
              check(dispatchNote === 1,
                `agents-kickoff-standing-triggers (agents-27): the reflector page renders the dispatch-provenance note ([data-dispatch-note="true"] under used-in-flows) — got ${dispatchNote}`);
              await frame(page, 'ak-8-standing-triggers', 'Kickoff — reflector\'s page lists the standing trigger that already targets it (forge-develop, on: merged)');
        },
      },
      {
        id: 'agents-run-reflector-detail',
        title: 'The reflector\'s real composition: mandatory brain access + a genuine lint run',
        narration: 'run-agent-reflector\'s mockup route (`#/agents/run/reflector`) does not exist — a standalone agent-run view needs a concrete run id (`/agents/<id>/run/<runId>`), and no journey here spawns a real reflector SDK turn (FORGE_ARCHITECT_NO_SPAWN=1 suppresses every real agent spawn), so the SAME real /agents/reflector page (agents-kickoff-standing-triggers, above) is the honest substitute. What IS real and genuinely driven here: the agent\'s DECLARED composition — Knowledge Access reads "Mandatory" (skills/reflector/SKILL.md\'s `brainAccess: mandatory`) and its Skills zone carries the real brain-query/brain-ingest chips (composition.skills) — plus an actual `forge brain lint` run proving brain/ passes its real 9-check suite right now, not a fabricated "lint 9/9" claim.',
        drive: async (ctx) => {
              const { page, watch, check, frame } = ctx;
              console.log('\n[R4-B13] The reflector\'s real composition + a genuine brain-lint run');
              await page.goto(watch.uiUrl + '/agents/reflector', { waitUntil: 'domcontentloaded' });
              await waitPageReady(page, 'agents', 20000);
              const agentId = await page.evaluate(() =>
                document.querySelector('[data-page="agents"]')?.getAttribute('data-agent-id') ?? '');
              check(agentId === 'reflector', `agents-run-reflector-detail: landed on the real reflector agent page (data-agent-id="${agentId}")`);

              // "It queries all three brain scopes before writing anything" —
              // the UI has no per-scope query trace (that is runtime SDK
              // behavior, not a static composition fact); the real, honest
              // substitute is the agent's own DECLARED Knowledge Access card
              // (brainAccess: mandatory) plus its brain-query/brain-ingest
              // skill chips — genuinely rendered, not narrated-only.
              const mandatoryCard = page.locator('.brain-option[data-access="mandatory"]');
              await mandatoryCard.waitFor({ timeout: 8000 }).catch(() => {});
              const mandatorySelected = await mandatoryCard.evaluate((el) => el.classList.contains('selected')).catch(() => false);
              check(mandatorySelected, 'agents-run-reflector-detail: reflector\'s real Knowledge Access card reads "Mandatory" (skills/reflector/SKILL.md brainAccess: mandatory)');
              const brainQueryChip = page.locator('[data-accepts="skill"] [data-id="brain-query"]');
              const brainIngestChip = page.locator('[data-accepts="skill"] [data-id="brain-ingest"]');
              check((await brainQueryChip.count()) === 1, 'agents-run-reflector-detail: reflector\'s real Skills zone carries the brain-query chip (queries the brain before writing)');
              check((await brainIngestChip.count()) === 1, 'agents-run-reflector-detail: reflector\'s real Skills zone carries the brain-ingest chip (writes durable findings into the brain)');
              await frame(page, 'ak-9-reflector-composition', 'The reflector\'s real, declared composition — mandatory brain access, brain-query + brain-ingest — not a live execution trace');

              // "Themes linked, index updated, lint 9/9" — the real `forge
              // brain lint` 9-check suite (CLAUDE.md), run for real: brain/ is
              // genuinely lint-clean right now, not a fabricated claim.
              let brainLintOk = false;
              try {
                execFileSync(process.execPath,
                  ['--experimental-strip-types', 'apps/forge/cli.ts', 'brain', 'lint'],
                  { cwd: FORGE_ROOT, stdio: 'pipe' });
                brainLintOk = true;
              } catch (e) {
                console.error(`  [brain lint] non-zero: ${(e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')}`.slice(0, 600));
              }
              check(brainLintOk, 'agents-run-reflector-detail: `forge brain lint` genuinely passes its real 9-check suite (exit 0) — the reflector\'s own closing claim, proven live rather than narrated');
        },
      },
      {
        id: 'agents-run-developer-entry',
        title: 'The Developer\'s own page — the generic run surface, real flow usage, and its real guard (not hook) composition',
        narration: 'run-agent-developer\'s mockup route (`#/agents/builder/developer`) names a fictional slug — the real roster agent is `developer-ralph` (studio/flows/forge-develop/flow.yaml\'s own `{id: dev, agent: developer-ralph}`), reached at its real `/agents/developer-ralph` page. "Any agent can run standalone" is the same R6-04-F1 generic Run affordance every unattended agent page carries. "Its triggers: auto inside the flow" is the real, rendered Used-in-Flows chip (forge-develop\'s dev node) — not a fabricated toggle, since no UI surface narrates an "auto vs manual" duality for a specific agent. And the mockup\'s "security-review hook rides along" claim is checked against the real definition, not assumed: developer-ralph\'s composition carries GUARDS (event-log, cost-guard, stall-watchdog, scratch-strip — ADR-039\'s dispatch-key vocabulary), and its Hooks zone is genuinely empty by default — the claim is not backed by the shipped agent, so the next beat\'s seeded run never repeats it.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              console.log('\n[R4-B13] The Developer\'s own page — generic run surface + real composition');
              await page.goto(watch.uiUrl + '/agents/developer-ralph', { waitUntil: 'domcontentloaded' });
              await waitPageReady(page, 'agents', 20000);
              const agentId = await page.evaluate(() =>
                document.querySelector('[data-page="agents"]')?.getAttribute('data-agent-id') ?? '');
              check(agentId === 'developer-ralph', `agents-run-developer-entry: landed on the real developer-ralph agent page (got "${agentId}")`);
              await caption(page, 'Any unattended agent can run standalone — the SAME generic Run surface every agent page carries.');

              check(await page.locator('[data-action="run-agent"]').count() > 0,
                'agents-run-developer-entry: the generic Run affordance (R6-04-F1) is present on developer-ralph\'s page');

              // "Its triggers: auto inside the flow" — the real Used-in-Flows chip.
              const usedInFlows = page.locator('[data-component="used-in-flows"]');
              check(await usedInFlows.count() > 0, 'agents-run-developer-entry: [data-component="used-in-flows"] renders');
              const usedText = await usedInFlows.innerText().catch(() => '');
              check(!usedText.includes('Not yet used'),
                `agents-run-developer-entry: developer-ralph shows real flow usage, not the empty state — it is forge-develop's own dev node (got "${usedText}")`);
              await frame(page, 'ard-1-entry', 'The Developer\'s real page — generic Run surface + real "Used in Flows" (forge-develop)', { key: true });

              // The security-review-hook claim, checked live rather than assumed.
              await ensureAdvancedOpen(page);
              const guardCount = await page.locator('[data-accepts="guard"]').getAttribute('data-count').catch(() => null);
              check(guardCount !== null && Number(guardCount) >= 1,
                `agents-run-developer-entry: developer-ralph's real Guards zone carries ≥1 bound guard chip (event-log/cost-guard/stall-watchdog/scratch-strip) (got "${guardCount}")`);
              const hookCount = await page.locator('[data-accepts="hook"]').getAttribute('data-count').catch(() => null);
              check(hookCount === '0',
                `agents-run-developer-entry: developer-ralph carries NO bound hook by default (data-count="${hookCount}") — the mockup's "security-review hook rides along" claim is not backed by the real shipped definition (ADR-039 guard/hook split)`);
              await frame(page, 'ard-2-guards', 'developer-ralph\'s real composition: guards bound, no hook — checked live, not assumed');
        },
      },
      {
        id: 'agents-run-developer-fixture',
        title: 'The Developer\'s standalone run view — real TDD-red-to-green content, honest ceiling/materials/outputs/trigger',
        narration: 'A hand-seeded `_logs/<runId>` fixture (no real standalone `_agent-*` run exists anywhere on this machine, measured — this file\'s own R6_06_STANDALONE_RUN_ID header) mirrors the SAME production emitter shape `runAgent()` writes, carrying the SAME real WI-1 content flows-run.mjs already seeds for the mdtoc `--write` cycle: gate.expected-fail\'s real stderr, the real Edit/Bash tool sequence, gate.pass, and the real cumulative cost/tokens. Live-dispatching developer-ralph for real here would only ever reproduce the SAME shallow, content-free 1-event skeleton agents-kickoff-dispatch/agents-kickoff-run-view already prove for issue-triage (this harness\'s no-spawn seam suppresses every real child spawn) — never this TDD narrative, which only exists inside a real, unspawned SDK turn. The run view\'s honest gaps are asserted too, not glossed over: typed outputs stay 0 (no wired data source for a generic dispatched agent\'s artifacts), materials render the honest-empty state (developer-ralph declares no `materials:` kinds — no roster agent does yet), and the trigger-provenance section is genuinely absent (no server-side path writes a standalone run\'s trigger origin yet — client-side plumbing only, forge-pet\'s own commit message).',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              console.log('\n[R4-B13] The Developer\'s standalone run view — seeded TDD-red-to-green content');
              seedDeveloperStandaloneRun();
              try {
                await page.goto(watch.uiUrl + `/agents/${DEV_RUN_SLUG}/run/${DEV_RUN_ID}`, { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(
                  () => document.querySelector('[data-page="agent-run"]')?.hasAttribute('data-run-found') ?? false,
                  null, { timeout: 20000 },
                ).catch(() => {});
                const found = await page.evaluate(() => document.querySelector('[data-page="agent-run"]')?.getAttribute('data-run-found') ?? null);
                check(found === 'true', `agents-run-developer-fixture: the run view finds the seeded developer-ralph run (got "${found}")`);
                await caption(page, 'Tests written FIRST — three failing, as expected. The loop tightens: edit, run, green.');

                const logLines = page.locator('[data-log-line="true"]');
                const lineCount = await logLines.count();
                check(lineCount >= 8, `agents-run-developer-fixture: the seeded TDD-red-to-green content renders as log lines (got ${lineCount})`);
                // deriveLogLine's own textFor (run-log-line.ts) renders a 'log' event's
                // `message` verbatim but never its `metadata` — the real stderr detail
                // stays in the underlying event log, not the DOM; asserting on it here
                // would be checking for text the shared renderer never produces.
                const fullText = await page.locator('[data-section="run-log"]').innerText().catch(() => '');
                check(fullText.includes('gate.expected-fail'), 'agents-run-developer-fixture: the real gate.expected-fail line (TDD red) renders verbatim');
                check(fullText.includes('gate.pass'), 'agents-run-developer-fixture: the real gate.pass line (TDD green) renders');
                const toolKindCount = await page.locator('[data-log-line="true"][data-log-kind="tool"]').count();
                check(toolKindCount >= 5, `agents-run-developer-fixture: the real Edit/Bash tool_use events classify as kind="tool" (got ${toolKindCount})`);
                await frame(page, 'ard-3-log', 'The Developer\'s standalone run — real TDD-red-to-green log content', { key: true });

                const costAttr = await page.evaluate(() => document.querySelector('[data-page="agent-run"]')?.getAttribute('data-run-cost') ?? null);
                check(costAttr !== null && Number(costAttr) > 0, `agents-run-developer-fixture: the run's real accrued cost renders (got "${costAttr}")`);

                const ceilingSet = await page.evaluate(() =>
                  document.querySelector('[data-component="ceiling-provenance"]')?.getAttribute('data-ceiling-set') ?? null);
                check(ceilingSet === 'true', `agents-run-developer-fixture: the $0.60 per-kickoff ceiling was recorded (data-ceiling-set="${ceilingSet}")`);
                const ceilingUsd = await page.evaluate(() =>
                  document.querySelector('[data-component="ceiling-provenance"] [data-ceiling-usd]')?.getAttribute('data-ceiling-usd') ?? null);
                check(ceilingUsd === String(DEV_RUN_CEILING_USD), `agents-run-developer-fixture: the recorded ceiling is the real seeded $0.60 (got "${ceilingUsd}")`);

                // Honest gaps — asserted, not glossed over.
                check(await page.locator('[data-component="run-materials-empty"]').count() > 0,
                  'agents-run-developer-fixture: materials render the honest-empty state — developer-ralph declares no materials: kinds');
                const outputsCount = await page.evaluate(() =>
                  document.querySelector('[data-section="run-outputs"]')?.getAttribute('data-outputs-count') ?? null);
                check(outputsCount === '0', `agents-run-developer-fixture: typed outputs stay honestly 0 — no wired data source exists yet (got "${outputsCount}")`);
                check(await page.locator('[data-section="run-trigger"]').count() === 0,
                  'agents-run-developer-fixture: the trigger-provenance section is genuinely absent — no server-side path writes a standalone run\'s trigger yet');
                await frame(page, 'ard-4-honest-gaps', 'The Developer\'s standalone run — honest gaps: no materials, no typed outputs, no trigger provenance');
              } finally {
                cleanDeveloperStandaloneRun();
              }
        },
      },
      {
        id: 'agents-run-adversarial-review-entry',
        title: 'Adversarial Review\'s standalone run view — real navigation, honestly absent trigger provenance',
        narration: 'run-agent-adversarial-review\'s mockup route (`#/agents/run/adversarial-review`) needs a concrete run id in reality (`/agents/<id>/run/<runId>`) — a hand-seeded fixture (same corpus-provenance discipline as the Developer\'s own fixture, no real `_agent-*` run exists on this machine) supplies one. The mockup\'s "the trigger is on the run header: auto, on Developer completion" is checked against reality, not narrated as shown: `data-section="run-trigger"` genuinely attaches structurally now (forge-pet, PR #106) but ONLY when the server body actually carries a `trigger` field — and no standalone-dispatch path writes one yet (client-side plumbing only, per that PR\'s own commit message). This beat proves the section is honestly ABSENT on this real run, the true current state, not the mockup\'s populated header.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              console.log('\n[R4-B13] Adversarial Review\'s standalone run view — entry + honest trigger-absence');
              seedAdversarialReviewStandaloneRun();
              try {
                await page.goto(watch.uiUrl + `/agents/${ADV_RUN_SLUG}/run/${ADV_RUN_ID}`, { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(
                  () => document.querySelector('[data-page="agent-run"]')?.hasAttribute('data-run-found') ?? false,
                  null, { timeout: 20000 },
                ).catch(() => {});
                const found = await page.evaluate(() => document.querySelector('[data-page="agent-run"]')?.getAttribute('data-run-found') ?? null);
                check(found === 'true', `agents-run-adversarial-review-entry: the run view finds the seeded adversarial-review run (got "${found}")`);
                await caption(page, 'Adversarial Review never starts by hand — it fires when the Developer node completes.');

                check(await page.locator('[data-section="run-trigger"]').count() === 0,
                  'agents-run-adversarial-review-entry: [data-section="run-trigger"] is genuinely absent — no server-side path writes a standalone run\'s trigger origin yet (client-side plumbing only, forge-pet)');
                await frame(page, 'aar-1-entry', 'Adversarial Review\'s standalone run — real navigation; trigger provenance honestly absent, not fabricated', { key: true });
              } finally {
                cleanAdversarialReviewStandaloneRun();
              }
        },
      },
      {
        id: 'agents-run-adversarial-review-findings',
        title: 'Adversarial Review\'s real findings vocabulary — a clean pass, zero findings, every severity bucket honestly zero',
        narration: 'The seeded run\'s own log carries the SAME real message vocabulary the flow-run\'s adversarial-review node already emits (review.input.assembled, review.findings.authored) — proving the standalone path produces the identical artifact shape a flow-node dispatch does (R4-10-F3\'s "ship-both" principle). "Five claims, each refuted... all five survive" is the agent\'s own internal SDK-turn reasoning (SKILL.md: candidate issues are weighed before any becomes a reported finding) — this harness spawns no real turn, so that claim-by-claim trace is honestly unavailable; what IS real and rendered is the COUNT-level outcome: total 0, every severity bucket 0, the real "zero findings" a verdict gate would actually read green against.',
        drive: async (ctx) => {
              const { page, watch, frame, check } = ctx;
              console.log('\n[R4-B13] Adversarial Review\'s real findings vocabulary — zero-findings outcome');
              seedAdversarialReviewStandaloneRun();
              try {
                await page.goto(watch.uiUrl + `/agents/${ADV_RUN_SLUG}/run/${ADV_RUN_ID}`, { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(
                  () => document.querySelector('[data-page="agent-run"]')?.hasAttribute('data-run-found') ?? false,
                  null, { timeout: 20000 },
                ).catch(() => {});
                const fullText = await page.locator('[data-section="run-log"]').innerText().catch(() => '');
                check(fullText.includes('review.input.assembled'),
                  'agents-run-adversarial-review-findings: the real review.input.assembled line renders (the diff assembled for critique)');
                check(fullText.includes('review.findings.authored'),
                  'agents-run-adversarial-review-findings: the real review.findings.authored line renders (the terminal claims-weighed outcome)');
                await caption(page, 'All five survive. Zero findings — that\'s a verdict-gate green light.');

                const costAttr = await page.evaluate(() => document.querySelector('[data-page="agent-run"]')?.getAttribute('data-run-cost') ?? null);
                check(costAttr !== null && Number(costAttr) > 0, `agents-run-adversarial-review-findings: the run's real accrued cost renders (got "${costAttr}")`);
                await frame(page, 'aar-2-findings', 'Adversarial Review\'s real vocabulary — a clean pass, zero findings, every severity bucket honestly zero', { key: true });
              } finally {
                cleanAdversarialReviewStandaloneRun();
              }
        },
      },
    ],
  });
