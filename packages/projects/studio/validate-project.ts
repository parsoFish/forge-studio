/**
 * Project definition validation (ADR 027, §6) — the `project` half of what was
 * `orchestrator/studio/validate.ts`, moved here by T1 ruling 159.
 *
 * Two rules, one per shape a project arrives in: `validateProject` checks a
 * single `ProjectDefinition` (the studio object), `validateDiscoveredProjects`
 * checks the disk-discovered SET that `discoverProjects` returns. Pure semantic
 * checks — no I/O, no mutation of inputs.
 *
 * The `.forge/project.json` CONTRACT file is a different subject with a
 * different parser: `project-config-validate.ts` in this package.
 */

import type { ProjectDefinition } from '@forge/contracts/studio/types.ts';
import { DEMO_STEP_KINDS } from '@forge/contracts/studio/types.ts';
import { type Finding, err, flag } from '@forge/kernel/findings.ts';
import { PROJECT_ID_RE } from '@forge/kernel/ids.ts';

/**
 * Duplicate-id helper — the local copy this package's one caller needs. See
 * the same note in `packages/flows/studio/validate-flow.ts`: ruling 159 keeps
 * `@forge/kernel` to ids and findings, and `packages/library` already carries
 * its own copy of this nine-line predicate.
 */
function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

export function validateProject(def: ProjectDefinition): Finding[] {
  const findings: Finding[] = [];
  const obj = `project:${def.id}`;

  // id rule (W7-A4: case-preserving, matched exactly — see PROJECT_ID_RE)
  if (!PROJECT_ID_RE.test(def.id)) {
    findings.push(err(obj, 'slug', `Project id "${def.id}" does not match ${PROJECT_ID_RE}`));
  }

  // northStar: empty → flag; >140 → error
  if (!def.northStar.trim()) {
    findings.push(flag(obj, 'readiness/north-star', 'Project northStar is missing or blank'));
  } else if (def.northStar.length > 140) {
    findings.push(
      err(
        obj,
        'readiness/north-star',
        `Project northStar must be ≤ 140 characters (got ${def.northStar.length})`,
      ),
    );
  }

  // demoProcess: each step's kind must be in the enum
  for (let i = 0; i < def.demoProcess.length; i++) {
    const step = def.demoProcess[i];
    if (!DEMO_STEP_KINDS.includes(step.kind)) {
      findings.push(
        err(
          obj,
          'demoProcess/kind',
          `demoProcess[${i}].kind "${step.kind}" must be one of capture|verify|present`,
        ),
      );
    }
  }

  // skills: all entries must be strings
  for (let i = 0; i < def.skills.length; i++) {
    if (typeof def.skills[i] !== 'string') {
      findings.push(
        err(obj, 'skills/type', `skills[${i}] must be a string (got ${typeof def.skills[i]})`),
      );
    }
  }

  return findings;
}

/**
 * Validate the disk-discovered project set (B1 — projects are auto-discovered
 * from `<projectsDir>/*` rather than a `studio/projects.yaml` registry). The
 * caller supplies the `discoverProjects` result. Errors: a project id that
 * cannot form a slug (the dir name produced an empty/invalid id) or a duplicate
 * id (two dirs slug to the same id). Flag (warn): a project dir without a
 * `.forge/project.json` — a half-onboarded project forge will skip until its
 * contract file lands.
 */
export function validateDiscoveredProjects(
  projects: ReadonlyArray<{ id: string; path: string; hasConfig: boolean }>,
): Finding[] {
  const findings: Finding[] = [];
  const obj = 'projects';

  // unique-ids
  for (const dup of findDuplicates(projects.map((p) => p.id))) {
    findings.push(err(obj, 'unique-ids', `Duplicate project id "${dup}" (two project dirs carry the same id)`));
  }

  for (const project of projects) {
    // id rule per project id (defensive — discoverProjects only publishes
    // ids that already satisfy PROJECT_ID_RE, W7-A4)
    if (!PROJECT_ID_RE.test(project.id)) {
      findings.push(err(obj, 'slug', `Project id "${project.id}" does not match ${PROJECT_ID_RE}`));
    }
    // half-onboarded: a dir without the contract file is a warn, not an error.
    if (!project.hasConfig) {
      findings.push(
        flag(
          obj,
          'missing-config',
          `Project dir "${project.path}" has no .forge/project.json — forge will skip it until the contract file is added (run \`forge preflight ${project.id}\` / the forge-onboard-project skill).`,
        ),
      );
    }
  }

  return findings;
}
