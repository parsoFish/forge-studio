/**
 * gallery.mjs — the demo gallery, derived and never hand-edited.
 *
 * Each run writes its own `demos/stories/<id>/story.json`; the index is then
 * derived by reading every `story.json` on disk. That is what makes
 * `--story smoke` safe: a single-story run refreshes one story's data and
 * still renders a complete index, where a wholesale regeneration would drop
 * the rows it did not execute.
 *
 * A story's `status` is DERIVED from its beats and is never stored as its own
 * field — the campaign's standing cure for `declared-data-fails-open`: derive
 * the value from its source of truth and give the object no field to hold a
 * stale copy in.
 *
 * The gallery is both the demo and the regression report, so a red story is
 * shown red. A failing story displayed as if it passed makes the demo a lie.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** git's `-z` record separator. NAMED, and written as a unicode escape:
 *  a bare `\0` in this position was turned into a RAW NUL BYTE by an editing
 *  layer above the file, which `node --check` accepted and which then made
 *  every ignore-aware grep skip this file as binary. The name also says what
 *  it is at the use site, which the escape never did. */
const NUL = '\u0000';
import { portableArtifact, portableFenceEscapes, portableReapEntries, portableSweepPaths } from './artifact-paths.mjs';
import { shortDigest, staleArtifacts } from './artifact-staleness.mjs';

/** `git rev-parse HEAD` in `root`, or `null` when it cannot be read (a
 *  refusal here would stop every run over a checkout mid-rebase or shallow
 *  in a way this artifact's provenance does not need to be strict about —
 *  the READER (`artifact-staleness.mjs`) already treats a missing/unknown
 *  sha as its own named case rather than a crash). */
function defaultGitSha(root) {
  const res = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return res.error === undefined && res.status === 0 ? res.stdout.trim() : null;
}

/** The three trees a story RUN writes to, excluded from the dirty check below
 *  — the pathspec `git status --porcelain -- . ':!demos/stories'
 *  ':!docs/tutorials' ':!docs/how-to'` uses. */
const GENERATED_TREES = ['demos/stories', 'docs/tutorials', 'docs/how-to'];

/**
 * Whether `root`'s working tree has uncommitted changes, or `null` when that
 * cannot be determined. SCOPED, excluding `GENERATED_TREES` (coordinator
 * review): an unscoped status sees every artifact an EARLIER beat in the same
 * run already wrote — its own story.json, frames and generated doc — so on
 * any multi-story run every story after the first would read `dirty: true`
 * for output nothing an operator touched. `git.dirty` exists to answer "did
 * the checkout have uncommitted SOURCE changes", not "has this run's own
 * prior beat written its own output yet".
 *
 * `run` is INJECTED (default the real `spawnSync`) so a test can assert the
 * exact pathspec without needing a real recording of the confound.
 */
export function defaultGitDirty(root, { run = spawnSync } = {}) {
  const res = run('git', ['-C', root, 'status', '--porcelain', '--', '.', ...GENERATED_TREES.map((t) => `:!${t}`)], {
    encoding: 'utf8',
  });
  return res.error === undefined && res.status === 0 ? res.stdout.trim().length > 0 : null;
}

/**
 * Findings row 56 + row 14 (T1 ruling 1283, option B) — whatever spend figure
 * the RUN ALREADY carries into this writer. MEASURED: today's `result` from
 * `run-story.mjs` is the literal `{ story, beats, reap, sweep, fence }` —
 * `summariseRunSpend`'s result is computed there but never attached to it,
 * and this brief forbids editing that file to add it. Rather than reach past
 * that boundary, this reads `result.spend` IF a future caller ever adds it
 * (kept forward-compatible with `summariseRunSpend`'s own `{measured, usd,
 * label}` shape) and writes the HONEST GAP otherwise — never a bare `$0`,
 * which would read as "nothing was spent" when nobody looked
 * (`spend.mjs`'s own UNMEASURED case exists to prevent exactly that
 * conflation).
 */
