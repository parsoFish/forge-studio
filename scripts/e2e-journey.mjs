/**
 * e2e-journey — the Forge Studio user-story walkthrough + DOM-as-metrics regression harness.
 *
 *   node scripts/e2e-journey.mjs   (npm run ui:journey)
 *
 * WHAT THIS IS. Forge Studio is one product for one operator running a portfolio,
 * who never leaves the UI. This harness walks the canonical Studio USER STORIES —
 * the things that operator actually does — organised around the three platform
 * verbs: AUTHOR a flow, RUN it, SWAP its engine. It is BOTH the watchable demo
 * (short looping per-capability clips + a frame gallery + index.html — clips-first,
 * NOT one full-session video) AND the UI regression harness (every beat asserts a
 * real data-* invariant; a non-zero exit flags a regression while the gallery
 * always finishes). It is a sibling to two other harnesses:
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
 * Output: demos/e2e/{clips/*.webm, frames/*.png, index.html}. Cleans up all
 * seeded state (architect session, cycle logs, queue manifests, the authored
 * scratch flow, any _guidance/*.md, and any brain/cycles/_raw/ archives an
 * emulated cycle left behind) in the finally block.
 *
 * JOURNEYS-AS-DATA. The beats are grouped into 10 journeys via `defineJourney()`
 * (scripts/lib/journey-runtime.mjs), one module per user story under
 * scripts/journeys/ (registry: scripts/journeys/index.mjs), and driven through
 * a flat `RUN_ORDER` in a building-blocks THROUGHLINE — every journey's beats
 * now run contiguous (no interleaving): skills, stand-up-onboard,
 * stand-up-create, knowledge, agents, flows-author, flows-run, roadmap,
 * recovery, demo-builder (see scripts/journeys/index.mjs for the
 * cross-journey ordering constraints this sequence preserves).
 * `node scripts/e2e-journey.mjs --list` prints the journey/beat shape and
 * exits without booting Studio.
 */
