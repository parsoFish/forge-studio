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
 *   catalogue) — with NO filesystem writes at all. Only once every single
 *   entry has passed does Phase 2 run, writing each file. If entry N (of
 *   any N, including the very last) fails its check, entries 1..N-1 are
 *   NEVER written — moving a write earlier would only change which artifact
 *   gets orphaned on a later refusal, not eliminate the problem.
 *
 * Throws `MaterialsStagingError` on any refusal (mirrors the established
 * throw-not-return convention of this route's sibling
 * `resolveDispatchableAgent` — no separate result/error channel). The
 * thrown message names no absolute filesystem path.
 */
export function stageMaterials(runDir: string, entries: ReadonlyArray<MaterialEntry>): void {
  if (entries.length === 0) return;

  // Phase 1 — resolve + verify every path. Zero side effects.
  const resolved: Array<{ realPath: string; bytes: Buffer }> = [];
  for (const entry of entries) {
    const result = resolveGuardedPath(runDir, ['materials', entry.filename]);
    if (!result.ok) {
      // `result.reason` is an internal diagnostic only (per
      // studio-path-guard.ts's own PathGuardReject contract) and is never
      // forwarded — this message names neither it nor any filesystem path.
      throw new MaterialsStagingError(`materials: refused to stage "${entry.filename}" — containment check failed`);
    }
    resolved.push({ realPath: result.realPath, bytes: entry.bytes });
  }

  // Phase 2 — write. Every path was already identity-verified above; the
  // `materials/` directory itself is created here (mkdirSync recursive) if
  // this is the first material for this run.
  for (const item of resolved) {
    mkdirSync(dirname(item.realPath), { recursive: true });
    writeFileSync(item.realPath, item.bytes);
  }
}
