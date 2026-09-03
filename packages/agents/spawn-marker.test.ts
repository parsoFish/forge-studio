/**
 * Bead `forge-8vfn.5.50` — the per-run spawn marker, and the sweep that finds
 * a process by it.
 *
 * THE GAP THIS CLOSES, in the reaper's own words (`scripts/stories/reap.mjs`,
 * sessions' #322): "A grandchild that BOTH calls `setsid` (leaving our group)
 * AND loses its parent before the snapshot is invisible to both walks: its
 * ppid no longer leads back to us and its pgid is its own. The only evidence
 * left is its cwd — and discovering processes by 'cwd inside ownRoot' is not
 * available here, because `run.mjs` passes the REPO ROOT as `ownRoot`, so such
 * a sweep would signal the story runner itself, the Studio bridge and the
 * operator's own shell."
 *
 * The marker identifies OUR PROCESSES rather than a directory, which is
 * exactly why it can do what that cwd sweep could not. The negative half is
 * satisfied BY CONSTRUCTION — a process acquires the marker only by being
 * spawned by a run that minted it — and the controls below prove it rather
 * than asserting it: a planted same-argv foreign process and a process
 * carrying a DIFFERENT run's token are both invisible to the sweep, and so is
 * this test process (which is the operator's shell and the Studio bridge under
 * another name: something running as the same user that we did not spawn).
 *
 * Every control here is a REAL process, not a stub: the whole claim is about
 * what `/proc` says after the pid/ppid/pgid evidence is gone, and a fake
 * process table cannot be wrong in the way the real one can.
 */
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MAX_ENV_OVERRIDE_KEYS, buildChildEnv } from '@forge/kernel/spawn-env.ts';

import { resolveRunQuery, withRunMarker, type StreamQueryFn } from './pinned-sdk-query.ts';
import { createClaudeAgent } from './ralph/claude-agent.ts';

import {
  AGENT_RUN_MARKER_ENV,
  AGENT_RUN_MARKER_FILE,
  markerEnvOverlay,
  mintRunMarker,
  processesCarryingMarker,
  readRunMarkers,
  tokenBelongsToRunDir,
  recordRunMarker,
} from './spawn-marker.ts';

/** Wait until `predicate()` is true, polling — never a fixed sleep. */
async function until(predicate: () => boolean, what: string, steps = 200): Promise<void> {
  for (let i = 0; i < steps; i += 1) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`timed out waiting for ${what}`);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killQuietly(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone — nothing to clean up */
  }
}

// ---------------------------------------------------------------------------
// Minting: per RUN, never a constant.
// ---------------------------------------------------------------------------

test('mintRunMarker mints a DIFFERENT token per call — a constant would let a later run sweep an earlier run\'s process', () => {
  const a = mintRunMarker('2026-09-03T10-00-00-abcdef12');
  const b = mintRunMarker('2026-09-03T10-00-00-abcdef12');
  assert.notEqual(a, b, 'two runs (even with the same runId) must not share a token');
  // Length is about COLLISION, not secrecy — the token is an identifier any
  // same-uid process can read out of /proc, never an authorisation.
  assert.ok(a.length >= 16, `a token must be wide enough not to collide: ${JSON.stringify(a)}`);
});

test('mintRunMarker carries the runId so a stray process names its own run without the reaper', () => {
  const runId = '2026-09-03T10-00-00-abcdef12';
  assert.ok(
    mintRunMarker(runId).startsWith(`${runId}:`),
    'the token leads with the runId: `grep -z FORGE_AGENT_RUN_MARKER /proc/<pid>/environ` on a leaked process must say which run leaked it',
  );
});

test('mintRunMarker refuses to embed an unsafe runId — the token reaches a file path via the run dir', () => {
  const token = mintRunMarker('../../etc/passwd');
  assert.ok(!token.includes('..'), `an unsafe runId must not ride into the token: ${JSON.stringify(token)}`);
  assert.ok(token.length >= 16);
});

