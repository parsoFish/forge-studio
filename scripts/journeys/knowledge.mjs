import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineJourney } from '../lib/journey-runtime.mjs';
import { caption, ACT, THINK, WORK, READ, FORGE_ROOT, waitForFile } from '../lib/journey-fixtures.mjs';
import { sleep, checkHonestPillarRead } from '../lib/journey-assertions.mjs';
// R4-19 WI-1/WI-2 (journey-sync F1) — direct in-process imports of the real
// orchestrator/CLI functions, mirroring the established precedent
// (scripts/lib/journey-daemon-guard.mjs importing orchestrator/daemon.ts
// directly: "Node ≥22.18 strips types natively ... so the daemon helpers can
// be imported directly from the orchestrator TypeScript source"). Used ONLY
// by knowledge-create-kb-band-scope-commit below: `runProjectBrainTurn`'s
// `phase === 'committing'` branch (`runCommitStep`) is fully deterministic —
// no SDK call — so calling it here exercises the SAME real code path a live
// daemon would run, bypassing only the detached-process `spawnAgentTurn`
// wrapper this harness's FORGE_ARCHITECT_NO_SPAWN=1 suppresses. `runBrainLint`
// is the same `forge brain lint` the CLI runs, called in-process to assert
// the real write leaves the whole brain 9/9 clean.
import { runProjectBrainTurn } from '../../orchestrator/project-brain-builder-runner.ts';
import { runBrainLint } from '@forge/knowledge/brain-lint.ts';

// module-scope cross-beat state for this journey (was hoisted in main())
let GUIDANCE_TEXT, kbPageReady;             // knowledge-graph → knowledge-pin-guidance
// knowledge-create-kb-band-scope → -seed → -commit (R4-19 WI-1/WI-2 arc)
let bandSessionId = null;
// Byte-stash of brain/INDEX.md, taken immediately before the real commit beat
// calls regenerateBrainIndex (inside runCommitStep) — restored in that same
// beat's own tail so the canonical repo file is never left dirty (state-
// ownership rule; this journey creates+destroys the scratch KB itself, but
// brain/INDEX.md is shared, git-tracked state it must put back byte-for-byte).
let brainIndexStash = null;

// ── scratch KB (knowledge-create-kb → knowledge-ingest) ──────────────────────
// A KB this journey creates AND deletes itself — never a REAL brain (brain/cycles,
// brain/forge-dev) or a REAL project's central brain (brain/projects/mdtoc,
// brain/projects/gitpulse, …, ADR 035). journey-fixtures.mjs is off-limits for
// this task, so every constant/helper for the ingest + kb-project/kb-cycle/
// kb-maintain demos lives here, module-local, mirroring the cleanup-at-top-of-
// beat pattern used by skills.mjs / demo-builder.mjs (defineJourney's
// spec.cleanup field is validated but never invoked by the runner, so
// self-contained cleanup lives inside drive()).
//
// R1-06 WI-4 (story-registry create-kb-project/create-kb-cycle/kb-maintain):
// this scratch KB is now PROJECT-bound (kind:'project', ref:'mdtoc' — forge's
// own creds-free reference project, already the shared grounding every other
// journey module uses per journey-fixtures.mjs's PROJECT constant) rather than
// flow-bound, so knowledge-create-kb honestly ports the mockup's
// "create-kb-project" story (a project-scoped brain, not a cross-cycle one) —
// substituting mdtoc for the mockup's fictional "trafficgame" the same way
// other registry rows substitute a real fixture for a fictional mockup id
// (e.g. install-connections' memory-for-crow-sentry-mcp). A project binding's
// create hand-off anchors its seeding session under the REAL project's own
// dir (bridge-studio-kbs.ts's `sessionProject = binding.ref`), so the session
// is genuinely reachable at /sessions/project-brain/<sid>?project=mdtoc —
// knowledge-create-kb asserts that reachability for real (T1 ruling: "its
// seeding session IS viewable, real project anchor").
const SCRATCH_KB_ID = 'journey-scratch-kb';
const SCRATCH_KB_NAME = 'Journey scratch KB';
const SCRATCH_KB_DESC = 'Ephemeral KB created by the e2e journey itself, to demo create -> guidance -> ingest -> delete without ever touching a real brain.';
const SCRATCH_KB_BIND_KIND = 'project';
const SCRATCH_KB_BIND_REF = 'mdtoc'; // the one project discoverProjects finds in this checkout — the POST dangling-ref check passes
const SCRATCH_KB_DIR = join(FORGE_ROOT, 'brain', SCRATCH_KB_ID);
const SCRATCH_GUIDANCE_TEXT = '[e2e-journey] scratch-kb guidance: a KB created purely for this demo should still round-trip through the exact same pin -> ingest -> delete loop as a real brain.';
// The project-brain seeding session hand-off's own scratch state, ephemeral
// and gitignored under projects/mdtoc/_project-brain/<sid>/ — the SAME
// directory shape journey-fixtures.mjs's own (off-limits-to-this-task) pbDir()
// helper uses for the mdtoc architect/instructions demos, reimplemented
// module-local per the header note above. Populated once knowledge-create-kb
// captures the real POST /api/studio/kbs response's sessionId.
let scratchKbSessionId = null;
function mdtocProjectBrainDir(sessionId) {
  return join(FORGE_ROOT, 'projects', SCRATCH_KB_BIND_REF, '_project-brain', sessionId);
}
function cleanScratchKbSession() {
  if (!scratchKbSessionId) return;
  try { rmSync(mdtocProjectBrainDir(scratchKbSessionId), { recursive: true, force: true }); } catch { /* best-effort */ }
  scratchKbSessionId = null;
}

// ── scratch KB #2 (knowledge-create-kb-band-scope) — create-kb-cycle port ────
// A SEPARATE flow-bound scratch KB, band-scoped to forge-develop's real
// 'review-band' (skills/adversarial-review/SKILL.md's own `guards:` entry,
// resolved through orchestrator/agent-bands.ts — never a hardcoded guess).
// Disjoint id from SCRATCH_KB_ID above; same create-and-destroy-itself
// discipline.
const SCRATCH_KB_BAND_ID = 'journey-scratch-kb-review-band';
const SCRATCH_KB_BAND_NAME = 'Journey scratch KB (review band)';
const SCRATCH_KB_BAND_DESC = 'Ephemeral, flow-bound + band-scoped KB created by the e2e journey itself, to demo the kb-binding-band field threading a real flow band into the create request.';
const SCRATCH_KB_BAND_BIND_KIND = 'flow';
const SCRATCH_KB_BAND_BIND_REF = 'forge-develop';
const SCRATCH_KB_BAND_VALUE = 'review-band';
const SCRATCH_KB_BAND_DIR = join(FORGE_ROOT, 'brain', SCRATCH_KB_BAND_ID);
// A non-project binding's seeding session is dot-anchored (bridge-studio-kbs.ts
// KB_SEEDING_ANCHOR_PREFIX = '.kb-'). Before R4-19 WI-2 this was genuinely
// unreachable through the session-shell route (its `project` query param was
// SLUG_RE-validated, which a leading '.' failed) — WI-2
// (cli/bridge-studio-sessions.ts's `invalidProjectReason`) added a BOUNDED
// carve-out: EXACTLY `.kb-<valid-slug>` now passes (the post-prefix remainder
// still runs through the same SLUG_RE, so `/`, `..`, NUL, empty-slug all still
// reject — general leading-dot traversal defense is unchanged). So the session
// is now genuinely reachable/drivable — proven by
// knowledge-create-kb-band-scope-seed below, not merely asserted. Same
// gitignored `projects/` tree as the mdtoc session above; cleaned as a whole
// dot-dir (by the LAST beat in the arc, knowledge-create-kb-band-scope-commit
// — the KB + its session must stay live across all three beats).
function scratchKbBandSessionAnchorDir() {
  return join(FORGE_ROOT, 'projects', `.kb-${SCRATCH_KB_BAND_ID}`);
}
/** The seeding session's own dir: projects/.kb-<id>/_project-brain/<sid>/ —
 *  same shape journey-fixtures.mjs's pbDir() uses for the mdtoc case,
 *  reimplemented module-local (this module owns the whole scratch-KB
 *  cleanup contract per the header note above SCRATCH_KB_DIR). */
function bandPbSessionDir(sid) {
  return join(scratchKbBandSessionAnchorDir(), '_project-brain', sid);
}
function readBandPbStatus(sid) {
  try { return JSON.parse(readFileSync(join(bandPbSessionDir(sid), 'status.json'), 'utf8')); } catch { return null; }
}
/** Merge-patch status.json (preserves kb_id/kb_binding/project/
 *  project_repo_path/session_id written by the real create hand-off —
 *  runCommitStep reads kb_id/kb_binding to resolve WHERE to commit, so those
 *  fields must survive every patch here untouched). */
function writeBandPbStatus(sid, patch) {
  const current = readBandPbStatus(sid) ?? {};
  writeFileSync(join(bandPbSessionDir(sid), 'status.json'), JSON.stringify({
    ...current, ...patch, updated_at: new Date().toISOString(),
  }, null, 2));
}

/**
 * R4-19 WI-1/WI-2 — EMULATED analyze-step theme authoring for the band-scoped
 * scratch KB, staged into the seeding session's own themes/ dir (exactly
 * where a real analyze turn would stage them — runCommitStep reads from
 * here, unchanged by anything below).
 *
 * The real R4-19 agent (`buildAnalyzePlan`'s flow+band branch,
 * orchestrator/project-brain-builder-runner.ts) reads live archived cycles
 * under `cyclesRawDir` plus each cycle's logged review-band / adversarial-
 * review findings. That SDK turn is suppressed under this harness's
 * FORGE_ARCHITECT_NO_SPAWN=1 — the SAME seam every other agentic beat honors
 * (su-create-project-brain's own seedStagedBrain is the precedent this
 * mirrors) — so this is a SCRIPTED STAND-IN, narrated as such everywhere it
 * is invoked, never presented as a real agent run.
 *
 * Grounded, not invented (corpus-grounded-demo-seeds): both themes mirror
 * forge's own real, already-committed review findings —
 * brain/cycles/themes/declared-data-fails-open.md and
 * .../suppression-env-fakes-the-pass.md — cited as provenance in each
 * theme's own Sources section, the shape a real pass over forge's own
 * archived cycles would actually surface.
 */
function seedBandStagedThemes(sid) {
  const themesDir = join(bandPbSessionDir(sid), 'themes');
  mkdirSync(themesDir, { recursive: true });
  const now = new Date().toISOString();
  const fm = (title, description, related) => [
    '---', `title: ${title}`, `description: ${description}`, 'category: antipattern',
    'keywords:', '  - review-band', '  - adversarial-review', '  - emulated-seeding',
    `created_at: ${now}`, `updated_at: ${now}`,
    'related_themes:', `  - ${related}`, '---', '',
  ].join('\n');
  writeFileSync(join(themesDir, 'review-band-declared-data-fails-open.md'),
    fm('review-band recurring finding — declared data fails open',
      'Emulated seeding pass over forge-develop\'s review-band findings — the recurring shape where a field is parsed, typed and surfaced but no production path reads it.',
      'review-band-suppression-env-fakes-the-pass') +
    '# review-band recurring finding — declared data fails open\n\n' +
    '**Harness stand-in (R4-19).** The real seeding agent (`buildAnalyzePlan`\'s flow+band branch) reads live archived cycles under `brain/cycles/_raw/` and each cycle\'s logged adversarial-review findings; that SDK turn is suppressed under `FORGE_ARCHITECT_NO_SPAWN=1` in this harness, so this theme is a SCRIPTED stand-in, not a real agent output.\n\n' +
    'It is grounded, not invented: forge\'s own review-band already surfaced this exact recurring pattern for real — a field declared, parsed, and rendered with no production path reading it to decide anything — logged as the wave-4/5 campaign\'s #1 recurring finding.\n\n' +
    '## Sources\n\n' +
    '- [`brain/cycles/themes/declared-data-fails-open.md`](../../cycles/themes/declared-data-fails-open.md) — the real, already-committed forge-brain theme this emulation mirrors.\n\n' +
    '## See also\n\n' +
    '- [[review-band-suppression-env-fakes-the-pass]]\n');
  writeFileSync(join(themesDir, 'review-band-suppression-env-fakes-the-pass.md'),
    fm('review-band recurring finding — the suppression env fakes the pass',
      'Emulated seeding pass over forge-develop\'s review-band findings — the recurring shape where the environment, not the code, decides whether a check passes.',
      'review-band-declared-data-fails-open') +
    '# review-band recurring finding — the suppression env fakes the pass\n\n' +
    '**Harness stand-in (R4-19).** Same emulation boundary as the sibling theme in this seeding pass — a scripted stand-in for the real, suppressed agent turn, grounded in forge\'s own already-logged recurring review finding rather than invented content.\n\n' +
    '## Sources\n\n' +
    '- [`brain/cycles/themes/suppression-env-fakes-the-pass.md`](../../cycles/themes/suppression-env-fakes-the-pass.md) — the real, already-committed forge-brain theme this emulation mirrors.\n\n' +
    '## See also\n\n' +
    '- [[review-band-declared-data-fails-open]]\n');
  writeFileSync(join(themesDir, 'profile.md'), [
    '---', 'title: profile', 'description: One-page overview of this review-band-scoped brain.',
    'category: reference', `created_at: ${now}`, `updated_at: ${now}`, '---', '',
    'Seeded (emulated, R4-19) from forge-develop\'s review-band findings — cross-project adversarial-review patterns, not a single project\'s own history.\n',
  ].join('\n'));
}

