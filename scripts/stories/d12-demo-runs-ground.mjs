/**
 * d12-demo-runs-ground.mjs — a provisioned fixture ground made ready the way an operator's own checkout is
 * (forge-1rk5.3 row 132): dependencies installed, and the project's declared quality gate green at HEAD in the
 * initiative worktree before anything is handed to a funded develop run. The develop loop refuses a red
 * baseline (`dev-loop.baseline-red`); checking it here costs nothing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { linkProjectDeps } from '../../packages/flows/scheduler-run-one.ts';
import { loadProjectConfig } from '../../packages/projects/project-config.ts';

const INSTALL_TIMEOUT_MS = 600_000;
const GATE_TIMEOUT_MS = 600_000;
const OUTPUT_TAIL_CHARS = 1_500;

/** `npm ci` in the ground, as an onboarded project's own checkout has had. Throws, naming the failure. */
export function installGroundDeps(projectRepoPath) {
  if (!existsSync(join(projectRepoPath, 'package.json'))) return 'no package.json — nothing to install';
  const args = existsSync(join(projectRepoPath, 'package-lock.json'))
    ? ['ci', '--no-audit', '--no-fund']
    : ['install', '--no-audit', '--no-fund'];
  execFileSync('npm', args, { cwd: projectRepoPath, stdio: 'pipe', timeout: INSTALL_TIMEOUT_MS });
  return `npm ${args[0]} ok`;
}

/**
 * Link the ground's deps into the worktree exactly as the scheduler does (`linkProjectDeps`), then run the
 * project's declared `testProcess.local.cmd` there. `{ ok, detail }`; no declared gate is NOT ok — a baseline
 * nothing can check is never reported green.
 */
export function runDeclaredGateAtHead(projectRepoPath, worktreePath) {
  let cmd;
  try {
    cmd = loadProjectConfig(projectRepoPath)?.testProcess?.local?.cmd;
  } catch (err) {
    return { ok: false, detail: `could not load the project config: ${err?.message ?? err}` };
  }
  if (!Array.isArray(cmd) || cmd.length === 0) {
    return { ok: false, detail: 'no declared testProcess.local.cmd — nothing can check the baseline' };
  }
  linkProjectDeps(projectRepoPath, worktreePath);
  const shown = cmd.join(' ');
  try {
    execFileSync(cmd[0], cmd.slice(1), { cwd: worktreePath, stdio: 'pipe', timeout: GATE_TIMEOUT_MS });
    return { ok: true, detail: `${shown} green at HEAD in ${worktreePath}` };
  } catch (err) {
    const out = `${err?.stdout ?? ''}${err?.stderr ?? ''}`.slice(-OUTPUT_TAIL_CHARS);
    return { ok: false, detail: `${shown} red at HEAD (exit ${err?.status ?? err?.signal ?? '?'}): ${out}` };
  }
}
