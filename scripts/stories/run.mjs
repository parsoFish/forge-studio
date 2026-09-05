/**
 * run.mjs — the story runner (`npm run stories`).
 *
 * One story file yields three artifacts from one script (1.0.md §3): a
 * per-beat verdict, a clip plus frames, and a usage-doc fragment — so the
 * tests, the demos and the docs cannot drift from each other.
 *
 *   npm run stories                      every story, in id order
 *   npm run stories -- --story smoke     one story
 *   npm run stories -- --costless-only   every story that reaches no agent
 *                                        (NOT what CI runs — CI names `smoke`
 *                                        and `proof`, the two harness proofs;
 *                                        see .github/workflows/ci.yml)
 *   npm run stories -- --approve-spend   authorise a story that spends (H2)
 *   npm run stories -- --list            print the shape, boot nothing
 *
 * ORDER IS LOAD-BEARING. The spend gate is evaluated before any lock, bridge
 * or browser work, so a refusal costs nothing. The sweep runs before the
 * bridge, so a run can never inherit a dead run's state. The bridge decision
 * runs before the browser, so we never drive a bridge serving another tree.
 *
 * The whole story runs in ONE browser context, reached by real navigation.
 * That yields one continuous `story.webm` plus a frame per beat — playwright
 * records one video per context, and buying a clip per beat would mean a
 * fresh context per beat re-navigating with `page.goto`, which is exactly the
 * teleporting this runner exists to stop.
 */
