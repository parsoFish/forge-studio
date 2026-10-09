/**
 * url-decode.ts — the ONE percent-decoder every request-derived URL part
 * passes through.
 *
 * `decodeURIComponent` throws `URIError` on a malformed escape (`%E0%A4%A`,
 * `%`, `%zz`). Thrown out of an async route handler on an unauthenticated
 * request, that rejection is unhandled and Node exits — the bridge dies.
 * `decodeUrlPart` throws a NAMED error instead, which the bridge's top-level
 * dispatch maps to a 400 (`apps/forge/bridge-safe-dispatch.ts`).
 */

/** How much of the offending input the error message quotes. */
const ERROR_PREFIX_MAX = 80;

/** A request URL part carried a malformed percent-escape. */
export class MalformedUrlEncodingError extends Error {
  constructor(raw: string) {
    super(`malformed percent-encoding in request URL: ${JSON.stringify(raw.slice(0, ERROR_PREFIX_MAX))}`);
    this.name = 'MalformedUrlEncodingError';
  }
}

/** Percent-decode one URL part, or throw `MalformedUrlEncodingError`. */
export function decodeUrlPart(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new MalformedUrlEncodingError(raw);
  }
}
