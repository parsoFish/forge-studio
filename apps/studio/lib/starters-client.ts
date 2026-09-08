/**
 * starters-client — the one client door to the starter-agent roster.
 *
 * Operator ruling 384: STARTER AGENTS ARE EXPLICIT OPT-IN. Saving a flow used
 * to materialise `dev`/`plan`/`review` as a side effect of resolving its
 * agent refs, so an operator who dragged a seeded canvas and pressed Save
 * gained three agents they never authored. The save now writes no roster agent
 * at all, and this route is the only thing that writes one.
 *
 * Its own module rather than a function in `studio-client.ts`, for the same
 * reason `hook-client` and `connection-client` are: that file sits at its
 * file-size baseline, and a per-domain door is a better separation than a
 * larger barrel. `bridge-client` is the shared transport either way.
 */
import { bridgeFetch } from './bridge-client';

/** What the seed wrote, and what was already there. The two are reported
 *  SEPARATELY by the bridge because they are different facts — "I made these"
 *  and "these existed" — and a second press must be able to say the second
 *  without claiming the first. */
export type StarterSeedResult = {
  readonly ok: boolean;
  /** Slugs this call wrote. Empty on a second press. */
  readonly seeded: readonly string[];
  /** Slugs that were already on disk and were left untouched. */
  readonly existing: readonly string[];
  readonly error?: string;
};

/**
 * Materialise the closed starter set, only because the operator asked.
 *
 * Idempotent by construction on the bridge side: pressed twice it writes once
 * and names the three that exist. Errors are returned, never thrown and never
 * swallowed — the caller renders what went wrong rather than a dead button.
 */
export async function seedStarterAgents(): Promise<StarterSeedResult> {
  try {
    const res = await bridgeFetch('/api/studio/starters/seed', {
      method: 'POST',
      headers: { 'x-forge-csrf': '1' },
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      seeded?: string[];
      existing?: string[];
      error?: string;
    };
    if (!res.ok) {
      return { ok: false, seeded: [], existing: [], error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: data.ok !== false, seeded: data.seeded ?? [], existing: data.existing ?? [] };
  } catch (err) {
    return { ok: false, seeded: [], existing: [], error: String(err) };
  }
}