function spendFieldFor(result) {
  const s = result.spend;
  if (s !== null && typeof s === 'object' && typeof s.usd !== 'undefined') {
    return Object.freeze({ usd: s.usd, unmeasured: s.measured === false ? (s.label ?? true) : false });
  }
  return Object.freeze({ usd: null, unmeasured: 'not passed to the artifact writer' });
}

/**
 * Derive one index row from a completed run result.
 *
 * `clip` is ALWAYS `<id>/story.webm` (forge-8vfn.2.34, REVISED). An earlier
 * pass made it existence-checked against disk — the webm is gitignored
 * (`.gitignore:191-195`), so a fresh clone or CI has none — but that only
 * fixed the dead-`<video>` problem for whichever row path opted into the
 * check, and the COMMITTED `demos/stories/index.html` (what a fresh clone
 * actually sees) never did, so it kept linking to a file nobody has, forever.
 * `firstFrame` is what actually fixes it: frames ARE tracked, so
 * `renderGalleryIndex` gives the `<video>` a real `poster` instead of the
 * browser's empty-player placeholder — bytes that depend only on what THIS
 * run captured, never on what happens to be on whatever disk generated them.
 */
export function storyRowFrom(result) {
  const beats = result.beats ?? [];
  const greenBeats = beats.filter((b) => b.status === 'green').length;
  // An empty story is not green: `every` is vacuously true on an empty array,
  // which would report a story that ran nothing as a passing story.
  const status = beats.length > 0 && greenBeats === beats.length ? 'green' : 'red';
  const firstFrameRelative = beats[0]?.frame;
  return Object.freeze({
    id: result.story.id,
    title: result.story.docs.title,
    status,
    beats: beats.length,
    greenBeats,
    clip: `${result.story.id}/story.webm`,
    // Frames ARE tracked (unlike the clip), so this is what actually fixes
    // the fresh-clone problem: `renderGalleryIndex` gives the `<video>` a real
    // `poster` instead of the browser's empty-player placeholder.
    firstFrame:
      typeof firstFrameRelative === 'string' && firstFrameRelative !== ''
        ? `${result.story.id}/${firstFrameRelative}`
        : null,
  });
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The row's media: ALWAYS a `<video>` (forge-8vfn.2.34, REVISED) — never
 *  conditional on disk, so the generator and the committed index can never
 *  disagree about what to render. A `poster` of the first captured frame is
 *  added when one is known, so a checkout without the gitignored webm shows a
 *  real picture instead of the browser's empty-player placeholder. */
function mediaFor(row) {
  const poster = row.firstFrame ? ` poster="${esc(row.firstFrame)}"` : '';
  return `<video src="${esc(row.clip)}"${poster} autoplay loop muted playsinline></video>`;
}

/**
 * Render the index page. Pure — sorted by id so regeneration is stable.
 *
 * `row.stale` — a reason string or `null`/absent (findings row 56 + row 14,
 * T1 ruling 1283 option B), set by BOTH `galleryRowsFrom` and
 * `committedGalleryRows` — marks a named row with a visible badge instead of
 * presenting it as current. Reading it FROM THE ROW rather than a second
 * argument is deliberate: an earlier pass took a `stale` list here, and only
 * the disk-generation caller ever computed one, so the pinned repo-door check
 * (which renders `committedGalleryRows`' rows with no such list) disagreed
 * with the very first real run's output. Two callers computing the same field
 * on the same row is a question renderGalleryIndex cannot get wrong by taking
 * no side in it.
 */
export function renderGalleryIndex(rows) {
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const cards = sorted
    .map((r) => {
      const badge = r.stale ? `\n    <p class="stale-badge">${esc(r.stale)}</p>` : '';
      return `  <section class="story ${esc(r.status)}">
    <h2>${esc(r.id)} — ${esc(r.title)}</h2>
    <p class="verdict ${esc(r.status)}">${esc(r.status)} · ${r.greenBeats}/${r.beats} beats green</p>${badge}
    ${mediaFor(r)}
  </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Forge Studio — operator stories</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 0; padding: 2rem; background: #f7f7f8; color: #14151a; }
  .story { background: #fff; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; border-left: 4px solid #999; }
  .story.green { border-left-color: #1a7f37; }
  .story.red { border-left-color: #cf222e; }
  .verdict.green { color: #1a7f37; }
  .verdict.red { color: #cf222e; font-weight: 600; }
  video { max-width: 100%; border-radius: 4px; }
  .stale-badge { color: #9a6700; font-weight: 600; }
</style>
</head>
<body>
<h1>Operator stories</h1>
<p>Generated by <code>npm run stories</code> from <code>tests/stories/</code>. Do not hand-edit —
   this page is derived from every <code>demos/stories/*/story.json</code> on disk.</p>
${cards}
</body>
</html>
`;
}

/** Write one story's data. Returns the id it wrote, so a caller can build the
 *  set of entries THIS RUN produced from what was actually written rather than
 *  from the stories it meant to run (T1 ruling 1009(c)). */
export function writeStoryJson(result, root, { gitSha = defaultGitSha, gitDirty = defaultGitDirty, readStoryBytes = readFileSync } = {}) {
  const dir = join(root, 'demos', 'stories', result.story.id);
  mkdirSync(dir, { recursive: true });
  // forge-8vfn.26: the artifact records the PRODUCT, never the checkout that ran
  // it. `portableArtifact` relativises the whole object and THROWS if anything
  // still names this machine — the write happens only on what it returns, so a
  // path shape it did not recognise stops the run instead of reaching a
  // committed file. One seam, because this is the only place the artifact is
  // serialised; a guard on the three emitters that leak today would pass the
  // fourth silently.
  // 7.6.120: an ATTRIBUTED sibling escape is made portable HERE — after
  // `describeFence` has already printed the full absolute paths to the run log,
  // which stays the operator's full-fidelity record of who was in which tree.
  // An UNATTRIBUTED escape is deliberately left absolute so it still hits the
  // throw below: that is how a containment breach is stopped from reaching a
  // committed file, and it must not be tidied into portability.
  let portable = result.fence?.escapes
    ? { ...result, fence: { ...result.fence, escapes: portableFenceEscapes(result.fence.escapes) } }
    : result;
  // 7.6.125, the second seam: the reap ledger names other checkouts the same way
  // `fence.escapes` did, and S2/S3/S5 could not be regenerated because of it. Own-root
  // entries pass through untouched — twelve committed entries are already `_logs/…`
  // and must not churn — and a dir that cannot be decomposed stays absolute for the
  // refusal below to catch.
  if (portable.reap && typeof portable.reap === 'object') {
    const reap = { ...portable.reap };
    for (const k of ['reaped', 'skipped', 'cancelled']) {
      if (Array.isArray(reap[k])) reap[k] = portableReapEntries(reap[k], root);
    }
    portable = { ...portable, reap };
  }
  // 7.6.127, the third seam: `sweep.removed` is a string[] so its frame is named
  // once for the array; `claim.claimed[].path` is an object and takes the
  // per-element frame. Two different foreign roots cannot be said in one frame,
  // so that case stays absolute and the refusal below catches it.
  if (portable.sweep && typeof portable.sweep === 'object') {
    portable = { ...portable, sweep: portableSweepPaths(portable.sweep, root) };
  }
  // Findings row 56 + row 14, T1 ruling 1283 (option B) — provenance, so a
  // committed artifact can be told apart from one written against a DIFFERENT
  // checkout state or a DIFFERENT version of the story that produced it.
  portable = {
    ...portable,
    git: Object.freeze({ sha: gitSha(root), dirty: gitDirty(root) }),
    spend: spendFieldFor(result),
    storyDigest: shortDigest(readStoryBytes(join(root, 'tests', 'stories', `${result.story.id}.story.mjs`))),
  };
  writeFileSync(join(dir, 'story.json'), `${JSON.stringify(portableArtifact(portable, root), null, 2)}\n`);
  return result.story.id;
}

/**
 * Every gallery target that the repo does not TRACK — `forge-8vfn.7.6.81`,
 * T1 ruling 1009(a).
 *
 * WHY: #703 committed an updated `demos/stories/index.html` whose new entry's
 * `story.json` and frames were untracked. Main's gallery pointed at artifacts
 * absent from the repo and every gate read rc=0, because an untracked file is
 * invisible to `check-file-size`, to every pin, and to `sha256sum -c` — a file
 * that is not listed cannot fail. Caught only by a post-merge porcelain read.
 *
 * THE SUBJECTS ARE `story.json` AND EACH BEAT'S `frame:`, AND THE CLIP IS
 * EXEMPT — not by this function's judgement but by the operator's own words at
 * `.gitignore:192-195`: "Frames, story.json and the generated doc ARE
 * deterministic and stay tracked" against an ignore rule for
 * `demos/stories/**\/*.webm` (ruling 2026-08-30). Every `href`/`src` in the
 * rendered index is a webm, so a guard reading the HTML's links would red on
 * all twelve BY DESIGN. This reads the same source `regenerateGallery` does.
 *
 * REFUSES RATHER THAN GUESSES, like `groundIgnoreFromGit`: a `git ls-files`
 * that cannot run is not "everything is tracked". Treating a failed read as a
 * clean one is how a guard reports the absence of evidence as evidence of
 * absence, which is the exact shape this bead exists to close.
 *
 * @returns {ReadonlyArray<{entry: string, path: string}>} repo-relative paths
 */
/**
 * Parse one story.json, naming the file when it will not parse — C's review of
 * 7.6.81.
 *
 * A bare `JSON.parse` throws a `SyntaxError` that names no path, so a single
 * malformed artifact reds a run with a message that does not say which of
 * twelve files is at fault. And `??` guards UNDEFINED, not null: a story.json
 * containing literal `null` parses fine and then makes `data.beats ?? []` a
 * TypeError on `null.beats`. These are generated artifacts, which is exactly
 * the argument for guarding them — this bead exists because a generated
 * artifact went wrong.
 */
function readStoryJson(file) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`gallery: ${file} is not readable JSON — ${err instanceof Error ? err.message : String(err)}`);
  }
  if (data === null || typeof data !== 'object') {
    throw new Error(`gallery: ${file} parsed to ${data === null ? 'null' : typeof data}, not an object`);
  }
  return data;
}

