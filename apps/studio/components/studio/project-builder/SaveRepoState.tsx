'use client';

import { disabledAttrs } from '@/lib/disabled-reason';
import type { SaveRecoveryProposal } from '@/lib/save-refusal';

export type { SaveRecoveryProposal };

const panel = { margin: '8px 28px 0', padding: '10px 12px', borderRadius: 6, fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 8 } as const;

/**
 * forge-mfv5.1.22 — where a Save went when it could not push the default branch.
 * A protected branch takes a pull request (served by repo-status while open); a
 * default branch stranded ahead of origin gets a recovery proposal that moves
 * nothing until the operator confirms it here.
 */
export function SaveRepoState({ prUrl, recovery, busy, onRecover }: {
  prUrl: string | undefined;
  recovery: SaveRecoveryProposal | null;
  busy: boolean;
  onRecover: () => void;
}) {
  return (
    <>
      {prUrl ? (
        <div data-section="save-pr" role="status" style={{ ...panel, border: '1px solid var(--border)' }}>
          <span>
            The default branch is protected, so Save opened a pull request:{' '}
            <a data-link="save-pr" href={prUrl} target="_blank" rel="noreferrer">{prUrl}</a>.
            Changes stay pending until it merges; Save again after it merges.
          </span>
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
