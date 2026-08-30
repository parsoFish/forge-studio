/**
 * W8-B5 / WI-6 — the registry form's REQUIRED-FIELD SSOT (exit row E10) and
 * the edit-load outcome classifier (exit row E9).
 *
 * DOES NOT EXIST YET when this file is first written: `./community-form.ts`
 * is created by this work item, so the expected first red is
 * module-not-found (this repo's own established red-first convention — see
 * community-view.test.ts's header).
 *
 * ---------------------------------------------------------------------------
 * E10 — "the Add disabled reason names the wrong fields".
 * ---------------------------------------------------------------------------
 * The shipped string at `app/community/new/page.tsx:214` read
 *   "Fill in id, name, description and upstream first"
 * while the predicate that actually gates the button required
 *   id, name, category, sourceUrl, provenance.
 * `description` is not required at all, `upstream` is not a field on that
 * form, and the two most-often-missing real ones went unnamed.
 *
 * Re-typing the list is the SAME defect one edit later. The cure is
 * structural: ONE exported list of required fields drives (a) the `*`
 * marker each `<Field>` renders, (b) `registryRequiredFilled` (the button
 * gate), and (c) the reason sentence — so the three cannot disagree. The
 * tests below are written so that ADDING a row to
 * `REGISTRY_REQUIRED_FIELDS` changes the asserted message with NO string
 * edit anywhere: the expected sentence is re-derived here, independently,
 * from the list itself.
 *
 * ---------------------------------------------------------------------------
 * E9 — "editing a non-existent registry id renders the full edit form".
 * ---------------------------------------------------------------------------
 * The real engineering is telling a genuine 404 ("no such registry row" →
 * the shared NotFound) apart from a transport failure ("the bridge is down"
 * → the error banner, NEVER a not-found claim). `registryEditLoadOutcome`
 * is that decision, isolated as a pure function and enumerated over every
 * status shape `fetchRegistryItem` can hand back.
 */
import { test, expect } from 'vitest';
import {
  REGISTRY_REQUIRED_FIELDS,
  REGISTRY_EDIT_LOAD_OUTCOMES,
  EMPTY_REGISTRY_FORM,
  isRegistryFieldRequired,
  missingRegistryRequiredLabels,
  registryRequiredFilled,
  registryFormDisabledReason,
  registryEditLoadOutcome,
  type RegistryFormState,
} from './community-form.ts';

/** A form with EVERY required field filled (and the optional ones blank) —
 *  built from the SSOT list, never from a hand-typed literal, so it stays
 *  correct if the list grows. */
function filledForm(overrides: Partial<RegistryFormState> = {}): RegistryFormState {
  const form: RegistryFormState = { ...EMPTY_REGISTRY_FORM };
  for (const { field } of REGISTRY_REQUIRED_FIELDS) {
    (form as Record<string, string>)[field] = `value-for-${field}`;
  }
  return { ...form, ...overrides };
}

/** The expected sentence, re-derived HERE from the SSOT — deliberately a
 *  second, independent implementation of the join so a hardcoded message in
 *  the module cannot pass this test once the list changes. */
