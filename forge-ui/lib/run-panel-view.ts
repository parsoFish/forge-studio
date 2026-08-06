/**
 * Pure decision logic for RunPanel.tsx (R6-04 WI-3) — the client-side
 * materials gate mirror and the cost-ceiling dispatch decision. Extracted
 * from the component so it can be unit-tested without jsdom/
 * `@testing-library/react` (neither is installed in this repo — see
 * `./run-panel-render.test.ts`'s header for the rendering-only alternative
 * that covers the component itself).
 *
 * THE CLIENT GATE IS A CONVENIENCE MIRROR — the server
 * (`cli/ui-bridge.ts`'s `validateMaterialsField` / the `POST
 * /api/agents/:slug/run` costCeilingUsd guard, R6-04 WI-1/WI-2) remains the
 * authority. This module exists so an operator gets an immediate, correctly-
 * worded refusal instead of round-tripping to the server for a mistake this
 * file already knows about — it must never be treated as replacing the
 * server check.
 *
 * The numeric caps and extension→kind table mirror
 * `orchestrator/studio/materials.ts` (`MATERIAL_KINDS`,
 * `MAX_MATERIALS_COUNT`, `MAX_MATERIAL_BYTES`, `MAX_MATERIALS_TOTAL_BYTES`,
 * `materialKindForFilename`) as LITERALS — forge-ui cannot import
 * orchestrator/ TypeScript directly (the same constraint
 * `SHIPPED_TRIGGER_KINDS` documents for itself in `./studio-client.ts`).
 * Keep this table and these caps in lockstep with that module by hand; the
 * message-shape tests in `./run-panel-view.test.ts` will go red the moment
 * either side drifts.
 */

// ---------------------------------------------------------------------------
// Caps — mirrors orchestrator/studio/materials.ts
// ---------------------------------------------------------------------------

/** Mirrors orchestrator/studio/materials.ts MAX_MATERIALS_COUNT. */
const MAX_MATERIALS_COUNT = 8;
/** Mirrors orchestrator/studio/materials.ts MAX_MATERIAL_BYTES (256 KiB). */
const MAX_MATERIAL_BYTES = 262144;
/** Mirrors orchestrator/studio/materials.ts MAX_MATERIALS_TOTAL_BYTES (512 KiB). */
const MAX_MATERIALS_TOTAL_BYTES = 524288;

/**
 * Mirrors orchestrator/studio/materials.ts's MATERIAL_EXTENSION_TO_KIND.
 * DELIBERATE EXCLUSION: `.svg` is NOT mapped to `images` — SVG is an
 * active-content format (can embed `<script>`), so it must never be bucketed
 * with inert raster images. See that module's own comment for the full
 * threat-model rationale before "fixing" this as a missing extension.
 */
const MATERIAL_EXTENSION_TO_KIND: Readonly<Record<string, string>> = Object.freeze({
  // images
  png: 'images', jpg: 'images', jpeg: 'images', gif: 'images', webp: 'images',
  // documents
  md: 'documents', txt: 'documents', pdf: 'documents', docx: 'documents',
  // audio
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', flac: 'audio',
  // data-files
  json: 'data-files', csv: 'data-files', tsv: 'data-files', yaml: 'data-files', yml: 'data-files', ndjson: 'data-files',
});

/** Mirrors orchestrator/studio/materials.ts's materialKindForFilename. */
function materialKindForFilename(filename: string): string | undefined {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) return undefined;
  const ext = filename.slice(lastDot + 1).toLowerCase();
  return MATERIAL_EXTENSION_TO_KIND[ext];
}

/** Mirrors cli/ui-bridge.ts's declaredMaterialKindsClause — the server's
 *  exact literal ("(none)") for an empty declared-kinds list. */
function declaredMaterialKindsClause(declared: readonly string[]): string {
  return declared.length > 0 ? declared.join(', ') : '(none)';
}

export type MaterialEntryMeta = { filename: string; sizeBytes: number };
export type MaterialsClientValidation = { ok: true } | { ok: false; error: string };

/**
 * Client-side mirror of `validateMaterialsField` (cli/ui-bridge.ts): the
 * SAME order (count cap, then per-entry: per-file size cap, running-total
 * cap, then the kind gate) and the SAME message shapes, character for
 * character. Never authoritative — see this module's header.
 */
export function validateMaterialsClientSide(
  entries: MaterialEntryMeta[],
  declaredKinds: string[],
  slug: string,
): MaterialsClientValidation {
  if (entries.length > MAX_MATERIALS_COUNT) {
    return {
      ok: false,
      error: `materials: at most ${MAX_MATERIALS_COUNT} materials per request (got ${entries.length})`,
    };
  }

  let totalBytes = 0;
  for (const entry of entries) {
    if (entry.sizeBytes > MAX_MATERIAL_BYTES) {
      return {
        ok: false,
        error: `materials: "${entry.filename}" exceeds the per-file size cap (${MAX_MATERIAL_BYTES} bytes)`,
      };
    }
    totalBytes += entry.sizeBytes;
    if (totalBytes > MAX_MATERIALS_TOTAL_BYTES) {
      return {
        ok: false,
        error: `materials: total size exceeds the request cap (${MAX_MATERIALS_TOTAL_BYTES} bytes)`,
      };
    }

    const kind = materialKindForFilename(entry.filename);
    if (!kind) {
      return {
        ok: false,
        error: `materials: "${entry.filename}" maps to no material kind; agent "${slug}" declares: ${declaredMaterialKindsClause(declaredKinds)}`,
      };
    }
    if (!declaredKinds.includes(kind)) {
      return {
        ok: false,
        error: `materials: "${entry.filename}" is ${kind}; agent "${slug}" declares: ${declaredMaterialKindsClause(declaredKinds)}`,
      };
    }
  }

  return { ok: true };
}

/**
 * The cost-ceiling dispatch decision (R6-04 WI-3 headline pin): "an operator
 * never submits a ceiling that will be refused." Gated purely on the AGENT's
 * enforceability (a fact about the agent, invariant under the value) — NOT
 * on the value's truthiness, so an enforceable agent with a ceiling of
 * exactly 0 still dispatches 0, not `undefined`.
 */
export function resolveCostCeilingForDispatch(inputValue: number, enforceable: boolean): number | undefined {
  return enforceable ? inputValue : undefined;
}