// ---------------------------------------------------------------------------
// The env override, and the cap it shares with the git-identity overlay.
// ---------------------------------------------------------------------------

test('markerEnvOverlay is exactly ONE key', () => {
  const overlay = markerEnvOverlay('token-1');
  assert.deepEqual(Object.keys(overlay), [AGENT_RUN_MARKER_ENV]);
  assert.equal(overlay[AGENT_RUN_MARKER_ENV], 'token-1');
});

test('the marker overlay and the 4-key git-identity overlay never combine past MAX_ENV_OVERRIDE_KEYS', () => {
  // The cap throws BY DESIGN (`buildChildEnv`), so tripping it would be a
  // self-inflicted outage on every commit-writing agent — the one interaction
  // ruling 68 asked to be proven rather than assumed.
  const gitIdentity = {
    GIT_AUTHOR_NAME: 'forge',
    GIT_AUTHOR_EMAIL: 'forge@example.invalid',
    GIT_COMMITTER_NAME: 'forge',
    GIT_COMMITTER_EMAIL: 'forge@example.invalid',
  };
  const overrides = { ...gitIdentity, ...markerEnvOverlay('token-1') };
  assert.equal(Object.keys(overrides).length, 5);
  assert.ok(5 <= MAX_ENV_OVERRIDE_KEYS, `the cap is ${MAX_ENV_OVERRIDE_KEYS}; the composed overlay is 5`);
  const env = buildChildEnv({ PATH: '/usr/bin' }, overrides);
  assert.equal(env[AGENT_RUN_MARKER_ENV], 'token-1');
  assert.equal(env['GIT_AUTHOR_NAME'], 'forge');
  assert.equal(env['PATH'], '/usr/bin', 'the allowlisted ambient snapshot survives underneath the overrides');
});

test('the marker is an OVERRIDE, never an allowlist entry — an ambient marker is not inherited', () => {
  // If the marker were allowlisted, a stale value exported in the operator's
  // shell would be inherited by everything forge spawns, and the sweep would
  // claim processes nobody minted a token for. Overrides are the caller's own
  // deliberate composition; ambient state is filtered out.
  const env = buildChildEnv({ PATH: '/usr/bin', [AGENT_RUN_MARKER_ENV]: 'ambient-token' }, {});
  assert.equal(
    env[AGENT_RUN_MARKER_ENV],
    undefined,
    'an ambient FORGE_AGENT_RUN_MARKER must be stripped by the allowlist, not passed through',
  );
});

// ---------------------------------------------------------------------------
// Recording: the run dir is where the reaper reads the token from.
// ---------------------------------------------------------------------------

