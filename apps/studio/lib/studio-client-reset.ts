/**
 * Studio client for the project-contract RESET — the "Rebuild contract"
 * control's two calls and the wire shapes they return.
 *
 * WHY THIS IS ITS OWN FILE. `studio-client.ts` is a 2,540-line module already
 * far over the 800-line cap and carrying a `file-size.json` exemption. An
 * exemption is a ceiling, not a licence: adding 129 lines to it because the
 * lines "have nowhere else to go" is the exact drift the cap exists to stop,
 * and the honest answer to "nothing left to trim" is "then put it somewhere
 * else". This module is that somewhere, and it stays well under the cap.
 *
 * It imports `studioPost` from the monolith rather than re-implementing the
 * request shape — one POST helper, one set of error semantics, no second copy
 * to drift from.
 */

import { studioPost } from './studio-client';
/** One row of `@forge/projects`' `DriftReport` (`packages/projects/reset.ts`),
 *  wire-shaped: what the reset WOULD change (or, for `'preserve'`/`'unchanged'`,
 *  would leave alone) in one contract section, read BEFORE the operator applies
 *  it. */
export type ContractDriftRow = {
  section: string;
  before: unknown;
  after: unknown;
  action: 'regenerate' | 'preserve' | 'add' | 'unchanged';
};

/** One bound skill the reset would relocate to the resolver's canonical
 *  `.forge/skills/<id>/` location — `from: null` when no SKILL.md was found at
 *  either the canonical path or the evidenced `<artifactRoot>/skills/<id>/`
 *  alternate (still named, never silently dropped). */
export type ContractDriftSkillMove = { id: string; from: string | null; to: string };

/** `computeContractDrift`'s report, as the dry-run/apply routes return it. */
export type ContractDrift = {
  projectId: string;
  /** The starter this drift was computed against, or `null` when the forge
   *  install has no starters to compare against at all (never the "unresolved"
   *  case — that is a distinct 400, see `ContractResetOutcome.availableAppTypes`). */
  appType: string | null;
  rows: ContractDriftRow[];
  skillMoves: ContractDriftSkillMove[];
};

/** Both the dry-run and apply calls answer this shape: either a real
 *  `ContractDrift` (`ok: true`), or an unresolved app type (`ok: false` +
 *  `availableAppTypes`, the operator's own remedy — never a bare, unreadable
 *  500), or any other failure (`ok: false` + `error` only). */
export type ContractResetOutcome = {
  ok: boolean;
  error?: string;
  /** Present only when the failure is an unresolved app type — the control's
   *  app-type field is populated from exactly this list. */
  availableAppTypes?: string[];
  drift?: ContractDrift;
};

function parseContractDriftRow(raw: unknown): ContractDriftRow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const action = o.action;
  if (typeof o.section !== 'string' || (action !== 'regenerate' && action !== 'preserve' && action !== 'add' && action !== 'unchanged')) {
    return null;
  }
  return { section: o.section, before: o.before, after: o.after, action };
}

function parseContractDriftSkillMove(raw: unknown): ContractDriftSkillMove | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.to !== 'string') return null;
  return { id: o.id, from: typeof o.from === 'string' ? o.from : null, to: o.to };
}

/** Parse a `{ok, drift}` body into `ContractDrift | undefined` — an absent or
 *  malformed `drift` reads as `undefined` (never a fabricated empty report),
 *  so the caller can tell "the server sent nothing" from "the server sent an
 *  empty, real report". */
function parseContractDrift(raw: unknown): ContractDrift | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.projectId !== 'string' || !Array.isArray(o.rows)) return undefined;
  return {
    projectId: o.projectId,
    appType: typeof o.appType === 'string' ? o.appType : null,
    rows: o.rows.map(parseContractDriftRow).filter((r): r is ContractDriftRow => r !== null),
    skillMoves: Array.isArray(o.skillMoves)
      ? o.skillMoves.map(parseContractDriftSkillMove).filter((m): m is ContractDriftSkillMove => m !== null)
      : [],
  };
}

function parseContractResetOutcome(r: { ok: boolean; error?: string; data?: Record<string, unknown> }): ContractResetOutcome {
  return {
    ok: r.ok,
    error: r.error,
    availableAppTypes: Array.isArray(r.data?.availableAppTypes)
      ? (r.data.availableAppTypes as unknown[]).filter((v): v is string => typeof v === 'string')
      : undefined,
    drift: r.ok ? parseContractDrift(r.data?.drift) : undefined,
  };
}

/**
 * Dry-run `POST /api/studio/projects/:id/contract-reset` — computes and
 * returns the drift report; writes nothing. `appType` is the operator's
 * explicit choice (from a PRIOR unresolved outcome's own `availableAppTypes`)
 * — omit it for a project with a persisted `appType`, which never needs one.
 */
export async function previewProjectContractReset(projectId: string, appType?: string): Promise<ContractResetOutcome> {
  const r = await studioPost(
    `/api/studio/projects/${encodeURIComponent(projectId)}/contract-reset`,
    appType ? { appType } : {},
  );
  return parseContractResetOutcome(r);
}

/**
 * Apply `POST /api/studio/projects/:id/contract-reset/apply` — recomputes the
 * SAME drift server-side (never round-trips the operator's previewed report
 * back as the thing that gets written) and applies it. Returns the applied
 * drift alongside the `ResetResult` bookkeeping (sections regenerated, skill
 * moves made, whether preflight came out MET) — the caller reloads the
 * project + preflight panels off the SUCCESS of this call, not off its body.
 */
export async function applyProjectContractReset(
  projectId: string,
  appType?: string,
): Promise<ContractResetOutcome & { appliedCount?: number; skillMovesAppliedCount?: number; preflightOk?: boolean }> {
  const r = await studioPost(
    `/api/studio/projects/${encodeURIComponent(projectId)}/contract-reset/apply`,
    appType ? { appType } : {},
  );
  const outcome = parseContractResetOutcome(r);
  const result = r.data?.result as { applied?: unknown[]; skillMovesApplied?: unknown[]; preflight?: { ok?: boolean } } | undefined;
  return {
    ...outcome,
    appliedCount: Array.isArray(result?.applied) ? result.applied.length : undefined,
    skillMovesAppliedCount: Array.isArray(result?.skillMovesApplied) ? result.skillMovesApplied.length : undefined,
    preflightOk: result?.preflight?.ok,
  };
}
