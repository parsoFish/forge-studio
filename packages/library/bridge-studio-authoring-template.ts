/**
 * `kind:'template'` install strategy for the studio-authoring finalize
 * route. Split out of `bridge-studio-authoring.ts` (M4-library PR 4b) — see
 * that file's header for the full route contract this strategy is one arm
 * of.
 *
 * `sanitizeError` rides in as a parameter (never a direct `cli/` import)
 * because that would make this a NEW importer of `cli/bridge-studio.ts` —
 * the retained route file already imports it and passes it down.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import matter from 'gray-matter';
import { resolveGuardedPath, guardedReadFile } from '@forge/kernel';
import { isReservedId } from '@forge/kernel/ids.ts';
import { listTemplateLibrary } from './studio/template-library.ts';
import {
  writableCategoryOrReason,
  WRITABLE_CATEGORY_DIRS,
  invalidTemplateIdReason,
  invalidTemplateContentReason,
} from './bridge-studio-templates.ts';
import { INTERACTIVE_LIBRARY_DIRNAME, type InstallOutcome } from './bridge-studio-authoring-types.ts';

// ---------------------------------------------------------------------------
// kind:"template" (W8-B4/WI-3) — the SAME posture as kind:"hook": template
// METADATA comes from the LANDED, DRAFTED template.md, parsed server-side,
// never from parallel request-body fields.
//
// A template is ONE markdown file with gray-matter frontmatter
// (apps/studio/app/templates/new/page.tsx's own seedContent — the manual
// builder's precedent; orchestrator/studio/template-library.ts D1) — never a
// multi-file package, unlike skill/hook. The creation-agent session drafts it
// at the ONE canonical staging filename `staging/template.md`
// (TEMPLATE_STAGING_FILENAME below), mirroring `SKILL.md`/`hook.yaml`'s own
// one-canonical-name-per-shape convention, and lands unchanged at
// `_interactive-library/<id>/template.md`.
//
// `category` ('planning' | 'demo-output') is NOT a field of a REAL, installed
// template.md — template-library.ts's D1 states category is STRUCTURAL,
// derived from which directory a definition lives in, never sniffed from
// content. But the interactive session has no separate structured "category"
// channel the way the manual /templates/new builder's own UI select does
// (apps/studio/app/templates/new/page.tsx) — so the drafted file carries
// `category` as a DRAFT-ONLY routing hint in its frontmatter, read HERE to
// pick the target directory, validated by the SAME `writableCategoryOrReason`
// the POST /api/studio/templates route uses (never a second, drifting copy
// of "which categories are writable" / "why project-scaffold isn't" — reuses
// that exact function AND its `SCAFFOLD_READONLY` constant), then STRIPPED
// before the persisted bytes are written — so an installed, authored
// template's frontmatter is byte-identical in shape to one authored by hand
// through /templates/new.
// ---------------------------------------------------------------------------

const TEMPLATE_STAGING_FILENAME = 'template.md';

export function finalizeTemplateFromLanded(
  forgeRoot: string,
  id: string,
  sanitizeError: (err: unknown) => string,
): InstallOutcome {
  // Layer 1 — SHAPE, the SAME checks POST /api/studio/templates runs before
  // any write: slug shape/length, then the reserved-id collision with the
  // /templates/new builder's own fixed path.
  const invalidId = invalidTemplateIdReason(id);
  if (invalidId) return { ok: false, status: 400, error: invalidId };
  if (isReservedId(id)) {
    return {
      ok: false,
      status: 400,
      error: `template id "${id}" is reserved (the /templates/new builder lives at that path) — choose another id`,
    };
  }

  const raw = guardedReadFile(forgeRoot, [INTERACTIVE_LIBRARY_DIRNAME, id, TEMPLATE_STAGING_FILENAME]);
  if (raw === null) {
    return { ok: false, status: 400, error: `drafted ${TEMPLATE_STAGING_FILENAME} is missing from the landed package "${id}"` };
  }

  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(raw, {});
  } catch (err) {
    return { ok: false, status: 400, error: `drafted ${TEMPLATE_STAGING_FILENAME} is not valid frontmatter: ${sanitizeError(err)}` };
  }
  const data: unknown = parsed.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return {
      ok: false,
      status: 400,
      error: `drafted ${TEMPLATE_STAGING_FILENAME} frontmatter must be a YAML mapping (object), not a scalar/array/null`,
    };
  }
  const { category: draftedCategory, ...persistedData } = data as Record<string, unknown>;

  // Layer 2 — the SAME category rule POST /api/studio/templates enforces
  // (never a second copy): refuses an unknown category generically and
  // 'project-scaffold' specifically via SCAFFOLD_READONLY.
  const categoryCheck = writableCategoryOrReason(draftedCategory);
  if ('error' in categoryCheck) {
    return { ok: false, status: 400, error: categoryCheck.error };
  }
  const category = categoryCheck.category;

  // Library-wide uniqueness — the SAME check POST /api/studio/templates
  // runs, against the REAL library (never the ghost _interactive-library
  // copy — see the file header's LANDED-PACKAGE CLEANUP note / library-37).
  if (listTemplateLibrary(forgeRoot).some((e) => e.id === id)) {
    return { ok: false, status: 409, error: `template "${id}" already exists` };
  }

  // Reconstruct WITHOUT the draft-only "category" routing field — a real,
  // installed template.md never carries one (category is structural, D1).
  const content = matter.stringify(parsed.content, persistedData);

  // Layer 3 — CONTENT: the SAME real-category-loader check
  // (invalidTemplateContentReason) POST /api/studio/templates uses — never a
  // re-implemented field list.
  const invalidContent = invalidTemplateContentReason(forgeRoot, category, id, content);
  if (invalidContent) return { ok: false, status: 400, error: invalidContent };

  // Layer 4 — CONTAINMENT: the SAME guarded choke point
  // POST /api/studio/templates uses — never a fresh lexical join.
  const dirSegments = WRITABLE_CATEGORY_DIRS[category];
  const targetGuard = resolveGuardedPath(resolve(forgeRoot, ...dirSegments), [`${id}.md`]);
  if (!targetGuard.ok) return { ok: false, status: 400, error: 'path traversal detected' };
  if (targetGuard.exists) return { ok: false, status: 409, error: `template "${id}" already exists` };

  writeFileSync(targetGuard.realPath, content, 'utf8');
  return { ok: true };
}
