/**
 * artifact-paths.mjs — a story artifact records the PRODUCT, never the checkout
 * that ran it (`forge-8vfn.26`).
 *
 * WHAT WENT WRONG. The costless stories left ten committed files dirty after a
 * green run, and one of the three causes was `story.json` carrying absolute
 * worktree paths:
 *
 *     "removed": ["/home/parso/forge-m6-c/projects/story-proof",
 *                 "/home/parso/forge-m6-c/brain/projects/story-proof"]
 *
 * and the same two again inside `sweep.lines`. Committing that writes one
 * lane's checkout path into a permanent repo artifact. It is the same rule as
 * "a permanent artifact never cites a path inside the campaign dir", one
 * directory along — and unlike the campaign-dir case nothing checked for it.
 *
 * WHY THE WHOLE ARTIFACT AND NOT THE THREE KNOWN KEYS. `sweep`, `claim` and
 * `fence` are the emitters that leak TODAY. A guard keyed on those three passes
 * the next emitter someone adds, and it passes it SILENTLY — the artifact is
 * written, committed, and the next lane's diff is the only thing that notices.
 * So this walks every string in the object.
 *
 * AND IT REFUSES RATHER THAN ONLY REWRITING. A relativiser alone would be a
 * best-effort tidy: anything it failed to recognise would be written out with
 * the lane's path still in it and nothing said. The rewrite is the repair; the
 * refusal is the guard, and the refusal is the half that cannot rot — it fails
 * on a path shape this file has never seen, which is precisely the case a list
 * of keys cannot cover.
 */

import { sep } from 'node:path';

/** Strings that name a place on the machine that ran the story. Deliberately
 *  NOT "starts with a slash": `/api/health` and `/projects/mdtoc` are routes,
 *  and a guard that refused those would be refusing the artifact's own subject.
 *  These are the roots a checkout actually sits under. */
const MACHINE_ROOTS = /(^|[\s"'([<])(\/home\/|\/Users\/|\/root\/|\/tmp\/|\/var\/folders\/|\/private\/var\/)/;

/** Deep-walk `value`, replacing `root` with a worktree-relative form wherever it
 *  appears INSIDE a string — not only as a prefix, because `sweep.lines` embeds
 *  the path in prose ("[stories] trailing sweep removed <path>").
 *  Arrays and plain objects are rebuilt; everything else is returned as it is. */
export function relativiseToRoot(value, root) {
  const rootSlash = root.endsWith('/') ? root : `${root}/`;
  const walk = (v) => {
    if (typeof v === 'string') return v.split(rootSlash).join('').split(root).join('.');
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value);
}

/**
 * Every place in `value` that still names a machine path, as `path.to.key` plus
 * the offending string. Empty means the artifact is portable.
 * @returns {Array<{at: string, text: string}>}
 */
export function machinePathsIn(value) {
  const found = [];
  const walk = (v, at) => {
    if (typeof v === 'string') {
      if (MACHINE_ROOTS.test(v)) found.push({ at, text: v });
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${at}[${i}]`)); return; }
    if (v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      for (const [k, x] of Object.entries(v)) walk(x, at === '' ? k : `${at}.${k}`);
    }
  };
  walk(value, '');
  return found;
}

/** The artifact as it should be written, or a throw naming what could not be
 *  made portable. The caller writes only what this returns. */
export function portableArtifact(value, root) {
  const out = relativiseToRoot(value, root);
  const left = machinePathsIn(out);
  if (left.length > 0) {
    const shown = left.slice(0, 5).map((f) => `  ${f.at}: ${f.text}`).join('\n');
    throw new Error(
      `story artifact still names this machine after relativising against ${root} — `
        + `${left.length} place(s), so it would record the checkout rather than the product `
        + `(forge-8vfn.26):\n${shown}${left.length > 5 ? `\n  …and ${left.length - 5} more` : ''}`,
    );
  }
  return out;
}

/**
 * Make the ATTRIBUTED sibling-worktree escapes portable — `forge-8vfn.7.6.120`,
 * T1 ruling 1093a.
 *
 * `siblingWorktreeEscapes` reports growth in a tree somebody else is working in
 * as not-red (ruling 340), then writes `root` and `live.cwd` absolute, and
 * `MACHINE_ROOTS` refuses the artifact. So a green costed run wrote NOTHING
 * whenever a neighbour touched one file: S9 run 7 went 16/16 for $0.4567 and
 * produced no artifact, naming `/home/parso/forge-m6-c`.
 *
 * WHY HERE AND NOT IN `siblingWorktreeEscapes`. The run LOG must keep the full
 * paths — `describeFence` prints from that structure, and it is the operator's
 * only full-fidelity record of who was in which tree. Stripping at source would
 * destroy the log to fix the artifact. So this runs at artifact assembly, AFTER
 * logging, and `portableArtifact` stays untouched as the backstop: if this
 * function ever misses a field the artifact still REFUSES rather than shipping a
 * machine path.
 *
 * AN UNATTRIBUTED ESCAPE IS LEFT EXACTLY AS IT IS. `live === null` is what
 * `unownedEscapes` filters on to end the run. Tidying those would let a real
 * containment breach serialise portably and ship — the failure mode of this
 * whole change, and the reason the test for it is the one that matters.
 */
export function portableFenceEscapes(escapes) {
  if (!Array.isArray(escapes)) return escapes;
  return escapes.map((e) => {
    // Unattributed: untouched, on purpose. It must still reach the refusal.
    if (!e || typeof e !== 'object' || e.live == null) return e;

    // REFUSE TO TRANSFORM WHAT WE CANNOT READ, rather than emitting an empty
    // string. `root: ""` would sail through `machinePathsIn` — portable-looking
    // and naming no sibling at all: a record that reconciles perfectly because
    // it is empty. Left untouched, a malformed escape reaches the backstop
    // instead, which is the direction an unreadable input must always resolve
    // (§15.504). Not reachable from `readlinkSync` today; this is about which
    // way it fails if it ever is.
    const root = typeof e.root === 'string' ? e.root : '';
    const base = root.split(sep).filter(Boolean).pop() ?? '';
    if (root === '' || base === '' || typeof e.live.cwd !== 'string') return e;

    // `liveProcessRoots` matches by PREFIX, so a cwd BELOW the sibling root is
    // the normal case. Keep the remainder: "somebody was working in
    // scripts/stories of that tree" is a stronger finding than "in that tree",
    // and collapsing it would be a true statement that loses information.
    const cwdAbs = e.live.cwd;
    let cwdRel = '.';
    if (cwdAbs !== root) {
      cwdRel = cwdAbs.startsWith(`${root}${sep}`) ? cwdAbs.slice(root.length + 1) : cwdAbs;
    }

    return {
      ...e,
      root: base,
      // ONE FRAME PER FIELD. A bare `forge-m6-c` is otherwise indistinguishable
      // from a path relative to the RUN root; naming the frame beats a
      // convention someone downstream has to remember.
      rootKind: 'sibling-basename',
      live: { ...e.live, cwd: cwdRel, cwdKind: 'relative-to-sibling-root' },
    };
  });
}
