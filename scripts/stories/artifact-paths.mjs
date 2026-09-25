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
 * AN ESCAPE THAT WILL RED THE RUN IS LEFT EXACTLY AS IT IS. Under T1 ruling
 * 1225, that is `owner === 'this-run'` when `attributeEscapes`
 * (`fence-attribution.mjs`) has already run — the field this function now
 * TRUSTS OVER `live` whenever it is present, because ruling 1225's whole point
 * is that "no live owner" (`live === null`) is no longer evidence of red on
 * its own (A's S10 run 24: an APPEARED tree with nobody live in it is
 * UNATTRIBUTABLE, not fatal, and must still reach a written artifact). A
 * caller that never attributed (the pre-1225 shape, kept so this function's
 * own contract does not silently change under an old input) falls back to the
 * original `live == null` test. Tidying a truly fatal escape would let a real
 * containment breach serialise portably and ship — the failure mode of this
 * whole function, and the reason the test for it is the one that matters.
 */
export function portableFenceEscapes(escapes) {
  if (!Array.isArray(escapes)) return escapes;
  return escapes.map((e) => {
    if (!e || typeof e !== 'object') return e;
    const willRedTheRun = e.owner !== undefined ? e.owner === 'this-run' : e.live == null;
    if (willRedTheRun) return e; // left exactly as it is — must still reach the refusal below

    // REFUSE TO TRANSFORM WHAT WE CANNOT READ, rather than emitting an empty
    // string. `root: ""` would sail through `machinePathsIn` — portable-looking
    // and naming no sibling at all: a record that reconciles perfectly because
    // it is empty. Left untouched, a malformed escape reaches the backstop
    // instead, which is the direction an unreadable input must always resolve
    // (§15.504). Not reachable from `readlinkSync` today; this is about which
    // way it fails if it ever is.
    const root = typeof e.root === 'string' ? e.root : '';
    const base = root.split(sep).filter(Boolean).pop() ?? '';
    if (root === '' || base === '') return e;
    // `reason` (T1 ruling 1225) is prose that NAMES `root` — the same
    // "replaced inside prose" discipline `relativiseToRoot` already uses for
    // `sweep.lines`, applied here so an UNATTRIBUTABLE escape's own reason
    // does not reintroduce the machine path this function exists to remove.
    const portableReason = typeof e.reason === 'string' ? { reason: e.reason.split(root).join(base) } : {};

    // No live process to relativise against at all — ruling 1225's own
    // UNATTRIBUTABLE-with-no-live-process case. Only `root` (and `reason`)
    // need to become portable; there is no `cwd` to carry a relation from.
    if (e.live === null) return { ...e, root: base, rootKind: 'sibling-basename', ...portableReason };
    // Absent, or present but missing a readable `cwd`: a malformed escape,
    // passed through UNTOUCHED (never stamped portable) rather than guessed —
    // the `rootKind` field is a CLAIM ("this was made safe") that an
    // unreadable input must never earn.
    if (e.live == null || typeof e.live.cwd !== 'string') return e;

    // `liveProcessRoots` matches by PREFIX, so a cwd BELOW the sibling root is
    // the normal case. Keep the remainder: "somebody was working in
    // scripts/stories of that tree" is a stronger finding than "in that tree",
    // and collapsing it would be a true statement that loses information.
    const cwdAbs = e.live.cwd;
    let cwdRel = '.';
    if (cwdAbs !== root) {
      // THE `else` HERE IS UNREACHABLE TODAY, and that is worth writing down
      // rather than leaving for someone to discover: `liveProcessRoots` only
      // records a root when `cwd === resolved || cwd.startsWith(resolved + sep)`
      // (`sweep.mjs`), so a cwd that is neither the root nor under it never
      // reaches this function attributed.
      //
      // It falls through ABSOLUTE on purpose. That lands on `portableArtifact`
      // and refuses the artifact — the same symptom this bead exists to remove,
      // but in the safe direction: a refusal that can be read beats a portable
      // record of a relation nobody can explain. NOT doored, deliberately —
      // a door would promise "this is contractually refused" where the truth is
      // "this cannot currently happen" (C, on review of #771).
      cwdRel = cwdAbs.startsWith(`${root}${sep}`) ? cwdAbs.slice(root.length + 1) : cwdAbs;
    }

    // BASENAME COLLISION, named because the trade should live in the record and
    // not only in the head of whoever made it (C, review of #771). Two siblings
    // with the same basename — possible only across different parents — collapse
    // to one string here. The pid below disambiguates them, and the run log
    // keeps both full paths. Accepted over a `../` relative form, which encodes
    // the assumption that both trees share a parent and becomes
    // `../../../mnt/x/…` the first time that is false: a machine path in
    // disguise, past a check matching only a LEADING `/home/`.
    return {
      ...e,
      root: base,
      // ONE FRAME PER FIELD. A bare `forge-m6-c` is otherwise indistinguishable
      // from a path relative to the RUN root; naming the frame beats a
      // convention someone downstream has to remember.
      rootKind: 'sibling-basename',
      live: { ...e.live, cwd: cwdRel, cwdKind: 'relative-to-sibling-root' },
      ...portableReason,
    };
  });
}

