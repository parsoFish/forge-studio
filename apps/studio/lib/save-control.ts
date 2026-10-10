/**
 * forge-mfv5.1.20 — the project page's Save control, derived from the form AND the
 * project repo (ONE derivation). Gated on the form's dirty flag alone, Save read
 * "No unsaved changes" while forge-studio held unsaved commits and contract files
 * sat uncommitted, so neither the Save nor its adopt list could be reached.
 */
import { readPrState, readPrUrl, type PrState } from './save-refusal';

export type RepoStatus = { pending: boolean; branch: string; uncommitted: string[]; prUrl?: string; prState?: PrState; prDetail?: string };

/** The repo-status body: a PR link only for a github.com PR URL; its verdict by name and detail (forge-mfv5.1.23). */
export function readRepoStatus(r: Record<string, unknown>): RepoStatus {
  const prUrl = readPrUrl(r.prUrl);
  const prState = readPrState(r.prState);
  return {
    pending: r.pending === true, branch: String(r.branch), uncommitted: Array.isArray(r.uncommitted) ? r.uncommitted.filter((f): f is string => typeof f === 'string') : [],
    ...(prUrl ? { prUrl } : {}), ...(prState ? { prState } : {}), ...(typeof r.prDetail === 'string' ? { prDetail: r.prDetail } : {}),
  };
}

export type SaveControl = { disabledReason: string | null; label: string; adoptFiles: string[] };

export function deriveSaveControl(input: {
  dirty: boolean;
  saving: boolean;
  /** null while unread or unreadable — the control then follows the form alone. */
  repo: RepoStatus | null;
  /** The files the last Save refused on; they win over the polled list. */
  refused: readonly string[];
}): SaveControl {
  const { dirty, saving, repo, refused } = input;
  const adoptFiles = refused.length > 0 ? [...refused] : [...(repo?.uncommitted ?? [])];
  const repoHasWork = repo?.pending === true || adoptFiles.length > 0;
  if (saving) return { disabledReason: 'Saving…', label: 'Saving…', adoptFiles };
  if (dirty) return { disabledReason: null, label: 'Save project', adoptFiles };
  if (repoHasWork) return { disabledReason: null, label: 'Save pending changes', adoptFiles };
  return { disabledReason: 'No unsaved changes', label: 'Save project', adoptFiles };
}
