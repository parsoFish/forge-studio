/**
 * `stageMaterials` — the write-path for agent-kickoff `materials:` uploads
 * (R6-04-F2, WI-1 "materials contract enforcement + guarded staging"). This
 * is the ONLY place in this feature that touches the filesystem; the
 * vocabulary/gate/derivation live in `packages/agents/studio/materials.ts`
 * (kept `fs`-free) and every shape/kind/cap check happens in the route
 * BEFORE this function is ever called (see `apps/forge/ui-bridge.ts`'s
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

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  resolveGuardedPath,
  detectVolumeCaseFolding as probeVolumeCaseFolding,
  CaseFoldingProbeError,
} from '@forge/kernel';
import type { CaseFoldingProbe } from '@forge/kernel';

export class MaterialsStagingError extends Error {}

type MaterialEntry = { filename: string; bytes: Buffer };

export type { CaseFoldingProbe };

/**
 * The default `CaseFoldingProbe` (bead forge-qn8) — a thin wrapper around
 * `@forge/kernel`'s `detectVolumeCaseFolding` (the shared probe mechanism
 * every staging module now imports; see that module's own docstring for the
 * method and its conservative-on-failure default) that translates a
 * probe-cannot-run failure into this module's own typed
 * `MaterialsStagingError`, matching the established throw-not-return
 * convention rather than letting a bare kernel error escape uncaught. `dir`
 * is always `runDir` (real, caller-created) today.
 */
export function detectVolumeCaseFolding(dir: string): boolean {
  try {
    return probeVolumeCaseFolding(dir);
  } catch (err) {
    if (err instanceof CaseFoldingProbeError) {
      throw new MaterialsStagingError(`materials: ${err.message}`);
    }
    throw err;
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
 * (`apps/forge/ui-bridge.ts`'s `validateMaterialsField`) happens to reject a
 * duplicate `filename` within one request today, but "the caller already
 * checks this" is precisely the guard-symmetry gap this codebase just
 * closed for `isSafeRunId` (see `apps/forge/ui-bridge.ts`'s run-dir mkdir) — a
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
 * VOLUME CASE-BEHAVIOUR DETECTION (bead forge-qn8) — in CREATE mode, the
 * common case where neither file exists yet, `resolveGuardedPath` performs
 * no `realpathSync` on the non-existent leaf and reassembles the tail
 * LITERALLY, so two DISTINCT filenames the underlying filesystem folds to
 * one directory entry — `Notes.md` vs `notes.md` on a case-insensitive
 * volume (default macOS APFS, exFAT, an SMB/NTFS mount — and this matters
 * because materials stage into operator-chosen project dirs, not only the
 * ext4 dev box this was first measured on) — would pass a literal-string
 * check as distinct and collide at `writeFileSync`, second write silently
 * winning. Blindly lower-casing the key would be wrong in the OPPOSITE
 * direction: on a genuinely case-sensitive filesystem the two names are
 * legitimate distinct files, and folding them unconditionally would be a
 * fails-closed false rejection. Even in EXISTS mode, `realpathSync` does not
 * necessarily normalise case on a folding volume — directory entries merely
 * match case-insensitively — so the fix applies uniformly to both modes.
 *
 * The fix DETECTS the volume's case behaviour rather than guessing from
 * `process.platform` (a case-sensitive volume can be mounted on macOS, a
 * folding one on Linux) — see `@forge/kernel`'s `detectVolumeCaseFolding`
 * for the mechanism (create a marker, stat it, stat its case-flipped
 * spelling, compare `{dev, ino}`) and its conservative-on-failure default.
 * It is probed ONCE per `stageMaterials` call, against `runDir` itself
 * (always real at call time — every caller `mkdirSync`s it first), never
 * once per entry. `seenTargets` is keyed by the case-folded `realPath` ONLY
 * when the probe reports folding; otherwise it stays keyed literally,
 * exactly as before the fix — a case-sensitive volume still accepts
 * `Notes.md` and `notes.md` as two distinct, legitimate targets.
 *
 * The probe is injectable via a third, optional `options.probeCaseFolding`
 * parameter (real default: this module's own `detectVolumeCaseFolding`
 * above, which wraps the kernel probe's failure into `MaterialsStagingError`
 * rather than letting it fall back to the old literal comparison — this
 * repo forbids silent fallbacks) — the seam that lets this behaviour be
 * exercised deterministically in tests on a case-sensitive dev machine
 * (WSL2/ext4) that cannot naturally produce a folding volume.
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