/** The `_logs/` segment every reap `dir` is built around: `<root>/_logs/<entry>`. */
const LOGS_SEGMENT = `${sep}_logs${sep}`;

/**
 * Make the reap ledger's `dir` fields portable — `forge-8vfn.7.6.125`.
 *
 * THE SECOND SEAM. 7.6.120 fixed `fence.escapes`; the reap ledger still named
 * other checkouts, so S2, S3 and S5 could not be regenerated at all —
 * `portableArtifact` over the committed `demos/stories/S3/story.json` throws on
 * `reap.reaped[].dir`.
 *
 * THE SPLIT IS OWN ROOT vs FOREIGN ROOT, not attributed vs unattributed. The
 * 7.6.120 shape does not map: `reaped` and `skipped` always carry a pid,
 * `cancelled` never does, and S2 and S5 carry a machine path in BOTH — so a
 * pid-based split would leave `cancelled` absolute and those two still
 * unwritable.
 *
 * AN OWN-ROOT ENTRY IS RETURNED UNTOUCHED. Twelve of the twenty-one committed
 * `dir` fields are already `_logs/…`, the form `relativiseToRoot` leaves behind,
 * and six artifacts depend on it. Stamping those would churn stories nobody
 * touched.
 *
 * `dirRoot` IS LOAD-BEARING. Without it a foreign `_logs/x` and an own
 * `_logs/x` serialise identically, quietly asserting another lane's reaped
 * process was this run's own — two facts sharing one representation. Its
 * ABSENCE is the signal for "the run's own tree".
 */
export function portableReapEntries(entries, root) {
  if (!Array.isArray(entries)) return entries;
  const rootSlash = root.endsWith(sep) ? root : `${root}${sep}`;
  return entries.map((e) => {
    if (!e || typeof e !== 'object' || typeof e.dir !== 'string') return e;
    const dir = e.dir;
    if (!dir.startsWith('/')) return e;                 // already relative: the working shape
    if (dir.startsWith(rootSlash)) {                    // our own tree, no sibling to name
      return { ...e, dir: dir.slice(rootSlash.length) };
    }
    const at = dir.indexOf(LOGS_SEGMENT);
    // Cannot decompose it — leave it ABSOLUTE for the backstop to refuse. A
    // `dirRoot` on a path we could not read would be a claim we cannot support,
    // which is the one thing this must never emit (§15.504).
    if (at === -1) return e;
    const base = dir.slice(0, at).split(sep).filter(Boolean).pop();
    if (!base) return e;
    return {
      ...e,
      dir: dir.slice(at + 1),                           // `_logs/<entry>`, one frame
      dirRoot: base,
      dirRootKind: 'sibling-basename',
    };
  });
}

