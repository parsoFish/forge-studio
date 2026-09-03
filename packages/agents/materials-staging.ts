/**
 * `stageMaterials` — the write-path for agent-kickoff `materials:` uploads
 * (R6-04-F2, WI-1 "materials contract enforcement + guarded staging"). This
 * is the ONLY place in this feature that touches the filesystem; the
 * vocabulary/gate/derivation live in `packages/agents/studio/materials.ts`
 * (kept `fs`-free) and every shape/kind/cap check happens in the route
 * BEFORE this function is ever called (see `cli/ui-bridge.ts`'s
 * `POST /api/agents/:slug/run`).
 *
 * PRECONDITION — load-bearing, mirrors `resolveGuardedPath`'s own CONTRACT
 * in `packages/kernel/path-guard.ts` (read that module's docstring in full before
 * touching this one): `runDir` MUST be trusted / server-derived — built from
 * config `logsRoot` plus a server-minted `runId`, NEVER from any
 * caller-supplied value. Every entry's `filename` is the only untrusted
 * value here, and it MUST reach the guard as its OWN path segment
 * (`resolveGuardedPath(runDir, ['materials', filename])`), never folded into
 * `runDir` first. Folding an untrusted value into `root` makes the guard's
 * realpath comparison tautological — `realRoot` is already the escaped
 * path, so the identity check can never fail — which is a live escape shape
 * in this codebase's own catalogue (see the `adversarial-containment-review`
 * skill). A future caller that builds `runDir` from anything other than a
 * trusted `logsRoot`/`runId` pair breaks this function's whole containment
 * guarantee, silently.
 */

import { mkdirSync, writeFileSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { resolveGuardedPath } from '@forge/kernel';

export class MaterialsStagingError extends Error {}

type MaterialEntry = { filename: string; bytes: Buffer };

/**
 * Injectable seam for volume case-behaviour detection (bead forge-qn8) — see
 * `detectVolumeCaseFolding` below for the real implementation and the
 * `stageMaterials` docstring's "VOLUME CASE-BEHAVIOUR DETECTION" section for
 * why this exists. `dir` is always `runDir` (real, caller-created) today;
 * kept as a parameter rather than hardcoding `runDir` so a future caller
 * probing a different root is not forced to reshape this type.
 */
export type CaseFoldingProbe = (dir: string) => boolean;

/** Marker-name prefix for `detectVolumeCaseFolding`'s throwaway probe entry
 *  — deliberately namespaced and unlikely to collide with a legitimate
 *  material filename. */
const CASE_PROBE_PREFIX = '.forge-case-probe-';

/** Flips the case of every ASCII letter in `s`. Used to build a spelling of
 *  the probe marker that is GUARANTEED to differ from the original only by
 *  letter case — the exact shape of the real bug (`Notes.md` vs
 *  `notes.md`), never by any other change. */
function flipAsciiCase(s: string): string {
  return s.replace(/[a-zA-Z]/g, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));
}

/**
 * The REAL, default `CaseFoldingProbe` — detects, by direct filesystem
 * evidence rather than a `process.platform` guess (a case-sensitive volume
 * can be mounted on macOS, and a case-folding one on Linux), whether `dir`
 * folds case for directory-entry lookups.
 *
 * Method: create a throwaway marker entry under `dir`, `statSync` it to
 * capture its `{dev, ino}`, then `statSync` the SAME name with every letter
 * case-flipped:
 *   - Both stats resolve to the same `{dev, ino}` → the two spellings are
 *     the SAME directory entry → the volume folds case → returns `true`.
 *   - The flipped spelling raises `ENOENT` → the two spellings are genuinely
 *     distinct, unrelated (absent) slots → the volume is case-sensitive →
 *     returns `false`.
 *   - The flipped-spelling stat fails for any OTHER reason (EACCES,
 *     ENOTDIR, ...) → indeterminate. Deliberate, documented choice: default
 *     CONSERVATIVE and report `true` (folding), so `stageMaterials` catches
 *     MORE potential duplicates rather than fewer on an inconclusive read —
 *     never silently treated as "assume case-sensitive", which would
 *     silently reopen the exact bug this function exists to close.
 *
 * If the marker itself cannot even be CREATED (EACCES, ENOSPC, a read-only
 * mount, ...), the probe cannot run at all — this throws
 * `MaterialsStagingError` rather than silently falling back to a literal,
 * un-folded comparison (this repo forbids silent fallbacks; a
 * duplicate-target check that might silently be wrong is worse than one
 * that refuses to run).
 */
