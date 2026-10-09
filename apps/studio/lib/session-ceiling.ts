/**
 * forge-nk1y.5 — a session's spend ceiling on the wire: `{usd, source}` or
 * `null` (the session recorded none). Parsed REQUIRED-nullable like
 * `finalized` in session-client.ts: a missing key or a wrong shape throws by
 * name. Its own file because session-client.ts is at its size exemption.
 */
function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

/** forge-nk1y.5 — mirrors `SessionCeilingSource` (packages/sessions); the
 *  client cannot import it, so the closed vocabulary is restated and parsed. */
export const SESSION_CEILING_SOURCES = ['operator', 'env', 'agent-budget'] as const;
export type SessionCeiling = { usd: number; source: (typeof SESSION_CEILING_SOURCES)[number] };

export function parseSessionCeiling(raw: Record<string, unknown>): SessionCeiling | null {
  if (!('ceiling' in raw)) {
    throw new Error('missing "ceiling" — expected {usd, source} or null, never an omitted key');
  }
  const c = raw['ceiling'];
  if (c === null) return null;
  const source = isPlainObject(c) ? SESSION_CEILING_SOURCES.find((s) => s === c['source']) : undefined;
  if (!isPlainObject(c) || typeof c['usd'] !== 'number' || !Number.isFinite(c['usd']) || c['usd'] <= 0 || source === undefined) {
    throw new Error(
      `missing or invalid "ceiling": expected {usd: positive number, source: ${SESSION_CEILING_SOURCES.join('|')}} or null, got ${JSON.stringify(c)}`,
    );
  }
  return { usd: c['usd'], source };
}