/**
 * Make the sweep ledger's paths portable — `forge-8vfn.7.6.127`, the third seam.
 *
 * After 7.6.125 the committed S2 artifact is STILL unwritable:
 * `portableArtifact` throws on `sweep.removed[0..1]`.
 *
 * THE SHAPE PROBLEM IS DIFFERENT HERE. `sweep.removed` is a `string[]`, so
 * there is no sibling field to carry a root the way `fence.escapes[].root` and
 * `reap.*[].dirRoot` do. Naming the frame per element would mean concatenating
 * basename and remainder into one string — the two-frames-in-one-field defect
 * caught on review of 7.6.120. So the frame is named ONCE FOR THE ARRAY and
 * each element stays a single frame.
 *
 * THAT SHAPE CANNOT EXPRESS TWO DIFFERENT FOREIGN ROOTS, and it does not
 * pretend to: the mixed case is left ABSOLUTE for `portableArtifact` to refuse.
 * A schema that cannot say the true thing must not be made to say a convenient
 * one. Every artifact today has at most one foreign sweep root, so this refuses
 * nothing that currently writes.
 *
 * `claim.claimed[]` holds OBJECTS, so it takes 7.6.125's per-element frame
 * (`pathRoot` / `pathRootKind`) unchanged.
 *
 * `lines` and `claim.lines` are PROSE. `relativiseToRoot` already removes the
 * run's own root from inside them; a foreign root in prose is left alone and
 * refuses, which is the safe direction and is why this does not touch them.
 */
export function portableSweepPaths(sweep, root) {
  if (!sweep || typeof sweep !== 'object') return sweep;
  const rootSlash = root.endsWith(sep) ? root : `${root}${sep}`;
  // A SIBLING SHARES THE RUN ROOT'S PARENT. Deriving the foreign root that way
  // rather than by counting path segments: segment counting encodes where this
  // box happens to keep its checkouts, and would read `/home/parso` as the root
  // on this machine and something else on another.
  const parent = root.slice(0, root.lastIndexOf(sep));
  const parentSlash = `${parent}${sep}`;
  /** The sibling worktree root of an absolute foreign path, or null if it is
   *  not a sibling at all — in which case it stays absolute and is refused. */
  const siblingRootOf = (p) => {
    if (typeof p !== 'string' || !p.startsWith(parentSlash)) return null;
    const rest = p.slice(parentSlash.length);
    const cut = rest.indexOf(sep);
    return cut === -1 ? null : `${parentSlash}${rest.slice(0, cut)}`;
  };
  const out = { ...sweep };

  if (Array.isArray(sweep.removed)) {
    const own = sweep.removed.map((p) =>
      (typeof p === 'string' && p.startsWith(rootSlash)) ? p.slice(rootSlash.length) : p);
    const foreign = own.filter((p) => typeof p === 'string' && p.startsWith('/'));
    if (foreign.length === 0) {
      out.removed = own;
    } else {
      // Every foreign element must share ONE root, or the array's single frame
      // would describe only some of them.
      const roots = new Set(foreign.map(siblingRootOf));
      if (roots.size === 1 && !roots.has(null)) {
        const [r] = [...roots];
        out.removed = own.map((p) =>
          (typeof p === 'string' && p.startsWith(`${r}${sep}`)) ? p.slice(r.length + 1) : p);
        out.removedRoot = r.split(sep).filter(Boolean).pop();
        out.removedRootKind = 'sibling-basename';
      } else {
        out.removed = sweep.removed;   // unrepresentable in one frame: leave for the refusal
      }
    }
  }

  if (sweep.claim && typeof sweep.claim === 'object' && Array.isArray(sweep.claim.claimed)) {
    out.claim = {
      ...sweep.claim,
      claimed: sweep.claim.claimed.map((c) => {
        if (!c || typeof c !== 'object' || typeof c.path !== 'string') return c;
        if (!c.path.startsWith('/')) return c;
        if (c.path.startsWith(rootSlash)) return { ...c, path: c.path.slice(rootSlash.length) };
        const r = siblingRootOf(c.path);
        if (r === null) return c;                       // not a sibling: refuse, never guess
        return {
          ...c,
          path: c.path.slice(r.length + 1),
          pathRoot: r.split(sep).filter(Boolean).pop(),
          pathRootKind: 'sibling-basename',
        };
      }),
    };
  }
  return out;
}
