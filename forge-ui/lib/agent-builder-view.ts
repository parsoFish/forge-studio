/**
 * Pure view-state derivation for the /agents/[id] builder (R2-09 WI-3).
 *
 * Mirrors the skill-library-view.ts / session-shell-view.ts testability
 * convention: no DOM, no React, no network — the page component and its
 * sub-components call these directly. Immutability: every function here
 * returns a NEW array/object, never mutates its input. The agents pillar
 * was the only library pillar without an extracted pure view module before
 * this initiative.
 */

import { MATERIAL_KINDS } from './studio-client';

// ---------------------------------------------------------------------------
// Materials — MATERIAL_KINDS-ordered toggle (C4)
// ---------------------------------------------------------------------------

/**
 * Toggle `kind` in `list`, returning a NEW array ordered by MATERIAL_KINDS'
 * canonical order — never click order — so the YAML preview and the saved
 * file are stable regardless of which toggle the operator clicked first.
 *
 * Fail-closed (mirrors orchestrator/studio/materials.ts's gate): a `kind`
 * outside the closed vocabulary is a no-op, never an append — there is no
 * "unknown kind ⇒ append anyway" arm.
 */
export function toggleMaterial(list: readonly string[], kind: string): string[] {
  const vocabulary: readonly string[] = MATERIAL_KINDS;
  if (!vocabulary.includes(kind)) return [...list];
  const next = list.includes(kind) ? list.filter((k) => k !== kind) : [...list, kind];
  return vocabulary.filter((k) => next.includes(k));
}

// ---------------------------------------------------------------------------
// Instructions draft lifecycle (C3, D9: never auto-saved)
// ---------------------------------------------------------------------------

/** The slice of builder state the instructions-draft lifecycle touches.
 *  A generic constraint (not a concrete type) so callers can pass their own
 *  richer state shape through unchanged — only these three fields are read
 *  or written. */
export type InstructionsDraftState = {
  instructions: string;
  dirty: boolean;
  instructionsIsDraft: boolean;
};

/**
 * Apply a fetched instructions draft to the builder state: the textarea
 * fills with the draft text, the state becomes dirty (the draft is NOT
 * auto-saved — only the operator's Save writes it, D9), and the draft flag
 * is set so the UI can show "unconfirmed draft" until save or discard.
 */
export function applyInstructionsDraft<T extends InstructionsDraftState>(state: T, draft: string): T {
  return { ...state, instructions: draft, dirty: true, instructionsIsDraft: true };
}

/**
 * Clear the draft-provenance flag — called on save-success and on discard.
 * Never touches the instructions text itself (a save persists whatever text
 * is currently in the field, draft-derived or otherwise; a discard replaces
 * the text separately from a fresh load).
 */
export function clearInstructionsDraftFlag<T extends { instructionsIsDraft: boolean }>(state: T): T {
  return { ...state, instructionsIsDraft: false };
}

/**
 * A manual edit to the instructions textarea. Sets the text and marks the
 * state dirty, but deliberately does NOT clear `instructionsIsDraft` — the
 * content is still draft-derived even after the operator tweaks it by hand,
 * and only a save-success or a discard clears that provenance flag.
 */
export function editInstructionsText<T extends { instructions: string; dirty: boolean }>(
  state: T,
  text: string,
): T {
  return { ...state, instructions: text, dirty: true };
}

// ---------------------------------------------------------------------------
// Catalog click-to-add (C2) — mirrors DropZone.tsx's ZONE_IDS + idempotent add
// ---------------------------------------------------------------------------

export type CatalogKind = 'skill' | 'tool' | 'mcp' | 'guard' | 'hook';

/** Mirrors DropZone.tsx's ZONE_IDS mapping exactly — the zone a catalog chip
 *  of a given kind is added to when clicked (rather than dragged). Returns
 *  `null` for an unknown kind, never a default zone (fail closed). */
const ZONE_TARGETS: Record<string, string> = {
  skill: 'zone-skills',
  tool: 'zone-tools',
  mcp: 'zone-mcps',
  guard: 'zone-guards',
  hook: 'zone-hooks',
};

export function catalogAddTarget(kind: string): string | null {
  return ZONE_TARGETS[kind] ?? null;
}

/**
 * Add `id` to `ids`, returning a NEW array. Adding an already-bound id is a
 * no-op (matches DropZone.tsx's `handleDrop`'s `!ids.includes(id)` guard) —
 * click-to-add must not double-bind a chip that drag-and-drop already
 * refuses to double-bind.
 */
export function addChip(ids: readonly string[], id: string): string[] {
  if (ids.includes(id)) return [...ids];
  return [...ids, id];
}

// ---------------------------------------------------------------------------
// YAML preview line builder (C5) — hooks + materials rows, declared-empty
// visibility
// ---------------------------------------------------------------------------

export type YamlPreviewComposition = {
  skills: readonly string[];
  tools: readonly string[];
  mcps: readonly string[];
  guards: readonly string[];
  hooks: readonly string[];
};

export type YamlPreviewInput = {
  composition: YamlPreviewComposition;
  materials: readonly string[];
};

/** One `key: […]` section: `key: []` inline when empty (declared-empty must
 *  be VISIBLE, never an omitted row), else `key:` followed by `  - item`
 *  lines. */
function yamlListLines(key: string, items: readonly string[]): string[] {
  if (items.length === 0) return [`${key}: []`];
  return [`${key}:`, ...items.map((item) => `  - ${item}`)];
}

/**
 * Build the plain-text preview lines for an agent's composition + materials.
 * Includes `hooks` (bound and saved, but historically missing from the
 * rendered preview — a real fidelity gap) and `materials` (new, R2-09) rows
 * alongside the pre-existing skills/tools/mcps/guards rows. `materials: []`
 * renders an explicit empty list, never an omitted row.
 */
export function buildYamlPreviewLines(input: YamlPreviewInput): string[] {
  return [
    ...yamlListLines('skills', input.composition.skills),
    ...yamlListLines('tools', input.composition.tools),
    ...yamlListLines('mcps', input.composition.mcps),
    ...yamlListLines('guards', input.composition.guards),
    ...yamlListLines('hooks', input.composition.hooks),
    ...yamlListLines('materials', input.materials),
  ];
}