test('recordRunMarker writes the token where the reaper reads it, and readRunMarkers reads it back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-marker-'));
  try {
    const runId = '2026-09-03T10-00-00-abcdef12';
    const token = mintRunMarker(runId);
    mkdirSync(join(dir, runId), { recursive: true });
    recordRunMarker(dir, runId, token);
    assert.equal(readFileSync(join(dir, runId, AGENT_RUN_MARKER_FILE), 'utf8').trim(), token);
    assert.deepEqual(readRunMarkers(join(dir, runId)), [token]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readRunMarkers returns [] for a dir with no marker — a run that recorded none is not an error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-marker-'));
  try {
    assert.deepEqual(readRunMarkers(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recordRunMarker refuses an empty token rather than writing a file that matches every marked process', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-marker-'));
  try {
    assert.throws(() => recordRunMarker(dir, '2026-09-03T10-00-00-abcdef12', ''), /token/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The sweep — real processes, both halves.
// ---------------------------------------------------------------------------

test('recordRunMarker re-checks the runId itself — a write must not inherit its containment from its caller', () => {
  // COMMON §15.19: a function that trusts the root it is handed makes every
  // caller's derivation part of the containment boundary, and this one writes.
  const dir = mkdtempSync(join(tmpdir(), 'agents-marker-'));
  try {
    assert.throws(
      () => recordRunMarker(dir, '../../../../tmp/pwned', 'token-1'),
      /unsafe runId/,
      'an unsafe runId must be refused here, not only at runAgent',
    );
    assert.equal(existsSync('/tmp/pwned'), false, 'nothing may be written outside the logs root');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('processesCarryingMarker refuses an empty token — a blank sweep is a pattern kill through an empty door', () => {
  assert.throws(() => processesCarryingMarker(''), /token/i);
});

test('NEGATIVE CONTROL: this process — same uid, not spawned by a run — is never swept', () => {
  const token = mintRunMarker('2026-09-03T10-00-00-abcdef12');
  const found = processesCarryingMarker(token);
  assert.ok(
    !found.includes(process.pid),
    'the sweep claimed its own caller: the operator shell and the Studio bridge are this process under another name',
  );
  assert.deepEqual(found, [], `a freshly minted token can match nothing yet: ${JSON.stringify(found)}`);
});

test('POSITIVE CONTROL: a grandchild that setsids AND orphans itself — invisible to both of the reaper\'s walks — IS found by its marker', async (t) => {
  const token = mintRunMarker('2026-09-03T10-00-00-abcdef12');
  const elsewhere = mkdtempSync(join(tmpdir(), 'agents-marker-elsewhere-'));
  // The escape shape exactly: a parent that spawns a DETACHED grandchild (its
  // own process group — `setsid`), prints its pid, then exits. The grandchild
  // is then an orphan in a group of its own, in a directory that is not the
  // run's: no ppid chain, no shared pgid, and a cwd sweep would have to signal
  // half the host to find it.
  const parent = spawn(
    process.execPath,
    [
      '-e',
      `const { spawn } = require('node:child_process');
       const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
         cwd: ${JSON.stringify(elsewhere)}, stdio: 'ignore', detached: true });
       c.unref();
       process.stdout.write(String(c.pid));
       setTimeout(() => process.exit(0), 50);`,
    ],
    { cwd: elsewhere, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, ...markerEnvOverlay(token) } },
  );
  const grandchild = await new Promise<number>((resolve) => {
    let out = '';
    parent.stdout.on('data', (c) => {
      out += String(c);
    });
    parent.on('close', () => resolve(Number.parseInt(out.trim(), 10)));
  });
  t.after(() => {
    killQuietly(grandchild);
    killQuietly(parent.pid);
    rmSync(elsewhere, { recursive: true, force: true });
  });

  assert.ok(Number.isInteger(grandchild) && grandchild > 0, `no grandchild pid was reported: ${grandchild}`);
  await until(() => !alive(parent.pid!), 'the parent to exit, orphaning the grandchild');
  assert.ok(alive(grandchild), 'the grandchild must outlive its parent — otherwise this control proves nothing');

  const found = processesCarryingMarker(token);
  assert.ok(
    found.includes(grandchild),
    `the orphaned, setsid'd grandchild was NOT found by its marker — the residual gap is still open: ${JSON.stringify(found)}`,
  );
});

test('NEGATIVE CONTROL: a same-argv foreign process, and one carrying ANOTHER run\'s token, both survive the sweep', async (t) => {
  const ours = mintRunMarker('2026-09-03T10-00-00-abcdef12');
  const theirs = mintRunMarker('2026-09-03T09-00-00-abcdef12');
  const elsewhere = mkdtempSync(join(tmpdir(), 'agents-marker-foreign-'));

  // Identical argv to what a dispatched agent's own child looks like — the
  // pattern-kill shape COMMON §15.17 exists to prevent — but no marker.
  const foreign = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: elsewhere,
    stdio: 'ignore',
    detached: true,
  });
  // An EARLIER run's process. A constant marker would sweep this one; a
  // per-run token must not.
  const earlierRun = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: elsewhere,
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, ...markerEnvOverlay(theirs) },
  });
  t.after(() => {
    killQuietly(foreign.pid);
    killQuietly(earlierRun.pid);
    rmSync(elsewhere, { recursive: true, force: true });
  });

  await until(() => alive(foreign.pid!) && alive(earlierRun.pid!), 'both planted processes to be running');

  const found = processesCarryingMarker(ours);
  assert.ok(!found.includes(foreign.pid!), 'a same-argv foreign process was claimed — the sweep has become a pattern kill');
  assert.ok(
    !found.includes(earlierRun.pid!),
    "an EARLIER run's process was claimed — the token is behaving like a constant",
  );
  // And the earlier run's own token still finds its own process: the sweep is
  // discriminating, not merely empty.
  assert.ok(
    processesCarryingMarker(theirs).includes(earlierRun.pid!),
    'the sweep found nothing for either token — a sweep that never matches proves nothing about the negative half',
  );
});

test('the sweep reads /proc by RECORDED UID, never by a name pattern', () => {
  // Proven structurally rather than by planting another user's process (which
  // a test cannot do): the sweep asks each candidate for its owner and skips
  // any pid it does not own, so a same-uid check is the only membership rule.
  const seen: number[] = [];
  const token = 'token-1';
  const found = processesCarryingMarker(token, {
    listPids: () => [11, 12, 13],
    ownerUidOf: (pid) => {
      seen.push(pid);
      return pid === 12 ? 4242 : process.getuid!();
    },
    readEnviron: () => `PATH=/usr/bin\0${AGENT_RUN_MARKER_ENV}=${token}\0`,
  });
  assert.deepEqual(seen, [11, 12, 13], 'every candidate must be uid-checked');
  assert.deepEqual(found, [11, 13], 'a pid owned by another uid is skipped even when its environ matches');
});

test('the sweep matches a WHOLE environ entry, never a substring', () => {
  const token = 'token-1';
  const found = processesCarryingMarker(token, {
    listPids: () => [21, 22, 23],
    ownerUidOf: () => process.getuid!(),
    readEnviron: (pid) => {
      if (pid === 21) return `${AGENT_RUN_MARKER_ENV}=${token}\0`;
      // A longer token that merely STARTS with ours, and an unrelated var
      // whose VALUE contains ours — both must miss.
      if (pid === 22) return `${AGENT_RUN_MARKER_ENV}=${token}-and-more\0`;
      return `SOME_OTHER_VAR=${AGENT_RUN_MARKER_ENV}=${token}\0`;
    },
  });
  assert.deepEqual(found, [21]);
});

test('the sweep never throws: an unreadable /proc entry is skipped, not fatal — it runs in a teardown', () => {
  const found = processesCarryingMarker('token-1', {
    listPids: () => [31, 32],
    ownerUidOf: (pid) => {
      if (pid === 31) throw new Error('ESRCH');
      return process.getuid!();
    },
    readEnviron: () => `${AGENT_RUN_MARKER_ENV}=token-1\0`,
  });
  assert.deepEqual(found, [32]);
  assert.deepEqual(
    processesCarryingMarker('token-1', {
      listPids: () => {
        throw new Error('/proc is gone');
      },
    }),
    [],
  );
});

// ---------------------------------------------------------------------------
// The seam: what the SDK child is actually spawned with.
//
// `resolveRunQuery` is the one place a run's query is chosen, so these cover
// the whole production chain up to (but not including) the SDK itself:
// marker -> options.env override -> buildChildEnv -> the child's real env.
// ---------------------------------------------------------------------------

test('withRunMarker puts the marker on every spawn, and PRESERVES the caller\'s own env overrides', async () => {
  const seen: Array<Record<string, unknown>> = [];
  const impl = ((params: { prompt: string; options: Record<string, unknown> }) => {
    seen.push(params.options);
    // eslint-disable-next-line require-yield
    return (async function* () {})();
  }) as unknown as StreamQueryFn;

  const marked = withRunMarker(impl, 'token-1');
  for await (const _ of marked({
    prompt: 'p',
    options: { cwd: '/w', env: { GIT_AUTHOR_NAME: 'forge' } },
  })) {
    /* drained */
  }

  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0]!.env, { GIT_AUTHOR_NAME: 'forge', [AGENT_RUN_MARKER_ENV]: 'token-1' });
  assert.equal(seen[0]!.cwd, '/w', 'the rest of the option bag is untouched');
});

