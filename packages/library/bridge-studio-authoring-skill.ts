/**
 * `kind:'skill'` install strategy for the studio-authoring finalize route.
 * Split out of `bridge-studio-authoring.ts` (M4-library PR 4b) — see that
 * file's header for the full route contract this strategy is one arm of.
 *
 * `sanitizeError` rides in as a parameter (never a direct `cli/` import)
 * because that would make this a NEW importer of `apps/forge/bridge-studio.ts` —
 * the retained route file already imports it and passes it down.
 */

import { installSkillPackage, SkillIdOccupiedError } from './studio/skill-install.ts';
import type { InstallOutcome } from './bridge-studio-authoring-types.ts';

/** Server-minted provenance for every package this route installs — the
 *  provenance of an authored package IS the session that authored it. Never
 *  read from the request body (a client-supplied upstream is unverifiable). */
const AUTHORING_UPSTREAM_SOURCE = 'forge-authoring';

// ---------------------------------------------------------------------------
// kind:"skill" — installs the LANDED package (_interactive-library/<id>/) via
// the SAME installSkillPackage every other skill-install path uses.
// ---------------------------------------------------------------------------

export async function finalizeSkillFromLanded(
  forgeRoot: string,
  packageDir: string,
  id: string,
  sessionId: string,
  sanitizeError: (err: unknown) => string,
): Promise<InstallOutcome> {
  try {
    // D-5/D6: always lands a DRAFT (status:'draft', library:false) —
    // approveSkillDraft is never called from this route. Upstream is
    // SERVER-MINTED, never read from the request body.
    const result = installSkillPackage({
      forgeRoot,
      id,
      packageDir,
      upstream: { source: AUTHORING_UPSTREAM_SOURCE, ref: sessionId },
    });
    // Finding 2 fix: installSkillPackage is idempotent BY DESIGN — an
    // existing skills/<id>/SKILL.md means it wrote NOTHING and the
    // operator's authored draft was just silently discarded. The two
    // sibling callers of this same function (packages/library/bridge-studio-skills.ts,
    // packages/library/bridge-studio-community.ts) both surface `alreadyInstalled`; this
    // route must too, rather than reporting the discard as a 200 success.
    if (result.alreadyInstalled) {
      return { ok: false, status: 409, error: `skill "${id}" already exists — choose a different id` };
    }
    return { ok: true };
  } catch (err) {
    // W7-B3 (library-31): an id occupied by an UNMANAGED local skill now
    // throws the NAMED SkillIdOccupiedError instead of answering a false
    // `alreadyInstalled` — for this route it is the SAME operator fact as
    // the managed collision above: the id is taken, pick another. 409.
    if (err instanceof SkillIdOccupiedError) {
      return { ok: false, status: 409, error: `skill "${id}" already exists — choose a different id` };
    }
    // Every OTHER installSkillPackage throw (bad slug, no SKILL.md at the
    // package root, cap exceeded, binary file, escaping destination, ...)
    // is a caller-input problem by contract — 400, never a 500 here.
    return { ok: false, status: 400, error: sanitizeError(err) };
  }
}
