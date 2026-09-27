/**
 * The ONE `.forge/project.json` merge-writer. It was the body of the Studio
 * project PUT route (`bridge-studio-project-onboard.ts`); bead forge-mfv5.2.8
 * lifted it out unchanged so the demo-builder session's lock writes the demo
 * declaration through the same read → merge → validate → write path instead of
 * a second writer that could disagree about what "preserve the other keys"
 * means.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { resolveGuardedPath } from '@forge/kernel';

import { validateProjectConfig, readQualityGateSidecar, injectSidecarIntoTestProcess } from './project-config.ts';
import { withStudioWrite } from './project-repo-tx.ts';

/** Why a write did not happen. `containment`: the path escapes the project
 *  root. `unreadable`: the existing file is not JSON. `invalid`: the merged
 *  config fails `validateProjectConfig`. Nothing is written in any case. */
export class ProjectConfigWriteError extends Error {
  readonly reason: 'containment' | 'unreadable' | 'invalid';

  constructor(reason: 'containment' | 'unreadable' | 'invalid', message: string) {
    super(message);
    this.reason = reason;
    this.name = 'ProjectConfigWriteError';
  }
}

/**
 * Read `<projectRoot>/.forge/project.json` (an absent file reads as `{}`), let
 * `patch` compute the keys to set from it, validate the merged config, and
 * write it back committed to the project's `forge-studio` branch. Keys `patch`
 * does not return are carried over as they were. The quality-gate sidecar is
 * injected into a VALIDATION COPY only — a project that declares its gate in
 * `.forge/quality_gate_cmd` legitimately omits it from project.json, and the
 * copy is deep so the sidecar never leaks into what is written. Returns the
 * config as it was before the write.
 */
export function writeProjectConfigPatch(
  projectRoot: string,
  patch: (previous: Readonly<Record<string, unknown>>) => Record<string, unknown>,
  message: string,
): { previous: Record<string, unknown> } {
  const guard = resolveGuardedPath(projectRoot, ['.forge', 'project.json']);
  if (!guard.ok) throw new ProjectConfigWriteError('containment', `.forge/project.json containment check failed: ${guard.reason}`);
  let previous: Record<string, unknown> = {};
  if (guard.exists) {
    try {
      previous = JSON.parse(readFileSync(guard.realPath, 'utf8')) as Record<string, unknown>;
    } catch (err) {
      throw new ProjectConfigWriteError('unreadable', err instanceof Error ? err.message : String(err));
    }
  }
  const merged: Record<string, unknown> = { ...previous, ...patch(previous) };
  const forValidation = structuredClone(merged);
  const sidecar = readQualityGateSidecar(projectRoot);
  if (sidecar) injectSidecarIntoTestProcess(forValidation, sidecar);
  try {
    validateProjectConfig(forValidation);
  } catch (err) {
    throw new ProjectConfigWriteError('invalid', String(err));
  }
  // Derived from the ALREADY-GUARDED real path, never a fresh lexical join.
  const forgeDir = dirname(guard.realPath);
  if (!existsSync(forgeDir)) mkdirSync(forgeDir, { recursive: true });
  withStudioWrite(
    projectRoot,
    message,
    () => writeFileSync(guard.realPath, JSON.stringify(merged, null, 2), 'utf8'),
    ['.forge/project.json'],
  );
  return { previous };
}