/** A story id / frame segment that is safe to fold into a path. Charset
 *  allowlist, length cap, and an explicit refusal of stringified nullish — the
 *  guard shape `scripts/lib/journey-assertions.mjs` uses for session ids, and
 *  the repo's rule for ANY value that becomes part of a filesystem path.
 *
 *  Today's ids come from `readdirSync`, which cannot return a name containing
 *  `/`. That is an argument about the CALLER, and this function is exported:
 *  the next caller is the one this exists for. `frame` is weaker still — it is
 *  read out of story.json CONTENT, so it is only as trustworthy as whatever
 *  wrote that file. */
//  THE `1` IN `{1,128}` IS LOAD-BEARING AND NOT FOR THE REASON IT LOOKS.
//  `/etc/passwd` splits to `['', 'etc', 'passwd']`, and the ABSOLUTE case is
//  refused only because the leading EMPTY segment fails the minimum length —
//  nothing here reasons about absolute paths at all. `frames//x.png` and a
//  trailing `frames/` are caught the same accidental way. Relax it to `{0,128}`
//  as a tidy and all three open SILENTLY, with every other case still passing.
//  (C's probe, 11 cases against e777669f.)
const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;
const NULLISH_AS_TEXT = new Set(['null', 'undefined', 'NaN', '.', '..']);

