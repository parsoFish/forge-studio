// ---------------------------------------------------------------------------
// template-authoring-view — the writable-category source of truth for the
// /templates/new builder and its authoring launcher.
//
// W8-B4 WI-4 originally declared these ON `app/templates/new/page.tsx`.
// A Next.js `page.tsx` may only export the framework's whitelisted names
// (`default`, `metadata`, `dynamic`, …), so exporting them there fails
// `next build` with "does not match the required types of a Next.js Page"
// — a constraint `tsc -p forge-ui/tsconfig.tests.json` cannot see, because
// it does not read Next's generated route types. They live here instead,
// with the page importing them. Same reason `HookLibraryResults.tsx` was
// split out of `app/hooks/page.tsx`.
//
// The point of the derivation: `project-scaffold` is excluded from the
// authoring launcher BY OMISSION from this one map — never by a second
// hard-coded list of "what is offered", which is the two-lists-can-disagree
// (`declared-data-fails-open`) shape. A category added here flows into the
// offered set automatically.
// ---------------------------------------------------------------------------

export type WritableCategory = 'planning' | 'demo-output';

export const CATEGORY_LABEL: Record<WritableCategory, string> = {
  planning: 'Planning (studio/artifact-templates)',
  'demo-output': 'Demo output (studio/demo-elements)',
};

/**
 * The authoring-launcher's "what can it draft" guidance is DERIVED from
 * {@link CATEGORY_LABEL} — never a second literal list. Exported as a pure
 * function taking the map so the derivation MECHANISM can be pinned
 * independently of what the map happens to contain today (see
 * `components/AuthoringLauncher.test.ts`).
 */
export function writableCategoryNames(labels: Record<string, string>): string[] {
  return Object.values(labels);
}