test('resolveRunQuery marks the PRODUCTION query and returns an INJECTED one verbatim', async () => {
  // The second half is load-bearing beyond tidiness: five spawn-capture
  // goldens pin "the exact {prompt, options} object each phase passes" into an
  // INJECTED stub. Wrapping an injected query would put a per-run UUID inside
  // every one of them (measured 2026-09-03: all five fail), so the runtime's
  // env delta is applied to the production query only — the same seam, and the
  // same reason, as `buildChildEnv`'s allowlist filtering, which those goldens
  // have never seen either.
  const injected = (() => (async function* () {})()) as unknown as StreamQueryFn;
  assert.equal(resolveRunQuery(injected, 'token-1'), injected, 'an injected query must be used verbatim');

  const seen: Array<Record<string, unknown>> = [];
  const production = ((params: { prompt: string; options: Record<string, unknown> }) => {
    seen.push(params.options);
    return (async function* () {})();
  }) as unknown as StreamQueryFn;
  const resolved = resolveRunQuery(undefined, 'token-1', production);
  assert.notEqual(resolved, production, 'with nothing injected the production query must be WRAPPED, not passed through');
  for await (const _ of resolved({ prompt: 'p', options: {} })) {
    /* drained */
  }
  assert.equal((seen[0]!.env as Record<string, string>)[AGENT_RUN_MARKER_ENV], 'token-1');
});