export function detectVolumeCaseFolding(dir: string): boolean {
  const marker = `${CASE_PROBE_PREFIX}${randomBytes(8).toString('hex')}-AbCdEf`;
  const markerPath = join(dir, marker);
  const flippedPath = join(dir, flipAsciiCase(marker));

  let markerStat: ReturnType<typeof statSync>;
  try {
    writeFileSync(markerPath, '');
    markerStat = statSync(markerPath);
  } catch (err) {
    throw new MaterialsStagingError(
      `materials: case-folding probe could not run — refusing to stage without a reliable duplicate-target check: ${(err as Error).message}`,
    );
  }

  try {
    const flippedStat = statSync(flippedPath);
    return flippedStat.dev === markerStat.dev && flippedStat.ino === markerStat.ino;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return false;
    // Indeterminate read-back (not "cannot run" — the marker itself exists
    // fine). See this function's docstring: deliberate conservative default.
    return true;
  } finally {
    // Best-effort cleanup of the throwaway marker. Nothing downstream
    // depends on this succeeding — the folding decision above is already
    // made — so a failure here is swallowed deliberately, not silently
    // masking a functional result.
    try {
      unlinkSync(markerPath);
    } catch {
      /* best-effort only */
    }
  }
}

/**
 * Stage one agent-kickoff request's materials under `<runDir>/materials/`.
 *
 * Two-phase, check-then-write, with ZERO partial writes on refusal:
 *   Phase 1 resolves and containment-checks EVERY entry's target path
 *   through `resolveGuardedPath` (the shared, generalized realpath-based
 *   guard — symlinked directory, symlinked leaf, and hardlinked leaf are
 *   all caught there; see that module's docstring for the full escape-shape
 *   catalogue) — with NO filesystem writes at all. Phase 1 ALSO refuses a
 *   DUPLICATE resolved target within the same call — see the paragraph
 *   below; this is not a containment check, but the same phase catches it
 *   for the same reason (still zero side effects). Only once every single
 *   entry has passed BOTH checks does Phase 2 run, writing each file. If
 *   entry N (of any N, including the very last) fails either check, entries
 *   1..N-1 are NEVER written — moving a write earlier would only change
 *   which artifact gets orphaned on a later refusal, not eliminate the
 *   problem.
 *
 * DUPLICATE-TARGET refusal (round 3 adversarial-review amendment) — this
 * function does NOT trust its caller to have deduped. The route
 * (`cli/ui-bridge.ts`'s `validateMaterialsField`) happens to reject a
 * duplicate `filename` within one request today, but "the caller already
 * checks this" is precisely the guard-symmetry gap this codebase just
 * closed for `isSafeRunId` (see `cli/ui-bridge.ts`'s run-dir mkdir) — a
 * module must not rely on an assumption about who calls it. Without this
 * check, two entries sharing one filename would each pass Phase 1
 * independently (it is side-effect-free, so neither sees the other), and
 * Phase 2 would then write both, the SECOND silently clobbering the first —
 * a full, undocumented overwrite, not a partial write, and therefore NOT
 * covered by the "zero partial writes" guarantee above without this
 * explicit check. The comparison is on each entry's RESOLVED
 * `realPath` (from `resolveGuardedPath`), not the raw input `filename`
 * string, so a name that resolves onto an ALREADY-EXISTING sibling target is
 * caught: for a segment that exists, `resolveGuardedPath` calls
 * `realpathSync` and identity-compares, so the collision surfaces as two
 * equal `realPath` values (or is rejected outright by the guard).
 *
 * VOLUME CASE-BEHAVIOUR DETECTION (bead forge-qn8 — this paragraph used to
 * document this as a deliberately-open gap; it is now the record of the
 * fix). In CREATE mode — the common case, where neither file exists yet —
 * `resolveGuardedPath` performs NO `realpathSync` on the non-existent leaf
 * and reassembles the tail LITERALLY (`studio-path-guard.ts`, the walk stops
 * at the first absent segment). So the dedup key would be a literal string
 * there, and two DISTINCT filenames that the underlying filesystem folds to
 * one directory entry — `Notes.md` vs `notes.md` on a case-insensitive
 * volume (default macOS APFS, exFAT, an SMB/NTFS mount — and this matters
 * because materials stage into operator-chosen project dirs, not only the
 * ext4 dev box this was first measured on) — would produce two different
 * keys, pass a literal-string check, and collide at `writeFileSync`, second
 * write silently winning. Blindly lower-casing the key would be wrong in
 * the OPPOSITE direction: on a genuinely case-sensitive filesystem
 * `Notes.md` and `notes.md` are two legitimate distinct files, and folding
 * them unconditionally would be a fails-closed false rejection of valid
 * input — trading one defect for another. Note also that even in EXISTS
 * mode, `realpathSync` does not necessarily normalise case on a
 * case-folding volume — it returns the path as spelled, where directory
 * entries merely match case-insensitively — so this fix applies uniformly
 * to both modes, not only CREATE.
 *
 * The fix actually DETECTS the volume's case behaviour rather than guessing
 * from `process.platform` — a case-sensitive volume can be mounted on
 * macOS, and a case-folding one on Linux, so a platform guess would be
 * wrong in both directions. See `detectVolumeCaseFolding` above for the
 * mechanism (create a marker, stat it, stat its case-flipped spelling,
 * compare `{dev, ino}`). It is probed ONCE per `stageMaterials` call,
 * against `runDir` itself (always real at call time — every caller
 * `mkdirSync`s it before calling; see the tests' own `freshRunDir`), never
 * once per entry — the same volume backs every entry staged in one call, so
 * re-probing per entry would pay the same cost N times for the same answer.
 * `seenTargets` below is keyed by the case-folded `realPath` ONLY when the
 * probe reports folding; otherwise it stays keyed by the literal
 * `realPath`, exactly as before the fix — so a case-sensitive volume still
 * accepts `Notes.md` and `notes.md` as two distinct, legitimate targets,
 * and nothing here can produce a false "duplicate" refusal on one.
 *
 * The probe is injectable via a third, optional `options.probeCaseFolding`
 * parameter (real default: `detectVolumeCaseFolding`) — the seam that lets
 * this behaviour be exercised deterministically in tests on a
 * case-sensitive dev machine (WSL2/ext4) that cannot naturally produce a
 * folding volume. If the default probe cannot even create its baseline
 * marker (EACCES, ENOSPC, a read-only mount, ...), it throws
 * `MaterialsStagingError` rather than silently falling back to the old
 * literal comparison — this repo forbids silent fallbacks, and a
 * duplicate-target check that might silently be WRONG is worse than one
 * that refuses to run. An indeterminate READ-BACK (the marker exists, but
 * stat-ing its flipped spelling fails for a reason other than `ENOENT`)
 * defaults conservatively to "folds" — see `detectVolumeCaseFolding`'s own
 * docstring for that deliberate, documented choice.
 *
 * The check is scoped to entries within ONE call only
 * — re-staging the same filename across two SEPARATE `stageMaterials` calls
 * is an ordinary edit (a run's materials are not write-once), matching the
 * route's own contract-point-8 wording ("duplicate filename in one
 * request").
 *
 * Throws `MaterialsStagingError` on any refusal (mirrors the established
 * throw-not-return convention of this route's sibling
 * `resolveDispatchableAgent` — no separate result/error channel). The
 * thrown message names no absolute filesystem path.
 */
