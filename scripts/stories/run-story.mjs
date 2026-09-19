/**
 * run-story.mjs — ONE story, end to end: preflight fence, browser context,
 * the beat loop, the spend ceiling, the verdict and the three artifacts.
 *
 * Split out of `run.mjs` (forge-0fli) because that file reached the 800-line
 * hard cap exactly — `check-file-size` reported `NO room left` on main, so
 * the next line anyone added to it failed CI. The seam is the FUNCTION
 * BOUNDARY and nothing inside it, for two measured reasons:
 *
 *   `spendHalt` is declared, set, read and decides the return across the
 *   body (455 / 506 / 744 / 789 in the pre-split file). C's `forge-rzrs`
 *   split of this same file cut through a span like that and left `v`
 *   unbound, which cost `forge-91cr`.
 *
 *   `writeStoryJson` RETURNS the id it wrote and `regenerateGallery`
 *   CONSUMES it (717 and 734, both inside this function since #752). Producer
 *   and consumer in one scope is the same hazard pointing the other way: a
 *   cut between them leaves not an unbound name but a silently `undefined`
 *   exempt set, which no runtime error would announce.
 *
 * So the caller passes four arguments and reads one exit code, and every
 * value either half needs stays on its own side of the call.
 *
 * `ROOT` is RE-DERIVED here rather than imported. Both files sit in
 * `scripts/stories/`, so `import.meta.url` resolves to the same repo root —
 * this is one expression evaluated twice, not a constant with two possible
 * values.
 */