function refuseUnsafe(kind, value) {
  const text = String(value);
  if (!SAFE_SEGMENT.test(text) || NULLISH_AS_TEXT.has(text)) {
    throw new Error(
      `untrackedGalleryTargets: refusing a ${kind} that is not a safe path segment: ${JSON.stringify(text)}. ` +
      'Allowed: 1-128 chars of [A-Za-z0-9._-], and never "." / ".." / a stringified nullish. ' +
      'A guard that folds an unchecked segment into a path answers a question about a file it was ' +
      'never asked about.',
    );
  }
  return text;
}

export function untrackedGalleryTargets(root, entryIds) {
  const ids = [...entryIds].map((id) => refuseUnsafe('story id', id));
  if (ids.length === 0) return Object.freeze([]);

  const wanted = [];
  for (const id of ids) {
    const file = join(root, 'demos', 'stories', id, 'story.json');
    // An entry whose story.json is not even on disk is a worse case than an
    // untracked one and is reported through the same channel — so it is the
    // SAME push, not a second one that happens to say the same thing.
    wanted.push({ entry: id, path: `demos/stories/${id}/story.json` });
    if (!existsSync(file)) continue;
    const data = readStoryJson(file);
    for (const beat of data.beats ?? []) {
      if (typeof beat?.frame === 'string' && beat.frame !== '') {
        // `frames/NN-slug.png` — each segment checked, so a story.json carrying
        // `../../../etc/passwd` is refused rather than folded into a path and
        // reported as an untracked "gallery target".
        const segments = beat.frame.split('/').map((seg) => refuseUnsafe('frame segment', seg));
        wanted.push({ entry: id, path: `demos/stories/${id}/${segments.join('/')}` });
      }
    }
  }

  const res = spawnSync('git', ['-C', root, 'ls-files', '-z', '--', 'demos/stories'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error !== undefined) {
    throw new Error(
      `untrackedGalleryTargets: could not run git ls-files in ${root} — ${res.error.message}. ` +
      'Refusing: a failed read is not a state, and treating it as "everything is tracked" would ' +
      'report exactly the condition this guard exists to catch as clean.',
    );
  }
  if (res.status !== 0) {
    throw new Error(
      `untrackedGalleryTargets: git ls-files exited ${res.status} in ${root} ` +
      `(128 means it is not a git repository)${res.stderr ? ` — ${String(res.stderr).trim()}` : ''}. ` +
      'Refusing rather than reporting an unchecked remainder as tracked.',
    );
  }
  const tracked = new Set(String(res.stdout).split('\0').filter((p) => p !== ''));

  const seen = new Set();
  const out = [];
  for (const w of wanted) {
    if (seen.has(w.path)) continue;
    seen.add(w.path);
    if (!tracked.has(w.path)) out.push(Object.freeze(w));
  }
  return Object.freeze(out);
}

/**
 * Read every story.json on disk and regenerate the index from all of them.
 *
 * `wroteThisRun` — the ids `writeStoryJson` RETURNED during this run — are
 * EXEMPT from the tracked check (`forge-8vfn.7.6.81`, T1 ruling 1009(c)).
 *
 * WHY THE EXEMPTION EXISTS, because without it this guard is worse than the
 * bug. A story that has never been committed has an untracked `story.json` and
 * untracked frames BY CONSTRUCTION — the run created them seconds earlier —
 * and this function is called at the END of a run. Refusing on them would
 * throw after every beat had executed, so the first run of any new story would
 * fail at its last step. On a costless story that is an annoyance; on a FUNDED
 * one it means paying for a complete run and losing it at the final render.
 * S1 run 11 cost $5.2497; that is the price tag. A guard that makes a funded
 * run fail at its last step is the kind of fix that gets reverted the first
 * time it fires.
 *
 * The set is MEASURED FROM WHAT THE RUN PRODUCED — the return values of
 * `writeStoryJson` — never from "the ids this invocation meant to run". Those
 * two agree right up until the moment they do not, and the failing case is a
 * story that was requested and never written, which is precisely an entry that
 * should NOT be exempt.
 *
 * What is left is the case #703 actually shipped: an entry this run did not
 * produce, pointing at artifacts the repo does not track. The committed-tree
 * check under `npm test` is the other half and the one that catches it after
 * the fact.
 */
/**
 * The rows the index is DERIVED from: one per `demos/stories/<id>/story.json`
 * present in the tree, through `storyRowFrom`.
 *
 * EXTRACTED SO A CHECK CAN USE THE GENERATOR'S OWN DERIVATION —
 * `forge-8vfn.7.6.128`. `demos/stories/index.html` on main called S9 `red 4/14`
 * while `demos/stories/S9/story.json` said `green 16/16`: the triple landed
 * without the fan-in index. Nothing caught it, because the index is matched by
 * no manifest — M6-C dropped that pin on the argument that a fan-in artifact's
 * change rate is the SUM of its inputs', so pinning it charges a stranding for
 * every legitimate input change forever — and amendment 56 named the residual
 * at the time: "Nothing asserts the committed index is what the generator would
 * produce from the CURRENT inputs. 'Regenerate and compare' does not exist as a
 * door."
 *
 * It exists now, and it has to run on THIS walk rather than a second copy of
 * it. A check that re-implemented the readdir would drift from the generator
 * and then assert its own copy — the two-notions-of-one-thing shape `handleFor`
 * exists to prevent, and the reason this is an extraction rather than a new
 * function beside the old one.
 *
 * @param {string} root
 * @returns {{rows: object[], ids: string[]}} rows in DISCOVERY order; the
 *   render sorts by id itself, so callers never depend on this order.
 */
/** `{id -> reason}` from `staleArtifacts(root)` — ONE call per row-path
 *  invocation, shared by both `galleryRowsFrom` and `committedGalleryRows` so
 *  the two can never compute staleness two different ways. */
function staleReasonMap(root) {
  return new Map(staleArtifacts(root).map((s) => [s.id, s.reason]));
}

/** A row from `storyRowFrom`, with `stale` attached from an already-built
 *  reason map (findings row 56 + row 14, T1 ruling 1283 option B). ONE
 *  function so `galleryRowsFrom` and `committedGalleryRows` attach it
 *  IDENTICALLY — they may read different story.json bytes (disk vs HEAD), but
 *  never a different notion of "how does staleness land on a row". */
function withStaleness(row, id, staleReasonById) {
  return Object.freeze({ ...row, stale: staleReasonById.get(id) ?? null });
}

export function galleryRowsFrom(root) {
  const base = join(root, 'demos', 'stories');
  const rows = [];
  const ids = [];
  const staleReasonById = staleReasonMap(root);
  if (existsSync(base)) {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(base, entry.name, 'story.json');
      if (!existsSync(file)) continue;
      rows.push(withStaleness(storyRowFrom(readStoryJson(file)), entry.name, staleReasonById));
      ids.push(entry.name);
    }
  }
  return { rows, ids };
}

