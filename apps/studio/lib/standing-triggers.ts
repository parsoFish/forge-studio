/**
 * Standing-trigger selection (R6-01 WI-4, the rider parked by R6-04).
 *
 * SOURCE OF TRUTH is the server: `GET /api/triggers` (handler
 * `apps/forge/bridge-studio.ts`) scans every registered flow's OWN `triggers:`
 * declarations and emits `{on, target:{kind,ref}, projects, sourceFlowId}`.
 * Nothing here re-derives a trigger fact — this module only SELECTS and
 * VALIDATES what the wire already said.
 *
 * The `projects: null` (unscoped — the declaration carries no `projects:`
 * key, so the trigger fires for every project) vs `projects: []` (declared
 * empty — scoped to nothing) distinction is preserved by the server all the
 * way to the wire (ADR-027's R2-08 amendment rule 1) and is preserved here
 * too: collapsing them would make an always-fires trigger read as if it
 * never fires. `StandingTriggers.tsx` renders that distinction as
 * `data-trigger-scope-count="all"` vs `"0"`.
 *
 * `target` is structurally the same shape as `studio-client.ts`'s
 * `TriggerTarget` and is deliberately re-declared rather than imported:
 * `studio-client.ts` imports THIS module (for `fetchStandingTriggers`), so
 * importing back would be a cycle.
 */

export type StandingTrigger = {
  /** The event that fires the trigger — the declaration's `on:` (e.g. 'merged'). */
  on: string;
  /** What the trigger starts. `kind: 'agent'` is the only kind this surface lists. */
  target: { kind: 'flow' | 'agent'; ref: string };
  /** `null` = unscoped (no `projects:` key declared); `[]` = declared empty. NEVER collapsed. */
  projects: string[] | null;
  /** The flow whose `flow.yaml` declares this trigger — its provenance. */
  sourceFlowId: string;
};

/**
 * The standing triggers whose target is THIS agent.
 *
 * Matching is exact on both fields: `target.kind === 'agent'` AND
 * `target.ref === agentSlug`. A flow-targeted trigger that happens to share
 * the ref string, a trigger whose `sourceFlowId` equals the slug, and a
 * similarly-named agent ref (`reflector-v2`) are all NON-matches.
 *
 * Returns a new array; the input is never mutated or reordered.
 */
export function standingTriggersForAgent(
  agentSlug: string,
  triggers: StandingTrigger[],
): StandingTrigger[] {
  return triggers.filter((t) => t.target.kind === 'agent' && t.target.ref === agentSlug);
}

/**
 * How a trigger's project scope renders on the DOM
 * (`data-trigger-scope-count`, reserved vocabulary — see
 * docs/forge-ui-dom-and-harness.md "Trigger provenance"):
 *
 *   null / absent -> 'all'  (unscoped: fires for every project)
 *   []            -> '0'    (declared empty: scoped to nothing)
 *   [...N]        -> '<N>'
 *
 * `Array.isArray` rather than `=== null` on purpose: absent and `null` mean
 * the same thing on the wire (the server maps `undefined` → `null`), and a
 * `.length` read on either would throw inside a render.
 */
export function triggerScopeCount(projects: string[] | null): string {
  return Array.isArray(projects) ? String(projects.length) : 'all';
}

/**
 * Validate a raw `GET /api/triggers` payload row into a `StandingTrigger`,
 * returning null if it does not conform.
 *
 * The wire is external input, and this data is rendered inside the agent
 * page's React tree: an unvalidated row missing `target` would throw on
 * `t.target.kind` during render and blank the whole page. Validation happens
 * here, at the boundary, so the render path can trust its own types.
 */
export function parseStandingTrigger(raw: unknown): StandingTrigger | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const target = r.target as Record<string, unknown> | undefined;
  if (typeof r.on !== 'string' || r.on === '') return null;
  if (typeof r.sourceFlowId !== 'string' || r.sourceFlowId === '') return null;
  if (!target || typeof target !== 'object') return null;
  if (target.kind !== 'flow' && target.kind !== 'agent') return null;
  if (typeof target.ref !== 'string' || target.ref === '') return null;
  const projects = r.projects;
  // Unscoped is `null` on the wire; an absent key means the same thing. A
  // present-but-not-an-array `projects` is malformed, not "unscoped".
  if (projects !== null && projects !== undefined && !Array.isArray(projects)) return null;
  if (Array.isArray(projects) && projects.some((p) => typeof p !== 'string')) return null;
  return {
    on: r.on,
    target: { kind: target.kind, ref: target.ref },
    projects: Array.isArray(projects) ? (projects as string[]).slice() : null,
    sourceFlowId: r.sourceFlowId,
  };
}

/**
 * Parse the whole `{triggers: [...]}` payload. A single malformed row is
 * dropped rather than sinking the listing — the same rule the server applies
 * to a malformed `flow.yaml` when building this very payload ("one malformed
 * flow.yaml must not sink the whole listing", apps/forge/bridge-studio.ts). A
 * non-array payload yields an empty list.
 */
export function parseStandingTriggers(raw: unknown): StandingTrigger[] {
  if (!Array.isArray(raw)) return [];
  const out: StandingTrigger[] = [];
  for (const row of raw) {
    const parsed = parseStandingTrigger(row);
    if (parsed) out.push(parsed);
  }
  return out;
}
