'use client';

/**
 * RepointGate — the originating control and its repoint confirmation, as ONE
 * component that renders exactly one of them.
 *
 * WHY THIS EXISTS, and why it is a component rather than a convention.
 * Adversarial review found the same defect **four times**, on four different
 * controls, across three fix rounds: a control that raises a confirmation stays
 * live beside it and re-posts the identical unconfirmed request forever. Each
 * round fixed the call sites the review named and left the others, because
 * "remember to suppress the button" is a rule a person has to apply N times.
 * The rule is structural here: a caller passes its control as `children`, and
 * `children` cannot render while `pending` is set. There is no version of this
 * that forgets.
 *
 * It also closes the display/payload split. `onConfirm` is invoked with
 * `pending.currentFlowId` — the SAME expression the bar displays — so a surface
 * cannot show one flow and confirm another. (`confirmRepointFrom` is a
 * compare-and-swap; see `orchestrator/enqueue-flow-run.ts`.) `currentFlowId` is
 * REQUIRED on `pending` for the same reason: a refusal that names no flow is not
 * confirmable, and must surface as an error rather than as a confirmation the
 * operator can click but never satisfy.
 *
 * DOM contract: identical on every surface, so one selector drives them all —
 *   [data-component="repoint-confirm"][data-initiative-id][data-current-flow][data-target-flow]
 *     button[data-action="confirm-repoint"] · button[data-action="cancel-repoint"]
 * and, while pending, NONE of the originating control's own markup.
 */

import type { ReactNode } from 'react';

import { RepointConfirmBar } from '@/components/studio/RepointConfirmBar';

export type PendingRepoint = {
  /** The flow the initiative is queued under, as the SERVER reported it. */
  currentFlowId: string;
  targetFlowId: string;
};

export function RepointGate({
  initiativeId,
  pending,
  verb,
  busy = false,
  onConfirm,
  onCancel,
  barStyle,
  children,
}: {
  initiativeId: string;
  /** Non-null ⇒ a confirmation is pending; the control does not render. */
  pending: PendingRepoint | null;
  verb: string;
  busy?: boolean;
  /** Called with the flow the bar just displayed — never a re-derived one. */
  onConfirm: (fromFlowId: string) => void;
  onCancel: () => void;
  barStyle?: React.CSSProperties;
  /** The originating control. Rendered only while nothing is pending. */
  children: ReactNode;
}): JSX.Element {
  if (pending === null) return <>{children}</>;
  return (
    <RepointConfirmBar
      initiativeId={initiativeId}
      currentFlowId={pending.currentFlowId}
      targetFlowId={pending.targetFlowId}
      verb={verb}
      busy={busy}
      onConfirm={() => onConfirm(pending.currentFlowId)}
      onCancel={onCancel}
      style={barStyle}
    />
  );
}