import { spawn, execSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, renameSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createAssertions, sleep } from './lib/journey-assertions.mjs';
import { assertNoLiveDaemon } from './lib/journey-daemon-guard.mjs';
import { createBeatTracker, renderGallery, writeResultsFile, writeGalleryFile, PACE } from './lib/journey-runtime.mjs';
import { JOURNEYS, RUN_ORDER } from './journeys/index.mjs';
import {
  FORGE_ROOT, PROJECT, projectRoot, cleanProjectDir, cleanSeededSession,
  OUT, FRAMES, CLIPS,
  DATE, INIT, J5_INIT, CYCLE_LOG,
  cleanScratchFlow,
  cleanStarterAgents,
  cleanFirstFlow,
  cleanFirstProject,
  cleanFirstFlowRun,
  READ, ACT, QDIR,
  cleanInstructionsSession,
  cleanSeededBrain,
  cleanDemoBuilderSession,
  cleanSkillArtifacts,
  ONB_EXISTING_SLUG, cleanOnboardedProject,
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
      { cwd: FORGE_ROOT,
        // R5-01-F1: FORGE_DRY_BRIDGE=1 alongside NO_SPAWN — the harness's bridge
        // child must never spawn/merge/daemon-control for real (2026-07-16
        // self-merge incident). Task A3/A4 add the drift-guard test + post-run
        // assertions that consume this; this wiring alone is R5-01-F1's job.
        env: { ...process.env, FORGE_ARCHITECT_NO_SPAWN: '1', FORGE_DRY_BRIDGE: '1' },
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
async function frame(page, name, altCaption, opts = {}) {
  seq += 1;
  const file = `${String(seq).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(FRAMES, file), fullPage: true });
  captions.push({ file, caption: altCaption });
  tracker.recordCapture({ kind: 'frame', file, caption: altCaption, key: opts.key });
  console.log(`  [${String(seq).padStart(2, '0')}] ${altCaption}`);
}

/**
 * Record ONE short looping clip around a single interaction, in its own ephemeral
 * recording context (recordVideo is per-context; a fresh context's .webm ≈ that one
 * interaction). A fresh context has NO nav/DOM state, so it re-navigates to `route`
 * and re-waits for readiness — which composes with the seed model (seed the files
 * first, then the clip re-reads the same server state). Non-fatal: any error is
 * swallowed so the journey (and its main video) always finishes.
 *
 * Operator pacing mandate: every clip HOLDS on its final state after `interact`
 * returns (opts.holdTailMs, default PACE.holdTail) so a loop never jump-cuts —
 * the viewer gets processing time on whatever the interaction just revealed.
 * Default recording size is 1600x1000 (crisper text than the old 1000x620); a
 * soft size-guard flags any clip that creeps toward a 4M runaway ceiling.
 */
async function recordClip(browser, watch, name, route, interact, opts = {}) {
  const { size = { width: 1600, height: 1000 }, readySel = '[data-page-ready="true"]', caption: cap = name } = opts;
  const tmp = join(CLIPS, '_tmp', name);
  let clipCtx = null;
  let clipPage = null;
  try {
    mkdirSync(tmp, { recursive: true });
    clipCtx = await browser.newContext({ viewport: size, recordVideo: { dir: tmp, size } });
    // Bound EVERY locator action inside interact(): the playwright default is 30s,
    // and a single missing element records 30s of dead video into the clip
    // (observed: a 129s clip from three swallowed locator timeouts).
    clipCtx.setDefaultTimeout(5000);
    clipPage = await clipCtx.newPage();
    // opts.freezeAnimations: pause CSS animations/transitions for the whole clip —
    // continuous shimmer/pulse effects dominate VP8 size on otherwise-static scenes.
    if (opts.freezeAnimations) {
      await clipPage.addInitScript(() => {
        const style = document.createElement('style');
        style.textContent = '*,*::before,*::after{animation-play-state:paused!important;transition:none!important}';
        document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
      }).catch(() => {});
    }
    await clipPage.goto(watch.uiUrl + route, { waitUntil: 'domcontentloaded' });
    await clipPage.waitForSelector(readySel, { timeout: 15000 }).catch(() => {});
    await interact(clipPage);
    await sleep(opts.holdTailMs ?? PACE.holdTail); // hold on the final state — no jump-cut loops
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
      const sizeBytes = statSync(dest).size;
      clipMeta.push({ file: `clips/${name}.webm`, caption: cap });
      tracker.recordCapture({ kind: 'clip', file: `clips/${name}.webm`, caption: cap, sizeBytes });
      // 4M runaway-catch: clips ARE the demo product now (clips-first pivot) —
      // full staged progressions with viewer-processing dwells legitimately run
      // 0.7-1.7M at the default 1000x620 size; the 2026-07 recording-quality bump
      // to 1600x1000 (2.56x the pixels) scales bytes ~2-2.5x in the same ratio, so
      // the guard doubles to 4M alongside it. The guard exists to catch a runaway
      // recording, not to fight the demo's purpose — the 129s-dead-video class it
      // exists for (a swallowed 30s locator timeout x N) blows past 4M regardless;
      // total clip weight still nets far below the removed 45M full-session video.
      check(sizeBytes < 4_000_000, `clip ${name}.webm under 4M (got ${sizeBytes})`);
      console.log(`  [clip] ${name} — ${cap} (${sizeBytes}B)`);
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
  // journeys-as-data: JOURNEYS (imported from ./journeys/index.mjs) declares
  // every beat as a drive(ctx) closure; ctx is the runner's closed handle set
  // (journeyCtx, below) so nothing needs pre-hoisting here anymore. `--list`
  // (below) prints the journey/beat shape from JOURNEYS without booting
  // anything.
  let watch, browser, page;

  // journeyCtx is the handle set every beat's drive(ctx) receives: the
  // runner-scope handles (assigned via Object.assign once page/watch/browser
  // exist, just before the run loop) plus a `seeded` bag journey modules
  // mirror cross-beat state into for the runner's own finally-block cleanup
  // to read (see scripts/journeys/*.mjs).
  const journeyCtx = { seeded: {} };

  // RUN_ORDER + results speak journey IDs (kebab-case), not array position.
  const journeyById = Object.fromEntries(JOURNEYS.map((j) => [j.id, j]));
  const journeyIds = JOURNEYS.map((j) => j.id);

  for (const j of JOURNEYS) tracker.journeyMeta(j);

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
  for (const j of JOURNEYS) {
    for (const b of j.beats) {
      if (!scheduled.has(`${j.id}/${b.id}`)) throw new Error(`[e2e] beat '${j.id}/${b.id}' is defined but never scheduled in RUN_ORDER`);
    }
  }

  if (process.argv.includes('--list')) {
    console.log(`[e2e] ${JOURNEYS.length} journeys, ${RUN_ORDER.length} beats:`);
    for (const j of JOURNEYS) {
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
  mkdirSync(CLIPS, { recursive: true });

  // The from-scratch flow (ACT-1) is now authored LIVE in the Studio BUILD tab by
  // flows-author's scratch-build beat, not pre-seeded — this is just the stale-state
  // sweep so a prior interrupted run's leftovers don't collide with this one.
  cleanScratchFlow();
  cleanStarterAgents();
  cleanFirstFlow();
  cleanFirstProject();
  cleanFirstFlowRun();

  console.log('[e2e] booting forge studio (cold compile ~20-40s)…');
  watch = await startWatch();
  console.log(`[e2e] ready: ${watch.uiUrl}`);
  try { execSync(`curl -s -m 60 ${watch.uiUrl}/ -o /dev/null`); } catch { /* warm */ }

  browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1380, height: 1600 },
  });
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));

  // Wire the runner-scope handles into journeyCtx now that page/watch/browser
  // exist — every beat's drive(ctx) destructures what it needs from here.
  Object.assign(journeyCtx, {
    page, watch, browser, frame, recordClip, check, countAtLeast, expectPhaseCost, expectHexOpensDrawer,
  });

  try {
    for (const [journeyId, beatId] of RUN_ORDER) {
      const beat = journeyById[journeyId].beats.find((b) => b.id === beatId);
      console.log(`\n[journey/beat] ${journeyId}/${beatId} — ${beat.title}`);
      tracker.begin(journeyId, beatId);
      await beat.drive(journeyCtx);
      tracker.end();
    }

        console.log('\n[e2e] journey complete.');
  } finally {
        await ctx.close();
        await browser.close();
        try { process.kill(-watch.proc.pid, 'SIGKILL'); } catch { /* */ }
        cleanProjectDir();
        cleanSeededSession(journeyCtx.seeded.createdSid);
        cleanInstructionsSession(journeyCtx.seeded.instrSid);          // Part 1 — AI-1
        cleanSeededBrain(journeyCtx.seeded.pbSid);                      // Part 1 — AI-2
        // Crash-safe sweep for the demo-builder journey (its in-beat cleanup only
        // runs on a completed journey; residue here caused the 2026-07-16 incident class).
        if (journeyCtx.seeded.demoSid) {
          try { cleanDemoBuilderSession(journeyCtx.seeded.demoSid); } catch { /* best-effort */ }
        }
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
        // Cycle-archive cleanup (contamination found 2026-07-16) — the emulated
        // architect/dev-loop turns this harness seeds write real reflector
        // archives under brain/cycles/_raw/ exactly like a live cycle does; left
        // behind, they silently pollute the real cross-cycle corpus Brain 2
        // planners read from. Sweep every archive stamped with this run's
        // synthetic initiative ids (main cycle, the J5 flows-author seeded-run,
        // and the ACT-3 gated "studio-demo" run — none of these must ever reach
        // the real corpus).
        try {
          const rawDir = join(FORGE_ROOT, 'brain', 'cycles', '_raw');
          if (existsSync(rawDir)) {
            const studioInit = `INIT-${DATE}-e2e-studio-demo`;
            const staleSuffixes = [`_${INIT}.md`, `_${J5_INIT}.md`, `_${studioInit}.md`];
            const stale = readdirSync(rawDir).filter((f) => staleSuffixes.some((suf) => f.endsWith(suf)));
            for (const f of stale) rmSync(join(rawDir, f), { force: true });
          }
        } catch { /* cycle-archive cleanup best-effort */ }
        if (journeyCtx.seeded.createdSid) {
          try { rmSync(join(FORGE_ROOT, '_logs', `_architect-${journeyCtx.seeded.createdSid}`), { recursive: true, force: true }); } catch { /* */ }
        }
        // KB-seam cleanup — remove any _guidance/*.md files written by the pin-guidance beat.
        try {
          const guidanceDir = join(FORGE_ROOT, 'brain', 'cycles', '_guidance');
          if (existsSync(guidanceDir)) {
            for (const f of readdirSync(guidanceDir)) rmSync(join(guidanceDir, f), { force: true });
            try { rmSync(guidanceDir, { recursive: true, force: true }); } catch { /* */ }
          }
        } catch { /* KB-seam cleanup best-effort */ }
        // Scratch-KB sweep — the knowledge journey creates + deletes
        // brain/journey-scratch-kb/ through the real UI; this is the crash-safe
        // backstop so an aborted run never leaves a synthetic KB in brain/.
        try { rmSync(join(FORGE_ROOT, 'brain', 'journey-scratch-kb'), { recursive: true, force: true }); } catch { /* */ }
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
    title: 'Forge Studio — the operator walkthrough',
    subtitle: 'Clone forge → stand up a project → compose the four pillars (flows · skills · agents · knowledge) → run a gated cycle. Grounded on a real mdtoc roadmap feature (in-place TOC injection). Recorded ' + new Date().toISOString() + '.',
  }));
  console.log(`[e2e] OK — ${OUT}/index.html (${captions.length} frames + ${clipMeta.length} clips)`);

  console.log('\n[e2e] journey summary:');
  for (const jid of results.executedJourneys) {
    const j = results.journeys[jid];
    if (!j) continue;
    const passed = j.checksTotal - j.checksFailed;
    const mark = j.pass ? '✓' : '✗';
    const beatCount = Object.keys(j.beats).length;
    console.log(`  ${mark} ${jid} — ${passed}/${j.checksTotal} checks, ${beatCount} beats`);
  }
  const totalBeats = results.executedJourneys.reduce(
    (sum, jid) => sum + (results.journeys[jid] ? Object.keys(results.journeys[jid].beats).length : 0), 0,
  );
  const totalPassed = results.totals.checksTotal - results.totals.checksFailed;
  console.log(`  totals: ${totalPassed}/${results.totals.checksTotal} checks, ${totalBeats} beats across ${results.executedJourneys.length} journeys`);

  if (failures.length) {
    console.error(`\n[e2e] ${failures.length} DOM-as-metrics assertion(s) FAILED:`);
    for (const f of failures) console.error(`   ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log('[e2e] all DOM-as-metrics assertions passed ✓');
  }
}

main().catch((err) => { console.error(err); cleanProjectDir(); cleanScratchFlow(); cleanStarterAgents(); cleanFirstFlow(); cleanFirstProject(); cleanFirstFlowRun(); process.exit(1); });
