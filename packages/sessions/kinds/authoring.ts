/**
 * The `authoring` session kind — identity only (M4 ruling 87); see `design.md`.
 */
import type { ServerResponse } from 'node:http';

import { sendJson, guardedReadFile } from '@forge/kernel';
import { SLUG_RE } from '@forge/agents/skill-path.ts';
import { runFinalize } from '@forge/library/bridge-studio-authoring.ts';
import { guardedWriteSessionStatus } from '../session-status-io.ts';
import type { AffordanceRouteContext } from '../bridge-studio-sessions-affordance-shell.ts';

// ---------------------------------------------------------------------------
// verdict — authoring (approve only; delegates WHOLESALE to `runFinalize`).
//
// NOT subject to this file's SYNC INVARIANT note (header): `runFinalize`
// does not reuse this file's caller-supplied `status` at all — it
// re-reads status.json ITSELF (`bridge-studio-authoring.ts` step 3) and
// writes its OWN atomic claim (`phase:'committing'`, step 4) synchronously
// before its one `await runInteractiveTurn(...)`, independent of whatever
// this dispatcher read earlier. It already had the claim-then-await shape
// `approveKbCleanup` (packages/knowledge/bridge-studio-kbs.ts) was built to match — the
// W6-B4 adversarial-review fix generalised authoring's existing pattern to
// kb-cleanup, not the other way around.
// ---------------------------------------------------------------------------

/** The ONE enumeration of "which single file at an authoring session's
 *  `staging/` root identifies the drafted package's shape" — SERVER-side
 *  source of truth (W8-B4 FIX-1). `'staging'` itself mirrors
 *  `orchestrator/studio/session-transcript.ts`'s own (unexported)
 *  `PACKAGE_DIRNAME` literal — not imported, to avoid widening that file's
 *  export surface for a single constant this route can just as honestly
 *  hand-copy (the same convention this file's own header already documents
 *  for `SLUG_RE`-class values).
 *
 *  W8-B4/WI-3 landed `kind:'template'` on the DEDICATED finalize route
 *  (`packages/library/bridge-studio-authoring.ts`'s `runFinalize` + its own
 *  `TEMPLATE_STAGING_FILENAME`) but this array's OWN two-shape version —
 *  the one `deriveAuthoringPackageKind` below actually used — never learned
 *  about `template.md`. Drafting a template therefore worked end to end,
 *  but the operator's real Approve button (which calls THIS route, never
 *  the dedicated one) 409'd forever. Exported so:
 *   (a) `deriveAuthoringPackageKind` below derives from it (one iteration,
 *       not a hand-rolled if-chain that a fourth shape is easy to forget
 *       inside), and
 *   (b) `packages/sessions/tests/contract/authoring-package-shape-parity.test.ts` can cross-check it,
 *       byte-for-byte, against forge-ui's own hand-mirrored copy
 *       (`apps/studio/lib/authoring-package-shape.ts` — forge-ui never
 *       imports cli/ at runtime, so that file is a second, independent
 *       definition, not an import of this one; the parity test is what
 *       keeps a hand-copy honest instead of silent). */
export const AUTHORING_PACKAGE_SHAPES: ReadonlyArray<{ readonly filename: string; readonly kind: 'skill' | 'hook' | 'template' }> = [
  { filename: 'SKILL.md', kind: 'skill' },
  { filename: 'hook.yaml', kind: 'hook' },
  { filename: 'template.md', kind: 'template' },
];

/** Derives the drafted package's shape purely by file PRESENCE, from
 *  `AUTHORING_PACKAGE_SHAPES` above — reads the REAL staging files
 *  server-side via `guardedReadFile` (the SAME guarded primitive
 *  `handleInstructionsAnswer` above already uses), never a client-supplied
 *  `body.kind` (W6-B9, reviewer finding on W6-B8: "keep kind derived from
 *  artifact" — `kind` is not an operator decision, D4; only the library
 *  `id` is, and that is what `meta.requires` now enforces generically).
 *  `null` when no marker file exists yet under `staging/` — still
 *  drafting, never guessed. */
