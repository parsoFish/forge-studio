/**
 * `detectVolumeCaseFolding` — direct filesystem evidence (never a
 * `process.platform` guess — a case-sensitive volume can be mounted on
 * macOS, and a case-folding one on Linux) of whether a directory's volume
 * folds case for directory-entry lookups. The shared MECHANISM behind every
 * staging module's duplicate-target check (bead forge-qn8's fix in
 * `@forge/agents`'s `materials-staging.ts`, mirrored by bead forge-gp4's fix
 * in `@forge/library`'s `skill-staging.ts` — this module used to be two
 * verbatim copies, one per package; see either module's own docstring for
 * its domain-specific duplicate-target rationale, this module owns only the
 * mechanism both delegate to through their own thin wrapper).
 *
 * METHOD: create a throwaway marker entry under `dir`, `statSync` it to
 * capture its `{dev, ino}`, then `statSync` the SAME name with every letter
 * case-flipped:
 *   - Both stats resolve to the same `{dev, ino}` → the two spellings are
 *     the SAME directory entry → the volume folds case → returns `true`.
 *   - The flipped spelling raises `ENOENT` → the two spellings are
 *     genuinely distinct, unrelated (absent) slots → the volume is
 *     case-sensitive → returns `false`.
 *   - The flipped-spelling stat fails for any OTHER reason (EACCES,
 *     ENOTDIR, ...) → indeterminate. Deliberate, documented choice: default
 *     CONSERVATIVE and report `true` (folding), so a caller's
 *     duplicate-target check catches MORE potential duplicates rather than
 *     fewer on an inconclusive read — never silently "assume
 *     case-sensitive", which would silently reopen the exact bug this probe
 *     exists to close.
 *
 * If the marker itself cannot even be CREATED (EACCES, ENOSPC, a read-only
 * mount, ...), the probe cannot run at all — this throws
 * `CaseFoldingProbeError` rather than silently falling back to a literal,
 * un-folded comparison (this repo forbids silent fallbacks; a
 * duplicate-target check that might silently be wrong is worse than one
 * that refuses to run). A caller wraps this in its OWN typed refusal
 * (`MaterialsStagingError` / `SkillStagingError`) so a probe failure still
 * surfaces through that module's established throw-not-return contract —
 * see either module's thin `detectVolumeCaseFolding` wrapper, which is what
 * every real caller (and `options.probeCaseFolding`'s default) actually
 * calls.
 */
import { writeFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/** Thrown when the probe's own marker cannot even be created. A caller
 *  wraps this in its own typed staging-refusal error — see this module's
 *  own docstring. */
export class CaseFoldingProbeError extends Error {}

/** Injectable seam for volume case-behaviour detection — lets the folding
 *  code path be driven deterministically in tests on a case-sensitive dev
 *  machine that cannot naturally produce a folding volume. `dir` is the
 *  real, caller-created root being staged into. */
export type CaseFoldingProbe = (dir: string) => boolean;

/** Marker-name prefix for the throwaway probe entry — namespaced and
 *  unlikely to collide with a real staged entry. */
const CASE_PROBE_PREFIX = '.forge-case-probe-';

/** Flips the case of every ASCII letter in `s` — the exact shape of the
 *  real bug (`Notes.md` vs `notes.md`, `SKILL.md` vs `skill.md`), never any
 *  other change. */
function flipAsciiCase(s: string): string {
  return s.replace(/[a-zA-Z]/g, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));
}

export function detectVolumeCaseFolding(dir: string): boolean {
  const marker = `${CASE_PROBE_PREFIX}${randomBytes(8).toString('hex')}-AbCdEf`;
  const markerPath = join(dir, marker);
  const flippedPath = join(dir, flipAsciiCase(marker));

  let markerStat: ReturnType<typeof statSync>;
  try {
    writeFileSync(markerPath, '');
    markerStat = statSync(markerPath);
  } catch (err) {
    throw new CaseFoldingProbeError(
      `case-folding probe could not run — refusing to stage without a reliable duplicate-target check: ${(err as Error).message}`,
    );
  }

  try {
    const flippedStat = statSync(flippedPath);
    return flippedStat.dev === markerStat.dev && flippedStat.ino === markerStat.ino;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return false;
    return true; // indeterminate read-back — conservative default, see docstring
  } finally {
    try {
      unlinkSync(markerPath);
    } catch {
      /* best-effort cleanup only — the folding decision above is already made */
    }
  }
}
