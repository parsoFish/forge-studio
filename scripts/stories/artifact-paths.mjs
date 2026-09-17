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
