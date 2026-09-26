/**
 * fork-grounds.mjs — T1 ruling 1350's gap-close: the own-ground drift
 * machinery watches EVERY ground a FILL fork mints, exactly as it already
 * watches the base `ground.project`, never re-implementing the rules it
 * reuses from `ground-hash.mjs`/`ground-clear.mjs`.
 *
 * THE GAP THIS CLOSES. `beats-fork.mjs` (ruling 1) gives S2's fork its own
 * ground per case — `story-s2-api`, `-cli`, `-webapp` — but `run-story.mjs`'s
 * own-ground hash/fence still only ever read `story.ground.project`
 * (`ownGroundBefore`/`ownGroundAfter`, the beat-scoped licence boundary, the
 * minted-session capture/clear). A per-case ground could drift, keep a session
 * this run minted, or simply be a directory nothing this run declared, and
 * NOTHING would watch it — a fail-open shape a fork agent's own report named
 * rather than left silent.
 *
 * WHY A LOOP, NOT A COPY. `judgeCaseGround` is one call to the SAME
 * `classifyOwnGroundDrift` + `captureAndClearMintedSessions` the base ground's
 * own inline block in `run-story.mjs` calls; `judgeForkGrounds` runs it once
 * per declared case. The base ground's own call site is untouched — it is
 * one project among the ones this run owns, not a separate mechanism.
 *
 * BEAT-SCOPED LICENSING, HONESTLY SCOPED. `ground.expectedChanges[].beat`
 * narrows a WHOLE-RUN declaration to one beat's boundary onward
 * (`beatWindowChangesFrom`, `ground-hash.mjs`); neither S2 nor S7 declares
 * one today. Per-case grounds are judged with an EMPTY beat-window map, so a
 * beat-scoped declaration cannot (yet) be verified against a per-case ground
 * and reports UNDECLARED rather than being silently accepted — the safe
 * direction, since it fails CLOSED (stricter) rather than open. A WHOLE-RUN
 * declaration (no `beat`) is licensed identically to the base ground's own.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isFillFork } from './beats-fork.mjs';
import { storyFixtureNames } from './sweep.mjs';
import { ownGroundManifest, groundChanges, groundIgnoreFromGit, classifyOwnGroundDrift } from './ground-hash.mjs';
import { mintedSessionPaths, mintedSessionWrites } from './ground-minted.mjs';
import { captureAndClearMintedSessions, describeGroundClear } from './ground-clear.mjs';

/**
 * `story-<id>-<case>` for every case of every FILL fork in `story.beats`.
 * Empty for a story with no fill fork (a door fork, or none at all) — see
 * `beats-fork.mjs`'s `isFillFork` for the classification.
 *
 * @param {{ground?: {project?: string}, beats: ReadonlyArray<object>}} story
 * @returns {string[]}
 */
export function perCaseGroundProjects(story) {
  const base = story.ground?.project;
  if (typeof base !== 'string' || base === '') return [];
  const names = new Set();
  for (const beat of story.beats ?? []) {
    if (beat.fork === undefined || !isFillFork(beat)) continue;
    for (const c of beat.fork.cases) names.add(`${base}-${c}`);
  }
  return [...names];
}

/**
 * `story-<id>-*` directories under `root/projects` that are NOT one of this
 * run's declared fork cases — T1 ruling 1350's ruling (2). Prefix ownership
 * (the trailing-sweep's own `story-<id>-*` glob, `sweep.mjs`) is broad on
 * purpose, so it can clean up whatever a fork ever minted; OWN-GROUND
 * containment is narrower — a directory in this namespace that this run did
 * not declare is unaccounted for and a breach, not a courtesy sweep target.
 *
 * @param {string} root
 * @param {{id: string}} story
 * @returns {string[]} sorted, never including a declared case
 */
export function undeclaredForkGrounds(root, story) {
  if (typeof story.id !== 'string' || story.id === '') return [];
  const prefixes = storyFixtureNames(story.id).map((n) => `${n}-`);
  let entries;
  try {
    entries = readdirSync(join(root, 'projects'));
  } catch {
    return []; // no projects/ dir at all: nothing to be undeclared
  }
  const declared = new Set(perCaseGroundProjects(story));
  return entries
    .filter((name) => prefixes.some((p) => name.startsWith(p)) && !declared.has(name))
    .sort();
}

/**
 * The pre-run manifest of every per-case ground — always `null`, because a
 * fill fork's own per-case grounds do not exist before the run creates them
 * (the base ground's `ownGroundBefore` is read the same way, at the same
 * moment, for the same reason).
 *
 * @returns {Map<string, {digest: string, files: Map<string,string>}|null>}
 */
export function snapshotForkGrounds(root, story) {
  return new Map(perCaseGroundProjects(story).map((p) => [p, ownGroundManifest(root, p)]));
}

/**
 * Judge ONE ground exactly as the base ground is judged: hash-diffed,
 * classified against `expectedChanges` (declared changes licensed the same
 * way), and its minted sessions captured and cleared.
 *
 * @returns {{project: string, before: object|null, after: object|null, split: object, clear: object}}
 */
