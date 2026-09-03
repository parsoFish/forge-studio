/**
 * SEC-04 pin — the RUNNER LEG (second independent, non-HTTP path).
 *
 * The three spawned-turn runners each recompute their session dir with a BARE
 * `join(projectRoot, <kindDir>, sessionId)` builder and hand it straight to
 * `readSessionStatus` (which itself does `join(sessionDir, 'status.json')` with
 * no containment). A traversal or symlink riding on `sessionId` therefore folds
 * the read OUT of the intended project subtree:
 *
 *   - runInstructionsTurn   → instructionsSessionDir  (packages/sessions/instructions-runner.ts:142/153)
 *   - runProjectBrainTurn   → projectBrainSessionDir  (packages/sessions/kinds/project-brain.ts)
 *   - runDemoBuilderTurn    → demoSessionDir          (packages/sessions/demo-builder-runner.ts:171/182)
 *
 * The Stage-1 reproduce agent exercised only the HTTP surface and SUPPRESSED
 * the spawn, so this leg was never executed. These tests invoke each runner
 * function DIRECTLY (integration-level, real scratch fs) so the read leg runs.
 *
 * CONTAINMENT CONTRACT (what the accepted fix must achieve — RED today):
 * a traversal/symlink `sessionId` must NOT let the runner read a status.json
 * that lives outside the project subtree. Post-fix the guarded builder resolves
 * the escape to `null` / a contained non-existent path, so `readSessionStatus`
 * finds nothing and the runner throws its "no status.json … has the session
 * been started?" refusal — it must NEVER surface the out-of-root file's
 * contents in its return value.
 *
 * RED PROOF: today the bare join folds the `..` / follows the symlink, the
 * victim status.json IS read, and the runner returns a result carrying the
 * victim's sentinel `phase` — the `assert.notEqual(disclosed, VICTIM_PHASE)`
 * line fails on the current (unfixed) tree.
 *
 * The sentinel phase is a value that matches NO runner's known phase enum, so
 * every runner falls through to its terminal `else` branch and returns
 * `{ phase, wrote: [] }` WITHOUT spawning an agent turn — the disclosure is
 * observed purely from the read, no LLM, no write. A throwing `queryFn` is
 * injected as a tripwire so any accidental spawn fails loudly instead of
 * reaching the real SDK.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  symlinkSync,
  lstatSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runInstructionsTurn, instructionsSessionDir } from './kinds/instructions.ts';
import { runProjectBrainTurn, projectBrainSessionDir } from './kinds/project-brain.ts';
import { runDemoBuilderTurn, demoSessionDir } from './kinds/demo-builder.ts';
import type { QueryFn } from './interactive-session.ts';

// Belt-and-braces: these are only read by the bridge/SDK spawn path, which the
// sentinel phase already avoids — but set them so an accidental spawn can never
// reach a live agent.
process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
process.env.FORGE_DRY_BRIDGE = '1';

/** A phase string that matches NO runner's phase enum → every runner takes its
 *  terminal `else` (return `{ phase, wrote: [] }`), never a spawning branch. */
const VICTIM_PHASE = 'sec04-out-of-root-disclosure';

/** Injected as `queryFn`: an LLM spawn in a containment test is itself a bug. */
const throwingQuery: QueryFn = ((): never => {
  throw new Error('SEC-04 containment test: the LLM must not be spawned on this leg');
}) as unknown as QueryFn;

type Scratch = {
  base: string;
  forgeRoot: string;
  projectsRoot: string;
  projectRoot: string;
  logsRoot: string;
  victimDir: string;
  victimStatus: string;
};

/**
 * Layout (base = a fresh mkdtemp dir; victim planted OUTSIDE forgeRoot AND
 * projectsRoot so any escape is unambiguous):
 *
 *   <base>/forge/projects/attacker   ← projectRoot (NOT created: proves the
 *                                       pass cannot come from an in-root file)
 *   <base>/forge/_logs               ← logsRoot (all runner side writes land here)
 *   <base>/victim-secret/status.json ← the out-of-root secret
 */
