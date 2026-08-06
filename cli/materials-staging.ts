/**
 * `stageMaterials` — the write-path for agent-kickoff `materials:` uploads
 * (R6-04-F2, WI-1 "materials contract enforcement + guarded staging"). This
 * is the ONLY place in this feature that touches the filesystem; the
 * vocabulary/gate/derivation live in `orchestrator/studio/materials.ts`
 * (kept `fs`-free) and every shape/kind/cap check happens in the route
 * BEFORE this function is ever called (see `cli/ui-bridge.ts`'s
 * `POST /api/agents/:slug/run`).
 *
 * PRECONDITION — load-bearing, mirrors `resolveGuardedPath`'s own CONTRACT
 * in `cli/studio-path-guard.ts` (read that module's docstring in full before
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

import { resolveGuardedPath } from './studio-path-guard.ts';

export class MaterialsStagingError extends Error {}

type MaterialEntry = { filename: string; bytes: Buffer };

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
 * BOUND OF THIS CHECK — do not overstate it (2026-08-07 adversarial
 * re-review). In CREATE mode — the common case, where neither file exists
 * yet — `resolveGuardedPath` performs NO `realpathSync` on the non-existent
 * leaf and reassembles the tail LITERALLY (`studio-path-guard.ts`, the walk
 * stops at the first absent segment). So the dedup key is a literal string
 * there, and two DISTINCT filenames that the underlying filesystem would
 * fold to one directory entry — `Notes.md` vs `notes.md` on a
 * case-insensitive volume (default macOS APFS, exFAT, an SMB/NTFS mount) —
 * produce two different keys, pass this check, and then collide at
 * `writeFileSync`, second write winning. NOT reachable on a case-sensitive
 * filesystem (ext4, the deployment this was measured on), which is why the
 * suite is green; the PRECONDITION that makes it live is `logsRoot` sitting
 * on a case-folding volume. Deliberately not "fixed" by lower-casing the
 * key: on a case-sensitive filesystem `Notes.md` and `notes.md` are two
 * legitimate distinct files, and rejecting them would be a fails-closed
 * false rejection of valid input — trading a real defect for a different
 * one. Closing it properly means detecting the volume's case behaviour, not
 * normalising blindly. Tracked, with this precondition, rather than papered
 * over.
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
export function stageMaterials(runDir: string, entries: ReadonlyArray<MaterialEntry>): void {
  if (entries.length === 0) return;

  // Phase 1 — resolve + verify every path, AND refuse a duplicate resolved
  // target within this call. Zero side effects.
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
    if (seenTargets.has(result.realPath)) {
      throw new MaterialsStagingError(`materials: refused to stage "${entry.filename}" — duplicate target within one call`);
    }
    seenTargets.add(result.realPath);
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
