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
} from './preflight.mjs';
import { suiteLockVerdict } from './lock-guard.mjs';
import { sweepStoryResidue } from './sweep.mjs';
import { captureAndSweepAgentLogs } from './sweep-agent-logs.mjs';
import { restoreSweptCommitted, stopOwnScheduler, releaseOwnInFlight } from './sweep-teardown.mjs';
import {
  decideStoryBridge,
  readProcCwd,
  refusalError,
  bootOwnBridge,
  bridgeSpawnOptions,
} from './bridge.mjs';
import { collectAgentRuns, reapAgentRuns, describeReap } from './reap.mjs';
import { recordReapedCancellations } from './reap-cancel.mjs';
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
      exitCode = (await runStory(story, uiUrl, startedMs, args.ceilingUsd)) || exitCode;
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

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`[stories] ${e?.message ?? e}`);
    process.exit(1);
  });
