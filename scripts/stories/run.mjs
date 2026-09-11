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
import { makeAgentProcProbe, makeAgentChannelDoor } from './beats-agent-proc.mjs';
import { readdirSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

import { loadStory, assertNonEmptySelection } from './story-file.mjs';
import { stampEveryLine } from './log-stamp.mjs';
import { spendGateVerdict, summariseRunSpend } from './spend.mjs';
import { memoryVerdict, readAvailableMb, acquireHostLock, foreignSessionVerdict, remoteSwitchVerdict } from './preflight.mjs';
import { suiteLockVerdict } from './lock-guard.mjs';
import {
  applyFence,
  describeFence,
  fenceBreaches,
  starterAgentSlugs,
  readGitPorcelain,
  snapshotSiblingWorktrees,
  siblingWorktreeEscapes,
  unownedEscapes,
  removePaths,
  sweepProductFixtures,
  sweepStoryResidue,
  sweepStoryRemotesFromManifest,
} from './sweep.mjs';
import { restoreSweptCommitted, stopOwnScheduler, releaseOwnInFlight } from './sweep-teardown.mjs';
import {
  snapshotSiblingGrounds, siblingGroundEscapes, describeGroundEscapes,
  ownGroundManifest, mintedSessionPaths, mintedSessionWrites, classifyOwnGroundDrift, groundChanges,
} from './ground-hash.mjs';
import { captureBeatDom, captureRedEvidence, describeRedEvidence } from './red-evidence.mjs';
import { decideStoryBridge, readProcCwd, refusalError, bootOwnBridge, bridgeSpawnOptions } from './bridge.mjs';
import { driveBeat } from './beats-drive.mjs';
import { resolveBeatRoute } from './beats.mjs';
import { renderDocFragment, docPathFor } from './docs-fragment.mjs';
import { writeStoryJson, regenerateGallery, storyRowFrom } from './gallery.mjs';
import { collectAgentRuns, reapAgentRuns, describeReap } from './reap.mjs';
import { quiesceWriters, describeQuiesce, reappeared } from './quiesce.mjs';
import { recordReapedCancellations, reapReasonFor } from './reap-cancel.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** One dispatched run's event rows, or [] — an unreadable log is UNMEASURED,
 *  never a silent zero (bead `forge-8vfn.6.11.8`). */
function readRunEvents(dir) {
  try {
    return readFileSync(join(dir, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  } catch {
    return [];
  }
}
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
  stampEveryLine();
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

  // 1b. Foreign sessions — bead `forge-8vfn.6.11.50`. A COSTED run must not
  //     start beside another project's sessions: Studio lists them all, a beat
  //     that presses `open-session` takes the FIRST card, and S2 run 10 spent
  //     its whole bound on S1 run 10's failed demo session on `gitweave`.
  //     Checked here, beside the spend gate, because the point is to refuse
  //     BEFORE the money — and only for a run that spends, so a costless story
  //     never gains a new way to be blocked.
  for (const s of stories) {
    if (!(s.ground.realSpawn || s.ground.budget_usd > 0)) continue;
    const v = foreignSessionVerdict(ROOT, s.ground.project);
    if (!v.ok) {
      console.error(`[stories] REFUSING ${s.id}: ${v.reason}`);
      return 1;
    }
    console.log(`[stories] sessions ok — ${v.reason}`);
  }

  // 1c. The operator switch a remote-binding story stands on (bead
  //     `forge-8vfn.7.5.7`, ruling 456). `projects.remote.create` is
  //     per-worktree state in a GITIGNORED config and defaults OFF, so S2's
  //     beat 5 is red BY CONSTRUCTION in a worktree nobody switched on — and
  //     A's S2 run 1 spent $1.76 discovering this lane's config rather than
  //     anything about the product. Checked here, beside the other refusals and
  //     BEFORE the money, and it refuses for costless runs too: the beat fails
  //     either way, and a red that says "the product is wrong" when the product
  //     was never asked is the expensive kind.
  const remote = remoteSwitchVerdict(ROOT, stories.map((s) => s.id));
  if (!remote.ok) {
    console.error(`[stories] REFUSING: ${remote.reason}`);
    return 1;
  }
  console.log(`[stories] remote switch ok — ${remote.reason}`);

  // 1d. The OTHER kind of work in this checkout — bead `forge-8vfn.7.6.13`
  //     (ruling 634). A full test suite writes into `projects/`
  //     (`agent-run-dispatch.test.ts`'s fixture), which is the directory the
  //     ground hash below measures before and after to prove this run's ground
  //     did not drift. The two took different locks and so overlapped by
  //     construction; lane A's fence caught one as an UNATTRIBUTABLE write.
  //     Refused HERE, beside the other refusals and before the bridge, and it
  //     never sleeps — the lane's own Monitor is what waits (§15.335).
  const overlap = suiteLockVerdict();
  console.log(`[stories] ${overlap.reason}`);
  if (!overlap.ok) return 1;

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
  // What the leading sweep removed, so the teardown can put back anything the
  // run never regenerated (T1 ruling 594, half 2).
  const sweptPaths = [];
  try {
    // 4. Leading sweep, before the bridge, so a run cannot inherit dead state.
    for (const s of stories) {
      const { removed, failed } = sweepStoryResidue(s.id, ROOT);
      sweptPaths.push(...removed);
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
      // 590(i): say whether this bridge can reach the community sources at all.
      // A run whose refresh refuses for want of a credential and a run whose
      // refresh refuses because the PRODUCT refused look identical in a beat's
      // verdict; only this line separates them. The token itself is never
      // printed — `note` carries the fact, never the value.
      // ONE read of the credential per boot: the options are built here, the
      // fact is logged from them, and the SAME object is what gets spawned.
      const bridgeOpts = bridgeSpawnOptions(ROOT);
      console.log(`[stories] ${bridgeOpts.note}`);
      const booted = await bootOwnBridge(ROOT, bridgeOpts);
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
    // THE SWEEP'S PAIRED RESTORE. `demos/stories/<id>/` was deleted before the
    // bridge booted; anything the run never regenerated is still missing, and
    // `git status` shows it as a deliberate deletion. The motivating case is not
    // a crash — a run that REFUSED at preflight against a foreign bridge, the
    // runner doing exactly the right thing, still left three committed files
    // deleted. Only paths git tracks AND that are absent right now are touched,
    // so a finished run's own output is never destroyed by its own teardown.
    // T1 ruling 657(ii). Beat 7 presses Start and a real daemon comes up; run 9's
    // was still alive after the sweep, and `scheduler-start` renders only at
    // `status: stopped`, so the NEXT run's beat 7 would red at t+0 on a missing
    // handle while the state it wants already holds.
    const sched = stopOwnScheduler(ROOT);
    if (sched.stopped !== null) {
      // 689(iii): SAY WHETHER IT DRAINED. "stopped by SIGKILL" and "stopped by
      // SIGKILL without draining" are the same sentence to a reader and
      // different facts to the next run — a daemon killed mid-drain never
      // released its claim, so `_queue/in-flight/` still holds a manifest with a
      // heartbeat that will never advance, and the next run reds at the develop
      // beat for a reason that has nothing to do with the code under test.
      const how = sched.drained ? `${sched.how}, drained` : `${sched.how}, DID NOT DRAIN`;
      console.log(`[stories] stopped the scheduler this run started — pid ${sched.stopped} by ${how}`);
    }
    if (sched.note !== null) console.log(`[stories] scheduler: ${sched.note}`);
    // The fallback, and ONLY the fallback: a daemon that drained handed its
    // claims back itself, with its cycle's own state, which is always better
    // than this. This runs when it could not — the claim is otherwise left in
    // `_queue/in-flight/` with a frozen heartbeat, and `_queue/` is gitignored,
    // so the tree reports clean over it and the NEXT run reds at the develop
    // beat for a reason that is not its own.
    if (sched.stopped !== null && !sched.drained) {
      const rel = releaseOwnInFlight(ROOT);
      for (const p of rel.released) console.log(`[stories] released _queue/in-flight/${p} — this tree's claim, held by a daemon that could not drain`);
      for (const f of rel.failed) console.warn(`[stories] could not release _queue/in-flight/${f.path}: ${f.error}`);
    }

    const put = restoreSweptCommitted(ROOT, sweptPaths);
    for (const p of put.restored) console.log(`[stories] restored ${p} — swept before the run and never regenerated`);
    for (const f of put.failed) console.warn(`[stories] could not restore ${f.path}: ${f.error}`);

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
  // This run's own stamp for its red evidence (`6.11.50`) — one value for the
  // whole run, so the DOM captured at a beat and the ground read before the
  // sweep land in the SAME directory and no previous run's files sit beside
  // them.
  const runStamp = new Date(startedMs).toISOString().replace(/[:.]/g, '-');
  // The fence's baseline, taken before this story touches anything and after
  // the leading sweep, so a previous run's residue is never charged to this one
  // and an operator's work-in-progress is never charged to it either.
  const treeBefore = readGitPorcelain(ROOT);
  // Ruling 309(b) — the fence used to read ONLY this tree, so S1 run 5 printed
  // `fence: clean` in the same run that wrote into the main checkout. Every
  // OTHER worktree of this repo is snapshotted too; what grows in one is an
  // escape into a tree this run does not own.
  const siblingsBefore = snapshotSiblingWorktrees(ROOT);
  // Bead `forge-8vfn.6.11.26` / §15.219 — the path fence above sees a whole
  // GROUND appearing in a sibling tree, but not an edit inside one that was
  // already there. S1 run 8 onboarded the operator's own `projects/gitweave`
  // and the fence said nothing. The ground is hashed by METHOD C here and
  // again after the run, which is what the launcher already did by hand.
  const groundsBefore = snapshotSiblingGrounds(story.ground?.project ?? null, { root: ROOT });
  // T1 ruling 594 — the fence above proves the ground is unchanged in every
  // OTHER worktree; nobody checked the one this run is using. Three lanes each
  // paid a run to find that gap, in three different places, and in one of them
  // the agent COMMITTED its writes so the ground's own `git status` reported
  // nothing at all (§15.327). Hence a hash, never a status.
  const ownGroundBefore = ownGroundManifest(ROOT, story.ground?.project ?? null);
  const logsDir = join(ROOT, '_logs');
  const logsBefore = readdirSync(logsDir, { withFileTypes: true }).map((e) => e.name);
  const outDir = join(ROOT, 'demos', 'stories', story.id);
  const framesDir = join(outDir, 'frames');
  const clipTmp = join(outDir, '_clip');
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(clipTmp, { recursive: true });

  // The blank separator is its own line so the story's title carries a stamp:
  // a leading `\n` inside the string puts the stamp before the break and the
  // line the reader sees starts unstamped (measured on the s11 smoke run).
  console.log('');
  console.log(`[stories] ${story.id} — ${story.docs.title}`);

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
  // T1 ruling 580 — the stop door for beats that are NOT on a session page.
  // 518's doors and the process probe both need a `/sessions/<kind>/<id>` route,
  // so a beat waiting on `/artifact` or a flow-run page had no door at all and
  // spent its whole declared bound; S10 run 5's beat 16 spent 14 m 13 s of its
  // fifteen minutes on a run that had already stopped writing. Built ONCE from
  // ROOT, which is known here and nowhere else (§15.148), and it only ever ends
  // a wait EARLIER — the declared bound remains a hard maximum.
  const stallDoor = makeAgentChannelDoor(ROOT);
  // What earlier beats bound, for the routes later beats build from it. Rebuilt
  // per beat rather than mutated — a beat's verdict states what IT learned.
  let bindings = {};
  try {
    for (const [i, beat] of story.beats.entries()) {
      // Bead `forge-8vfn.6.11.22` — an agent-scale wait samples the agent's own
      // process as it polls, so an unsatisfied one says what that process was
      // doing instead of leaving it to be reconstructed afterwards by hand.
      // Built per beat from the route it is about; null for every other beat.
      const probe = makeAgentProcProbe(ROOT, resolveBeatRoute(beat, bindings).route);
      const verdict = await driveBeat(page, beat, i, uiUrl, bindings, undefined, probe, stallDoor);
      bindings = { ...bindings, ...verdict.bindings };
      const frame = `frames/${String(i + 1).padStart(2, '0')}-${slug(beat.act)}.png`;
      await page.screenshot({ path: join(outDir, frame), fullPage: true });
      beats.push({ ...verdict, frame });
      // Bead `forge-8vfn.6.11.42` — what the OPERATOR could see at the red,
      // captured while the page still exists. The session dir below says what
      // the product HAD; this says what was on the screen, and S2 run 8's open
      // question is exactly the difference between the two.
      if (verdict.status !== 'green') await captureBeatDom(page, ROOT, story.id, i, beat.act, runStamp);
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
  // Collected ONCE and reused: the reap signals and removes, so a second
  // `collectAgentRuns` after it would find a smaller window and price less than
  // the run actually spent.
  const dispatchedRuns = collectAgentRuns(ROOT, startedMs);
  const reap = await reapAgentRuns(dispatchedRuns, { ownRoot: ROOT });
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

  // Bead `forge-8vfn.6.11.8` — the spend COLUMN. Read from the dispatched
  // runs' OWN event logs, collected before the reap removed them from the
  // window, so a turn that priced itself is reported and a turn that was reaped
  // before writing a terminal event is reported as UNMEASURED with the reason.
  // Never `$0.00`: a zero meaning "nothing was spent" and a zero meaning
  // "nobody looked" printing the same is what four H6 runs cost to learn.
  const spend = summariseRunSpend({
    realSpawn: story.ground?.realSpawn === true,
    events: dispatchedRuns.map((r) => readRunEvents(r.dir)),
  });
  console.log(`[stories] spend: ${spend.label}`);

  // §3.1's trailing duty: the fixtures this story CREATED in the product. Not
  // its own output — `demos/stories/<id>` IS the artifact. The comment that
  // used to stand here ("the smoke story creates none") was true of `smoke` and
  // false of `proof`, S2 and S4, which left `projects/story-<id>`,
  // `brain/projects/story-<id>` and a saved flow behind every run.
  // Bead `forge-8vfn.6.11.42` (ruling 356b) — ON A RED RUN THE SWEEP WAITS.
  // S2 run 8's ground was removed before anything read
  // `_architect/<sid>/questions.json`, so "the questions were written late" and
  // "the page rendered them late" — different defects with byte-identical JSON —
  // could not be told apart, and the answer would have cost a third funded run.
  // The sweep below is unchanged; it simply no longer runs first. A GREEN run
  // reads nothing and sweeps exactly as before.
  const redEvidence = captureRedEvidence({
    root: ROOT,
    storyId: story.id,
    red: beats.some((b) => b.status !== 'green'),
    runStamp,
  });
  for (const line of describeRedEvidence(redEvidence, ROOT)) console.log(line);

  // Bead `forge-8vfn.7.5.2` — THE TREE STOPS MOVING BEFORE THE FENCE JUDGES IT.
  // S6's re-measure removed `brain/story-s6/` at 13:49:02.890Z, said so, and
  // the bridge this run booted — still shutting down — put `kb.yaml` back at
  // .935Z, 33 ms before the verdict printed. The fence's line was true when
  // written and false at process exit, and that line is what a lane pastes
  // into a ledger. The reap above has just signalled every agent this story
  // dispatched; a `kill` returning is not the process ending, so this waits
  // for them to be GONE (whole-parentage, §15.206) and then for the tree
  // itself to read the same twice. The bridge deliberately is NOT waited on:
  // `run.mjs` boots one and drives every story through it, so it must outlive
  // this sweep — which is exactly why the re-read after the fence exists.
  const quiesce = await quiesceWriters({ root: ROOT, pids: reap.reaped.map((r) => r.pid) });
  for (const line of describeQuiesce(quiesce)) console.log(line);

  const sweep = sweepProductFixtures(story.id, ROOT);
  for (const p of sweep.removed) console.log(`[stories] trailing sweep removed ${p}`);
  // Bead `forge-8vfn.6.11.29` — the OTHER half of the trailing sweep: the
  // GitHub remotes this run minted. Unreached until now, so every run that
  // minted one leaked it.
  const remotes = sweepStoryRemotesFromManifest({ storyId: story.id, root: ROOT });
  for (const r of remotes.deleted) console.log(`[stories] trailing sweep DELETED remote ${r}`);
  for (const r of remotes.refusals) console.warn(`[stories] ${r}`);
  for (const f of remotes.failed) console.warn(`[stories] could not delete remote ${f.nameWithOwner ?? f}: ${f.error ?? ''}`);
  for (const f of sweep.failed) console.warn(`[stories] trailing sweep could not remove ${f.path}: ${f.error}`);

  // And the fence, over everything the product wrote that carries no story id.
  const fence = applyFence(
    fenceBreaches(treeBefore, readGitPorcelain(ROOT), story.id, story.ground?.project ?? null, { root: ROOT }),
    ROOT,
  );
  fence.escapes = siblingWorktreeEscapes(ROOT, siblingsBefore);
  fence.groundEscapes = siblingGroundEscapes(story.ground?.project ?? null, groundsBefore, { root: ROOT });
  // Bead `forge-8vfn.6.12` (ruling 275) — a flow save legitimately materialises
  // starter agents into the roster, so the fence names those as EXPECTED while
  // still removing them; anything else is still an escape.
  for (const line of describeFence(fence, starterAgentSlugs(ROOT))) console.log(line);
  for (const line of describeGroundEscapes(story.ground?.project ?? null, fence.groundEscapes)) console.log(line);

  // The run's own ground, judged against what the run demonstrably MINTED.
  // A run's own ground drift is the product WORKING — S10 run 5 ended
  // `731cf1401fbfb896` against a pin of `e12d66d463e094eb` because the architect
  // had just written its plan there — so the produced half is reported loudly
  // and does not fail the run. Failing on any drift at all would fail every
  // green run, and nine-green is this campaign's exit criterion: a gate that
  // cannot be passed is not a gate.
  const ownGroundDrift = { produced: [], undeclared: [] };
  if (ownGroundBefore !== null) {
    const minted = mintedSessionPaths(
      logsBefore,
      readdirSync(logsDir, { withFileTypes: true }).map((e) => e.name),
      logsDir,
    );
    const split = classifyOwnGroundDrift(
      groundChanges(ownGroundBefore, ownGroundManifest(ROOT, story.ground.project)),
      minted,
      mintedSessionWrites(minted, logsDir, join(ROOT, 'projects', story.ground.project)),
    );
    ownGroundDrift.produced = split.produced;
    ownGroundDrift.undeclared = split.undeclared;
    if (split.produced.length === 0 && split.undeclared.length === 0) {
      console.log(`[stories] own ground: unchanged — projects/${story.ground.project} is back at the hash it started from`);
    }
    for (const line of split.produced) {
      console.log(`[stories] own ground: PRODUCED ${line}`);
    }
    for (const line of split.undeclared) {
      console.error(`[stories] own ground: UNDECLARED ${line}`);
    }
  }

  // The other half of `forge-8vfn.7.5.2`. A bounded wait can always be
  // outlasted, so the report RE-READS rather than trusting itself: anything the
  // sweep or the fence removed that is back is named here. Without this, the
  // only way to learn that a removal did not stick is to look at the worktree
  // afterwards — which is how the incident was found in the first place.
  fence.reappeared = reappeared(
    [...sweep.removed, ...fence.removed],
    readGitPorcelain(ROOT).map((r) => `${r.xy} ${r.path}`),
  );
  for (const p of fence.reappeared) {
    console.warn(
      `[stories] fence: RE-APPEARED ${p} — removed by this run and present again when the report was re-read; ` +
      'a writer this run started outlived the sweep, so the REMOVED line above is a snapshot, not a final state',
    );
  }

  const result = { story, beats, reap, sweep, fence };
  writeStoryJson(result, ROOT);

  // Ruling 308's second half — the ground's Brain 3 was HELD through the fence
  // so preflight clause C4 can pass while the verdict is being read (removing
  // it made S1's own exit row unreachable). The verdict is recorded now, so the
  // trailing removal happens here rather than never.
  if ((fence.defer ?? []).length > 0) {
    const held = removePaths(fence.defer.map((p) => join(ROOT, p)));
    for (const p of held.removed) console.log(`[stories] trailing sweep removed ${relative(ROOT, p)} (held for the verdict)`);
    for (const f of held.failed) console.warn(`[stories] trailing sweep could not remove ${f.path}: ${f.error}`);
  }

  const docPath = docPathFor(story, ROOT);
  mkdirSync(dirname(docPath), { recursive: true });
  writeFileSync(docPath, renderDocFragment(result));

  regenerateGallery(ROOT);

  const row = storyRowFrom(result);
  console.log(`[stories] ${story.id}: ${row.status} — ${row.greenBeats}/${row.beats} beats green`);
  console.log(`[stories]   clip  ${join('demos', 'stories', story.id, 'story.webm')}`);
  console.log(`[stories]   doc   ${docPath.replace(`${ROOT}/`, '')}`);

  // Ruling 309(b) — an escape into a tree this run does not own reds the run
  // even when every beat is green. S1 run 5 was the reverse of this: a run that
  // wrote into the main checkout and reported `fence: clean`, because nothing
  // looked. A containment failure is not a footnote on a green verdict.
  // Ruling 340 / bead `forge-8vfn.6.11.34`: growth in a tree where ANOTHER
  // process was working is named in full and is NOT fatal — attribution by
  // time window cannot tell a concurrent lane's own writes from this run's,
  // and a funded run must not go red on a reading nobody can make.
  // A named ground in a tree this run does not own is not somewhere another
  // lane is incidentally working — it is the operator's copy of the very repo
  // this run was told to leave alone. Ruling 340's live-process softening does
  // NOT apply to it, deliberately: this is RED regardless of the beats.
  if (ownGroundDrift.undeclared.length > 0) {
    console.error(
      `[stories] ${story.id}: CONTAINMENT FAILURE — ${ownGroundDrift.undeclared.length} change(s) in ` +
      `projects/${story.ground?.project} that nothing this run minted accounts for (named above). ` +
      'The run is RED regardless of its beats.',
    );
    return 1;
  }
  if (fence.groundEscapes.length > 0) {
    console.error(
      `[stories] ${story.id}: CONTAINMENT FAILURE — projects/${story.ground?.project} CHANGED in ` +
      `${fence.groundEscapes.length} worktree(s) this run does not own (files named above). ` +
      'The run is RED regardless of its beats.',
    );
    return 1;
  }
  const unowned = unownedEscapes(fence.escapes);
  const escaped = unowned.reduce((n, e) => n + e.paths.length, 0);
  if (escaped > 0) {
    console.error(
      `[stories] ${story.id}: CONTAINMENT FAILURE — ${escaped} path(s) written into ` +
      `${unowned.length} worktree(s) this run does not own (named above). The run is RED ` +
      'regardless of its beats.',
    );
    return 1;
  }

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