test('END-TO-END: a real child spawned with the env the SDK would receive IS found by the sweep', async (t) => {
  // The full production composition, minus the SDK: the marker rides as an
  // override on `options.env`, `buildChildEnv` filters the ambient env and
  // layers that override on top, and THAT object is what the SDK hands
  // `child_process.spawn`. Spawning a real process with it proves the marker
  // survives the one step every other test here stubs.
  const token = mintRunMarker('2026-09-03T10-00-00-abcdef12');
  let spawnEnv: NodeJS.ProcessEnv | undefined;
  const production = ((params: { prompt: string; options: Record<string, unknown> }) => {
    spawnEnv = buildChildEnv(process.env, (params.options['env'] as NodeJS.ProcessEnv | undefined) ?? {});
    return (async function* () {})();
  }) as unknown as StreamQueryFn;
  for await (const _ of resolveRunQuery(undefined, token, production)({ prompt: 'p', options: {} })) {
    /* drained */
  }
  assert.ok(spawnEnv, 'the production query must have been invoked');

  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    detached: true,
    env: spawnEnv,
  });
  t.after(() => killQuietly(child.pid));
  await until(() => alive(child.pid!), 'the planted child to be running');

  assert.ok(
    processesCarryingMarker(token).includes(child.pid!),
    'a child spawned with the env the SDK is handed does not carry the marker — the chain breaks at the last step',
  );
});

// ---------------------------------------------------------------------------
// The token is bound to the directory it was recorded in (adversarial
// containment review, 2026-09-03 — HIGH).
// ---------------------------------------------------------------------------

test('a token only counts in the run directory whose name it names — a planted cross-run token is refused', () => {
  const runId = '2026-09-03T10-00-00-abcdef12';
  const token = mintRunMarker(runId);
  assert.equal(tokenBelongsToRunDir(token, `/x/_logs/${runId}`), true);
  // The attack: an escaped agent reads another run's live token (same uid,
  // readable by design) and drops it in a directory of its own making, so OUR
  // teardown kills the OTHER run's healthy processes — with no cwd check to
  // catch it, because the marker rung waives that on purpose.
  assert.equal(
    tokenBelongsToRunDir(token, '/x/_logs/_agent-planted'),
    false,
    "a token found in a directory it was not minted for must be refused — otherwise the reaper is a cross-run kill primitive",
  );
  assert.equal(tokenBelongsToRunDir(token, ''), false);
  // A prefix that merely STARTS with the dir name is not the dir name.
  assert.equal(tokenBelongsToRunDir(`${runId}-evil:abc`, `/x/_logs/${runId}`), false);
});

