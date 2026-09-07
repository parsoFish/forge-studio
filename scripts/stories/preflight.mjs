/**
 * preflight.mjs — memory and the host lock, both ported lessons.
 *
 * MEMORY. A memory-starved host OOM-kills the browser and produces a trailing
 * cluster of `Target crashed` failures that read exactly like code defects
 * (measured on this 13 GB box with a foreign 10 GB process). The runner
 * refuses up front and names the symptom, so nobody spends 45 minutes reading
 * a crash as a product bug. If the figure cannot be read, it refuses too —
 * "we could not tell" is not "there is plenty".
 *
 * HOST LOCK. 4123/4124 are host-global, so exactly one story run may hold the
 * host at a time. The lock therefore lives in the OS temp dir, NOT in the
 * worktree: a lock inside the repo gives every worktree its own lock file, so
 * two lanes would each acquire "the" lock and both run — a per-repo lock on a
 * host-global resource is not a lock at all. Implemented with
 * `proper-lockfile`, already a dependency here — no new one, and it handles
 * staleness for us rather than us hand-rolling a PID file (and a holder PID is
 * not a liveness check anyway).
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import lockfile from 'proper-lockfile';

/**
 * The floor, in MB of MemAvailable. Chosen as the headroom a chromium context
 * plus a production Next server need on this host; below it the browser is
 * the thing that dies, not the code under test.
 */
export const MIN_AVAILABLE_MB = 1500;

/** Pure: judge an available-MB figure. */
/**
 * Sessions on disk that belong to a project this run does not own.
 *
 * Bead `forge-8vfn.6.11.50` (T1 ruling 368), bought by S2 run 10. It was
 * launched minutes after S1 run 10 in the same lane; its beat 12 pressed
 * `open-session` — a handle `HomeSessionsStrip` renders ONCE PER CARD, so the
 * runner's `.first()` takes whichever card sorts first — and landed on S1 run
 * 10's FAILED demo session on `gitweave`: another story, another project,
 * another kind. It then spent ten minutes waiting for an architect's question
 * box on a demo session's page, and the funded run measured nothing.
 *
 * The product was fine and the sweep was fine: the trailing sweep removes
 * `story-*` fixtures and has no business touching a real project's sessions.
 * What was missing was this question, asked BEFORE the money.
 *
 * A session is any `projects/<project>/_<kind>/<sessionId>/` directory — the
 * shape Studio itself lists from, so the check sees what the operator's first
 * card would.
 *
 * @param {string} root      the forge root this run owns
 * @param {string} ownProject the project this story's ground IS
 */
export function foreignSessionVerdict(root, ownProject) {
  const projectsRoot = join(root, 'projects');
  const foreign = [];
  let seen = 0;
  for (const project of readdirSafe(projectsRoot)) {
    if (project.name.startsWith('.') || !project.isDirectory()) continue;
    for (const kind of readdirSafe(join(projectsRoot, project.name))) {
      if (!kind.isDirectory() || !kind.name.startsWith('_')) continue;
      for (const session of readdirSafe(join(projectsRoot, project.name, kind.name))) {
        if (!session.isDirectory()) continue;
        seen += 1;
        if (project.name !== ownProject) {
          foreign.push(`${project.name}${kind.name}/${session.name}`);
        }
      }
    }
  }
  if (foreign.length > 0) {
    return Object.freeze({
      ok: false,
      foreign: Object.freeze(foreign),
      reason:
        `${foreign.length} session(s) on disk belong to a project this run does not own — ` +
        `${foreign.join(', ')}. Studio lists them beside this run's own, and a beat that presses ` +
        '`open-session` takes the FIRST card, so a costed run could spend its bound on the wrong ' +
        'session (S2 run 10 did). Remove them, or run in a lane that has none.',
    });
  }
  return Object.freeze({
    ok: true,
    foreign: Object.freeze([]),
    reason: seen === 0 ? 'no sessions on disk' : `${seen} session(s) on disk, all in ${ownProject}`,
  });
}

/** `readdirSync` with types, or nothing — an absent directory is not an error here. */
function readdirSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function memoryVerdict(availableMb) {
  if (typeof availableMb !== 'number' || !Number.isFinite(availableMb)) {
    return Object.freeze({
      ok: false,
      reason:
        'could not read MemAvailable from /proc/meminfo. Refusing rather than assuming there is ' +
        `enough: a story run under memory pressure dies with "Target crashed", which reads exactly ` +
        'like a code defect.',
    });
  }
  if (availableMb < MIN_AVAILABLE_MB) {
    return Object.freeze({
      ok: false,
      reason:
        `only ${availableMb} MB available, floor is ${MIN_AVAILABLE_MB} MB. Refusing: at this level ` +
        'the browser is OOM-killed and the run fails with "Target crashed" — that is memory, not code. ' +
        'Free memory (check for a leaked process) and re-run.',
    });
  }
  return Object.freeze({ ok: true, reason: `${availableMb} MB available` });
}

