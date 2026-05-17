/**
 * Reflector moved-manifest bridge for the chained bench.
 *
 * THE BUG (a chained-harness false-red — NOT a forge bug):
 *
 *   orchestrator/phases/reflector.ts computes
 *     forgeRoot = resolve(import.meta.dirname, '..', '..')
 *   which is the REAL forge root (`/home/parso/forge`), NOT the chained
 *   tempdir — and we cannot change the orchestrator runtime. It then does
 *     manifestPath = resolveCurrentManifestPath(input.manifestPath, forgeRoot)
 *   where `input.manifestPath` is the tempdir in-flight path.
 *
 *   On a merged cycle the closure step (orchestrator/phases/closure.ts) has
 *   ALREADY moved the manifest `_queue/in-flight/` → `_queue/done/` *inside
 *   the tempdir* (events: `closure.manifest-moved-to-done`), and reflection
 *   runs immediately after, still inside the same `runCycle`. So when the
 *   reflector resolves the manifest:
 *     - `existsSync(<tempdir in-flight path>)` is false (closure moved it),
 *     - it falls back to `<REAL forge root>/_queue/{done,ready-for-review,
 *       failed}/<id>.md` — all miss, because the manifest is in the
 *       *tempdir* done/, not the real-forge done/.
 *   → `reflector.manifest-unreadable` ENOENT, reflection scored as errored,
 *   even though closure genuinely succeeded.
 *
 * THE FIX (same class + leave-no-residue discipline as the existing sdk.ts
 * cycle-log / user-feedback bridge): make the manifest the reflector's OWN
 * `resolveCurrentManifestPath(input.manifestPath, realForgeRoot)` will look
 * for resolvable under the REAL forge root by mirroring the tempdir queue
 * there with SYMLINKS.
 *
 *   - For every queue dir the reflector's resolver inspects (done first, then
 *     the defensive fallbacks ready-for-review / in-flight / pending — the
 *     SAME precedence the reflector and the chained reflection caseScore
 *     use), place a symlink
 *         <realForgeRoot>/_queue/<dir>/<id>.md → <tempdir>/_queue/<dir>/<id>.md
 *     *unconditionally* (the tempdir target need not exist yet).
 *   - Symlink-to-target semantics (verified): `existsSync(link)` is false
 *     while the target is absent and flips to true the instant the target
 *     appears. The bridge is installed BEFORE `runCycle`; closure moves the
 *     manifest into the tempdir `done/` *during* `runCycle`; the matching
 *     real-forge `done/` symlink therefore resolves at exactly the moment
 *     the reflector runs — zero copy, zero staleness, and it correctly
 *     tracks WHICHEVER queue dir the manifest ends up in (done on the merged
 *     path; the fallbacks defend the rest) because the resolver scans them
 *     in precedence order and only a link whose target exists resolves.
 *   - We NEVER clobber real forge state: a real (non-symlink) file or a
 *     foreign symlink already at a bridge path is left untouched and that
 *     dir is skipped.
 *   - `removeReflectorManifestBridge` deletes ONLY the links we created and
 *     ONLY empty parent dirs we created — the real forge `_queue/` is
 *     byte-identical afterwards.
 *
 * Path semantics reuse `orchestrator/queue.ts:getPaths` so this stays in
 * lockstep with the queue layout (no reimplementation).
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { resolve } from 'node:path';

import { getPaths } from '../../orchestrator/queue.ts';

/**
 * Queue dirs to mirror, in the SAME precedence the reflector's
 * `resolveCurrentManifestPath` + the chained reflection caseScore use:
 * done first (the merged-cycle location), then the defensive fallbacks.
 */
const QUEUE_PRECEDENCE = ['done', 'ready-for-review', 'in-flight', 'pending'] as const;
type BridgedQueueDir = (typeof QUEUE_PRECEDENCE)[number];

const DIR_KEY: Record<BridgedQueueDir, keyof ReturnType<typeof getPaths>> = {
  done: 'done',
  'ready-for-review': 'readyForReview',
  'in-flight': 'inFlight',
  pending: 'pending',
};

export type BridgedLink = { link: string; target: string };

