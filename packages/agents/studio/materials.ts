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

import type { AgentDefinition } from '@forge/contracts/studio/types.ts';

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

/**
 * Extension → kind table for `materialKindForFilename` (R6-04-F2, WI-1: the
 * agent-kickoff upload seam — this gate's first real caller). A closed
 * ALLOWLIST, not a denylist: every extension not listed here derives
 * `undefined`, including several that would otherwise "obviously" fit a
 * kind. Deliberately excluded (see `materialKindForFilename`'s own comment
 * for the reasoning, kept there rather than here since that is where a
 * future reader will look to "fix" the gap): `.svg`.
 */
const MATERIAL_EXTENSION_TO_KIND: Readonly<Record<string, MaterialKind>> = Object.freeze({
  // images
  png: 'images', jpg: 'images', jpeg: 'images', gif: 'images', webp: 'images',
  // documents
  md: 'documents', txt: 'documents', pdf: 'documents', docx: 'documents',
  // audio
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', flac: 'audio',
  // data-files
  json: 'data-files', csv: 'data-files', tsv: 'data-files', yaml: 'data-files', yml: 'data-files', ndjson: 'data-files',
});

/**
 * Derive a `MaterialKind` from a filename's EXTENSION alone (R6-04-F2
 * contract point 4) — the kind a client-supplied upload maps to is always
 * computed server-side from this function, never trusted from a
 * client-supplied `kind` field. Case-insensitive; the LAST extension wins
 * (`notes.tar.gz` inspects `.gz`, not `.tar`); no extension (or a filename
 * ending in a bare `.` with nothing after it) yields `undefined`.
 *
 * This is an ALLOWLIST: any extension not explicitly present in
 * `MATERIAL_EXTENSION_TO_KIND` yields `undefined`, including several that
 * would "obviously" seem to fit a kind (`.zip`, `.html`, `.js`, ...) — an
 * unrecognized extension is refused, not guessed at.
 *
 * DELIBERATE EXCLUSION — `.svg` is NOT mapped to `images`, even though an
 * SVG is visually an image and every other common image extension is
 * listed. SVG is an ACTIVE-CONTENT format: it can embed `<script>` and
 * other executable content, and a run view may later render an accepted
 * "images" material directly (e.g. an `<img>`/inline preview). Accepting
 * `.svg` into the same bucket as inert raster images would hand an
 * attacker-controlled upload a route to script execution in whatever
 * surface renders it. A future reader WILL be tempted to "fix" this as a
 * missing image extension — it is not a gap, it is the point. Do not add
 * `svg` to the images list above without re-litigating that render-time
 * threat model first.
 */
export function materialKindForFilename(filename: string): MaterialKind | undefined {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) return undefined;
  const ext = filename.slice(lastDot + 1).toLowerCase();
  return MATERIAL_EXTENSION_TO_KIND[ext];
}

/**
 * Caps for one agent-kickoff `materials:` upload (R6-04-F2 contract point
 * 6), derived from the bridge's fixed request-body ceiling
 * (`MAX_BODY_BYTES = 1 MiB`, `cli/ui-bridge.ts` ~line 3207) rather than
 * picked as round numbers in isolation. This module stays `fs`-free (it is
 * the vocabulary owner, imported by the loader/lint/wire projection too) and
 * deliberately does NOT import `MAX_BODY_BYTES` — it is a module-private
 * constant in a `cli/` module or a mirrored literal, and `orchestrator/` must
 * not depend on `cli/` (the established import direction). The relationship
 * is instead documented here, in numbers, and pinned by a drift test
 * (`materials.test.ts`) asserting `MAX_MATERIALS_TOTAL_BYTES < MAX_BODY_BYTES`
 * against a literal mirror.
 *
 * Why the numbers below leave real headroom, not just enough to scrape
 * under the ceiling: a base64 encoding inflates DECODED bytes by 4/3
 * (`ceil(n/3)*4`), and the JSON request body then wraps every material in
 * envelope punctuation (`filename`/`contentBase64` keys, quotes, commas) on
 * top of that, alongside whatever else the route's body already carries
 * (`inputs`, `project`). A cap picked at, say, 90% of `MAX_BODY_BYTES` would
 * already be over the ceiling once base64 inflation alone is accounted for
 * — the decoded cap has to be well below `MAX_BODY_BYTES`, not merely below
 * it.
 *
 * `MAX_MATERIALS_TOTAL_BYTES` is fixed at exactly HALF of the 1 MiB body
 * ceiling (512 KiB decoded). At that boundary, base64 inflation alone
 * consumes `ceil(524288/3)*4 = 699052` bytes — ~66.7% of the 1 MiB ceiling —
 * leaving ~349 KiB (~33%) of headroom for JSON envelope overhead and every
 * other body field. That is comfortably more than the few hundred bytes
 * even `MAX_MATERIALS_COUNT` filenames/punctuation could ever add.
 */
export const MAX_MATERIALS_TOTAL_BYTES = 512 * 1024; // 524288 decoded bytes — half of the 1 MiB body ceiling

/**
 * Per-file cap: half of `MAX_MATERIALS_TOTAL_BYTES`, so no single file can
 * alone exhaust an entire request's material budget — at least two
 * meaningfully-sized files must be nameable within one request's total cap.
 */
export const MAX_MATERIAL_BYTES = 256 * 1024; // 262144 decoded bytes

/**
 * Cap on the number of materials in a single request. A small, fixed count
 * — a kickoff upload is meant to hand an agent a handful of reference
 * files, not act as a bulk-upload channel; `MAX_MATERIALS_TOTAL_BYTES`
 * already bounds the aggregate size regardless of count.
 */
export const MAX_MATERIALS_COUNT = 8;
