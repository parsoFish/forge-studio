/**
 * Project definition validation (ADR 027, §6) — the `project` half of what was
 * `orchestrator/studio/validate.ts`, moved here by T1 ruling 159.
 *
 * ONE rule, over the shape a project actually arrives in:
 * `validateDiscoveredProjects` checks the disk-discovered SET that
 * `discoverProjects` returns, and `apps/forge/studio-lint.ts` calls it. A pure
 * semantic check — no I/O, no mutation of inputs.
 *
 * The `.forge/project.json` CONTRACT file is a different subject with a
 * different parser: `project-config-validate.ts` in this package.
 *
 * `validateProject` USED to sit here, over a single `ProjectDefinition`, and it
 * was DELETED 2026-09-05 (bead `forge-8vfn.6.10.10`, operator ruling 204) after
 * its four rules were traced one by one:
 *
 *   - `readiness/north-star` (> 140) — `parseNorthStar` THROWS on it;
 *   - `demoProcess/kind`            — `parseDemoProcess` THROWS on it;
 *   - `skills/type`                 — `parseSkills` THROWS on it;
 *   - `slug`                        — `validateDiscoveredProjects`, below,
 *                                     checks it on the set `studio-lint`
 *                                     actually passes.
 *
 * Three of four were already enforced MORE strictly than a finding, and the
 * fourth was already here. The one rule with no other home — northStar EMPTY,
 * the "business-level emptiness check" `project-config-validate.ts` named this
 * function for — ran over `ProjectDefinition`, and **nothing in the repository
 * constructs one**: `grep -rn ProjectDefinition` answers its own declaration in
 * `packages/contracts`, this file, and this file's test. Wiring it would have
 * meant inventing the producer whose absence made it dead, which is the
 * opposite of ruling 204's question. The type itself is left for
 * `packages/contracts`' own prune (M5-A's ruling-199 census) rather than
 * reached into from here.
 */

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
