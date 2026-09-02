/**
 * `forge project reset <id>` + Studio's "Rebuild contract" (S3, 1.0.md §3) —
 * the ONE new capability M4 adds to the projects package. Regenerates the
 * mechanisms forge itself owns in a drifted project's `.forge/project.json`
 * (`testProcess`, `demoProcess`, `releaseProcess`, `buildProcess`,
 * `standing_work_item_acs`) and relocates any bound project skill whose
 * `SKILL.md` sits outside the resolver's hardcoded scan path, while leaving
 * every judgment-carrying field (`northStar`, `instructions`, `kb`,
 * `artifactRoot`, `repo`, `name`, secret VALUES) untouched. See
 * `_1.0/plans/M4-projects-reset-spec.md` for the file:line research this
 * design is built from (Q1-Q6); the deviations from that spec's literal Q2/Q5
 * proposals are called out inline below, each with its own reasoning.
 *
 * TWO-PHASE, MATCHING THE REST OF THIS PACKAGE'S WRITE PATH (the PUT
 * `/api/studio/projects/:id` route this mirrors, `cli/bridge-studio-writes.ts`):
 * `computeContractDrift` is PURE — it reads the tree and the matched
 * app-type starter, and returns every row the caller would need to render a
 * before/after diff, WITHOUT writing anything. `applyContractReset` takes
 * that SAME report back and writes ONLY the sections it names — never a
 * section the caller didn't ask for, never a filesystem path not already
 * named in `drift.skillMoves`. This is deliberate: Studio's "Rebuild
 * contract" shows the drift report before the operator confirms, and the CLI
 * defaults to the same dry-run-first behaviour (see `cmdProjectReset` below).
 *
 * SKILL-RESOLUTION SPEC DEVIATION (Q1's own finding, not a guess): the
 * resolver `deriveProjectLocalSkills` (`cli/bridge-studio.ts:480-491`) scans
 * the LITERAL, hardcoded path `<project>/.forge/skills/<id>/SKILL.md` — one
 * level deep — and `artifactRoot` never enters that function or its caller
 * (independently confirmed three ways in the spec). This module follows the
 * CODE, not `docs/forge-project-contract.md`'s stale `<artifactRoot>/skills/`
 * line (corrected in the same PR that lands this file — see that doc's
 * "Artifact layout" section).
 *
 * SECRETS (D3, load-bearing): this module NEVER opens a file named
 * `secrets.env`, in this project or anywhere else, under any code path. It
 * reads and writes `testProcess.acceptance.requiresEnv` — NAMES only — the
 * same rule `packages/projects/contract-stages.ts`'s `deriveSecretsRow`
 * already states for the analogous read-only surface. See
 * `reset-preservation.test.ts` for the call-record assertion that pins this.
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import {
  FORGE_ROOT,
  PROJECT_ID_RE,
  defaultConfigPath,
  guardedFile,
  guardedReadFile,
  guardedRename,
  listProjectStarters,
  loadConfig,
  projectStartersDir,
  resolveGuardedPath,
  resolveProjectsDir,
  PathGuardContainmentError,
} from '@forge/kernel';

import {
  PROJECT_CONFIG_REL_PATH,
  injectSidecarIntoTestProcess,
  loadProjectConfig,
  readQualityGateSidecar,
  validateProjectConfig,
  type ProjectConfig,
} from './project-config.ts';
import { withStudioWrite } from './project-repo-tx.ts';
import { runPreflight, type PreflightReport } from './preflight.ts';

// ---------------------------------------------------------------------------
// Types (Q5's proposal, refined — see the deviations noted per field below)
// ---------------------------------------------------------------------------

/**
 * The regenerated-set fields — deliberately excludes `northStar`,
 * `instructions`, `kb`, `artifactRoot`, `repo`, `name`, `metrics`, `sweep`,
 * `logging` (Q5): those never appear as a row, so a caller can never mistake
 * "not mentioned" for "unchanged" on a field this report has no authority
 * over.
 */