/**
 * The rows the COMMITTED index must agree with: one per `story.json` that git
 * tracks, read from HEAD rather than from the working tree.
 *
 * BOTH SIDES COME FROM GIT, and that is the whole design — `forge-8vfn.7.6.128`,
 * after M6-C pointed out the half I had got wrong. The claim is about what is ON
 * MAIN: the committed index contradicted its own committed input for S9. A run
 * in progress must not be able to change the answer, and it could have done so
 * in BOTH directions:
 *
 *   INPUT SIDE    a live run writes `demos/stories/S10/story.json` UNTRACKED. A
 *                 disk walk sees it, the committed index has no S10 card, and
 *                 the check reds on every in-flight run. A refusal that fires
 *                 every time is one that gets routed around within the hour.
 *   INDEX SIDE    that same run then REGENERATES `index.html` on disk, so
 *                 filtering only the inputs would compare a fresh index against
 *                 committed inputs and red just as falsely, the other way.
 *
 * Reading both sides from HEAD makes an in-flight run invisible here, which is
 * correct: a story whose artifact is not committed is not something the
 * committed index can be expected to list, and a story that was DISCARDED —
 * run 18's S10 was, under T1's ruling, because a tutorial documenting a failure
 * is not a tutorial — has no tracked artifact and no card, which is agreement
 * rather than a fault. "Absent" and "wrong" are different findings.
 *
 * THE DERIVATION IS STILL SHARED with the generator: `storyRowFrom` here and
 * `renderGalleryIndex` at the call site are the same functions
 * `regenerateGallery` uses. Only the FILE SOURCE differs, deliberately, because
 * the generator's question is "what should the index say now" and this one's is
 * "does what we committed agree with itself".
 *
 * IT REFUSES RATHER THAN FAILING OPEN in both git calls. A failed read is not a
 * state, and "git did not answer" resolving to "nothing is tracked" would report
 * a repo with no committed stories as perfectly self-consistent.
 *
 * @param {string} root
 * @returns {{rows: object[], ids: string[]}}
 */
