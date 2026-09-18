/**
 * story-schema-fail.mjs — how the story validator reports, and nothing else.
 *
 * Split out of `story-file.mjs` by `forge-8vfn.7.6.149`. A PURE MOVE: these
 * three functions are byte-identical to the ones that lived there, DECLARATION
 * LINES INCLUDED, and every caller now imports them instead of closing over
 * them.
 *
 * WHY ITS OWN MODULE rather than travelling with the wait schema. `fail` has
 * sixty call sites across both halves of the split, so wherever it lives the
 * other half must import it. Putting it inside `story-wait-schema.mjs` would
 * make `story-file.mjs` import its most-used primitive from a module named for
 * waits — a name that lies about what it holds. Three functions in a file
 * named for them is smaller than that lie.
 *
 * It imports nothing, which is what keeps the graph a DAG:
 *   story-file -> story-wait-schema -> story-schema-fail
 *   story-file ------------------------> story-schema-fail
 */

function fail(field, why) {
  throw new Error(`story is invalid — ${field}: ${why}`);
}

/**
 * A validator finding that is NOT fatal — 7.6.54 (ruling 795).
 *
 * Used for the one shape that is legal JavaScript, passes every structural
 * rule, and is almost certainly wrong: a literal `press` carrying `<name>`
 * where `name` is a declared binding. Refusing it outright would be wrong —
 * a press may legitimately contain angle brackets — so it warns and names the
 * form that works. It prints on stderr rather than returning quietly, because
 * a finding nobody sees is the defect this campaign keeps meeting.
 */
function warn(field, why) {
  console.warn(`[stories] story warning — ${field}: ${why}`);
}

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(field, `expected a non-empty string, got ${JSON.stringify(value)}`);
  }
}

export { fail, warn, requireNonEmptyString };
