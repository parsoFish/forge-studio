/**
 * forge↔project contract preflight — the SKILLS clause (forge-8vfn.5.13).
 *
 * THE BUG THIS CLOSES: a project's `.forge/project.json` `skills[]` names ids
 * an agent is expected to load when working the project — but nothing in
 * readiness ever checked whether a declared id resolves to a real
 * `SKILL.md`. A project whose declared skills ALL fail to resolve still read
 * `health=healthy`, `preflight-status=ok`, `flow-ready=true` — the
 * declared-data-fails-open class: a parsed and surfaced fact, enforced
 * nowhere. `SkillsBind`'s per-chip `data-resolved="missing"` already knew
 * the true fact; it just never fed into anything a gate reads.
 *
 * THE FIX IS DERIVATION, NOT A SECOND FLAG (SPEC.md §6: "Forbidden: a
 * readiness signal computed in a second place, or surfaced without being
 * enforced"). `data-preflight-status` and `data-flow-ready`
 * (`apps/studio/components/studio/project-builder/ContractReadiness.tsx`)
 * are ALREADY derived from `report.clauses` (`hardFailures = clauses.filter(
 * c => c.hard && !c.pass)`), so making this clause `hard: true` is the ONE
 * place that needs to change — no apps/studio edit required, and no new
 * stored flag anywhere.
 *
 * RESOLUTION mirrors the two sources `SkillsBind`'s own `offeredSkills`
 * derivation offers back (`apps/studio/lib/project-skills-bind.ts`): a bound
 * id resolves either to THIS project (`.forge/skills/<id>/SKILL.md`) or to
 * the forge-wide library (`<forgeRoot>/skills/<id>/SKILL.md`) — the SAME
 * project-local convention `project-roster.ts`'s `deriveProjectLocalSkills`
 * already reads (guardedFile, not a raw join — a declared skill id is
 * project-authored, not slug-validated at parse time, per
 * `project-config-validate.ts`'s `parseSkills`, so it rides the same
 * containment guard every other per-id leaf read in this codebase does).
 *
 * DELIBERATELY NOT a fix for the artifactRoot skill-layout mismatch the bead
 * ALSO reports (terraform-provider-betterado's skills living under
 * `forge/skills/<id>/` because its `artifactRoot` is `"forge"`, not
 * `.forge/skills/<id>/`) — the bead is explicit that "the defect is not the
 * layout"; a project on a non-default artifactRoot still correctly reads
 * `pass: false` here today, exactly the honest signal this clause exists to
 * produce. Closing the layout mismatch itself is a separate, larger change
 * (S3 beat 6, blocked on the not-yet-built Rebuild control) — deliberately
 * out of scope here.
 *
 * No `skills` declared at all is not a gap — it PASSES trivially. This
 * clause exists to catch a binding that LIES (declared, but dead), not to
 * mandate that every project bind one.
 */

import { readFileSync } from 'node:fs';
import { guardedFile } from '@forge/kernel';
import type { ClauseResult } from '@forge/kernel';
import type { ProjectConfig } from './project-config.ts';
import { loadProjectConfig } from './project-config.ts';

/** The one id → SKILL.md resolver for preflight and the loader: project-local,
 *  then forge-wide; `null` if neither. The id rides `guardedFile`'s containment. */
export function resolveDeclaredSkillPath(dir: string, forgeRoot: string, id: string): string | null {
  return (
    guardedFile(dir, ['.forge', 'skills', id, 'SKILL.md'], 'read') ??
    guardedFile(forgeRoot, ['skills', id, 'SKILL.md'], 'read')
  );
}

/** Named, fail-fast: a declared skill id an agent was told to load that resolves nowhere. */
export class MissingDeclaredSkillError extends Error {
  constructor(id: string, dir: string, forgeRoot: string) {
    super(
      `declared skill "${id}" does not resolve — no SKILL.md at ${dir}/.forge/skills/${id}/ (project-local) ` +
        `or ${forgeRoot}/skills/${id}/ (forge-wide)`,
    );
    this.name = 'MissingDeclaredSkillError';
  }
}

export type DeclaredSkill = { id: string; path: string; text: string };

/** Every skill the project declares, read for an agent's prompt (ADR 024, item 90).
 *  A declared id that resolves nowhere throws: a running agent has no later. */
export function loadDeclaredSkills(projectDir: string, forgeRoot: string): DeclaredSkill[] {
  const declared = loadProjectConfig(projectDir)?.skills ?? [];
  return declared.map((id) => {
    const path = resolveDeclaredSkillPath(projectDir, forgeRoot, id);
    if (path === null) throw new MissingDeclaredSkillError(id, projectDir, forgeRoot);
    return { id, path, text: readFileSync(path, 'utf8') };
  });
}

export function checkSkills(dir: string, cfg: ProjectConfig | null, forgeRoot: string): ClauseResult {
  const base = { clause: 'SKILLS' as const, title: 'Declared skills resolve (project-local or forge-wide)', hard: true };
  const declared = cfg?.skills ?? [];
  if (declared.length === 0) {
    return { ...base, pass: true, detail: 'no skills declared — nothing to resolve' };
  }

  const missing = declared.filter((id) => resolveDeclaredSkillPath(dir, forgeRoot, id) === null);

  if (missing.length === 0) {
    return { ...base, pass: true, detail: `${declared.length} declared skill(s) all resolve` };
  }
  return {
    ...base,
    pass: false,
    detail:
      `${missing.length} of ${declared.length} declared skill(s) do not resolve — no SKILL.md at ` +
      `.forge/skills/<id>/ (project-local) or <forgeRoot>/skills/<id>/ (forge-wide): ${missing.join(', ')}. ` +
      'An agent dispatched against this project silently loses these bindings.',
  };
}
