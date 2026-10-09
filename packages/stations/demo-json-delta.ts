/**
 * The JSON half of the control (forge-mfv5.1.19): an `api-before-after`
 * checkpoint's before/after bodies are compared after dropping volatile keys
 * at any depth and sorting keys, so a re-minted id or a fresh timestamp never
 * reads as changed behaviour. `demo-delta.ts` decides when this applies.
 */

/** Keys whose value differs on every read of an unchanged resource. Also
 *  volatile: any key ending `_url` and any key starting `watchers`. */
export const DEFAULT_VOLATILE_JSON_KEYS: readonly string[] = Object.freeze([
  'id', 'node_id', 'created_at', 'updated_at', 'pushed_at', 'url', 'etag', 'size',
]);

const isVolatile = (key: string, ignoreKeys: readonly string[]): boolean =>
  DEFAULT_VOLATILE_JSON_KEYS.includes(key) || ignoreKeys.includes(key) || key.endsWith('_url') || key.startsWith('watchers');

function strip(value: unknown, ignoreKeys: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((v) => strip(v, ignoreKeys));
  if (value === null || typeof value !== 'object') return value;
  const kept = Object.keys(value).sort().filter((k) => !isVolatile(k, ignoreKeys));
  return Object.fromEntries(kept.map((k) => [k, strip((value as Record<string, unknown>)[k], ignoreKeys)]));
}

/** The canonical, line-per-field form of a JSON body with volatile keys
 *  removed, or `null` when the text is not JSON. Pure. */
export function normaliseJsonBody(text: string, ignoreKeys: readonly string[]): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return JSON.stringify(strip(parsed, ignoreKeys), null, 2);
}
