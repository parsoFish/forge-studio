/**
 * project-skills-bind — the pure derivations behind `SkillsBind`
 * (W8-C3 WI-4; projects-06 + projects-43).
 *
 * TWO defects lived in the same 127-line component, both instances of the
 * campaign's dominant class:
 *
 *  · **projects-06** — the picker's catalog was forge-wide ONLY
 *    (`GET /api/studio/catalog`), while the forge<->project contract puts
 *    skills INSIDE the project (`.forge/skills/<id>/SKILL.md`). Unbind a
 *    project-local skill and it could never be re-bound. Its search also
 *    matched `name`/`desc` only, so typing the id an operator reads off
 *    `project.json` found nothing.
 *  · **projects-43** — `catalog.find(c => c.id === sid)` then
 *    `{item?.name ?? sid}`. The `??` IS the defect: a binding that resolves to
 *    NOTHING was displayed as its own raw id and read as a healthy chip.
 *
 * The cure is one derivation both problems go through: build the OFFERED set
 * from every real source, then resolve each binding against it. A binding is
 * "missing" exactly when the picker could not offer it back — which makes
 * "you can't re-bind this" and "this chip is lying" the same fact, judged once.
 *
 * PURE: no fetch, no DOM, no React.
 * See `./project-skills-bind.test.ts` for the acceptance contract.
 */

/** Where an offered skill came from. */
export type SkillSource = 'forge' | 'project';

export type SkillItem = { id: string; name: string; desc?: string; source?: SkillSource };

export type SkillBinding = {
  id: string;
  resolved: boolean;
  /** `'missing'` when nothing offers this id. */
  source: SkillSource | 'missing';
  /** What to show: the offered item's name, or the raw id when unresolved —
   *  paired with `resolved: false` so a caller can never render the id alone
   *  and call it healthy. */
  label: string;
};

/**
 * Every skill the picker can offer: the forge-wide catalog, plus the
 * project's own `.forge/skills/<id>` ids that the catalog does not already
 * carry.
 *
 * An id present in BOTH is offered exactly once, with the forge-wide entry's
 * metadata — it is the same skill, and two entries for one id would make the
 * picker able to bind a duplicate.
 */
export function offeredSkills(catalog: readonly SkillItem[], localSkills: readonly string[]): SkillItem[] {
  const forgeWide: SkillItem[] = catalog.map((item) => ({ ...item, source: 'forge' }));
  const known = new Set(forgeWide.map((item) => item.id));
  const local: SkillItem[] = localSkills
    .filter((id) => !known.has(id))
    .map((id) => ({ id, name: id, desc: 'lives in this project (.forge/skills)', source: 'project' }));
  return [...forgeWide, ...local];
}

/**
 * Search across id, name and description. A whitespace-only query is NOT a
 * constraint — it is what a stray keystroke leaves behind, and treating it as
 * one empties the library and reads as "no skills".
 */
export function filterSkillCatalog(items: readonly SkillItem[], search: string): SkillItem[] {
  const needle = search.trim().toLowerCase();
  if (needle === '') return [...items];
  return items.filter((item) =>
    item.id.toLowerCase().includes(needle) ||
    item.name.toLowerCase().includes(needle) ||
    (item.desc ?? '').toLowerCase().includes(needle),
  );
}

/** Resolve one bound id against the offered set. */
export function resolveSkillBinding(id: string, offered: readonly SkillItem[]): SkillBinding {
  const item = offered.find((candidate) => candidate.id === id);
  if (item === undefined) return { id, resolved: false, source: 'missing', label: id };
  return { id, resolved: true, source: item.source ?? 'forge', label: item.name };
}