export type ContractSection =
  | 'testProcess.local'
  | 'testProcess.ci'
  | 'testProcess.acceptance'
  | 'standing_work_item_acs'
  | 'demoProcess'
  | 'skills'
  | 'releaseProcess'
  | 'buildProcess';

/**
 * Q5 proposes all four; this module only ever emits 'add' / 'unchanged' /
 * 'regenerate'. 'preserve' is kept in the union for forward-compat (a future
 * section might need "field exists, value untouched, but for a REASON
 * distinct from before===after") but is currently unreachable — every
 * ContractSection row's action is decided purely by before/after equality
 * (see `driftRow` / `computeSkillsDrift`).
 */
export type DriftAction = 'regenerate' | 'preserve' | 'add' | 'unchanged';

export type DriftRow = {
  section: ContractSection;
  /** What's on disk today (via the already-validated `ProjectConfig`); `undefined` ⇒ absent. */
  before: unknown;
  /** What the reset WOULD write. */
  after: unknown;
  action: DriftAction;
};

export type SkillMove = {
  id: string;
  /** Relative path (project-dir-relative) the SKILL.md dir was found at, or
   *  `null` when nothing was found at either the canonical location or the
   *  one evidenced alternate (`<artifactRoot>/skills/<id>/`) — named, never
   *  silently skipped. */
  from: string | null;
  /** Always `.forge/skills/<id>` — the resolver's one hardcoded location. */
  to: string;
};

export type DriftReport = {
  projectDir: string;
  projectId: string;
  /**
   * The app-type starter this drift was computed against, or `null` when
   * none could be resolved (no `studio/starters/projects/` entries under
   * `forgeRoot` — a bare/test forgeRoot). SPEC DEVIATION: Q5 types this as a
   * required `string`. There is genuinely no on-disk record of which
   * scaffold produced an EXISTING project (confirmed independently:
   * `packages/library/…project-scaffold-usage…` — "appType is validated at
   * creation but is never persisted in .forge/project.json"), so
   * `computeContractDrift` cannot always produce one; `null` is the honest
   * value for that case, not a fabricated derivation.
   */
  appType: string | null;
  /** The `forgeRoot` the drift was resolved against — carried so
   *  `applyContractReset`'s post-write `runPreflight` uses the SAME root
   *  (not in Q5's proposal; needed so the two-phase call doesn't have to
   *  re-derive or risk disagreeing on it). */
  forgeRoot: string;
  rows: DriftRow[];
  skillMoves: SkillMove[];
};

export type ResetResult = {
  projectId: string;
  /** Only the rows whose action was 'regenerate' or 'add'. */
  applied: DriftRow[];
  skillMovesApplied: SkillMove[];
  /** Re-run preflight after the write, same shape `runPreflight` returns. */
  preflight: PreflightReport;
};

// ---------------------------------------------------------------------------
// computeContractDrift — PURE. Reads the tree; writes nothing, spawns nothing.
// ---------------------------------------------------------------------------

/**
 * Resolve the app-type starter to diff against. An EXPLICIT `requested`
 * appType that isn't a real starter throws (an "unresolvable projectDir/
 * appType" per this module's own contract); an omitted one degrades
 * gracefully to `null` (no starters at all under `forgeRoot`) or the
 * deterministic default `'typescript-cli'` when available, else the first
 * starter alphabetically (`listProjectStarters` already sorts) — never a
 * throw, since "no appType known" is an ordinary, expected outcome for an
 * existing project (see the `DriftReport.appType` doc above).
 */
function resolveAppType(forgeRoot: string, requested: string | undefined): string | null {
  const available = listProjectStarters(forgeRoot);
  if (requested !== undefined) {
    if (!available.includes(requested)) {
      throw new Error(`reset: unknown appType "${requested}" — available: ${available.join(', ') || '(none)'}`);
    }
    return requested;
  }
  if (available.length === 0) return null;
  return available.includes('typescript-cli') ? 'typescript-cli' : available[0];
}