export type ReflectorManifestBridge = {
  /** The symlinks we created under the real forge root (reflector reads these). */
  links: BridgedLink[];
  /** Parent dirs we created (empty before) — removed on cleanup if still empty. */
  createdDirs: string[];
  /**
   * The link the reflector's resolver would pick FIRST given current target
   * existence (done > ready-for-review > in-flight > pending). `null` until
   * some target exists. Test/diagnostic affordance — the runtime reflector
   * does its own resolution; this just lets a caller assert the wiring.
   */
  readonly resolvedPath: string | null;
};

export type BridgeInput = {
  /** The chained tempdir (its `_queue/` holds the real manifest). */
  tempdir: string;
  /** Initiative id → `<id>.md` filename. */
  initiativeId: string;
  /**
   * The in-flight manifest path the cycle was started with. Kept in the
   * signature for call-site clarity / future-proofing; the filename is
   * derived from `initiativeId` (they are the same `<id>.md`).
   */
  inFlightManifestPath: string;
  /** The REAL forge root the reflector is anchored at. */
  realForgeRoot: string;
};

/**
 * Install the bridge: for each queue dir (in precedence order) symlink the
 * real-forge `<dir>/<id>.md` to the tempdir `<dir>/<id>.md` (target need not
 * exist yet). Returns the handle (always non-null unless every candidate dir
 * was blocked by pre-existing real forge state, in which case `null`).
 */
export function bridgeMovedManifestForReflector(
  input: BridgeInput,
): ReflectorManifestBridge | null {
  const filename = `${input.initiativeId}.md`;
  const tempPaths = getPaths(resolve(input.tempdir, '_queue'));
  const realPaths = getPaths(resolve(input.realForgeRoot, '_queue'));

  const links: BridgedLink[] = [];
  const createdDirs: string[] = [];

  for (const dir of QUEUE_PRECEDENCE) {
    const key = DIR_KEY[dir];
    const target = resolve(tempPaths[key], filename);
    const link = resolve(realPaths[key], filename);

    if (existsSync(link) || isSymlink(link)) {
      // Our own link (idempotent re-install) → keep; foreign/real → skip
      // this dir (NEVER clobber real forge state).
      if (isSymlink(link) && readLinkTarget(link) === target) {
        links.push({ link, target });
      }
      continue;
    }

    const parent = resolve(link, '..');
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
      createdDirs.push(parent);
    }
    try {
      symlinkSync(target, link);
      links.push({ link, target });
    } catch {
      /* best-effort — a dir we can't link just won't bridge */
    }
  }

  if (links.length === 0) return null;

  return {
    links,
    createdDirs,
    get resolvedPath(): string | null {
      // Mirror resolveCurrentManifestPath: first link whose target exists,
      // in precedence order.
      for (const dir of QUEUE_PRECEDENCE) {
        const key = DIR_KEY[dir];
        const link = resolve(realPaths[key], filename);
        const hit = links.find((l) => l.link === link);
        if (hit && existsSync(hit.target)) return hit.link;
      }
      return null;
    },
  };
}

/**
 * Remove ONLY the links we created and ONLY empty parent dirs we created.
 * Idempotent and defensive — always safe to call in a `finally`. Mirrors the
 * brain mask / cycle-log bridge's leave-no-residue guarantee: the real forge
 * `_queue/` is byte-identical afterwards.
 */
export function removeReflectorManifestBridge(
  bridge: ReflectorManifestBridge | null,
): void {
  if (!bridge) return;
  for (const { link } of bridge.links) {
    try {
      if (isSymlink(link)) unlinkSync(link);
    } catch {
      /* best-effort */
    }
  }
  for (const dir of [...bridge.createdDirs].reverse()) {
    try {
      if (existsSync(dir) && isEmptyDir(dir)) {
        rmSync(dir, { recursive: false, force: true });
      }
    } catch {
      /* best-effort */
    }
  }
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function readLinkTarget(p: string): string | null {
  try {
    return readlinkSync(p);
  } catch {
    return null;
  }
}

function isEmptyDir(p: string): boolean {
  try {
    return readdirSync(p).length === 0;
  } catch {
    return false;
  }
}
