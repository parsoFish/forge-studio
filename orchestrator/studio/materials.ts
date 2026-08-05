/**
 * Forge Studio materials vocabulary (R2-09 D1-D4, "Agent-builder definition
 * parity"). A material is a broad UPLOAD KIND an agent is willing to accept
 * from the operator (images / documents / audio / data-files) — the closed
 * vocabulary an agent's optional `materials:` frontmatter field draws from.
 * SINGLE OWNER (D3): registry.ts (parse + serialize), validate.ts
 * (materials/enum lint) and derive.ts (AgentCapabilityDescriptor.materials
 * filter) all import from here — do not re-declare the vocabulary anywhere
 * else.
 *
 * D1: `materials` is modelled as a top-level optional AgentDefinition field,
 * mirroring `fanout` (NOT nested under `composition`). Parsed LENIENTLY on
 * VALUES — an unknown string survives the loader; it's a lint concern
 * (materials/enum, validate.ts), never a load-time crash, mirroring the
 * `composition` (shape, throws) vs `surface` (value, lints) split already
 * established in registry.ts. A SHAPE error (non-array, or a non-string
 * entry) DOES throw at load.
 *
 * D2: absent and `materials: []` BOTH mean "accepts nothing" for the GATE
 * (agentAcceptsMaterial) — there is no "undeclared ⇒ allow all" arm anywhere.
 * But the two stay DISTINGUISHABLE on the AgentDefinition itself (undefined
 * vs []) so registry.ts can round-trip "not declared" and "declared empty"
 * as two different on-disk shapes (see registry.test.ts).
 *
 * No runtime enforcement point consumes this yet (the upload seam is
 * R6-04-F2, a later batch) — which is exactly why the gate below is
 * fail-closed: a field that's parsed and surfaced but enforced nowhere is
 * this campaign's recurring defect shape, so nothing here fails open.
 */

import type { AgentDefinition } from './types.ts';

/** The closed, frozen materials vocabulary. Order is significant (surfaced
 *  verbatim in builder UI pickers and lint messages) — do not re-sort. */
export const MATERIAL_KINDS = Object.freeze(['images', 'documents', 'audio', 'data-files'] as const);
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

/** Hard cap on the length of a `materials:` array. The vocabulary has only
 *  `MATERIAL_KINDS.length` members, so a list longer than that is ALWAYS a
 *  shape error, not a legitimately large declaration — without this cap, a
 *  10k-element array sails through as a DoS-shaped payload (one lint finding
 *  per element on the way to a 400 response). Kept next to the vocabulary it
 *  is derived from rather than inlined at each call site (2026-08-05
 *  adversarial-review round 2, finding C/9). */
export const MAX_MATERIALS_LENGTH = MATERIAL_KINDS.length;

/**
 * Parse a raw frontmatter `materials:` value. Lenient on VALUES (an unknown
 * string survives — materials/enum in validate.ts rejects it, not this
 * function), strict on SHAPE: a non-array or a non-string entry throws.
 * `undefined` (field absent from the frontmatter) yields `undefined` —
 * DISTINCT from a declared `materials: []`, which yields `[]` (D2).
 */
export function parseMaterials(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error('materials: field must be an array of strings');
  }
  return raw.map((item, i) => {
    if (typeof item !== 'string') {
      throw new Error(`materials[${i}]: must be a string`);
    }
    return item;
  });
}

/**
 * Fail-closed capability gate (D2/D4): true iff `kind` is BOTH a member of
 * the closed vocabulary AND declared on `def.materials`. Absent materials and
 * declared-empty materials both answer false for EVERY kind — there is no
 * "undeclared ⇒ allow all" arm. A value that slipped past lint (declared on
 * the definition but outside MATERIAL_KINDS — e.g. authored before a
 * vocabulary member existed, or lint simply hasn't run yet) never grants
 * acceptance: the gate answers from VOCABULARY ∩ DECLARATION, never the
 * declaration alone.
 *
 * Guards its inputs defensively (2026-08-05 adversarial-review round 2,
 * finding A): `def` itself may be `null`/`undefined`, and `def.materials` —
 * reachable from any hand-built `AgentDefinition` that never went through
 * `loadAgentDefinition` — may be any shape at all, not just the
 * `string[] | undefined` the type declares. A bare STRING is the sharpest
 * case: `.includes(kind)` on a string resolves to
 * `String.prototype.includes`, which SUBSTRING-matches
 * (`materials: 'no-images-allowed'` + kind `'images'` → `true`, a real
 * fail-OPEN, not merely a crash). The shape is checked with `Array.isArray`
 * FIRST, before anything reaches `.includes`, so every non-array shape
 * (string, plain object, Set, number, array-like) degrades to `false` —
 * never a substring match, never a throw.
 */
export function agentAcceptsMaterial(def: AgentDefinition | null | undefined, kind: string): boolean {
  if (def === null || def === undefined) return false;
  if (!Array.isArray(def.materials)) return false;
  if (!(MATERIAL_KINDS as readonly string[]).includes(kind)) return false;
  return def.materials.includes(kind);
}