/**
 * Read `<forgeRoot>/studio/starters/projects/<appType>/.forge/project.json`
 * and validate it — the SAME `validateProjectConfig` every other config
 * consumer uses (ruling 5: the starter's own project.json + the validator's
 * schema are the machine-readable source; `project.json.example` is
 * documentation this module never parses). Template tokens (`{{NAME}}` etc.)
 * only ever appear in `name`/`northStar`/`instructions`/`kb` — none of which
 * this module reads from a starter — so validating the raw, unsubstituted
 * JSON is safe.
 */
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

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * How a section's `after` value is derived from the matched starter — THREE
 * modes, not Q2's flat "regenerate | regenerate-if-declared | preserve"
 * per-field prose, because a flat reading is unsafe: Q2 (literally) makes
 * every conditional field's regenerated value TRACK the starter exactly,
 * "else absent" — which means a project's own `testProcess.ci`/
 * `standing_work_item_acs`/`buildProcess` would be silently WIPED by any
 * reset, since none of the three shipped starters declare any of them. That
 * is real, disclosed-in-the-drift-report-first destructive behaviour for
 * fields no test in this suite requires "regenerated" — so this module only
 * takes the starter's word UNCONDITIONALLY for the three fields Q2 AND this
 * package's own tests actually exercise as regenerated
 * (`testProcess.local`/`demoProcess`/`releaseProcess`); everything else the
 * starter has no opinion on is a FILL — the starter wins only when it
 * declares something and the project doesn't, never a clear of an existing
 * declaration the current template simply doesn't mention.
 *
 *   - `'unconditional'` — `after = starterValue`, even `undefined` (clears a
 *     stale declaration the current template no longer wants).
 *   - `'fillOnly'`       — `after = starterValue ?? current` (starter fills
 *     an absence; never clears an existing declaration).
 *   - `'protected'`      — `after = current`, always; the starter is never
 *     consulted. `testProcess.acceptance` only (Q3's secret-NAMES carve-out
 *     — no starter can know which env vars THIS project's live-acceptance
 *     tier needs, so this section is never sourced from a template at all).
 */
type RegenMode = 'unconditional' | 'fillOnly' | 'protected';

function driftRow(section: ContractSection, current: unknown, starterValue: unknown, mode: RegenMode): DriftRow {
  const after = mode === 'protected' ? current : mode === 'unconditional' ? starterValue : (starterValue !== undefined ? starterValue : current);
  const action: DriftAction =
    current === undefined && after !== undefined
      ? 'add'
      : jsonEqual(current, after)
        ? 'unchanged'
        : 'regenerate';
  return { section, before: current, after, action };
}

function artifactRootSegments(artifactRoot: string | undefined): string[] {
  if (!artifactRoot) return [];
  return artifactRoot.split('/').filter((s) => s.length > 0 && s !== '.');
}

/**
 * Q1's mechanism. For every bound skill id: already resolved at the
 * resolver's ONE hardcoded location (`.forge/skills/<id>/SKILL.md`) ⇒ no
 * drift, not even a row. Not resolved there ⇒ probe the one evidenced
 * alternate (`<artifactRoot>/skills/<id>/SKILL.md`); found ⇒ a named move;
 * not found anywhere ⇒ `from: null`, still named (never silently dropped).
 * Every probe rides `guardedFile` — the SAME call `deriveProjectLocalSkills`
 * makes — so a malicious id (`..`, an embedded `/`, a symlinked segment)
 * fails the guard's `isSafeSegment`/identity walk and simply reads as "not
 * found here either", never reaching a raw fs call (see
 * `reset-containment.test.ts`).
 */