export function committedGalleryRows(root) {
  const ls = spawnSync('git', ['-C', root, 'ls-files', '-z', '--', 'demos/stories/*/story.json'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (ls.error !== undefined) {
    throw new Error(
      `committedGalleryRows: could not run git ls-files in ${root} — ${ls.error.message}. ` +
      'Refusing: treating a failed read as "nothing is tracked" would report any repo as agreeing.',
    );
  }
  if (ls.status !== 0) {
    throw new Error(
      `committedGalleryRows: git ls-files exited ${ls.status} in ${root} ` +
      `(128 means it is not a git repository)${ls.stderr ? ` — ${String(ls.stderr).trim()}` : ''}.`,
    );
  }
  const rows = [];
  const ids = [];
  const staleReasonById = staleReasonMap(root);
  for (const rel of ls.stdout.split(NUL)) {
    if (rel === '') continue;
    const show = spawnSync('git', ['-C', root, 'show', `HEAD:${rel}`], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    // A path git TRACKS but HEAD does not carry is a file added to the index and
    // not yet committed. It is not part of the committed state, so it is not
    // this check's subject — skipped, not refused.
    if (show.error === undefined && show.status === 0) {
      const id = rel.split('/')[2];
      rows.push(withStaleness(storyRowFrom(JSON.parse(show.stdout)), id, staleReasonById));
      ids.push(id);
    }
  }
  return { rows, ids };
}

/**
 * The COMMITTED index, read from HEAD for the same reason its inputs are.
 * `null` when HEAD carries no index at all — which the caller must treat as a
 * finding and never as agreement.
 */
export function committedGalleryIndex(root) {
  const show = spawnSync('git', ['-C', root, 'show', 'HEAD:demos/stories/index.html'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (show.error !== undefined) {
    throw new Error(`committedGalleryIndex: could not run git show in ${root} — ${show.error.message}.`);
  }
  return show.status === 0 ? show.stdout : null;
}

export function regenerateGallery(root, wroteThisRun = []) {
  const base = join(root, 'demos', 'stories');
  const { rows, ids } = galleryRowsFrom(root);

  const exempt = new Set(wroteThisRun);
  const stale = untrackedGalleryTargets(root, ids.filter((id) => !exempt.has(id)));
  if (stale.length > 0) {
    const named = stale.map((t) => `  ${t.entry} -> ${t.path}`).join('\n');
    throw new Error(
      `regenerateGallery: ${stale.length} gallery target(s) are not tracked by git, and this run did ` +
      `not produce them:\n${named}\n` +
      'Writing the index now would publish links to artifacts absent from the repo — the #703 state, ' +
      'where main\'s gallery pointed at nothing and every gate read rc=0 because an untracked file is ' +
      'invisible to check-file-size, to every pin, and to sha256sum -c.\n' +
      `Commit the paths above, or remove the stale entry. (Clips are exempt by .gitignore's own rule; ` +
      'the subjects here are story.json and each beat\'s frame.)',
    );
  }

  mkdirSync(base, { recursive: true });
  // `rows` already carries `.stale` — `galleryRowsFrom` attaches it (findings
  // row 56 + row 14, T1 ruling 1283 option B), the SAME way `committedGalleryRows`
  // does, so this and the repo-door check can never disagree about it.
  const html = renderGalleryIndex(rows);
  writeFileSync(join(base, 'index.html'), html);
  return { rows, html };
}