/** Read MemAvailable in MB, or null when it cannot be read. */
export function readAvailableMb(meminfoPath = '/proc/meminfo') {
  try {
    const m = readFileSync(meminfoPath, 'utf8').match(/^MemAvailable:\s+(\d+)\s+kB$/m);
    return m ? Math.floor(Number(m[1]) / 1024) : null;
  } catch {
    return null;
  }
}

/**
 * Take the host lock. Returns a release function.
 *
 * The lock file lives under the gitignored operator root so it is never
 * committed and never collides with a tracked path.
 */
export function hostLockPath() {
  return join(tmpdir(), 'forge-stories-host.lock');
}

export async function acquireHostLock() {
  const lockPath = hostLockPath();
  if (!existsSync(lockPath)) writeFileSync(lockPath, 'forge story runner host lock\n');
  try {
    return await lockfile.lock(lockPath, { stale: 30 * 60 * 1000, retries: 0 });
  } catch (e) {
    throw new Error(
      `another story run holds the host lock (${lockPath}): ${e?.message ?? e}. ` +
        'Ports 4123/4124 are host-global — exactly one story run at a time.',
    );
  }
}

/**
 * Stories whose beats BIND A GITHUB REMOTE, and therefore stand on the
 * operator switch `projects.remote.create`.
 *
 * Bead `forge-8vfn.7.5.7`, T1 ruling 456 / §15.248. The switch is per-worktree
 * operator state in a GITIGNORED `forge.config.json`, and it defaults OFF
 * (ruling 323 — `bridge-studio-project-onboard.ts:215` mints a remote only when
 * it is `true`). So a story whose beat asserts the remote is red BY
 * CONSTRUCTION in any worktree nobody remembered to switch on: A's S2 run 1
 * redded beat 5 and spent **$1.76** proving the lane's config, not the product.
 *
 * A NAMED SET, not an inference. The alternative was to guess from a beat's
 * handles, and a guess that goes wrong here refuses a run that would have
 * worked — worse than the defect. The cost is that this set must be extended
 * when another story starts binding a remote; that is one line, and a run
 * refused with the switch named is far cheaper than a beat red for a reason
 * nobody can see. It cannot be a field on the story: `tests/stories/*` is
 * pinned, and adding one would be an amendment to a file this check exists to
 * protect.
 */
export const REMOTE_BINDING_STORIES = Object.freeze(['S2']);

/**
 * Is `projects.remote.create` on in the RUN worktree's own config?
 *
 * Reads the same file the product reads (`<root>/forge.config.json`,
 * `loadConfig(defaultConfigPath(forgeRoot))`) so the check and the behaviour
 * cannot disagree about which file they came from. A missing file, a malformed
 * one and an absent key are all "OFF" — and each says which, because "no config
 * here" and "the switch is off" send the operator to different places.
 *
 * @returns {{ok: boolean, reason: string}}
 */
export function remoteSwitchVerdict(root, storyIds) {
  const need = storyIds.filter((id) => REMOTE_BINDING_STORIES.includes(id));
  if (need.length === 0) return { ok: true, reason: 'no selected story binds a GitHub remote' };
  const path = join(root, 'forge.config.json');
  if (!existsSync(path)) {
    return {
      ok: false,
      reason:
        `${need.join(', ')} binds a GitHub remote, and ${path} does not exist — so ` +
        '`projects.remote.create` is OFF and the beat that asserts the remote is red before it runs. ' +
        'Create the config with `projects: { remote: { create: true } }` for the run, and restore it after.',
    };
  }
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return {
      ok: false,
      reason: `${need.join(', ')} binds a GitHub remote and ${path} could not be parsed (${err?.message ?? err}) — refusing rather than assuming the switch`,
    };
  }
  if (cfg?.projects?.remote?.create === true) {
    return { ok: true, reason: `projects.remote.create is on in ${path} — ${need.join(', ')} can bind its remote` };
  }
  return {
    ok: false,
    reason:
      `${need.join(', ')} binds a GitHub remote but \`projects.remote.create\` is not true in ${path} ` +
      '(it defaults OFF, ruling 323). The beat that asserts the remote would be red by construction and the ' +
      'run would spend proving this lane\'s config rather than the product. Set it true for the run and ' +
      'restore it unconditionally afterwards (rulings 323/354).',
  };
}
