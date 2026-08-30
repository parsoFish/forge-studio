'use client';

/**
 * RepointConfirmBar — the ONE confirmation every surface that can move an
 * initiative between flows renders (W8-A3, `flows-37`).
 *
 * SEVEN controls in Studio can repoint a queued manifest's `flow_id` and ask
 * before doing it: the flow monitor's generic Start-Run picker; the project
 * page's Start-work Plan and Run-a-flow; the roadmap card drawer's Plan and
 * Start development; and the "Actionable now" rows' Plan and Start development.
 * (Two more — the two BATCH buttons — deliberately do not ask, and name their
 * refused ids instead; a batch cannot show N moves.)
 *
 * Earlier revisions of this comment said "four", which is how review round 3
 * found two live controls with no confirmation and no error at all: the
 * enumeration was the defect, not any one call site. The first cut of this lane
 * also grew a hand-copied panel per surface, which is the same shape as the
 * defect it was closing — three copies of one rule drift, and two of them
 * shipped with no test until review round 2 said so.
 *
 * NOTHING SHOULD MOUNT THIS DIRECTLY. Mount `RepointGate`, which renders either
 * this bar or the originating control and never both — review found "the control
 * stays live beside its own confirmation and re-posts unconfirmed" on FOUR
 * separate controls across three fix rounds, because suppression-by-convention
 * is a rule someone has to remember N times.
 *
 * `verb` is the acting control's own word, so the copy reads as that control's
 * consequence rather than as generic ceremony.
 *
 * DOM contract (identical on every surface, so one selector drives them all):
 *   [data-component="repoint-confirm"][data-initiative-id][data-current-flow][data-target-flow]
 *     button[data-action="confirm-repoint"]
 *     button[data-action="cancel-repoint"]
 */

import { disabledAttrs } from '@/lib/disabled-reason';

export type RepointConfirmBarProps = {
  initiativeId: string;
  /** The flow the initiative is queued under TODAY, as the server reported it. */
  currentFlowId: string;
  targetFlowId: string;
  /** The acting control's own verb — "Plan", "Start development", "Run". */
  verb: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  style?: React.CSSProperties;
};

export function RepointConfirmBar({
  initiativeId,
  currentFlowId,
  targetFlowId,
  verb,
  busy = false,
  onConfirm,
  onCancel,
  style,
}: RepointConfirmBarProps): JSX.Element {
  return (
    <div
      data-component="repoint-confirm"
      data-initiative-id={initiativeId}
      data-current-flow={currentFlowId}
      data-target-flow={targetFlowId}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        fontSize: 11.5,
        padding: '6px 8px',
        border: '1px solid var(--ember, #9e6a03)',
        borderRadius: 'var(--radius-sm, 6px)',
        ...style,
      }}
    >
      <span>
        <strong>{initiativeId}</strong> is queued under <strong>{currentFlowId}</strong>.{' '}
        {verb} moves it to <strong>{targetFlowId}</strong>.
      </span>
      {/* `btn-primary`: this IS the bar's primary action, and it keeps the
          button inside `scripts/check-disabled-reason.mjs`'s scan — the shared
          component would otherwise silently drop out of that ratchet when the
          per-surface copies it replaced were in it. */}
      <button
        className="btn btn-sm btn-primary"
        data-action="confirm-repoint"
        {...disabledAttrs(busy ? 'A dispatch is already in flight…' : null)}
        onClick={onConfirm}
        style={{ fontSize: 11, fontWeight: 600, opacity: busy ? 0.6 : 1 }}
      >
        Move it and {verb.toLowerCase()}
      </button>
      <button
        className="btn btn-sm"
        data-action="cancel-repoint"
        onClick={onCancel}
        style={{ fontSize: 11 }}
      >
        Cancel
      </button>
    </div>
  );
}