function expectedFillReason(labels: readonly string[]): string {
  const list = labels.length === 1
    ? labels[0]!
    : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]!}`;
  return `Fill in ${list} first`;
}

// ---------------------------------------------------------------------------
// The SSOT itself
// ---------------------------------------------------------------------------

test('REGISTRY_REQUIRED_FIELDS is the real required set the bridge enforces: id, name, category, sourceUrl, provenance', () => {
  expect(REGISTRY_REQUIRED_FIELDS.map((f) => f.field)).toEqual(['id', 'name', 'category', 'sourceUrl', 'provenance']);
});

test('REGISTRY_REQUIRED_FIELDS does NOT contain desc or any field absent from the form — the two the shipped message invented', () => {
  const fields = REGISTRY_REQUIRED_FIELDS.map((f) => f.field as string);
  expect(fields).not.toContain('desc');
  expect(fields).not.toContain('upstream');
  for (const field of fields) {
    expect(Object.keys(EMPTY_REGISTRY_FORM)).toContain(field);
  }
});

test('isRegistryFieldRequired is derived from the SSOT for every field on the form — no second hand-maintained truth', () => {
  const required = new Set(REGISTRY_REQUIRED_FIELDS.map((f) => f.field as string));
  for (const field of Object.keys(EMPTY_REGISTRY_FORM) as Array<keyof RegistryFormState>) {
    expect(isRegistryFieldRequired(field)).toBe(required.has(field));
  }
});

// ---------------------------------------------------------------------------
// The gate — registryRequiredFilled
// ---------------------------------------------------------------------------

test('registryRequiredFilled: an empty form is not fillable', () => {
  expect(registryRequiredFilled(EMPTY_REGISTRY_FORM)).toBe(false);
});

test('registryRequiredFilled: every required field filled ⇒ true, with every optional field still blank', () => {
  expect(registryRequiredFilled(filledForm())).toBe(true);
});

// ENUMERATION — one case per required field, generated from the SSOT. A new
// required field automatically gains its own case here.
for (const { field, label } of REGISTRY_REQUIRED_FIELDS) {
  test(`registryRequiredFilled: blanking ONLY "${field}" disables the button`, () => {
    expect(registryRequiredFilled(filledForm({ [field]: '' } as Partial<RegistryFormState>))).toBe(false);
  });

  test(`registryRequiredFilled: whitespace in "${field}" is not a value`, () => {
    expect(registryRequiredFilled(filledForm({ [field]: '   ' } as Partial<RegistryFormState>))).toBe(false);
  });

  test(`the disabled reason names EXACTLY "${label}" when it is the only missing field`, () => {
    const reason = registryFormDisabledReason({
      form: filledForm({ [field]: '' } as Partial<RegistryFormState>),
      submitting: false,
      loadFailed: false,
    });
    expect(reason).toBe(expectedFillReason([label]));
  });
}

// ENUMERATION — an optional field left blank must NEVER disable the button.
test('a blank OPTIONAL field never disables the button and is never named in the reason', () => {
  const optional = (Object.keys(EMPTY_REGISTRY_FORM) as Array<keyof RegistryFormState>)
    .filter((f) => !isRegistryFieldRequired(f));
  expect(optional.length).toBeGreaterThan(0);
  for (const field of optional) {
    const form = filledForm({ [field]: '' } as Partial<RegistryFormState>);
    expect(registryRequiredFilled(form)).toBe(true);
    expect(registryFormDisabledReason({ form, submitting: false, loadFailed: false })).toBeNull();
  }
});

// ---------------------------------------------------------------------------
// The reason — DERIVED, structurally undriftable
// ---------------------------------------------------------------------------

test('the empty-form reason is the derived join of EVERY required label — adding a field to the SSOT changes it with no string edit', () => {
  const labels = REGISTRY_REQUIRED_FIELDS.map((f) => f.label);
  expect(registryFormDisabledReason({ form: EMPTY_REGISTRY_FORM, submitting: false, loadFailed: false }))
    .toBe(expectedFillReason(labels));
});

test('the reason never names "description" or "upstream" — the two fields the shipped string invented', () => {
  const reason = registryFormDisabledReason({ form: EMPTY_REGISTRY_FORM, submitting: false, loadFailed: false }) ?? '';
  expect(reason).not.toContain('description');
  expect(reason).not.toContain('upstream');
});

test('the reason names category and provenance — the two real required fields the shipped string left out', () => {
  const reason = registryFormDisabledReason({ form: EMPTY_REGISTRY_FORM, submitting: false, loadFailed: false }) ?? '';
  expect(reason).toContain('category');
  expect(reason).toContain('provenance');
});

test('missingRegistryRequiredLabels reports the missing labels in SSOT order, not input order', () => {
  const form = filledForm({ id: '', category: '' });
  expect(missingRegistryRequiredLabels(form)).toEqual(
    REGISTRY_REQUIRED_FIELDS.filter((f) => f.field === 'id' || f.field === 'category').map((f) => f.label),
  );
});

test('a fully-filled form has no disabled reason at all — null, never an empty string left behind', () => {
  expect(registryFormDisabledReason({ form: filledForm(), submitting: false, loadFailed: false })).toBeNull();
});

test('submitting outranks everything — the reason says Saving, even with fields missing', () => {
  expect(registryFormDisabledReason({ form: EMPTY_REGISTRY_FORM, submitting: true, loadFailed: false })).toBe('Saving…');
});

test('a failed load outranks the missing-fields reason — writing over a registry that could not be read is the worse move', () => {
  const reason = registryFormDisabledReason({ form: filledForm(), submitting: false, loadFailed: true }) ?? '';
  expect(reason).toContain('could not be read');
});

// ---------------------------------------------------------------------------
// E9 — registryEditLoadOutcome: 404 is NOT the same as "the bridge is down"
// ---------------------------------------------------------------------------

test('REGISTRY_EDIT_LOAD_OUTCOMES enumerates exactly the three distinct outcomes', () => {
  expect([...REGISTRY_EDIT_LOAD_OUTCOMES]).toEqual(['ok', 'not-found', 'error']);
});

test('registryEditLoadOutcome: a 200 carrying an item is "ok"', () => {
  expect(registryEditLoadOutcome({ ok: true, item: { id: 'x' }, status: 200 })).toBe('ok');
});

test('registryEditLoadOutcome: a 404 is "not-found" — the ONLY status that may render NotFound', () => {
  expect(registryEditLoadOutcome({ ok: false, status: 404 })).toBe('not-found');
});

test('registryEditLoadOutcome: a transport failure (NO status — the bridge was never reached) is "error", never "not-found"', () => {
  expect(registryEditLoadOutcome({ ok: false })).toBe('error');
});

// ENUMERATION — every non-404 status the bridge can answer with must classify
// as "error". A down/erroring bridge must never fabricate a "no such item"
// claim; that is the defect this row exists to prevent.
for (const status of [400, 401, 403, 405, 409, 422, 429, 500, 502, 503, 504]) {
  test(`registryEditLoadOutcome: HTTP ${status} is "error" — only a 404 may claim the row does not exist`, () => {
    expect(registryEditLoadOutcome({ ok: false, status })).toBe('error');
  });
}

test('registryEditLoadOutcome: ok:true with NO item is "error" — a malformed 200 is not a not-found', () => {
  expect(registryEditLoadOutcome({ ok: true, status: 200 })).toBe('error');
});

test('registryEditLoadOutcome: a 200 that somehow reports ok:false is "error", not "ok"', () => {
  expect(registryEditLoadOutcome({ ok: false, status: 200 })).toBe('error');
});
