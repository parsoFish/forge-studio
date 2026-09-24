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
 * THIRD RESOLUTION SOURCE (M7 findings row 21, closing the gap this file
 * used to defer): a bound id ALSO resolves at `<artifactRoot>/skills/<id>/
 * SKILL.md` — the exact terraform-provider-betterado shape (`artifactRoot:
 * "forge"`, skills living under `forge/skills/<id>/`). This used to read
 * `pass: false` here, deferred as "a separate, larger change (S3 beat 6,
 * blocked on the not-yet-built Rebuild control)". The Rebuild control has
 * since shipped (`reset.ts`'s `computeContractDrift`/`applyContractReset`,
 * Studio's `RebuildContractPanel`) and its own `computeSkillsDrift` already
 * treats this exact location as "the one evidenced alternate" (see that
 * function's header) — this clause was the one place still blind to it,
 * refusing a claim the Rebuild control would happily relocate. Resolving it
 * here does not replace the Rebuild control: a project may leave a skill
 * living under `artifactRoot` indefinitely (this clause now passes it) or
 * run "Rebuild contract" to physically move it to the canonical
 * `.forge/skills/<id>/` path — both are valid. `artifactRoot` is read off
 * the already-validated `cfg.artifactRoot` (parsed once by
 * `project-config.ts`'s `parseArtifactRoot`, which already rejects an
 * absolute value, a backslash, or a `..` segment) — never re-parsed here —
 * and, like every other per-id leaf read in this file, rides `guardedFile`'s
 * containment guard, never a raw join.
 *
 * No `skills` declared at all is not a gap — it PASSES trivially. This
 * clause exists to catch a binding that LIES (declared, but dead), not to
 * mandate that every project bind one.
 */

import { guardedFile } from '@forge/kernel';
import type { ClauseResult } from '@forge/kernel';
import type { ProjectConfig } from './project-config.ts';

/**
 * Splits an optional `artifactRoot` into path segments for `guardedFile`.
 * Mirrors `reset.ts`'s private `artifactRootSegments` (same semantics, not
 * imported: `reset.ts` imports `runPreflight` from `preflight.ts`, which
 * imports `checkSkills` from this file, so an import the other way would
 * cycle). `artifactRoot` itself is never re-parsed from disk here — it
 * arrives already validated on `cfg.artifactRoot`.
 */
function artifactRootSegments(artifactRoot: string | undefined): string[] {
  if (!artifactRoot) return [];
  return artifactRoot.split('/').filter((s) => s.length > 0 && s !== '.');
}

export function checkSkills(dir: string, cfg: ProjectConfig | null, forgeRoot: string): ClauseResult {
  const base = {
    clause: 'SKILLS' as const,
    title: 'Declared skills resolve (project-local, forge-wide, or under artifactRoot)',
    hard: true,
  };
  const declared = cfg?.skills ?? [];
  if (declared.length === 0) {
    return { ...base, pass: true, detail: 'no skills declared — nothing to resolve' };
  }

  const artifactSegs = artifactRootSegments(cfg?.artifactRoot);

  const missing = declared.filter((id) => {
    const local = guardedFile(dir, ['.forge', 'skills', id, 'SKILL.md'], 'read');
    if (local !== null) return false;
    const forgeWide = guardedFile(forgeRoot, ['skills', id, 'SKILL.md'], 'read');
    if (forgeWide !== null) return false;
    if (artifactSegs.length === 0) return true;
    const underArtifactRoot = guardedFile(dir, [...artifactSegs, 'skills', id, 'SKILL.md'], 'read');
    return underArtifactRoot === null;
  });

  if (missing.length === 0) {
    return { ...base, pass: true, detail: `${declared.length} declared skill(s) all resolve` };
  }
  return {
    ...base,
    pass: false,
    detail:
      `${missing.length} of ${declared.length} declared skill(s) do not resolve — no SKILL.md at ` +
      '.forge/skills/<id>/ (project-local), <forgeRoot>/skills/<id>/ (forge-wide)' +
      `${artifactSegs.length > 0 ? `, or ${artifactSegs.join('/')}/skills/<id>/ (artifactRoot)` : ''}: ` +
      `${missing.join(', ')}. An agent dispatched against this project silently loses these bindings.`,
  };
}