import { makeAgentProcProbe, makeAgentChannelDoor, makeCycleTerminalWatch } from './beats-agent-proc.mjs';
import { readdirSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { chromium } from 'playwright-core';
import { spendGateVerdict, summariseRunSpend, effectiveCeiling } from './spend.mjs';
import { readRunEvents, hostState, collectSpendDirs, spendSoFar, finalSpendHalt } from './run-observe.mjs';
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
  sweepStoryRemotesFromManifest,
  describeRemoteSweep,
} from './sweep.mjs';
import {
  snapshotSiblingGrounds,
  siblingGroundEscapes,
  describeGroundEscapes,
  ownGroundManifest,
  mintedSessionPaths,
  mintedSessionDirNames,
  mintedSessionWrites,
  classifyOwnGroundDrift,
  groundChanges,
  groundIgnoreFromGit,
  seedIgnoredBorn,
  beatWindowChangesFrom,
} from './ground-hash.mjs';
import {
  teardownFixtureGround,
  realGroundDirs,
  snapshotRealGrounds,
  realGroundEscapes,
} from './fixture-ground.mjs';
import { captureBeatDom, captureRedEvidence, describeRedEvidence } from './red-evidence.mjs';
import { captureAndClearMintedSessions, describeGroundClear, captureAndClearMintedLogs, describeLogsClear } from './ground-clear.mjs';
import { driveBeat } from './beats-drive.mjs';
import { resolveBeatRoute } from './beats.mjs';
import { renderDocFragment, docPathFor } from './docs-fragment.mjs';
import { writeStoryJson, regenerateGallery, storyRowFrom } from './gallery.mjs';
import { collectAgentRuns, reapAgentRuns, describeReap } from './reap.mjs';
import { reappeared } from './quiesce.mjs';
import { reapCensusAndSweep } from './sweep-teardown.mjs';
import { recordReapedCancellations, reapReasonFor } from './reap-cancel.mjs';
// Needed by ROOT below, not by the moved body — the one import here that a
// scan of the body alone would have missed.
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const VIEWPORT = { width: 1600, height: 1000 };

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export async function runStory(story, uiUrl, startedMs, fundedCeilingUsd = null) {
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
  // M7-D — a FIXTURE run must never move a REAL ground: every `projects/*`
  // outside this run's own `story-<id>` namespace, in this tree and every
  // sibling worktree — `realGroundDirs`/`snapshotRealGrounds` generalise the
  // sibling-ground fence above ("every real ground THIS STORY declares") to
  // "every real ground THIS RUN DOES NOT OWN". Only a fixture run pays for it:
  // a real-ground run's own ground IS one of these dirs, so the check would
  // either double-count it or need to special-case its own ground out, and
  // `groundsBefore`/`ownGroundBefore` above already cover a real ground.
  const realBefore = story.ground?.fixture
    ? snapshotRealGrounds(realGroundDirs(ROOT, { ownProject: story.ground.project, worktrees: [...siblingsBefore.keys()] }))
    : null;
  // T1 ruling 594 — the fence above proves the ground is unchanged in every
  // OTHER worktree; nobody checked the one this run is using. Three lanes each
  // paid a run to find that gap, in three different places, and in one of them
  // the agent COMMITTED its writes so the ground's own `git status` reported
  // nothing at all (§15.327). Hence a hash, never a status.
  const ownGroundBefore = ownGroundManifest(ROOT, story.ground?.project ?? null);
  // `forge-8vfn.7.6.140` — the beat numbers any declaration actually names, so
  // the loop below hashes the ground ONLY at a boundary some licence needs it
  // (a story with no `beat:` declarations pays nothing extra), and the
  // manifest captured at each — keyed 1-indexed to match `beat: <n>`.
  const licensedBeatNumbers = new Set(
    (story.ground?.expectedChanges ?? []).map((d) => d.beat).filter((b) => typeof b === 'number'),
  );
  const groundBeatBoundaries = new Map();
  const seeded = story.ground?.seedIgnoredBorn ? seedIgnoredBorn(join(ROOT, 'projects', story.ground.project), story.ground.seedIgnoredBorn) : []; // 7.6.52 — after the pre-run hash, deliberately
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
  // 7.6.118 / T1 1089(c) — a FACTORY, not a door: the cycle watch is stateful
  // per beat, so the run hands `driveBeat` the means to build one rather than a
  // shared instance every beat would poison for the next.
  // 7.6.143: `cycleOf` names the initiative whose EXISTING cycle this beat
  // watches — the develop station continues the architect's cycle, so there is
  // no new dispatch dir for the anchor form to find. Null for every beat that
  // does not declare it, which is every beat but S10's kickoff pair.
  const cycleWatchFor = (wantState, cycleOf = null) =>
    makeCycleTerminalWatch(ROOT, wantState, cycleOf === null ? null : { cycleOf });
  // What earlier beats bound, for the routes later beats build from it. Rebuilt
  // per beat rather than mutated — a beat's verdict states what IT learned.
  let bindings = {};
  // 7.6.51/7.6.71: set when a beat boundary ends the run on money — breached, or
  // gone blind — and the verdict below is RED in the halt's own words, not a beat's.
  let spendHalt = null;
  // `forge-8vfn.7.6.76` — declared OUTSIDE the `try` below, unlike `pressedAt`:
  // `finalSpendHalt` reads it AFTER that block closes, and a Map scoped to the
  // block it is declared in would not exist by then. One Map for the whole
  // run either way — never a module-level Map (this box runs four lanes).
  const unmeasuredSnapshots = new Map();
  // M7-D — lines from `realGroundEscapes`, set only for a fixture run (see
  // `realBefore` above); read at the CONTAINMENT FAILURE checks below.
  let realGroundMoved = [];
  const costs = story.ground?.realSpawn === true || (story.ground?.budget_usd ?? 0) > 0;
  // 7.6.52: BOTH NUMBERS PRINT BEFORE A DOLLAR IS SPENT, agreeing or not. A run
  // whose funded and declared ceilings differ must say so up front rather than
  // in a post-mortem; a run whose numbers agree must say THAT, because a guard
  // that speaks only on disagreement is indistinguishable from one that never
  // compared them.
  const ceiling = costs ? effectiveCeiling(story.ground?.budget_usd, fundedCeilingUsd) : null;
  if (ceiling !== null) console.log(`[stories] ${ceiling.reason}`);
  try {
    // `forge-8vfn.27` — ONE map for the whole run, declared HERE and threaded
    // into every beat. `driveBeat`'s ninth parameter defaults to a fresh Map,
    // which is correct for the ~90 single-beat callers in the door suite and
    // WRONG for this one: a multi-beat run that lets the default fire gives each
    // beat its own empty map, so a press recorded in beat 7 is discarded when
    // that call returns and beat 8's `anchor` can never resolve it.
    //
    // MEASURED: S10 run 16 died at beat 8 with `pressed so far: none` after four
    // beats had pressed, and `git log -S'pressedAt'` on this file returned
    // nothing — the caller had never passed it in any commit. 718(1)'s anchor
    // had not worked once since the commit that introduced it.
    const pressedAt = new Map();
    for (const [i, beat] of story.beats.entries()) {
      // `forge-8vfn.7.6.140` — THE BOUNDARY WHERE A BEAT-SCOPED LICENCE OPENS,
      // captured at the moment this beat STARTS and before anything in it can
      // run. `classifyOwnGroundDrift` reduces this (via `beatWindowChangesFrom`)
      // to "what changed from here to the end of the run" — never taken twice
      // for the same beat, and never taken for a beat no declaration named.
      if (ownGroundBefore !== null && licensedBeatNumbers.has(i + 1)) {
        groundBeatBoundaries.set(i + 1, ownGroundManifest(ROOT, story.ground.project));
      }
      // Bead `forge-8vfn.6.11.22` — an agent-scale wait samples the agent's own
      // process as it polls, so an unsatisfied one says what that process was
      // doing instead of leaving it to be reconstructed afterwards by hand.
      // Built per beat from the route it is about; null for every other beat.
      const probe = makeAgentProcProbe(ROOT, resolveBeatRoute(beat, bindings).route);
      const verdict = await driveBeat(page, beat, i, uiUrl, bindings, undefined, probe, stallDoor, pressedAt, cycleWatchFor);
      bindings = { ...bindings, ...verdict.bindings };
      const frame = `frames/${String(i + 1).padStart(2, '0')}-${slug(beat.act)}.png`;
      await page.screenshot({ path: join(outDir, frame), fullPage: true });
      beats.push({ ...verdict, frame });
      // Bead `forge-8vfn.6.11.42` — what the OPERATOR could see at the red,
      // captured while the page still exists. The session dir below says what
      // the product HAD; this says what was on the screen, and S2 run 8's open
      // question is exactly the difference between the two.
      if (verdict.status !== 'green') await captureBeatDom(page, ROOT, story.id, i, beat.act, runStamp);
      // Bead `forge-8vfn.7.6.51` (ruling 788) — THE CEILING IS ENFORCED HERE,
      // at every beat boundary, because this is the only place the run is
      // between two units of work and can still be stopped cheaply.
      //
      // §15.449: until now `budget_usd` was a label. It was interpolated into
      // `spendGateVerdict`'s reason, printed in `--list`, and compared to
      // nothing — so `--approve-spend` authorised an unbounded run, and the
      // $35 on runs 12 and 13 was a number in an INTENT. The product agrees:
      // `developer-loop.ts:573` sets `costBudgetUsd: POSITIVE_INFINITY`.
      //
      // The running total is printed EVERY beat, not only on breach: a guard
      // that speaks only when it fires is indistinguishable from one that never
      // ran, which is `test-guard.mjs`'s own rule and the reason "host quiet"
      // was worth nothing without the numbers beside it.
      if (costs) {
        const { stop, lines } = spendSoFar({
          root: ROOT,
          startedMs,
          realSpawn: story.ground?.realSpawn === true,
          ceilingUsd: ceiling?.usd,
          label: `after beat ${i + 1}`,
          unmeasuredSnapshots,
        });
        for (const l of lines) console.log(l);
        if (stop.halt) { // 7.6.71 (849(d)): a BREACH stops on a number; a turn that ENDED unpriced stops because the ceiling above it went blind
          console.error(`[stories] ${stop.headline} — ${stop.reason} (${ceiling.reason}). Tearing down what this run started.`);
          spendHalt = stop;
          break;
        }
      }
      // §15.439 (ruling 769) — HOST STATE AT EVERY BEAT BOUNDARY, printed
      // whether or not anything looks wrong.
      //
      // Beat 4's nine measurements run 7m37s to 13m05s, and nobody can say why
      // the tail happens because no run ever recorded what else was on the box.
      // Three launchers checked ground hash, memory and ports and none checked
      // load; this lane wrote "host quiet" from free locks and MemAvailable
      // having never read /proc/loadavg once. A LOCK CENSUS ANSWERS "is a lane
      // between its precheck and its merge", NOT "is the box busy" — a sibling's
      // vitest holds neither campaign lock.
      //
      // Printed on every beat, not only slow ones: a number recorded only when
      // it looks bad cannot establish a baseline, and the whole difficulty with
      // the tail is that there is nothing to compare a slow beat against.
      const host = hostState();
      console.log(`[stories] host after beat ${i + 1}: loadavg ${host.load}  MemAvailable ${host.memGiB}GiB`);
      const mark = verdict.status === 'green' ? '✓' : '✗';
      // §15.415: MARK A BEAT THAT PERFORMS NOTHING. Under 504 a beat with no
      // `do` navigates and then asserts — which is right for a navigation beat
      // and a trap for a beat that MEANT to act. S7's beat 21 sat for a
      // campaign asserting the post-condition of a click it never made, because
      // a stale comment said the click was "NOT expressible"; run 3 read 21/22
      // over a binding that never happened. The verdict line said `✗ 21.` and
      // looked exactly like a beat that tried and failed.
      //
      // So the line now says which it is. A no-do beat is not wrong — most
      // navigation beats have none — but a reader deciding whether to suspect
      // the product or the story needs to know that nothing was pressed, and
      // that is the one fact the transcript never carried.
      const acted = Array.isArray(beat.do) && beat.do.length > 0;
      console.log(`  ${mark} ${i + 1}. ${beat.act}${acted ? '' : '   [no-do: navigated and asserted; nothing was pressed]'}`);
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
    // `dispatchedRuns` above is the REAP set and stays that way; the spend set
    // is a different question with a different answer (`forge-rzrs`).
    events: collectSpendDirs(ROOT, startedMs).map(readRunEvents),
  });
  console.log(`[stories] spend: ${spend.label}`);
  for (const n of spend.notes ?? []) console.log(`[stories] spend: ${n}`);
  // Bead `forge-8vfn.7.6.92` — a turn that ended after the LAST beat boundary
  // is judged here, by the same verdict the boundaries use; a halt makes the
  // run RED in its own words rather than letting it read as complete.
  if (costs) {
    const late = finalSpendHalt({
      root: ROOT, startedMs, realSpawn: story.ground?.realSpawn === true, ceilingUsd: ceiling?.usd,
      alreadyHalted: spendHalt !== null, unmeasuredSnapshots,
    });
    for (const l of late.lines) console.log(l);
    if (late.stop) {
      console.error(`[stories] ${late.stop.headline} after the last beat boundary — ${late.stop.reason} (${ceiling.reason}).`);
      spendHalt = late.stop;
    }
  }

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
  // into a ledger.
  //
  // Finding row 75 (T1 rulings 1258, 1332) — `quiesceWriters` only ever
  // PRINTED whether the tree settled, and the trailing sweep below ran
  // regardless of what it found: measured as a heartbeat written back 13s
  // after this runner printed CLEARED, a loop still committing into the
  // ground 2.7 minutes later. `reapCensusAndSweep` closes the gap: it still
  // runs `quiesceWriters` (unchanged), then takes a FRESH, post-reap census of
  // every reaped pid's descendants — `reapAgentRuns`'s own snapshot is stale
  // the instant it returns — with the same TERM-then-bounded-wait-then-KILL
  // escalation the scheduler half uses, and only a census-empty result reaches
  // `_queue/*/<id>.md.heartbeat`, `_worktrees/<id>` and this run's ground
  // `_logs/<ts>_<id>` (`sweepProductFixtures` / `captureAndClearMintedRun-
  // Artefacts`). A re-read afterwards catches a writer the census cannot see
  // — one outside this run's own dispatch tree entirely. See its header in
  // `sweep-teardown.mjs` and the doors in `sweep-teardown.test.ts`.
  const trailing = await reapCensusAndSweep({
    root: ROOT, storyId: story.id, sinceMs: startedMs,
    groundProject: story.ground?.project, evidenceDir: join(outDir, 'queue-claim'),
    reapedPids: reap.reaped.map((r) => r.pid),
    // M7-D — a FIXTURE ground is judged (the own-ground drift below, the real-
    // ground fence) BEFORE it is torn down, never removed as unconditional
    // trailing debris the way `story-<id>` fixtures otherwise are.
    ...(story.ground?.fixture ? { keepProjects: [story.ground.project] } : {}),
  });
  for (const line of trailing.lines) console.log(line); // 7.6.74: the removals AND the cycle's own queue writes, which no story-id glob reaches
  for (const line of trailing.warnLines) console.warn(line);
  // A REFUSED or PARTIALLY-HELD sweep still leaves every downstream read below
  // something to read — never `undefined.length` on the branch that has
  // nothing to report (`ownGroundDrift`'s own reasoning, echoed here).
  const sweep = trailing.sweep ?? {
    removed: [], failed: [],
    claim: { ok: true, claimed: [], left: [], unattributable: [], failed: [], lines: [] },
    artefacts: { dest: null, captured: [], cleared: [], refused: [], unremoved: [] },
    lines: [],
  };
  // Bead `forge-8vfn.6.11.29` — the OTHER half of the trailing sweep: the
  // GitHub remotes this run minted. Unreached until now, so every run that
  // minted one leaked it.
  const remotes = sweepStoryRemotesFromManifest({ storyId: story.id, root: ROOT });
  const remoteReport = describeRemoteSweep(remotes);
  for (const line of remoteReport.lines) console.log(line);
  for (const line of remoteReport.warnLines) console.warn(line);

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
  // `clear` starts as the SHAPE the clear returns, not as `null` or absent:
  // a story with no ground never runs the clear, and the verdict below reads
  // `clear.unremoved` unconditionally. An absent field there would be an
  // `undefined.length` on the no-ground path — a crash in the branch that has
  // nothing to check, which is the worst place to put one.
  const ownGroundDrift = {
    produced: [],
    undeclared: [],
    ignored: [],
    clear: { dest: null, captured: [], cleared: [], refused: [], unremoved: [], absent: [] },
  };
  if (ownGroundBefore !== null) {
    const groundDir = join(ROOT, 'projects', story.ground.project);
    const minted = mintedSessionPaths(
      logsBefore,
      readdirSync(logsDir, { withFileTypes: true }).map((e) => e.name),
      logsDir,
    );
    // Read ONCE and shared: `beatWindowChangesFrom` below needs the same
    // end-of-run manifest `groundChanges` compares against, and hashing the
    // ground a second time here would let the two readings disagree about
    // what "the end of the run" was.
    const ownGroundAfter = ownGroundManifest(ROOT, story.ground.project);
    const split = classifyOwnGroundDrift(
      groundChanges(ownGroundBefore, ownGroundAfter),
      minted,
      mintedSessionWrites(minted, logsDir, groundDir),
      groundIgnoreFromGit(groundDir),
      // 7.6.136 — the ground changes this story DECLARES its product makes,
      // read from the PINNED story file so the licence cannot widen at runtime.
      story.ground?.expectedChanges ?? [],
      // 7.6.140 — narrows a declaration that named `beat: <n>` to the window
      // from that beat's own boundary (captured live, above) to this manifest.
      beatWindowChangesFrom(groundBeatBoundaries, ownGroundAfter),
    );
    ownGroundDrift.produced = split.produced;
    ownGroundDrift.undeclared = split.undeclared;
    ownGroundDrift.ignored = split.ignored;
    ownGroundDrift.declared = split.declared;
    ownGroundDrift.unmatchedDeclarations = split.unmatchedDeclarations;
    if (split.produced.length === 0 && split.undeclared.length === 0 && split.ignored.length === 0) {
      console.log(`[stories] own ground: unchanged — projects/${story.ground.project} is back at the hash it started from`);
    }
    for (const line of split.produced) {
      console.log(`[stories] own ground: PRODUCED ${line}`);
    }
    // UNCONDITIONAL, EVEN AT ZERO, and always naming the rule that produced the
    // number. `0 ignored-born` and "no ignore check ran" must never render the
    // same line — that is `forge-e8dn`, and C's run 12 printed a `0` from
    // `ls <a path that has never existed>` which reached the ledger as a
    // measurement. The count is the ground's OWN toolchain output: S1 run 8 read
    // 4500 of these as containment failures because method C prunes only
    // `node_modules` and `.git`.
    console.log(
      `[stories] own ground: IGNORED-BY-GROUND ${split.ignored.length} path(s) — ` +
      `unattributed and ignored by ${split.ignoreSource}; reported, never red`,
    );
    for (const line of split.ignored) {
      console.log(`[stories] own ground: ignored-born ${line}`);
    }
    for (const line of split.declared) {
      console.log(`[stories] own ground: DECLARED ${line}`);
    }
    // A declaration that matched nothing is NAMED, never dropped — §15.539's
    // dead glob in another costume: a licence that cannot match cannot fail,
    // and would sit in the pinned story describing a behaviour that has changed.
    for (const line of split.unmatchedDeclarations) {
      console.error(`[stories] own ground: DECLARATION UNMATCHED ${line}`);
    }
    for (const line of split.undeclared) {
      console.error(`[stories] own ground: UNDECLARED ${line}`);
    }
    for (const rel of seeded) rmSync(join(ROOT, 'projects', story.ground.project, rel), { force: true }); // 7.6.52 — next run seeds fresh

    // `forge-8vfn.7.6.123` — THE PRODUCED LIST NOW REACHES SOMETHING.
    //
    // Everything above already knew: `groundManifest` walks the filesystem so
    // it sees gitignored content, and `classifyOwnGroundDrift` already names
    // each minted session. It stopped at the `PRODUCED` lines, so
    // `projects/gitpulse/_architect/<ts>/` survived porcelain (gitignored
    // inside the ground), `residue.sh` (git's view) and the ground fence, and
    // the NEXT run's launcher refused on the ground hash. Five times.
    //
    // C's run 18 leaked TWO things and `residue.sh` caught exactly one:
    // `_worktrees/INIT-…` (a NAMED LOCATION it counts with `ls`) and the
    // ground's `_architect/<ts>/` (walked through git, so invisible). Same
    // instrument, same run, opposite outcomes.
    ownGroundDrift.clear = captureAndClearMintedSessions({
      root: ROOT,
      project: story.ground.project,
      storyId: story.id,
      runStamp,
      producedPaths: split.producedPaths,
    });
    for (const line of describeGroundClear(ownGroundDrift.clear, story.ground.project)) {
      console.log(`[stories] ${line}`);
    }
    // THE HASH IS RE-READ, not inferred from the removals. The digest is the
    // number the next run's launcher will refuse on, so it is the only reading
    // that settles whether this worked.
    if (ownGroundDrift.clear.cleared.length > 0) {
      const after = ownGroundManifest(ROOT, story.ground.project);
      if (after !== null && after.digest === ownGroundBefore.digest) {
        console.log(
          `[stories] own ground: RESTORED ${after.digest} — projects/${story.ground.project} is byte-identical ` +
          'to the hash it started from, so the next run starts on the ground it was pinned at',
        );
      } else {
        // NOT RED on its own. A develop run that legitimately commits into its
        // ground moves this digest, and failing here would fail every real run
        // — ruling 594's "a gate that cannot be passed is not a gate", quoted
        // in `ground-hash.mjs` for this same reason. What IS red is a minted
        // dir surviving the clear, checked at the verdict below.
        const still = groundChanges(ownGroundBefore, after);
        console.log(
          `[stories] own ground: STILL DIFFERS ${after?.digest ?? 'UNREADABLE'} vs ${ownGroundBefore.digest} — ` +
          `+${still.added.length} -${still.removed.length} ~${still.modified.length} remain after the clear; ` +
          'reported, and red only if one of them is a minted session dir',
        );
      }
    }
  }

  // M7-D — THE REAL-GROUND FENCE, and THE TEARDOWN. Both only for a fixture
  // run (`realBefore` is null otherwise), and both AFTER the own-ground block
  // above, because that block still needs `projects/<project>` — the fixture
  // ground — on disk to read its own drift.
  if (realBefore !== null) {
    const dirs = realGroundDirs(ROOT, { ownProject: story.ground.project, worktrees: [...siblingsBefore.keys()] });
    const realAfter = snapshotRealGrounds(dirs);
    realGroundMoved = realGroundEscapes(realBefore, realAfter);
    for (const line of realGroundMoved) console.error(`[stories] REAL GROUND MOVED ${line}`);
    // ALWAYS printed, even at zero — `forge-e8dn`'s own rule: a count that
    // prints only when it is bad is indistinguishable from a check that never
    // ran, and this is the one line that proves the fence looked at all.
    console.log(
      `[stories] real grounds: ${dirs.length} hashed in ${1 + siblingsBefore.size} tree(s), ${realGroundMoved.length} moved`,
    );

    // LAST: the fixture ground itself. `sweepProductFixtures` above kept it
    // (`keepProjects`) so the own-ground drift and this fence could both read
    // it; nothing after this point needs `projects/<project>` on disk.
    const teardown = teardownFixtureGround(ROOT, { storyId: story.id, project: story.ground.project });
    if (teardown.removed) {
      console.log(`[stories] fixture ground: torn down projects/${story.ground.project}`);
    } else if (teardown.error !== undefined) {
      console.warn(
        `[stories] fixture ground: could not tear down projects/${story.ground.project}: ${teardown.error} — ` +
        'the next leading sweep removes it',
      );
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
  const wroteThisRun = [writeStoryJson(result, ROOT)];

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

  // 7.6.81 — exempt set = what writeStoryJson RETURNED (see its doc for why).
  regenerateGallery(ROOT, wroteThisRun);

  const row = storyRowFrom(result);
  console.log(`[stories] ${story.id}: ${row.status} — ${row.greenBeats}/${row.beats} beats green`);
  // 7.6.51: a breach is RED on its own terms and must not be read off the beat
  // score. A run stopped at beat 8 of 23 for spending its ceiling has a beat
  // count that looks like an ordinary red, and the two are different facts —
  // one says the product failed, the other says we stopped paying. The line
  // below is printed AFTER the score so both are on the record, and the exit
  // code is non-zero whatever the beats did.
  if (spendHalt !== null) {
    console.error(`[stories] ${story.id}: RED — ${spendHalt.reason}. ${spendHalt.note}`);
  }
  // `forge-8vfn.7.6.137` — THE `_logs` HALF, and it runs for EVERY story, not
  // only one with a ground: a costless story mints sessions too, and its
  // leavings refuse the next run's residue door just as surely.
  //
  // Measured cost of not doing this: S9 run 7's `_agent-*` blocked run 8, and
  // run 8's blocked S3 run 3. Both refusals were correct and cost $0 — and both
  // were paid off by a hand capture-then-clear the product never did.
  const mintedLogNames = mintedSessionDirNames(
    logsBefore,
    readdirSync(logsDir, { withFileTypes: true }).map((e) => e.name),
    logsDir,
  );
  const logsClear = captureAndClearMintedLogs({ root: ROOT, storyId: story.id, runStamp, mintedNames: mintedLogNames });
  for (const line of describeLogsClear(logsClear)) console.log(`[stories] ${line}`);

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

  // `forge-8vfn.7.6.139` — A DECLARATION THAT MATCHED NOTHING IS RED, not a note.
  //
  // 7.6.136 reported it and stayed green, which is §15.539's dead glob exactly:
  // a licence that cannot match cannot fail, so it stops protecting and stops
  // complaining in the same instant, and nothing distinguishes a live
  // declaration from a fossil.
  //
  // THIS IS ONLY UNAMBIGUOUS BECAUSE THE PREMISE IS CHECKED AT THE START. Until
  // `groundPinVerdict` moved into the runner, "unmatched because the product
  // stopped doing what the story says" and "unmatched because the ground was
  // already migrated" were one state — and reddening both would have failed
  // every idempotent re-run. The start-of-run refusal makes the second
  // unreachable, so what is left here is the first, and it deserves a red.
  if ((ownGroundDrift.unmatchedDeclarations ?? []).length > 0) {
    console.error(
      `[stories] ${story.id}: DECLARATION UNMATCHED — ${ownGroundDrift.unmatchedDeclarations.length} ` +
      `ground change(s) this story DECLARES its product makes did not happen (named above). The ground was ` +
      'at its declared pin when this run started, so the product stopped doing what the story says — or the ' +
      'story still describes behaviour that has since changed. The run is RED regardless of its beats.',
    );
    return 1;
  }
  // `forge-8vfn.7.6.123`. THE NARROW GATE, and the narrowness is the point.
  //
  // Red when a session THIS RUN MINTED is still in the ground after the clear
  // captured it and removed it. That is a removal that did not take — the same
  // failure `fence.reappeared` exists for — and it is always achievable to
  // avoid, so it is a gate that can be passed.
  //
  // What this deliberately does NOT do is red on "the ground hash moved". A
  // develop run that commits into its ground moves that hash as its actual
  // product, and failing on it would fail every real run: ruling 594, and its
  // own words, "a gate that cannot be passed is not a gate". The drift is
  // reported either way; only the survival of a minted dir is fatal.
  if (ownGroundDrift.clear.unremoved.length > 0) {
    console.error(
      `[stories] ${story.id}: CONTAINMENT FAILURE — ${ownGroundDrift.clear.unremoved.length} session(s) this run ` +
      `minted are STILL in projects/${story.ground?.project} after being captured and removed ` +
      `(${ownGroundDrift.clear.unremoved.join(', ')}). The next run will refuse on the ground hash. ` +
      'The run is RED regardless of its beats.',
    );
    return 1;
  }
  // Finding row 75 (T1 rulings 1258, 1332) — a census that never settled means
  // the trailing sweep above was REFUSED, not merely skipped: something this
  // run dispatched was still alive and this run cannot say it is not still
  // writing into `_queue/`, `_worktrees/` or this run's own ground. Silence
  // here is exactly the failure this census exists to close, so it is fatal
  // rather than a note.
  if (!trailing.census.empty) {
    console.error(
      `[stories] ${story.id}: CONTAINMENT FAILURE — the trailing sweep was refused: ${trailing.census.reason} ` +
      '(named above). The run is RED regardless of its beats.',
    );
    return 1;
  }
  // The re-read half of the same finding: a writer OUTSIDE the census — no
  // ancestry through anything this run dispatched — recreated a path the
  // sweep reported CLEARED. Never a silent CLEARED for a path that came back.
  if (trailing.reappearedArtefacts.length > 0) {
    console.error(
      `[stories] ${story.id}: CONTAINMENT FAILURE — ${trailing.reappearedArtefacts.length} artefact(s) this ` +
      `run's trailing sweep cleared reappeared after being re-read (${trailing.reappearedArtefacts.join(', ')}, ` +
      'named above). The run is RED regardless of its beats.',
    );
    return 1;
  }
  // T1 ruling 1332 — `fence.reappeared` NAMED a removal that did not stick and
  // stopped there; "never a silent CLEARED" is a sentence printed, not
  // enforced, until it also ends the run.
  if (fence.reappeared.length > 0) {
    console.error(
      `[stories] ${story.id}: CONTAINMENT FAILURE — ${fence.reappeared.length} path(s) this run removed ` +
      `reappeared when re-read (${fence.reappeared.join(', ')}, named above). The run is RED regardless of ` +
      'its beats.',
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
  // M7-D — a FIXTURE run must never move a REAL ground. `realGroundMoved` is
  // `[]` for a non-fixture story (`realBefore` was never computed), so this
  // check is inert everywhere it does not apply.
  if (realGroundMoved.length > 0) {
    console.error(
      `[stories] ${story.id}: CONTAINMENT FAILURE — ${realGroundMoved.length} real ground(s) moved during ` +
      'this fixture run (named above as REAL GROUND MOVED). The run is RED regardless of its beats.',
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

  return (row.status === 'green' && spendHalt === null) ? 0 : 1;
}