function computeSkillsDrift(
  projectDir: string,
  skills: string[] | undefined,
  artifactRoot: string | undefined,
): { row: DriftRow; skillMoves: SkillMove[] } {
  const ids = skills ?? [];
  const artifactSegs = artifactRootSegments(artifactRoot);
  const moves: SkillMove[] = [];

  for (const id of ids) {
    const resolved = guardedFile(projectDir, ['.forge', 'skills', id, 'SKILL.md'], 'read') !== null;
    if (resolved) continue;

    const altSegments = [...artifactSegs, 'skills', id, 'SKILL.md'];
    const foundAlt = artifactSegs.length > 0 && guardedFile(projectDir, altSegments, 'read') !== null;
    moves.push({
      id,
      from: foundAlt ? [...artifactSegs, 'skills', id].join('/') : null,
      to: ['.forge', 'skills', id].join('/'),
    });
  }

  // The row's action tracks whether `applyContractReset` will actually WRITE
  // anything for it — an id with no resolved source anywhere (`from: null`)
  // is still named in `skillMoves` (never silently dropped), but moves
  // nothing, so it must not mark the row 'regenerate' on its own (that would
  // make `applyContractReset` stage a no-op JSON rewrite whenever every
  // unresolved id has no findable source — see `reset-containment.test.ts`).
  const action: DriftAction = moves.some((m) => m.from !== null) ? 'regenerate' : 'unchanged';
  return { row: { section: 'skills', before: skills, after: skills, action }, skillMoves: moves };
}

/**
 * PURE — reads `.forge/project.json` (via `loadProjectConfig`, so a
 * malformed / un-migrated config throws exactly as it does everywhere else
 * in this package; `forge project migrate` is the remedy for the latter —
 * Q6, this module never re-implements that mapping), the matched starter's
 * own `.forge/project.json`, and `.forge/skills/**`. Writes nothing, spawns
 * nothing. Throws on an unresolvable `projectDir` or an explicitly-requested
 * unknown `appType`; never on a merely-drifted config.
 */
export function computeContractDrift(
  projectDir: string,
  opts: { forgeRoot?: string; appType?: string } = {},
): DriftReport {
  const dir = resolve(projectDir);
  let dirStat;
  try {
    dirStat = statSync(dir);
  } catch {
    throw new Error(`reset: no project directory at ${dir}`);
  }
  if (!dirStat.isDirectory()) throw new Error(`reset: not a directory: ${dir}`);

  const projectId = basename(dir);
  const forgeRoot = resolve(opts.forgeRoot ?? FORGE_ROOT);

  const config = loadProjectConfig(dir); // ProjectConfig | null; propagates a malformed-config throw

  const appType = resolveAppType(forgeRoot, opts.appType);
  const starter = appType ? loadStarterConfig(forgeRoot, appType) : null;
  // When NO starter resolves at all (no `studio/starters/projects/` entries
  // under `forgeRoot`), there is no template to regenerate from — every
  // field must fall back to 'protected' regardless of its declared mode, or
  // 'unconditional' would clear a project's own valid declarations to
  // `undefined` for want of ANY comparison basis (a real bug this module's
  // own containment tests caught: `reset-containment.test.ts` deliberately
  // runs against a starter-less forgeRoot).
  const mode = (m: RegenMode): RegenMode => (starter ? m : 'protected');

  const rows: DriftRow[] = [
    driftRow('testProcess.local', config?.testProcess.local, starter?.testProcess.local, mode('unconditional')),
    driftRow('testProcess.ci', config?.testProcess.ci, starter?.testProcess.ci, mode('fillOnly')),
    // Secret NAMES carve-out (Q3): never sourced from a starter — no starter
    // declares `acceptance` at all, and even if one did, a template cannot
    // know which env vars THIS project's live-acceptance tier needs.
    driftRow('testProcess.acceptance', config?.testProcess.acceptance, undefined, 'protected'),
    driftRow('standing_work_item_acs', config?.standing_work_item_acs, starter?.standing_work_item_acs, mode('fillOnly')),
    driftRow('demoProcess', config?.demoProcess, starter?.demoProcess, mode('unconditional')),
    driftRow('releaseProcess', config?.releaseProcess, starter?.releaseProcess, mode('unconditional')),
    driftRow('buildProcess', config?.buildProcess, starter?.buildProcess, mode('fillOnly')),
  ];

  const { row: skillsRow, skillMoves } = computeSkillsDrift(dir, config?.skills, config?.artifactRoot);
  rows.push(skillsRow);

  return { projectDir: dir, projectId, appType, forgeRoot, rows, skillMoves };
}

// ---------------------------------------------------------------------------
// applyContractReset — writes ONLY what `drift` names.
// ---------------------------------------------------------------------------