function deriveAuthoringPackageKind(projectsRoot: string, dirSegs: readonly string[]): 'skill' | 'hook' | 'template' | null {
  for (const shape of AUTHORING_PACKAGE_SHAPES) {
    if (guardedReadFile(projectsRoot, [...dirSegs, 'staging', shape.filename]) !== null) return shape.kind;
  }
  return null;
}

export async function handleAuthoringVerdict(
  ctx: AffordanceRouteContext,
  res: ServerResponse,
  origin: string,
  projectsRoot: string,
  dirSegs: readonly string[],
  status: Record<string, unknown>,
  project: string,
  sessionId: string,
  verdict: 'approve' | 'reject',
  body: Record<string, unknown>,
): Promise<void> {
  // W7-C2 (sessions-kinds-23 / library-24) — reject: a plain, SYNC-INVARIANT
  // write straight to the terminal `rejected` row the yaml now declares. No
  // spawn, nothing landed in either library; the staged draft stays on disk
  // as the session's own record but is never installed.
  if (verdict === 'reject') {
    if (guardedWriteSessionStatus(projectsRoot, dirSegs, { ...status, phase: 'rejected' }) === null) {
      sendJson(res, 400, { error: 'invalid session path', sessionId }, origin);
      return;
    }
    sendJson(res, 200, { ok: true, phase: 'rejected' }, origin);
    return;
  }

  // W6-B9 (reviewer finding on W6-B8): `body.kind`/`body.id` used to be
  // hardcoded, authoring-specific checks here — `kind` duplicated a fact
  // the server can derive for itself (never an operator decision, D4), and
  // `id`'s requiredness had no wire signal a client could read back. Both
  // are gone: `id`'s presence is now the GENERIC `meta.requires` check in
  // the main dispatcher above (studio/session-kinds.yaml's `requires: [id]`
  // on this row), and `kind` is derived here, from the REAL staging files,
  // never trusted from the request body.
  const kind = deriveAuthoringPackageKind(projectsRoot, dirSegs);
  if (kind === null) {
    // The enumeration pin: built FROM AUTHORING_PACKAGE_SHAPES, never a
    // hand-typed literal list — a shape added to that array is a shape this
    // message names for free, so the operator-facing error can never drift
    // behind the actual check above the way the old two-item "neither a
    // SKILL.md nor a hook.yaml" copy silently did the day `template.md`
    // became a real third shape.
    const expected = AUTHORING_PACKAGE_SHAPES.map((s) => s.filename).join(', ');
    sendJson(res, 409, { error: `cannot finalize: the drafted package has none of ${expected} at its staging root yet` }, origin);
    return;
  }
  // body.id is already guaranteed a non-empty (post-trim) string by the
  // generic `requires` check above — re-read (never re-validate presence)
  // here.
  const id = (body.id as string).trim();
  // W7-C2 (library-22) — the id's SHAPE is validated HERE, before any phase
  // write: the finalizer downstream (runInteractiveTurn) enforces the same
  // SLUG_RE but raises it as an InteractiveRunnerError, which used to
  // surface as a 500 carrying the raw error-class text. A 400 with an
  // operator-readable rule (and no internal class name) is the honest
  // answer to a typo'd id; the panel mirrors this SAME rule as a
  // disable+hint, and the server check remains the enforcement.
  if (!SLUG_RE.test(id)) {
    sendJson(
      res,
      400,
      { error: `"${id}" is not a valid id — use lowercase letters/digits separated by hyphens, starting with a letter (e.g. "pr-diff-summary")` },
      origin,
    );
    return;
  }
  // runFinalize sends its OWN response (success and every failure path) —
  // this route hands off wholesale rather than reimplementing any part of
  // the copyStagingToLibrary + skill/hook-install sequence.
  await runFinalize(ctx, res, origin, { project, sessionId, kind, id }, ctx.authoringSession);
}
