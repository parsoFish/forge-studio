/**
 * The ONE derivation of "can this verdict's Approve be clicked, and if not,
 * why" (W8-B3, bead forge-6gv.7.1 / sessions-kinds-R01 + sessions-kinds-06).
 *
 * Why this is a module and not four locals in the panel: the shipped code had
 * TWO independent derivations of the same question. An `approveDisabled`
 * boolean folded in the bad-slug check and drove only `style.opacity`, while a
 * separate `disabledAttrs(...)` chain drove the real `disabled` attribute and
 * never mentioned the slug. Typing an invalid id therefore dimmed Approve to
 * 50% while leaving `button.disabled === false` with pointer-events auto: a
 * control whose appearance and behaviour disagreed, clickable straight into a
 * 400 that then printed the same sentence twice (once as the hint, once as the
 * error). That is the `declared-data-fails-open` shape in its purest form — a
 * value that is computed, surfaced, and enforced nowhere.
 *
 * Adding the missing branch to the second chain would have fixed the symptom
 * and left the shape. Returning ONE value that the disabled attribute, the
 * `data-disabled-reason` and the opacity all read means there is no second
 * value left that could disagree.
 *
 * `requires` is the phase row's own authored list (studio/session-kinds.yaml),
 * arriving on the wire as `affordance.meta.requires` — the SAME signal the
 * server's write route enforces. It is deliberately the source of truth here
 * instead of `artifact.kind === 'file-package'`: that artifact kind is
 * REUSED by community-refresh for a registry.yaml + evidence draft that will
 * never contain a SKILL.md, so keying off it rendered a "Skill id" field the
 * kind never asked for and gated Approve on a shape the draft can never reach
 * (sessions-kinds-06). Client and server now gate on one fact.
 */

/** Mirrors the server's own id rule (the write route 400s a non-slug id with
 *  the same rule text). Advisory here — the server stays the enforcement. */
export const CLIENT_SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** A drafted package's detected shape, by file presence, or `null` when the
 *  session has no file-package artifact at all. */
export type DraftShape = 'skill' | 'hook' | 'unknown' | null;

export type ApproveGate = {
  /** Whether this verdict needs an operator-supplied library id. */
  readonly idRequired: boolean;
  /** Whether the draft's shape is what blocks Approve (id required, but no
   *  SKILL.md/hook.yaml has landed yet). */
  readonly shapeBlocksApprove: boolean;
  /** `null` ⇒ Approve is clickable. Otherwise the verbatim reason, used for
   *  the `disabled` attribute, `data-disabled-reason`, `title` AND opacity —
   *  one value, so appearance and behaviour cannot disagree. */
  readonly disabledReason: string | null;
  /** The inline hint under the fields, or `null`. Actionable detail the
   *  button's short reason has no room for. */
  readonly hint: string | null;
  /** The extra body fields an approve must carry, keyed by the `requires`
   *  name and already trimmed — the SAME map the gate judged. Returned here so
   *  the submit body cannot be built from a second, differently-collected
   *  copy: what was judged is exactly what is sent. */
  readonly providedFields: Readonly<Record<string, string>>;
};

export function deriveApproveGate(input: {
  readonly requires: readonly string[];
  /** The operator's typed id, as typed (trimmed here, once). */
  readonly idValue: string;
  readonly packageShape: DraftShape;
  readonly busy: boolean;
}): ApproveGate {
  const idRequired = input.requires.includes('id');
  const idValue = input.idValue.trim();
  const provided: Record<string, string> = idRequired ? { id: idValue } : {};
  const unmet = input.requires.filter((field) => (provided[field] ?? '').trim().length === 0);

  // The shape advisory is scoped to the verdicts that actually depend on it:
  // it only ever meant "the id this verdict requires is derived from a shape
  // we cannot see yet".
  const shapeBlocksApprove = idRequired && input.packageShape === 'unknown';
  const idBadSlug = idRequired && idValue.length > 0 && !CLIENT_SLUG_RE.test(idValue);

  const disabledReason: string | null =
    input.busy ? 'Submitting…'
    : shapeBlocksApprove ? 'The draft’s shape is still resolving'
    : idBadSlug ? `“${idValue}” is not a valid id`
    : unmet.length > 0 ? 'Fill in every field this verdict requires first'
    : null;

  const hint: string | null =
    idBadSlug
      ? `"${idValue}" is not a valid id — use lowercase letters/digits separated by hyphens, starting with a letter (e.g. "pr-diff-summary").`
      : unmet.length > 0
        ? `Enter ${unmet.map((f) => (f === 'id' && input.packageShape !== null && input.packageShape !== 'unknown' ? `a ${input.packageShape} id` : `"${f}"`)).join(', ')} to enable Approve.`
        : null;

  return { idRequired, shapeBlocksApprove, disabledReason, hint, providedFields: provided };
}