import { readdirSync, mkdirSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

import { loadStory, assertNonEmptySelection } from './story-file.mjs';
import { spendGateVerdict } from './spend.mjs';
import { memoryVerdict, readAvailableMb, acquireHostLock } from './preflight.mjs';
import {
  applyFence,
  describeFence,
  fenceBreaches,
  readGitPorcelain,
  sweepProductFixtures,
  sweepStoryResidue,
} from './sweep.mjs';
import { decideStoryBridge, readProcCwd, refusalError, bootOwnBridge } from './bridge.mjs';
import { driveBeat } from './beats.mjs';
import { renderDocFragment, docPathFor } from './docs-fragment.mjs';
import { writeStoryJson, regenerateGallery, storyRowFrom } from './gallery.mjs';
import { collectAgentRuns, reapAgentRuns, describeReap } from './reap.mjs';
import { recordReapedCancellations, reapReasonFor } from './reap-cancel.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORY_DIR = join(ROOT, 'tests', 'stories');
const BRIDGE_HEALTH = 'http://localhost:4123/api/health';
const VIEWPORT = { width: 1600, height: 1000 };

function parseArgs(argv) {
  const at = (f) => argv.indexOf(f);
  const storyIdx = at('--story');
  return {
    story: storyIdx === -1 ? null : argv[storyIdx + 1],
    approveSpend: argv.includes('--approve-spend'),
    costlessOnly: argv.includes('--costless-only'),
    list: argv.includes('--list'),
  };
}

function storyFiles() {
  if (!existsSync(STORY_DIR)) return [];
  return readdirSync(STORY_DIR)
    .filter((f) => f.endsWith('.story.mjs'))
    .sort()
    .map((f) => join(STORY_DIR, f));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Stamped before anything runs: the reaper only claims sessions THIS run
  // created, so a previous run's residue is never signalled (reap.mjs header).
  const startedMs = Date.now();

  let stories = [];
  for (const file of storyFiles()) {
    stories.push(await loadStory(pathToFileURL(file).href));
  }
  if (args.story !== null) {
    stories = stories.filter((s) => s.id === args.story);
    if (stories.length === 0) {
      throw new Error(`--story "${args.story}" matched nothing in ${STORY_DIR}`);
    }
  }
  if (args.costlessOnly) {
    stories = stories.filter((s) => spendGateVerdict(s.ground, { approveSpend: false }).allowed);
  }

  // A run that selected nothing must not exit 0. Checked after filtering and
  // before --list, so `--list` on an empty set is loud too.
  assertNonEmptySelection(stories, { costlessOnly: args.costlessOnly });

  if (args.list) {
    console.log(`[stories] ${stories.length} story/stories:`);
    for (const s of stories) {
      const spend = s.ground.realSpawn || s.ground.budget_usd > 0 ? ` [costs $${s.ground.budget_usd}]` : '';
      console.log(`  ${s.id} — ${s.docs.title} (${s.beats.length} beats, ${s.docs.kind})${spend}`);
    }
    return 0;
  }

  // 1. Spend gate FIRST — a refusal must cost nothing.
  for (const s of stories) {
    const v = spendGateVerdict(s.ground, { approveSpend: args.approveSpend });
    if (!v.allowed) {
      console.error(`[stories] REFUSING ${s.id}: ${v.reason}`);
      return 1;
    }
  }

  // 2. Memory — a starved host OOM-kills the browser and the crash reads as a
  //    code defect.
  const mem = memoryVerdict(readAvailableMb());
  if (!mem.ok) {
    console.error(`[stories] REFUSING: ${mem.reason}`);
    return 1;
  }
  console.log(`[stories] memory ok — ${mem.reason}`);

  // 3. Host lock — 4123/4124 are host-global.
  const release = await acquireHostLock();

  let bridgeProc = null;
  let exitCode = 0;
  try {
    // 4. Leading sweep, before the bridge, so a run cannot inherit dead state.
    for (const s of stories) {
      const { removed, failed } = sweepStoryResidue(s.id, ROOT);
      for (const p of removed) console.log(`[stories] leading sweep removed ${p}`);
      for (const f of failed) console.warn(`[stories] leading sweep could not remove ${f.path}: ${f.error}`);
    }

    // 5. Bridge identity — never drive a bridge serving another tree.
    const { probeBridgeIdentity } = await import(
      pathToFileURL(join(ROOT, 'apps', 'forge', 'forge-watch.ts')).href
    );
    const identity = await probeBridgeIdentity(BRIDGE_HEALTH);
    const decision = decideStoryBridge(identity, { ownRoot: ROOT, cwdOf: readProcCwd });

    let uiUrl;
    if (decision === 'refuse') {
      throw refusalError(identity, readProcCwd(identity.pid), ROOT);
    } else if (decision === 'boot') {
      console.log('[stories] 4123 is free — booting our own bridge from this tree');
      const booted = await bootOwnBridge(ROOT);
      bridgeProc = booted.proc;
      uiUrl = booted.uiUrl;
    } else {
      console.log(`[stories] reusing this tree's own bridge (pid ${identity.pid})`);
      uiUrl = 'http://localhost:4124';
    }

    for (const story of stories) {
      exitCode = (await runStory(story, uiUrl, startedMs)) || exitCode;
    }
  } finally {
    // The abort backstop. `runStory` reaps into each story's own verdict
    // record; this catches the paths that never reach one — a throw, a
    // refusal after the bridge booted, a Ctrl-C between stories. Idempotent:
    // a pid already reaped is simply not alive, and is reported as skipped.
    // It runs BEFORE the bridge is taken down, so no agent is orphaned by the
    // very teardown that is supposed to be ending it.
    try {
      const report = await reapAgentRuns(collectAgentRuns(ROOT, startedMs), { ownRoot: ROOT });
      // 6.11.12: a kill writes nothing for itself, so the terminal phase is
      // written here — otherwise the turn we just ended reads as still working
      // on every Studio surface, forever.
      report.cancelled = recordReapedCancellations(report, {
        projectsRoot: join(ROOT, 'projects'),
        reason: 'story runner: the run ended before this turn did (abort backstop)',
      });
      for (const line of describeReap(report)) console.log(line);
    } catch (err) {
      // A teardown that throws loses the verdict the run just produced.
      console.warn(`[stories] run-end reap failed: ${err?.message ?? err}`);
    }
    if (bridgeProc !== null) {
      try {
        process.kill(-bridgeProc.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
    await release();
  }
  return exitCode;
}

async function runStory(story, uiUrl, startedMs) {
  // The fence's baseline, taken before this story touches anything and after
  // the leading sweep, so a previous run's residue is never charged to this one
  // and an operator's work-in-progress is never charged to it either.
  const treeBefore = readGitPorcelain(ROOT);
  const outDir = join(ROOT, 'demos', 'stories', story.id);
  const framesDir = join(outDir, 'frames');
  const clipTmp = join(outDir, '_clip');
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(clipTmp, { recursive: true });

  console.log(`\n[stories] ${story.id} — ${story.docs.title}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: clipTmp, size: VIEWPORT },
  });
  // Bound every locator action: a playwright default of 30s records half a
  // minute of dead video per missing element.
  context.setDefaultTimeout(5000);
  const page = await context.newPage();

  const beats = [];
  // What earlier beats bound, for the routes later beats build from it. Rebuilt
  // per beat rather than mutated — a beat's verdict states what IT learned.
  let bindings = {};
  try {
    for (const [i, beat] of story.beats.entries()) {
      const verdict = await driveBeat(page, beat, i, uiUrl, bindings);
      bindings = { ...bindings, ...verdict.bindings };
      const frame = `frames/${String(i + 1).padStart(2, '0')}-${slug(beat.act)}.png`;
      await page.screenshot({ path: join(outDir, frame), fullPage: true });
      beats.push({ ...verdict, frame });
      const mark = verdict.status === 'green' ? '✓' : '✗';
      console.log(`  ${mark} ${i + 1}. ${beat.act}`);
      for (const f of verdict.failures) console.log(`      ${f}`);
    }
  } finally {
    await context.close(); // finalises the .webm
    await browser.close();
  }

  // Collect the clip.
  const recorded = readdirSync(clipTmp).filter((f) => f.endsWith('.webm'));
  if (recorded.length > 0) {
    renameSync(join(clipTmp, recorded[0]), join(outDir, 'story.webm'));
  }
  // The recording scratch dir is ours and must not survive into the gallery.
  rmSync(clipTmp, { recursive: true, force: true });

  // Every agent this story dispatched dies with the story, and the kills go
  // INTO the verdict record — an orphan that outlives its run is unobserved
  // by the gate that started it, and a kill nobody can read afterwards is a
  // side effect rather than evidence (`forge-8vfn.5.37`, reap.mjs header).
  const reap = await reapAgentRuns(collectAgentRuns(ROOT, startedMs), { ownRoot: ROOT });
  // 6.11.12 (T1 ruling 232): the kill cannot write its own ending, so the
  // reserved terminal phase is stamped here — the same act, through the same
  // guarded seam, as the generic cancel route. The reason quotes the run's
  // FIRST RED BEAT, whose failure text already names the bound that fired
  // (`beatBound`'s label, bead 6.11.10), so the session says why it stopped
  // rather than only that it did.
  reap.cancelled = recordReapedCancellations(reap, {
    projectsRoot: join(ROOT, 'projects'),
    reason: reapReasonFor(story, beats),
  });
  for (const line of describeReap(reap)) console.log(line);

  // §3.1's trailing duty: the fixtures this story CREATED in the product. Not
  // its own output — `demos/stories/<id>` IS the artifact. The comment that
  // used to stand here ("the smoke story creates none") was true of `smoke` and
  // false of `proof`, S2 and S4, which left `projects/story-<id>`,
  // `brain/projects/story-<id>` and a saved flow behind every run.
  const sweep = sweepProductFixtures(story.id, ROOT);
  for (const p of sweep.removed) console.log(`[stories] trailing sweep removed ${p}`);
  for (const f of sweep.failed) console.warn(`[stories] trailing sweep could not remove ${f.path}: ${f.error}`);

  // And the fence, over everything the product wrote that carries no story id.
  const fence = applyFence(fenceBreaches(treeBefore, readGitPorcelain(ROOT), story.id), ROOT);
  for (const line of describeFence(fence)) console.log(line);

  const result = { story, beats, reap, sweep, fence };
  writeStoryJson(result, ROOT);

  const docPath = docPathFor(story, ROOT);
  mkdirSync(dirname(docPath), { recursive: true });
  writeFileSync(docPath, renderDocFragment(result));

  regenerateGallery(ROOT);

  const row = storyRowFrom(result);
  console.log(`[stories] ${story.id}: ${row.status} — ${row.greenBeats}/${row.beats} beats green`);
  console.log(`[stories]   clip  ${join('demos', 'stories', story.id, 'story.webm')}`);
  console.log(`[stories]   doc   ${docPath.replace(`${ROOT}/`, '')}`);

  return row.status === 'green' ? 0 : 1;
}

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`[stories] ${e?.message ?? e}`);
    process.exit(1);
  });
