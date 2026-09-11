/**
 * The strict-parse helpers the community wire parsers share.
 *
 * Extracted from `community-client.ts` (M6-D, ruling 616) when the refresh half
 * moved out to `community-refresh-client.ts` and both halves still needed them.
 * A second copy would have been the cheaper edit and the worse one: these are
 * the functions that decide what counts as a MALFORMED response, and two copies
 * of that decision is two answers to the same question.
 *
 * The rule they enforce, stated once here rather than in each caller: a parser
 * REFUSES (throws) on a malformed payload rather than coercing it. The
 * `Array.isArray(x) ? x : []` / `?? []` / `?? null` permissive-parse shape has
 * been found repeatedly in this campaign. Nullable fields are legitimately
 * null, but the KEY must be PRESENT — an ABSENT key is a malformed response,
 * never silently the same as an explicit null.
 */

export function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

export function asRecord(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    throw new Error(`expected a JSON object, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

export function requireString(r: Record<string, unknown>, key: string): string {
  const v = r[key];
  if (typeof v !== 'string') throw new Error(`expected "${key}" to be a string, got ${JSON.stringify(v)}`);
  return v;
}

export function requireBoolean(r: Record<string, unknown>, key: string): boolean {
  const v = r[key];
  if (typeof v !== 'boolean') throw new Error(`expected "${key}" to be a boolean, got ${JSON.stringify(v)}`);
  return v;
}

export function requireNumber(r: Record<string, unknown>, key: string): number {
  const v = r[key];
  if (typeof v !== 'number') throw new Error(`expected "${key}" to be a number, got ${JSON.stringify(v)}`);
  return v;
}

/** A field that is legitimately a number OR null (never absent — the KEY
 *  must still be present, mirroring `parseNullableField`'s own discipline
 *  below for object-shaped nullable fields). */
export function requireNullableNumber(r: Record<string, unknown>, key: string): number | null {
  if (!(key in r)) throw new Error(`expected "${key}" key to be present (explicit null is allowed, an absent key is not)`);
  const v = r[key];
  if (v === null) return null;
  if (typeof v !== 'number') throw new Error(`expected "${key}" to be a number or null, got ${JSON.stringify(v)}`);
  return v;
}

/** A field that is legitimately nullable MUST still be a PRESENT key
 *  (explicit `null` is honest; an absent key is a malformed response — this
 *  campaign's recurring "declared data fails open" shape, applied to parse
 *  time: silently treating "absent" the same as "explicitly none" hides a
 *  transport bug behind a plausible-looking value). */
/** A NULLABLE string field whose key must still be PRESENT. Four fields share
 *  this shape and each carried its own copy; one copy cannot drift. */
export function nullableString(r: Record<string, unknown>, key: string): string | null {
  return parseNullableField(r, key, (v) => {
    if (typeof v !== 'string') throw new Error(`expected "${key}" to be a string when present, got ${JSON.stringify(v)}`);
    return v;
  });
}

export function parseNullableField<T>(r: Record<string, unknown>, key: string, parse: (raw: unknown) => T): T | null {
  if (!(key in r)) throw new Error(`expected "${key}" key to be present (explicit null is allowed, an absent key is not)`);
  const v = r[key];
  return v === null ? null : parse(v);
}
