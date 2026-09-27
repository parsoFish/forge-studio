/**
 * reset-report.ts — the reset contract's operator-facing report layer: which
 * app type (if any) `computeContractDrift` needs, and what each row in its
 * `DriftReport` is FOR (bead forge-mfv5.3.2, forge-mfv5.3.1). Split out of
 * reset.ts (800-line file cap) rather than grown in place; both concerns land
 * together since both are new for the same ruling and feed one call site.
 * `ContractSection`/`RawDriftRow`/`DriftRow` are imported TYPE-ONLY so this
 * file and reset.ts (which imports the VALUES below) never form a runtime
 * cycle — reset-command-resolve.ts's header documents the identical pattern.
 *
 * APP-TYPE (forge-mfv5.3.2): required only when some section would actually
 * regenerate FROM a starter. `sectionNeedsAppType` decides that per field
 * without picking one: a value matching NO shipped starter (hand-authored)
 * never needs one; a value no starter declares at all never needs one either
 * (nothing to regenerate TO); anything else — an undeclared field a starter
 * would fill, or a value template-derived from one starter — depends on
 * exactly which is picked, so the operator must say so (unchanged throw).
 *
 * PURPOSE + VERDICT (forge-mfv5.3.1): every row gets a one-sentence `purpose`
 * from the ONE table below. Exactly two element kinds also get a `verdict`:
 * 'skills' (reuses `resolveDeclaredSkillPath`, preflight-skills.ts) and
 * 'demoProcess' (reuses `checkDemoSkill`, preflight-demo.ts, verbatim) —
 * neither check is re-implemented here.
 */
import { guardedReadFile, listProjectStarters, projectStartersDir } from '@forge/kernel';

import { validateProjectConfig, type ProjectConfig } from './project-config.ts';
import { resolveDeclaredSkillPath } from './preflight-skills.ts';
import { checkDemoSkill } from './preflight-demo.ts';
import type { ContractSection, DriftRow, RawDriftRow } from './reset.ts';

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

// ---------------------------------------------------------------------------
// purpose + verdict (bead forge-mfv5.3.1)
// ---------------------------------------------------------------------------

/** ONE table, one sentence each — no other copy of these strings anywhere. */
const SECTION_PURPOSE: Record<ContractSection, string> = {
  'testProcess.local': 'The command a developer runs locally to check their own work before pushing.',
  'testProcess.ci': "The gate command forge runs to decide whether a cycle's change is green enough to merge.",
  'testProcess.acceptance': 'How forge recognizes a live-acceptance test run and which secret NAMES must be present to run one.',
  standing_work_item_acs: 'Testing invariants forge appends to every work item this project generates.',
  demoProcess: "The steps that capture and verify evidence a cycle's change works, compiled into the shipped demo.",
  skills: 'The project-specific skills an agent loads when working this project, and where their SKILL.md files live.',
  releaseProcess: "What happens after a cycle's change merges to main, before forge's release stage runs it.",
  buildProcess: "This project's build command, when it has one distinct from its test command.",
};

/** skills-resolve: each declared id resolves to a real SKILL.md? Reuses
 *  `resolveDeclaredSkillPath` — narrower than `checkSkills` on purpose (no
 *  git-tracked-ness check here). */
function skillsResolveVerdict(dir: string, forgeRoot: string, skills: string[] | undefined, artifactRoot: string | undefined): { pass: boolean; detail: string } {
  const declared = skills ?? [];
  if (declared.length === 0) return { pass: true, detail: 'no skills declared — nothing to resolve' };
  const missing = declared.filter((id) => resolveDeclaredSkillPath(dir, forgeRoot, id, artifactRoot) === null);
  if (missing.length === 0) return { pass: true, detail: `${declared.length} declared skill(s) all resolve to a SKILL.md` };
  const named = missing.map((id) => `${id} (missing .forge/skills/${id}/SKILL.md)`).join(', ');
  return { pass: false, detail: `${missing.length} of ${declared.length} declared skill(s) do not resolve: ${named}` };
}

/** Attaches `purpose` (every row) and `verdict` ('skills'/'demoProcess') to
 *  the rows already computed — a final pass, so `driftRow`/`resolveCommandRow`
 *  never carry a field they have no opinion on. */
export function attachReportMetadata(rows: readonly RawDriftRow[], dir: string, forgeRoot: string, config: ProjectConfig | null): DriftRow[] {
  return rows.map((row): DriftRow => {
    const purpose = SECTION_PURPOSE[row.section];
    if (row.section === 'skills') {
      return { ...row, purpose, verdict: skillsResolveVerdict(dir, forgeRoot, config?.skills, config?.artifactRoot) };
    }
    if (row.section === 'demoProcess') {
      // demo-capture: reuses `checkDemoSkill` verbatim (same `extractDrivableCommand` rule) — never re-implemented.
      const result = checkDemoSkill(dir);
      return { ...row, purpose, verdict: { pass: result.pass, detail: result.detail } };
    }
    return { ...row, purpose };
  });
}
