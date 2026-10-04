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
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadStory, assertNonEmptySelection } from './story-file.mjs';
import { stampEveryLine } from './log-stamp.mjs';
import { spendGateVerdict, effectiveCeiling } from './spend.mjs';
import { spawnSync } from 'node:child_process';
import {
  memoryVerdict,
  readAvailableMb,
  acquireHostLock,
  foreignSessionVerdict,
  remoteSwitchVerdict,
  queueStateVerdict,
  declaredCommitsVerdict,
  groundPinVerdicts,
} from './preflight.mjs';
import { ownGroundManifest } from './ground-hash.mjs';
import { suiteLockVerdict, lockOrderVerdict, EXIT_LOCK_REFUSED } from './lock-guard.mjs';
import { sweepStoryResidue } from './sweep.mjs';
import { sweepCycleArtefacts } from './sweep-cycle-artefacts.mjs';
import { captureAndClearBornLogDirs, describeBornLogDirsClear } from './sweep-post-stop-logs.mjs';
import { provisionFixtureGrounds, teardownFixtureGround } from './fixture-ground.mjs';
import { captureAndSweepAgentLogs } from './sweep-agent-logs.mjs';
import { restoreSweptCommitted, stopStudioThenScheduler, teardownExitCode } from './sweep-teardown.mjs';
import { preexistingSchedulerVerdict } from './scheduler-preflight.mjs';
import { clearRunHalt, preexistingHaltVerdict } from './halt-record.mjs';
import {
  decideStoryBridge,
  readProcCwd,
  refusalError,
  bootOwnBridge,
  bridgeSpawnOptions,
} from './bridge.mjs';
import { collectAgentRuns, reapAgentRuns, describeReap } from './reap.mjs';
import { recordReapedCancellations } from './reap-cancel.mjs';
// Defect B fold, row 184b (forge-8vfn.8.5.21) — the SIGINT/SIGTERM path's own
// version of the own-ground clear `run-story.mjs` already runs at the end of
// every story IT reaches; see that module's header for why a signal needs a
// second copy rather than reusing `runStory`'s internal one.
import { captureAndClearMintedSessionsSince } from './ground-abort-clear.mjs';
import { runStopPath } from './stop-path.mjs';
import { mintedSessionDirNames } from './ground-minted.mjs';
import { captureAndClearMintedLogs, describeLogsClear, describeGroundClear } from './ground-clear.mjs';
import { loadRegisteredSessionKindIds } from './session-kind-registry.mjs';
// The beat loop and everything one story needs lives in `run-story.mjs`
// (forge-0fli). This file keeps argument parsing, the preflight fence, the
// bridge decision and the per-story loop; the call below is the only seam.
import { runStory } from './run-story.mjs';

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
    // 7.6.52 (ruling 791): what the OPERATOR funded for this run, which is a
    // different fact from what the story declares. D's S7 run 4 declared $25
    // and was funded $5; enforcing the story's figure alone would have allowed
    // five times what anyone authorised and called it compliant.
    // Present-but-unusable REFUSES rather than falling back. A first draft
    // returned NaN here, and `effectiveCeiling` then reported "the launcher
    // named no --ceiling" — FALSE, and it silently restored the higher declared
    // figure. An operator who typed `--ceiling` and fat-fingered the value
    // would have been told a number they did not choose was in force.
    ceilingUsd: at('--ceiling') === -1 ? null : Number(argv[at('--ceiling') + 1]),
    ceilingGiven: at('--ceiling') !== -1,
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

  // ROW 146 (`forge-8vfn.8.1.52`, ruling 1911) — a SIGTERM/SIGINT to this
  // run's own process group (an operator stop) skips the `finally` block at
  // the bottom of this function entirely: with no listener installed, Node
  // terminates on either signal before a single pending `finally` runs
  // (`sweep.mjs`'s own header states this). S10 run 43 measured exactly
  // that — its own-artefacts clear never ran, so `_logs/<ts>_INIT-*` and
  // `_queue/done/INIT-*.md` survived, and the NEXT run's residue guard
  // (`.claude/skills/tiered-orchestration/scripts/residue.sh`) refused to
  // launch on them.
  //
  // Registering a handler is what gives a STOPPED run the chance to clear
  // its own `_queue/*`, `_worktrees` and `_logs/<ts>_INIT-*` before it
  // actually exits — `sweepCycleArtefacts` is the exact same claim-then-clear
  // `sweepProductFixtures` already runs at a green finish, over exactly the
  // targets the residue guard gates on, never a second copy of it. Scoped to
  // `startedMs`, the same born-within-this-run window every other reader of
  // this run's own artefacts uses (`collectAgentRuns`, `claimQueueWrites`),
  // so a stop can only ever claim what THIS run created.
  //
  // Deliberately narrower than the trailing sweep: it does not touch
  // `productFixturePathsFor` (`demos/stories/<id>`, a fixture ground and the
  // like) — a stopped run keeps those for evidence exactly as a crash does,
  // same as `sweepProductFixtures` already keeps a fixture ground standing
  // until its own teardown call, and the residue guard never gates on them.
  //
  // `residue.sh` also gates `_logs/_agent-*` and `_logs/_authoring-*`
  // (lines 68-69) — a stopped run strands a Studio agent or authoring
  // session exactly as it strands the queue/worktree/cycle-dir targets
  // above, so `captureAndClearBornLogDirs` clears those two families too,
  // over the SAME `startedMs` birth-time window and never a story name or a
  // ground-manifest diff (`sweep-post-stop-logs.mjs`'s own header).
  //
  // `once`, not `on`: a second signal while the sweep is already running
  // must not re-enter it and race its own capture-then-remove.
  //
  // ROW 166 follow-up (bead `forge-8vfn.8.1.60`) — `schedulerAlive: false`,
  // EXPLICIT below, never defaulted: `sweepCycleArtefacts`'s own header
  // requires every caller to state this rather than inherit a default. At a
  // stop, the SIGNAL THAT REACHED THIS HANDLER is what is killing the
  // scheduler this run may have started, in the SAME process group being
  // torn down here — so by the time this sweep runs, that daemon is not a
  // live writer to defer to. Claiming what it left behind IS this sweep's
  // job, not a race with it.
  let stopping = false;
  // Declared here, ahead of the listener below, rather than at their natural
  // call sites further down the function: a SIGTERM/SIGINT can in principle
  // arrive before `main()` reaches those lines, and a `let` the closure below
  // reads before ITS OWN declaration has run throws (TDZ) instead of the
  // handler actually running.
  let bridgeProc = null;
  // The in-progress story's own ground snapshot, so a signal mid-story can
  // still capture + clear what it minted before exit — Defect B, row 184b
  // fold (forge-8vfn.8.5.21). `null` whenever no story has started yet, the
  // started story declares no ground project, or its OWN `runStory` already
  // reached its own teardown (every path through that function clears this
  // the instant it starts, exactly where the per-story loop below sets it).
  let inProgressGround = null;
  const onStopSignal = (signal) => {
    if (stopping) return;
    stopping = true;
    const runStamp = new Date(startedMs).toISOString().replace(/[:.]/g, '-');
    const evidenceDir = join(ROOT, '_logs', '_story-post-stop-sweep', 'stopped-run', runStamp);
    console.log(`[stories] received ${signal} — running the post-stop sweep before exit`);
    // Row 187 (forge-8vfn.8.5.23) — `runStopPath` (`stop-path.mjs`) signals
    // the bridge's group, REAPS this run's detached agent turns, and waits
    // (bounded) for the bridge to exit, all BEFORE `clear` below captures and
    // clears anything: a turn left running wrote into the real ground minutes
    // after this path had finished. `clear` is the post-stop sweep as before.
    const clear = () => {
      // Row 213 (forge-8vfn.8.5.49) — the root-relative paths THIS sweep
      // reported cleared, handed back to `runStopPath` so its own re-read can
      // confirm a writer this path failed to reap did not rewrite one of them
      // (`_queue/in-flight/<id>.md.heartbeat`, `_worktrees/wi/<id>`, …) after
      // the sweep declared the tree clear. `sweepCycleArtefacts` is the ONE
      // call whose own `artefacts.cleared` is already root-relative and is
      // exactly the shape row 213 measured a leaked scheduler rewriting.
      let cleared = [];
      try {
        const swept = sweepCycleArtefacts('stopped-run', ROOT, {
          sinceMs: startedMs, evidenceDir, schedulerAlive: false,
        });
        for (const line of swept.lines) console.log(`[stories] post-stop sweep: ${line}`);
        cleared = swept.artefacts.cleared;
      } catch (err) {
        console.error(`[stories] post-stop sweep failed: ${err?.message ?? err}`);
      }
      // The emergency halt this run may have pulled (halt-record.mjs): studio
      // and serve are already gone here, so clearing it cannot let a claim in.
      for (const line of clearRunHalt(ROOT).lines) console.log(`[stories] post-stop sweep: ${line}`);
      try {
        const bornLogs = captureAndClearBornLogDirs(ROOT, {
          prefixes: ['_agent-', '_authoring-'], sinceMs: startedMs, evidenceDir,
        });
        for (const line of describeBornLogDirsClear(bornLogs)) {
          console.log(`[stories] post-stop sweep: ${line}`);
        }
      } catch (err) {
        console.error(`[stories] post-stop sweep (agent/authoring logs) failed: ${err?.message ?? err}`);
      }
      // Defect B fold, row 184b — the IN-PROGRESS story's own minted sessions,
      // captured and cleared exactly as `run-story.mjs` already does at the end
      // of every story it reaches ("own ground: CAPTURED … CLEARED …"). A
      // signal skips that function entirely, so without this a minted session
      // (an architect's `_architect/<sid>/…`) survived in the REAL ground,
      // moving its method-C hash off the pin the next run's launcher checks.
      if (inProgressGround !== null) {
        try {
          const logsDir = join(ROOT, '_logs');
          const groundAfter = ownGroundManifest(ROOT, inProgressGround.project);
          let logsAfter = [];
          try {
            logsAfter = readdirSync(logsDir, { withFileTypes: true }).map((e) => e.name);
          } catch (err) {
            console.error(`[stories] post-stop sweep (own ground) could not read ${logsDir}: ${err?.message ?? err}`);
          }
          const groundClear = captureAndClearMintedSessionsSince({
            root: ROOT,
            project: inProgressGround.project,
            storyId: inProgressGround.storyId,
            runStamp,
            groundBefore: inProgressGround.groundBefore,
            groundAfter,
            logsBefore: inProgressGround.logsBefore,
            logsAfter,
            logsDir,
            registeredKindIds: loadRegisteredSessionKindIds(ROOT),
          });
          for (const line of describeGroundClear(groundClear, inProgressGround.project)) {
            console.log(`[stories] post-stop sweep: ${line}`);
          }
          const mintedLogNames = mintedSessionDirNames(inProgressGround.logsBefore, logsAfter, logsDir);
          const logsClear = captureAndClearMintedLogs({
            root: ROOT, storyId: inProgressGround.storyId, runStamp, mintedNames: mintedLogNames,
          });
          for (const line of describeLogsClear(logsClear)) {
            console.log(`[stories] post-stop sweep: ${line}`);
          }
        } catch (err) {
          console.error(`[stories] post-stop sweep (own ground) failed: ${err?.message ?? err}`);
        }
      }
      return { cleared };
    };
    runStopPath({ root: ROOT, startedMs, bridgeProc, clear })
      .catch((err) => console.error(`[stories] post-stop path failed: ${err?.message ?? err}`))
      .finally(() => process.exit(signal === 'SIGINT' ? 130 : 143)); // 128+signum, the conventional signal exit code
  };
  process.once('SIGTERM', () => onStopSignal('SIGTERM'));
  process.once('SIGINT', () => onStopSignal('SIGINT'));

  // 0. THE TWO CHECKOUT-OVERLAP LOCKS — moved ahead of even loading a story
  //    file (M7-COMMON §6.16, `lock-guard.test.ts`'s "DOOR: a story run
  //    refuses BEFORE booting a bridge"). These used to sit beside the other
  //    preflight refusals below, after `--story` had already been resolved
  //    against the real story files on disk. That let a DOOR test asserting
  //    "refuses before a bridge boots" only be driven with a REAL, resolvable
  //    story id — S8's real ground — so a broken guard did not stop at the
  //    lock check, it fell through everything below (spend gate, sweep,
  //    fixture-ground provisioning, a REAL bridge boot with a real registry
  //    refresh against GitHub) before anything else had a chance to refuse.
  //    Measured: exactly that happened once, live.
  //
  //    Moved here, both locks are checked before this process has read a
  //    single story file, so a test that probes with an id that can never
  //    resolve (`__guard_probe__`) is hermetic REGARDLESS of whether the
  //    guard is working: a working guard refuses right here with its own
  //    named line; a broken one falls through to the ordinary
  //    `--story "__guard_probe__" matched nothing` throw a few lines down —
  //    still before any spend gate, sweep, or bridge — and the two are
  //    distinguishable by which message actually printed, so the DOOR test
  //    still reds when the guard itself does not refuse.
  //
  //    Bead `forge-8vfn.7.6.13` (ruling 634): a full test suite writes into
  //    `projects/`, the directory a story run hashes before and after to
  //    prove its ground did not drift; the two took different locks and so
  //    overlapped by construction. Refused first, before anything else in
  //    this run touches disk, and it never sleeps — the lane's own Monitor is
  //    what waits (§15.335).
  //    `--list` is exempt (T1 1549): the door guards story EXECUTION, not
  //    enumeration. It loads story files and prints them — no spawn, no port,
  //    no write — and T1 and the lanes enumerate while a run holds the locks.
  //    Every path that executes a story, costless included, is still checked
  //    here first.
  if (!args.list) {
    const overlap = suiteLockVerdict();
    console.log(`[stories] ${overlap.reason}`);
    if (!overlap.ok) return 1;

    // 0b. THE ORDER ITSELF — finding row 73 (2026-09-19). A launcher that holds
    //     the run-lock (by ancestry) without ALSO holding the suite-lock is
    //     exactly the shape that can be waiting for the suite-lock while
    //     holding the run-lock — the reverse of `with-locks.sh`'s ratified order
    //     and the deadlock this bead exists to close. Checked here, before any
    //     spawn, port bind, or story resolution, with the runner's own
    //     lock-refusal exit code (75) so a refusal is never read as a suite
    //     that ran and went red.
    const order = lockOrderVerdict();
    console.log(`[stories] ${order.reason}`);
    if (!order.ok) return EXIT_LOCK_REFUSED;
  }

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

  // 1b-ii. The tree this run will actually execute — T1 ruling 753 (§15.430,
  //     §15.432). Two checks, both learned from run 12, which passed every
  //     precondition it had and still measured the wrong thing.
  //
  //     The QUEUE must exist and be empty. Run 12's "ready-for-review empty"
  //     came from `ls <path that has never existed> | wc -l` -> 0 and reached
  //     the ledger as a measurement; an absent path must never read as a clean
  //     one. Residue there is worse than noise — it can satisfy a beat's
  //     assertion before the run does anything.
  //
  //     The DECLARED COMMITS must be in THIS tree. Run 12's INTENT named the
  //     live-refresh fix "on main"; it was, and the run executed a branch forked
  //     before it, so $2.91 measured the behaviour the fix replaces. `main` is
  //     not what runs. Declaring nothing refuses; `none` is the stated escape.
  for (const s of stories) {
    if (!(s.ground.realSpawn || s.ground.budget_usd > 0)) continue;
    const q = queueStateVerdict(ROOT);
    if (!q.ok) {
      console.error(`[stories] REFUSING ${s.id}: ${q.reason}`);
      return 1;
    }
    console.log(`[stories] queue ok — ${q.reason}`);
    break;
  }
  // 1b-iii. THE GROUND IS AT THE HASH THE CALLER DECLARED — `forge-8vfn.7.6.139`.
  //
  //     Here, beside the other costed-run preconditions, because the point is to
  //     refuse BEFORE the money and before the browser opens. Until this moved
  //     into the runner it lived only in each lane's own launcher — and a
  //     precondition that lives in a launcher does not exist for anyone who
  //     starts the run another way. The cost was that a declaration going
  //     unmatched because the PRODUCT stopped and one going unmatched because
  //     the GROUND WAS ALREADY MIGRATED were a single green state.
  //
  //     Row 171 (forge-8vfn.8.5.7): each real ground reads its own
  //     `FORGE_GROUND_PIN_<project>`; the bare form is refused for a run with
  //     more than one costed story, and a story-minted ground never consults one.
  const pins = groundPinVerdicts(stories, {
    env: process.env,
    measure: (project) => ownGroundManifest(ROOT, project)?.digest ?? null,
  });
  if (!pins.ok) {
    console.error(`[stories] REFUSING ${pins.reason}`);
    return 1;
  }
  for (const v of pins.verdicts) console.log(`[stories] ground pin ok — ${v.id}: ${v.reason}`);

  if (stories.some((s) => s.ground.realSpawn || s.ground.budget_usd > 0)) {
    const declared = (process.env.FORGE_STORY_REQUIRES ?? '').split(',').map((c) => c.trim()).filter(Boolean);
    const req = declaredCommitsVerdict(declared, (sha) => {
      const r = spawnSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: ROOT });
      return r.status === 0;
    });
    if (!req.ok) {
      console.error(`[stories] REFUSING: ${req.reason}`);
      return 1;
    }
    console.log(`[stories] tree ok — ${req.reason}`);
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
  // 7.6.52: a `--ceiling` that was GIVEN but does not parse is a malformed
  // authorisation, not an absent one. Refusing is the only safe reading — the
  // alternative restores the story's own, higher figure under a message that
  // says the launcher named nothing.
  if (args.ceilingGiven && !(Number.isFinite(args.ceilingUsd) && args.ceilingUsd >= 0)) {
    console.error(`[stories] REFUSING: --ceiling was given as ${JSON.stringify(process.argv[process.argv.indexOf('--ceiling') + 1])}, which is not a usable dollar amount. Nothing was run.`);
    return 1;
  }

  const remote = remoteSwitchVerdict(ROOT, stories.map((s) => s.id));
  if (!remote.ok) {
    console.error(`[stories] REFUSING: ${remote.reason}`);
    return 1;
  }
  console.log(`[stories] remote switch ok — ${remote.reason}`);

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

  // `bridgeProc` is declared ahead of the SIGINT/SIGTERM listener, above.
  let exitCode = 0;
  // What the leading sweep removed, so the teardown can put back anything the
  // run never regenerated (T1 ruling 594, half 2).
  const sweptPaths = [];
  // The grounds `provisionFixtureGrounds` provisioned in THIS call.
  // `runStory` tears down its own ground on every path it reaches, but a
  // bridge refusal or throw before a later story's turn — or a throw inside
  // an EARLIER story's own run — would otherwise leave an already-provisioned
  // ground standing; declared outside the `try` so the abort backstop in
  // `finally` can always see it.
  let provisionedGrounds = [];
  // Which of `provisionedGrounds`' stories actually STARTED. A story that
  // started and then crashed
  // mid-beats keeps its ground for evidence; only a ground whose story was
  // NEVER ENTERED is the backstop's to remove. Written immediately before
  // `runStory` is awaited (see the loop below) so there is no gap between
  // "marked started" and "actually starting" a crash could hide inside.
  const startedStoryIds = new Set();
  // The ids every story in THIS INVOCATION has written so far —
  // `forge-8vfn.8.5.17` (row 181, measured twice). ONE array for the whole
  // batch: `runStory` mutates it (push, never replace) as each story writes
  // its own `story.json`, so the NEXT story's own gallery regen
  // (`regenerateGalleryForRun`, gallery.mjs) recognises every earlier
  // story's still-untracked artefacts as something THIS RUN produced,
  // rather than reading them as a foreign leftover and refusing — the shape
  // that used to throw out of `runStory` and abort every story still queued
  // in the loop below.
  const writtenThisRun = [];
  try {
    // 4. Leading sweep, before the bridge, so a run cannot inherit dead state.
    for (const s of stories) {
      const { removed, failed } = sweepStoryResidue(s.id, ROOT);
      sweptPaths.push(...removed);
      for (const p of removed) console.log(`[stories] leading sweep removed ${p}`);
      for (const f of failed) console.warn(`[stories] leading sweep could not remove ${f.path}: ${f.error}`);
      // `forge-8vfn.7.6.24` — the agent log dirs a PREVIOUS run of this story
      // left. Captured before removal, and LEADING ONLY: nothing here can belong
      // to this run, because the run has not started. Stamped so two runs'
      // captures can never read as one (`redEvidenceDir`'s own lesson).
      const sweepStamp = new Date().toISOString().replace(/[:.]/g, '-');
      const agentLogs = captureAndSweepAgentLogs(s.id, ROOT, sweepStamp);
      for (const p of agentLogs.removed) {
        console.log(`[stories] leading sweep captured and removed ${p} — a previous run's dispatch log; ` +
          'left in place it inflates this run\'s ledger count and can turn a red beat green');
      }
      for (const f of agentLogs.failed) {
        console.warn(`[stories] leading sweep could not clear ${f.path}: ${f.error} — the residue STAYS, ` +
          'because losing the bytes is worse than carrying it one more run');
      }
    }

    // 4b. Fixture grounds — AFTER the leading sweep (provisioning before it
    //     would have the sweep remove the ground it just wrote) and BEFORE the
    //     bridge identity probe (a beat can drive the browser to a fixture
    //     ground only once it exists, and provisioning after the bridge is up
    //     would race a driven browser against a `git init` still in flight).
    //     A refusal here writes nothing FOR THE WHOLE BATCH
    //     (`provisionFixtureGrounds`'s own contract) and must
    //     cost nothing either: it stops the run before any story's beats,
    //     same as every other preflight refusal above. ONE call for every
    //     story, not a loop over the singular: a loop has no batch-level
    //     rollback, so a LATER story's refusal left every EARLIER story's
    //     ground standing.
    const provisionResult = provisionFixtureGrounds(ROOT, stories);
    provisionedGrounds = provisionResult.provisioned;
    for (const p of provisionResult.provisioned) {
      const fixture = stories.find((s) => s.id === p.storyId)?.ground?.fixture;
      console.log(
        `[stories] fixture ground: provisioned projects/${p.project} from ` +
        `tests/stories/grounds/${fixture}/seed — digest ${p.digest}, commit ${p.commit}`,
      );
    }
    if (provisionResult.refused !== null) {
      console.error(`[stories] REFUSING ${provisionResult.refused.storyId}: ${provisionResult.refused.message}`);
      exitCode = 1;
      // A rollback `provisionFixtureGrounds` could not finish is named, not
      // left for someone to notice by its absence.
      for (const f of provisionResult.rollbackFailures) {
        console.warn(
          `[stories] fixture ground: could not roll back projects/${f.project}: ${f.error} — ` +
          'the leading sweep of the next run that includes its story removes it',
        );
      }
    }

    // 4b. `forge-8vfn.8.1.6` (T1 row 6) — the SAME combination rule
    //     `runStory` applies per beat (`effectiveCeiling`), reused rather than
    //     re-derived, so the bridge's own env agrees with the beat-boundary
    //     check it backstops: a cycle the bridge starts can now halt INSIDE a
    //     beat, not only when the runner notices between two of them.
    //     `bootOwnBridge` boots ONE bridge process for the WHOLE batch below,
    //     so a batch mixing several costed stories takes the STRICTEST of
    //     their effective ceilings — one shared process must not let a laxer
    //     sibling widen a stricter one's bound. `null` when nothing in this
    //     batch spends: `effectiveCeiling` is never asked for a story that
    //     never asked for money.
    const costedCeilings = stories
      .filter((s) => s.ground.realSpawn === true || (s.ground.budget_usd ?? 0) > 0)
      .map((s) => effectiveCeiling(s.ground.budget_usd, args.ceilingUsd).usd)
      .filter((usd) => Number.isFinite(usd));
    const bridgeCeilingUsd = costedCeilings.length > 0 ? Math.min(...costedCeilings) : null;

    // 4c. `forge-8vfn.8.1.6` follow-up — the `forge studio` this run boots
    //     supervises `forge serve`, and a studio that finds a live serve pid
    //     ADOPTS it instead of spawning one (`apps/forge/serve-supervisor.ts`).
    //     An adopted serve keeps its own env: 4b's ceiling binds nothing, and
    //     it claims whatever sits in `_queue/pending/` on this run's ground —
    //     in a costless batch too, which sets no ceiling at all. So every run
    //     refuses to start beside a serve it did not start.
    const sched = preexistingSchedulerVerdict(ROOT);
    if (!sched.ok) {
      console.error(`[stories] REFUSING: ${sched.reason}`);
      return 1;
    }
    console.log(`[stories] serve ok — ${sched.reason}`);
    // A ground already carrying the emergency halt claims nothing and refuses
    // every dispatch — every claim-waiting beat would time out unexplained.
    const halt = preexistingHaltVerdict(ROOT);
    if (!halt.ok) {
      console.error(`[stories] REFUSING: ${halt.reason}`);
      return 1;
    }
    console.log(`[stories] halt ok — ${halt.reason}`);

    if (provisionResult.refused === null) {
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
        const bridgeOpts = bridgeSpawnOptions(ROOT, { ceilingUsd: bridgeCeilingUsd });
        console.log(`[stories] ${bridgeOpts.note}`);
        console.log(`[stories] ${bridgeOpts.ceilingNote}`);
        const booted = await bootOwnBridge(ROOT, bridgeOpts);
        bridgeProc = booted.proc;
        uiUrl = booted.uiUrl;
      } else {
        console.log(`[stories] reusing this tree's own bridge (pid ${identity.pid})`);
        uiUrl = 'http://localhost:4124';
      }

      for (const story of stories) {
        // Defect B fold, row 184b (forge-8vfn.8.5.21) — the ground snapshot
        // `onStopSignal` needs to capture + clear whatever THIS story mints,
        // taken here because `runStory` owns its own before-snapshot
        // internally and never exposes it. Set IMMEDIATELY before the same
        // await `startedStoryIds` already anchors to, for the same reason:
        // no code must run between this and the story actually starting.
        const project = story.ground?.project ?? null;
        inProgressGround = project === null ? null : {
          storyId: story.id,
          project,
          groundBefore: ownGroundManifest(ROOT, project),
          logsBefore: readdirSync(join(ROOT, '_logs'), { withFileTypes: true }).map((e) => e.name),
        };
        // Marked IMMEDIATELY before the await — no code runs between this and
        // `runStory` actually starting, so a crash inside it can never leave
        // a gap where the story still reads as unstarted.
        startedStoryIds.add(story.id);
        exitCode = (await runStory(story, uiUrl, startedMs, args.ceilingUsd, writtenThisRun)) || exitCode;
        // `runStory` already cleared its OWN minted sessions on every path it
        // reached (every return, every throw past its own try/finally) — so
        // by the time control returns here, `onStopSignal` must stop treating
        // this story as still in progress.
        inProgressGround = null;
      }
    }
  } finally {
    // STUDIO ENDS FIRST, ALWAYS — never signal the scheduler daemon while
    // THIS run's own `forge studio` is still alive and supervising it.
    // `forge studio`'s own exit sequence (`apps/forge/forge-watch.ts`'s
    // `shutdown` → `runExitSequence`) stops its serve supervisor
    // SYNCHRONOUSLY — marking the daemon stopping and sending it ONE
    // SIGTERM — before the studio process itself ever exits; a second,
    // unrelated SIGTERM landing on that pid while the supervisor is also
    // polling it reads, from the supervisor's own side, as the daemon
    // CRASHING, and it respawns a fresh one within its own ~2 s poll tick.
    // `stopStudioThenScheduler` (`sweep-teardown.mjs`) kills `bridgeProc`'s
    // whole process group and waits it fully gone — escalating to SIGKILL
    // past its bound — BEFORE it ever calls `stopSchedulerCensusAndRelease`,
    // so that call's own `stopOwnScheduler` always finds the marker already
    // there and only waits for the drain, never signals again.
    //
    // T1 ruling 657(ii). A leftover `forge serve` from this run breaks the
    // NEXT one, not just this one's own cleanup: `forge studio` ADOPTS a pid
    // that is already alive rather than spawning fresh
    // (`apps/forge/serve-supervisor.ts`), so a daemon this run leaves running
    // carries this run's own queue state and env into whatever boots next —
    // `scheduler-preflight.mjs`'s own refusal exists for exactly that reason,
    // on the costed side. Clearing it here, every run, is what keeps the next
    // one honest.
    //
    // Finding row 75 (T1 rulings 1258, 1332) — stopping the daemon and
    // releasing its claim is never two calls in a row with nothing between
    // them confirming a dispatch the daemon started (detached, per
    // `spawnAgentTurn`) was actually dead: measured as a heartbeat written
    // back 13s after this runner printed CLEARED. `stopSchedulerCensusAndRelease`
    // snapshots the daemon's descendants BEFORE it is signalled, kills them
    // directly, censuses, and only then releases — with a re-read after,
    // because the census cannot see a writer outside the daemon's own tree.
    // See its header in `sweep-teardown.mjs` and the three doors in
    // `sweep-teardown.test.ts`.
    //
    // ROW 166 follow-up (bead `forge-8vfn.8.1.60`) — `sinceMs: startedMs` is
    // this run's own window, so a DEFERRED initiative (still in flight when
    // its story ended, because the scheduler that owned it was still alive)
    // is captured and cleared here too, once that daemon is confirmed dead.
    // REQUIRED, not optional — see the function's own header for why.
    const stop = await stopStudioThenScheduler(ROOT, bridgeProc, { sinceMs: startedMs });
    for (const line of stop.lines) console.log(line);
    // MUST 1 (D's review of #906) — the teardown's own outcome must reach the
    // process's exit code, not only the log: a surviving daemon grandchild
    // printing "REFUSING to release…" or "RELEASE DID NOT HOLD…" must not let
    // the process still exit 0 on an otherwise-green run.
    const teardown = teardownExitCode(exitCode, stop);
    exitCode = teardown.exitCode;
    for (const line of teardown.lines) console.error(line);
    // Studio and serve are stopped above, so clearing a halt this run pulled
    // cannot let a claim in; a halt left behind would wedge the next run.
    const haltClear = clearRunHalt(ROOT);
    for (const line of haltClear.lines) console.log(line);
    if (!haltClear.ok) exitCode = exitCode || 1;

    const put = restoreSweptCommitted(ROOT, sweptPaths);
    for (const p of put.restored) console.log(`[stories] restored ${p} — swept before the run and never regenerated`);
    for (const f of put.failed) console.warn(`[stories] could not restore ${f.path}: ${f.error}`);

    // The abort backstop. `runStory` reaps into each story's own verdict
    // record; this catches the paths that never reach one — a throw, a
    // refusal after the bridge booted, a Ctrl-C between stories. Idempotent:
    // a pid already reaped is simply not alive, and is reported as skipped.
    // It runs once studio and the scheduler daemon it supervises are BOTH
    // confirmed gone (the stop above), so every turn still alive here is a
    // genuine orphan — never one either of them is still actively managing.
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
    // The fixture-ground abort backstop. `runStory` already tears down its OWN
    // ground on every path it reaches ONCE STARTED (a green run, a red one, a
    // spend halt) — so this only ever has work to do for a story whose ground
    // was provisioned in THIS batch but whose own `runStory` was NEVER
    // ENTERED: the bridge `refuse` throw, a `bootOwnBridge` failure, or an
    // earlier story's `runStory` throwing before a later story's turn. A
    // story that DID start and then crashed mid-beats keeps its ground —
    // deleting it here would destroy evidence (`_architect/<sid>/…` and
    // friends) before anything reads it.
    // After the agent reap above, so nothing is still writing into a ground
    // this might remove. Wrapped in its own try/catch, same as the reap
    // block above and for the same reason: a throw here must not be able to
    // skip `await release()` below it.
    try {
      for (const p of provisionedGrounds) {
        if (startedStoryIds.has(p.storyId)) {
          // A started story's own `runStory` tears its ground down on every
          // path it reaches, so "started" alone does not mean the ground is
          // still there. Only a ground still ON DISK gets the line — a report
          // that speaks whether or not the thing it names is true is the
          // `forge-e8dn` class.
          if (existsSync(join(ROOT, 'projects', p.project))) {
            console.log(
              `[stories] fixture ground: projects/${p.project} LEFT for evidence — ` +
              `the leading sweep of the next run that includes ${p.storyId} removes it`,
            );
          }
          continue;
        }
        const t = teardownFixtureGround(ROOT, { storyId: p.storyId, project: p.project });
        if (t.removed) console.log(`[stories] fixture ground: torn down projects/${p.project}`);
        else if (t.error !== undefined) {
          console.warn(
            `[stories] fixture ground: could not tear down projects/${p.project}: ${t.error} — ` +
            `the leading sweep of the next run that includes ${p.storyId} removes it`,
          );
        } else console.log(`[stories] fixture ground: projects/${p.project} already absent`);
      }
    } catch (err) {
      console.warn(`[stories] fixture-ground backstop failed: ${err?.message ?? err}`);
    }
    // Studio (and the scheduler daemon it supervises) is already fully
    // stopped above, by `stopStudioThenScheduler` — which reuses the SAME
    // bridge-group kill `onStopSignal` above and the boot-timeout path in
    // `bridge.mjs` both call, row 184b (forge-8vfn.8.5.21). The host lock
    // releases last, once nothing this run started still holds the ports.
    await release();
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`[stories] ${e?.message ?? e}`);
    process.exit(1);
  });