/** Merge the applied rows into the raw (pre-parse) JSON object, section by
 *  section. `testProcess`'s three sub-fields are merged into ONE nested
 *  object so a row that regenerates `local` alone never clobbers a sibling
 *  `ci`/`acceptance` this pass didn't touch. `undefined` deletes the key
 *  (a starter that regenerates a field to "not declared"). The `skills`
 *  section is a no-op here — the JSON array never changes, only the
 *  on-disk location of the directories it names (handled separately). */
function applyRowsToRaw(raw: Record<string, unknown>, rows: DriftRow[]): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...raw };
  const existingTestProcess: Record<string, unknown> =
    raw.testProcess && typeof raw.testProcess === 'object' && !Array.isArray(raw.testProcess)
      ? { ...(raw.testProcess as Record<string, unknown>) }
      : {};
  let testProcessTouched = false;

  const setOrDelete = (key: string, value: unknown) => {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  };

  for (const row of rows) {
    switch (row.section) {
      case 'testProcess.local':
        testProcessTouched = true;
        if (row.after === undefined) delete existingTestProcess.local;
        else existingTestProcess.local = row.after;
        break;
      case 'testProcess.ci':
        testProcessTouched = true;
        if (row.after === undefined) delete existingTestProcess.ci;
        else existingTestProcess.ci = row.after;
        break;
      case 'testProcess.acceptance':
        testProcessTouched = true;
        if (row.after === undefined) delete existingTestProcess.acceptance;
        else existingTestProcess.acceptance = row.after;
        break;
      case 'standing_work_item_acs':
        setOrDelete('standing_work_item_acs', row.after);
        break;
      case 'demoProcess':
        setOrDelete('demoProcess', row.after);
        break;
      case 'releaseProcess':
        setOrDelete('releaseProcess', row.after);
        break;
      case 'buildProcess':
        setOrDelete('buildProcess', row.after);
        break;
      case 'skills':
        break; // filesystem-only — see computeSkillsDrift / the move loop below
    }
  }
  if (testProcessTouched) merged.testProcess = existingTestProcess;
  return merged;
}

/** Guard-terminal `.forge/skills` ensure — `resolveGuardedPath`'s own
 *  create-mode reassembles BOTH `.forge` and `.forge/skills` literally when
 *  neither exists yet, so one call covers both levels; `mkdirSync` runs only
 *  on the guard's own `realPath`, never a re-joined string. */
function ensureForgeSkillsDir(projectDir: string): void {
  const guarded = resolveGuardedPath(projectDir, ['.forge', 'skills']);
  if (!guarded.ok) {
    throw new PathGuardContainmentError(`reset: .forge/skills containment check failed: ${guarded.reason}`);
  }
  if (!guarded.exists) mkdirSync(guarded.realPath, { recursive: true });
}

/**
 * Writes ONLY the sections `drift` names as 'regenerate'/'add' — never a
 * section the caller didn't ask for, never a filesystem path not already
 * named in `drift.skillMoves`. Idempotent: applying the SAME drift report
 * twice produces the SAME on-disk state (the second run's own
 * `computeContractDrift` reports all-'unchanged').
 *
 * ORDER + FAILURE MODE: skill moves run FIRST, each through `guardedRename`
 * (kernel, already the containment-reviewed primitive — ruling 3, this
 * module never writes a second move path); on the FIRST rejection the whole
 * call throws immediately (fail-closed) and does NOT roll back moves that
 * already succeeded — the same disclosed-residual stance
 * `scaffoldGreenfieldProject`'s header takes ("fail-safe-and-manual beats
 * automatic-and-occasionally-catastrophic") for an operation that, unlike
 * that one, has no all-new staging tree to unwind: these are an EXISTING
 * project's live files, and every move this function makes was already
 * named in the drift report the operator reviewed before confirming apply.
 * A thrown error never reaches `withStudioWrite`, so the `.forge/project.json`
 * write below never runs and nothing is committed to `forge-studio` — the
 * partially-moved directories are left as real, visible, uncommitted
 * working-tree changes for the operator to inspect via `git status`, not a
 * silent half-reset.
 */
