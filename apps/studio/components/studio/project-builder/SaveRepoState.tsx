'use client';

import { disabledAttrs } from '@/lib/disabled-reason';
import type { PrState, SaveRecoveryProposal } from '@/lib/save-refusal';

export type { SaveRecoveryProposal };

const panel = { margin: '8px 28px 0', padding: '10px 12px', borderRadius: 6, fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 8 } as const;

/** forge-mfv5.1.23 — what the operator does next, per verdict; the bridge's detail names the checks or the reason. */
const NEXT: Record<PrState, string> = {
  pending: 'Required checks are still running; Save again once they pass.',
  failing: 'Required checks failed; fix them on forge-studio, then Save again.',
  green: 'Required checks passed. Save to merge it.',
  merged: 'It merged. Save to bring the default branch up to date.',
  'blocked-no-required-check': 'Save will not merge it:',
  'blocked-by-ruleset': 'GitHub refused the merge:',
  'stale-head': 'The PR head is not the commit Save pushed; Save to push it again.',
  unreadable: 'Studio could not read the PR state; Save again to retry.',
};

/**
 * forge-mfv5.1.22 — where a Save went when it could not push the default branch.
 * A protected branch takes a pull request (served by repo-status while open, with
 * its verdict by name — forge-mfv5.1.23); a default branch stranded ahead of
 * origin gets a recovery proposal that moves nothing until the operator confirms it here.
 */
export function SaveRepoState({ prUrl, prState, prDetail, recovery, busy, onRecover }: {
  prUrl: string | undefined;
  prState?: PrState;
  prDetail?: string;
  recovery: SaveRecoveryProposal | null;
  busy: boolean;
  onRecover: () => void;
}) {
  return (
    <>
      {prUrl ? (
        <div data-section="save-pr" data-pr-state={prState ?? ''} role="status" style={{ ...panel, border: '1px solid var(--border)' }}>
          <span>
            The default branch is protected, so Save opened a pull request:{' '}
            <a data-link="save-pr" href={prUrl} target="_blank" rel="noreferrer">{prUrl}</a>.
            Changes stay pending until it merges.
          </span>
          {prState ? <span>{NEXT[prState]} {prDetail}</span> : null}
        </div>
      ) : null}
      {recovery ? (
        <div data-section="save-recovery" data-recovery-commits={recovery.commits} role="alert" style={{ ...panel, border: '1px solid var(--amber)' }}>
          <span>{recovery.detail}</span>
          <ul style={{ margin: 0, paddingLeft: 18, fontFamily: 'var(--font-mono)' }}>
            {recovery.subjects.map((s, i) => <li key={`${i}-${s}`} data-recovery-commit={i}>{s}</li>)}
          </ul>
          <button
            type="button"
            className="btn btn-sm"
            data-action="confirm-recovery"
            onClick={onRecover}
            {...disabledAttrs(busy ? 'Saving…' : null)}
            style={{ alignSelf: 'flex-start' }}
          >
            {busy ? 'Saving…' : `Move ${recovery.commits} commit${recovery.commits === 1 ? '' : 's'} to forge-studio and open a PR`}
          </button>
        </div>
      ) : null}
    </>
  );
}
