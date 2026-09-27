/**
 * reset-report.ts — bead forge-mfv5.3.2: an app type is required only when
 * some contract section would actually regenerate FROM a starter. Split out
 * of reset.ts (800-line file cap) rather than grown in place.
 *
 * `sectionNeedsAppType` decides that per field without picking one: a value
 * matching NO shipped starter (hand-authored) never needs one; a value no
 * starter declares at all never needs one either (nothing to regenerate TO);
 * anything else — an undeclared field a starter would fill, or a value
 * template-derived from one starter — depends on exactly which is picked, so
 * the operator must say so (unchanged throw). `resolveAppTypeForReset`
 * replaces reset.ts's old `resolveAppType`: same throw, same message, for the
 * case that still needs one; a NEW non-throwing outcome (`appTypeNote` set)
 * for the case that does not.
 */
import { guardedReadFile, listProjectStarters, projectStartersDir } from '@forge/kernel';

import { validateProjectConfig, type ProjectConfig } from './project-config.ts';

/** Mirrors reset.ts's private `RegenMode` — re-declared, not imported, to
 *  avoid a VALUE import back into a file that imports this one's values. */
type RegenMode = 'unconditional' | 'fillOnly' | 'protected';

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Fail-fast: the one condition an operator must answer explicitly, never a
 *  guess (ruling 38 fix a — unchanged by forge-mfv5.3.2, only WHEN thrown). */
export class AppTypeUnresolvedError extends Error {
  readonly availableAppTypes: string[];
  constructor(message: string, availableAppTypes: string[]) {
    super(message);
    this.name = 'AppTypeUnresolvedError';
    this.availableAppTypes = availableAppTypes;
  }
}

/** Read + validate one starter's own `.forge/project.json`. Moved verbatim
 *  from reset.ts. */
function loadStarterConfig(forgeRoot: string, appType: string): ProjectConfig | null {
  const startersRoot = projectStartersDir(forgeRoot);
  const raw = guardedReadFile(startersRoot, [appType, '.forge', 'project.json']);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return validateProjectConfig(parsed);
}

/** Whether resolving THIS section depends on which starter is matched —
 *  see the file header. `everyStarterValue` spans every shipped starter. */
function sectionNeedsAppType(mode: RegenMode, current: unknown, everyStarterValue: readonly unknown[]): boolean {
  if (mode === 'protected' || everyStarterValue.length === 0) return false;
  if (current === undefined) return true;
  return everyStarterValue.some((v) => jsonEqual(v, current));
}

/** The six fields whose drift can vary by starter — excludes
 *  `testProcess.acceptance` ('protected') and 'skills' (no starter opinion). */
function anySectionNeedsAppType(config: ProjectConfig | null, everyStarter: readonly ProjectConfig[]): boolean {
  const across = (pick: (s: ProjectConfig) => unknown): unknown[] => everyStarter.map(pick).filter((v) => v !== undefined);
  return (
    sectionNeedsAppType('unconditional', config?.testProcess.local, across((s) => s.testProcess.local)) ||
    sectionNeedsAppType('fillOnly', config?.testProcess.ci, across((s) => s.testProcess.ci)) ||
    sectionNeedsAppType('fillOnly', config?.standing_work_item_acs, across((s) => s.standing_work_item_acs)) ||
    sectionNeedsAppType('unconditional', config?.demoProcess, across((s) => s.demoProcess)) ||
    sectionNeedsAppType('unconditional', config?.releaseProcess, across((s) => s.releaseProcess)) ||
    sectionNeedsAppType('fillOnly', config?.buildProcess, across((s) => s.buildProcess))
  );
}

export type AppTypeResolution = {
  appType: string | null;
  starter: ProjectConfig | null;
  /** Every starter forge ships, regardless of which is matched — the
   *  row-level hand-authored check needs the whole set. */
  everyStarter: ProjectConfig[];
  /** True only when no usable starter exists anywhere (bare/test forgeRoot):
   *  every mode collapses — nothing to compare against, nothing hand-authored. */
  isFullyProtected: boolean;
  /** Set only in the new no-app-type-needed outcome. */
  appTypeNote?: string;
};

/** Replaces reset.ts's old `resolveAppType`. `requested` wins over
 *  `persisted` when both are given, exactly as before. */
export function resolveAppTypeForReset(
  forgeRoot: string,
  requested: string | undefined,
  persisted: string | undefined,
  config: ProjectConfig | null,
): AppTypeResolution {
  const available = listProjectStarters(forgeRoot);
  const everyStarter = available.map((id) => loadStarterConfig(forgeRoot, id)).filter((s): s is ProjectConfig => s !== null);

  const explicit = requested ?? persisted;
  if (explicit !== undefined) {
    if (!available.includes(explicit)) {
      throw new AppTypeUnresolvedError(`reset: unknown appType "${explicit}" — available: ${available.join(', ') || '(none)'}`, available);
    }
    const starter = loadStarterConfig(forgeRoot, explicit);
    return { appType: explicit, starter, everyStarter, isFullyProtected: !starter };
  }

  if (available.length === 0) {
    return { appType: null, starter: null, everyStarter, isFullyProtected: true };
  }

  if (anySectionNeedsAppType(config, everyStarter)) {
    throw new AppTypeUnresolvedError(
      `reset: cannot determine this project's app type — .forge/project.json has no persisted appType and none was given. ` +
        `Pass --app-type explicitly (available: ${available.join(', ')})`,
      available,
    );
  }
  return { appType: null, starter: null, everyStarter, isFullyProtected: false, appTypeNote: 'no app type needed: every section is hand-authored' };
}