function planScratch(): Scratch {
  const base = mkdtempSync(join(tmpdir(), 'sec04-runner-'));
  const forgeRoot = join(base, 'forge');
  const projectsRoot = join(forgeRoot, 'projects');
  const projectRoot = join(projectsRoot, 'attacker');
  const logsRoot = join(forgeRoot, '_logs');
  const victimDir = join(base, 'victim-secret');
  mkdirSync(victimDir, { recursive: true });
  const victimStatus = join(victimDir, 'status.json');
  writeFileSync(
    victimStatus,
    JSON.stringify(
      {
        session_id: 'sess-VICTIM',
        project: 'victim',
        project_repo_path: join(base, 'victim-repo'),
        phase: VICTIM_PHASE,
        // both counters present so the record satisfies every runner's status shape
        round: 1,
        iteration: 1,
        prompt: 'SECRET-OUT-OF-ROOT',
        updated_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  return { base, forgeRoot, projectsRoot, projectRoot, logsRoot, victimDir, victimStatus };
}

/** `join(projectRoot, kindDir, sessionId)` reaches `<base>/victim-secret` with
 *  four `..` (climbing kindDir → attacker → projects → forge → base). */
const FOLD_SESSION_ID = '../../../../victim-secret';

type RunnerLeg = {
  name: string;
  builder: (projectRoot: string, sessionId: string) => string;
  run: (s: Scratch, sessionId: string) => Promise<{ phase: string }>;
};

const LEGS: RunnerLeg[] = [
  {
    name: 'runInstructionsTurn',
    builder: instructionsSessionDir,
    run: (s, sessionId) =>
      runInstructionsTurn({
        sessionId,
        projectRoot: s.projectRoot,
        logsRoot: s.logsRoot,
        forgeRoot: s.forgeRoot,
        queryFn: throwingQuery,
      }),
  },
  {
    name: 'runProjectBrainTurn',
    builder: projectBrainSessionDir,
    run: (s, sessionId) =>
      runProjectBrainTurn({
        sessionId,
        projectRoot: s.projectRoot,
        logsRoot: s.logsRoot,
        forgeRoot: s.forgeRoot,
        queryFn: throwingQuery,
      }),
  },
  {
    name: 'runDemoBuilderTurn',
    builder: demoSessionDir,
    run: (s, sessionId) =>
      runDemoBuilderTurn({
        sessionId,
        projectRoot: s.projectRoot,
        logsRoot: s.logsRoot,
        forgeRoot: s.forgeRoot,
        queryFn: throwingQuery,
      }),
  },
];

for (const leg of LEGS) {
  test(`${leg.name} contains a ..-fold traversal sessionId (no out-of-root read)`, async () => {
    const s = planScratch();
    try {
      // --- preconditions (false-negative discipline): assert the fixture BEFORE
      //     reading any verdict, so a "contained" verdict cannot be an accident.
      assert.ok(existsSync(s.victimStatus), 'fixture: out-of-root victim status.json must exist');
      assert.ok(
        !existsSync(s.projectRoot),
        'fixture: attacker projectRoot must NOT exist — there is no in-root file to read, so a contained run cannot pass by reading one',
      );
      const naive = leg.builder(s.projectRoot, FOLD_SESSION_ID);
      assert.equal(
        naive,
        s.victimDir,
        'the bare-join builder folds the traversal straight to the out-of-root victim dir',
      );
      assert.equal(join(naive, 'status.json'), s.victimStatus);
      const victimBefore = readdirSync(s.victimDir).sort();

      // --- invoke the real runner leg
      let disclosed: string | null = null;
      let threw = false;
      try {
        const res = await leg.run(s, FOLD_SESSION_ID);
        disclosed = res.phase;
      } catch {
        threw = true;
      }

      // --- containment: the out-of-root status must NOT be disclosed in the
      //     return, and the runner must refuse (throw its no-status error).
      assert.notEqual(
        disclosed,
        VICTIM_PHASE,
        `containment breach: ${leg.name} read an out-of-root status.json and returned its phase (=${JSON.stringify(disclosed)})`,
      );
      assert.ok(
        threw,
        `containment: ${leg.name} must refuse the folded traversal and throw its no-status error, not read the out-of-root dir`,
      );
      assert.deepEqual(
        readdirSync(s.victimDir).sort(),
        victimBefore,
        'containment: no out-of-root write into the victim dir',
      );
    } finally {
      rmSync(s.base, { recursive: true, force: true });
    }
  });
}

test('runInstructionsTurn contains a symlinked kind-dir (the shipped-vector shape; no out-of-root read)', async () => {
  // Mirrors the bd forge-ebj wire vector: a symlinked kind-dir inside the
  // (attacker-controlled) project working tree redirects the session read to
  // another subtree entirely. Here `projectRoot/_instructions` → the victim's
  // `_instructions`, and a perfectly well-formed sessionId ('sess-VICTIM')
  // reads through it. A lexical `startsWith`/`..`-only check never catches this;
  // only per-segment realpath identity does.
  const base = mkdtempSync(join(tmpdir(), 'sec04-runner-symlink-'));
  const forgeRoot = join(base, 'forge');
  const projectRoot = join(forgeRoot, 'projects', 'attacker');
  const logsRoot = join(forgeRoot, '_logs');
  const victimKindDir = join(base, 'victim-secret', '_instructions');
  const victimSessionDir = join(victimKindDir, 'sess-VICTIM');
  try {
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(victimSessionDir, { recursive: true });
    const victimStatus = join(victimSessionDir, 'status.json');
    writeFileSync(
      victimStatus,
      JSON.stringify(
        {
          session_id: 'sess-VICTIM',
          project: 'victim',
          project_repo_path: join(base, 'victim-repo'),
          phase: VICTIM_PHASE,
          round: 1,
          prompt: 'SECRET-OUT-OF-ROOT',
          updated_at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    // Plant the symlink the ordinary attacker git commit would carry.
    symlinkSync(victimKindDir, join(projectRoot, '_instructions'));

    // --- preconditions
    assert.ok(existsSync(victimStatus), 'fixture: victim status.json must exist');
    assert.ok(
      lstatSync(join(projectRoot, '_instructions')).isSymbolicLink(),
      'fixture: projectRoot/_instructions must be the planted symlink',
    );
    const naive = instructionsSessionDir(projectRoot, 'sess-VICTIM');
    assert.ok(
      existsSync(join(naive, 'status.json')),
      'fixture: the bare-join builder resolves through the symlink to the victim status.json',
    );

    // --- invoke
    let disclosed: string | null = null;
    let threw = false;
    try {
      const res = await runInstructionsTurn({
        sessionId: 'sess-VICTIM',
        projectRoot,
        logsRoot,
        forgeRoot,
        queryFn: throwingQuery,
      });
      disclosed = res.phase;
    } catch {
      threw = true;
    }

    // --- containment
    assert.notEqual(
      disclosed,
      VICTIM_PHASE,
      `containment breach: runInstructionsTurn read through a symlinked kind-dir and returned the victim phase (=${JSON.stringify(disclosed)})`,
    );
    assert.ok(
      threw,
      'containment: runInstructionsTurn must refuse the symlinked kind-dir and throw its no-status error',
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