export function stageMaterials(
  runDir: string,
  entries: ReadonlyArray<MaterialEntry>,
  options: { probeCaseFolding?: CaseFoldingProbe } = {},
): void {
  if (entries.length === 0) return;

  // Probed ONCE per call (not per entry — see the docstring's "VOLUME
  // CASE-BEHAVIOUR DETECTION" section) against `runDir` itself, which is
  // always real at this point (every caller `mkdirSync`s it first).
  const probeCaseFolding = options.probeCaseFolding ?? detectVolumeCaseFolding;
  const volumeFoldsCase = probeCaseFolding(runDir);

  // Phase 1 — resolve + verify every path, AND refuse a duplicate resolved
  // target within this call. Zero side effects (the case-folding probe
  // above is a throwaway, self-cleaning marker — see its own docstring —
  // not a materials write).
  const resolved: Array<{ realPath: string; bytes: Buffer }> = [];
  const seenTargets = new Set<string>();
  for (const entry of entries) {
    const result = resolveGuardedPath(runDir, ['materials', entry.filename]);
    if (!result.ok) {
      // `result.reason` is an internal diagnostic only (per
      // studio-path-guard.ts's own PathGuardReject contract) and is never
      // forwarded — this message names neither it nor any filesystem path.
      throw new MaterialsStagingError(`materials: refused to stage "${entry.filename}" — containment check failed`);
    }
    // Keyed by the case-FOLDED realPath only when the probe says this
    // volume folds case; otherwise keyed literally, exactly as before this
    // fix — so a case-sensitive volume never sees a false "duplicate".
    const dedupeKey = volumeFoldsCase ? result.realPath.toLowerCase() : result.realPath;
    if (seenTargets.has(dedupeKey)) {
      throw new MaterialsStagingError(`materials: refused to stage "${entry.filename}" — duplicate target within one call`);
    }
    seenTargets.add(dedupeKey);
    resolved.push({ realPath: result.realPath, bytes: entry.bytes });
  }

  // Phase 2 — write. Every path was already identity-verified AND
  // uniqueness-checked above; the `materials/` directory itself is created
  // here (mkdirSync recursive) if this is the first material for this run.
  for (const item of resolved) {
    mkdirSync(dirname(item.realPath), { recursive: true });
    writeFileSync(item.realPath, item.bytes);
  }
}