export function applyContractReset(projectDir: string, drift: DriftReport): ResetResult {
  const dir = resolve(projectDir);
  if (dir !== drift.projectDir) {
    throw new Error(`reset: drift report was computed for ${drift.projectDir}, not ${dir}`);
  }

  const skillMovesApplied: SkillMove[] = [];
  const realMoves = drift.skillMoves.filter((m) => m.from !== null);
  if (realMoves.length > 0) ensureForgeSkillsDir(dir);
  for (const move of realMoves) {
    guardedRename(dir, (move.from as string).split('/'), move.to.split('/'));
    skillMovesApplied.push(move);
  }

  // COMMIT SCOPE: every path this call wrote, and nothing else. `paths` is
  // not optional here — `commitStudioChange` falls through to
  // `git add -A -- .` when it is absent, which would sweep any unrelated
  // dirty file in the operator's working tree into a commit messaged
  // "reset project contract" (and, on a project whose .gitignore is wrong,
  // a secrets file with it). Both other `withStudioWrite` call sites in the
  // repo scope their paths; this one now does too. Note the moves must be
  // listed EXPLICITLY: the unscoped `add -A` was the only thing committing
  // them, so scoping without naming them would have quietly stopped the
  // relocation from ever being committed.
  const movePaths = skillMovesApplied.flatMap((m) => [m.from as string, m.to]);

  const applied = drift.rows.filter((r) => r.action === 'regenerate' || r.action === 'add');
  if (applied.length > 0) {
    const guarded = resolveGuardedPath(dir, PROJECT_CONFIG_REL_PATH.split('/'));
    if (!guarded.ok) {
      throw new PathGuardContainmentError(`reset: .forge/project.json containment check failed: ${guarded.reason}`);
    }
    const existingRaw: Record<string, unknown> = guarded.exists
      ? (JSON.parse(readFileSync(guarded.realPath, 'utf8')) as Record<string, unknown>)
      : {};
    const merged = applyRowsToRaw(existingRaw, applied);

    // Validate BEFORE writing (Q4/ruling 5: `validateProjectConfig`'s schema
    // is the source of truth) — sidecar injected into a VALIDATION COPY only,
    // mirroring `loadProjectConfig`/the PUT route's own single-source rule;
    // the sidecar file is never read by anything but `readQualityGateSidecar`
    // itself, and never written here.
    const forValidation: Record<string, unknown> = structuredClone(merged);
    const sidecar = readQualityGateSidecar(dir);
    if (sidecar) injectSidecarIntoTestProcess(forValidation, sidecar);
    validateProjectConfig(forValidation);

    const forgeDirGuard = resolveGuardedPath(dir, ['.forge']);
    if (!forgeDirGuard.ok) {
      throw new PathGuardContainmentError(`reset: .forge containment check failed: ${forgeDirGuard.reason}`);
    }
    if (!forgeDirGuard.exists) mkdirSync(forgeDirGuard.realPath, { recursive: true });

    withStudioWrite(
      dir,
      'forge-studio: reset project contract',
      () => {
        writeFileSync(guarded.realPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
      },
      [PROJECT_CONFIG_REL_PATH, ...movePaths],
    );
  } else if (movePaths.length > 0) {
    // Moves happened but no config section changed: still commit the
    // relocation, scoped the same way. Before this branch existed the moves
    // reached a commit only as collateral of the unscoped `add -A`.
    withStudioWrite(dir, 'forge-studio: reset project skill layout', () => undefined, movePaths);
  }

  const preflight = runPreflight(dir, { forgeRoot: drift.forgeRoot });

  return { projectId: drift.projectId, applied, skillMovesApplied, preflight };
}

// ---------------------------------------------------------------------------
// `forge project reset <id>` — CLI entry. `apps/forge/cli.ts` routes to this
// with a single dispatch line (host: cli.ts repoint), mirroring
// `cmdProjectMigrate` (project-migrate.ts) exactly.
// ---------------------------------------------------------------------------

function printDriftReport(drift: DriftReport): void {
  console.log(`project: ${drift.projectId}`);
  console.log(`app type: ${drift.appType ?? '(unresolved — no starter matched; regeneration limited to what is already declared)'}`);
  console.log('');
  console.log('drift report:');
  for (const row of drift.rows) {
    console.log(`  [${row.action}] ${row.section}`);
    if (row.action !== 'unchanged') {
      console.log(`      before: ${JSON.stringify(row.before)}`);
      console.log(`      after:  ${JSON.stringify(row.after)}`);
    }
  }
  if (drift.skillMoves.length > 0) {
    console.log('');
    console.log('skill relocations:');
    for (const move of drift.skillMoves) {
      console.log(`  ${move.id}: ${move.from ?? '(no source found)'} -> ${move.to}`);
    }
  }
}

/**
 * `forge project reset <id> [--apply]`. Dry-run is the DEFAULT and needs no
 * confirmation — it only computes + prints the drift report; `--dry-run` is
 * also accepted explicitly (same behaviour) for callers that want to name it.
 * Only `--apply` writes.
 */
export function cmdProjectReset(args: string[]): number {
  const id = args[0];
  if (!id || id.startsWith('-')) {
    console.error('usage: forge project reset <project-id> [--dry-run|--apply]');
    return 2;
  }
  if (!PROJECT_ID_RE.test(id)) {
    console.error(`forge project reset: invalid project id — must match ${PROJECT_ID_RE}`);
    return 2;
  }
  const apply = args.includes('--apply');

  // NOT `resolve('.')`. That reads the process cwd, and it is correct today
  // only by accident: `apps/forge/cli.ts:51` does `process.chdir(FORGE_ROOT)`
  // before dispatch, two files away from here. Anything else calling this
  // function — the Studio "Rebuild contract" route this module's own header
  // anticipates, a daemon, a test — would resolve the projects root against
  // whatever cwd it happened to have, and a wrong root here does not fail
  // loudly: it makes the projects scan come up empty, or worse, resolve
  // somewhere real. Anchor on kernel's depth- and cwd-independent constant.
  const forgeRoot = FORGE_ROOT;
  const projectsDir = resolveProjectsDir(forgeRoot, loadConfig(defaultConfigPath(forgeRoot)));
  // The id is request-derived (an operator argument today, and this same
  // function is what a Studio "Rebuild contract" route would call), so the
  // project dir is resolved as a SEGMENT under the config-derived projects
  // root — never `join(projectsDir, id)` with a lexical `startsWith` check.
  // That check is worthless on an unresolved path (path-guard.ts's own header
  // says so) and it matters more here than usual: `projectRoot` becomes the
  // TRUSTED `root` argument for every `resolveGuardedPath`/`guardedRename`
  // call inside this module, and `resolveGuardedPath` performs no identity
  // check on its own root. A planted symlink at `projects/<id>` would
  // therefore have been followed by `realpathSync`, and the whole reset would
  // have written outside the projects root with every inner guard passing.
  // Same shape, same remedy as `cli/bridge-studio.ts:605`.
  const guardedRoot = resolveGuardedPath(projectsDir, [id]);
  if (!guardedRoot.ok) {
    console.error(`forge project reset: project path containment check failed: ${guardedRoot.reason}`);
    return 1;
  }
  if (!guardedRoot.exists) {
    console.error(`forge project reset: no project directory for ${id} under ${projectsDir}`);
    return 1;
  }
  const projectRoot = guardedRoot.realPath;

  let drift: DriftReport;
  try {
    drift = computeContractDrift(projectRoot, { forgeRoot });
  } catch (err) {
    console.error(`forge project reset: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  printDriftReport(drift);

  if (!apply) {
    console.log('');
    console.log('(dry run — nothing written; pass --apply to write these changes)');
    return 0;
  }

  try {
    const result = applyContractReset(projectRoot, drift);
    console.log('');
    console.log(`applied ${result.applied.length} section(s); moved ${result.skillMovesApplied.length} skill dir(s)`);
    console.log(`preflight: ${result.preflight.ok ? 'MET' : 'NOT MET'}`);
    return result.preflight.ok ? 0 : 1;
  } catch (err) {
    console.error(`forge project reset: apply failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
