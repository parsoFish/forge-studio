/**
 * W7-FIX-A4 (W7A4-03) — the ONE place the project editor's Save payload is
 * assembled (forge-ui/app/projects/[id]/page.tsx `handleSave`).
 *
 * Why this exists: a project's KB binding is DERIVED (packages/knowledge/kb-sites.ts
 * `projectKbBindings` — from the kb.yaml whose `binding.ref` names the
 * project; "never stored"). The roster serves that derived value as
 * `project.kb`, the editor hydrates its `kb` state from it, and the bridge's
 * `PUT /api/studio/projects/:id` treats ANY present `kb` key (string or
 * null) as the operator's explicit answer and writes it into project.json —
 * where it then shadows the derivation in BOTH directions: the roster reads
 * a stored string as a rebind and a stored `null` as an UNBIND (serving no
 * kb at all), and only an ABSENT key leaves the derivation live
 * (`bridge-studio.ts` `loadProjectsWithMeta`). So the payload carries `kb`
 * ONLY when the operator actually changed the binding in this editing
 * session (`kbTouched`); an untouched binding — derived or not — is not
 * echoed back, because echoing it would freeze a live derivation.
 */
export type ProjectSaveFields = {
  name: string;
  northStar: string;
  instructions: string;
  demoProcess: unknown[];
  skills: string[];
  /** The editor's current KB binding state (derived-or-explicit, from the roster). */
  kb: string | null;
  /** True only when the operator changed the binding via KbBind in this session. */
  kbTouched: boolean;
};

export type ProjectSavePayload = {
  name: string;
  northStar: string;
  instructions: string;
  demoProcess: unknown[];
  skills: string[];
  /** Present ONLY when `kbTouched` — string = rebind, null = explicit unbind. */
  kb?: string | null;
};

export function buildProjectSavePayload(f: ProjectSaveFields): ProjectSavePayload {
  return {
    name: f.name.trim(),
    northStar: f.northStar.trim(),
    instructions: f.instructions.trim(),
    demoProcess: f.demoProcess,
    skills: f.skills,
    // Deliberately `...(cond ? {kb} : {})` and not `kb: cond ? kb : undefined`:
    // the bridge checks `b['kb'] !== undefined`, and JSON.stringify drops an
    // undefined value anyway — but a present-with-undefined key would still
    // read as "the editor sent kb" to anyone diffing the object client-side.
    ...(f.kbTouched ? { kb: f.kb } : {}),
  };
}
