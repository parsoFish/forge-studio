/**
 * ServeStatusNotice — the ONE read-only line for "is `forge serve` actually
 * claiming work right now" (M7-E row 205, ADR 011/031, T1 ruling 1973mq).
 *
 * `forge studio` supervises `forge serve` directly and the operator has no
 * lifecycle control over it, so this renders NO button and nothing at all
 * when things are fine — only a short notice for the states where there is
 * something real to report:
 *   - `restarting`   — serve crashed and the supervisor's backoff respawn is pending
 *   - `draining`     — the previous serve is still finishing before a fresh one starts
 *   - `down`         — nothing is currently supervised as live
 *   - `unsupervised` — this bridge has no supervisor at all (the dry bridge,
 *                      or a second studio that attached read-only)
 * An emergency halt renders its drain line (`data-serve-halt="on"`) in every state,
 * `running` included. `running` without a halt, and `null` (not yet read, or the read failed — the global
 * BridgeStatus banner owns that outage message), render nothing: there is
 * nothing new for THIS notice to tell the operator.
 *
 * DOM contract: [data-component="serve-status-notice"][data-serve-state][data-serve-restarts]
 */
import type { ServeStatus } from '@/lib/bridge-client';
import { describeHalt } from '@/lib/halt-view';

export type ServeStatusNoticeProps = {
  status: ServeStatus | null;
  /** Rendering context — a standalone notice, or an inline strip beside
   *  other copy. */
  variant?: 'card' | 'strip';
};

const MESSAGE: Record<'draining' | 'restarting' | 'down' | 'unsupervised', string> = {
  draining: 'The previous forge serve is finishing before a fresh one takes over — queued work waits.',
  restarting: 'forge serve is restarting after an unexpected exit — queued work waits.',
  down: 'forge serve is not running — queued work waits.',
  unsupervised: 'forge serve status is not available from this bridge.',
};

export function ServeStatusNotice({ status, variant = 'card' }: ServeStatusNoticeProps): JSX.Element | null {
  if (status === null) return null;
  const halt = status.halt;
  if (status.state === 'running' && halt === null) return null;
  return (
    <div
      data-component="serve-status-notice"
      data-serve-state={status.state}
      data-serve-restarts={status.restarts}
      data-serve-halt={halt !== null ? 'on' : undefined}
      data-halt-active={halt?.active ?? undefined}
      data-halt-queued={halt?.queued ?? undefined}
      style={
        variant === 'strip'
          ? { fontSize: 11.5, color: 'var(--ember)', padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--bg-2)' }
          : { fontSize: 12, color: 'var(--ember)', padding: '10px 12px', border: '1px solid var(--yellow)', borderRadius: 'var(--radius)', background: 'var(--bg-2)' }
      }
    >
      {halt !== null ? describeHalt(halt) : status.state === 'running' ? null : MESSAGE[status.state]}
    </div>
  );
}
