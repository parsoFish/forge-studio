/**
 * community-form — the registry item form's ONE required-field truth, and the
 * ONE classification of an edit-load outcome (W8-B5 / WI-6, exit rows E10/E9).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS (E10).
 * ---------------------------------------------------------------------------
 * `/community/new` shipped with THREE independent statements of "which fields
 * are required": a hand-typed `required` prop per `<Field>`, a hand-written
 * `requiredFilled` conjunction, and a hand-written sentence in the submit
 * button's disabled reason. They disagreed. The predicate required
 * id/name/category/sourceUrl/provenance; the sentence said "id, name,
 * description and upstream" — naming one field that is not required at all,
 * one that is not on the form, and omitting the two most often left blank.
 *
 * Re-typing the sentence is the same defect one edit later. So the list below
 * is the ONE source: it drives the `*` marker, the submit gate, and the
 * wording of the reason. Adding a field here changes all three at once, and
 * `community-form.test.ts` re-derives the expected sentence from this list so
 * a hardcoded message cannot pass.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LOAD OUTCOME LIVES HERE TOO (E9).
 * ---------------------------------------------------------------------------
 * Editing an id that does not exist used to render the whole edit form with a
 * red banner over it. The right surface is the shared `NotFound`. But "the row
 * does not exist" and "the bridge never answered" are DIFFERENT facts, and a
 * down bridge must never be rendered as a confident "no such row" — the same
 * discipline `bridge-result.ts` holds for every other read (a failure with no
 * HTTP status means the bridge was never reached). Only a real 404 may claim
 * absence; everything else is an error.
 */
import type { CommunityKind } from './community-client.ts';

// ---------------------------------------------------------------------------
// The form's own state shape — owned here so the required-field list below is
// type-checked against the real fields rather than against string literals.
// ---------------------------------------------------------------------------

export type RegistryFormState = {
  id: string;
  kind: CommunityKind;
  name: string;
  desc: string;
  category: string;
  sourceUrl: string;
  provenance: string;
  tier: string;
  attributedTo: string;
};

export type RegistryFormField = keyof RegistryFormState;

export const EMPTY_REGISTRY_FORM: RegistryFormState = {
  id: '', kind: 'skill', name: '', desc: '', category: '',
  sourceUrl: '', provenance: '', tier: '', attributedTo: '',
};

/**
 * THE required set — the same five the bridge's own validator enforces
 * (`@forge/library/studio/community-registry.ts`'s `reqString` calls for id/name/category/
 * sourceUrl/provenance). `label` is the operator-facing name: it is what the
 * field's own `<Field label=…>` renders AND what the disabled reason says, so
 * the two cannot describe the same field differently.
 */
export const REGISTRY_REQUIRED_FIELDS = [
  { field: 'id', label: 'id' },
  { field: 'name', label: 'name' },
  { field: 'category', label: 'category' },
  { field: 'sourceUrl', label: 'source URL' },
  { field: 'provenance', label: 'provenance' },
] as const satisfies ReadonlyArray<{ field: RegistryFormField; label: string }>;

export function isRegistryFieldRequired(field: RegistryFormField): boolean {
  return REGISTRY_REQUIRED_FIELDS.some((f) => f.field === field);
}

/** The labels of the required fields still empty, in the list's own order
 *  (which is the form's field order — so the sentence reads top-to-bottom
 *  the way the operator scans the form). Whitespace is not a value. */
export function missingRegistryRequiredLabels(form: RegistryFormState): string[] {
  return REGISTRY_REQUIRED_FIELDS.filter((f) => form[f.field].trim().length === 0).map((f) => f.label);
}

/** The submit gate — the SAME predicate the disabled reason is built from. */
export function registryRequiredFilled(form: RegistryFormState): boolean {
  return missingRegistryRequiredLabels(form).length === 0;
}

/** "a, b and c" — the sentence fragment naming what is still missing. */
function joinLabels(labels: readonly string[]): string {
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]!}`;
}

export const REGISTRY_LOAD_FAILED_REASON = 'The registry could not be read — reload before writing to it';

/**
 * The submit button's disabled reason, or `null` when the button is live.
 * Fed straight into `disabledAttrs()`, so `disabled`, `title` and
 * `data-disabled-reason` all come from this one string.
 *
 * Precedence, most-blocking first: a write already in flight; a registry that
 * could not be read (writing over a file you failed to read is the worse
 * move); then the derived missing-fields sentence.
 */
export function registryFormDisabledReason(args: {
  form: RegistryFormState;
  submitting: boolean;
  loadFailed: boolean;
}): string | null {
  if (args.submitting) return 'Saving…';
  if (args.loadFailed) return REGISTRY_LOAD_FAILED_REASON;
  const missing = missingRegistryRequiredLabels(args.form);
  if (missing.length === 0) return null;
  return `Fill in ${joinLabels(missing)} first`;
}

// ---------------------------------------------------------------------------
// E9 — the edit-load outcome
// ---------------------------------------------------------------------------

export const REGISTRY_EDIT_LOAD_OUTCOMES = ['ok', 'not-found', 'error'] as const;
export type RegistryEditLoadOutcome = (typeof REGISTRY_EDIT_LOAD_OUTCOMES)[number];

/**
 * Classify what `fetchRegistryItem` came back with.
 *
 *   - `ok`         — a 2xx carrying a parsed row.
 *   - `not-found`  — a real HTTP 404, and ONLY that: the bridge answered, and
 *                    what it said is "no registry item with that id".
 *   - `error`      — everything else, including a failure with NO status at
 *                    all (the transport threw; the bridge was never reached).
 *                    A down or erroring bridge must never be rendered as a
 *                    confident absence claim.
 */
export function registryEditLoadOutcome(r: { ok: boolean; item?: unknown; status?: number }): RegistryEditLoadOutcome {
  if (r.ok && r.item !== undefined && r.item !== null) return 'ok';
  if (r.status === 404) return 'not-found';
  return 'error';
}
