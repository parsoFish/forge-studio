/**
 * disabled-reason — ONE derivation for a disabled control's three attributes
 * (W7-C3 review, A-M12 / park-point C3-PP-2 promoted to a requirement).
 *
 * The convention "a disabled primary CTA always says why" shipped as pure
 * per-component discipline: `disabled`, `title` and `data-disabled-reason`
 * were three hand-written expressions per button, so most buttons carried
 * only the first, several carried a `title` that covered one of two
 * disabling branches, and nothing anywhere enforced any of it — textbook
 * declared-data-fails-open, in the very PR that introduced the convention.
 *
 * Spreading `disabledAttrs(reason)` makes the three impossible to disagree:
 * ONE nullable reason decides all of them. A non-null reason means the
 * control is disabled AND says why, in the tooltip and on the attribute the
 * harness reads; `null` means enabled, with no stale reason left behind.
 *
 * `enabledTitle` is for the controls that also want a tooltip while ENABLED
 * ("Dispatch this agent standalone") — it is never shown while disabled,
 * where the reason takes the slot.
 *
 * Enforced by `scripts/check-disabled-reason.mjs`.
 */
export type DisabledAttrs = {
  disabled: boolean;
  title?: string;
  'data-disabled-reason'?: string;
};

export function disabledAttrs(reason: string | null | undefined, enabledTitle?: string): DisabledAttrs {
  if (reason === null || reason === undefined || reason.trim().length === 0) {
    return enabledTitle ? { disabled: false, title: enabledTitle } : { disabled: false };
  }
  return { disabled: true, title: reason, 'data-disabled-reason': reason };
}