export function judgeCaseGround({ root, project, before, mintedPaths, logsDir, expectedChanges, beatWindowChanges, storyId, runStamp }) {
  const groundDir = join(root, 'projects', project);
  const after = ownGroundManifest(root, project);
  const split = classifyOwnGroundDrift(
    groundChanges(before, after),
    mintedPaths,
    mintedSessionWrites(mintedPaths, logsDir, groundDir),
    groundIgnoreFromGit(groundDir),
    expectedChanges,
    beatWindowChanges,
  );
  const clear = captureAndClearMintedSessions({ root, project, storyId, runStamp, producedPaths: split.producedPaths });
  return { project, before, after, split, clear };
}

/** Console lines for one judged ground — the base ground's own wording, once per project. */
export function describeCaseGround({ project, before, after, split, clear }) {
  const lines = [];
  if (split.produced.length === 0 && split.undeclared.length === 0 && split.ignored.length === 0) {
    lines.push(`[stories] fork ground ${project}: unchanged — back at the hash it started from`);
  }
  for (const line of split.produced) lines.push(`[stories] fork ground ${project}: PRODUCED ${line}`);
  lines.push(
    `[stories] fork ground ${project}: IGNORED-BY-GROUND ${split.ignored.length} path(s) — ` +
    `unattributed and ignored by ${split.ignoreSource}; reported, never red`,
  );
  for (const line of split.ignored) lines.push(`[stories] fork ground ${project}: ignored-born ${line}`);
  for (const line of split.declared) lines.push(`[stories] fork ground ${project}: DECLARED ${line}`);
  for (const line of split.unmatchedDeclarations) lines.push(`[stories] fork ground ${project}: DECLARATION UNMATCHED ${line}`);
  for (const line of split.undeclared) lines.push(`[stories] fork ground ${project}: UNDECLARED ${line}`);
  for (const line of describeGroundClear(clear, project)) lines.push(`[stories] fork ground ${project}: ${line}`);
  if (clear.cleared.length > 0) {
    if (after !== null && before !== null && after.digest === before.digest) {
      lines.push(`[stories] fork ground ${project}: RESTORED ${after.digest} — byte-identical to the hash it started from`);
    } else {
      const still = groundChanges(before, after);
      lines.push(
        `[stories] fork ground ${project}: STILL DIFFERS ${after?.digest ?? 'UNREADABLE'} vs ${before?.digest ?? '(absent)'} — ` +
        `+${still.added.length} -${still.removed.length} ~${still.modified.length} remain after the clear`,
      );
    }
  }
  return lines;
}

/**
 * Judge every ground a fill fork minted, plus the ruling-(2) breach check —
 * ONE result the runner can print and gate on with a couple of lines, so
 * `run-story.mjs` (at the 800-line hard cap) grows by a call, not a loop.
 *
 * @returns {{lines: string[], redReason: string|null}} `redReason` is the
 *   FIRST containment failure found, in the same wording style the base
 *   ground's own verdict checks use — never more than one, because the run
 *   is red on any one of them regardless of the others.
 */
export function judgeForkGrounds({ root, story, before, logsBefore, logsDir, runStamp }) {
  const lines = [];
  let redReason = null;

  const rogue = undeclaredForkGrounds(root, story);
  if (rogue.length > 0) {
    lines.push(
      `[stories] fork grounds: UNDECLARED ${rogue.join(', ')} — carries this story's prefix but is not one ` +
      'of this run\'s declared fork cases',
    );
    redReason ??=
      `CONTAINMENT FAILURE — ${rogue.length} fork-case ground(s) exist that are not one of this run's declared ` +
      `cases (${rogue.join(', ')}). The run is RED regardless of its beats.`;
  }

  const projects = perCaseGroundProjects(story);
  if (projects.length === 0) return { lines, redReason };

  const logsAfter = readdirSync(logsDir, { withFileTypes: true }).map((e) => e.name);
  const mintedPaths = mintedSessionPaths(logsBefore, logsAfter, logsDir);
  const expectedChanges = story.ground?.expectedChanges ?? [];

  for (const project of projects) {
    const result = judgeCaseGround({
      root, project, before: before.get(project) ?? null, mintedPaths, logsDir,
      expectedChanges, beatWindowChanges: new Map(), storyId: story.id, runStamp,
    });
    lines.push(...describeCaseGround(result));
    if (redReason === null && result.split.undeclared.length > 0) {
      redReason =
        `CONTAINMENT FAILURE — ${result.split.undeclared.length} change(s) in projects/${project} that nothing ` +
        'this run minted accounts for (named above). The run is RED regardless of its beats.';
    }
    if (redReason === null && (result.split.unmatchedDeclarations ?? []).length > 0) {
      redReason =
        `DECLARATION UNMATCHED — ${result.split.unmatchedDeclarations.length} ground change(s) this story ` +
        `declares its product makes did not happen in projects/${project} (named above). The run is RED ` +
        'regardless of its beats.';
    }
    if (redReason === null && result.clear.unremoved.length > 0) {
      redReason =
        `CONTAINMENT FAILURE — ${result.clear.unremoved.length} session(s) this run minted are STILL in ` +
        `projects/${project} after being captured and removed (${result.clear.unremoved.join(', ')}). The next ` +
        'run will refuse on the ground hash. The run is RED regardless of its beats.';
    }
  }
  return { lines, redReason };
}
