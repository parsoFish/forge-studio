/**
 * reset-cli.ts — `forge project reset <id>`, the CLI half of the contract reset.
 *
 * Split out of `reset.ts` on 2026-09-05 when the section-level preservation for
 * `'fillOnly'` took that file to 802 lines, over the 800-line cap. The seam is
 * the one the file already drew with a banner: `reset.ts` computes and applies
 * the drift (pure decision + guarded writes), and this file is its PRESENTATION
 * and argv layer — `console.log`, exit codes, nothing else. Not one line of
 * behaviour changed in the move.
 *
 * `apps/forge/cli.ts` routes here with a single dispatch line, mirroring
 * `cmdProjectMigrate` (project-migrate.ts) exactly.
 */
import {
  FORGE_ROOT,
  PROJECT_ID_RE,
  defaultConfigPath,
  loadConfig,
  resolveGuardedPath,
  resolveProjectsDir,
} from '@forge/kernel';

import {
  applyContractReset,
  computeContractDrift,
  type DriftReport,
} from './reset.ts';

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
    console.log(`  [${row.action}] ${row.section}${row.reason === undefined ? '' : ` — ${row.reason === 'hand-authored' ? 'matches no starter; this is yours' : 'the matched starter declares nothing here'}`}`);
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
 * `forge project reset <id> [--apply] [--app-type <type>]`. Dry-run is the
 * DEFAULT and needs no confirmation — it only computes + prints the drift
 * report; `--dry-run` is also accepted explicitly (same behaviour) for
 * callers that want to name it. Only `--apply` writes.
 *
 * `--app-type` (ruling 38 fix a) is the operator's explicit override/answer
 * when `computeContractDrift` can't otherwise pin an app type — no persisted
 * `config.appType` (an onboarded project, or one created before fix c) and
 * none given here throws `AppTypeUnresolvedError`, caught below like any
 * other `computeContractDrift` throw: non-zero exit, the report is never
 * printed, and `--apply` never reaches `applyContractReset` — nothing is
 * written.
 */
export function cmdProjectReset(args: string[]): number {
  const id = args[0];
  if (!id || id.startsWith('-')) {
    console.error('usage: forge project reset <project-id> [--dry-run|--apply] [--app-type <type>]');
    return 2;
  }
  if (!PROJECT_ID_RE.test(id)) {
    console.error(`forge project reset: invalid project id — must match ${PROJECT_ID_RE}`);
    return 2;
  }
  const apply = args.includes('--apply');
  const appTypeFlagIndex = args.indexOf('--app-type');
  const appTypeFlagValue = appTypeFlagIndex >= 0 ? args[appTypeFlagIndex + 1] : undefined;
  // An EMPTY `--app-type ''` must not read as "not given": the flag was
  // passed, so the operator meant something by it, and silently falling back
  // to the unresolved path would report "pass --app-type explicitly" to
  // someone who just did. Kept as the empty string so it reaches the
  // allowlist check and is refused by name.
  const appTypeFlag = appTypeFlagValue !== undefined && !appTypeFlagValue.startsWith('--') ? appTypeFlagValue : undefined;

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
  // Same shape, same remedy as `apps/forge/bridge-studio.ts:605`.
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
    drift = computeContractDrift(projectRoot, { forgeRoot, ...(appTypeFlag !== undefined ? { appType: appTypeFlag } : {}) });
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