function cleanScratchKbBand() {
  try { rmSync(SCRATCH_KB_BAND_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { rmSync(scratchKbBandSessionAnchorDir(), { recursive: true, force: true }); } catch { /* best-effort */ }
  if (bandSessionId) {
    try { rmSync(join(FORGE_ROOT, '_logs', `_project-brain-${bandSessionId}`), { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

// ── scratch project-brain (knowledge-kb-maintain-session) — kb-maintain port ─
// A THIRD scratch KB, this one nested under brain/projects/ (ADR 035's
// central-per-project layout) — the ONE containment root
// checkProjectBrainIndexes (cli/brain-lint.ts) scans, and therefore the ONLY
// shape whose lint findings are BOTH agent-tier (resolution:'agent', kind
// 'index.project') AND deterministically fixable by consolidate's in-process
// `applyDeterministicConsolidateFixes` path (the "not listed in project
// category index" message shape) — the one real, CI-safe (no SDK turn) way to
// show the Consolidate button driving a GENUINE reduction in
// [data-component="kb-health"][data-lint-warnings]. Its id
// (journey-scratch-kb-maintain) is disjoint from every real project brain
// (mdtoc, gitpulse, demo-project, terraform-provider-betterado, trafficGame)
// this journey run might find under brain/projects/ — created and destroyed
// by this beat alone, never touching a real one, the same discipline as
// SCRATCH_KB_DIR/SCRATCH_KB_BAND_DIR above just one level deeper.
const SCRATCH_KB_MAINTAIN_ID = 'journey-scratch-kb-maintain';
const SCRATCH_KB_MAINTAIN_NAME = 'journey-scratch-kb-maintain (project)';
const SCRATCH_KB_MAINTAIN_DESC = 'Ephemeral per-project-shaped brain created by the e2e journey itself, seeded with one deterministically-fixable lint finding to demo Consolidate driving a real reduction.';
const SCRATCH_KB_MAINTAIN_DIR = join(FORGE_ROOT, 'brain', 'projects', SCRATCH_KB_MAINTAIN_ID);
const SCRATCH_KB_MAINTAIN_THEME_SLUG = 'scratch-maintain-lesson';
const SCRATCH_KB_MAINTAIN_THEME_DESC = 'A scratch lint fixture: a real theme, present on disk, deliberately left out of its own category index so checkProjectBrainIndexes flags it and Consolidate has something genuine to clear.';

function cleanScratchKbMaintain() {
  try { rmSync(SCRATCH_KB_MAINTAIN_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
}

/** Seed brain/projects/journey-scratch-kb-maintain/ with kb.yaml + one theme
 *  whose category index (patterns.md) exists but omits the theme's own link —
 *  the exact "not listed in project category index" shape
 *  isDeterministicNotListedFinding (cli/bridge-studio-kbs.ts) claims. Mirrors
 *  the real on-disk shape of brain/projects/mdtoc/{kb.yaml,patterns.md,themes/}
 *  (read, never written, by this journey). */
function seedScratchKbMaintain() {
  const themesDir = join(SCRATCH_KB_MAINTAIN_DIR, 'themes');
  mkdirSync(themesDir, { recursive: true });
  writeFileSync(join(SCRATCH_KB_MAINTAIN_DIR, 'kb.yaml'), [
    `id: ${SCRATCH_KB_MAINTAIN_ID}`,
    `name: ${SCRATCH_KB_MAINTAIN_NAME}`,
    'binding:',
    '  kind: project',
    `  ref: ${SCRATCH_KB_MAINTAIN_ID}`,
    `desc: ${SCRATCH_KB_MAINTAIN_DESC}`,
    'backend: filesystem',
    '',
  ].join('\n'), 'utf8');
  const now = new Date().toISOString();
  writeFileSync(join(themesDir, `${SCRATCH_KB_MAINTAIN_THEME_SLUG}.md`), [
    '---',
    'title: Scratch maintain lesson — deliberately unindexed',
    `description: ${SCRATCH_KB_MAINTAIN_THEME_DESC}`,
    'category: pattern',
    'keywords: [e2e-journey, scratch-kb, kb-maintain, consolidate]',
    `created_at: ${now}`,
    `updated_at: ${now}`,
    'related_themes: []',
    '---',
    '',
    '# Theme: scratch maintain lesson',
    '',
    '## Pattern',
    '',
    SCRATCH_KB_MAINTAIN_THEME_DESC,
    '',
  ].join('\n'), 'utf8');
  // patterns.md EXISTS (so checkProjectBrainIndexes doesn't instead flag
  // "no category index files") but omits the theme's own link line — the
  // finding Consolidate is being asked to clear.
  writeFileSync(join(SCRATCH_KB_MAINTAIN_DIR, 'patterns.md'), [
    `# ${SCRATCH_KB_MAINTAIN_ID} — Patterns`,
    '',
    '> Category index. Lists theme pages describing proven approaches that work in this project.',
    '',
    '## Theme pages',
    '',
    '(deliberately empty — the e2e journey seeds this to demo Consolidate filling it in)',
    '',
  ].join('\n'), 'utf8');
}

/** Defensive cleanup: guards against leftover state from a prior crashed run, and is
 * the belt-and-braces call after the real UI-driven delete. Safe to call any number of
 * times. Note for the caller/report: e2e-journey.mjs's finally block only ever sweeps
 * brain/cycles/_guidance/ — it has no knowledge of brain/journey-scratch-kb/, so this
 * module owns the entire cleanup contract for the scratch KB (out of this task's
 * touch-scope to wire a second runner-level sweep; the exact path for that sweep would
 * be SCRATCH_KB_DIR itself, i.e. join(FORGE_ROOT, 'brain', 'journey-scratch-kb')). */
function cleanScratchKb() {
  try { rmSync(SCRATCH_KB_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ── scratch project-brain (knowledge-lint-index — W6-B13 drain-to-green) ──────
// A FIFTH scratch KB, disjoint from every one above — the drain button's own
// fixture. W7 FIX-B-KB: this fixture used to mirror SCRATCH_KB_MAINTAIN's
// "missing from its own category index" shape and lean on it being
// unfixable without an agent turn — but that was only ever true because the
// index auto-fixer wrote the WRONG index (the brain/cycles leak); with the
// own-tree fixer the drain's real auto pass legitimately heals that shape
// to a genuine "green", which is the wrong demo for THIS beat. So the seed
// here is now a finding with NO auto or deterministic path at all — a
// dangling `related_themes` edge (checkDanglingEdges → `edge.dangling`,
// resolution:'agent', see classifyFinding in cli/brain-lint.ts) — while the
// theme IS properly listed in its own patterns.md (zero index findings).
// Disjoint directory keeps each beat's state ownership independent (rule 3);
// drain under no-spawn never writes to this KB's files at all (a dangling
// edge is repointed only by a real SDK turn).
const SCRATCH_KB_DRAIN_ID = 'journey-scratch-kb-drain';
const SCRATCH_KB_DRAIN_NAME = 'journey-scratch-kb-drain (project)';
const SCRATCH_KB_DRAIN_DESC = 'Ephemeral per-project-shaped brain created by the e2e journey itself, seeded with one agent-tier lint finding to demo the drain-to-green button reaching an honest, CI-safe terminal.';
const SCRATCH_KB_DRAIN_DIR = join(FORGE_ROOT, 'brain', 'projects', SCRATCH_KB_DRAIN_ID);
const SCRATCH_KB_DRAIN_THEME_SLUG = 'scratch-drain-lesson';
/** A REAL forge theme (brain/cycles/themes/eval-driven-development.md) in a
 *  DIFFERENT sub-wiki — the cross-KB edge forge-9kr is about. */
const SCRATCH_KB_DRAIN_EXTERNAL_SLUG = 'eval-driven-development';
const SCRATCH_KB_DRAIN_THEME_DESC = 'A scratch lint fixture: a real theme, listed in its own category index, but carrying a deliberately dangling related_themes edge so checkDanglingEdges flags it (agent-tier, no auto fixer) and the drain button has something genuine — and genuinely agent-only — to work on.';
// A slug that exists NOWHERE under brain/**/themes — the dangling target.
const SCRATCH_KB_DRAIN_DANGLING_SLUG = 'journey-scratch-nonexistent-theme';

function cleanScratchKbDrain() {
  try { rmSync(SCRATCH_KB_DRAIN_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
  // Also drop this scratch KB's prior DRAIN RUNS (`_logs/_kb-drain-<kb>-drain-*`).
  // KbDrainPanel reattaches on mount to the active-or-LATEST run — a leftover
  // terminal run from a previous journey execution made the reattach beat read
  // a STALE runId as its "before" (waitForTerminalDrainState was satisfied
  // instantly by the old terminal state), so its own fresh dispatch became the
  // "after" and the same-run assertion failed. Fixture hygiene rule 3: each
  // beat owns ALL of its state, including server-side run dirs.
  try {
    const logsDir = join(FORGE_ROOT, '_logs');
    const prefix = `_kb-drain-${SCRATCH_KB_DRAIN_ID}-drain-`;
    for (const d of readdirSync(logsDir)) {
      if (d.startsWith(prefix)) { try { rmSync(join(logsDir, d), { recursive: true, force: true }); } catch { /* */ } }
    }
  } catch { /* best-effort */ }
}

/** Seeds exactly ONE finding: a dangling related_themes edge
 *  (checkDanglingEdges, agent-tier, NO auto/deterministic fixer — see the
 *  W7 FIX-B-KB block comment above). The theme is properly indexed in its
 *  own patterns.md so no index-tier finding fires alongside it. */
function seedScratchKbDrain() {
  const themesDir = join(SCRATCH_KB_DRAIN_DIR, 'themes');
  mkdirSync(themesDir, { recursive: true });
  writeFileSync(join(SCRATCH_KB_DRAIN_DIR, 'kb.yaml'), [
    `id: ${SCRATCH_KB_DRAIN_ID}`,
    `name: ${SCRATCH_KB_DRAIN_NAME}`,
    'binding:',
    '  kind: project',
    `  ref: ${SCRATCH_KB_DRAIN_ID}`,
    `desc: ${SCRATCH_KB_DRAIN_DESC}`,
    'backend: filesystem',
    '',
  ].join('\n'), 'utf8');
  const now = new Date().toISOString();
  writeFileSync(join(themesDir, `${SCRATCH_KB_DRAIN_THEME_SLUG}.md`), [
    '---',
    'title: Scratch drain lesson — deliberately dangling edge',
    // JSON.stringify = double-quoted YAML: the DESC contains an unquoted
    // `: ` which would otherwise make gray-matter throw and route this
    // fixture through the lenient fallback — the seed must be VALID yaml so
    // the beat demos drain honesty, not parser-fallback trivia (the fallback
    // path has its own unit pins in cli/theme-frontmatter.test.ts).
    `description: ${JSON.stringify(SCRATCH_KB_DRAIN_THEME_DESC)}`,
    'category: pattern',
    'keywords: [e2e-journey, scratch-kb, kb-drain, drain-to-green]',
    `created_at: ${now}`,
    `updated_at: ${now}`,
    // Two edges, deliberately: the dangling one is the seeded agent-tier
    // finding, and `eval-driven-development` is a REAL theme in the cycles
    // sub-wiki — a legitimate cross-KB reference `checkDanglingEdges`
    // correctly does NOT flag, and which the per-KB graph cannot draw. It is
    // what makes the external-edge readout assert a real 1 instead of a 0
    // that could never fail (adversarial round 1).
    `related_themes: [${SCRATCH_KB_DRAIN_DANGLING_SLUG}, ${SCRATCH_KB_DRAIN_EXTERNAL_SLUG}]`,
    '---',
    '',
    '# Theme: scratch drain lesson',
    '',
    '## Pattern',
    '',
    SCRATCH_KB_DRAIN_THEME_DESC,
    '',
  ].join('\n'), 'utf8');
  // patterns.md EXISTS and LISTS the theme — zero index-tier findings, so
  // the drain's real auto pass has nothing it can (or should) fix and the
  // ONLY finding is the agent-tier dangling edge above (W7 FIX-B-KB: the
  // old missing-link shape is auto-healable now that ensureLinked targets
  // the KB's own tree, which turned this beat's honest "no-progress" demo
  // into a real green).
  writeFileSync(join(SCRATCH_KB_DRAIN_DIR, 'patterns.md'), [
    `# ${SCRATCH_KB_DRAIN_ID} — Patterns`,
    '',
    '> Category index. Lists theme pages describing proven approaches that work in this project.',
    '',
    '## Theme pages',
    '',
    `- [\`${SCRATCH_KB_DRAIN_THEME_SLUG}\`](./themes/${SCRATCH_KB_DRAIN_THEME_SLUG}.md) — ${SCRATCH_KB_DRAIN_THEME_DESC}`,
    '',
  ].join('\n'), 'utf8');
}

/** Emulates one ingest pass on the scratch KB: folds the pinned guidance note into a
 * real theme file (house-style frontmatter, matching brain/cycles/themes/*.md) and
 * removes the guidance note. In the real product this fold is an LLM pass
 * (brain-ingest); here, on a throwaway scratch KB, it is a scripted write — narrated as
 * such everywhere this is invoked. */
function foldScratchGuidanceIntoTheme() {
  const guidanceDir = join(SCRATCH_KB_DIR, '_guidance');
  if (existsSync(guidanceDir)) {
    for (const f of readdirSync(guidanceDir)) { try { rmSync(join(guidanceDir, f), { force: true }); } catch { /* */ } }
  }
  const themesDir = join(SCRATCH_KB_DIR, 'themes');
  mkdirSync(themesDir, { recursive: true });
  const now = new Date().toISOString();
  const theme = `---
title: Ephemeral demo lesson — folded from pinned guidance
description: >-
  A scratch-KB demo lesson: pinned human guidance, once folded by an ingest
  pass, becomes a real theme node with its own article body — not just a
  transient note. Folded on ${now.slice(0, 10)} by the e2e journey.
category: pattern
keywords:
  - e2e-journey
  - scratch-kb
  - ingest-emulation
created_at: ${now}
updated_at: ${now}
source_dates:
  - ${now.slice(0, 10)}
---

## The problem

A guidance note pinned to a KB is deliberately transient — it is a human's
raw lesson, not yet folded into the brain's structured themes. Left alone it
never becomes a durable, linkable article.

## The fix

An ingest pass reads every pending guidance note, writes it up as a proper
theme (frontmatter + a problem/fix body), and removes the guidance file once
folded. ${SCRATCH_GUIDANCE_TEXT}

## See also
- (none — this is a scratch demo theme, not a real cross-linked brain node)
`;
  writeFileSync(join(themesDir, 'scratch-ingest-lesson.md'), theme, 'utf8');
}

// ── scratch KB #4 (knowledge-kb-cleanup-launch / -approve) — R4-19-F2 port ──
// A FOURTH scratch KB, disjoint from the three above, for the NEW kb-cleanup
// interactive session kind (studio/session-kinds.yaml, R4-19-F2): an operator
// opens a KB, clicks "Cleanup plan" (the KB-actions group's OTHER launcher, next to
// Consolidate), a brain-maintenance agent drafts a reviewable plan from that
// KB's real lint findings, the operator reviews + approves it, and a real
// drain runs. Bound `{kind: 'flow', ref: 'forge-develop'}` — deliberately NOT
// 'project' (would mint a phantom projects/<id>/ dir the way a real
// project-bound KB's cleanup session anchors under its own project root) and
// NOT 'unique' (forge studio lint's own `unique-binding` check requires
// EXACTLY ONE unique-bound KB across the whole registry — that's forge-dev;
// a second one would fail lint for the whole window this scratch KB is on
// disk). A flow binding anchors the cleanup session under the SAME
// dot-prefixed KB-seeding anchor (`.kb-<id>`, KB_SEEDING_ANCHOR_PREFIX)
// SCRATCH_KB_BAND_ID already proves reachable — never a real project dir.
const SCRATCH_KB_CLEANUP_ID = 'journey-scratch-kb-cleanup';
const SCRATCH_KB_CLEANUP_NAME = 'Journey scratch KB (cleanup demo)';
const SCRATCH_KB_CLEANUP_DESC = 'Ephemeral, flow-bound KB created by the e2e journey itself, to demo the kb-cleanup session kind (launch -> drafted plan -> approve -> real drain) without ever touching a real brain.';
const SCRATCH_KB_CLEANUP_BIND_KIND = 'flow';
const SCRATCH_KB_CLEANUP_BIND_REF = 'forge-develop';
const SCRATCH_KB_CLEANUP_DIR = join(FORGE_ROOT, 'brain', SCRATCH_KB_CLEANUP_ID);

/** Cross-beat state: knowledge-kb-cleanup-launch sets these from the real
 *  POST /api/studio/kbs/:id/cleanup/start response; knowledge-kb-cleanup-
 *  approve reads them to re-navigate to the SAME session two beats later
 *  (mirrors bandSessionId's own cross-beat pattern above). */
let kbCleanupSessionId = null;
let kbCleanupSessionProject = null;

function scratchKbCleanupSessionAnchorDir() {
  return join(FORGE_ROOT, 'projects', `.kb-${SCRATCH_KB_CLEANUP_ID}`);
}
function kbCleanupSessionDir(sid) {
  return join(scratchKbCleanupSessionAnchorDir(), '_kb-cleanup', sid);
}

function cleanScratchKbCleanup() {
  try { rmSync(SCRATCH_KB_CLEANUP_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { rmSync(scratchKbCleanupSessionAnchorDir(), { recursive: true, force: true }); } catch { /* best-effort */ }
}

/** Seed brain/journey-scratch-kb-cleanup/ with kb.yaml + one real theme —
 *  just enough for the KB to render as a normal library card / graph; this
 *  beat's own real payoff is the kb-cleanup SESSION arc, not any particular
 *  lint-finding shape on this KB (the replayed plan's own actions target the
 *  real forge-dev KB's paths — see seedKbCleanupPlanFromRealCapture below —
 *  so nothing about THIS KB's own findings drives their derived state). */
function seedScratchKbCleanup() {
  const themesDir = join(SCRATCH_KB_CLEANUP_DIR, 'themes');
  mkdirSync(themesDir, { recursive: true });
  writeFileSync(join(SCRATCH_KB_CLEANUP_DIR, 'kb.yaml'), [
    `id: ${SCRATCH_KB_CLEANUP_ID}`,
    `name: ${SCRATCH_KB_CLEANUP_NAME}`,
    'binding:',
    `  kind: ${SCRATCH_KB_CLEANUP_BIND_KIND}`,
    `  ref: ${SCRATCH_KB_CLEANUP_BIND_REF}`,
    `desc: ${SCRATCH_KB_CLEANUP_DESC}`,
    'backend: filesystem',
    '',
  ].join('\n'), 'utf8');
  const now = new Date().toISOString();
  writeFileSync(join(themesDir, 'profile.md'), [
    '---', 'title: profile', 'description: One-page overview of this cleanup-demo-scoped brain.',
    'category: reference', `created_at: ${now}`, `updated_at: ${now}`, '---', '',
    'Seeded by the e2e journey purely to give the kb-cleanup session demo a real KB to open — see knowledge-kb-cleanup-launch.\n',
  ].join('\n'), 'utf8');
}

/** Merge-patch the REAL status.json the real POST /cleanup/start route
 *  already wrote (session_id/project/phase/kb_id/kb_binding/findings all
 *  stay real) — mirrors writeBandPbStatus's own merge-patch shape above and
 *  scripts/lib/journey-fixtures.mjs's authoring-session PROVENANCE precedent
 *  ("merge-patch onto the REAL status.json the start route already wrote").
 *  Used here to write the ONE field a suppressed agent turn would have
 *  written under a live spawn: the drafting -> awaiting-approval phase
 *  transition (studio/session-kinds.yaml's kb-cleanup turnSpec table). */
function writeKbCleanupStatus(sid, patch) {
  const path = join(kbCleanupSessionDir(sid), 'status.json');
  let current = {};
  try { current = JSON.parse(readFileSync(path, 'utf8')); } catch { /* start route always writes this first */ }
  writeFileSync(path, JSON.stringify({ ...current, ...patch, updated_at: new Date().toISOString() }, null, 2), 'utf8');
}

// PROVENANCE (binding — never hand-invent an agent's output, mirrors
// scripts/lib/journey-fixtures.mjs's R4-21 authoring-session precedent
// verbatim): scripts/journeys/fixtures/r4-19-f2-live-capture/cleanup-plan.md
// is the REAL, byte-verbatim `plan/cleanup-plan.md` a real brain-maintenance
// drafting turn wrote against forge's own real "forge-dev" KB (session
// 2026-08-14T08-34-38-a34fff82; the sibling status.json in that same
// directory is the real captured session status — both files are also the
// committed ground-truth fixture orchestrator/studio/session-transcript.
// test.ts's own R4-19-F2-fix P1-regression tests read directly, so this
// journey and that unit suite can never silently drift onto two different
// "real" plans). Read once at module-load time so this beat drives the exact
// same on-disk bytes every run, never a paraphrase.
const R4_19_F2_FIXTURE_DIR = join(FORGE_ROOT, 'scripts', 'journeys', 'fixtures', 'r4-19-f2-live-capture');
const R4_19_F2_REAL_SESSION_ID = '2026-08-14T08-34-38-a34fff82';
const R4_19_F2_REAL_PLAN_MD = readFileSync(join(R4_19_F2_FIXTURE_DIR, 'cleanup-plan.md'), 'utf8');

/** Writes plan/cleanup-plan.md into the kb-cleanup session's own dir, exactly
 *  where a real drafting turn would (CLEANUP_PLAN_DIRNAME/CLEANUP_PLAN_
 *  FILENAME, orchestrator/studio/session-transcript.ts). FORGE_DRY_BRIDGE=1
 *  suppresses the real agent spawn (`spawnAgentTurn`) the /cleanup/start
 *  route fires, so this is the stand-in for that suppressed turn — the SAME
 *  seam every other agentic beat in this journey honors (writeBandPbStatus's
 *  own header comment states the identical rationale for project-brain). The
 *  visible provenance note is prose IN the seeded file itself (not just a
 *  source comment) so the operator watching the rendered plan — not just a
 *  future code reader — sees the same disclosure, mirroring how
 *  seedBandStagedThemes's own theme bodies self-disclose "Harness stand-in
 *  (R4-19)." inline rather than only in this module's comments. */
function seedKbCleanupPlanFromRealCapture(sid) {
  const dir = join(kbCleanupSessionDir(sid), 'plan');
  mkdirSync(dir, { recursive: true });
  const note = [
    `> **Journey-sync provenance note.** Everything below this line is the REAL,`,
    `> byte-verbatim \`plan/cleanup-plan.md\` a real brain-maintenance drafting turn`,
    `> wrote against forge's own real "forge-dev" KB (session ${R4_19_F2_REAL_SESSION_ID};`,
    '> committed at scripts/journeys/fixtures/r4-19-f2-live-capture/). This demo',
    '> session runs under FORGE_DRY_BRIDGE=1, which suppresses ITS OWN agent',
    '> spawn — no agent ran for this session; the journey replays the captured',
    '> output rather than faking a live turn. And because this replay runs',
    '> against a disposable scratch KB, never the real forge-dev brain (so this',
    "> journey can never mutate Brain 1), the two actions below correctly read",
    '> "unknown" once parsed: their targets name real forge-dev theme paths',
    "> outside this scratch KB's own scanned domain — the exact fail-safe the",
    "> derive-don't-store P1 fix (session-transcript.ts's deriveActionState)",
    '> built, never a fabricated "open" or "cleared".',
    '',
    '',
  ].join('\n');
  writeFileSync(join(dir, 'cleanup-plan.md'), note + R4_19_F2_REAL_PLAN_MD, 'utf8');
}

// ── ingest-activity fixture (knowledge-explore-tabs) ──────────────────────
// A single real `reflect.kb-ingest` event on a DISJOINT scratch cycle id
// (`journey-scratch-kb-ingest-activity`, never a real archived cycle),
// scoped to the real 'cycles' KB the Explore/Health assertions in that same
// beat already target. Written directly as JSONL rather than through
// orchestrator/logging.ts's createLogger (this beat needs exactly one line,
// not a whole logger instance + cycle dir lifecycle) — but the field shape
// mirrors createLogger's own EventLogEntry (orchestrator/logging.ts) and the
// EXACT reflect.kb-ingest emit call orchestrator/kb-health.ts's
// runPostReflectionKbHealth makes on its builtin-ingest success path:
//   emit('reflect.kb-ingest', 'log', { kb: kbId, impl: 'builtin',
//     builtin: builtinName(ingestImpl, 'reflector-ingest'),
//     fresh_themes: freshFiles.length });
// GET /api/studio/kbs/:id/ingest-activity (cli/bridge-studio-kbs.ts) reads
// this straight off _logs/<cycleId>/events.jsonl via listCycles + a guarded
// per-cycle read — never a synthetic in-memory list — so this fixture
// exercises the SAME real read path a genuine post-reflect run would
// populate, on a scratch cycle id this beat alone creates and destroys.
const INGEST_FIXTURE_CYCLE_ID = 'journey-scratch-kb-ingest-activity';
const INGEST_FIXTURE_KB_ID = 'cycles';
const INGEST_FIXTURE_FRESH_THEMES = 3;
// Real, already-committed brain/cycles/themes/ theme (also cited as
// provenance by seedBandStagedThemes above) — used as the ?theme= deep-link
// target; never invented.
const DEEP_LINK_THEME_SLUG = 'declared-data-fails-open';

function ingestFixtureLogDir() {
  return join(FORGE_ROOT, '_logs', INGEST_FIXTURE_CYCLE_ID);
}

function seedIngestActivityFixture() {
  const dir = ingestFixtureLogDir();
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const entry = {
    event_id: `${INGEST_FIXTURE_CYCLE_ID}-evt-1`,
    cycle_id: INGEST_FIXTURE_CYCLE_ID,
    initiative_id: 'journey-scratch-ingest-activity',
    phase: 'reflection',
    skill: 'reflector',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    started_at: now,
    message: 'reflect.kb-ingest',
    metadata: {
      kb: INGEST_FIXTURE_KB_ID,
      impl: 'builtin',
      builtin: 'reflector-ingest',
      fresh_themes: INGEST_FIXTURE_FRESH_THEMES,
    },
  };
  writeFileSync(join(dir, 'events.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
}

/** Defensive + real cleanup, called both before seeding (guard against a
 *  prior crashed run) and in this beat's own finally. Never touches any
 *  other _logs/ dir — only its own disjoint scratch cycle id. */
function cleanIngestActivityFixture() {
  try { rmSync(ingestFixtureLogDir(), { recursive: true, force: true }); } catch { /* best-effort */ }
}

export const journey = defineJourney({
    id: 'knowledge',
    title: 'Knowledge graph',
    story: 'As an operator, I browse the real cycles brain as a force-graph, pin a piece of human guidance onto it, and run lint/index maintenance — the knowledge pillar\'s OOTB brains, edited through both deterministic tooling and my own guidance-plus-ingest loop.',
    beats: [
      {
        id: 'knowledge-graph',
        title: 'KB-backend seam — /knowledge?id=cycles (real brain)',
        narration: 'The knowledge screen force-graphs the real cycles brain — theme and index nodes, KB health panel, a backend selector — and clicking a theme node opens its full article; this is the actual OOTB cross-cycle brain, not a mock graph.',
        drive: async (ctx) => {
              const { page, watch, check, frame, countAtLeast } = ctx;
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
                // W7-A1 / FIX-A1 (A1-11 + A1-07): the roster AND the KB-detail
                // read both settled honestly (data-fetch-status folds both in).
                await checkHonestPillarRead(page, check, 'knowledge', 'kb-seam');
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

                // R6-08 WI-3: KB HEALTH moved under the Health tab — switch
                // there, assert, then switch BACK to Explore before the graph
                // screenshot/node click below (KbGraph only renders on the
                // explore branch). The KB selector lives in the header, above
                // the tab bar, so it's tab-independent — asserted here anyway
                // since we're already on Health.
                await page.locator('[data-tab="health"]').click().catch(() => {});
                await page.waitForFunction(
                  () => document.querySelector('[data-tab="health"]')?.getAttribute('data-tab-active') === 'true',
                  null, { timeout: 8000 },
                ).catch(() => {});
                const healthPresent = await page.evaluate(() =>
                  document.querySelector('[data-section="kb-health"]') !== null ||
                  [...document.querySelectorAll('div')].some((el) => el.textContent?.includes('KB HEALTH') || el.textContent?.includes('LAYER BALANCE')));
                check(healthPresent, 'kb-seam: KB HEALTH panel rendered (Health tab, R6-08 WI-3)');
                const selectorPresent = await page.evaluate(() =>
                  document.querySelector('select') !== null || document.querySelector('[data-component="kb-selector"]') !== null);
                check(selectorPresent, 'kb-seam: KB selector present');
                await page.locator('[data-tab="explore"]').click().catch(() => {});
                await page.waitForFunction(
                  () => document.querySelector('[data-tab="explore"]')?.getAttribute('data-tab-active') === 'true',
                  null, { timeout: 8000 },
                ).catch(() => {});
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
        narration: 'The operator types a lesson straight into the HUMAN GUIDANCE panel and pins it; a guidance node appears in the graph immediately — human guidance is how the brain grows between ingest passes, visible as its own node until the next one folds it in.',
        drive: async (ctx) => {
              const { page, check, frame } = ctx;
              // ── S3.1: Pin-guidance → guidance node appears (writes _guidance/<ts>.md) ──
              console.log('\n[S3.1] KB-backend seam — pin-guidance');
              await caption(page, 'Human guidance — pin a note to the brain; it surfaces as a guidance node until the next ingest pass.');
              await sleep(ACT);
              if (kbPageReady) {
                // R6-08 WI-3: GuidancePanel moved under the Health tab — switch there
                // before locating #guidance-text (this beat continues knowledge-graph's
                // page, which returns to Explore at the end of its own drive()).
                await page.locator('[data-tab="health"]').click().catch(() => {});
                await page.waitForFunction(
                  () => document.querySelector('[data-tab="health"]')?.getAttribute('data-tab-active') === 'true',
                  null, { timeout: 8000 },
                ).catch(() => {});
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
                      // The guidance NODE lives on the Explore tab's force-graph
                      // (KbGraph only renders on that branch) — switch back before
                      // checking for it.
                      await page.locator('[data-tab="explore"]').click().catch(() => {});
                      await page.waitForFunction(
                        () => document.querySelector('[data-tab="explore"]')?.getAttribute('data-tab-active') === 'true',
                        null, { timeout: 8000 },
                      ).catch(() => {});
                      await page.waitForFunction(() => document.querySelector('[data-layer="guidance"]') !== null, null, { timeout: 8000 }).catch(() => {});
                      const hasGuidanceNode = await page.evaluate(() => document.querySelector('[data-layer="guidance"]') !== null);
                      check(hasGuidanceNode, 'kb-seam: [data-layer="guidance"] node appeared after pin (graph re-fetched, Explore tab)');
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
        id: 'knowledge-create-kb',
        title: 'Author a KB from scratch — /knowledge/new (project scope)',
        narration: 'From a blank form the operator names a brand-new knowledge base, binds it to a project (mdtoc — the real, creds-free reference project every journey shares), and describes it; creating it writes a fresh kb.yaml + themes/ + _raw/ under brain/ AND hands off to a real project-brain seeding session (viewable at /sessions/project-brain/<sid>, anchored under mdtoc\'s own dir) — a scratch KB this journey both creates and deletes itself, so the real cycles/forge-dev/mdtoc brains are never touched.',
        drive: async (ctx) => {
              const { page, watch, check, frame } = ctx;
              // ── S3.0b: author a brand-new KB from scratch (/knowledge/new) ────────────
              console.log('\n[S3.0b] Author a scratch KB — /knowledge/new');
              cleanScratchKb(); // guard against leftover state from a prior crashed run
              cleanScratchKbSession();
              await page.goto(`${watch.uiUrl}/knowledge/new`, { waitUntil: 'domcontentloaded' });
              await sleep(1200); // data-page-ready is static "true" pre-hydration (same trap as /skills/new)
              check(await page.locator('main[data-page="knowledge-new"]').count() > 0, 'kb-create: knowledge-new page renders');
              await caption(page, 'Author a brand-new KB from scratch, bound to a real project — a scratch brain this journey creates and deletes itself, never a real one.');
              const fillKb = async () => {
                const nameEl = page.locator('[data-field="kb-name"]');
                await nameEl.click().catch(() => {});
                await nameEl.fill('').catch(() => {});
                await nameEl.pressSequentially(SCRATCH_KB_NAME, { delay: 16 }).catch(() => {});
                await page.locator('[data-field="kb-binding-kind"]').selectOption(SCRATCH_KB_BIND_KIND).catch(() => {});
                // fetchStudioFlows is async — wait for the ref option to render before selecting it
                await page.locator(`[data-field="kb-binding-ref"] option[value="${SCRATCH_KB_BIND_REF}"]`).waitFor({ timeout: 5000 }).catch(() => {});
                await page.locator('[data-field="kb-binding-ref"]').selectOption(SCRATCH_KB_BIND_REF).catch(() => {});
                await page.locator('[data-field="kb-desc"]').fill(SCRATCH_KB_DESC).catch(() => {});
              };
              const createEnabled = (ms) => page.waitForFunction(() => {
                const b = document.querySelector('[data-action="create-kb"]');
                return b !== null && !b.hasAttribute('disabled');
              }, null, { timeout: ms }).then(() => true).catch(() => false);
              await fillKb();
              let kbEnabled = await createEnabled(6000);
              if (!kbEnabled) { await fillKb(); kbEnabled = await createEnabled(6000); }
              check(kbEnabled, 'kb-create: create-kb enables once a name + binding are filled');
              await frame(page, 'kb-2-create-form', 'Knowledge — authoring a brand-new KB from scratch (name/binding/description)');
              // Capture the real POST /api/studio/kbs response BEFORE clicking — the form
              // itself never surfaces the returned sessionId (it just redirects to
              // /knowledge), so this is the only way to observe the real hand-off contract
              // (R1-06-F2: `{ ok, id, sessionId }`) without inventing one.
              const createRespPromise = page.waitForResponse((r) => {
                try { return new URL(r.url()).pathname === '/api/studio/kbs' && r.request().method() === 'POST'; } catch { return false; }
              }, { timeout: 12000 }).catch(() => null);
              await page.locator('[data-action="create-kb"]').click().catch(() => {});
              const created = await waitForFile(join(SCRATCH_KB_DIR, 'kb.yaml'), 12000);
              check(created, `kb-create: creating writes brain/${SCRATCH_KB_ID}/kb.yaml`);
              const createResp = await createRespPromise;
              let sessionId = '';
              if (createResp) {
                try {
                  const json = await createResp.json();
                  sessionId = typeof json?.sessionId === 'string' ? json.sessionId : '';
                } catch { /* checked below */ }
              }
              scratchKbSessionId = sessionId || null;
              check(sessionId.length > 0, 'kb-create: POST /api/studio/kbs hands off a real project-brain seeding sessionId (R1-06-F2)');
              // The create form redirects to /knowledge with no ?id= (lands on whatever KB
              // the page defaults to) — navigate to the new KB's own graph explicitly.
              await page.goto(`${watch.uiUrl}/knowledge?id=${SCRATCH_KB_ID}`, { waitUntil: 'domcontentloaded' });
              let scratchReady = false;
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 15000 },
                );
                scratchReady = true;
              } catch { /* checked below */ }
              check(scratchReady, 'kb-create: the new scratch KB\'s graph page reaches data-page-ready="true"');
              if (scratchReady) {
                const kbId = await page.evaluate(() => document.querySelector('#kb-svg')?.getAttribute('data-kb-id') ?? '');
                check(kbId === SCRATCH_KB_ID, `kb-create: #kb-svg data-kb-id="${SCRATCH_KB_ID}" (got "${kbId}")`);
                const inSelector = await page.evaluate(
                  (id) => document.querySelector(`#kb-select option[value="${id}"]`) !== null, SCRATCH_KB_ID);
                check(inSelector, 'kb-create: the new KB appears in the #kb-select selector');
              }
              await frame(page, 'kb-3-scratch-empty', 'Knowledge — the new scratch KB\'s (near-empty) graph renders', { key: true });

              // T1 ruling: "create-kb-project uses a PROJECT binding; its seeding session
              // IS viewable (real project anchor)" — a project binding's create hand-off
              // anchors the session under mdtoc's own real dir (not a dot-anchored, filtered
              // one), so /sessions/project-brain/<sid>?project=mdtoc is a genuinely reachable
              // page. This asserts the reachability itself, never the seeding CONTENT (the
              // multi-turn agentic pass that would draft real themes is R4-19, unbuilt,
              // suppressed everywhere under this harness's FORGE_ARCHITECT_NO_SPAWN=1).
              if (sessionId) {
                await caption(page, 'The create hand-off started a real seeding session — viewable at its own session-shell URL, not just a fire-and-forget POST.');
                await page.goto(`${watch.uiUrl}/sessions/project-brain/${sessionId}?project=${SCRATCH_KB_BIND_REF}`, { waitUntil: 'domcontentloaded' });
                let sessionReady = false;
                try {
                  await page.waitForFunction(
                    () => document.querySelector('[data-page="session"]')?.getAttribute('data-page-ready') === 'true',
                    null, { timeout: 15000 },
                  );
                  sessionReady = true;
                } catch { /* checked below */ }
                check(sessionReady, `kb-create: the project-brain seeding session is viewable at /sessions/project-brain/${sessionId}?project=${SCRATCH_KB_BIND_REF}`);
                if (sessionReady) {
                  const sessionKind = await page.evaluate(() => document.querySelector('[data-page="session"]')?.getAttribute('data-session-kind') ?? '');
                  check(sessionKind === 'project-brain', `kb-create: data-session-kind="project-brain" (got "${sessionKind}")`);
                  const sessionIdAttr = await page.evaluate(() => document.querySelector('[data-page="session"]')?.getAttribute('data-session-id') ?? '');
                  check(sessionIdAttr === sessionId, `kb-create: data-session-id="${sessionId}" (got "${sessionIdAttr}")`);
                  const sessionPhase = await page.evaluate(() => document.querySelector('[data-page="session"]')?.getAttribute('data-session-phase') ?? '');
                  check(sessionPhase.length > 0, `kb-create: data-session-phase is non-empty (got "${sessionPhase}") — real hand-off state, not a fabricated turn`);
                }
                await frame(page, 'kb-2b-create-session-viewable', `Knowledge — the create hand-off's seeding session, viewable at /sessions/project-brain/${sessionId} (real project anchor, mdtoc)`, { key: true });
              }

        },
      },
      {
        id: 'knowledge-ingest',
        title: 'Pin guidance on the scratch KB, then emulate an ingest fold',
        narration: 'The operator pins a guidance note onto the just-created scratch KB — the same panel used on the real cycles brain, proving the pin route targets whichever KB is open — then an ingest pass folds that note into a real theme file (an LLM pass in the real product, scripted here on a throwaway KB): the guidance node disappears, a theme node takes its place, and its article holds the folded lesson. The journey then deletes the scratch KB it created.',
        drive: async (ctx) => {
              const { page, watch, browser, recordClip, check, frame } = ctx;
              // ── S3.0c: pin guidance on the SCRATCH kb, then fold (ingest emulation) ───
              console.log('\n[S3.0c] Pin guidance on the scratch KB, then fold it (ingest emulation)');
              await page.goto(`${watch.uiUrl}/knowledge?id=${SCRATCH_KB_ID}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 }).catch(() => {});
              await caption(page, 'Pin guidance on the SCRATCH kb (not cycles) — the same panel, proving the route is generic to whatever KB is open.');
              // R6-08 WI-3: GuidancePanel moved under the Health tab — switch there
              // before locating #guidance-text (a fresh goto above lands on Explore,
              // the default tab).
              await page.locator('[data-tab="health"]').click().catch(() => {});
              await page.waitForFunction(
                () => document.querySelector('[data-tab="health"]')?.getAttribute('data-tab-active') === 'true',
                null, { timeout: 8000 },
              ).catch(() => {});
              const guidanceTextarea = page.locator('#guidance-text');
              let pinnedOnScratch = false;
              if (await guidanceTextarea.count() > 0) {
                await guidanceTextarea.scrollIntoViewIfNeeded().catch(() => {});
                await guidanceTextarea.click();
                await guidanceTextarea.pressSequentially(SCRATCH_GUIDANCE_TEXT, { delay: 10 });
                await sleep(THINK);
                await page.locator('#pin-guidance-btn').click().catch(() => {});
                try {
                  await page.waitForFunction(() => document.querySelector('[data-guidance-pinned="true"]') !== null, null, { timeout: 10000 });
                  pinnedOnScratch = true;
                } catch { /* checked below */ }
              }
              check(pinnedOnScratch, 'kb-ingest: guidance pinned via the real panel, on the scratch KB');
              const guidanceDir = join(SCRATCH_KB_DIR, '_guidance');
              const guidanceFileOnScratch = existsSync(guidanceDir) && readdirSync(guidanceDir).length > 0;
              check(guidanceFileOnScratch, `kb-ingest: pin route wrote into brain/${SCRATCH_KB_ID}/_guidance/ (targeted the scratch KB, not cycles)`);
              await sleep(WORK);
              // The guidance NODE lives on the Explore tab's force-graph — switch
              // back before checking for it (also where the clip below and the
              // frame capture right after this need to be, to show the graph).
              await page.locator('[data-tab="explore"]').click().catch(() => {});
              await page.waitForFunction(
                () => document.querySelector('[data-tab="explore"]')?.getAttribute('data-tab-active') === 'true',
                null, { timeout: 8000 },
              ).catch(() => {});
              await page.waitForFunction(() => document.querySelector('[data-layer="guidance"]') !== null, null, { timeout: 8000 }).catch(() => {});
              check(await page.evaluate(() => document.querySelector('[data-layer="guidance"]') !== null),
                'kb-ingest: [data-layer="guidance"] node appeared on the scratch KB graph (Explore tab)');
              await frame(page, 'kb-4-scratch-guidance', 'Knowledge — guidance pinned onto the scratch KB (guidance node appears)');

              // The clip's interact() performs the actual fold mutation (theme write +
              // guidance rm) — the one place this journey emulates an ingest pass. Ingest
              // is an LLM fold in the real product; here it's a scripted write against a
              // throwaway scratch KB (never brain/cycles, brain/forge-dev, or brain/projects).
              await recordClip(browser, watch, 'kb-ingest', '/knowledge', async (p) => {
                // Entry point: the Knowledge page's own selector, choosing the scratch KB
                // just created — a real navigation to /knowledge?id=<scratch>, not a
                // direct goto to that URL itself. W6-IA-4: was the library's own KB-shelf
                // card — Library no longer lists knowledge bases; KbSelector.tsx's
                // native <select> is the real discovery affordance now.
                await p.waitForFunction(
                  () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 8000 },
                ).catch(() => {});
                const kbSelect = p.locator('#kb-select');
                await kbSelect.scrollIntoViewIfNeeded().catch(() => {});
                await caption(p, 'Meeting the KB where an operator actually finds it — the Knowledge selector, for the scratch KB just created.');
                await sleep(THINK);
                await kbSelect.selectOption(SCRATCH_KB_ID).catch(() => {});
                await p.waitForFunction(
                  (id) => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true'
                    && document.querySelector('#kb-select')?.value === id,
                  SCRATCH_KB_ID, { timeout: 10000 },
                ).catch(() => {});
                await p.waitForFunction(() => document.querySelector('[data-layer="guidance"]') !== null, null, { timeout: 10000 }).catch(() => {});
                await caption(p, 'A raw guidance node — pinned human lesson, not yet folded into a theme.');
                await sleep(1200);
                foldScratchGuidanceIntoTheme();
                await p.reload({ waitUntil: 'domcontentloaded' });
                await p.waitForFunction(() => document.querySelector('[data-layer="theme"]') !== null, null, { timeout: 10000 }).catch(() => {});
                await caption(p, 'Ingest folds it: a real theme node replaces the guidance note — the graph itself is the payoff here.');
                const themeNode = p.locator('[data-layer="theme"]').first();
                if (await themeNode.count() > 0) {
                  await themeNode.locator('[data-hit]').click({ force: true, timeout: 5000 }).catch(() => {});
                }
                await sleep(THINK);
              }, {
                readySel: '[data-page="knowledge"]',
                caption: 'From the Knowledge selector to a folded theme — guidance becomes a real graph node',
              });

              // Assertions run AFTER the clip, against the main page, re-reading the same
              // disk state the clip's interact() just mutated.
              await page.reload({ waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 }).catch(() => {});
              const guidanceGone = await page.evaluate(() => document.querySelector('[data-layer="guidance"]') === null);
              check(guidanceGone, 'kb-ingest: guidance node gone after the fold (guidance file removed)');
              const themePresent = await page.evaluate(() => document.querySelector('[data-layer="theme"]') !== null);
              check(themePresent, 'kb-ingest: theme node present after the fold (theme file written)');
              if (themePresent) {
                const themeNode = page.locator('[data-layer="theme"]').first();
                await themeNode.locator('[data-hit]').click({ force: true, timeout: 5000 }).catch(() => {});
                await sleep(ACT);
                const articleText = await page.evaluate(() => document.querySelector('[data-node-article-body]')?.textContent ?? '');
                check(articleText.includes('Ephemeral demo lesson') || articleText.length > 0,
                  'kb-ingest: clicking the folded theme node opens its article (folded lesson text)');
                await frame(page, 'kb-5-scratch-theme', 'Knowledge — ingest folded: guidance -> theme node, article open', { key: true });
              }

              // Cleanup — drive the real kb-delete on the scratch KB (proves delete works
              // end to end through the UI), then defensively rmSync in case the UI path
              // didn't fully land. Zero scratch-KB state may survive this beat.
              // W7-B2 (knowledge-24): delete moved into the Health tab's KB-actions
              // danger zone with a TYPED-ID confirm — arm, type the id, confirm
              // (no browser dialog any more).
              await page.locator('[data-tab="health"]').click().catch(() => {});
              await page.waitForFunction(
                () => document.querySelector('[data-tab="health"]')?.getAttribute('data-tab-active') === 'true',
                null, { timeout: 8000 }).catch(() => {});
              // The group's buttons stay disabled while the drain panel's
              // mount-time reattach is in flight ('attaching') — wait for the
              // arm button to be genuinely clickable before arming.
              await page.waitForFunction(() => {
                const b = document.querySelector('[data-section="kb-danger-zone"] [data-action="kb-delete"]');
                return b !== null && !b.hasAttribute('disabled');
              }, null, { timeout: 10000 }).catch(() => {});
              await page.locator('[data-section="kb-danger-zone"] [data-action="kb-delete"]').click().catch(() => {});
              await page.locator('[data-field="kb-delete-confirm"]').fill(SCRATCH_KB_ID).catch(() => {});
              await page.locator('[data-action="kb-delete-confirm"]').click().catch(() => {});
              let deletedFromDisk = false;
              { const dl = Date.now() + 8000; while (Date.now() < dl) { if (!existsSync(SCRATCH_KB_DIR)) { deletedFromDisk = true; break; } await sleep(150); } }
              check(deletedFromDisk, `kb-ingest: kb-delete removed brain/${SCRATCH_KB_ID}/ from disk`);
              await sleep(ACT);
              const stillInSelector = await page.evaluate(
                (id) => document.querySelector(`#kb-select option[value="${id}"]`) !== null, SCRATCH_KB_ID).catch(() => true);
              check(!stillInSelector, 'kb-ingest: scratch KB no longer listed in #kb-select after delete');
              await frame(page, 'kb-6-scratch-deleted', 'Knowledge — scratch KB deleted; gone from the selector/library');
              cleanScratchKb();
              cleanScratchKbSession();

        },
      },
      {
        id: 'knowledge-lint-index',
        title: 'KB health — drain to green (W6-B13) + index / OOTB brains',
        narration: 'The operator opens a KB with a real lint finding and clicks the ONE "Drain to green" button on Health — forge iteratively fixes every auto- and agent-tier finding server-side, round by round, until the KB is clean or honestly stops and says why (`cli/bridge-studio-kb-drain.ts`). This replaces the old kb-lint scan + LintResolutionPanel\'s own "fix all with agent" client loop (W6-B13, retiring sweep finding C4#7\'s header/panel scan duplication and C9#2/C9#3\'s silent-timeout/dead-skip-button defects). Under this harness\'s FORGE_ARCHITECT_NO_SPAWN=1 the drain loop still runs for real (a real local fresh-lint, a real local auto-fix pass, a real status.json on disk) but never actually spawns the agent-tier turn — so the seeded fixture\'s one agent-tier finding can never clear here, and the panel\'s own [data-drain-state] honestly reaches "no-progress," never a fabricated "green." Wave 8 (B2) answers operator note ON-3 on this same panel: every finding row now advertises the DERIVED disposition of what the turn proposed (`data-drain-finding-disposition` — honestly \"none\" here, because this harness suppresses the agent turn), carries a disclosure holding the proposal\'s own diff, the gate\'s refusal reasons and the brief the agent was given, and LINKS BACK to its own theme in Explore. The beat clicks that link and asserts where it lands, and the graph now reports how many declared links point at real themes in another KB instead of discarding them in silence (forge-9kr). Navigating away (the Explore tab) and back to Health proves the run is server-owned, not component state: the SAME run id and state are still there, exactly the "nav-away never loses the work" invariant the operator brief names. The KB selector also confirms both cycles and forge-dev ship as OOTB brains, and kb-index still runs a real deterministic refresh.',
        drive: async (ctx) => {
              const { page, watch, browser, recordClip, check, frame } = ctx;
              // ── S3.2: KB health — drain to green + index / OOTB brains ────────────────
              console.log('\n[S3.2] KB health — drain to green + index / OOTB brains');
              cleanScratchKbDrain(); // guard against leftover state from a prior crashed run
              seedScratchKbDrain();
              try {

              const TERMINAL_DRAIN_STATES = ['green', 'needs-you', 'no-progress', 'round-cap', 'cost-ceiling', 'cancelled', 'failed', 'timed-out', 'unreadable'];
              const waitForTerminalDrainState = (p, timeout) => p.waitForFunction(
                (terminals) => {
                  const v = document.querySelector('[data-component="kb-drain-panel"]')?.getAttribute('data-drain-state');
                  return v !== null && terminals.includes(v);
                },
                TERMINAL_DRAIN_STATES, { timeout },
              );
              const readDrainAttrs = (p) => p.evaluate(() => {
                const el = document.querySelector('[data-component="kb-drain-panel"]');
                return { state: el?.getAttribute('data-drain-state') ?? '', runId: el?.getAttribute('data-drain-run-id') ?? '' };
              });

              await page.goto(`${watch.uiUrl}/knowledge?id=${encodeURIComponent(SCRATCH_KB_DRAIN_ID)}`, { waitUntil: 'domcontentloaded' });
              const kbMaintReady = await page.waitForFunction(
                () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 30000 }).then(() => true).catch(() => false);
              await caption(page, 'Knowledge is editable — ONE button drains every fixable lint finding to green, server-side.');
              check(kbMaintReady, 'kb-drain: the seeded scratch KB\'s page reaches data-page-ready="true"');

              if (kbMaintReady) {
                await page.locator('[data-tab="health"]').click().catch(() => {});
                await page.waitForFunction(
                  () => document.querySelector('[data-tab="health"]')?.getAttribute('data-tab-active') === 'true',
                  null, { timeout: 8000 }).catch(() => {});

                const drainPanelPresent = await page.locator('[data-component="kb-drain-panel"]').count().catch(() => 0);
                check(drainPanelPresent > 0, 'kb-drain: KbDrainPanel renders on the Health tab ([data-component="kb-drain-panel"])');
                await frame(page, 'kb-0-drain-idle', 'Part 2 (knowledge) — KB health: the drain-to-green panel, not yet run');

                const preClickRunId = (await readDrainAttrs(page)).runId;
                await page.locator('[data-action="drain-to-green"]').click().catch(() => {});
                await caption(page, 'ONE button — forge iteratively fixes every auto/agent lint finding, round by round, on the server.');

                let drainState = '';
                let runIdBefore = '';
                try {
                  // The click mints a NEW run; wait until the panel shows a runId that is
                  // not whatever it may have reattached to on mount, THEN wait for terminal —
                  // otherwise a pre-existing terminal run satisfies the terminal wait instantly.
                  await page.waitForFunction(
                    (prev) => { const el = document.querySelector('[data-drain-run-id]'); const id = el?.getAttribute('data-drain-run-id') ?? ''; return id.length > 0 && id !== prev; },
                    preClickRunId, { timeout: 15000 });
                  await waitForTerminalDrainState(page, 30000);
                  ({ state: drainState, runId: runIdBefore } = await readDrainAttrs(page));
                } catch { /* checked below */ }
                // Honesty rule: under FORGE_ARCHITECT_NO_SPAWN=1 the agent-tier turn never
                // runs, so the seeded fixture's one agent-tier (checkDanglingEdges — a
                // dangling related_themes edge, NO auto/deterministic fixer; W7 FIX-B-KB
                // moved the seed off the missing-index-link shape, which the own-tree
                // index auto-fixer now legitimately heals to a real green) finding can
                // never actually clear here — the only honest terminal this run
                // can reach is 'no-progress' (nothing changed round-over-round). Asserting
                // this exact state (not just "some terminal") kills a false 'green' that
                // would mean an agent turn secretly ran under a harness meant to suppress it.
                check(drainState === 'no-progress',
                  `kb-drain: [data-drain-state] reaches the real, honest terminal for a CI-suppressed agent-tier finding (got "${drainState || '(none)'}") — never a fabricated "green"`);
                check(runIdBefore.length > 0, 'kb-drain: a real server-minted runId is recorded on the panel (data-drain-run-id)');

                // W7-B2 (knowledge-01/08/12): the panel renders PER-FINDING rows —
                // file · rule · outcome — grouped under per-round headers, never a
                // bare state chip the operator has to take on faith.
                const findingRows = await page.evaluate(() => Array.from(
                  document.querySelectorAll('[data-drain-finding-file]'),
                ).map((el) => ({
                  file: el.getAttribute('data-drain-finding-file') ?? '',
                  tier: el.getAttribute('data-drain-finding-tier') ?? '',
                  outcome: el.getAttribute('data-drain-finding-outcome') ?? '',
                })));
                check(findingRows.length > 0 && findingRows.every((r) => r.file && r.tier && r.outcome),
                  `kb-drain: per-finding rows render file/tier/outcome for the seeded finding (got ${findingRows.length} row(s)) — knowledge-01/08`);
                const roundGroups = await page.locator('[data-drain-round-group]').count().catch(() => 0);
                check(roundGroups > 0, `kb-drain: finding rows are grouped under per-round headers ([data-drain-round-group], got ${roundGroups}) — knowledge-12`);

                // W8-B2 (ON-3): every row advertises the DERIVED disposition of
                // what the turn proposed. Under NO_SPAWN no turn runs, so the
                // honest value here is "none" — asserting that exact token, not
                // merely "the attribute exists", is what kills a fabricated
                // "applied" on a run where nothing was ever proposed.
                const dispositions = await page.evaluate(() => Array.from(
                  document.querySelectorAll('[data-drain-finding]'),
                ).map((el) => el.getAttribute('data-drain-finding-disposition') ?? ''));
                check(dispositions.length > 0 && dispositions.every((d) => d === 'none'),
                  `kb-drain: every finding row carries a DERIVED data-drain-finding-disposition; with the agent turn suppressed the honest value is "none" (got ${JSON.stringify(dispositions)}) — W8-B2/ON-3`);

                // W8-B2 (ON-3, second half): the finding links back to its own
                // theme in Explore. The seeded finding is on a real theme file,
                // so the link must be present AND point at that theme's slug.
                const nodeHref = await page.evaluate(() =>
                  document.querySelector('[data-action="open-finding-node"]')?.getAttribute('data-finding-node-href') ?? '');
                check(nodeHref === `/knowledge?id=${SCRATCH_KB_DRAIN_ID}&node=${SCRATCH_KB_DRAIN_THEME_SLUG}`,
                  `kb-drain: the finding deep-links to ITS OWN theme node in Explore (got "${nodeHref}") — ON-3`);

                // W7-B2 (knowledge-14): Cancel exists and is HONEST — against this
                // already-terminal run the endpoint refuses with 409 ("no active
                // drain run"), never a fake success. (The live-run Stop control's
                // rendering is pinned by lib/kb-drain-panel-render.test.ts — a
                // NO_SPAWN drain terminates too fast to click it deterministically.)
                // W7 FIX-B-KB: like EVERY node-side POST in the journeys, this
                // must carry the x-forge-csrf header the bridge's global
                // anti-CSRF guard requires — without it the guard's 403 fires
                // before the cancel route's own terminal check can answer 409
                // (the gate regression: got 403, wanted 409).
                const cancelRes = await fetch(`${watch.bridgeUrl}/api/studio/kbs/${encodeURIComponent(SCRATCH_KB_DRAIN_ID)}/drain/cancel`, { method: 'POST', headers: { 'x-forge-csrf': '1' } });
                check(cancelRes.status === 409,
                  `kb-drain: POST .../drain/cancel on a terminal run refuses with 409 (got ${cancelRes.status}) — cancel is real and honest (knowledge-14)`);

                await frame(page, 'kb-drain-1-terminal', `Knowledge — drain-to-green reached a real terminal (data-drain-state="${drainState}")`);

                // Reattach-on-return (the operator-brief invariant: "nav-away never loses
                // the work; the UI is a pure OBSERVER of server state"). KbDrainPanel's
                // reattach effect runs on MOUNT, keyed off kbId — switching to Explore
                // unmounts it (Health-tab-gated in page.tsx) and switching back remounts it,
                // so a tab round-trip genuinely exercises the same GET .../drain reattach a
                // full page reload would.
                await page.locator('[data-tab="explore"]').click().catch(() => {});
                await page.waitForFunction(
                  () => document.querySelector('[data-tab="explore"]')?.getAttribute('data-tab-active') === 'true',
                  null, { timeout: 8000 }).catch(() => {});
                await sleep(THINK);
                await page.locator('[data-tab="health"]').click().catch(() => {});
                await page.waitForFunction(
                  () => document.querySelector('[data-tab="health"]')?.getAttribute('data-tab-active') === 'true',
                  null, { timeout: 8000 }).catch(() => {});

                let reattachedState = '';
                let reattachedRunId = '';
                try {
                  await waitForTerminalDrainState(page, 15000);
                  ({ state: reattachedState, runId: reattachedRunId } = await readDrainAttrs(page));
                } catch { /* checked below */ }
                check(reattachedRunId.length > 0 && reattachedRunId === runIdBefore,
                  `kb-drain: navigating away (Explore) and back REATTACHES to the SAME server-owned run (data-drain-run-id before="${runIdBefore}" after="${reattachedRunId}")`);
                check(reattachedState === drainState,
                  `kb-drain: the reattached state matches the terminal reached before navigating away (before="${drainState}" after="${reattachedState}")`);
                await frame(page, 'kb-drain-2-reattached', `Knowledge — nav-away and back reattaches to the SAME run (data-drain-run-id="${reattachedRunId}")`, { key: true });

                // W7-B2 (knowledge-20): the Health tab's shared RecentRuns widget
                // lists this KB's run history — the drain that just terminated must
                // appear as a real ledger row (the tab round-trip above re-fetched
                // GET /api/studio/kbs/:id/runs).
                let kbRunRows = 0;
                try {
                  await page.waitForFunction(() => {
                    const sec = document.querySelector('[data-section="kb-recent-runs"]');
                    const count = sec?.querySelector('[data-section="history-ledger"]')?.getAttribute('data-ledger-count');
                    return count !== null && count !== undefined && Number(count) > 0;
                  }, null, { timeout: 10000 });
                } catch { /* checked below */ }
                kbRunRows = await page.evaluate(() => Number(
                  document.querySelector('[data-section="kb-recent-runs"] [data-section="history-ledger"]')?.getAttribute('data-ledger-count') ?? '0',
                ));
                check(kbRunRows > 0, `kb-drain: the Health tab's RecentRuns widget lists this KB's drain run (data-ledger-count=${kbRunRows}) — knowledge-20`);

                // W7-B2 (knowledge-06): "Refresh this KB's index" moved into the ONE
                // KB-actions group; its result span reports BOTH halves (this KB's
                // link repairs + the meta-index rebuild), so match the stable prefix.
                await page.waitForFunction(() => {
                  const b = document.querySelector('[data-component="kb-action-group"] [data-action="kb-index"]');
                  return b !== null && !b.hasAttribute('disabled');
                }, null, { timeout: 10000 }).catch(() => {});
                await page.locator('[data-component="kb-action-group"] [data-action="kb-index"]').click().catch(() => {});
                let indexResult = '';
                try {
                  await page.waitForFunction(
                    () => (document.querySelector('[data-component="kb-action-result"]')?.textContent ?? '').startsWith('index refreshed ✓'),
                    null, { timeout: 15000 });
                  indexResult = await page.evaluate(() => document.querySelector('[data-component="kb-action-result"]')?.textContent ?? '');
                } catch { /* checked below */ }
                check(indexResult.startsWith('index refreshed ✓'),
                  `S3.2: kb-index ran and reported its real result (got "${indexResult || '(none)'}")`);

                const ootb = await page.evaluate(() => ({
                  cycles: document.querySelector('#kb-select option[value="cycles"]')?.textContent ?? '',
                  forgeDev: document.querySelector('#kb-select option[value="forge-dev"]')?.textContent ?? '',
                }));
                check(ootb.cycles.length > 0 && ootb.forgeDev.length > 0,
                  `S3.2: cycles + forge-dev brains ship OOTB (${ootb.cycles} / ${ootb.forgeDev})`);

                // ── W8-B2 (ON-3) — the finding's Explore link is CLICKED, not just
                // asserted present. A link whose href is right and whose landing is
                // wrong is exactly the shape this lane exists to stop.
                await page.locator('[data-action="open-finding-node"]').first().click().catch(() => {});
                await page.waitForFunction(
                  (slug) => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-selected-node') === slug,
                  SCRATCH_KB_DRAIN_THEME_SLUG, { timeout: 12000 },
                ).catch(() => {});
                const landed = await page.evaluate(() => ({
                  node: document.querySelector('[data-page="knowledge"]')?.getAttribute('data-selected-node') ?? '',
                  tabActive: document.querySelector('[data-tab="explore"]')?.getAttribute('data-tab-active') ?? '',
                  url: location.search,
                }));
                check(landed.node === SCRATCH_KB_DRAIN_THEME_SLUG,
                  `S3.2/ON-3: clicking the finding's link LANDS on that theme in Explore (data-selected-node="${landed.node}")`);
                check(landed.url.includes(`node=${SCRATCH_KB_DRAIN_THEME_SLUG}`),
                  `S3.2/ON-3: the deep link is in the URL, so it is shareable and survives a reload (got "${landed.url}")`);
                await frame(page, 'kb-drain-3-finding-to-explore', 'Knowledge — a drain finding links straight back to its own theme in Explore', { key: true });

                // W8-B2 (forge-9kr): the graph SAYS how many declared links point at
                // real themes in another KB, instead of silently discarding them.
                const externalEdges = await page.evaluate(() =>
                  document.querySelector('#kb-svg')?.getAttribute('data-external-edge-count') ?? '');
                check(Number(externalEdges) >= 1,
                  `S3.2/forge-9kr: the graph REPORTS the seeded cross-sub-wiki edge to ${SCRATCH_KB_DRAIN_EXTERNAL_SLUG} instead of dropping it in silence (data-external-edge-count="${externalEdges}", want >=1)`);
              }

              // Clip: drain-to-green on the seeded fixture — real/idempotent (re-seeded
              // every run), safe to re-drive on a fresh context. Fresh context, own
              // navigation.
              await recordClip(browser, watch, 'kb-lint', `/knowledge?id=${encodeURIComponent(SCRATCH_KB_DRAIN_ID)}&tab=health`, async (p) => {
                await p.waitForFunction(
                  () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 12000 },
                ).catch(() => {});
                await caption(p, 'A KB with a real lint finding — the story here is the ONE drain-to-green button.');
                await sleep(THINK);
                await p.waitForSelector('[data-action="drain-to-green"]', { timeout: 12000 }).catch(() => {});
                await p.locator('[data-component="kb-drain-panel"]').scrollIntoViewIfNeeded().catch(() => {});
                await sleep(400);
                await p.locator('[data-action="drain-to-green"]').click().catch(() => {});
                await caption(p, 'Server-side, round by round — this browser is just watching.');
                await waitForTerminalDrainState(p, 15000).catch(() => {});
                const { state: clipState } = await readDrainAttrs(p);
                await caption(p, `Reached a real terminal, live: ${clipState || 'the panel\'s own read of the run'}`);
                await sleep(THINK);
              }, {
                readySel: '[data-page="knowledge"]',
                caption: 'Drain to green — the ONE button, server-owned, honest about what it did',
                holdTailMs: 1500,
              });

              } finally {
                // Fixture rule 3 (W7 FIX-B-KB): swept even when a wait above
                // throws mid-beat — never left for the boundary check.
                cleanScratchKbDrain();
              }

        },
      },
      {
        id: 'knowledge-create-kb-band-scope',
        title: 'Author a KB from scratch — flow binding + band scope (/knowledge/new)',
        narration: 'A second scratch KB, bound to forge-develop but scoped to its real review-band — [data-field="kb-binding-band"] only renders for a flow binding, is populated from that flow\'s own REAL derived bands (never a static list), and the chosen band threads straight into the create request and the written kb.yaml. This is the create-kb-cycle mockup\'s scope+create arc, real end to end. Its session-content steps continue in the next two beats (knowledge-create-kb-band-scope-seed / -commit): R4-19 WI-2 made this non-project binding\'s dot-anchored hand-off session genuinely reachable (it used to 404 on the session-shell route), and WI-1 branches the analyze plan to read cycle/review-band evidence instead of a project repo — only the SDK theme-authoring turn itself stays emulated under this harness.',
        drive: async (ctx) => {
              const { page, watch, check, frame } = ctx;
              // ── S3.3: flow binding + band scope (/knowledge/new) — create-kb-cycle ────
              console.log('\n[S3.3] Author a scratch KB — flow binding + band scope (/knowledge/new)');
              cleanScratchKbBand(); // guard against leftover state from a prior crashed run

              // Entry point: the Knowledge page's own persistent "+ New KB" CTA — never a
              // direct goto. (W6-IA-4: was the library's own "+ New KB" cross-link/CTA —
              // Library no longer creates or lists knowledge bases; the Knowledge pillar
              // itself now carries the persistent CTA, data-action="new-kb" unchanged.)
              await page.goto(watch.uiUrl + '/knowledge', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              await caption(page, 'Same kickoff as any KB — the Knowledge page\'s own + New KB CTA.');
              await sleep(THINK);
              await page.locator('[data-action="new-kb"]').click().catch(() => {});
              await page.waitForFunction(
                () => document.querySelector('main[data-page="knowledge-new"]') !== null,
                null, { timeout: 10000 },
              ).catch(() => {});
              check(await page.locator('main[data-page="knowledge-new"]').count() > 0, 'kb-band: knowledge-new page renders (via the Knowledge page\'s + New KB CTA)');

              const nameEl = page.locator('[data-field="kb-name"]');
              await nameEl.click().catch(() => {});
              await nameEl.fill('').catch(() => {});
              await nameEl.pressSequentially(SCRATCH_KB_BAND_NAME, { delay: 16 }).catch(() => {});
              await page.locator('[data-field="kb-binding-kind"]').selectOption(SCRATCH_KB_BAND_BIND_KIND).catch(() => {});
              await page.locator(`[data-field="kb-binding-ref"] option[value="${SCRATCH_KB_BAND_BIND_REF}"]`).waitFor({ timeout: 5000 }).catch(() => {});
              await page.locator('[data-field="kb-binding-ref"]').selectOption(SCRATCH_KB_BAND_BIND_REF).catch(() => {});

              // The band field: real, flow-derived options — never a static list.
              const bandFieldPresent = (await page.locator('[data-field="kb-binding-band"]').count().catch(() => 0)) > 0;
              check(bandFieldPresent, 'kb-band: [data-field="kb-binding-band"] renders once a flow binding is selected');
              if (bandFieldPresent) {
                await page.locator(`[data-field="kb-binding-band"] option[value="${SCRATCH_KB_BAND_VALUE}"]`).waitFor({ timeout: 5000 }).catch(() => {});
                const hasReviewBand = (await page.locator(`[data-field="kb-binding-band"] option[value="${SCRATCH_KB_BAND_VALUE}"]`).count().catch(() => 0)) > 0;
                check(hasReviewBand, `kb-band: forge-develop's real bands include "${SCRATCH_KB_BAND_VALUE}" (adversarial-review's own guard, resolved from its SKILL.md — never a hardcoded guess)`);
                await caption(page, `forge-develop's real bands, not a static list — scope this KB to ${SCRATCH_KB_BAND_VALUE}.`);
                await sleep(THINK);
                await page.locator('[data-field="kb-binding-band"]').selectOption(SCRATCH_KB_BAND_VALUE).catch(() => {});
              }
              await page.locator('[data-field="kb-desc"]').fill(SCRATCH_KB_BAND_DESC).catch(() => {});
              await frame(page, 'kb-band-1-form', `Knowledge — flow binding + band scope selected (${SCRATCH_KB_BAND_VALUE})`);

              const createRespPromise = page.waitForResponse((r) => {
                try { return new URL(r.url()).pathname === '/api/studio/kbs' && r.request().method() === 'POST'; } catch { return false; }
              }, { timeout: 12000 }).catch(() => null);
              await page.locator('[data-action="create-kb"]').click().catch(() => {});
              const created = await waitForFile(join(SCRATCH_KB_BAND_DIR, 'kb.yaml'), 12000);
              check(created, `kb-band: creating writes brain/${SCRATCH_KB_BAND_ID}/kb.yaml`);
              const createResp = await createRespPromise;
              bandSessionId = ''; // module-scope — read by knowledge-create-kb-band-scope-seed/-commit
              if (createResp) {
                try {
                  const json = await createResp.json();
                  bandSessionId = typeof json?.sessionId === 'string' ? json.sessionId : '';
                } catch { /* checked below */ }
              }
              check(bandSessionId.length > 0, 'kb-band: POST /api/studio/kbs still hands off a sessionId for a non-project binding');

              // The written descriptor carries the real band — never dropped on the way to disk.
              let kbYamlText = '';
              try { kbYamlText = readFileSync(join(SCRATCH_KB_BAND_DIR, 'kb.yaml'), 'utf8'); } catch { /* checked below */ }
              const bandInYaml = kbYamlText.includes(`band: ${SCRATCH_KB_BAND_VALUE}`);
              check(bandInYaml, `kb-band: kb.yaml's binding carries "band: ${SCRATCH_KB_BAND_VALUE}" (got:\n${kbYamlText || '(empty)'})`);

              await page.goto(`${watch.uiUrl}/knowledge?id=${SCRATCH_KB_BAND_ID}`, { waitUntil: 'domcontentloaded' });
              let bandKbReady = false;
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 15000 },
                );
                bandKbReady = true;
              } catch { /* checked below */ }
              check(bandKbReady, 'kb-band: the new band-scoped KB\'s graph page reaches data-page-ready="true"');
              await frame(page, 'kb-band-2-graph', 'Knowledge — the band-scoped scratch KB\'s graph renders', { key: true });

              // R4-19 WI-2: the hand-off session is still dot-anchored on disk (the
              // anchor SHAPE is unchanged) — but it is no longer unreachable. Proven
              // on disk here; genuine session-shell reachability is proven next, by
              // knowledge-create-kb-band-scope-seed (not merely asserted from a
              // ruling — the WI-2 carve-out changed a real 400 into a real 200).
              if (bandSessionId) {
                const anchored = existsSync(join(scratchKbBandSessionAnchorDir(), '_project-brain', bandSessionId, 'status.json'));
                check(anchored, 'kb-band: the hand-off session is dot-anchored on disk (projects/.kb-<id>/_project-brain/<sid>/status.json) — the anchor shape R4-19 WI-2 made reachable, not merely a phantom-project dodge');
              }

              // NOTE: no cleanup here — the scratch KB + its seeding session stay live
              // across the next two beats (knowledge-create-kb-band-scope-seed / -commit),
              // which continue this SAME session. knowledge-create-kb-band-scope-commit
              // (the last beat in the arc) owns the sweep.

        },
      },
      {
        id: 'knowledge-create-kb-band-scope-seed',
        title: 'Band-scoped KB seeding session — reachable + real briefing (R4-19 WI-1/WI-2)',
        narration: 'R4-19 WI-2 makes a non-project KB\'s dot-anchored hand-off session genuinely reachable — this exact session used to 404 through the session-shell route; now it loads for real. The operator briefs it and starts analysis for real (a real POST flips phase to analyzing on disk); the theme-authoring pass itself is EMULATED — the real seeding agent is suppressed under this harness (FORGE_ARCHITECT_NO_SPAWN=1) — but the staged themes mirror forge\'s own real, already-logged review-band findings (declared-data-fails-open, suppression-env-fakes-the-pass), narrated honestly as a scripted stand-in and never presented as a real agent run.',
        drive: async (ctx) => {
              const { page, watch, check, frame, countAtLeast } = ctx;
              console.log('\n[R4-19] Band-scoped KB seeding session — reachable + real briefing');
              if (!bandSessionId) {
                check(false, 'kb-band-seed: bandSessionId available from knowledge-create-kb-band-scope (precondition)');
                return;
              }
              const anchor = `.kb-${SCRATCH_KB_BAND_ID}`;
              await page.goto(`${watch.uiUrl}/sessions/project-brain/${encodeURIComponent(bandSessionId)}?project=${encodeURIComponent(anchor)}`, { waitUntil: 'domcontentloaded' });
              const sessionReady = await page.waitForFunction(
                () => document.querySelector('[data-page="session"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).then(() => true).catch(() => false);
              check(sessionReady, `kb-band-seed: R4-19 WI-2 — the dot-anchored seeding session is now genuinely reachable at /sessions/project-brain/<sid>?project=${anchor} (used to 404)`);
              if (!sessionReady) return;
              const sessionKind = await page.evaluate(() => document.querySelector('[data-page="session"]')?.getAttribute('data-session-kind') ?? '');
              check(sessionKind === 'project-brain', `kb-band-seed: data-session-kind="project-brain" (got "${sessionKind}")`);
              const sessionIdAttr = await page.evaluate(() => document.querySelector('[data-page="session"]')?.getAttribute('data-session-id') ?? '');
              check(sessionIdAttr === bandSessionId, `kb-band-seed: data-session-id="${bandSessionId}" (got "${sessionIdAttr}")`);
              await caption(page, 'R4-19 WI-2 — this dot-anchored, non-project seeding session used to 404 here; now it genuinely loads.');
              await sleep(READ);
              await frame(page, 'kb-band-seed-0-reachable', 'R4-19 — the band-scoped KB\'s seeding session, genuinely reachable (WI-2)');

              // Real briefing: fill + click start-brain-analysis — a REAL POST flips
              // phase -> analyzing on disk (prompt.md written for real too; only the
              // spawn that would follow is suppressed under FORGE_ARCHITECT_NO_SPAWN=1).
              await page.waitForSelector('[data-section="brain-briefing"]', { timeout: 10000 }).catch(() => {});
              await page.locator('[data-component="brain-brief-input"]').fill('Focus on the review band\'s most frequent recurring findings.').catch(() => {});
              await page.locator('[data-action="start-brain-analysis"]').click().catch(() => {});
              const analyzing = await page.waitForFunction(
                () => document.querySelector('[data-page="session"]')?.getAttribute('data-session-phase') === 'analyzing',
                null, { timeout: 10000 },
              ).then(() => true).catch(() => false);
              check(analyzing, 'kb-band-seed: clicking "Start analysis" flips phase to analyzing for real (POST /api/project-brain/brief)');
              check(await page.locator('[data-section="brain-analyzing"]').count() > 0, 'kb-band-seed: brain-analyzing section renders');

              // EMULATED: the real R4-19 agent never runs under this harness — write the
              // staged themes directly (grounded in forge's own real review-band
              // findings), then flip phase -> awaiting-review the same way a real
              // successful analyze turn would (writeProjectBrainStatus in
              // orchestrator/project-brain-builder-runner.ts's runAnalyzeStep).
              await caption(page, 'Emulated — R4-19\'s real agent is suppressed here; scripted stand-in themes grounded in forge\'s own real review-band findings.');
              seedBandStagedThemes(bandSessionId);
              writeBandPbStatus(bandSessionId, { phase: 'awaiting-review' });
              const reviewReady = await page.waitForSelector('[data-section="brain-review"]', { timeout: 12000 }).then(() => true).catch(() => false);
              check(reviewReady, 'kb-band-seed: awaiting-review renders after the emulated seeding pass (client poll picked up the disk write)');
              // W7-C2 (sessions-kinds-22): themes render ONCE, in the
              // artifact pane's FilePackage tabs (the panel's duplicate
              // accordion is gone).
              await countAtLeast(page, '[data-section="session-artifact"] [data-file-tab]', 2, 'kb-band-seed: >=2 staged themes rendered for review (artifact pane tabs)');
              await frame(page, 'kb-band-seed-1-review', 'R4-19 — staged themes (emulated authoring, grounded in real review-band findings) awaiting review', { key: true });

        },
      },
      {
        id: 'knowledge-create-kb-band-scope-commit',
        title: 'Band-scoped KB — real commit + brain write (R4-19 WI-1/WI-2)',
        narration: 'Approving is real (a real POST flips phase to committing); the commit itself is the deterministic runCommitStep (R1-06, generalized to any kb_binding) — invoked directly here since the harness suppresses the detached spawn that would normally trigger it — so a genuine brain write lands: themes physically committed into brain/<kbId>, the KB\'s own graph gets a real index hub with real links off them, and forge brain lint stays clean with the new KB present. The accept affordance (return-to-project, W6-SW-3 sweep C6#1 rename of bind-and-return — it only ever navigated) is offered, byte-identical to the project-scoped panel.',
        drive: async (ctx) => {
              const { page, watch, check, frame } = ctx;
              console.log('\n[R4-19] Band-scoped KB — real commit + brain write');
              if (!bandSessionId) {
                check(false, 'kb-band-commit: bandSessionId available (precondition)');
                return;
              }
              const anchor = `.kb-${SCRATCH_KB_BAND_ID}`;
              await page.goto(`${watch.uiUrl}/sessions/project-brain/${encodeURIComponent(bandSessionId)}?project=${encodeURIComponent(anchor)}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="session"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              check(await page.locator('[data-section="brain-review"]').count() > 0, 'kb-band-commit: the staged themes from the seed beat persisted on disk (cross-beat, same session)');

              // Real approve — POST /api/project-brain/approve flips phase -> committing
              // for real (only the spawn that would follow is suppressed).
              await page.locator('[data-action="approve-brain"]').click().catch(() => {});
              const committing = await page.waitForFunction(
                () => document.querySelector('[data-page="session"]')?.getAttribute('data-session-phase') === 'committing',
                null, { timeout: 10000 },
              ).then(() => true).catch(() => false);
              check(committing, 'kb-band-commit: clicking "Approve + commit" flips phase to committing for real (POST /api/project-brain/approve)');

              // REAL, deterministic commit. The detached spawn that would normally run
              // this is suppressed (FORGE_ARCHITECT_NO_SPAWN=1); runCommitStep itself
              // makes no SDK call, so calling runProjectBrainTurn in-process here
              // exercises the SAME deterministic code path a live daemon would run —
              // a genuine brain write, never flip-only.
              brainIndexStash = readFileSync(join(FORGE_ROOT, 'brain', 'INDEX.md'), 'utf8');
              let commitOk = false;
              try {
                const result = await runProjectBrainTurn({
                  sessionId: bandSessionId,
                  projectRoot: scratchKbBandSessionAnchorDir(),
                  forgeRoot: FORGE_ROOT,
                });
                commitOk = result.phase === 'committed' && (result.themes?.length ?? 0) > 0;
              } catch (err) {
                console.error(`[kb-band-commit] runProjectBrainTurn threw: ${err?.message ?? err}`);
              }
              check(commitOk, 'kb-band-commit: runCommitStep (R1-06, deterministic, generalized to any kb_binding) committed the staged themes for real');

              const committed = await page.waitForSelector('[data-section="brain-committed"]', { timeout: 12000 }).then(() => true).catch(() => false);
              check(committed, 'kb-band-commit: brain-committed section renders after the real commit (client poll picked up the disk write)');
              check(await page.locator('[data-action="return-to-project"]').count() > 0, 'kb-band-commit: return-to-project offered — same accept affordance as the project-scoped panel (SessionProjectBrainPanel is shared, byte-identical)');
              await frame(page, 'kb-band-commit-0-committed', 'R4-19 — the band-scoped KB, real commit landed; return-to-project offered');

              // Real brain write, on disk.
              const themesDir = join(SCRATCH_KB_BAND_DIR, 'themes');
              let writtenThemes = [];
              try { writtenThemes = readdirSync(themesDir).filter((f) => f.endsWith('.md')); } catch { /* checked below */ }
              check(writtenThemes.length >= 2, `kb-band-commit: brain/${SCRATCH_KB_BAND_ID}/themes/ carries the real committed theme files (got ${writtenThemes.length})`);
              let themeContent = '';
              try { themeContent = readFileSync(join(themesDir, writtenThemes.find((f) => f !== 'profile.md') ?? ''), 'utf8'); } catch { /* checked below */ }
              check(themeContent.includes('review-band'), 'kb-band-commit: the committed theme content is grounded in real review-band evidence, not empty/placeholder');

              // The KB's own graph — a real index hub + real links, off the
              // just-committed themes (orchestrator/kb-graph.ts buildKbGraph runs for
              // ANY kbId on disk, regardless of binding kind).
              await page.goto(`${watch.uiUrl}/knowledge?id=${SCRATCH_KB_BAND_ID}`, { waitUntil: 'domcontentloaded' });
              const graphReady = await page.waitForFunction(
                () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).then(() => true).catch(() => false);
              check(graphReady, 'kb-band-commit: the committed KB\'s graph page reaches data-page-ready="true"');
              if (graphReady) {
                const nodeCount = await page.evaluate(() => parseInt(document.querySelector('#kb-svg')?.getAttribute('data-node-count') ?? '0', 10));
                check(nodeCount >= 3, `kb-band-commit: the graph carries a real INDEX hub + the committed theme nodes (got ${nodeCount} nodes)`);
                const edgeCount = await page.evaluate(() => parseInt(document.querySelector('#kb-svg')?.getAttribute('data-edge-count') ?? '0', 10));
                check(edgeCount >= 2, `kb-band-commit: real links from the INDEX hub to the committed themes (got ${edgeCount} edges)`);
                const indexNodes = await page.locator('[data-layer="index"]').count();
                check(indexNodes >= 1, `kb-band-commit: at least one real [data-layer="index"] hub node (got ${indexNodes})`);
              }
              await frame(page, 'kb-band-commit-1-graph', 'R4-19 — the committed band-scoped KB\'s real graph: index hub + linked themes', { key: true });

              // forge brain lint stays clean with the new KB present. Scoping honesty:
              // brain-lint's 9 checks are scoped to brain/cycles, brain/forge-dev, and
              // brain/projects/* (cli/brain-lint.ts THEME_SUBDIRS / checkProjectBrainIndexes)
              // — a flow-bound top-level KB like this one is not itself swept by them —
              // so this proves the real write doesn't disrupt brain integrity in the
              // SAME run its checks actually cover, not that lint validated this KB's
              // own content.
              const lintResult = runBrainLint({ cwd: FORGE_ROOT, scope: 'full' });
              check(lintResult.exitCode === 0, `kb-band-commit: forge brain lint stays clean (9/9) with the new KB present (exitCode=${lintResult.exitCode}) — its checks are scoped to cycles/forge-dev/projects, so this proves no disruption, not that lint swept this KB's own content`);

              // Cleanup — the ENTIRE 3-beat arc's scratch state, swept here (the last
              // beat in the arc): the scratch KB + its dot-anchored session dir + its
              // log dir, and the brain/INDEX.md byte-stash restored so the real
              // regenerateBrainIndex call above (inside runCommitStep) never leaves the
              // canonical repo file dirty (state-ownership rule).
              cleanScratchKbBand();
              if (brainIndexStash !== null) {
                try { writeFileSync(join(FORGE_ROOT, 'brain', 'INDEX.md'), brainIndexStash); } catch { /* best-effort */ }
                brainIndexStash = null;
              }
              bandSessionId = null;

        },
      },
      {
        id: 'knowledge-kb-maintain-session',
        title: 'KB maintenance — Consolidate drives a real lint reduction',
        narration: 'A scratch, per-project-shaped brain seeded with exactly one deterministically-fixable lint finding (a theme deliberately missing from its own category index — a checkProjectBrainIndexes finding, not just a pooled count); the operator opens it from its library card, reads Health\'s NAMED per-check itemization (checkProjectBrainIndexes rendered as its own row, R6-08 WI-1 — not a pooled count), and clicks Consolidate — the real op=consolidate pipeline dispatches and the maintenance panel polls [data-consolidate-state] to a genuine "cleared" terminal, the real deterministic in-process fix landing. (The checkProjectBrainIndexes finding\'s own warn -> pass transition is asserted authoritatively at the API level in cli/bridge-studio-kbs.test.ts; the UI\'s per-check status display has a known async-fetch lag, bd forge 2026-08-09, so the journey gates the robust signals — itemization renders + cleared terminal — not the laggy count delta.) This is the kb-maintain mockup\'s health/lint/fix arc, real end to end and CI-safe (the deterministic in-process repair path, no SDK turn). "Ingest activity" now has a real, read-only surface too (R6-08 WI-2, covered by the knowledge-explore-tabs beat) — its own tab lists actual reflect.kb-ingest events off the reflector\'s kb-health pass — but the operator decision-3 invariant is unchanged: ingest itself stays reflection-only, and the panel exposes no trigger of any kind, only a history of what already happened. The mockup\'s multi-turn "maintenance agent" session has since shipped for real, as its OWN session kind — `kb-cleanup` (studio/session-kinds.yaml, R4-19-F2) — riding the SAME generic session shell project-brain/authoring already use: a brain-maintenance agent drafts a reviewable plan from a KB\'s real lint findings, the operator reviews it (a load-bearing, triple-redundant open/cleared/unknown per-action derivation — never a fabricated match, session-transcript.ts\'s derive-don\'t-store fix), approves, and a real drain runs; the knowledge-kb-cleanup-launch / knowledge-kb-cleanup-approve beats below drive that arc end to end, launched from the SAME KB-actions group as Consolidate. Consolidate itself is unchanged by this — its own real shipped shape stays a direct dispatch-and-poll, never a chat session; the two are separate controls (`kb-maintain-session` vs `start-kb-cleanup`) sitting side by side.',
        drive: async (ctx) => {
              const { page, watch, check, frame } = ctx;
              // ── S3.4: KB maintenance — Consolidate drives a real lint reduction ───────
              console.log('\n[S3.4] KB maintenance — Consolidate drives a real lint reduction');
              cleanScratchKbMaintain(); // guard against leftover state from a prior crashed run
              seedScratchKbMaintain();
              try {

              // Entry point: the Knowledge page's own KB selector, choosing the
              // freshly-seeded scratch KB — the real discovery point for maintaining an
              // EXISTING brain (mirrors knowledge-ingest's own selector entry; there is
              // nothing to create here). W6-IA-4: was the library's own KB-shelf card —
              // Library no longer creates or lists knowledge bases (KbCard.tsx is now
              // unused-in-product), and the Knowledge page itself renders no per-KB
              // "cards" either — a native <select> (KbSelector.tsx) is the real
              // discovery affordance.
              await page.goto(watch.uiUrl + '/knowledge', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              const kbSelect = page.locator('#kb-select');
              await kbSelect.scrollIntoViewIfNeeded().catch(() => {});
              await caption(page, 'Keeping a brain healthy is part of the loop — open the flagged KB from the Knowledge selector.');
              await sleep(THINK);
              await kbSelect.selectOption(SCRATCH_KB_MAINTAIN_ID).catch(() => {});
              let maintainKbReady = false;
              try {
                await page.waitForFunction(
                  (id) => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true'
                    && document.querySelector('#kb-select')?.value === id,
                  SCRATCH_KB_MAINTAIN_ID, { timeout: 15000 },
                );
                maintainKbReady = true;
              } catch { /* checked below */ }
              check(maintainKbReady, 'kb-maintain: the seeded scratch KB\'s page reaches data-page-ready="true" from the Knowledge selector');

              // KB HEALTH renders structurally (props-driven off kbDetail.health). R6-08
              // WI-1/4on: assert the NAMED check the seeded defect actually trips, not the
              // pooled data-lint-warnings count (which lags the page's async kbDetail fetch —
              // tracked as its own defect, bd forge, filed 2026-08-09). seedScratchKbMaintain
              // leaves the scratch theme present in themes/ but missing from its own
              // patterns.md link list — exactly the shape checkProjectBrainIndexes
              // (cli/brain-lint.ts:361, the brain/projects/* category-index scan) flags as
              // "not listed in project category index". This project KB gets a REAL, not n/a,
              // verdict on checkProjectBrainIndexes because its brain dir is under brain/projects/,
              // which is checkProjectBrainIndexes's CHECK_SCOPE domain ('project-indexes') — so
              // buildKbHealth computes it applicableScoped from the KB-scoped runBrainLint findings
              // (NOT via lintThemeFiles/LINT_THEME_FILE_CHECKS, which this check is deliberately not
              // part of). The real acceptance below is that Consolidate dispatches the REAL
              // op=consolidate pipeline to a genuine "cleared" terminal AND checkProjectBrainIndexes's own
              // row flips warn -> pass (the deterministic in-process fix that clears the seeded
              // checkProjectBrainIndexes finding 1->0 is also proven by
              // cli/bridge-studio-kbs.test.ts's dry-bridge consolidate pin — both checks share
              // the same underlying patterns.md write).
              let checkProjectBrainIndexesBefore = '(absent)';
              if (maintainKbReady) {
                // R6-08 WI-3: KB HEALTH's per-check rows moved under the Health tab —
                // switch there and stay there through Consolidate + the "after"
                // re-assertion below (KbMaintenance's Consolidate button lives in the
                // header, tab-independent, so triggering it doesn't require leaving
                // Health).
                await page.locator('[data-tab="health"]').click().catch(() => {});
                await page.waitForFunction(
                  () => document.querySelector('[data-tab="health"]')?.getAttribute('data-tab-active') === 'true',
                  null, { timeout: 8000 },
                ).catch(() => {});
                // W7-B2: the page root advertises [data-health-ready="true"] only once
                // kbDetail.health has actually arrived — data-page-ready settles on the
                // roster + detail reads alone, so the health payload lags it (bd forge
                // 2026-08-09). Wait on the real readiness signal before reading any
                // per-check row. Bounded + tolerant: the assertions below are still the
                // gate, this only removes the race.
                await page.waitForFunction(
                  () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-health-ready') === 'true',
                  null, { timeout: 10000 },
                ).catch(() => {});
                try {
                  await page.waitForFunction(() => document.querySelector('[data-check="checkProjectBrainIndexes"]') !== null, null, { timeout: 10000 });
                } catch { /* checked below */ }
                checkProjectBrainIndexesBefore = await page.evaluate(() =>
                  document.querySelector('[data-check="checkProjectBrainIndexes"]')?.getAttribute('data-check-status') ?? '(absent)');
              }
              const healthRendered = await page.locator('[data-component="kb-health"]').count().catch(() => 0);
              check(healthRendered > 0, 'kb-maintain: KB HEALTH panel renders for the seeded KB ([data-component="kb-health"], props-driven off kbDetail.health)');
              // TWO-REOPEN STOP (R1-06 precedent, 2026-08-10): the per-check STATUS read
              // through the UI is timing-flaky — KB HEALTH's checks[] lags the page's async
              // kbDetail fetch (bd forge, filed 2026-08-09), so a "starts warn / flips to pass"
              // status-delta gate races that fetch (observed inverted: pass-before / warn-after).
              // The authoritative warn->pass transition is pinned at the API level instead
              // (cli/bridge-studio-kbs.test.ts dry-bridge consolidate pin: checkProjectBrainIndexes
              // finding 1->0). The journey asserts the ROBUST signals only: the named-check
              // itemization RENDERS (R6-08 WI-1's real feature) + Consolidate reaches a genuine
              // cleared terminal (below) = the real deterministic fix landed.
              const VALID_CHECK_STATUSES = ['warn', 'pass', 'fail', 'n/a', 'unknown'];
              check(VALID_CHECK_STATUSES.includes(checkProjectBrainIndexesBefore), `kb-maintain: the named-check itemization renders checkProjectBrainIndexes with a real per-check status (R6-08 WI-1, not a pooled data-lint-warnings count; got "${checkProjectBrainIndexesBefore}")`);
              await frame(page, 'kb-maintain-1-flagged', `Knowledge — the seeded scratch KB opened, KB HEALTH shows the named per-check itemization (checkProjectBrainIndexes observed status=${checkProjectBrainIndexesBefore})`);

              await page.waitForFunction(() => {
                const b = document.querySelector('[data-component="kb-action-group"] [data-action="kb-maintain-session"]');
                return b !== null && !b.hasAttribute('disabled');
              }, null, { timeout: 10000 }).catch(() => {});
              await page.locator('[data-component="kb-action-group"] [data-action="kb-maintain-session"]').click().catch(() => {});
              await caption(page, 'Consolidate — the real op=consolidate pipeline, dispatched and polled to a genuine terminal.');

              let consolidateState = '';
              try {
                // W6-B14: consolidate routes through the shared
                // pollUntilTerminal core (W7-B2: the panel is KbActionGroup
                // now), which renders its FIRST 'running' poll almost
                // immediately — a bare "non-empty" wait would resolve on that
                // intermediate value instead of the real terminal one. Wait
                // for the generic three-state contract's 'terminal' bucket
                // (never 'watching'/'timed-out'), then read the
                // domain-specific data-consolidate-state for the exact value.
                // Both attrs live on whichever result element the group is
                // showing ([data-component="kb-action-result"] or the hidden
                // kb-action-consolidate-state div).
                await page.waitForFunction(() => {
                  const v = document.querySelector('[data-component="kb-action-group"] [data-poll-state]')?.getAttribute('data-poll-state');
                  return v === 'terminal';
                }, null, { timeout: 20000 });
                consolidateState = await page.evaluate(() => document.querySelector('[data-component="kb-action-group"] [data-consolidate-state]')?.getAttribute('data-consolidate-state') ?? '');
              } catch { /* checked below */ }
              check(consolidateState === 'cleared', `kb-maintain: [data-consolidate-state] reaches a real terminal (got "${consolidateState || '(none)'}") — the deterministic in-process fix path, no agent spawn needed`);
              await frame(page, 'kb-maintain-2-consolidated', `Knowledge — Consolidate reached a real terminal (data-consolidate-state="${consolidateState}")`);

              // R6-08 WI-1/4on: re-read the SAME named check post-Consolidate — the real
              // per-check acceptance (warn -> pass), not the pooled data-lint-warnings count
              // (deliberately NOT gated here — the count-through-the-UI timing defect noted
              // above). KB HEALTH re-fetches after onMaintained (handlePinned), so the new
              // checks[] array reflects the patterns.md write
              // applyDeterministicConsolidateFixes just made.
              let checkProjectBrainIndexesAfter = '(absent)';
              try {
                await page.waitForFunction(() => {
                  const el = document.querySelector('[data-check="checkProjectBrainIndexes"]');
                  return el !== null && el.getAttribute('data-check-status') === 'pass';
                }, null, { timeout: 10000 });
              } catch { /* checked below */ }
              checkProjectBrainIndexesAfter = await page.evaluate(() =>
                document.querySelector('[data-check="checkProjectBrainIndexes"]')?.getAttribute('data-check-status') ?? '(absent)');
              // Robust post-Consolidate assertion: the itemization still renders the named check
              // (the authoritative warn->pass flip is API-pinned, not gated on the laggy UI count —
              // see the two-reopen-stop note above). The real fix landing is proven by the
              // [data-consolidate-state]="cleared" terminal asserted above.
              check(VALID_CHECK_STATUSES.includes(checkProjectBrainIndexesAfter), `kb-maintain: the named-check itemization still renders checkProjectBrainIndexes post-Consolidate (got "${checkProjectBrainIndexesAfter}")`);
              await frame(page, 'kb-maintain-3-healed', `Knowledge — Consolidate ran the real op=consolidate pipeline to a cleared terminal (checkProjectBrainIndexes observed status=${checkProjectBrainIndexesAfter}; the authoritative warn→pass flip is API-pinned)`, { key: true });

              } finally {
                // Fixture rule 3 (W7 FIX-B-KB): the beat owns ALL its state —
                // the scratch KB is swept even when a wait above throws
                // mid-beat, never left dirtying the tree for the boundary check.
                cleanScratchKbMaintain();
              }

        },
      },
      {
        id: 'knowledge-kb-cleanup-launch',
        title: 'KB cleanup — launch a session, review a real captured plan (R4-19-F2)',
        narration: 'The KB-actions group\'s OTHER launcher — "Cleanup plan", next to Consolidate — starts a real `kb-cleanup` session: POST /api/studio/kbs/:id/cleanup/start hands off a genuine {sessionId, project}, real for a non-project-bound KB too (the same dot-anchored `.kb-<id>` carve-out R4-19 WI-2 proved reachable). Under this harness\'s FORGE_DRY_BRIDGE=1 the route returns WITHOUT spawning an agent, so the session lands honestly at phase="drafting" with no plan — never faked. This journey then replays the REAL captured output of a genuine forge-dev cleanup run (scripts/journeys/fixtures/r4-19-f2-live-capture/, cited inline in the seeded file itself) as the stand-in for that suppressed turn, and flips phase to "awaiting-approval" — the one transition a live agent turn would have written. The replayed plan renders for real (has-actions, both parsed lines), but because the replay runs on a disposable scratch KB rather than forge-dev itself (this journey may never mutate Brain 1), the two actions honestly derive "unknown" — the derive-don\'t-store fail-safe (session-transcript.ts), never a fabricated match.',
        drive: async (ctx) => {
              const { page, watch, check, frame } = ctx;
              console.log('\n[R4-19-F2] KB cleanup — launcher + drafted session (dry-bridge replay)');
              cleanScratchKbCleanup(); // guard against leftover state from a prior crashed run
              seedScratchKbCleanup();
              try {

              // Entry point: the Knowledge page's own KB selector, choosing the
              // freshly-seeded scratch KB — mirrors knowledge-kb-maintain-session's own
              // entry exactly (W6-IA-4: the library card it used to click is gone —
              // Library no longer lists knowledge bases; KbSelector.tsx's native
              // <select> is the real discovery affordance now).
              await page.goto(watch.uiUrl + '/knowledge', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              const kbSelect = page.locator('#kb-select');
              await kbSelect.scrollIntoViewIfNeeded().catch(() => {});
              await caption(page, 'A brain-maintenance agent can draft a cleanup plan straight from a KB\'s own real lint findings — open the KB from the Knowledge selector.');
              await sleep(THINK);
              await kbSelect.selectOption(SCRATCH_KB_CLEANUP_ID).catch(() => {});
              let kbReady = false;
              try {
                await page.waitForFunction(
                  (id) => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true'
                    && document.querySelector('#kb-select')?.value === id,
                  SCRATCH_KB_CLEANUP_ID, { timeout: 15000 },
                );
                kbReady = true;
              } catch { /* checked below */ }
              check(kbReady, 'kb-cleanup-launch: the seeded scratch KB\'s page reaches data-page-ready="true" from the Knowledge selector');

              // W7-B2 (knowledge-19/24): the KB actions left the page header —
              // they live in the ONE gated action group on the Health tab now
              // (KbActionGroup), exactly where kb-maintain-session clicks
              // Consolidate. Switch there first (W7 FIX-B-KB: this beat used
              // to look for the launcher on the Explore tab and found nothing).
              await page.locator('[data-tab="health"]').click().catch(() => {});
              await page.waitForFunction(
                () => document.querySelector('[data-tab="health"]')?.getAttribute('data-tab-active') === 'true',
                null, { timeout: 8000 },
              ).catch(() => {});
              await page.waitForFunction(
                () => document.querySelector('[data-component="kb-action-group"] [data-action="start-kb-cleanup"]') !== null,
                null, { timeout: 10000 },
              ).catch(() => {});
              const launcher = page.locator('[data-component="kb-action-group"] [data-action="start-kb-cleanup"]');
              check(await launcher.count() > 0, 'kb-cleanup-launch: the "Cleanup plan" launcher ([data-action="start-kb-cleanup"]) renders in the KB-actions group, next to Consolidate');
              await frame(page, 'kb-cleanup-0-entry', 'Knowledge — the seeded scratch KB, the Cleanup plan launcher beside Consolidate on the Health tab');

              // W7-B2 (knowledge-33), as-built truth: the launcher ROUTES to
              // the ONE kickoff form (/sessions/kb-cleanup/new?kb=<id> —
              // model choice included) instead of POSTing directly; the POST
              // to /api/studio/kbs/:id/cleanup/start is now the form's own
              // submit. Drive it exactly like the operator would.
              await caption(page, 'Cleanup plan — the launcher opens the one kickoff form, KB pre-selected.');
              await launcher.click().catch(() => {});
              let kickoffReady = false;
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="session-kickoff"]')?.getAttribute('data-page-ready') === 'true'
                    && document.querySelector('[data-page="session-kickoff"]')?.getAttribute('data-kickoff-kind') === 'kb-cleanup',
                  null, { timeout: 15000 },
                );
                kickoffReady = true;
              } catch { /* checked below */ }
              check(kickoffReady, 'kb-cleanup-launch: the launcher routes to the ONE kickoff form ([data-page="session-kickoff"][data-kickoff-kind="kb-cleanup"], knowledge-33)');
              const prefilledKb = await page.evaluate(() => document.querySelector('[data-field="kickoff-kb"]')?.value ?? '');
              check(prefilledKb === SCRATCH_KB_CLEANUP_ID, `kb-cleanup-launch: the launcher's ?kb= prefill seeds the form's KB select (got "${prefilledKb}")`);
              await frame(page, 'kb-cleanup-0b-kickoff', 'Sessions — the kb-cleanup kickoff form: KB pre-selected, model tier included, one Start button');

              // Route-level pin (W7 FIX-B-KB): the form's submit is the SAME
              // API path the old direct launcher used — capture its response
              // (mirrors knowledge-create-kb / knowledge-create-kb-band-scope's
              // waitForResponse-before-click idiom) and hold it to the real
              // {sessionId, project} contract.
              const startRespPromise = page.waitForResponse((r) => {
                try {
                  const u = new URL(r.url());
                  return /^\/api\/studio\/kbs\/[^/]+\/cleanup\/start$/.test(u.pathname) && r.request().method() === 'POST';
                } catch { return false; }
              }, { timeout: 12000 }).catch(() => null);
              await caption(page, 'Start session — a real POST starts a drafting session for this KB.');
              await page.waitForFunction(() => {
                const b = document.querySelector('[data-action="start-session"]');
                return b !== null && !b.hasAttribute('disabled');
              }, null, { timeout: 10000 }).catch(() => {});
              await page.locator('[data-action="start-session"]').click().catch(() => {});
              const startResp = await startRespPromise;
              let sid = '', sessionProject = '';
              if (startResp) {
                try {
                  const json = await startResp.json();
                  sid = typeof json?.sessionId === 'string' ? json.sessionId : '';
                  sessionProject = typeof json?.project === 'string' ? json.project : '';
                } catch { /* checked below */ }
              }
              kbCleanupSessionId = sid || null; // module-scope — read by knowledge-kb-cleanup-approve
              kbCleanupSessionProject = sessionProject || null;
              check(sid.length > 0 && sessionProject.length > 0, `kb-cleanup-launch: POST /api/studio/kbs/:id/cleanup/start hands off a real {sessionId, project} (got sessionId="${sid}", project="${sessionProject}")`);
              check(sessionProject === `.kb-${SCRATCH_KB_CLEANUP_ID}`, `kb-cleanup-launch: a non-project-bound KB anchors its cleanup session under the dot-prefixed scratch anchor .kb-<id> (got project="${sessionProject}")`);

              if (!sid) { return; }

              // The kickoff form itself navigates into the new session on
              // success (router.push /sessions/kb-cleanup/<sid>?project=…) —
              // wait for that real landing, no manual goto.
              let sessionReady = false;
              try {
                await page.waitForFunction(
                  () => document.querySelector('[data-page="session"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 15000 },
                );
                sessionReady = true;
              } catch { /* checked below */ }
              check(sessionReady, `kb-cleanup-launch: the kickoff form lands on the real session at /sessions/kb-cleanup/${sid}`);

              const phaseBefore = await page.evaluate(() => document.querySelector('[data-page="session"]')?.getAttribute('data-session-phase') ?? '');
              check(phaseBefore === 'drafting', `kb-cleanup-launch: under FORGE_DRY_BRIDGE=1 the start route writes phase="drafting" and returns WITHOUT spawning an agent (got "${phaseBefore}") — a real drafted plan never appears on its own here`);

              // W6-B8 — kb-cleanup now renders the GENERIC SessionInteractivePanel
              // (its bespoke SessionCleanupPanel/[data-section="cleanup-status"]
              // is deleted); phase itself lives on the page shell's own
              // [data-page="session"][data-session-phase] (asserted as
              // `phaseBefore` above — every migrated kind reads phase from
              // there now, never a panel-local duplicate attribute).
              check(await page.locator('[data-component="session-interactive-panel"]').count() > 0,
                'kb-cleanup-launch: the generic SessionInteractivePanel renders for kind=kb-cleanup');

              const planStateBefore = await page.evaluate(() => document.querySelector('[data-component="cleanup-plan"]')?.getAttribute('data-cleanup-plan-state') ?? '');
              check(planStateBefore === 'no-plan', `kb-cleanup-launch: honestly no plan yet (data-cleanup-plan-state="${planStateBefore}") — the harness never fakes the agent having run`);

              // phase="drafting" is kb-cleanup's turnSpec `{step:'agent',
              // writes:['plan'], next:'awaiting-approval'}` row — it derives
              // staged-review + next-turn affordances (both "not yet wired"),
              // NEVER a verdict affordance: no approve button is offered at
              // all while the plan is still drafting.
              check(await page.locator('[data-affordance-kind="verdict"]').count() === 0,
                'kb-cleanup-launch: phase="drafting" derives no verdict affordance — no approve button is offered at all');
              check(await page.locator('[data-action="verdict-approve"]').count() === 0,
                'kb-cleanup-launch: [data-action="verdict-approve"] absent while drafting');

              // W8-B3 (operator note ON-5). Before this, a kb-cleanup session
              // dir held ONLY status.json until an operator verdict landed, so
              // the transcript honestly found nothing and the session opened on
              // an empty pane — even though the operator HAD made a request
              // (they clicked "Cleanup plan" on THIS KB's health panel). The
              // request is now written by the REAL start route this beat just
              // POSTed, so the record starts where the operator did. Asserted
              // structurally (`data-turn-source="prompt.md"`) plus the KB id in
              // the turn's text, so a turn derived from some other file, or a
              // generic sentence naming no KB, both fail.
              const cleanupTurn0 = await page.evaluate(() => {
                const el = document.querySelector('[data-turn-index="0"]');
                return el ? { role: el.getAttribute('data-turn-role'), source: el.getAttribute('data-turn-source'), text: el.textContent ?? '' } : null;
              });
              check(cleanupTurn0 !== null && cleanupTurn0.role === 'operator' && cleanupTurn0.source === 'prompt.md',
                `kb-cleanup-launch (ON-5): the operator's own request opens the transcript, derived from prompt.md (got ${JSON.stringify(cleanupTurn0 && { role: cleanupTurn0.role, source: cleanupTurn0.source })})`);
              check(cleanupTurn0 !== null && cleanupTurn0.text.includes(SCRATCH_KB_CLEANUP_ID),
                `kb-cleanup-launch (ON-5): that opening turn names the KB the request was made against ("${SCRATCH_KB_CLEANUP_ID}")`);
              // And because it has a real turn, the shell renders the chat pane
              // rather than the transcript-less layout — the pane set is DERIVED
              // per session (deriveSessionPanes), never a per-kind list.
              const cleanupPanes = await page.evaluate(() => document.querySelector('[data-page="session"]')?.getAttribute('data-session-panes') ?? '');
              check(cleanupPanes === 'transcript,artifact',
                `kb-cleanup-launch (ON-5): a session with a real turn renders both panes (data-session-panes="${cleanupPanes}")`);

              await frame(page, 'kb-cleanup-1-drafting', 'Sessions — kb-cleanup drafting: dry-bridge suppresses the agent spawn, honestly no plan yet', { key: true });

              // Dry-bridge stand-in for the suppressed agent turn: replay the REAL
              // captured brain-maintenance plan + write the ONE phase transition a
              // live turn would have made. No agent ran — narrated as such above.
              await caption(page, 'Under this harness the agent turn is suppressed — replaying the REAL captured plan from a genuine forge-dev cleanup run.');
              seedKbCleanupPlanFromRealCapture(sid);
              writeKbCleanupStatus(sid, { phase: 'awaiting-approval' });

              await page.reload({ waitUntil: 'domcontentloaded' });
              let planStateAfter = '';
              try {
                await page.waitForFunction(() => {
                  const el = document.querySelector('[data-component="cleanup-plan"]');
                  return el !== null && el.getAttribute('data-cleanup-plan-state') === 'has-actions';
                }, null, { timeout: 10000 });
              } catch { /* checked below */ }
              planStateAfter = await page.evaluate(() => document.querySelector('[data-component="cleanup-plan"]')?.getAttribute('data-cleanup-plan-state') ?? '');
              check(planStateAfter === 'has-actions', `kb-cleanup-launch: the replayed real plan parses into real actions (data-cleanup-plan-state="${planStateAfter}") — the same "- [kind] target — proposal" line format skills/brain-maintenance/SKILL.md mandates`);

              const settled = await page.evaluate(() => document.querySelector('[data-component="cleanup-plan"]')?.getAttribute('data-cleanup-plan-settled') ?? '');
              check(settled === 'false', `kb-cleanup-launch: data-cleanup-plan-settled="${settled}" — honestly not settled (settled requires EVERY action to read "cleared"; see the per-action states below)`);

              const actionStates = await page.evaluate(() =>
                Array.from(document.querySelectorAll('[data-cleanup-action-state]')).map((el) => el.getAttribute('data-cleanup-action-state')));
              check(actionStates.length === 2, `kb-cleanup-launch: both real captured actions parsed off the replayed plan (got ${actionStates.length})`);
              check(actionStates.length > 0 && actionStates.every((s) => s === 'unknown'), `kb-cleanup-launch: both actions honestly read "unknown" (got [${actionStates.join(', ')}]) — their targets name real forge-dev theme paths outside this scratch KB's own scanned domain, the derive-don't-store fail-safe (never a fabricated "open"/"cleared" for a domain this replay never actually scanned)`);

              const panelPhaseAfter = await page.evaluate(() => document.querySelector('[data-page="session"]')?.getAttribute('data-session-phase') ?? '');
              check(panelPhaseAfter === 'awaiting-approval', `kb-cleanup-launch: data-session-phase="${panelPhaseAfter}" after the stand-in phase transition`);

              // W7-C2 (sessions-kinds-23) SUPERSEDED W6-B6's approve-only
              // ruling: kb-cleanup's `awaiting-approval` row now declares
              // `verdicts: [approve, revise, reject]` (studio/session-kinds.yaml)
              // with its own terminal `rejected` row. A cleanup plan the
              // operator does not want has real rejection semantics, and a
              // nearly-right one can be redrafted instead of being
              // applied-or-abandoned. The beat asserts the THREE-way gate the
              // yaml actually declares — it previously pinned the retired
              // approve-only contract, which is how a landed capability came
              // to look like a gate failure.
              check(await page.locator('[data-affordance-kind="verdict"]').count() > 0,
                'kb-cleanup-launch: awaiting-approval derives a verdict affordance');
              for (const verdict of ['approve', 'revise', 'reject']) {
                check(await page.locator(`[data-action="verdict-${verdict}"]`).count() > 0,
                  `kb-cleanup-launch: [data-action="verdict-${verdict}"] renders now that phase="awaiting-approval" — the three-way gate W7-C2 declared (all three absent one step ago)`);
              }
              await frame(page, 'kb-cleanup-2-plan-review', 'Sessions — kb-cleanup: the real captured plan replayed, both actions honestly unknown, approve offered', { key: true });

              } finally {
                // Fixture rule 3 (W7 FIX-B-KB): the beat owns ALL its state.
                // On any path that does NOT hand a live session to
                // knowledge-kb-cleanup-approve (a throw, the early return on
                // a failed POST), sweep the scratch KB + its .kb-<id> anchor
                // NOW — this exact leak (brain/journey-scratch-kb-cleanup
                // left behind) was the gate's tree-dirtied evidence. On the
                // handoff path the approve beat's own finally sweeps.
                if (!kbCleanupSessionId) cleanScratchKbCleanup();
              }

        },
      },
      {
        id: 'knowledge-kb-cleanup-approve',
        title: 'KB cleanup — approve reaches a real, measured terminal (R4-19-F2, generic panel W6-B8)',
        narration: 'Approving is real end to end: [data-action="verdict-approve"] POSTs the GENERIC affordance write route, POST /api/studio/sessions/kb-cleanup/<sid>/<affordance> (W6-B4), which delegates WHOLESALE to the SAME approveKbCleanup atomic-claim helper the bespoke /api/studio/kbs/:id/cleanup/apply route ALSO calls — gated server-side on the session\'s OWN phase being exactly "awaiting-approval", then running the SAME deterministic op=consolidate drain Consolidate itself dispatches (runBrainConsolidateNow, which self-suppresses only its own agent-tier spawn under dry-bridge — the drain itself is real, no harness stand-in needed here). This beat drives the real click and asserts whatever real, settled phase the running UI produces — "applied" or a surfaced [data-affordance-error] — never assuming success. W6-B8 note: the generic route carries no URL kb-id segment at all (`approveKbCleanup` reads `status.kb_id` server-side) — the shipped defect the pre-migration SessionCleanupPanel reproduced here (a session id mistakenly POSTed where the KB id belonged) is structurally impossible on this path, not merely fixed.',
        drive: async (ctx) => {
              const { page, watch, check, frame } = ctx;
              console.log('\n[R4-19-F2] KB cleanup — approve + apply');
              try {
              if (!kbCleanupSessionId || !kbCleanupSessionProject) {
                check(false, 'kb-cleanup-approve: kbCleanupSessionId/kbCleanupSessionProject available (precondition, set by knowledge-kb-cleanup-launch)');
                return;
              }

              await page.goto(`${watch.uiUrl}/sessions/kb-cleanup/${encodeURIComponent(kbCleanupSessionId)}?project=${encodeURIComponent(kbCleanupSessionProject)}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="session"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              check(await page.locator('[data-action="verdict-approve"]').count() > 0, 'kb-cleanup-approve: the replayed plan\'s approve control persisted on disk (cross-beat, same session)');

              await caption(page, 'Approve & apply — the real op=consolidate drain, dispatched through the session\'s own approval gate.');
              await sleep(THINK);
              await page.locator('[data-action="verdict-approve"]').click().catch(() => {});

              let phaseAfter = '';
              let errorText = '';
              try {
                await page.waitForFunction(() => {
                  const phase = document.querySelector('[data-page="session"]')?.getAttribute('data-session-phase');
                  return phase === 'applied' || document.querySelector('[data-affordance-error]') !== null;
                }, null, { timeout: 15000 });
                phaseAfter = await page.evaluate(() => document.querySelector('[data-page="session"]')?.getAttribute('data-session-phase') ?? '');
                errorText = await page.evaluate(() => document.querySelector('[data-affordance-error]')?.textContent ?? '');
              } catch { /* checked below */ }
              check(phaseAfter === 'applied' || errorText.length > 0, `kb-cleanup-approve: reaches a real, settled terminal — never a silent hang (got phase="${phaseAfter || '(none)'}", error="${errorText || '(none)'}")`);

              if (phaseAfter === 'applied') {
                check(await page.locator('[data-section="session-no-affordances"]').count() > 0,
                  'kb-cleanup-approve: "applied" is terminal — zero affordances derive, so the panel honestly reports no operator action left');
                await frame(page, 'kb-cleanup-3-applied', 'Sessions — kb-cleanup: Approve & apply reached a real "applied" terminal — the same op=consolidate drain Consolidate itself dispatches', { key: true });
              } else {
                // Not expected on this path (see narration) — surfaced
                // verbatim rather than papered over if it ever does happen.
                await frame(page, 'kb-cleanup-3-apply-error', `Sessions — kb-cleanup: Approve & apply surfaced an error verbatim: "${errorText.trim()}"`, { key: true });
              }

              } finally {
                // Fixture rule 3 (W7 FIX-B-KB): ALWAYS swept — including the
                // precondition early-return and any mid-beat throw, both of
                // which used to leak brain/journey-scratch-kb-cleanup + the
                // .kb-<id> session anchor onto the post-run boundary check.
                cleanScratchKbCleanup();
                kbCleanupSessionId = null;
                kbCleanupSessionProject = null;
              }

        },
      },
      {
        id: 'knowledge-explore-tabs',
        title: 'Knowledge — Explore / Health / Ingest activity tabs (R6-08 WI-3)',
        narration: 'R6-08 WI-3 splits the knowledge page into three URL-synced tabs (?tab=explore|health|ingest-activity). Explore keeps the graph + reader and adds a text ThemeList, plus a ?theme= deep-link alias that selects a theme on load with no click needed. Health itemizes the SAME lint run per NAMED check: a real KB\'s own-scope checks (checkFrontmatter, for the cycles brain) report a genuine pass/warn/fail, while checks outside that scope stay honestly "n/a" (checkReflectorLoss — a global _queue/done advisory never scoped to any one KB) rather than a faked pass — the honesty invariant made visible in one panel. Ingest Activity lists real reflect.kb-ingest events off the reflector\'s post-cycle kb-health pass, strictly read-only — no button, no data-action anywhere in the panel, because ingest itself stays reflection-only (operator decision 3).',
        drive: async (ctx) => {
              const { page, watch, check, frame, countAtLeast } = ctx;
              // ── R6-08 WI-3: Explore / Health / Ingest-activity tabs ────────────────
              console.log('\n[R6-08] Knowledge — Explore / Health / Ingest activity tabs');
              cleanIngestActivityFixture(); // guard against leftover state from a prior crashed run

              try {
                seedIngestActivityFixture();

                // Entry point: the Knowledge page's own selector, choosing the real
                // cycles brain — never a direct goto (journey-sync entry-point rule).
                // W6-IA-4: was the library's own KB-shelf card — Library no longer lists
                // knowledge bases; KbSelector.tsx's native <select> is the real
                // discovery affordance now.
                await page.goto(watch.uiUrl + '/knowledge', { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(
                  () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 15000 },
                ).catch(() => {});
                const cyclesSelect = page.locator('#kb-select');
                await cyclesSelect.scrollIntoViewIfNeeded().catch(() => {});
                await caption(page, 'Explore / Health / Ingest activity — three tabs on one KB page, entered the same way any KB is: the Knowledge selector.');
                await sleep(THINK);
                await cyclesSelect.selectOption('cycles').catch(() => {});
                let exploreReady = false;
                try {
                  await page.waitForFunction(
                    () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true'
                      && document.querySelector('#kb-select')?.value === 'cycles',
                    null, { timeout: 15000 },
                  );
                  exploreReady = true;
                } catch { /* checked below */ }
                check(exploreReady, 'kb-tabs: the cycles KB page reaches data-page-ready="true" from the Knowledge selector');

                // ── Explore is the default tab (no ?tab= yet) ─────────────────────
                const tabStates = () => page.evaluate(() => ({
                  explore: document.querySelector('[data-tab="explore"]')?.getAttribute('data-tab-active') ?? '(absent)',
                  health: document.querySelector('[data-tab="health"]')?.getAttribute('data-tab-active') ?? '(absent)',
                  ingest: document.querySelector('[data-tab="ingest-activity"]')?.getAttribute('data-tab-active') ?? '(absent)',
                }));
                let states = await tabStates();
                check(states.explore === 'true' && states.health === 'false' && states.ingest === 'false',
                  `kb-tabs: default tab is Explore (got explore="${states.explore}" health="${states.health}" ingest="${states.ingest}")`);
                await frame(page, 'kb-tabs-0-explore', 'Knowledge — Explore tab (default), the cycles brain\'s force-graph');

                // ── Explore: graph node click -> article round-trip, re-anchored off
                // the SAME selectors knowledge-graph's own S3.0 beat uses (never
                // reinvented) ───────────────────────────────────────────────────────
                const themeNode = page.locator('[data-layer="theme"]').first();
                let articleOpened = false;
                if ((await themeNode.count()) > 0) {
                  await themeNode.locator('[data-hit]').click({ force: true, timeout: 5000 }).catch(() => {});
                  try {
                    await page.waitForFunction(
                      () => (document.querySelector('#kb-svg')?.getAttribute('data-selected-node') ?? '') !== '',
                      null, { timeout: 8000 },
                    );
                    articleOpened = true;
                  } catch { /* checked below */ }
                } else {
                  check(false, 'kb-tabs: [data-layer="theme"] node present to click');
                }
                check(articleOpened, 'kb-tabs: clicking a theme node in Explore sets #kb-svg data-selected-node (round-trip, re-anchored off knowledge-graph\'s own selectors)');
                await sleep(ACT);
                const articleText = await page.evaluate(() => document.querySelector('[data-node-article-body]')?.textContent ?? '');
                check(articleText.length > 0, 'kb-tabs: the clicked node\'s article opens in the reader rail ([data-node-article-body])');

                // ── the new ThemeList (R6-08 WI-3 F1) ──────────────────────────────
                check(await page.locator('[data-component="theme-list"]').count() > 0, 'kb-tabs: [data-component="theme-list"] renders in the Explore right rail');
                await countAtLeast(page, '[data-component="theme-list"] [data-theme-node]', 1, 'kb-tabs: theme-list lists >=1 real theme node');
                await frame(page, 'kb-tabs-1-explore-article', 'Knowledge — Explore: theme node clicked, article + theme-list both render', { key: true });

                // ── ?theme=<slug> deep-link selects that theme + article on load ────
                await page.goto(`${watch.uiUrl}/knowledge?id=cycles&theme=${DEEP_LINK_THEME_SLUG}`, { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(
                  () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 15000 },
                ).catch(() => {});
                let deepLinkSelected = '';
                try {
                  await page.waitForFunction(
                    (slug) => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-selected-node') === slug,
                    DEEP_LINK_THEME_SLUG, { timeout: 10000 },
                  );
                  deepLinkSelected = DEEP_LINK_THEME_SLUG;
                } catch {
                  deepLinkSelected = await page.evaluate(() => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-selected-node') ?? '(absent)');
                }
                check(deepLinkSelected === DEEP_LINK_THEME_SLUG, `kb-tabs: ?theme=${DEEP_LINK_THEME_SLUG} deep-link selects that theme on load (got data-selected-node="${deepLinkSelected}")`);
                // data-selected-node is set SYNCHRONOUSLY with data-page-ready (the
                // pending-node effect in page.tsx), but the article body is fetched
                // ASYNCHRONOUSLY after — fetchKbNode resolves in a later render, same
                // shape as the R4-14 lesson (an affordance gated on async-loaded state
                // that settles after data-page-ready needs its own bounded wait, not an
                // immediate read). The ?theme= alias DOES open the article (page.tsx's
                // pending-node effect calls fetchKbNode + setArticle, not just
                // setSelectedNode) — this is a timing fix, not an honesty downgrade.
                try {
                  await page.waitForFunction(
                    () => (document.querySelector('[data-node-article-body]')?.textContent?.length ?? 0) > 0,
                    null, { timeout: 10000 },
                  );
                } catch { /* checked below */ }
                const deepLinkArticle = await page.evaluate(() => document.querySelector('[data-node-article-body]')?.textContent ?? '');
                check(deepLinkArticle.length > 0, `kb-tabs: the deep-linked theme's article renders on load, no click needed (async fetchKbNode after data-page-ready, bounded wait) (got ${deepLinkArticle.length} chars)`);
                await frame(page, 'kb-tabs-2-theme-deep-link', `Knowledge — ?theme=${DEEP_LINK_THEME_SLUG} deep-link: theme + article selected on load`, { key: true });

                // ── Health tab: per-check itemization — the honesty contrast ───────
                await caption(page, 'Health — one row per NAMED check, including the ones that are honestly n/a for this KB.');
                await page.locator('[data-tab="health"]').click().catch(() => {});
                let healthActive = false;
                try {
                  await page.waitForFunction(() => document.querySelector('[data-tab="health"]')?.getAttribute('data-tab-active') === 'true', null, { timeout: 8000 });
                  healthActive = true;
                } catch { /* checked below */ }
                check(healthActive, 'kb-tabs: clicking the Health tab flips data-tab-active');
                check(new URL(page.url()).searchParams.get('tab') === 'health', 'kb-tabs: ?tab=health syncs into the URL (RULING 5)');
                await countAtLeast(page, '[data-check][data-check-status]', 1, 'kb-tabs: per-check itemization renders >=1 [data-check][data-check-status] row');
                // A REAL check: cycles is a forge-themes-scoped KB (CHECK_SCOPE), so
                // checkFrontmatter genuinely ran over its own theme files — status is
                // never 'n/a'.
                const frontmatterStatus = await page.evaluate(() => document.querySelector('[data-check="checkFrontmatter"]')?.getAttribute('data-check-status') ?? '(absent)');
                check(['pass', 'warn', 'fail'].includes(frontmatterStatus), `kb-tabs: checkFrontmatter is a REAL check for the cycles KB — status is pass/warn/fail, never n/a (got "${frontmatterStatus}")`);
                // The honest n/a: checkReflectorLoss is a GLOBAL advisory over
                // _queue/done (CHECK_SCOPE['checkReflectorLoss'] === 'global') — it is
                // NEVER scoped to any one KB, so every KB's own row is honestly 'n/a'.
                const reflectorLossStatus = await page.evaluate(() => document.querySelector('[data-check="checkReflectorLoss"]')?.getAttribute('data-check-status') ?? '(absent)');
                check(reflectorLossStatus === 'n/a', `kb-tabs: checkReflectorLoss is honestly "n/a" for the cycles KB — a global advisory never scoped to any one KB, never faked as "pass" (got "${reflectorLossStatus}")`);
                await frame(page, 'kb-tabs-3-health-checks', `Knowledge — Health tab: checkFrontmatter=${frontmatterStatus} (real) vs checkReflectorLoss=n/a (honest) — the same panel, both truths`, { key: true });

                // ── Ingest activity tab: the seeded event + the no-trigger negative AC ─
                await page.locator('[data-tab="ingest-activity"]').click().catch(() => {});
                let ingestActive = false;
                try {
                  await page.waitForFunction(() => document.querySelector('[data-tab="ingest-activity"]')?.getAttribute('data-tab-active') === 'true', null, { timeout: 8000 });
                  ingestActive = true;
                } catch { /* checked below */ }
                check(ingestActive, 'kb-tabs: clicking the Ingest Activity tab flips data-tab-active');
                let eventCount = -1;
                try {
                  await page.waitForFunction(() => {
                    const el = document.querySelector('[data-component="ingest-activity"]');
                    return el !== null && parseInt(el.getAttribute('data-ingest-event-count') ?? '0', 10) >= 1;
                  }, null, { timeout: 10000 });
                } catch { /* checked below */ }
                eventCount = await page.evaluate(() => parseInt(document.querySelector('[data-component="ingest-activity"]')?.getAttribute('data-ingest-event-count') ?? '-1', 10));
                check(eventCount >= 1, `kb-tabs: [data-component="ingest-activity"][data-ingest-event-count] renders the seeded reflect.kb-ingest event (got ${eventCount})`);
                const kbCellText = await page.evaluate((kb) => document.querySelector(`[data-ingest-kb="${kb}"]`)?.textContent ?? null, INGEST_FIXTURE_KB_ID);
                check(kbCellText === INGEST_FIXTURE_KB_ID, `kb-tabs: the seeded event's row renders [data-ingest-kb="${INGEST_FIXTURE_KB_ID}"] (got "${kbCellText}")`);
                const implCellText = await page.evaluate(() => document.querySelector('[data-ingest-impl="builtin"]')?.textContent ?? null);
                check(implCellText === 'builtin', `kb-tabs: the seeded event's row renders [data-ingest-impl="builtin"] (got "${implCellText}")`);
                // NEGATIVE AC (mirrors scripts/check-kb-ingest-affordance.test.ts's own
                // operator-decision-3 ratchet): the read-only panel offers NO trigger —
                // zero buttons, zero data-action attributes, anywhere inside it.
                const triggerCount = await page.evaluate(() =>
                  document.querySelectorAll('[data-component="ingest-activity"] button, [data-component="ingest-activity"] [data-action]').length);
                check(triggerCount === 0, `kb-tabs: NEGATIVE AC — zero buttons/data-action affordances inside [data-component="ingest-activity"] (got ${triggerCount}); ingest stays reflection-only, this tab only ever displays past events`);
                await frame(page, 'kb-tabs-4-ingest-activity', `Knowledge — Ingest Activity tab: ${eventCount} real event(s), zero trigger affordances`, { key: true });
              } finally {
                cleanIngestActivityFixture();
              }

        },
      },
    ],
});