test('several runs sharing ONE run directory each keep their token — the file appends, never overwrites', () => {
  // The phase pipelines pass `runId: cycleId`, so a cycle's PM and its
  // reflector record into the same `_logs/<cycleId>/`. Overwriting would
  // silently retire the earlier phase's token while its children were alive.
  const dir = mkdtempSync(join(tmpdir(), 'agents-marker-share-'));
  try {
    const runId = '2026-09-03T10-00-00-abcdef12';
    const first = mintRunMarker(runId);
    const second = mintRunMarker(runId);
    recordRunMarker(dir, runId, first);
    recordRunMarker(dir, runId, second);
    recordRunMarker(dir, runId, first); // a retry must not grow the file
    assert.deepEqual(readRunMarkers(join(dir, runId)), [first, second]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recordRunMarker creates the run directory when the caller owns no logger', () => {
  // `lifecycle: 'caller'` runs (the four phase pipelines) and every flow-runner
  // node inject their own logger, so nothing else has necessarily created
  // `<logsRoot>/<runId>`. Before this, those runs were marked on the child and
  // recorded nowhere: covered in appearance only.
  const dir = mkdtempSync(join(tmpdir(), 'agents-marker-mkdir-'));
  try {
    const runId = '2026-09-03T10-00-00-abcdef12';
    const token = mintRunMarker(runId);
    recordRunMarker(dir, runId, token);
    assert.deepEqual(readRunMarkers(join(dir, runId)), [token]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('THE ADAPTER CHAIN: a production query resolved for a run reaches the SDK with the marker AND the git identity', async () => {
  // The invocation path spawns through `createClaudeAgent`, which sets
  // `options.env` to its own 4-key git-identity overlay. This drives that real
  // chain with an UNWRAPPED production query — the shape a test that injects
  // `ctx.queryFn` can never exercise, because an injected query is returned
  // verbatim — and pins the 5-key composition against the cap.
  const token = mintRunMarker('2026-09-03T10-00-00-abcdef12');
  const seen: Array<Record<string, unknown>> = [];
  const production = ((params: { prompt: string; options: Record<string, unknown> }) => {
    seen.push(params.options);
    return (async function* () {})();
  }) as unknown as StreamQueryFn;

  const promptDir = mkdtempSync(join(tmpdir(), 'agents-marker-adapter-'));
  const promptPath = join(promptDir, 'PROMPT.md');
  writeFileSync(promptPath, 'do the thing');
  try {
    const agent = createClaudeAgent({
      gitIdentity: { name: 'forge', email: 'forge@example.invalid' },
      queryFn: resolveRunQuery(undefined, token, production) as unknown as NonNullable<
        Parameters<typeof createClaudeAgent>[0]
      >['queryFn'],
    });
    await agent({
      promptPath,
      agentMdPath: join(promptDir, 'AGENT.md'),
      fixPlanPath: join(promptDir, 'fix_plan.md'),
      worktreePath: promptDir,
      iteration: 1,
    });
  } finally {
    rmSync(promptDir, { recursive: true, force: true });
  }

  assert.equal(seen.length, 1, 'the adapter must have invoked the resolved query exactly once');
  const env = seen[0]!.env as Record<string, string>;
  assert.equal(env[AGENT_RUN_MARKER_ENV], token, 'the marker did not survive the adapter chain');
  assert.equal(env['GIT_AUTHOR_NAME'], 'forge', 'the adapter own env override was lost');
  assert.ok(
    Object.keys(env).length <= MAX_ENV_OVERRIDE_KEYS,
    `the composed override is ${Object.keys(env).length} keys against a cap of ${MAX_ENV_OVERRIDE_KEYS}, which throws by design`,
  );
});
